import { describe, expect, it } from 'vitest';
import {
  decideWinner,
  type RankedSubmission,
} from '../../src/domain/answerRanks.js';

type SubmissionFixture = RankedSubmission & {
  id: string;
  groupId: string;
  questionId: string;
  receivedAt: string;
};

function submission(
  rank: number,
  voidedAt: string | null = null,
): SubmissionFixture {
  return {
    id: `submission-${rank}`,
    questionId: 'question-1',
    groupId: `group-${rank}`,
    rank,
    receivedAt: '2026-11-12T12:00:00.000Z',
    voidedAt,
  };
}

const VOIDED_AT = '2026-11-12T12:01:00.000Z';

describe('decideWinner（003 FR-010、FR-014）', () => {
  it('沒有任何作答時回傳 null', () => {
    expect(decideWinner([])).toBeNull();
  });

  it('rank 1 有效時選 rank 1，不依賴輸入排列順序', () => {
    const first = submission(1);
    const second = submission(2);

    expect(decideWinner([second, first])).toBe(first);
  });

  it('rank 1 已作廢、rank 2 有效時選 rank 2', () => {
    const voidedFirst = submission(1, VOIDED_AT);
    const validSecond = submission(2);

    expect(decideWinner([voidedFirst, validSecond])).toBe(validSecond);
  });

  it('中間順位作廢時仍選擇最小有效 rank，不重排其他順位', () => {
    const first = submission(1);
    const voidedSecond = submission(2, VOIDED_AT);
    const third = submission(3);

    expect(decideWinner([third, voidedSecond, first])).toBe(first);
  });

  it('所有作廢時回傳 null', () => {
    expect(
      decideWinner([
        submission(1, VOIDED_AT),
        submission(2, VOIDED_AT),
        submission(3, VOIDED_AT),
      ]),
    ).toBeNull();
  });

  it('純函式不修改輸入陣列或作答物件', () => {
    const first = submission(1);
    const second = submission(2);
    const submissions = [second, first];
    const before = submissions.map((entry) => ({ ...entry }));

    decideWinner(submissions);

    expect(submissions).toEqual(before);
    expect(submissions[0]).toBe(second);
    expect(submissions[1]).toBe(first);
  });
});
