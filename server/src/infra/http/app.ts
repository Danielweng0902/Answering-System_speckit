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
import { createAuthRouter } from './authRoutes.js';

export type HttpAppOptions = {
  /** Database used by the authentication routes. */
  database: DatabaseSync;
  /** Build artifact directory served for non-API GET requests. */
  webDistPath?: string | undefined;
  /** Kept on app.locals for the authentication routes. */
  teacherPassword?: string | undefined;
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
    (error: unknown, _request: Request, response: Response, next: NextFunction) => {
      if (isJsonParseError(error)) {
        response.status(400).json(errorBody('INVALID_INPUT'));
        return;
      }

      // No other web errors exist in this phase; let Express use its default
      // handler rather than inventing an error code outside the contracts.
      next(error);
    },
  );

  return app;
}
