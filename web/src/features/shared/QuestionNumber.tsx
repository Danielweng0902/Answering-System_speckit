import { useI18n } from '../../lib/i18n/LanguageProvider';
import styles from './QuestionNumber.module.css';

export type QuestionNumberProps = {
  /** 題號（1 起算）。 */
  number: number;
};

/**
 * 題號標記：視覺上顯示 **Q1／Q2**，螢幕閱讀器讀「第 1 題」。
 *
 * 2026-11-19 review：題號改成國際通用的 Q 編號（與「去掉中華感」一致）；
 * 中文說法保留在隱藏文字裡，所以語意與無障礙不受影響。
 */
export function QuestionNumber({ number }: QuestionNumberProps) {
  const { t } = useI18n();
  return (
    <>
      <span className="visually-hidden">
        {t('question.sr', { number })}
      </span>
      <span className={styles.mark} aria-hidden="true">
        <span className={styles.q}>Q</span>
        <span className={styles.n}>{number}</span>
      </span>
    </>
  );
}

export default QuestionNumber;
