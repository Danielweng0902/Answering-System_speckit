import type { Socket } from 'socket.io-client';
import type { Ack, Snapshot } from '@classroom/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import { createSnapshot } from '../../src/app/snapshot.js';
import {
  getActivity,
  getAnswerEventCount,
  type Activity,
} from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { list as listQuestions } from '../../src/infra/db/questionRepo.js';
import {
  seedQuestions,
  sendCommand,
  startTestServer,
  waitForState,
  type SeedQuestionDefinition,
  type TestServer,
} from './helpers.js';

const FIXED_NOW = new Date('2026-11-12T10:00:00.000Z');

type SubmissionRow = {
  id: string;
  questionNumber: number;
  questionId: string;
  groupId: string;
  rank: number;
  receivedAt: string;
  voidedAt: string | null;
};

type SubmissionAnswerRow = {
  questionNumber: number;
  groupId: string;
  blankPosition: number;
  answerText: string;
};

type GroupAnswerRevisionRow = {
  groupId: string;
  answerRevision: number;
};

type CapturedState = {
  activity: Activity;
  answerEventCount: number;
  groupAnswerRevisions: GroupAnswerRevisionRow[];
  submissions: SubmissionRow[];
  answers: SubmissionAnswerRow[];
  studentSnapshot: Snapshot;
};

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function submissions(database: TestServer['db']): SubmissionRow[] {
  return database
    .prepare(
      `SELECT s.id, q.number AS questionNumber, s.question_id AS questionId,
              s.group_id AS groupId, s.rank, s.received_at AS receivedAt,
              s.voided_at AS voidedAt
       FROM submissions s
       JOIN questions q ON q.id = s.question_id
       ORDER BY q.position, s.rank`,
    )
    .all() as SubmissionRow[];
}

function submissionAnswers(database: TestServer['db']): SubmissionAnswerRow[] {
  return database
    .prepare(
      `SELECT q.number AS questionNumber, s.group_id AS groupId,
              a.blank_position AS blankPosition, a.answer_text AS answerText
       FROM submission_answers a
       JOIN submissions s ON s.id = a.submission_id
       JOIN questions q ON q.id = s.question_id
       ORDER BY q.position, s.rank, a.blank_position`,
    )
    .all() as SubmissionAnswerRow[];
}

function groupAnswerRevisions(
  target: TestServer,
): GroupAnswerRevisionRow[] {
  return target.db
    .prepare(
      `SELECT group_id AS groupId, answer_revision AS answerRevision
       FROM group_answer_revisions ORDER BY group_id`,
    )
    .all() as GroupAnswerRevisionRow[];
}

function captureState(target: TestServer): CapturedState {
  const activity = getActivity(target.db);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }
  return {
    activity,
    answerEventCount: getAnswerEventCount(target.db),
    groupAnswerRevisions: groupAnswerRevisions(target),
    submissions: submissions(target.db),
    answers: submissionAnswers(target.db),
    studentSnapshot: createSnapshot(
      target.db,
      { role: 'student', groupId: 'group-1' },
      {},
      FIXED_NOW,
    ),
  };
}

function expectFailureUnchanged(
  target: TestServer,
  before: CapturedState,
  ack: Ack,
  code: string,
): void {
  expect(ack).toEqual({
    ok: false,
    error: { code, message: expect.any(String) },
  });
  // 包含 activity.revision、所有作答／順位與固定時鐘的完整學生快照。
  expect(captureState(target)).toEqual(before);
}

async function connectStudent(
  target: TestServer,
  groupId: string,
  existingStudentObservers: Socket[] = [],
): Promise<Socket> {
  const token = issueSession(target.db, { role: 'student', groupId });
  const socket = target.connect({ token, autoConnect: false });
  const ownInitial = waitForState(socket);
  // 學生進場會改變 presence；先收掉其他連線的這輪快照，避免後續等待誤收。
  const observers = existingStudentObservers.map((observer) =>
    waitForState(observer),
  );
  socket.connect();
  await Promise.all([ownInitial, ...observers]);
  return socket;
}

