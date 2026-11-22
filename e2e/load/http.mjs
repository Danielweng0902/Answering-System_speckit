#!/usr/bin/env node
/**
 * HTTP 固定到達率負載腳本。
 *
 * 三種情境：
 * 1. health：GET /api/health；
 * 2. join：POST /api/student/join；
 * 3. health-full-room：真實 Socket.IO 滿房作答洪流下的 health 探測。
 *
 * 預設只允許 loopback。遠端需明確 --allow-remote，且強制 HTTPS。
 * 正式伺服器、憑證與統計口徑與 socket.mjs 相同。
 */
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import console from 'node:console';
import process from 'node:process';
import { setTimeout } from 'node:timers';

import { startServer } from './lib/server.mjs';
import { createAgentForUrl, timedRequest } from './lib/httpClient.mjs';
import { summarizeSamples } from './lib/measure.mjs';
import { loginTeacher, createGroupViaTeacherSocket } from './lib/socketSetup.mjs';
import { createAnswerFlood } from './lib/socketLoad.mjs';
import { resolveTargetUrl } from './lib/targetSafety.mjs';

const FULL_ROOM_NOTE =
  'health 探測同時以 WebSocket 老師／投影／學生連線進行 answer:submit；背景作答同速率，未用 join 冒充作答壓力';
const JOIN_ONLY_NOTE =
  '量不到：--url attach 模式未提供 TEACHER_PASSWORD 環境變數，無法以老師 API 建立組別（join／滿房情境需要已存在的組別）';
const EMPTY_ROOM_NOTE = '量不到：--students 0 無法建立作答洪流';

function parseArgs(argv) {
  const options = {
    url: null,
    rates: [10, 25, 50],
    seconds: 120,
    warmupSeconds: 30,
    timeoutMs: 5000,
    students: 200,
    jsonPath: null,
    allowRemote: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`參數格式錯誤：${key}`);
    if (key === '--allow-remote') {
      options.allowRemote = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`參數 ${key} 缺少值`);
    index += 1;
    if (key === '--rate') {
      const rates = value.split(',').map((part) => Number(part.trim()));
      if (!rates.length || rates.some((rate) => !Number.isFinite(rate) || rate <= 0)) {
        throw new Error('--rate 需為正數或以逗號分隔的正數清單');
      }
      options.rates = rates;
    } else if (key === '--url') options.url = value.replace(/\/+$/, '');
    else if (key === '--json') options.jsonPath = value;
    else if (key === '--seconds') options.seconds = Number(value);
    else if (key === '--warmup') options.warmupSeconds = Number(value);
    else if (key === '--timeout-ms') options.timeoutMs = Number(value);
    else if (key === '--students') options.students = Number(value);
    else throw new Error(`不認識的參數 ${key}`);
  }
  if (
    !Number.isFinite(options.seconds) ||
    options.seconds <= 0 ||
    !Number.isFinite(options.warmupSeconds) ||
    options.warmupSeconds < 0 ||
    !Number.isFinite(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    !Number.isSafeInteger(options.students) ||
    options.students < 0
  ) {
    throw new Error('--seconds/--timeout-ms 需為正數，--warmup 不能為負，--students 須為非負整數');
  }
  if (options.url !== null) {
    const target = resolveTargetUrl(options.url, { allowRemote: options.allowRemote });
    options.url = `${target.origin}${target.pathname === '/' ? '' : target.pathname.replace(/\/+$/, '')}`;
  }
  return options;
}

const sleepUntil = (targetMonoMs) => {
  const remaining = targetMonoMs - performance.now();
  return remaining > 0
    ? new Promise((resolve) => setTimeout(resolve, remaining))
    : Promise.resolve();
};

function tallyOutcome(result, expectedStatus, counters) {
  counters.total += 1;
  if (result.error === 'timeout') counters.timeout += 1;
  else if (result.error === 'network' || result.statusCode !== expectedStatus) counters.error += 1;
  const key = result.error === 'timeout' ? 'timeout' : String(result.statusCode ?? 'network');
  counters.statusCounts[key] = (counters.statusCounts[key] ?? 0) + 1;
}

