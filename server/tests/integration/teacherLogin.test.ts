import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeRateLimitSource } from '../../src/infra/http/authRoutes.js';
import {
  TEACHER_SESSION_COOKIE,
  readTeacherCookieToken,
} from '../../src/infra/http/teacherSession.js';
import {
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

const TEACHER_PW = 'test-pass-123';

async function login(
  server: TestServer,
  password: string,
): Promise<Response> {
  return fetch(`${server.url}/api/teacher/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

/** 2026-11-22（D18）：登入狀態在 HttpOnly cookie 裡，測試也走同一條路。 */
async function loginAndGetCookie(
  server: TestServer,
  password = TEACHER_PW,
): Promise<string> {
  const response = await login(server, password);
  expect(response.status).toBe(200);
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).not.toBeNull();
  const cookie = readTeacherCookieToken(setCookie ?? undefined);
  expect(cookie).not.toBeNull();
  return `${TEACHER_SESSION_COOKIE}=${cookie as string}`;
}

describe('POST /api/teacher/login', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer({ teacherPassword: TEACHER_PW });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.close();
  });

  it('以 HttpOnly cookie 建立登入狀態，回應本文不含憑證', async () => {
    const response = await login(server, TEACHER_PW);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      role: string;
      authenticated: boolean;
      token?: string;
    };
    expect(body.role).toBe('teacher');
    expect(body.authenticated).toBe(true);
    // 2026-11-22（D18）：頁面 JavaScript 讀不到憑證，回應裡不得有 token。
    expect(body.token).toBeUndefined();

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${TEACHER_SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });

  it('帶 cookie 連線會拿到老師快照', async () => {
    const cookie = await loginAndGetCookie(server);
    const token = readTeacherCookieToken(cookie);

    const socket = server.connect({ cookie, autoConnect: false });
    const statePromise = waitForState(socket);
    socket.connect();

    const state = await statePromise;
    expect(state.role).toBe('teacher');
    expect(state).toHaveProperty('presence');
    expect(state.phase).toBe('preparing');
    expect(token).not.toBeNull();
  });

  it('rejects a wrong password with 401 WRONG_PASSWORD', async () => {
    const response = await login(server, 'definitely-wrong');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'WRONG_PASSWORD', message: expect.any(String) },
    });
  });

  it('rejects a malformed body with 400 INVALID_INPUT', async () => {
    const response = await fetch(`${server.url}/api/teacher/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INVALID_INPUT', message: expect.any(String) },
    });
  });

  it('responds 429 TOO_MANY_ATTEMPTS after 10 failures within a minute', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await login(server, 'wrong-password');
      expect(response.status).toBe(401);
      await response.arrayBuffer();
    }

    const response = await login(server, 'wrong-password');

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'TOO_MANY_ATTEMPTS', message: expect.any(String) },
    });

    // 鎖定期間即使密碼正確也一律拒絕。
    const blocked = await login(server, TEACHER_PW);
    expect(blocked.status).toBe(429);
    await blocked.arrayBuffer();
  });

  it('速率限制的來源位址已正規化（IPv4 與 IPv6 不再是兩個 key）', () => {
    // 2026-11-21 資安審計：原本直接用 request.ip，127.0.0.1 與 ::1 會被當成
    // 兩個來源 → 換一種位址表示法就能完全繞過限流（實測：猜 10 次 → 429；
    // 改用 [::1] 立刻恢復可猜）。
    expect(normalizeRateLimitSource('127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeRateLimitSource('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeRateLimitSource('::1')).toBe('127.0.0.1');
    expect(normalizeRateLimitSource('0:0:0:0:0:0:0:1')).toBe('127.0.0.1');
    expect(normalizeRateLimitSource('2001:db8:1:2:3:4::5')).toBe(
      '2001:db8:1:2::/64',
    );
    expect(normalizeRateLimitSource('2001:db8:1234:5678::9')).toBe(
      '2001:db8:1234:5678::/64',
    );
    expect(normalizeRateLimitSource('unknown')).toBe('unknown');
  });

  it('never logs nor returns the password or token', async () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'info'),
    ];

    const success = await login(server, TEACHER_PW);
    expect(success.status).toBe(200);
    const successText = await success.text();
    expect(successText).not.toContain(TEACHER_PW);
    const token = readTeacherCookieToken(
      success.headers.get('set-cookie') ?? undefined,
    );

    const failure = await login(server, 'another-wrong-password');
    expect(failure.status).toBe(401);
    await failure.arrayBuffer();

    const logged = spies
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .join('\n');

    expect(logged).not.toContain(TEACHER_PW);
    expect(logged).not.toContain(token ?? '');
  });

  it('responds 503 TEACHER_PASSWORD_NOT_SET when no password is configured', async () => {
    const withoutPassword = await startTestServer({ teacherPassword: '' });
    try {
      const response = await login(withoutPassword, TEACHER_PW);

      expect(response.status).toBe(503);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({
        error: { code: 'TEACHER_PASSWORD_NOT_SET', message: expect.any(String) },
      });
      expect(text).not.toContain(TEACHER_PW);
    } finally {
      await withoutPassword.close();
    }
  });
});

describe('GET /api/teacher/session', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer({ teacherPassword: TEACHER_PW });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.close();
  });

  it('未登入時回 authenticated=false、密碼已設定', async () => {
    const response = await fetch(`${server.url}/api/teacher/session`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
      passwordConfigured: true,
    });
  });

  it('帶有效 cookie 時回 authenticated=true', async () => {
    const cookie = await loginAndGetCookie(server);

    const response = await fetch(`${server.url}/api/teacher/session`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      passwordConfigured: true,
    });
  });

  it('沒有設定密碼時回 passwordConfigured=false', async () => {
    const withoutPassword = await startTestServer({ teacherPassword: '' });
    try {
      const response = await fetch(`${withoutPassword.url}/api/teacher/session`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        authenticated: false,
        passwordConfigured: false,
      });
    } finally {
      await withoutPassword.close();
    }
  });
});

describe('POST /api/teacher/logout', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer({ teacherPassword: TEACHER_PW });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.close();
  });

  it('登出後 session 立即失效，cookie 被清除', async () => {
    const cookie = await loginAndGetCookie(server);

    const before = await fetch(`${server.url}/api/teacher/session`, {
      headers: { cookie },
    });
    expect(((await before.json()) as { authenticated: boolean }).authenticated).toBe(
      true,
    );

    const response = await fetch(`${server.url}/api/teacher/logout`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');

    const after = await fetch(`${server.url}/api/teacher/session`, {
      headers: { cookie },
    });
    expect(((await after.json()) as { authenticated: boolean }).authenticated).toBe(
      false,
    );
  });

  it('沒有登入狀態時也回 200（冪等）', async () => {
    const response = await fetch(`${server.url}/api/teacher/logout`, {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
