import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { ERROR_MESSAGES, type ErrorCode } from '@classroom/shared';
import {
  createImportService,
  type ImportService,
} from '../../app/importService.js';
import {
  exportGuidedNotes,
  exportResultCsv,
} from '../../app/exportCommands.js';
import { createAuthRouter } from './authRoutes.js';
import { createQuestionRouter } from './questionRoutes.js';
import { createExportRouter } from './exportRoutes.js';

export type HttpAppOptions = {
  /** Database used by the authentication routes. */
  database: DatabaseSync;
  /** Build artifact directory served for non-API GET requests. */
  webDistPath?: string | undefined;
  /** Kept on app.locals for the authentication routes. */
  teacherPassword?: string | undefined;
  /** 002 匯入服務；未注入時以資料庫建立預設實例（時鐘與 fetch 不可控）。 */
  importService?: ImportService | undefined;
  /**
   * 006：寫回線上 Google 試算表的用處；未注入時該功能回
   * SHEET_NOT_CONFIGURED（伺服器沒有服務帳號設定）。
   */
  writeBackGuidedNotes?:
    | ((
        database: DatabaseSync,
      ) => Promise<
        | { ok: true; writtenCells: number; remapped: boolean }
        | { ok: false; code: ErrorCode; message: string }
      >)
    | undefined;
};

const DEFAULT_WEB_DIST = fileURLToPath(
  new URL('../../../../web/dist/', import.meta.url),
);

function errorBody(code: ErrorCode): {
  error: { code: ErrorCode; message: string };
} {
  return { error: { code, message: ERROR_MESSAGES[code] } };
}

function isJsonParseError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    'status' in error &&
    error.status === 400 &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  );
}

function isApiRequest(request: Request): boolean {
  return request.path === '/api' || request.path.startsWith('/api/');
}

export function createApp(options: HttpAppOptions): Express {
  const app = express();
  // 不論 NODE_ENV，Express 預設錯誤處理都不得回傳堆疊與本機路徑。
  app.set('env', 'production');
  const webDistPath = options.webDistPath ?? DEFAULT_WEB_DIST;
  const indexPath = join(webDistPath, 'index.html');

  app.locals.teacherPassword = options.teacherPassword;
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/health', (_request: Request, response: Response) => {
    response.status(200).json({ ok: true });
  });

  app.use(
    createAuthRouter({
      database: options.database,
      getTeacherPassword: () =>
        app.locals.teacherPassword as string | undefined,
    }),
  );

  // 002 匯入路由：只讀取不寫入；raw body 中介層只掛在上傳路徑，
  // 不影響其他 API 的 express.json。
  const importService =
    options.importService ?? createImportService({ db: options.database });
  app.use(createQuestionRouter({ database: options.database, importService }));

  // 004 匯出入口：只在 activity closed 且匯入過學習單後提供。
  app.use(
    createExportRouter({
      database: options.database,
      exportGuidedNotes: (database) => exportGuidedNotes(database, new Date()),
      exportResultCsv: (database) => exportResultCsv(database, new Date()),
      // 006：未設定服務帳號時不注入，路由會回 SHEET_NOT_CONFIGURED。
      writeBackGuidedNotes: options.writeBackGuidedNotes,
    }),
  );

  // A missing development build must not prevent server startup.
  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
  }

  // Client-side routes such as /teacher and /student load index.html. This
  // fallback deliberately excludes API paths.
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      request.method !== 'GET' ||
      isApiRequest(request) ||
      !existsSync(indexPath)
    ) {
      next();
      return;
    }

    response.sendFile(indexPath, (error: unknown) => {
      if (error) {
        next(error);
      }
    });
  });

  app.use(
    (error: unknown, _request: Request, response: Response) => {
      if (isJsonParseError(error)) {
        response.status(400).json(errorBody('INVALID_INPUT'));
        return;
      }

      // 未預期的例外：回應維持 Express 預設的 500 文字，**不在 log 寫入
      // 例外訊息或堆疊**（可能含資料庫路徑、SQL、內部路徑；原則 IV）。
      // 只記錄固定事件字串，與 broadcaster／commandRouter 的做法一致。
      console.error('HTTP request failed unexpectedly.');
      response.status(500).type('text/plain').send('Internal Server Error');
    },
  );

  return app;
}
