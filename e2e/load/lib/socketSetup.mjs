/**
 * 負載測試的前置設定：老師登入 + 用老師 API 建立組別。
 *
 * 組別只能透過 Socket.IO 指令 group:create 建立（沒有對應的 HTTP 路由）。
 * 這裡不引入第三方 Socket.IO client，而是用 node:http 實作 Engine.IO v4
 * long-polling 的最小客戶端，只供「設定」使用（不是量測對象）：
 *
 *   GET  /socket.io/?EIO=4&transport=polling          → 握手，取得 sid
 *   POST ...&sid=…  body `40{"token":"…"}`            → Socket.IO 連線＋身分
 *   GET  ...&sid=…                                     → 收 `40{...}` 連線成功
 *   POST ...&sid=…  body `420["group:create",{...}]`   → 建組別（ack id 0）
 *   GET  ...&sid=…                                     → 收 `430[...]` ack 與
 *                                                          `42["state",{...}]` 快照
 *
 * ack 只有 { ok: true }，新建組別的 id 要從 state 快照的 groups 裡依名稱找。
 * 密碼與 token 只存在本 process 記憶體；任何錯誤訊息都不包含它們。
 */
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { URL, URLSearchParams } from 'node:url';
import { postJson, timedRequest } from './httpClient.mjs';

/** 老師 HTTP 登入，回傳 token（呼叫方不得印出或寫檔）。 */
export async function loginTeacher(baseUrl, password) {
  const body = await postJson(`${baseUrl}/api/teacher/login`, { password });
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new Error('老師登入回應缺少 token');
  }
  return body.token;
}

async function pollingGet(baseUrl, query, timeoutMs) {
  const url = new URL('/socket.io/', baseUrl);
  url.search = new URLSearchParams(query).toString();
  const result = await timedRequest({ url, agent: false, timeoutMs });
  if (result.error !== null) {
    throw new Error(
      `Socket.IO polling GET 失敗（${result.error === 'timeout' ? '逾時' : '連線錯誤'}）`,
    );
  }
  if (result.statusCode !== 200) {
    throw new Error(`Socket.IO polling GET 回應 ${result.statusCode}`);
  }
  return (result.body ?? Buffer.alloc(0)).toString('utf8');
}

async function pollingPost(baseUrl, query, packet, timeoutMs) {
  const url = new URL('/socket.io/', baseUrl);
  url.search = new URLSearchParams(query).toString();
  const result = await timedRequest({
    url,
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: packet,
    agent: false,
    timeoutMs,
  });
  if (result.error !== null) {
    throw new Error(
      `Socket.IO polling POST 失敗（${result.error === 'timeout' ? '逾時' : '連線錯誤'}）`,
    );
  }
  if (result.statusCode !== 200) {
    throw new Error(`Socket.IO polling POST 回應 ${result.statusCode}`);
  }
}

/** Engine.IO v4 polling payload：多個封包以 \x1e 分隔。 */
function splitPackets(payload) {
  return payload.split('\x1e').filter((packet) => packet.length > 0);
}

/**
 * 以老師身分經 Socket.IO 的 group:create 指令建立組別，回傳新組別的 groupId。
 * 每次呼叫使用隨機組名，避免與既有組別撞名。
 */
export async function createGroupViaTeacherSocket(baseUrl, token, { timeoutMs = 10_000 } = {}) {
  const name = `load-${randomBytes(6).toString('hex')}`;
  const query = { EIO: '4', transport: 'polling' };

  const handshake = await pollingGet(baseUrl, query, timeoutMs);
  if (!handshake.startsWith('0')) {
    throw new Error('Socket.IO 握手回應格式不符（缺少 open 封包）');
  }
  let sid;
  try {
    sid = JSON.parse(handshake.slice(1)).sid;
  } catch {
    throw new Error('Socket.IO 握手回應無法解析');
  }
  if (typeof sid !== 'string' || sid.length === 0) {
    throw new Error('Socket.IO 握手缺少 sid');
  }

  const open = { ...query, sid };
  // CONNECT 封包帶 auth token；此封包含密鑰，任何 log 都不得輸出。
  await pollingPost(baseUrl, open, `40${JSON.stringify({ token })}`, timeoutMs);
  const connected = await pollingGet(baseUrl, open, timeoutMs);
  if (!splitPackets(connected).some((packet) => packet.startsWith('40'))) {
    throw new Error('Socket.IO 連線未成功（缺少 connect ack）');
  }

  try {
    await pollingPost(baseUrl, open, `420${JSON.stringify(['group:create', { name }])}`, timeoutMs);

    const deadline = Date.now() + timeoutMs;
    let ack = null;
    let groupId = null;
    while (Date.now() < deadline && (ack === null || groupId === null)) {
      const payload = await pollingGet(baseUrl, open, Math.max(1000, deadline - Date.now()));
      for (const packet of splitPackets(payload)) {
        if (packet.startsWith('430')) {
          ack = JSON.parse(packet.slice(3))[0];
        } else if (packet.startsWith('42')) {
          const [event, snapshot] = JSON.parse(packet.slice(2));
          if (event === 'state' && Array.isArray(snapshot?.groups)) {
            const created = snapshot.groups.find((group) => group.name === name);
            if (created) {
              groupId = created.id;
            }
          }
        }
      }
    }
    if (ack === null) {
      throw new Error('group:create 在逾時前沒有收到 ack');
    }
    if (ack.ok !== true) {
      throw new Error(`group:create 被拒絕（代碼 ${ack.error?.code ?? '未知'}）`);
    }
    if (groupId === null) {
      throw new Error('group:create 成功但 state 快照中找不到新組別');
    }
    return groupId;
  } finally {
    // 盡力關閉；失敗不影響設定結果（polling 連線會由伺服器 ping 逾時回收）。
    await pollingPost(baseUrl, open, '41', 2000).catch(() => {});
  }
}
