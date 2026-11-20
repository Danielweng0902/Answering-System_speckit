import { useRef, useState } from 'react';
import type { StudentOpenAnswer, StudentOpenSnapshot, StudentQuestion } from '@classroom/shared';
import { useI18n } from '../../lib/i18n/LanguageProvider';
import { sendCommand } from '../../lib/socket';
import { QuestionNumber } from '../shared/QuestionNumber';
import { activateDraftSession, writeAnswerDrafts, type AnswerDraftMap } from './answerDrafts';
import styles from './AnswerArea.module.css';

export type AnswerAreaProps = {
  snapshot: StudentOpenSnapshot;
};

/** 答案字數上限，與伺服器驗證一致（003 FR-023：每格 1–200 字）。 */
const MAX_ANSWER_LENGTH = 200;

type AnswerStateByQuestion = Map<number, StudentOpenAnswer>;

function answerStates(snapshot: StudentOpenSnapshot): AnswerStateByQuestion {
  return new Map(snapshot.myAnswers.map((answer) => [answer.questionNumber, answer]));
}

type Translate = ReturnType<typeof useI18n>['t'];

function inputLabel(t: Translate, question: StudentQuestion, prefix: string): string {
  return prefix === ''
    ? t('answer.inputLabel', { number: question.number })
    : t('answer.inputLabelWithPrefix', { number: question.number, prefix });
}

/**
 * 錯誤訊息用的空格標示（2026-11-18 兩組同意，採 003 人工驗證建議 1）：
 * 單題寫「答案」、題組寫「第（2）格」，讓訊息短又不會分不出是哪一格。
 */
function blankLabel(t: Translate, prefix: string): string {
  return prefix === '' ? t('answer.label') : t('answer.blankLabel', { prefix });
}

