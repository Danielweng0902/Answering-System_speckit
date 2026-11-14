import { describe, expect, it } from 'vitest';
import type { ImportWarning } from '@classroom/shared';
import {
  validateImport,
  type ParsedImportInput,
} from '../../src/domain/importValidator.js';
import type { ParsedQuestion } from '../../src/domain/guidedNotesParser.js';

function makeQuestion(
  number: number,
  row: number,
  options: { readonly hasContent?: boolean } = {},
): ParsedQuestion {
  const blank: ParsedQuestion['blanks'][number] = {
    position: 1,
    prefix: '',
    cell: `C${row}`,
  };
  if (options.hasContent === true) {
    blank.hasContent = true;
  }

  return {
    number,
    kind: 'single',
    prompt: `第 ${number} 題`,
    position: row,
    rows: [row],
    blanks: [blank],
  };
}

function makeParsed(
  questions: ParsedQuestion[],
  warnings: ImportWarning[] = [],
): ParsedImportInput {
  return {
    sheetName: '學習單',
    questions: questions.map((question, index) => ({
      ...question,
      position: index + 1,
    })),
    warnings,
  };
}

describe('validateImport', () => {
  it('題號不是從 1 開始或不連續時回 NUMBERS_NOT_SEQUENTIAL 提醒，但不拒絕匯入', () => {
    const result = validateImport(
      makeParsed([
        makeQuestion(1, 2),
        makeQuestion(2, 3),
        makeQuestion(4, 4),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('提醒不應阻擋匯入');
    }
    expect(result.sheetName).toBe('學習單');
    expect(result.questions).toHaveLength(3);
    expect(result.warnings).toEqual([
      {
        code: 'NUMBERS_NOT_SEQUENTIAL',
        message: '題號不是從 1 開始或沒有連續（實際題號：1、2、4），匯入前請確認',
        numbers: [1, 2, 4],
      },
    ]);
  });

  it('題號不是從 1 開始時也回 NUMBERS_NOT_SEQUENTIAL 提醒', () => {
    const result = validateImport(
      makeParsed([makeQuestion(2, 2), makeQuestion(3, 3)]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('提醒不應阻擋匯入');
    }
    expect(result.warnings).toEqual([
      {
        code: 'NUMBERS_NOT_SEQUENTIAL',
        message: '題號不是從 1 開始或沒有連續（實際題號：2、3），匯入前請確認',
        numbers: [2, 3],
      },
    ]);
  });

  it('單題空格已有內容時回 BLANK_HAS_CONTENT 提醒，並附題號與 A1 位置', () => {
    const result = validateImport(
      makeParsed([
        makeQuestion(1, 2),
        makeQuestion(2, 5, { hasContent: true }),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('提醒不應阻擋匯入');
    }
    expect(result.warnings).toEqual([
      {
        code: 'BLANK_HAS_CONTENT',
        message: '題號 2 的作答格 C5 已有內容，匯出時會被取代',
        number: 2,
        cell: 'C5',
      },
    ]);
  });

  it('既有提醒（例如多工作表表頭）會保留，且不阻擋匯入', () => {
    const sheetWarning: ImportWarning = {
      code: 'MULTIPLE_SHEETS_WITH_HEADER',
      message: '多個工作表都有表頭，已使用「學習單」工作表',
      sheetName: '學習單',
    };

    const result = validateImport(
      makeParsed([makeQuestion(1, 2)], [sheetWarning]),
    );

    expect(result).toEqual({
      ok: true,
      sheetName: '學習單',
      questions: [
        {
          number: 1,
          kind: 'single',
          prompt: '第 1 題',
          position: 1,
          rows: [2],
          blanks: [{ position: 1, prefix: '', cell: 'C2' }],
        },
      ],
      warnings: [sheetWarning],
    });
  });

  it('題號重複時回 DUPLICATE_QUESTION_NUMBER，訊息含題號與所有出現列號（1 起算）', () => {
    const result = validateImport(
      makeParsed([
        makeQuestion(1, 5),
        makeQuestion(2, 7),
        makeQuestion(3, 9),
        makeQuestion(3, 11),
      ]),
    );

    expect(result).toEqual({
      ok: false,
      code: 'DUPLICATE_QUESTION_NUMBER',
      message: '題號 3 重複（第 9、11 列），請修正後重新匯入',
    });
  });
});
