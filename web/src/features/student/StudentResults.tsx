import { useI18n } from '../../lib/i18n/LanguageProvider';
import type { StudentClosedSnapshot, StudentQuestion } from '@classroom/shared';
import { QuestionNumber } from '../shared/QuestionNumber';
import styles from './StudentResults.module.css';

export type StudentResultsProps = {
  snapshot: StudentClosedSnapshot;
};

/**
 * 題組（一題多空格）的每格答案以原前綴標示、依前綴順序逐格顯示
 * （003 US5；T040；AC-003-25），例如「（1）A、（2）B」。
 * 單題維持原有的「、」合併顯示；blanks 與 answers 同為 blank position
 * 順序（T038 整合測試保證），以 index 對應，與 AnswerArea 相同慣例。
 */
function formatAnswers(question: StudentQuestion, answers: string[]): string {
  if (question.blanks.length <= 1 || answers.length !== question.blanks.length) {
    return answers.join('、');
  }
  return answers
    .map((answer, index) => `${question.blanks[index]?.prefix ?? ''}${answer}`)
    .join('、');
}

/**
 * 結束後的結果（003 US4；AC-003-17–19、FR-023–FR-025）。答案一律以
 * React 文字節點輸出，不做任何 HTML 解析（spec Edge Cases）。
 */
export function StudentResults({ snapshot }: StudentResultsProps) {
  const { t } = useI18n();
  const myAnswersByNumber = new Map(
    snapshot.myAnswers.map((answer) => [answer.questionNumber, answer]),
  );
  const resultsByNumber = new Map(
    snapshot.results.map((result) => [result.questionNumber, result]),
  );

  return (
    <section className={styles.results} aria-labelledby="student-results-title">
      <h2 id="student-results-title" className={styles.title}>
        {t('results.title')}
      </h2>
      <p className={styles.description}>
        {t('results.description')}
      </p>
      {/* 005（AC-005-11、FR-011）：標示本場使用的順位規則與改判題目。 */}
      <p className={styles.description}>
        {snapshot.fairRankingEnabled
          ? t('results.fair')
          : t('results.firstCome')}
      </p>
      <ol className={styles.questions} aria-label={t('results.listLabel')}>
        {snapshot.questions.map((question) => {
          const result = resultsByNumber.get(question.number);
          const myAnswer = myAnswersByNumber.get(question.number);
          const winner = result?.winner ?? null;

          return (
            <li key={question.number} className={styles.questionItem}>
              <section
                className={styles.question}
                aria-labelledby={`result-${question.number}-title`}
              >
                <h3
                  id={`result-${question.number}-title`}
                  className={styles.questionTitle}
                >
                  <QuestionNumber number={question.number} />
                </h3>
                {/* 內容放在同一個欄位裡：題號欄固定、內容欄自適應，
                    內容多一行（例如「本題因公平順位改判」）也不會擠到隔壁欄。 */}
                <div className={styles.questionBody}>
                {question.prompt !== '' && (
                  <p className={styles.prompt}>{question.prompt}</p>
                )}

                {winner === null ? (
                  <p className={styles.noAnswer}>{t('results.noAnswer')}</p>
                ) : (
                  <>
                    <p className={styles.winner}>
                      {t('results.winner', { group: winner.groupName })}
                    </p>
                    {result?.fairnessApplied === true && (
                      <p className={styles.description}>{t('results.fairnessAdjusted')}</p>
                    )}
                    <p className={styles.answers}>
                      {t('results.answer', { answers: formatAnswers(question, winner.answers) })}
                    </p>
                  </>
                )}

                {myAnswer?.state === 'submitted' && (
                  <>
                    <p className={styles.mine}>
                      {t('results.myAnswer', { answers: formatAnswers(question, myAnswer.answers) })}
                    </p>
                    {myAnswer.rank !== null && (
                      <p className={styles.mine}>
                        {t('results.myRank', { rank: myAnswer.rank })}
                      </p>
                    )}
                  </>
                )}
                {myAnswer?.state === 'voided' && (
                  <p className={styles.mine}>
                    {t('results.voided', { answers: formatAnswers(question, myAnswer.answers) })}
                  </p>
                )}
                {(myAnswer === undefined ||
                  myAnswer.state === 'not_submitted') && (
                  <p className={styles.mine}>{t('results.notSubmitted')}</p>
                )}
                </div>
              </section>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default StudentResults;
