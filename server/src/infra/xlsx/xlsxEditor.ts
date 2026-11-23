import JSZip from 'jszip';

/**
 * 004 匯出（T004）：以 jszip 在位元組層替換 xlsx 的目標儲存格 XML。
 *
 * 匯出只修改答案儲存格；其餘 zip entry 的**解壓縮內容**保持 byte-identical，
 * 讓原檔的合併範圍、欄寬、列高、框線、字型與對齊完整保留
 * （重新 DEFLATE 的 ZIP 封裝位元組不在驗證範圍，FR-003、research R1）。
 */
export type SheetPathResult = {
  /** 例如 xl/worksheets/sheet2.xml */
  path: string;
};

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/** XML 屬性值先解 entity；與 002 由 parser 取得的 sheetName 對比。 */
function xmlUnescape(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (entity) => {
    const mapped = XML_ENTITIES[entity];
    if (mapped !== undefined) {
      return mapped;
    }
    return String.fromCodePoint(
      entity.startsWith('&#x')
        ? Number.parseInt(entity.slice(3, -1), 16)
        : Number.parseInt(entity.slice(2, -1), 10),
    );
  });
}

/** 從一個完整 XML 標籤取出屬性並解 entity；不仰賴排列順序。 */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag);
  const value = match?.[1];
  return value === undefined ? null : xmlUnescape(value);
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

  const relationships = relationshipsXml.match(/<Relationship\b[^>]*\/>/g) ?? [];
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

/** XML 1.0 禁用控制字元；tab、LF、CR 合法（T027）。 */
function isForbiddenXmlCharacter(text: string): boolean {
  const code = text.codePointAt(0)!;
  return code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f);
}

function xmlEscape(value: string): string {
  const withoutOoxmlMarkers = value.replace(/_x([0-9a-fA-F]{4})_/g, '_x005F_x$1_');
  const withControlsEscaped = Array.from(withoutOoxmlMarkers, (character) =>
    isForbiddenXmlCharacter(character)
      ? `_x${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}_`
      : character,
  ).join('');
  return withControlsEscaped.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
export function setCellText(sheetXml: string, cellCoordinate: string, text: string): string {
  const selfClosing = new RegExp(`<c\\s*r="${escapeRegex(cellCoordinate)}"([^>]*)\\/>`);
  const paired = new RegExp(`(<c\\s*r="${escapeRegex(cellCoordinate)}"[^>]*)(>[\\s\\S]*?)(</c>)`);
  const value = inlineStringValue(text);

  if (selfClosing.test(sheetXml)) {
    return sheetXml.replace(selfClosing, (_match, attributes: string) => {
      const cleanAttributes = String(attributes).replace(/\s+t="[^"]*"/g, '');
      return `<c r="${cellCoordinate}"${cleanAttributes} t="inlineStr">${value}</c>`;
    });
  }

  if (paired.test(sheetXml)) {
    return sheetXml.replace(paired, (_match, open: string, _body: string, close: string) => {
      const cleanAttributes = String(open).replace(/\s+t="[^"]*"/g, '');
      return `${cleanAttributes} t="inlineStr">${value}${close}`;
    });
  }

  throw new Error(`找不到儲存格：${cellCoordinate}`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type WorksheetHandle = {
  zip: JSZip;
  path: string;
  xml: string;
  /**
   * 原檔每個 zip 項目的時間戳。
   *
   * 2026-11-23：JSZip 在重新加入檔案時，會把**資料夾項目**（`xl/`、
   * `xl/worksheets/`）的時間戳設成「現在」；zip 的 DOS 時間只有 2 秒精度，
   * 所以同一份輸入在不同的秒數匯出會得到不同的位元組，讓「同一場活動匯出
   * 兩次內容相同」（AC-004-07）有時會失敗。
   *
   * 還原所有項目的原始時間戳，輸出就只取決於輸入 → 匯出結果可重現。
   */
  originalDates: Map<string, Date>;
};

/** 找不到原檔時間戳時的固定值（zip 能表示的最早時間）。 */
const FALLBACK_ZIP_DATE = new Date('1980-01-01T00:00:00.000Z');

async function openWorksheet(xlsxBytes: Uint8Array, sheetName: string): Promise<WorksheetHandle> {
  const zip = await JSZip.loadAsync(xlsxBytes);
  const workbook = zip.file('xl/workbook.xml');
  const relationships = zip.file('xl/_rels/workbook.xml.rels');
  if (!workbook || !relationships) {
    throw new Error('不是有效的 xlsx：找不到 workbook 定義');
  }

  const path = resolveSheetPathFromXml(
    await workbook.async('string'),
    await relationships.async('string'),
    sheetName,
  );
  const sheet = zip.file(path);
  if (!sheet) {
    throw new Error(`找不到工作表檔案：${path}`);
  }
  const originalDates = new Map<string, Date>();
  for (const [name, entry] of Object.entries(zip.files)) {
    originalDates.set(name, entry.date);
  }
  return { zip, path, xml: await sheet.async('string'), originalDates };
}

/** 供匯出流程一次讀取原檔的 merge range，用來判定右側是否為獨立答案格。 */
export async function getWorksheetXml(xlsxBytes: Uint8Array, sheetName: string): Promise<string> {
  return (await openWorksheet(xlsxBytes, sheetName)).xml;
}

function parseA1Cell(cellCoordinate: string): { column: number; row: number } {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(cellCoordinate);
  if (match === null) {
    throw new Error(`不是有效的 A1 儲存格：${cellCoordinate}`);
  }
  let column = 0;
  for (const character of match[1]!) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { column, row: Number(match[2]) };
}

function mergeRangeContains(
  start: { column: number; row: number },
  end: { column: number; row: number },
  cell: { column: number; row: number },
): boolean {
  return (
    cell.column >= start.column &&
    cell.column <= end.column &&
    cell.row >= start.row &&
    cell.row <= end.row
  );
}

/** 指定 cell 是否與右側 cell 屬於同一個合併儲存格。 */
export function isMergedWithRightCell(sheetXml: string, cellCoordinate: string): boolean {
  const cell = parseA1Cell(cellCoordinate);
  const rightCell = { column: cell.column + 1, row: cell.row };
  const mergeReferences = [...sheetXml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"[^>]*\/>/g)].map(
    (match) => match[1]!,
  );

  return mergeReferences.some((reference) => {
    const [startReference, endReference] = reference.split(':');
    if (startReference === undefined || endReference === undefined) {
      return false;
    }
    const start = parseA1Cell(startReference);
    const end = parseA1Cell(endReference);
    return mergeRangeContains(start, end, cell) && mergeRangeContains(start, end, rightCell);
  });
}

/** replaceCellText：只改一個目標 cell，回傳新的 xlsx 位元組。 */
export async function replaceCellText(
  xlsxBytes: Uint8Array,
  sheetName: string,
  cellCoordinate: string,
  text: string,
): Promise<Uint8Array> {
  const { zip, path, xml, originalDates } = await openWorksheet(xlsxBytes, sheetName);
  zip.file(path, setCellText(xml, cellCoordinate, text));
  // 2026-11-23：還原每個項目的原始時間戳（JSZip 會把資料夾項目設成「現在」），
  // 讓「同一份輸入 → 同一份位元組」成立（AC-004-07：同一場活動匯出兩次相同）。
  for (const [name, entry] of Object.entries(zip.files)) {
    const original = originalDates.get(name);
    entry.date = original === undefined || Number.isNaN(original.getTime())
      ? FALLBACK_ZIP_DATE
      : original;
  }
  const result = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
  return new Uint8Array(result);
}
