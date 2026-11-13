import type { StudentClosedSnapshot, StudentQuestion } from '@classroom/shared';
import styles from './StudentResults.module.css';

export type StudentResultsProps = {
  snapshot: StudentClosedSnapshot;
};

/**
 * 題組（一題多空格）的每格答案以原前綴標示、依前綴順序逐格顯示
 * （003 US5；T040；AC-003-25），例如「（1）甲、（2）乙」。
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
  const myAnswersByNumber = new Map(
    snapshot.myAnswers.map((answer) => [answer.questionNumber, answer]),
  );
  const resultsByNumber = new Map(
    snapshot.results.map((result) => [result.questionNumber, result]),
  );

  return (
    <section className={styles.results} aria-labelledby="student-results-title">
      <h2 id="student-results-title" className={styles.title}>
        結果區
      </h2>
      <p className={styles.description}>
        搶答已結束，每一題顯示搶答成功的組別與答案，以及本組的答案與順位。
      </p>
      <ol className={styles.questions} aria-label="作答結果">
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
                  第 {question.number} 題
                </h3>
                {question.prompt !== '' && (
                  <p className={styles.prompt}>{question.prompt}</p>
                )}

                {winner === null ? (
                  <p className={styles.noAnswer}>無人作答</p>
                ) : (
                  <>
                    <p className={styles.winner}>
                      搶答成功：{winner.groupName}
                    </p>
                    <p className={styles.answers}>
                      答案：{formatAnswers(question, winner.answers)}
                    </p>
                  </>
                )}

                {myAnswer?.state === 'submitted' && (
                  <>
                    <p className={styles.mine}>
                      本組答案：{formatAnswers(question, myAnswer.answers)}
                    </p>
                    {myAnswer.rank !== null && (
                      <p className={styles.mine}>
                        本組順位：第 {myAnswer.rank} 順位
                      </p>
                    )}
                  </>
                )}
                {myAnswer?.state === 'voided' && (
                  <p className={styles.mine}>
                    本組作答已被老師作廢：
                    {formatAnswers(question, myAnswer.answers)}
                  </p>
                )}
                {(myAnswer === undefined ||
                  myAnswer.state === 'not_submitted') && (
                  <p className={styles.mine}>本組未作答</p>
                )}
              </section>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default StudentResults;
