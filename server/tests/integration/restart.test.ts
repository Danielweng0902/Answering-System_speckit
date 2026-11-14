import { describe, expect, it } from 'vitest';
import { issueSession } from '../../src/app/access.js';
import {
  getActivity,
  updateActivity,
  type Activity,
} from '../../src/infra/db/activityRepo.js';
import {
  insertGroup,
  listGroups,
  type Group,
} from '../../src/infra/db/groupRepo.js';
import {
  seedQuestion,
  sendCommand,
  startTestServer,
  waitForState,
  type TestServer,
} from './helpers.js';

function readActivity(server: TestServer): Activity {
  const activity = getActivity(server.db);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }
  return activity;
}

describe('伺服器以同一 SQLite 資料夾重新啟動', () => {
  it('保留階段、組別順序、倒數結束時間與舊師生 token（AC-001-21）', async () => {
    let server = await startTestServer();
    const dataDir = server.dataDir;

    try {
      const groups: Group[] = [
        { id: 'group-c', name: '第三組', position: 3 },
        { id: 'group-a', name: '第一組', position: 1 },
        { id: 'group-b', name: '第二組', position: 2 },
      ];
      for (const group of groups) {
        insertGroup(server.db, group);
      }
      // 002（FR-020）：開啟搶答前先有題目。
      seedQuestion(server.db);

      const teacherToken = issueSession(server.db, { role: 'teacher' });
      const studentToken = issueSession(server.db, {
        role: 'student',
        groupId: 'group-a',
      });
      const teacherSocket = server.connect({
        token: teacherToken,
        autoConnect: false,
      });
      const teacherInitial = waitForState(teacherSocket);
      teacherSocket.connect();
      await teacherInitial;

      const teacherOpened = waitForState(teacherSocket);
      expect(await sendCommand(teacherSocket, 'activity:open', {})).toEqual({
        ok: true,
      });
      const openedState = await teacherOpened;
      expect(openedState.phase).toBe('open');

      const countdownEndsAt = new Date(
        Date.now() + 10 * 60 * 1_000,
      ).toISOString();
      updateActivity(server.db, {
        ...readActivity(server),
        countdownEndsAt,
      });

      const activityBeforeRestart = readActivity(server);
      const groupsBeforeRestart = listGroups(server.db);
      expect(openedState.groups).toEqual([
        { id: 'group-a', name: '第一組' },
        { id: 'group-b', name: '第二組' },
        { id: 'group-c', name: '第三組' },
      ]);

      await server.close({ preserveDataDir: true });
      server = await startTestServer({ dataDir });

      const studentSocket = server.connect({
        token: studentToken,
        autoConnect: false,
      });
      const studentFirstState = waitForState(studentSocket);
      studentSocket.connect();
      const studentState = await studentFirstState;

      const reconnectedTeacher = server.connect({
        token: teacherToken,
        autoConnect: false,
      });
      const teacherFirstState = waitForState(reconnectedTeacher);
      reconnectedTeacher.connect();
      const teacherState = await teacherFirstState;

      expect(studentState).toMatchObject({
        role: 'student',
        myGroupId: 'group-a',
        phase: activityBeforeRestart.phase,
        countdownEndsAt: activityBeforeRestart.countdownEndsAt,
        groups: openedState.groups,
      });
      expect(teacherState).toMatchObject({
        role: 'teacher',
        phase: activityBeforeRestart.phase,
        countdownEndsAt: activityBeforeRestart.countdownEndsAt,
        groups: openedState.groups,
      });
      expect(listGroups(server.db)).toEqual(groupsBeforeRestart);
      expect(readActivity(server).countdownEndsAt).toBe(countdownEndsAt);
      expect(activityBeforeRestart.countdownEndsAt).toBe(countdownEndsAt);
    } finally {
      await server.close();
    }
  });
});
