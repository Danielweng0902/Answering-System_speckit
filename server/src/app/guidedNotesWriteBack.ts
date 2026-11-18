/**
 * 寫回線上 Google 試算表（006 US1）。
 *
 * 老師的學習單若是「以連結匯入」，活動結束後把搶答成功組別的答案直接寫回
 * 那份線上試算表（助教 2026-11-17 說明：系統要直接串接線上 Google Sheets
 * 讀寫，不是下載 xlsx 離線處理）。
 *
 * 本模組唯讀本地資料（不動作答、不動資料庫），只在線上試算表寫入答案值。
 */
import type { DatabaseSync } from 'node:sqlite';
import { ERROR_MESSAGES, type ErrorCode } from '@classroom/shared';
import { resolveGuidedNotesTargets } from './guidedNotesTargets.js';
import { getStoredGuidedNotes, list as listQuestions } from '../infra/db/questionRepo.js';
import { parseGuidedNotes, type ParsedQuestion } from '../domain/guidedNotesParser.js';
import {
  fetchSheetXlsx,
  parseSheetLink,
} from '../infra/sheets/googleSheetsFetcher.js';
import { readWorkbook } from '../infra/xlsx/workbookReader.js';
import {
  SheetAuthError,
  SheetWriteError,
  type SheetWriter,
} from '../infra/sheets/sheetWriter.js';

export type WriteBackResult =
  | { ok: true; writtenCells: number }
  | { ok: false; code: ErrorCode; message: string };

export type WriteBackOptions = {
  /**
   * 老師確認「試算表雖然被改過但仍要寫回」時帶 true，略過版面比對
   * （006 T023；依人工驗證建議 3）。
   */
  force?: boolean | undefined;
  /** 讀取線上試算表用來比對版面；測試注入假的 fetch，不連網路。 */
  fetchImpl?: typeof fetch | undefined;
};

function failure(code: ErrorCode): WriteBackResult {
  return { ok: false, code, message: ERROR_MESSAGES[code] };
}

/** 題目與空格的結構指紋：題號＋每個空格的格號與前綴。 */
function structureSignature(
  questions: readonly {
    number: number;
    blanks: readonly { position: number; prefix: string; cell: string }[];
  }[],
): string {
  return questions
    .map(
      (question) =>
        `${question.number}:${question.blanks
          .map(
            (blank) => `${blank.position}/${blank.prefix}/${blank.cell}`,
          )
          .join(',')}`,
    )
    .join('|');
}

/**
 * 比對線上試算表與匯入當時保存的版面是否不同。
 *
 * 讀不到（沒有連結檢視權限、網路問題）或解析失敗時**不阻擋**寫回：
 * 比對只是提醒，不是安全邊界（006 T023、依人工驗證建議 3）。
 */
async function hasSheetChangedSinceImport(
  database: DatabaseSync,
  spreadsheetId: string,
  fetchImpl: typeof fetch | undefined,
): Promise<boolean> {
  try {
    const bytes = await fetchSheetXlsx(spreadsheetId, { fetchImpl });
    const grids = await readWorkbook(bytes);
    const parsed = parseGuidedNotes(grids);
    if (!parsed.ok) {
      return false;
    }
    const stored = listQuestions(database).map((question) => ({
      number: question.number,
      blanks: question.blanks.map((blank) => ({
        position: blank.position,
        prefix: blank.prefix,
        cell: blank.cell,
      })),
    }));
    const live = (parsed.questions as ParsedQuestion[]).map((question) => ({
      number: question.number,
      blanks: question.blanks.map((blank) => ({
        position: blank.position,
        prefix: blank.prefix,
        cell: blank.cell,
      })),
    }));
    return structureSignature(stored) !== structureSignature(live);
  } catch {
    return false;
  }
}

/**
 * 把答案寫回老師的線上試算表。
 *
 * - 匯入來源不是連結（上傳的 xlsx）→ 沒有雲端目標，回 GUIDED_NOTES_NOT_LINK。
 * - 伺服器沒有設定服務帳號 → 回 SHEET_NOT_CONFIGURED。
 * - 線上試算表在匯入後被改過 → 回 SHEET_MODIFIED，請老師確認後再按一次。
 * - 沒有任何搶答成功答案 → 不寫入任何儲存格，回成功與 0。
 */
export async function writeBackGuidedNotes(
  database: DatabaseSync,
  writer: SheetWriter | null,
  now: Date = new Date(),
  options: WriteBackOptions = {},
): Promise<WriteBackResult> {
  const stored = getStoredGuidedNotes(database);
  if (stored === null) {
    return failure('NO_GUIDED_NOTES');
  }
  if (stored.sourceKind !== 'link' || stored.sourceUrl === null) {
    return failure('GUIDED_NOTES_NOT_LINK');
  }
  if (writer === null) {
    return failure('SHEET_NOT_CONFIGURED');
  }

  const spreadsheetId = parseSheetLink(stored.sourceUrl)?.id;
  if (spreadsheetId === undefined) {
    return failure('SHEET_NOT_FOUND');
  }

  const targets = await resolveGuidedNotesTargets(database, now);
  if (targets === null) {
    return failure('NO_GUIDED_NOTES');
  }
  if (targets.writes.length === 0) {
    return { ok: true, writtenCells: 0 };
  }

  if (options.force !== true) {
    const changed = await hasSheetChangedSinceImport(
      database,
      spreadsheetId,
      options.fetchImpl,
    );
    if (changed) {
      return failure('SHEET_MODIFIED');
    }
  }

  try {
    await writer.writeCells({
      spreadsheetId,
      sheetName: targets.sheetName,
      updates: targets.writes.map((write) => ({
        cell: write.cell,
        value: write.content,
      })),
    });
  } catch (error) {
    if (error instanceof SheetWriteError) {
      return failure(error.code);
    }
    if (error instanceof SheetAuthError) {
      return failure('SHEET_AUTH_FAILED');
    }
    return failure('SHEET_UNAVAILABLE');
  }

  return { ok: true, writtenCells: targets.writes.length };
}
