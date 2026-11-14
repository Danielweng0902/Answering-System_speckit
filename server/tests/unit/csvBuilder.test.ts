import { describe, expect, it } from 'vitest';
import {
  buildCsv,
  escapeCsvField,
  safeFormulaGuard,
  type ResultRow,
} from '../../src/app/csvBuilder.js';

const HEADER = '題號,空格序,組別,答案,順位,是否搶答成功,送出時間';
const RECEIVED_AT = '2026-11-14T09:30:00.123Z';

function row(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    questionNumber: 1,
    blankPosition: 1,
    groupName: '第一組',
    answer: '答案',
    rank: 1,
    isWinner: true,
    receivedAt: RECEIVED_AT,
    ...overrides,
  };
}

function text(bytes: Uint8Array): string {
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return Buffer.from(bytes.subarray(3)).toString('utf8');
}

describe('CSV Builder（004 US3；T017）', () => {
  it('UTF-8 BOM 後只有正確的欄位名稱；空資料只有 header', () => {
    expect(text(buildCsv([]))).toBe(HEADER);
  });

  it('一筆作答每個空格一列，搶答成功輸出為是／否，時間保留 ISO 毫秒', () => {
    const output = text(
      buildCsv([
        row({ blankPosition: 2, answer: '第二格', isWinner: false }),
        row({ blankPosition: 1, answer: '第一格' }),
      ]),
    );

    expect(output.split('\r\n')).toEqual([
      HEADER,
      `1,1,第一組,第一格,1,是,${RECEIVED_AT}`,
      `1,2,第一組,第二格,1,否,${RECEIVED_AT}`,
    ]);
  });

  it('排序為題號 → 順位 → 空格序', () => {
    const output = text(
      buildCsv([
        row({ questionNumber: 2, rank: 1, answer: '最後' }),
        row({ questionNumber: 1, rank: 2, blankPosition: 2, answer: '第三' }),
        row({ questionNumber: 1, rank: 2, blankPosition: 1, answer: '第二' }),
        row({ questionNumber: 1, rank: 1, blankPosition: 1, answer: '第一' }),
      ]),
    );

    expect(output.split('\r\n').slice(1).map((line) => line.split(',')[3])).toEqual([
      '第一',
      '第二',
      '第三',
      '最後',
    ]);
  });

  it('CSV 欄位正確處理逗號、引號與 CRLF', () => {
    expect(escapeCsvField('包含,逗號')).toBe('"包含,逗號"');
    expect(escapeCsvField('他說"答案"')).toBe('"他說""答案"""');
    expect(escapeCsvField('第一行\r\n第二行')).toBe('"第一行\r\n第二行"');
  });

  it('=、+、-、@ 開頭的欄位加前導單引號，其他文字不動', () => {
    expect(safeFormulaGuard('=1+1')).toBe("'=1+1");
    expect(safeFormulaGuard('+1')).toBe("'+1");
    expect(safeFormulaGuard('-1')).toBe("'-1");
    expect(safeFormulaGuard('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeFormulaGuard('= 不當公式的中文')).toBe("'= 不當公式的中文");
    expect(safeFormulaGuard('原本文字')).toBe('原本文字');
  });

  it('完整 buildCsv 將公式保護與 CSV 轉義一起套用', () => {
    const output = text(buildCsv([row({ answer: '=1,"x"' })]));
    expect(output.split('\r\n')[1]).toContain(`"'=1,""x"""`);
  });

  it('T027：組別名稱等所有自由文字欄也防公式注入', () => {
    expect(
      text(buildCsv([row({ groupName: '=SUM(1)' })])).split('\r\n')[1],
    ).toContain(",'=SUM(1),");
    expect(
      text(buildCsv([row({ groupName: '@危險組' })])).split('\r\n')[1],
    ).toContain(",'@危險組,");
  });
});
