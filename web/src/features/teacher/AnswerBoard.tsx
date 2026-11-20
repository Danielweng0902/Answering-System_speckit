import { useI18n } from '../../lib/i18n/LanguageProvider';
import { useState } from 'react';
import type { AnswerBoardCell, TeacherSnapshot } from '@classroom/shared';
import { sendCommand } from '../../lib/socket';
import { QuestionNumber } from '../shared/QuestionNumber';
import styles from './AnswerBoard.module.css';

export type AnswerBoardProps = {
  snapshot: TeacherSnapshot;
};

type ActiveVoidConfirmation = {
  key: string;
  signature: string;
};

type ActiveVoidError = {
  message: string;
  signature: string;
};

function confirmationSignature(phase: TeacherSnapshot['phase'], cell: AnswerBoardCell): string {
  return JSON.stringify([phase, cell.state, cell.answers, cell.rank]);
}

/**
 * 題組（多空格）答案逐格顯示、以位置標示，順序即資料順序
 * （003 US5；T040；AC-003-25 老師側）。teacher 快照的 questions 是 002 的
 * QuestionSummary，只有 blankCount、沒有原始前綴，所以看板以
 * 「第 1 格」「第 2 格」等位置標示，不顯示原前綴。單題維持原樣。
 */
function CellAnswers({ label, answers }: { label: string; answers: AnswerBoardCell['answers'] }) {
  const { t } = useI18n();
  if (answers.length <= 1) {
    return (
      <span>
        {label}
        {answers.join('、')}
      </span>
    );
  }
  return (
    <>
      <span>{label}</span>
      {answers.map((answer, index) => (
        <span key={index} className={styles.blank}>
          {t('board.blank', { number: index + 1, answer })}
        </span>
      ))}
    </>
  );
}

/**
 * 老師作答看板與進度（003 US3；T032；AC-003-13–16、FR-019–FR-022）。
 * 題 × 組完整矩陣由伺服器快照直接渲染，前端不推測空缺；答案一律以
 * React 文字節點輸出，不做任何 HTML 解析（spec Edge Cases）。
 * 作廢操作（T053）只在 open 的有效作答顯示，並經確認／取消後才送指令。
 */
