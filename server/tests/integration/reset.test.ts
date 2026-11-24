import type { Socket } from 'socket.io-client';
import type { Snapshot } from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import { getActivity, type Activity } from '../../src/infra/db/activityRepo.js';
import { insertGroup, listGroups } from '../../src/infra/db/groupRepo.js';
import {
  seedQuestion,
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

function readActivity(server: TestServer): Activity {
  const activity = getActivity(server.db);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }
  return activity;
}

function expectNoState(socket: Socket, milliseconds = 300): Promise<void> {
  return expect(waitForState(socket, milliseconds)).rejects.toThrow(
    'Timed out waiting for a state snapshot',
  );
}

function expectError(
  ack: unknown,
  code: 'CONFIRM_REQUIRED' | 'INVALID_PHASE' | 'FORBIDDEN',
): void {
  expect(ack).toEqual({
    ok: false,
    error: { code, message: expect.any(String) },
  });
}

describe('activity:reset 重設活動（老師＋學生＋guest）', () => {
  let server: TestServer;
  let teacherSocket: Socket;
  let studentSocket: Socket;
  let guestSocket: Socket;
  let studentToken: string;

  beforeEach(async () => {
    server = await startTestServer();
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
    insertGroup(server.db, { id: 'group-2', name: '第二組', position: 2 });
    // 002（FR-020）：開啟搶答前先有題目。
    seedQuestion(server.db);

    const teacherToken = issueSession(server.db, { role: 'teacher' });
    studentToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-1',
    });

    teacherSocket = server.connect({ token: teacherToken, autoConnect: false });
    studentSocket = server.connect({ token: studentToken, autoConnect: false });
    guestSocket = server.connect({ autoConnect: false });

    // 等待 state 必須在送指令之前註冊；依序連線並收完每輪快照。
    const teacherInitial = waitForState(teacherSocket);
    teacherSocket.connect();
    await teacherInitial;

    const teacherSawStudent = waitForState(teacherSocket);
    const studentInitial = waitForState(studentSocket);
    studentSocket.connect();
    await Promise.all([teacherSawStudent, studentInitial]);

    const guestInitial = waitForState(guestSocket);
    guestSocket.connect();
    await guestInitial;
  });

  afterEach(async () => {
    await server.close();
  });

  function waitAllStates(): Promise<Snapshot[]> {
    return Promise.all(
      [teacherSocket, studentSocket, guestSocket].map((socket) =>
        waitForState(socket),
      ),
    );
  }

  /** 建立一場「已結束」的活動，供各測試重設。 */
  async function openThenClose(): Promise<void> {
    let states = waitAllStates();
    expect(await sendCommand(teacherSocket, 'activity:open', {})).toEqual({
      ok: true,
    });
    await states;

    states = waitAllStates();
    expect(await sendCommand(teacherSocket, 'activity:close', {})).toEqual({
      ok: true,
    });
    await states;
  }

  it('closed 時未帶 confirm 或 confirm:false 得 CONFIRM_REQUIRED，不廣播、狀態不變（AC-001-28）', async () => {
    await openThenClose();
    const before = readActivity(server);
    expect(before.phase).toBe('closed');

    expectError(
      await sendCommand(teacherSocket, 'activity:reset', {}),
      'CONFIRM_REQUIRED',
    );
    expectError(
      await sendCommand(teacherSocket, 'activity:reset', { confirm: false }),
      'CONFIRM_REQUIRED',
    );

    expect(readActivity(server)).toEqual(before);
    await expectNoState(teacherSocket);
    await expectNoState(studentSocket);
    await expectNoState(guestSocket);
  });

  it('confirm:true 後老師、學生、guest 都收到 preparing，組別保留（AC-001-27）', async () => {
    await openThenClose();
    const before = readActivity(server);

    const states = waitAllStates();
    expect(
      await sendCommand(teacherSocket, 'activity:reset', { confirm: true }),
    ).toEqual({ ok: true });

    const snapshots = await states;
    for (const snapshot of snapshots) {
      expect(snapshot.phase).toBe('preparing');
      expect(snapshot.revision).toBe(before.revision + 1);
      expect(snapshot.countdownEndsAt).toBeNull();
      // 組別保留（依建立順序）。
      expect(snapshot.groups).toEqual([
        { id: 'group-1', name: '第一組' },
        { id: 'group-2', name: '第二組' },
      ]);
    }

    // 資料庫中的時間欄位清空、組別保留。
    const activity = readActivity(server);
    expect(activity.phase).toBe('preparing');
    expect(activity.openedAt).toBeNull();
    expect(activity.countdownEndsAt).toBeNull();
    expect(activity.closedAt).toBeNull();
    expect(activity.revision).toBe(before.revision + 1);
    expect(listGroups(server.db)).toHaveLength(2);

  });

  /**
   * 2026-11-24（D2-1）：重設 = 新的一場 → 一併作廢學生的 session。
   *
   * 這個測項自建 socket（不用 beforeEach 的），因為要同時觀察三種身分在
   * 重設前後的差別：學生降為 guest、老師保留、已連線的學生不受影響。
   */
  it('重設會作廢學生的 session：舊 token 重連降為 guest，老師的 token 仍可重連（D2-1）', async () => {
    const teacherToken = issueSession(server.db, { role: 'teacher' });
    const studentToken = issueSession(server.db, { role: 'student', groupId: 'group-1' });

    const teacher = server.connect({ token: teacherToken, autoConnect: false });
    const student = server.connect({ token: studentToken, autoConnect: false });

    const teacherInitial = waitForState(teacher);
    const studentInitial = waitForState(student);
    teacher.connect();
    student.connect();
    await Promise.all([teacherInitial, studentInitial]);

    // 開搶答 → 結束，讓重設的前置條件成立。
    let states = Promise.all([waitForState(teacher), waitForState(student)]);
    expect(await sendCommand(teacher, 'activity:open', {})).toEqual({ ok: true });
    await states;
    states = Promise.all([waitForState(teacher), waitForState(student)]);
    expect(await sendCommand(teacher, 'activity:close', {})).toEqual({ ok: true });
    await states;

    const teacherSaw = waitForState(teacher);
    const studentSaw = waitForState(student);
    expect(await sendCommand(teacher, 'activity:reset', { confirm: true })).toEqual({
      ok: true,
    });
    // 已連線的學生**沒有被踢掉** → 仍收到重設後的 state，而且身分仍是學生
    // （身分是在 connection 時解析一次就存著的，每個指令不重查 sessions 表）。
    const [afterReset, studentAfterReset] = await Promise.all([teacherSaw, studentSaw]);
    expect(afterReset.phase).toBe('preparing');
    expect(studentAfterReset.role).toBe('student');
    expect(studentAfterReset).toMatchObject({ myGroupId: 'group-1' });

    // 但他的 session 已經不存在了 → 用舊 token 重連會降為 guest。
    const reconnected = server.connect({ token: studentToken, autoConnect: false });
    const guestSnapshot = waitForState(reconnected);
    reconnected.connect();
    expect((await guestSnapshot).role).toBe('guest');

    // 老師的 session 保留 → 用老師 token 重連仍是老師（不該被踢出）。
    const teacherReconnected = server.connect({ token: teacherToken, autoConnect: false });
    const teacherSnapshot = waitForState(teacherReconnected);
    teacherReconnected.connect();
    expect((await teacherSnapshot).role).toBe('teacher');
  });

  it('preparing 與 open 時 reset 拒絕 INVALID_PHASE，不廣播、狀態不變（AC-001-29）', async () => {
    // preparing：一開始就拒絕。
    let before = readActivity(server);
    expectError(
      await sendCommand(teacherSocket, 'activity:reset', { confirm: true }),
      'INVALID_PHASE',
    );
    expect(readActivity(server)).toEqual(before);
    await expectNoState(teacherSocket);

    // open：同樣拒絕。
    const states = waitAllStates();
    expect(await sendCommand(teacherSocket, 'activity:open', {})).toEqual({
      ok: true,
    });
    await states;

    before = readActivity(server);
    expectError(
      await sendCommand(teacherSocket, 'activity:reset', { confirm: true }),
      'INVALID_PHASE',
    );
    expect(readActivity(server)).toEqual(before);
    await expectNoState(teacherSocket);
    await expectNoState(studentSocket);
    await expectNoState(guestSocket);
  });

  it('學生與 guest 不能 reset（只有老師），狀態不變也不廣播', async () => {
    await openThenClose();
    const before = readActivity(server);

    for (const socket of [studentSocket, guestSocket]) {
      expectError(
        await sendCommand(socket, 'activity:reset', { confirm: true }),
        'FORBIDDEN',
      );
    }

    expect(readActivity(server)).toEqual(before);
    await expectNoState(teacherSocket);
    await expectNoState(studentSocket);
    await expectNoState(guestSocket);
  });
});
