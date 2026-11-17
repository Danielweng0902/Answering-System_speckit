import type { DatabaseSync } from 'node:sqlite';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { ERROR_MESSAGES, type ErrorCode } from '@classroom/shared';
import {
  authorizeExport,
  type ExportFile,
} from '../../app/exportCommands.js';

export type ExportRoutesDependencies = {
  database: DatabaseSync;
  /** US1 完成前不存在；完成後由 app.ts 注入。 */
  exportGuidedNotes?: (database: DatabaseSync) => Promise<ExportFile>;
  /** US3 完成前不存在；完成後由 app.ts 注入。 */
  exportResultCsv?: (database: DatabaseSync) => Promise<ExportFile>;
};

const ERROR_STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_PHASE: 409,
  NO_GUIDED_NOTES: 422,
};

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

function sendExportError(
  response: Response,
  code: ErrorCode,
): void {
  response.status(ERROR_STATUS[code] ?? 500).json({
    error: {
      code,
      message: ERROR_MESSAGES[code],
    },
  });
}

/** RFC 5987 的 UTF-8 檔名；ASCII fallback 僅供不支援 filename* 的客戶端。 */
function contentDisposition(fileName: string): string {
  const asciiFallback = fileName.endsWith('.csv')
    ? 'results.csv'
    : 'guided-notes.xlsx';
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function sendExportFile(
  eventName: 'guided-notes' | 'results.csv',
  response: Response,
  file: ExportFile,
): void {
  response.setHeader('Content-Type', file.contentType);
  response.setHeader('Content-Disposition', contentDisposition(file.fileName));
  response.send(Buffer.from(file.bytes));
  // 原則IV：只記錄事件與檔案大小；不記錄 token、答案或檔案內容。
  console.info(`export:${eventName} size=${file.bytes.byteLength}`);
}

export function createExportRouter(
  dependencies: ExportRoutesDependencies,
): Router {
  const router = Router();
  const { database } = dependencies;

  router.get(
    '/api/export/guided-notes',
    async (request: Request, response: Response, next: NextFunction) => {
      const authorization = authorizeExport(
        database,
        bearerToken(request),
      );
      if (!authorization.ok) {
        sendExportError(response, authorization.code);
        return;
      }
      if (dependencies.exportGuidedNotes === undefined) {
        next(new Error('Guided Notes exporter is not initialized'));
        return;
      }

      try {
        const file = await dependencies.exportGuidedNotes(database);
        sendExportFile('guided-notes', response, file);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/api/export/results.csv',
    async (request: Request, response: Response, next: NextFunction) => {
      const authorization = authorizeExport(
        database,
        bearerToken(request),
      );
      if (!authorization.ok) {
        sendExportError(response, authorization.code);
        return;
      }
      if (dependencies.exportResultCsv === undefined) {
        next(new Error('Result CSV exporter is not initialized'));
        return;
      }

      try {
        const file = await dependencies.exportResultCsv(database);
        sendExportFile('results.csv', response, file);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
