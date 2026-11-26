import type { GroupSummary, SessionInvalidPayload } from '@classroom/shared';
import { useState } from 'react';
import { useI18n } from '../../lib/i18n/LanguageProvider';
import { joinStudent } from '../../lib/api';
import { saveToken } from '../../lib/session';
import { connectSocket } from '../../lib/socket';
import styles from './GroupPicker.module.css';

const SESSION_INVALID_MESSAGE_KEYS = {
  GROUP_NOT_FOUND: 'picker.groupNotFound',
  ACTIVITY_RESET: 'picker.activityReset',
  SESSION_EXPIRED: 'picker.sessionExpired',
} as const;

export type GroupPickerProps = {
  groups: readonly GroupSummary[];
  /**
   * 伺服器已通知目前進場狀態失效時，提示學生重新選擇。
   *
   * - `GROUP_NOT_FOUND`：目前組別已不存在（老師刪組）。
   * - `ACTIVITY_RESET`：活動被重設，本場的進場狀態失效（D2-1）。
   * - `SESSION_EXPIRED`：帶著已失效的 token 重新連線，原失效原因已無法分辨。
   */
  sessionInvalidCode: SessionInvalidPayload['code'] | null;
};

export function GroupPicker({ groups, sessionInvalidCode }: GroupPickerProps) {
  const { t } = useI18n();
  const [joiningGroupId, setJoiningGroupId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function joinGroup(groupId: string): Promise<void> {
    setJoiningGroupId(groupId);
    setErrorMessage(null);

    try {
      const result = await joinStudent(groupId);

      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }

      saveToken(result.token);
      connectSocket(result.token);
    } finally {
      setJoiningGroupId(null);
    }
  }

  const isJoining = joiningGroupId !== null;

  return (
    <section className={styles.card} aria-labelledby="group-picker-title">
      <h2 id="group-picker-title" className={styles.title}>
        {t('picker.title')}
      </h2>
      {sessionInvalidCode !== null && (
        <p className={styles.notice} role="alert">
          {t(SESSION_INVALID_MESSAGE_KEYS[sessionInvalidCode])}
        </p>
      )}
      {errorMessage !== null && (
        <p className={styles.notice} role="alert">
          {errorMessage}
        </p>
      )}
      {groups.length === 0 ? (
        <p className={styles.description} role="status">
          {t('picker.empty')}
        </p>
      ) : (
        <ul className={styles.list} aria-label={t('picker.listLabel')}>
          {groups.map((group) => (
            <li key={group.id}>
              <button
                className={styles.button}
                type="button"
                disabled={isJoining}
                aria-busy={joiningGroupId === group.id}
                onClick={() => {
                  void joinGroup(group.id);
                }}
              >
                {group.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default GroupPicker;
