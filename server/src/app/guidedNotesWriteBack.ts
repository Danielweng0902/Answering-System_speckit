/**
 * 寫回線上 Google 試算表（006 US1）。
 *
 * 老師的學習單若是「以連結匯入」，活動結束後把搶答成功組別的答案直接寫回
 * 那份線上試算表（助教 2026-11-17 說明：系統要直接串接線上 Google Sheets
 * 讀寫，不是下載 xlsx 離線處理）。
 *
 * 寫回前一定會**重新讀取並解析線上試算表**，確認版面與匯入時完全一致：
 * - 一致 → 用匯入時的座標寫入（此時線上座標與儲存座標相同，安全）。
 * - **不一致**（列欄被挪動、題目被改動）→ 對應不起來，**不寫回**，請老師
 *   改用「匯出 Guided Notes」下載含答案的 xlsx。
 * - **讀不到／解析不出來** → 無法確認要寫到哪裡，**不寫回**，請老師先重試，
 *   仍無法比對就下載 xlsx。
 *
 * 為什麼不放寬：讀不到線上試算表不代表服務帳號不能寫，硬寫會覆蓋別的格或
 * 公式（2026-11-19 實測：插一列後照舊座標寫會整體錯位一行）。
 * 「自動對到線上現在的新格子」是後續工作（下一個 PR），這次不做。
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

type SheetCheck = 'unchanged' | 'changed' | 'failed';

/**
 * 比對線上試算表與匯入當時保存的版面。
 *
 * - `unchanged`：讀得到且結構（含儲存格座標）完全相同 → 可以寫。
 * - `changed`：讀得到但結構不同（列欄被挪動或題目被改）→ 不寫回。
 * - `failed`：讀不到或解析不出來 → 不寫回，請老師重試或下載 xlsx。
 */
async function compareSheetWithImport(
  database: DatabaseSync,
  spreadsheetId: string,
  fetchImpl: typeof fetch | undefined,
): Promise<SheetCheck> {
  try {
    const bytes = await fetchSheetXlsx(spreadsheetId, { fetchImpl });
    const grids = await readWorkbook(bytes);
    const parsed = parseGuidedNotes(grids);
    if (!parsed.ok) {
      // 解析不出題目＝無法確認版面 → 視為比對失敗。
      return 'failed';
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
    return structureSignature(stored) === structureSignature(live)
      ? 'unchanged'
      : 'changed';
  } catch {
    return 'failed';
  }
}

/**
 * 把答案寫回老師的線上試算表。
 *
 * - 匯入來源不是連結（上傳的 xlsx）→ 沒有雲端目標，回 GUIDED_NOTES_NOT_LINK。
 * - 伺服器沒有設定服務帳號 → 回 SHEET_NOT_CONFIGURED。
 * - 線上版面與匯入時不同 → 回 SHEET_MODIFIED，請老師下載含答案的 xlsx。
 * - 讀不到或解析不出線上試算表 → 回 SHEET_CHECK_FAILED，請老師重試或下載 xlsx。
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

  const check = await compareSheetWithImport(
    database,
    spreadsheetId,
    options.fetchImpl,
  );
  if (check === 'changed') {
    // 版面已變：對應不起來，不寫回（2026-11-19 review：硬寫會整體錯位）。
    return failure('SHEET_MODIFIED');
  }
  if (check === 'failed') {
    // 比對失敗不是「沒變」，而是「無法確認」→ 不寫回，請老師重試或下載。
    return failure('SHEET_CHECK_FAILED');
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
