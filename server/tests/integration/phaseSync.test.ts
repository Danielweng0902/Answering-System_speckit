import type { Socket } from 'socket.io-client';
import type { Snapshot } from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import { getActivity, type Activity } from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
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

describe('activity 階段同步（老師＋兩組學生＋guest）', () => {
  let server: TestServer;
  let teacherSocket: Socket;
  let studentOneSocket: Socket;
  let studentTwoSocket: Socket;
  let guestSocket: Socket;

  beforeEach(async () => {
    server = await startTestServer();
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
    insertGroup(server.db, { id: 'group-2', name: '第二組', position: 2 });
    // 002（FR-020）：沒有題目不能開啟搶答，先以 repository 直接寫入一題。
    seedQuestion(server.db);

    const teacherToken = issueSession(server.db, { role: 'teacher' });
    const studentOneToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-1',
    });
    const studentTwoToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-2',
    });

    teacherSocket = server.connect({ token: teacherToken, autoConnect: false });
    studentOneSocket = server.connect({
      token: studentOneToken,
      autoConnect: false,
    });
    studentTwoSocket = server.connect({
      token: studentTwoToken,
      autoConnect: false,
    });
    guestSocket = server.connect({ autoConnect: false });

    // 等待 state 必須在連線之前註冊；學生連線會改變 presence 並向所有
    // 已連線者廣播，所以依序連線、每輪把快照收完，避免殘留快照干擾
    // 後續的階段斷言。
    const teacherInitial = waitForState(teacherSocket);
    teacherSocket.connect();
    await teacherInitial;

    const teacherSawStudentOne = waitForState(teacherSocket);
    const studentOneInitial = waitForState(studentOneSocket);
    studentOneSocket.connect();
    await Promise.all([teacherSawStudentOne, studentOneInitial]);

    const teacherSawStudentTwo = waitForState(teacherSocket);
    const studentOneSawStudentTwo = waitForState(studentOneSocket);
    const studentTwoInitial = waitForState(studentTwoSocket);
    studentTwoSocket.connect();
    await Promise.all([
      teacherSawStudentTwo,
      studentOneSawStudentTwo,
      studentTwoInitial,
    ]);

    const guestInitial = waitForState(guestSocket);
    guestSocket.connect();
    await guestInitial;
  });

  afterEach(async () => {
    await server.close();
  });

  /** 同時等待四個連線的下一次 state（waitForState 預設 2 秒逾時）。 */
  function waitAllStates(): Promise<Snapshot[]> {
    return Promise.all(
      [teacherSocket, studentOneSocket, studentTwoSocket, guestSocket].map(
        (socket) => waitForState(socket),
      ),
    );
  }

  it('老師 activity:open 後四個連線都在 2 秒內收到 phase=open', async () => {
    const before = readActivity(server);
    expect(before.phase).toBe('preparing');

    const states = waitAllStates();
    const ack = await sendCommand(teacherSocket, 'activity:open', {});
    expect(ack).toEqual({ ok: true });

    const opened = await states;
    for (const snapshot of opened) {
      expect(snapshot.phase).toBe('open');
      // 只有這次改變使 revision +1。
      expect(snapshot.revision).toBe(before.revision + 1);
      // 倒數計時屬 Phase 7（T063）：目前維持 null。
      expect(snapshot.countdownEndsAt).toBeNull();
    }
    // 各身分快照各自正確。
    expect(opened[0]?.role).toBe('teacher');
    expect(opened[1]?.role).toBe('student');
    expect(opened[2]?.role).toBe('student');
    expect(opened[3]?.role).toBe('guest');
  });

  it('老師 activity:close 後四個連線都在 2 秒內收到 phase=closed', async () => {
    const before = readActivity(server);

    let states = waitAllStates();
    expect(await sendCommand(teacherSocket, 'activity:open', {})).toEqual({
      ok: true,
    });
    await states;

    states = waitAllStates();
    const ack = await sendCommand(teacherSocket, 'activity:close', {});
    expect(ack).toEqual({ ok: true });

    const closed = await states;
    for (const snapshot of closed) {
      expect(snapshot.phase).toBe('closed');
      // open 與 close 各改變一次，revision 共 +2。
      expect(snapshot.revision).toBe(before.revision + 2);
    }
  });

  it('重複 open／close 回覆 ok 但不改變資料、不加 revision（冪等）', async () => {
    let states = waitAllStates();
    expect(await sendCommand(teacherSocket, 'activity:open', {})).toEqual({
      ok: true,
    });
    await states;

    const afterOpen = readActivity(server);
    expect(afterOpen.phase).toBe('open');

    // open 再 open：ok 但資料完全不變。
    expect(await sendCommand(teacherSocket, 'activity:open', {})).toEqual({
      ok: true,
    });
    expect(readActivity(server)).toEqual(afterOpen);

    states = waitAllStates();
    expect(await sendCommand(teacherSocket, 'activity:close', {})).toEqual({
      ok: true,
    });
    await states;

    const afterClose = readActivity(server);
    expect(afterClose.phase).toBe('closed');
    expect(afterClose.revision).toBe(afterOpen.revision + 1);

    // closed 再 close：ok 但資料完全不變（AC-001-05）。
    expect(await sendCommand(teacherSocket, 'activity:close', {})).toEqual({
      ok: true,
    });
    expect(readActivity(server)).toEqual(afterClose);
  });

  it('closed 之後不能再 open（INVALID_PHASE，AC-001-03）', async () => {
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

    const before = readActivity(server);
    const ack = await sendCommand(teacherSocket, 'activity:open', {});
    expect(ack).toEqual({
      ok: false,
      error: { code: 'INVALID_PHASE', message: expect.any(String) },
    });
    expect(readActivity(server)).toEqual(before);
    await expectNoState(teacherSocket);
  });

  it('preparing 不能 close（INVALID_PHASE）', async () => {
    const before = readActivity(server);
    const ack = await sendCommand(teacherSocket, 'activity:close', {});
    expect(ack).toEqual({
      ok: false,
      error: { code: 'INVALID_PHASE', message: expect.any(String) },
    });
    expect(readActivity(server)).toEqual(before);
    await expectNoState(teacherSocket);
  });

  it('學生與 guest 不能 open 或 close，狀態不變也不廣播', async () => {
    const before = readActivity(server);

    const commands = [
      { event: 'activity:open', payload: {} },
      { event: 'activity:close', payload: {} },
    ] as const;

    for (const socket of [studentOneSocket, guestSocket]) {
      for (const command of commands) {
        const ack = await sendCommand(socket, command.event, command.payload);
        expect(ack).toEqual({
          ok: false,
          error: { code: 'FORBIDDEN', message: expect.any(String) },
        });
      }
    }

    expect(readActivity(server)).toEqual(before);
    await expectNoState(studentOneSocket);
    await expectNoState(guestSocket);
    await expectNoState(teacherSocket);
  });
});

describe('activity:open 沒有組別時', () => {
  it('拒絕 NO_GROUPS 且維持 preparing（AC-001-04）', async () => {
    const server = await startTestServer();
    try {
      const teacherToken = issueSession(server.db, { role: 'teacher' });
      const teacherSocket = server.connect({
        token: teacherToken,
        autoConnect: false,
      });
      const initial = waitForState(teacherSocket);
      teacherSocket.connect();
      await initial;

      const ack = await sendCommand(teacherSocket, 'activity:open', {});
      expect(ack).toEqual({
        ok: false,
        error: { code: 'NO_GROUPS', message: expect.any(String) },
      });

      const activity = readActivity(server);
      expect(activity.phase).toBe('preparing');
      expect(activity.revision).toBe(0);
      expect(activity.openedAt).toBeNull();
      await expectNoState(teacherSocket);
    } finally {
      await server.close();
    }
  });
});