type Fixture = {
  server: TestServer;
  teacher: Socket;
  studentOne: Socket;
  studentTwo: Socket;
  sockets: Socket[];
};

async function startFixture(
  questionDefinitions?: readonly SeedQuestionDefinition[],
): Promise<Fixture> {
  const target = await startTestServer();
  server = target;
  insertGroup(target.db, { id: 'group-1', name: '第一組', position: 1 });
  insertGroup(target.db, { id: 'group-2', name: '第二組', position: 2 });
  seedQuestions(
    target.db,
    questionDefinitions ?? [
      { number: 1, prompt: '第一題題目' },
      { number: 2, prompt: '第二題題目' },
    ],
  );

  const teacherToken = issueSession(target.db, { role: 'teacher' });
  const teacher = target.connect({ token: teacherToken, autoConnect: false });
  const teacherInitial = waitForState(teacher);
  teacher.connect();
  await teacherInitial;

  const studentOne = await connectStudent(target, 'group-1', [teacher]);
  const studentTwo = await connectStudent(target, 'group-2', [
    teacher,
    studentOne,
  ]);
  return {
    server: target,
    teacher,
    studentOne,
    studentTwo,
    sockets: [teacher, studentOne, studentTwo],
  };
}

async function openActivity(fixture: Fixture): Promise<void> {
  const states = fixture.sockets.map((socket) => waitForState(socket));
  expect(
    await sendCommand(fixture.teacher, 'activity:open', {}),
  ).toEqual({ ok: true });
  await Promise.all(states);
}

async function submitWithState(
  fixture: Fixture,
  socket: Socket,
  questionNumber: number,
  answers: string[],
): Promise<{ ack: Ack; states: Snapshot[] }> {
  // 003 US2：作答成功只送所有老師與送出的該組。這個 helper 的既有案例
  // 每次都由一組的一名成員送出，因此只等老師與該成員；其他組/guest 的
  // 「完全沒有 state 封包」由 answerVisibility.test.ts 驗證。
  const statePromises = [
    waitForState(fixture.teacher),
    waitForState(socket),
  ];
  const ack = await sendCommand(socket, 'answer:submit', {
    questionNumber,
    answers,
  });
  const states = await Promise.all(statePromises);
  return { ack, states };
}

async function voidWithState(
  fixture: Fixture,
  studentSocket: Socket,
  groupId: string,
  questionNumber: number,
): Promise<{ ack: Ack; states: Snapshot[] }> {
  const statePromises = [
    waitForState(fixture.teacher),
    waitForState(studentSocket),
  ];
  const ack = await sendCommand(fixture.teacher, 'answer:void', {
    groupId,
    questionNumber,
  });
  const states = await Promise.all(statePromises);
  return { ack, states };
}

