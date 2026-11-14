/**
 * 匯入流程的應用服務（research R6）：
 *
 * - preview：讀取 xlsx 位元組 → SheetGrid → parseGuidedNotes →
 *   validateImport。失敗回對應錯誤且不保留 preview，資料完全不變
 *   （FR-019）；成功產生隨機 importId，記憶體只保留最近一次讀取結果
 *   （原檔位元組＋來源＋解析結果＋createdAt），15 分鐘後失效。
 * - confirm：questions:confirm 指令的用例。只在準備中允許
 *   （INVALID_PHASE）；importId 不存在、已被較新讀取取代或過期回
 *   IMPORT_EXPIRED；成功在同一個 transaction 中取代題目並把
 *   activity.revision +1（照 001 的 revision 寫法），題目 id 隨機產生。
 *
 * 時鐘與 fetch 都可注入；log 不得包含 token、檔案內容或連結查詢字串
 * （原則 IV），所以這裡只記錄事件名稱。
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ERROR_MESSAGES,
  type Ack,
  type ErrorCode,
  type ImportSummary,
  type ImportWarning,
} from '@classroom/shared';
import {
  parseGuidedNotes,
  type ParsedQuestion,
} from '../domain/guidedNotesParser.js';
import { validateImport } from '../domain/importValidator.js';
import type { SheetGrid } from '../domain/sheetGrid.js';
import {
  getActivity,
  newSessionId,
  updateActivity,
} from '../infra/db/activityRepo.js';
import type { GuidedNotesRecord, QuestionInput } from '../infra/db/questionRepo.js';
import {
  fetchSheetXlsx,
  normalizeSheetUrl,
  parseSheetLink,
  SheetFetchError,
} from '../infra/sheets/googleSheetsFetcher.js';
import { readWorkbook } from '../infra/xlsx/workbookReader.js';
import { createQuestionBank, type QuestionBank } from './questionBank.js';

/** 讀取結果的保留期限：15 分鐘（research R6）。 */
export const PREVIEW_TTL_MS = 15 * 60 * 1_000;

export type ImportSourceInput =
  | { kind: 'file'; fileName: string | null }
  | { kind: 'link'; sourceUrl: string };

type PendingImport = {
  importId: string;
  createdAtMs: number;
  source: ImportSourceInput;
  bytes: Uint8Array;
  sheetName: string;
  questions: ParsedQuestion[];
  warnings: ImportWarning[];
};

export type PreviewSuccess = { ok: true; summary: ImportSummary };
export type PreviewFailure = {
  ok: false;
  code: ErrorCode;
  message: string;
};
export type PreviewResult = PreviewSuccess | PreviewFailure;

export type ImportServiceOptions = {
  db: DatabaseSync;
  /** 可注入時鐘（15 分鐘有效期與 importedAt）。 */
  now?: (() => Date) | undefined;
  /** 連結下載用；測試注入假的 fetch，不連網路。 */
  fetchImpl?: typeof fetch | undefined;
};

export type ImportService = {
  previewFromFile: (
    fileName: string | null,
    bytes: Uint8Array,
  ) => Promise<PreviewResult>;
  previewFromLink: (url: string) => Promise<PreviewResult>;
  confirm: (importId: string) => Ack;
};

function failure(code: ErrorCode, message?: string): PreviewFailure {
  return { ok: false, code, message: message ?? ERROR_MESSAGES[code] };
}

function toSummaryQuestions(questions: ParsedQuestion[]): ImportSummary['questions'] {
  return questions.map((question) => ({
    number: question.number,
    kind: question.kind,
    prompt: question.prompt,
    blankCount: question.blanks.length,
    blanks: question.blanks.map((blank) => ({
      prefix: blank.prefix,
      cell: blank.cell,
    })),
  }));
}

