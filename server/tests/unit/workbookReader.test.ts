import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  MAX_WORKBOOK_UNCOMPRESSED_BYTES,
  readWorkbook,
  WorkbookReadError,
} from '../../src/infra/xlsx/workbookReader.js';

const FIXTURE_NAMES = [
  '01-official-single.xlsx',
  '02-official-group.xlsx',
  '03-shifted-layout.xlsx',
  '04-mixed-groups.xlsx',
  '05-two-sheets.xlsx',
  '90-invalid-no-header.xlsx',
  '91-invalid-duplicate-number.xlsx',
  '92-invalid-empty.xlsx',
];

function fixtureBytes(fileName: string): Promise<Buffer> {
  return readFile(
    fileURLToPath(
      new URL(`../../../fixtures/guided-notes/${fileName}`, import.meta.url),
    ),
  );
}

describe('readWorkbook', () => {
  it('02-official-group.xlsx 保留工作表名稱、題號垂直合併與前綴文字', async () => {
    const grids = await readWorkbook(
      await fixtureBytes('02-official-group.xlsx'),
    );

    expect(grids[0]?.name).toBe('學習單');
    expect(grids[0]?.merges).toContainEqual({
      top: 5,
      left: 2,
      bottom: 6,
      right: 2,
    });
    expect(grids[0]?.cells.get('G5')).toMatch(/^（1）/);
  });

  it('05-two-sheets.xlsx 依活頁簿順序回傳兩個工作表', async () => {
    const grids = await readWorkbook(
      await fixtureBytes('05-two-sheets.xlsx'),
    );

    expect(grids.map((grid) => grid.name)).toEqual(['說明', '學習單']);
  });

  it('數字格 1 轉成文字 1，而非保留數值', async () => {
    const grids = await readWorkbook(
      await fixtureBytes('01-official-single.xlsx'),
    );

    expect(grids[0]?.cells.get('B5')).toBe('1');
    expect(typeof grids[0]?.cells.get('B5')).toBe('string');
  });

  it('接受只有局部 buffer 內容的 Uint8Array（非零 byteOffset）', async () => {
    const bytes = await fixtureBytes('01-official-single.xlsx');
    const padded = new Uint8Array(bytes.length + 4);
    padded.set(bytes, 2);
    const view = padded.subarray(2, padded.length - 2);

    const grids = await readWorkbook(view);

    expect(grids[0]?.name).toBe('學習單');
    expect(grids[0]?.cells.get('B5')).toBe('1');
  });

  it.each(FIXTURE_NAMES)('%s 都能讀取而不拋錯', async (fileName) => {
    const grids = await readWorkbook(await fixtureBytes(fileName));

    expect(grids.length).toBeGreaterThan(0);
  });

  it('不是 zip 的位元組拒絕為 FILE_INVALID，而不是交給 exceljs', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 not an xlsx');

    await expect(readWorkbook(bytes)).rejects.toBeInstanceOf(WorkbookReadError);
    await expect(readWorkbook(bytes)).rejects.toMatchObject({
      code: 'FILE_INVALID',
    });
  });

  it('損壞的 zip 拒絕為 FILE_INVALID', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', 'not a workbook');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    // 截掉 End of Central Directory，仍是常見的損壞 zip 形式。
    const damaged = bytes.slice(0, Math.max(0, bytes.length - 8));

    await expect(readWorkbook(damaged)).rejects.toMatchObject({
      code: 'FILE_INVALID',
    });
  });

  it('zip 結構可讀但 exceljs 無法讀成 workbook 時轉成 FILE_INVALID', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '這不是合法的活頁簿 XML');
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    await expect(readWorkbook(bytes)).rejects.toMatchObject({
      code: 'FILE_INVALID',
    });
  });

  it('依中央目錄計算解壓後總大小，超過 50 MB 直接在 exceljs 前拒絕', async () => {
    const zip = new JSZip();
    // 全零資料高度可壓縮，產生的壓縮檔很小但中央目錄標示超大，
    // 受測端必須在 exceljs 展開前先讀大小（防壓縮炸彈）。
    zip.file(
      'xl/worksheets/sheet1.xml',
      new Uint8Array(MAX_WORKBOOK_UNCOMPRESSED_BYTES + 1),
    );
    const bytes = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });

    await expect(readWorkbook(bytes)).rejects.toBeInstanceOf(WorkbookReadError);
    await expect(readWorkbook(bytes)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });
  it('中央目錄與本地標頭偽造成很小的解壓大小時，實際解壓不符仍拒絕為 FILE_INVALID（T051）', async () => {
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', new Uint8Array(MAX_WORKBOOK_UNCOMPRESSED_BYTES + 1));
    const bytes = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    // 把每個本地標頭（offset 22）與中央目錄（offset 24）的 uncompressed size 改成 100。
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index + 4 <= bytes.length; index += 1) {
      const signature = view.getUint32(index, true);
      if (signature === 0x04034b50) view.setUint32(index + 22, 100, true);
      if (signature === 0x02014b50) view.setUint32(index + 24, 100, true);
    }

    await expect(readWorkbook(bytes)).rejects.toMatchObject({
      code: 'FILE_INVALID',
    });
  });
});
