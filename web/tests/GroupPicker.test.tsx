import { cleanup, render, screen } from '@testing-library/react';
import type { GroupSummary } from '@classroom/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupPicker } from '../src/features/student/GroupPicker';

vi.mock('../src/lib/socket', () => ({
  connectSocket: vi.fn(),
  sendCommand: vi.fn(),
}));

vi.mock('../src/lib/api', () => ({
  joinStudent: vi.fn(),
}));

const groups: readonly GroupSummary[] = [
  { id: 'g1', name: '第一組' },
  { id: 'g2', name: '第二組' },
];

describe('GroupPicker', () => {
  afterEach(() => {
    cleanup();
  });

  it('sessionInvalidCode 為 null 時不顯示任何原因說明', () => {
    render(<GroupPicker groups={groups} sessionInvalidCode={null} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('GROUP_NOT_FOUND 顯示「組別不存在」的說明（老師刪組）', () => {
    render(<GroupPicker groups={groups} sessionInvalidCode="GROUP_NOT_FOUND" />);

    expect(screen.getByRole('alert').textContent).toBe(
      '找不到這個組別，請重新選擇',
    );
  });

  /**
   * 2026-11-25（D2-1）：活動被重設時，學生端要說明「活動已重設」，
   * 不是「組別不存在」——否則學生會以為自己被踢出組別。
   */
  it('ACTIVITY_RESET 顯示「活動已重設，請重新選擇組別」的說明', () => {
    render(<GroupPicker groups={groups} sessionInvalidCode="ACTIVITY_RESET" />);

    expect(screen.getByRole('alert').textContent).toBe(
      '活動已重設，請重新選擇組別',
    );
    // 不是「組別不存在」的說明。
    expect(screen.queryByText('找不到這個組別，請重新選擇')).toBeNull();
    // 組別保留 → 學生點一下就能重新進場。
    expect(screen.getByRole('button', { name: '第一組' })).toBeDefined();
  });

  it('SESSION_EXPIRED 顯示「進場狀態已失效，請重新選擇組別」的說明', () => {
    render(<GroupPicker groups={groups} sessionInvalidCode="SESSION_EXPIRED" />);

    expect(screen.getByRole('alert').textContent).toBe(
      '進場狀態已失效，請重新選擇組別',
    );
    // 失效原因已無法分辨，不應誤稱是活動重設或組別不存在。
    expect(screen.queryByText('活動已重設，請重新選擇組別')).toBeNull();
    expect(screen.queryByText('找不到這個組別，請重新選擇')).toBeNull();
  });
});
