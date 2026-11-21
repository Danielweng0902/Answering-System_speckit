import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import { STATE_EVENT, type TeacherSnapshot } from '@classroom/shared';
import { issueSession } from '../../src/app/access.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import {
  seedQuestion,
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

/** 連線可能保留前面成功指令的舊 state；此測試輪只需等待真正的 closed。 */
function waitForFirstClosedState(
  socket: Socket,
  timeoutMilliseconds = 30_000,
): Promise<TeacherSnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(STATE_EVENT, onState);
      reject(new Error('Timed out waiting for the first closed state'));
    }, timeoutMilliseconds);
    function onState(snapshot: unknown): void {
      if (
        typeof snapshot !== 'object' ||
        snapshot === null ||
        !('phase' in snapshot) ||
        snapshot.phase !== 'closed'
      ) {
        return;
      }
      clearTimeout(timeout);
      socket.off(STATE_EVENT, onState);
      resolve(snapshot as TeacherSnapshot);
    }
    socket.on(STATE_EVENT, onState);
  });
}

describe('斷線後以同一 token 重新連線', () => {
  let server: TestServer;
  let teacherToken: string;
  let studentToken: string;

  beforeEach(async () => {
    server = await startTestServer();
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
    // 002（FR-020）：開啟搶答前先有題目。
    seedQuestion(server.db);
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

it('五十組重連期間結束活動：最後 presence 每組 1、各自收到 closed 與正確答案', async () => {
  const target = await startTestServer();
  try {
    seedQuestion(target.db);
    const teacherToken = issueSession(target.db, { role: 'teacher' });
    const teacher = target.connect({ token: teacherToken, autoConnect: false });
    const teacherInitial = waitForState(teacher);
    teacher.connect();
    await teacherInitial;

    const students: ReturnType<typeof target.connect>[] = [];
    const tokens: string[] = [];
    for (let position = 1; position <= 50; position += 1) {
      const groupId = `group-${position}`;
      insertGroup(target.db, {
        id: groupId,
        name: `第 ${position} 組`,
        position,
      });
      const token = issueSession(target.db, { role: 'student', groupId });
      tokens.push(token);
      const student = target.connect({ token, autoConnect: false });
      const connected = [student, teacher, ...students].map((socket) =>
        waitForState(socket),
      );
      student.connect();
      await Promise.all(connected);
      students.push(student);
    }

    const openedStates = [teacher, ...students].map((socket) =>
      waitForState(socket),
    );
    expect(await sendCommand(teacher, 'activity:open', {})).toEqual({
      ok: true,
    });
    await Promise.all(openedStates);
    const acks = await Promise.all(
      students.map((student, index) =>
        sendCommand(student, 'answer:submit', {
          questionNumber: 1,
          answers: [`第 ${index + 1} 組保留答案`],
        }),
      ),
    );
    expect(acks).toEqual(Array.from({ length: 50 }, () => ({ ok: true })));

    await Promise.all(
      students.map(async (student) => {
        const disconnected = new Promise<void>((resolve) => {
          student.once('disconnect', () => resolve());
        });
        student.disconnect();
        await disconnected;
      }),
    );
    const teacherClosed = waitForFirstClosedState(teacher);
    expect(await sendCommand(teacher, 'activity:close', {})).toEqual({
      ok: true,
    });
    expect((await teacherClosed).phase).toBe('closed');

    const reconnected = tokens.map((token) =>
      target.connect({ token, autoConnect: false }),
    );
    const firstStates = reconnected.map((student) =>
      waitForState(student, 30_000),
    );
    for (const student of reconnected) student.connect();
    const snapshots = await Promise.all(firstStates);
    for (const [index, snapshot] of snapshots.entries()) {
      expect(snapshot).toMatchObject({
        role: 'student',
        phase: 'closed',
        myGroupId: `group-${index + 1}`,
        myAnswers: [
          {
            questionNumber: 1,
            state: 'submitted',
            answers: [`第 ${index + 1} 組保留答案`],
          },
        ],
      });
    }

    const finalTeacher = target.connect({
      token: teacherToken,
      autoConnect: false,
    });
    const finalInitial = waitForState(finalTeacher, 30_000);
    finalTeacher.connect();
    const finalSnapshot = (await finalInitial) as TeacherSnapshot;
    expect(finalSnapshot.role).toBe('teacher');
    for (let position = 1; position <= 50; position += 1) {
      expect(finalSnapshot.presence[`group-${position}`]).toBe(1);
      expect(finalSnapshot.board[0]?.cells[position - 1]).toMatchObject({
        groupId: `group-${position}`,
        state: 'submitted',
        answers: [`第 ${position} 組保留答案`],
      });
    }
  } finally {
    await target.close();
  }
}, 60_000);
