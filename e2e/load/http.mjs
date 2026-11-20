#!/usr/bin/env node
/**
 * HTTP 負載腳本（固定到達率，開放迴路排程）。
 *
 * 用法：
 *   node e2e/load/http.mjs --rate 25 --seconds 10 --warmup 2 --students 20
 *   node e2e/load/http.mjs --rate 10,25,50 --seconds 120 --json results.json
 *   node e2e/load/http.mjs --url http://127.0.0.1:3000 --rate 25 --seconds 10
 *
 * 三種情境（每個 rate 各跑一次、各自有暖身與量測視窗）：
 * 1. health：GET /api/health，固定到達率。
 * 2. join：POST /api/student/join 對已存在的組別；組別由老師 API
 *    （/api/teacher/login + Socket.IO group:create）在量測前建立。
 * 3. health-full-room：滿房情境下用 health 探測事件迴圈。本輪尚無 Socket.IO
 *    作答負載腳本，因此「滿房作答」以「預先加入 --students 名學生＋同速率
 *    背景 join 流量」替代，量測值只有 health 探測；此限制會印出並寫入 JSON。
 *
 * 未加 --url 時由本腳本啟動全新的正式 build 伺服器（lib/server.mjs），
 * 老師密碼在記憶體中隨機產生；--url attach 模式需要 TEACHER_PASSWORD
 * 環境變數才能跑情境 2、3，否則這兩個情境標記「量不到」並說明原因。
 * 任何輸出（console、JSON）都不包含密碼或 token。
 */
import { Agent } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import console from 'node:console';
import process from 'node:process';
import { setTimeout } from 'node:timers';

import { startServer } from './lib/server.mjs';
import { timedRequest } from './lib/httpClient.mjs';
import { summarizeSamples } from './lib/measure.mjs';
import { loginTeacher, createGroupViaTeacherSocket } from './lib/socketSetup.mjs';

const FULL_ROOM_NOTE =
  '本輪尚無 Socket.IO 作答負載；情境三以預先加入學生＋同速率背景 join 流量代替「滿房作答」，health 延遲尚未反映真實作答壓力';
const JOIN_ONLY_NOTE =
  '量不到：--url attach 模式未提供 TEACHER_PASSWORD 環境變數，無法以老師 API 建立組別（join／滿房情境需要已存在的組別）';

function parseArgs(argv) {
  const options = {
    url: null,
    rates: [10, 25, 50],
    seconds: 120,
    warmupSeconds: 30,
    timeoutMs: 5000,
    students: 200,
    jsonPath: null,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (value === undefined || !key.startsWith('--')) {
      throw new Error(`參數格式錯誤：${key}（每個 --參數都需要一個值）`);
    }
    if (key === '--rate') {
      const rates = value.split(',').map((part) => Number(part.trim()));
      if (rates.length === 0 || rates.some((rate) => !Number.isFinite(rate) || rate <= 0)) {
        throw new Error(`--rate 需為正數或以逗號分隔的正數清單：${value}`);
      }
      options.rates = rates;
    } else if (key === '--url') {
      options.url = value.replace(/\/+$/, '');
    } else if (key === '--json') {
      options.jsonPath = value;
    } else if (key === '--seconds') {
      options.seconds = Number(value);
    } else if (key === '--warmup') {
      options.warmupSeconds = Number(value);
    } else if (key === '--timeout-ms') {
      options.timeoutMs = Number(value);
    } else if (key === '--students') {
      options.students = Number(value);
    } else {
      throw new Error(`不認識的參數 ${key}`);
    }
  }
  if (
    options.seconds <= 0 ||
    options.warmupSeconds < 0 ||
    options.timeoutMs <= 0 ||
    options.students < 0
  ) {
    throw new Error('--seconds/--timeout-ms 需為正數，--warmup/--students 不得為負數');
  }
  return options;
}

function sleepUntil(targetMonoMs) {
  const remaining = targetMonoMs - performance.now();
  return remaining > 0
    ? new Promise((resolve) => setTimeout(resolve, remaining))
    : Promise.resolve();
}

/** 累計單次請求結果：錯誤＝連線失敗或非預期狀態碼；逾時另外統計。 */
function tallyOutcome(result, expectedStatus, counters) {
  counters.total += 1;
  if (result.error === 'timeout') {
    counters.timeout += 1;
  } else if (result.error === 'network' || result.statusCode !== expectedStatus) {
    counters.error += 1;
  }
  const key = result.error === 'timeout' ? 'timeout' : String(result.statusCode ?? 'network');
  counters.statusCounts[key] = (counters.statusCounts[key] ?? 0) + 1;
}

