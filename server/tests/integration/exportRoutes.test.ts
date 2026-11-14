import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { ErrorCode } from '@classroom/shared';
import { issueSession } from '../../src/app/access.js';
import { getActivity, updateActivity } from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { insertSubmission } from '../../src/infra/db/answerRepo.js';
import { replaceAll } from '../../src/infra/db/questionRepo.js';
import { startTestServer as start, type TestServer } from './helpers.js';

const ENDPOINTS = [
  '/api/export/guided-notes',
  '/api/export/results.csv',
] as const;

async function requestExport(
  server: TestServer,
  path: (typeof ENDPOINTS)[number],
  token?: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== undefined && token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`${server.url}${path}`, { headers });
}

async function expectExportError(
  response: Response,
  status: number,
  code: ErrorCode,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/json');
  await expect(response.json()).resolves.toMatchObject({
    error: { code },
  });
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

describe('004 匯出 HTTP 路由 Foundational（T007）', () => {
  it.each(ENDPOINTS)('%s：沒有 token 或 token 無效 → 401 UNAUTHORIZED', async (path) => {
    const server = await start();
    try {
      await expectExportError(
        await requestExport(server, path),
        401,
        'UNAUTHORIZED',
      );
      await expectExportError(
        await requestExport(server, path, 'invalid-token'),
        401,
        'UNAUTHORIZED',
      );
    } finally {
      await server.close();
    }
  });

  it.each(ENDPOINTS)('%s：學生 → 403 FORBIDDEN，老師但 preparing/open → 409 INVALID_PHASE', async (path) => {
    const server = await start();
    try {
      insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
      const student = issueSession(server.db, {
        role: 'student',
        groupId: 'group-1',
      });
      const teacher = issueSession(server.db, { role: 'teacher' });

      await expectExportError(
        await requestExport(server, path, student),
        403,
        'FORBIDDEN',
      );
      await expectExportError(
        await requestExport(server, path, teacher),
        409,
        'INVALID_PHASE',
      );

      setPhase(server.db, 'open');
      await expectExportError(
        await requestExport(server, path, teacher),
        409,
        'INVALID_PHASE',
      );
    } finally {
      await server.close();
    }
  });

  it.each(ENDPOINTS)('%s：closed 但沒有匯入學習單 → 422 新錯誤代碼且不變更資料', async (path) => {
    const server = await start();
    try {
      const teacher = issueSession(server.db, { role: 'teacher' });
      setPhase(server.db, 'closed');
      const revisionBefore = getActivity(server.db)!.revision;

      const response = await requestExport(server, path, teacher);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'NO_GUIDED_NOTES',
          message: '這個活動沒有匯入過學習單，請先匯入學習單',
        },
      });
      expect(getActivity(server.db)!.revision).toBe(revisionBefore);
      expect(server.db.prepare('SELECT COUNT(*) AS count FROM questions').get()).toEqual({ count: 0 });
    } finally {
      await server.close();
    }
  });

  it('/api/export/guided-notes：老師 closed 後取得 xlsx 與 UTF-8 檔名', async () => {
    const server = await start();
    try {
      const original = new Uint8Array(
        await readFile(
          fileURLToPath(
            new URL(
              '../../../fixtures/guided-notes/01-official-single.xlsx',
              import.meta.url,
            ),
          ),
        ),
      );
      replaceAll(
        server.db,
        {
          sourceKind: 'file',
          sourceUrl: null,
          fileName: '01-official-single.xlsx',
          file: original,
          sheetName: '學習單',
          importedAt: '2026-11-14T09:00:00.000Z',
        },
        [
          {
            id: 'q-1',
            number: 1,
            kind: 'single',
            prompt: '單題',
            position: 1,
            blanks: [{ position: 1, prefix: '', cell: 'G5' }],
          },
        ],
      );
      insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
      insertSubmission(server.db, {
        id: 'submission-1',
        questionId: 'q-1',
        groupId: 'group-1',
        rank: 1,
        receivedAt: '2026-11-14T09:01:00.000Z',
        answers: ['勝出答案'],
      });
      const teacher = issueSession(server.db, { role: 'teacher' });
      setPhase(server.db, 'closed');
      const revisionBefore = getActivity(server.db)!.revision;
      const emitSpy = vi.spyOn(server.io, 'emit');

      const response = await requestExport(
        server,
        '/api/export/guided-notes',
        teacher,
      );
      const bytes = Buffer.from(await response.arrayBuffer());

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      const disposition = response.headers.get('content-disposition');
      expect(disposition).toMatch(
        /^attachment; filename="guided-notes\.xlsx"; filename\*=UTF-8''\S+$/,
      );
      const encodedName = disposition?.match(/filename\*=UTF-8''(.+)$/)?.[1];
      expect(decodeURIComponent(encodedName!)).toMatch(
        /^搶答結果_\d{8}_\d{4}\.xlsx$/,
      );
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from('PK'));
      expect(bytes).not.toEqual(Buffer.from(original));
      expect(getActivity(server.db)!.revision).toBe(revisionBefore);
      expect(emitSpy).not.toHaveBeenCalled();
      emitSpy.mockRestore();
    } finally {
      await server.close();
    }
  });

  it('/api/export/results.csv：老師 closed 後取得含 BOM 的 UTF-8 CSV', async () => {
    const server = await start();
    try {
      replaceAll(
        server.db,
        {
          sourceKind: 'file',
          sourceUrl: null,
          fileName: 'fixture.xlsx',
          file: new Uint8Array(),
          sheetName: '學習單',
          importedAt: '2026-11-14T09:00:00.000Z',
        },
        [
          {
            id: 'q-1',
            number: 1,
            kind: 'single',
            prompt: '單題',
            position: 1,
            blanks: [{ position: 1, prefix: '', cell: 'G5' }],
          },
        ],
      );
      insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
      insertSubmission(server.db, {
        id: 'submission-1',
        questionId: 'q-1',
        groupId: 'group-1',
        rank: 1,
        receivedAt: '2026-11-14T09:01:00.000Z',
        answers: ['中文答案'],
      });
      const teacher = issueSession(server.db, { role: 'teacher' });
      setPhase(server.db, 'closed');
      const revisionBefore = getActivity(server.db)!.revision;
      const emitSpy = vi.spyOn(server.io, 'emit');

      const response = await requestExport(server, '/api/export/results.csv', teacher);
      const bytes = Buffer.from(await response.arrayBuffer());

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      const disposition = response.headers.get('content-disposition');
      expect(disposition).toMatch(
        /^attachment; filename="results\.csv"; filename\*=UTF-8''\S+$/,
      );
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(bytes.subarray(3).toString('utf8')).toBe(
        '題號,空格序,組別,答案,順位,是否搶答成功,送出時間\r\n' +
          '1,1,第一組,中文答案,1,是,2026-11-14T09:01:00.000Z',
      );
      expect(getActivity(server.db)!.revision).toBe(revisionBefore);
      expect(emitSpy).not.toHaveBeenCalled();
      emitSpy.mockRestore();
    } finally {
      await server.close();
    }
  });
});