function missingBlankLabels(
  t: Translate,
  question: StudentQuestion,
  draftAnswers: string[],
): string[] {
  return question.blanks.flatMap((blank, index) =>
    (draftAnswers[index] ?? '').trim() === '' ? [blankLabel(t, blank.prefix)] : [],
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
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<AnswerDraftMap>(() =>
    activateDraftSession(snapshot.sessionId, snapshot.myGroupId),
  );
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [submittingQuestion, setSubmittingQuestion] = useState<number | null>(null);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const states = answerStates(snapshot);

  /** 聚焦該題第一個還沒填的欄位（送出失敗時使用）。 */
  function focusFirstEmptyBlank(question: StudentQuestion, answers: readonly string[]): void {
    const emptyIndex = answers.findIndex((answer) => answer.trim() === '');
    if (emptyIndex < 0) {
      return;
    }
    const blank = question.blanks[emptyIndex];
    if (blank === undefined) {
      return;
    }
    inputRefs.current.get(`${question.number}-${blank.position}`)?.focus();
  }

  function persistDrafts(update: (current: AnswerDraftMap) => AnswerDraftMap): void {
    setDrafts((current) => {
      const next = update(current);
      writeAnswerDrafts(snapshot.sessionId, snapshot.myGroupId, next);
      return next;
    });
  }

  function updateAnswer(question: StudentQuestion, blankIndex: number, value: string): void {
    persistDrafts((current) => {
      const existing = current[question.number];
      // 以空格數補滿空字串，避免先填後格時產生 sparse array：hole 經
      // JSON.stringify 會變 null，重新讀取時整題草稿會被驗證拒絕（T059）。
      const answers = question.blanks.map((_blank, index) => existing?.[index] ?? '');
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
    const missingBlanks = missingBlankLabels(t, question, draftAnswers);
    if (missingBlanks.length > 0) {
      setErrors((current) => ({
        ...current,
        [question.number]: t('answer.empty', { blanks: missingBlanks.join('、') }),
      }));
      // 送出失敗後把焦點移到第一個沒填的欄位，讓鍵盤與螢幕閱讀器使用者
      // 不用自己找（Modern Web Guidance：送出失敗後聚焦第一個無效欄位）。
      focusFirstEmptyBlank(question, draftAnswers);
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
        {t('answer.title')}
      </h2>
      <p className={styles.description}>{t('answer.description')}</p>
      <ol className={styles.questions} aria-label={t('answer.listLabel')}>
        {snapshot.questions.map((question) => {
          const myAnswer = states.get(question.number);
          const isSubmitted = myAnswer?.state === 'submitted';
          const isVoided = myAnswer?.state === 'voided';
          const isSubmitting = submittingQuestion === question.number;
          const draft = drafts[question.number] ?? [];
          const answers = isSubmitted ? (myAnswer?.answers ?? []) : draft;
          const error = errors[question.number];

          return (
            <li key={question.number} className={styles.questionItem}>
              <section
                className={styles.question}
                aria-labelledby={`question-${question.number}-title`}
              >
                <h3 id={`question-${question.number}-title`} className={styles.questionTitle}>
                  {/* 語意標籤只給螢幕閱讀器；視覺上是 Q1／Q2。 */}
                  <QuestionNumber number={question.number} />
                </h3>
                {/* 內容固定在右欄：題號欄不會被內容擠開（2026-11-19 review）。 */}
                <div className={styles.questionBody}>
                {question.prompt !== '' && <p className={styles.prompt}>{question.prompt}</p>}
                {question.blanks.map((blank, index) => {
                  const answerText = answers[index] ?? '';
                  const nextEmptyIndex = question.blanks.findIndex(
                    (_candidate, candidateIndex) =>
                      candidateIndex > index && (draft[candidateIndex] ?? '').trim() === '',
                  );
                  const allFilled = question.blanks.every(
                    (_candidate, candidateIndex) => (draft[candidateIndex] ?? '').trim() !== '',
                  );
                  return (
                    <label
                      key={blank.position}
                      className={styles.blank}
                      htmlFor={`answer-${question.number}-${blank.position}`}
                    >
                      <span className={styles.prefix}>
                        {blank.prefix === '' ? t('answer.label') : blank.prefix}
                      </span>
                      <input
                        id={`answer-${question.number}-${blank.position}`}
                        className={styles.input}
                        type="text"
                        aria-label={inputLabel(t, question, blank.prefix)}
                        value={answerText}
                        disabled={isSubmitted || isSubmitting}
                        readOnly={isSubmitted}
                        // 答案上限與伺服器一致（003 FR-023：每格 1–200 字），
                        // 先在輸入端擋住超長，伺服器仍會再驗一次。
                        maxLength={MAX_ANSWER_LENGTH}
                        // 學生的答案是簡答（多為中文），關閉拼字檢查避免紅線。
                        spellCheck={false}
                        // 行動鍵盤的送出鍵：還有空格沒填是「下一個」，
                        // 全部填完才是「傳送」（2026-11-18 人工驗證建議）。
                        enterKeyHint={allFilled ? 'send' : 'next'}
                        ref={(element) => {
                          if (element === null) {
                            inputRefs.current.delete(`${question.number}-${blank.position}`);
                            return;
                          }
                          inputRefs.current.set(`${question.number}-${blank.position}`, element);
                        }}
                        onChange={(event) => {
                          updateAnswer(question, index, event.currentTarget.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') {
                            return;
                          }
                          // 中文輸入法（IME）組字／選字時的 Enter 是「選字」，
                          // 不能當成送出；`isComposing` 是標準訊號，`keyCode 229`
                          // 補上 Safari 的事件順序問題（Modern Web Guidance 的
                          // ime-safe-enter-submit：兩個訊號任一個成立就略過）。
                          const native = event.nativeEvent;
                          if (native.isComposing || native.keyCode === 229) {
                            return;
                          }
                          event.preventDefault();
                          // 還有後面的空格沒填 → 只移到下一格，不送出也不
                          // 顯示錯誤（2026-11-18 人工驗證建議：學生用 Enter
                          // 跳下一格時不該像被罵）。
                          if (nextEmptyIndex >= 0) {
                            const nextBlank = question.blanks[nextEmptyIndex];
                            if (nextBlank !== undefined) {
                              inputRefs.current
                                .get(`${question.number}-${nextBlank.position}`)
                                ?.focus();
                            }
                            return;
                          }
                          void submit(question);
                        }}
                      />
                      {/* 貼上超過 200 字會被截斷，顯示字數讓學生看得到
                          （2026-11-18 人工驗證建議）。 */}
                      {!isSubmitted && (
                        <span className={styles.counter}>
                          {`${String(answerText.length)}／${String(MAX_ANSWER_LENGTH)}`}
                        </span>
                      )}
                    </label>
                  );
                })}
                {isSubmitted && (
                  <p className={styles.submitted} role="status">
                    {t('answer.submitted', { answers: answers.join('、') })}
                  </p>
                )}
                {isVoided && (
                  <p className={styles.submitted} role="status">
                    {t('answer.voided')}
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
                  {/*
                   * 可讀名稱維持中文「送出第 N 題」，視覺上是「送出 Q N」；
                   * 已送出的狀態文字則原樣顯示（螢幕閱讀器讀「已送出」）。
                   */}
                  {isSubmitted ? (
                    t('answer.buttonSubmitted')
                  ) : isSubmitting ? (
                    <>
                      <span className="visually-hidden">
                        {t('answer.buttonSending', { number: question.number })}
                      </span>
                      <span aria-hidden="true">
                        {t('answer.buttonSendingVisible', { number: question.number })}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="visually-hidden">
                        {t('answer.buttonSubmit', { number: question.number })}
                      </span>
                      <span aria-hidden="true">
                        {t('answer.buttonSubmitVisible', { number: question.number })}
                      </span>
                    </>
                  )}
                </button>
                </div>
              </section>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default AnswerArea;
