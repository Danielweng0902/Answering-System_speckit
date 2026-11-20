/**
 * 006 整合測試共用：以連結匯入的官方題組學習單（02）。
 *
 * 測試一律注入假的 fetch，不連網路；線上試算表的內容用 fixture 位元組模擬。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import type { DatabaseSync } from 'node:sqlite';
import { insertSubmission } from '../../src/infra/db/answerRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { replaceAll } from '../../src/infra/db/questionRepo.js';
import { readWorkbook } from '../../src/infra/xlsx/workbookReader.js';
import { parseGuidedNotes } from '../../src/domain/guidedNotesParser.js';

const FIXTURES = fileURLToPath(
  new URL('../../../fixtures/guided-notes/', import.meta.url),
);

export const OFFICIAL_GROUP_FILE = '02-official-group.xlsx';

/** 存檔內容的覆寫選項，用來模擬老師在線上改了題目。 */
export type SeedOverrides = {
  /** 覆寫題幹（key 為題號）：模擬老師改了題目內容。 */
  prompts?: Record<number, string>;
  /** 題號重排（key 為原題號 → 新題號）：模擬老師把題目換了位置。 */
  renumber?: Record<number, number>;
  /** 覆寫空格（key 為題號）：模擬老師改了子題數或前綴。 */
  blanks?: Record<number, { position: number; prefix: string; cell: string }[]>;
  /** 搶答成功那筆作答的答案（預設兩格）；可給對不上的數量測防呆。 */
  submissionAnswers?: string[];
};

/**
 * 依 02 fixture 的四題結構存檔。
 *
 * 題幹、題型、空格與前綴都直接取自 fixture 本身（不另外假造），這樣
 * 「線上試算表內容沒變、只是位置被移動」與「題目被改過」兩種情況才是
 * 真實可比對的。
 */
export async function seedOfficialGroupLinkStructure(
  target: DatabaseSync,
  overrides: SeedOverrides = {},
): Promise<void> {
  const file = new Uint8Array(
    await readFile(`${FIXTURES}${OFFICIAL_GROUP_FILE}`),
  );
  const grids = await readWorkbook(file);
  const parsed = parseGuidedNotes(grids);
  if (!parsed.ok) {
    throw new Error('測試用 fixture 02 解析失敗，測試資料本身有問題');
  }

  insertGroup(target, { id: 'group-1', name: '第一組', position: 1 });
  insertGroup(target, { id: 'group-2', name: '第二組', position: 2 });
  replaceAll(
    target,
    {
      sourceKind: 'link',
      sourceUrl: 'https://docs.google.com/spreadsheets/d/sheet-id-123',
      fileName: OFFICIAL_GROUP_FILE,
      file,
      sheetName: parsed.sheetName,
      importedAt: '2026-11-17T09:00:00.000Z',
    },
    parsed.questions.map((question) => ({
      id: `q-${question.number}`,
      number: overrides.renumber?.[question.number] ?? question.number,
      kind: question.kind,
      prompt: overrides.prompts?.[question.number] ?? question.prompt,
      position: question.position,
      blanks:
        overrides.blanks?.[question.number] ??
        question.blanks.map((blank) => ({
          position: blank.position,
          prefix: blank.prefix,
          cell: blank.cell,
        })),
    })),
  );
  // 有一筆搶答成功的作答，才有東西要寫回。
  insertSubmission(target, {
    id: 's1',
    questionId: 'q-1',
    groupId: 'group-1',
    rank: 1,
    receivedAt: '2026-11-17T09:30:00.000Z',
    answers: overrides.submissionAnswers ?? ['答案 A', '答案 B'],
  });
}

/** 假的線上試算表回應：回傳指定 fixture 的位元組。 */
export function fakeSheetFetch(fileName: string): typeof fetch {
  return (async () => {
    const bytes = await readFile(`${FIXTURES}${fileName}`);
    return new Response(bytes, { status: 200 });
  }) as unknown as typeof fetch;
}

/**
 * 在 fixture 的指定列插入一列（後面的列整個往下移），回傳處理後的位元組。
 * 模擬老師在線上試算表插了一列的情況。
 */
export async function sheetBytesWithInsertedRow(
  fileName: string,
  insertAtRow: number,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  // 用 readFile 而不是 load(Buffer)：exceljs 自己的型別把 Buffer 宣告成
  // `extends ArrayBuffer` 的介面，與 Node 的 Buffer 在 CI 上對不上（2026-11-19
  // GitHub Actions 第一次跑就抓到這裡型別不符）。
  await workbook.xlsx.readFile(`${FIXTURES}${fileName}`);
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) {
    throw new Error(`測試用 fixture ${fileName} 沒有工作表`);
  }
  sheet.insertRow(insertAtRow, []);
  const written = await workbook.xlsx.writeBuffer();
  // writeBuffer 實際回傳的是 Node 的 Buffer（Uint8Array 的子類別），
  // 轉成 Uint8Array 給呼叫端。
  return new Uint8Array(written as unknown as Uint8Array);
}

/** 假的線上試算表回應：回傳指定的位元組（已加工過的線上版本）。 */
export function fakeSheetFetchWithBytes(bytes: Uint8Array): typeof fetch {
  return (async () =>
    new Response(bytes, { status: 200 })) as unknown as typeof fetch;
}

/** 假的線上試算表回應：線上版本比匯入時多了一列（位置往下移）。 */
export async function fakeSheetFetchWithInsertedRow(
  fileName: string,
  insertAtRow: number,
): Promise<typeof fetch> {
  return fakeSheetFetchWithBytes(
    await sheetBytesWithInsertedRow(fileName, insertAtRow),
  );
}

/** 讀不到線上試算表時的假 fetch。 */
export function failingSheetFetch(): typeof fetch {
  return (async () =>
    new Response('nope', { status: 500 })) as unknown as typeof fetch;
}
