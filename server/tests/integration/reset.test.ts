import type { Socket } from 'socket.io-client';
import type { GuestSnapshot, Snapshot, TeacherSnapshot } from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import { getActivity, type Activity } from '../../src/infra/db/activityRepo.js';
import { insertGroup, listGroups } from '../../src/infra/db/groupRepo.js';
import {
  seedQuestion,
  sendCommand,
  startTestServer,
  waitForSessionInvalid,
  waitForState,
  waitForStateMatching,
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
   * 重設前後的差別：已連線的學生即時降為 guest、離線的學生重連時被通知、
   * 老師保留。
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
    // 已連線的學生也會收到 session:invalid → 回到選組頁（另一組那邊是
    // 「每次送出都重新檢查」所以一定會重選；我們要一致）。
    const studentInvalidated = waitForSessionInvalid(student);
    expect(await sendCommand(teacher, 'activity:reset', { confirm: true })).toEqual({
      ok: true,
    });
    const [afterReset, studentAfterReset] = await Promise.all([teacherSaw, studentSaw]);
    expect(afterReset.phase).toBe('preparing');

    // 學生的進場狀態失效 → 身分降為 guest（不再有 myGroupId）→ 回到選組頁。
    expect(await studentInvalidated).toEqual({ code: 'ACTIVITY_RESET' });
    expect(studentAfterReset.role).toBe('guest');
    expect(studentAfterReset).not.toHaveProperty('myGroupId');

    // 但他的 session 已經不存在了 → 用舊 token 重連會降為 guest，並先收到
    // SESSION_EXPIRED，讓前端清掉舊 token（等待器必須在 connect 前掛好）。
    const reconnected = server.connect({ token: studentToken, autoConnect: false });
    const sessionExpired = waitForSessionInvalid(reconnected);
    const guestSnapshot = waitForState(reconnected);
    reconnected.connect();
    expect(await sessionExpired).toEqual({ code: 'SESSION_EXPIRED' });
    expect((await guestSnapshot).role).toBe('guest');

    // 老師的 session 保留 → 用老師 token 重連仍是老師（不該被踢出）。
    const teacherReconnected = server.connect({ token: teacherToken, autoConnect: false });
    const teacherSnapshot = waitForState(teacherReconnected);
    teacherReconnected.connect();
    expect((await teacherSnapshot).role).toBe('teacher');
  });

  /**
   * 重設當下離線的學生收不到即時的 ACTIVITY_RESET；session 資料列刪除後，
   * 必須在帶舊 token 重連時收到 SESSION_EXPIRED，才知道進場狀態為何失效。
   */
  it('重設當下離線的學生帶舊 token 重連，收到 SESSION_EXPIRED 且快照身分為 guest', async () => {
    const offlineStudentToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-2',
    });
    const offlineStudent = server.connect({
      token: offlineStudentToken,
      autoConnect: false,
    });

    const studentInitial = waitForState(offlineStudent);
    offlineStudent.connect();
    const initialSnapshot = await studentInitial;
    expect(initialSnapshot.role).toBe('student');
    expect(initialSnapshot).toHaveProperty('myGroupId', 'group-2');

    // 開搶答 → 結束，讓重設的前置條件成立。
    let states = Promise.all([
      waitForState(teacherSocket),
      waitForState(offlineStudent),
    ]);
    expect(await sendCommand(teacherSocket, 'activity:open', {})).toEqual({
      ok: true,
    });
    await states;
    states = Promise.all([
      waitForState(teacherSocket),
      waitForState(offlineStudent),
    ]);
    expect(await sendCommand(teacherSocket, 'activity:close', {})).toEqual({
      ok: true,
    });
    await states;

    // 等老師快照確認第二組已離線，確保重設前 server 已處理 disconnect。
    const teacherSawStudentOffline = waitForStateMatching(
      teacherSocket,
      (snapshot): snapshot is TeacherSnapshot =>
        snapshot.role === 'teacher' && snapshot.presence['group-2'] === 0,
    );
    offlineStudent.disconnect();
    await teacherSawStudentOffline;

    expect(
      await sendCommand(teacherSocket, 'activity:reset', { confirm: true }),
    ).toEqual({ ok: true });

    // 舊 token 對應的 session 已刪除；兩個等待器都要在 connect 前掛好。
    const reconnected = server.connect({
      token: offlineStudentToken,
      autoConnect: false,
    });
    const sessionExpired = waitForSessionInvalid(reconnected);
    const guestSnapshot = waitForState(reconnected);
    reconnected.connect();

    expect(await sessionExpired).toEqual({ code: 'SESSION_EXPIRED' });
    const reconnectedSnapshot = await guestSnapshot;
    expect(reconnectedSnapshot.role).toBe('guest');
    expect(reconnectedSnapshot).not.toHaveProperty('myGroupId');
  });

  /**
   * 2026-11-25（D2-1 補充；OpenSpec 組 2026-11-25 同意並追加要求）：
   * 重設時**已連線**的學生也必須被通知 → 回到選組頁。
   *
   * 為什麼一定要通知已連線的學生：另一組（OpenSpec 組）的學生端每次送出
   * 都會重新檢查學生的進場狀態，所以他們那邊重設後**一定**會全部重選；
   * 我們若不通知已連線的學生，同一班會變成「有人留在原組、有人要重選」。
   * 兩組的行為必須一致（Feature Contract D19）。
   *
   * 這個測項自建三條連線（老師＋兩個不同組的學生），因為要同時觀察：
   * 兩個學生都被通知、快照降為 guest、在線人數清空、組別保留、老師保留。
   */
  it('重設時兩個不同組的已連線學生都收到 ACTIVITY_RESET、快照降為 guest、在線人數清空、組別保留，老師仍是老師（D2-1）', async () => {
    const teacherToken = issueSession(server.db, { role: 'teacher' });
    const studentOneToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-1',
    });
    const studentTwoToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-2',
    });

    const teacher = server.connect({ token: teacherToken, autoConnect: false });
    const studentOne = server.connect({
      token: studentOneToken,
      autoConnect: false,
    });
    const studentTwo = server.connect({
      token: studentTwoToken,
      autoConnect: false,
    });

    const teacherInitial = waitForState(teacher);
    teacher.connect();
    await teacherInitial;

    // 等待器必須在學生連線**之前**就掛好，否則兩位學生都在線的那一份
    // 老師快照可能已經送達、沒有任何等待器會收到它。
    //
    // 這個測項與 beforeEach 共用同一個 server（beforeEach 已有一個第一組的
    // 學生連線），所以在線人數用「≥1」判定；重設後則要求**全部歸零**。
    const teacherSawBoth = waitForStateMatching(
      teacher,
      (snapshot): snapshot is TeacherSnapshot =>
        snapshot.role === 'teacher' &&
        (snapshot.presence['group-1'] ?? 0) >= 1 &&
        (snapshot.presence['group-2'] ?? 0) >= 1,
    );
    const studentOneInitial = waitForState(studentOne);
    const studentTwoInitial = waitForState(studentTwo);
    studentOne.connect();
    studentTwo.connect();
    await Promise.all([teacherSawBoth, studentOneInitial, studentTwoInitial]);

    // 兩個學生都在線 → 老師快照的 presence 兩個組都有人。
    expect((await teacherSawBoth).presence['group-1']).toBeGreaterThanOrEqual(1);
    expect((await teacherSawBoth).presence['group-2']).toBeGreaterThanOrEqual(1);

    // 開搶答 → 結束，讓重設的前置條件成立。
    let states = Promise.all([
      waitForState(teacher),
      waitForState(studentOne),
      waitForState(studentTwo),
    ]);
    expect(await sendCommand(teacher, 'activity:open', {})).toEqual({ ok: true });
    await states;
    states = Promise.all([
      waitForState(teacher),
      waitForState(studentOne),
      waitForState(studentTwo),
    ]);
    expect(await sendCommand(teacher, 'activity:close', {})).toEqual({ ok: true });
    await states;

    // 重設：兩個學生都要收到 session:invalid（ACTIVITY_RESET），
    // 下一份快照要降為 guest（回到選組頁）。
    //
    // 三個等待器都必須在送出重設**之前**就掛好：session:invalid 與降級後的
    // 快照幾乎同時送達，晚一步掛上就會漏掉那一份快照。
    const studentOneInvalidated = waitForSessionInvalid(studentOne);
    const studentTwoInvalidated = waitForSessionInvalid(studentTwo);
    const studentOneAfterReset = waitForStateMatching(
      studentOne,
      (snapshot): snapshot is GuestSnapshot => snapshot.role === 'guest',
    );
    const studentTwoAfterReset = waitForStateMatching(
      studentTwo,
      (snapshot): snapshot is GuestSnapshot => snapshot.role === 'guest',
    );
    // 重設會讓 activity.revision +1 → 用 revision 認出「重設後」的那一份
    // 老師快照（重設前的 preparing 快照 revision 較舊，不會被誤認）。
    const revisionBeforeReset = readActivity(server).revision;
    const teacherAfterReset = waitForStateMatching(
      teacher,
      (snapshot): snapshot is TeacherSnapshot =>
        snapshot.role === 'teacher' && snapshot.revision > revisionBeforeReset,
    );
    expect(
      await sendCommand(teacher, 'activity:reset', { confirm: true }),
    ).toEqual({ ok: true });

    expect(await studentOneInvalidated).toEqual({ code: 'ACTIVITY_RESET' });
    expect(await studentTwoInvalidated).toEqual({ code: 'ACTIVITY_RESET' });

    // 學生的下一份快照是 guest（回到選組頁），組別仍在（重選只要點一下）。
    for (const snapshot of [await studentOneAfterReset, await studentTwoAfterReset]) {
      expect(snapshot.role).toBe('guest');
      expect(snapshot).not.toHaveProperty('myGroupId');
      expect(snapshot.phase).toBe('preparing');
      expect(snapshot.groups).toEqual([
        { id: 'group-1', name: '第一組' },
        { id: 'group-2', name: '第二組' },
      ]);
    }

    // 老師仍是老師，而且在線人數清空（兩位學生都被降為 guest）。
    const teacherSnapshot = await teacherAfterReset;
    expect(teacherSnapshot.role).toBe('teacher');
    expect(teacherSnapshot.presence).toEqual({ 'group-1': 0, 'group-2': 0 });
    expect(teacherSnapshot.groups).toEqual([
      { id: 'group-1', name: '第一組' },
      { id: 'group-2', name: '第二組' },
    ]);
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
