import { useI18n } from '../../lib/i18n/LanguageProvider';
import { phaseLabel } from '../../lib/i18n/phase';
import type { ProjectorSnapshot, Snapshot } from '@classroom/shared';
import { Link } from 'react-router';
import { Countdown } from '../shared/Countdown';
import { LanguageSwitch } from '../shared/LanguageSwitch';
import { phaseStyleClass } from '../shared/phaseStyle';
import { QuestionNumber } from '../shared/QuestionNumber';
import { TeacherLogin } from '../teacher/TeacherLogin';
import styles from './ProjectorPage.module.css';

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
  const { t } = useI18n();
  if (snapshot === null) {
    return (
      <section className={styles.page} aria-labelledby="projector-title">
        <h1 id="projector-title" className={styles.title}>
          {t('projector.title')}
        </h1>
        <p className={styles.hint}>{t('projector.connecting')}</p>
      </section>
    );
  }

  if (snapshot.role !== 'projector') {
    return (
      <section className={styles.page} aria-labelledby="projector-title">
        <h1 id="projector-title" className={styles.title}>
          {t('projector.title')}
        </h1>
        <p className={styles.hint} role="status">
          {t('projector.loginHint')}
        </p>
        <TeacherLogin />
        <p className={styles.hint}>
          <Link className={styles.link} to="/teacher">
            {t('projector.toTeacher')}
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
          {phaseLabel(t, projector.phase)}
        </h1>
        <p className={styles.rule}>
          {projector.fairRankingEnabled
            ? t('projector.ruleFair')
            : t('projector.ruleFirstCome')}
        </p>
        <LanguageSwitch />
      </header>

      {projector.phase === 'open' && projector.countdownEndsAt !== null && (
        <Countdown serverNow={projector.serverNow} countdownEndsAt={projector.countdownEndsAt} />
      )}

      {projector.phase !== 'closed' && (
        <section className={styles.groupSection} aria-labelledby="projector-groups-title">
          <h2 id="projector-groups-title" className={styles.sectionTitle}>
            {t('projector.groupStatus')}
          </h2>
          <ul className={styles.groupList}>
            {projector.groupStatus.map((group) => (
              <li key={group.id} className={styles.groupItem}>
                <span className={styles.groupName}>{group.name}</span>
                <span className={group.online ? styles.online : styles.offline}>
                  {group.online ? t('projector.online') : t('projector.offline')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {projector.phase === 'closed' && (
        <section className={styles.revealSection} aria-labelledby="projector-reveal-title">
          <h2 id="projector-reveal-title" className={styles.sectionTitle}>
            {t('projector.revealTitle')}
          </h2>
          {projector.reveal.questions.length === 0 ? (
            <p className={styles.hint}>{t('projector.noReveal')}</p>
          ) : (
            <ol className={styles.revealList}>
              {projector.reveal.questions.map((entry) => (
                <li key={entry.questionNumber} className={styles.revealItem}>
                  <span className={styles.revealNumber}>
                    <QuestionNumber number={entry.questionNumber} />
                  </span>
                  <span
                    className={
                      entry.winnerGroupName === null
                        ? `${styles.revealWinner} ${styles.revealWinnerEmpty}`
                        : styles.revealWinner
                    }
                  >
                    {entry.winnerGroupName === null
                      ? t('projector.noWinner')
                      : entry.winnerGroupName}
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
                {t('projector.winCounts')}
              </h3>
              <ul className={styles.groupList}>
                {projector.reveal.groupWinCounts.map((entry) => (
                  <li key={entry.groupId} className={styles.groupItem}>
                    <span className={styles.groupName}>{entry.groupName}</span>
                    <span className={styles.winCount}>
                      {t('projector.winCount', { count: entry.count })}
                    </span>
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
