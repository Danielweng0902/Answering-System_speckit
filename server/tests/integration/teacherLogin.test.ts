import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('POST /api/teacher/login', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer({ teacherPassword: TEACHER_PW });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.close();
  });

  it('returns a token for the correct password and the token yields teacher snapshots', async () => {
    const response = await login(server, TEACHER_PW);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string; role: string };
    expect(body.role).toBe('teacher');
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);

    const socket = server.connect({ token: body.token, autoConnect: false });
    const statePromise = waitForState(socket);
    socket.connect();

    const state = await statePromise;
    expect(state.role).toBe('teacher');
    expect(state).toHaveProperty('presence');
    expect(state.phase).toBe('preparing');
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
    const { token } = JSON.parse(successText) as { token: string };

    const failure = await login(server, 'another-wrong-password');
    expect(failure.status).toBe(401);
    await failure.arrayBuffer();

    const logged = spies
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .join('\n');

    expect(logged).not.toContain(TEACHER_PW);
    expect(logged).not.toContain(token);
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
