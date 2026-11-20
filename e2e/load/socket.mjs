#!/usr/bin/env node
/**
 * Socket.IO 負載與資源量測入口。
 *
 * 用法：
 *   node e2e/load/socket.mjs --groups 50 --questions 20 --rounds 10
 *   node e2e/load/socket.mjs --transport websocket --groups 5 --questions 3 --rounds 1
 *   node e2e/load/socket.mjs --url http://127.0.0.1:3000 --server-pid 1234 \
 *     --transport polling --groups 5 --questions 3 --rounds 1
 *
 * 不指定 --url 時，每種 transport 各自啟動一次全新的正式 build 伺服器。
 * attach 模式需 TEACHER_PASSWORD；CPU/RSS 還需 --server-pid。
 * 預設只允許 loopback；遠端要 --allow-remote，且只准 HTTPS。
 */
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import console from 'node:console';

import { startServer } from './lib/server.mjs';
import { runSocketLoad } from './lib/socketLoad.mjs';
import { resolveTargetUrl } from './lib/targetSafety.mjs';

function positiveNumber(value, name, { integer = false, allowZero = false } = {}) {
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    (integer && !Number.isInteger(number)) ||
    (allowZero ? number < 0 : number <= 0)
  ) {
    throw new Error(`${name} 需為${allowZero ? '非負' : '正'}${integer ? '整數' : '數'}：${value}`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    url: null,
    serverPid: null,
    transport: null,
    groups: 50,
    questions: 20,
    rounds: 10,
    timeoutMs: 5000,
    burstIntervalMs: 250,
    cooldownSeconds: 60,
    jsonPath: null,
    allowRemote: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) {
      throw new Error(`參數格式錯誤：${key}`);
    }
    if (key === '--allow-remote') {
      options.allowRemote = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`參數 ${key} 缺少值`);
    }
    index += 1;
    if (key === '--url') options.url = value.replace(/\/+$/, '');
    else if (key === '--server-pid')
      options.serverPid = positiveNumber(value, key, { integer: true });
    else if (key === '--transport') options.transport = value;
    else if (key === '--groups') options.groups = positiveNumber(value, key, { integer: true });
    else if (key === '--questions')
      options.questions = positiveNumber(value, key, { integer: true });
    else if (key === '--rounds') options.rounds = positiveNumber(value, key, { integer: true });
    else if (key === '--timeout-ms') options.timeoutMs = positiveNumber(value, key);
    else if (key === '--burst-interval-ms')
      options.burstIntervalMs = positiveNumber(value, key, { allowZero: true });
    else if (key === '--cooldown-seconds')
      options.cooldownSeconds = positiveNumber(value, key, { allowZero: true });
    else if (key === '--json') options.jsonPath = value;
    else throw new Error(`不認識的參數 ${key}`);
  }
  if (options.groups < 2) {
    throw new Error('公平順位「第二組晚到勝出」需要至少 2 組，請設 --groups 2 以上');
  }
  if (options.transport !== null && !['websocket', 'polling', 'both'].includes(options.transport)) {
    throw new Error('--transport 需為 websocket、polling 或 both');
  }
  if (options.url !== null && options.transport === 'both') {
    throw new Error('attach 模式一次只能跑一種 transport，請指定 --transport websocket 或 polling');
  }
  if (options.url !== null) {
    const target = resolveTargetUrl(options.url, { allowRemote: options.allowRemote });
    options.url = `${target.origin}${target.pathname === '/' ? '' : target.pathname.replace(/\/+$/, '')}`;
  }
  return options;
}

function formatMs(value) {
  return value === null || value === undefined ? '量不到' : `${value.toFixed(2)}ms`;
}

function formatPercent(value) {
  return value === null || value === undefined ? '量不到' : `${(value * 100).toFixed(2)}%`;
}

function printSubmissionScenario(name, entry) {
  console.log(
    `\n[${name}] 合法送出規劃 ${entry.plannedSubmissions ?? entry.submissionCount} 筆；實際 ${entry.submissionCount} 筆`,
  );
  for (const [channel, label] of [
    ['ack', '送出→ACK'],
    ['necessaryState', '送出→四路必要 state（合計）'],
    ['senderState', '送出者'],
    ['peerState', '同組成員'],
    ['teacherState', '老師'],
    ['projectorState', '投影'],
  ]) {
    const summary = entry[channel];
    console.log(
      `  ${label}: p50=${formatMs(summary.p50Ms)} p95=${formatMs(summary.p95Ms)} p99=${formatMs(summary.p99Ms)} max=${formatMs(summary.maxMs)}；樣本 ${summary.sampleCount}；逾時 ${formatPercent(summary.timeoutRate)}`,
    );
  }
  console.log(
    `  命令錯誤 ${entry.commandErrorCount}（${formatPercent(entry.commandErrorRate)}）；漏送 ${entry.missingDeliveryCount}；越權 ${entry.unauthorizedCount}；錯誤順位 ${entry.wrongRankingCount ?? '未評估'}`,
  );
}

