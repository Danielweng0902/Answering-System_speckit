import { describe, expect, it } from 'vitest';
import { buildBlankContent } from '../../src/app/guidedNotesExporter.js';

describe('buildBlankContent（004 US2；T016）', () => {
  it.each([
    {
      name: '前綴為空時只寫答案',
      answers: ['CPU'],
      prefixes: [''],
      expected: ['CPU'],
    },
    {
      name: '題組時保留各自前綴',
      answers: ['CPU', '作業系統'],
      prefixes: ['（1）', '（2）'],
      expected: ['（1）CPU', '（2）作業系統'],
    },
    {
      name: '答案以 = 開頭仍當純文字組合',
      answers: ['=1+1'],
      prefixes: ['（1）'],
      expected: ['（1）=1+1'],
    },
  ])('$name', ({ answers, prefixes, expected }) => {
    expect(buildBlankContent(answers, prefixes)).toEqual(expected);
  });

  it('該題無搶答成功者回傳 null，表示完全不動原檔', () => {
    expect(buildBlankContent(null, ['（1）', '（2）'])).toBeNull();
  });
});
