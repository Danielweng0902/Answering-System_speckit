/**
 * 答案要寫到哪個儲存格（006 US1；與 004 匯出共用同一套判定）。
 *
 * 002 依結構解析時已保存每個空格的 A1 座標（`blanks.cell`）與前綴；
 * 題組有兩種版面：前綴格與答案格分離（02）→ 答案寫右側獨立格；
 * 前綴位於合併填答區（04）→ 該合併格本身就是答案格，內容是「前綴＋答案」。
 * 兩者都由原檔的 merge range 判定，不寫死座標（原則 V）。
 */
import type { DatabaseSync } from 'node:sqlite';
import { buildResults } from './answerProjections.js';
import { buildBlankWrites } from './guidedNotesExporter.js';
import { getStoredGuidedNotes } from '../infra/db/questionRepo.js';
import { list as listQuestions } from '../infra/db/questionRepo.js';
import {
  getWorksheetXml,
  isMergedWithRightCell,
} from '../infra/xlsx/xlsxEditor.js';

export type GuidedNotesCellWrite = {
  /** A1 座標，例如 `H5`。 */
  cell: string;
  /** 要寫入的文字。 */
  content: string;
};

export type GuidedNotesTargets = {
  /** 工作表名稱（002 匯入時保存的那一個）。 */
  sheetName: string;
  writes: GuidedNotesCellWrite[];
};

/**
 * 解析本次活動要寫入的儲存格與內容。沒有匯入學習單時回傳 null；
 * 沒有任何搶答成功答案時回傳空的 writes（不寫入任何儲存格）。
 */
export async function resolveGuidedNotesTargets(
  database: DatabaseSync,
  now: Date = new Date(),
): Promise<GuidedNotesTargets | null> {
  const stored = getStoredGuidedNotes(database);
  if (stored === null) {
    return null;
  }

  const resultByNumber = new Map(
    buildResults(database, now).map((result) => [result.questionNumber, result]),
  );
  const originalSheetXml = await getWorksheetXml(stored.file, stored.sheetName);
  const writes: GuidedNotesCellWrite[] = [];

  for (const question of listQuestions(database)) {
    const result = resultByNumber.get(question.number);
    const blanks = question.blanks.map((blank) => ({
      ...blank,
      hasSeparateRightAnswerCell:
        blank.prefix !== '' && !isMergedWithRightCell(originalSheetXml, blank.cell),
    }));
    const questionWrites = buildBlankWrites(
      result?.winner?.answers ?? null,
      blanks,
    );
    if (questionWrites === null) {
      continue;
    }
    for (const write of questionWrites) {
      writes.push({ cell: write.cell, content: write.content });
    }
  }

  return { sheetName: stored.sheetName, writes };
}
