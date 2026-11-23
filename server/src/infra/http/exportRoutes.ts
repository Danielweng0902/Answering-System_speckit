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
import { readTeacherToken } from './teacherSession.js';

export type ExportRoutesDependencies = {
  database: DatabaseSync;
  /** US1 完成前不存在；完成後由 app.ts 注入。 */
  exportGuidedNotes?: (database: DatabaseSync) => Promise<ExportFile>;
  /** US3 完成前不存在；完成後由 app.ts 注入。 */
  exportResultCsv?: (database: DatabaseSync) => Promise<ExportFile>;
  /** 006：把答案寫回老師的線上 Google 試算表；未設定服務帳號時為 undefined。 */
  writeBackGuidedNotes?:
    | ((
        database: DatabaseSync,
      ) => Promise<
        | { ok: true; writtenCells: number; remapped: boolean }
        | { ok: false; code: ErrorCode; message: string }
      >)
    | undefined;
};

const ERROR_STATUS: Partial<Record<ErrorCode, number>> = {
  TEACHER_AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  INVALID_PHASE: 409,
  NO_GUIDED_NOTES: 422,
  GUIDED_NOTES_NOT_LINK: 422,
  SHEET_NOT_CONFIGURED: 503,
  SHEET_NOT_FOUND: 422,
  SHEET_TAB_NOT_FOUND: 422,
  SHEET_NOT_EDITABLE: 422,
  SHEET_NOT_NATIVE: 422,
  SHEET_API_DISABLED: 503,
  SHEET_AUTH_FAILED: 503,
  SHEET_MODIFIED: 409,
  SHEET_CHECK_FAILED: 409,
  SHEET_UNAVAILABLE: 502,
};

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
        readTeacherToken(request),
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
        readTeacherToken(request),
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

  router.post(
    '/api/export/guided-notes/writeback',
    async (request: Request, response: Response, next: NextFunction) => {
      const authorization = authorizeExport(
        database,
        readTeacherToken(request),
      );
      if (!authorization.ok) {
        sendExportError(response, authorization.code);
        return;
      }
      if (dependencies.writeBackGuidedNotes === undefined) {
        sendExportError(response, 'SHEET_NOT_CONFIGURED');
        return;
      }

      try {
        // 寫回前伺服器會重新讀取線上試算表並用「現在」的座標寫入，不需要
        // 前端帶 force（2026-11-19 review：照舊座標硬寫會錯位）。
        const result = await dependencies.writeBackGuidedNotes(database);
        if (!result.ok) {
          response.status(ERROR_STATUS[result.code] ?? 500).json({
            error: { code: result.code, message: result.message },
          });
          return;
        }
        // remapped=true 表示線上版面只是位置移動，答案已自動對到新的座標。
        response.json({
          writtenCells: result.writtenCells,
          remapped: result.remapped,
        });
        // 原則IV：只記事件與寫入格數；不記答案、token 或金鑰。
        console.info(
          `export:writeback cells=${result.writtenCells} remapped=${String(result.remapped)}`,
        );
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
