import type { Snapshot } from '@classroom/shared';
import { useState } from 'react';
import { Countdown } from '../shared/Countdown';
import { AnswerBoard } from './AnswerBoard';
import { GroupManager } from './GroupManager';
import { PhaseControl } from './PhaseControl';
import { QuestionImport } from './QuestionImport';
import { QuestionList } from './QuestionList';
import { TeacherLogin } from './TeacherLogin';
import styles from './TeacherPage.module.css';

export type TeacherPageProps = {
  snapshot: Snapshot | null;
};

export function TeacherPage({ snapshot }: TeacherPageProps) {
  const [isAwaitingTeacherSnapshot, setIsAwaitingTeacherSnapshot] =
    useState(false);

  if (snapshot?.role !== 'teacher') {
    return (
      <section className={styles.page} aria-labelledby="teacher-page-title">
        <header className={styles.header}>
          <h1 id="teacher-page-title" className={styles.title}>
            老師端
          </h1>
        </header>
        <TeacherLogin
          onLoginSuccess={() => {
            setIsAwaitingTeacherSnapshot(true);
          }}
        />
        {isAwaitingTeacherSnapshot && (
          <p className={styles.notice} role="status">
            已送出登入資訊，等待同步老師狀態。
          </p>
        )}
      </section>
    );
  }

  return (
    <section className={styles.page} aria-labelledby="teacher-page-title">
      <header className={styles.header}>
        <h1 id="teacher-page-title" className={styles.title}>
          老師端
        </h1>
      </header>
      <PhaseControl snapshot={snapshot} />
      {snapshot.phase === 'open' && (
        <Countdown
          serverNow={snapshot.serverNow}
          countdownEndsAt={snapshot.countdownEndsAt}
        />
      )}
      <QuestionImport snapshot={snapshot} />
      <QuestionList questions={snapshot.questions} />
      <GroupManager snapshot={snapshot} />
      {/* 003 US3（T032）：任何階段都有看板與進度（FR-019–FR-022）。 */}
      <AnswerBoard snapshot={snapshot} />
    </section>
  );
}

export default TeacherPage;
