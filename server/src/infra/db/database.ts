import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    phase TEXT NOT NULL CHECK (phase IN ('preparing', 'open', 'closed')),
    opened_at TEXT,
    countdown_ends_at TEXT,
    closed_at TEXT,
    revision INTEGER NOT NULL DEFAULT 0
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
`;

/** Apply the idempotent schema and singleton seed to an open database. */
export function initializeDatabase(database: DatabaseSync): void {
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(SCHEMA);
  database
    .prepare(
      `INSERT INTO activity
        (id, phase, opened_at, countdown_ends_at, closed_at, revision)
       VALUES (1, 'preparing', NULL, NULL, NULL, 0)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run();
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
