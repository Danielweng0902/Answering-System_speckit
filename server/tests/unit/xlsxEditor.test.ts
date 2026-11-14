import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  replaceCellText,
  resolveSheetPathFromXml,
  setCellText,
} from '../../src/infra/xlsx/xlsxEditor.js';

function fixtureUrl(fileName: string): string {
  return fileURLToPath(
    new URL(`../../../fixtures/guided-notes/${fileName}`, import.meta.url),
  );
}

async function fixtureBytes(fileName: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixtureUrl(fileName)));
}

async function entries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(bytes);
  const result = new Map<string, Uint8Array>();
  await Promise.all(
    Object.entries(zip.files).map(async ([name, file]) => {
      if (!file.dir) {
        result.set(name, await file.async('uint8array'));
      }
    }),
  );
  return result;
}

async function readCell(
  bytes: Uint8Array,
  sheetName: string,
  cell: string,
): Promise<{
  text: unknown;
  style: {
    font?: { size?: number };
    border?: { bottom?: { style?: string } };
    alignment?: { vertical?: string };
  };
  type: number;
  font: unknown;
  border: unknown;
  alignment: unknown;
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const worksheet = workbook.getWorksheet(sheetName);
  expect(worksheet).toBeDefined();
  const found = worksheet!.getCell(cell);
  const text =
    typeof found.value === 'object' && found.value !== null
      ? (
          found.value as { richText?: Array<{ text: string }> }
        ).richText
          ?.map((part) => part.text)
          .join('') ?? found.value
      : found.value;
  return {
    text,
    style: found.style as {
      font?: { size?: number };
      border?: { bottom?: { style?: string } };
      alignment?: { vertical?: string };
    },
    type: found.type,
    font: found.font,
    border: found.border,
    alignment: found.alignment,
  };
}

