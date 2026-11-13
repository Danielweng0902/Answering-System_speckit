import { useState } from 'react';
import type { AnswerBoardCell, TeacherSnapshot } from '@classroom/shared';
import { sendCommand } from '../../lib/socket';
import styles from './AnswerBoard.module.css';

export type AnswerBoardProps = {
  snapshot: TeacherSnapshot;
};

/**
 * 題組（多空格）答案逐格顯示、以位置標示，順序即資料順序
 * （003 US5；T040；AC-003-25 老師側）。teacher 快照的 questions 是 002 的
 * QuestionSummary，只有 blankCount、沒有原始前綴，所以看板以
 * 「第 1 格」「第 2 格」等位置標示，不顯示原前綴。單題維持原樣。
 */
function CellAnswers({
  label,
  answers,
}: {
  label: string;
  answers: AnswerBoardCell['answers'];
}) {
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
          第 {index + 1} 格：{answer}
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
  const groupNames = new Map(
    snapshot.groups.map((group) => [group.id, group.name]),
  );
  const [confirmingCell, setConfirmingCell] = useState<string | null>(null);
  const [voidingCell, setVoidingCell] = useState<string | null>(null);
  const [voidErrors, setVoidErrors] = useState<Record<string, string>>({});

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
          [key]: ack.error.message,
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
        作答看板
      </h2>
      <p className={styles.description}>
        每一題、每一組的送出狀態、答案與順位；搶答中即時更新。
      </p>

      {snapshot.board.length === 0 ? (
        <p className={styles.empty}>
          尚未匯入題目，看板會在匯入後顯示每題各組的作答狀態。
        </p>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">題目</th>
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
                    <th scope="row">第 {question.questionNumber} 題</th>
                    {question.cells.map((cell) => {
                      const key = cellKey(cell);
                      return (
                        <td key={cell.groupId} className={styles.cell}>
                          {cell.state === 'not_submitted' && (
                            <span className={styles.muted}>未送出</span>
                          )}
                          {cell.state === 'submitted' && (
                            <>
                              <CellAnswers
                                label="已送出："
                                answers={cell.answers}
                              />
                              {cell.rank !== null && (
                                <span className={styles.muted}>
                                  第 {cell.rank} 順位
                                </span>
                              )}
                              {question.winnerGroupId === cell.groupId && (
                                <span className={styles.winner}>搶答成功</span>
                              )}
                              {snapshot.phase === 'open' &&
                                (confirmingCell === key ? (
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
                                        ? '作廢中…'
                                        : '確認作廢'}
                                    </button>
                                    <button
                                      className={styles.voidButton}
                                      type="button"
                                      disabled={voidingCell !== null}
                                      onClick={() => {
                                        setConfirmingCell(null);
                                      }}
                                    >
                                      取消
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    className={styles.voidButton}
                                    type="button"
                                    onClick={() => {
                                      clearVoidError(key);
                                      setConfirmingCell(key);
                                    }}
                                  >
                                    作廢
                                  </button>
                                ))}
                            </>
                          )}
                          {cell.state === 'voided' && (
                            <>
                              <CellAnswers
                                label="已作廢："
                                answers={cell.answers}
                              />
                              {cell.rank !== null && (
                                <span className={styles.muted}>
                                  原第 {cell.rank} 順位
                                </span>
                              )}
                            </>
                          )}
                          {voidErrors[key] !== undefined && (
                            <p className={styles.voidError} role="alert">
                              {voidErrors[key]}
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

          <section
            className={styles.progress}
            aria-labelledby="answer-progress-title"
          >
            <h3 id="answer-progress-title" className={styles.progressTitle}>
              作答進度
            </h3>
            <ul
              className={styles.progressList}
              aria-label="每一題已送出的組數"
            >
              {snapshot.progress.perQuestion.map((entry) => (
                <li key={entry.questionNumber}>
                  第 {entry.questionNumber} 題：
                  {entry.submittedGroupCount} 組送出
                </li>
              ))}
            </ul>
            <ul
              className={styles.progressList}
              aria-label="每一組已送出的題數"
            >
              {snapshot.progress.perGroup.map((entry) => (
                <li key={entry.groupId}>
                  {groupNames.get(entry.groupId) ?? entry.groupId}：已送出{' '}
                  {entry.submittedQuestionCount} 題
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
