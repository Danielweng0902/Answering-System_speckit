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
});
