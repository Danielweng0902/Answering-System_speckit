import type { Socket } from 'socket.io-client';
import {
  STATE_EVENT,
  type Ack,
  type AnswerBoardQuestion,
  type AnswerProgress,
  type Snapshot,
  type StudentSnapshot,
  type TeacherSnapshot,
} from '@classroom/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import {
  getActivity,
  type Activity,
} from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import {
  seedQuestions,
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

type CapturedStates = {
  count: number;
  latest: Snapshot | null;
  all: Snapshot[];
};

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function activity(target: TestServer): Activity {
  const current = getActivity(target.db);
  if (!current) {
    throw new Error('Activity state is not initialized');
  }
  return current;
}

function answerRevision(target: TestServer, groupId: string): number {
  const row = target.db
    .prepare(
      `SELECT COALESCE(answer_revision, 0) AS answerRevision
       FROM group_answer_revisions
       WHERE group_id = ?`,
    )
    .get(groupId) as { answerRevision: number } | undefined;
  return row?.answerRevision ?? 0;
}

function answerEventCount(target: TestServer): number {
  const row = target.db
    .prepare(
      `SELECT answer_event_count AS answerEventCount
       FROM activity
       WHERE id = 1`,
    )
    .get() as { answerEventCount: number };
  return row.answerEventCount;
}

function captureStates(socket: Socket, captured: CapturedStates): void {
  socket.on(STATE_EVENT, (snapshot: Snapshot) => {
    captured.count += 1;
    captured.latest = snapshot;
    captured.all.push(snapshot);
  });
}

function expectStudentSnapshotIsOpen(
  snapshot: Snapshot,
): asserts snapshot is Extract<StudentSnapshot, { phase: 'open' }> {
  expect(snapshot).toMatchObject({ role: 'student', phase: 'open' });
}

function expectTeacherSnapshot(
  snapshot: Snapshot,
  phase: TeacherSnapshot['phase'],
): asserts snapshot is TeacherSnapshot {
  expect(snapshot).toMatchObject({ role: 'teacher', phase });
}

function expectNoRankKey(snapshot: Snapshot): void {
  expect(JSON.stringify(snapshot)).not.toContain('"rank"');
}

describe('answer:submit 可見範圍（US2；AC-003-09–12、SC-002）', () => {
  it('作答事件只送老師與送出組，其他組與 guest 的封包數與 revision 不改變', async () => {
    const target = await startTestServer();
    server = target;
    insertGroup(target.db, { id: 'group-a', name: '甲組', position: 1 });
    insertGroup(target.db, { id: 'group-b', name: '乙組', position: 2 });
    seedQuestions(target.db, [{ number: 1, prompt: '第一題題目' }]);

    const teacher = target.connect({
      token: issueSession(target.db, { role: 'teacher' }),
      autoConnect: false,
    });
    const teacherInitial = waitForState(teacher);
    teacher.connect();
    await teacherInitial;

    const studentA = target.connect({
      token: issueSession(target.db, {
        role: 'student',
        groupId: 'group-a',
      }),
      autoConnect: false,
    });
    const aInitial = waitForState(studentA);
    studentA.connect();
    await aInitial;

    const studentB = target.connect({
      token: issueSession(target.db, {
        role: 'student',
        groupId: 'group-b',
      }),
      autoConnect: false,
    });
    const bInitial = waitForState(studentB);
    studentB.connect();
    await bInitial;

    const guest = target.connect({ autoConnect: false });
    const guestInitial = waitForState(guest);
    guest.connect();
    await guestInitial;

    const openedStates = Promise.all([
      waitForState(teacher),
      waitForState(studentA),
      waitForState(studentB),
      waitForState(guest),
    ]);
    expect(await sendCommand(teacher, 'activity:open', {})).toEqual({
      ok: true,
    });
    const [teacherOpened, aOpened, bOpened, guestOpened] =
      await openedStates;

    const baseActivity = activity(target);
    const baseAnswerEventCount = answerEventCount(target);
    const baseARevision = answerRevision(target, 'group-a');
    const baseBRevision = answerRevision(target, 'group-b');
    expect(teacherOpened.revision).toBe(
      baseActivity.revision + baseAnswerEventCount,
    );
    expect(aOpened.revision).toBe(baseActivity.revision + baseARevision);
    expect(bOpened.revision).toBe(baseActivity.revision + baseBRevision);
    expect(guestOpened.revision).toBe(baseActivity.revision);

    const teacherPackets: CapturedStates = { count: 0, latest: null, all: [] };
    const aPackets: CapturedStates = { count: 0, latest: null, all: [] };
    const bPackets: CapturedStates = { count: 0, latest: null, all: [] };
    const guestPackets: CapturedStates = { count: 0, latest: null, all: [] };
    captureStates(teacher, teacherPackets);
    captureStates(studentA, aPackets);
    captureStates(studentB, bPackets);
    captureStates(guest, guestPackets);

    // AC-003-09：B 組不應收到任何 A 組送出造成的 state 封包。
    const expectedDirected = Promise.all([
      waitForState(teacher),
      waitForState(studentA),
    ]);
    expect(await sendCommand(studentA, 'answer:submit', {
      questionNumber: 1,
      answers: ['甲組秘密答案'],
    })).toEqual({ ok: true });
    await expectedDirected;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(bPackets.count).toBe(0);
    expect(guestPackets.count).toBe(0);
    expect(teacherPackets.count).toBe(1);
    expect(aPackets.count).toBe(1);
    expect(aPackets.all.at(-1)?.revision).toBe(
      baseActivity.revision + baseARevision + 1,
    );
    expect(teacherPackets.all.at(-1)?.revision).toBe(
      baseActivity.revision + baseAnswerEventCount + 1,
    );
    expect(bPackets.latest).toBeNull();
    expect(guestPackets.latest).toBeNull();
    expect(answerRevision(target, 'group-a')).toBe(baseARevision + 1);
    expect(answerRevision(target, 'group-b')).toBe(baseBRevision);
    expect(answerEventCount(target)).toBe(baseAnswerEventCount + 1);
    expect(activity(target).revision).toBe(baseActivity.revision);

    // AC-003-10、11：B 組送出後只看見自己已送出與自己的答案；ack 與快照都沒有 rank。
    const beforeBSubmitActivity = activity(target);
    const beforeBSubmitEventCount = answerEventCount(target);
    const beforeBSubmitARevision = answerRevision(target, 'group-a');
    const beforeBSubmitBRevision = answerRevision(target, 'group-b');
    const bDirected = Promise.all([
      waitForState(teacher),
      waitForState(studentB),
    ]);
    const bAck: Ack = await sendCommand(studentB, 'answer:submit', {
      questionNumber: 1,
      answers: ['乙組自己的答案'],
    });
    expect(bAck).toEqual({ ok: true });
    expect(bAck).not.toHaveProperty('rank');
    await bDirected;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(aPackets.count).toBe(1);
    expect(guestPackets.count).toBe(0);
    expect(teacherPackets.count).toBe(2);
    expect(bPackets.count).toBe(1);
    const bSnapshot = bPackets.all.at(-1);
    if (!bSnapshot) {
      throw new Error('B 組沒有收到自己的作答快照');
    }
    expectStudentSnapshotIsOpen(bSnapshot);
    expect(bSnapshot.myAnswers).toEqual([
      {
        questionNumber: 1,
        state: 'submitted',
        answers: ['乙組自己的答案'],
      },
    ]);
    expect(JSON.stringify(bSnapshot)).not.toContain('甲組秘密答案');
    expectNoRankKey(bSnapshot);
    expect(bSnapshot).not.toHaveProperty('board');
    expect(bSnapshot).not.toHaveProperty('progress');
    expect(bSnapshot).not.toHaveProperty('results');
    expect(answerRevision(target, 'group-a')).toBe(beforeBSubmitARevision);
    expect(answerRevision(target, 'group-b')).toBe(beforeBSubmitBRevision + 1);
    expect(answerEventCount(target)).toBe(beforeBSubmitEventCount + 1);
    expect(activity(target).revision).toBe(beforeBSubmitActivity.revision);
    expect(bSnapshot.revision).toBe(
      beforeBSubmitActivity.revision + beforeBSubmitBRevision + 1,
    );

    // AC-003-12：學生不能偽造組別；teacher 與 guest 也不能用答案指令。
    expect(
      await sendCommand(studentB, 'answer:submit', {
        questionNumber: 2,
        answers: ['企圖代替甲組'],
        groupId: 'group-a',
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(
      await sendCommand(teacher, 'answer:submit', {
        questionNumber: 2,
        answers: ['企圖以老師身分送出'],
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await sendCommand(guest, 'answer:submit', {
        questionNumber: 2,
        answers: ['企圖以訪客身分送出'],
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(teacherPackets.count).toBe(2);
    expect(aPackets.count).toBe(1);
    expect(bPackets.count).toBe(1);
    expect(guestPackets.count).toBe(0);
  });
});

describe('老師看板與進度（US3；T027；AC-003-13–16、FR-019–FR-022；SC-003）', () => {
  it('送出後老師快照即時更新 board 與 progress，closed 維持結束內容；學生與 guest 快照沒有 board/progress', async () => {
    const target = await startTestServer();
    server = target;
    insertGroup(target.db, { id: 'group-a', name: '甲組', position: 1 });
    insertGroup(target.db, { id: 'group-b', name: '乙組', position: 2 });
    seedQuestions(target.db, [
      {
        number: 1,
        prompt: '第一題題目',
        kind: 'group',
        blanks: [
          { position: 1, prefix: '（1）', cell: 'G5' },
          { position: 2, prefix: '（2）', cell: 'G6' },
        ],
      },
      { number: 2, prompt: '第二題題目' },
    ]);

    const teacher = target.connect({
      token: issueSession(target.db, { role: 'teacher' }),
      autoConnect: false,
    });
    const studentA = target.connect({
      token: issueSession(target.db, {
        role: 'student',
        groupId: 'group-a',
      }),
      autoConnect: false,
    });
    const studentB = target.connect({
      token: issueSession(target.db, {
        role: 'student',
        groupId: 'group-b',
      }),
      autoConnect: false,
    });
    const guest = target.connect({ autoConnect: false });
    const sockets = [teacher, studentA, studentB, guest];
    const initialStates = sockets.map((socket) => waitForState(socket));
    for (const socket of sockets) socket.connect();
    await Promise.all(initialStates);

    const openedStates = sockets.map((socket) => waitForState(socket));
    expect(await sendCommand(teacher, 'activity:open', {})).toEqual({
      ok: true,
    });
    const [teacherOpened, aOpened, , guestOpened] =
      await Promise.all(openedStates);
    if (teacherOpened === undefined) throw new Error('老師沒有收到 open 快照');

    // 未作答時：老師看板每題每組固定一筆 not_submitted cell、winner 為 null、
    // 進度全 0（FR-019–FR-022：任何階段都有 board 與 progress）。
    expectTeacherSnapshot(teacherOpened, 'open');
    const notSubmittedCell = (
      questionNumber: number,
      groupId: string,
      groupName: string,
    ) => ({
      questionNumber,
      groupId,
      groupName,
      state: 'not_submitted' as const,
      answers: [],
      rank: null,
    });
    expect(teacherOpened.board).toEqual([
      {
        questionNumber: 1,
        winnerGroupId: null,
        cells: [
          notSubmittedCell(1, 'group-a', '甲組'),
          notSubmittedCell(1, 'group-b', '乙組'),
        ],
      },
      {
        questionNumber: 2,
        winnerGroupId: null,
        cells: [
          notSubmittedCell(2, 'group-a', '甲組'),
          notSubmittedCell(2, 'group-b', '乙組'),
        ],
      },
    ]);
    expect(teacherOpened.progress).toEqual({
      perQuestion: [
        { questionNumber: 1, submittedGroupCount: 0 },
        { questionNumber: 2, submittedGroupCount: 0 },
      ],
      perGroup: [
        { groupId: 'group-a', submittedQuestionCount: 0 },
        { groupId: 'group-b', submittedQuestionCount: 0 },
      ],
    });
    // 原則 VI：學生與 guest 快照絕不含 board／progress。
    for (const snapshot of [aOpened, guestOpened]) {
      if (snapshot === undefined) throw new Error('沒有收到快照');
      expect(snapshot).not.toHaveProperty('board');
      expect(snapshot).not.toHaveProperty('progress');
    }

    // 甲組送出第 1 題（兩空格）：waitForState 的 2 秒逾時即 SC-003／FR-021
    // 的即時更新驗證；answers 依 blank position 排列（AC-003-25 老師側）。
    const afterA = waitForState(teacher);
    expect(
      await sendCommand(studentA, 'answer:submit', {
        questionNumber: 1,
        answers: ['甲組第一格', '甲組第二格'],
      }),
    ).toEqual({ ok: true });
    const teacherAfterA = await afterA;
    expectTeacherSnapshot(teacherAfterA, 'open');
    const expectedAfterA: AnswerBoardQuestion[] = [
      {
        questionNumber: 1,
        winnerGroupId: 'group-a',
        cells: [
          {
            questionNumber: 1,
            groupId: 'group-a',
            groupName: '甲組',
            state: 'submitted',
            answers: ['甲組第一格', '甲組第二格'],
            rank: 1,
          },
          notSubmittedCell(1, 'group-b', '乙組'),
        ],
      },
      {
        questionNumber: 2,
        winnerGroupId: null,
        cells: [
          notSubmittedCell(2, 'group-a', '甲組'),
          notSubmittedCell(2, 'group-b', '乙組'),
        ],
      },
    ];
    expect(teacherAfterA.board).toEqual(expectedAfterA);
    expect(teacherAfterA.progress).toEqual({
      perQuestion: [
        { questionNumber: 1, submittedGroupCount: 1 },
        { questionNumber: 2, submittedGroupCount: 0 },
      ],
      perGroup: [
        { groupId: 'group-a', submittedQuestionCount: 1 },
        { groupId: 'group-b', submittedQuestionCount: 0 },
      ],
    });

    // 乙組送出第 1 題：rank 2、winner 仍是甲組（decideWinner 取最小有效 rank）。
    const afterBFirst = waitForState(teacher);
    expect(
      await sendCommand(studentB, 'answer:submit', {
        questionNumber: 1,
        answers: ['乙組第一格', '乙組第二格'],
      }),
    ).toEqual({ ok: true });
    const teacherAfterBFirst = await afterBFirst;
    expectTeacherSnapshot(teacherAfterBFirst, 'open');
    const expectedAfterBFirst: AnswerBoardQuestion[] = [
      {
        questionNumber: 1,
        winnerGroupId: 'group-a',
        cells: [
          expectedAfterA[0]!.cells[0]!,
          {
            questionNumber: 1,
            groupId: 'group-b',
            groupName: '乙組',
            state: 'submitted',
            answers: ['乙組第一格', '乙組第二格'],
            rank: 2,
          },
        ],
      },
      expectedAfterA[1]!,
    ];
    expect(teacherAfterBFirst.board).toEqual(expectedAfterBFirst);

    // 乙組再送第 2 題：各題 rank 獨立（rank 1），progress 每組題數更新。
    const afterBSecond = waitForState(teacher);
    expect(
      await sendCommand(studentB, 'answer:submit', {
        questionNumber: 2,
        answers: ['乙組第二題答案'],
      }),
    ).toEqual({ ok: true });
    const teacherAfterBSecond = await afterBSecond;
    expectTeacherSnapshot(teacherAfterBSecond, 'open');
    const expectedFinalBoard: AnswerBoardQuestion[] = [
      expectedAfterBFirst[0]!,
      {
        questionNumber: 2,
        winnerGroupId: 'group-b',
        cells: [
          notSubmittedCell(2, 'group-a', '甲組'),
          {
            questionNumber: 2,
            groupId: 'group-b',
            groupName: '乙組',
            state: 'submitted',
            answers: ['乙組第二題答案'],
            rank: 1,
          },
        ],
      },
    ];
    const expectedFinalProgress: AnswerProgress = {
      perQuestion: [
        { questionNumber: 1, submittedGroupCount: 2 },
        { questionNumber: 2, submittedGroupCount: 1 },
      ],
      perGroup: [
        { groupId: 'group-a', submittedQuestionCount: 1 },
        { groupId: 'group-b', submittedQuestionCount: 2 },
      ],
    };
    expect(teacherAfterBSecond.board).toEqual(expectedFinalBoard);
    expect(teacherAfterBSecond.progress).toEqual(expectedFinalProgress);

    // AC-003-16：closed 後老師看板維持結束當下內容；學生與 guest 快照仍然
    // 沒有 board／progress。
    const closedStates = sockets.map((socket) => waitForState(socket));
    expect(await sendCommand(teacher, 'activity:close', {})).toEqual({
      ok: true,
    });
    const [teacherClosed, , bClosed, guestClosed] =
      await Promise.all(closedStates);
    if (teacherClosed === undefined) {
      throw new Error('老師沒有收到 closed 快照');
    }
    expectTeacherSnapshot(teacherClosed, 'closed');
    expect(teacherClosed.board).toEqual(expectedFinalBoard);
    expect(teacherClosed.progress).toEqual(expectedFinalProgress);
    for (const snapshot of [bClosed, guestClosed]) {
      if (snapshot === undefined) throw new Error('沒有收到快照');
      expect(snapshot).not.toHaveProperty('board');
      expect(snapshot).not.toHaveProperty('progress');
    }
  });
});
