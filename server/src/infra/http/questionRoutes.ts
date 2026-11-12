/**
 * Guided Notes 匯入的 HTTP 路由（T023；contracts/http-api.md）。
 *
 * 兩個端點都只讀取不寫入：Authorization: Bearer <token> 以 001 的
 * resolveIdentity 解析身分（沒有或無效 → 401 UNAUTHORIZED；不是老師 →
 * 403 FORBIDDEN），不在準備中 → 409 INVALID_PHASE。成功的摘要與之後的
 * 內容錯誤（422）交給 importService 回傳，這裡只對應 HTTP 狀態碼。
 *
 * log 不記錄 token、檔案內容、連結查詢字串（原則 IV）。
 */
import type { DatabaseSync } from 'node:sqlite';
import express, {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  ERROR_MESSAGES,
  importLinkRequestSchema,
  type ErrorCode,
} from '@classroom/shared';
import { resolveIdentity } from '../../app/access.js';
import type { ImportService } from '../../app/importService.js';
import { getActivity } from '../db/activityRepo.js';
import {
  assertWorkbookSize,
  WorkbookReadError,
} from '../xlsx/workbookReader.js';

export type QuestionRoutesDependencies = {
  database: DatabaseSync;
  importService: ImportService;
};

/** 各錯誤代碼對應的 HTTP 狀態（contracts/http-api.md）。 */
const ERROR_STATUS: Partial<Record<ErrorCode, number>> = {
  INVALID_INPUT: 400,
  FILE_INVALID: 400,
  LINK_INVALID: 400,
  FILE_TOO_LARGE: 413,
  HEADER_NOT_FOUND: 422,
  NO_QUESTIONS: 422,
  DUPLICATE_QUESTION_NUMBER: 422,
  LINK_NOT_SHARED: 422,
  LINK_UNREACHABLE: 502,
};

function errorBody(code: ErrorCode, message?: string) {
  return { error: { code, message: message ?? ERROR_MESSAGES[code] } };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** express.raw 的 entity.too.large 錯誤要轉成 contracts 的 JSON。 */
function isEntityTooLarge(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  return error.status === 413 || error.type === 'entity.too.large';
}

function isAllowedUploadContentType(request: Request): boolean {
  const raw = request.headers['content-type'];
  const type =
    typeof raw === 'string'
      ? raw.split(';', 1)[0]?.trim().toLowerCase()
      : undefined;
  return (
    type ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    type === 'application/octet-stream'
  );
}

/** 身分（401／403）與階段（409）檢查；回傳 null 表示可以繼續。 */
function authorizeTeacher(
  request: Request,
  response: Response,
  database: DatabaseSync,
): boolean {
  const token = bearerToken(request);
  if (token === null) {
    response.status(401).json(errorBody('UNAUTHORIZED'));
    return false;
  }

  const identity = resolveIdentity(database, token);
  if (identity.role === 'guest') {
    // 帶了 token 但無效（找不到 session）。
    response.status(401).json(errorBody('UNAUTHORIZED'));
    return false;
  }
  if (identity.role !== 'teacher') {
    response.status(403).json(errorBody('FORBIDDEN'));
    return false;
  }

  const activity = getActivity(database);
  if (activity?.phase !== 'preparing') {
    response.status(409).json(errorBody('INVALID_PHASE'));
    return false;
  }
  return true;
}

/** URL 解碼、去掉兩種路徑分隔符之前的路徑段，並以 Unicode 字元數截到 255。 */
function readFileName(request: Request): string | null {
  const raw = request.headers['x-file-name'];
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // 解碼失敗仍不得改回整段含查詢字串的路徑；下面先取 basename。
  }
  const basename = decoded.split(/[\\/]/).at(-1) ?? '';
  return Array.from(basename).slice(0, 255).join('');
}

export function createQuestionRouter(
  dependencies: QuestionRoutesDependencies,
): Router {
  const router = Router();
  const { database, importService } = dependencies;

  router.post(
    '/api/questions/import/file',
    // 先檢查身分與階段，未授權的請求不必讀入最多 5 MB 的本體（T051）。
    (request: Request, response: Response, next: NextFunction) => {
      if (authorizeTeacher(request, response, database)) {
        next();
      }
    },
    // 本體直接是 xlsx 位元組；Content-Type 與 413 的細節見 T048。
    express.raw({ type: () => true, limit: '5mb' }),
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        if (!isAllowedUploadContentType(request)) {
          response.status(400).json(errorBody('FILE_INVALID'));
          return;
        }

        const body: unknown = request.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          response.status(400).json(errorBody('FILE_INVALID'));
          return;
        }

        // importService 的共用讀檔邊界也會檢查；這裡先做同樣的中央目錄
        // 前置檢查，讓此層能保留 FILE_TOO_LARGE 的 413（而非一般 400）。
        // 不展開任何項目，也不把檔案內容或例外交給 log。
        await assertWorkbookSize(new Uint8Array(body));

        const result = await importService.previewFromFile(
          readFileName(request),
          new Uint8Array(body),
        );
        if (!result.ok) {
          response
            .status(ERROR_STATUS[result.code] ?? 500)
            .json(errorBody(result.code, result.message));
          return;
        }
        response.status(200).json(result.summary);
      } catch (error) {
        if (error instanceof WorkbookReadError) {
          response
            .status(ERROR_STATUS[error.code] ?? 500)
            .json(errorBody(error.code, error.message));
          return;
        }
        next(error);
      }
    },
  );

  router.post(
    '/api/questions/import/link',
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        if (!authorizeTeacher(request, response, database)) {
          return;
        }

        const parsed = importLinkRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          response.status(400).json(errorBody('INVALID_INPUT'));
          return;
        }

        const result = await importService.previewFromLink(parsed.data.url);
        if (!result.ok) {
          response
            .status(ERROR_STATUS[result.code] ?? 500)
            .json(errorBody(result.code, result.message));
          return;
        }
        response.status(200).json(result.summary);
      } catch (error) {
        next(error);
      }
    },
  );

  // 必須掛在同一路由下，否則 body-parser 會落入 Express 預設 HTML 413。
  router.use(
    '/api/questions/import/file',
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (response.headersSent) {
        next(error);
        return;
      }
      if (isEntityTooLarge(error)) {
        response.status(413).json(errorBody('FILE_TOO_LARGE'));
        return;
      }
      next(error);
    },
  );

  return router;
}
