import type { DatabaseSync } from 'node:sqlite';
import type { ErrorCode } from '@classroom/shared';
import { resolveIdentity, type TeacherIdentity } from './access.js';
import { getActivity } from '../infra/db/activityRepo.js';
import { listValidSubmissionsWithAnswers } from '../infra/db/answerRepo.js';
import { getStoredGuidedNotes } from '../infra/db/questionRepo.js';
import { buildResults } from './answerProjections.js';
import { computeSettlement } from './answerSettlementService.js';
import { resolveGuidedNotesTargets } from './guidedNotesTargets.js';
import { buildCsv } from './csvBuilder.js';
import { replaceCellText } from '../infra/xlsx/xlsxEditor.js';

export type ExportAuthorization =
  { ok: true; teacher: TeacherIdentity } | { ok: false; code: ErrorCode };

export type ExportFile = {
  fileName: string;
  bytes: Uint8Array;
  contentType: string;
};

/** FR-007：統一固定命名，時間取教室／伺服器的本地時區（PR review 修正）。 */
export function buildExportFileName(
  now: Date,
  extension: 'xlsx' | 'csv',
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((accumulator, part) => {
      if (part.type !== 'literal') {
        accumulator[part.type] = part.value;
      }
      return accumulator;
    }, {});
  const date = `${parts.year}${parts.month}${parts.day}`;
  return `搶答結果_${date}_${parts.hour}${parts.minute}.${extension}`;
}

/**
 * CSV「送出時間」：資料庫維持 UTC；匯出時以教室／伺服器本地時區呈現。
 * 老師直接閱讀的格式不附 `Z` 或 `+08:00`，但保留毫秒（2026-11-16 兩組同意）。
 */
export function formatLocalTimestamp(
  receivedAt: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const instant = new Date(receivedAt);
  if (Number.isNaN(instant.getTime())) {
    throw new Error('作答送出時間不是有效的日期時間');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((accumulator, part) => {
      if (part.type !== 'literal') {
        accumulator[part.type] = part.value;
      }
      return accumulator;
    }, {});
  const milliseconds = String(instant.getUTCMilliseconds()).padStart(3, '0');
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${milliseconds}`;
}

/**
 * 004 兩個匯出入口共用：只有老師、活動已結束、已匯入 Guided Notes 才允許。
 * 不回傳 token；HTTP 層只在回應放錯誤代碼與使用者訊息。
 */
export function authorizeExport(
  database: DatabaseSync,
  token?: string | null,
): ExportAuthorization {
  const identity = resolveIdentity(database, token);
  if (identity.role === 'guest') {
    return { ok: false, code: 'TEACHER_AUTH_REQUIRED' };
  }
  if (identity.role !== 'teacher') {
    return { ok: false, code: 'FORBIDDEN' };
  }

  if (getActivity(database)?.phase !== 'closed') {
    return { ok: false, code: 'INVALID_PHASE' };
  }
  if (getStoredGuidedNotes(database) === null) {
    return { ok: false, code: 'NO_GUIDED_NOTES' };
  }

  return { ok: true, teacher: identity };
}

/**
 * 004 US1（T010）：取原檔副本，只填各題搶答成功組別的答案。
 *
 * winners 由 003 的 buildResults／decideWinner 單一入口判定；此方法本身唯讀，
 * 不更新任何資料列、不產生 Socket 事件、不遞增 revision（FR-008）。
 * 要寫到哪一格由 resolveGuidedNotesTargets 決定（006 與線上寫回共用同一套）。
 */
export async function exportGuidedNotes(database: DatabaseSync, now: Date): Promise<ExportFile> {
  const stored = getStoredGuidedNotes(database);
  if (stored === null) {
    throw new Error('Cannot export Guided Notes: no imported file');
  }

  const targets = await resolveGuidedNotesTargets(database, now);
  let bytes = stored.file;

  if (targets !== null) {
    for (const write of targets.writes) {
      bytes = await replaceCellText(
        bytes,
        targets.sheetName,
        write.cell,
        write.content,
      );
    }
  }

  return {
    fileName: buildExportFileName(now, 'xlsx'),
    bytes,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

/** 004 US3（T021）：只輸出有效作答；CSV 加 BOM、欄位移交由 builder。 */
export async function exportResultCsv(
  database: DatabaseSync,
  now: Date,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Promise<ExportFile> {
  const settlement = computeSettlement(database, now);
  const activity = getActivity(database);
  const fairRankingEnabled = activity?.fairRankingEnabled ?? false;
  const winners = new Map(
    buildResults(database, now).map((result) => [
      result.questionNumber,
      result.winner?.groupId ?? null,
    ]),
  );
  const rows = listValidSubmissionsWithAnswers(database).map((row) => {
    const result = settlement.get(row.questionNumber);
    // 005 FR-021：啟用公平順位時「順位」欄是公平順位；未啟用時與送達序號相同。
    const rank =
      result?.ranks.find((entry) => entry.groupId === row.groupId)?.rank ??
      row.rank;
    return {
      questionNumber: row.questionNumber,
      blankPosition: row.blankPosition,
      groupName: row.groupName,
      answer: row.answer,
      rank,
      isWinner: winners.get(row.questionNumber) === row.groupId,
      receivedAt: formatLocalTimestamp(row.receivedAt, timeZone),
      // 005 D13 v0.5：第 8 欄「公平順位」。
      fairness: !fairRankingEnabled
        ? '否'
        : result?.fairnessApplied === true
          ? '是（改判）'
          : '是',
    };
  });

  return {
    fileName: buildExportFileName(now, 'csv', timeZone),
    bytes: buildCsv(rows),
    contentType: 'text/csv; charset=utf-8',
  };
}
