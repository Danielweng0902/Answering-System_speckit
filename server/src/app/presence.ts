/**
 * Presence 變更的應用層規則。
 *
 * 在線人數只存於記憶體（data-model.md「Presence」），但前端只接受
 * revision 較大的快照，所以學生連線／斷線造成 presence 改變時，
 * 必須先把 activity.revision 加 1 再廣播。
 */
import type { DatabaseSync } from 'node:sqlite';
import { getActivity, updateActivity } from '../infra/db/activityRepo.js';

/** 每次狀態改變（這裡是 presence 改變）將 activity.revision 加 1。 */
export function recordPresenceChange(database: DatabaseSync): void {
  const activity = getActivity(database);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }

  updateActivity(database, { ...activity, revision: activity.revision + 1 });
}
