import { useState } from 'react';
import type { Phase } from '@classroom/shared';
import type { UseSnapshotResult } from '../../lib/useSnapshot';
import { clearToken } from '../../lib/session';
import { connectSocket, sendCommand } from '../../lib/socket';
import { Countdown } from '../shared/Countdown';
import { GroupPicker } from './GroupPicker';
import styles from './StudentPage.module.css';

const PHASE_LABELS: Record<Phase, string> = {
  preparing: '準備中',
  open: '搶答中',
  closed: '已結束',
};

export type StudentPageProps = UseSnapshotResult;

export function StudentPage({
  snapshot,
  sessionInvalid,
}: StudentPageProps) {
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
          <h1 id="student-page-title" className={styles.title}>
            學生端
          </h1>
        </header>
        <GroupPicker
          groups={snapshot?.groups ?? []}
          sessionInvalid={sessionInvalid}
        />
      </section>
    );
  }

  const myGroup = snapshot.groups.find(
    (group) => group.id === snapshot.myGroupId,
  );

  return (
    <section className={styles.page} aria-labelledby="student-page-title">
      <header className={styles.header}>
        <h1 id="student-page-title" className={styles.title}>
          學生端
        </h1>
        <p className={styles.status}>
          目前組別：<strong>{myGroup?.name ?? '未知組別'}</strong>
        </p>
        <p className={styles.status}>
          目前階段：{PHASE_LABELS[snapshot.phase]}
        </p>
      </header>

      {errorMessage !== null && (
        <p className={styles.notice} role="alert">
          {errorMessage}
        </p>
      )}

      {snapshot.phase === 'open' && (
        <Countdown
          serverNow={snapshot.serverNow}
          countdownEndsAt={snapshot.countdownEndsAt}
        />
      )}

      {snapshot.phase === 'preparing' && (
        <PreparingView
          isLeaving={isLeaving}
          onLeave={() => {
            void leaveGroup();
          }}
        />
      )}
      {snapshot.phase === 'open' && <OpenView />}
      {snapshot.phase === 'closed' && <ClosedView />}
    </section>
  );
}

type PreparingViewProps = {
  isLeaving: boolean;
  onLeave: () => void;
};

function PreparingView({ isLeaving, onLeave }: PreparingViewProps) {
  return (
    <section
      className={styles.phaseCard}
      aria-labelledby="student-preparing-title"
    >
      <h2 id="student-preparing-title" className={styles.phaseTitle}>
        等待老師開啟搶答
      </h2>
      <p className={styles.description}>
        請留在這個畫面，老師開始後會自動更新。
      </p>
      <button
        className={styles.button}
        type="button"
        disabled={isLeaving}
        onClick={onLeave}
      >
        更換組別
      </button>
    </section>
  );
}

function OpenView() {
  return (
    <section className={styles.phaseCard} aria-labelledby="student-open-title">
      <h2 id="student-open-title" className={styles.phaseTitle}>
        作答區
      </h2>
      <p className={styles.description}>搶答進行中，作答功能將在後續開放。</p>
    </section>
  );
}

function ClosedView() {
  return (
    <section
      className={styles.phaseCard}
      aria-labelledby="student-closed-title"
    >
      <h2 id="student-closed-title" className={styles.phaseTitle}>
        結果區
      </h2>
      <p className={styles.description}>搶答已結束，結果功能將在後續開放。</p>
    </section>
  );
}

export default StudentPage;
