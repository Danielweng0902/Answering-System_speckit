/**
 * 負載量測統計（e2e/load）。
 *
 * 樣本型別：{ scheduledAt, completedAt, status }，時間皆為毫秒、來自單調時鐘
 * （performance.now()）。
 * - scheduledAt：實際送出請求前記下的單調時間。
 * - completedAt：回應完整收到（或連線失敗結束）時記下的單調時間；逾時樣本為 null。
 * - status：'ok' 只代表「未逾時」（HTTP 非 2xx、連線失敗也算完成，錯誤率由
 *   呼叫方另行統計）；'timeout' 代表在逾時上限內沒有完整回應。
 *
 * 逾時樣本計入 sampleCount 分母，並以 timeoutCount／timeoutRate 另外呈現；
 * 分位數與最大值只對未逾時（有實際延遲值）的樣本計算，空集合時回 null。
 */

/**
 * 最近秩法（nearest-rank）分位數：p95 = 第 ceil(0.95 × n) 小的樣本值。
 * 輸入必須已升冪排序；p 等同或小於 0 取最小值，等同或大於 1 取最大值。
 * 空陣列回 null。
 */
export function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return null;
  }
  const rank = Math.ceil(p * sortedValues.length);
  const clamped = Math.min(Math.max(rank, 1), sortedValues.length);
  return sortedValues[clamped - 1];
}

/**
 * 彙整樣本：{ sampleCount, successCount, timeoutCount, timeoutRate,
 * p50Ms, p95Ms, p99Ms, maxMs }。
 * 單調時間不得倒退：任何 completedAt（非 null）小於 scheduledAt 時 throw。
 */
export function summarizeSamples(samples) {
  const durations = [];
  let timeoutCount = 0;

  for (const sample of samples) {
    const { scheduledAt, completedAt, status } = sample;
    if (!Number.isFinite(scheduledAt)) {
      throw new Error(`樣本的 scheduledAt 必須是有限數值，實際為 ${scheduledAt}`);
    }
    if (completedAt !== null) {
      if (!Number.isFinite(completedAt)) {
        throw new Error(`樣本的 completedAt 必須是有限數值或 null，實際為 ${completedAt}`);
      }
      if (completedAt < scheduledAt) {
        throw new Error(
          `單調時間不得倒退：completedAt (${completedAt}) 小於 scheduledAt (${scheduledAt})`,
        );
      }
    }

    if (status === 'timeout') {
      timeoutCount += 1;
      continue;
    }
    if (status !== 'ok') {
      throw new Error(`未知的樣本狀態：${status}`);
    }
    if (completedAt === null) {
      throw new Error(`status 'ok' 的樣本必須有完成時間（completedAt 不得為 null）`);
    }
    durations.push(completedAt - scheduledAt);
  }

  durations.sort((a, b) => a - b);

  const sampleCount = samples.length;
  const successCount = durations.length;
  return {
    sampleCount,
    successCount,
    timeoutCount,
    timeoutRate: sampleCount === 0 ? null : timeoutCount / sampleCount,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: successCount === 0 ? null : durations[successCount - 1],
  };
}
