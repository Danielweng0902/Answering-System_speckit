/**
 * Socket.IO 負載量測的純邏輯測試：作答／快照配對、提醒排除、長答案與
 * 跨平台 CPU 時間解析。整合行為由 socket.mjs 的短煙霧測試驗證。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAnswers,
  createDeliveryTracker,
  createLongAnswers,
  isValidRoleState,
  parseCpuTime,
  summarizeResourceSamples,
  transportsForMode,
} from '../lib/socketLoad.mjs';

const TARGETS = {
  sender: 'student-a',
  peer: 'student-a-peer',
  teacher: 'teacher',
  projector: 'projector',
};

function begin(tracker, overrides = {}) {
  return tracker.beginSubmission({
    groupId: 'group-a',
    questionNumber: 1,
    answers: ['答案-A'],
    scheduledAt: 100,
    targets: TARGETS,
    ...overrides,
  });
}

function studentState(answers, revision = 7) {
  return {
    role: 'student',
    myGroupId: 'group-a',
    phase: 'open',
    revision,
    myAnswers: [{ questionNumber: 1, state: 'submitted', answers }],
  };
}

function teacherState(revision = 40) {
  return {
    role: 'teacher',
    phase: 'open',
    revision,
    board: [
      {
        questionNumber: 1,
        cells: [{ groupId: 'group-a', state: 'submitted', answers: ['答案-A'], rank: 1 }],
      },
    ],
  };
}

function observe(tracker, clientId, state, receivedAt) {
  tracker.observeState({ clientId, state, receivedAt });
}

test('isValidRoleState：第一份 state 必須角色、組別與 revision 合法', () => {
  assert.equal(
    isValidRoleState(
      { role: 'student', myGroupId: 'g1', revision: 0 },
      {
        role: 'student',
        groupId: 'g1',
      },
    ),
    true,
  );
  assert.equal(
    isValidRoleState(
      { role: 'student', myGroupId: 'g2', revision: 1 },
      {
        role: 'student',
        groupId: 'g1',
      },
    ),
    false,
  );
  assert.equal(isValidRoleState({ role: 'teacher', revision: -1 }, { role: 'teacher' }), false);
  assert.equal(isValidRoleState({ role: 'projector', revision: 2 }, { role: 'projector' }), true);
});

test('createDeliveryTracker：以題號＋答案＋groupId 配對，不用 ack 先後猜 state', () => {
  const tracker = createDeliveryTracker({ timeoutMs: 1000 });
  const record = begin(tracker);
  tracker.completeAck(record, {
    sample: { scheduledAt: 100, completedAt: 108, status: 'ok' },
  });
  observe(tracker, 'student-a', studentState(['別題內容'], 8), 110);
  observe(tracker, 'student-a', studentState(['答案-A'], 9), 120);
  observe(tracker, 'student-a-peer', studentState(['答案-A'], 9), 125);
  observe(tracker, 'teacher', teacherState(41), 130);
  // 投影本身沒有答案內容，必須用老師已配對的同一個全域 revision 對上。
  observe(tracker, 'projector', { role: 'projector', revision: 40 }, 132);
  observe(tracker, 'projector', { role: 'projector', revision: 41 }, 135);

  assert.equal(record.samples.ack.completedAt, 108);
  assert.equal(record.samples.senderState.completedAt, 120);
  assert.equal(record.samples.peerState.completedAt, 125);
  assert.equal(record.samples.teacherState.completedAt, 130);
  assert.equal(record.samples.projectorState.completedAt, 135);
});

test('createDeliveryTracker：同 revision 的公平順位 3 秒提醒不重複計為送達', () => {
  const tracker = createDeliveryTracker({ timeoutMs: 5000 });
  const record = begin(tracker);
  observe(tracker, 'student-a', studentState(['答案-A'], 9), 120);
  observe(tracker, 'student-a', studentState(['答案-A'], 9), 3120);
  observe(tracker, 'teacher', teacherState(41), 130);
  observe(tracker, 'teacher', teacherState(41), 3130);
  observe(tracker, 'projector', { role: 'projector', revision: 41 }, 135);
  observe(tracker, 'projector', { role: 'projector', revision: 41 }, 3135);

  assert.equal(record.samples.senderState.completedAt, 120);
  assert.equal(record.samples.teacherState.completedAt, 130);
  assert.equal(record.samples.projectorState.completedAt, 135);
  assert.equal(tracker.ignoredReminderStateCount, 3);
});

test('createDeliveryTracker：不同組的內容不得配對，越權快照會被計數', () => {
  const tracker = createDeliveryTracker({ timeoutMs: 1000 });
  const record = begin(tracker);
  observe(tracker, 'student-a', { ...studentState(['答案-A']), myGroupId: 'group-b' }, 120);
  observe(tracker, 'student-a', { ...studentState(['答案-A']), board: [] }, 121);
  assert.equal(record.samples.senderState, undefined);
  assert.equal(tracker.unauthorizedCount, 2);
});

test('createDeliveryTracker：finalizeExpired 把漏送放進分母與逾時率', () => {
  const tracker = createDeliveryTracker({ timeoutMs: 1000 });
  const record = begin(tracker);
  tracker.completeAck(record, {
    sample: { scheduledAt: 100, completedAt: 105, status: 'ok' },
  });
  observe(tracker, 'student-a', studentState(['答案-A'], 9), 120);
  tracker.finalizeExpired(1100);

  const report = tracker.getReport();
  assert.equal(report.ack.sampleCount, 1);
  assert.equal(report.senderState.successCount, 1);
  for (const name of ['peerState', 'teacherState', 'projectorState']) {
    assert.equal(report[name].sampleCount, 1);
    assert.equal(report[name].timeoutCount, 1);
    assert.equal(report[name].timeoutRate, 1);
  }
  assert.equal(report.necessaryState.sampleCount, 4);
  assert.equal(report.necessaryState.timeoutCount, 3);
  assert.equal(report.missingDeliveryCount, 3);
});

test('createDeliveryTracker：拒絕 ACK 是命令錯誤，但不偽造成逾時', () => {
  const tracker = createDeliveryTracker({ timeoutMs: 1000 });
  const record = begin(tracker);
  tracker.completeAck(record, {
    sample: { scheduledAt: 100, completedAt: 110, status: 'ok' },
    errorCode: 'ALREADY_SUBMITTED',
  });
  tracker.finalizeExpired(1100);
  const report = tracker.getReport();
  assert.equal(report.commandErrorCount, 1);
  assert.equal(report.commandErrorRate, 1);
  assert.equal(report.ack.timeoutCount, 0);
  assert.deepEqual(report.commandErrorCodes, { ALREADY_SUBMITTED: 1 });
});

test('createDeliveryTracker：同一份 state 可一次配對多筆必要送達，不重複復用 revision', () => {
  const tracker = createDeliveryTracker({ timeoutMs: 1000 });
  const first = begin(tracker);
  const second = begin(tracker, {
    answers: ['答案-B'],
    scheduledAt: 101,
  });
  const sharedStudentState = {
    ...studentState(['答案-A'], 42),
    myAnswers: [
      { questionNumber: 1, state: 'submitted', answers: ['答案-A'] },
      { questionNumber: 1, state: 'submitted', answers: ['答案-B'] },
    ],
  };
  // groupId 相同時答案內容已足以區分，第二筆應有自己的 scheduledAt。
  second.groupId = first.groupId;
  observe(tracker, 'student-a', sharedStudentState, 120);
  observe(tracker, 'student-a-peer', sharedStudentState, 125);
  observe(
    tracker,
    'teacher',
    {
      ...teacherState(41),
      board: [
        {
          questionNumber: 1,
          cells: [
            { groupId: 'group-a', state: 'submitted', answers: ['答案-A'], rank: 1 },
            { groupId: 'group-a', state: 'submitted', answers: ['答案-B'], rank: 2 },
          ],
        },
      ],
    },
    130,
  );
  observe(tracker, 'projector', { role: 'projector', revision: 41 }, 135);

  for (const record of [first, second]) {
    assert.equal(record.samples.senderState.completedAt, 120);
    assert.equal(record.samples.peerState.completedAt, 125);
    assert.equal(record.samples.teacherState.completedAt, 130);
    assert.equal(record.samples.projectorState.completedAt, 135);
  }
});

test('createDeliveryTracker：逾時後才到的 state 不得補記成功，ACK 逾時不重複算命令錯誤', () => {
  const tracker = createDeliveryTracker({ timeoutMs: 1000 });
  const record = begin(tracker);
  tracker.completeAck(record, {
    sample: { scheduledAt: 100, completedAt: null, status: 'timeout' },
    errorCode: 'TIMEOUT',
  });
  observe(tracker, 'student-a', studentState(['答案-A'], 9), 1101);
  tracker.finalizeExpired(1101);
  const report = tracker.getReport();

  assert.equal(record.samples.senderState.status, 'timeout');
  assert.equal(report.senderState.timeoutCount, 1);
  assert.equal(report.ack.timeoutCount, 1);
  assert.equal(report.commandErrorCount, 0);
  assert.equal(report.ack.p95Ms, 1000);
  assert.equal(report.ack.maxMs, 1000);
});

test('createLongAnswers：固定 4 空、每空 200 code point 且含 emoji', () => {
  const answers = createLongAnswers('50-20-10');
  assert.equal(answers.length, 4);
  assert.equal(new Set(answers).size, 4);
  for (const answer of answers) {
    assert.equal(Array.from(answer).length, 200);
    assert.match(answer, /🙂/u);
  }
});

test('parseCpuTime：解析 ps 的秒、分、小時與日格式', () => {
  assert.equal(parseCpuTime('00:00.12'), 0.12);
  assert.equal(parseCpuTime('01:02.50'), 62.5);
  assert.equal(parseCpuTime('02:03:04'), 7384);
  assert.equal(parseCpuTime('2-03:04:05'), 183845);
  assert.equal(parseCpuTime('not-a-time'), null);
});

test('summarizeResourceSamples：CPU 用於穩態期間的累計時間差，RSS 比較暖身後與停止後', () => {
  const samples = [
    { monoMs: 0, rssBytes: 100, cpuSeconds: 10 },
    { monoMs: 1000, rssBytes: 110, cpuSeconds: 11 },
    { monoMs: 2000, rssBytes: 120, cpuSeconds: 13 },
    { monoMs: 3000, rssBytes: 130, cpuSeconds: 17 },
    { monoMs: 4000, rssBytes: 140, cpuSeconds: 18 },
  ];
  const summary = summarizeResourceSamples(samples, {
    warmupEndIndex: 1,
    loadEndIndex: 3,
  });
  assert.equal(summary.sampleCount, 5);
  // 基準是「暖身結束當下」，不是把啟動初期的低 RSS 平均進去。
  assert.equal(summary.warmupRssBytes, 110);
  assert.equal(summary.endRssBytes, 140);
  assert.equal(summary.rssGrowthRatio, 30 / 110);
  // 暖身結束（1s）到停止負載（3s）：CPU 6 秒 ÷ 牆鐘 2 秒 = 300%。
  assert.equal(summary.steadyCpuPercent, 300);
});

test('transportsForMode：websocket 只用 ws，polling 固定留在 polling 不升級', () => {
  assert.deepEqual(transportsForMode('websocket'), ['websocket']);
  assert.deepEqual(transportsForMode('polling'), ['polling']);
  assert.throws(() => transportsForMode('tcp'), /未知/);
});

test('createAnswers：一般與長答案都帶唯一標記，避免跨情境誤配對', () => {
  assert.deepEqual(createAnswers('r1-q2-g3', 3), [
    '回答-r1-q2-g3-空1',
    '回答-r1-q2-g3-空2',
    '回答-r1-q2-g3-空3',
  ]);
});
