import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TeacherSnapshot } from '@classroom/shared';
import { issueSession } from '../../src/app/access.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import {
  seedQuestions,
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

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

async function connectAndDrain(initial: Socket, sockets: Socket[]): Promise<SnapshotShape> {
  const waits = [waitForState(initial), ...sockets.map((socket) => waitForState(socket))];
  initial.connect();
  return (await Promise.all(waits))[0] as SnapshotShape;
}

// 只用本測試需要的欄位，避免在 52 封快照間複製 union 型別防護。
type SnapshotShape = {
  role: string;
  phase: string;
  presence?: Record<string, number>;
};

describe('滿場 presence 覆蓋', () => {
  let server: TestServer;
  let teacherSocket: Socket;

  afterEach(async () => {
    await server.close();
  });

  it('50 組在線的定向送出與整房 presence：斷線 51 位、重連 52 位都收到 state', async () => {
    server = await startTestServer();
    for (let position = 1; position <= 50; position += 1) {
      insertGroup(server.db, {
        id: `group-${position}`,
        name: `第 ${position} 組`,
        position,
      });
    }
    seedQuestions(server.db, [{ number: 1, prompt: 'presence 題目' }]);

    const teacherToken = issueSession(server.db, { role: 'teacher' });
    teacherSocket = server.connect({ token: teacherToken, autoConnect: false });
    await connectAndDrain(teacherSocket, []);

    const students: Socket[] = [];
    const tokens: string[] = [];
    for (let position = 1; position <= 50; position += 1) {
      const token = issueSession(server.db, {
        role: 'student',
        groupId: `group-${position}`,
      });
      tokens.push(token);
      const student = server.connect({ token, autoConnect: false });
      await connectAndDrain(student, [teacherSocket, ...students]);
      students.push(student);
    }
    const projector = server.connect({
      token: teacherToken,
      view: 'projector',
      autoConnect: false,
    });
    await connectAndDrain(projector, []);
    const allSockets = [teacherSocket, ...students, projector];
    expect(allSockets).toHaveLength(52);

    const openedStates = allSockets.map((socket) => waitForState(socket));
    expect(await sendCommand(teacherSocket, 'activity:open', {})).toEqual({
      ok: true,
    });
    expect(await Promise.all(openedStates)).toHaveLength(52);

    const related = [teacherSocket, students[49]!, projector];
    const unrelated = students.slice(0, 49);
    let unrelatedStates = 0;
    for (const socket of unrelated) {
      socket.on('state', () => {
        unrelatedStates += 1;
      });
    }
    const changedStates = related.map((socket) => waitForState(socket));
    expect(
      await sendCommand(students[49]!, 'answer:submit', {
        questionNumber: 1,
        answers: ['只有第五十組的答案'],
      }),
    ).toEqual({ ok: true });
    const changed = await Promise.all(changedStates);
    expect(changed).toHaveLength(3);
    expect(unrelatedStates).toBe(0);
    const projectorAfterSubmit = changed[2]!;
    expect(projectorAfterSubmit.role).toBe('projector');
    expect(JSON.stringify(projectorAfterSubmit)).not.toContain('只有第五十組的答案');
    expect(projectorAfterSubmit).not.toHaveProperty('board');
    expect(projectorAfterSubmit).not.toHaveProperty('results');

    const survivors = [...unrelated, teacherSocket, projector];
    expect(survivors).toHaveLength(51);
    const disconnectedStates = survivors.map((socket) => waitForState(socket));
    students[49]!.disconnect();
    expect(await Promise.all(disconnectedStates)).toHaveLength(51);

    const reconnected = server.connect({
      token: tokens[49]!,
      autoConnect: false,
    });
    const reconnectedStates = [...survivors, reconnected].map((socket) => waitForState(socket));
    reconnected.connect();
    const finalStates = await Promise.all(reconnectedStates);
    expect(finalStates).toHaveLength(52);
    const finalTeacher = finalStates[49] as unknown as TeacherSnapshot;
    expect(finalTeacher.role).toBe('teacher');
    for (let position = 1; position <= 50; position += 1) {
      expect(finalTeacher.presence[`group-${position}`]).toBe(1);
    }
    const finalProjector = finalStates[50]!;
    expect(JSON.stringify(finalProjector)).not.toContain('只有第五十組的答案');
    expect(finalProjector).not.toHaveProperty('results');
  }, 30_000);
});
