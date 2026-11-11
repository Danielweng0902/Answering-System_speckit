import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATE_EVENT, type Snapshot } from '@classroom/shared';
import { issueSession } from '../../src/app/access.js';
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

describe('group commands', () => {
  let server: TestServer;
  let teacherSocket: Socket;
  let guestSocket: Socket;

  beforeEach(async () => {
    server = await startTestServer();
    const teacherToken = issueSession(server.db, { role: 'teacher' });

    teacherSocket = server.connect({ token: teacherToken });
    guestSocket = server.connect();
    await Promise.all([
      waitForState(teacherSocket),
      waitForState(guestSocket),
    ]);
  });

  afterEach(async () => {
    await server.close();
  });

  it('broadcasts the new group to teacher and guest with an increased revision', async () => {
    const teacherState = waitForState(teacherSocket);
    const guestState = waitForState(guestSocket);

    const ack = await sendCommand(teacherSocket, 'group:create', {
      name: '  第一組  ',
    });

    expect(ack).toEqual({ ok: true });

    const [teacherSnapshot, guestSnapshot] = await Promise.all([
      teacherState,
      guestState,
    ]);

    expect(teacherSnapshot.revision).toBe(1);
    expect(teacherSnapshot.groups).toEqual([
      { id: expect.any(String), name: '第一組' },
    ]);
    expect(guestSnapshot.revision).toBe(1);
    expect(guestSnapshot.groups).toEqual([
      { id: expect.any(String), name: '第一組' },
    ]);
    expect(guestSnapshot).not.toHaveProperty('presence');
  });

  it('rejects group:create from guest and student with FORBIDDEN and no broadcast', async () => {
    const teacherCreated = waitForState(teacherSocket);
    const guestCreated = waitForState(guestSocket);
    const createAck = await sendCommand(teacherSocket, 'group:create', {
      name: '第一組',
    });
    expect(createAck).toEqual({ ok: true });
    const [created] = await Promise.all([teacherCreated, guestCreated]);
    const groupId = created.groups[0]?.id ?? '';
    expect(groupId).not.toBe('');

    const studentToken = issueSession(server.db, {
      role: 'student',
      groupId,
    });
    // 學生連線本身會推送 state，先把這些快照收完。
    const teacherPresence = waitForState(teacherSocket);
    const guestPresence = waitForState(guestSocket);
    const studentSocket = server.connect({ token: studentToken });
    await Promise.all([
      teacherPresence,
      guestPresence,
      waitForState(studentSocket),
    ]);

    const guestAck = await sendCommand(guestSocket, 'group:create', {
      name: '第二組',
    });
    expect(guestAck).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: expect.any(String) },
    });
    await expectNoState(guestSocket);

    const studentAck = await sendCommand(studentSocket, 'group:create', {
      name: '第二組',
    });
    expect(studentAck).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: expect.any(String) },
    });
    await expectNoState(guestSocket);
    await expectNoState(studentSocket);

    // 被拒絕的指令沒有改變資料。
    expect(
      server.db.prepare('SELECT COUNT(*) AS count FROM groups').get(),
    ).toEqual({ count: 1 });
  });

  it('replies with the validation error and broadcasts nothing for invalid names', async () => {
    const emptyAck = await sendCommand(teacherSocket, 'group:create', {
      name: '   ',
    });
    expect(emptyAck).toEqual({
      ok: false,
      error: { code: 'GROUP_NAME_EMPTY', message: expect.any(String) },
    });
    await expectNoState(teacherSocket);

    const longAck = await sendCommand(teacherSocket, 'group:create', {
      name: 'a'.repeat(31),
    });
    expect(longAck).toEqual({
      ok: false,
      error: { code: 'GROUP_NAME_TOO_LONG', message: expect.any(String) },
    });
    await expectNoState(teacherSocket);

    const teacherCreated = waitForState(teacherSocket);
    const guestCreated = waitForState(guestSocket);
    const firstAck = await sendCommand(teacherSocket, 'group:create', {
      name: '第一組',
    });
    expect(firstAck).toEqual({ ok: true });
    await Promise.all([teacherCreated, guestCreated]);

    const duplicateAck = await sendCommand(teacherSocket, 'group:create', {
      name: ' 第一組 ',
    });
    expect(duplicateAck).toEqual({
      ok: false,
      error: { code: 'GROUP_NAME_DUPLICATE', message: expect.any(String) },
    });
    await expectNoState(teacherSocket);
    await expectNoState(guestSocket);
  });

  it('renames and deletes groups, and invalidates students of a deleted group', async () => {
    const teacherCreated = waitForState(teacherSocket);
    const createAck = await sendCommand(teacherSocket, 'group:create', {
      name: '第一組',
    });
    expect(createAck).toEqual({ ok: true });
    const created = await teacherCreated;
    const groupId = created.groups[0]?.id ?? '';
    expect(groupId).not.toBe('');

    const studentToken = issueSession(server.db, {
      role: 'student',
      groupId,
    });
    const studentSocket = server.connect({
      token: studentToken,
      autoConnect: false,
    });
    const studentStates: Snapshot[] = [];
    studentSocket.on(STATE_EVENT, (snapshot) => {
      studentStates.push(snapshot);
    });
    const teacherSawStudent = waitForState(teacherSocket);
    const studentInitial = waitForState(studentSocket);
    studentSocket.connect();
    await teacherSawStudent;
    await studentInitial;

    const teacherRenamed = waitForState(teacherSocket);
    const renameAck = await sendCommand(teacherSocket, 'group:rename', {
      groupId,
      name: '改名後',
    });
    expect(renameAck).toEqual({ ok: true });

    const renamed = await teacherRenamed;
    expect(renamed.groups[0]?.name).toBe('改名後');
    expect(renamed.revision).toBeGreaterThan(created.revision);

    const invalidPromise = waitForSessionInvalid(studentSocket);
    const teacherDeleted = waitForState(teacherSocket);
    const deleteAck = await sendCommand(teacherSocket, 'group:delete', {
      groupId,
    });
    expect(deleteAck).toEqual({ ok: true });

    const deleted = await teacherDeleted;
    expect(deleted.groups).toEqual([]);
    expect(deleted.revision).toBeGreaterThan(renamed.revision);

    await expect(invalidPromise).resolves.toEqual({ code: 'GROUP_NOT_FOUND' });

    // 被刪組的學生降為 guest，之後的快照不再是 student。
    await vi.waitFor(() => {
      expect(studentStates.at(-1)?.role).toBe('guest');
    });
  });

  it('rejects malformed payloads with INVALID_INPUT and no broadcast', async () => {
    const ack = await sendCommand(teacherSocket, 'group:rename', {
      groupId: 123,
    });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: expect.any(String) },
    });
    await expectNoState(teacherSocket);
  });
});
