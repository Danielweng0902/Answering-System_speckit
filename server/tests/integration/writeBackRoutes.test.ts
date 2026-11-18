import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import { insertSubmission } from '../../src/infra/db/answerRepo.js';
import { getActivity, updateActivity } from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { replaceAll } from '../../src/infra/db/questionRepo.js';
import type {
  SheetWriter,
  SheetWriteRequest,
} from '../../src/infra/sheets/sheetWriter.js';
import { startTestServer, type TestServer } from './helpers.js';

const FIXTURES = fileURLToPath(
  new URL('../../../fixtures/guided-notes/', import.meta.url),
);

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function seed(target: TestServer): Promise<void> {
  insertGroup(target.db, { id: 'group-1', name: '第一組', position: 1 });
  replaceAll(
    target.db,
    {
      sourceKind: 'link',
      sourceUrl: 'https://docs.google.com/spreadsheets/d/sheet-id-123',
      fileName: '02-official-group.xlsx',
      file: new Uint8Array(
        await readFile(`${FIXTURES}02-official-group.xlsx`),
      ),
      sheetName: '學習單',
      importedAt: '2026-11-17T09:00:00.000Z',
    },
    [
      {
        id: 'q-1',
        number: 1,
        kind: 'group',
        prompt: '第一題',
        position: 1,
        blanks: [
          { position: 1, prefix: '（1）', cell: 'G5' },
          { position: 2, prefix: '（2）', cell: 'G6' },
        ],
      },
    ],
  );
  insertSubmission(target.db, {
    id: 's1',
    questionId: 'q-1',
    groupId: 'group-1',
    rank: 1,
    receivedAt: '2026-11-17T09:00:00.000Z',
    answers: ['CPU', '作業系統'],
  });
}

function closeActivity(target: TestServer): void {
  const activity = getActivity(target.db);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }
  updateActivity(target.db, {
    ...activity,
    phase: 'closed',
    revision: activity.revision + 1,
  });
}

async function post(
  target: TestServer,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`${target.url}/api/export/guided-notes/writeback`, {
    method: 'POST',
    headers,
  });
}

describe('006 寫回路由（US1）', () => {
  it('老師在已結束時可把答案寫回線上試算表', async () => {
    const requests: SheetWriteRequest[] = [];
    const writer: SheetWriter = {
      async writeCells(request: SheetWriteRequest): Promise<void> {
        requests.push(request);
      },
    };
    server = await startTestServer({ sheetWriter: writer });
    await seed(server);
    closeActivity(server);
    const token = issueSession(server.db, { role: 'teacher' });

    const response = await post(server, token);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ writtenCells: 2 });
    expect(requests[0]?.updates).toEqual([
      { cell: 'H5', value: 'CPU' },
      { cell: 'H6', value: '作業系統' },
    ]);
  });

  it('沒有 token 回 401、學生回 403、未結束回 409', async () => {
    server = await startTestServer({
      sheetWriter: { async writeCells(): Promise<void> {} },
    });
    await seed(server);
    const teacherToken = issueSession(server.db, { role: 'teacher' });
    const studentToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-1',
    });

    expect((await post(server)).status).toBe(401);
    expect((await post(server, studentToken)).status).toBe(403);
    expect((await post(server, teacherToken)).status).toBe(409);
  });

  it('伺服器沒有設定服務帳號時回 503 與 SHEET_NOT_CONFIGURED', async () => {
    server = await startTestServer({ sheetWriter: null });
    await seed(server);
    closeActivity(server);
    const token = issueSession(server.db, { role: 'teacher' });

    const response = await post(server, token);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SHEET_NOT_CONFIGURED' },
    });
  });
});
