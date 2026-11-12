import { describe, expect, it, vi } from 'vitest';
import {
  createCountdown,
  type CountdownScheduler,
} from '../../src/app/countdown.js';

const START = Date.parse('2026-11-12T08:00:00.000Z');

type PendingTimer = {
  handle: number;
  ms: number;
  fn: () => void;
};

/** 手動時鐘：記錄排程與取消，時間由測試推進，回呼由測試觸發。 */
function createManualScheduler(startMs: number) {
  let currentMs = startMs;
  let nextHandle = 1;
  const pending = new Map<number, PendingTimer>();
  const cleared: number[] = [];

  const scheduler: CountdownScheduler = {
    now: () => currentMs,
    setTimeout: (fn, ms) => {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, { handle, ms, fn });
      return handle;
    },
    clearTimeout: (handle) => {
      const numeric = handle as number;
      cleared.push(numeric);
      pending.delete(numeric);
    },
  };

  return {
    scheduler,
    advance: (ms: number): void => {
      currentMs += ms;
    },
    pending: (): PendingTimer[] => [...pending.values()],
    cleared: (): number[] => [...cleared],
    /** 強制觸發某個回呼（模擬時間到或殘留的回呼）。 */
    fire: (timer: PendingTimer): void => {
      timer.fn();
    },
  };
}

describe('countdown 計時器', () => {
  it('schedule 以「結束時間 − 現在」排程，時間到呼叫 onExpire 一次', () => {
    const manual = createManualScheduler(START);
    const onExpire = vi.fn();
    const countdown = createCountdown({
      scheduler: manual.scheduler,
      onExpire,
    });

    const endsAt = new Date(START + 30_000).toISOString();
    countdown.schedule(endsAt);

    const timers = manual.pending();
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(30_000);

    manual.advance(30_000);
    manual.fire(timers[0] as PendingTimer);
    expect(onExpire).toHaveBeenCalledTimes(1);

    // 觸發後排程已清空，同一個回呼再被觸發也不會重複呼叫。
    manual.fire(timers[0] as PendingTimer);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('重複 schedule 會先取消前一個排程', () => {
    const manual = createManualScheduler(START);
    const onExpire = vi.fn();
    const countdown = createCountdown({
      scheduler: manual.scheduler,
      onExpire,
    });

    countdown.schedule(new Date(START + 30_000).toISOString());
    const first = manual.pending()[0] as PendingTimer;
    countdown.schedule(new Date(START + 60_000).toISOString());

    expect(manual.cleared()).toContain(first.handle);
    const timers = manual.pending();
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(60_000);

    // 舊的回呼即使被觸發也不會呼叫 onExpire。
    manual.fire(first);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('cancel 清除排程，之後殘留的回呼不會呼叫 onExpire', () => {
    const manual = createManualScheduler(START);
    const onExpire = vi.fn();
    const countdown = createCountdown({
      scheduler: manual.scheduler,
      onExpire,
    });

    countdown.schedule(new Date(START + 10_000).toISOString());
    const timer = manual.pending()[0] as PendingTimer;
    countdown.cancel();

    expect(manual.cleared()).toContain(timer.handle);
    expect(manual.pending()).toHaveLength(0);

    manual.advance(10_000);
    manual.fire(timer);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('結束時間已過時視為立即（delay 0），仍可觸發 onExpire', () => {
    const manual = createManualScheduler(START);
    const onExpire = vi.fn();
    const countdown = createCountdown({
      scheduler: manual.scheduler,
      onExpire,
    });

    countdown.schedule(new Date(START - 1).toISOString());
    const timer = manual.pending()[0] as PendingTimer;
    expect(timer.ms).toBe(0);

    manual.fire(timer);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('未注入 scheduler 時使用真實時鐘排程（不以固定秒數等待）', () => {
    const onExpire = vi.fn();
    const countdown = createCountdown({ onExpire });
    // 只驗證可以排程與取消而不拋錯（真實計時器不等待）。
    countdown.schedule(new Date(Date.now() + 60_000).toISOString());
    countdown.cancel();
    expect(onExpire).not.toHaveBeenCalled();
  });
});
