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
import { computeSettlementFromRecords } from './answerSettlementService.js';
import {
  listAllSubmissions,
  listByGroup,
  listValidSubmissionPairs,
  type SubmissionRecord,
} from '../infra/db/answerRepo.js';
import { getActivity } from '../infra/db/activityRepo.js';
import { listGroups } from '../infra/db/groupRepo.js';
import { list as listQuestions } from '../infra/db/questionRepo.js';

/** Shared question list projection for open and closed student snapshots. */
export function buildStudentQuestions(database: DatabaseSync): StudentQuestion[] {
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

type OwnSubmissionIndex = {
  /** 每題唯一有效作答（資料庫有部分唯一索引保證）。 */
  validByQuestionNumber: Map<number, SubmissionRecord>;
  /** 含作廢歷史的最新一筆；rank 最大即最新。 */
  latestByQuestionNumber: Map<number, SubmissionRecord>;
};

/** open 與 closed 學生快照共用同一份本組明細，建立「最新／有效」索引。 */
function createOwnSubmissionIndex(submissions: SubmissionRecord[]): OwnSubmissionIndex {
  const validByQuestionNumber = new Map<number, SubmissionRecord>();
  const latestByQuestionNumber = new Map<number, SubmissionRecord>();
  for (const submission of submissions) {
    if (submission.voidedAt === null) {
      validByQuestionNumber.set(submission.questionNumber, submission);
    }
    // listAll/listByGroup 已依題目與 rank 排序，最後覆蓋即最新。
    latestByQuestionNumber.set(submission.questionNumber, submission);
  }
  return { validByQuestionNumber, latestByQuestionNumber };
}

/**
 * Build the per-question own-group answer state for open student snapshots.
 * 最新 Submission（rank 最大）決定 submitted／voided，與 closed 投影及
 * buildBoard 的「最新」語意一致；open 快照仍不含 rank（FR-030、FR-017）。
 */
export function buildMyAnswers(database: DatabaseSync, groupId: string): StudentOpenAnswer[] {
  const own = createOwnSubmissionIndex(listByGroup(database, groupId));
  return listQuestions(database).map((question) => {
    const submission = own.latestByQuestionNumber.get(question.number);
    if (submission === undefined) {
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

type QuestionGroupSubmission = {
  valid: SubmissionRecord | null;
  latest: SubmissionRecord | null;
};

/**
 * 以讀入時的題目／rank／blank 順序建立巢狀索引；有效作答仍依部分唯一
 * 索引只會一筆，latest 則保留作廢歷史。winner 不由此推斷，一律看結算。
 */
function createSubmissionIndex(
  submissions: SubmissionRecord[],
): Map<string, Map<string, QuestionGroupSubmission>> {
  const index = new Map<string, Map<string, QuestionGroupSubmission>>();
  for (const submission of submissions) {
    let byGroup = index.get(submission.questionId);
    if (byGroup === undefined) {
      byGroup = new Map();
      index.set(submission.questionId, byGroup);
    }
    const previous = byGroup.get(submission.groupId);
    byGroup.set(submission.groupId, {
      valid: submission.voidedAt === null ? submission : (previous?.valid ?? null),
      latest: submission,
    });
  }
  return index;
}

function submissionFor(
  index: Map<string, Map<string, QuestionGroupSubmission>>,
  questionId: string,
  groupId: string,
): QuestionGroupSubmission | undefined {
  return index.get(questionId)?.get(groupId);
}

/**
 * 結束後每題的搶答結果（003 US4；FR-023、FR-025）。winner 一律只由
 * 判定服務決定（005 FR-009、原則 VI）；無有效作答為 null。
 */
export function buildResults(database: DatabaseSync, now: Date = new Date()): QuestionResult[] {
  const groups = listGroups(database);
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const activity = getActivity(database);
  const submissions = listAllSubmissions(database);
  const questions = listQuestions(database);
  const settlement = computeSettlementFromRecords({ activity, submissions, questions }, now);
  const submissionIndex = createSubmissionIndex(submissions);

  return questions.map((question) => {
    const result = settlement.get(question.number);
    const winnerGroupId = result?.winnerGroupId ?? null;
    const winnerSubmission =
      winnerGroupId === null
        ? null
        : (submissionFor(submissionIndex, question.id, winnerGroupId)?.valid ?? null);
    return {
      questionNumber: question.number,
      winner:
        winnerGroupId === null || winnerSubmission === null
          ? null
          : {
              groupId: winnerGroupId,
              groupName: groupNames.get(winnerGroupId) ?? '',
              answers: [...winnerSubmission.answers],
            },
      fairnessApplied: result?.fairnessApplied ?? false,
    };
  });
}

/**
 * 結束後本組每題的答案與順位（003 US4；FR-024）。有有效作答時為其順位
 * （啟用公平順位時為公平順位，005 FR-021）；未送出或只有作廢作答時 rank
 * 為 null；作廢保留最新一筆答案供標示。
 */
export function buildClosedMyAnswers(
  database: DatabaseSync,
  groupId: string,
  now: Date = new Date(),
): StudentClosedAnswer[] {
  const own = createOwnSubmissionIndex(listByGroup(database, groupId));
  const questions = listQuestions(database);
  const settlement = computeSettlementFromRecords(
    {
      activity: getActivity(database),
      submissions: listAllSubmissions(database),
      questions,
    },
    now,
  );

  return questions.map((question) => {
    const submitted = own.validByQuestionNumber.get(question.number);
    if (submitted !== undefined) {
      const rank =
        settlement.get(question.number)?.ranks.find((entry) => entry.groupId === groupId)?.rank ??
        null;
      return {
        questionNumber: question.number,
        state: 'submitted',
        answers: [...submitted.answers],
        rank,
      };
    }
    const latestVoided = own.latestByQuestionNumber.get(question.number);
    if (latestVoided !== undefined && latestVoided.voidedAt !== null) {
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
 * 定一筆 cell。winnerGroupId 只由判定服務決定（005 FR-009、原則 VI）。
 * cell 取該組該題最新 Submission（rank 最大＝最新，語意同 findLatest）：
 * 有有效作答顯示 submitted 與其順位（啟用公平順位時為公平順位，005 FR-021）；
 * 只有已作廢作答顯示最新一筆 voided 並保留答案與原順位；未送出為
 * not_submitted、[] 與 null。
 */
export function buildBoard(database: DatabaseSync, now: Date = new Date()): AnswerBoardQuestion[] {
  const groups = listGroups(database);
  const activity = getActivity(database);
  const submissions = listAllSubmissions(database);
  const questions = listQuestions(database);
  const settlement = computeSettlementFromRecords({ activity, submissions, questions }, now);
  const submissionIndex = createSubmissionIndex(submissions);

  return questions.map((question) => {
    const result = settlement.get(question.number);
    const winnerGroupId = result?.winnerGroupId ?? null;
    const rankByGroup = new Map((result?.ranks ?? []).map((entry) => [entry.groupId, entry.rank]));
    const cells: AnswerBoardCell[] = groups.map((group) => {
      const submission = submissionFor(submissionIndex, question.id, group.id);
      const valid = submission?.valid;
      const latest = valid ?? submission?.latest;
      return {
        questionNumber: question.number,
        groupId: group.id,
        groupName: group.name,
        state:
          valid !== undefined && valid !== null
            ? 'submitted'
            : latest !== undefined && latest !== null
              ? 'voided'
              : 'not_submitted',
        answers: latest == null ? [] : [...latest.answers],
        rank:
          valid !== undefined && valid !== null
            ? (rankByGroup.get(group.id) ?? null)
            : latest == null
              ? null
              : latest.rank,
      };
    });
    return {
      questionNumber: question.number,
      cells,
      winnerGroupId,
      settling: result?.settling ?? false,
      fairnessApplied: result?.fairnessApplied ?? false,
    };
  });
}

/**
 * 老師進度（003 US3；T029；FR-020）：每題有效送出的組數、每組有效送出的
 * 題數，只計 voided_at IS NULL 的作答。
 */
export function buildProgress(database: DatabaseSync): AnswerProgress {
  const groups = listGroups(database);
  const questions = listQuestions(database);
  const submittedPairs = listValidSubmissionPairs(database);
  const submittedGroupsByQuestion = new Map<string, Set<string>>();
  const submittedCountsByGroup = new Map<string, number>();

  for (const pair of submittedPairs) {
    const submittedGroups = submittedGroupsByQuestion.get(pair.questionId) ?? new Set<string>();
    if (!submittedGroups.has(pair.groupId)) {
      submittedGroups.add(pair.groupId);
      submittedGroupsByQuestion.set(pair.questionId, submittedGroups);
      submittedCountsByGroup.set(pair.groupId, (submittedCountsByGroup.get(pair.groupId) ?? 0) + 1);
    }
  }

  return {
    perQuestion: questions.map((question) => ({
      questionNumber: question.number,
      submittedGroupCount: submittedGroupsByQuestion.get(question.id)?.size ?? 0,
    })),
    perGroup: groups.map((group) => ({
      groupId: group.id,
      submittedQuestionCount: submittedCountsByGroup.get(group.id) ?? 0,
    })),
  };
}
