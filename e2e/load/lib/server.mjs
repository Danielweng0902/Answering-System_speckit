/**
 * 正式 build 伺服器的生命週期管理（e2e/load 用）。
 *
 * 每次 startServer：
 * - 以子程序啟動 `node server/dist/index.js`（正式 build，不是 tsx）；
 * - 使用新的暫存資料夾（DATA_DIR）與全新的 SQLite 檔；
 * - PORT 固定傳 0 讓作業系統挑可用 port（避免與其他服務衝突），實際 port
 *   從子程序 stdout 的 "Server listening on ..." 解析；
 * - TEACHER_PASSWORD 每次隨機產生（或由呼叫方提供），只經環境變數傳遞，
 *   不寫檔、不印出，也不包含在回傳值裡；
 * - 就緒判斷：輪詢 GET /api/health 直到 200，逾時明確報錯；
 * - stop() 關閉子程序（逾時未退出就 SIGKILL）並刪除暫存目錄。
 *
 * 回傳 { url, port, dataDir, stop() }；需要老師密碼的呼叫方（例如
 * e2e/load/http.mjs）應自行產生密碼、以 teacherPassword 選項傳入，密碼只留
 * 在自己的 process 記憶體中。
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

const SERVER_ENTRY = fileURLToPath(new URL('../../../server/dist/index.js', import.meta.url));
const READY_POLL_INTERVAL_MS = 150;
const LISTENING_PATTERN = /Server listening on (https?:\/\/\S+)/;

/** 截斷子程序 stderr 供錯誤訊息使用（不印出環境變數，密碼只存在 env）。 */
function tail(text, maxChars = 1000) {
  return text.length <= maxChars ? text : `…${text.slice(-maxChars)}`;
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

/** 輪詢 GET /api/health 直到 200；逾時或子程序先退出會明確報錯。 */
async function waitForHealthy(url, child, stderrBuffer, timeoutMs) {
  const { request } = await import('node:http');
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(
        `伺服器子程序在就緒前退出（exit ${child.exitCode}）：${tail(stderrBuffer.text)}`,
      );
    }
    const healthy = await new Promise((resolve) => {
      const req = request(new URL('/api/health', url), { agent: false }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode === 200));
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
    if (healthy) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `伺服器就緒逾時（${timeoutMs} ms 內 /api/health 未回 200）：${tail(stderrBuffer.text)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
}

/**
 * 啟動正式 build 的伺服器。
 * @param {{ teacherPassword?: string, readyTimeoutMs?: number }} [options]
 * @returns {Promise<{ url: string, port: number, dataDir: string, stop: () => Promise<void> }>}
 */
export async function startServer(options = {}) {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`找不到正式 build 產物 ${SERVER_ENTRY}；請先執行 npm run build。`);
  }

  const teacherPassword = options.teacherPassword ?? randomBytes(24).toString('base64url');
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;

  const dataDir = await mkdtemp(`${tmpdir()}/classroom-load-`);
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATA_DIR: dataDir,
      PORT: '0',
      TEACHER_PASSWORD: teacherPassword,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderrBuffer = { text: '' };
  child.stderr.on('data', (chunk) => {
    stderrBuffer.text += chunk.toString('utf8');
  });

  // 安全網：呼叫方忘記 stop 或當掉時，父程序結束也帶走子程序。
  const killOnParentExit = () => {
    child.kill('SIGKILL');
  };
  process.once('exit', killOnParentExit);

  let stopped = false;
  const stop = async () => {
    if (stopped) {
      return;
    }
    stopped = true;
    process.off('exit', killOnParentExit);
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      if (!(await waitForExit(child, 5000))) {
        child.kill('SIGKILL');
        await waitForExit(child, 5000);
      }
    }
    await rm(dataDir, { recursive: true, force: true });
  };

  try {
    const url = await new Promise((resolve, reject) => {
      let stdout = '';
      const timer = setTimeout(() => {
        reject(
          new Error(
            `伺服器啟動逾時（${readyTimeoutMs} ms 內未輸出監聽位址）：${tail(stderrBuffer.text)}`,
          ),
        );
      }, readyTimeoutMs);

      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`伺服器子程序在就緒前退出（exit ${code}）：${tail(stderrBuffer.text)}`));
      });
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
        const match = LISTENING_PATTERN.exec(stdout);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });

    await waitForHealthy(url, child, stderrBuffer, readyTimeoutMs);
    return { url, port: Number(new URL(url).port), dataDir, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
