import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import {
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

describe('斷線後以同一 token 重新連線', () => {
  let server: TestServer;
  let teacherToken: string;
  let studentToken: string;

  beforeEach(async () => {
    server = await startTestServer();
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
    teacherToken = issueSession(server.db, { role: 'teacher' });
    studentToken = issueSession(server.db, {
      role: 'student',
      groupId: 'group-1',
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it('學生回到原組，老師仍是 teacher（AC-001-18、20）', async () => {
    const teacherSocket = server.connect({
      token: teacherToken,
      autoConnect: false,
    });
    const teacherInitial = waitForState(teacherSocket);
    teacherSocket.connect();
    expect((await teacherInitial).role).toBe('teacher');

    const studentSocket = server.connect({
      token: studentToken,
      autoConnect: false,
    });
    const teacherSawStudent = waitForState(teacherSocket);
    const studentInitial = waitForState(studentSocket);
    studentSocket.connect();
    const [, initialStudentState] = await Promise.all([
      teacherSawStudent,
      studentInitial,
    ]);
    expect(initialStudentState).toMatchObject({
      role: 'student',
      myGroupId: 'group-1',
    });

    const teacherSawStudentLeave = waitForState(teacherSocket);
    studentSocket.disconnect();
    await teacherSawStudentLeave;
    teacherSocket.disconnect();

    const reconnectedStudent = server.connect({
      token: studentToken,
      autoConnect: false,
    });
    const studentFirstState = waitForState(reconnectedStudent);
    reconnectedStudent.connect();
    expect(await studentFirstState).toMatchObject({
      role: 'student',
      myGroupId: 'group-1',
    });

    const reconnectedTeacher = server.connect({
      token: teacherToken,
      autoConnect: false,
    });
    const teacherFirstState = waitForState(reconnectedTeacher);
    reconnectedTeacher.connect();
    expect((await teacherFirstState).role).toBe('teacher');
  });

  it('學生斷線期間開啟再結束，重連第一個 state 就是 closed（AC-001-19）', async () => {
    const teacherSocket = server.connect({
      token: teacherToken,
      autoConnect: false,
    });
    const teacherInitial = waitForState(teacherSocket);
    teacherSocket.connect();
    await teacherInitial;

    const studentSocket = server.connect({
      token: studentToken,
      autoConnect: false,
    });
    const teacherSawStudent = waitForState(teacherSocket);
    const studentInitial = waitForState(studentSocket);
    studentSocket.connect();
    await Promise.all([teacherSawStudent, studentInitial]);

    const teacherSawStudentLeave = waitForState(teacherSocket);
    studentSocket.disconnect();
    await teacherSawStudentLeave;

    const teacherOpened = waitForState(teacherSocket);
    expect(await sendCommand(teacherSocket, 'activity:open', {})).toEqual({
      ok: true,
    });
    expect((await teacherOpened).phase).toBe('open');

    const teacherClosed = waitForState(teacherSocket);
    expect(await sendCommand(teacherSocket, 'activity:close', {})).toEqual({
      ok: true,
    });
    expect((await teacherClosed).phase).toBe('closed');

    const reconnectedStudent = server.connect({
      token: studentToken,
      autoConnect: false,
    });
    const firstState = waitForState(reconnectedStudent);
    reconnectedStudent.connect();

    expect(await firstState).toMatchObject({
      role: 'student',
      myGroupId: 'group-1',
      phase: 'closed',
    });
  });
});
