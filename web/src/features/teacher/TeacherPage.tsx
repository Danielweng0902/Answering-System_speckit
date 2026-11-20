import { useI18n } from '../../lib/i18n/LanguageProvider';
import type { Snapshot } from '@classroom/shared';
import { useState } from 'react';
import {
  downloadGuidedNotes,
  downloadResultCsv,
  writeBackGuidedNotes,
  type DownloadExportResult,
} from '../../lib/api';
import { Countdown } from '../shared/Countdown';
import { LanguageSwitch } from '../shared/LanguageSwitch';
import { sendCommand } from '../../lib/socket';
import { AnswerBoard } from './AnswerBoard';
import { GroupManager } from './GroupManager';
import { PhaseControl } from './PhaseControl';
import { QuestionImport } from './QuestionImport';
import { QuestionList } from './QuestionList';
import { TeacherLogin } from './TeacherLogin';
import styles from './TeacherPage.module.css';

export type TeacherPageProps = {
  snapshot: Snapshot | null;
};

export function TeacherPage({ snapshot }: TeacherPageProps) {
  const { t } = useI18n();
  const [isAwaitingTeacherSnapshot, setIsAwaitingTeacherSnapshot] =
    useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [isWritingBack, setIsWritingBack] = useState(false);
  const [writeBackMessage, setWriteBackMessage] = useState<string | null>(null);
  const [writeBackError, setWriteBackError] = useState<string | null>(null);

  /**
   * 006 T022（人工驗證建議 2）：階段改變、重設活動或重新匯入時，
   * 上一次的寫回／揭曉訊息要清掉，否則老師會誤以為這場也失敗。
   * 用「render 期間調整 state」而不是 effect，避免多一次渲染與多餘的 effect。
   */
  const activityKey = `${snapshot?.phase ?? 'none'}:${
    snapshot?.role === 'teacher' ? (snapshot.guidedNotes?.importedAt ?? '') : ''
  }`;
  const [previousActivityKey, setPreviousActivityKey] = useState(activityKey);
  if (previousActivityKey !== activityKey) {
    setPreviousActivityKey(activityKey);
    setWriteBackMessage(null);
    setWriteBackError(null);
    setRevealError(null);
  }

  /**
   * 006：把答案寫回老師的線上 Google 試算表。失敗時保留伺服器的訊息，
   * 老師可以改用「匯出 Guided Notes」下載 xlsx。
   *
   * 寫回前伺服器會重新讀取線上試算表並使用「現在」的座標，所以位置被挪動
   * 也能正確寫入；只有題目真的改動或讀不到試算表時才會失敗（此時請改用
   * 「匯出 Guided Notes」下載 xlsx，2026-11-19 review）。
   */
  async function handleWriteBack(): Promise<void> {
    setWriteBackMessage(null);
    setWriteBackError(null);
    setIsWritingBack(true);
    try {
      const result = await writeBackGuidedNotes();
      if (!result.ok) {
        setWriteBackError(result.error.message);
        return;
      }
      setWriteBackMessage(
        result.writtenCells === 0
          ? t('teacher.writeBackNone')
          : result.remapped
            // 成功訊息只講「這次做了什麼」；「沒人作答的題目不會被清除」是
            // 使用限制，寫在 quickstart，不要每次都跳出來（2026-11-19 review：
            // 每次都出現容易讓老師誤以為有殘留或系統沒清除成功）。
            ? t('teacher.writeBackRemapped', { count: result.writtenCells })
            : t('teacher.writeBackDone', { count: result.writtenCells }),
      );
    } finally {
      setIsWritingBack(false);
    }
  }

  /** 005（FR-017）：逐題揭曉或全部揭曉；失敗顯示伺服器的中文訊息。 */
  async function sendReveal(
    event: 'reveal:next' | 'reveal:all',
  ): Promise<void> {
    setRevealError(null);
    setIsRevealing(true);
    try {
      const ack = await sendCommand(event, {});
      if (!ack.ok) {
        setRevealError(ack.error.message);
      }
    } finally {
      setIsRevealing(false);
    }
  }

  if (snapshot?.role !== 'teacher') {
    return (
      <section className={styles.page} aria-labelledby="teacher-page-title">
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <h1 id="teacher-page-title" className={styles.title}>
              {t('teacher.title')}
            </h1>
            <LanguageSwitch />
          </div>
        </header>
        <TeacherLogin
          onLoginSuccess={() => {
            setIsAwaitingTeacherSnapshot(true);
          }}
        />
        {isAwaitingTeacherSnapshot && (
          <p className={styles.notice} role="status">
            {t('teacher.loginPending')}
          </p>
        )}
      </section>
    );
  }

  async function handleExport(
    download: () => Promise<DownloadExportResult>,
  ): Promise<void> {
    setIsExporting(true);
    setExportError(null);
    try {
      const result = await download();
      if (!result.ok) {
        setExportError(result.error.message);
        return;
      }

      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.fileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className={styles.page} aria-labelledby="teacher-page-title">
      <header className={styles.header}>
        {/* 標題與語言切換同一列，切換器靠右（2026-11-20 review）。 */}
        <div className={styles.headerTop}>
          <h1 id="teacher-page-title" className={styles.title}>
            {t('teacher.title')}
          </h1>
          <LanguageSwitch />
        </div>
      </header>
      <PhaseControl snapshot={snapshot} />
      {snapshot.phase === 'open' && (
        <Countdown
          serverNow={snapshot.serverNow}
          countdownEndsAt={snapshot.countdownEndsAt}
        />
      )}
      <QuestionImport snapshot={snapshot} />
      <QuestionList questions={snapshot.questions} />
      <GroupManager snapshot={snapshot} />
      {snapshot.phase === 'closed' && (
        <section className={styles.exportSection} aria-labelledby="export-results-title">
          <h2 id="export-results-title" className={styles.exportTitle}>
            {t('teacher.exportTitle')}
          </h2>
          <div className={styles.exportActions}>
            <button
              className={styles.exportButton}
              type="button"
              disabled={
                isWritingBack ||
                snapshot.guidedNotes?.sourceKind !== 'link'
              }
              onClick={() => {
                void handleWriteBack();
              }}
            >
              {t('teacher.writeBack')}
            </button>
            <button
              className={styles.exportButton}
              type="button"
              disabled={isExporting}
              onClick={() => {
                void handleExport(downloadGuidedNotes);
              }}
            >
              {t('teacher.exportGuided')}
            </button>
            <button
              className={styles.exportButton}
              type="button"
              disabled={isExporting}
              onClick={() => {
                void handleExport(downloadResultCsv);
              }}
            >
              {t('teacher.exportCsv')}
            </button>
          </div>
          {snapshot.guidedNotes?.sourceKind !== 'link' && (
            <p className={styles.exportError}>
              {t('teacher.noOnlineSheet')}
            </p>
          )}
          {writeBackMessage !== null && (
            <p className={styles.exportError} role="status">
              {writeBackMessage}
            </p>
          )}
          {writeBackError !== null && (
            <p className={styles.exportError} role="alert">
              {writeBackError}
            </p>
          )}
          {exportError !== null && (
            <p className={styles.exportError} role="alert">
              {exportError}
            </p>
          )}
        </section>
      )}
      {/* 005（FR-013、FR-017）：投影看板與逐題揭曉。 */}
      <section className={styles.exportSection} aria-labelledby="projector-control-title">
        <h2 id="projector-control-title" className={styles.exportTitle}>
          {t('teacher.projectorTitle')}
        </h2>
        <div className={styles.exportActions}>
          <button
            className={styles.exportButton}
            type="button"
            onClick={() => {
              window.open('/projector', '_blank', 'noopener');
            }}
          >
            {t('teacher.openProjector')}
          </button>
          <button
            className={styles.exportButton}
            type="button"
            disabled={isRevealing || snapshot.phase !== 'closed'}
            onClick={() => {
              void sendReveal('reveal:next');
            }}
          >
            {t('teacher.revealNext')}
          </button>
          <button
            className={styles.exportButton}
            type="button"
            disabled={isRevealing || snapshot.phase !== 'closed'}
            onClick={() => {
              void sendReveal('reveal:all');
            }}
          >
            {t('teacher.revealAll')}
          </button>
        </div>
        {revealError !== null && (
          <p className={styles.exportError} role="alert">
            {revealError}
          </p>
        )}
      </section>
      {/* 003 US3（T032）：任何階段都有看板與進度（FR-019–FR-022）。 */}
      <AnswerBoard snapshot={snapshot} />
    </section>
  );
}

export default TeacherPage;
