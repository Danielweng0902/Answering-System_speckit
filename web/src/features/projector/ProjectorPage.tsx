import type { Phase, ProjectorSnapshot, Snapshot } from '@classroom/shared';
import { Link } from 'react-router';
import { Countdown } from '../shared/Countdown';
import { phaseStyleClass } from '../shared/phaseStyle';
import { TeacherLogin } from '../teacher/TeacherLogin';
import styles from './ProjectorPage.module.css';

const PHASE_LABELS: Record<Phase, string> = {
  preparing: '準備中',
  open: '搶答中',
  closed: '已結束',
};

export type ProjectorPageProps = {
  snapshot: Snapshot | null;
};

/**
 * 005 投影看板（US3；FR-013～FR-019）。
 *
 * 這頁用 view='projector' 連線，伺服器送來的快照本身就沒有作答資訊
 * （搶答中只有階段、倒數與各組是否在線）；這裡只負責把內容大字呈現。
 */
export function ProjectorPage({ snapshot }: ProjectorPageProps) {
  if (snapshot === null) {
    return (
      <section className={styles.page} aria-labelledby="projector-title">
        <h1 id="projector-title" className={styles.title}>
          投影看板
        </h1>
        <p className={styles.hint}>連線中…</p>
      </section>
    );
  }

  if (snapshot.role !== 'projector') {
    return (
      <section className={styles.page} aria-labelledby="projector-title">
        <h1 id="projector-title" className={styles.title}>
          投影看板
        </h1>
        <p className={styles.hint} role="status">
          請先以老師身分登入，才能使用投影看板。
        </p>
        <TeacherLogin />
        <p className={styles.hint}>
          <Link className={styles.link} to="/teacher">
            前往老師端
          </Link>
        </p>
      </section>
    );
  }

  const projector: ProjectorSnapshot = snapshot;

  return (
    <section className={styles.page} aria-labelledby="projector-title">
      <header className={styles.header}>
        <h1
          id="projector-title"
          className={`${styles.title} ${phaseStyleClass(projector.phase)}`}
        >
          {PHASE_LABELS[projector.phase]}
        </h1>
        <p className={styles.rule}>
          {projector.fairRankingEnabled ? '本場使用公平順位' : '本場先到先得'}
        </p>
      </header>

      {projector.phase === 'open' && projector.countdownEndsAt !== null && (
        <Countdown serverNow={projector.serverNow} countdownEndsAt={projector.countdownEndsAt} />
      )}

      {projector.phase !== 'closed' && (
        <section className={styles.groupSection} aria-labelledby="projector-groups-title">
          <h2 id="projector-groups-title" className={styles.sectionTitle}>
            組別在線狀態
          </h2>
          <ul className={styles.groupList}>
            {projector.groupStatus.map((group) => (
              <li key={group.id} className={styles.groupItem}>
                <span className={styles.groupName}>{group.name}</span>
                <span className={group.online ? styles.online : styles.offline}>
                  {group.online ? '在線' : '離線'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {projector.phase === 'closed' && (
        <section className={styles.revealSection} aria-labelledby="projector-reveal-title">
          <h2 id="projector-reveal-title" className={styles.sectionTitle}>
            搶答結果
          </h2>
          {projector.reveal.questions.length === 0 ? (
            <p className={styles.hint}>尚未揭曉任何題目。</p>
          ) : (
            <ol className={styles.revealList}>
              {projector.reveal.questions.map((entry) => (
                <li key={entry.questionNumber} className={styles.revealItem}>
                  <span className={styles.revealNumber}>
                    <span className={styles.revealNumberValue} aria-hidden="true">
                      {entry.questionNumber}
                    </span>
                    <span className={styles.revealNumberUnit} aria-hidden="true">
                      題
                    </span>
                    {/* 螢幕閱讀器用的「第 N 題」：視覺上隱藏，畫面只留大題號。 */}
                    <span className={styles.visuallyHidden}>
                      {`第 ${entry.questionNumber} 題`}
                    </span>
                  </span>
                  <span
                    className={
                      entry.winnerGroupName === null
                        ? `${styles.revealWinner} ${styles.revealWinnerEmpty}`
                        : styles.revealWinner
                    }
                  >
                    {entry.winnerGroupName === null ? '無人作答' : entry.winnerGroupName}
                  </span>
                  {entry.winnerAnswers.length > 0 && (
                    <span className={styles.revealAnswers}>{entry.winnerAnswers.join('／')}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {projector.reveal.groupWinCounts !== null && (
            <section className={styles.winCountSection} aria-labelledby="projector-wincount-title">
              <h3 id="projector-wincount-title" className={styles.sectionTitle}>
                各組搶答成功題數
              </h3>
              <ul className={styles.groupList}>
                {projector.reveal.groupWinCounts.map((entry) => (
                  <li key={entry.groupId} className={styles.groupItem}>
                    <span className={styles.groupName}>{entry.groupName}</span>
                    <span className={styles.winCount}>{`${entry.count} 題`}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}
    </section>
  );
}

export default ProjectorPage;
