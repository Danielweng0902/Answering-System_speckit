import { afterEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import { getActivity, updateActivity } from '../../src/infra/db/activityRepo.js';
import type {
  SheetWriter,
  SheetWriteRequest,
} from '../../src/infra/sheets/sheetWriter.js';
import {
  failingSheetFetch,
  fakeSheetFetch,
  seedOfficialGroupLinkStructure,
} from './guidedNotesFixtures.js';
import { startTestServer, type TestServer } from './helpers.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function seed(target: TestServer): Promise<void> {
  await seedOfficialGroupLinkStructure(target.db);
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
  body: unknown = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`${target.url}/api/export/guided-notes/writeback`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
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
    server = await startTestServer({
      sheetWriter: writer,
      // 假的線上試算表（內容與匯入時相同 → 版面比對通過），不連網路。
      fetchImpl: fakeSheetFetch('02-official-group.xlsx'),
    });
    await seed(server);
    closeActivity(server);
    const token = issueSession(server.db, { role: 'teacher' });

    const response = await post(server, token);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ writtenCells: 2 });
    expect(requests[0]?.updates).toEqual([
      { cell: 'H5', value: '甲答案' },
      { cell: 'H6', value: '乙答案' },
    ]);
  });

  it('沒有 token 回 401、學生回 403、未結束回 409', async () => {
    server = await startTestServer({
      sheetWriter: { async writeCells(): Promise<void> {} },
      fetchImpl: fakeSheetFetch('02-official-group.xlsx'),
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
    server = await startTestServer({
      sheetWriter: null,
      fetchImpl: fakeSheetFetch('02-official-group.xlsx'),
    });
    await seed(server);
    closeActivity(server);
    const token = issueSession(server.db, { role: 'teacher' });

    const response = await post(server, token);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SHEET_NOT_CONFIGURED' },
    });
  });

  it('讀不到線上試算表、比對失敗時回 409 SHEET_CHECK_FAILED 且不寫入（006 T026）', async () => {
    const requests: SheetWriteRequest[] = [];
    const writer: SheetWriter = {
      async writeCells(request: SheetWriteRequest): Promise<void> {
        requests.push(request);
      },
    };
    server = await startTestServer({
      sheetWriter: writer,
      fetchImpl: failingSheetFetch(),
    });
    await seed(server);
    closeActivity(server);
    const token = issueSession(server.db, { role: 'teacher' });

    const response = await post(server, token);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SHEET_CHECK_FAILED' },
    });
    expect(requests).toHaveLength(0);
  });
});