export function AnswerBoard({ snapshot }: AnswerBoardProps) {
  const { t } = useI18n();
  const groupNames = new Map(snapshot.groups.map((group) => [group.id, group.name]));
  const [confirmingCell, setConfirmingCell] = useState<ActiveVoidConfirmation | null>(null);
  const [voidingCell, setVoidingCell] = useState<string | null>(null);
  const [voidErrors, setVoidErrors] = useState<Record<string, ActiveVoidError>>({});

  function cellKey(cell: AnswerBoardCell): string {
    return `${String(cell.questionNumber)}:${cell.groupId}`;
  }

  function clearVoidError(key: string): void {
    setVoidErrors((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function confirmVoid(cell: AnswerBoardCell): Promise<void> {
    const key = cellKey(cell);
    if (voidingCell !== null) {
      return;
    }
    setVoidingCell(key);
    try {
      const ack = await sendCommand('answer:void', {
        groupId: cell.groupId,
        questionNumber: cell.questionNumber,
      });
      if (!ack.ok) {
        setVoidErrors((current) => ({
          ...current,
          [key]: {
            message: ack.error.message,
            signature: confirmationSignature(snapshot.phase, cell),
          },
        }));
      }
    } finally {
      setVoidingCell(null);
      setConfirmingCell(null);
    }
  }

  return (
    <section className={styles.board} aria-labelledby="answer-board-title">
      <h2 id="answer-board-title" className={styles.title}>
        {t('board.title')}
      </h2>
      <p className={styles.description}>{t('board.description')}</p>
      {snapshot.fairRankingEnabled && (
        <p className={styles.muted}>{t('board.fairNote')}</p>
      )}

      {snapshot.board.length === 0 ? (
        <p className={styles.empty}>{t('board.empty')}</p>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('board.colQuestion')}</th>
                  {snapshot.groups.map((group) => (
                    <th key={group.id} scope="col">
                      {group.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.board.map((question) => (
                  <tr key={question.questionNumber}>
                    <th scope="row" className={styles.questionCell}>
                      <QuestionNumber number={question.questionNumber} />
                    </th>
                    {question.cells.map((cell) => {
                      const key = cellKey(cell);
                      // 確認只對當初點開的同一份作答有效。cell 曾轉成其他
                      // 狀態、被別人變動或 phase 改變後，即使 key 一樣也不
                      // 能自動沿用舊確認（M5；T062）。
                      const currentSignature = confirmationSignature(snapshot.phase, cell);
                      const isCurrentConfirmation =
                        confirmingCell?.key === key &&
                        confirmingCell.signature === currentSignature;
                      const activeVoidError =
                        voidErrors[key]?.signature === currentSignature
                          ? voidErrors[key]
                          : undefined;
                      return (
                        <td key={cell.groupId} className={styles.cell}>
                          {cell.state === 'not_submitted' && (
                            <span className={styles.muted}>{t('board.notSubmitted')}</span>
                          )}
                          {cell.state === 'submitted' && (
                            <>
                              <CellAnswers label={t('board.submitted')} answers={cell.answers} />
                              {cell.rank !== null && (
                                <span className={styles.muted}>
                                  {t('board.rank', { rank: cell.rank })}
                                </span>
                              )}
                              {question.settling ? (
                                <span className={styles.muted}>{t('board.settling')}</span>
                              ) : (
                                question.winnerGroupId === cell.groupId && (
                                  <span className={styles.winner}>{t('board.winner')}</span>
                                )
                              )}
                              {question.fairnessApplied && (
                                <span className={styles.muted}>{t('board.fairnessAdjusted')}</span>
                              )}
                              {snapshot.phase === 'open' &&
                                (isCurrentConfirmation ? (
                                  <div className={styles.voidActions}>
                                    <button
                                      className={styles.voidButton}
                                      type="button"
                                      disabled={voidingCell !== null}
                                      onClick={() => {
                                        void confirmVoid(cell);
                                      }}
                                    >
                                      {voidingCell === key
                                        ? t('board.voiding')
                                        : t('board.voidConfirm')}
                                    </button>
                                    <button
                                      className={styles.voidButton}
                                      type="button"
                                      disabled={voidingCell !== null}
                                      onClick={() => {
                                        setConfirmingCell(null);
                                      }}
                                    >
                                      {t('board.cancel')}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    className={styles.voidButton}
                                    type="button"
                                    onClick={() => {
                                      clearVoidError(key);
                                      setConfirmingCell({
                                        key,
                                        signature: confirmationSignature(snapshot.phase, cell),
                                      });
                                    }}
                                  >
                                    {t('board.void')}
                                  </button>
                                ))}
                            </>
                          )}
                          {cell.state === 'voided' && (
                            <>
                              <CellAnswers label={t('board.voided')} answers={cell.answers} />
                              {cell.rank !== null && (
                                <span className={styles.muted}>
                                  {t('board.formerRank', { rank: cell.rank })}
                                </span>
                              )}
                            </>
                          )}
                          {activeVoidError !== undefined && (
                            <p className={styles.voidError} role="alert">
                              {activeVoidError.message}
                            </p>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className={styles.progress} aria-labelledby="answer-progress-title">
            <h3 id="answer-progress-title" className={styles.progressTitle}>
              {t('board.progressTitle')}
            </h3>
            <ul className={styles.progressList} aria-label={t('board.progressListLabel')}>
              {snapshot.progress.perQuestion.map((entry) => (
                <li key={entry.questionNumber}>
                  {t('board.progressEntry', {
                    number: entry.questionNumber,
                    count: entry.submittedGroupCount,
                  })}
                </li>
              ))}
            </ul>
            <ul className={styles.progressList} aria-label={t('board.byGroupListLabel')}>
              {snapshot.progress.perGroup.map((entry) => (
                <li key={entry.groupId}>
                  {t('board.byGroupEntry', {
                    group: groupNames.get(entry.groupId) ?? entry.groupId,
                    count: entry.submittedQuestionCount,
                  })}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}

export default AnswerBoard;
