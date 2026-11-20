import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { config as loadDotenv } from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';
import type {
  AnswerVoidPayload,
  QuestionsConfirmPayload,
} from '@classroom/shared';
import { loadConfig } from './config.js';
import { repositoryRoot, resolveFromRepositoryRoot } from './paths.js';
import { createActivityCommands } from './app/activityCommands.js';
import { createAnswerCommands } from './app/answerCommands.js';
import { createFairnessSettler } from './app/fairnessSettler.js';
import { createProjectorCommands } from './app/projectorCommands.js';
import { writeBackGuidedNotes } from './app/guidedNotesWriteBack.js';
import { createGoogleSheetWriter, type SheetWriter } from './infra/sheets/sheetWriter.js';
import { createServiceAccountTokenProvider } from './infra/sheets/serviceAccountToken.js';
import { FAIR_BATCH_WINDOW_MS } from './domain/answerSettlement.js';
import { createCountdown, type CountdownScheduler } from './app/countdown.js';
import { createGroupCommands } from './app/groupCommands.js';
import { createImportService } from './app/importService.js';
import { leaveGroup } from './app/studentCommands.js';
import { getActivity } from './infra/db/activityRepo.js';
import { countValidForQuestion } from './infra/db/answerRepo.js';
import { list as listQuestions } from './infra/db/questionRepo.js';
import { openDatabase } from './infra/db/database.js';
import { createApp } from './infra/http/app.js';
import { createSocketBroadcaster, type StateBroadcaster } from './infra/socket/broadcaster.js';
import { createCommandRouter } from './infra/socket/commandRouter.js';

export type CreateServerOptions = {
  dataDir?: string;
  databasePath?: string;
  /** Use 0 to ask the OS for an available ephemeral port. */
  port?: number;
  /**
   * 綁定的 host；不給就維持 Node 預設（所有介面，課堂的 LAN 存取需要）。
   * 2026-11-21 資安審計：預設對整個 LAN 開放，需要時可設成 127.0.0.1。
   */
  host?: string;
  teacherPassword?: string;
  webDistPath?: string;
  /** 倒數計時的時鐘與排程器（T064）；測試可注入手動時鐘。 */
  scheduler?: CountdownScheduler;
  /** 002 連結匯入的 fetch；測試注入假的 fetch，不連網路。 */
  fetchImpl?: typeof fetch;
  /** 002 匯入服務的時鐘（15 分鐘有效期）；預設真實時鐘。 */
  now?: () => Date;
  /**
   * 006：線上寫回 Google 試算表的寫入器；測試注入假的，不連網路。
   * 未注入且沒有設定服務帳號時，該功能回 SHEET_NOT_CONFIGURED。
   */
  sheetWriter?: SheetWriter | null;
};

export type ServerControl = Pick<StateBroadcaster, 'broadcastState'> & {
  url: string;
  port: number;
  close: () => Promise<void>;
  io: SocketIOServer;
  db: DatabaseSync;
  httpServer: HttpServer;
};

