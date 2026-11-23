/**
 * Socket.IO 負載量測核心。
 *
 * 作答與 state 的配對不依賴封包先後：
 * - 學生用 groupId＋題號＋完整答案陣列配對自己的 state；
 * - 老師用看板 cell 的相同三項配對，取得全域作答 revision；
 * - 投影不應含未揭曉答案，因此只接受老師已配對的同一個 revision；
 * - 已配對過的同 revision 快照視為重複通知（含公平順位 3 秒提醒），
 *   不得再次寫入送達樣本。
 *
 * 這個模組不輸出任何 token、密碼或 Socket.IO auth 內容。
 */
import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { io as createSocketIOClient } from 'socket.io-client';

import { postJson, timedRequest } from './httpClient.mjs';
import { percentile, summarizeSamples } from './measure.mjs';
import { createGroupViaTeacherSocket, loginTeacher } from './socketSetup.mjs';

const execFileAsync = promisify(execFile);

/**
 * 作答事件的「必要 state 收件者」：送出者、同組成員、老師。
 *
 * **投影不是必要收件者**：2026-11-21 起作答事件不再推給投影連線（推了也會因為
 * revision 不跳動而被前端忽略，而且會洩漏「全場作答次數與時機」）。
 * 投影的送達情形仍然另外記錄（projectorState），只是不列入「必要」。
 */
const CHANNELS = ['senderState', 'peerState', 'teacherState'];

function answerKey(groupId, questionNumber, answers) {
  return JSON.stringify([groupId, questionNumber, answers]);
}

/** 第一份合法 state 的身分檢查；revision 是非負有限整數。 */
export function isValidRoleState(state, expected) {
  if (
    state === null ||
    typeof state !== 'object' ||
    state.role !== expected.role ||
    !Number.isInteger(state.revision) ||
    state.revision < 0
  ) {
    return false;
  }
  if (expected.role === 'student') {
    return typeof state.myGroupId === 'string' && state.myGroupId === expected.groupId;
  }
  return true;
}

/** 一般答案：把情境／輪次／組別／空格標記帶入內容，讓配對不會靠順序猜測。 */
export function createAnswers(marker, blankCount) {
  return Array.from({ length: blankCount }, (_value, index) => `回答-${marker}-空${index + 1}`);
}

/** 四空長答案負載：每空恰好 200 個 Unicode code point（不是 UTF-16 長度）。 */
export function createLongAnswers(marker) {
  return Array.from({ length: 4 }, (_value, index) => {
    const prefix = `負載-${marker}-第${index + 1}空🙂`;
    return `${prefix}${'答'.repeat(Math.max(0, 200 - Array.from(prefix).length))}`;
  });
}

/** WebSocket only 與固定 HTTP long-polling；兩者不混用，才能分開比較。 */
export function transportsForMode(mode) {
  if (mode === 'websocket') {
    return ['websocket'];
  }
  if (mode === 'polling') {
    return ['polling'];
  }
  throw new Error(`未知的 Socket.IO transport 模式：${mode}`);
}

/**
 * 將每秒資源樣本彙整。CPU 穩態值用暖身結束到停止負載的「累計 CPU 秒差
 * ÷ 牆鐘秒差」，避免把 ps 的一生平均誤當瞬間使用率；100% 代表一核心。
 */
export function summarizeResourceSamples(samples, { warmupEndIndex, loadEndIndex }) {
  const boundedWarmup = Math.max(0, Math.min(warmupEndIndex, samples.length - 1));
  const boundedLoadEnd = Math.max(0, Math.min(loadEndIndex, samples.length - 1));
  // RSS 增幅以「暖身結束當下」為基準；不可把啟動初期較低的 RSS 平均進去。
  const warmupRssBytes = samples[boundedWarmup]?.rssBytes ?? null;
  const endRssBytes = samples.at(-1)?.rssBytes ?? null;
  const intervalCpu = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const elapsedSeconds = (current.monoMs - previous.monoMs) / 1000;
    const cpuDelta = current.cpuSeconds - previous.cpuSeconds;
    if (elapsedSeconds > 0 && cpuDelta >= 0) {
      intervalCpu.push((cpuDelta / elapsedSeconds) * 100);
    }
  }
  intervalCpu.sort((left, right) => left - right);
  const first = samples[boundedWarmup];
  const last = samples[boundedLoadEnd];
  const steadyElapsedSeconds =
    first === undefined || last === undefined ? 0 : (last.monoMs - first.monoMs) / 1000;
  const steadyCpuPercent =
    first === undefined || last === undefined || steadyElapsedSeconds <= 0
      ? null
      : ((last.cpuSeconds - first.cpuSeconds) / steadyElapsedSeconds) * 100;
  return {
    sampleCount: samples.length,
    warmupRssBytes,
    endRssBytes,
    rssGrowthRatio:
      warmupRssBytes === null || warmupRssBytes === 0 || endRssBytes === null
        ? null
        : (endRssBytes - warmupRssBytes) / warmupRssBytes,
    steadyCpuPercent,
    cpuP50Percent: percentile(intervalCpu, 0.5),
    cpuP95Percent: percentile(intervalCpu, 0.95),
    cpuP99Percent: percentile(intervalCpu, 0.99),
    cpuMaxPercent: intervalCpu.length === 0 ? null : intervalCpu.at(-1),
    rssMinBytes:
      samples.length === 0 ? null : Math.min(...samples.map((sample) => sample.rssBytes)),
    rssMaxBytes:
      samples.length === 0 ? null : Math.max(...samples.map((sample) => sample.rssBytes)),
  };
}

/**
 * 解析 `ps -o time=` 的累计 CPU 時間，回傳秒數。
 * 支援 mm:ss、hh:mm:ss、dd-hh:mm:ss，以及小數秒。
 */
export function parseCpuTime(text) {
  const trimmed = text.trim();
  const [timePart, dayText] = trimmed.includes('-')
    ? trimmed.split('-').reverse()
    : [trimmed, undefined];
  if (dayText !== undefined && !/^\d+$/.test(dayText)) {
    return null;
  }
  const days = dayText === undefined ? 0 : Number(dayText);
  const parts = timePart.split(':');
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }
  if (!parts.every((part) => /^\d+(?:\.\d+)?$/.test(part))) {
    return null;
  }
  const numbers = parts.map(Number);
  const hours = parts.length === 3 ? numbers[0] : 0;
  const minutes = parts.length === 3 ? numbers[1] : numbers[0];
  const seconds = parts.length === 3 ? numbers[2] : numbers[1];
  if (minutes >= 60 || seconds >= 60) {
    return null;
  }
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function timeoutSample(scheduledAt) {
  return { scheduledAt, completedAt: null, status: 'timeout' };
}

/**
 * 一個情境的作答送達追蹤器。每筆 submission 都保留實際送出時間，
 * ACK 與四路必要 state 各自有獨立樣本；逾時统一由 timeoutMs 截止。
 */
