import type { Socket } from 'socket.io-client';
import type {
  Ack,
  Snapshot,
  StudentClosedSnapshot,
} from '@classroom/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import { createSnapshot } from '../../src/app/snapshot.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import {
  seedQuestions,
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

const FIXED_NOW = new Date('2026-11-12T10:00:00.000Z');

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

type Fixture = {
  server: TestServer;
  teacher: Socket;
  studentOne: Socket;
  studentTwo: Socket;
  studentOneToken: string;
  sockets: Socket[];
};

async function startFixture(): Promise<Fixture> {
  const target = await startTestServer();
  server = target;
  insertGroup(target.db, { id: 'group-1', name: '第一組', position: 1 });
  insertGroup(target.db, { id: 'group-2', name: '第二組', position: 2 });
  seedQuestions(target.db, [
    { number: 1, prompt: '第一題題目' },
    { number: 2, prompt: '第二題題目' },
    { number: 3, prompt: '第三題題目（無人作答）' },
  ]);

  const teacherToken = issueSession(target.db, { role: 'teacher' });
  const teacher = target.connect({ token: teacherToken, autoConnect: false });
  const teacherInitial = waitForState(teacher);
  teacher.connect();
  await teacherInitial;

  const studentOneToken = issueSession(target.db, {
    role: 'student',
    groupId: 'group-1',
  });
  const studentOne = target.connect({
    token: studentOneToken,
    autoConnect: false,
  });
  const studentOneInitial = waitForState(studentOne);
  const teacherSeesOne = waitForState(teacher);
  studentOne.connect();
  await Promise.all([studentOneInitial, teacherSeesOne]);

  const studentTwoToken = issueSession(target.db, {
    role: 'student',
    groupId: 'group-2',
  });
  const studentTwo = target.connect({
    token: studentTwoToken,
    autoConnect: false,
  });
  const studentTwoInitial = waitForState(studentTwo);
  const teacherSeesTwo = waitForState(teacher);
  const studentOneSeesTwo = waitForState(studentOne);
  studentTwo.connect();
  await Promise.all([studentTwoInitial, teacherSeesTwo, studentOneSeesTwo]);

  return {
    server: target,
    teacher,
    studentOne,
    studentTwo,
    studentOneToken,
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

async function submit(
  fixture: Fixture,
  socket: Socket,
  questionNumber: number,
  answers: string[],
): Promise<Ack> {
  // US2 定向廣播：送出成功只有老師與該組成員收到新快照。
  const states = [waitForState(fixture.teacher), waitForState(socket)];
  const ack = await sendCommand(socket, 'answer:submit', {
    questionNumber,
    answers,
  });
  expect(ack).toEqual({ ok: true });
  await Promise.all(states);
  return ack;
}

/** 兩組作答後結束，回傳每個連線在 activity:close 收到的快照（SC-005）。 */
async function closeAndCapture(
  fixture: Fixture,
): Promise<Map<Socket, Snapshot>> {
  const states = fixture.sockets.map(
    async (socket) => [socket, await waitForState(socket)] as const,
  );
  expect(
    await sendCommand(fixture.teacher, 'activity:close', {}),
  ).toEqual({ ok: true });
  return new Map(await Promise.all(states));
}

function closedStudent(
  snapshot: Snapshot | undefined,
  groupId: string,
): StudentClosedSnapshot {
  expect(snapshot).toMatchObject({
    role: 'student',
    phase: 'closed',
    myGroupId: groupId,
  });
  return snapshot as StudentClosedSnapshot;
}

describe('US4 搶答結束後檢視結果（AC-003-17–21、FR-013、FR-023–FR-025、SC-005）', () => {
  it('activity:close 後學生連線收到含 questions、results 與含 rank myAnswers 的 closed 快照（AC-003-17–19、SC-005）', async () => {
    const fixture = await startFixture();
    await openActivity(fixture);

    await submit(fixture, fixture.studentOne, 1, ['第一組第一題答案']);
    await submit(fixture, fixture.studentTwo, 1, ['第二組第一題答案']);
    // 特殊字元答案照原字保留，不做任何 HTML 解析或過濾（Edge Cases）。
    await submit(fixture, fixture.studentTwo, 2, [
      '<script>alert(1)</script>',
    ]);

    const snapshots = await closeAndCapture(fixture);

    const groupOne = closedStudent(snapshots.get(fixture.studentOne), 'group-1');
    const expectedQuestions = [
      {
        number: 1,
        kind: 'single',
        prompt: '第一題題目',
        blanks: [{ position: 1, prefix: '' }],
      },
      {
        number: 2,
        kind: 'single',
        prompt: '第二題題目',
        blanks: [{ position: 1, prefix: '' }],
      },
      {
        number: 3,
        kind: 'single',
        prompt: '第三題題目（無人作答）',
        blanks: [{ position: 1, prefix: '' }],
      },
    ];
    expect(groupOne.questions).toEqual(expectedQuestions);
    // results 每題固定一筆，winner 由 decideWinner 判定（FR-010、FR-014）。
    expect(groupOne.results).toEqual([
      {
        questionNumber: 1,
        winner: {
          groupId: 'group-1',
          groupName: '第一組',
          answers: ['第一組第一題答案'],
        },
      },
      {
        questionNumber: 2,
        winner: {
          groupId: 'group-2',
          groupName: '第二組',
          answers: ['<script>alert(1)</script>'],
        },
      },
      // 無有效作答的題目 winner 為 null，前端顯示無人作答（FR-025）。
      { questionNumber: 3, winner: null },
    ]);
    expect(groupOne.myAnswers).toEqual([
      {
        questionNumber: 1,
        state: 'submitted',
        answers: ['第一組第一題答案'],
        rank: 1,
      },
      { questionNumber: 2, state: 'not_submitted', answers: [], rank: null },
      { questionNumber: 3, state: 'not_submitted', answers: [], rank: null },
    ]);
    expect(groupOne).not.toHaveProperty('board');
    expect(groupOne).not.toHaveProperty('progress');

    const groupTwo = closedStudent(snapshots.get(fixture.studentTwo), 'group-2');
    expect(groupTwo.questions).toEqual(expectedQuestions);
    // 兩組看到的 results 相同；myAnswers 各自不同（FR-024）。
    expect(groupTwo.results).toEqual(groupOne.results);
    expect(groupTwo.myAnswers).toEqual([
      {
        questionNumber: 1,
        state: 'submitted',
        answers: ['第二組第一題答案'],
        rank: 2,
      },
      {
        questionNumber: 2,
        state: 'submitted',
        answers: ['<script>alert(1)</script>'],
        rank: 1,
      },
      { questionNumber: 3, state: 'not_submitted', answers: [], rank: null },
    ]);
  });

  it('closed 後 answer:submit 回 INVALID_PHASE，作答、counter 與結果不變（AC-003-20、FR-013）', async () => {
    const fixture = await startFixture();
    await openActivity(fixture);
    await submit(fixture, fixture.studentOne, 1, ['原本答案']);
    await closeAndCapture(fixture);

    const before = createSnapshot(
      fixture.server.db,
      { role: 'student', groupId: 'group-1' },
      {},
      FIXED_NOW,
    );
    const ack = await sendCommand(fixture.studentOne, 'answer:submit', {
      questionNumber: 1,
      answers: ['結束後的答案'],
    });
    expect(ack).toEqual({
      ok: false,
      error: { code: 'INVALID_PHASE', message: expect.any(String) },
    });
    // 失敗後的 closed 快照（含 results、myAnswers 與 revision）完全不變（原則 III）。
    expect(
      createSnapshot(
        fixture.server.db,
        { role: 'student', groupId: 'group-1' },
        {},
        FIXED_NOW,
      ),
    ).toEqual(before);
    const rows = fixture.server.db
      .prepare('SELECT group_id AS groupId, rank FROM submissions')
      .all();
    expect(rows).toEqual([{ groupId: 'group-1', rank: 1 }]);
  });

  it('重新連線後的 closed 快照內容相同（AC-003-21、FR-026）', async () => {
    const fixture = await startFixture();
    await openActivity(fixture);
    await submit(fixture, fixture.studentOne, 1, ['第一組第一題答案']);
    await submit(fixture, fixture.studentTwo, 1, ['第二組第一題答案']);
    const snapshots = await closeAndCapture(fixture);
    const before = closedStudent(
      snapshots.get(fixture.studentOne),
      'group-1',
    );

    // 重新整理／斷線重連以同一 token 建立新連線，讀回同一份結果。
    fixture.studentOne.disconnect();
    const reconnected = fixture.server.connect({
      token: fixture.studentOneToken,
      autoConnect: false,
    });
    const initial = waitForState(reconnected);
    reconnected.connect();
    const after = closedStudent(await initial, 'group-1');

    expect(after.questions).toEqual(before.questions);
    expect(after.results).toEqual(before.results);
    expect(after.myAnswers).toEqual(before.myAnswers);
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.groups).toEqual(before.groups);
  });
});