export function createImportService(
  options: ImportServiceOptions,
): ImportService {
  const database = options.db;
  const now = options.now ?? (() => new Date());
  const questionBank: QuestionBank = createQuestionBank(database);
  // 只保留最近一次的讀取結果；新的讀取直接取代（記憶體用量固定）。
  let pending: PendingImport | null = null;

  async function parseBytes(
    bytes: Uint8Array,
  ): Promise<
    | { ok: true; sheetName: string; questions: ParsedQuestion[]; warnings: ImportWarning[] }
    | PreviewFailure
  > {
    let grids: SheetGrid[];
    try {
      grids = await readWorkbook(bytes);
    } catch {
      // 讀不了的檔案（不是 zip／損毀）：內容不進 log，只回錯誤代碼。
      return failure('FILE_INVALID');
    }

    const parsed = parseGuidedNotes(grids);
    if (!parsed.ok) {
      return { ok: false, code: parsed.code, message: parsed.message };
    }

    const validated = validateImport(parsed);
    if (!validated.ok) {
      return { ok: false, code: validated.code, message: validated.message };
    }
    return {
      ok: true,
      sheetName: validated.sheetName,
      questions: validated.questions,
      warnings: validated.warnings,
    };
  }

  function buildPreview(
    source: ImportSourceInput,
    bytes: Uint8Array,
    parsed: { sheetName: string; questions: ParsedQuestion[]; warnings: ImportWarning[] },
  ): PreviewSuccess {
    const importId = randomUUID();
    pending = {
      importId,
      createdAtMs: now().getTime(),
      source,
      bytes,
      sheetName: parsed.sheetName,
      questions: parsed.questions,
      warnings: parsed.warnings,
    };

    const summary: ImportSummary = {
      importId,
      sheetName: parsed.sheetName,
      questionCount: parsed.questions.length,
      blankCount: parsed.questions.reduce(
        (total, question) => total + question.blanks.length,
        0,
      ),
      questions: toSummaryQuestions(parsed.questions),
      warnings: parsed.warnings,
      replacesExisting: questionBank.hasQuestions(),
    };
    return { ok: true, summary };
  }

  return {
    async previewFromFile(fileName, bytes) {
      // 失敗的讀取不是可確認的 preview；同時清掉較早的待定結果。
      pending = null;
      const parsed = await parseBytes(bytes);
      if (!parsed.ok) {
        return parsed;
      }
      return buildPreview({ kind: 'file', fileName }, bytes, parsed);
    },

    async previewFromLink(url) {
      pending = null;
      const link = parseSheetLink(url);
      if (!link) {
        return failure('LINK_INVALID');
      }

      let bytes: Uint8Array;
      try {
        bytes = await fetchSheetXlsx(link.id, {
          fetchImpl: options.fetchImpl,
        });
      } catch (error) {
        if (error instanceof SheetFetchError) {
          return failure(error.code);
        }
        return failure('LINK_UNREACHABLE');
      }

      const parsed = await parseBytes(bytes);
      if (!parsed.ok) {
        return parsed;
      }
      return buildPreview(
        { kind: 'link', sourceUrl: normalizeSheetUrl(link.id) },
        bytes,
        parsed,
      );
    },

    confirm(importId) {
      const activity = getActivity(database);
      if (!activity) {
        throw new Error('Activity state is not initialized');
      }
      if (activity.phase !== 'preparing') {
        return {
          ok: false,
          error: {
            code: 'INVALID_PHASE',
            message: ERROR_MESSAGES.INVALID_PHASE,
          },
        };
      }

      const current = pending;
      const expired =
        current !== null &&
        now().getTime() - current.createdAtMs >= PREVIEW_TTL_MS;
      if (current === null || current.importId !== importId || expired) {
        // 資料不變；過期的結果順手清掉。
        if (expired) {
          pending = null;
        }
        return {
          ok: false,
          error: {
            code: 'IMPORT_EXPIRED',
            message: ERROR_MESSAGES.IMPORT_EXPIRED,
          },
        };
      }

      const importedAt = now().toISOString();
      const guidedNotes: GuidedNotesRecord = {
        sourceKind: current.source.kind,
        sourceUrl:
          current.source.kind === 'link' ? current.source.sourceUrl : null,
        fileName:
          current.source.kind === 'file' ? current.source.fileName : null,
        file: current.bytes,
        sheetName: current.sheetName,
        importedAt,
      };
      const questions: QuestionInput[] = current.questions.map((question) => ({
        id: randomUUID(),
        number: question.number,
        kind: question.kind,
        prompt: question.prompt,
        position: question.position,
        blanks: question.blanks.map((blank) => ({
          position: blank.position,
          prefix: blank.prefix,
          cell: blank.cell,
        })),
      }));

      // 取代題目與 revision +1 在同一個 transaction（001 的寫法）。
      database.exec('BEGIN');
      try {
        questionBank.replace(guidedNotes, questions);
        // 003 US6 / R8：成功取代題目代表舊活動草稿失效，與題目寫入同一
        // transaction 換新 sessionId；失敗時連同 revision 一起 ROLLBACK。
        newSessionId(database);
        updateActivity(database, {
          ...activity,
          revision: activity.revision + 1,
        });
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }

      return { ok: true };
    },
  };
}
