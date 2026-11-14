/**
 * 學習單、題目與空格的 SQLite 存取（data-model.md「SQLite 資料表」）。
 *
 * replaceAll 以 SAVEPOINT 包住「刪舊寫新」：單獨呼叫時本身就是一個
 * transaction；呼叫方（importService.confirm）已 BEGIN 時則成為巢狀
 * savepoint，整體仍在同一個交易內，失敗一起 ROLLBACK（research R9）。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { QuestionKind } from '@classroom/shared';

export type GuidedNotesSource = {
  sourceKind: 'link' | 'file';
  sourceUrl: string | null;
  fileName: string | null;
};

export type GuidedNotesRecord = GuidedNotesSource & {
  file: Uint8Array;
  sheetName: string;
  importedAt: string;
};

/** 快照用的學習單資訊：不含原檔位元組（getGuidedNotes）。 */
export type GuidedNotesMeta = GuidedNotesSource & {
  sheetName: string;
  importedAt: string;
};

export type BlankInput = {
  position: number;
  prefix: string;
  cell: string;
};

export type QuestionInput = {
  id: string;
  number: number;
  kind: QuestionKind;
  prompt: string;
  position: number;
  blanks: BlankInput[];
};

export type StoredQuestion = QuestionInput;

type QuestionRow = {
  id: string;
  number: number;
  kind: QuestionKind;
  prompt: string;
  position: number;
};

type BlankRow = {
  questionId: string;
  position: number;
  prefix: string;
  cell: string;
};

type GuidedNotesRow = {
  sourceKind: 'link' | 'file';
  sourceUrl: string | null;
  fileName: string | null;
  file: Uint8Array;
  sheetName: string;
  importedAt: string;
};

/** 刪除舊的 guided_notes、questions、blanks 再寫入新的（題目 id 由呼叫方隨機產生）。 */
export function replaceAll(
  database: DatabaseSync,
  guidedNotes: GuidedNotesRecord,
  questions: QuestionInput[],
): void {
  database.exec('SAVEPOINT questions_replace_all');
  try {
    // blanks 的 ON DELETE CASCADE 會跟著 questions 一起刪除。
    database.exec('DELETE FROM guided_notes; DELETE FROM questions;');

    database
      .prepare(
        `INSERT INTO guided_notes
           (id, source_kind, source_url, file_name, file, sheet_name, imported_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        guidedNotes.sourceKind,
        guidedNotes.sourceUrl,
        guidedNotes.fileName,
        guidedNotes.file,
        guidedNotes.sheetName,
        guidedNotes.importedAt,
      );

    const insertQuestion = database.prepare(
      `INSERT INTO questions (id, number, kind, prompt, position)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertBlank = database.prepare(
      `INSERT INTO blanks (question_id, position, prefix, cell)
       VALUES (?, ?, ?, ?)`,
    );
    for (const question of questions) {
      insertQuestion.run(
        question.id,
        question.number,
        question.kind,
        question.prompt,
        question.position,
      );
      for (const blank of question.blanks) {
        insertBlank.run(
          question.id,
          blank.position,
          blank.prefix,
          blank.cell,
        );
      }
    }

    database.exec('RELEASE SAVEPOINT questions_replace_all');
  } catch (error) {
    database.exec(
      'ROLLBACK TO SAVEPOINT questions_replace_all; RELEASE SAVEPOINT questions_replace_all',
    );
    throw error;
  }
}

/** 依 position（原檔順序）列出題目，空格依其在題目中的 position 排列。 */
export function list(database: DatabaseSync): StoredQuestion[] {
  const questionRows = database
    .prepare(
      `SELECT id, number, kind, prompt, position
       FROM questions ORDER BY position`,
    )
    .all() as QuestionRow[];
  const blankStatement = database.prepare(
    `SELECT question_id AS questionId, position, prefix, cell
     FROM blanks WHERE question_id = ? ORDER BY position`,
  );

  return questionRows.map((row) => ({
    id: row.id,
    number: row.number,
    kind: row.kind,
    prompt: row.prompt,
    position: row.position,
    blanks: (blankStatement.all(row.id) as BlankRow[]).map((blank) => ({
      position: blank.position,
      prefix: blank.prefix,
      cell: blank.cell,
    })),
  }));
}

export function count(database: DatabaseSync): number {
  const row = database
    .prepare('SELECT COUNT(*) AS count FROM questions')
    .get() as { count: number };
  return row.count;
}

function readGuidedNotesRow(database: DatabaseSync): GuidedNotesRow | null {
  const row = database
    .prepare(
      `SELECT source_kind AS sourceKind, source_url AS sourceUrl,
              file_name AS fileName, file, sheet_name AS sheetName,
              imported_at AS importedAt
       FROM guided_notes WHERE id = 1`,
    )
    .get() as GuidedNotesRow | undefined;
  return row ?? null;
}

/** 學習單資訊，不含原檔位元組（快照用，原則 VI）。 */
export function getGuidedNotes(database: DatabaseSync): GuidedNotesMeta | null {
  const row = readGuidedNotesRow(database);
  if (!row) {
    return null;
  }
  return {
    sourceKind: row.sourceKind,
    sourceUrl: row.sourceUrl,
    fileName: row.fileName,
    sheetName: row.sheetName,
    importedAt: row.importedAt,
  };
}

/** 完整學習單（含原檔位元組）；004 匯出與持久化測試使用。 */
export function getStoredGuidedNotes(
  database: DatabaseSync,
): GuidedNotesRecord | null {
  const row = readGuidedNotesRow(database);
  if (!row) {
    return null;
  }
  return {
    sourceKind: row.sourceKind,
    sourceUrl: row.sourceUrl,
    fileName: row.fileName,
    file: new Uint8Array(row.file),
    sheetName: row.sheetName,
    importedAt: row.importedAt,
  };
}
