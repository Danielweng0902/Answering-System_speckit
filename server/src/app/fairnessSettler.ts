/**
 * 公平順位「判定完成」提醒（005 T014；FR-010、FR-019；research R3）。
 *
 * 判定本身是衍生計算，不需要排程器保存結果；這個排程只負責在某題的
 * 3 秒批次時間結束時提醒伺服器廣播一次，讓老師看板從「判定中」翻成
 * 已判定。伺服器重啟後最多少一次即時翻轉，下次廣播時狀態仍然正確
 * （判定只依已保存的送達資料）。
 */
import type { CountdownScheduler } from './countdown.js';
import { defaultCountdownScheduler } from './countdown.js';

export type FairnessSettler = {
  /** 安排某題在 delayMs 後提醒一次；同一題重複安排會取代前一次。 */
  schedule: (questionNumber: number, delayMs: number) => void;
  /** 取消所有提醒（重設活動時呼叫）。 */
  cancelAll: () => void;
};

export type FairnessSettlerOptions = {
  scheduler?: CountdownScheduler | undefined;
  onSettled: (questionNumber: number) => void;
};

export function createFairnessSettler(
  options: FairnessSettlerOptions,
): FairnessSettler {
  const scheduler = options.scheduler ?? defaultCountdownScheduler;
  const handles = new Map<number, unknown>();

  function cancelAll(): void {
    for (const handle of handles.values()) {
      scheduler.clearTimeout(handle);
    }
    handles.clear();
  }

  return {
    schedule(questionNumber, delayMs) {
      const existing = handles.get(questionNumber);
      if (existing !== undefined) {
        scheduler.clearTimeout(existing);
      }
      const handle = scheduler.setTimeout(() => {
        handles.delete(questionNumber);
        options.onSettled(questionNumber);
      }, delayMs);
      handles.set(questionNumber, handle);
    },
    cancelAll,
  };
}
