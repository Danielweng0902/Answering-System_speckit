/**
 * T012（US1）：上傳 xlsx → ImportSummary → questions:confirm 的整合測試。
 *
 * 使用 fixtures/guided-notes/01-official-single.xlsx（工作表「學習單」、
 * 6 題、題號 1–6、空格 G5,G7,G9,G11,G13,G15）。所有等待 state 都在連線或
 * 送指令之前註冊；密碼一律用 TEACHER_PW 常數。
 */
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ImportSummary, TeacherSnapshot } from '@classroom/shared';
import { issueSession } from '../../src/app/access.js';
import { getActivity } from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import {
  count as countQuestions,
  getStoredGuidedNotes,
  list as listQuestions,
} from '../../src/infra/db/questionRepo.js';
import {
  seedQuestion,
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

const TEACHER_PW = 'test-teacher-password';

const FIXTURE_01_PATH = fileURLToPath(
  new URL('../../../fixtures/guided-notes/01-official-single.xlsx', import.meta.url),
);
const EXPECTED_CELLS = ['G5', 'G7', 'G9', 'G11', 'G13', 'G15'];
const IMPORT_EXPIRED_ACK = {
  ok: false,
  error: { code: 'IMPORT_EXPIRED', message: expect.any(String) },
} as const;

let fixture01: Uint8Array;
let fixture90: Uint8Array;
let fixture91: Uint8Array;
let fixture92: Uint8Array;
let server: TestServer | undefined;

function fixtureGuidedNotesPath(fileName: string): string {
  // 與 fixtures.test.ts 相同，統一由測試檔位置解析 fixtures 目錄。
  return fileURLToPath(
    new URL(`../../../fixtures/guided-notes/${fileName}`, import.meta.url),
  );
}

async function readFixture(fileName: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixtureGuidedNotesPath(fileName)));
}

beforeAll(async () => {
  [fixture01, fixture90, fixture91, fixture92] = await Promise.all([
    new Uint8Array(await readFile(FIXTURE_01_PATH)),
    readFixture('90-invalid-no-header.xlsx'),
    readFixture('91-invalid-duplicate-number.xlsx'),
    readFixture('92-invalid-empty.xlsx'),
  ]);
});

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(
  options: Parameters<typeof startTestServer>[0] = {},
): Promise<{ server: TestServer; token: string }> {
  server = await startTestServer({ teacherPassword: TEACHER_PW, ...options });
  return { server, token: await loginTeacher(server) };
}

