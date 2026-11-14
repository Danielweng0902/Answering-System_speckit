import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { Buffer } from 'node:buffer';
import { ERROR_MESSAGES } from '@classroom/shared';
import {
  parseA1,
  toA1,
  type CellRange,
  type SheetGrid,
} from '../../domain/sheetGrid.js';

export const MAX_WORKBOOK_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

export type WorkbookReadErrorCode = 'FILE_INVALID' | 'FILE_TOO_LARGE';

/** 讀取／大小檢查的已知錯誤；HTTP 層只使用 code，不輸出檔案細節。 */
export class WorkbookReadError extends Error {
  readonly code: WorkbookReadErrorCode;

  constructor(code: WorkbookReadErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'WorkbookReadError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarValueToText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value === '' ? null : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return null;
}

function objectValueToText(value: Record<string, unknown>): string | null {
  if (Array.isArray(value.richText)) {
    const text = value.richText
      .map((part) =>
        isRecord(part) && typeof part.text === 'string' ? part.text : '',
      )
      .join('');
    return text === '' ? null : text;
  }

  if ('result' in value) {
    return cellValueToText(value.result);
  }

  if (typeof value.text === 'string') {
    return value.text === '' ? null : value.text;
  }

  return null;
}

/** 把 exceljs 的儲存格值轉成領域模型使用的純文字。 */
function cellValueToText(value: unknown): string | null {
  const scalar = scalarValueToText(value);
  if (scalar !== null) {
    return scalar;
  }
  if (isRecord(value)) {
    return objectValueToText(value);
  }
  return null;
}

function mergeToRange(reference: string): CellRange {
  const separator = reference.indexOf(':');
  const startReference =
    separator === -1 ? reference : reference.slice(0, separator);
  const endReference =
    separator === -1 ? reference : reference.slice(separator + 1);

  const start = parseA1(startReference);
  const end = parseA1(endReference);
  return {
    top: Math.min(start.row, end.row),
    left: Math.min(start.column, end.column),
    bottom: Math.max(start.row, end.row),
    right: Math.max(start.column, end.column),
  };
}

/**
 * 在展開任何檔案項目之前，只讀中央目錄累計未壓縮大小。
 * JSZipObject 沒有公開 size 型別；其載入中央目錄後的 _data 元資料
 * 提供 uncompressedSize。元資料不可讀時採 fail-closed，不交給 exceljs。
 */
export async function assertWorkbookSize(bytes: Uint8Array): Promise<void> {
  try {
    const archive = await JSZip.loadAsync(Buffer.from(bytes));
    let totalUncompressedBytes = 0;

    for (const entry of Object.values(archive.files)) {
      if (!isRecord(entry) || entry.dir === true) {
        continue;
      }
      const data = entry._data;
      const size = isRecord(data) ? data.uncompressedSize : undefined;
      if (
        typeof size !== 'number' ||
        !Number.isSafeInteger(size) ||
        size < 0
      ) {
        throw new WorkbookReadError('FILE_INVALID');
      }

      totalUncompressedBytes += size;
      if (totalUncompressedBytes > MAX_WORKBOOK_UNCOMPRESSED_BYTES) {
        throw new WorkbookReadError('FILE_TOO_LARGE');
      }
    }
  } catch (error) {
    if (error instanceof WorkbookReadError) {
      throw error;
    }
    throw new WorkbookReadError('FILE_INVALID');
  }
}

/**
 * 以 exceljs 把 xlsx 位元組轉成依活頁簿順序排列的 SheetGrid；
 * exceljs 型別不穿越 infra 層邊界。
 */
export async function readWorkbook(bytes: Uint8Array): Promise<SheetGrid[]> {
  // JSZip 只讀中央目錄；必須在 exceljs 展開 xlsx 前檢查壓縮炸彈。
  await assertWorkbookSize(bytes);

  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs 的型別宣告用舊版 Buffer 定義，執行時接受一般 Buffer。
    await workbook.xlsx.load(
      Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new WorkbookReadError('FILE_INVALID');
  }

  return workbook.worksheets.map((worksheet) => {
    const cells = new Map<string, string>();
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        const text = cellValueToText(cell.value);
        if (text !== null) {
          cells.set(toA1(row.number, column), text);
        }
      });
    });

    return {
      name: worksheet.name,
      cells,
      merges: worksheet.model.merges.map(mergeToRange),
    };
  });
}
