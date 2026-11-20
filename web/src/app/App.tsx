import { BrowserRouter } from 'react-router';
import { LanguageProvider } from '../lib/i18n/LanguageProvider';
import styles from './App.module.css';
import { AppRoutes } from './routes';

export function App() {
  return (
    <BrowserRouter>
      {/* 007 i18n：預設依使用者的系統語言，可在畫面右上角切換。 */}
      <LanguageProvider>
        <div className={`app-shell ${styles.shell}`}>
          <main className={styles.main}>
            <AppRoutes />
          </main>
        </div>
      </LanguageProvider>
    </BrowserRouter>
  );
}

export default App;