async function runArrivals({ rate, warmupSeconds, seconds, requestOnce, expectedStatus = 200 }) {
  const intervalMs = 1000 / rate;
  const warmupArrivals = Math.round(rate * warmupSeconds);
  const measuredArrivals = Math.round(rate * seconds);
  const samples = [];
  const counters = { total: 0, error: 0, timeout: 0, statusCounts: {} };
  const pending = [];
  const start = performance.now();

  for (let index = 0; index < warmupArrivals + measuredArrivals; index += 1) {
    await sleepUntil(start + index * intervalMs);
    const kept = index >= warmupArrivals;
    pending.push(
      requestOnce().then((result) => {
        if (kept) {
          samples.push(result.sample);
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

/**
 * 學生 token 以有限併發分配至各組。回傳的 token 只留在記憶體供正式 Socket.IO
 * 客戶端使用，不進 report、不寫檔。學生數低於 50 時，每組一名；高於 50 則輪流分配。
 */
async function joinFullRoomStudents(baseUrl, groupIds, students, agent, timeoutMs) {
  const tokensByGroup = groupIds.map(() => []);
  let nextIndex = 0;
  let failed = 0;
  const worker = async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= students) return;
      const groupIndex = index % groupIds.length;
      const result = await joinRequest(baseUrl, groupIds[groupIndex], agent, timeoutMs)();
      if (result.error !== null || result.statusCode !== 200) {
        failed += 1;
        continue;
      }
      try {
        const body = JSON.parse(result.body.toString('utf8'));
        if (typeof body.token !== 'string') throw new Error('token');
        tokensByGroup[groupIndex].push(body.token);
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(10, students) }, () => worker()));
  return {
    tokensByGroup,
    joined: tokensByGroup.reduce((total, tokens) => total + tokens.length, 0),
    failed,
  };
}

const formatMs = (value) => (value === null ? '量不到' : `${value.toFixed(2)}ms`);
const formatRate = (value) => (value === null ? '量不到' : `${(value * 100).toFixed(2)}%`);

function printScenario(entry) {
  const { summary, errorCount, errorRate, counters } = entry;
  console.log(
    `  門檻用全部樣本分位數（逾時以 ${entry.timeoutMs}ms 計）；completedOnly 另存僅完成樣本`,
  );
  console.log(
    `  樣本 ${summary.sampleCount}（完成 ${summary.successCount}、逾時 ${summary.timeoutCount}）` +
      ` 錯誤 ${errorCount} 錯誤率 ${formatRate(errorRate)} 逾時率 ${formatRate(summary.timeoutRate)}`,
  );
  console.log(
    `  p50 ${formatMs(summary.p50Ms)} p95 ${formatMs(summary.p95Ms)} p99 ${formatMs(summary.p99Ms)} max ${formatMs(summary.maxMs)}`,
  );
  console.log(`  狀態分佈 ${JSON.stringify(counters.statusCounts)}`);
}

function summarizeEntry(name, rate, options, agent, result, extra = {}) {
  const { samples, counters } = result;
  const summary = summarizeSamples(samples, { timeoutMs: options.timeoutMs });
  const entry = {
    name,
    rate,
    warmupSeconds: options.warmupSeconds,
    seconds: options.seconds,
    timeoutMs: options.timeoutMs,
    summary,
    errorCount: counters.error,
    errorRate: samples.length === 0 ? null : counters.error / samples.length,
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
  const report = {
    tool: 'e2e/load/http.mjs',
    node: process.version,
    startedAt: new Date().toISOString(),
    platform: process.platform,
    target: { mode: options.url === null ? 'managed' : 'attached', url: null },
    config: {
      rates: options.rates,
      seconds: options.seconds,
      warmupSeconds: options.warmupSeconds,
      timeoutMs: options.timeoutMs,
      students: options.students,
      allowRemote: options.allowRemote,
    },
    statistics: {
      thresholdBasis: '全部樣本；逾時以 timeoutMs 作為延遲下界',
      completedOnly: 'summary.completedOnly 另供對照，不用作門檻',
    },
    scenarios: [],
    skipped: [],
  };
  let server = null;
  let password = process.env.TEACHER_PASSWORD ?? null;
  if (options.url === null) {
    password = randomBytes(24).toString('base64url');
    server = await startServer({ teacherPassword: password });
    console.log(`伺服器已啟動：${server.url}（暫存資料 ${server.dataDir}）`);
  }
  const baseUrl = options.url ?? server.url;
  report.target.url = baseUrl;
  if (options.url !== null) {
    console.log(
      `量測既有伺服器：${baseUrl}（${options.allowRemote ? '已明確放行遠端' : 'loopback-only'}）`,
    );
  }

  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  let teacherCookie = null;
  let fullRoomTokens = [];
  let activeFlood = null;

  try {
    let groupIds = [];
    if (password !== null) {
      teacherCookie = await loginTeacher(baseUrl, password);
      password = null;
      const groupCount = options.students === 0 ? 1 : Math.min(50, Math.max(1, options.students));
      for (let index = 0; index < groupCount; index += 1) {
        groupIds.push(await createGroupViaTeacherSocket(baseUrl, teacherCookie));
      }
      console.log(`已用老師 API 建立 ${groupCount} 個量測組別`);
    } else {
      report.skipped.push({ name: 'join', reason: JOIN_ONLY_NOTE });
      report.skipped.push({ name: 'health-full-room', reason: JOIN_ONLY_NOTE });
      console.log(`\n${JOIN_ONLY_NOTE}`);
    }

    // token size 相同不會持續增長；滿房只在第三情境建立 Socket 連線。
    let prejoin = { joined: 0, failed: 0 };
    if (groupIds.length > 0 && options.students > 0) {
      const prejoinAgent = createAgentForUrl(baseUrl, { keepAlive: true, maxSockets: 10 });
      const joined = await joinFullRoomStudents(
        baseUrl,
        groupIds,
        options.students,
        prejoinAgent,
        options.timeoutMs,
      );
      prejoinAgent.destroy();
      prejoin = { joined: joined.joined, failed: joined.failed };
      fullRoomTokens = joined.tokensByGroup;
      console.log(`滿房已加入 ${prejoin.joined} 名學生（失敗 ${prejoin.failed}）`);
      if (prejoin.failed > 0 || prejoin.joined !== options.students) {
        throw new Error('滿房學生加入未完成，拒絕產生看似完整實不足的數字');
      }
    }

    for (const rate of options.rates) {
      if (interrupted) break;
      const healthAgent = createAgentForUrl(baseUrl, { keepAlive: true, maxSockets: 512 });
      const health = await runArrivals({
        rate,
        warmupSeconds: options.warmupSeconds,
        seconds: options.seconds,
        requestOnce: healthRequest(baseUrl, healthAgent, options.timeoutMs),
      });
      report.scenarios.push(summarizeEntry('health', rate, options, healthAgent, health));
      if (groupIds.length === 0 || interrupted) continue;

      const joinAgent = createAgentForUrl(baseUrl, { keepAlive: true, maxSockets: 512 });
      const joined = await runArrivals({
        rate,
        warmupSeconds: options.warmupSeconds,
        seconds: options.seconds,
        requestOnce: joinRequest(baseUrl, groupIds[0], joinAgent, options.timeoutMs),
      });
      report.scenarios.push(summarizeEntry('join', rate, options, joinAgent, joined));

      if (interrupted) continue;
      if (options.students === 0) {
        report.skipped.push({ name: 'health-full-room', rate, reason: EMPTY_ROOM_NOTE });
        continue;
      }
      activeFlood = await createAnswerFlood({
        baseUrl,
        teacherCookie,
        groupIds,
        studentTokensByGroup: fullRoomTokens,
        questionCount: 20,
        rateTimeoutMs: options.timeoutMs,
      });
      const roomAgent = createAgentForUrl(baseUrl, { keepAlive: true, maxSockets: 512 });
      try {
        const [probe, backgroundAnswers] = await Promise.all([
          runArrivals({
            rate,
            warmupSeconds: options.warmupSeconds,
            seconds: options.seconds,
            requestOnce: healthRequest(baseUrl, roomAgent, options.timeoutMs),
          }),
          activeFlood.run({ rate, warmupSeconds: options.warmupSeconds, seconds: options.seconds }),
        ]);
        report.scenarios.push(
          summarizeEntry('health-full-room', rate, options, roomAgent, probe, {
            prejoin,
            backgroundAnswers,
            note: FULL_ROOM_NOTE,
          }),
        );
        console.log(
          `  作答洪流：${backgroundAnswers.counters.total} 筆；錯誤 ${backgroundAnswers.counters.error}；逾時 ${backgroundAnswers.counters.timeout}`,
        );
      } finally {
        activeFlood.close();
        activeFlood = null;
      }
    }

    report.finishedAt = new Date().toISOString();
    if (options.jsonPath !== null) {
      const json = `${JSON.stringify(report, null, 2)}\n`;
      if (/"(?:password|token|authorization)"\s*:/i.test(json)) {
        throw new Error('拒絕寫出疑似含憑證欄位的 JSON');
      }
      await writeFile(options.jsonPath, json, 'utf8');
      console.log(`\n結果已寫入 ${options.jsonPath}（不含密碼與 token）`);
    }
    if (interrupted) console.log('\n收到中斷訊號，提前結束。');
  } finally {
    activeFlood?.close();
    fullRoomTokens = [];
    teacherCookie = null;
    if (server !== null) {
      await server.stop();
      console.log('量測用伺服器已停止，暫存資料已刪除。');
    }
  }
}

main().catch((error) => {
  console.error(`負載腳本失敗：${error.message}`);
  process.exitCode = 1;
});
