/**
 * 寫回線上 Google 試算表（006 US1；2026-11-19 T029 自動對位）。
 *
 * 老師的學習單若是「以連結匯入」，活動結束後把搶答成功組別的答案直接寫回
 * 那份線上試算表（助教 2026-11-17 說明：系統要直接串接線上 Google Sheets
 * 讀寫，不是下載 xlsx 離線處理）。
 *
 * 寫回前一定會**重新讀取並解析線上試算表**，並分成兩種比對：
 * - **內容比對**（題目是不是同一份）：題號、題型、題幹文字、每題的空格數與
 *   每個空格的前綴都相同 → 視為同一份題目，只是位置可能動過。
 * - **位置比對**（答案要寫到哪裡）：內容相同但儲存格位置不同（例如老師在
 *   線上插了一列）→ **自動對到線上現在的座標**寫入，答案仍對得上題目。
 *
 * 對應不起來時（題幹被改、空格數或前綴不同、題目被刪或重排）→ 回
 * `SHEET_MODIFIED`，不寫回，請老師改用「匯出 Guided Notes」下載含答案的
 * xlsx。讀不到或解析不出線上試算表 → 回 `SHEET_CHECK_FAILED`，同樣不寫回。
 *
 * 為什麼不放寬「讀不到就照舊座標寫」：讀不到線上試算表不代表服務帳號不能
 * 寫，硬寫會覆蓋別的格或公式（2026-11-19 實測：插一列後照舊座標寫會整體
 * 錯位一行）。
 *
 * 答案要寫到哪一格（合併填答區或右側獨立格）一律依**線上現在**的 merge
 * range 判定，不沿用匯入時的版面。
 *
 * 本模組唯讀本地資料（不動作答、不動資料庫），只在線上試算表寫入答案值。
 */
import type { DatabaseSync } from 'node:sqlite';
import { ERROR_MESSAGES, type ErrorCode } from '@classroom/shared';
import { buildResults } from './answerProjections.js';
import { buildBlankWrites } from './guidedNotesExporter.js';
import {
  getStoredGuidedNotes,
  list as listQuestions,
  type StoredQuestion,
} from '../infra/db/questionRepo.js';
import { parseGuidedNotes, type ParsedQuestion } from '../domain/guidedNotesParser.js';
import {
  fetchSheetXlsx,
  parseSheetLink,
} from '../infra/sheets/googleSheetsFetcher.js';
import { readWorkbook } from '../infra/xlsx/workbookReader.js';
import {
  getWorksheetXml,
  isMergedWithRightCell,
} from '../infra/xlsx/xlsxEditor.js';
import {
  SheetAuthError,
  SheetWriteError,
  type SheetWriter,
} from '../infra/sheets/sheetWriter.js';

export type WriteBackResult =
  | { ok: true; writtenCells: number; remapped: boolean }
  | { ok: false; code: ErrorCode; message: string };

export type WriteBackOptions = {
  /** 讀取線上試算表用來比對版面；測試注入假的 fetch，不連網路。 */
  fetchImpl?: typeof fetch | undefined;
};

function failure(code: ErrorCode): WriteBackResult {
  return { ok: false, code, message: ERROR_MESSAGES[code] };
}

/** 線上試算表目前的樣貌：工作表名稱、題目結構與該工作表的 XML。 */
type LiveSheet = {
  sheetName: string;
  questions: readonly ParsedQuestion[];
  xml: string;
};

/**
 * 讀取線上試算表。讀不到、解析不出題目或讀不到工作表 XML → 回 null
 * （無法確認要寫到哪裡，一律不寫回）。
 */
async function readLiveSheet(
  spreadsheetId: string,
  fetchImpl: typeof fetch | undefined,
): Promise<LiveSheet | null> {
  try {
    const bytes = await fetchSheetXlsx(spreadsheetId, { fetchImpl });
    const grids = await readWorkbook(bytes);
    const parsed = parseGuidedNotes(grids);
    if (!parsed.ok) {
      return null;
    }
    const xml = await getWorksheetXml(bytes, parsed.sheetName);
    return {
      sheetName: parsed.sheetName,
      questions: parsed.questions,
      xml,
    };
  } catch {
    return null;
  }
}

/** 比較題幹時忽略所有空白（半形與全形），避免老師只是多打一個空白就被擋。 */
function normalizeForCompare(text: string): string {
  return text.replace(/\s+/gu, '');
}

/**
 * 題目「內容」是否相同（不看位置）：題型、題幹文字、空格數與每個空格的
 * 前綴都要一樣。位置不同不影響這裡的判斷，那是位置比對的事。
 */
function sameQuestionContent(
  stored: StoredQuestion,
  live: ParsedQuestion,
): boolean {
  if (stored.kind !== live.kind) {
    return false;
  }
  if (normalizeForCompare(stored.prompt) !== normalizeForCompare(live.prompt)) {
    return false;
  }
  if (stored.blanks.length !== live.blanks.length) {
    return false;
  }
  return stored.blanks.every(
    (blank, index) => blank.prefix === live.blanks[index]?.prefix,
  );
}

