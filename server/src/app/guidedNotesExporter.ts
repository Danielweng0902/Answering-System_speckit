/**
 * Guided Notes 匯出的純領域組合（004 T009）。
 *
 * 前綴是原本儲存格文字的一部分；寫入時把 prefix 與學生每個空格的答案
 * 組合成「同一格」的文字，而不是拆到兩格（research R5）。
 */
export function buildBlankContent(
  winnerAnswers: readonly string[] | null,
  prefixes: readonly string[],
): string[] | null {
  if (winnerAnswers === null) {
    return null;
  }
  if (winnerAnswers.length !== prefixes.length) {
    throw new Error('搶答成功的答案數與空格數不一致');
  }
  return prefixes.map(
    (prefix, index) => `${prefix}${winnerAnswers[index]}`,
  );
}
