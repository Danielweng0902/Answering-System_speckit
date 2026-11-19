import type { Socket } from 'socket.io-client';
import type { ProjectorSnapshot, Snapshot } from '@classroom/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import {
  getActivity,
  updateActivity,
} from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import {
  seedQuestions,
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

type Fixture = {
  server: TestServer;
  teacher: Socket;
  projector: Socket;
};

async function startFixture(): Promise<Fixture> {
  const target = await startTestServer();
  server = target;
  insertGroup(target.db, { id: 'group-1', name: '第一組', position: 1 });
  insertGroup(target.db, { id: 'group-2', name: '第二組', position: 2 });
  seedQuestions(target.db, [
    { number: 1, prompt: '第一題題目' },
    { number: 2, prompt: '第二題題目' },
  ]);

  const teacherToken = issueSession(target.db, { role: 'teacher' });
  const teacher = target.connect({ token: teacherToken, autoConnect: false });
  const teacherInitial = waitForState(teacher);
  teacher.connect();
  await teacherInitial;

  // 005：投影連線以 view: 'projector' 握手，伺服器改送投影快照。
  const projector = target.connect({
    token: teacherToken,
    autoConnect: false,
    view: 'projector',
  });
  const projectorInitial = waitForState(projector);
  projector.connect();
  await projectorInitial;

  return { server: target, teacher, projector };
}

function setPhase(
  target: TestServer,
  phase: 'preparing' | 'open' | 'closed',
): void {
  const activity = getActivity(target.db);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }
  updateActivity(target.db, {
    ...activity,
    phase,
    revision: activity.revision + 1,
  });
}

