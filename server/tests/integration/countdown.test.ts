import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import type { CountdownScheduler } from '../../src/app/countdown.js';
import { getActivity, type Activity } from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import {
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

const START = Date.parse('2026-11-12T08:00:00.000Z');

type PendingTimer = {
  handle: number;
  ms: number;
  fn: () => void;
};

/** 手動時鐘：時間由測試推進，到期回呼由測試觸發（T064 的注入點）。 */
function createManualScheduler(startMs: number) {
  let currentMs = startMs;
  let nextHandle = 1;
  const pending = new Map<number, PendingTimer>();
  const cleared: number[] = [];

  const scheduler: CountdownScheduler = {
    now: () => currentMs,
    setTimeout: (fn, ms) => {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, { handle, ms, fn });
      return handle;
    },
    clearTimeout: (handle) => {
      const numeric = handle as number;
      cleared.push(numeric);
      pending.delete(numeric);
    },
  };

  return {
    scheduler,
    advance: (ms: number): void => {
      currentMs += ms;
    },
    now: (): number => currentMs,
    pending: (): PendingTimer[] => [...pending.values()],
    cleared: (): number[] => [...cleared],
    /** 強制觸發回呼（即使已被取消，模擬競爭時殘留的回呼）。 */
    fire: (timer: PendingTimer): void => {
      // 真實的 setTimeout 觸發後就不再排程，這裡同步移除。
      pending.delete(timer.handle);
      timer.fn();
    },
  };
}

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

