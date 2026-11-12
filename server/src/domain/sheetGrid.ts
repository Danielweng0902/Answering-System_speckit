/**
 * 與 xlsx 套件無關的試算表格子模型。
 * 列與欄都以 1 起算，`cells` 的鍵使用大寫 A1 表示法；空白格子不存放。
 */
export type CellRange = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

export type SheetGrid = {
  name: string;
  cells: Map<string, string>;
  merges: CellRange[];
};

export type GridCellPosition = {
  row: number;
  column: number;
};

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

/** 1 起算的欄數轉成試算表欄名（1 → A、26 → Z、27 → AA）。 */
export function columnToLetters(column: number): string {
  assertPositiveInteger(column, 'column');

  let remaining = column;
  let letters = '';
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/** 大寫欄名轉成 1 起算的欄數（Z → 26、AA → 27、AZ → 52）。 */
export function lettersToColumn(letters: string): number {
  if (!/^[A-Z]+$/.test(letters)) {
    throw new Error('column letters must use A-Z');
  }

  let column = 0;
  for (const letter of letters) {
    column = column * 26 + letter.charCodeAt(0) - 64;
    if (!Number.isSafeInteger(column)) {
      throw new Error('column letters are out of range');
    }
  }
  return column;
}

/** （列, 欄）轉成 A1 表示法。 */
export function toA1(row: number, column: number): string {
  assertPositiveInteger(row, 'row');
  assertPositiveInteger(column, 'column');
  return `${columnToLetters(column)}${row}`;
}

/** A1 表示法轉成（列, 欄）；列號從 1 起算，不接受 A0。 */
export function parseA1(a1: string): GridCellPosition {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(a1);
  if (!match) {
    throw new Error(`invalid A1 cell reference: ${a1}`);
  }

  const letterPart = match[1];
  const rowPart = match[2];
  if (letterPart === undefined || rowPart === undefined) {
    throw new Error(`invalid A1 cell reference: ${a1}`);
  }

  const row = Number(rowPart);
  if (!Number.isSafeInteger(row)) {
    throw new Error(`A1 row is out of range: ${a1}`);
  }
  return { row, column: lettersToColumn(letterPart) };
}

/** 找到包含指定列欄的合併範圍；不在任何範圍內時回 null。 */
export function findMerge(
  grid: SheetGrid,
  row: number,
  column: number,
): CellRange | null {
  for (const range of grid.merges) {
    if (
      row >= range.top &&
      row <= range.bottom &&
      column >= range.left &&
      column <= range.right
    ) {
      return range;
    }
  }
  return null;
}

/**
 * 讀取指定格子的文字。若在合併範圍內，回傳範圍左上角的文字；
 * 空白或未合併的空格一律回空字串。
 */
export function cellText(
  grid: SheetGrid,
  row: number,
  column: number,
): string {
  const merge = findMerge(grid, row, column);
  if (merge) {
    return grid.cells.get(toA1(merge.top, merge.left)) ?? '';
  }
  return grid.cells.get(toA1(row, column)) ?? '';
}

/** 工作表中最後一個有內容或合併範圍的列號；空工作表為 0。 */
export function maxRow(grid: SheetGrid): number {
  let result = 0;
  for (const key of grid.cells.keys()) {
    result = Math.max(result, parseA1(key).row);
  }
  for (const merge of grid.merges) {
    result = Math.max(result, merge.bottom);
  }
  return result;
}

/** 工作表中最後一個有內容或合併範圍的欄號；空工作表為 0。 */
export function maxColumn(grid: SheetGrid): number {
  let result = 0;
  for (const key of grid.cells.keys()) {
    result = Math.max(result, parseA1(key).column);
  }
  for (const merge of grid.merges) {
    result = Math.max(result, merge.right);
  }
  return result;
}
