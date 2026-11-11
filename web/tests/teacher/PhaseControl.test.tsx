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
    ...overrides,
  };
}

describe('PhaseControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('顯示目前階段文字', () => {
    render(<PhaseControl snapshot={makeSnapshot({ phase: 'open' })} />);

    expect(screen.getByText('目前階段：搶答中')).toBeDefined();
  });

  it('preparing：「開啟搶答」可按、「結束搶答」停用', () => {
    render(<PhaseControl snapshot={makeSnapshot({ phase: 'preparing' })} />);

    const openButton = screen.getByRole('button', {
      name: '開啟搶答',
    }) as HTMLButtonElement;
    const closeButton = screen.getByRole('button', {
      name: '結束搶答',
    }) as HTMLButtonElement;

    expect(openButton.disabled).toBe(false);
    expect(closeButton.disabled).toBe(true);
  });

  it('open：「結束搶答」可按、「開啟搶答」停用', () => {
    render(<PhaseControl snapshot={makeSnapshot({ phase: 'open' })} />);

    const openButton = screen.getByRole('button', {
      name: '開啟搶答',
    }) as HTMLButtonElement;
    const closeButton = screen.getByRole('button', {
      name: '結束搶答',
    }) as HTMLButtonElement;

    expect(openButton.disabled).toBe(true);
    expect(closeButton.disabled).toBe(false);
  });

  it('closed：兩個按鈕都停用', () => {
    render(<PhaseControl snapshot={makeSnapshot({ phase: 'closed' })} />);

    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
    }
  });

  it('按「開啟搶答」送出 activity:open，成功時不顯示錯誤', async () => {
    vi.mocked(sendCommand).mockResolvedValue({ ok: true });

    render(<PhaseControl snapshot={makeSnapshot({ phase: 'preparing' })} />);
    fireEvent.click(screen.getByRole('button', { name: '開啟搶答' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('activity:open', {});
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('按「結束搶答」送出 activity:close', async () => {
    vi.mocked(sendCommand).mockResolvedValue({ ok: true });

    render(<PhaseControl snapshot={makeSnapshot({ phase: 'open' })} />);
    fireEvent.click(screen.getByRole('button', { name: '結束搶答' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('activity:close', {});
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('伺服器回覆 ok:false 時顯示 error.message', async () => {
    const ack: Ack = {
      ok: false,
      error: { code: 'NO_GROUPS', message: '伺服器說請先建立組別' },
    };
    vi.mocked(sendCommand).mockResolvedValue(ack);

    render(<PhaseControl snapshot={makeSnapshot({ phase: 'preparing' })} />);
    fireEvent.click(screen.getByRole('button', { name: '開啟搶答' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('伺服器說請先建立組別');
  });

  it('送出中停用兩個按鈕', async () => {
    let resolveAck: ((ack: Ack) => void) | undefined;
    vi.mocked(sendCommand).mockReturnValue(
      new Promise<Ack>((resolve) => {
        resolveAck = resolve;
      }),
    );

    render(<PhaseControl snapshot={makeSnapshot({ phase: 'preparing' })} />);
    const openButton = screen.getByRole('button', {
      name: '開啟搶答',
    }) as HTMLButtonElement;
    const closeButton = screen.getByRole('button', {
      name: '結束搶答',
    }) as HTMLButtonElement;

    fireEvent.click(openButton);

    expect(openButton.disabled).toBe(true);
    expect(closeButton.disabled).toBe(true);

    resolveAck?.({ ok: true });
    await waitFor(() => {
      expect(openButton.disabled).toBe(false);
    });
  });

  it('再次操作前清除前一次的錯誤訊息', async () => {
    vi.mocked(sendCommand)
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'NO_GROUPS', message: '第一次的錯誤' },
      })
      .mockResolvedValueOnce({ ok: true });

    render(<PhaseControl snapshot={makeSnapshot({ phase: 'preparing' })} />);
    const openButton = screen.getByRole('button', { name: '開啟搶答' });

    fireEvent.click(openButton);
    expect((await screen.findByRole('alert')).textContent).toBe('第一次的錯誤');

    fireEvent.click(openButton);
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
