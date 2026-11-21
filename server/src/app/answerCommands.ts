import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Ack, AnswerSubmitInput, AnswerVoidInput } from '@classroom/shared';
import { validateAnswer } from '../domain/answerValidation.js';
import { getActivity, incrementAnswerEventCount, type Activity } from '../infra/db/activityRepo.js';
import {
  findValid,
  incrementGroupAnswerRevision,
  insertSubmission,
  maxRank,
  voidSubmission,
  type SubmissionRecord,
} from '../infra/db/answerRepo.js';
import { getGroupById } from '../infra/db/groupRepo.js';
import { list as listQuestions } from '../infra/db/questionRepo.js';
import { commandError, type CommandUseCase } from '../infra/socket/commandRouter.js';

export type AnswerCommandUseCases = {
  submitAnswer: CommandUseCase;
  voidAnswer: CommandUseCase;
};

export type AnswerCommandDependencies = {
  /** Server-side receive timestamp; tests can inject a fixed clock. */
  now?: (() => string) | undefined;
  /**
   * 005（T014）：作答被接受後呼叫（在 transaction COMMIT 之後），讓伺服器
   * 安排「判定完成」的提醒；只在啟用公平順位時需要。
   */
  onAnswerAccepted?: ((questionNumber: number) => void) | undefined;
  /**
   * 2026-11-21 冷啟效能修正 P1：一筆作答**已 COMMIT** 後呼叫，讓行程內
   * 作答索引增量更新。必須與實際寫入同一對 questionId／groupId／rank；
   * ROLLBACK 或失敗的作答不會觸發。
   */
  onSubmissionRecorded?: ((record: SubmissionRecord) => void) | undefined;
  /**
   * 2026-11-21 冷啟效能修正 P1：一筆作廢**已 COMMIT** 後呼叫；voidedAt
   * 與寫入 submissions.voided_at 的是同一個時間戳。
   */
  onSubmissionVoided?:
    ((event: { questionId: string; groupId: string; voidedAt: string }) => void) | undefined;
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
  ): { ack: Ack; recorded?: SubmissionRecord } {
    const activity = readActivity(database);
    if (activity.phase !== 'open') {
      return { ack: commandError('INVALID_PHASE') };
    }

    const question = listQuestions(database).find(
      (candidate) => candidate.number === input.questionNumber,
    );
    if (question === undefined) {
      return { ack: commandError('QUESTION_NOT_FOUND') };
    }
    if (input.answers.length !== question.blanks.length) {
      return { ack: commandError('BLANK_COUNT_MISMATCH') };
    }

    const validatedAnswers: string[] = [];
    for (const answer of input.answers) {
      const validation = validateAnswer(answer);
      if (!validation.ok) {
        return { ack: commandError(validation.code) };
      }
      validatedAnswers.push(validation.answer);
    }

    if (findValid(database, question.id, groupId) !== null) {
      return { ack: commandError('ALREADY_SUBMITTED') };
    }

    // 先固定這次要寫入的欄位：COMMIT 後用同一份資料更新記憶體作答索引
    // （P1），不重新讀庫，rank 與順位語意也不會偏移。
    const recorded: SubmissionRecord = {
      id: randomUUID(),
      questionId: question.id,
      questionNumber: question.number,
      groupId,
      rank: maxRank(database, question.id) + 1,
      receivedAt: now(),
      voidedAt: null,
      answers: [...validatedAnswers],
    };
    insertSubmission(database, {
      id: recorded.id,
      questionId: recorded.questionId,
      groupId,
      rank: recorded.rank,
      receivedAt: recorded.receivedAt,
      answers: validatedAnswers,
    });
    // 003 US2 / research R4：作答事件不改 activity.revision。該組與老師
    // 各自依持久化的分開 counter 得到單調快照 revision；其他組與 guest 不
    // 因本事件產生任何 revision 變化。
    incrementGroupAnswerRevision(database, groupId);
    incrementAnswerEventCount(database);
    return { ack: { ok: true }, recorded };
  }

  /** Must be called while an outer transaction is active. */
  function voidInTransaction(input: AnswerVoidInput): {
    ack: Ack;
    voided?: { questionId: string; groupId: string; voidedAt: string };
  } {
    const activity = readActivity(database);
    if (activity.phase !== 'open') {
      return { ack: commandError('INVALID_PHASE') };
    }

    const question = listQuestions(database).find(
      (candidate) => candidate.number === input.questionNumber,
    );
    if (question === undefined) {
      return { ack: commandError('QUESTION_NOT_FOUND') };
    }
    if (getGroupById(database, input.groupId) === null) {
      return { ack: commandError('GROUP_NOT_FOUND') };
    }

    const validSubmission = findValid(database, question.id, input.groupId);
    if (validSubmission === null) {
      return { ack: commandError('SUBMISSION_NOT_FOUND') };
    }

    // 固定同一個時間戳，COMMIT 後記憶體作答索引要套用一模一樣的 voided_at。
    const voidedAt = now();
    voidSubmission(database, question.id, input.groupId, voidedAt);
    incrementGroupAnswerRevision(database, input.groupId);
    incrementAnswerEventCount(database);
    return {
      ack: { ok: true },
      voided: { questionId: question.id, groupId: input.groupId, voidedAt },
    };
  }

  return {
    submitAnswer(identity, payload): Ack {
      if (identity.role !== 'student') {
        return commandError('FORBIDDEN');
      }
      const input = payload as AnswerSubmitInput;

      database.exec('BEGIN IMMEDIATE');
      try {
        const { ack, recorded } = submitInTransaction(identity.groupId, input);

        // 失敗一律 ROLLBACK：不保存作答、rank 或 revision 變化（原則 III）。
        database.exec(ack.ok ? 'COMMIT' : 'ROLLBACK');
        if (ack.ok) {
          // COMMIT 之後才更新記憶體作答索引（P1）：ROLLBACK 的作答絕對
          // 不會進索引；索引空窗（尚未重建）由索引自身略過重建時讀到。
          if (recorded !== undefined) {
            dependencies.onSubmissionRecorded?.(recorded);
          }
          dependencies.onAnswerAccepted?.(input.questionNumber);
        }
        return ack;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    voidAnswer(identity, payload): Ack {
      if (identity.role !== 'teacher') {
        return commandError('FORBIDDEN');
      }
      const input = payload as AnswerVoidInput;

      database.exec('BEGIN IMMEDIATE');
      try {
        const { ack, voided } = voidInTransaction(input);

        // 作廢失敗同樣整筆 ROLLBACK，保留原 Submission、答案與兩個 counter。
        database.exec(ack.ok ? 'COMMIT' : 'ROLLBACK');
        if (ack.ok && voided !== undefined) {
          dependencies.onSubmissionVoided?.(voided);
        }
        return ack;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
