import { DatabaseSync } from 'node:sqlite';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeDatabase } from '../../src/infra/db/database.js';
import { createApp } from '../../src/infra/http/app.js';

/**
 * 靜態檔與 client fallback 的行為（2026-11-21 第二驗證 GLM 覆核後補的回歸測試）。
 *
 * - 靜態根目錄裡的 dotfile（例如 .env、.DS_Store）**不得**被下載。
 *   先前為了讓「repo 在隱藏目錄（~/.t3/…）時靜態頁面不 404」而對整個
 *   靜態根目錄放行 dotfile，實測會讓 web/dist 內的 .env 回 200 與檔案內容。
 * - `HEAD /` 必須回 200（監控常以 HEAD 做健康檢查）。
 */
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function startStaticServer(webDistPath: string): Promise<{
  url: string;
  close: () => void;
}> {
  const database = new DatabaseSync(':memory:');
  initializeDatabase(database);
  const app = createApp({
    database,
    teacherPassword: undefined,
    webDistPath,
  });
  const server = createHttpServer(app);
  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => {
          server.close();
          database.close();
        },
      });
    });
  });
}

describe('靜態檔與 client fallback（2026-11-21 第二驗證）', () => {
  it('靜態根目錄裡的 dotfile 不得被下載', async () => {
    const webDist = mkdtempSync(join(tmpdir(), 'web-dist-'));
    cleanups.push(() => {
      // 暫存目錄只在測試期間存在，離開測試時刪除。
      rmSyncSafe(webDist);
    });
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>app</title>');
    writeFileSync(join(webDist, '.env'), 'SECRET=should-not-leak\n');
    mkdirSync(join(webDist, '.hidden'), { recursive: true });
    writeFileSync(join(webDist, '.hidden', 'x.txt'), 'hidden-content\n');

    const server = await startStaticServer(webDist);
    cleanups.push(() => server.close());

    for (const path of ['/.env', '/.hidden/x.txt']) {
      const response = await fetch(`${server.url}${path}`);
      const body = await response.text();
      expect(body, `${path} 不得回傳檔案內容`).not.toContain('should-not-leak');
      expect(body, `${path} 不得回傳隱藏檔案內容`).not.toContain('hidden-content');
    }
  });

  it('GET / 與 HEAD / 都回 200（監控常用 HEAD 做健康檢查）', async () => {
    const webDist = mkdtempSync(join(tmpdir(), 'web-dist-'));
    cleanups.push(() => rmSyncSafe(webDist));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>app</title>');

    const server = await startStaticServer(webDist);
    cleanups.push(() => server.close());

    const get = await fetch(`${server.url}/`);
    expect(get.status).toBe(200);
    expect(await get.text()).toContain('<title>app</title>');

    const head = await fetch(`${server.url}/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
  });
});

function rmSyncSafe(path: string): void {
  try {
    // 只刪除測試建立的暫存目錄。
    rmSync(path, { recursive: true, force: true });
  } catch {
    // 清理失敗不影響測試結果。
  }
}
