import { cleanup, render, screen } from '@testing-library/react';
import { ERROR_MESSAGES, type GroupSummary } from '@classroom/shared';
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
      ERROR_MESSAGES.GROUP_NOT_FOUND,
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
    expect(screen.queryByText(ERROR_MESSAGES.GROUP_NOT_FOUND)).toBeNull();
    // 組別保留 → 學生點一下就能重新進場。
    expect(screen.getByRole('button', { name: '第一組' })).toBeDefined();
  });
});
