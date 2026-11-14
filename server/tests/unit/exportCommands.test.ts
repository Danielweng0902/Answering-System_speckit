import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '@classroom/shared';
import {
  authorizeExport,
  buildExportFileName,
} from '../../src/app/exportCommands.js';
import { issueSession } from '../../src/app/access.js';
import { getActivity, updateActivity } from '../../src/infra/db/activityRepo.js';
import { openDatabase } from '../../src/infra/db/database.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';

function withDatabase<T>(run: (database: DatabaseSync) => T): T {
  const database = openDatabase(':memory:');
  try {
    return run(database);
  } finally {
    database.close();
  }
}

function expectExportError(
  result: ReturnType<typeof authorizeExport>,
  code: ErrorCode,
): void {
  expect(result).toEqual({ ok: false, code });
}

function setPhase(database: DatabaseSync, phase: 'preparing' | 'open' | 'closed'): void {
  const activity = getActivity(database);
  expect(activity).not.toBeNull();
  updateActivity(database, {
    ...activity!,
    phase,
    revision: activity!.revision + 1,
  });
}

describe('exportCommands（004 Foundational；T003）', () => {
  it.each<[string, string | undefined]>([
    ['沒有 token', undefined],
    ['無效 token', 'invalid-token'],
  ])('%s → UNAUTHORIZED', (_name, token) => {
    withDatabase((database) => {
      expectExportError(authorizeExport(database, token), 'UNAUTHORIZED');
      expect(database.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 0 });
    });
  });

  it('學生 token → FORBIDDEN', () => {
    withDatabase((database) => {
      insertGroup(database, { id: 'group-1', name: '第一組', position: 1 });
      const student = issueSession(database, {
        role: 'student',
        groupId: 'group-1',
      });

      expectExportError(authorizeExport(database, student), 'FORBIDDEN');
    });
  });

  it.each(['preparing', 'open'] as const)(
    '老師 token 但活動在 %s → INVALID_PHASE',
    (phase) => {
      withDatabase((database) => {
        const teacher = issueSession(database, { role: 'teacher' });
        setPhase(database, phase);

        expectExportError(authorizeExport(database, teacher), 'INVALID_PHASE');
      });
    },
  );

  it('已結束但沒有匯入學習單 → NO_GUIDED_NOTES', () => {
    withDatabase((database) => {
      const teacher = issueSession(database, { role: 'teacher' });
      setPhase(database, 'closed');

      expectExportError(
        authorizeExport(database, teacher),
        'NO_GUIDED_NOTES',
      );
    });
  });

  it('所有授權與階段失敗都不改變資料、不產生資料列', () => {
    withDatabase((database) => {
      const beforeRevision = getActivity(database)!.revision;

      expectExportError(authorizeExport(database, 'invalid'), 'UNAUTHORIZED');
      setPhase(database, 'open');
      const teacher = issueSession(database, { role: 'teacher' });
      expectExportError(authorizeExport(database, teacher), 'INVALID_PHASE');

      expect(database.prepare('SELECT COUNT(*) AS count FROM guided_notes').get()).toEqual({ count: 0 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM questions').get()).toEqual({ count: 0 });
      expect(getActivity(database)!.revision).toBe(beforeRevision + 1);
    });
  });

  it('檔名使用固定的「搶答結果_YYYYMMDD_HHmm」格式', () => {
    const build = (extension: 'xlsx' | 'csv') =>
      buildExportFileName(new Date('2026-11-14T09:08:07.123Z'), extension);

    expect(build('xlsx')).toBe('搶答結果_20261114_0908.xlsx');
    expect(build('csv')).toBe('搶答結果_20261114_0908.csv');
  });
});
