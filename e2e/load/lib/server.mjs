/**
 * 正式 build 伺服器的生命週期管理（e2e/load 用）。
 *
 * 每次 startServer：
 * - 以子程序啟動 `node server/dist/index.js`（正式 build，不是 tsx）；
 * - 使用新的暫存資料夾（DATA_DIR）與全新的 SQLite 檔；
 * - PORT 固定傳 0 讓作業系統挑可用 port，實際 port 從 stdout 解析；
 * - TEACHER_PASSWORD 只經環境變數傳遞，不寫檔、不印出；
 * - 正常 stop、未預期 exit、SIGINT、SIGTERM 都會終止子程序並刪暫存目錄。
 *
 * SIGKILL 無法捕捉，不能保證即時清孤兒；每個 DATA_DIR 的 load-owner.json
 * 記錄父／子 PID（只有數字 PID，不含 token 或密碼），下次啟動會清掉
 * 超過 staleAgeMs、且父程序已不存在的孤兒。活躍父程序的舊目錄不會誤刪。
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

const SERVER_ENTRY = fileURLToPath(new URL('../../../server/dist/index.js', import.meta.url));
const READY_POLL_INTERVAL_MS = 150;
const LISTENING_PATTERN = /Server listening on (https?:\/\/\S+)/;
const DATA_DIR_PREFIX = 'classroom-load-';
const OWNER_FILENAME = 'load-owner.json';
const DEFAULT_STALE_AGE_MS = 30 * 60 * 1000;

function tail(text, maxChars = 1000) {
  return text.length <= maxChars ? text : `…${text.slice(-maxChars)}`;
}

function validPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0;
}

function isProcessAlive(pid) {
  if (!validPid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateProcess(pid, signal) {
  if (!validPid(pid)) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * 清理逾期的 classroom-load-* 目錄。只有父 PID 已不活躍才判定孤兒；
 * 子 PID 仍活著時先送 SIGTERM。測試可注入 PID 檢查與終止函式，避免碰真程序。
 */
export async function cleanupStaleLoadDirs({
  root = tmpdir(),
  olderThanMs = DEFAULT_STALE_AGE_MS,
  currentTimeMs = Date.now(),
  isProcessAlive: alive = isProcessAlive,
  terminateProcess: terminate = terminateProcess,
} = {}) {
  const removed = [];
  const failed = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { removed, failed };
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(DATA_DIR_PREFIX)) continue;
    const dataDir = join(root, entry.name);
    try {
      const info = await stat(dataDir);
      if (currentTimeMs - info.mtimeMs <= olderThanMs) continue;

      let owner = null;
      try {
        owner = JSON.parse(await readFile(join(dataDir, OWNER_FILENAME), 'utf8'));
      } catch {
        // 舊版可能沒有 owner marker；仍在逾時後清暫存資料，但不亂猜該殺哪個 PID。
      }
      if (validPid(owner?.parentPid) && alive(owner.parentPid)) continue;
      if (validPid(owner?.childPid) && alive(owner.childPid)) {
        terminate(owner.childPid, 'SIGTERM');
      }
      await rm(dataDir, { recursive: true, force: true });
      removed.push(dataDir);
    } catch (error) {
      failed.push({ dataDir, reason: error.code ?? 'UNKNOWN' });
    }
  }
  return { removed, failed };
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

/** 輪詢 GET /api/health 直到 200；managed 模式只會產生本機 HTTP URL。 */
async function waitForHealthy(url, child, stderrBuffer, timeoutMs) {
  const { request } = await import('node:http');
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `伺服器子程序在就緒前退出（exit ${child.exitCode}，signal ${child.signalCode}）：${tail(stderrBuffer.text)}`,
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
    if (healthy) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `伺服器就緒逾時（${timeoutMs} ms 內 /api/health 未回 200）：${tail(stderrBuffer.text)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
}

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

/**
 * 啟動正式 build 的伺服器。
 * @param {{ teacherPassword?: string, readyTimeoutMs?: number, cleanupStale?: boolean }} [options]
 */
export async function startServer(options = {}) {
  if (options.cleanupStale !== false) {
    await cleanupStaleLoadDirs();
  }
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`找不到正式 build 產物 ${SERVER_ENTRY}；請先執行 npm run build。`);
  }

  const teacherPassword = options.teacherPassword ?? randomBytes(24).toString('base64url');
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
  const dataDir = await mkdtemp(join(tmpdir(), DATA_DIR_PREFIX));
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATA_DIR: dataDir,
      PORT: '0',
      // 壓測伺服器只綁 loopback（B4）。
      //
      // 產品端預設綁「所有介面」（課堂內學生要連得到），但壓測期間
      // 這台機器不需要被同網段的任何人連到 —— 反而是量測時被打到
      // 會污染結果。managed 模式只在本機量測，所以明確綁 127.0.0.1。
      HOST: '127.0.0.1',
      TEACHER_PASSWORD: teacherPassword,
      // 壓測工具量的是**伺服器本身的容量**，不是速率限制的行為：它會用單一
      // 來源送出上萬次 join，會把正常的進場節流（預設 burst 600／分鐘 30）
      // 全部打成 429，量到的就是限流而不是容量。因此在壓測用的伺服器上
      // 把進場限流關閉（0 = 不限制）；限流本身另有單元與整合測試涵蓋。
      JOIN_RATE_LIMIT_BURST: '0',
      JOIN_RATE_LIMIT_PER_MINUTE: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderrBuffer = { text: '' };
  child.stderr.on('data', (chunk) => {
    stderrBuffer.text += chunk.toString('utf8');
  });
  try {
    await writeFile(
      join(dataDir, OWNER_FILENAME),
      `${JSON.stringify({ parentPid: process.pid, childPid: child.pid })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  } catch (error) {
    terminateProcess(child.pid, 'SIGKILL');
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }

  let stopPromise = null;
  let cleaned = false;
  const removeCleanupHooks = () => {
    process.off('exit', killOnParentExit);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  };
  const killOnParentExit = () => {
    if (child.exitCode === null && child.signalCode === null) {
      terminateProcess(child.pid, 'SIGKILL');
    }
    if (!cleaned) {
      cleaned = true;
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
  const onSignal = (signal) => {
    // stop() 冪等；即使負載主腳本也收到同一訊號，仍由這裡保證完整清理。
    void stop().finally(() => {
      process.exit(SIGNAL_EXIT_CODES[signal]);
    });
  };
  const onSigint = () => onSignal('SIGINT');
  const onSigterm = () => onSignal('SIGTERM');

  const stop = () => {
    stopPromise ??= (async () => {
      removeCleanupHooks();
      if (child.exitCode === null && child.signalCode === null) {
        terminateProcess(child.pid, 'SIGTERM');
        if (!(await waitForExit(child, 5000))) {
          terminateProcess(child.pid, 'SIGKILL');
          await waitForExit(child, 5000);
        }
      }
      await rm(dataDir, { recursive: true, force: true });
      cleaned = true;
    })();
    return stopPromise;
  };

  process.once('exit', killOnParentExit);
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

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
    if (!validPid(child.pid)) {
      await stop();
      throw new Error('伺服器子程序沒有可用 PID');
    }
    return { url, port: Number(new URL(url).port), pid: child.pid, dataDir, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
