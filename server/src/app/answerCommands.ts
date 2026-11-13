import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Ack, AnswerSubmitInput } from '@classroom/shared';
import { validateAnswer } from '../domain/answerValidation.js';
import {
  getActivity,
  incrementAnswerEventCount,
  type Activity,
} from '../infra/db/activityRepo.js';
import {
  findValid,
  incrementGroupAnswerRevision,
  insertSubmission,
  maxRank,
} from '../infra/db/answerRepo.js';
import { list as listQuestions } from '../infra/db/questionRepo.js';
import {
  commandError,
  type CommandUseCase,
} from '../infra/socket/commandRouter.js';

export type AnswerCommandUseCases = {
  submitAnswer: CommandUseCase;
};

export type AnswerCommandDependencies = {
  /** Server-side receive timestamp; tests can inject a fixed clock. */
  now?: (() => string) | undefined;
};

function readActivity(database: DatabaseSync): Activity {
  const activity = getActivity(database);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }
  return activity;
}

export function createAnswerCommands(
  database: DatabaseSync,
  dependencies: AnswerCommandDependencies = {},
): AnswerCommandUseCases {
  const now = dependencies.now ?? (() => new Date().toISOString());

  /** Must be called while an outer transaction is active. */
  function submitInTransaction(
    groupId: string,
    input: AnswerSubmitInput,
  ): Ack {
    const activity = readActivity(database);
    if (activity.phase !== 'open') {
      return commandError('INVALID_PHASE');
    }

    const question = listQuestions(database).find(
      (candidate) => candidate.number === input.questionNumber,
    );
    if (question === undefined) {
      return commandError('QUESTION_NOT_FOUND');
    }
    if (input.answers.length !== question.blanks.length) {
      return commandError('BLANK_COUNT_MISMATCH');
    }

    const validatedAnswers: string[] = [];
    for (const answer of input.answers) {
      const validation = validateAnswer(answer);
      if (!validation.ok) {
        return commandError(validation.code);
      }
      validatedAnswers.push(validation.answer);
    }

    if (findValid(database, question.id, groupId) !== null) {
      return commandError('ALREADY_SUBMITTED');
    }

    insertSubmission(database, {
      id: randomUUID(),
      questionId: question.id,
      groupId,
      rank: maxRank(database, question.id) + 1,
      receivedAt: now(),
      answers: validatedAnswers,
    });
    // 003 US2 / research R4：作答事件不改 activity.revision。該組與老師
    // 各自依持久化的分開 counter 得到單調快照 revision；其他組與 guest 不
    // 因本事件產生任何 revision 變化。
    incrementGroupAnswerRevision(database, groupId);
    incrementAnswerEventCount(database);
    return { ok: true };
  }

  return {
    submitAnswer(identity, payload): Ack {
      if (identity.role !== 'student') {
        return commandError('FORBIDDEN');
      }
      const input = payload as AnswerSubmitInput;

      database.exec('BEGIN IMMEDIATE');
      try {
        const ack = submitInTransaction(identity.groupId, input);

        // 失敗一律 ROLLBACK：不保存作答、rank 或 revision 變化（原則 III）。
        database.exec(ack.ok ? 'COMMIT' : 'ROLLBACK');
        return ack;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
