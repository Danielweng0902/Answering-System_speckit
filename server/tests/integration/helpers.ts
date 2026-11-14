import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { io as createSocketIOClient, type Socket } from 'socket.io-client';
import {
  SESSION_INVALID_EVENT,
  STATE_EVENT,
  type Ack,
  type CommandEvent,
  type SessionInvalidPayload,
  type Snapshot,
} from '@classroom/shared';
import {
  createServer,
  type CreateServerOptions,
  type ServerControl,
} from '../../src/index.js';
import { replaceAll } from '../../src/infra/db/questionRepo.js';

/**
 * 002（T020）：直接以 questionRepo 寫入一題（一個空格、guided_notes 一筆，
 * 原檔為空 Uint8Array），讓 001 的整合測試在 activity:open 前備好題目
 * （FR-020：沒有題目不能開啟搶答）。
 */
export function seedQuestion(database: DatabaseSync): void {
  replaceAll(
    database,
    {
      sourceKind: 'file',
      sourceUrl: null,
      fileName: 'seed.xlsx',
      file: new Uint8Array(),
      sheetName: '學習單',
      importedAt: new Date().toISOString(),
    },
    [
      {
        id: randomUUID(),
        number: 1,
        kind: 'single',
        prompt: '種子題目',
        position: 1,
        blanks: [{ position: 1, prefix: '', cell: 'G5' }],
      },
    ],
  );
}

export type TestClientOptions = {
  token?: string;
  autoConnect?: boolean;
};

export type TestServerOptions = Omit<
  CreateServerOptions,
  'dataDir' | 'port'
> & {
  /** Reuse an existing directory, for example when testing a restart. */
  dataDir?: string;
};

export type CloseTestServerOptions = {
  /** Keep the SQLite file so a later startTestServer can reuse this directory. */
  preserveDataDir?: boolean;
};

export type TestServer = Omit<ServerControl, 'close'> & {
  dataDir: string;
  close: (options?: CloseTestServerOptions) => Promise<void>;
  connect: (options?: TestClientOptions) => Socket;
};

export async function startTestServer(
  options: TestServerOptions = {},
): Promise<TestServer> {
  const { dataDir: existingDataDir, ...serverOptions } = options;
  const dataDir =
    existingDataDir ?? (await mkdtemp(join(tmpdir(), 'classroom-server-')));
  let server: ServerControl;

  try {
    server = await createServer({
      ...serverOptions,
      dataDir,
      port: 0,
      teacherPassword: serverOptions.teacherPassword ?? 'test-password',
    });
  } catch (error) {
    // Never remove a caller-owned directory when startup itself fails.
    if (existingDataDir === undefined) {
      await rm(dataDir, { recursive: true, force: true });
    }
    throw error;
  }

  const clients = new Set<Socket>();

  async function close(
    closeOptions: CloseTestServerOptions = {},
  ): Promise<void> {
    for (const client of clients) {
      client.removeAllListeners();
      client.disconnect();
    }
    clients.clear();
    await server.close();
    if (!closeOptions.preserveDataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  }

  return {
    ...server,
    close,
    dataDir,
    connect(clientOptions: TestClientOptions = {}): Socket {
      const client = createSocketIOClient(server.url, {
        auth:
          clientOptions.token === undefined
            ? {}
            : { token: clientOptions.token },
        autoConnect: clientOptions.autoConnect ?? true,
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
      });
      clients.add(client);
      client.on('disconnect', () => {
        clients.delete(client);
      });
      return client;
    },
  };
}

/** Wait for the next state snapshot received by this connection. */
export function waitForState(
  socket: Socket,
  timeoutMilliseconds = 2_000,
): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(STATE_EVENT, onState);
      reject(new Error('Timed out waiting for a state snapshot'));
    }, timeoutMilliseconds);

    function onState(snapshot: Snapshot): void {
      clearTimeout(timeout);
      resolve(snapshot);
    }

    socket.once(STATE_EVENT, onState);
  });
}

/** Emit a contract command and resolve with its acknowledgement. */
export function sendCommand(
  socket: Socket,
  event: CommandEvent,
  payload: unknown,
  timeoutMilliseconds = 2_000,
): Promise<Ack> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for the ${event} ack`));
    }, timeoutMilliseconds);

    socket.emit(event, payload, (ack: Ack) => {
      clearTimeout(timeout);
      resolve(ack);
    });
  });
}

/** Wait for the next session:invalid event received by this connection. */
export function waitForSessionInvalid(
  socket: Socket,
  timeoutMilliseconds = 2_000,
): Promise<SessionInvalidPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(SESSION_INVALID_EVENT, onInvalid);
      reject(new Error('Timed out waiting for a session:invalid event'));
    }, timeoutMilliseconds);

    function onInvalid(payload: SessionInvalidPayload): void {
      clearTimeout(timeout);
      resolve(payload);
    }

    socket.once(SESSION_INVALID_EVENT, onInvalid);
  });
}