describe('answer:submit（US1；AC-003-01–08、SC-001、SC-007）', () => {
  it('preparing 與 closed 都回 INVALID_PHASE，作答、順位與快照不變（AC-003-02）', async () => {
    const fixture = await startFixture();

    let before = captureState(fixture.server);
    expectFailureUnchanged(
      fixture.server,
      before,
      await sendCommand(fixture.studentOne, 'answer:submit', {
        questionNumber: 1,
        answers: ['準備中的答案'],
      }),
      'INVALID_PHASE',
    );

    await openActivity(fixture);
    const closingStates = fixture.sockets.map((socket) => waitForState(socket));
    expect(
      await sendCommand(fixture.teacher, 'activity:close', {}),
    ).toEqual({ ok: true });
    await Promise.all(closingStates);

    before = captureState(fixture.server);
    expectFailureUnchanged(
      fixture.server,
      before,
      await sendCommand(fixture.studentOne, 'answer:submit', {
        questionNumber: 1,
        answers: ['結束後的答案'],
      }),
      'INVALID_PHASE',
    );
  });

  it('open 送出成功會 trim 並保存整題，ack 只有 ok；同組成員 2 秒內看到本組答案且沒有 rank（AC-003-05）', async () => {
    const fixture = await startFixture();
    await openActivity(fixture);

    const { ack, states } = await submitWithState(
      fixture,
      fixture.studentOne,
      1,
      ['  第一組的答案　'],
    );

    expect(ack).toEqual({ ok: true });
    const [questionOne, questionTwo] = listQuestions(fixture.server.db);
    expect(submissions(fixture.server.db)).toMatchObject([
      {
        questionNumber: 1,
        questionId: questionOne?.id,
        groupId: 'group-1',
        rank: 1,
        receivedAt: expect.any(String),
        voidedAt: null,
      },
    ]);
    expect(submissionAnswers(fixture.server.db)).toEqual([
      {
        questionNumber: 1,
        groupId: 'group-1',
        blankPosition: 1,
        answerText: '第一組的答案',
      },
    ]);

    const groupOneState = states[1];
    expect(groupOneState).toMatchObject({
      myGroupId: 'group-1',
      myAnswers: [
        { questionNumber: 1, state: 'submitted', answers: ['第一組的答案'] },
        { questionNumber: 2, state: 'not_submitted', answers: [] },
      ],
    });
    expect(JSON.stringify(groupOneState)).not.toContain('"rank"');
    expect(questionTwo).toBeDefined();
  });

  it('不存在的題號、空格數不符、空答案、純空白與 201 code point 都被拒且不占順位（AC-003-08）', async () => {
    const fixture = await startFixture();
    await openActivity(fixture);

    const cases = [
      {
        payload: { questionNumber: 99, answers: ['答案'] },
        code: 'QUESTION_NOT_FOUND',
      },
      {
        payload: { questionNumber: 1, answers: [] },
        code: 'BLANK_COUNT_MISMATCH',
      },
      {
        payload: { questionNumber: 1, answers: [''] },
        code: 'ANSWER_EMPTY',
      },
      {
        payload: { questionNumber: 1, answers: [' \t　\n'] },
        code: 'ANSWER_EMPTY',
      },
      {
        payload: { questionNumber: 1, answers: ['😀'.repeat(201)] },
        code: 'ANSWER_TOO_LONG',
      },
    ] as const;

    for (const testCase of cases) {
      const before = captureState(fixture.server);
      expectFailureUnchanged(
        fixture.server,
        before,
        await sendCommand(
          fixture.studentOne,
          'answer:submit',
          testCase.payload,
        ),
        testCase.code,
      );
    }

    const { ack } = await submitWithState(fixture, fixture.studentOne, 1, [
      '錯誤後第一次有效送出',
    ]);
    expect(ack).toEqual({ ok: true });
    expect(submissions(fixture.server.db).map((row) => row.rank)).toEqual([1]);
  });

  it('同組重複送出回 ALREADY_SUBMITTED，原答案、rank、revision 與快照不變（AC-003-04、SC-007）', async () => {
    const fixture = await startFixture();
    await openActivity(fixture);
    expect(
      (
        await submitWithState(fixture, fixture.studentOne, 1, [
          '原本答案',
        ])
      ).ack,
    ).toEqual({ ok: true });

    const before = captureState(fixture.server);
    expectFailureUnchanged(
      fixture.server,
      before,
      await sendCommand(fixture.studentOne, 'answer:submit', {
        questionNumber: 1,
        answers: ['試圖覆蓋'],
      }),
      'ALREADY_SUBMITTED',
    );
    expect(submissionAnswers(fixture.server.db)[0]?.answerText).toBe('原本答案');
    expect(submissions(fixture.server.db)[0]?.rank).toBe(1);
  });

  it('兩組先後送出同一題得到 rank 1、2，第二組只看自己的已送出答案（AC-003-03）', async () => {
    const fixture = await startFixture();
    await openActivity(fixture);

    expect(
      (await submitWithState(fixture, fixture.studentOne, 1, ['先送'])).ack,
    ).toEqual({ ok: true });
    const { ack, states } = await submitWithState(
      fixture,
      fixture.studentTwo,
      1,
      ['後送'],
    );

    expect(ack).toEqual({ ok: true });
    expect(
      submissions(fixture.server.db).map(({ groupId, rank }) => ({
        groupId,
        rank,
      })),
    ).toEqual([
      { groupId: 'group-1', rank: 1 },
      { groupId: 'group-2', rank: 2 },
    ]);
    expect(states[1]).toMatchObject({
      myGroupId: 'group-2',
      myAnswers: [
        { questionNumber: 1, state: 'submitted', answers: ['後送'] },
        { questionNumber: 2, state: 'not_submitted', answers: [] },
      ],
    });
    expect(JSON.stringify(states[1])).not.toContain('先送');
    expect(JSON.stringify(states[1])).not.toContain('"rank"');
  });

  it('不同題目的順位各自從 1 獨立計算（AC-003-07）', async () => {
    const fixture = await startFixture();
    await openActivity(fixture);

    expect(
      (await submitWithState(fixture, fixture.studentOne, 1, ['一之一'])).ack,
    ).toEqual({ ok: true });
    expect(
      (await submitWithState(fixture, fixture.studentTwo, 1, ['二之一'])).ack,
    ).toEqual({ ok: true });
    expect(
      (await submitWithState(fixture, fixture.studentTwo, 2, ['二之二'])).ack,
    ).toEqual({ ok: true });
    expect(
      (await submitWithState(fixture, fixture.studentOne, 2, ['一之二'])).ack,
    ).toEqual({ ok: true });

    expect(
      submissions(fixture.server.db).map(
        ({ questionNumber, groupId, rank }) => ({
          questionNumber,
          groupId,
          rank,
        }),
      ),
    ).toEqual([
      { questionNumber: 1, groupId: 'group-1', rank: 1 },
      { questionNumber: 1, groupId: 'group-2', rank: 2 },
      { questionNumber: 2, groupId: 'group-2', rank: 1 },
      { questionNumber: 2, groupId: 'group-1', rank: 2 },
    ]);
  });

  it('同組兩連線 Promise.all 幾乎同時送出，只接受一筆，另一個看到本組已送出的答案（AC-003-06）', async () => {
    const fixture = await startFixture();
    const partner = await connectStudent(fixture.server, 'group-1', [
      fixture.teacher,
      fixture.studentOne,
      fixture.studentTwo,
    ]);
    fixture.sockets.push(partner);
    await openActivity(fixture);

    const states = [
      fixture.teacher,
      fixture.studentOne,
      partner,
    ].map((socket) => waitForState(socket));
    const acks = await Promise.all([
      sendCommand(fixture.studentOne, 'answer:submit', {
        questionNumber: 1,
        answers: ['第一位成員'],
      }),
      sendCommand(partner, 'answer:submit', {
        questionNumber: 1,
        answers: ['第二位成員'],
      }),
    ]);
    const snapshots = await Promise.all(states);

    const successful = acks.filter((ack) => ack.ok);
    const rejected = acks.filter((ack) => !ack.ok);
    expect(successful).toEqual([{ ok: true }]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_SUBMITTED' },
    });
    const winningAnswer = acks[0]?.ok ? '第一位成員' : '第二位成員';
    expect(submissionAnswers(fixture.server.db)).toHaveLength(1);
    expect(submissionAnswers(fixture.server.db)[0]?.answerText).toBe(
      winningAnswer,
    );
    for (const snapshot of [snapshots[1], snapshots[2]]) {
      expect(snapshot).toMatchObject({
        myGroupId: 'group-1',
        myAnswers: [
          { questionNumber: 1, state: 'submitted', answers: [winningAnswer] },
          { questionNumber: 2, state: 'not_submitted', answers: [] },
        ],
      });
    }
  });

  it('10 組同時對同一題送出，rank 1–10 各出現一次（SC-001）', async () => {
    const target = await startTestServer();
    server = target;
    seedQuestions(target.db, [{ number: 1, prompt: '同時送出題目' }]);

    const sockets: Socket[] = [];
    for (let position = 1; position <= 10; position += 1) {
      const id = `group-${String(position).padStart(2, '0')}`;
      insertGroup(target.db, { id, name: `第 ${position} 組`, position });
      const token = issueSession(target.db, {
        role: 'student',
        groupId: id,
      });
      sockets.push(target.connect({ token, autoConnect: false }));
    }

    const teacherToken = issueSession(target.db, { role: 'teacher' });
    const teacher = target.connect({ token: teacherToken, autoConnect: false });
    const teacherInitial = waitForState(teacher);
    teacher.connect();
    await teacherInitial;
    const openedState = waitForState(teacher);
    expect(await sendCommand(teacher, 'activity:open', {})).toEqual({
      ok: true,
    });
    await openedState;

    const initialStates = sockets.map((socket) => waitForState(socket));
    for (const socket of sockets) socket.connect();
    await Promise.all(initialStates);

    const acks = await Promise.all(
      sockets.map((socket, index) =>
        sendCommand(socket, 'answer:submit', {
          questionNumber: 1,
          answers: [`第 ${index + 1} 組答案`],
        }),
      ),
    );
    expect(acks).toEqual(Array.from({ length: 10 }, () => ({ ok: true })));

    const rows = submissions(target.db);
    expect(rows).toHaveLength(10);
    expect(rows.map((row) => row.rank).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(new Set(rows.map((row) => row.groupId)).size).toBe(10);
    expect(submissionAnswers(target.db)).toHaveLength(10);
  });

  it('guest 與 teacher 回 FORBIDDEN，payload 偽造 groupId 回 INVALID_INPUT，資料不變（FR-018）', async () => {
    const fixture = await startFixture();
    await openActivity(fixture);
    const guest = fixture.server.connect({ autoConnect: false });
    const guestInitial = waitForState(guest);
    guest.connect();
    await guestInitial;

    let before = captureState(fixture.server);
    expectFailureUnchanged(
      fixture.server,
      before,
      await sendCommand(guest, 'answer:submit', {
        questionNumber: 1,
        answers: ['guest 答案'],
      }),
      'FORBIDDEN',
    );

    before = captureState(fixture.server);
    expectFailureUnchanged(
      fixture.server,
      before,
      await sendCommand(fixture.teacher, 'answer:submit', {
        questionNumber: 1,
        answers: ['teacher 答案'],
      }),
      'FORBIDDEN',
    );

    before = captureState(fixture.server);
    expectFailureUnchanged(
      fixture.server,
      before,
      await sendCommand(fixture.studentOne, 'answer:submit', {
        questionNumber: 1,
        answers: ['冒用別組'],
        groupId: 'group-2',
      }),
      'INVALID_INPUT',
    );
  });
});

