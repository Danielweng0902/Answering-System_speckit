/**
 * 作答文字驗證（003 FR-006、research R6）。
 *
 * 先依 JavaScript 的 Unicode WhiteSpace 規則 trim（包含 U+3000），再以
 * Unicode code point 計算長度；成功時回傳要保存的 trimmed 原文。
 */
import type { ErrorCode } from '@classroom/shared';

export const MAX_ANSWER_LENGTH = 200;

export type AnswerValidationResult =
  | { ok: true; answer: string }
  | { ok: false; code: Extract<ErrorCode, 'ANSWER_EMPTY' | 'ANSWER_TOO_LONG'> };

export function validateAnswer(input: string): AnswerValidationResult {
  const answer = input.trim();
  if (answer === '') {
    return { ok: false, code: 'ANSWER_EMPTY' };
  }

  const codePointCount = Array.from(answer).length;
  if (codePointCount > MAX_ANSWER_LENGTH) {
    return { ok: false, code: 'ANSWER_TOO_LONG' };
  }

  return { ok: true, answer };
}
