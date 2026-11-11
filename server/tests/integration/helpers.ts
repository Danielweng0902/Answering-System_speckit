import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

export type TestClientOptions = {
  token?: string;
  autoConnect?: boolean;
};

export type TestServer = ServerControl & {
  dataDir: string;
  connect: (options?: TestClientOptions) => Socket;
};

export async function startTestServer(
  options: Omit<CreateServerOptions, 'dataDir' | 'port'> = {},
): Promise<TestServer> {
  const dataDir = await mkdtemp(join(tmpdir(), 'classroom-server-'));
  let server: ServerControl;

  try {
    server = await createServer({
      ...options,
      dataDir,
      port: 0,
      teacherPassword: options.teacherPassword ?? 'test-password',
    });
  } catch (error) {
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }

  const clients = new Set<Socket>();

  async function close(): Promise<void> {
    for (const client of clients) {
      client.removeAllListeners();
      client.disconnect();
    }
    clients.clear();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
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
