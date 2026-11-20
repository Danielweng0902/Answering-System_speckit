import { useI18n } from '../../lib/i18n/LanguageProvider';
import { useId, useState, type FormEvent } from 'react';
import { loginTeacher } from '../../lib/api';
import { saveToken } from '../../lib/session';
import { connectSocket } from '../../lib/socket';
import styles from './TeacherLogin.module.css';

export type TeacherLoginProps = {
  onLoginSuccess?: (token: string) => void;
};

export function TeacherLogin({ onLoginSuccess }: TeacherLoginProps) {
  const { t } = useI18n();
  const passwordId = useId();
  const errorId = useId();
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await loginTeacher(password);

      if (!result.ok) {
        setPassword('');
        setErrorMessage(result.error.message);
        return;
      }

      saveToken(result.token);
      connectSocket(result.token);
      setPassword('');
      onLoginSuccess?.(result.token);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="teacher-login-title">
      <h2 id="teacher-login-title" className={styles.title}>
        {t('login.title')}
      </h2>
      <form
        className={styles.form}
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor={passwordId}>
            {t('login.passwordLabel')}
          </label>
          <input
            id={passwordId}
            className={styles.input}
            type="password"
            name="password"
            autoComplete="current-password"
            // 密碼是必填：先由瀏覽器擋住空白送出（Modern Web Guidance：
            // 登入表單用原生驗證），送出鍵在行動鍵盤上標示為「完成」。
            required
            enterKeyHint="done"
            value={password}
            disabled={isSubmitting}
            aria-invalid={errorMessage !== null}
            aria-describedby={errorMessage === null ? undefined : errorId}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </div>
        {errorMessage !== null && (
          <p id={errorId} className={styles.error} role="alert">
            {errorMessage}
          </p>
        )}
        <button className={styles.button} type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
    </section>
  );
}

export default TeacherLogin;
