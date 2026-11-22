import type { ErrorCode } from '@classroom/shared';
import { getCurrentLanguage } from './language';

/**
 * 伺服器錯誤訊息的英文版（007 i18n）。
 *
 * 伺服器**維持回繁體中文**（共用契約不動、兩組行為一致），這裡在客戶端
 * 依錯誤代碼對應英文；沒有對應到的代碼就直接顯示伺服器回來的中文。
 */
export const ERROR_MESSAGES_EN: Partial<Record<ErrorCode, string>> = {
  FORBIDDEN: 'Only the teacher can do this',
  INVALID_PHASE: 'This action is not available in the current phase',
  INVALID_INPUT: 'The input format is not valid',
  GROUP_NAME_EMPTY: 'Please enter a group name',
  GROUP_NAME_TOO_LONG: 'Group names can be at most 30 characters',
  GROUP_NAME_DUPLICATE: 'A group with this name already exists',
  GROUP_LIMIT_REACHED: 'You can create at most 100 groups',
  GROUP_NOT_FOUND: 'That group no longer exists, please pick another one',
  NO_GROUPS: 'Create at least one group first',
  COUNTDOWN_OUT_OF_RANGE: 'The countdown must be between 10 seconds and 60 minutes',
  CONFIRM_REQUIRED: 'Please confirm the activity reset',
  WRONG_PASSWORD: 'Wrong password',
  TEACHER_PASSWORD_NOT_SET: 'No teacher password has been set yet',
  TOO_MANY_ATTEMPTS: 'Too many attempts, please try again later',
  TEACHER_AUTH_REQUIRED: 'Please sign in as a teacher first',
  FILE_INVALID: 'That file could not be read — upload an xlsx Guided Notes file',
  FILE_TOO_LARGE: 'The file is too large — upload an xlsx under 5 MB',
  HEADER_NOT_FOUND:
    'Header row not found. The Guided Notes file needs a row with the columns 題號 / 題目 / 作答 (number / question / answer).',
  NO_QUESTIONS:
    'No question numbers found under the header — check that the number column contains numbers',
  NO_GUIDED_NOTES: 'No Guided Notes file has been imported for this activity yet',
  DUPLICATE_QUESTION_NUMBER: 'Duplicate question number — fix it and import again',
  LINK_INVALID:
    'That is not a Google Sheets link — it should start with docs.google.com/spreadsheets',
  LINK_NOT_SHARED: 'That sheet could not be read. You can also:',
  LINK_UNREACHABLE:
    'Could not reach Google Sheets — check the network, or download it as xlsx and upload it',
  IMPORT_EXPIRED: 'The import summary expired — read the Guided Notes file again',
  QUESTIONS_REQUIRED: 'Import some questions first',
  QUESTION_NOT_FOUND: 'That question no longer exists — please refresh',
  BLANK_COUNT_MISMATCH: 'Every blank of this question must be filled in',
  ANSWER_EMPTY: 'The answer cannot be empty',
  ANSWER_TOO_LONG: 'Each blank accepts at most 200 characters',
  ALREADY_SUBMITTED: 'Your group already submitted this question',
  SUBMISSION_NOT_FOUND: 'That answer no longer exists — please refresh',
  GUIDED_NOTES_NOT_LINK:
    'This Guided Notes file was uploaded as xlsx, so there is no online sheet to write back to — download the xlsx instead',
  SHEET_NOT_CONFIGURED:
    'The server has no Google service account set up, so it cannot write back — download the xlsx instead',
  SHEET_NOT_FOUND:
    'That Google Sheet could not be found — it may have been deleted; download the xlsx instead',
  SHEET_TAB_NOT_FOUND:
    'The tab inside the sheet could not be found — it may have been renamed; rename it back or import again, or download the xlsx',
  SHEET_NOT_EDITABLE:
    'No edit permission for that sheet — share it with the service account, or download the xlsx',
  SHEET_NOT_NATIVE:
    'This file is still an xlsx, so it cannot be written to. Save it as a native Google Sheet, then import the new link.',
  SHEET_API_DISABLED:
    'The server’s Google project has not enabled the Sheets API — please ask the administrator.',
  SHEET_AUTH_FAILED:
    'The server’s write-back settings are broken — please ask the administrator to check the service account key.',
  SHEET_MODIFIED:
    'The questions on the sheet differ from the imported version (prompt, blanks or prefixes changed), so the answers cannot be placed. Download the xlsx with answers using “Export Guided Notes”. (If you only inserted a row or moved a column, the answers are matched to the new positions automatically.)',
  SHEET_CHECK_FAILED:
    'The sheet could not be read, so the layout cannot be checked (a common cause: “anyone with the link” sharing was turned off, or the network is unstable). Press “Write back to Google Sheets” again; if it still fails, download the xlsx with answers using “Export Guided Notes”.',
  SHEET_UNAVAILABLE:
    'Google Sheets cannot be written to right now — try again later or download the xlsx',
};

/**
 * 依錯誤代碼把伺服器的中文訊息換成英文；沒有對應英文（或是前端自己產生的
 * 錯誤、code 為 null）就維持原樣。
 */
export function localizeErrorMessage(
  code: ErrorCode | null,
  message: string,
): string {
  if (code === null || getCurrentLanguage() !== 'en') {
    return message;
  }
  return ERROR_MESSAGES_EN[code] ?? message;
}
