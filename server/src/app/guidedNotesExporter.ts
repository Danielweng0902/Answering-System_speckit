/**
 * Guided Notes 匯出的純領域組合（004 T009）。
 *
 * 002 的 `blanks.cell` 依結構定位到填寫區。題組有兩種版面：
 * - 前綴與答案是分開的兩格（例如 02）：前綴保持原格，答案寫右側獨立格。
 * - 前綴本身就在合併填答區裡（例如 04）：此合併格就是答案格，寫入
 *   「前綴＋答案」，不再額外搬移。
 * 「是否分開」由 xlsx 的 merge range 判定，不寫死座標（2026-11-16 R5 修訂）。
 */
export type GuidedNotesBlank = {
  /** 題組前綴文字；單題為空字串。 */
  prefix: string;
  /** 002 依結構解析保存的 A1 位置。 */
  cell: string;
  /** 前綴格右側是否有獨立答案格；由 merge range 判定。 */
  hasSeparateRightAnswerCell?: boolean;
};

export type BlankWrite = {
  /** 最終要寫入答案的 A1 位置。 */
  cell: string;
  /** 要寫入的文字（獨立答案格不含前綴；合併填答區含原前綴）。 */
  content: string;
};

const A1_PATTERN = /^([A-Z]+)([1-9][0-9]*)$/;

function columnToNumber(column: string): number {
  let result = 0;
  for (const character of column) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result;
}

function numberToColumn(value: number): string {
  let remaining = value;
  let result = '';
  while (remaining > 0) {
    const mod = (remaining - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return result;
}

function rightOf(cell: string): string {
  const match = A1_PATTERN.exec(cell);
  if (match === null) {
    throw new Error(`無法由結構判定答案格：${cell}`);
  }
  return `${numberToColumn(columnToNumber(match[1]!) + 1)}${match[2]}`;
}

function hasSeparateRightAnswerCell(blank: GuidedNotesBlank): boolean {
  return blank.prefix !== '' && blank.hasSeparateRightAnswerCell === true;
}

/**
 * 前綴格右側是獨立答案格時才右移；前綴已在合併填答區時仍寫原格。
 * 單題（prefix 為空）一律維持原格。
 */
export function answerCellForBlank(blank: GuidedNotesBlank): string {
  return hasSeparateRightAnswerCell(blank) ? rightOf(blank.cell) : blank.cell;
}

/** 該題無人作答回傳 null；有答案時依序對應每個空格，並決定正確寫入位置。 */
export function buildBlankWrites(
  winnerAnswers: readonly string[] | null,
  blanks: readonly GuidedNotesBlank[],
): BlankWrite[] | null {
  if (winnerAnswers === null) {
    return null;
  }
  if (winnerAnswers.length !== blanks.length) {
    throw new Error('搶答成功的答案數與空格數不一致');
  }
  return winnerAnswers.map((answer, index) => {
    const blank = blanks[index]!;
    const separate = hasSeparateRightAnswerCell(blank);
    return {
      cell: separate ? rightOf(blank.cell) : blank.cell,
      content: separate ? answer : `${blank.prefix}${answer}`,
    };
  });
}
