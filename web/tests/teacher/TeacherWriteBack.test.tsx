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
    writeBackGuidedNotes.mockResolvedValue({
      ok: true,
      writtenCells: 6,
      remapped: false,
    });
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
    // 成功訊息只講這次寫了幾格；「沒人作答的題目不會被清除」是使用限制，
    // 寫在 quickstart，不在每次成功時跳出來（2026-11-19 review）。
    expect(screen.getByRole('status').textContent).not.toContain('不會被清除');
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

  it('線上題目被改過時停下來請老師改用下載（人工驗證建議 3 / T029）', async () => {
    writeBackGuidedNotes.mockResolvedValue({
      ok: false,
      error: {
        code: 'SHEET_MODIFIED',
        message:
          '線上試算表的題目已與匯入時不同（題幹、子題數或前綴有變動），無法確定答案要寫到哪一格。請改用「匯出 Guided Notes」下載含答案的 xlsx。（只是插了一列或挪了欄、題目沒改時，系統會自動對到現在的位置寫入。）',
      },
    });
    render(<TeacherPage snapshot={makeSnapshot()} />);

    fireEvent.click(
      screen.getByRole('button', { name: '寫回 Google 試算表' }),
    );

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('題目已與匯入時不同');
    });
    // 不再提供「仍要寫回」：照舊座標硬寫會整體錯位（2026-11-19 review 實測）。
    expect(screen.queryByRole('button', { name: '仍要寫回' })).toBeNull();
    // 不另開重複按鈕；訊息直接引導老師用既有的「匯出 Guided Notes」。
    expect(screen.queryByRole('button', { name: '下載含答案的 xlsx' })).toBeNull();
    expect(
      screen.getByRole('button', { name: '匯出 Guided Notes' }),
    ).toBeDefined();
  });

  it('線上版面只是位置移動時，提示答案已自動對到現在的位置（T029）', async () => {
    writeBackGuidedNotes.mockResolvedValue({
      ok: true,
      writtenCells: 2,
      remapped: true,
    });
    render(<TeacherPage snapshot={makeSnapshot()} />);

    fireEvent.click(
      screen.getByRole('button', { name: '寫回 Google 試算表' }),
    );

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain(
        '答案已自動對到現在的位置',
      );
    });
  });

  it('階段改變時清掉上一次的寫回訊息（人工驗證建議 2）', async () => {
    writeBackGuidedNotes.mockResolvedValue({
      ok: false,
      error: { code: 'SHEET_NOT_EDITABLE', message: '沒有這份試算表的編輯權限' },
    });
    const { rerender } = render(<TeacherPage snapshot={makeSnapshot()} />);

    fireEvent.click(
      screen.getByRole('button', { name: '寫回 Google 試算表' }),
    );
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('編輯權限');
    });

    // 重設活動 → 階段改變 → 舊訊息不該還留在畫面上。
    rerender(
      <TeacherPage
        snapshot={makeSnapshot({ phase: 'preparing', revision: 2 })}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('比對失敗（讀不到線上試算表）時也停下來請老師確認（006 T026）', async () => {
    writeBackGuidedNotes.mockResolvedValue({
      ok: false,
      error: {
        code: 'SHEET_CHECK_FAILED',
        message:
          '無法讀取線上試算表，比對不了版面（常見原因：關閉了「知道連結者可檢視」或網路不穩）。請再按一次「寫回 Google 試算表」重試；仍無法比對請改用「匯出 Guided Notes」下載含答案的 xlsx。',
      },
    });
    render(<TeacherPage snapshot={makeSnapshot()} />);

    fireEvent.click(
      screen.getByRole('button', { name: '寫回 Google 試算表' }),
    );

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('無法讀取');
    });
    expect(screen.queryByRole('button', { name: '仍要寫回' })).toBeNull();
    // 不另開重複按鈕；重試就是再按一次既有的「寫回 Google 試算表」，
    // 下載就是既有的「匯出 Guided Notes」。
    expect(screen.queryByRole('button', { name: '重試寫回' })).toBeNull();
    expect(
      screen.getByRole('button', { name: '寫回 Google 試算表' }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: '匯出 Guided Notes' }),
    ).toBeDefined();
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