function printReport(report) {
  console.log(`\n=== ${report.transportMode} ===`);
  console.log(
    `握手→首份合法 state：p95=${formatMs(report.handshakes.initial.summary.p95Ms)} p99=${formatMs(report.handshakes.initial.summary.p99Ms)}`,
  );
  printSubmissionScenario('冷啟搶答', report.scenarios.coldSubmissions);
  printSubmissionScenario('公平順位', {
    ...report.scenarios.fairness,
    wrongRankingCount: report.scenarios.fairness.wrongRankingCount,
  });
  printSubmissionScenario('四空長答案', report.scenarios.longAnswers);
  printSubmissionScenario('作廢後重送', {
    ...report.scenarios.voidResend,
    wrongRankingCount: '未評估',
  });
  const reconnect = report.scenarios.reconnect.state;
  console.log(
    `\n[1,000 筆後重連] p95=${formatMs(reconnect.p95Ms)} p99=${formatMs(reconnect.p99Ms)}；樣本 ${reconnect.sampleCount}；逾時 ${formatPercent(reconnect.timeoutRate)}`,
  );
  const closed = report.scenarios.countdown.allRoles;
  console.log(
    `\n[倒數到期] p95=${formatMs(closed.p95Ms)} p99=${formatMs(closed.p99Ms)}；樣本 ${closed.sampleCount}；逾時 ${closed.timeoutCount}`,
  );
  const switching = report.handshakes.switch.leaveToNewIdentity;
  console.log(
    `\n[leave→下一輪正確身分] p95=${formatMs(switching.p95Ms)} p99=${formatMs(switching.p99Ms)}；樣本 ${switching.sampleCount}`,
  );
  if (report.resources?.available) {
    console.log(
      `\n資源：穩態 CPU=${report.resources.steadyCpuPercent?.toFixed(2) ?? '量不到'}%；` +
        `每秒 CPU p95=${report.resources.cpuP95Percent?.toFixed(2) ?? '量不到'}% max=${report.resources.cpuMaxPercent?.toFixed(2) ?? '量不到'}%；` +
        `RSS 暖身 ${report.resources.warmupRssBytes} B → 停止後 ${report.resources.endRssBytes} B；增幅 ${formatPercent(report.resources.rssGrowthRatio)}`,
    );
  } else {
    console.log(`\n資源：量不到（${report.resources?.reason ?? '未知原因'}）`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const modes =
    options.transport === 'both' || (options.transport === null && options.url === null)
      ? ['websocket', 'polling']
      : [options.transport ?? 'websocket'];
  const report = {
    tool: 'e2e/load/socket.mjs',
    node: process.version,
    platform: process.platform,
    targetMode: options.url === null ? 'managed' : 'attached',
    config: { ...options, serverPidProvided: options.serverPid !== null, serverPid: undefined },
    statistics: {
      thresholdBasis: '全部樣本；逾時以 timeoutMs 作為延遲下界',
      note: 'summary.completedOnly 另供對照，不用作門檻；3 秒公平順位提醒不作必要送達',
    },
    runs: [],
  };

  for (const transportMode of modes) {
    let server = null;
    let password = process.env.TEACHER_PASSWORD ?? null;
    if (options.url === null) {
      password = randomBytes(24).toString('base64url');
      server = await startServer({ teacherPassword: password });
      console.log(`正式伺服器已啟動：${server.url}（${transportMode}，PID ${server.pid}）`);
    } else if (password === null) {
      throw new Error('attach 模式需要 TEACHER_PASSWORD 環境變數（不會輸出或落盤）');
    }
    try {
      const result = await runSocketLoad({
        baseUrl: options.url ?? server.url,
        password,
        serverPid: options.serverPid ?? server?.pid ?? null,
        transportMode,
        groups: options.groups,
        questions: options.questions,
        rounds: options.rounds,
        timeoutMs: options.timeoutMs,
        burstIntervalMs: options.burstIntervalMs,
        cooldownSeconds: options.cooldownSeconds,
        log: (message) => console.log(message),
      });
      report.runs.push(result);
      printReport(result);
    } finally {
      password = null;
      if (server !== null) {
        await server.stop();
        console.log(`量測用伺服器已停止（${transportMode}），暫存資料已刪除。`);
      }
    }
  }

  if (options.jsonPath !== null) {
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (/(?:"(?:password|token|authorization)"\s*:)/i.test(json)) {
      throw new Error('拒絕寫出疑似含憑證欄位的 JSON');
    }
    await writeFile(options.jsonPath, json, 'utf8');
    console.log(`\n結果已寫入 ${options.jsonPath}（不含密碼與 token）`);
  }
}

main().catch((error) => {
  console.error(`Socket.IO 負載腳本失敗：${error.message}`);
  process.exitCode = 1;
});