describe('倒數計時自動結束（手動時鐘）', () => {
  let server: TestServer;
  let manual: ReturnType<typeof createManualScheduler>;
  let teacherSocket: Socket;
  let studentSocket: Socket;
  let guestSocket: Socket;

  beforeEach(async () => {
    manual = createManualScheduler(START);
    server = await startTestServer({ scheduler: manual.scheduler });
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
    insertGroup(server.db, { id: 'group-2', name: '第二組', position: 2 });

    const teacherToken = issueSession(server.db, { role: 'teacher' });
    const studentToken = issueSession(server.db, {
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

  function sockets(): Socket[] {
    return [teacherSocket, studentSocket, guestSocket];
  }

  it('時間到自動變 closed 並廣播給所有連線（FR-025、AC-001-23）', async () => {
    let states = Promise.all(sockets().map((socket) => waitForState(socket)));
    expect(
      await sendCommand(teacherSocket, 'activity:open', {
        countdownSeconds: 10,
      }),
    ).toEqual({ ok: true });

    const expectedEndsAt = new Date(START + 10_000).toISOString();
    const opened = await states;
    for (const snapshot of opened) {
      expect(snapshot.phase).toBe('open');
      expect(snapshot.countdownEndsAt).toBe(expectedEndsAt);
    }
    const afterOpen = readActivity(server);
    expect(afterOpen.countdownEndsAt).toBe(expectedEndsAt);

    // 計時器依「結束時間 − 現在」排程。
    const timer = manual.pending()[0] as PendingTimer;
    expect(timer.ms).toBe(10_000);

    // 推進手動時鐘到結束時間並觸發到期回呼。
    manual.advance(10_000);
    states = Promise.all(sockets().map((socket) => waitForState(socket)));
    manual.fire(timer);

    const closed = await states;
    for (const snapshot of closed) {
      expect(snapshot.phase).toBe('closed');
      // 只有這次改變使 revision +1。
      expect(snapshot.revision).toBe(afterOpen.revision + 1);
    }
    const activity = readActivity(server);
    expect(activity.phase).toBe('closed');
    expect(activity.closedAt).toBe(expectedEndsAt);
    // 觸發後沒有殘留的排程。
    expect(manual.pending()).toHaveLength(0);
  });

  it('時間到之前手動 close 會取消計時，殘留回呼不再改變狀態（AC-001-24）', async () => {
    let states = Promise.all(sockets().map((socket) => waitForState(socket)));
    expect(
      await sendCommand(teacherSocket, 'activity:open', {
        countdownSeconds: 60,
      }),
    ).toEqual({ ok: true });
    await states;
    const timer = manual.pending()[0] as PendingTimer;

    states = Promise.all(sockets().map((socket) => waitForState(socket)));
    expect(await sendCommand(teacherSocket, 'activity:close', {})).toEqual({
      ok: true,
    });
    await states;
    const afterClose = readActivity(server);
    expect(afterClose.phase).toBe('closed');

    // 計時器已被取消。
    expect(manual.cleared()).toContain(timer.handle);

    // 即使殘留的回呼之後被觸發，狀態也不再改變、也不廣播。
    manual.advance(60_000);
    manual.fire(timer);
    expect(readActivity(server)).toEqual(afterClose);
    await expectNoState(teacherSocket);
    await expectNoState(studentSocket);
    await expectNoState(guestSocket);
  });

  it('倒數歸零與手動 close 同時發生只結束一次，revision 只 +1（FR-026）', async () => {
    const states = Promise.all(sockets().map((socket) => waitForState(socket)));
    expect(
      await sendCommand(teacherSocket, 'activity:open', {
        countdownSeconds: 10,
      }),
    ).toEqual({ ok: true });
    await states;
    const afterOpen = readActivity(server);
    const timer = manual.pending()[0] as PendingTimer;

    // 先註冊等待再觸發：到期回呼與手動 close 緊接著發生。
    const closedStates = Promise.all(
      sockets().map((socket) => waitForState(socket)),
    );
    manual.advance(10_000);
    manual.fire(timer);
    const ack = await sendCommand(teacherSocket, 'activity:close', {});
    // 手動 close 對已結束的活動冪等回覆成功。
    expect(ack).toEqual({ ok: true });

    const closed = await closedStates;
    for (const snapshot of closed) {
      expect(snapshot.phase).toBe('closed');
      // 兩個觸發只產生一次狀態改變。
      expect(snapshot.revision).toBe(afterOpen.revision + 1);
    }

    const activity = readActivity(server);
    expect(activity.revision).toBe(afterOpen.revision + 1);
    expect(activity.closedAt).toBe(new Date(START + 10_000).toISOString());
  });
});

describe('啟動還原倒數（T059、research R7）', () => {
  let dataDir: string;
  let databasePath: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'classroom-countdown-'));
    databasePath = join(dataDir, 'app.db');
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  /** 啟動第一個伺服器、開一場有倒數的活動後關閉，回傳關閉時的狀態。 */
  async function openWithCountdownThenClose(seconds: number): Promise<{
    activity: Activity;
  }> {
    const manual = createManualScheduler(START);
    const server = await startTestServer({
      databasePath,
      scheduler: manual.scheduler,
    });
    try {
      insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
      const teacherToken = issueSession(server.db, { role: 'teacher' });
      const teacherSocket = server.connect({
        token: teacherToken,
        autoConnect: false,
      });
      const initial = waitForState(teacherSocket);
      teacherSocket.connect();
      await initial;

      const opened = waitForState(teacherSocket);
      expect(
        await sendCommand(teacherSocket, 'activity:open', {
          countdownSeconds: seconds,
        }),
      ).toEqual({ ok: true });
      await opened;
      return { activity: readActivity(server) };
    } finally {
      await server.close();
    }
  }

  it('啟動時 countdownEndsAt 已過且仍是 open，立即 closed（FR-021）', async () => {
    const before = await openWithCountdownThenClose(10);
    expect(before.activity.phase).toBe('open');

    const manual = createManualScheduler(START + 10_000);
    const server = await startTestServer({
      databasePath,
      scheduler: manual.scheduler,
    });
    try {
      // 啟動（listen 之前）已立即結束：guest 的第一個快照就是 closed。
      const guestSocket = server.connect({ autoConnect: false });
      const initial = waitForState(guestSocket);
      guestSocket.connect();
      const snapshot = await initial;
      expect(snapshot.phase).toBe('closed');
      expect(snapshot.revision).toBe(before.activity.revision + 1);

      const activity = readActivity(server);
      expect(activity.phase).toBe('closed');
      expect(activity.closedAt).toBe(new Date(START + 10_000).toISOString());
      // 沒有重新排程多餘的計時器。
      expect(manual.pending()).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('啟動時倒數未過期，重新排程剩餘時間，時間到仍自動 closed', async () => {
    const before = await openWithCountdownThenClose(60);
    expect(before.activity.phase).toBe('open');
    expect(before.activity.countdownEndsAt).toBe(
      new Date(START + 60_000).toISOString(),
    );

    const manual = createManualScheduler(START + 5_000);
    const server = await startTestServer({
      databasePath,
      scheduler: manual.scheduler,
    });
    try {
      // 重新排程剩餘的 55 秒。
      const timer = manual.pending()[0] as PendingTimer;
      expect(timer.ms).toBe(55_000);

      const guestSocket = server.connect({ autoConnect: false });
      const initial = waitForState(guestSocket);
      guestSocket.connect();
      const snapshot = await initial;
      expect(snapshot.phase).toBe('open');
      expect(snapshot.countdownEndsAt).toBe(before.activity.countdownEndsAt);

      const closedState = waitForState(guestSocket);
      manual.advance(55_000);
      manual.fire(timer);
      const closed = await closedState;
      expect(closed.phase).toBe('closed');
      expect(closed.revision).toBe(before.activity.revision + 1);
      expect(readActivity(server).phase).toBe('closed');
    } finally {
      await server.close();
    }
  });
});
