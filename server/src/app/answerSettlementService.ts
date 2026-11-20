/**
 * 判定服務（005 US1；T007）。
 *
 * 這是**唯一**的判定入口：讀取已保存的送達資料，呼叫純函式
 * `settleAll()`，回傳每題的搶答成功組別、順位、判定中與是否改判
 * （005 FR-009、原則 VI）。判定結果不保存，每次即時推導
 * （005 research R1）。
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  settleAll,
  type Settlement,
  type SettlementQuestion,
  type SettlementSubmission,
} from '../domain/answerSettlement.js';
import { getActivity, type Activity } from '../infra/db/activityRepo.js';
import {
  listAllSubmissions,
  type SubmissionRecord,
} from '../infra/db/answerRepo.js';
import {
  list as listQuestions,
  type StoredQuestion,
} from '../infra/db/questionRepo.js';

type SettlementSource = {
  activity: Activity | null;
  questions: StoredQuestion[];
  submissions: SubmissionRecord[];
};

export type { SettlementSource };

/**
 * 依呼叫端已讀出的同一份資料計算判定；結果快照可重複利用這份資料，
 * 不影響判定仍是即時衍生、未保存的語意（005 research R1）。
 */
export function computeSettlementFromRecords(
  source: SettlementSource,
  now: Date = new Date(),
): Map<number, Settlement> {
  const byQuestion = new Map<string, SettlementSubmission[]>();
  for (const submission of source.submissions) {
    const existing = byQuestion.get(submission.questionId);
    const entry = {
      groupId: submission.groupId,
      rank: submission.rank,
      receivedAt: submission.receivedAt,
      voidedAt: submission.voidedAt,
    };
    if (existing === undefined) {
      byQuestion.set(submission.questionId, [entry]);
    } else {
      existing.push(entry);
    }
  }

  const questions: SettlementQuestion[] = source.questions.map((question) => ({
    number: question.number,
    submissions: byQuestion.get(question.id) ?? [],
  }));

  const settlements = settleAll(questions, {
    fairRankingEnabled: source.activity?.fairRankingEnabled ?? false,
    now: now.getTime(),
    settled: source.activity?.phase === 'closed',
  });

  return new Map(
    settlements.map((settlement) => [settlement.questionNumber, settlement]),
  );
}

/**
 * 計算本場活動的判定結果，key 為題號。
 *
 * - 公平順位旗標來自 `activity.fair_ranking_enabled`（未啟用時與 003 相同）。
 * - 活動已結束時所有題目立即判定，不再有「判定中」狀態（FR-007）。
 */
export function computeSettlement(
  database: DatabaseSync,
  now: Date = new Date(),
): Map<number, Settlement> {
  return computeSettlementFromRecords(
    {
      activity: getActivity(database),
      submissions: listAllSubmissions(database),
      questions: listQuestions(database),
    },
    now,
  );
}
