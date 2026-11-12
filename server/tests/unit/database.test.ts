import { afterEach, describe, expect, it } from 'vitest';
import {
  initializeDatabase,
  openDatabase,
} from '../../src/infra/db/database.js';

const databases: ReturnType<typeof openDatabase>[] = [];

function database(): ReturnType<typeof openDatabase> {
  const db = openDatabase(':memory:');
  databases.push(db);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

describe('openDatabase', () => {
  it('建立 activity、groups、sessions 資料表', () => {
    const db = database();
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('activity', 'groups', 'sessions')
         ORDER BY name`,
      )
      .all() as { name: string }[];

    expect(rows.map((row) => row.name)).toEqual([
      'activity',
      'groups',
      'sessions',
    ]);
  });

  it('重複初始化不出錯', () => {
    const db = database();

    expect(() => initializeDatabase(db)).not.toThrow();
  });

  it('重複初始化後 activity 仍只有一列且初始為 preparing', () => {
    const db = database();
    initializeDatabase(db);

    const rows = db
      .prepare('SELECT id, phase, revision FROM activity')
      .all() as { id: number; phase: string; revision: number }[];
    expect(rows).toEqual([{ id: 1, phase: 'preparing', revision: 0 }]);
  });

  it('建立 guided_notes、questions、blanks 資料表', () => {
    const db = database();
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('guided_notes', 'questions', 'blanks')
         ORDER BY name`,
      )
      .all() as { name: string }[];

    expect(rows.map((row) => row.name)).toEqual([
      'blanks',
      'guided_notes',
      'questions',
    ]);
  });

  it('guided_notes 只能保存 id = 1 的單一學習單', () => {
    const db = database();
    const insert = db.prepare(
      `INSERT INTO guided_notes
         (id, source_kind, file, sheet_name, imported_at)
       VALUES (?, 'file', X'01', '學習單', '2026-11-12T00:00:00.000Z')`,
    );
    insert.run(1);

    expect(() => insert.run(1)).toThrow();
    expect(() => insert.run(2)).toThrow();
  });

  it('questions.number 在同一份學習單內不可重複', () => {
    const db = database();
    const insert = db.prepare(
      `INSERT INTO questions (id, number, kind, prompt, position)
       VALUES (?, 3, 'single', '', ?)`,
    );
    insert.run('question-1', 1);

    expect(() => insert.run('question-2', 2)).toThrow();
  });

  it('刪除 question 時以 foreign key cascade 一併刪除其 blanks', () => {
    const db = database();
    const insertQuestion = db.prepare(
      `INSERT INTO questions (id, number, kind, prompt, position)
       VALUES (?, ?, 'single', '', ?)`,
    );
    insertQuestion.run('question-1', 1, 1);
    insertQuestion.run('question-2', 2, 2);
    db.prepare(
      `INSERT INTO blanks (question_id, position, prefix, cell)
       VALUES ('question-1', 1, '', 'G5')`,
    ).run();
    db.prepare(
      `INSERT INTO blanks (question_id, position, prefix, cell)
       VALUES ('question-2', 1, '', 'G7')`,
    ).run();

    db.prepare("DELETE FROM questions WHERE id = 'question-1'").run();

    expect(
      db
        .prepare('SELECT question_id AS questionId FROM blanks ORDER BY question_id')
        .all(),
    ).toEqual([{ questionId: 'question-2' }]);
  });
});
