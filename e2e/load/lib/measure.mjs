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
 * 主要 p50/p95/p99/max 皆以「全部樣本」計算：逾時樣本以呼叫方提供的
 * timeoutMs（逾時上限）作為保守下界，避免存活者偏差。completedOnly 另提供
 * 未逾時樣本的分位數作為對照，但不作為門檻判定的主要欄位。
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

function latencyStats(durations) {
  return {
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: durations.length === 0 ? null : durations[durations.length - 1],
  };
}

/**
 * 彙整樣本。flat 的 p50/p95/p99/max 是全部樣本；completedOnly 是僅成功
 * （未逾時）樣本的對照組。有逾時樣本時，timeoutMs 必須是正數，否則無法
 * 可靠地將「逾時」換算成保守延遲下界。
 *
 * 單調時間不得倒退：任何 completedAt（非 null）小於 scheduledAt 時 throw。
 */
export function summarizeSamples(samples, { timeoutMs } = {}) {
  const completedDurations = [];
  const allDurations = [];
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
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`算出全部樣本分位數需要正數 timeoutMs，實際為 ${timeoutMs}`);
      }
      timeoutCount += 1;
      allDurations.push(timeoutMs);
      continue;
    }
    if (status !== 'ok') {
      throw new Error(`未知的樣本狀態：${status}`);
    }
    if (completedAt === null) {
      throw new Error(`status 'ok' 的樣本必須有完成時間（completedAt 不得為 null）`);
    }
    const duration = completedAt - scheduledAt;
    completedDurations.push(duration);
    allDurations.push(duration);
  }

  completedDurations.sort((left, right) => left - right);
  allDurations.sort((left, right) => left - right);

  const sampleCount = samples.length;
  return {
    sampleCount,
    successCount: completedDurations.length,
    timeoutCount,
    timeoutRate: sampleCount === 0 ? null : timeoutCount / sampleCount,
    ...latencyStats(allDurations),
    completedOnly: latencyStats(completedDurations),
  };
}
