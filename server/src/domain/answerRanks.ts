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
