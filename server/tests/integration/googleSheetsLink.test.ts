/**
 * T013（US1）：Google 試算表連結匯入的整合測試。
 *
 * 一律注入假的 fetch，不連網路。連結的 <ID> 會被轉成
 * `https://docs.google.com/spreadsheets/d/<ID>/export?format=xlsx` 下載；回傳
 * fixtures/guided-notes/01-official-single.xlsx 的位元組時，摘要與上傳 01
 * 完全相同（AC-002-04；FR-001、002；research R4）。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ImportSummary } from '@classroom/shared';
import { getActivity } from '../../src/infra/db/activityRepo.js';
import {
  getStoredGuidedNotes,
  list as listQuestions,
} from '../../src/infra/db/questionRepo.js';
import { fetchSheetXlsx } from '../../src/infra/sheets/googleSheetsFetcher.js';
import {
  seedQuestion,
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

const TEACHER_PW = 'test-teacher-password';
const SHEET_ID = 'abc_123-XYZ';
const SHEET_LINK = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;
const EXPECTED_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;

const FIXTURE_01_PATH = fileURLToPath(
  new URL(
    '../../../fixtures/guided-notes/01-official-single.xlsx',
    import.meta.url,
  ),
);

let fixture01: Uint8Array;
let server: TestServer | undefined;

beforeAll(async () => {
  fixture01 = new Uint8Array(await readFile(FIXTURE_01_PATH));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
});

async function loginTeacher(target: TestServer): Promise<string> {
  const response = await fetch(`${target.url}/api/teacher/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: TEACHER_PW }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { token: string }).token;
}

function importFromLink(
  target: TestServer,
  token: string | null,
  url?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }
  return fetch(`${target.url}/api/questions/import/link`, {
    method: 'POST',
    headers,
    body: JSON.stringify(url === undefined ? {} : { url }),
  });
}

async function expectLinkError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
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

async function startWithFetch(
  fetchImpl: typeof fetch,
): Promise<{ server: TestServer; token: string }> {
  server = await startTestServer({
    teacherPassword: TEACHER_PW,
    fetchImpl,
  });
  const target = server;
  const token = await loginTeacher(target);
  return { server: target, token };
}

function xlsxResponse(): Response {
  return new Response(fixture01, { status: 200 });
}

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location },
  });
}

function chunkStream(): ReadableStream<Uint8Array> {
  let sentBytes = 0;
  const chunk = new Uint8Array(1024 * 1024).fill(65);
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sentBytes >= 6 * 1024 * 1024) {
        controller.close();
        return;
      }
      sentBytes += chunk.length;
      controller.enqueue(chunk);
    },
  });
}

describe('連結讀取與確認（AC-002-04；注入假的 fetch）', () => {
  it('<ID> 被轉成 export?format=xlsx 下載；摘要與上傳 01 完全相同；確認後 sourceKind=link、sourceUrl 正規化', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Promise.resolve(new Response(fixture01, { status: 200 })),
    );
    server = await startTestServer({
      teacherPassword: TEACHER_PW,
      fetchImpl,
    });
    const target = server;
    const token = await loginTeacher(target);

    const teacherSocket = target.connect({ token, autoConnect: false });
    const initial = waitForState(teacherSocket);
    teacherSocket.connect();
    await initial;

    const response = await importFromLink(target, token, SHEET_LINK);
    expect(response.status).toBe(200);
    const summary = (await response.json()) as ImportSummary;

    // 只由 <ID> 組出匯出網址，不使用連結的 #gid 等其他部分。
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      EXPECTED_EXPORT_URL,
      expect.objectContaining({
        redirect: 'manual',
        signal: expect.any(AbortSignal),
      }),
    );

    expect(summary.sheetName).toBe('學習單');
    expect(summary.questionCount).toBe(6);
    expect(summary.blankCount).toBe(6);
    expect(summary.questions.map((question) => question.number)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(
      summary.questions.map((question) => question.blanks[0]?.cell),
    ).toEqual(['G5', 'G7', 'G9', 'G11', 'G13', 'G15']);
    for (const question of summary.questions) {
      expect(question.blanks[0]?.prefix).toBe('');
    }
    expect(summary.replacesExisting).toBe(false);

    // 與上傳同一份檔案的摘要完全相同（只有 importId 不同）。
    const uploadResponse = await fetch(
      `${target.url}/api/questions/import/file`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/octet-stream',
        },
        body: fixture01,
      },
    );
    expect(uploadResponse.status).toBe(200);
    const uploadSummary = (await uploadResponse.json()) as ImportSummary;
    const { importId: linkImportId, ...linkRest } = summary;
    const { importId: uploadImportId, ...uploadRest } = uploadSummary;
    expect(linkRest).toEqual(uploadRest);
    expect(linkImportId).not.toBe(uploadImportId);

    // 較新的讀取是 uploadSummary；以它確認，來源仍正確記為 file。
    // 另外再讀一次連結，確認 link 來源的保存。
    const linkAgain = (await (
      await importFromLink(target, token, SHEET_LINK)
    ).json()) as ImportSummary;
    const statePromise = waitForState(teacherSocket);
    expect(
      await sendCommand(teacherSocket, 'questions:confirm', {
        importId: linkAgain.importId,
      }),
    ).toEqual({ ok: true });
    await statePromise;

    const stored = getStoredGuidedNotes(target.db);
    expect(stored?.sourceKind).toBe('link');
    expect(stored?.sourceUrl).toBe(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
    );
    expect(stored?.fileName).toBeNull();
    expect(stored?.file).toEqual(fixture01);
  });

  it('不符合形式的連結回 400 LINK_INVALID 且不發出任何請求；缺少 url 回 400 INVALID_INPUT', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Promise.resolve(new Response(fixture01, { status: 200 })),
    );
    server = await startTestServer({
      teacherPassword: TEACHER_PW,
      fetchImpl,
    });
    const target = server;
    const token = await loginTeacher(target);
    seedQuestion(target.db);
    const before = storedImportState(target);

    for (const url of [
      'https://example.com/',
      'https://example.com/spreadsheets/d/abc/edit',
      `http://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
      `https://docs.google.com/document/d/${SHEET_ID}/edit`,
      'not-a-url',
    ]) {
      const response = await importFromLink(target, token, url);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: 'LINK_INVALID', message: expect.any(String) },
      });
    }

    const missing = await importFromLink(target, token);
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({
      error: { code: 'INVALID_INPUT', message: expect.any(String) },
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expectStoredStateUnchanged(target, before);
  });

  it('沒有 token 回 401 UNAUTHORIZED，不發出任何請求', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(xlsxResponse()),
    );
    const { server: target } = await startWithFetch(fetchImpl);

    const response = await importFromLink(target, null, SHEET_LINK);
    await expectLinkError(response, 401, 'UNAUTHORIZED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('US4 連結錯誤路徑（T044；AC-002-18、19；research R4）', () => {
  it('導向 accounts.google.com 或回應不是 xlsx，都回 422 LINK_NOT_SHARED，資料完全不變', async () => {
    const accountsUrl = 'https://accounts.google.com/ServiceLogin?service=wise';
    const fetchImpl = vi
      .fn<typeof fetch>(() => Promise.resolve(xlsxResponse()))
      .mockImplementationOnce(() =>
        Promise.resolve(redirectResponse(accountsUrl)),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(
          new Response('<html>請先登入</html>', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
        ),
      );
    const { server: target, token } = await startWithFetch(fetchImpl);
    seedQuestion(target.db);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = storedImportState(target);
      await expectLinkError(
        await importFromLink(target, token, SHEET_LINK),
        422,
        'LINK_NOT_SHARED',
      );
      expectStoredStateUnchanged(target, before);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('轉址主機不是 docs.google.com 或 *.googleusercontent.com 時拒絕且不讀取回應內容', async () => {
    const getReader = vi.fn(() => {
      throw new Error('不應讀取內容');
    });
    const response = {
      status: 302,
      ok: false,
      headers: new Headers({ location: 'https://attacker.example/x.xlsx' }),
      body: {
        getReader,
      } as unknown as ReadableStream<Uint8Array>,
    } as Response;
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(response),
    );
    const { server: target, token } = await startWithFetch(fetchImpl);
    seedQuestion(target.db);
    const before = storedImportState(target);

    await expectLinkError(
      await importFromLink(target, token, SHEET_LINK),
      422,
      'LINK_NOT_SHARED',
    );
    expectStoredStateUnchanged(target, before);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(getReader).not.toHaveBeenCalled();
  });

  it('轉址到允許的主機但指定其他埠時拒絕（T051）', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'https://docs.google.com:8443/x.xlsx' },
        }),
      ),
    );
    const { server: target, token } = await startWithFetch(fetchImpl);
    seedQuestion(target.db);
    const before = storedImportState(target);

    await expectLinkError(
      await importFromLink(target, token, SHEET_LINK),
      422,
      'LINK_NOT_SHARED',
    );
    expectStoredStateUnchanged(target, before);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('允許轉址到 *.googleusercontent.com，並改讀最終網址', async () => {
    const downloadHost = `https://${SHEET_ID.toLowerCase()}.doc-00-a1-sheets.googleusercontent.com/export/xlsx`;
    const fetchImpl = vi
      .fn<typeof fetch>(() => Promise.resolve(xlsxResponse()))
      .mockImplementationOnce(() =>
        Promise.resolve(redirectResponse(downloadHost)),
      );
    const { server: target, token } = await startWithFetch(fetchImpl);

    const response = await importFromLink(target, token, SHEET_LINK);
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      downloadHost,
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('計時器以 10 秒逾時，中止的 fetch 拋出 LINK_UNREACHABLE', async () => {
    let runTimeout: (() => void) | undefined;
    const setTimeoutImpl = vi.fn((callback: () => void, milliseconds: number) => {
      expect(milliseconds).toBe(10_000);
      runTimeout = callback;
      return 'timeout-handle';
    });
    const clearTimeoutImpl = vi.fn((handle: unknown) => {
      expect(handle).toBe('timeout-handle');
    });
    const fetchImpl = vi.fn<typeof fetch>((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
        runTimeout?.();
      }),
    );

    await expect(
      fetchSheetXlsx(SHEET_ID, {
        fetchImpl,
        setTimeoutImpl,
        clearTimeoutImpl,
      }),
    ).rejects.toMatchObject({
      code: 'LINK_UNREACHABLE',
    });
    expect(setTimeoutImpl).toHaveBeenCalledTimes(1);
    expect(clearTimeoutImpl).toHaveBeenCalledTimes(1);
  });

  it('連結下載 10 秒逾時中止，HTTP 回 502 LINK_UNREACHABLE，資料完全不變', async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      }),
    );
    const { server: target, token } = await startWithFetch(fetchImpl);
    seedQuestion(target.db);
    const before = storedImportState(target);

    vi.useFakeTimers();
    try {
      const request = importFromLink(target, token, SHEET_LINK);
      await vi.waitFor(
        () => {
          expect(fetchImpl).toHaveBeenCalledTimes(1);
        },
        { timeout: 1_000, interval: 10 },
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await expectLinkError(await request, 502, 'LINK_UNREACHABLE');
    } finally {
      vi.useRealTimers();
    }
    expectStoredStateUnchanged(target, before);
  });

  it('網路連線失敗回 502 LINK_UNREACHABLE，資料完全不變', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError('network down')),
    );
    const { server: target, token } = await startWithFetch(fetchImpl);
    seedQuestion(target.db);
    const before = storedImportState(target);

    await expectLinkError(
      await importFromLink(target, token, SHEET_LINK),
      502,
      'LINK_UNREACHABLE',
    );
    expectStoredStateUnchanged(target, before);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('串流下載超過 5 MB 就中止，回 413 FILE_TOO_LARGE，資料完全不變', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(chunkStream(), { status: 200 })),
    );
    const { server: target, token } = await startWithFetch(fetchImpl);
    seedQuestion(target.db);
    const before = storedImportState(target);

    await expectLinkError(
      await importFromLink(target, token, SHEET_LINK),
      413,
      'FILE_TOO_LARGE',
    );
    expectStoredStateUnchanged(target, before);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('非 zip 的回應即使伺服器標示成功，也視為 LINK_NOT_SHARED', async () => {
    await expect(
      fetchSheetXlsx(SHEET_ID, {
        fetchImpl: vi.fn<typeof fetch>(() =>
          Promise.resolve(new Response('not a spreadsheet', { status: 200 })),
        ),
      }),
    ).rejects.toMatchObject({ code: 'LINK_NOT_SHARED' });
  });
});
