import type { Socket } from 'socket.io-client';
import type { StudentSnapshot, TeacherSnapshot } from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import { countGroups, insertGroup } from '../../src/infra/db/groupRepo.js';
import {
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

function expectNoState(socket: Socket, milliseconds = 300): Promise<void> {
  return expect(waitForState(socket, milliseconds)).rejects.toThrow(
    'Timed out waiting for a state snapshot',
  );
}

describe('邊界情況（spec Edge Cases）', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('老師兩個連線同時在線看到相同狀態，任一邊 group:create 兩邊都收到', async () => {
    // spec：老師在兩個瀏覽器分頁同時登入（各自取得 token）。
    const teacherOneToken = issueSession(server.db, { role: 'teacher' });
    const teacherTwoToken = issueSession(server.db, { role: 'teacher' });

    const teacherOne = server.connect({
      token: teacherOneToken,
      autoConnect: false,
    });
    const oneInitial = waitForState(teacherOne);
    teacherOne.connect();
    const initialOne = (await oneInitial) as TeacherSnapshot;

    const teacherTwo = server.connect({
      token: teacherTwoToken,
      autoConnect: false,
    });
    const twoInitial = waitForState(teacherTwo);
    teacherTwo.connect();
    const initialTwo = (await twoInitial) as TeacherSnapshot;

    // serverNow 由各自連線的時間產生，只比對狀態本身的欄位。
    expect(initialOne.role).toBe('teacher');
    expect(initialTwo.role).toBe('teacher');
    expect(initialTwo.phase).toBe(initialOne.phase);
    expect(initialTwo.revision).toBe(initialOne.revision);
    expect(initialTwo.groups).toEqual(initialOne.groups);
    expect(initialTwo.presence).toEqual(initialOne.presence);

    // 第二個連線送出指令，兩邊收到同一個廣播快照（serverNow 一致）。
    const oneNext = waitForState(teacherOne);
    const twoNext = waitForState(teacherTwo);
    expect(
      await sendCommand(teacherTwo, 'group:create', { name: '第一組' }),
    ).toEqual({ ok: true });

    const [nextOne, nextTwo] = await Promise.all([oneNext, twoNext]);
    expect(nextOne).toEqual(nextTwo);
    expect(nextOne.groups).toContainEqual({
      id: expect.any(String),
      name: '第一組',
    });
  });

  it('同組兩位學生其中一人斷線，另一人不受影響，老師 presence 由 2 變 1 仍大於 0', async () => {
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });

    const teacherToken = issueSession(server.db, { role: 'teacher' });
    const teacherSocket = server.connect({
      token: teacherToken,
      autoConnect: false,
    });
    const teacherInitial = waitForState(teacherSocket);
    teacherSocket.connect();
    await teacherInitial;

    const studentOneToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-1',
    });
    const studentOne = server.connect({
      token: studentOneToken,
      autoConnect: false,
    });
    const teacherSawOne = waitForState(teacherSocket);
    const oneInitial = waitForState(studentOne);
    studentOne.connect();
    await Promise.all([teacherSawOne, oneInitial]);

    const studentTwoToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-1',
    });
    const studentTwo = server.connect({
      token: studentTwoToken,
      autoConnect: false,
    });
    const teacherSawTwo = waitForState(teacherSocket);
    const twoInitial = waitForState(studentTwo);
    studentTwo.connect();
    const [teacherTwoState] = await Promise.all([teacherSawTwo, twoInitial]);
    expect((teacherTwoState as TeacherSnapshot).presence['group-1']).toBe(2);

    // 斷線前先在老師與另一位學生註冊等待；斷線會觸發一次 presence 廣播。
    const teacherAfter = waitForState(teacherSocket);
    const twoAfter = waitForState(studentTwo);
    studentOne.disconnect();

    const [teacherState, twoState] = await Promise.all([
      teacherAfter,
      twoAfter,
    ]);
    const online = (teacherState as TeacherSnapshot).presence['group-1'];
    expect(online).toBe(1);
    expect(online).toBeGreaterThan(0);

    // 另一位學生仍在線，身分與組別不受影響。
    expect(twoState).toMatchObject({
      role: 'student',
      myGroupId: 'group-1',
    });
  });

  it('組別改名後，該組學生的快照中 myGroupId 對應的組名是新名稱', async () => {
    insertGroup(server.db, { id: 'group-1', name: '舊名組', position: 1 });

    const teacherToken = issueSession(server.db, { role: 'teacher' });
    const teacherSocket = server.connect({
      token: teacherToken,
      autoConnect: false,
    });
    const teacherInitial = waitForState(teacherSocket);
    teacherSocket.connect();
    await teacherInitial;

    const studentToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-1',
    });
    const studentSocket = server.connect({
      token: studentToken,
      autoConnect: false,
    });
    const teacherSawStudent = waitForState(teacherSocket);
    const studentInitial = waitForState(studentSocket);
    studentSocket.connect();
    await Promise.all([teacherSawStudent, studentInitial]);

    const studentNext = waitForState(studentSocket);
    expect(
      await sendCommand(teacherSocket, 'group:rename', {
        groupId: 'group-1',
        name: '新名組',
      }),
    ).toEqual({ ok: true });

    const state = (await studentNext) as StudentSnapshot;
    expect(state.role).toBe('student');
    expect(state.myGroupId).toBe('group-1');
    const mine = state.groups.find((group) => group.id === state.myGroupId);
    expect(mine?.name).toBe('新名組');
  });

  it('已有 50 組時新增回 GROUP_LIMIT_REACHED，組數不變也不廣播（FR-009）', async () => {
    for (let index = 1; index <= 50; index += 1) {
      insertGroup(server.db, {
        id: `group-${index}`,
        name: `第${index}組`,
        position: index,
      });
    }

    const teacherToken = issueSession(server.db, { role: 'teacher' });
    const teacherSocket = server.connect({
      token: teacherToken,
      autoConnect: false,
    });
    const teacherInitial = waitForState(teacherSocket);
    teacherSocket.connect();
    await teacherInitial;

    const ack = await sendCommand(teacherSocket, 'group:create', {
      name: '第 51 組',
    });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'GROUP_LIMIT_REACHED', message: expect.any(String) },
    });
    expect(countGroups(server.db)).toBe(50);
    // 被拒絕的指令不得改變資料，也不得觸發廣播（原則 III）。
    await expectNoState(teacherSocket);
  });
});
