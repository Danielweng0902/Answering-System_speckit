import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSnapshot } from '../../src/app/snapshot.js';
import { openDatabase } from '../../src/infra/db/database.js';
import {
  getActivity,
  updateActivity,
} from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { replaceAll as replaceQuestions } from '../../src/infra/db/questionRepo.js';

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
    // 002（FR-016）：questions、guidedNotes 只有老師快照有。
    expect(snapshot).not.toHaveProperty('questions');
    expect(snapshot).not.toHaveProperty('guidedNotes');
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
    // 002（FR-016）：questions、guidedNotes 只有老師快照有。
    expect(snapshot).not.toHaveProperty('questions');
    expect(snapshot).not.toHaveProperty('guidedNotes');
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
      // 尚未匯入：空清單與 null。
      questions: [],
      guidedNotes: null,
    });
    expect(snapshot).toHaveProperty('presence');
  });

  it('teacher 快照含 002 題目摘要（依 position）與學習單資訊（不含原檔）', () => {
    replaceQuestions(
      db,
      {
        sourceKind: 'link',
        sourceUrl: 'https://docs.google.com/spreadsheets/d/abc123',
        fileName: null,
        file: new Uint8Array([1, 2, 3]),
        sheetName: '學習單',
        importedAt: '2026-11-12T09:00:00.000Z',
      },
      [
        {
          id: randomUUID(),
          number: 2,
          kind: 'group',
          prompt: '第二題',
          position: 2,
          blanks: [
            { position: 1, prefix: '（1）', cell: 'G9' },
            { position: 2, prefix: '（2）', cell: 'G10' },
          ],
        },
        {
          id: randomUUID(),
          number: 1,
          kind: 'single',
          prompt: '第一題',
          position: 1,
          blanks: [{ position: 1, prefix: '', cell: 'G5' }],
        },
      ],
    );

    const snapshot = createSnapshot(db, { role: 'teacher' }, {}, fixedNow);

    expect(snapshot).toMatchObject({
      role: 'teacher',
      questions: [
        { number: 1, kind: 'single', prompt: '第一題', blankCount: 1 },
        { number: 2, kind: 'group', prompt: '第二題', blankCount: 2 },
      ],
      guidedNotes: {
        sheetName: '學習單',
        sourceKind: 'link',
        fileName: null,
        importedAt: '2026-11-12T09:00:00.000Z',
      },
    });
    // 快照不含原檔位元組。
    expect(JSON.stringify(snapshot)).not.toContain('sourceUrl');
  });
});
