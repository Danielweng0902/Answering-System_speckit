import type { Ack, CommandEvent, Phase, TeacherSnapshot } from '@classroom/shared';
import { useState } from 'react';
import { sendCommand } from '../../lib/socket';
import styles from './PhaseControl.module.css';

const PHASE_LABELS: Record<Phase, string> = {
  preparing: '準備中',
  open: '搶答中',
  closed: '已結束',
};

export type PhaseControlProps = {
  snapshot: TeacherSnapshot;
};

/** 老師端的階段顯示與「開啟搶答」「結束搶答」（T053；FR-015、016）。 */
export function PhaseControl({ snapshot }: PhaseControlProps) {
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function send(
    event: Extract<CommandEvent, 'activity:open' | 'activity:close'>,
  ): Promise<void> {
    setErrorMessage(null);
    setIsSending(true);

    try {
      // 倒數時間輸入屬於 Phase 7（T066），目前不帶 countdownSeconds。
      const ack: Ack = await sendCommand(event, {});
      if (!ack.ok) {
        setErrorMessage(ack.error.message);
      }
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="phase-control-title">
      <h2 id="phase-control-title" className={styles.title}>
        搶答控制
      </h2>
      <p className={styles.status}>{`目前階段：${PHASE_LABELS[snapshot.phase]}`}</p>
      {errorMessage !== null && (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      )}
      <div className={styles.actions}>
        <button
          className={styles.button}
          type="button"
          disabled={isSending || snapshot.phase !== 'preparing'}
          onClick={() => {
            void send('activity:open');
          }}
        >
          開啟搶答
        </button>
        <button
          className={styles.button}
          type="button"
          disabled={isSending || snapshot.phase !== 'open'}
          onClick={() => {
            void send('activity:close');
          }}
        >
          結束搶答
        </button>
      </div>
    </section>
  );
}

export default PhaseControl;
