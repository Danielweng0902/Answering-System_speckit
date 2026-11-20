import { useI18n } from '../../lib/i18n/LanguageProvider';
import styles from './LanguageSwitch.module.css';

/**
 * 語言切換（007 i18n）：繁體中文／English。
 *
 * 預設依使用者的系統語言（`navigator.languages`），切換後記在 localStorage，
 * 換頁與重新整理都保留；同一個瀏覽器的其他分頁也會跟著變。
 */
export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div className={styles.switch} role="group" aria-label={t('language.label')}>
      <button
        className={language === 'zh-TW' ? styles.active : styles.option}
        type="button"
        aria-pressed={language === 'zh-TW'}
        onClick={() => {
          setLanguage('zh-TW');
        }}
      >
        中文
      </button>
      <button
        className={language === 'en' ? styles.active : styles.option}
        type="button"
        aria-pressed={language === 'en'}
        onClick={() => {
          setLanguage('en');
        }}
      >
        EN
      </button>
    </div>
  );
}

export default LanguageSwitch;
