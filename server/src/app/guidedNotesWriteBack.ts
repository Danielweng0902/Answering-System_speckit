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
import { getStoredGuidedNotes } from '../infra/db/questionRepo.js';
import { parseSheetLink } from '../infra/sheets/googleSheetsFetcher.js';
import {
  SheetWriteError,
  type SheetWriter,
} from '../infra/sheets/sheetWriter.js';

export type WriteBackResult =
  | { ok: true; writtenCells: number }
  | { ok: false; code: ErrorCode; message: string };

function failure(code: ErrorCode): WriteBackResult {
  return { ok: false, code, message: ERROR_MESSAGES[code] };
}

/**
 * 把答案寫回老師的線上試算表。
 *
 * - 匯入來源不是連結（上傳的 xlsx）→ 沒有雲端目標，回 GUIDED_NOTES_NOT_LINK。
 * - 伺服器沒有設定服務帳號 → 回 SHEET_NOT_CONFIGURED。
 * - 沒有任何搶答成功答案 → 不寫入任何儲存格，回成功與 0。
 */
export async function writeBackGuidedNotes(
  database: DatabaseSync,
  writer: SheetWriter | null,
  now: Date = new Date(),
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
    return failure('SHEET_UNAVAILABLE');
  }

  return { ok: true, writtenCells: targets.writes.length };
}
