import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Ack, TeacherSnapshot } from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendCommand } from '../../src/lib/socket';
import { GroupManager } from '../../src/features/teacher/GroupManager';

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
    // 003（T030）：TeacherSnapshot 必填的看板與進度欄位。
    board: [],
    progress: { perQuestion: [], perGroup: [] },
    ...overrides,
  };
}

describe('GroupManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('phase 不是 preparing 時停用所有輸入與按鈕並顯示說明', () => {
    render(<GroupManager snapshot={makeSnapshot({ phase: 'open' })} />);

    expect(
      screen.getByText('組別只能在準備中新增、改名或刪除。'),
    ).toBeDefined();

    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];

    expect(inputs.length).toBeGreaterThan(0);
    expect(buttons.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input.disabled).toBe(true);
    }
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
    }
  });

  it('送出 group:create 收到 ok:false 時顯示伺服器訊息', async () => {
    const ack: Ack = {
      ok: false,
      error: {
        code: 'GROUP_NAME_DUPLICATE',
        message: '伺服器說組名已重複',
      },
    };
    vi.mocked(sendCommand).mockResolvedValue(ack);

    render(<GroupManager snapshot={makeSnapshot()} />);

    fireEvent.change(
      screen.getByLabelText<HTMLInputElement>('新增組別名稱'),
      { target: { value: '第一組' } },
    );
    fireEvent.click(screen.getByRole('button', { name: '新增組別' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('伺服器說組名已重複');
    expect(sendCommand).toHaveBeenCalledWith('group:create', {
      name: '第一組',
    });
  });

  it('依 presence 顯示各組在線或離線', () => {
    render(
      <GroupManager
        snapshot={makeSnapshot({
          presence: { g1: 2, g2: 0 },
        })}
      />,
    );

    expect(screen.getByText('在線 2 人')).toBeDefined();
    expect(screen.getByText('離線')).toBeDefined();
  });
});
