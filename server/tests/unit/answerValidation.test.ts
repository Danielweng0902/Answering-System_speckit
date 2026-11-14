import { describe, expect, it } from 'vitest';
import { validateAnswer } from '../../src/domain/answerValidation.js';

describe('validateAnswer（003 FR-006）', () => {
  it('去除答案前後的半形與全形空白（U+3000）後保存', () => {
    expect(
      validateAnswer(' \t\u3000  半形與全形空白  \u3000\n '),
    ).toEqual({ ok: true, answer: '半形與全形空白' });
  });

  it('200 個 BMP 字元通過，trim 後才計算長度', () => {
    const answer = '界'.repeat(200);

    expect(validateAnswer(` \u3000${answer}\u3000 `)).toEqual({
      ok: true,
      answer,
    });
  });

  it('代理對 emoji 各算一個 Unicode code point，200 個可以通過', () => {
    expect(validateAnswer('🎉')).toEqual({ ok: true, answer: '🎉' });

    const answer = '🎉'.repeat(200);
    expect(validateAnswer(answer)).toEqual({ ok: true, answer });
  });

  it.each(['界'.repeat(201), '🎉'.repeat(201)])(
    '201 個 Unicode code point 拒絕 ANSWER_TOO_LONG',
    (answer) => {
      expect(validateAnswer(answer)).toEqual({
        ok: false,
        code: 'ANSWER_TOO_LONG',
      });
    },
  );

  it('trim 後才計算上限，前後空白不計入 200 字', () => {
    const answer = '答'.repeat(201);

    expect(validateAnswer(` \u3000${answer}\u3000 `)).toEqual({
      ok: false,
      code: 'ANSWER_TOO_LONG',
    });
  });

  it.each(['', ' ', '\t\n', '\u3000 \u3000'])(
    '空字串或純空白 %j 拒絕 ANSWER_EMPTY',
    (answer) => {
      expect(validateAnswer(answer)).toEqual({
        ok: false,
        code: 'ANSWER_EMPTY',
      });
    },
  );

  it('<script>、反引號與模板字元等特殊內容都照原文保留', () => {
    const answer = '<script>alert("x")</script> `sample` ${notExecuted}';

    expect(validateAnswer(` \u3000${answer}\u3000 `)).toEqual({
      ok: true,
      answer,
    });
  });
});
