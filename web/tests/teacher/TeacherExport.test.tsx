import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TeacherSnapshot } from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeacherPage } from '../../src/features/teacher/TeacherPage';

const downloadGuidedNotes = vi.hoisted(() => vi.fn());
const downloadResultCsv = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/api')>();
  return {
    ...actual,
    downloadGuidedNotes,
    downloadResultCsv,
  };
});

const snapshot: TeacherSnapshot = {
  revision: 1,
  serverNow: '2026-11-14T09:00:00.000Z',
  phase: 'closed',
  countdownEndsAt: null,
  groups: [],
  presence: {},
  questions: [],
  guidedNotes: {
    sheetName: '學習單',
    sourceKind: 'file',
    fileName: '01-official-single.xlsx',
    importedAt: '2026-11-14T09:00:00.000Z',
  },
  role: 'teacher',
  board: [],
  progress: { perQuestion: [], perGroup: [] },
};

describe('TeacherPage 匯出（004 T012）', () => {
  beforeEach(() => {
    downloadGuidedNotes.mockResolvedValue({
      ok: true,
      blob: new Blob([new Uint8Array([80, 75])]),
      fileName: '搶答結果_20261114_0908.xlsx',
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    downloadGuidedNotes.mockReset();
    downloadResultCsv.mockReset();
  });

  it('只有 closed 的老師端顯示 Guided Notes 匯出按鈕', () => {
    const { rerender } = render(<TeacherPage snapshot={snapshot} />);
    expect(
      screen.getByRole('button', { name: '匯出 Guided Notes' }),
    ).toBeDefined();

    rerender(<TeacherPage snapshot={{ ...snapshot, phase: 'open' }} />);
    expect(
      screen.queryByRole('button', { name: '匯出 Guided Notes' }),
    ).toBeNull();
  });

  it('student closed 快照沒有老師匯出按鈕', () => {
    render(
      <TeacherPage
        snapshot={{
          revision: 1,
          serverNow: '2026-11-14T09:00:00.000Z',
          phase: 'closed',
          countdownEndsAt: null,
          groups: [],
          role: 'student',
          myGroupId: 'g1',
          sessionId: 's1',
          questions: [],
          results: [],
          myAnswers: [],
        }}
      />,
    );

    expect(
      screen.queryByRole('button', { name: '匯出 Guided Notes' }),
    ).toBeNull();
  });

  it('點擊後透過 Blob URL 下載，不開新視窗', async () => {
    // jsdom 沒有完整 object URL；測試瀏覽器觸發點，不驗證真實檔案。
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:export'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(<TeacherPage snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: '匯出 Guided Notes' }));

    await waitFor(() => {
      expect(downloadGuidedNotes).toHaveBeenCalledTimes(1);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
    });
    expect(click.mock.instances[0]).toHaveProperty(
      'download',
      '搶答結果_20261114_0908.xlsx',
    );
  });

  it('下載失敗時顯示伺服器中文錯誤', async () => {
    downloadGuidedNotes.mockResolvedValue({
      ok: false,
      error: {
        code: 'NO_GUIDED_NOTES',
        message: '這個活動沒有匯入過學習單，請先匯入學習單',
      },
    });

    render(<TeacherPage snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: '匯出 Guided Notes' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      '這個活動沒有匯入過學習單，請先匯入學習單',
    );
  });

  it('closed 可匯出 CSV，呼叫正確端點並顯示錯誤（T023）', async () => {
    downloadResultCsv.mockResolvedValue({
      ok: false,
      error: {
        code: 'INVALID_PHASE',
        message: '目前階段不能執行這個操作',
      },
    });

    render(<TeacherPage snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: '匯出 CSV' }));

    await waitFor(() => expect(downloadResultCsv).toHaveBeenCalledTimes(1));
    expect(downloadGuidedNotes).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent).toContain(
      '目前階段不能執行這個操作',
    );
  });
});
