import type { ImportWarning } from '@classroom/shared';
import type { ParsedQuestion } from './guidedNotesParser.js';

export type ParsedImportInput = {
  sheetName: string;
  questions: ParsedQuestion[];
  warnings: ImportWarning[];
};

export type ImportValidationFailure = {
  ok: false;
  code: 'DUPLICATE_QUESTION_NUMBER';
  message: string;
};

export type ImportValidationResult =
  | {
      ok: true;
      sheetName: string;
      questions: ParsedQuestion[];
      warnings: ImportWarning[];
    }
  | ImportValidationFailure;

function duplicateQuestionError(
  questions: readonly ParsedQuestion[],
): ImportValidationFailure | null {
  const rowsByNumber = new Map<number, number[]>();
  for (const question of questions) {
    // rows[0] 是題號所在列；題組其餘列是同一次出現，不能當成重複。
    const row = question.rows[0] ?? question.position;
    const rows = rowsByNumber.get(question.number);
    if (rows === undefined) {
      rowsByNumber.set(question.number, [row]);
    } else {
      rows.push(row);
    }
  }

  const descriptions: string[] = [];
  for (const [number, rows] of rowsByNumber) {
    if (rows.length > 1) {
      descriptions.push(`題號 ${number} 重複（第 ${rows.join('、')} 列）`);
    }
  }
  if (descriptions.length === 0) {
    return null;
  }

  return {
    ok: false,
    code: 'DUPLICATE_QUESTION_NUMBER',
    message: `${descriptions.join('；')}，請修正後重新匯入`,
  };
}

/** 驗證 parser 選出的工作表；重複題號是錯誤，其餘資訊只產生提醒。 */
export function validateImport(
  parsed: ParsedImportInput,
): ImportValidationResult {
  const duplicate = duplicateQuestionError(parsed.questions);
  if (duplicate !== null) {
    return duplicate;
  }

  const warnings: ImportWarning[] = [...parsed.warnings];
  const numbers = parsed.questions.map(({ number }) => number);
  if (numbers.some((number, index) => number !== index + 1)) {
    warnings.push({
      code: 'NUMBERS_NOT_SEQUENTIAL',
      message: `題號不是從 1 開始或沒有連續（實際題號：${numbers.join('、')}），匯入前請確認`,
      numbers,
    });
  }

  for (const question of parsed.questions) {
    for (const blank of question.blanks) {
      if (blank.hasContent === true) {
        warnings.push({
          code: 'BLANK_HAS_CONTENT',
          message: `題號 ${question.number} 的作答格 ${blank.cell} 已有內容，匯出時會被取代`,
          number: question.number,
          cell: blank.cell,
        });
      }
    }
  }

  return {
    ok: true,
    sheetName: parsed.sheetName,
    questions: parsed.questions,
    warnings,
  };
}
