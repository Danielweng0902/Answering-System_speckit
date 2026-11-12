import { ERROR_MESSAGES } from '@classroom/shared';
import { describe, expect, it } from 'vitest';
import {
  findHeader,
  parseGuidedNotes,
} from '../../src/domain/guidedNotesParser.js';
import { validateImport } from '../../src/domain/importValidator.js';
import type { CellRange, SheetGrid } from '../../src/domain/sheetGrid.js';

function makeGrid(
  name: string,
  cells: Record<string, string>,
  merges: CellRange[] = [],
): SheetGrid {
  return { name, cells: new Map(Object.entries(cells)), merges };
}

function activeGrid(): SheetGrid {
  return makeGrid('學習單', {
    B4: '題號',
    D4: '題目',
    G4: '作答',
    B5: '1',
    D5: '第一題',
  });
}

describe('findHeader', () => {
  it('找到同一列的三個表頭，並回報該列的各欄位置', () => {
    const grid = makeGrid('任意名稱', {
      A2: '標題',
      D7: '題號',
      F7: '題目',
      K7: '作答',
    });

    expect(findHeader(grid)).toEqual({
      row: 7,
      numberColumn: 4,
      promptColumn: 6,
      answerColumn: 11,
    });
  });

  it('三個欄名分散在不同列時不算表頭，繼續找下一列', () => {
    const grid = makeGrid('學習單', {
      A2: '題號',
      B3: '題目',
      C4: '作答',
      A8: '題號',
      B8: '題目',
      C8: '作答',
    });

    expect(findHeader(grid)).toEqual({
      row: 8,
      numberColumn: 1,
      promptColumn: 2,
      answerColumn: 3,
    });
  });

  it('欄名去除前後半形、全形空白後完全相等才相符', () => {
    const grid = makeGrid('學習單', {
      C4: ' \u3000題號\u3000 ',
      E4: '\u3000題目\t',
      H4: ' 作答\n',
    });

    expect(findHeader(grid)).toEqual({
      row: 4,
      numberColumn: 3,
      promptColumn: 5,
      answerColumn: 8,
    });
  });

  it('「作答區」「題目說明」不算完整欄名', () => {
    const grid = makeGrid('學習單', {
      A2: '題號',
      B2: '題目說明',
      C2: '作答區',
    });

    expect(findHeader(grid)).toBeNull();
  });
});