async function loginTeacher(target: TestServer): Promise<string> {
  const response = await fetch(`${target.url}/api/teacher/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: TEACHER_PW }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string };
  return body.token;
}

function uploadFile(
  target: TestServer,
  token: string | null,
  bytes: Uint8Array = fixture01,
  fileName?: string,
  contentType = 'application/octet-stream',
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': contentType,
  };
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }
  if (fileName !== undefined) {
    headers['x-file-name'] = encodeURIComponent(fileName);
  }
  return fetch(`${target.url}/api/questions/import/file`, {
    method: 'POST',
    headers,
    body: bytes,
  });
}

async function preview(
  target: TestServer,
  token: string,
  fileName?: string,
): Promise<ImportSummary> {
  const response = await uploadFile(target, token, fixture01, fileName);
  expect(response.status).toBe(200);
  return (await response.json()) as ImportSummary;
}

async function connectTeacher(
  target: TestServer,
  token: string,
): Promise<{ socket: Socket; initial: TeacherSnapshot }> {
  const socket = target.connect({ token, autoConnect: false });
  const statePromise = waitForState(socket);
  socket.connect();
  const initial = (await statePromise) as TeacherSnapshot;
  expect(initial.role).toBe('teacher');
  return { socket, initial };
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual({
    error: { code, message: expect.any(String) },
  });
}

function storedImportState(target: TestServer) {
  return {
    questions: listQuestions(target.db),
    guidedNotes: getStoredGuidedNotes(target.db),
    revision: getActivity(target.db)?.revision,
  };
}

function expectStoredStateUnchanged(
  target: TestServer,
  before: ReturnType<typeof storedImportState>,
): void {
  expect(storedImportState(target)).toEqual(before);
}

function expectOfficialSummary(summary: ImportSummary): void {
  expect(summary.sheetName).toBe('學習單');
  expect(summary.questionCount).toBe(6);
  expect(summary.blankCount).toBe(6);
  expect(summary.importId).toEqual(expect.any(String));
  expect(summary.questions.map((question) => question.number)).toEqual([1, 2, 3, 4, 5, 6]);
  for (const question of summary.questions) {
    expect(question.kind).toBe('single');
    expect(question.blankCount).toBe(1);
    expect(question.blanks).toHaveLength(1);
  }
  // 空格位置（FR-011）與前綴。
  expect(summary.questions.map((question) => question.blanks[0]?.cell)).toEqual(EXPECTED_CELLS);
  for (const question of summary.questions) {
    expect(question.blanks[0]?.prefix).toBe('');
  }
}

describe('上傳 01 的讀取與確認（AC-002-01–03）', () => {
  it('讀取回傳 ImportSummary（6 題、6 空格、題號 1–6、replacesExisting=false），資料庫題目仍為空', async () => {
    const { server: target, token } = await start();
    const revisionBefore = getActivity(target.db)?.revision;

    const summary = await preview(target, token, '01-學習單.xlsx');

    expectOfficialSummary(summary);
    expect(summary.replacesExisting).toBe(false);
    // 讀取不寫入（FR-013、FR-019）。
    expect(countQuestions(target.db)).toBe(0);
    expect(getStoredGuidedNotes(target.db)).toBeNull();
    expect(getActivity(target.db)?.revision).toBe(revisionBefore);
  });

  it('confirm 後老師快照為題號 1–6、guidedNotes.sheetName=學習單、revision +1，另一個老師分頁同步；學生與訪客快照不含 questions、guidedNotes', async () => {
    const { server: target, token } = await start();
    insertGroup(target.db, { id: 'group-1', name: '第一組', position: 1 });
    const studentToken = issueSession(target.db, {
      role: 'student',
      groupId: 'group-1',
    });

    const teacherOne = await connectTeacher(target, token);
    const teacherTwo = await connectTeacher(target, token);
    const studentSocket = target.connect({ token: studentToken });
    const guestSocket = target.connect();
    await Promise.all([waitForState(studentSocket), waitForState(guestSocket)]);

    expect(teacherOne.initial.questions).toEqual([]);
    expect(teacherOne.initial.guidedNotes).toBeNull();

    const summary = await preview(target, token);
    // 學生連線會改變 presence 並使 revision +1，所以在送出確認前才讀取。
    const revisionBefore = getActivity(target.db)?.revision ?? 0;

    // 快照等待先註冊再送指令。
    const states = [teacherOne.socket, teacherTwo.socket, studentSocket, guestSocket].map(
      (socket) => waitForState(socket),
    );
    expect(
      await sendCommand(teacherOne.socket, 'questions:confirm', {
        importId: summary.importId,
      }),
    ).toEqual({ ok: true });

    const [confirmedOne, confirmedTwo, studentState, guestState] = await Promise.all(states);
    for (const snapshot of [confirmedOne, confirmedTwo]) {
      if (snapshot === undefined) throw new Error('missing teacher snapshot');
      expect(snapshot.role).toBe('teacher');
      expect(snapshot.revision).toBe(revisionBefore + 1);
      const teacher = snapshot as TeacherSnapshot;
      expect(teacher.questions.map((question) => question.number)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(teacher.questions.every((question) => question.blankCount === 1)).toBe(true);
      expect(teacher.guidedNotes).toMatchObject({
        sheetName: '學習單',
        sourceKind: 'file',
      });
    }
    for (const snapshot of [studentState, guestState]) {
      expect(snapshot).not.toHaveProperty('questions');
      expect(snapshot).not.toHaveProperty('guidedNotes');
    }
  });

  it('不確認（取消）時題目不變', async () => {
    const { server: target, token } = await start();

    await preview(target, token);

    // 取消不需要通知伺服器；老師重新連線仍沒有題目。
    const { initial } = await connectTeacher(target, token);
    expect(initial.questions).toEqual([]);
    expect(initial.guidedNotes).toBeNull();
    expect(countQuestions(target.db)).toBe(0);
  });
});

describe('取代既有題目（AC-002-05、FR-015）', () => {
  it('已有題目時 replacesExisting=true，確認後完全取代', async () => {
    const { server: target, token } = await start();
    seedQuestion(target.db);
    expect(countQuestions(target.db)).toBe(1);

    const summary = await preview(target, token, '新學習單.xlsx');
    expect(summary.replacesExisting).toBe(true);
    expectOfficialSummary(summary);

    const teacher = await connectTeacher(target, token);
    const nextState = waitForState(teacher.socket);
    expect(
      await sendCommand(teacher.socket, 'questions:confirm', {
        importId: summary.importId,
      }),
    ).toEqual({ ok: true });
    await nextState;

    expect(countQuestions(target.db)).toBe(6);
    expect(listQuestions(target.db).map((question) => question.number)).toEqual([1, 2, 3, 4, 5, 6]);
    const stored = getStoredGuidedNotes(target.db);
    expect(stored?.fileName).toBe('新學習單.xlsx');
    expect(stored?.sourceKind).toBe('file');
  });
});

describe('IMPORT_EXPIRED（AC-002-06；importId 不存在、被取代、過期）', () => {
  it('不存在的 importId 回 IMPORT_EXPIRED，資料不變也不廣播', async () => {
    const { server: target, token } = await start();
    const teacher = await connectTeacher(target, token);

    expect(
      await sendCommand(teacher.socket, 'questions:confirm', {
        importId: 'does-not-exist',
      }),
    ).toEqual(IMPORT_EXPIRED_ACK);

    expect(countQuestions(target.db)).toBe(0);
    await expect(waitForState(teacher.socket, 300)).rejects.toThrow('Timed out');
  });

  it('已被較新讀取取代的 importId 回 IMPORT_EXPIRED', async () => {
    const { server: target, token } = await start();
    const first = await preview(target, token);
    const second = await preview(target, token);
    expect(second.importId).not.toBe(first.importId);

    const teacher = await connectTeacher(target, token);
    expect(
      await sendCommand(teacher.socket, 'questions:confirm', {
        importId: first.importId,
      }),
    ).toEqual(IMPORT_EXPIRED_ACK);
    expect(countQuestions(target.db)).toBe(0);
  });

  it('超過 15 分鐘的 importId 回 IMPORT_EXPIRED（注入時鐘）', async () => {
    let current = new Date('2026-11-12T10:00:00.000Z');
    const { server: target, token } = await start({ now: () => current });
    const summary = await preview(target, token);

    current = new Date(current.getTime() + 15 * 60 * 1_000 + 1);

    const teacher = await connectTeacher(target, token);
    expect(
      await sendCommand(teacher.socket, 'questions:confirm', {
        importId: summary.importId,
      }),
    ).toEqual(IMPORT_EXPIRED_ACK);
    expect(countQuestions(target.db)).toBe(0);
    expect(getStoredGuidedNotes(target.db)).toBeNull();
  });
});

describe('身分與階段檢查（401／403／409，FR-004、019）', () => {
  it('沒有 token 與無效 token 回 401 UNAUTHORIZED，學生 token 回 403 FORBIDDEN', async () => {
    const { server: target } = await start();

    await expectError(await uploadFile(target, null), 401, 'UNAUTHORIZED');
    await expectError(await uploadFile(target, 'invalid-token'), 401, 'UNAUTHORIZED');

    insertGroup(target.db, { id: 'group-1', name: '第一組', position: 1 });
    const studentToken = issueSession(target.db, {
      role: 'student',
      groupId: 'group-1',
    });
    await expectError(await uploadFile(target, studentToken), 403, 'FORBIDDEN');
    expect(countQuestions(target.db)).toBe(0);
  });

  it.each(['open', 'closed'] as const)(
    '%s 時讀取回 409、questions:confirm 回 INVALID_PHASE，題目不變',
    async (phase) => {
      const { server: target, token } = await start();
      insertGroup(target.db, { id: 'group-1', name: '第一組', position: 1 });
      seedQuestion(target.db);
      const summary = await preview(target, token);

      const teacher = await connectTeacher(target, token);
      // 先收 open（與 close）的 state，再送指令。
      let statePromise = waitForState(teacher.socket);
      expect(await sendCommand(teacher.socket, 'activity:open', {})).toEqual({ ok: true });
      await statePromise;
      if (phase === 'closed') {
        statePromise = waitForState(teacher.socket);
        expect(await sendCommand(teacher.socket, 'activity:close', {})).toEqual({ ok: true });
        await statePromise;
      }

      await expectError(await uploadFile(target, token), 409, 'INVALID_PHASE');
      expect(
        await sendCommand(teacher.socket, 'questions:confirm', {
          importId: summary.importId,
        }),
      ).toEqual({
        ok: false,
        error: { code: 'INVALID_PHASE', message: expect.any(String) },
      });

      // 還是種子那一題，沒有被取代。
      const questions = listQuestions(target.db);
      expect(questions).toHaveLength(1);
      expect(questions[0]?.number).toBe(1);
      expect(getStoredGuidedNotes(target.db)?.fileName).toBe('seed.xlsx');
    },
  );
});

describe('保留性（FR-021；重設與重啟後題目保留，FR-010 原檔保存）', () => {
  async function importAndConfirm(
    target: TestServer,
    token: string,
    fileName = '01-學習單.xlsx',
  ): Promise<ImportSummary> {
    const summary = await preview(target, token, fileName);
    const teacher = await connectTeacher(target, token);
    const statePromise = waitForState(teacher.socket);
    expect(
      await sendCommand(teacher.socket, 'questions:confirm', {
        importId: summary.importId,
      }),
    ).toEqual({ ok: true });
    await statePromise;
    return summary;
  }

  it('重設活動後題目保留', async () => {
    const { server: target, token } = await start();
    insertGroup(target.db, { id: 'group-1', name: '第一組', position: 1 });
    await importAndConfirm(target, token);
    expect(countQuestions(target.db)).toBe(6);

    const teacher = await connectTeacher(target, token);
    for (const [event, payload] of [
      ['activity:open', {}],
      ['activity:close', {}],
      ['activity:reset', { confirm: true }],
    ] as const) {
      const statePromise = waitForState(teacher.socket);
      expect(await sendCommand(teacher.socket, event, payload)).toEqual({
        ok: true,
      });
      await statePromise;
    }

    expect(getActivity(target.db)?.phase).toBe('preparing');
    expect(countQuestions(target.db)).toBe(6);
    expect(listQuestions(target.db).map((question) => question.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('重新啟動伺服器後題目、原檔位元組與每個空格的 cell/prefix 都保留', async () => {
    const { server: target, token } = await start();
    const summary = await importAndConfirm(target, token);
    const dataDir = target.dataDir;

    await target.close({ preserveDataDir: true });

    const { server: restarted } = await start({ dataDir });
    try {
      expect(countQuestions(restarted.db)).toBe(6);
      expect(listQuestions(restarted.db).map((question) => question.number)).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);

      // FR-010：資料庫中的原檔位元組與上傳的完全相同。
      const stored = getStoredGuidedNotes(restarted.db);
      expect(stored).not.toBeNull();
      expect(stored?.sheetName).toBe('學習單');
      expect(stored?.fileName).toBe('01-學習單.xlsx');
      expect(stored?.file).toEqual(fixture01);

      // 每個空格的 cell 與 prefix 與摘要一致。
      for (const question of listQuestions(restarted.db)) {
        const expected = summary.questions.find(
          (candidate) => candidate.number === question.number,
        );
        expect(expected).toBeDefined();
        expect(question.blanks).toHaveLength(1);
        expect(question.blanks[0]).toMatchObject({
          position: 1,
          cell: expected?.blanks[0]?.cell,
          prefix: '',
        });
        expect(question.blanks[0]?.prefix).toBe(expected?.blanks[0]?.prefix);
      }

      // 重啟後老師快照一樣看得到題目。
      const restartedTeacher = await connectTeacher(restarted, await loginTeacher(restarted));
      expect(restartedTeacher.initial.questions.map((question) => question.number)).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
    } finally {
      await restarted.close();
    }
  });
});

describe('US4 檔案錯誤路徑（T043；AC-002-17、19；FR-003、019）', () => {
  it('PDF 位元組與損壞的 zip 都回 400 FILE_INVALID，已存資料完全不變', async () => {
    const { server: target, token } = await start();
    seedQuestion(target.db);
    const pdfBytes = new TextEncoder().encode('%PDF-1.4 not a real xlsx');
    const zip = new JSZip();
    zip.file('xl/workbook.xml', 'not a workbook');
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const damagedZip = zipBytes.slice(0, Math.max(0, zipBytes.length - 8));

    for (const bytes of [pdfBytes, damagedZip]) {
      const before = storedImportState(target);
      await expectError(await uploadFile(target, token, bytes), 400, 'FILE_INVALID');
      expectStoredStateUnchanged(target, before);
    }
  });

  it('沒有 token 時即使本體超過 5 MB 也先回 401，不讀取本體（T051）', async () => {
    const { server: target } = await start();
    await expectError(
      await uploadFile(target, null, new Uint8Array(5 * 1024 * 1024 + 1)),
      401,
      'UNAUTHORIZED',
    );
  });

  it('超過 express.raw 5 MB 上限回 413 FILE_TOO_LARGE JSON，資料完全不變', async () => {
    const { server: target, token } = await start();
    seedQuestion(target.db);
    const before = storedImportState(target);
    const overFiveMegabytes = new Uint8Array(5 * 1024 * 1024 + 1);

    await expectError(
      await uploadFile(target, token, overFiveMegabytes),
      413,
      'FILE_TOO_LARGE',
    );
    expectStoredStateUnchanged(target, before);
  });

  it('壓縮檔很小但解壓後超過 50 MB 的 xlsx 回 413 FILE_TOO_LARGE，資料完全不變', async () => {
    const { server: target, token } = await start();
    seedQuestion(target.db);
    const before = storedImportState(target);
    const zip = new JSZip();
    // 高度可壓縮的大檔案項目：體積可放在記憶體與 5 MB 上傳上限內，
    // 中央目錄的 uncompressed size 卻超過 50 MB。
    zip.file(
      'xl/worksheets/sheet1.xml',
      new Uint8Array(50 * 1024 * 1024 + 1),
    );
    const compressed = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    expect(compressed.length).toBeLessThan(5 * 1024 * 1024);

    await expectError(
      await uploadFile(target, token, compressed),
      413,
      'FILE_TOO_LARGE',
    );
    expectStoredStateUnchanged(target, before);
  });

  it('90、91、92 分別回 422 的三種內容錯誤，資料完全不變', async () => {
    const { server: target, token } = await start();
    seedQuestion(target.db);
    const cases: ReadonlyArray<readonly [Uint8Array, string]> = [
      [fixture90, 'HEADER_NOT_FOUND'],
      [fixture91, 'DUPLICATE_QUESTION_NUMBER'],
      [fixture92, 'NO_QUESTIONS'],
    ];

    for (const [bytes, code] of cases) {
      const before = storedImportState(target);
      await expectError(await uploadFile(target, token, bytes), 422, code);
      expectStoredStateUnchanged(target, before);
    }
  });

  it('Content-Type 不是允許的兩種值回 400 FILE_INVALID，資料完全不變', async () => {
    const { server: target, token } = await start();
    seedQuestion(target.db);
    const before = storedImportState(target);

    await expectError(
      await uploadFile(target, token, fixture01, undefined, 'application/pdf'),
      400,
      'FILE_INVALID',
    );
    expectStoredStateUnchanged(target, before);

    const response = await uploadFile(
      target,
      token,
      fixture01,
      undefined,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; charset=binary',
    );
    expect(response.status).toBe(200);
  });

  it('X-File-Name 解碼後只取最後一段，且最多保留 255 字', async () => {
    const { server: target, token } = await start();
    const longFileName = `${'學'.repeat(300)}.xlsx`;
    const summary = await preview(
      target,
      token,
      `C:\\老師的資料\\${longFileName}`,
    );

    const teacher = await connectTeacher(target, token);
    const statePromise = waitForState(teacher.socket);
    expect(
      await sendCommand(teacher.socket, 'questions:confirm', {
        importId: summary.importId,
      }),
    ).toEqual({ ok: true });
    await statePromise;

    const expectedFileName = Array.from(longFileName).slice(0, 255).join('');
    expect(getStoredGuidedNotes(target.db)?.fileName).toBe(expectedFileName);
  });
});

describe('匯入效能（T052；SC-003）', () => {
  it('上傳 01 到收到摘要的時間在 5 秒內', async () => {
    const { server: target, token } = await start();

    const startedAt = performance.now();
    const summary = await preview(target, token, '01-official-single.xlsx');
    const elapsedMs = performance.now() - startedAt;

    expectOfficialSummary(summary);
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
