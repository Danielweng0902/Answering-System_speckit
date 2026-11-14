import { DatabaseSync } from 'node:sqlite';
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

type TestDatabase = ReturnType<typeof openDatabase>;

function legacyDatabase(): TestDatabase {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  return db;
}

function seedGroup(
  db: TestDatabase,
  id = 'group-1',
  name = '第一組',
  position = 1,
): void {
  db.prepare('INSERT INTO groups (id, name, position) VALUES (?, ?, ?)').run(
    id,
    name,
    position,
  );
}

function seedQuestion(
  db: TestDatabase,
  id = 'question-1',
  number = 1,
): void {
  db.prepare(
    `INSERT INTO questions (id, number, kind, prompt, position)
     VALUES (?, ?, 'single', '', ?)`,
  ).run(id, number, number);
}

type SubmissionFixture = {
  id: string;
  questionId: string;
  groupId: string;
  rank: number;
  voidedAt: string | null;
};

function insertSubmission(
  db: TestDatabase,
  overrides: Partial<SubmissionFixture> = {},
): void {
  const submission: SubmissionFixture = {
    id: 'submission-1',
    questionId: 'question-1',
    groupId: 'group-1',
    rank: 1,
    voidedAt: null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO submissions
       (id, question_id, group_id, rank, received_at, voided_at)
     VALUES (?, ?, ?, ?, '2026-11-12T12:00:00.000Z', ?)`,
  ).run(
    submission.id,
    submission.questionId,
    submission.groupId,
    submission.rank,
    submission.voidedAt,
  );
}

describe('003 作答資料表與 migration', () => {
  it('新資料庫建立三張作答資料表，activity 有 session_id 與 answer_event_count', () => {
    const db = database();

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('submissions', 'submission_answers', 'group_answer_revisions')
         ORDER BY name`,
      )
      .all() as { name: string }[];
    expect(tables.map((table) => table.name)).toEqual([
      'group_answer_revisions',
      'submission_answers',
      'submissions',
    ]);

    const activity = db
      .prepare(
        `SELECT session_id AS sessionId,
                answer_event_count AS answerEventCount
         FROM activity WHERE id = 1`,
      )
      .get() as { sessionId: string | null; answerEventCount: number };
    expect(activity.answerEventCount).toBe(0);
    expect(typeof activity.sessionId).toBe('string');
    expect(activity.sessionId?.length ?? 0).toBeGreaterThan(0);

    const columns = db
      .prepare('PRAGMA table_info(activity)')
      .all() as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }[];
    expect(columns.find(({ name }) => name === 'session_id')).toMatchObject({
      type: 'TEXT',
      notnull: 0,
      dflt_value: null,
    });
    expect(
      columns.find(({ name }) => name === 'answer_event_count'),
    ).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
  });

  it('既有資料庫 migration 後補上 activity 欄位，舊列得到穩定的隨機 session_id', () => {
    const db = legacyDatabase();
    db.exec(`
      CREATE TABLE activity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        phase TEXT NOT NULL CHECK (phase IN ('preparing', 'open', 'closed')),
        opened_at TEXT,
        countdown_ends_at TEXT,
        closed_at TEXT,
        revision INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO activity
        (id, phase, opened_at, countdown_ends_at, closed_at, revision)
      VALUES
        (1, 'open', '2026-11-12T09:00:00.000Z', NULL, NULL, 7);
    `);

    initializeDatabase(db);

    const migrated = db
      .prepare(
        `SELECT revision,
                session_id AS sessionId,
                answer_event_count AS answerEventCount
         FROM activity WHERE id = 1`,
      )
      .get() as {
        revision: number;
        sessionId: string | null;
        answerEventCount: number;
      };
    expect(migrated.revision).toBe(7);
    expect(migrated.answerEventCount).toBe(0);
    expect(typeof migrated.sessionId).toBe('string');
    expect(migrated.sessionId?.length ?? 0).toBeGreaterThan(0);

    // migration 必須冪等，不能換掉既有列的 session_id。
    const sessionId = migrated.sessionId;
    expect(() => initializeDatabase(db)).not.toThrow();
    expect(
      db
        .prepare(
          `SELECT session_id AS sessionId
           FROM activity WHERE id = 1`,
        )
        .get(),
    ).toEqual({ sessionId });
  });

  it('submissions 的 rank 必須大於 0', () => {
    const db = database();
    seedGroup(db);
    seedQuestion(db);

    expect(() => insertSubmission(db, { rank: 0 })).toThrow();
    expect(() => insertSubmission(db, { rank: -1 })).toThrow();
  });

  it('每一題的 rank 不得重複（UNIQUE question_id, rank）', () => {
    const db = database();
    seedGroup(db, 'group-1', '第一組', 1);
    seedGroup(db, 'group-2', '第二組', 2);
    seedQuestion(db);
    insertSubmission(db);

    expect(() =>
      insertSubmission(db, {
        id: 'submission-2',
        groupId: 'group-2',
        rank: 1,
      }),
    ).toThrow();
  });

  it('每組每題同時只能有一筆有效作答；作廢後才能重新送出', () => {
    const db = database();
    seedGroup(db);
    seedQuestion(db);
    insertSubmission(db);

    expect(() =>
      insertSubmission(db, { id: 'submission-2', rank: 2 }),
    ).toThrow();

    db.prepare(
      `UPDATE submissions
       SET voided_at = '2026-11-12T12:01:00.000Z'
       WHERE id = 'submission-1'`,
    ).run();
    insertSubmission(db, { id: 'submission-2', rank: 2 });

    expect(
      db.prepare(
        `SELECT COUNT(*) AS count FROM submissions
         WHERE voided_at IS NULL`,
      ).get(),
    ).toEqual({ count: 1 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM submissions').get(),
    ).toEqual({ count: 2 });
  });

  it('刪除 question 時 cascade 刪除 submissions 與 submission_answers', () => {
    const db = database();
    seedGroup(db);
    seedQuestion(db, 'question-1', 1);
    seedQuestion(db, 'question-2', 2);
    insertSubmission(db);
    insertSubmission(db, {
      id: 'submission-2',
      questionId: 'question-2',
    });
    db.prepare(
      `INSERT INTO submission_answers
         (submission_id, blank_position, answer_text)
       VALUES ('submission-1', 1, '答案一')`,
    ).run();
    db.prepare(
      `INSERT INTO submission_answers
         (submission_id, blank_position, answer_text)
       VALUES ('submission-2', 1, '答案二')`,
    ).run();

    db.prepare("DELETE FROM questions WHERE id = 'question-1'").run();

    expect(
      db.prepare('SELECT id FROM submissions ORDER BY id').all(),
    ).toEqual([{ id: 'submission-2' }]);
    expect(
      db.prepare('SELECT submission_id FROM submission_answers').all(),
    ).toEqual([{ submission_id: 'submission-2' }]);
  });

  it('刪除 group 時 cascade 刪除 submissions、answers 與該組 revision', () => {
    const db = database();
    seedGroup(db, 'group-1', '第一組', 1);
    seedGroup(db, 'group-2', '第二組', 2);
    seedQuestion(db);
    insertSubmission(db);
    insertSubmission(db, {
      id: 'submission-2',
      groupId: 'group-2',
      rank: 2,
    });
    db.prepare(
      `INSERT INTO submission_answers
         (submission_id, blank_position, answer_text)
       VALUES ('submission-1', 1, '第一組答案')`,
    ).run();
    db.prepare(
      `INSERT INTO submission_answers
         (submission_id, blank_position, answer_text)
       VALUES ('submission-2', 1, '第二組答案')`,
    ).run();
    db.prepare(
      'INSERT INTO group_answer_revisions (group_id) VALUES (?)',
    ).run('group-1');
    db.prepare(
      'INSERT INTO group_answer_revisions (group_id) VALUES (?)',
    ).run('group-2');

    db.prepare("DELETE FROM groups WHERE id = 'group-1'").run();

    expect(db.prepare('SELECT id FROM submissions').all()).toEqual([
      { id: 'submission-2' },
    ]);
    expect(
      db.prepare('SELECT submission_id FROM submission_answers').all(),
    ).toEqual([{ submission_id: 'submission-2' }]);
    expect(
      db.prepare('SELECT group_id FROM group_answer_revisions').all(),
    ).toEqual([{ group_id: 'group-2' }]);
  });

  it('submission_answers 的同一作答同一空格只允許一筆，位置必須大於 0', () => {
    const db = database();
    seedGroup(db);
    seedQuestion(db);
    insertSubmission(db);
    const insertAnswer = db.prepare(
      `INSERT INTO submission_answers
         (submission_id, blank_position, answer_text)
       VALUES ('submission-1', ?, '答案')`,
    );
    insertAnswer.run(1);

    expect(() => insertAnswer.run(1)).toThrow();
    expect(() => insertAnswer.run(0)).toThrow();
    expect(() => insertAnswer.run(-1)).toThrow();
  });

  it('group_answer_revisions 以 group_id 為主鍵且 revision 不得為負數', () => {
    const db = database();
    seedGroup(db, 'group-1', '第一組', 1);
    seedGroup(db, 'group-2', '第二組', 2);
    db.prepare(
      `INSERT INTO group_answer_revisions (group_id) VALUES ('group-1')`,
    ).run();

    expect(() =>
      db.prepare(
        `INSERT INTO group_answer_revisions
           (group_id) VALUES ('group-1')`,
      ).run(),
    ).toThrow();
    expect(() =>
      db.prepare(
        `INSERT INTO group_answer_revisions
           (group_id, answer_revision) VALUES ('group-2', -1)`,
      ).run(),
    ).toThrow();
    expect(
      db.prepare(
        `SELECT group_id AS groupId, answer_revision AS answerRevision
         FROM group_answer_revisions WHERE group_id = 'group-1'`,
      ).get(),
    ).toEqual({ groupId: 'group-1', answerRevision: 0 });
  });
});
