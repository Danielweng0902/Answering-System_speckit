import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TeacherSnapshot } from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeacherPage } from '../../src/features/teacher/TeacherPage';

const writeBackGuidedNotes = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/api')>();
  return {
    ...actual,
    writeBackGuidedNotes,
  };
});

function makeSnapshot(
  overrides: Partial<TeacherSnapshot> = {},
): TeacherSnapshot {
  return {
    revision: 1,
    serverNow: '2026-11-17T09:00:00.000Z',
    phase: 'closed',
    countdownEndsAt: null,
    groups: [],
    presence: {},
    questions: [],
    guidedNotes: {
      sheetName: '學習單',
      sourceKind: 'link',
      fileName: null,
      importedAt: '2026-11-17T09:00:00.000Z',
    },
    role: 'teacher',
    fairRankingEnabled: false,
    board: [],
    progress: { perQuestion: [], perGroup: [] },
    ...overrides,
  };
}

describe('TeacherPage 寫回 Google 試算表（006 US1）', () => {
  beforeEach(() => {
    writeBackGuidedNotes.mockResolvedValue({ ok: true, writtenCells: 6 });
  });

  afterEach(() => {
    cleanup();
    writeBackGuidedNotes.mockReset();
  });

  it('連結來源的學習單可以按「寫回 Google 試算表」並顯示結果', async () => {
    render(<TeacherPage snapshot={makeSnapshot()} />);

    fireEvent.click(
      screen.getByRole('button', { name: '寫回 Google 試算表' }),
    );

    await waitFor(() => {
      expect(writeBackGuidedNotes).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('已寫回 6 格');
    });
  });

  it('寫回失敗時顯示伺服器的中文訊息', async () => {
    writeBackGuidedNotes.mockResolvedValue({
      ok: false,
      error: {
        code: 'SHEET_NOT_EDITABLE',
        message: '沒有這份試算表的編輯權限；請把試算表共用給服務帳號，或改用下載 xlsx',
      },
    });
    render(<TeacherPage snapshot={makeSnapshot()} />);

    fireEvent.click(
      screen.getByRole('button', { name: '寫回 Google 試算表' }),
    );

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('編輯權限');
    });
  });

  it('上傳 xlsx 的學習單沒有線上目標，按鈕停用並提示改用下載', () => {
    render(
      <TeacherPage
        snapshot={makeSnapshot({
          guidedNotes: {
            sheetName: '學習單',
            sourceKind: 'file',
            fileName: '01-official-single.xlsx',
            importedAt: '2026-11-17T09:00:00.000Z',
          },
        })}
      />,
    );

    const button = screen.getByRole('button', {
      name: '寫回 Google 試算表',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/沒有線上試算表可以寫回/).textContent).toContain(
      '匯出 Guided Notes',
    );
  });
});
