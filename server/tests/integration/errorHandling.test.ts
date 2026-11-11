import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerCommand } from '../../src/infra/socket/commandRouter.js';
import { initializeDatabase } from '../../src/infra/db/database.js';
import { createApp } from '../../src/infra/http/app.js';
import {
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

describe('例外處理（GLM 複查發現）', () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    vi.restoreAllMocks();
  });

  it('指令用例拋出例外時伺服器不崩潰，連線仍可使用，log 不含 payload', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    server = await startTestServer();
    const broadcast = vi.fn();
    server.io.on('connection', (socket) => {
      registerCommand(socket, 'activity:close', ['guest'], () => {
        throw new Error('boom');
      }, broadcast);
    });

    const socket = server.connect({ autoConnect: false });
    const initial = waitForState(socket);
    socket.connect();
    await initial;

    socket.emit('activity:close', { secretField: 'payload-value' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(socket.connected).toBe(true);
    expect(broadcast).not.toHaveBeenCalled();
    const response = await fetch(`${server.url}/api/health`);
    expect(response.status).toBe(200);
    const logged = errorSpy.mock.calls.flat().map(String).join('\n');
    expect(logged).toContain('activity:close');
    expect(logged).not.toContain('payload-value');
  });

  it('HTTP 非預期錯誤不回傳堆疊', async () => {
    const database = new DatabaseSync(':memory:');
    initializeDatabase(database);
    const app = createApp({ database, teacherPassword: undefined });
    database.close();
    const httpServer = createHttpServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/student/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: 'g1' }),
      });
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(text).not.toMatch(/\bat .+\.(ts|js):\d+/);
      expect(text).not.toContain('database');
    } finally {
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });
});
