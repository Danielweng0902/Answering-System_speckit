import type {
  CommandEvent,
  CommandPayloads,
  TeacherSnapshot,
} from '@classroom/shared';
import { useI18n } from '../../lib/i18n/LanguageProvider';
import { phaseLabel } from '../../lib/i18n/phase';
import { useId, useState } from 'react';
import { sendCommand, type CommandResult } from '../../lib/socket';
import { phaseStyleClass } from '../shared/phaseStyle';
import styles from './PhaseControl.module.css';



type ActivityCommandEvent = Extract<
  CommandEvent,
  'activity:open' | 'activity:close' | 'activity:reset' | 'activity:fair-ranking'
>;

export type PhaseControlProps = {
  snapshot: TeacherSnapshot;
};

/** 老師端的階段顯示、倒數輸入與活動控制（T053、T066、T071）。 */
export function PhaseControl({ snapshot }: PhaseControlProps) {
  const { t } = useI18n();
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
        {t('control.title')}
      </h2>
      <p className={`${styles.status} ${phaseStyleClass(snapshot.phase)}`}>{t('phase.current', { phase: phaseLabel(t, snapshot.phase) })}</p>
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
            // 維持原生 checkbox（不改成 role="switch"）：倒數秒數要按
            // 「開啟搶答」才生效，依 ARIA APG 建議這是表單欄位而不是
            // 立即生效的開關；只有「啟用公平順位」是立即生效，才用 switch。
            onChange={(event) => {
              setCountdownEnabled(event.target.checked);
            }}
          />
          {t('control.setCountdown')}
        </label>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={countdownSecondsId}>
            {t('control.countdownSeconds')}
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
          {t('control.open')}
        </button>
        <button
          className={styles.button}
          type="button"
          disabled={isSending || snapshot.phase !== 'open'}
          onClick={() => {
            void send('activity:close', {});
          }}
        >
          {t('control.close')}
        </button>
      </div>

      {/* 005（FR-001、AC-005-09）：公平順位只有準備中能切換。 */}
      <div className={styles.fairRankingRow}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            name="enable-fair-ranking"
            checked={snapshot.fairRankingEnabled}
            disabled={isSending || !isPreparing}
            // 同「設定倒數」：以 role="switch" 表達開／關語意。
            role="switch"
            onChange={(event) => {
              void send('activity:fair-ranking', {
                enabled: event.target.checked,
              });
            }}
          />
          {t('control.fairness')}
        </label>
        <p className={styles.description}>
          {t('control.fairnessHint')}
        </p>
      </div>

      {snapshot.phase === 'closed' &&
        (isShowingResetConfirmation ? (
          <div
            className={styles.confirmation}
            role="group"
            aria-label={t('control.resetConfirmLabel')}
          >
            <p className={styles.confirmationText}>
              {t('control.resetHint')}
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
                {t('control.resetConfirm')}
              </button>
              <button
                className={styles.button}
                type="button"
                disabled={isSending}
                onClick={() => {
                  setIsShowingResetConfirmation(false);
                }}
              >
                {t('control.resetCancel')}
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
            {t('control.resetActivity')}
          </button>
        ))}
    </section>
  );
}

export default PhaseControl;
