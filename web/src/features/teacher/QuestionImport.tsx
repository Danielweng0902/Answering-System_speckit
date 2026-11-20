import type {
  ErrorCode,
  ImportSummary,
  ImportSummaryQuestion,
  TeacherSnapshot,
} from '@classroom/shared';
import { useI18n } from '../../lib/i18n/LanguageProvider';
import type { MessageKey } from '../../lib/i18n/messages';
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

const QUESTION_KIND_KEYS: Record<ImportSummaryQuestion['kind'], MessageKey> = {
  single: 'import.kindSingle',
  group: 'import.kindGroup',
};

type Translate = ReturnType<typeof useI18n>['t'];

function questionBlankText(t: Translate, question: ImportSummaryQuestion): string {
  return t('import.kindDetail', {
    kind: t(QUESTION_KIND_KEYS[question.kind]),
    blanks: question.blankCount,
  });
}

/** 學習單讀取、摘要顯示與確認；只有確認才會送出題目變更指令。 */
export function QuestionImport({ snapshot }: QuestionImportProps) {
  const { t } = useI18n();
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
      aria-label={t('import.title')}
      aria-busy={isSending}
    >
      <h2 className={styles.title}>{t('import.title')}</h2>
      {importError !== null && (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>{importError.message}</p>
          {importError.code !== null &&
            LINK_ERROR_CODES.includes(importError.code) && (
              <ul className={styles.errorHints} aria-label={t('import.alternativesLabel')}>
                <li>{t('import.alternativeShare')}</li>
                <li>{t('import.alternativeDownload')}</li>
              </ul>
            )}
          {importError.code !== null &&
            FILE_ERROR_CODES.includes(importError.code) && (
              <p className={styles.errorHint}>
                {t('import.formatHint')}
              </p>
            )}
        </div>
      )}

      <form className={styles.form} onSubmit={readLink}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={linkId}>
            {t('import.linkLabel')}
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
          {t('import.read')}
        </button>
      </form>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fileId}>
          {t('import.fileLabel')}
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
        <section className={styles.summary} aria-label={t('import.summaryTitle')}>
          <h3 className={styles.summaryTitle}>{t('import.summaryTitle')}</h3>
          <p className={styles.text}>{t('import.sheet', { name: summary.sheetName })}</p>
          <p className={styles.text}>
            {t('import.counts', {
              questions: summary.questionCount,
              blanks: summary.blankCount,
            })}
          </p>

          <ul className={styles.list} aria-label={t('import.questionListLabel')}>
            {summary.questions.map((question) => (
              <li key={question.number}>
                {t('import.questionItem', {
                  number: question.number,
                  detail: questionBlankText(t, question),
                })}
                {question.kind === 'group' && (
                  <span className={styles.prefixes}>
                    {t('import.prefix', {
                      prefixes: question.blanks
                        .map((blank) =>
                          blank.prefix === '' ? t('import.noPrefix') : blank.prefix,
                        )
                        .join('、'),
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {groupNumbers.length > 0 && (
            <p className={styles.text}>
              {t('import.groupNotice', { numbers: groupNumbers.join('、') })}
            </p>
          )}

          {summary.warnings.length > 0 && (
            <div className={styles.warnings}>
              <h4 className={styles.warningsTitle}>{t('import.warningsTitle')}</h4>
              <ul className={styles.list} aria-label={t('import.warningsTitle')}>
                {summary.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${index}`}>{warning.message}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.replacesExisting && (
            <p className={styles.notice}>{t('import.replaceNotice')}</p>
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
              {t('import.confirm')}
            </button>
            <button
              className={styles.button}
              type="button"
              disabled={controlsDisabled}
              onClick={cancelImport}
            >
              {t('import.cancel')}
            </button>
          </div>
        </section>
      )}
    </section>
  );
}

export default QuestionImport;
