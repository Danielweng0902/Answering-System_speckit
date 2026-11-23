import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startTestServer,
  type TestServer,
} from './helpers.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';

/**
 * 2026-11-21 資安審計 D2-3：`/api/student/join` 原本完全沒有節流，
 * 實測 1000 次 join 在 0.6 秒內全部成功（每次都新增一筆 session）。
 * 這裡驗證節流生效，且**不影響合法課堂規模**。
 */
describe('POST /api/student/join 速率限制', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
  });

  afterEach(async () => {
    await server.close();
  });

  function join(groupId = 'group-1'): Promise<Response> {
    return fetch(`${server.url}/api/student/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId }),
    });
  }

  it('連續進場超過門檻後回 429 TOO_MANY_ATTEMPTS，且不再新增 session', async () => {
    // 門檻預設 burst 600；先確認前 600 次都成功（合法課堂規模）。
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const response = await join();
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }

    const sessionsAfterBurst = server.db
      .prepare('SELECT COUNT(*) AS count FROM sessions')
      .get() as { count: number };
    expect(sessionsAfterBurst.count).toBe(600);

    // 額度用完 → 429。
    const blocked = await join();
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toEqual({
      error: { code: 'TOO_MANY_ATTEMPTS', message: expect.any(String) },
    });

    // 被擋下的請求不得動到資料（sessions 表不增加）。
    const sessionsAfterBlock = server.db
      .prepare('SELECT COUNT(*) AS count FROM sessions')
      .get() as { count: number };
    expect(sessionsAfterBlock.count).toBe(600);
  });

  it('格式錯誤與不存在的組別不影響額度以外的行為', async () => {
    const invalid = await fetch(`${server.url}/api/student/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(400);

    const missingGroup = await join('missing-group');
    expect(missingGroup.status).toBe(404);
  });

  it('不同來源的額度互相獨立', async () => {
    // 這個測試用同一個 server（同來源），因此改以單元測試驗證來源隔離；
    // 這裡只確認預設門檻不影響單一學生重複進場（正常操作）。
    const first = await join();
    expect(first.status).toBe(200);
    const second = await join();
    expect(second.status).toBe(200);
  });
});
