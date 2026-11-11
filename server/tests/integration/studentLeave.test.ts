import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TeacherSnapshot } from '@classroom/shared';
import { issueSession } from '../../src/app/access.js';
import { getActivity, updateActivity } from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import {
  sendCommand,
  startTestServer,
  waitForSessionInvalid,
  waitForState,
  type TestServer,
} from './helpers.js';

function expectNoState(socket: Socket, milliseconds = 300): Promise<void> {
  return expect(waitForState(socket, milliseconds)).rejects.toThrow(
    'Timed out waiting for a state snapshot',
  );
}

describe('student:leave and deleted student groups', () => {
  let server: TestServer;
  let teacherSocket: Socket;
  let studentSocket: Socket;

  beforeEach(async () => {
    server = await startTestServer();
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });

    const teacherToken = issueSession(server.db, { role: 'teacher' });
    const studentToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-1',
    });

    teacherSocket = server.connect({ token: teacherToken, autoConnect: false });
    const teacherInitial = waitForState(teacherSocket);
    teacherSocket.connect();
    await teacherInitial;

    studentSocket = server.connect({ token: studentToken, autoConnect: false });
    const teacherSawStudent = waitForState(teacherSocket);
    const studentInitial = waitForState(studentSocket);
    studentSocket.connect();
    await Promise.all([teacherSawStudent, studentInitial]);
  });

  afterEach(async () => {
    await server.close();
  });

  it('準備中離開成功，該連線收到 guest 快照且老師 presence 減少', async () => {
    const beforeLeave = (await getActivity(server.db))?.revision;
    const teacherState = waitForState(teacherSocket);
    const studentState = waitForState(studentSocket);

    const ack = await sendCommand(studentSocket, 'student:leave', {});

    expect(ack).toEqual({ ok: true });
    const [teacherSnapshot, studentSnapshot] = await Promise.all([
      teacherState,
      studentState,
    ]);
    expect(studentSnapshot.role).toBe('guest');
    expect(studentSnapshot).not.toHaveProperty('presence');
    expect((teacherSnapshot as TeacherSnapshot).presence['group-1']).toBe(0);
    expect(teacherSnapshot.revision).toBeGreaterThan(beforeLeave ?? -1);
  });

  it('搶答中回覆 INVALID_PHASE，且不觸發任何 state 廣播', async () => {
    const activity = getActivity(server.db);
    if (!activity) {
      throw new Error('Activity state is not initialized');
    }
    updateActivity(server.db, { ...activity, phase: 'open' });

    const ack = await sendCommand(studentSocket, 'student:leave', {});

    expect(ack).toEqual({
      ok: false,
      error: { code: 'INVALID_PHASE', message: expect.any(String) },
    });
    await expectNoState(studentSocket);
    await expectNoState(teacherSocket);
  });

  it('guest 與 teacher 都收到 FORBIDDEN，且不廣播', async () => {
    const guestSocket = server.connect({ autoConnect: false });
    const guestInitial = waitForState(guestSocket);
    guestSocket.connect();
    await guestInitial;

    const guestAck = await sendCommand(guestSocket, 'student:leave', {});
    expect(guestAck).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: expect.any(String) },
    });
    await expectNoState(guestSocket);

    const teacherAck = await sendCommand(teacherSocket, 'student:leave', {});
    expect(teacherAck).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: expect.any(String) },
    });
    await expectNoState(teacherSocket);
  });

  it('老師刪除組別後，該組學生收到 session:invalid', async () => {
    const invalidPromise = waitForSessionInvalid(studentSocket);

    const ack = await sendCommand(teacherSocket, 'group:delete', {
      groupId: 'group-1',
    });

    expect(ack).toEqual({ ok: true });
    await expect(invalidPromise).resolves.toEqual({
      code: 'GROUP_NOT_FOUND',
    });
  });
});
