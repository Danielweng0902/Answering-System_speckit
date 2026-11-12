import type { Socket } from 'socket.io-client';
import { STATE_EVENT, type CommandEvent } from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import {
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

const TEACHER_PW = 'noleak-teacher-pass';
const WRONG_PW = 'noleak-wrong-pass';

type CapturedEvent = { event: string; payload: unknown };

/** 以 onAny 擷取此連線收到的每一個事件（註冊後才 connect）。 */
function captureEvents(socket: Socket, captured: CapturedEvent[]): void {
  socket.onAny((event: string, ...args: unknown[]) => {
    captured.push({ event, payload: args[0] });
  });
}

function statesOf(captured: CapturedEvent[]): unknown[] {
  return captured
    .filter(({ event }) => event === STATE_EVENT)
    .map(({ payload }) => payload);
}

describe('資訊不外洩（原則 IV、VI；SC-005）', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer({ teacherPassword: TEACHER_PW });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.close();
  });

  it('學生與 guest 收到的一連串 state 快照都不含 presence（原則 VI）', async () => {
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
    insertGroup(server.db, { id: 'group-2', name: '第二組', position: 2 });

    const teacherToken = issueSession(server.db, { role: 'teacher' });
    const teacherSocket = server.connect({
      token: teacherToken,
      autoConnect: false,
    });
    const teacherInitial = waitForState(teacherSocket);
    teacherSocket.connect();
    await teacherInitial;

    const capturedByStudent: CapturedEvent[] = [];
    const capturedByNewStudent: CapturedEvent[] = [];
    const capturedByGuest: CapturedEvent[] = [];

    const studentToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-1',
    });
    const studentSocket = server.connect({
      token: studentToken,
      autoConnect: false,
    });
    captureEvents(studentSocket, capturedByStudent);
    const studentInitial = waitForState(studentSocket);
    studentSocket.connect();
    await studentInitial;

    const guestSocket = server.connect({ autoConnect: false });
    captureEvents(guestSocket, capturedByGuest);
    const guestInitial = waitForState(guestSocket);
    guestSocket.connect();
    await guestInitial;

    // 每次會改變狀態的指令前先在 guest 註冊等待，確定廣播已被擷取。
    async function runCommand(
      event: CommandEvent,
      payload: unknown,
    ): Promise<void> {
      const guestState = waitForState(guestSocket);
      expect(await sendCommand(teacherSocket, event, payload)).toEqual({
        ok: true,
      });
      await guestState;
    }

    // 建組與改名。
    await runCommand('group:create', { name: '第三組' });
    await runCommand('group:rename', {
      groupId: 'group-2',
      name: '改名第二組',
    });

    // 另一位學生進場：presence 改變會對所有人廣播。
    const newStudentToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-2',
    });
    const newStudentSocket = server.connect({
      token: newStudentToken,
      autoConnect: false,
    });
    captureEvents(newStudentSocket, capturedByNewStudent);
    const guestSawNewStudent = waitForState(guestSocket);
    const newStudentInitial = waitForState(newStudentSocket);
    newStudentSocket.connect();
    await Promise.all([guestSawNewStudent, newStudentInitial]);

    // 第一位學生離開，該連線降回 guest，之後繼續收到 guest 快照。
    const studentState = waitForState(studentSocket);
    const guestSawLeave = waitForState(guestSocket);
    expect(await sendCommand(studentSocket, 'student:leave', {})).toEqual({
      ok: true,
    });
    await Promise.all([studentState, guestSawLeave]);

    // 開啟 → 結束 → 重設。
    await runCommand('activity:open', {});
    await runCommand('activity:close', {});
    await runCommand('activity:reset', { confirm: true });

    const studentStates = statesOf(capturedByStudent);
    const newStudentStates = statesOf(capturedByNewStudent);
    const guestStates = statesOf(capturedByGuest);
    // 確認整串操作確實產生了多次快照，不是空斷言。
    expect(studentStates.length).toBeGreaterThanOrEqual(6);
    expect(newStudentStates.length).toBeGreaterThanOrEqual(3);
    expect(guestStates.length).toBeGreaterThanOrEqual(6);

    for (const snapshot of [
      ...studentStates,
      ...newStudentStates,
      ...guestStates,
    ]) {
      expect(snapshot).not.toHaveProperty('presence');
    }
  });

  it('伺服器 log 不含老師密碼，也不含任何回傳的 token（原則 IV）', async () => {
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });

    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ];

    // 錯誤密碼一次、正確密碼一次。
    const wrong = await fetch(`${server.url}/api/teacher/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: WRONG_PW }),
    });
    expect(wrong.status).toBe(401);
    await wrong.arrayBuffer();

    const correct = await fetch(`${server.url}/api/teacher/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: TEACHER_PW }),
    });
    expect(correct.status).toBe(200);
    const correctText = await correct.text();
    expect(correctText).not.toContain(TEACHER_PW);
    const teacherToken = (JSON.parse(correctText) as { token: string }).token;

    // 學生進場也會取得 token。
    const join = await fetch(`${server.url}/api/student/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId: 'group-1' }),
    });
    expect(join.status).toBe(200);
    const joinText = await join.text();
    expect(joinText).not.toContain(TEACHER_PW);
    const studentToken = (JSON.parse(joinText) as { token: string }).token;

    const logged = spies
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .join('\n');

    expect(logged).not.toContain(TEACHER_PW);
    expect(logged).not.toContain(WRONG_PW);
    expect(logged).not.toContain(teacherToken);
    expect(logged).not.toContain(studentToken);
  });
});
