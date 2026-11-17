import { describe, expect, it } from 'vitest';
import {
  FAIR_BATCH_WINDOW_MS,
  settleAll,
  type SettlementQuestion,
  type SettlementSubmission,
} from '../../src/domain/answerSettlement.js';

function submission(
  groupId: string,
  rank: number,
  receivedAt: string,
  voidedAt: string | null = null,
): SettlementSubmission {
  return { groupId, rank, receivedAt, voidedAt };
}

function question(
  number: number,
  submissions: SettlementSubmission[],
): SettlementQuestion {
  return { number, submissions };
}

const T0 = Date.parse('2026-11-17T09:00:00.000Z');
const at = (ms: number): string => new Date(T0 + ms).toISOString();

function settle(
  questions: SettlementQuestion[],
  options: { fairRankingEnabled?: boolean; now?: number; settled?: boolean } = {},
) {
  return settleAll(questions, {
    fairRankingEnabled: options.fairRankingEnabled ?? true,
    now: options.now ?? T0 + 60_000,
    settled: options.settled ?? true,
  });
}

describe('settleAll（005 US1；T004、T005）', () => {
  it('未啟用公平順位時，順位與搶答成功組別完全等同先到先得（FR-002、SC-002）', () => {
    const questions = [
      question(1, [submission('G1', 1, at(0)), submission('G2', 2, at(100))]),
      question(2, [submission('G2', 1, at(200)), submission('G1', 2, at(300))]),
    ];

    const result = settle(questions, { fairRankingEnabled: false });

    expect(result.map((entry) => entry.winnerGroupId)).toEqual(['G1', 'G2']);
    expect(result[0]?.ranks).toEqual([
      { groupId: 'G1', rank: 1 },
      { groupId: 'G2', rank: 2 },
    ]);
    expect(result[1]?.ranks).toEqual([
      { groupId: 'G2', rank: 1 },
      { groupId: 'G1', rank: 2 },
    ]);
    expect(result.every((entry) => entry.fairnessApplied === false)).toBe(true);
  });

  it('啟用公平順位時，同一批依已判定的成功題數由少到多排序（FR-004、AC-005-01）', () => {
    // 第 1 題由 G1 取得（成功 1 題）；第 2 題 G1 先送達、G2 在 3 秒內也送達，
    // G2 的成功題數較少，因此第 2 題由 G2 搶答成功。
    const questions = [
      question(1, [submission('G1', 1, at(0))]),
      question(2, [
        submission('G1', 1, at(10_000)),
        submission('G2', 2, at(10_500)),
      ]),
    ];

    const result = settle(questions);

    expect(result[0]?.winnerGroupId).toBe('G1');
    expect(result[1]?.winnerGroupId).toBe('G2');
    expect(result[1]?.ranks).toEqual([
      { groupId: 'G2', rank: 1 },
      { groupId: 'G1', rank: 2 },
    ]);
    expect(result[1]?.fairnessApplied).toBe(true);
  });

  it('同批成功題數相同時依送達先後（FR-004、AC-005-03）', () => {
    const questions = [
      question(1, [
        submission('G1', 1, at(0)),
        submission('G2', 2, at(100)),
      ]),
    ];

    const result = settle(questions);

    expect(result[0]?.winnerGroupId).toBe('G1');
    expect(result[0]?.ranks).toEqual([
      { groupId: 'G1', rank: 1 },
      { groupId: 'G2', rank: 2 },
    ]);
    expect(result[0]?.fairnessApplied).toBe(false);
  });

  it('超過 3 秒送達的作答不屬於同一批，排在批後（FR-005、AC-005-02）', () => {
    const questions = [
      question(1, [
        submission('G1', 1, at(0)),
        submission('G2', 2, at(FAIR_BATCH_WINDOW_MS + 1)),
      ]),
    ];

    const result = settle(questions);

    expect(result[0]?.winnerGroupId).toBe('G1');
    expect(result[0]?.ranks).toEqual([
      { groupId: 'G1', rank: 1 },
      { groupId: 'G2', rank: 2 },
    ]);
  });

  it('批次邊界：與第一個答案相差剛好 3 秒算同一批（FR-003）', () => {
    const sameBatch = settle([
      question(1, [
        submission('G1', 1, at(0)),
        submission('G2', 2, at(FAIR_BATCH_WINDOW_MS)),
      ]),
    ]);
    const differentBatch = settle([
      question(1, [
        submission('G1', 1, at(0)),
        submission('G2', 2, at(FAIR_BATCH_WINDOW_MS + 1)),
      ]),
    ]);

    expect(sameBatch[0]?.ranks).toEqual([
      { groupId: 'G1', rank: 1 },
      { groupId: 'G2', rank: 2 },
    ]);
    expect(differentBatch[0]?.ranks).toEqual([
      { groupId: 'G1', rank: 1 },
      { groupId: 'G2', rank: 2 },
    ]);
  });

  it('作廢後該題與後面已判定的題目連鎖重算（FR-020、D25、AC-005-19）', () => {
    const voided = '2026-11-17T09:00:05.000Z';
    const questions = [
      question(1, [
        submission('G1', 1, at(0), voided),
        submission('G2', 2, at(100)),
      ]),
      question(2, [
        submission('G1', 1, at(10_000)),
        submission('G2', 2, at(10_100)),
      ]),
      question(3, [
        submission('G1', 1, at(20_000)),
        submission('G2', 2, at(20_100)),
      ]),
    ];

    const result = settle(questions);

    // 第 1 題改由 G2 取得 → G1 成功題數歸零 → 第 2 題改由 G1 取得 → 第 3 題平手依送達先後。
    expect(result.map((entry) => entry.winnerGroupId)).toEqual([
      'G2',
      'G1',
      'G1',
    ]);
  });

  it('未啟用公平順位時作廢不發生連鎖重算（AC-005-20）', () => {
    const voided = '2026-11-17T09:00:05.000Z';
    const questions = [
      question(1, [
        submission('G1', 1, at(0), voided),
        submission('G2', 2, at(100)),
      ]),
      question(2, [
        submission('G1', 1, at(10_000)),
        submission('G2', 2, at(10_100)),
      ]),
    ];

    const result = settle(questions, { fairRankingEnabled: false });

    expect(result.map((entry) => entry.winnerGroupId)).toEqual(['G2', 'G1']);
  });

  it('同一輸入重算 100 次結果完全相同（FR-009、SC-003）', () => {
    const questions = [
      question(1, [
        submission('G1', 1, at(0)),
        submission('G2', 2, at(100)),
        submission('G3', 3, at(200)),
      ]),
      question(2, [
        submission('G2', 1, at(10_000)),
        submission('G3', 2, at(10_050)),
        submission('G1', 3, at(10_100)),
      ]),
    ];

    const first = JSON.stringify(settle(questions));
    for (let index = 0; index < 100; index += 1) {
      expect(JSON.stringify(settle(questions))).toBe(first);
    }
  });

  it('6 組 × 6 題同速作答時，各組成功題數相差不超過 1（SC-001）', () => {
    const questions = Array.from({ length: 6 }, (_, questionIndex) =>
      question(
        questionIndex + 1,
        Array.from({ length: 6 }, (_, groupIndex) =>
          submission(`G${groupIndex + 1}`, groupIndex + 1, at(questionIndex * 60_000 + groupIndex * 100)),
        ),
      ),
    );

    const result = settle(questions);
    const winCounts = new Map<string, number>();
    for (const entry of result) {
      if (entry.winnerGroupId !== null) {
        winCounts.set(
          entry.winnerGroupId,
          (winCounts.get(entry.winnerGroupId) ?? 0) + 1,
        );
      }
    }
    const counts = [...winCounts.values()];

    expect(counts).toHaveLength(6);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('無人作答的題目沒有搶答成功組別；只有一組作答時該組勝出（T005）', () => {
    const result = settle([
      question(1, []),
      question(2, [submission('G1', 1, at(0))]),
    ]);

    expect(result[0]?.winnerGroupId).toBeNull();
    expect(result[0]?.ranks).toEqual([]);
    expect(result[0]?.settling).toBe(false);
    expect(result[1]?.winnerGroupId).toBe('G1');
    expect(result[1]?.ranks).toEqual([{ groupId: 'G1', rank: 1 }]);
  });

  it('判定中是時間衍生的：3 秒內為判定中，滿 3 秒後為已判定（FR-010、AC-005-08）', () => {
    const questions = [question(1, [submission('G1', 1, at(0))])];

    const during = settle(questions, {
      now: T0 + FAIR_BATCH_WINDOW_MS - 1,
      settled: false,
    });
    const after = settle(questions, {
      now: T0 + FAIR_BATCH_WINDOW_MS,
      settled: false,
    });
    const closed = settle(questions, {
      now: T0 + 100,
      settled: true,
    });

    expect(during[0]?.settling).toBe(true);
    expect(after[0]?.settling).toBe(false);
    expect(closed[0]?.settling).toBe(false);
  });

  it('未啟用公平順位時不會有判定中狀態（003 行為不變）', () => {
    const result = settle([question(1, [submission('G1', 1, at(0))])], {
      fairRankingEnabled: false,
      now: T0 + 10,
      settled: false,
    });

    expect(result[0]?.settling).toBe(false);
  });
});
