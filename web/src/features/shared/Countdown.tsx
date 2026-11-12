import { useEffect, useState } from 'react';
import styles from './Countdown.module.css';

export type CountdownProps = {
  /** 伺服器快照的目前時間（ISO 8601），用來校正本機時鐘。 */
  serverNow: string;
  /** 伺服器給的絕對結束時間；沒有設定倒數時為 null。 */
  countdownEndsAt: string | null;
};

function calculateRemainingSeconds(
  clockOffsetMs: number,
  countdownEndsAt: string,
): number {
  const correctedNowMs = Date.now() + clockOffsetMs;
  const remainingMs = Date.parse(countdownEndsAt) - correctedNowMs;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function formatRemainingSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0',
  )}`;
}

/** 顯示以伺服器時間為準的剩餘時間，避免受使用者裝置時鐘影響。 */
export function Countdown({ serverNow, countdownEndsAt }: CountdownProps) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(() => {
    if (countdownEndsAt === null) {
      return null;
    }

    const clockOffsetMs = Date.parse(serverNow) - Date.now();
    return calculateRemainingSeconds(clockOffsetMs, countdownEndsAt);
  });

  useEffect(() => {
    if (countdownEndsAt === null) {
      // 沒有倒數時由下方的 countdownEndsAt === null 判斷直接不顯示。
      return undefined;
    }

    // 收到新快照時重新計算與伺服器的時間差（FR-024）。
    const clockOffsetMs = Date.parse(serverNow) - Date.now();
    const updateRemainingSeconds = () => {
      setRemainingSeconds(
        calculateRemainingSeconds(clockOffsetMs, countdownEndsAt),
      );
    };

    // 不在 effect 本體同步 setState；第一次更新排在下一個 tick。
    const firstUpdateId = window.setTimeout(updateRemainingSeconds, 0);
    const intervalId = window.setInterval(updateRemainingSeconds, 250);

    return () => {
      window.clearTimeout(firstUpdateId);
      window.clearInterval(intervalId);
    };
  }, [serverNow, countdownEndsAt]);

  if (countdownEndsAt === null || remainingSeconds === null) {
    return null;
  }

  const formattedRemainingSeconds = formatRemainingSeconds(remainingSeconds);

  return (
    <div
      className={styles.timer}
      role="timer"
      aria-live="off"
      aria-label={`剩餘時間 ${formattedRemainingSeconds}`}
    >
      {`剩餘時間 ${formattedRemainingSeconds}`}
    </div>
  );
}

export default Countdown;
