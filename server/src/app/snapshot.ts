import type { DatabaseSync } from 'node:sqlite';
import type { Snapshot, SnapshotBase } from '@classroom/shared';
import type { AccessIdentity } from './access.js';
import { getActivity } from '../infra/db/activityRepo.js';
import { listGroups } from '../infra/db/groupRepo.js';
import { getGuidedNotes, list as listQuestions } from '../infra/db/questionRepo.js';

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
    case 'teacher': {
      // 002（FR-016）：題目摘要與學習單資訊只有老師快照有；
      // 學生與訪客快照絕對不加這兩個欄位（原則 VI）。
      const guidedNotes = getGuidedNotes(database);
      return {
        ...base,
        role: 'teacher',
        presence: { ...presence },
        questions: listQuestions(database).map((question) => ({
          number: question.number,
          kind: question.kind,
          prompt: question.prompt,
          blankCount: question.blanks.length,
        })),
        guidedNotes: guidedNotes
          ? {
              sheetName: guidedNotes.sheetName,
              sourceKind: guidedNotes.sourceKind,
              fileName: guidedNotes.fileName,
              importedAt: guidedNotes.importedAt,
            }
          : null,
      };
    }
  }
}