/**
 * 固定到達率排程：第 i 個到達排在 start + i × (1000/rate)，以絕對時間
 * sleep 校正 setTimeout 漂移；來不及送出時立即補送（catch-up，不跳過）。
 * 回應一律等到結束（含逾時 destroy）才彙整，避免視窗結尾的在途請求漏計。
 */
async function runArrivals({
  rate,
  warmupSeconds,
  seconds,
  requestOnce,
  expectedStatus = 200,
  measured = true,
}) {
  const intervalMs = 1000 / rate;
  const warmupArrivals = Math.round(rate * warmupSeconds);
  const measuredArrivals = Math.round(rate * seconds);
  const total = warmupArrivals + measuredArrivals;
  const samples = [];
  const counters = { total: 0, error: 0, timeout: 0, statusCounts: {} };
  const pending = [];
  const start = performance.now();

  for (let i = 0; i < total; i += 1) {
    await sleepUntil(start + i * intervalMs);
    const kept = measured && i >= warmupArrivals;
    pending.push(
      requestOnce().then((result) => {
        if (kept) {
          samples.push(result.sample);
        }
        // 量測通道只統計量測視窗；背景通道（measured=false）統計全部到達。
        if (measured ? kept : true) {
          tallyOutcome(result, expectedStatus, counters);
        }
      }),
    );
  }
  await Promise.allSettled(pending);
  return { samples, counters };
}

function healthRequest(baseUrl, agent, timeoutMs) {
  return () => timedRequest({ url: `${baseUrl}/api/health`, agent, timeoutMs });
}

function joinRequest(baseUrl, groupId, agent, timeoutMs) {
  return () =>
    timedRequest({
      url: `${baseUrl}/api/student/join`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId }),
      agent,
      timeoutMs,
    });
}

/** 滿房前置：以有限併發（10）預先加入學生；這是設定，不納入量測樣本。 */
async function prejoinStudents(baseUrl, groupId, students, agent, timeoutMs) {
  const request = joinRequest(baseUrl, groupId, agent, timeoutMs);
  let remaining = students;
  let joined = 0;
  let failed = 0;
  const worker = async () => {
    while (remaining > 0) {
      remaining -= 1;
      const result = await request();
      if (result.error === null && result.statusCode === 200) {
        joined += 1;
      } else {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(10, students) }, worker));
  return { joined, failed };
}

function formatMs(value) {
  return value === null ? '量不到' : `${value.toFixed(2)}ms`;
}

function formatRate(value) {
  return value === null ? '量不到' : `${(value * 100).toFixed(1)}%`;
}

function printScenario(entry) {
  const { summary, errorCount, errorRate, counters } = entry;
  console.log(
    `  樣本 ${summary.sampleCount}（完成 ${summary.successCount}、逾時 ${summary.timeoutCount}）` +
      `  錯誤 ${errorCount}  錯誤率 ${formatRate(errorRate)}  逾時率 ${formatRate(summary.timeoutRate)}`,
  );
  console.log(
    `  p50 ${formatMs(summary.p50Ms)}  p95 ${formatMs(summary.p95Ms)}` +
      `  p99 ${formatMs(summary.p99Ms)}  max ${formatMs(summary.maxMs)}`,
  );
  console.log(`  狀態分佈 ${JSON.stringify(counters.statusCounts)}`);
}