const mixedQuestionDefinitions: readonly SeedQuestionDefinition[] = [
  {
    number: 1,
    kind: 'group',
    prompt: '第一題是兩空格題組',
    blanks: [
      { position: 1, prefix: '（1）', cell: 'G5' },
      { position: 2, prefix: '（2）', cell: 'G6' },
    ],
  },
  { number: 2, kind: 'single', prompt: '第二題是單空格題目' },
];

describe('answer:submit 題組（US5；FR-007；AC-003-07、22–25）', () => {
  it('兩空格只送一個答案或含空值都被拒，不占順位；補齊後從 rank 1 開始（AC-003-23）', async () => {
    const fixture = await startFixture(mixedQuestionDefinitions);
    await openActivity(fixture);

    for (const testCase of [
      { answers: ['只有第一格'], code: 'BLANK_COUNT_MISMATCH' },
      { answers: ['第一格', ''], code: 'ANSWER_EMPTY' },
      { answers: ['第一格', ' \t　\n'], code: 'ANSWER_EMPTY' },
    ] as const) {
      const before = captureState(fixture.server);
      expectFailureUnchanged(
        fixture.server,
        before,
        await sendCommand(fixture.studentOne, 'answer:submit', {
          questionNumber: 1,
          answers: testCase.answers,
        }),
        testCase.code,
      );
    }

    expect(
      (
        await submitWithState(fixture, fixture.studentOne, 1, [
          '第一格',
          '第二格',
        ])
      ).ack,
    ).toEqual({ ok: true });
    expect(submissions(fixture.server.db)).toHaveLength(1);
    expect(submissions(fixture.server.db)[0]?.rank).toBe(1);
  });

  it('兩格答案在同一筆 Submission 一起記錄且整題只有一個 rank（AC-003-24）', async () => {
    const fixture = await startFixture(mixedQuestionDefinitions);
    await openActivity(fixture);

    expect(
      (
        await submitWithState(fixture, fixture.studentOne, 1, [
          '  第一格答案　',
          '第二格答案',
        ])
      ).ack,
    ).toEqual({ ok: true });

    expect(submissions(fixture.server.db)).toMatchObject([
      {
        questionNumber: 1,
        groupId: 'group-1',
        rank: 1,
        voidedAt: null,
      },
    ]);
    expect(submissionAnswers(fixture.server.db)).toEqual([
      {
        questionNumber: 1,
        groupId: 'group-1',
        blankPosition: 1,
        answerText: '第一格答案',
      },
      {
        questionNumber: 1,
        groupId: 'group-1',
        blankPosition: 2,
        answerText: '第二格答案',
      },
    ]);
  });

  it('closed 學生快照的 results 與 myAnswers 都依 blank position 回傳答案（AC-003-25 學生側）', async () => {
    const fixture = await startFixture(mixedQuestionDefinitions);
    await openActivity(fixture);
    const answers = ['前綴一的答案', '前綴二的答案'];
    expect(
      (await submitWithState(fixture, fixture.studentOne, 1, answers)).ack,
    ).toEqual({ ok: true });

    const closingStates = fixture.sockets.map((socket) => waitForState(socket));
    expect(
      await sendCommand(fixture.teacher, 'activity:close', {}),
    ).toEqual({ ok: true });
    const snapshots = await Promise.all(closingStates);
    const closedStudent = snapshots[1];

    expect(closedStudent).toMatchObject({
      role: 'student',
      phase: 'closed',
      myGroupId: 'group-1',
      results: [
        {
          questionNumber: 1,
          winner: {
            groupId: 'group-1',
            groupName: '第一組',
            answers: ['前綴一的答案', '前綴二的答案'],
          },
        },
        { questionNumber: 2, winner: null },
      ],
      myAnswers: [
        {
          questionNumber: 1,
          state: 'submitted',
          answers: ['前綴一的答案', '前綴二的答案'],
          rank: 1,
        },
        {
          questionNumber: 2,
          state: 'not_submitted',
          answers: [],
          rank: null,
        },
      ],
    });
  });

  it('題組與單題混合時，各題順位仍各自獨立（AC-003-07）', async () => {
    const fixture = await startFixture(mixedQuestionDefinitions);
    await openActivity(fixture);

    expect(
      (
        await submitWithState(fixture, fixture.studentOne, 1, [
          '一組第一題第一格',
          '一組第一題第二格',
        ])
      ).ack,
    ).toEqual({ ok: true });
    expect(
      (
        await submitWithState(fixture, fixture.studentTwo, 1, [
          '二組第一題第一格',
          '二組第一題第二格',
        ])
      ).ack,
    ).toEqual({ ok: true });
    expect(
      (await submitWithState(fixture, fixture.studentTwo, 2, ['二組第二題']))
        .ack,
    ).toEqual({ ok: true });
    expect(
      (await submitWithState(fixture, fixture.studentOne, 2, ['一組第二題']))
        .ack,
    ).toEqual({ ok: true });

    expect(
      submissions(fixture.server.db).map(
        ({ questionNumber, groupId, rank }) => ({
          questionNumber,
          groupId,
          rank,
        }),
      ),
    ).toEqual([
      { questionNumber: 1, groupId: 'group-1', rank: 1 },
      { questionNumber: 1, groupId: 'group-2', rank: 2 },
      { questionNumber: 2, groupId: 'group-2', rank: 1 },
      { questionNumber: 2, groupId: 'group-1', rank: 2 },
    ]);
  });
});

