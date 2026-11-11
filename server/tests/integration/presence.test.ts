import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TeacherSnapshot } from '@classroom/shared';
import { issueSession } from '../../src/app/access.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { startTestServer, waitForState, type TestServer } from './helpers.js';

describe('presence changes', () => {
  let server: TestServer;
  let teacherSocket: Socket;

  beforeEach(async () => {
    server = await startTestServer();
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });

    const teacherToken = issueSession(server.db, { role: 'teacher' });
    teacherSocket = server.connect({ token: teacherToken });
    const initial = await waitForState(teacherSocket);
    expect(initial.revision).toBe(0);
  });

  afterEach(async () => {
    await server.close();
  });

  it('bumps the revision and reports presence when a student connects', async () => {
    const studentToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-1',
    });

    const teacherState = waitForState(teacherSocket);
    const studentSocket = server.connect({
      token: studentToken,
      autoConnect: false,
    });
    const studentStatePromise = waitForState(studentSocket);
    studentSocket.connect();

    const snapshot = (await teacherState) as TeacherSnapshot;
    expect(snapshot.role).toBe('teacher');
    expect(snapshot.revision).toBeGreaterThan(0);
    expect(snapshot.presence['group-1']).toBe(1);

    const studentState = await studentStatePromise;
    expect(studentState.role).toBe('student');
    expect(studentState).not.toHaveProperty('presence');
  });

  it('bumps the revision and reports presence when a student disconnects', async () => {
    const studentToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-1',
    });
    const connected = waitForState(teacherSocket);
    const studentSocket = server.connect({ token: studentToken });
    const afterConnect = (await connected) as TeacherSnapshot;
    expect(afterConnect.presence['group-1']).toBe(1);

    const disconnected = waitForState(teacherSocket);
    studentSocket.disconnect();

    const afterDisconnect = (await disconnected) as TeacherSnapshot;
    expect(afterDisconnect.presence['group-1']).toBe(0);
    expect(afterDisconnect.revision).toBeGreaterThan(afterConnect.revision);
  });
});