export function createDeliveryTracker({ timeoutMs }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('DeliveryTracker 的 timeoutMs 必須為正數');
  }

  const records = [];
  const byAnswer = new Map();
  const byTeacherRevision = new Map();
  const projectorFirstSeen = new Map();
  const latestRevision = new Map();
  const clientMetadata = new Map();
  const commandErrorCodes = {};
  let commandErrorCount = 0;
  let unauthorizedCount = 0;
  let ignoredReminderStateCount = 0;
  let draining = false;

  function metadataFor(targets) {
    for (const [channel, clientId] of Object.entries(targets)) {
      if (clientMetadata.has(clientId)) {
        continue;
      }
      clientMetadata.set(clientId, {
        channel,
        expectedRole:
          channel === 'teacher' ? 'teacher' : channel === 'projector' ? 'projector' : 'student',
      });
    }
  }

  function completeChannel(record, channel, state, receivedAt) {
    // 逾時後才到的事件不能補記成成功；分位數中的逾時值仍是 timeoutMs 上限。
    if (receivedAt - record.scheduledAt > timeoutMs && record.samples[channel] === undefined) {
      record.samples[channel] = timeoutSample(record.scheduledAt);
      return;
    }
    if (record.samples[channel] !== undefined) {
      if (record.channelRevisions[channel] === state.revision) {
        ignoredReminderStateCount += 1;
      }
      return;
    }
    const baseline =
      record.baselineRevisions[
        record.targets[
          channel === 'senderState'
            ? 'sender'
            : channel === 'peerState'
              ? 'peer'
              : channel === 'teacherState'
                ? 'teacher'
                : 'projector'
        ]
      ] ?? -1;
    if (state.revision <= baseline) {
      return;
    }
    record.samples[channel] = {
      scheduledAt: record.scheduledAt,
      completedAt: receivedAt,
      status: 'ok',
    };
    record.channelRevisions[channel] = state.revision;
  }

  function observeStudent(clientId, state, receivedAt) {
    const metadata = clientMetadata.get(clientId);
    if (metadata?.channel === 'teacher' || metadata?.channel === 'projector') {
      unauthorizedCount += 1;
      return;
    }
    if ('board' in state || 'progress' in state || 'presence' in state) {
      unauthorizedCount += 1;
      return;
    }
    const expectedGroup = records.find((record) =>
      Object.values(record.targets).includes(clientId),
    )?.groupId;
    if (expectedGroup !== undefined && state.myGroupId !== expectedGroup) {
      unauthorizedCount += 1;
      return;
    }

    const candidates = [];
    if (Array.isArray(state.myAnswers)) {
      for (const answer of state.myAnswers) {
        if (answer.state !== 'submitted' || !Array.isArray(answer.answers)) {
          continue;
        }
        const record = byAnswer.get(
          answerKey(state.myGroupId, answer.questionNumber, answer.answers),
        );
        if (
          record !== undefined &&
          (record.targets.sender === clientId || record.targets.peer === clientId)
        ) {
          candidates.push(record);
        }
      }
    }

    // 一份學生快照可同時含同組多題答案；每一筆以答案內容獨立配對。
    // 不能只挑最新一筆，否則較舊作答會在最後一題沒有後續快照時被誤判漏送。
    for (const record of candidates) {
      completeChannel(
        record,
        record.targets.sender === clientId ? 'senderState' : 'peerState',
        state,
        receivedAt,
      );
    }
  }

  function observeTeacher(clientId, state, receivedAt) {
    if (!Array.isArray(state.board)) {
      return;
    }
    const candidates = [];
    for (const question of state.board) {
      if (!Array.isArray(question.cells)) {
        continue;
      }
      for (const cell of question.cells) {
        if (cell.state !== 'submitted' || !Array.isArray(cell.answers)) {
          continue;
        }
        const record = byAnswer.get(answerKey(cell.groupId, question.questionNumber, cell.answers));
        if (record !== undefined && record.targets.teacher === clientId) {
          candidates.push(record);
        }
      }
    }
    if (candidates.length === 0) {
      return;
    }

    // 老師快照可能批次包含多筆作答，同一 revision 可對應多個記錄。
    // 投影沒有答案內容，只接受「老師已在同 revision 看見該答案」的配對。
    const owners = byTeacherRevision.get(state.revision) ?? new Set();
    byTeacherRevision.set(state.revision, owners);
    const projectorArrival = projectorFirstSeen.get(state.revision);
    for (const record of candidates) {
      owners.add(record);
      completeChannel(record, 'teacherState', state, receivedAt);
      if (projectorArrival !== undefined) {
        completeChannel(record, 'projectorState', { revision: state.revision }, projectorArrival);
      }
    }
  }

  function observeProjector(clientId, state, receivedAt) {
    if ('board' in state || 'myAnswers' in state || 'progress' in state || 'presence' in state) {
      unauthorizedCount += 1;
    }
    if (!projectorFirstSeen.has(state.revision)) {
      projectorFirstSeen.set(state.revision, receivedAt);
    }
    const owners = byTeacherRevision.get(state.revision);
    if (owners === undefined) {
      return;
    }
    for (const record of owners) {
      if (record.targets.projector === clientId) {
        completeChannel(record, 'projectorState', state, receivedAt);
      }
    }
  }

  return {
    records,
    commandErrorCodes,
    get commandErrorCount() {
      return commandErrorCount;
    },
    get unauthorizedCount() {
      return unauthorizedCount;
    },
    get ignoredReminderStateCount() {
      return ignoredReminderStateCount;
    },

    beginSubmission({ groupId, questionNumber, answers, scheduledAt, targets }) {
      const key = answerKey(groupId, questionNumber, answers);
      if (byAnswer.has(key)) {
        throw new Error('同一情境中的作答識別內容重複，無法可靠配對 state');
      }
      metadataFor(targets);
      const record = {
        groupId,
        questionNumber,
        answers: [...answers],
        scheduledAt,
        targets: { ...targets },
        baselineRevisions: Object.fromEntries(
          Object.values(targets).map((clientId) => [clientId, latestRevision.get(clientId) ?? -1]),
        ),
        channelRevisions: {},
        samples: {},
      };
      byAnswer.set(key, record);
      records.push(record);
      return record;
    },

    completeAck(record, { sample, errorCode = null }) {
      if (record.samples.ack !== undefined) {
        throw new Error('同一筆作答收到重複 ACK');
      }
      record.samples.ack = sample;
      // timeout 已由 sample/timeoutRate 呈現，不重複算進「錯誤率」。
      if (errorCode !== null && errorCode !== 'TIMEOUT') {
        commandErrorCount += 1;
        commandErrorCodes[errorCode] = (commandErrorCodes[errorCode] ?? 0) + 1;
      }
    },

    observeState({ clientId, state, receivedAt }) {
      latestRevision.set(clientId, state.revision);
      if (state.role === 'student') {
        observeStudent(clientId, state, receivedAt);
      } else if (state.role === 'teacher') {
        observeTeacher(clientId, state, receivedAt);
      } else if (state.role === 'projector') {
        observeProjector(clientId, state, receivedAt);
      }
    },

    /** 將已超過 deadline 的未完成通道記為逾時；可重複呼叫且不會重複計數。 */
    finalizeExpired(nowMonoMs) {
      for (const record of records) {
        if (nowMonoMs < record.scheduledAt + timeoutMs) {
          continue;
        }
        record.samples.ack ??= timeoutSample(record.scheduledAt);
        for (const channel of CHANNELS) {
          record.samples[channel] ??= timeoutSample(record.scheduledAt);
        }
      }
    },

    /** 等到所有 ACK／必要 state 完成或各自逾時。 */
    async drain() {
      if (draining) {
        throw new Error('同一 tracker 不可同時 drain');
      }
      draining = true;
      try {
        for (;;) {
          const now = performance.now();
          this.finalizeExpired(now);
          const complete = records.every(
            (record) =>
              record.samples.ack !== undefined &&
              CHANNELS.every((channel) => record.samples[channel] !== undefined),
          );
          if (complete) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      } finally {
        draining = false;
      }
    },

    getReport() {
      const samplesFor = (channel) =>
        records.map((record) => record.samples[channel] ?? timeoutSample(record.scheduledAt));
      const summarize = (samples) => summarizeSamples(samples, { timeoutMs });
      const ack = summarize(samplesFor('ack'));
      const necessarySamples = CHANNELS.flatMap(samplesFor);
      const necessaryState = summarize(necessarySamples);
      return {
        ack,
        senderState: summarize(samplesFor('senderState')),
        peerState: summarize(samplesFor('peerState')),
        teacherState: summarize(samplesFor('teacherState')),
        projectorState: summarize(samplesFor('projectorState')),
        necessaryState,
        commandErrorCount,
        commandErrorRate: ack.sampleCount === 0 ? null : commandErrorCount / ack.sampleCount,
        commandErrorCodes: { ...commandErrorCodes },
        missingDeliveryCount: necessarySamples.filter((sample) => sample.status === 'timeout')
          .length,
        unauthorizedCount,
        ignoredReminderStateCount,
        submissionCount: records.length,
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 連線、指令與資源採樣                                                        */
/* -------------------------------------------------------------------------- */

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

async function sleepUntil(targetMonoMs) {
  const remaining = targetMonoMs - performance.now();
  if (remaining > 0) {
    await sleep(remaining);
  }
}

let nextClientNumber = 1;

class TrackedSocketClient {
  constructor({ id, role, groupId, socket, latestState, onState }) {
    this.id = id;
    this.role = role;
    this.groupId = groupId;
    this.socket = socket;
    this.latestState = latestState;
    this.onState = onState;
    this.waiters = new Set();
    this.closed = false;
  }

  receiveState(state) {
    const receivedAt = performance.now();
    this.latestState = state;
    this.onState?.(this, state, receivedAt);
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(state)) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.resolve({ state, receivedAt });
      }
    }
    return receivedAt;
  }

  waitForState(predicate, timeoutMs = 5000) {
    if (this.latestState !== null && predicate(this.latestState)) {
      return Promise.resolve({ state: this.latestState, receivedAt: performance.now() });
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`${this.role} 等待 state 逾時`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  emitCommand(event, payload, timeoutMs) {
    return new Promise((resolve) => {
      const scheduledAt = performance.now();
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish({
          sample: { scheduledAt, completedAt: null, status: 'timeout' },
          ack: null,
          errorCode: 'TIMEOUT',
        });
      }, timeoutMs);
      try {
        this.socket.emit(event, payload, (ack) => {
          const errorCode = ack?.ok === true ? null : (ack?.error?.code ?? 'INVALID_ACK');
          finish({
            sample: { scheduledAt, completedAt: performance.now(), status: 'ok' },
            ack,
            errorCode,
          });
        });
      } catch {
        finish({
          sample: { scheduledAt, completedAt: performance.now(), status: 'ok' },
          ack: null,
          errorCode: 'NETWORK',
        });
      }
    });
  }

  async emitRequired(event, payload, timeoutMs) {
    const result = await this.emitCommand(event, payload, timeoutMs);
    if (result.errorCode !== null) {
      const error = new Error(`${event} 失敗（${result.errorCode}）`);
      error.code = result.errorCode;
      throw error;
    }
    return result;
  }

  transportName() {
    return this.socket.io.engine?.transport?.name ?? 'unknown';
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ state: null, receivedAt: performance.now() });
    }
    this.waiters.clear();
    this.socket.disconnect();
  }
}

