import type {
  CommandEvent,
  CommandPayloads,
  Phase,
  TeacherSnapshot,
} from '@classroom/shared';
import { useId, useState } from 'react';
import { sendCommand, type CommandResult } from '../../lib/socket';
import styles from './PhaseControl.module.css';

const PHASE_LABELS: Record<Phase, string> = {
  preparing: '準備中',
  open: '搶答中',
  closed: '已結束',
};

type ActivityCommandEvent = Extract<
  CommandEvent,
  'activity:open' | 'activity:close' | 'activity:reset'
>;

export type PhaseControlProps = {
  snapshot: TeacherSnapshot;
};

/** 老師端的階段顯示、倒數輸入與活動控制（T053、T066、T071）。 */
export function PhaseControl({ snapshot }: PhaseControlProps) {
  const countdownSecondsId = useId();
  const [countdownEnabled, setCountdownEnabled] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState('60');
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isShowingResetConfirmation, setIsShowingResetConfirmation] =
    useState(false);

  const isPreparing = snapshot.phase === 'preparing';
  const controlsDisabled = isSending || !isPreparing;

  async function send<E extends ActivityCommandEvent>(
    event: E,
    payload: CommandPayloads[E],
  ): Promise<CommandResult> {
    setErrorMessage(null);
    setIsSending(true);

    try {
      const ack = await sendCommand(event, payload);
      if (!ack.ok) {
        setErrorMessage(ack.error.message);
      }
      return ack;
    } finally {
      setIsSending(false);
    }
  }

  async function openActivity(): Promise<void> {
    const payload: CommandPayloads['activity:open'] = countdownEnabled
      ? { countdownSeconds: Number(countdownSeconds) }
      : {};

    await send('activity:open', payload);
  }

  async function resetActivity(): Promise<void> {
    const ack = await send('activity:reset', { confirm: true });
    if (ack.ok) {
      setIsShowingResetConfirmation(false);
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

      <div className={styles.countdownControls}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            name="enable-countdown"
            checked={countdownEnabled}
            disabled={controlsDisabled}
            onChange={(event) => {
              setCountdownEnabled(event.target.checked);
            }}
          />
          設定倒數
        </label>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={countdownSecondsId}>
            倒數秒數
          </label>
          <input
            id={countdownSecondsId}
            className={styles.input}
            type="number"
            name="countdown-seconds"
            value={countdownSeconds}
            disabled={controlsDisabled}
            onChange={(event) => {
              setCountdownSeconds(event.target.value);
            }}
          />
        </div>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.button}
          type="button"
          disabled={isSending || snapshot.phase !== 'preparing'}
          onClick={() => {
            void openActivity();
          }}
        >
          開啟搶答
        </button>
        <button
          className={styles.button}
          type="button"
          disabled={isSending || snapshot.phase !== 'open'}
          onClick={() => {
            void send('activity:close', {});
          }}
        >
          結束搶答
        </button>
      </div>

      {snapshot.phase === 'closed' &&
        (isShowingResetConfirmation ? (
          <div
            className={styles.confirmation}
            role="group"
            aria-label="確認重設活動"
          >
            <p className={styles.confirmationText}>
              重設後回到準備中，組別保留
            </p>
            <div className={styles.resetActions}>
              <button
                className={styles.button}
                type="button"
                disabled={isSending}
                onClick={() => {
                  void resetActivity();
                }}
              >
                確認重設
              </button>
              <button
                className={styles.button}
                type="button"
                disabled={isSending}
                onClick={() => {
                  setIsShowingResetConfirmation(false);
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            className={styles.button}
            type="button"
            disabled={isSending}
            onClick={() => {
              setIsShowingResetConfirmation(true);
            }}
          >
            重設活動
          </button>
        ))}
    </section>
  );
}

export default PhaseControl;
