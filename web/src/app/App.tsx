import { BrowserRouter } from 'react-router';
import styles from './App.module.css';
import { AppRoutes } from './routes';

export function App() {
  return (
    <BrowserRouter>
      <div className={`app-shell ${styles.shell}`}>
        <main className={styles.main}>
          <AppRoutes />
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
