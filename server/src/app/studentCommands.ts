/**
 * 學生指令用例：student:leave（FR-012）。
 * 身分（只有 student）由指令路由把關；廣播由路由在 ack 為 ok 時觸發。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { Ack } from '@classroom/shared';
import { hashToken } from './access.js';
import { getActivity, updateActivity } from '../infra/db/activityRepo.js';
import { deleteSession } from '../infra/db/sessionRepo.js';
import { commandError } from '../infra/socket/commandRouter.js';

export type StudentCommandDependencies = {
  /** 成功離開後把這個連線降為 guest，並從 presence 移除。 */
  demoteToGuest: () => void;
};

export function leaveGroup(
  database: DatabaseSync,
  token: string | undefined,
  dependencies: StudentCommandDependencies,
): Ack {
  const activity = getActivity(database);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }
  if (activity.phase !== 'preparing') {
    return commandError('INVALID_PHASE');
  }

  database.exec('BEGIN');
  try {
    if (token !== undefined) {
      deleteSession(database, hashToken(token));
    }
    updateActivity(database, { ...activity, revision: activity.revision + 1 });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  dependencies.demoteToGuest();
  return { ok: true };
}
