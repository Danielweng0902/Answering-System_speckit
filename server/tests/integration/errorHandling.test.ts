import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { Server as SocketIOServer } from 'socket.io';
import { io as createSocketIOClient, type Socket } from 'socket.io-client';
import type { Ack } from '@classroom/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerCommand } from '../../src/infra/socket/commandRouter.js';
import { createSocketBroadcaster } from '../../src/infra/socket/broadcaster.js';
import { initializeDatabase } from '../../src/infra/db/database.js';
import { createApp } from '../../src/infra/http/app.js';
import {
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

function fakeBroadcasterIo(...sockets: Socket[]): SocketIOServer {
  return {
    on: vi.fn(),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`socket-${index}`, socket])),
    },
  } as unknown as SocketIOServer;
}

function teacherSocket(emit: ReturnType<typeof vi.fn>): Socket {
  return {
    data: { identity: { role: 'teacher' } },
    emit,
  } as unknown as Socket;
}

function memoryDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  initializeDatabase(database);
  return database;
}

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

/**
 * T060：只掛 registerCommand 的獨立 Socket.IO 伺服器。不用 startTestServer，
 * 因為正式伺服器也對同一事件註冊 handler，其角色檢查會先送出 FORBIDDEN
 * ack（Socket.IO 同一 ack id 只送第一次），使「原 ack 恰一次」無法觀察。
 */
async function startRouterOnlyServer(
  broadcastState: () => void,
  broadcastOnSuccess?: (identity: unknown, payload: unknown) => void,
): Promise<{ url: string; io: SocketIOServer; client: () => Socket }> {
  const httpServer = createHttpServer();
  const io = new SocketIOServer(httpServer);
  io.on('connection', (socket) => {
    registerCommand(
      socket,
      'activity:close',
      ['guest'],
      () => ({ ok: true }),
      broadcastState,
      broadcastOnSuccess,
    );
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    io,
    client: () =>
      createSocketIOClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      }),
  };
}

describe('廣播例外處理（T060）', () => {
  it('用例成功後全域廣播拋出例外時，仍回覆原 ack 恰一次且連線存活，log 不含 payload', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broadcastState = vi.fn(() => {
      throw new Error('default-broadcast-boom');
    });
    const routerServer = await startRouterOnlyServer(broadcastState);
    const socket = routerServer.client();
    const acks: Ack[] = [];

    try {
      const firstAck = new Promise<void>((resolve) => {
        socket.emit(
          'activity:close',
          { secretField: 'default-broadcast-secret' },
          (ack: Ack) => {
            acks.push(ack);
            resolve();
          },
        );
      });
      await firstAck;
      await new Promise((resolve) => setTimeout(resolve, 200));

      // 用例已成功：廣播失敗不得吞掉 ack，也不得重送（恰一次）。
      expect(acks).toEqual([{ ok: true }]);
      expect(socket.connected).toBe(true);

      // 連線仍可用的證據：同一連線再送一次，仍收到 ack。
      await new Promise<void>((resolve) => {
        socket.emit('activity:close', {}, (ack: Ack) => {
          acks.push(ack);
          resolve();
        });
      });
      expect(acks).toEqual([{ ok: true }, { ok: true }]);
      expect(broadcastState).toHaveBeenCalledTimes(2);

      const logged = errorSpy.mock.calls.flat().map(String).join('\n');
      expect(logged).toContain('activity:close');
      expect(logged).not.toContain('default-broadcast-secret');
      expect(logged).not.toContain('default-broadcast-boom');
    } finally {
      socket.removeAllListeners();
      socket.disconnect();
      await new Promise<void>((resolve) => routerServer.io.close(() => resolve()));
      vi.restoreAllMocks();
    }
  });

  it('定向廣播拋出例外時，仍回覆原 ack 恰一次且連線存活，且未改用全域廣播', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broadcastState = vi.fn();
    const directedBroadcast = vi.fn(() => {
      throw new Error('directed-broadcast-boom');
    });
    const routerServer = await startRouterOnlyServer(
      broadcastState,
      directedBroadcast,
    );
    const socket = routerServer.client();
    const acks: Ack[] = [];

    try {
      await new Promise<void>((resolve) => {
        socket.emit(
          'activity:close',
          { secretField: 'directed-broadcast-secret' },
          (ack: Ack) => {
            acks.push(ack);
            resolve();
          },
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(acks).toEqual([{ ok: true }]);
      expect(socket.connected).toBe(true);
      expect(directedBroadcast).toHaveBeenCalledTimes(1);
      expect(broadcastState).not.toHaveBeenCalled();

      const logged = errorSpy.mock.calls.flat().map(String).join('\n');
      expect(logged).toContain('activity:close');
      expect(logged).not.toContain('directed-broadcast-secret');
      expect(logged).not.toContain('directed-broadcast-boom');
    } finally {
      socket.removeAllListeners();
      socket.disconnect();
      await new Promise<void>((resolve) => routerServer.io.close(() => resolve()));
      vi.restoreAllMocks();
    }
  });
});

describe('broadcaster 單一連線例外隔離（T063）', () => {
  it('全域廣播中一個 socket emit 拋例外時，後續連線仍收到 state，log 不含快照內容', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwingEmit = vi.fn(() => {
      throw new Error('global-socket-secret');
    });
    const normalEmit = vi.fn();
    const database = memoryDatabase();

    try {
      const broadcaster = createSocketBroadcaster(
        fakeBroadcasterIo(
          teacherSocket(throwingEmit),
          teacherSocket(normalEmit),
        ),
        database,
      );
      broadcaster.broadcastState();

      expect(throwingEmit).toHaveBeenCalledTimes(1);
      expect(normalEmit).toHaveBeenCalledTimes(1);
      expect(normalEmit.mock.calls[0]?.[0]).toBe('state');
      const logged = errorSpy.mock.calls.flat().map(String).join('\n');
      expect(logged).toContain('Broadcast state failed.');
      expect(logged).not.toContain('global-socket-secret');
    } finally {
      database.close();
      vi.restoreAllMocks();
    }
  });

  it('定向廣播中一個 teacher emit 拋例外時，其他 teacher 仍收到 state', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwingEmit = vi.fn(() => {
      throw new Error('directed-socket-secret');
    });
    const normalEmit = vi.fn();
    const database = memoryDatabase();

    try {
      const broadcaster = createSocketBroadcaster(
        fakeBroadcasterIo(
          teacherSocket(throwingEmit),
          teacherSocket(normalEmit),
        ),
        database,
      );
      broadcaster.broadcastSubmissionChanged('group-1');

      expect(throwingEmit).toHaveBeenCalledTimes(1);
      expect(normalEmit).toHaveBeenCalledTimes(1);
      expect(normalEmit.mock.calls[0]?.[0]).toBe('state');
      const logged = errorSpy.mock.calls.flat().map(String).join('\n');
      expect(logged).toContain('Broadcast state failed.');
      expect(logged).not.toContain('directed-socket-secret');
    } finally {
      database.close();
      vi.restoreAllMocks();
    }
  });
});
