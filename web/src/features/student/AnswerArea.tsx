import { useState } from 'react';
import type {
  StudentOpenAnswer,
  StudentOpenSnapshot,
  StudentQuestion,
} from '@classroom/shared';
import { sendCommand } from '../../lib/socket';
import {
  activateDraftSession,
  writeAnswerDrafts,
  type AnswerDraftMap,
} from './answerDrafts';
import styles from './AnswerArea.module.css';

export type AnswerAreaProps = {
  snapshot: StudentOpenSnapshot;
};

type AnswerStateByQuestion = Map<number, StudentOpenAnswer>;

function answerStates(snapshot: StudentOpenSnapshot): AnswerStateByQuestion {
  return new Map(
    snapshot.myAnswers.map((answer) => [answer.questionNumber, answer]),
  );
}

function inputLabel(question: StudentQuestion, prefix: string): string {
  return prefix === ''
    ? `第 ${question.number} 題答案`
    : `第 ${question.number} 題${prefix}答案`;
}

function blankText(prefix: string, index: number): string {
  return prefix === '' ? `第 ${index + 1} 格（答案）` : prefix;
}

function missingBlankTexts(
  question: StudentQuestion,
  draftAnswers: string[],
): string[] {
  return question.blanks.flatMap((blank, index) =>
    (draftAnswers[index] ?? '').trim() === ''
      ? [blankText(blank.prefix, index)]
      : [],
  );
}

export function AnswerArea({ snapshot }: AnswerAreaProps) {
  return (
    <AnswerAreaContent
      key={JSON.stringify([snapshot.sessionId, snapshot.myGroupId])}
      snapshot={snapshot}
    />
  );
}

function AnswerAreaContent({ snapshot }: AnswerAreaProps) {
  const [drafts, setDrafts] = useState<AnswerDraftMap>(() =>
    activateDraftSession(snapshot.sessionId, snapshot.myGroupId),
  );
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [submittingQuestion, setSubmittingQuestion] = useState<number | null>(
    null,
  );
  const states = answerStates(snapshot);


  function persistDrafts(
    update: (current: AnswerDraftMap) => AnswerDraftMap,
  ): void {
    setDrafts((current) => {
      const next = update(current);
      writeAnswerDrafts(snapshot.sessionId, snapshot.myGroupId, next);
      return next;
    });
  }

  function updateAnswer(
    question: StudentQuestion,
    blankIndex: number,
    value: string,
  ): void {
    persistDrafts((current) => {
      const existing = current[question.number];
      // 以空格數補滿空字串，避免先填後格時產生 sparse array：hole 經
      // JSON.stringify 會變 null，重新讀取時整題草稿會被驗證拒絕（T059）。
      const answers = question.blanks.map(
        (_blank, index) => existing?.[index] ?? '',
      );
      answers[blankIndex] = value;
      return { ...current, [question.number]: answers };
    });
    clearError(question.number);
  }

  function clearError(questionNumber: number): void {
    setErrors((current) => {
      if (!(questionNumber in current)) {
        return current;
      }
      const next = { ...current };
      delete next[questionNumber];
      return next;
    });
  }

  async function submit(question: StudentQuestion): Promise<void> {
    if (submittingQuestion !== null) {
      return;
    }

    const draftAnswers = question.blanks.map(
      (_blank, index) => drafts[question.number]?.[index] ?? '',
    );
    const missingBlanks = missingBlankTexts(question, draftAnswers);
    if (missingBlanks.length > 0) {
      setErrors((current) => ({
        ...current,
        [question.number]: `每個空格都要填寫答案；尚未填寫的空格：${missingBlanks.join('、')}`,
      }));
      return;
    }

    clearError(question.number);
    setSubmittingQuestion(question.number);

    try {
      const ack = await sendCommand('answer:submit', {
        questionNumber: question.number,
        answers: draftAnswers,
      });
      if (!ack.ok) {
        setErrors((current) => ({
          ...current,
          [question.number]: ack.error.message,
        }));
        return;
      }

      // 已送出的題目不再屬於「尚未送出草稿」；同一題送出前的舊草稿
      // 由伺服器快照負責顯示，不帶回作答區改寫。
      persistDrafts((current) => {
        const next = { ...current };
        delete next[question.number];
        return next;
      });
    } finally {
      setSubmittingQuestion(null);
    }
  }

  return (
    <section className={styles.area} aria-labelledby="answer-area-title">
      <h2 id="answer-area-title" className={styles.title}>
        作答區
      </h2>
      <p className={styles.description}>
        每一題填好答案後按送出，送出代表整組作答。
      </p>
      <ol className={styles.questions} aria-label="作答題目">
        {snapshot.questions.map((question) => {
          const myAnswer = states.get(question.number);
          const isSubmitted = myAnswer?.state === 'submitted';
          const isVoided = myAnswer?.state === 'voided';
          const isSubmitting = submittingQuestion === question.number;
          const draft = drafts[question.number] ?? [];
          const answers = isSubmitted
            ? (myAnswer?.answers ?? [])
            : draft;
          const error = errors[question.number];

          return (
            <li key={question.number} className={styles.questionItem}>
              <section
                className={styles.question}
                aria-labelledby={`question-${question.number}-title`}
              >
                <h3
                  id={`question-${question.number}-title`}
                  className={styles.questionTitle}
                >
                  第 {question.number} 題
                </h3>
                {question.prompt !== '' && (
                  <p className={styles.prompt}>{question.prompt}</p>
                )}
                {question.blanks.map((blank, index) => (
                  <label
                    key={blank.position}
                    className={styles.blank}
                    htmlFor={`answer-${question.number}-${blank.position}`}
                  >
                    <span className={styles.prefix}>
                      {blank.prefix === '' ? '答案' : blank.prefix}
                    </span>
                    <input
                      id={`answer-${question.number}-${blank.position}`}
                      className={styles.input}
                      type="text"
                      aria-label={inputLabel(question, blank.prefix)}
                      value={answers[index] ?? ''}
                      disabled={isSubmitted || isSubmitting}
                      readOnly={isSubmitted}
                      onChange={(event) => {
                        updateAnswer(question, index, event.currentTarget.value);
                      }}
                    />
                  </label>
                ))}
                {isSubmitted && (
                  <p className={styles.submitted} role="status">
                    本組已送出：{answers.join('、')}
                  </p>
                )}
                {isVoided && (
                  <p className={styles.submitted} role="status">
                    老師已作廢這一題的作答，請重新送出
                  </p>
                )}
                {error !== undefined && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}
                <button
                  className={styles.button}
                  type="button"
                  disabled={isSubmitted || submittingQuestion !== null}
                  onClick={() => {
                    void submit(question);
                  }}
                >
                  {isSubmitted
                    ? '已送出'
                    : isSubmitting
                      ? `送出第 ${question.number} 題中…`
                      : `送出第 ${question.number} 題`}
                </button>
              </section>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default AnswerArea;
