import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ImportSummary, TeacherSnapshot } from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importFromFile, importFromLink } from '../../src/lib/api';
import { QuestionImport } from '../../src/features/teacher/QuestionImport';

vi.mock('../../src/lib/api', () => ({
  importFromFile: vi.fn(),
  importFromLink: vi.fn(),
}));

vi.mock('../../src/lib/socket', () => ({
  sendCommand: vi.fn(),
}));

function makeSnapshot(
  overrides: Partial<TeacherSnapshot> = {},
): TeacherSnapshot {
  return {
    revision: 1,
    serverNow: '2026-11-12T00:00:00.000Z',
    phase: 'preparing',
    countdownEndsAt: null,
    groups: [],
    presence: {},
    role: 'teacher',
    questions: [],
    guidedNotes: null,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    importId: 'import-1',
    sheetName: '學習單',
    questionCount: 4,
    blankCount: 6,
    questions: [
      {
        number: 1,
        kind: 'group',
        prompt: '第一題',
        blankCount: 2,
        blanks: [
          { prefix: '（1）', cell: 'G5' },
          { prefix: '（2）', cell: 'G6' },
        ],
      },
      {
        number: 2,
        kind: 'group',
        prompt: '第二題',
        blankCount: 2,
        blanks: [
          { prefix: '(1)', cell: 'G8' },
          { prefix: '(2)', cell: 'G9' },
        ],
      },
      {
        number: 3,
        kind: 'single',
        prompt: '第三題',
        blankCount: 1,
        blanks: [{ prefix: '', cell: 'G11' }],
      },
      {
        number: 4,
        kind: 'single',
        prompt: '第四題',
        blankCount: 1,
        blanks: [{ prefix: '', cell: 'G13' }],
      },
    ],
    warnings: [],
    replacesExisting: false,
    ...overrides,
  };
}

function submitLink(): void {
  fireEvent.change(screen.getByLabelText('Google 試算表連結'), {
    target: {
      value: 'https://docs.google.com/spreadsheets/d/abc/edit#gid=0',
    },
  });
  fireEvent.click(screen.getByRole('button', { name: '讀取' }));
}

function uploadFile(): void {
  const input = screen.getByLabelText<HTMLInputElement>('上傳 xlsx 檔', {
    exact: true,
  });
  fireEvent.change(input, {
    target: { files: [new File(['xlsx'], 'guided-notes.xlsx')] },
  });
}

describe('QuestionImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('摘要顯示工作表、每則提醒 message、每題類型與空格數、題組前綴與取代提示', async () => {
    vi.mocked(importFromLink).mockResolvedValue({
      ok: true,
      summary: makeSummary({
        replacesExisting: true,
        warnings: [
          {
            code: 'NUMBERS_NOT_SEQUENTIAL',
            message: '題號不連續：1、2、4',
            numbers: [1, 2, 4],
          },
          {
            code: 'MULTIPLE_SHEETS_WITH_HEADER',
            message: '多個工作表都有表頭，使用「學習單」',
            sheetName: '學習單',
          },
          {
            code: 'BLANK_HAS_CONTENT',
            message: '第 3 題的空格 G11 已有內容',
            number: 3,
            cell: 'G11',
          },
        ],
      }),
    });

    render(<QuestionImport snapshot={makeSnapshot()} />);
    submitLink();

    const summary = await screen.findByRole('region', { name: '匯入摘要' });
    const text = summary.textContent ?? '';

    expect(text).toContain('工作表：學習單');
    expect(text).toContain('共 4 題、6 個空格');
    expect(text).toContain('題號不連續：1、2、4');
    expect(text).toContain('多個工作表都有表頭，使用「學習單」');
    expect(text).toContain('第 3 題的空格 G11 已有內容');

    expect(text).toContain('第 1 題（題組，2 個空格）');
    expect(text).toContain('第 2 題（題組，2 個空格）');
    expect(text).toContain('第 3 題（單題，1 個空格）');
    expect(text).toContain('第 4 題（單題，1 個空格）');
    expect(text).toContain('第 1、2 題是題組');
    expect(text).toContain('前綴：（1）、（2）');
    expect(text).toContain('前綴：(1)、(2)');

    expect(text).toContain('確認後會取代現有題目');
  });

  it('連結錯誤 LINK_NOT_SHARED 顯示伺服器 message 與兩個替代做法', async () => {
    vi.mocked(importFromLink).mockResolvedValue({
      ok: false,
      error: { code: 'LINK_NOT_SHARED', message: '伺服器：試算表未開放檢視' },
    });

    render(<QuestionImport snapshot={makeSnapshot()} />);
    submitLink();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('伺服器：試算表未開放檢視');
    expect(
      screen.getByText('把共用設定改成知道連結者可檢視'),
    ).toBeDefined();
    expect(screen.getByText('下載成 xlsx 後上傳')).toBeDefined();
  });

  for (const code of ['LINK_INVALID', 'LINK_UNREACHABLE'] as const) {
    it(`連結錯誤 ${code} 也附上兩個替代做法`, async () => {
      vi.mocked(importFromLink).mockResolvedValue({
        ok: false,
        error: { code, message: `伺服器訊息：${code}` },
      });

      render(<QuestionImport snapshot={makeSnapshot()} />);
      submitLink();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(`伺服器訊息：${code}`);
      expect(
        screen.getByText('把共用設定改成知道連結者可檢視'),
      ).toBeDefined();
      expect(screen.getByText('下載成 xlsx 後上傳')).toBeDefined();
    });
  }

  for (const code of ['FILE_INVALID', 'FILE_TOO_LARGE'] as const) {
    it(`檔案錯誤 ${code} 顯示伺服器 message 並說明 xlsx、5 MB 以內`, async () => {
      vi.mocked(importFromFile).mockResolvedValue({
        ok: false,
        error: { code, message: `伺服器訊息：${code}` },
      });

      render(<QuestionImport snapshot={makeSnapshot()} />);
      uploadFile();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(`伺服器訊息：${code}`);
      expect(
        screen.getByText('請使用 xlsx 格式、5 MB 以內的學習單'),
      ).toBeDefined();
      expect(
        screen.queryByText('把共用設定改成知道連結者可檢視'),
      ).toBeNull();
      expect(screen.queryByText('下載成 xlsx 後上傳')).toBeNull();
    });
  }

  it('內容錯誤只顯示伺服器 message，不加連結或檔案格式提示', async () => {
    vi.mocked(importFromFile).mockResolvedValue({
      ok: false,
      error: {
        code: 'DUPLICATE_QUESTION_NUMBER',
        message: '題號 3 重複（第 9、11 列），請修正後重新匯入',
      },
    });

    render(<QuestionImport snapshot={makeSnapshot()} />);
    uploadFile();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('題號 3 重複（第 9、11 列）');
    expect(
      screen.queryByText('請使用 xlsx 格式、5 MB 以內的學習單'),
    ).toBeNull();
    expect(screen.queryByRole('region', { name: '匯入摘要' })).toBeNull();
  });
});
