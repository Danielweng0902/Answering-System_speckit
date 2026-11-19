/**
 * 寫回線上 Google 試算表（006 US1）。
 *
 * 老師的學習單若是「以連結匯入」，活動結束後把搶答成功組別的答案直接寫回
 * 那份線上試算表（助教 2026-11-17 說明：系統要直接串接線上 Google Sheets
 * 讀寫，不是下載 xlsx 離線處理）。
 *
 * 寫回前一定會**重新讀取並解析線上試算表**，用「現在」的座標寫入：
 * - 版面沒變 → 照原位寫。
 * - 老師在匯入後插了一列／挪了欄，但**題號、前綴與空格數都還對得上**
 *   → 直接用新的座標寫，答案仍然對得上題目（2026-11-19 review 的實測：
 *   在最上方插一列後照舊座標寫會整體錯位）。
 * - 題目本身改了（題號／空格數／前綴不同）→ 對應不起來，擋下來請老師改用
 *   「匯出 xlsx」。
 * - 讀不到線上試算表 → 無法確認要寫到哪裡，一律擋下（讀不到不代表服務帳號
 *   不能寫，硬寫會覆蓋別的格或公式）。
 *
 * 本模組唯讀本地資料（不動作答、不動資料庫），只在線上試算表寫入答案值。
 */
import type { DatabaseSync } from 'node:sqlite';
import { ERROR_MESSAGES, type ErrorCode } from '@classroom/shared';
import { buildResults } from './answerProjections.js';
import { buildBlankWrites } from './guidedNotesExporter.js';
import { getStoredGuidedNotes, list as listQuestions } from '../infra/db/questionRepo.js';
import { parseGuidedNotes, type ParsedQuestion } from '../domain/guidedNotesParser.js';
import {
  fetchSheetXlsx,
  parseSheetLink,
} from '../infra/sheets/googleSheetsFetcher.js';
import { readWorkbook } from '../infra/xlsx/workbookReader.js';
import { getWorksheetXml, isMergedWithRightCell } from '../infra/xlsx/xlsxEditor.js';
import {
  SheetAuthError,
  SheetWriteError,
  type SheetWriter,
} from '../infra/sheets/sheetWriter.js';

export type WriteBackResult =
  | { ok: true; writtenCells: number }
  | { ok: false; code: ErrorCode; message: string };

export type WriteBackOptions = {
  /** 讀取線上試算表用來取得「現在」的座標；測試注入假的 fetch，不連網路。 */
  fetchImpl?: typeof fetch | undefined;
};

function failure(code: ErrorCode): WriteBackResult {
  return { ok: false, code, message: ERROR_MESSAGES[code] };
}

type SheetQuestion = {
  number: number;
  blanks: { position: number; prefix: string; cell: string }[];
};

/** 兩個題目的「題意」是否一致（只看題號、空格數與前綴，不看位置）。 */
function sameQuestionShape(
  stored: { blanks: readonly { prefix: string }[] },
  live: { blanks: readonly { prefix: string }[] },
): boolean {
  return (
    stored.blanks.length === live.blanks.length &&
    stored.blanks.every(
      (blank, index) => blank.prefix === live.blanks[index]?.prefix,
    )
  );
}

/**
 * 把答案寫回老師的線上試算表。
 *
 * - 匯入來源不是連結（上傳的 xlsx）→ 沒有雲端目標，回 GUIDED_NOTES_NOT_LINK。
 * - 伺服器沒有設定服務帳號 → 回 SHEET_NOT_CONFIGURED。
 * - 讀不到或解析不出線上試算表 → 回 SHEET_CHECK_FAILED（無法確認要寫到哪裡）。
 * - 線上題目已改動、對應不起來 → 回 SHEET_MODIFIED。
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

  // 讀線上試算表：拿「現在」的版面與座標。
  let liveBytes: Uint8Array;
  let liveQuestions: ParsedQuestion[];
  let liveSheetName: string;
  try {
    liveBytes = await fetchSheetXlsx(spreadsheetId, { fetchImpl: options.fetchImpl });
    const grids = await readWorkbook(liveBytes);
    const parsed = parseGuidedNotes(grids);
    if (!parsed.ok) {
      return failure('SHEET_CHECK_FAILED');
    }
    liveQuestions = parsed.questions;
    liveSheetName = parsed.sheetName;
  } catch {
    // 讀不到 → 無法確定答案要寫到哪一格，不能照舊座標硬寫。
    return failure('SHEET_CHECK_FAILED');
  }

  const liveByNumber = new Map(
    liveQuestions.map((question) => [question.number, question]),
  );
  const storedQuestions = listQuestions(database);
  const results = new Map(
    buildResults(database, now).map((result) => [result.questionNumber, result]),
  );

  let liveXml: string;
  try {
    liveXml = await getWorksheetXml(liveBytes, liveSheetName);
  } catch {
    return failure('SHEET_CHECK_FAILED');
  }

  const updates: { cell: string; value: string }[] = [];
  for (const question of storedQuestions) {
    const answers = results.get(question.number)?.winner?.answers;
    if (answers === undefined) {
      // 這題沒有人作答 → 不寫入（寫回不清空上一場的答案，見 contracts）。
      continue;
    }
    const live = liveByNumber.get(question.number);
    if (live === undefined || !sameQuestionShape(question, live)) {
      // 題目被改過（題號／空格數／前綴不同）→ 對應不起來，不硬寫。
      return failure('SHEET_MODIFIED');
    }
    const blanks = live.blanks.map((blank) => ({
      position: blank.position,
      prefix: blank.prefix,
      cell: blank.cell,
      hasSeparateRightAnswerCell:
        blank.prefix !== '' && !isMergedWithRightCell(liveXml, blank.cell),
    }));
    const writes = buildBlankWrites(answers, blanks);
    for (const write of writes ?? []) {
      updates.push({ cell: write.cell, value: write.content });
    }
  }

  if (updates.length === 0) {
    return { ok: true, writtenCells: 0 };
  }

  try {
    await writer.writeCells({
      spreadsheetId,
      sheetName: liveSheetName,
      updates,
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

  return { ok: true, writtenCells: updates.length };
}

export type { SheetQuestion };