describe('parseGuidedNotes（單題與版面）', () => {
  it('取得每個正整數題號的一題一空格、題目文字與由上而下的位置', () => {
    const grid = makeGrid('空白列範例', {
      C3: '題號',
      E3: '題目',
      I3: '作答',
      C4: '1',
      E4: '  第一題　',
      C8: '2',
      E8: '　',
    });

    const result = parseGuidedNotes([grid]);

    expect(result).toEqual({
      ok: true,
      sheetName: '空白列範例',
      warnings: [],
      questions: [
        {
          number: 1,
          kind: 'single',
          prompt: '第一題',
          position: 1,
          rows: [4],
          blanks: [{ position: 1, prefix: '', cell: 'I4' }],
        },
        {
          number: 2,
          kind: 'single',
          prompt: '',
          position: 2,
          rows: [8],
          blanks: [{ position: 1, prefix: '', cell: 'I8' }],
        },
      ],
    });
  });

  it('表頭可在任意列欄，三欄間的其他欄與題目間的空白列都會被跳過', () => {
    const grid = makeGrid('變動版面', {
      C6: '題號',
      G6: '題目',
      H6: '備註',
      K6: '作答',
      C7: '1',
      G7: '第一題',
      H7: '不要當作答',
      C12: '2',
      G12: '第二題',
    });

    const result = parseGuidedNotes([grid]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.sheetName).toBe('變動版面');
    expect(
      result.questions.map(({ number, rows, blanks }) => ({
        number,
        row: rows[0],
        cells: blanks.map(({ cell }) => cell),
      })),
    ).toEqual([
      { number: 1, row: 7, cells: ['K7'] },
      { number: 2, row: 12, cells: ['K12'] },
    ]);
    expect(result.questions.map(({ position }) => position)).toEqual([1, 2]);
  });

  it('作答欄橫向合併時，空格取合併範圍左上角', () => {
    const grid = makeGrid(
      '學習單',
      {
        A4: '題號',
        B4: '題目',
        G4: '作答',
        A5: '1',
        B5: '題目',
      },
      [{ top: 5, left: 7, bottom: 5, right: 10 }],
    );

    expect(parseGuidedNotes([grid])).toEqual({
      ok: true,
      sheetName: '學習單',
      warnings: [],
      questions: [
        {
          number: 1,
          kind: 'single',
          prompt: '題目',
          position: 1,
          rows: [5],
          blanks: [{ position: 1, prefix: '', cell: 'G5' }],
        },
      ],
    });
  });

  it('數字 1、1.0 與文字「1」「 1 」都是題號 1；空白、文字、小數、0、負數不是題目', () => {
    const grid = makeGrid('題號正規化', {
      A1: '題號',
      B1: '題目',
      E1: '作答',
      A2: '1',
      A3: '1.0',
      A4: ' \u30002\u3000 ',
      A5: '　',
      A6: '備註',
      A7: '1.5',
      A8: '0',
      A9: '-1',
      A10: '3',
    });

    const result = parseGuidedNotes([grid]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.questions.map(({ number }) => number)).toEqual([1, 1, 2, 3]);
    expect(result.questions.map(({ rows }) => rows[0])).toEqual([2, 3, 4, 10]);
    expect(
      result.questions.flatMap(({ blanks }) => blanks.map(({ cell }) => cell)),
    ).toEqual(['E2', 'E3', 'E4', 'E10']);
  });

  it('零是邊界值而非正整數，不產生題目，也不影響後續位置的編號', () => {
    const grid = makeGrid('學習單', {
      A1: '題號',
      B1: '題目',
      C1: '作答',
      A2: '0',
      A3: ' 1 ',
    });

    const result = parseGuidedNotes([grid]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected parse to succeed');
    }
    expect(result.questions.map(({ number }) => number)).toEqual([1]);
    expect(result.questions[0]).toMatchObject({
      position: 1,
      rows: [3],
      blanks: [{ position: 1, prefix: '', cell: 'C3' }],
    });
  });

  it('使用第一個有表頭且至少有一題的工作表；沒有表頭或沒有題目的工作表被略過', () => {
    const noHeader = makeGrid('說明', { A1: '使用方式' });
    const emptyWithHeader = makeGrid('空白', {
      A1: '題號',
      B1: '題目',
      C1: '作答',
    });
    const laterEmptyHeader = makeGrid('另一份', {
      A1: '題號',
      B1: '題目',
      C1: '作答',
    });

    const result = parseGuidedNotes([
      noHeader,
      emptyWithHeader,
      activeGrid(),
      laterEmptyHeader,
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sheetName).toBe('學習單');
      expect(result.questions).toHaveLength(1);
    }
  });

  it('多個有表頭且有題目的工作表時仍使用第一個，並回 MULTIPLE_SHEETS_WITH_HEADER 提醒', () => {
    const first = makeGrid('第一份', {
      A1: '題號',
      B1: '題目',
      C1: '作答',
      A2: '1',
    });
    const second = makeGrid('第二份', {
      A1: '題號',
      B1: '題目',
      C1: '作答',
      A2: '1',
    });

    const result = parseGuidedNotes([second, first]);

    expect(result).toMatchObject({
      ok: true,
      sheetName: '第二份',
      questions: [
        {
          number: 1,
          kind: 'single',
          rows: [2],
          blanks: [{ position: 1, prefix: '', cell: 'C2' }],
        },
      ],
    });
    if (!result.ok) {
      throw new Error('expected parse to succeed');
    }
    expect(result.warnings).toEqual([
      {
        code: 'MULTIPLE_SHEETS_WITH_HEADER',
        message: '多個工作表都有表頭，已使用「第二份」工作表',
        sheetName: '第二份',
      },
    ]);
  });

  it('所有工作表都找不到表頭時回 HEADER_NOT_FOUND，訊息列出題號、題目、作答', () => {
    const result = parseGuidedNotes([]);

    expect(result).toEqual({
      ok: false,
      code: 'HEADER_NOT_FOUND',
      message: ERROR_MESSAGES.HEADER_NOT_FOUND,
    });
    if (result.ok) {
      throw new Error('expected parse failure');
    }
    expect(result.message).toContain('「題號」');
    expect(result.message).toContain('「題目」');
    expect(result.message).toContain('「作答」');
  });

  it('有表頭但沒有正整數題號時回 NO_QUESTIONS 與共用錯誤訊息', () => {
    const grid = makeGrid('空白', {
      A1: '題號',
      B1: '題目',
      C1: '作答',
      A2: '說明文字',
    });

    expect(parseGuidedNotes([grid])).toEqual({
      ok: false,
      code: 'NO_QUESTIONS',
      message: ERROR_MESSAGES.NO_QUESTIONS,
    });
  });
});

