import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSnapshot } from '../../src/app/snapshot.js';
import { openDatabase } from '../../src/infra/db/database.js';
import {
  getActivity,
  updateActivity,
} from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';

const databases: ReturnType<typeof openDatabase>[] = [];
let db: ReturnType<typeof openDatabase>;

const fixedNow = new Date('2026-11-12T10:00:00.000Z');
const countdownEndsAt = '2026-11-12T10:01:00.000Z';

beforeEach(() => {
  db = database();
  insertGroup(db, { id: 'group-2', name: '第二組', position: 2 });
  insertGroup(db, { id: 'group-1', name: '第一組', position: 1 });

  const activity = getActivity(db);
  if (!activity) {
    throw new Error('activity was not initialized');
  }
  updateActivity(db, {
    ...activity,
    phase: 'open',
    countdownEndsAt,
    revision: 7,
  });
});

afterEach(() => {
  for (const open of databases.splice(0)) {
    open.close();
  }
});

function database(): ReturnType<typeof openDatabase> {
  const created = openDatabase(':memory:');
  databases.push(created);
  return created;
}

describe('createSnapshot', () => {
  it('guest 快照欄位符合 contract 且沒有 presence', () => {
    const snapshot = createSnapshot(db, { role: 'guest' }, undefined, fixedNow);

    expect(snapshot).toEqual({
      role: 'guest',
      revision: 7,
      serverNow: fixedNow.toISOString(),
      phase: 'open',
      countdownEndsAt,
      groups: [
        { id: 'group-1', name: '第一組' },
        { id: 'group-2', name: '第二組' },
      ],
    });
    expect(snapshot).not.toHaveProperty('presence');
  });

  it('student 快照欄位符合 contract 且沒有 presence', () => {
    const snapshot = createSnapshot(
      db,
      { role: 'student', groupId: 'group-1' },
      { 'group-1': 2 },
      fixedNow,
    );

    expect(snapshot).toEqual({
      role: 'student',
      myGroupId: 'group-1',
      revision: 7,
      serverNow: fixedNow.toISOString(),
      phase: 'open',
      countdownEndsAt,
      groups: [
        { id: 'group-1', name: '第一組' },
        { id: 'group-2', name: '第二組' },
      ],
    });
    expect(snapshot).not.toHaveProperty('presence');
  });

  it('teacher 快照欄位符合 contract 且只有 teacher 有 presence', () => {
    const presence = { 'group-1': 2, 'group-2': 0 };
    const snapshot = createSnapshot(db, { role: 'teacher' }, presence, fixedNow);

    expect(snapshot).toEqual({
      role: 'teacher',
      presence,
      revision: 7,
      serverNow: fixedNow.toISOString(),
      phase: 'open',
      countdownEndsAt,
      groups: [
        { id: 'group-1', name: '第一組' },
        { id: 'group-2', name: '第二組' },
      ],
    });
    expect(snapshot).toHaveProperty('presence');
  });
});
