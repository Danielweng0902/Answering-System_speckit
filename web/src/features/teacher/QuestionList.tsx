import type { QuestionKind, QuestionSummary } from '@classroom/shared';
import styles from './QuestionList.module.css';

export type QuestionListProps = {
  questions: QuestionSummary[];
};

const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  single: '單題',
  group: '題組',
};

/** 老師端確認後的題目清單。學生與訪客快照不會收到這些資料。 */
export function QuestionList({ questions }: QuestionListProps) {
  return (
    <section className={styles.section} aria-label="題目清單">
      <h2 className={styles.title}>題目清單</h2>
      {questions.length === 0 ? (
        <p className={styles.empty}>尚未匯入題目</p>
      ) : (
        <ol className={styles.list} aria-label="已匯入題目">
          {questions.map((question) => (
            <li className={styles.question} key={question.number}>
              <strong>{`第 ${question.number} 題`}</strong>
              <span className={styles.meta}>
                {`${QUESTION_KIND_LABELS[question.kind]}，${question.blankCount} 個空格`}
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
