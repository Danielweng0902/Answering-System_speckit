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
    questions: [],
    guidedNotes: null,
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

  it('closed：「開啟搶答」「結束搶答」都停用', () => {
    render(<PhaseControl snapshot={makeSnapshot({ phase: 'closed' })} />);

    const openButton = screen.getByRole('button', {
      name: '開啟搶答',
    }) as HTMLButtonElement;
    const closeButton = screen.getByRole('button', {
      name: '結束搶答',
    }) as HTMLButtonElement;

    expect(openButton.disabled).toBe(true);
    expect(closeButton.disabled).toBe(true);
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

  it('勾選設定倒數後按開啟，送出輸入的倒數秒數', async () => {
    vi.mocked(sendCommand).mockResolvedValue({ ok: true });

    render(<PhaseControl snapshot={makeSnapshot({ phase: 'preparing' })} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '設定倒數' }));
    fireEvent.change(screen.getByLabelText<HTMLInputElement>('倒數秒數'), {
      target: { value: '65' },
    });
    fireEvent.click(screen.getByRole('button', { name: '開啟搶答' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('activity:open', {
        countdownSeconds: 65,
      });
    });
  });

  it('設定倒數與倒數秒數只在 preparing 可用', () => {
    const rendered = render(
      <PhaseControl snapshot={makeSnapshot({ phase: 'preparing' })} />,
    );
    const checkbox = screen.getByRole('checkbox', {
      name: '設定倒數',
    }) as HTMLInputElement;
    const secondsInput = screen.getByLabelText<HTMLInputElement>('倒數秒數');

    expect(checkbox.disabled).toBe(false);
    expect(secondsInput.disabled).toBe(false);

    rendered.rerender(<PhaseControl snapshot={makeSnapshot({ phase: 'open' })} />);
    expect(checkbox.disabled).toBe(true);
    expect(secondsInput.disabled).toBe(true);

    rendered.rerender(
      <PhaseControl snapshot={makeSnapshot({ phase: 'closed' })} />,
    );
    expect(checkbox.disabled).toBe(true);
    expect(secondsInput.disabled).toBe(true);
  });

  it('重設活動只在 closed 顯示', () => {
    const rendered = render(
      <PhaseControl snapshot={makeSnapshot({ phase: 'preparing' })} />,
    );
    expect(screen.queryByRole('button', { name: '重設活動' })).toBeNull();

    rendered.rerender(<PhaseControl snapshot={makeSnapshot({ phase: 'open' })} />);
    expect(screen.queryByRole('button', { name: '重設活動' })).toBeNull();

    rendered.rerender(
      <PhaseControl snapshot={makeSnapshot({ phase: 'closed' })} />,
    );
    expect(screen.getByRole('button', { name: '重設活動' })).toBeDefined();
  });

  it('重設確認步驟按取消不送出任何指令', () => {
    render(<PhaseControl snapshot={makeSnapshot({ phase: 'closed' })} />);

    fireEvent.click(screen.getByRole('button', { name: '重設活動' }));
    expect(screen.getByText('重設後回到準備中，組別保留')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByText('重設後回到準備中，組別保留')).toBeNull();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('確認重設時送出 activity:reset 與 confirm:true', async () => {
    vi.mocked(sendCommand).mockResolvedValue({ ok: true });

    render(<PhaseControl snapshot={makeSnapshot({ phase: 'closed' })} />);
    fireEvent.click(screen.getByRole('button', { name: '重設活動' }));
    fireEvent.click(screen.getByRole('button', { name: '確認重設' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('activity:reset', {
        confirm: true,
      });
    });
  });
});
