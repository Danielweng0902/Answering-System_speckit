import { Link, Route, Routes, useLocation } from 'react-router';
import { useI18n } from '../lib/i18n/LanguageProvider';
import { ConnectionStatus } from '../features/shared/ConnectionStatus';
import { LanguageSwitch } from '../features/shared/LanguageSwitch';
import { ProjectorPage } from '../features/projector/ProjectorPage';
import { StudentPage } from '../features/student/StudentPage';
import { TeacherPage } from '../features/teacher/TeacherPage';
import styles from './App.module.css';
import { useSnapshot } from '../lib/useSnapshot';

function HomePage() {
  const { t } = useI18n();
  return (
    <section className={styles.page} aria-labelledby="home-title">
      <div className={styles.homeHeader}>
        <div>
          <h1 id="home-title" className={styles.title}>
            {t('home.title')}
          </h1>
          <p className={styles.description}>{t('home.description')}</p>
        </div>
        <LanguageSwitch />
      </div>
      <nav className={styles.roleLinks} aria-label={t('home.roleLabel')}>
        <Link className={styles.roleLink} to="/teacher">
          {t('home.teacher')}
        </Link>
        <Link className={styles.roleLink} to="/student">
          {t('home.student')}
        </Link>
      </nav>
    </section>
  );
}

export function AppRoutes() {
  // 005：投影看板以 view='projector' 連線，伺服器改送不含作答資訊的快照；
  // 其他頁面維持一般檢視模式。
  const location = useLocation();
  const view = location.pathname === '/projector' ? 'projector' : 'normal';
  const snapshotState = useSnapshot({ view });

  return (
    <>
      <ConnectionStatus
        connectionState={snapshotState.connectionState ?? 'connecting'}
      />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/teacher"
          element={<TeacherPage snapshot={snapshotState.snapshot} />}
        />
        <Route path="/student" element={<StudentPage {...snapshotState} />} />
        {/* 005：投影看板是獨立頁面，內容來自不含作答資訊的投影快照。 */}
        <Route
          path="/projector"
          element={<ProjectorPage snapshot={snapshotState.snapshot} />}
        />
      </Routes>
    </>
  );
}
