import type { Socket } from 'socket.io-client';
import type { Snapshot } from '@classroom/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import { createSnapshot } from '../../src/app/snapshot.js';
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
  student: Socket;
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

  const studentToken = issueSession(target.db, {
    role: 'student',
    groupId: 'group-1',
  });
  const student = target.connect({ token: studentToken, autoConnect: false });
  const studentInitial = waitForState(student);
  student.connect();
  await studentInitial;

  return { server: target, teacher, student };
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

function setFairRanking(target: TestServer, enabled: boolean): void {
  const activity = getActivity(target.db);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }
  updateActivity(target.db, {
    ...activity,
    fairRankingEnabled: enabled,
  });
}

/** 直接寫入可控送達時間的作答，讓判定案例不受真實時鐘影響。 */
function insertSubmission(
  target: TestServer,
  options: {
    id: string;
    questionNumber: number;
    groupId: string;
    rank: number;
    receivedAt: string;
    voidedAt?: string | null;
  },
): void {
  const question = target.db
    .prepare('SELECT id FROM questions WHERE number = ?')
    .get(options.questionNumber) as { id: string };
  target.db
    .prepare(
      `INSERT INTO submissions
         (id, question_id, group_id, rank, received_at, voided_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      options.id,
      question.id,
      options.groupId,
      options.rank,
      options.receivedAt,
      options.voidedAt ?? null,
    );
  target.db
    .prepare(
      `INSERT INTO submission_answers
         (submission_id, blank_position, answer_text)
       VALUES (?, 1, ?)`,
    )
    .run(options.id, `${options.groupId}-${options.questionNumber}`);
}

/** 等到符合條件的快照（避免抓到其他人進場造成的舊廣播）。 */
function waitForStateWhere(
  socket: Socket,
  predicate: (snapshot: Snapshot) => boolean,
  timeoutMilliseconds = 2_000,
): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('state', onState);
      reject(new Error('Timed out waiting for a matching state snapshot'));
    }, timeoutMilliseconds);

    function onState(snapshot: Snapshot): void {
      if (!predicate(snapshot)) {
        return;
      }
      clearTimeout(timeout);
      socket.off('state', onState);
      resolve(snapshot);
    }

    socket.on('state', onState);
  });
}

function teacherSnapshot(target: TestServer, now = new Date()): Snapshot {
  return createSnapshot(target.db, { role: 'teacher' }, {}, now);
}

function studentSnapshot(
  target: TestServer,
  now = new Date(),
): Snapshot {
  return createSnapshot(
    target.db,
    { role: 'student', groupId: 'group-1' },
    {},
    now,
  );
}

describe('activity:fair-ranking 指令（005 US2；T016、AC-005-09、AC-005-10）', () => {
  it('老師在準備中可切換，資料變更、revision +1 並廣播', async () => {
    const fixture = await startFixture();
    const before = getActivity(fixture.server.db)!.revision;

    const statePromise = waitForStateWhere(
      fixture.teacher,
      (snapshot) => snapshot.fairRankingEnabled === true,
    );
    const ack = await sendCommand(fixture.teacher, 'activity:fair-ranking', {
      enabled: true,
    });
    const state = await statePromise;

    expect(ack).toEqual({ ok: true });
    expect(getActivity(fixture.server.db)!.fairRankingEnabled).toBe(true);
    expect(getActivity(fixture.server.db)!.revision).toBe(before + 1);
    expect(state.fairRankingEnabled).toBe(true);
  });

  it('學生呼叫被拒且資料不變', async () => {
    const fixture = await startFixture();
    const before = getActivity(fixture.server.db)!;

    const ack = await sendCommand(fixture.student, 'activity:fair-ranking', {
      enabled: true,
    });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: expect.any(String) },
    });
    const after = getActivity(fixture.server.db)!;
    expect(after.fairRankingEnabled).toBe(false);
    expect(after.revision).toBe(before.revision);
  });

  it('搶答中或已結束時切換被拒且資料不變（AC-005-10）', async () => {
    const fixture = await startFixture();
    setPhase(fixture.server, 'open');
    const before = getActivity(fixture.server.db)!;

    const ack = await sendCommand(fixture.teacher, 'activity:fair-ranking', {
      enabled: true,
    });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'INVALID_PHASE', message: expect.any(String) },
    });
    const after = getActivity(fixture.server.db)!;
    expect(after.fairRankingEnabled).toBe(false);
    expect(after.revision).toBe(before.revision);
  });

  it('設定成與現況相同的值回成功但不寫入、不遞增 revision', async () => {
    const fixture = await startFixture();
    setFairRanking(fixture.server, true);
    const before = getActivity(fixture.server.db)!;

    const ack = await sendCommand(fixture.teacher, 'activity:fair-ranking', {
      enabled: true,
    });

    expect(ack).toEqual({ ok: true });
    const after = getActivity(fixture.server.db)!;
    expect(after.revision).toBe(before.revision);
  });
});

describe('公平順位判定（005 US1；T011、AC-005-01、AC-005-04、AC-005-19、AC-005-20）', () => {
  it('啟用時同批內成功題數少的組別搶答成功，未啟用時先到先得', async () => {
    const fixture = await startFixture();
    insertSubmission(fixture.server, {
      id: 's1',
      questionNumber: 1,
      groupId: 'group-1',
      rank: 1,
      receivedAt: '2026-11-17T09:00:00.000Z',
    });
    insertSubmission(fixture.server, {
      id: 's2',
      questionNumber: 2,
      groupId: 'group-1',
      rank: 1,
      receivedAt: '2026-11-17T09:01:00.000Z',
    });
    insertSubmission(fixture.server, {
      id: 's3',
      questionNumber: 2,
      groupId: 'group-2',
      rank: 2,
      receivedAt: '2026-11-17T09:01:00.500Z',
    });
    setPhase(fixture.server, 'closed');

    const arrivalBoard = teacherSnapshot(fixture.server);
    if (arrivalBoard.role !== 'teacher') {
      throw new Error('預期為老師快照');
    }
    expect(
      arrivalBoard.board.map((entry) => entry.winnerGroupId),
    ).toEqual(['group-1', 'group-1']);

    setFairRanking(fixture.server, true);
    const fair = teacherSnapshot(fixture.server);
    if (fair.role !== 'teacher') {
      throw new Error('預期為老師快照');
    }
    // 第 1 題 G1 先送；第 2 題 G1、G2 同批，G2 成功題數較少 → G2 搶答成功。
    expect(fair.board.map((entry) => entry.winnerGroupId)).toEqual([
      'group-1',
      'group-2',
    ]);
    expect(fair.board[1]?.fairnessApplied).toBe(true);
    expect(fair.board[0]?.fairnessApplied).toBe(false);
  });

  it('作廢搶答成功組後，該題與後面已判定的題目連鎖重算（D25、AC-005-19）', async () => {
    const fixture = await startFixture();
    insertGroup(fixture.server.db, { id: 'group-3', name: '第三組', position: 3 });
    // 第 1 題：只有 G1 作答 → G1 取得 1 次成功。
    insertSubmission(fixture.server, {
      id: 'v1',
      questionNumber: 1,
      groupId: 'group-1',
      rank: 1,
      receivedAt: '2026-11-17T09:00:00.000Z',
    });
    // 第 2 題：G1、G2 同批；G2 成功題數較少 → G2 成功（1 次）。
    insertSubmission(fixture.server, {
      id: 'v2',
      questionNumber: 2,
      groupId: 'group-1',
      rank: 1,
      receivedAt: '2026-11-17T09:01:00.000Z',
    });
    insertSubmission(fixture.server, {
      id: 'v3',
      questionNumber: 2,
      groupId: 'group-2',
      rank: 2,
      receivedAt: '2026-11-17T09:01:00.500Z',
    });
    setFairRanking(fixture.server, true);
    setPhase(fixture.server, 'closed');

    const before = teacherSnapshot(fixture.server);
    if (before.role !== 'teacher') {
      throw new Error('預期為老師快照');
    }
    expect(before.board.map((entry) => entry.winnerGroupId)).toEqual([
      'group-1',
      'group-2',
    ]);

    fixture.server.db
      .prepare(`UPDATE submissions SET voided_at = ? WHERE id = 'v1'`)
      .run('2026-11-17T09:02:00.000Z');

    const after = teacherSnapshot(fixture.server);
    if (after.role !== 'teacher') {
      throw new Error('預期為老師快照');
    }
    // 第 1 題沒有其他有效作答 → 無人作答；G1 的成功題數歸零後，
    // 第 2 題同批的 G1 與 G2 都是 0 次 → 依送達先後改判。
    expect(after.board.map((entry) => entry.winnerGroupId)).toEqual([
      null,
      'group-1',
    ]);
  });

  it('未啟用公平順位時作廢不發生連鎖重算（AC-005-20）', async () => {
    const fixture = await startFixture();
    insertSubmission(fixture.server, {
      id: 'n1',
      questionNumber: 1,
      groupId: 'group-1',
      rank: 1,
      receivedAt: '2026-11-17T09:00:00.000Z',
    });
    insertSubmission(fixture.server, {
      id: 'n2',
      questionNumber: 2,
      groupId: 'group-2',
      rank: 1,
      receivedAt: '2026-11-17T09:01:00.000Z',
    });
    insertSubmission(fixture.server, {
      id: 'n3',
      questionNumber: 2,
      groupId: 'group-1',
      rank: 2,
      receivedAt: '2026-11-17T09:01:00.500Z',
    });
    setPhase(fixture.server, 'closed');

    fixture.server.db
      .prepare(`UPDATE submissions SET voided_at = ? WHERE id = 'n1'`)
      .run('2026-11-17T09:02:00.000Z');

    const snapshot = teacherSnapshot(fixture.server);
    if (snapshot.role !== 'teacher') {
      throw new Error('預期為老師快照');
    }
    expect(snapshot.board.map((entry) => entry.winnerGroupId)).toEqual([
      null,
      'group-2',
    ]);
  });

  it('學生端知道本場使用公平順位，但搶答中仍看不到順位與其他組資訊（FR-012）', async () => {
    const fixture = await startFixture();
    setFairRanking(fixture.server, true);
    setPhase(fixture.server, 'open');

    const snapshot = studentSnapshot(fixture.server);
    expect(snapshot.fairRankingEnabled).toBe(true);
    // 搶答中的學生快照沒有順位，也沒有其他組的作答內容（FR-012、C9）。
    expect(JSON.stringify(snapshot)).not.toContain('"rank"');
    expect(JSON.stringify(snapshot)).not.toContain('group-1-2');
  });

  it('公平順位下學生看到自己組的順位是公平順位（FR-021）', async () => {
    const fixture = await startFixture();
    // 第 1 題只有 G1 作答 → G1 已有 1 次成功。
    insertSubmission(fixture.server, {
      id: 'f1',
      questionNumber: 1,
      groupId: 'group-1',
      rank: 1,
      receivedAt: '2026-11-17T09:00:00.000Z',
    });
    // 第 2 題：G1 先送達、G2 同批送出；G2 成功題數較少 → G2 第 1 順位、G1 第 2。
    insertSubmission(fixture.server, {
      id: 'f2',
      questionNumber: 2,
      groupId: 'group-1',
      rank: 1,
      receivedAt: '2026-11-17T09:01:00.000Z',
    });
    insertSubmission(fixture.server, {
      id: 'f3',
      questionNumber: 2,
      groupId: 'group-2',
      rank: 2,
      receivedAt: '2026-11-17T09:01:00.500Z',
    });
    setFairRanking(fixture.server, true);
    setPhase(fixture.server, 'closed');

    const snapshot = studentSnapshot(fixture.server);
    if (snapshot.role !== 'student' || snapshot.phase !== 'closed') {
      throw new Error('預期為學生 closed 快照');
    }
    // 送達順序上 G1 是第 1 順位，公平順位下則是第 2 順位。
    expect(snapshot.myAnswers[1]?.rank).toBe(2);
  });
});
