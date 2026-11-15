import { describe, expect, it } from 'vitest';
import { answerCellForBlank, buildBlankWrites } from '../../src/app/guidedNotesExporter.js';

describe('buildBlankWrites（004 US2；T016，2026-11-16 修訂）', () => {
  it.each([
    {
      name: '單題前綴為空時仍在原填空格寫答案',
      answers: ['CPU'],
      blanks: [{ prefix: '', cell: 'G5' }],
      expected: [{ cell: 'G5', content: 'CPU' }],
    },
    {
      name: '題組前綴格保持原樣，答案寫入右側獨立答案格',
      answers: ['CPU', '作業系統'],
      blanks: [
        { prefix: '（1）', cell: 'G5', hasSeparateRightAnswerCell: true },
        { prefix: '（2）', cell: 'G6', hasSeparateRightAnswerCell: true },
      ],
      expected: [
        { cell: 'H5', content: 'CPU' },
        { cell: 'H6', content: '作業系統' },
      ],
    },
    {
      name: '前綴在原檔的合併填答區內時，此格本身是答案格',
      answers: ['封包交換'],
      blanks: [{ prefix: '（1）', cell: 'G7', hasSeparateRightAnswerCell: false }],
      expected: [{ cell: 'G7', content: '（1）封包交換' }],
    },
    {
      name: '答案以 = 開頭仍輸出原始文字，不由這一層加工',
      answers: ['=1+1'],
      blanks: [{ prefix: '（1）', cell: 'G7', hasSeparateRightAnswerCell: true }],
      expected: [{ cell: 'H7', content: '=1+1' }],
    },
    {
      name: '多位數欄位的前綴格仍只右移一欄',
      answers: ['答案'],
      blanks: [
        {
          prefix: '（1）',
          cell: 'AA12',
          hasSeparateRightAnswerCell: true,
        },
      ],
      expected: [{ cell: 'AB12', content: '答案' }],
    },
  ])('$name', ({ answers, blanks, expected }) => {
    expect(buildBlankWrites(answers, blanks)).toEqual(expected);
  });

  it('answerCellForBlank 依原檔結構判斷原格或右側答案格', () => {
    expect(answerCellForBlank({ prefix: '', cell: 'G11' })).toBe('G11');
    expect(
      answerCellForBlank({
        prefix: '（1）',
        cell: 'G11',
        hasSeparateRightAnswerCell: true,
      }),
    ).toBe('H11');
    expect(
      answerCellForBlank({
        prefix: '（2）',
        cell: 'AB9',
        hasSeparateRightAnswerCell: true,
      }),
    ).toBe('AC9');
    expect(
      answerCellForBlank({
        prefix: '（1）',
        cell: 'G7',
        hasSeparateRightAnswerCell: false,
      }),
    ).toBe('G7');
  });

  it('該題無搶答成功者回傳 null，表示完全不動原檔', () => {
    expect(
      buildBlankWrites(null, [
        { prefix: '（1）', cell: 'G5' },
        { prefix: '（2）', cell: 'G6' },
      ]),
    ).toBeNull();
  });

  it('答案數與空格數不一致時立即失敗，不寫出半套答案', () => {
    expect(() =>
      buildBlankWrites(
        ['只有一個答案'],
        [
          { prefix: '（1）', cell: 'G5' },
          { prefix: '（2）', cell: 'G6' },
        ],
      ),
    ).toThrow('搶答成功的答案數與空格數不一致');
  });
});
