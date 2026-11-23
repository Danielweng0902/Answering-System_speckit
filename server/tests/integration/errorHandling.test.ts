import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { Server as SocketIOServer } from 'socket.io';
import { io as createSocketIOClient, type Socket } from 'socket.io-client';
import type { Ack } from '@classroom/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import { registerCommand } from '../../src/infra/socket/commandRouter.js';
import { createSocketBroadcaster } from '../../src/infra/socket/broadcaster.js';
import { initializeDatabase } from '../../src/infra/db/database.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { createApp } from '../../src/infra/http/app.js';
import {
  seedQuestion,
  sendCommand,
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

/**
 * 等待條件成立（最多 5 秒）；條件不成立就讓測試以斷言失敗收尾。
 *
 * 2026-11-22：CI 跑器比本機慢，用固定 sleep 等非同步結果會造成間歇性失敗。
 */
async function waitUntil(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      expect(condition(), '等待條件逾時').toBe(true);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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
    // 等待伺服器真的記錄了這筆錯誤：固定睡 200 ms 在忙碌的機器（CI 跑器）
    // 上可能還沒處理完 socket 事件就斷言，會造成間歇性失敗。
    await waitUntil(() =>
      errorSpy.mock.calls.flat().map(String).join('\n').includes('activity:close'),
    );

    expect(socket.connected).toBe(true);
    expect(broadcast).not.toHaveBeenCalled();
    const response = await fetch(`${server.url}/api/health`);
    expect(response.status).toBe(200);
    const logged = errorSpy.mock.calls.flat().map(String).join('\n');
    expect(logged).toContain('activity:close');
    expect(logged).not.toContain('payload-value');
  });

  it('HTTP 非預期錯誤不把例外訊息或堆疊寫進 stderr（2026-11-21 資安審計）', async () => {
    const database = new DatabaseSync(':memory:');
    initializeDatabase(database);
    const app = createApp({ database, teacherPassword: undefined });
    database.close();
    const httpServer = createHttpServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;

    const logged: string[] = [];
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join('\n'));
      });

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/student/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: 'g1' }),
      });
      await response.arrayBuffer();
      expect(response.status).toBe(500);
      // stderr 只允許固定字串，不得含堆疊、資料庫路徑或 SQL。
      const output = logged.join('\n');
      expect(output).not.toMatch(/\bat .+\.(ts|js):\d+/);
      expect(output).not.toContain('database');
      expect(output).not.toContain('SQLITE');
      expect(output).not.toContain('Error:');
    } finally {
      errorSpy.mockRestore();
      await new Promise((resolve) => httpServer.close(resolve));
    }
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

  it('定向廣播中一個 teacher emit 拋例外時，其他 teacher 仍收到 state', async () => {
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
      // 2026-11-22（D20，100 組）：老師看板的廣播會在同一個時間窗內合併，
      // 這裡等時間窗過去再斷言（廣播本身仍逐個 socket 送出、例外仍被隔離）。
      await new Promise((resolve) => setTimeout(resolve, 300));

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

describe('伺服器關閉後的待處理計時器（2026-11-22 CI 失敗回歸）', () => {
  it('dispose() 會清掉老師看板的合併廣播計時器（資料庫關閉後不會再觸發）', async () => {
    // 情境：作答後老師看板的合併廣播排了 120 ms 的計時器 → 伺服器在計時器
    // 觸發前就關閉（資料庫一併關閉）。若計時器沒被清掉，它會讀已關閉的
    // SQLite 而拋出 ERR_INVALID_STATE（變成未處理的例外，CI 第一次失敗）。
    //
    // 訊號：flushTeacherBoard 會把這類例外記成 'Broadcast teacher board failed.'，
    // 因此斷言「伺服器關閉後不該出現這筆錯誤」。
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const database = memoryDatabase();
    const broadcaster = createSocketBroadcaster(
      fakeBroadcasterIo(teacherSocket(vi.fn())),
      database,
    );

    broadcaster.broadcastSubmissionChanged('group-1');
    broadcaster.dispose();
    database.close();

    // 等過合併視窗（120 ms）。
    await new Promise((resolve) => setTimeout(resolve, 400));

    const logged = errorSpy.mock.calls.flat().map(String).join('\n');
    expect(logged).not.toContain('Broadcast teacher board failed.');
  });

  it('作答後立刻關閉伺服器，不會在資料庫關閉後觸發看板廣播', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const local = await startTestServer();
    insertGroup(local.db, { id: 'group-1', name: '第一組', position: 1 });
    seedQuestion(local.db);

    const teacher = local.connect({
      token: issueSession(local.db, { role: 'teacher' }),
      autoConnect: false,
    });
    const teacherState = waitForState(teacher);
    teacher.connect();
    await teacherState;
    await sendCommand(teacher, 'activity:open', {});

    const student = local.connect({
      token: issueSession(local.db, { role: 'student', groupId: 'group-1' }),
      autoConnect: false,
    });
    const studentState = waitForState(student);
    student.connect();
    await studentState;

    // 作答會觸發老師看板的合併廣播（排入 120 ms 計時器）；ack 是在廣播之後
    // 才送出的，所以等到 ack 就確定計時器已經排入。
    await sendCommand(student, 'answer:submit', {
      questionNumber: 1,
      answers: ['答案'],
    });

    await local.close();

    // 等過合併視窗：伺服器關閉後不得再讀已關閉的資料庫。
    await new Promise((resolve) => setTimeout(resolve, 400));

    const logged = errorSpy.mock.calls.flat().map(String).join('\n');
    expect(logged).not.toContain('Broadcast teacher board failed.');
  });
});
