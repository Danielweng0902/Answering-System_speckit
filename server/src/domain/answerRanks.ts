/**
 * 搶答成功判定（003 FR-010、FR-014；research R3）。
 *
 * 目前規則：同一題未作廢作答中 rank 最小者。005 的公平機制只需要替換
 * 這個純函式，不影響資料保存與投影層。
 */
export type RankedSubmission = {
  rank: number;
  voidedAt: string | null;
};

export function decideWinner<T extends RankedSubmission>(
  submissions: readonly T[],
): T | null {
  let winner: T | null = null;

  for (const submission of submissions) {
    if (submission.voidedAt !== null) {
      continue;
    }
    if (winner === null || submission.rank < winner.rank) {
      winner = submission;
    }
  }

  return winner;
}

/* ------------------------------------------------------------------ */
/* 順位規則（005 research R4）                                          */
/* ------------------------------------------------------------------ */

/**
 * 參與順位排序的作答。`rank` 是資料庫的送達序號，只用來比較送達先後；
 * 對外顯示的順位由規則算出（005 FR-021）。
 */
export type RankingSubmission = {
  groupId: string;
  rank: number;
  receivedAt: string;
  voidedAt: string | null;
};

/** 排序時可用的跨題脈絡：各組目前已判定的搶答成功題數。 */
export type RankingContext = {
  successCounts: ReadonlyMap<string, number>;
};

/**
 * 順位規則。003 的先到先得與 005 的公平順位都實作同一個介面，
 * 由 005 的 `settleAll()` 依活動設定選擇。
 */
export type RankingRule = {
  readonly id: 'arrival' | 'fairness';
  /**
   * 依規則排出順位順序；回傳的第一筆就是第 1 順位。
   * 呼叫端保證傳入的是同一批的作答（005 research R2）。
   */
  order(
    submissions: readonly RankingSubmission[],
    context: RankingContext,
  ): RankingSubmission[];
};

/** 003 的既有規則：先到先得（`rank` 即送達序號）。 */
export const arrivalRule: RankingRule = {
  id: 'arrival',
  order(submissions) {
    return [...submissions].sort((a, b) => a.rank - b.rank);
  },
};

/**
 * 005 的公平順位：成功題數少者優先，成功題數相同則依送達先後
 * （005 FR-004、AC-005-01、AC-005-03）。
 */
export const fairnessRule: RankingRule = {
  id: 'fairness',
  order(submissions, context) {
    return [...submissions].sort(
      (a, b) =>
        (context.successCounts.get(a.groupId) ?? 0) -
          (context.successCounts.get(b.groupId) ?? 0) || a.rank - b.rank,
    );
  },
};