function listen(
  httpServer: HttpServer,
  port: number,
  host?: string | undefined,
): Promise<void> {
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
    // 未指定 HOST 時維持 Node 預設（所有介面）；指定時只綁該介面。
    if (host === undefined) {
      httpServer.listen(port);
    } else {
      httpServer.listen(port, host);
    }
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

  // 002 匯入服務：HTTP 讀取與 Socket questions:confirm 共用同一份記憶體
  // 讀取結果，所以先建立再傳給 HTTP app 與指令註冊。
  const importService = createImportService({
    db: database,
    now: options.now,
    fetchImpl: options.fetchImpl,
  });

  // 006：線上寫回需要服務帳號；沒有設定就不注入該功能，路由回
  // SHEET_NOT_CONFIGURED，xlsx 下載與 CSV 匯出不受影響。
  const sheetWriter =
    options.sheetWriter !== undefined
      ? options.sheetWriter
      : config.googleServiceAccountEmail !== undefined &&
          config.googleServiceAccountPrivateKey !== undefined
        ? createGoogleSheetWriter({
            accessTokenProvider: createServiceAccountTokenProvider({
              credentials: {
                clientEmail: config.googleServiceAccountEmail,
                privateKey: config.googleServiceAccountPrivateKey,
              },
            }),
          })
        : null;

  const httpServer = createHttpServer(
    createApp({
      database,
      webDistPath: options.webDistPath,
      teacherPassword: options.teacherPassword ?? config.teacherPassword,
      importService,
      writeBackGuidedNotes: (target: DatabaseSync) =>
        writeBackGuidedNotes(target, sheetWriter, new Date(), {
          // 讀取線上試算表以取得「現在」的座標；測試注入假的 fetch，不連網路。
          fetchImpl: options.fetchImpl,
        }),
    }),
  );
  const io = new SocketIOServer(httpServer);
  const broadcaster = createSocketBroadcaster(io, database);

  // Group and answer commands share the existing success-broadcast router.
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
  // 005（T014）：公平順位「判定完成」提醒；只廣播，不保存判定結果。
  const fairnessSettler = createFairnessSettler({
    scheduler,
    onSettled: () => {
      try {
        broadcaster.broadcastState();
      } catch {
        console.error('Fairness settlement reminder failed.');
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
      fairnessSettler.cancelAll();
    },
  });
  const answerCommands = createAnswerCommands(database, {
    // 005（T014、FR-010）：啟用公平順位時，某題第一個答案送達後 3 秒安排
    // 一次提醒，讓老師看板從「判定中」翻成已判定；判定本身不保存結果。
    onAnswerAccepted: (questionNumber) => {
      const activity = getActivity(database);
      if (!activity?.fairRankingEnabled) {
        return;
      }
      const question = listQuestions(database).find(
        (candidate) => candidate.number === questionNumber,
      );
      if (question === undefined) {
        return;
      }
      if (countValidForQuestion(database, question.id) !== 1) {
        return;
      }
      fairnessSettler.schedule(questionNumber, FAIR_BATCH_WINDOW_MS);
    },
  });
  const teacherOnly = ['teacher'] as const;
  const studentOnly = ['student'] as const;
  const projectorCommands = createProjectorCommands(database);
  io.on('connection', (socket) => {
    commandRouter.register(socket, 'group:create', teacherOnly, groupCommands.createGroup);
    commandRouter.register(socket, 'group:rename', teacherOnly, groupCommands.renameGroup);
    commandRouter.register(socket, 'group:delete', teacherOnly, groupCommands.deleteGroup);
    commandRouter.register(socket, 'activity:open', teacherOnly, activityCommands.openActivity);
    commandRouter.register(socket, 'activity:close', teacherOnly, activityCommands.closeActivity);
    commandRouter.register(socket, 'activity:reset', teacherOnly, activityCommands.resetActivity);
    // 005（FR-001）：只有老師、只有準備中能切換公平順位；成功後所有角色
    // 都會收到帶有 fairRankingEnabled 的新快照。
    commandRouter.register(
      socket,
      'activity:fair-ranking',
      teacherOnly,
      activityCommands.setFairRanking,
    );
    // 002（T024）：questions:confirm 只有老師、只在準備中；ack.ok 由路由
    // 決定是否廣播，所有老師分頁同步收到新的題目摘要（research R6）。
    commandRouter.register(
      socket,
      'questions:confirm',
      teacherOnly,
      (_identity, payload) =>
        importService.confirm((payload as QuestionsConfirmPayload).importId),
    );
    // 003 US1/US2：學生身分與 groupId 由 stored connection identity 決定；
    // open 階段、答案格式、重複與順位由用例在同一 transaction 判定；成功後
    // 只通知所有老師與送出的該組，其他組與 guest 不收到 state（research R4）。
    commandRouter.register(
      socket,
      'answer:submit',
      studentOnly,
      answerCommands.submitAnswer,
      (identity) => {
        if (identity.role === 'student') {
          broadcaster.broadcastSubmissionChanged(identity.groupId);
        }
      },
    );
    // 003 US3：作廢由老師送 groupId；成功後使用同一個作答定向通道，
    // 只通知老師與該組，其他組與 guest 不會收到作廢相關資訊。
    commandRouter.register(
      socket,
      'answer:void',
      teacherOnly,
      answerCommands.voidAnswer,
      (_identity, payload) => {
        broadcaster.broadcastSubmissionChanged(
          (payload as AnswerVoidPayload).groupId,
        );
      },
    );
    // 005（FR-017）：只有老師、只有在已結束能揭曉；成功後廣播讓投影頁更新。
    commandRouter.register(
      socket,
      'reveal:next',
      teacherOnly,
      projectorCommands.revealNext,
    );
    commandRouter.register(
      socket,
      'reveal:all',
      teacherOnly,
      projectorCommands.revealAll,
    );
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
    // 密碼過短不擋啟動（避免破壞既有部署），但明確提出警告
    // （2026-11-21 資安審計：密碼沒有最小長度政策）。
    const effectivePassword = options.teacherPassword ?? config.teacherPassword;
    if (effectivePassword !== undefined && effectivePassword.length < 8) {
      console.warn(
        '[warn] 老師密碼短於 8 個字元；請改用更長的密碼（不要把密碼印出來）。',
      );
    }

    await listen(httpServer, options.port ?? config.port, options.host ?? config.host);
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
