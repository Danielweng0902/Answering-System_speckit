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
import { timedRequest } from './httpClient.mjs';

/**
 * 老師 HTTP 登入。
 *
 * 2026-11-22（D18）：登入狀態改放在 **HttpOnly cookie**，登入回應不再
 * 回傳 token。這個工具要模擬瀏覽器，因此取出 `Set-Cookie` 的
 * `classroom.teacher.session=<token>` 並以 `Cookie` 標頭帶著走。
 *
 * 回傳值是 cookie 標頭字串；呼叫方不得印出或寫檔（它就是憑證）。
 */
export async function loginTeacher(baseUrl, password) {
  const result = await timedRequest({
    url: new URL('/api/teacher/login', baseUrl),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
    agent: false,
    timeoutMs: 8000,
  });
  if (result.error !== null || result.statusCode !== 200) {
    throw new Error('老師登入失敗');
  }
  const setCookie = result.headers?.['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof raw !== 'string') {
    throw new Error('老師登入回應缺少 session cookie');
  }
  const match = /classroom\.teacher\.session=([^;]+)/.exec(raw);
  if (match === null || match[1] === undefined) {
    throw new Error('老師登入回應缺少 session cookie');
  }
  return `classroom.teacher.session=${match[1]}`;
}

async function pollingGet(baseUrl, query, timeoutMs, cookie) {
  const url = new URL('/socket.io/', baseUrl);
  url.search = new URLSearchParams(query).toString();
  const result = await timedRequest({
    url,
    headers: cookie === undefined ? {} : { cookie },
    agent: false,
    timeoutMs,
  });
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

async function pollingPost(baseUrl, query, packet, timeoutMs, cookie) {
  const url = new URL('/socket.io/', baseUrl);
  url.search = new URLSearchParams(query).toString();
  const result = await timedRequest({
    url,
    method: 'POST',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      ...(cookie === undefined ? {} : { cookie }),
    },
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
 *
 * 2026-11-22（D18）：老師身分改由 cookie 認證，所以 CONNECT 封包不再帶
 * token，改由 polling 請求帶 `Cookie` 標頭。
 */
export async function createGroupViaTeacherSocket(baseUrl, cookie, { timeoutMs = 10_000 } = {}) {
  const name = `load-${randomBytes(6).toString('hex')}`;
  const query = { EIO: '4', transport: 'polling' };

  const handshake = await pollingGet(baseUrl, query, timeoutMs, cookie);
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
  // CONNECT 封包帶 auth；此封包含憑證，任何 log 都不得輸出。
  await pollingPost(baseUrl, open, `40${JSON.stringify({})}`, timeoutMs, cookie);
  const connected = await pollingGet(baseUrl, open, timeoutMs, cookie);
  if (!splitPackets(connected).some((packet) => packet.startsWith('40'))) {
    throw new Error('Socket.IO 連線未成功（缺少 connect ack）');
  }

  try {
    await pollingPost(
      baseUrl,
      open,
      `420${JSON.stringify(['group:create', { name }])}`,
      timeoutMs,
      cookie,
    );

    const deadline = Date.now() + timeoutMs;
    let ack = null;
    let groupId = null;
    while (Date.now() < deadline && (ack === null || groupId === null)) {
      const payload = await pollingGet(
        baseUrl,
        open,
        Math.max(1000, deadline - Date.now()),
        cookie,
      );
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
    await pollingPost(baseUrl, open, '41', 2000, cookie).catch(() => {});
  }
}