describe('answer:void（US3；T026；FR-029、FR-030；AC-003-29–31）', () => {
  it('preparing 與 closed 都回 INVALID_PHASE，作答、counter 與結果不變（AC-003-31）', async () => {
    const fixture = await startFixture();

    let before = captureState(fixture.server);
    expectFailureUnchanged(
      fixture.server,
      before,
      await sendCommand(fixture.teacher, 'answer:void', {
        groupId: 'group-1',
        questionNumber: 1,
      }),
      'INVALID_PHASE',
    );

    await openActivity(fixture);
    expect(
      (await submitWithState(fixture, fixture.studentOne, 1, ['保留答案']))
        .ack,
    ).toEqual({ ok: true });
    const closingStates = fixture.sockets.map((socket) => waitForState(socket));
    expect(
      await sendCommand(fixture.teacher, 'activity:close', {}),
    ).toEqual({ ok: true });
    await Promise.all(closingStates);

    before = captureState(fixture.server);
    expectFailureUnchanged(
      fixture.server,
      before,
      await sendCommand(fixture.teacher, 'answer:void', {
        groupId: 'group-1',
        questionNumber: 1,
      }),
      'INVALID_PHASE',
    );
  });

  it('老師作廢成功保留 Submission 與答案，open 學生看到 voided，老師看板與進度排除該作答（FR-029、FR-030）', async () => {
    const fixture = await startFixture();
    await openActivity(fixture);
    expect(
      (
        await submitWithState(fixture, fixture.studentOne, 1, [
          '要被作廢的答案',
        ])
      ).ack,
    ).toEqual({ ok: true });

    const { ack, states } = await voidWithState(
      fixture,
      fixture.studentOne,
      'group-1',
      1,
    );
    expect(ack).toEqual({ ok: true });
    expect(submissions(fixture.server.db)).toMatchObject([
      {
        questionNumber: 1,
        groupId: 'group-1',
        rank: 1,
        voidedAt: expect.any(String),
      },
    ]);
    expect(submissionAnswers(fixture.server.db)).toEqual([
      {
        questionNumber: 1,
        groupId: 'group-1',
        blankPosition: 1,
        answerText: '要被作廢的答案',
      },
    ]);

    const studentState = states[1];
    if (
      studentState?.role !== 'student' ||
      studentState.phase !== 'open'
    ) {
      throw new Error('該組沒有收到 open 作廢快照');
    }
    expect(studentState.myAnswers[0]).toEqual({
      questionNumber: 1,
      state: 'voided',
      answers: ['要被作廢的答案'],
    });
    expect(JSON.stringify(studentState)).not.toContain('"rank"');

    const teacherState = states[0];
    if (teacherState?.role !== 'teacher') {
      throw new Error('老師沒有收到作廢快照');
    }
    const questionOne = teacherState.board.find(
      (question) => question.questionNumber === 1,
    );
    expect(questionOne?.winnerGroupId).toBeNull();
    expect(
      questionOne?.cells.find((cell) => cell.groupId === 'group-1'),
    ).toEqual({
      questionNumber: 1,
      groupId: 'group-1',
      groupName: '第一組',
      state: 'voided',
      answers: ['要被作廢的答案'],
      rank: 1,
    });
    expect(teacherState.progress.perQuestion[0]).toEqual({
      questionNumber: 1,
      submittedGroupCount: 0,
    });
    expect(
      teacherState.progress.perGroup.find(
        (entry) => entry.groupId === 'group-1',
      ),
    ).toEqual({ groupId: 'group-1', submittedQuestionCount: 0 });
  });

  it('題號、組別、有效作答不存在或 student 冒充老師都被拒，資料與 counter 完全不變（原則 III）', async () => {
    const fixture = await startFixture();
    await openActivity(fixture);

    const cases = [
      {
        socket: fixture.teacher,
        payload: { groupId: 'group-1', questionNumber: 99 },
        code: 'QUESTION_NOT_FOUND',
      },
      {
        socket: fixture.teacher,
        payload: { groupId: 'missing-group', questionNumber: 1 },
        code: 'GROUP_NOT_FOUND',
      },
      {
        socket: fixture.teacher,
        payload: { groupId: 'group-1', questionNumber: 1 },
        code: 'SUBMISSION_NOT_FOUND',
      },
      {
        socket: fixture.studentOne,
        payload: { groupId: 'group-1', questionNumber: 1 },
        code: 'FORBIDDEN',
      },
    ] as const;

    for (const testCase of cases) {
      const before = captureState(fixture.server);
      expectFailureUnchanged(
        fixture.server,
        before,
        await sendCommand(testCase.socket, 'answer:void', testCase.payload),
        testCase.code,
      );
    }
  });

  it('同筆不可作廢兩次；其他組 rank 不變、原 winner 由下一個有效 rank 接任，該組重送使用 max(rank)+1（AC-003-29、30）', async () => {
    const fixture = await startFixture();
    insertGroup(fixture.server.db, {
      id: 'group-3',
      name: '第三組',
      position: 3,
    });
    const studentThree = await connectStudent(
      fixture.server,
      'group-3',
      fixture.sockets,
    );
    fixture.sockets.push(studentThree);
    await openActivity(fixture);

    for (const [socket, answer] of [
      [fixture.studentOne, '第一組原始答案'],
      [fixture.studentTwo, '第二組答案'],
      [studentThree, '第三組答案'],
    ] as const) {
      expect(
        (await submitWithState(fixture, socket, 1, [answer])).ack,
      ).toEqual({ ok: true });
    }

    const { ack, states } = await voidWithState(
      fixture,
      fixture.studentOne,
      'group-1',
      1,
    );
    expect(ack).toEqual({ ok: true });
    expect(
      submissions(fixture.server.db).map(
        ({ groupId, rank, voidedAt }) => ({
          groupId,
          rank,
          voided: voidedAt !== null,
        }),
      ),
    ).toEqual([
      { groupId: 'group-1', rank: 1, voided: true },
      { groupId: 'group-2', rank: 2, voided: false },
      { groupId: 'group-3', rank: 3, voided: false },
    ]);

    const teacherAfterVoid = states[0];
    if (teacherAfterVoid?.role !== 'teacher') {
      throw new Error('老師沒有收到作廢後看板');
    }
    const boardAfterVoid = teacherAfterVoid.board.find(
      (question) => question.questionNumber === 1,
    );
    expect(boardAfterVoid?.winnerGroupId).toBe('group-2');
    expect(
      boardAfterVoid?.cells.find((cell) => cell.groupId === 'group-2')?.rank,
    ).toBe(2);
    expect(teacherAfterVoid.progress.perQuestion[0]).toEqual({
      questionNumber: 1,
      submittedGroupCount: 2,
    });
    expect(
      teacherAfterVoid.progress.perGroup.find(
        (entry) => entry.groupId === 'group-1',
      )?.submittedQuestionCount,
    ).toBe(0);

    const beforeDuplicate = captureState(fixture.server);
    expectFailureUnchanged(
      fixture.server,
      beforeDuplicate,
      await sendCommand(fixture.teacher, 'answer:void', {
        groupId: 'group-1',
        questionNumber: 1,
      }),
      'SUBMISSION_NOT_FOUND',
    );

    expect(
      (
        await submitWithState(fixture, fixture.studentOne, 1, [
          '第一組重新送出',
        ])
      ).ack,
    ).toEqual({ ok: true });
    expect(
      submissions(fixture.server.db).map(
        ({ groupId, rank, voidedAt }) => ({
          groupId,
          rank,
          voided: voidedAt !== null,
        }),
      ),
    ).toEqual([
      { groupId: 'group-1', rank: 1, voided: true },
      { groupId: 'group-2', rank: 2, voided: false },
      { groupId: 'group-3', rank: 3, voided: false },
      { groupId: 'group-1', rank: 4, voided: false },
    ]);
    expect(submissionAnswers(fixture.server.db)).toEqual([
      {
        questionNumber: 1,
        groupId: 'group-1',
        blankPosition: 1,
        answerText: '第一組原始答案',
      },
      {
        questionNumber: 1,
        groupId: 'group-2',
        blankPosition: 1,
        answerText: '第二組答案',
      },
      {
        questionNumber: 1,
        groupId: 'group-3',
        blankPosition: 1,
        answerText: '第三組答案',
      },
      {
        questionNumber: 1,
        groupId: 'group-1',
        blankPosition: 1,
        answerText: '第一組重新送出',
      },
    ]);
  });
});
