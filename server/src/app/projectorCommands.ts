/**
 * 投影看板指令（005 US3；T027；FR-017、FR-022）。
 *
 * 只有老師、只有在「已結束」階段可以揭曉。揭曉進度存在
 * `activity.revealed_question_count`，依**題號順序**前進；重設活動時歸零
 * （FR-023）。揭曉只影響投影看板，學生端在結束時仍看得到完整結果。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { Ack } from '@classroom/shared';
import { getActivity, updateActivity } from '../infra/db/activityRepo.js';
import { count as countQuestions } from '../infra/db/questionRepo.js';
import {
  commandError,
  type CommandUseCase,
} from '../infra/socket/commandRouter.js';

export type ProjectorCommandUseCases = {
  revealNext: CommandUseCase;
  revealAll: CommandUseCase;
};

export function createProjectorCommands(
  database: DatabaseSync,
): ProjectorCommandUseCases {
  function readActivity() {
    const activity = getActivity(database);
    if (!activity) {
      throw new Error('Activity state is not initialized');
    }
    return activity;
  }

  /** 只有已結束能揭曉；回傳目前要寫入的揭曉數。 */
  function nextRevealCount(
    mode: 'next' | 'all',
  ): { ok: true; count: number } | { ok: false; code: 'INVALID_PHASE' } {
    const activity = readActivity();
    if (activity.phase !== 'closed') {
      return { ok: false, code: 'INVALID_PHASE' };
    }
    const total = countQuestions(database);
    if (mode === 'all') {
      return { ok: true, count: total };
    }
    return { ok: true, count: Math.min(activity.revealedQuestionCount + 1, total) };
  }

  function persist(count: number): Ack {
    const activity = readActivity();
    if (activity.revealedQuestionCount === count) {
      // 冪等：已經全部揭曉時再按「下一題」不寫入、不遞增 revision。
      return { ok: true };
    }
    updateActivity(database, {
      ...activity,
      revealedQuestionCount: count,
      revision: activity.revision + 1,
    });
    return { ok: true };
  }

  return {
    revealNext(): Ack {
      const result = nextRevealCount('next');
      if (!result.ok) {
        return commandError(result.code);
      }
      return persist(result.count);
    },
    revealAll(): Ack {
      const result = nextRevealCount('all');
      if (!result.ok) {
        return commandError(result.code);
      }
      return persist(result.count);
    },
  };
}
