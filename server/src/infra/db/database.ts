import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    phase TEXT NOT NULL CHECK (phase IN ('preparing', 'open', 'closed')),
    opened_at TEXT,
    countdown_ends_at TEXT,
    closed_at TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    session_id TEXT,
    answer_event_count INTEGER NOT NULL DEFAULT 0,
    fair_ranking_enabled INTEGER NOT NULL DEFAULT 0,
    revealed_question_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
    group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guided_notes (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('link', 'file')),
    source_url TEXT,
    file_name TEXT,
    file BLOB NOT NULL,
    sheet_name TEXT NOT NULL,
    imported_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('single', 'group')),
    prompt TEXT NOT NULL,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blanks (
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    prefix TEXT NOT NULL,
    cell TEXT NOT NULL,
    PRIMARY KEY (question_id, position)
  );

  CREATE TABLE IF NOT EXISTS group_answer_revisions (
    group_id TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
    answer_revision INTEGER NOT NULL DEFAULT 0 CHECK (answer_revision >= 0)
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL CHECK (rank > 0),
    received_at TEXT NOT NULL,
    voided_at TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS submissions_question_rank_unique
    ON submissions(question_id, rank);

  CREATE UNIQUE INDEX IF NOT EXISTS submissions_one_valid_per_group_question
    ON submissions(question_id, group_id)
    WHERE voided_at IS NULL;

  CREATE INDEX IF NOT EXISTS submissions_by_group_valid
    ON submissions(group_id, voided_at);

  CREATE TABLE IF NOT EXISTS submission_answers (
    submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    blank_position INTEGER NOT NULL CHECK (blank_position > 0),
    answer_text TEXT NOT NULL,
    PRIMARY KEY (submission_id, blank_position)
  );

  CREATE INDEX IF NOT EXISTS submission_answers_by_submission
    ON submission_answers(submission_id);

  -- 2026-11-21 冷啟效能修正 P1：作答資料代際計數器。submissions 表的任何
  -- INSERT／UPDATE／DELETE（含繞過應用層的直寫與 FK CASCADE 刪除）都由
  -- trigger 遞增；記憶體作答索引以此判斷手上的投影是否仍有效，trigger
  -- 的更新與外層交易同進退，ROLLBACK 不會留下代際變化。
  CREATE TABLE IF NOT EXISTS answer_data_generation (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    generation INTEGER NOT NULL DEFAULT 0
  );

  CREATE TRIGGER IF NOT EXISTS submissions_generation_insert
    AFTER INSERT ON submissions
  BEGIN
    UPDATE answer_data_generation SET generation = generation + 1 WHERE id = 1;
  END;

  CREATE TRIGGER IF NOT EXISTS submissions_generation_update
    AFTER UPDATE ON submissions
  BEGIN
    UPDATE answer_data_generation SET generation = generation + 1 WHERE id = 1;
  END;

  CREATE TRIGGER IF NOT EXISTS submissions_generation_delete
    AFTER DELETE ON submissions
  BEGIN
    UPDATE answer_data_generation SET generation = generation + 1 WHERE id = 1;
  END;
`;

/** Seed the generation counter row; trigger updates are no-ops without it. */
function seedAnswerDataGeneration(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO answer_data_generation (id, generation)
       VALUES (1, 0)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run();
}

type ActivityColumn = { name: string };

function migrateActivityColumns(database: DatabaseSync): void {
  const columns = database.prepare('PRAGMA table_info(activity)').all() as
    ActivityColumn[];
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('session_id')) {
    database.exec('ALTER TABLE activity ADD COLUMN session_id TEXT');
  }
  if (!columnNames.has('answer_event_count')) {
    database.exec(
      `ALTER TABLE activity
       ADD COLUMN answer_event_count INTEGER NOT NULL DEFAULT 0`,
    );
  }
  // 005：公平順位旗標與投影看板揭曉進度（research R5）。
  if (!columnNames.has('fair_ranking_enabled')) {
    database.exec(
      `ALTER TABLE activity
       ADD COLUMN fair_ranking_enabled INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!columnNames.has('revealed_question_count')) {
    database.exec(
      `ALTER TABLE activity
       ADD COLUMN revealed_question_count INTEGER NOT NULL DEFAULT 0`,
    );
  }
}

/** Apply the idempotent schema and singleton seed to an open database. */
export function initializeDatabase(database: DatabaseSync): void {
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(SCHEMA);
  migrateActivityColumns(database);
  seedAnswerDataGeneration(database);
  database
    .prepare(
      `INSERT INTO activity
        (id, phase, opened_at, countdown_ends_at, closed_at, revision,
         session_id, answer_event_count, fair_ranking_enabled,
         revealed_question_count)
       VALUES (1, 'preparing', NULL, NULL, NULL, 0, ?, 0, 0, 0)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(randomUUID());

  // 001、002 的既有資料庫沒有 session_id；migration 後補上且以後保持不變。
  database
    .prepare(
      `UPDATE activity SET session_id = ? WHERE session_id IS NULL`,
    )
    .run(randomUUID());
}

export function openDatabase(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  try {
    initializeDatabase(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
