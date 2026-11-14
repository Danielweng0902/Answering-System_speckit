import JSZip from 'jszip';

/**
 * 004 匯出（T004）：以 jszip 在位元組層替換 xlsx 的目標儲存格 XML。
 *
 * 匯出只修改答案儲存格；其他 entry 一律保持原 byte，使原檔的合併範圍、
 * 欄寬、列高、框線、字型與對齊完整保留（FR-003、research R1）。
 */
export type SheetPathResult = {
  /** 例如 xl/worksheets/sheet2.xml */
  path: string;
};

/** 從一個完整 XML 標籤取出指定屬性；不仰賴屬性出現順序。 */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return match?.[1] ?? null;
}

/**
 * resolveSheetPathFromXml：不依賴 XML 屬性順序（research R3）。
 */
export function resolveSheetPathFromXml(
  workbookXml: string,
  relationshipsXml: string,
  sheetName: string,
): string {
  const sheets = workbookXml.match(/<sheet\b[^>]*\/>/g) ?? [];
  let relationshipId: string | null = null;
  for (const sheet of sheets) {
    if (attribute(sheet, 'name') !== sheetName) {
      continue;
    }
    relationshipId = attribute(sheet, 'r:id');
    break;
  }
  if (relationshipId === null) {
    throw new Error(`工作表不存在：${sheetName}`);
  }

  const relationships =
    relationshipsXml.match(/<Relationship\b[^>]*\/>/g) ?? [];
  let target: string | null = null;
  for (const relationship of relationships) {
    if (attribute(relationship, 'Id') !== relationshipId) {
      continue;
    }
    target = attribute(relationship, 'Target');
    break;
  }
  if (target === null) {
    throw new Error(`找不到工作表 ${sheetName} 對應的檔案`);
  }

  if (target.startsWith('/')) {
    return target.slice(1);
  }
  if (!target.startsWith('xl/')) {
    return `xl/${target}`;
  }
  return target;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 根據前後空白決定是否加 xml:space="preserve"。 */
function inlineStringValue(text: string): string {
  const preserve = text !== text.trim() ? ' xml:space="preserve"' : '';
  return `<is><t${preserve}>${xmlEscape(text)}</t></is>`;
}

/**
 * setCellText：在 sheet XML 中替換指定 A1 cell。
 *
 * 支援 self-closing 與 paired cell；替換前一定移除原 t 屬性，否則原本
 * 有 t="s" 的 cell 會產生重複屬性（research R4）。
 */
export function setCellText(
  sheetXml: string,
  cellCoordinate: string,
  text: string,
): string {
  const selfClosing = new RegExp(
    `<c\\s*r="${escapeRegex(cellCoordinate)}"([^>]*)\\/>`,
  );
  const paired = new RegExp(
    `(<c\\s*r="${escapeRegex(cellCoordinate)}"[^>]*)(>[\\s\\S]*?)(</c>)`,
  );
  const value = inlineStringValue(text);

  if (selfClosing.test(sheetXml)) {
    return sheetXml.replace(selfClosing, (_match, attributes: string) => {
      const cleanAttributes = String(attributes).replace(/\s+t="[^"]*"/g, '');
      return `<c r="${cellCoordinate}"${cleanAttributes} t="inlineStr">${value}</c>`;
    });
  }

  if (paired.test(sheetXml)) {
    return sheetXml.replace(
      paired,
      (_match, open: string, _body: string, close: string) => {
        const cleanAttributes = String(open).replace(/\s+t="[^"]*"/g, '');
        return `${cleanAttributes} t="inlineStr">${value}${close}`;
      },
    );
  }

  throw new Error(`找不到儲存格：${cellCoordinate}`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** replaceCellText：只改一個目標 cell，回傳新的 xlsx 位元組。 */
export async function replaceCellText(
  xlsxBytes: Uint8Array,
  sheetName: string,
  cellCoordinate: string,
  text: string,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(xlsxBytes);
  const workbook = zip.file('xl/workbook.xml');
  const relationships = zip.file('xl/_rels/workbook.xml.rels');
  if (!workbook || !relationships) {
    throw new Error('不是有效的 xlsx：找不到 workbook 定義');
  }

  const sheetPath = resolveSheetPathFromXml(
    await workbook.async('string'),
    await relationships.async('string'),
    sheetName,
  );
  const sheet = zip.file(sheetPath);
  if (!sheet) {
    throw new Error(`找不到工作表檔案：${sheetPath}`);
  }

  zip.file(
    sheetPath,
    setCellText(await sheet.async('string'), cellCoordinate, text),
  );
  const result = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
  return new Uint8Array(result);
}
