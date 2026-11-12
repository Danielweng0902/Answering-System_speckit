import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { config as loadDotenv } from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';
import { loadConfig } from './config.js';
import { repositoryRoot, resolveFromRepositoryRoot } from './paths.js';
import { createActivityCommands } from './app/activityCommands.js';
import { createCountdown, type CountdownScheduler } from './app/countdown.js';
import { createGroupCommands } from './app/groupCommands.js';
import { leaveGroup } from './app/studentCommands.js';
import { getActivity } from './infra/db/activityRepo.js';
import { openDatabase } from './infra/db/database.js';
import { createApp } from './infra/http/app.js';
import { createSocketBroadcaster, type StateBroadcaster } from './infra/socket/broadcaster.js';
import { createCommandRouter } from './infra/socket/commandRouter.js';

export type CreateServerOptions = {
  dataDir?: string;
  databasePath?: string;
  /** Use 0 to ask the OS for an available ephemeral port. */
  port?: number;
  teacherPassword?: string;
  webDistPath?: string;
  /** 倒數計時的時鐘與排程器（T064）；測試可注入手動時鐘。 */
  scheduler?: CountdownScheduler;
};

export type ServerControl = Pick<StateBroadcaster, 'broadcastState'> & {
  url: string;
  port: number;
  close: () => Promise<void>;
  io: SocketIOServer;
  db: DatabaseSync;
  httpServer: HttpServer;
};

function listen(httpServer: HttpServer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      httpServer.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      httpServer.off('error', onError);
      resolve();
    };

    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(port);
  });
}

function closeResources(io: SocketIOServer, database: DatabaseSync): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // Socket.IO closes both its transports and the attached HTTP server.
      io.close(() => {
        try {
          database.close();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      try {
        database.close();
      } catch {
        // Preserve the resource-closing error.
      }
      reject(error);
    }
  });
}

export async function createServer(options: CreateServerOptions = {}): Promise<ServerControl> {
  const config = loadConfig();
  const databasePath =
    options.databasePath ??
    join(resolveFromRepositoryRoot(options.dataDir ?? config.dataDir), 'app.db');

  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const database = openDatabase(databasePath);

  const httpServer = createHttpServer(
    createApp({
      database,
      webDistPath: options.webDistPath,
      teacherPassword: options.teacherPassword ?? config.teacherPassword,
    }),
  );
  const io = new SocketIOServer(httpServer);
  const broadcaster = createSocketBroadcaster(io, database);

  // Group commands are teacher-only; the router broadcasts only on success.
  const commandRouter = createCommandRouter(broadcaster.broadcastState);
  const groupCommands = createGroupCommands(database, {
    onGroupDeleted: (groupId) => {
      broadcaster.invalidateGroup(groupId);
    },
  });
  // 倒數計時（T064）：時間到與手動 activity:close 走同一條 close 路徑，
  // 只有真的改變狀態才廣播；已結束的活動不做事（FR-026）。
  const scheduler = options.scheduler;
  const countdown = createCountdown({
    scheduler,
    onExpire: () => {
      try {
        if (activityCommands.closeExpiredActivity()) {
          broadcaster.broadcastState();
        }
      } catch {
        // 計時器回呼不在任何請求內，例外不得讓伺服器程序崩潰。
        console.error('Countdown expiry failed.');
      }
    },
  });
  const activityCommands = createActivityCommands(database, {
    // 指令時間戳與倒數排程使用同一個時鐘，手動時鐘的測試才能對齊。
    now: scheduler
      ? () => new Date(scheduler.now()).toISOString()
      : undefined,
    onOpened: (countdownEndsAt) => {
      if (countdownEndsAt === null) {
        countdown.cancel();
      } else {
        countdown.schedule(countdownEndsAt);
      }
    },
    onClosed: () => {
      countdown.cancel();
    },
    // 重設時取消倒數；後續子功能可在此掛上各自的資料清理（T069）。
    onReset: () => {
      countdown.cancel();
    },
  });
  const teacherOnly = ['teacher'] as const;
  const studentOnly = ['student'] as const;
  io.on('connection', (socket) => {
    commandRouter.register(socket, 'group:create', teacherOnly, groupCommands.createGroup);
    commandRouter.register(socket, 'group:rename', teacherOnly, groupCommands.renameGroup);
    commandRouter.register(socket, 'group:delete', teacherOnly, groupCommands.deleteGroup);
    commandRouter.register(socket, 'activity:open', teacherOnly, activityCommands.openActivity);
    commandRouter.register(socket, 'activity:close', teacherOnly, activityCommands.closeActivity);
    commandRouter.register(socket, 'activity:reset', teacherOnly, activityCommands.resetActivity);
    commandRouter.register(socket, 'student:leave', studentOnly, () => {
      const token: unknown = socket.handshake.auth.token;
      return leaveGroup(
        database,
        typeof token === 'string' && token.length > 0 ? token : undefined,
        {
          demoteToGuest: () => {
            broadcaster.demoteToGuest(socket);
          },
        },
      );
    });
  });

  // 啟動還原（T059、T064、research R7）：在 listen 接受連線之前依保存的
  // 活動狀態處理倒數——open 且 countdownEndsAt 已過 → 立即 close
  // （revision +1，此時尚無連線不必廣播）；未過 → 重新排程（FR-021）。
  const persisted = getActivity(database);
  if (persisted?.phase === 'open' && persisted.countdownEndsAt !== null) {
    const endsAtMs = Date.parse(persisted.countdownEndsAt);
    const nowMs = scheduler ? scheduler.now() : Date.now();
    if (endsAtMs <= nowMs) {
      activityCommands.closeExpiredActivity();
    } else {
      countdown.schedule(persisted.countdownEndsAt);
    }
  }

  try {
    await listen(httpServer, options.port ?? config.port);
  } catch (error) {
    countdown.cancel();
    await closeResources(io, database);
    throw error;
  }

  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    countdown.cancel();
    await closeResources(io, database);
    throw new Error('HTTP server did not expose a TCP listening address');
  }

  const close = (() => {
    let closing: Promise<void> | undefined;
    return (): Promise<void> => {
      // 關閉時取消倒數，避免計時器在資料庫關閉後觸發結束流程。
      countdown.cancel();
      closing ??= closeResources(io, database);
      return closing;
    };
  })();

  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close,
    broadcastState: broadcaster.broadcastState,
    io,
    db: database,
    httpServer,
  };
}

const entryPath = process.argv[1];
const isDirectExecution =
  entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  loadDotenv({ path: join(repositoryRoot, '.env'), quiet: true });

  try {
    const server = await createServer();
    console.log(`Server listening on ${server.url}`);
    console.log(
      'Other devices on the same network: http://<this computer IP>:' + String(server.port),
    );

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        void server.close().catch(() => {
          console.error('Server shutdown failed.');
          process.exitCode = 1;
        });
      });
    }
  } catch {
    // Avoid dumping environment values or unexpected objects into logs.
    console.error('Server failed to start.');
    process.exitCode = 1;
  }
}