/** 建立一條正式 Socket.IO 連線，並量「呼叫連線 → 第一份合法 state」。 */
async function connectTrackedClient({
  baseUrl,
  token,
  cookie,
  role,
  groupId = null,
  view = undefined,
  transportMode,
  timeoutMs,
  onState,
}) {
  const id = `${role}-${nextClientNumber}`;
  nextClientNumber += 1;
  const scheduledAt = performance.now();
  let resolveFirst;
  let rejectFirst;
  const firstState = new Promise((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  let firstSettled = false;
  // 2026-11-22（D18）：老師與投影改以 HttpOnly cookie 認證（不帶 token）；
  // 學生仍帶 sessionStorage 的 token。
  const auth = {};
  if (token !== undefined && token !== null) {
    auth.token = token;
  }
  if (view !== undefined) {
    auth.view = view;
  }
  const socket = createSocketIOClient(baseUrl, {
    auth,
    ...(cookie === undefined || cookie === null
      ? {}
      : { extraHeaders: { Cookie: cookie } }),
    transports: transportsForMode(transportMode),
    // polling 模式必須留在 polling；升級成 WebSocket 會讓兩組數字無法分開解讀。
    upgrade: false,
    forceNew: true,
    reconnection: false,
  });
  const client = new TrackedSocketClient({ id, role, groupId, socket, latestState: null, onState });
  const timer = setTimeout(() => {
    if (firstSettled) return;
    firstSettled = true;
    clearTimeout(timer);
    socket.disconnect();
    const error = new Error(`${role} 握手後 ${timeoutMs} ms 內沒有合法 state`);
    error.handshakeSample = { scheduledAt, completedAt: null, status: 'timeout' };
    rejectFirst(error);
  }, timeoutMs);
  socket.on('state', (state) => {
    if (
      state === null ||
      typeof state !== 'object' ||
      !Number.isInteger(state.revision) ||
      state.revision < 0
    ) {
      return;
    }
    const receivedAt = client.receiveState(state);
    if (!firstSettled && isValidRoleState(state, { role, groupId })) {
      firstSettled = true;
      clearTimeout(timer);
      resolveFirst({ sample: { scheduledAt, completedAt: receivedAt, status: 'ok' } });
    }
  });
  socket.on('connect_error', () => {
    // 連線錯誤不印原始錯誤物件（可能含 URL 或 auth 細節）；由 deadline 結算。
  });
  try {
    const result = await firstState;
    return { client, handshakeSample: result.sample };
  } catch (error) {
    client.close();
    throw error;
  }
}

/** 每秒以 ps 讀取指定 PID 的 RSS 與累計 CPU，意味 100% CPU 為一核心。 */
export function startProcessMonitor(pid, { intervalMs = 1000 } = {}) {
  const samples = [];
  let faultCount = 0;
  let stopped = false;
  let inFlight = null;
  const sampleOnce = async () => {
    if (stopped) return;
    try {
      const { stdout } = await execFileAsync(
        'ps',
        ['-p', String(pid), '-o', 'rss=', '-o', 'time='],
        { timeout: 3000, maxBuffer: 4096 },
      );
      const match = /^\s*(\d+)\s+(\S+)\s*$/m.exec(stdout);
      const cpuSeconds = match === null ? null : parseCpuTime(match[2]);
      if (match !== null && cpuSeconds !== null) {
        samples.push({
          capturedAt: new Date().toISOString(),
          monoMs: performance.now(),
          rssBytes: Number(match[1]) * 1024,
          cpuSeconds,
        });
      } else {
        faultCount += 1;
      }
    } catch {
      faultCount += 1;
    }
  };
  const tick = () => {
    if (inFlight === null) {
      inFlight = sampleOnce().finally(() => {
        inFlight = null;
      });
    }
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return {
    mark() {
      return samples.length - 1;
    },
    sampleCount() {
      return samples.length;
    },
    async stop({ warmupEndIndex, loadEndIndex }) {
      stopped = true;
      clearInterval(timer);
      if (inFlight !== null) await inFlight;
      // 補上停止當下樣本，讓 60 秒後的 RSS 不必再等下一個 tick。
      stopped = false;
      await sampleOnce();
      stopped = true;
      return {
        ...summarizeResourceSamples(samples, { warmupEndIndex, loadEndIndex }),
        faultCount,
        intervalMs,
        samples: samples.map((sample) => ({ ...sample })),
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 正式匯入流程與活動設定                                                      */
/* -------------------------------------------------------------------------- */

async function buildWorkbookBytes(questionCount, blankCount) {
  const imported = await import('exceljs');
  const ExcelJS = imported.default ?? imported;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('負載學習單');
  worksheet.addRow(['題號', '題目', '作答']);
  let headerRow = null;
  const columns = {};
  worksheet.eachRow((row) => {
    const found = {};
    row.eachCell((cell, columnNumber) => {
      for (const label of ['題號', '題目', '作答']) {
        if (cell.value === label) found[label] = columnNumber;
      }
    });
    if (Object.keys(found).length === 3) {
      headerRow = row.number;
      Object.assign(columns, found);
    }
  });
  if (headerRow === null) throw new Error('量測 Workbook 找不到結構化表頭');
  for (let question = 1; question <= questionCount; question += 1) {
    const firstRow = headerRow + 1 + (question - 1) * blankCount;
    if (blankCount > 1) {
      worksheet.mergeCells(firstRow, columns['題號'], firstRow + blankCount - 1, columns['題號']);
    }
    worksheet.getRow(firstRow).getCell(columns['題號']).value = question;
    worksheet.getRow(firstRow).getCell(columns['題目']).value = `負載題目 ${question}`;
    for (let blank = 1; blank <= blankCount; blank += 1) {
      worksheet.getRow(firstRow + blank - 1).getCell(columns['作答']).value = `（${blank}）`;
    }
  }
  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(new Uint8Array(bytes));
}

async function importQuestions(baseUrl, teacherCookie, teacher, questionCount, timeoutMs) {
  const bytes = await buildWorkbookBytes(questionCount, 4);
  const result = await timedRequest({
    url: `${baseUrl}/api/questions/import/file`,
    method: 'POST',
    headers: {
      cookie: teacherCookie,
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'x-file-name': 'socket-load.xlsx',
    },
    body: bytes,
    agent: false,
    timeoutMs,
  });
  if (result.error !== null || result.statusCode !== 200) {
    throw new Error(`題目匯入失敗（${result.statusCode ?? result.error}）`);
  }
  const summary = JSON.parse((result.body ?? Buffer.alloc(0)).toString('utf8'));
  await teacher.emitRequired('questions:confirm', { importId: summary.importId }, timeoutMs);
  await teacher.waitForState((state) => state.questions?.length === questionCount, timeoutMs);
}

async function ensurePreparing(teacher, timeoutMs) {
  if (teacher.latestState?.phase === 'open') {
    await teacher.emitRequired('activity:close', {}, timeoutMs);
  }
  if (teacher.latestState?.phase === 'closed') {
    await teacher.emitRequired('activity:reset', { confirm: true }, timeoutMs);
  }
  if (teacher.latestState?.phase !== 'preparing') {
    await teacher.waitForState((state) => state.phase === 'preparing', timeoutMs);
  }
}

async function openActivity(teacher, timeoutMs, payload = {}) {
  await ensurePreparing(teacher, timeoutMs);
  await teacher.emitRequired('activity:open', payload, timeoutMs);
  await teacher.waitForState((state) => state.phase === 'open', timeoutMs);
}

const SETTLE_WAIT_MS = 3250;

function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* 完整 Socket.IO 量測情境                                                     */
/* -------------------------------------------------------------------------- */

function makeTargets(bundle, teacher, projector) {
  return {
    sender: bundle.sender.id,
    peer: bundle.peer.id,
    teacher: teacher.id,
    projector: projector.id,
  };
}

function latestTransportCounts(clients) {
  const counts = {};
  for (const client of clients) {
    if (!client.closed) {
      const name = client.transportName();
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  return counts;
}

async function joinStudentToken(baseUrl, groupId, timeoutMs) {
  const body = await postJson(`${baseUrl}/api/student/join`, { groupId }, { timeoutMs });
  if (typeof body.token !== 'string' || body.groupId !== groupId) {
    throw new Error('學生加入回應格式不符');
  }
  return body.token;
}

async function connectStudent({
  baseUrl,
  bundle,
  tokenField,
  clientField,
  transportMode,
  timeoutMs,
  onState,
  handshakeSamples = null,
  clientRegistry = null,
}) {
  const result = await connectTrackedClient({
    baseUrl,
    token: bundle[tokenField],
    role: 'student',
    groupId: bundle.groupId,
    transportMode,
    timeoutMs,
    onState,
  });
  handshakeSamples?.push(result.handshakeSample);
  bundle[clientField] = result.client;
  clientRegistry?.add(result.client);
  return result.client;
}

async function runSubmissionItems({
  items,
  tracker = null,
  students,
  targetsForBundle,
  timeoutMs,
}) {
  const base = performance.now() + 20;
  const pending = [];
  for (const item of items) {
    pending.push(
      (async () => {
        await sleepUntil(base + (item.offsetMs ?? 0));
        const bundle = students[item.groupIndex];
        const scheduledAt = performance.now();
        const answers = item.answers;
        const record =
          tracker === null
            ? null
            : tracker.beginSubmission({
                groupId: bundle.groupId,
                questionNumber: item.questionNumber,
                answers,
                scheduledAt,
                targets: targetsForBundle(bundle),
              });
        const result = await bundle.sender.emitCommand(
          'answer:submit',
          {
            questionNumber: item.questionNumber,
            answers,
          },
          timeoutMs,
        );
        if (record !== null) {
          tracker.completeAck(record, result);
        } else if (result.errorCode !== null) {
          const error = new Error(`背景作答失敗（${result.errorCode}）`);
          error.code = result.errorCode;
          throw error;
        }
        return result;
      })(),
    );
  }
  return pending;
}

function evaluateArrivalRanking(teacher, groups, questionNumbers, activeGroupIndexes) {
  let wrong = 0;
  const board = teacher.latestState?.board ?? [];
  for (const questionNumber of questionNumbers) {
    const question = board.find((candidate) => candidate.questionNumber === questionNumber);
    if (question === undefined) {
      wrong += 1;
      continue;
    }
    const cells = question.cells.filter(
      (cell) =>
        activeGroupIndexes.some((index) => groups[index].id === cell.groupId) &&
        cell.state === 'submitted',
    );
    const ranks = cells.map((cell) => cell.rank).filter((rank) => Number.isInteger(rank));
    if (ranks.length !== cells.length || new Set(ranks).size !== ranks.length) wrong += 1;
    const first = cells.find((cell) => cell.rank === 1);
    if (first === undefined || question.winnerGroupId !== first.groupId) wrong += 1;
  }
  return wrong;
}

async function waitOpenForAll(clients, timeoutMs) {
  await Promise.all(
    clients.map((client) => client.waitForState((state) => state.phase === 'open', timeoutMs)),
  );
}

async function switchGroupIdentity({
  extraBundle,
  baseUrl,
  transportMode,
  timeoutMs,
  handshakeTimeoutMs,
  onState,
  handshakeSamples,
  groupIndex,
  clientRegistry,
}) {
  const startedAt = performance.now();
  const leave = await extraBundle.sender.emitCommand('student:leave', {}, timeoutMs);
  const leaveError = leave.errorCode;
  let guestCompletedAt = null;
  if (leaveError === null) {
    const guest = await extraBundle.sender.waitForState(
      (state) => state.role === 'guest',
      timeoutMs,
    );
    guestCompletedAt = guest.receivedAt;
  }
  extraBundle.sender.close();
  if (leaveError !== null) throw new Error(`student:leave 失敗（${leaveError}）`);
  const token = await joinStudentToken(baseUrl, extraBundle.groupId, handshakeTimeoutMs);
  extraBundle.senderToken = token;
  extraBundle.groupIndex = groupIndex;
  const connected = await connectTrackedClient({
    baseUrl,
    token,
    role: 'student',
    groupId: extraBundle.groupId,
    transportMode,
    timeoutMs: handshakeTimeoutMs,
    onState,
  });
  handshakeSamples.push(connected.handshakeSample);
  extraBundle.sender = connected.client;
  clientRegistry.add(connected.client);
  return {
    leaveToGuest: { scheduledAt: startedAt, completedAt: guestCompletedAt, status: 'ok' },
    leaveToNewIdentity: {
      scheduledAt: startedAt,
      completedAt: connected.handshakeSample.completedAt,
      status: 'ok',
    },
  };
}

/**
 * 一到兩種 transport 的完整量測。呼叫方只提供 baseUrl 與老師密碼／server PID。
 */
export async function runSocketLoad(options) {
  const {
    baseUrl,
    password,
    serverPid = null,
    transportMode,
    groups: requestedGroups,
    questions,
    rounds,
    timeoutMs,
    burstIntervalMs,
    cooldownSeconds,
    log = () => {},
  } = options;
  if (requestedGroups < 1 || requestedGroups > 100) throw new Error('--groups 需介於 1 與 100');
  if (questions < 1 || questions > 100) throw new Error('--questions 需介於 1 與 100');
  if (rounds < 1) throw new Error('--rounds 至少為 1');

  const progress = [];
  const handshakes = { initial: [], reconnect: [], switch: [] };
  const switchSamples = { leaveToGuest: [], leaveToNewIdentity: [] };
  const countdown = {
    samples: [],
    byRole: { teacher: [], projector: [], student: [] },
    clockViolationCount: 0,
  };
  const trackers = [];
  const observeAll = (client, state, receivedAt) => {
    for (const tracker of trackers)
      tracker.observeState({ clientId: client.id, state, receivedAt });
  };
  const allClients = new Set();
  const groups = [];
  const students = [];
  let teacherCookie = null;
  let teacher = null;
  let projector = null;
  let extraBundle = null;
  let monitor = null;
  let monitorStopped = false;
  let warmupEndIndex = -1;
  let loadEndIndex = -1;
  const startedAt = new Date();
  // reset／1,000 筆重建屬環境建立，不是 measured ACK；polling 下廣播積壓可超過 30 秒。
  const setupTimeoutMs = Math.max(timeoutMs, 120_000);
  // 握手包含 polling 與 presence 廣播排隊，使用獨立 30 秒 deadline。
  const handshakeTimeoutMs = Math.max(timeoutMs, 30_000);

  const createClient = async (arguments_) => {
    const connected = await connectTrackedClient({ ...arguments_, timeoutMs: handshakeTimeoutMs });
    allClients.add(connected.client);
    return connected;
  };

  try {
    log('登入老師並建立量測組別…');
    teacherCookie = await loginTeacher(baseUrl, password);
    for (let index = 0; index < requestedGroups; index += 1) {
      groups.push({
        id: await createGroupViaTeacherSocket(baseUrl, teacherCookie, { timeoutMs: setupTimeoutMs }),
        index,
      });
    }

    log(`以 ${transportMode} 模式連接老師與投影…`);
    const teacherConnected = await createClient({
      baseUrl,
      cookie: teacherCookie,
      role: 'teacher',
      transportMode,
      timeoutMs,
      onState: observeAll,
    });
    handshakes.initial.push(teacherConnected.handshakeSample);
    teacher = teacherConnected.client;
    const projectorConnected = await createClient({
      baseUrl,
      cookie: teacherCookie,
      role: 'projector',
      view: 'projector',
      transportMode,
      timeoutMs,
      onState: observeAll,
    });
    handshakes.initial.push(projectorConnected.handshakeSample);
    projector = projectorConnected.client;

    const setupClients =
      monitor === null && serverPid !== null
        ? (() => {
            monitor = startProcessMonitor(serverPid);
            return monitor.sampleCount();
          })()
        : null;

    await ensurePreparing(teacher, setupTimeoutMs);
    await importQuestions(baseUrl, teacherCookie, teacher, Math.max(questions, 20), setupTimeoutMs);

    log(`加入 ${requestedGroups} 組的主要學生與同組觀察者…`);
    for (let index = 0; index < requestedGroups; index += 1) {
      const bundle = {
        index,
        groupIndex: index,
        groupId: groups[index].id,
        senderToken: await joinStudentToken(baseUrl, groups[index].id, setupTimeoutMs),
        peerToken: await joinStudentToken(baseUrl, groups[index].id, setupTimeoutMs),
        sender: null,
        peer: null,
      };
      students.push(bundle);
      await Promise.all([
        connectStudent({
          baseUrl,
          bundle,
          tokenField: 'senderToken',
          clientField: 'sender',
          transportMode,
          timeoutMs: handshakeTimeoutMs,
          onState: observeAll,
          handshakeSamples: handshakes.initial,
          clientRegistry: allClients,
        }),
        connectStudent({
          baseUrl,
          bundle,
          tokenField: 'peerToken',
          clientField: 'peer',
          transportMode,
          timeoutMs: handshakeTimeoutMs,
          onState: observeAll,
          handshakeSamples: handshakes.initial,
          clientRegistry: allClients,
        }),
      ]);
    }
    extraBundle = {
      index: 0,
      groupIndex: 0,
      groupId: groups[0].id,
      senderToken: await joinStudentToken(baseUrl, groups[0].id, setupTimeoutMs),
      sender: null,
    };
    await connectStudent({
      baseUrl,
      bundle: extraBundle,
      tokenField: 'senderToken',
      clientField: 'sender',
      transportMode,
      timeoutMs: handshakeTimeoutMs,
      onState: observeAll,
      handshakeSamples: handshakes.initial,
      clientRegistry: allClients,
    });
    if (setupClients !== null)
      progress.push(`資源採樣自第 ${Math.max(0, setupClients)} 筆樣本後開始`);

    // 暖身：一次跨所有主要組別的合法作答，然後重設，不納入正式樣本。
    await openActivity(teacher, setupTimeoutMs);
    const warmItems = students.map((bundle, groupIndex) => ({
      groupIndex,
      questionNumber: 1,
      answers: createAnswers(`warmup-${transportMode}-${groupIndex}`, 4),
    }));
    await Promise.all(
      await runSubmissionItems({
        items: warmItems,
        tracker: null,
        students,
        targetsForBundle: null,
        timeoutMs: setupTimeoutMs,
      }),
    );
    await sleep(250);
    warmupEndIndex = monitor?.mark() ?? -1;
    await ensurePreparing(teacher, setupTimeoutMs);

    const mainTracker = createDeliveryTracker({ timeoutMs });
    trackers.push(mainTracker);
    const activeIndexes = Array.from({ length: requestedGroups }, (_value, index) => index);
    const targetsForBundle = (bundle) => makeTargets(bundle, teacher, projector);
    let wrongRankingCount = 0;

    log(`冷啟作答：${requestedGroups} 組 × ${questions} 題 × ${rounds} 輪…`);
    for (let round = 1; round <= rounds; round += 1) {
      if (round > 1) {
        await ensurePreparing(teacher, setupTimeoutMs);
        const targetIndex = (round - 1) % groups.length;
        extraBundle.groupId = groups[targetIndex].id;
        const switched = await switchGroupIdentity({
          extraBundle,
          baseUrl,
          transportMode,
          timeoutMs,
          handshakeTimeoutMs,
          onState: observeAll,
          handshakeSamples: handshakes.switch,
          groupIndex: targetIndex,
          clientRegistry: allClients,
        });
        switchSamples.leaveToGuest.push(switched.leaveToGuest);
        switchSamples.leaveToNewIdentity.push(switched.leaveToNewIdentity);
      }
      await openActivity(teacher, setupTimeoutMs);
      await waitOpenForAll(
        [
          teacher,
          projector,
          ...students.flatMap((bundle) => [bundle.sender, bundle.peer]),
          extraBundle.sender,
        ],
        setupTimeoutMs,
      );
      const roundStart = performance.now() + 100;
      const pending = [];
      for (let questionNumber = 1; questionNumber <= questions; questionNumber += 1) {
        await sleepUntil(roundStart + (questionNumber - 1) * burstIntervalMs);
        const items = activeIndexes.map((groupIndex) => ({
          groupIndex,
          questionNumber,
          answers: createAnswers(
            `main-${transportMode}-r${round}-q${questionNumber}-g${groupIndex}`,
            4,
          ),
        }));
        pending.push(
          ...(await runSubmissionItems({
            items,
            tracker: mainTracker,
            students,
            targetsForBundle,
            timeoutMs,
          })),
        );
      }
      await Promise.allSettled(pending);
      await mainTracker.drain();
      wrongRankingCount += evaluateArrivalRanking(
        teacher,
        groups,
        Array.from({ length: questions }, (_v, i) => i + 1),
        activeIndexes,
      );
    }
    const coldSubmissionReport = {
      ...mainTracker.getReport(),
      plannedSubmissions: requestedGroups * questions * rounds,
      wrongRankingCount,
    };
    trackers.splice(trackers.indexOf(mainTracker), 1);

    // 量測用的老師／投影若留在線上，種子期間每筆作答都會替他們累積
    // 1000 筆 unread state（polling 下會讓後續 reset ACK 被積壓）。暫時關掉；
    // 種子完成後再重接，後續必要送達才是在量新作答而不是 setup 廣播。
    log(`重建恰好 ${requestedGroups * 20} 筆作答後量測 ${requestedGroups} 組依序重連…`);
    await ensurePreparing(teacher, setupTimeoutMs);
    await openActivity(teacher, setupTimeoutMs);
    teacher.close();
    projector.close();

    // 1000 筆種子不是正式 transport 樣本。polling 先關掉原 sender，改用
    // WebSocket setup 產生資料種子；隨後重連才回到本次 transport 實測。
    for (const bundle of students) {
      bundle.sender.close();
      await connectStudent({
        baseUrl,
        bundle,
        tokenField: 'senderToken',
        clientField: 'sender',
        transportMode: 'websocket',
        timeoutMs: setupTimeoutMs,
        onState: observeAll,
        clientRegistry: allClients,
      });
    }
    for (let index = requestedGroups; index < 50; index += 1) {
      const bundle = {
        index,
        groupIndex: index,
        groupId: groups[index].id,
        senderToken: await joinStudentToken(baseUrl, groups[index].id, setupTimeoutMs),
        peerToken: null,
        sender: null,
        peer: null,
      };
      students.push(bundle);
      await connectStudent({
        baseUrl,
        bundle,
        tokenField: 'senderToken',
        clientField: 'sender',
        transportMode: 'websocket',
        timeoutMs: setupTimeoutMs,
        onState: observeAll,
        clientRegistry: allClients,
      });
    }
    const seedPending = [];
    for (let questionNumber = 1; questionNumber <= 20; questionNumber += 1) {
      const items = Array.from({ length: requestedGroups }, (_value, groupIndex) => ({
        groupIndex,
        offsetMs: 0,
        questionNumber,
        answers: createAnswers(`seed-${transportMode}-q${questionNumber}-g${groupIndex}`, 4),
      }));
      // 只控制建立資料的等待上限；正式量測仍使用 --timeout-ms。
      seedPending.push(
        ...(await runSubmissionItems({
          items,
          tracker: null,
          students,
          targetsForBundle: null,
          timeoutMs: setupTimeoutMs,
        })),
      );
      await sleep(25);
    }
    await Promise.all(seedPending);
    await sleep(500);

    for (const bundle of students) bundle.sender.close();
    // 依序建立 50 條重連，避免 polling 在「握手＋presence 廣播」上形成
    // 自我疊加的 50×50 啟動風暴；延遲仍逐條量測並算 p95/p99。
    for (const bundle of students) {
      await connectStudent({
        baseUrl,
        bundle,
        tokenField: 'senderToken',
        clientField: 'sender',
        transportMode,
        timeoutMs: handshakeTimeoutMs,
        onState: observeAll,
        handshakeSamples: handshakes.reconnect,
        clientRegistry: allClients,
      });
    }
    // 後續情境只需要 --groups 指定的組數；先讓 disconnect 廣播積壓消散再 reset。
    for (const bundle of students.slice(requestedGroups)) bundle.sender.close();
    await sleep(1000);

    // 種子期間刻意停線的量測角色，先在乾淨佇列下重接，再進入公平順位情境。
    const teacherRestored = await createClient({
      baseUrl,
      cookie: teacherCookie,
      role: 'teacher',
      transportMode,
      timeoutMs,
      onState: observeAll,
    });
    teacher = teacherRestored.client;
    const projectorRestored = await createClient({
      baseUrl,
      cookie: teacherCookie,
      role: 'projector',
      view: 'projector',
      transportMode,
      timeoutMs,
      onState: observeAll,
    });
    projector = projectorRestored.client;
    progress.push('1,000 筆重建期間暫停量測用老師／投影連線，避免 setup 廣播汙染後續送達');

    const reconnectReport = {
      answersBeforeReconnect: 1000,
      seedSetupTransport: 'websocket',
      measuredReconnectTransport: transportMode,
      state: summarizeSamples(handshakes.reconnect, { timeoutMs: handshakeTimeoutMs }),
      handshakeErrorCount: 0,
    };
    const activeStudents = students.slice(0, requestedGroups);

    log('公平順位：先讓 A 組在上一題獲勝，再讓 B 組晚到但依公平順位勝出…');
    await ensurePreparing(teacher, setupTimeoutMs);
    await teacher.emitRequired('activity:fair-ranking', { enabled: true }, setupTimeoutMs);
    await openActivity(teacher, setupTimeoutMs);
    const fairTracker = createDeliveryTracker({ timeoutMs });
    trackers.push(fairTracker);
    const fairTargets = targetsForBundle;
    await Promise.all(
      await runSubmissionItems({
        items: [
          {
            groupIndex: 0,
            questionNumber: 1,
            answers: createAnswers(`fair-${transportMode}-seed-g0`, 4),
          },
        ],
        tracker: fairTracker,
        students: activeStudents,
        targetsForBundle: fairTargets,
        timeoutMs,
      }),
    );
    await fairTracker.drain();
    await sleep(SETTLE_WAIT_MS);
    const fairPending = await runSubmissionItems({
      items: [
        {
          groupIndex: 0,
          questionNumber: 2,
          offsetMs: 0,
          answers: createAnswers(`fair-${transportMode}-late-g0`, 4),
        },
        {
          groupIndex: 1,
          questionNumber: 2,
          offsetMs: 100,
          answers: createAnswers(`fair-${transportMode}-late-g1`, 4),
        },
      ],
      tracker: fairTracker,
      students: activeStudents,
      targetsForBundle: fairTargets,
      timeoutMs,
    });
    await Promise.allSettled(fairPending);
    await fairTracker.drain();
    await sleep(SETTLE_WAIT_MS);
    const fairQuestion = teacher.latestState?.board?.find(
      (question) => question.questionNumber === 2,
    );
    const fairWinner = fairQuestion?.winnerGroupId === groups[1].id;
    const fairApplied = fairQuestion?.fairnessApplied === true && fairQuestion?.settling === false;
    const fairnessReport = {
      ...fairTracker.getReport(),
      laterSubmissionWon: fairWinner && fairApplied,
      wrongRankingCount: fairWinner && fairApplied ? 0 : 1,
    };
    trackers.splice(trackers.indexOf(fairTracker), 1);

    log('四空長答案（每空 200 code point，含 emoji）…');
    await ensurePreparing(teacher, setupTimeoutMs);
    await openActivity(teacher, setupTimeoutMs);
    const longTracker = createDeliveryTracker({ timeoutMs });
    trackers.push(longTracker);
    await Promise.allSettled(
      await runSubmissionItems({
        items: activeIndexes.map((groupIndex) => ({
          groupIndex,
          questionNumber: 1,
          answers: createLongAnswers(`long-${transportMode}-g${groupIndex}`),
        })),
        tracker: longTracker,
        students: activeStudents,
        targetsForBundle: targetsForBundle,
        timeoutMs,
      }),
    );
    await longTracker.drain();
    const longAnswerReport = longTracker.getReport();
    trackers.splice(trackers.indexOf(longTracker), 1);

    log('作廢後重送…');
    await ensurePreparing(teacher, setupTimeoutMs);
    await openActivity(teacher, setupTimeoutMs);
    const voidTracker = createDeliveryTracker({ timeoutMs });
    trackers.push(voidTracker);
    const voidBundle = activeStudents[0];
    await Promise.allSettled(
      await runSubmissionItems({
        items: [
          {
            groupIndex: 0,
            questionNumber: 1,
            answers: createAnswers(`void-${transportMode}-first`, 4),
          },
        ],
        tracker: voidTracker,
        students: activeStudents,
        targetsForBundle: targetsForBundle,
        timeoutMs,
      }),
    );
    await voidTracker.drain();
    const voidAck = await teacher.emitCommand(
      'answer:void',
      { groupId: voidBundle.groupId, questionNumber: 1 },
      timeoutMs,
    );
    let voidErrorCount = voidAck.errorCode === null ? 0 : 1;
    await voidBundle.sender.waitForState(
      (state) => state.myAnswers?.[0]?.state === 'voided',
      setupTimeoutMs,
    );
    await Promise.allSettled(
      await runSubmissionItems({
        items: [
          {
            groupIndex: 0,
            questionNumber: 1,
            answers: createAnswers(`void-${transportMode}-resend`, 4),
          },
        ],
        tracker: voidTracker,
        students: activeStudents,
        targetsForBundle: targetsForBundle,
        timeoutMs,
      }),
    );
    await voidTracker.drain();
    const voidReport = {
      ...voidTracker.getReport(),
      voidAck: summarizeSamples([voidAck.sample], { timeoutMs }),
      voidErrorCount,
      resubmitted: true,
    };
    trackers.splice(trackers.indexOf(voidTracker), 1);
    voidErrorCount = 0;

    log('倒數自然到期，量測各角色收到 closed…');
    await ensurePreparing(teacher, setupTimeoutMs);
    const countdownPlayers = [
      { role: 'teacher', client: teacher },
      { role: 'projector', client: projector },
      ...activeStudents.flatMap((bundle) => [
        { role: 'student', client: bundle.sender },
        { role: 'student', client: bundle.peer },
      ]),
      { role: 'student', client: extraBundle.sender },
    ];
    const baselines = new Map(
      countdownPlayers.map(({ client }) => [client.id, client.latestState?.revision ?? -1]),
    );
    await openActivity(teacher, timeoutMs, { countdownSeconds: 10 });
    const openState = await teacher.waitForState(
      (state) => state.phase === 'open' && typeof state.countdownEndsAt === 'string',
      timeoutMs,
    );
    const targetMono =
      performance.now() + (Date.parse(openState.state.countdownEndsAt) - Date.now());
    const countdownTimeoutMs = 10_000 + timeoutMs;
    const closedResults = await Promise.allSettled(
      countdownPlayers.map(async ({ role, client }) => {
        const arrived = await client.waitForState(
          (state) => state.phase === 'closed' && state.revision > baselines.get(client.id),
          countdownTimeoutMs,
        );
        if (arrived.receivedAt < targetMono) {
          countdown.clockViolationCount += 1;
          return null;
        }
        const sample = { scheduledAt: targetMono, completedAt: arrived.receivedAt, status: 'ok' };
        countdown.samples.push(sample);
        countdown.byRole[role].push(sample);
        return sample;
      }),
    );
    let countdownTimeoutCount = 0;
    closedResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value !== null) return;
      const sample = timeoutSample(targetMono);
      countdown.samples.push(sample);
      countdown.byRole[countdownPlayers[index].role].push(sample);
      countdownTimeoutCount += 1;
    });
    countdown.timeoutCount = countdownTimeoutCount;
    loadEndIndex = monitor?.mark() ?? -1;

    const report = {
      transportMode,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      config: {
        activeGroups: requestedGroups,
        totalGroupsCreated: requestedGroups,
        questions,
        rounds,
        timeoutMs,
        handshakeTimeoutMs,
        burstIntervalMs,
        cooldownSeconds,
        seedAnswersBeforeReconnect: 1000,
        seedSetupTransport: 'websocket',
      },
      progress,
      handshakes: {
        initial: {
          summary: summarizeSamples(handshakes.initial, { timeoutMs: handshakeTimeoutMs }),
          samples: handshakes.initial.length,
        },
        reconnect: reconnectReport,
        switch: {
          leaveToGuest: summarizeSamples(switchSamples.leaveToGuest, { timeoutMs }),
          leaveToNewIdentity: summarizeSamples(switchSamples.leaveToNewIdentity, {
            timeoutMs: handshakeTimeoutMs,
          }),
          samples: handshakes.switch.length,
        },
      },
      scenarios: {
        coldSubmissions: coldSubmissionReport,
        reconnect: reconnectReport,
        fairness: fairnessReport,
        longAnswers: longAnswerReport,
        voidResend: voidReport,
        countdown: {
          allRoles: summarizeSamples(countdown.samples, { timeoutMs: countdownTimeoutMs }),
          teacher: summarizeSamples(countdown.byRole.teacher, { timeoutMs: countdownTimeoutMs }),
          projector: summarizeSamples(countdown.byRole.projector, {
            timeoutMs: countdownTimeoutMs,
          }),
          student: summarizeSamples(countdown.byRole.student, { timeoutMs: countdownTimeoutMs }),
          timeoutCount: countdown.timeoutCount,
          timeoutMs: countdownTimeoutMs,
          clockViolationCount: countdown.clockViolationCount,
          participants: countdownPlayers.length,
        },
      },
      finalTransportCounts: latestTransportCounts([...allClients]),
    };

    for (const client of allClients) client.close();
    await sleep(cooldownSeconds * 1000);
    report.finishedAt = new Date().toISOString();
    report.resources =
      monitor === null
        ? { available: false, reason: '未提供伺服器 PID，量不到 CPU 與 RSS' }
        : { available: true, ...(await monitor.stop({ warmupEndIndex, loadEndIndex })) };
    monitorStopped = monitor !== null;
    return report;
  } finally {
    for (const client of allClients) client.close();
    if (monitor !== null && !monitorStopped) {
      // 例外路徑也必須停止 interval；否則故障的負載腳本會被資源監視器掛住。
      await monitor.stop({ warmupEndIndex, loadEndIndex });
    }
    teacherCookie = null;
    for (const bundle of [...students, extraBundle].filter(Boolean)) {
      bundle.senderToken = null;
      bundle.peerToken = null;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP 滿房情境的作答洪流                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 建立長住的滿房作答背景。start(rate, warmup, seconds) 採固定到達率，答完一輪
 * （groups × questions）後結束、重設、再開，直到視窗結束。回傳不含 token。
 */
export async function createAnswerFlood({
  baseUrl,
  teacherCookie,
  groupIds,
  studentTokensByGroup,
  questionCount = 20,
  rateTimeoutMs = 5000,
  log = () => {},
}) {
  const timeoutMs = rateTimeoutMs;
  const setupTimeoutMs = Math.max(timeoutMs, 30_000);
  const teacherConnected = await connectTrackedClient({
    baseUrl,
    cookie: teacherCookie,
    role: 'teacher',
    transportMode: 'websocket',
    timeoutMs,
  });
  const teacher = teacherConnected.client;
  const projectorConnected = await connectTrackedClient({
    baseUrl,
    cookie: teacherCookie,
    role: 'projector',
    view: 'projector',
    transportMode: 'websocket',
    timeoutMs,
  });
  const projectors = [projectorConnected.client];
  const students = [];
  for (const [groupIndex, tokens] of studentTokensByGroup.entries()) {
    for (const token of tokens) {
      const connected = await connectTrackedClient({
        baseUrl,
        token,
        role: 'student',
        groupId: groupIds[groupIndex],
        transportMode: 'websocket',
        timeoutMs,
      });
      students.push({ groupIndex, token, client: connected.client });
    }
  }
  await ensurePreparing(teacher, setupTimeoutMs);
  await importQuestions(baseUrl, teacherCookie, teacher, questionCount, timeoutMs);
  await openActivity(teacher, setupTimeoutMs);
  log(`作答洪流已連接 ${students.length + projectors.length + 1} 條 Socket.IO 連線`);

  let cycle = 0;
  let recyclingPromise = null;
  let queue = shuffled(
    groupIds.flatMap((groupId, groupIndex) =>
      Array.from({ length: questionCount }, (_v, questionIndex) => ({
        groupIndex,
        questionNumber: questionIndex + 1,
      })),
    ),
  );
  const answererByGroup = groupIds.map((_groupId, groupIndex) =>
    students.find((entry) => entry.groupIndex === groupIndex),
  );

  async function recycleIfNeeded() {
    if (queue.length > 0) return;
    // 同一輪最後幾筆抵達會同時看見空 queue，必須共用一次重設；否則會並發 reset。
    recyclingPromise ??= (async () => {
      if (queue.length === 0) {
        cycle += 1;
        await ensurePreparing(teacher, setupTimeoutMs);
        await openActivity(teacher, setupTimeoutMs);
        queue = shuffled(
          groupIds.flatMap((_groupId, groupIndex) =>
            Array.from({ length: questionCount }, (_v, questionIndex) => ({
              groupIndex,
              questionNumber: questionIndex + 1,
            })),
          ),
        );
      }
    })().finally(() => {
      recyclingPromise = null;
    });
    await recyclingPromise;
    if (queue.length === 0) {
      // 前一位共用呼叫失敗時，讓本次呼叫明確重試／報錯，不 shift undefined。
      return recycleIfNeeded();
    }
  }

  return {
    async run({ rate, warmupSeconds, seconds }) {
      const samples = [];
      const counters = { total: 0, error: 0, timeout: 0, cycles: 0, commandErrorCodes: {} };
      const total = Math.round(rate * (warmupSeconds + seconds));
      const start = performance.now();
      const pending = [];
      for (let arrival = 0; arrival < total; arrival += 1) {
        await sleepUntil(start + (1000 * arrival) / rate);
        pending.push(
          (async () => {
            await recycleIfNeeded();
            const item = queue.shift();
            const answerer = answererByGroup[item.groupIndex]?.client;
            if (answerer === undefined) {
              counters.total += 1;
              counters.error += 1;
              counters.commandErrorCodes.NO_STUDENT =
                (counters.commandErrorCodes.NO_STUDENT ?? 0) + 1;
              return;
            }
            const result = await answerer.emitCommand(
              'answer:submit',
              {
                questionNumber: item.questionNumber,
                answers: createAnswers(
                  `http-flood-c${cycle}-q${item.questionNumber}-g${item.groupIndex}`,
                  4,
                ),
              },
              timeoutMs,
            );
            counters.total += 1;
            samples.push(result.sample);
            if (result.errorCode === 'TIMEOUT') counters.timeout += 1;
            if (result.errorCode !== null) {
              counters.error += 1;
              counters.commandErrorCodes[result.errorCode] =
                (counters.commandErrorCodes[result.errorCode] ?? 0) + 1;
            }
          })(),
        );
      }
      await Promise.allSettled(pending);
      counters.cycles = cycle;
      return { counters, summary: summarizeSamples(samples, { timeoutMs }) };
    },
    close() {
      teacher.close();
      for (const projector of projectors) projector.close();
      for (const student of students) {
        student.client.close();
        student.token = null;
      }
    },
  };
}
