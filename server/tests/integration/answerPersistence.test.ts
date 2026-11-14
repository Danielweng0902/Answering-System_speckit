import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Socket } from 'socket.io-client';
import type {
  ImportSummary,
  Snapshot,
  StudentOpenSnapshot,
  StudentPreparingSnapshot,
  StudentSnapshot,
} from '@classroom/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import {
  getAnswerEventCount,
  getSessionId,
} from '../../src/infra/db/activityRepo.js';
import { getGroupAnswerRevision } from '../../src/infra/db/answerRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { count as countQuestions } from '../../src/infra/db/questionRepo.js';
import {
  seedQuestions,
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

const OFFICIAL_SINGLE_XLSX = fileURLToPath(
  new URL(
    '../../../fixtures/guided-notes/01-official-single.xlsx',
    import.meta.url,
  ),
);

type SubmissionRow = {
  id: string;
  questionId: string;
  questionNumber: number;
  groupId: string;
  rank: number;
  receivedAt: string;
  voidedAt: string | null;
};

type SubmissionAnswerRow = {
  submissionId: string;
  blankPosition: number;
  answerText: string;
};

type PersistedAnswerState = {
  submissions: SubmissionRow[];
  answers: SubmissionAnswerRow[];
  groupOneAnswerRevision: number;
  groupTwoAnswerRevision: number;
  answerEventCount: number;
  sessionId: string;
};

let server: TestServer | undefined;
let officialSingle: Uint8Array;

beforeAll(async () => {
  officialSingle = new Uint8Array(await readFile(OFFICIAL_SINGLE_XLSX));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function submissions(database: TestServer['db']): SubmissionRow[] {
  return database
    .prepare(
      `SELECT s.id, s.question_id AS questionId, q.number AS questionNumber,
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
      `SELECT submission_id AS submissionId,
              blank_position AS blankPosition,
              answer_text AS answerText
       FROM submission_answers
       ORDER BY submission_id, blank_position`,
    )
    .all() as SubmissionAnswerRow[];
}

function persistedAnswerState(target: TestServer): PersistedAnswerState {
  return {
    submissions: submissions(target.db),
    answers: submissionAnswers(target.db),
    groupOneAnswerRevision: getGroupAnswerRevision(target.db, 'group-1'),
    groupTwoAnswerRevision: getGroupAnswerRevision(target.db, 'group-2'),
    answerEventCount: getAnswerEventCount(target.db),
    sessionId: getSessionId(target.db),
  };
}

function requiredState(snapshot: Snapshot | undefined): Snapshot {
  if (snapshot === undefined) {
    throw new Error('Expected a state snapshot');
  }
  return snapshot;
}

async function connectWithInitial(
  target: TestServer,
  token?: string,
): Promise<{ socket: Socket; initial: Snapshot }> {
  const socket = target.connect(
    token === undefined ? { autoConnect: false } : { token, autoConnect: false },
  );
  const statePromise = waitForState(socket);
  socket.connect();
  return { socket, initial: await statePromise };
}

function openStudentSnapshot(snapshot: Snapshot): StudentOpenSnapshot {
  expect(snapshot).toMatchObject({ role: 'student', phase: 'open' });
  return snapshot as StudentOpenSnapshot;
}

function studentSnapshot(
  snapshot: Snapshot,
  phase: 'open' | 'preparing',
): StudentOpenSnapshot | StudentPreparingSnapshot {
  expect(snapshot).toMatchObject({ role: 'student', phase });
  return snapshot as Extract<StudentSnapshot, { phase: typeof phase }>;
}

async function setupBuzzInFixture(): Promise<{
  teacherToken: string;
  teacher: Socket;
  studentOne: Socket;
  studentTwo: Socket;
  sockets: Socket[];
}> {
  if (!server) {
    throw new Error('Test server is not initialized');
  }
  const target = server;
  insertGroup(target.db, { id: 'group-1', name: '第一組', position: 1 });
  insertGroup(target.db, { id: 'group-2', name: '第二組', position: 2 });
  seedQuestions(target.db, [
    { number: 1, prompt: '第一題題目' },
    { number: 2, prompt: '第二題題目' },
  ]);

  const teacherToken = issueSession(target.db, { role: 'teacher' });
  const { socket: teacher } = await connectWithInitial(target, teacherToken);
  const { socket: studentOne } = await connectWithInitial(
    target,
    issueSession(target.db, { role: 'student', groupId: 'group-1' }),
  );
  const { socket: studentTwo } = await connectWithInitial(
    target,
    issueSession(target.db, { role: 'student', groupId: 'group-2' }),
  );

  return {
    teacherToken,
    teacher,
    studentOne,
    studentTwo,
    sockets: [teacher, studentOne, studentTwo],
  };
}

async function openActivity(sockets: Socket[], teacher: Socket): Promise<void> {
  const states = sockets.map((socket) => waitForState(socket));
  expect(await sendCommand(teacher, 'activity:open', {})).toEqual({
    ok: true,
  });
  await Promise.all(states);
}

async function submit(
  teacher: Socket,
  student: Socket,
  questionNumber: number,
  answers: string[],
): Promise<Snapshot> {
  const states = [waitForState(teacher), waitForState(student)];
  expect(
    await sendCommand(student, 'answer:submit', {
      questionNumber,
      answers,
    }),
  ).toEqual({ ok: true });
  const [, studentState] = await Promise.all(states);
  return requiredState(studentState);
}

describe('US6 作答保存（AC-003-27、32；FR-026–FR-028；SC-006）', () => {
  it('多組送出後以同一資料夾重啟：Submission、rank、counter 與 sessionId 完全相同', async () => {
    server = await startTestServer();
    const dataDir = server.dataDir;
    const fixture = await setupBuzzInFixture();
    await openActivity(fixture.sockets, fixture.teacher);

    await submit(fixture.teacher, fixture.studentOne, 1, ['一組第一題']);
    await submit(fixture.teacher, fixture.studentTwo, 1, ['二組第一題']);
    await submit(fixture.teacher, fixture.studentOne, 2, ['一組第二題']);
    const studentTwoToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-2',
    });

    const before = persistedAnswerState(server);
    expect(before.submissions).toHaveLength(3);
    expect(before.submissions.map((row) => row.rank)).toEqual([1, 2, 1]);
    expect(before.groupOneAnswerRevision).toBe(2);
    expect(before.groupTwoAnswerRevision).toBe(1);
    expect(before.answerEventCount).toBe(3);

    await server.close({ preserveDataDir: true });
    server = await startTestServer({ dataDir });
    const after = persistedAnswerState(server);
    expect(after).toEqual(before);

    // 舊學生 token 重連後仍由保存資料讀回同一活動與本組作答，不重排重建。
    const reconnected = await connectWithInitial(server, studentTwoToken);
    const snapshot = openStudentSnapshot(reconnected.initial);
    expect(snapshot.sessionId).toBe(before.sessionId);
    expect(snapshot.myAnswers).toEqual([
      {
        questionNumber: 1,
        state: 'submitted',
        answers: ['二組第一題'],
      },
      { questionNumber: 2, state: 'not_submitted', answers: [] },
    ]);
  });

  it('activity:reset 清空作答、sessionId 換新，兩個 counter 不歸零且學生 revision 不回頭', async () => {
    server = await startTestServer();
    const fixture = await setupBuzzInFixture();
    await openActivity(fixture.sockets, fixture.teacher);
    const submittedState = await submit(fixture.teacher, fixture.studentOne, 1, [
      '重設前的答案',
    ]);
    const beforeReset = persistedAnswerState(server);
    const acceptedRevisionBeforeReset = submittedState.revision;

    const closingStates = fixture.sockets.map((socket) => waitForState(socket));
    expect(
      await sendCommand(fixture.teacher, 'activity:close', {}),
    ).toEqual({ ok: true });
    await Promise.all(closingStates);

    const resettingStates = fixture.sockets.map((socket) => waitForState(socket));
    expect(
      await sendCommand(fixture.teacher, 'activity:reset', { confirm: true }),
    ).toEqual({ ok: true });
    const [, resetStudentState] = await Promise.all(resettingStates);
    const preparingSnapshot = studentSnapshot(
      requiredState(resetStudentState),
      'preparing',
    ) as StudentPreparingSnapshot;

    expect(submissions(server.db)).toEqual([]);
    expect(submissionAnswers(server.db)).toEqual([]);
    expect(getSessionId(server.db)).not.toBe(beforeReset.sessionId);
    expect(getSessionId(server.db)).toEqual(expect.any(String));
    expect(getGroupAnswerRevision(server.db, 'group-1')).toBe(
      beforeReset.groupOneAnswerRevision,
    );
    expect(getGroupAnswerRevision(server.db, 'group-2')).toBe(
      beforeReset.groupTwoAnswerRevision,
    );
    expect(getAnswerEventCount(server.db)).toBe(beforeReset.answerEventCount);
    expect(preparingSnapshot.sessionId).toBe(getSessionId(server.db));
    expect(preparingSnapshot.revision).toBeGreaterThanOrEqual(
      acceptedRevisionBeforeReset,
    );

    // 重新開啟後作答區不再有任何已送出答案，但 counter 仍維持持久值。
    const reopenedStates = fixture.sockets.map((socket) =>
      waitForState(socket),
    );
    expect(
      await sendCommand(fixture.teacher, 'activity:open', {}),
    ).toEqual({ ok: true });
    const [, reopenedStudentState] = await Promise.all(reopenedStates);
    const openSnapshot = openStudentSnapshot(
      requiredState(reopenedStudentState),
    );
    expect(openSnapshot.sessionId).toBe(preparingSnapshot.sessionId);
    expect(openSnapshot.myAnswers).toEqual([
      { questionNumber: 1, state: 'not_submitted', answers: [] },
      { questionNumber: 2, state: 'not_submitted', answers: [] },
    ]);
    expect(openSnapshot.revision).toBeGreaterThan(preparingSnapshot.revision);
  });

  it('questions:confirm 成功取代題目時 sessionId 換新且學生快照同步', async () => {
    server = await startTestServer();
    const fixture = await setupBuzzInFixture();
    const before = persistedAnswerState(server);
    expect(countQuestions(server.db)).toBe(2);

    const response = await fetch(
      `${server.url}/api/questions/import/file`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${fixture.teacherToken}`,
          'content-type': 'application/octet-stream',
          'x-file-name': encodeURIComponent('new-official-single.xlsx'),
        },
        body: officialSingle,
      },
    );
    expect(response.status).toBe(200);
    const summary = (await response.json()) as ImportSummary;
    expect(summary.questionCount).toBe(6);

    const states = [fixture.teacher, fixture.studentOne].map((socket) =>
      waitForState(socket),
    );
    expect(
      await sendCommand(fixture.teacher, 'questions:confirm', {
        importId: summary.importId,
      }),
    ).toEqual({ ok: true });
    const [, confirmedStudentState] = await Promise.all(states);

    expect(countQuestions(server.db)).toBe(6);
    expect(getSessionId(server.db)).not.toBe(before.sessionId);
    expect(
      studentSnapshot(requiredState(confirmedStudentState), 'preparing'),
    ).toMatchObject({
      phase: 'preparing',
      sessionId: getSessionId(server.db),
    });
    expect(getAnswerEventCount(server.db)).toBe(before.answerEventCount);
  });
});
