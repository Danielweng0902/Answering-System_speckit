import type { DatabaseSync } from 'node:sqlite';
import type { Snapshot, SnapshotBase } from '@classroom/shared';
import type { AccessIdentity } from './access.js';
import {
  buildBoard,
  buildClosedMyAnswers,
  buildMyAnswers,
  buildProgress,
  buildResults,
  buildStudentQuestions,
} from './answerProjections.js';
import {
  getActivity,
  getAnswerEventCount,
  getSessionId,
} from '../infra/db/activityRepo.js';
import { getGroupAnswerRevision } from '../infra/db/answerRepo.js';
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

  const revision =
    identity.role === 'teacher'
      ? activity.revision + getAnswerEventCount(database)
      : identity.role === 'student'
        ? activity.revision + getGroupAnswerRevision(database, identity.groupId)
        : activity.revision;

  const base: SnapshotBase = {
    revision,
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
    case 'student': {
      const studentBase = {
        ...base,
        role: 'student' as const,
        myGroupId: identity.groupId,
        sessionId: getSessionId(database),
      };
      if (activity.phase === 'preparing') {
        return { ...studentBase, phase: 'preparing' as const };
      }
      if (activity.phase === 'open') {
        return {
          ...studentBase,
          phase: 'open' as const,
          questions: buildStudentQuestions(database),
          myAnswers: buildMyAnswers(database, identity.groupId),
        };
      }
      // 003 US4（T035）：closed 學生快照含每題搶答結果與本組含順位的答案。
      return {
        ...studentBase,
        phase: 'closed' as const,
        questions: buildStudentQuestions(database),
        results: buildResults(database),
        myAnswers: buildClosedMyAnswers(database, identity.groupId),
      };
    }
    case 'teacher': {
      // 002（FR-016）：題目摘要與學習單資訊只有老師快照有；003 學生快照
      // 的 questions 另有自己（空格 prefix）與本組作答投影（原則 VI）。
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
        // 003 US3（T030；FR-019–FR-022）：老師快照任何階段都輸出看板與進度。
        board: buildBoard(database),
        progress: buildProgress(database),
      };
    }
  }
}