describe('parseGuidedNotes（題組）', () => {
  it('題號垂直合併 2 列與 3 列時是題組；每列一個空格、順序依列、保留前綴、題目取第一列', () => {
    const grid = makeGrid(
      '題組',
      {
        B2: '題號',
        D2: '題目',
        G2: '作答',
        B3: '1',
        D3: '第一個題組',
        G3: '（1）',
        G4: '(2)',
        B5: '2',
        D5: '第二個題組的第一列',
        D6: '第二個題組的第二列',
        G5: '（1）',
        G6: '　',
      },
      [
        { top: 3, left: 2, bottom: 4, right: 2 },
        { top: 5, left: 2, bottom: 7, right: 2 },
      ],
    );

    expect(parseGuidedNotes([grid])).toEqual({
      ok: true,
      sheetName: '題組',
      warnings: [],
      questions: [
        {
          number: 1,
          kind: 'group',
          prompt: '第一個題組',
          position: 1,
          rows: [3, 4],
          blanks: [
            { position: 1, prefix: '（1）', cell: 'G3' },
            { position: 2, prefix: '(2)', cell: 'G4' },
          ],
        },
        {
          number: 2,
          kind: 'group',
          prompt: '第二個題組的第一列',
          position: 2,
          rows: [5, 6, 7],
          blanks: [
            { position: 1, prefix: '（1）', cell: 'G5' },
            { position: 2, prefix: '', cell: 'G6' },
            { position: 3, prefix: '', cell: 'G7' },
          ],
        },
      ],
    });
  });

  it('作答欄跨列合併時，同一題重複指向的左上角位置只算一次', () => {
    const grid = makeGrid(
      '合併作答',
      {
        A1: '題號',
        C1: '題目',
        E1: '作答',
        A2: '1',
        C2: '題組題目',
        E2: '（1）',
      },
      [
        { top: 2, left: 1, bottom: 4, right: 1 },
        { top: 2, left: 5, bottom: 4, right: 5 },
      ],
    );

    expect(parseGuidedNotes([grid])).toEqual({
      ok: true,
      sheetName: '合併作答',
      warnings: [],
      questions: [
        {
          number: 1,
          kind: 'group',
          prompt: '題組題目',
          position: 1,
          rows: [2, 3, 4],
          blanks: [{ position: 1, prefix: '（1）', cell: 'E2' }],
        },
      ],
    });
  });

  it('前綴之後還有文字時保留前綴並由 validateImport 回 BLANK_HAS_CONTENT', () => {
    const grid = makeGrid(
      '已有內容',
      {
        A1: '題號',
        B1: '題目',
        E1: '作答',
        A2: '1',
        E2: '（1） 那是小題舊答案',
        E3: '(2)',
      },
      [{ top: 2, left: 1, bottom: 3, right: 1 }],
    );

    const parsed = parseGuidedNotes([grid]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    expect(parsed.warnings).toEqual([]);
    expect(parsed.questions[0]?.blanks[0]).toMatchObject({
      prefix: '（1）',
      cell: 'E2',
      hasContent: true,
    });

    const validated = validateImport(parsed);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error(validated.message);
    }
    expect(validated.warnings).toEqual([
      {
        code: 'BLANK_HAS_CONTENT',
        message: '題號 1 的作答格 E2 已有內容，匯出時會被取代',
        number: 1,
        cell: 'E2',
      },
    ]);
  });
});
