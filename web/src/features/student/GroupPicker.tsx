import { ERROR_MESSAGES, type GroupSummary } from '@classroom/shared';
import { useState } from 'react';
import { joinStudent } from '../../lib/api';
import { saveToken } from '../../lib/session';
import { connectSocket } from '../../lib/socket';
import styles from './GroupPicker.module.css';

export type GroupPickerProps = {
  groups: readonly GroupSummary[];
  /** 伺服器已通知目前組別不存在時，提示學生重新選擇。 */
  sessionInvalid: boolean;
};

export function GroupPicker({ groups, sessionInvalid }: GroupPickerProps) {
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
        選擇組別
      </h2>
      {sessionInvalid && (
        <p className={styles.notice} role="alert">
          {ERROR_MESSAGES.GROUP_NOT_FOUND}
        </p>
      )}
      {errorMessage !== null && (
        <p className={styles.notice} role="alert">
          {errorMessage}
        </p>
      )}
      {groups.length === 0 ? (
        <p className={styles.description} role="status">
          老師尚未建立組別
        </p>
      ) : (
        <ul className={styles.list} aria-label="可選組別">
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
