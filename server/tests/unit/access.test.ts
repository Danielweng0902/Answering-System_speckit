import { afterEach, describe, expect, it } from 'vitest';
import {
  hashToken,
  issueSession,
  resolveIdentity,
} from '../../src/app/access.js';
import { openDatabase } from '../../src/infra/db/database.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';

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

describe('resolveIdentity', () => {
  it('缺少 token 時解析為 guest', () => {
    const db = database();

    expect(resolveIdentity(db)).toEqual({ role: 'guest' });
    expect(resolveIdentity(db, null)).toEqual({ role: 'guest' });
    expect(resolveIdentity(db, '')).toEqual({ role: 'guest' });
  });

  it('無效 token 解析為 guest', () => {
    const db = database();

    expect(resolveIdentity(db, 'not-a-valid-session')).toEqual({
      role: 'guest',
    });
  });

  it('由有效 token 解析 teacher 身分', () => {
    const db = database();
    const token = issueSession(db, { role: 'teacher' });

    expect(resolveIdentity(db, token)).toEqual({ role: 'teacher' });
  });

  it('由有效 token 解析 student 與其組別', () => {
    const db = database();
    insertGroup(db, { id: 'group-1', name: '第一組', position: 1 });
    const token = issueSession(db, {
      role: 'student',
      groupId: 'group-1',
    });

    expect(resolveIdentity(db, token)).toEqual({
      role: 'student',
      groupId: 'group-1',
    });
  });
});

describe('issueSession', () => {
  it('資料庫只保存雜湊，不出現 token 原值', () => {
    const db = database();
    const createdAt = '2026-11-12T00:00:00.000Z';
    const token = issueSession(db, { role: 'teacher' }, createdAt);

    const rows = db.prepare('SELECT * FROM sessions').all() as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(1);
    expect(Object.values(rows[0]!)).not.toContain(token);
    expect(rows[0]).toEqual({
      token_hash: hashToken(token),
      role: 'teacher',
      group_id: null,
      created_at: createdAt,
    });
  });
});
