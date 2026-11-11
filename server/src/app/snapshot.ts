import type { DatabaseSync } from 'node:sqlite';
import type { Snapshot, SnapshotBase } from '@classroom/shared';
import type { AccessIdentity } from './access.js';
import { getActivity } from '../infra/db/activityRepo.js';
import { listGroups } from '../infra/db/groupRepo.js';

export function createSnapshot(
  database: DatabaseSync,
  identity: AccessIdentity,
  presence: Readonly<Record<string, number>> = {},
  now = new Date(),
): Snapshot {
  const activity = getActivity(database);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }

  const base: SnapshotBase = {
    revision: activity.revision,
    serverNow: now.toISOString(),
    phase: activity.phase,
    countdownEndsAt: activity.countdownEndsAt,
    groups: listGroups(database).map((group) => ({
      id: group.id,
      name: group.name,
    })),
  };

  switch (identity.role) {
    case 'guest':
      return { ...base, role: 'guest' };
    case 'student':
      return { ...base, role: 'student', myGroupId: identity.groupId };
    case 'teacher':
      return { ...base, role: 'teacher', presence: { ...presence } };
  }
}
