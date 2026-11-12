import { ERROR_MESSAGES } from '@classroom/shared';
import type { ImportWarning, QuestionKind } from '@classroom/shared';
import {
  cellText,
  findMerge,
  maxColumn,
  maxRow,
  toA1,
  type SheetGrid,
} from './sheetGrid.js';

export type HeaderLocation = {
  row: number;
  numberColumn: number;
  promptColumn: number;
  answerColumn: number;
};

export type ParsedBlank = {
  position: number;
  prefix: string;
  cell: string;
  /**
   * 除已辨識前綴以外的作答內容。只給 importValidator 產生提醒使用，
   * 不匯出到 ImportSummary；無內容時省略，維持既有解析結果結構。
   */
  hasContent?: boolean;
};

export type ParsedQuestion = {
  number: number;
  kind: QuestionKind;
  prompt: string;
  position: number;
  rows: number[];
  blanks: ParsedBlank[];
};

export type ParseFailure = {
  ok: false;
  code: 'HEADER_NOT_FOUND' | 'NO_QUESTIONS';
  message: string;
};

export type ParseResult =
  | {
      ok: true;
      sheetName: string;
      questions: ParsedQuestion[];
      warnings: ImportWarning[];
    }
  | ParseFailure;

const HEADER_TEXT = {
  number: '題號',
  prompt: '題目',
  answer: '作答',
} as const;

const QUESTION_NUMBER_PATTERN = /^\d+(?:\.0+)?$/;
const BLANK_PREFIX_PATTERN = /^(?:（\d+）|\(\d+\))/;

/**
 * 找到同一列中的「題號」「題目」「作答」欄。
 * 比對會去掉 `String.prototype.trim()` 涵蓋的半形與全形空白。
 */
export function findHeader(grid: SheetGrid): HeaderLocation | null {
  const lastRow = maxRow(grid);
  const lastColumn = maxColumn(grid);

  for (let row = 1; row <= lastRow; row += 1) {
    let numberColumn: number | null = null;
    let promptColumn: number | null = null;
    let answerColumn: number | null = null;

    for (let column = 1; column <= lastColumn; column += 1) {
      const text = cellText(grid, row, column).trim();
      if (text === HEADER_TEXT.number && numberColumn === null) {
        numberColumn = column;
      } else if (text === HEADER_TEXT.prompt && promptColumn === null) {
        promptColumn = column;
      } else if (text === HEADER_TEXT.answer && answerColumn === null) {
        answerColumn = column;
      }
    }

    if (
      numberColumn !== null &&
      promptColumn !== null &&
      answerColumn !== null
    ) {
      return {
        row,
        numberColumn,
        promptColumn,
        answerColumn,
      };
    }
  }

  return null;
}

function parseQuestionNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!QUESTION_NUMBER_PATTERN.test(trimmed)) {
    return null;
  }

  const number = Number(trimmed);
  if (!Number.isSafeInteger(number) || number < 1) {
    return null;
  }
  return number;
}

function parseBlanks(
  grid: SheetGrid,
  header: HeaderLocation,
  rows: readonly number[],
  kind: QuestionKind,
): ParsedBlank[] {
  const blanks: ParsedBlank[] = [];
  const seenCells = new Set<string>();

  for (const row of rows) {
    const merge = findMerge(grid, row, header.answerColumn);
    const origin = merge ?? { top: row, left: header.answerColumn };
    const cell = toA1(origin.top, origin.left);
    if (seenCells.has(cell)) {
      continue;
    }
    seenCells.add(cell);

    const text = cellText(grid, row, header.answerColumn);
    const prefix = BLANK_PREFIX_PATTERN.exec(text)?.[0] ?? '';
    const blank: ParsedBlank = {
      position: blanks.length + 1,
      prefix,
      cell,
    };
    // 題組只提醒前綴以外的文字；單題則是作答格本身有任何內容都提醒
    // （research R3），即使它看起來像「（1）」。
    const remainingText = kind === 'single' ? text : text.slice(prefix.length);
    if (remainingText.trim().length > 0) {
      blank.hasContent = true;
    }
    blanks.push(blank);
  }

  return blanks;
}

function parseQuestions(
  grid: SheetGrid,
  header: HeaderLocation,
): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  const lastRow = maxRow(grid);

  for (let row = header.row + 1; row <= lastRow; row += 1) {
    const numberMerge = findMerge(grid, row, header.numberColumn);

    // 合併題號的每個續列都會讀到左上角的值，不能重複當成新題。
    if (
      numberMerge !== null &&
      numberMerge.bottom > numberMerge.top &&
      row !== numberMerge.top
    ) {
      continue;
    }

    const number = parseQuestionNumber(
      cellText(grid, row, header.numberColumn),
    );
    if (number === null) {
      continue;
    }

    let kind: QuestionKind = 'single';
    let rows: number[] = [row];
    if (numberMerge !== null && numberMerge.bottom > numberMerge.top) {
      kind = 'group';
      rows = [];
      for (
        let questionRow = numberMerge.top;
        questionRow <= numberMerge.bottom;
        questionRow += 1
      ) {
        rows.push(questionRow);
      }
    }

    const firstRow = rows[0] ?? row;
    questions.push({
      number,
      kind,
      prompt: cellText(grid, firstRow, header.promptColumn).trim(),
      position: questions.length + 1,
      rows,
      blanks: parseBlanks(grid, header, rows, kind),
    });
  }

  return questions;
}

/** 依活頁簿順序選用第一個有表頭且至少有一題的工作表。 */
export function parseGuidedNotes(grids: SheetGrid[]): ParseResult {
  let headerCount = 0;
  let selected: { sheetName: string; questions: ParsedQuestion[] } | null =
    null;

  for (const grid of grids) {
    const header = findHeader(grid);
    if (header === null) {
      continue;
    }
    headerCount += 1;

    const questions = parseQuestions(grid, header);
    if (selected === null && questions.length > 0) {
      selected = { sheetName: grid.name, questions };
    }
  }

  if (selected !== null) {
    const warnings: ImportWarning[] = [];
    if (headerCount > 1) {
      warnings.push({
        code: 'MULTIPLE_SHEETS_WITH_HEADER',
        message: `多個工作表都有表頭，已使用「${selected.sheetName}」工作表`,
        sheetName: selected.sheetName,
      });
    }
    return {
      ok: true,
      sheetName: selected.sheetName,
      questions: selected.questions,
      warnings,
    };
  }

  const code = headerCount > 0 ? 'NO_QUESTIONS' : 'HEADER_NOT_FOUND';
  return { ok: false, code, message: ERROR_MESSAGES[code] };
}
