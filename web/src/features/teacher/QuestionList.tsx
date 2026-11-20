import { useI18n } from '../../lib/i18n/LanguageProvider';
import type { MessageKey } from '../../lib/i18n/messages';
import type { QuestionKind, QuestionSummary } from '@classroom/shared';
import { QuestionNumber } from '../shared/QuestionNumber';
import styles from './QuestionList.module.css';

export type QuestionListProps = {
  questions: QuestionSummary[];
};

const QUESTION_KIND_KEYS: Record<QuestionKind, MessageKey> = {
  single: 'import.kindSingle',
  group: 'import.kindGroup',
};

/** 老師端確認後的題目清單。學生與訪客快照不會收到這些資料。 */
export function QuestionList({ questions }: QuestionListProps) {
  const { t } = useI18n();
  return (
    <section className={styles.section} aria-label={t('list.title')}>
      <h2 className={styles.title}>{t('list.title')}</h2>
      {questions.length === 0 ? (
        <p className={styles.empty}>{t('list.empty')}</p>
      ) : (
        <ol className={styles.list} aria-label={t('list.listLabel')}>
          {questions.map((question) => (
            <li className={styles.question} key={question.number}>
              <strong>
                <QuestionNumber number={question.number} />
              </strong>
              <span className={styles.meta}>
                {t('import.kindDetail', {
                  kind: t(QUESTION_KIND_KEYS[question.kind]),
                  blanks: question.blankCount,
                })}
              </span>
              {question.prompt.length > 0 && (
                <span className={styles.prompt}>{question.prompt}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default QuestionList;
