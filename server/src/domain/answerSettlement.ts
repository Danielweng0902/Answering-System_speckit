/**
 * 公平順位判定（005 US1；FR-003～FR-009、FR-020）。
 *
 * 判定**不保存**，而是由已保存的送達資料衍生計算（005 research R1）：
 * 同一份輸入必然得到同一份結果，重啟後不需要任何恢復邏輯，老師作廢
 * 某題的成功組時，該題與後面已判定的題目也會依新的成功題數一起重算
 * （D25、FR-020）。
 */
import {
  arrivalRule,
  fairnessRule,
  type RankingContext,
  type RankingSubmission,
  type RankingRule,
} from './answerRanks.js';

/** 同一批的時間窗：某題第一個答案送達後 3 秒（含邊界）。 */
export const FAIR_BATCH_WINDOW_MS = 3_000;

export type SettlementSubmission = RankingSubmission;

export type SettlementQuestion = {
  /** 題號；用於輸出順序與同秒到達時的穩定排序。 */
  number: number;
  submissions: readonly SettlementSubmission[];
};

export type Settlement = {
  questionNumber: number;
  /** 搶答成功組別；無人作答為 null。 */
  winnerGroupId: string | null;
  /** 該題各組的顯示順位，由第 1 順位起連續編號。 */
  ranks: { groupId: string; rank: number }[];
  /** 是否仍在判定中（FR-010）。 */
  settling: boolean;
  /** 是否因公平順位而改判（FR-011、CSV 第 8 欄 `是（改判）`）。 */
  fairnessApplied: boolean;
};

export type SettlementOptions = {
  /** 本場是否啟用公平順位。 */
  fairRankingEnabled: boolean;
  /** 判定「判定中」用的現在時間（epoch 毫秒）。 */
  now: number;
  /** 活動已結束時為 true：所有題目立即判定，不再有判定中狀態（FR-007）。 */
  settled: boolean;
};

function timeOf(receivedAt: string): number {
  const value = Date.parse(receivedAt);
  if (Number.isNaN(value)) {
    throw new Error(`作答送達時間不是有效的日期時間：${receivedAt}`);
  }
  return value;
}

function ruleFor(fairRankingEnabled: boolean): RankingRule {
  return fairRankingEnabled ? fairnessRule : arrivalRule;
}

/**
 * 判定順序：依各題「第一個作答」的送達時間先後；同一時間以題號穩定排序
 * （FR-008）。作廢不會讓題目移到別的判定時機。
 */
function orderQuestions(
  questions: readonly SettlementQuestion[],
): SettlementQuestion[] {
  return [...questions].sort((a, b) => {
    const firstA = earliestTime(a.submissions);
    const firstB = earliestTime(b.submissions);
    if (firstA === null || firstB === null) {
      if (firstA === null && firstB === null) {
        return a.number - b.number;
      }
      return firstA === null ? 1 : -1;
    }
    return firstA - firstB || a.number - b.number;
  });
}

function earliestTime(
  submissions: readonly SettlementSubmission[],
): number | null {
  let earliest: number | null = null;
  for (const submission of submissions) {
    const value = timeOf(submission.receivedAt);
    if (earliest === null || value < earliest) {
      earliest = value;
    }
  }
  return earliest;
}

/**
 * 判定全部題目。
 *
 * 內部依「第一個作答的送達時間」逐題判定（FR-008），但回傳陣列依**題號**
 * 排列，方便呼叫端直接對應題目。
 */
export function settleAll(
  questions: readonly SettlementQuestion[],
  options: SettlementOptions,
): Settlement[] {
  const rule = ruleFor(options.fairRankingEnabled);
  const successCounts = new Map<string, number>();
  const context: RankingContext = { successCounts };
  const settlements = new Map<number, Settlement>();

  for (const question of orderQuestions(questions)) {
    const valid = question.submissions
      .filter((submission) => submission.voidedAt === null)
      .sort((a, b) => a.rank - b.rank);

    if (valid.length === 0) {
      settlements.set(question.number, {
        questionNumber: question.number,
        winnerGroupId: null,
        ranks: [],
        settling: false,
        fairnessApplied: false,
      });
      continue;
    }

    const firstValid = valid[0]!;
    const batchStart = timeOf(firstValid.receivedAt);
    const batch = valid.filter(
      (submission) =>
        timeOf(submission.receivedAt) - batchStart <= FAIR_BATCH_WINDOW_MS,
    );
    const late = valid.filter(
      (submission) =>
        timeOf(submission.receivedAt) - batchStart > FAIR_BATCH_WINDOW_MS,
    );

    const ordered = [...rule.order(batch, context), ...late];
    // 未啟用公平順位時，順位維持資料庫的送達序號（003 語意：作廢不影響
    // 其他組的順位）；啟用時才依公平規則重新編號（005 FR-021）。
    const ranks = options.fairRankingEnabled
      ? ordered.map((submission, index) => ({
          groupId: submission.groupId,
          rank: index + 1,
        }))
      : ordered.map((submission) => ({
          groupId: submission.groupId,
          rank: submission.rank,
        }));
    const winnerGroupId = ranks[0]!.groupId;
    successCounts.set(
      winnerGroupId,
      (successCounts.get(winnerGroupId) ?? 0) + 1,
    );

    const settling =
      options.fairRankingEnabled &&
      !options.settled &&
      options.now < batchStart + FAIR_BATCH_WINDOW_MS;

    settlements.set(question.number, {
      questionNumber: question.number,
      winnerGroupId,
      ranks,
      settling,
      fairnessApplied:
        options.fairRankingEnabled && winnerGroupId !== firstValid.groupId,
    });
  }

  return [...settlements.values()].sort(
    (a, b) => a.questionNumber - b.questionNumber,
  );
}