describe('xlsxEditor（004 Foundational；T002～T005）', () => {
  it('透過工作表名稱解析檔案路徑，不依賴 XML 屬性順序（research R3）', () => {
    const workbookXml = [
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<sheets>',
      '<sheet r:id="rId2" sheetId="2" name="學習單" state="visible"/>',
      '<sheet name="說明" state="hidden" sheetId="1" r:id="rId1"/>',
      '</sheets></workbook>',
    ].join('');
    const relsXml = [
      '<Relationships>',
      '<Relationship Target="worksheets/sheet1.xml" Type="x" Id="rId1"/>',
      '<Relationship Target="worksheets/sheet2.xml" Type="x" Id="rId2"/>',
      '</Relationships>',
    ].join('');

    expect(
      resolveSheetPathFromXml(workbookXml, relsXml, '學習單'),
    ).toBe('xl/worksheets/sheet2.xml');

    expect(
      resolveSheetPathFromXml(
        workbookXml.replace(
          'name="學習單"',
          'name="Q&amp;A &#38; 學習單"',
        ),
        relsXml,
        'Q&A & 學習單',
      ),
    ).toBe('xl/worksheets/sheet2.xml');
  });

  it('替換空殼 cell 時保留樣式索引，且產出是合法 xlsx（02）', async () => {
    const original = await fixtureBytes('02-official-group.xlsx');
    const changed = await replaceCellText(
      original,
      '學習單',
      'G5',
      '（1）CPU',
    );
    const cell = await readCell(changed, '學習單', 'G5');

    expect(cell.text).toBe('（1）CPU');
    expect(cell.style?.font?.size).toBe(11);
    expect(cell.style?.border?.bottom?.style).toBe('thin');
    expect(cell.style?.alignment?.vertical).toBe('middle');
    expect(cell.type).not.toBe(2);
  });

  it('原本已有 t="s" 的 cell 不得產生重複屬性，輸出仍可讀（research R4）', async () => {
    const original = await fixtureBytes('01-official-single.xlsx');
    const changed = await replaceCellText(
      original,
      '學習單',
      'G5',
      '直接寫入的答案',
    );

    await expect(readCell(changed, '學習單', 'G5')).resolves.toBeDefined();
    const rewritten = setCellText(
      '<c r="G5" s="15" t="s"><v>5</v></c>',
      'G5',
      '文字',
    );
    expect(rewritten.match(/\bt="/g)).toHaveLength(1);
    expect(rewritten).toContain('t="inlineStr"');
  });

  it('寫入公式字樣與特殊字元時仍是純文字，並以 XML 跳脫（FR-006）', async () => {
    const original = await fixtureBytes('01-official-single.xlsx');
    const changed = await replaceCellText(
      original,
      '學習單',
      'G5',
      ' =1+1 & <tag> ',
    );
    const cell = await readCell(changed, '學習單', 'G5');

    expect(cell.text).toBe(' =1+1 & <tag> ');
    expect(cell.type).toBe(3);
    expect(
      setCellText('<c r="G5" s="15"/>', 'G5', ' =1+1 & <tag> '),
    ).toContain('xml:space="preserve"');
    expect(
      setCellText('<c r="G5" s="15"/>', 'G5', ' =1+1 & <tag> '),
    ).toContain(' =1+1 &amp; &lt;tag&gt; ');
    expect(
      setCellText('<c r="G5" s="15"/>', 'G5', '=1+1'),
    ).not.toContain('<f>');
  });

  it('T027：XML 1.0 禁用控制字元以 OOXML 編碼，literal _xHHHH_ 不誤解碼', async () => {
    const original = await fixtureBytes('01-official-single.xlsx');
    const changed = await replaceCellText(
      original,
      '學習單',
      'G5',
      '\u0000\u0001x_x0001_y',
    );

    await expect(readCell(changed, '學習單', 'G5')).resolves.toBeDefined();
    const rewritten = setCellText(
      '<c r="G5" s="15"/>',
      'G5',
      '\u0000\u0001x_x0001_y',
    );
    const hasDisallowedControl = Array.from(rewritten).some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f);
    });
    expect(hasDisallowedControl).toBe(false);
    expect(rewritten).toContain('_x0000__x0001_x_x005F_x0001_y');
  });

  it('替換後只改目標 sheet XML，其餘解壓縮 zip entry 保持 byte-identical（research R1）', async () => {
    const original = await fixtureBytes('05-two-sheets.xlsx');
    const changed = await replaceCellText(
      original,
      '學習單',
      'G5',
      '只在第二工作表寫入',
    );

    const before = await entries(original);
    const after = await entries(changed);
    const changedEntries = [...after.entries()].filter(
      ([name, bytes]) =>
        !before.has(name) ||
        !Buffer.from(before.get(name)!).equals(Buffer.from(bytes)),
    );
    const removed = [...before.keys()].filter((name) => !after.has(name));

    expect(changedEntries.map(([name]) => name)).toEqual([
      'xl/worksheets/sheet2.xml',
    ]);
    expect(removed).toEqual([]);
  });

  it('工作表不存在或 cell 不存在時回報明確錯誤，不產生錯的檔案', async () => {
    const original = await fixtureBytes('01-official-single.xlsx');
    await expect(
      replaceCellText(original, '不存在', 'G5', 'xx'),
    ).rejects.toThrow('工作表');

    expect(() =>
      setCellText('<c r="A1" s="1"/>', 'G5', 'xx'),
    ).toThrow('G5');
  });

  it('所有 fixture 的空格 cell 都存在，替換時不需要插入新 row（004 plan）', async () => {
    const expectedPath = fixtureUrl('expected.json');
    const expected = JSON.parse(await readFile(expectedPath, 'utf8')) as Array<{
      valid: boolean;
      file: string;
      sheet: string;
      questions: Array<{ number: number; blanks: Array<{ cell: string }> }>;
    }>;

    const valid = expected.filter((entry) => entry.valid);
    expect(valid).toHaveLength(5);
    expect(
      valid.flatMap((entry) => entry.questions.flatMap((question) => question.blanks))
        .length,
    ).toBe(36);

    for (const entry of valid) {
      const original = await fixtureBytes(entry.file);
      for (const question of entry.questions) {
        const firstBlank = question.blanks.at(-1) ?? question.blanks[0]!;
        const changed = await replaceCellText(
          original,
          entry.sheet,
          firstBlank.cell,
          `題 ${question.number} 驗證`,
        );
        expect(
          await readCell(changed, entry.sheet, firstBlank.cell).then(
            (cell) => cell.text,
          ),
        ).toBe(`題 ${question.number} 驗證`);
      }
    }
  }, 10_000);
});
