import type {
  ErrorCode,
  ImportSummary,
  ImportSummaryQuestion,
  TeacherSnapshot,
} from '@classroom/shared';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  importFromFile,
  importFromLink,
  type ImportQuestionsResult,
} from '../../lib/api';
import { sendCommand } from '../../lib/socket';
import styles from './QuestionImport.module.css';

export type QuestionImportProps = {
  snapshot: TeacherSnapshot;
};

type ImportError = { code: ErrorCode | null; message: string };

/** 依 contracts/http-api.md：連結類錯誤附帶兩個替代做法。 */
const LINK_ERROR_CODES: readonly ErrorCode[] = [
  'LINK_INVALID',
  'LINK_NOT_SHARED',
  'LINK_UNREACHABLE',
];

/** 依 contracts/http-api.md：檔案類錯誤說明可接受的格式與大小。 */
const FILE_ERROR_CODES: readonly ErrorCode[] = [
  'FILE_INVALID',
  'FILE_TOO_LARGE',
];

const QUESTION_KIND_LABELS: Record<ImportSummaryQuestion['kind'], string> = {
  single: '單題',
  group: '題組',
};

function questionBlankText(question: ImportSummaryQuestion): string {
  return `${QUESTION_KIND_LABELS[question.kind]}，${question.blankCount} 個空格`;
}

/** 學習單讀取、摘要顯示與確認；只有確認才會送出題目變更指令。 */
export function QuestionImport({ snapshot }: QuestionImportProps) {
  const linkId = useId();
  const fileId = useId();
  const [link, setLink] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);
  const [isSending, setIsSending] = useState(false);

  const isPreparing = snapshot.phase === 'preparing';
  const controlsDisabled = !isPreparing || isSending;

  async function readImport(
    request: () => Promise<ImportQuestionsResult>,
  ): Promise<void> {
    setSummary(null);
    setImportError(null);
    setIsSending(true);

    try {
      const result = await request();

      if (result.ok) {
        setSummary(result.summary);
      } else {
        setImportError(result.error);
      }
    } finally {
      setIsSending(false);
    }
  }

  function readLink(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void readImport(() => importFromLink(link));
  }

  function readFile(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (file === undefined) {
      return;
    }

    // 清除 input 讓同一個檔案可以連續選取（例如取消後重新讀取）。
    input.value = '';
    void readImport(() => importFromFile(file));
  }

  async function confirmImport(): Promise<void> {
    if (summary === null) {
      return;
    }

    setImportError(null);
    setIsSending(true);

    try {
      const ack = await sendCommand('questions:confirm', {
        importId: summary.importId,
      });

      if (ack.ok) {
        setSummary(null);
        setLink('');
      } else {
        setImportError(ack.error);
      }
    } finally {
      setIsSending(false);
    }
  }

  function cancelImport(): void {
    setSummary(null);
    setImportError(null);
  }

  const groupNumbers = (summary?.questions ?? [])
    .filter((question) => question.kind === 'group')
    .map((question) => question.number);

  return (
    <section
      className={styles.section}
      aria-label="匯入學習單"
      aria-busy={isSending}
    >
      <h2 className={styles.title}>匯入學習單</h2>
      {importError !== null && (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>{importError.message}</p>
          {importError.code !== null &&
            LINK_ERROR_CODES.includes(importError.code) && (
              <ul className={styles.errorHints} aria-label="其他做法">
                <li>把共用設定改成知道連結者可檢視</li>
                <li>下載成 xlsx 後上傳</li>
              </ul>
            )}
          {importError.code !== null &&
            FILE_ERROR_CODES.includes(importError.code) && (
              <p className={styles.errorHint}>
                請使用 xlsx 格式、5 MB 以內的學習單
              </p>
            )}
        </div>
      )}

      <form className={styles.form} onSubmit={readLink}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={linkId}>
            Google 試算表連結
          </label>
          <input
            id={linkId}
            className={styles.input}
            type="url"
            name="google-sheets-link"
            value={link}
            disabled={controlsDisabled}
            onChange={(event) => {
              setLink(event.target.value);
            }}
          />
        </div>
        <button
          className={styles.button}
          type="submit"
          disabled={controlsDisabled}
        >
          讀取
        </button>
      </form>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fileId}>
          上傳 xlsx 檔
        </label>
        <input
          id={fileId}
          className={styles.fileInput}
          type="file"
          name="guided-notes-file"
          accept=".xlsx"
          disabled={controlsDisabled}
          onChange={readFile}
        />
      </div>

      {summary !== null && (
        <section className={styles.summary} aria-label="匯入摘要">
          <h3 className={styles.summaryTitle}>匯入摘要</h3>
          <p className={styles.text}>{`工作表：${summary.sheetName}`}</p>
          <p className={styles.text}>
            {`共 ${summary.questionCount} 題、${summary.blankCount} 個空格`}
          </p>

          <ul className={styles.list} aria-label="摘要題目清單">
            {summary.questions.map((question) => (
              <li key={question.number}>
                {`第 ${question.number} 題（${questionBlankText(question)}）`}
                {question.kind === 'group' && (
                  <span className={styles.prefixes}>
                    {`前綴：${question.blanks
                      .map((blank) =>
                        blank.prefix === '' ? '（無前綴）' : blank.prefix,
                      )
                      .join('、')}`}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {groupNumbers.length > 0 && (
            <p className={styles.text}>{`第 ${groupNumbers.join('、')} 題是題組`}</p>
          )}

          {summary.warnings.length > 0 && (
            <div className={styles.warnings}>
              <h4 className={styles.warningsTitle}>提醒事項</h4>
              <ul className={styles.list} aria-label="提醒事項">
                {summary.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${index}`}>{warning.message}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.replacesExisting && (
            <p className={styles.notice}>確認後會取代現有題目</p>
          )}

          <div className={styles.actions}>
            <button
              className={styles.button}
              type="button"
              disabled={controlsDisabled}
              onClick={() => {
                void confirmImport();
              }}
            >
              確認匯入
            </button>
            <button
              className={styles.button}
              type="button"
              disabled={controlsDisabled}
              onClick={cancelImport}
            >
              取消
            </button>
          </div>
        </section>
      )}
    </section>
  );
}

export default QuestionImport;
