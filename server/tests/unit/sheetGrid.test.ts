import { describe, expect, it } from 'vitest';
import {
  cellText,
  columnToLetters,
  findMerge,
  lettersToColumn,
  maxColumn,
  maxRow,
  parseA1,
  toA1,
  type SheetGrid,
} from '../../src/domain/sheetGrid.js';

function grid(
  cells: Readonly<Record<string, string>>,
  merges: SheetGrid['merges'] = [],
): SheetGrid {
  return {
    name: '學習單',
    cells: new Map(Object.entries(cells)),
    merges,
  };
}

describe('columnToLetters 與 lettersToColumn', () => {
  it.each([
    [1, 'A'],
    [26, 'Z'],
    [27, 'AA'],
    [52, 'AZ'],
    [53, 'BA'],
  ])('%i 與 %s 可以互相轉換', (column, letters) => {
    expect(columnToLetters(column)).toBe(letters);
    expect(lettersToColumn(letters)).toBe(column);
  });

  it.each([0, -1, 1.5])('拒絕無效的欄數 %i', (column) => {
    expect(() => columnToLetters(column)).toThrow();
  });

  it.each(['', 'a', 'A1'])('拒絕無效的欄名 %s', (letters) => {
    expect(() => lettersToColumn(letters)).toThrow();
  });
});

describe('toA1 與 parseA1', () => {
  it.each([
    [1, 1, 'A1'],
    [26, 26, 'Z26'],
    [27, 27, 'AA27'],
    [52, 52, 'AZ52'],
  ])('(%i, %i) 與 %s 可以互相轉換', (row, column, a1) => {
    expect(toA1(row, column)).toBe(a1);
    expect(parseA1(a1)).toEqual({ row, column });
  });

  it.each(['A0', 'A01', 'a1', '1A', '', 'A-1'])('拒絕非法的 A1 表示法 %s', (a1) => {
    expect(() => parseA1(a1)).toThrow('invalid A1 cell reference');
  });

  it.each([
    [0, 1],
    [1, 0],
    [1.5, 1],
  ])('拒絕非法的列欄位置 %s', (row, column) => {
    expect(() => toA1(row, column)).toThrow();
  });
});

describe('findMerge 與 cellText', () => {
  const merged = grid(
    { B5: '題 1', G5: '（1）' },
    [
      { top: 5, left: 2, bottom: 6, right: 2 },
      { top: 5, left: 7, bottom: 5, right: 10 },
    ],
  );

  it('查詢合併範圍內任意格子，包含邊界', () => {
    expect(findMerge(merged, 5, 2)).toEqual({
      top: 5,
      left: 2,
      bottom: 6,
      right: 2,
    });
    expect(findMerge(merged, 6, 2)).toEqual({
      top: 5,
      left: 2,
      bottom: 6,
      right: 2,
    });
  });

  it('不在合併範圍內時回 null', () => {
    expect(findMerge(merged, 7, 2)).toBeNull();
    expect(findMerge(merged, 6, 3)).toBeNull();
  });

  it('查詢合併範圍內的文字時回傳左上角的文字', () => {
    expect(cellText(merged, 6, 2)).toBe('題 1');
    expect(cellText(merged, 5, 10)).toBe('（1）');
  });

  it('未合併的格子回傳自己的文字，空格回空字串', () => {
    expect(cellText(grid({ A1: '內容' }), 1, 1)).toBe('內容');
    expect(cellText(grid({ A1: '內容' }), 1, 2)).toBe('');
    expect(cellText(grid({}), 3, 7)).toBe('');
  });
});

describe('maxRow 與 maxColumn', () => {
  it('同時考慮有文字的格子與合併範圍', () => {
    const sheet = grid({ A1: '標題', AZ52: '內容' }, [
      { top: 3, left: 2, bottom: 60, right: 4 },
    ]);

    expect(maxRow(sheet)).toBe(60);
    expect(maxColumn(sheet)).toBe(52);
  });

  it('空工作表的邊界為 0', () => {
    expect(maxRow(grid({}))).toBe(0);
    expect(maxColumn(grid({}))).toBe(0);
  });
});
