import { Link, Route, Routes } from 'react-router';
import { ConnectionStatus } from '../features/shared/ConnectionStatus';
import { StudentPage } from '../features/student/StudentPage';
import { TeacherPage } from '../features/teacher/TeacherPage';
import styles from './App.module.css';
import { useSnapshot } from '../lib/useSnapshot';

function HomePage() {
  return (
    <section className={styles.page} aria-labelledby="home-title">
      <div>
        <h1 id="home-title" className={styles.title}>
          選擇身分
        </h1>
        <p className={styles.description}>請選擇要進入老師端或學生端。</p>
      </div>
      <nav className={styles.roleLinks} aria-label="選擇身分">
        <Link className={styles.roleLink} to="/teacher">
          老師
        </Link>
        <Link className={styles.roleLink} to="/student">
          學生
        </Link>
      </nav>
    </section>
  );
}

export function AppRoutes() {
  const snapshotState = useSnapshot();

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
      </Routes>
    </>
  );
}
