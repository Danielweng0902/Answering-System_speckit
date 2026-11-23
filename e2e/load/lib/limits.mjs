/**
 * 負載測試工具的參數上限（B2）。
 *
 * 為什麼要有上限：壓測工具本質上是一個「能送出大量請求的工具」。
 * 目標網址已經有防護（`targetSafety.mjs`：預設只准 loopback、遠端必須
 * HTTPS 且要明確旗標），但參數本身若沒有上限，加上 `--allow-remote`
 * 之後就等同於一個對外壓測器。
 *
 * 這些上限是**硬上限**，不提供旗標放行 —— 因為本機容量測試真正需要的
 * 遠低於此（實測報告用到的最大值是 rate 50／秒、200 名學生、數十秒），
 * 沒有任何合理的課堂規模測試需要超過這些值。
 */

/** 每秒請求數上限（本機 loopback）。 */
export const MAX_RATE_PER_SECOND = 1000;

/** 同時在場的學生數上限（課堂規模 ≈ 200，留 5 倍餘裕）。 */
export const MAX_STUDENTS = 1000;

/** 單次量測的持續秒數上限（1 小時）。 */
export const MAX_SECONDS = 3600;

/** 量測前暖身秒數上限（不得比量測本身還長）。 */
export const MAX_WARMUP_SECONDS = 600;

/** 同時建立的組別數上限（對齊 D20 的 100 組課堂上限）。 */
export const MAX_GROUPS = 100;

/** 每輪作答的題數上限。 */
export const MAX_QUESTIONS = 200;

/** 輪數上限。 */
export const MAX_ROUNDS = 100;

/** 停止負載後的冷卻秒數上限（1 小時）。 */
export const MAX_COOLDOWN_SECONDS = 3600;

/**
 * 檢查數值是否在允許範圍內，超過就丟出帶說明的錯誤。
 *
 * @param {string} label 參數名稱（顯示在錯誤訊息裡）
 * @param {number} value 實際值
 * @param {{ min?: number, max: number, integer?: boolean }} bounds 允許範圍
 */
export function assertWithinLimit(label, value, { min = 0, max, integer = false } = {}) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} 需為有限數值，實際為 ${value}`);
  }
  if (integer && !Number.isSafeInteger(value)) {
    throw new Error(`${label} 須為整數，實際為 ${value}`);
  }
  if (value < min) {
    throw new Error(`${label} 不得小於 ${min}，實際為 ${value}`);
  }
  if (value > max) {
    throw new Error(
      `${label} 不得超過 ${max}，實際為 ${value}。` +
        '這是為了避免壓測工具被當成對外壓測器使用；' +
        '若確實需要更高的量，請改用受控的壓測環境並自行調整上限。',
    );
  }
  return value;
}
