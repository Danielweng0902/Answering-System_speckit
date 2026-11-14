export type ResultRow = {
  questionNumber: number;
  blankPosition: number;
  groupName: string;
  answer: string;
  rank: number;
  isWinner: boolean;
  receivedAt: string;
};

const HEADER =
  '題號,空格序,組別,答案,順位,是否搶答成功,送出時間';

/** 試算表公式注入保護（FR-014）：只有欄位的原始第一個字元需要判斷。 */
export function safeFormulaGuard(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** RFC 4180 轉義：逗號、引號或 newline 要以雙引號包住。 */
export function escapeCsvField(value: string | number): string {
  const text = String(value);
  if (!/[,"\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function serialize(row: ResultRow): string {
  return [
    row.questionNumber,
    row.blankPosition,
    escapeCsvField(row.groupName),
    escapeCsvField(safeFormulaGuard(row.answer)),
    row.rank,
    row.isWinner ? '是' : '否',
    row.receivedAt,
  ].join(',');
}

/**
 * 004（T020）：產出 UTF-8 CSV；BOM 與 CRLF 讓 Excel 不亂碼，
 * 且作廢作答必須由 repo 查詢流程排除，不送到這裡。
 */
export function buildCsv(rows: readonly ResultRow[]): Uint8Array {
  const sortedRows = [...rows].sort(
    (a, b) =>
      a.questionNumber - b.questionNumber ||
      a.rank - b.rank ||
      a.blankPosition - b.blankPosition,
  );
  const text = [HEADER, ...sortedRows.map(serialize)].join('\r\n');
  return new TextEncoder().encode(`\uFEFF${text}`);
}
