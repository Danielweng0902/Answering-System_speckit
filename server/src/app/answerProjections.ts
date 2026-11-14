import type { DatabaseSync } from 'node:sqlite';
import type {
  AnswerBoardCell,
  AnswerBoardQuestion,
  AnswerProgress,
  QuestionResult,
  StudentClosedAnswer,
  StudentOpenAnswer,
  StudentQuestion,
} from '@classroom/shared';
import { decideWinner } from '../domain/answerRanks.js';
import {
  findLatest,
  listByQuestion,
  listValidByGroup,
  type SubmissionRecord,
} from '../infra/db/answerRepo.js';
import { listGroups } from '../infra/db/groupRepo.js';
import { list as listQuestions } from '../infra/db/questionRepo.js';

/** Shared question list projection for open and closed student snapshots. */
export function buildStudentQuestions(
  database: DatabaseSync,
): StudentQuestion[] {
  return listQuestions(database).map((question) => ({
    number: question.number,
    kind: question.kind,
    prompt: question.prompt,
    blanks: question.blanks.map((blank) => ({
      position: blank.position,
      prefix: blank.prefix,
    })),
  }));
}


/**
 * Build the per-question own-group answer state for open student snapshots.
 * 最新 Submission（rank 最大）決定 submitted／voided，與 closed 投影及
 * buildBoard 的「最新」語意一致；open 快照仍不含 rank（FR-030、FR-017）。
 */
export function buildMyAnswers(
  database: DatabaseSync,
  groupId: string,
): StudentOpenAnswer[] {
  return listQuestions(database).map((question) => {
    const submission = findLatest(database, question.id, groupId);
    if (submission === null) {
      return {
        questionNumber: question.number,
        state: 'not_submitted',
        answers: [],
      };
    }
    return {
      questionNumber: question.number,
      state: submission.voidedAt === null ? 'submitted' : 'voided',
      answers: [...submission.answers],
    };
  });
}

/**
 * 結束後每題的搶答結果（003 US4；FR-023、FR-025）。winner 一律只由
 * decideWinner 判定（FR-014 唯一入口）；無有效作答為 null。
 */
export function buildResults(database: DatabaseSync): QuestionResult[] {
  const groupNames = new Map(
    listGroups(database).map((group) => [group.id, group.name]),
  );
  return listQuestions(database).map((question) => {
    const winner = decideWinner(listByQuestion(database, question.id));
    return {
      questionNumber: question.number,
      winner:
        winner === null
          ? null
          : {
              groupId: winner.groupId,
              groupName: groupNames.get(winner.groupId) ?? '',
              answers: [...winner.answers],
            },
    };
  });
}

/**
 * 結束後本組每題的答案與順位（003 US4；FR-024）。有有效作答時為其 rank；
 * 未送出或只有作廢作答時 rank 為 null；作廢保留最新一筆答案供標示。
 */
export function buildClosedMyAnswers(
  database: DatabaseSync,
  groupId: string,
): StudentClosedAnswer[] {
  const submittedByQuestionNumber = new Map(
    listValidByGroup(database, groupId).map((submission) => [
      submission.questionNumber,
      submission,
    ]),
  );

  return listQuestions(database).map((question) => {
    const submission = submittedByQuestionNumber.get(question.number);
    if (submission !== undefined) {
      return {
        questionNumber: question.number,
        state: 'submitted',
        answers: [...submission.answers],
        rank: submission.rank,
      };
    }
    // listByQuestion 依 position、rank 排序；最後一筆作廢即最新作廢。
    const latestVoided = listByQuestion(database, question.id)
      .filter(
        (entry: SubmissionRecord) =>
          entry.groupId === groupId && entry.voidedAt !== null,
      )
      .at(-1);
    if (latestVoided !== undefined) {
      return {
        questionNumber: question.number,
        state: 'voided',
        answers: [...latestVoided.answers],
        rank: null,
      };
    }
    return {
      questionNumber: question.number,
      state: 'not_submitted',
      answers: [],
      rank: null,
    };
  });
}

/**
 * 老師看板（003 US3；T029；FR-019、FR-022）：題 × 組完整矩陣，每題每組固
 * 定一筆 cell。winnerGroupId 只由 decideWinner 判定（FR-014 唯一入口）。
 * cell 取該組該題最新 Submission（rank 最大＝最新，語意同 findLatest）：
 * 有有效作答顯示 submitted 與其 rank；只有已作廢作答顯示最新一筆 voided
 * 並保留答案與原順位；未送出為 not_submitted、[] 與 null。
 */
export function buildBoard(
  database: DatabaseSync,
): AnswerBoardQuestion[] {
  const groups = listGroups(database);
  return listQuestions(database).map((question) => {
    const submissions = listByQuestion(database, question.id);
    const winner = decideWinner(submissions);
    const cells: AnswerBoardCell[] = groups.map((group) => {
      const valid = submissions.find(
        (submission) =>
          submission.groupId === group.id && submission.voidedAt === null,
      );
      const latest =
        valid ??
        submissions
          .filter((submission) => submission.groupId === group.id)
          .at(-1);
      return {
        questionNumber: question.number,
        groupId: group.id,
        groupName: group.name,
        state:
          valid !== undefined
            ? 'submitted'
            : latest !== undefined
              ? 'voided'
              : 'not_submitted',
        answers: latest === undefined ? [] : [...latest.answers],
        rank: latest === undefined ? null : latest.rank,
      };
    });
    return {
      questionNumber: question.number,
      cells,
      winnerGroupId: winner === null ? null : winner.groupId,
    };
  });
}

/**
 * 老師進度（003 US3；T029；FR-020）：每題有效送出的組數、每組有效送出的
 * 題數，只計 voided_at IS NULL 的作答。
 */
export function buildProgress(database: DatabaseSync): AnswerProgress {
  const groups = listGroups(database);
  const submittedQuestionsByGroup = new Map<string, Set<number>>();
  const perQuestion = listQuestions(database).map((question) => {
    const submittedGroups = new Set(
      listByQuestion(database, question.id)
        .filter((submission) => submission.voidedAt === null)
        .map((submission) => submission.groupId),
    );
    for (const groupId of submittedGroups) {
      const questions = submittedQuestionsByGroup.get(groupId) ?? new Set();
      questions.add(question.number);
      submittedQuestionsByGroup.set(groupId, questions);
    }
    return { questionNumber: question.number, submittedGroupCount: submittedGroups.size };
  });
  return {
    perQuestion,
    perGroup: groups.map((group) => ({
      groupId: group.id,
      submittedQuestionCount:
        submittedQuestionsByGroup.get(group.id)?.size ?? 0,
    })),
  };
}