function summarizeEntry(name, rate, options, agent, result, extra = {}) {
  const { samples, counters } = result;
  const summary = summarizeSamples(samples);
  const errorRate = samples.length === 0 ? null : counters.error / samples.length;
  const entry = {
    name,
    rate,
    warmupSeconds: options.warmupSeconds,
    seconds: options.seconds,
    timeoutMs: options.timeoutMs,
    summary,
    errorCount: counters.error,
    errorRate,
    counters,
    ...extra,
  };
  console.log(`\n[${name}] rate=${rate}/s 暖身 ${options.warmupSeconds}s 量測 ${options.seconds}s`);
  printScenario(entry);
  agent.destroy();
  return entry;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const report = {
    tool: 'e2e/load/http.mjs',
    node: process.version,
    startedAt: startedAt.toISOString(),
    platform: process.platform,
    target: { mode: options.url === null ? 'managed' : 'attached', url: null },
    config: {
      rates: options.rates,
      seconds: options.seconds,
      warmupSeconds: options.warmupSeconds,
      timeoutMs: options.timeoutMs,
      students: options.students,
    },
    scenarios: [],
    skipped: [],
  };

  let server = null;
  // 密碼只在這個 process 記憶體與子程序環境變數，不寫檔、不印出。
  // 由 http.mjs 產生並傳入 startServer，才能再向 /api/teacher/login 換 token。
  let password = null;
  if (options.url === null) {
    password = randomBytes(24).toString('base64url');
    server = await startServer({ teacherPassword: password });
    console.log(`伺服器已啟動：${server.url}（暫存資料 ${server.dataDir}）`);
  } else {
    // attach 模式由環境變數提供老師密碼（與既有伺服器設定相同）。
    password = process.env.TEACHER_PASSWORD ?? null;
    console.log(`量測既有伺服器：${options.url}`);
  }
  const baseUrl = options.url ?? server.url;
  report.target.url = baseUrl;

  const stopServer = async () => {
    if (server !== null) {
      await server.stop();
      server = null;
    }
  };
  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    console.log(
      `排程：rate=${options.rates.join(',')}/s、暖身 ${options.warmupSeconds}s、` +
        `量測 ${options.seconds}s、單次請求逾時 ${options.timeoutMs}ms`,
    );

    let groupId = null;
    if (password !== null) {
      const token = await loginTeacher(baseUrl, password);
      password = null; // 只要換到 token 就丟棄密碼參照。
      groupId = await createGroupViaTeacherSocket(baseUrl, token);
      console.log('已用老師 API 建立量測用組別（join 情境使用此已存在組別）');
    } else {
      report.skipped.push({ name: 'join', reason: JOIN_ONLY_NOTE });
      report.skipped.push({ name: 'health-full-room', reason: JOIN_ONLY_NOTE });
      console.log(`\n${JOIN_ONLY_NOTE}`);
    }

    for (const rate of options.rates) {
      if (interrupted) break;
      const agent = new Agent({ keepAlive: true, maxSockets: 512 });
      const health = await runArrivals({
        rate,
        warmupSeconds: options.warmupSeconds,
        seconds: options.seconds,
        requestOnce: healthRequest(baseUrl, agent, options.timeoutMs),
      });
      report.scenarios.push(summarizeEntry('health', rate, options, agent, health));

      if (groupId !== null && !interrupted) {
        const joinAgent = new Agent({ keepAlive: true, maxSockets: 512 });
        const join = await runArrivals({
          rate,
          warmupSeconds: options.warmupSeconds,
          seconds: options.seconds,
          requestOnce: joinRequest(baseUrl, groupId, joinAgent, options.timeoutMs),
        });
        report.scenarios.push(summarizeEntry('join', rate, options, joinAgent, join));

        if (!interrupted) {
          const roomAgent = new Agent({ keepAlive: true, maxSockets: 512 });
          const prejoin = await prejoinStudents(
            baseUrl,
            groupId,
            options.students,
            roomAgent,
            options.timeoutMs,
          );
          console.log(
            `\n[health-full-room] 已預先加入 ${prejoin.joined} 名學生（失敗 ${prejoin.failed}）`,
          );
          const [probe, background] = await Promise.all([
            runArrivals({
              rate,
              warmupSeconds: options.warmupSeconds,
              seconds: options.seconds,
              requestOnce: healthRequest(baseUrl, roomAgent, options.timeoutMs),
            }),
            // 背景 join 流量：製造寫入壓力，不納入 health 探測的樣本。
            runArrivals({
              rate,
              warmupSeconds: options.warmupSeconds,
              seconds: options.seconds,
              requestOnce: joinRequest(baseUrl, groupId, roomAgent, options.timeoutMs),
              measured: false,
            }),
          ]);
          report.scenarios.push(
            summarizeEntry('health-full-room', rate, options, roomAgent, probe, {
              prejoin,
              backgroundJoins: background.counters,
              note: FULL_ROOM_NOTE,
            }),
          );
          console.log(`  註：${FULL_ROOM_NOTE}`);
        }
      }
    }

    report.finishedAt = new Date().toISOString();
    if (options.jsonPath !== null) {
      await writeFile(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      console.log(`\n結果已寫入 ${options.jsonPath}（不含密碼與 token）`);
    }
    if (interrupted) {
      console.log('\n收到中斷訊號，提前結束；已完成的量測仍保留。');
    }
  } finally {
    const wasManaged = options.url === null;
    await stopServer();
    if (wasManaged) {
      console.log('量測用伺服器已停止，暫存資料已刪除。');
    }
  }
}

main().catch((error) => {
  console.error(`負載腳本失敗：${error.message}`);
  process.exitCode = 1;
});
