import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, waitForState, type TestServer } from './helpers.js';

describe('foundational server connections', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('immediately sends a guest snapshot without a token', async () => {
    const socket = server.connect({ autoConnect: false });
    const statePromise = waitForState(socket);
    socket.connect();

    const state = await statePromise;

    expect(state.role).toBe('guest');
    expect(state.phase).toBe('preparing');
    expect(state.groups).toEqual([]);
    expect(state).not.toHaveProperty('presence');
  });

  it('returns JSON from the health endpoint', async () => {
    const response = await fetch(`${server.url}/api/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('returns the contract error format for invalid JSON', async () => {
    const response = await fetch(`${server.url}/api/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INVALID_INPUT', message: expect.any(String) },
    });
  });
});
