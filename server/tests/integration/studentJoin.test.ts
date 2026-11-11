import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Phase, TeacherSnapshot } from '@classroom/shared';
import { issueSession } from '../../src/app/access.js';
import { getActivity, updateActivity } from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { startTestServer, waitForState, type TestServer } from './helpers.js';

type JoinSuccessBody = {
  token: string;
  role: 'student';
  groupId: string;
};

describe('POST /api/student/join', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
    insertGroup(server.db, { id: 'group-1', name: '第一組', position: 1 });
  });

  afterEach(async () => {
    await server.close();
  });

  function setPhase(phase: Phase): void {
    const activity = getActivity(server.db);
    if (!activity) {
      throw new Error('Activity state is not initialized');
    }
    updateActivity(server.db, { ...activity, phase });
  }

  function postStudentJoin(body: unknown): Promise<Response> {
    return fetch(`${server.url}/api/student/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function joinStudent(groupId: string): Promise<JoinSuccessBody> {
    const response = await postStudentJoin({ groupId });
    expect(response.status).toBe(200);
    return (await response.json()) as JoinSuccessBody;
  }

  function connectStudent(token: string): Socket {
    return server.connect({ token, autoConnect: false });
  }

  it('成功建立學生 session；格式錯誤與不存在的組別依合約拒絕', async () => {
    const invalidInput = await postStudentJoin({});
    expect(invalidInput.status).toBe(400);
    await expect(invalidInput.json()).resolves.toEqual({
      error: { code: 'INVALID_INPUT', message: expect.any(String) },
    });

    const missingGroup = await postStudentJoin({ groupId: 'missing-group' });
    expect(missingGroup.status).toBe(404);
    await expect(missingGroup.json()).resolves.toEqual({
      error: { code: 'GROUP_NOT_FOUND', message: expect.any(String) },
    });

    const response = await postStudentJoin({ groupId: 'group-1' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: expect.any(String),
      role: 'student',
      groupId: 'group-1',
    });
  });

  it('兩個連線加入同一組都成功，老師 presence 為 2，學生快照不含 presence', async () => {
    const teacherToken = issueSession(server.db, { role: 'teacher' });
    const teacherSocket = server.connect({
      token: teacherToken,
      autoConnect: false,
    });
    const teacherInitial = waitForState(teacherSocket);
    teacherSocket.connect();
    await teacherInitial;

    const firstJoin = await joinStudent('group-1');
    const firstSocket = connectStudent(firstJoin.token);
    const teacherSawFirst = waitForState(teacherSocket);
    const firstStatePromise = waitForState(firstSocket);
    firstSocket.connect();

    const [firstTeacherState, firstStudentState] = await Promise.all([
      teacherSawFirst,
      firstStatePromise,
    ]);
    expect((firstTeacherState as TeacherSnapshot).presence['group-1']).toBe(1);
    expect(firstStudentState).toMatchObject({
      role: 'student',
      myGroupId: 'group-1',
    });
    expect(firstStudentState).not.toHaveProperty('presence');

    const secondJoin = await joinStudent('group-1');
    const secondSocket = connectStudent(secondJoin.token);
    const teacherSawSecond = waitForState(teacherSocket);
    const secondStatePromise = waitForState(secondSocket);
    secondSocket.connect();

    const [secondTeacherState, secondStudentState] = await Promise.all([
      teacherSawSecond,
      secondStatePromise,
    ]);
    expect((secondTeacherState as TeacherSnapshot).presence['group-1']).toBe(2);
    expect(secondStudentState).toMatchObject({
      role: 'student',
      myGroupId: 'group-1',
    });
    expect(secondStudentState).not.toHaveProperty('presence');
    expect(secondJoin.token).not.toBe(firstJoin.token);
  });

  it('搶答中仍允許進場，學生第一個快照就是 open', async () => {
    setPhase('open');

    const joined = await joinStudent('group-1');
    const socket = connectStudent(joined.token);
    const statePromise = waitForState(socket);
    socket.connect();

    const state = await statePromise;
    expect(state).toMatchObject({
      role: 'student',
      myGroupId: 'group-1',
      phase: 'open',
    });
    expect(state).not.toHaveProperty('presence');
  });
});
