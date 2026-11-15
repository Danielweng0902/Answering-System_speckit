import type { DatabaseSync } from 'node:sqlite';
import type { ErrorCode } from '@classroom/shared';
import {
  resolveIdentity,
  type TeacherIdentity,
} from './access.js';
import { getActivity } from '../infra/db/activityRepo.js';
import { listValidSubmissionsWithAnswers } from '../infra/db/answerRepo.js';
import {
  getStoredGuidedNotes,
  list as listQuestions,
} from '../infra/db/questionRepo.js';
import { buildResults } from './answerProjections.js';
import { buildCsv } from './csvBuilder.js';
import { buildBlankContent } from './guidedNotesExporter.js';
import { replaceCellText } from '../infra/xlsx/xlsxEditor.js';

export type ExportAuthorization =
  | { ok: true; teacher: TeacherIdentity }
  | { ok: false; code: ErrorCode };

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
 * 004 兩個匯出入口共用：只有老師、活動已結束、已匯入 Guided Notes 才允許。
 * 不回傳 token；HTTP 層只在回應放錯誤代碼與使用者訊息。
 */
export function authorizeExport(
  database: DatabaseSync,
  token?: string | null,
): ExportAuthorization {
  const identity = resolveIdentity(database, token);
  if (identity.role === 'guest') {
    return { ok: false, code: 'UNAUTHORIZED' };
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
 */
export async function exportGuidedNotes(
  database: DatabaseSync,
  now: Date,
): Promise<ExportFile> {
  const stored = getStoredGuidedNotes(database);
  if (stored === null) {
    throw new Error('Cannot export Guided Notes: no imported file');
  }

  const questions = listQuestions(database);
  const resultByNumber = new Map(
    buildResults(database).map((result) => [result.questionNumber, result]),
  );
  let bytes = stored.file;

  for (const question of questions) {
    const result = resultByNumber.get(question.number);
    const prefixes = question.blanks.map((blank) => blank.prefix);
    const contents = buildBlankContent(
      result?.winner?.answers ?? null,
      prefixes,
    );
    if (contents === null) {
      continue;
    }

    for (const [index, blank] of question.blanks.entries()) {
      bytes = await replaceCellText(
        bytes,
        stored.sheetName,
        blank.cell,
        contents[index]!,
      );
    }
  }

  return {
    fileName: buildExportFileName(now, 'xlsx'),
    bytes,
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

/** 004 US3（T021）：只輸出有效作答；CSV 加 BOM、欄位移交由 builder。 */
export async function exportResultCsv(
  database: DatabaseSync,
  now: Date,
): Promise<ExportFile> {
  const winners = new Map(
    buildResults(database).map((result) => [
      result.questionNumber,
      result.winner?.groupId ?? null,
    ]),
  );
  const rows = listValidSubmissionsWithAnswers(database).map((row) => ({
    questionNumber: row.questionNumber,
    blankPosition: row.blankPosition,
    groupName: row.groupName,
    answer: row.answer,
    rank: row.rank,
    isWinner: winners.get(row.questionNumber) === row.groupId,
    receivedAt: row.receivedAt,
  }));

  return {
    fileName: buildExportFileName(now, 'csv'),
    bytes: buildCsv(rows),
    contentType: 'text/csv; charset=utf-8',
  };
}