/**
 * 線上版面與匯入時的關係：
 * - `same`：內容相同、位置也相同 → 照原位寫。
 * - `remapped`：內容相同、位置不同（例如老師插了一列）→ 自動對到線上現在
 *   的座標寫。
 * - `modified`：內容對不起來（題幹被改、空格數或前綴不同、題目被刪或重排）
 *   → 不寫回。
 */
type LayoutRelation = 'same' | 'remapped' | 'modified';

function compareLayout(
  storedQuestions: readonly StoredQuestion[],
  live: LiveSheet,
): LayoutRelation {
  if (storedQuestions.length !== live.questions.length) {
    return 'modified';
  }
  const liveByNumber = new Map(
    live.questions.map((question) => [question.number, question]),
  );

  let sameCells = true;
  for (const stored of storedQuestions) {
    const liveQuestion = liveByNumber.get(stored.number);
    if (liveQuestion === undefined) {
      return 'modified';
    }
    if (!sameQuestionContent(stored, liveQuestion)) {
      return 'modified';
    }
    for (const [index, blank] of stored.blanks.entries()) {
      if (blank.cell !== liveQuestion.blanks[index]?.cell) {
        sameCells = false;
      }
    }
  }
  return sameCells ? 'same' : 'remapped';
}

/**
 * 依線上現在的版面算出要寫入的儲存格與內容。
 *
 * - 這題沒有人搶答成功 → 不寫（不清空上一場留在表上的答案）。
 * - 答案數與線上的空格數不一致 → 回 null（對不起來，不硬寫）。
 */
function buildLiveWrites(
  storedQuestions: readonly StoredQuestion[],
  live: LiveSheet,
  answersByQuestion: ReadonlyMap<number, readonly string[]>,
): { cell: string; value: string }[] | null {
  const liveByNumber = new Map(
    live.questions.map((question) => [question.number, question]),
  );
  const updates: { cell: string; value: string }[] = [];

  for (const stored of storedQuestions) {
    const answers = answersByQuestion.get(stored.number);
    if (answers === undefined) {
      continue;
    }
    const liveQuestion = liveByNumber.get(stored.number);
    if (liveQuestion === undefined) {
      return null;
    }
    if (answers.length !== liveQuestion.blanks.length) {
      return null;
    }
    const blanks = liveQuestion.blanks.map((blank) => ({
      prefix: blank.prefix,
      cell: blank.cell,
      // 答案格是「合併填答區」還是「右側獨立格」，依線上現在的 merge range 判定。
      hasSeparateRightAnswerCell:
        blank.prefix !== '' && !isMergedWithRightCell(live.xml, blank.cell),
    }));
    const writes = buildBlankWrites(answers, blanks);
    if (writes === null) {
      return null;
    }
    for (const write of writes) {
      updates.push({ cell: write.cell, value: write.content });
    }
  }
  return updates;
}

/**
 * 把答案寫回老師的線上試算表。
 *
 * - 匯入來源不是連結（上傳的 xlsx）→ 沒有雲端目標，回 GUIDED_NOTES_NOT_LINK。
 * - 伺服器沒有設定服務帳號 → 回 SHEET_NOT_CONFIGURED。
 * - 線上版面只是位置移動 → 自動對位寫入，回 `remapped: true`。
 * - 線上題目被改動、對應不起來 → 回 SHEET_MODIFIED。
 * - 讀不到或解析不出線上試算表 → 回 SHEET_CHECK_FAILED。
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

  const storedQuestions = listQuestions(database);
  const answersByQuestion = new Map(
    buildResults(database, now)
      .filter((result) => result.winner !== null)
      .map((result) => [result.questionNumber, result.winner!.answers]),
  );
  if (answersByQuestion.size === 0) {
    // 這場沒有搶答成功的答案，沒有需要寫回的儲存格，也不必讀線上試算表。
    return { ok: true, writtenCells: 0, remapped: false };
  }

  const live = await readLiveSheet(spreadsheetId, options.fetchImpl);
  if (live === null) {
    // 讀不到不代表服務帳號不能寫，但無法確認要寫到哪裡 → 不寫回。
    return failure('SHEET_CHECK_FAILED');
  }

  const relation = compareLayout(storedQuestions, live);
  if (relation === 'modified') {
    // 題目被改過：對應不起來，不寫回（2026-11-19 review：硬寫會寫錯格）。
    return failure('SHEET_MODIFIED');
  }

  const updates = buildLiveWrites(storedQuestions, live, answersByQuestion);
  if (updates === null) {
    return failure('SHEET_MODIFIED');
  }
  if (updates.length === 0) {
    return { ok: true, writtenCells: 0, remapped: false };
  }

  try {
    await writer.writeCells({
      spreadsheetId,
      sheetName: live.sheetName,
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

  return {
    ok: true,
    writtenCells: updates.length,
    remapped: relation === 'remapped',
  };
}
