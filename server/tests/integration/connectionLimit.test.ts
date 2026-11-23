import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import type { Socket } from 'socket.io-client';
import {
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';
import { issueSession } from '../../src/app/access.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';

/**
 * 2026-11-21 資安審計 C3：Socket.IO 連線數原本只受 OS 限制；每條連線都
 * 佔記憶體，而且每次廣播都要對全部連線序列化快照。
 *
 * 這裡驗證超過上限時新連線被拒（403），而**已經連上的連線不受影響**，
 * 名額空出來後新連線可以再進來。
 */
describe('Socket.IO 連線數上限', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer({ maxConnections: 2 });
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
  });

  afterEach(async () => {
    await server.close();
  });

  /** 建立一條尚未連線的連線；呼叫 connect() 之後才真的送出握手。 */
  function prepareConnection(): Socket {
    return server.connect({
      token: issueSession(server.db, { role: 'teacher' }),
      autoConnect: false,
    });
  }

  async function connectSuccessfully(socket: Socket): Promise<void> {
    const statePromise = waitForState(socket);
    socket.connect();
    const state = await statePromise;
    expect(state.role).toBe('teacher');
  }

  async function expectRejected(socket: Socket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      socket.on('connect_error', () => resolve());
      socket.on('connect', () => reject(new Error('此連線不應成功')));
      setTimeout(() => reject(new Error('等待 connect_error 逾時')), 2_000);
      socket.connect();
    });
  }

  it('超過上限時新連線被拒，已建立的連線仍可正常使用', async () => {
    const first = prepareConnection();
    const second = prepareConnection();
    await connectSuccessfully(first);
    await connectSuccessfully(second);

    // 第三條連線超過上限 → 被拒（傳輸層錯誤 → connect_error）。
    const third = prepareConnection();
    await expectRejected(third);

    // 已建立的連線不受影響：仍能下指令並收到 ack。
    const ack = (await first.emitWithAck('group:create', {
      name: '被拒後仍可操作',
    })) as { ok: boolean };
    expect(ack.ok).toBe(true);
  });

  it('名額空出來後，新連線可以再進來', async () => {
    const first = prepareConnection();
    const second = prepareConnection();
    await connectSuccessfully(first);
    await connectSuccessfully(second);

    const third = prepareConnection();
    await expectRejected(third);

    // 第一條離線 → 名額釋出。
    first.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 換一條新的連線：此時名額有一個空位，應可連上。
    const fourth = prepareConnection();
    await connectSuccessfully(fourth);
  });

  it('上限為 0 時不限制連線數', async () => {
    const unlimited = await startTestServer({ maxConnections: 0 });
    try {
      for (let index = 0; index < 4; index += 1) {
        const socket = unlimited.connect({
          token: issueSession(unlimited.db, { role: 'teacher' }),
          autoConnect: false,
        });
        await connectSuccessfully(socket);
      }
    } finally {
      await unlimited.close();
    }
  });

  it('被中止的握手不會一直占住名額', async () => {
    // 攻擊者可以送出握手後立刻斷線。若這些半途而廢的握手一直占著名額，
    // 其他人就會被擋住（審計 C3 的補充情境）。底層 socket 關閉時必須
    // 立刻釋放名額，而不是等到逾時清理。
    //
    // 這個時序在真實網路上難以穩定重現，因此行為本身由單元測試
    // （tests/unit/connectionCap.test.ts）以假的 engine 事件驗證；
    // 這裡只確認「真的把連線中斷掉之後，其他人仍然連得上」。
    const blocked = await startTestServer({ maxConnections: 1 });
    try {
      await new Promise<void>((resolve) => {
        const raw = net.connect(blocked.port, '127.0.0.1', () => {
          raw.write(
            'GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\n' +
              'Host: 127.0.0.1\r\n' +
              'Upgrade: websocket\r\n' +
              'Connection: Upgrade\r\n' +
              'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
              'Sec-WebSocket-Version: 13\r\n\r\n',
          );
          setTimeout(() => {
            raw.destroy();
            resolve();
          }, 50);
        });
        raw.on('error', () => {
          /* 連線被中斷是預期結果 */
        });
        raw.on('close', () => resolve());
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 名額已釋放 → 正常連線應可建立。
      const socket = blocked.connect({
        token: issueSession(blocked.db, { role: 'teacher' }),
        autoConnect: false,
      });
      await connectSuccessfully(socket);
    } finally {
      await blocked.close();
    }
  });
});
