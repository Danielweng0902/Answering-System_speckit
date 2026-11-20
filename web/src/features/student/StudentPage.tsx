import { useState } from 'react';
import { useI18n } from '../../lib/i18n/LanguageProvider';
import { phaseLabel } from '../../lib/i18n/phase';
import type { UseSnapshotResult } from '../../lib/useSnapshot';
import { clearToken } from '../../lib/session';
import { connectSocket, sendCommand } from '../../lib/socket';
import { Countdown } from '../shared/Countdown';
import { LanguageSwitch } from '../shared/LanguageSwitch';
import { phaseStyleClass } from '../shared/phaseStyle';
import { AnswerArea } from './AnswerArea';
import { GroupPicker } from './GroupPicker';
import { StudentResults } from './StudentResults';
import styles from './StudentPage.module.css';


export type StudentPageProps = UseSnapshotResult;

export function StudentPage({ snapshot, sessionInvalid }: StudentPageProps) {
  const { t } = useI18n();
  const [isLeaving, setIsLeaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function leaveGroup(): Promise<void> {
    setIsLeaving(true);
    setErrorMessage(null);

    try {
      const ack = await sendCommand('student:leave', {});

      if (!ack.ok) {
        setErrorMessage(ack.error.message);
        return;
      }

      clearToken();
      connectSocket(null);
    } finally {
      setIsLeaving(false);
    }
  }

  if (snapshot?.role !== 'student' || sessionInvalid) {
    return (
      <section className={styles.page} aria-labelledby="student-page-title">
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <h1 id="student-page-title" className={styles.title}>
              {t('student.title')}
            </h1>
            <LanguageSwitch />
          </div>
        </header>
        <GroupPicker groups={snapshot?.groups ?? []} sessionInvalid={sessionInvalid} />
      </section>
    );
  }

  const myGroup = snapshot.groups.find((group) => group.id === snapshot.myGroupId);

  return (
    <section className={styles.page} aria-labelledby="student-page-title">
      <header className={styles.header}>
        {/* 標題與語言切換同一列，切換器靠右（2026-11-20 review：學生端切換器
            旁邊有一大段無效空白 → 用明確的結構，不要靠 :last-child 定位）。 */}
        <div className={styles.headerTop}>
          <h1 id="student-page-title" className={styles.title}>
            {t('student.title')}
          </h1>
          <LanguageSwitch />
        </div>
        <p className={styles.groupStatus}>
          {t('group.currentLabel')}{' '}
          <strong>{myGroup?.name ?? t('group.unknown')}</strong>
        </p>
        {/* 文字維持單一節點，螢幕閱讀器與測試讀到的都是「目前階段：搶答中」。 */}
        <p
          className={`${styles.phaseStatus} ${phaseStyleClass(snapshot.phase)}`}
        >
          {t('phase.current', { phase: phaseLabel(t, snapshot.phase) })}
        </p>
      </header>

      {errorMessage !== null && (
        <p className={styles.notice} role="alert">
          {errorMessage}
        </p>
      )}

      {snapshot.phase === 'open' && (
        <Countdown serverNow={snapshot.serverNow} countdownEndsAt={snapshot.countdownEndsAt} />
      )}

      {snapshot.phase === 'preparing' && (
        <PreparingView
          isLeaving={isLeaving}
          onLeave={() => {
            void leaveGroup();
          }}
        />
      )}
      {snapshot.phase === 'open' && <AnswerArea snapshot={snapshot} />}
      {snapshot.phase === 'closed' && <StudentResults snapshot={snapshot} />}
    </section>
  );
}

type PreparingViewProps = {
  isLeaving: boolean;
  onLeave: () => void;
};

function PreparingView({ isLeaving, onLeave }: PreparingViewProps) {
  const { t } = useI18n();
  return (
    <section className={styles.phaseCard} aria-labelledby="student-preparing-title">
      <h2 id="student-preparing-title" className={styles.phaseTitle}>
        {t('student.preparingTitle')}
      </h2>
      <p className={styles.description}>{t('student.preparingDescription')}</p>
      <button className={styles.button} type="button" disabled={isLeaving} onClick={onLeave}>
        {t('student.changeGroup')}
      </button>
    </section>
  );
}

export default StudentPage;
