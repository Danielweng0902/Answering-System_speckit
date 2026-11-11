import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
// Playwright 會在主程序與每個 worker 程序各載入一次這個設定檔。
// 只在主程序產生一次密碼與資料夾，worker 從繼承的環境變數沿用，
// 否則伺服器（主程序啟動）與測試（worker）會拿到不同的隨機密碼。
process.env.E2E_TEACHER_PASSWORD ??= randomBytes(32).toString('base64url');
process.env.E2E_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'classroom-response-e2e-'));

process.env.PORT = '3100';
process.env.DATA_DIR = process.env.E2E_DATA_DIR;
process.env.TEACHER_PASSWORD = process.env.E2E_TEACHER_PASSWORD;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm start',
    cwd: repositoryRoot,
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
