/**
 * 倒數計時器（T064、research R7）：以注入的 scheduler 排程到
 * countdownEndsAt（絕對時間，ISO 字串），時間到呼叫 onExpire。
 *
 * onExpire 由 index.ts 接到與手動 activity:close 完全相同的路徑
 * （closeActivity），只有真的改變狀態才廣播；close 對已結束的活動
 * 不做任何事，所以倒數歸零與手動結束同時發生也只結束一次（FR-026）。
 *
 * scheduler 以參數注入，整合測試用手動時鐘控制（T061）；正式環境使用
 * 真實時鐘（defaultCountdownScheduler）。伺服器重啟後由 index.ts 的
 * 啟動流程依保存的 countdownEndsAt 重新排程或立即結束（FR-021）。
 */
export type CountdownScheduler = {
  /** 目前時間（Unix epoch 毫秒）。 */
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

/** 真實時鐘（正式環境預設）。 */
export const defaultCountdownScheduler: CountdownScheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export type CountdownOptions = {
  scheduler?: CountdownScheduler | undefined;
  onExpire: () => void;
};

export type Countdown = {
  /** 排程到倒數結束時間；已過期時視為立即（下一個 tick）觸發。 */
  schedule: (countdownEndsAt: string) => void;
  /** 取消排程；之後即使 scheduler 仍觸發舊回呼也不會呼叫 onExpire。 */
  cancel: () => void;
};

export function createCountdown(options: CountdownOptions): Countdown {
  const scheduler = options.scheduler ?? defaultCountdownScheduler;
  let activeHandle: unknown;
  let scheduled = false;
  // 每次排程／取消／觸發都前進一代，作廢舊的回呼，避免取消後或重複
  // 觸發仍呼叫 onExpire（對應 FR-026：同時發生只結束一次）。
  let generation = 0;

  function cancel(): void {
    generation += 1;
    if (scheduled) {
      scheduler.clearTimeout(activeHandle);
    }
    scheduled = false;
    activeHandle = undefined;
  }

  function schedule(countdownEndsAt: string): void {
    cancel();
    const delay = Math.max(0, Date.parse(countdownEndsAt) - scheduler.now());
    const current = generation;
    scheduled = true;
    activeHandle = scheduler.setTimeout(() => {
      if (current !== generation) {
        // 已被 cancel 或被較新的 schedule 取代。
        return;
      }
      scheduled = false;
      activeHandle = undefined;
      generation += 1;
      options.onExpire();
    }, delay);
  }

  return { schedule, cancel };
}
