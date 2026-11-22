/**
 * 老師登入狀態（2026-11-22；D18 與 OpenSpec 組對齊）。
 *
 * 對方的 teacher-auth 規格要求「登入狀態無法被頁面上的 JavaScript 讀取」，
 * 我們原本把 token 放在 sessionStorage（頁面 JS 讀得到），因此改成
 * **HttpOnly cookie**：
 *
 * - 登入成功：伺服器以 `Set-Cookie` 發出 session cookie，**回應本文不含
 *   憑證**，頁面 JavaScript 拿不到 token。
 * - 老師的 HTTP 端點與 Socket.IO 握手都改讀 cookie。
 * - 登出：刪掉伺服器端 session 並清除 cookie。
 * - 伺服器重新啟動時清掉所有老師 session（見 access.ts 的
 *   `deleteTeacherSessions`），所以重啟後必須重新登入。
 *
 * Cookie 屬性：
 * - `HttpOnly`：頁面 JavaScript 讀不到。
 * - `SameSite=Lax`：同源的呼叫一定會帶；從別的網站連過來的 top-level
 *   導覽也會帶（Lax），避免老師從 messenger 的連結點進來就被登出。
 * - `Path=/`：老師端與 API 都在同一個來源。
 * - 不設 `Secure`：課堂多數是區網 HTTP，設了 Secure cookie 反而會登入不了。
 *   （正式環境要走 HTTPS 時再加。）
 */
import type { Request, Response } from 'express';

/** 老師 session cookie 的名稱。 */
export const TEACHER_SESSION_COOKIE = 'classroom.teacher.session';

/** 解析 Cookie 標頭；同名 cookie 取第一個值。 */
export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header === undefined || header.length === 0) {
    return cookies;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name.length > 0 && !cookies.has(name)) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

/** 從 Cookie 標頭取出老師 session token；沒有或格式不對時為 null。 */
export function readTeacherCookieToken(
  cookieHeader: string | undefined,
): string | null {
  const token = parseCookies(cookieHeader).get(TEACHER_SESSION_COOKIE);
  return token !== undefined && token.length > 0 ? token : null;
}

/** 從 `Authorization: Bearer <token>` 取出 token；沒有時為 null。 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();
  return token !== undefined && token.length > 0 ? token : null;
}

/**
 * 老師端點的憑證來源：**先看 cookie，再看 Bearer**。
 *
 * 瀏覽器路徑只會用到 cookie（前端不再持有 token）；Bearer 保留給
 * 指令列工具與既有整合測試，兩者都只到伺服器端，瀏覽器仍讀不到憑證。
 */
export function readTeacherToken(request: Request): string | null {
  return (
    readTeacherCookieToken(request.headers.cookie) ?? bearerToken(request)
  );
}

/** 發出老師 session cookie（HttpOnly，工作階段 cookie）。 */
export function setTeacherSessionCookie(
  response: Response,
  token: string,
): void {
  response.setHeader(
    'Set-Cookie',
    `${TEACHER_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`,
  );
}

/** 清除老師 session cookie。 */
export function clearTeacherSessionCookie(response: Response): void {
  response.setHeader(
    'Set-Cookie',
    `${TEACHER_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}
