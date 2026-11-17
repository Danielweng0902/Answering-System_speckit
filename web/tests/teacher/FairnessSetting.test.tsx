import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Ack, TeacherSnapshot } from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendCommand } from '../../src/lib/socket';
import { PhaseControl } from '../../src/features/teacher/PhaseControl';

vi.mock('../../src/lib/socket', () => ({
  sendCommand: vi.fn(),
}));

function makeSnapshot(overrides: Partial<TeacherSnapshot> = {}): TeacherSnapshot {
  return {
    revision: 1,
    serverNow: '2026-11-12T00:00:00.000Z',
    phase: 'preparing',
    countdownEndsAt: null,
    groups: [
      { id: 'g1', name: '第一組' },
      { id: 'g2', name: '第二組' },
    ],
    presence: {},
    role: 'teacher',
    fairRankingEnabled: false,
    questions: [],
    guidedNotes: null,
    board: [],
    progress: { perQuestion: [], perGroup: [] },
    ...overrides,
  };
}

describe('005 公平順位開關（US2；T018、AC-005-09、AC-005-10）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendCommand).mockResolvedValue({ ok: true } as Ack);
  });

  afterEach(() => {
    cleanup();
  });

  it('準備中顯示開關且預設關閉，並附規則說明', () => {
    render(<PhaseControl snapshot={makeSnapshot()} />);

    const checkbox = screen.getByRole('checkbox', {
      name: '啟用公平順位',
    }) as HTMLInputElement;

    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);
    expect(
      screen.getByText(/同一題 3 秒內送出的組別視為同批/).textContent,
    ).toContain('已搶答成功題數');
  });

  it('勾選後送出 activity:fair-ranking 指令', async () => {
    render(<PhaseControl snapshot={makeSnapshot()} />);

    fireEvent.click(
      screen.getByRole('checkbox', { name: '啟用公平順位' }),
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('activity:fair-ranking', {
        enabled: true,
      });
    });
  });

  it('搶答中與已結束時開關停用（AC-005-10）', () => {
    const { unmount } = render(
      <PhaseControl snapshot={makeSnapshot({ phase: 'open' })} />,
    );
    expect(
      (screen.getByRole('checkbox', { name: '啟用公平順位' }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    unmount();

    render(<PhaseControl snapshot={makeSnapshot({ phase: 'closed' })} />);
    expect(
      (screen.getByRole('checkbox', { name: '啟用公平順位' }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });

  it('已啟用時開關為勾選狀態', () => {
    render(
      <PhaseControl snapshot={makeSnapshot({ fairRankingEnabled: true })} />,
    );

    expect(
      (screen.getByRole('checkbox', { name: '啟用公平順位' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
