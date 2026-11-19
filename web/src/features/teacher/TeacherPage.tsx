import type { Snapshot } from '@classroom/shared';
import { useState } from 'react';
import {
  downloadGuidedNotes,
  downloadResultCsv,
  writeBackGuidedNotes,
  type DownloadExportResult,
} from '../../lib/api';
import { Countdown } from '../shared/Countdown';
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
          ? '這場沒有搶答成功的答案，沒有需要寫回的儲存格。'
          : `已寫回 ${String(result.writtenCells)} 格答案到 Google 試算表。這次沒有人作答的題目不會被清除，表上可能還留著上一場的答案。`,
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
          <h1 id="teacher-page-title" className={styles.title}>
            老師端
          </h1>
        </header>
        <TeacherLogin
          onLoginSuccess={() => {
            setIsAwaitingTeacherSnapshot(true);
          }}
        />
        {isAwaitingTeacherSnapshot && (
          <p className={styles.notice} role="status">
            已送出登入資訊，等待同步老師狀態。
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
        <h1 id="teacher-page-title" className={styles.title}>
          老師端
        </h1>
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
            匯出結果
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
              寫回 Google 試算表
            </button>
            <button
              className={styles.exportButton}
              type="button"
              disabled={isExporting}
              onClick={() => {
                void handleExport(downloadGuidedNotes);
              }}
            >
              匯出 Guided Notes
            </button>
            <button
              className={styles.exportButton}
              type="button"
              disabled={isExporting}
              onClick={() => {
                void handleExport(downloadResultCsv);
              }}
            >
              匯出 CSV
            </button>
          </div>
          {snapshot.guidedNotes?.sourceKind !== 'link' && (
            <p className={styles.exportError}>
              這次的學習單是上傳的 xlsx，沒有線上試算表可以寫回；請用「匯出 Guided Notes」。
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
          投影看板
        </h2>
        <div className={styles.exportActions}>
          <button
            className={styles.exportButton}
            type="button"
            onClick={() => {
              window.open('/projector', '_blank', 'noopener');
            }}
          >
            開啟投影看板
          </button>
          <button
            className={styles.exportButton}
            type="button"
            disabled={isRevealing || snapshot.phase !== 'closed'}
            onClick={() => {
              void sendReveal('reveal:next');
            }}
          >
            揭曉下一題
          </button>
          <button
            className={styles.exportButton}
            type="button"
            disabled={isRevealing || snapshot.phase !== 'closed'}
            onClick={() => {
              void sendReveal('reveal:all');
            }}
          >
            全部揭曉
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
