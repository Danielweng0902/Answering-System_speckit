import { describe, expect, it } from 'vitest';
import {
  detectLanguage,
  formatMessage,
  translate,
} from '../src/lib/i18n/language';
import { MESSAGES, en, zhTW } from '../src/lib/i18n/messages';
import { ERROR_MESSAGES_EN } from '../src/lib/i18n/errors';

describe('007 i18n：語言判定與訊息', () => {
  it('沒選過語言時依瀏覽器語言判定：英文優先、繁中其次', () => {
    expect(detectLanguage(null, ['en-US', 'zh-TW'])).toBe('en');
    expect(detectLanguage(null, ['zh-TW', 'en-US'])).toBe('zh-TW');
    expect(detectLanguage(null, ['zh-Hant-TW'])).toBe('zh-TW');
    // 其他語言（例：日文）→ 繁體中文（這個系統本來就繁中優先）。
    expect(detectLanguage(null, ['ja-JP'])).toBe('zh-TW');
    expect(detectLanguage(null, [])).toBe('zh-TW');
  });

  it('使用者自己選過就用他選的（不受瀏覽器語言影響）', () => {
    expect(detectLanguage('zh-TW', ['en-US'])).toBe('zh-TW');
    expect(detectLanguage('en', ['zh-TW'])).toBe('en');
    // 存了不認識的值 → 當作沒選過。
    expect(detectLanguage('fr', ['en-US'])).toBe('en');
  });

  it('訊息表的兩種語言 key 完全相同', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhTW).sort());
  });

  it('每一則訊息在兩種語言都不是空的', () => {
    for (const [key, value] of Object.entries(zhTW)) {
      expect(value.trim(), `zhTW.${key}`).not.toBe('');
      expect(en[key as keyof typeof en].trim(), `en.${key}`).not.toBe('');
    }
  });

  it('插值會取代 {name}，沒有參數就留空', () => {
    expect(formatMessage('第 {number} 題', { number: 3 })).toBe('第 3 題');
    expect(formatMessage('第 {number} 題')).toBe('第  題');
    expect(formatMessage('沒有佔位符')).toBe('沒有佔位符');
  });

  it('translate 依語言取訊息並代入參數', () => {
    expect(translate('zh-TW', MESSAGES['zh-TW'], 'phase.open')).toBe('搶答中');
    expect(translate('en', MESSAGES.en, 'phase.open')).toBe('Buzzing');
    expect(
      translate('en', MESSAGES.en, 'phase.current', { phase: 'Buzzing' }),
    ).toBe('Current phase: Buzzing');
  });

  it('伺服器錯誤訊息有英文對應（共用契約不動，客戶端翻譯）', () => {
    // 幾個會直接顯示在畫面上的錯誤一定要有英文。
    for (const code of [
      'UNAUTHORIZED',
      'WRONG_PASSWORD',
      'ANSWER_EMPTY',
      'ALREADY_SUBMITTED',
      'SHEET_MODIFIED',
      'SHEET_CHECK_FAILED',
      'FILE_INVALID',
    ] as const) {
      expect(ERROR_MESSAGES_EN[code], code).toBeDefined();
    }
  });
});