function insertSubmission(
  target: TestServer,
  options: {
    id: string;
    questionNumber: number;
    groupId: string;
    rank: number;
    receivedAt: string;
  },
): void {
  const question = target.db
    .prepare('SELECT id FROM questions WHERE number = ?')
    .get(options.questionNumber) as { id: string };
  target.db
    .prepare(
      `INSERT INTO submissions
         (id, question_id, group_id, rank, received_at, voided_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      options.id,
      question.id,
      options.groupId,
      options.rank,
      options.receivedAt,
    );
  target.db
    .prepare(
      `INSERT INTO submission_answers
         (submission_id, blank_position, answer_text)
       VALUES (?, 1, ?)`,
    )
    .run(options.id, `${options.groupId}-${options.questionNumber}`);
}

function asProjector(snapshot: Snapshot): ProjectorSnapshot {
  if (snapshot.role !== 'projector') {
    throw new Error(`預期為投影快照，實際為 ${snapshot.role}`);
  }
  return snapshot;
}

describe('005 投影看板（US3；T023）', () => {
  it('搶答中的投影快照完全不含答案、送出狀態與送出數量（FR-015、SC-004）', async () => {
    const fixture = await startFixture();
    insertSubmission(fixture.server, {
      id: 'p1',
      questionNumber: 1,
      groupId: 'group-1',
      rank: 1,
      receivedAt: '2026-11-17T09:00:00.000Z',
    });
    await sendCommand(fixture.teacher, 'activity:open', {});

    const state = await waitForState(fixture.projector);
    const projector = asProjector(state);

    expect(projector.phase).toBe('open');
    expect(projector.reveal.questions).toEqual([]);
    expect(projector.reveal.revealedQuestionCount).toBe(0);
    expect(projector.groupStatus.map((group) => group.online)).toEqual([
      false,
      false,
    ]);
    const serialized = JSON.stringify(projector);
    expect(serialized).not.toContain('第一組第一題');
    expect(serialized).not.toContain('"answers"');
    expect(serialized).not.toContain('"rank"');
    expect(serialized).not.toContain('"cells"');
  });

  it('學生送出答案後，投影連線仍只收到投影快照（2026-11-19 review 發現的 bug）', async () => {
    const target = await startTestServer();
    server = target;
    insertGroup(target.db, { id: 'group-1', name: '第一組', position: 1 });
    seedQuestions(target.db, [{ number: 1, prompt: '第一題題目' }]);

    const teacherToken = issueSession(target.db, { role: 'teacher' });
    const teacher = target.connect({ token: teacherToken, autoConnect: false });
    const teacherInitial = waitForState(teacher);
    teacher.connect();
    await teacherInitial;

    const projector = target.connect({
      token: teacherToken,
      autoConnect: false,
      view: 'projector',
    });
    const projectorInitial = waitForState(projector);
    projector.connect();
    await projectorInitial;

    const studentToken = issueSession(target.db, {
      role: 'student',
      groupId: 'group-1',
    });
    const student = target.connect({ token: studentToken, autoConnect: false });
    const studentInitial = waitForState(student);
    student.connect();
    await studentInitial;

    await sendCommand(teacher, 'activity:open', {});

    // 學生送出答案 → 伺服器會用 broadcastSubmissionChanged 廣播給老師連線。
    // 這條路徑以前送「一般老師快照」給投影連線，前端因此跳回登入畫面，
    // 而且一般快照含作答資訊（FR-015／FR-022：投影連線只收投影快照）。
    const projectorState = waitForState(projector);
    const ack = await sendCommand(student, 'answer:submit', {
      questionNumber: 1,
      answers: ['甲答案'],
    });
    expect(ack).toEqual({ ok: true });

    const state = await projectorState;
    expect(state.role).toBe('projector');
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain('"answers"');
    expect(serialized).not.toContain('"cells"');
    expect(serialized).not.toContain('甲答案');
  });

  it('非老師身分連線不會取得投影快照（FR-022、AC-005-18）', async () => {
    const target = await startTestServer();
    server = target;
    insertGroup(target.db, { id: 'group-1', name: '第一組', position: 1 });
    seedQuestions(target.db, [{ number: 1, prompt: '第一題題目' }]);

    const studentToken = issueSession(target.db, {
      role: 'student',
      groupId: 'group-1',
    });
    const socket = target.connect({
      token: studentToken,
      autoConnect: false,
      view: 'projector',
    });
    const initial = waitForState(socket);
    socket.connect();
    const state = await initial;

    expect(state.role).toBe('student');
    expect(state).not.toHaveProperty('reveal');
    expect(state).not.toHaveProperty('groupStatus');
  });

  it('只有老師、只有在已結束能揭曉；依題號順序逐題揭曉（FR-017、AC-005-16）', async () => {
    const fixture = await startFixture();
    setPhase(fixture.server, 'open');

    const tooEarly = await sendCommand(fixture.teacher, 'reveal:next', {});
    expect(tooEarly).toEqual({
      ok: false,
      error: { code: 'INVALID_PHASE', message: expect.any(String) },
    });

    setPhase(fixture.server, 'closed');
    // 廣播在 ack 之前送出，所以先掛等待再送指令。
    const statePromise = waitForState(fixture.projector);
    const ack = await sendCommand(fixture.teacher, 'reveal:next', {});
    expect(ack).toEqual({ ok: true });
    expect(getActivity(fixture.server.db)!.revealedQuestionCount).toBe(1);

    const state = await statePromise;
    const projector = asProjector(state);
    expect(projector.reveal.revealedQuestionCount).toBe(1);
    expect(projector.reveal.questions).toHaveLength(1);
    expect(projector.reveal.questions[0]?.questionNumber).toBe(1);
  });

  it('全部揭曉後顯示各組搶答成功的題數（FR-018）', async () => {
    const fixture = await startFixture();
    insertSubmission(fixture.server, {
      id: 'a1',
      questionNumber: 1,
      groupId: 'group-1',
      rank: 1,
      receivedAt: '2026-11-17T09:00:00.000Z',
    });
    insertSubmission(fixture.server, {
      id: 'a2',
      questionNumber: 2,
      groupId: 'group-2',
      rank: 1,
      receivedAt: '2026-11-17T09:01:00.000Z',
    });
    setPhase(fixture.server, 'closed');

    const statePromise = waitForState(fixture.projector);
    const ack = await sendCommand(fixture.teacher, 'reveal:all', {});
    expect(ack).toEqual({ ok: true });

    const state = await statePromise;
    const projector = asProjector(state);
    expect(projector.reveal.revealedQuestionCount).toBe(2);
    expect(projector.reveal.questions.map((entry) => entry.questionNumber)).toEqual([
      1,
      2,
    ]);
    expect(projector.reveal.groupWinCounts).toEqual([
      { groupId: 'group-1', groupName: '第一組', count: 1 },
      { groupId: 'group-2', groupName: '第二組', count: 1 },
    ]);
  });

  it('學生不能揭曉；重設活動後揭曉進度清空（FR-017、FR-023）', async () => {
    const fixture = await startFixture();
    const studentToken = issueSession(fixture.server.db, {
      role: 'student',
      groupId: 'group-1',
    });
    const student = fixture.server.connect({
      token: studentToken,
      autoConnect: false,
    });
    const studentInitial = waitForState(student);
    student.connect();
    await studentInitial;
    setPhase(fixture.server, 'closed');

    const ack = await sendCommand(student, 'reveal:all', {});
    expect(ack).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: expect.any(String) },
    });

    await sendCommand(fixture.teacher, 'reveal:all', {});
    expect(getActivity(fixture.server.db)!.revealedQuestionCount).toBe(2);

    await sendCommand(fixture.teacher, 'activity:reset', { confirm: true });
    expect(getActivity(fixture.server.db)!.revealedQuestionCount).toBe(0);
    expect(getActivity(fixture.server.db)!.fairRankingEnabled).toBe(false);
  });
});
