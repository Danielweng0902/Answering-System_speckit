/** 壓測目標的安全邊界：預設只准本機，避免工具被誤用成對外掃壓工具。 */
import { URL } from 'node:url';

function normalizeIpv4(candidate) {
  const parts = candidate.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    ? parts.map(Number)
    : null;
}

/** 只承認 loopback：127/8、localhost 與 ::1（含 bracket / IPv4-mapped IPv6）。 */
export function isLoopbackHostname(hostname) {
  let normalized = String(hostname).trim().toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice('::ffff:'.length);
  }
  if (normalized === 'localhost' || normalized === '::1') return true;
  const ipv4 = normalizeIpv4(normalized);
  return ipv4 !== null && ipv4[0] === 127;
}

/**
 * 解析並驗證 --url。回傳 URL 物件，呼叫方會以 base 的部分進行量測。
 * - loopback：HTTP 或 HTTPS 均可用（本機正式產物目前只跑 HTTP）；
 * - 其他主機：必須明確 allowRemote，且必須是 HTTPS（密碼與 token 不可明文出網）；
 * - 其他 protocol：一律拒絕，避免 node:http 對 https 的混用或把工具用於 HTTP 以外服務。
 */
export function resolveTargetUrl(rawUrl, { allowRemote = false } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`--url 不是合法網址：${rawUrl}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('--url 只支援 HTTP／HTTPS，不支援其他 protocol');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('--url 不得內嵌帳號或密碼；憑證只能從環境變數提供');
  }

  const loopback = isLoopbackHostname(url.hostname);
  if (!loopback && !allowRemote) {
    throw new Error(
      '安全限制：負載目標預設只允許 loopback（127.0.0.1／localhost／::1）；' +
        '量測遠端目標需明確加上 --allow-remote',
    );
  }
  if (!loopback && url.protocol !== 'https:') {
    throw new Error(
      '拒絕執行：非 loopback 目標必須使用 HTTPS；HTTP 會讓老師密碼與 token 明文穿網路',
    );
  }
  return url;
}
