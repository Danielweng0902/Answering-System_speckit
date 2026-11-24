import type {
  ErrorCode,
  ImportSummary,
  ImportSummaryQuestion,
  ImportWarning,
  TeacherSnapshot,
} from '@classroom/shared';
import { useI18n } from '../../lib/i18n/LanguageProvider';
import type { Language } from '../../lib/i18n/language';
import type { MessageKey } from '../../lib/i18n/messages';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { importFromFile, importFromLink, type ImportQuestionsResult } from '../../lib/api';
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
const FILE_ERROR_CODES: readonly ErrorCode[] = ['FILE_INVALID', 'FILE_TOO_LARGE'];

const QUESTION_KIND_KEYS: Record<ImportSummaryQuestion['kind'], MessageKey> = {
  single: 'import.kindSingle',
  group: 'import.kindGroup',
};

type Translate = ReturnType<typeof useI18n>['t'];

/**
 * 匯入警告的顯示文字。
 *
 * - **中文版直接用伺服器的 `message`**：那是權威措辭（伺服器改了措辭，
 *   中文版自動跟上）。
 * - **英文版用結構化資料翻譯**：伺服器給的警告是結構化的
 *   （`code` ＋ 題號／儲存格／工作表名），所以客戶端翻譯即可，
 *   **不必改 API 契約**（2026-11-19 review：匯入警告在英文版沒翻譯）。
 */
function importWarningText(t: Translate, warning: ImportWarning, language: Language): string {
  if (language !== 'en') {
    return warning.message;
  }
  if (warning.code === 'NUMBERS_NOT_SEQUENTIAL') {
    return t('import.warningNumbersNotSequential', {
      numbers: warning.numbers.join('、'),
    });
  }
  if (warning.code === 'BLANK_HAS_CONTENT') {
    return t('import.warningBlankHasContent', {
      number: warning.number,
      cell: warning.cell,
    });
  }
  return t('import.warningMultipleSheets', { name: warning.sheetName });
}

function questionBlankText(t: Translate, question: ImportSummaryQuestion): string {
  return t('import.kindDetail', {
    kind: t(QUESTION_KIND_KEYS[question.kind]),
    blanks: question.blankCount,
  });
}

/** 學習單讀取、摘要顯示與確認；只有確認才會送出題目變更指令。 */
export function QuestionImport({ snapshot }: QuestionImportProps) {
  const { t, language } = useI18n();
  const linkId = useId();
  const fileId = useId();
  const [link, setLink] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);
  const [isSending, setIsSending] = useState(false);
  /** 自製檔案按鈕旁的檔名；原生 input 的「未選擇任何檔案」是瀏覽器文字，翻譯不到。 */
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const isPreparing = snapshot.phase === 'preparing';
  const controlsDisabled = !isPreparing || isSending;

  async function readImport(request: () => Promise<ImportQuestionsResult>): Promise<void> {
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
      setSelectedFileName(null);
      return;
    }

    // 自製按鈕旁的檔名文字（走 i18n；原生 input 的「未選擇任何檔案」是
    // 瀏覽器文字，無法翻譯 → 2026-11-23 的 007 人工驗證發現）。
    setSelectedFileName(file.name);

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
    <section className={styles.section} aria-label={t('import.title')} aria-busy={isSending}>
      <h2 className={styles.title}>{t('import.title')}</h2>
      {importError !== null && (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>{importError.message}</p>
          {importError.code !== null && LINK_ERROR_CODES.includes(importError.code) && (
            <ul className={styles.errorHints} aria-label={t('import.alternativesLabel')}>
              <li>{t('import.alternativeShare')}</li>
              <li>{t('import.alternativeDownload')}</li>
            </ul>
          )}
          {importError.code !== null && FILE_ERROR_CODES.includes(importError.code) && (
            <p className={styles.errorHint}>{t('import.formatHint')}</p>
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
        <button className={styles.button} type="submit" disabled={controlsDisabled}>
          {t('import.read')}
        </button>
      </form>

      <div className={styles.field}>
        {/*
          這裡是 <span> 不是 <label>：自製按鈕（下面的 .fileButton）已經用
          <label htmlFor> 指向那個 input，再多一個 label 指向同一個 input
          會讓螢幕閱讀器把兩個名稱串起來（「上傳 xlsx 檔 選擇檔案」）。
          input 自己帶 aria-label → 它的可存取名稱清楚。
        */}
        <span className={styles.label}>{t('import.fileLabel')}</span>
        {/*
          2026-11-23（007 人工驗證，Philip 在 Windows + Chrome 實測）：
          原生 `<input type="file">` 的「選擇檔案」「未選擇任何檔案」是
          **瀏覽器自己畫的字**，跟著 Chrome 的介面語言，不跟網頁的語言切換
          —— 網頁切成英文時這一區仍是中文，介面中英混雜。

          所以把原生 input 視覺隱藏（但仍可 Tab 聚焦、仍能被螢幕閱讀器讀到），
          另做一個走 i18n 的自製按鈕（<label htmlFor>）與檔名文字。
        */}
        <input
          id={fileId}
          className={styles.fileInputHidden}
          type="file"
          name="guided-notes-file"
          accept=".xlsx"
          aria-label={t('import.fileLabel')}
          disabled={controlsDisabled}
          onChange={readFile}
        />
        <div className={styles.filePicker}>
          <label className={styles.fileButton} htmlFor={fileId}>
            {t('import.chooseFile')}
          </label>
          <span className={styles.fileName}>
            {selectedFileName === null
              ? t('import.noFileSelected')
              : t('import.selectedFile', { name: selectedFileName })}
          </span>
        </div>
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
                        .map((blank) => (blank.prefix === '' ? t('import.noPrefix') : blank.prefix))
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
                  <li key={`${warning.code}-${index}`}>
                    {importWarningText(t, warning, language)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.replacesExisting && <p className={styles.notice}>{t('import.replaceNotice')}</p>}

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
