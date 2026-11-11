import { act, renderHook } from '@testing-library/react';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@classroom/shared';

const fakeSocket = new EventEmitter();

vi.mock('../src/lib/session', () => ({
  clearToken: () => undefined,
}));

vi.mock('../src/lib/socket', () => ({
  getSocket: () => fakeSocket,
  connectSocket: () => fakeSocket,
}));

const { useSnapshot } = await import('../src/lib/useSnapshot');

function snapshot(revision: number, role: 'guest' | 'student'): Snapshot {
  const base = {
    revision,
    serverNow: '2026-11-12T00:00:00.000Z',
    phase: 'preparing' as const,
    countdownEndsAt: null,
    groups: [{ id: 'g1', name: '第一組' }],
  };
  return role === 'guest'
    ? { ...base, role: 'guest' }
    : { ...base, role: 'student', myGroupId: 'g1' };
}

describe('useSnapshot', () => {
  it('忽略 revision 沒有比較新的快照', () => {
    const { result } = renderHook(() => useSnapshot());
    act(() => {
      fakeSocket.emit('state', snapshot(5, 'guest'));
      fakeSocket.emit('state', snapshot(4, 'guest'));
    });
    expect(result.current.snapshot?.revision).toBe(5);
  });

  it('重新連線（身分改變）後接受相同 revision 的新身分快照', () => {
    const { result } = renderHook(() => useSnapshot());
    act(() => {
      fakeSocket.emit('state', snapshot(7, 'guest'));
    });
    act(() => {
      fakeSocket.emit('connect');
      fakeSocket.emit('state', snapshot(7, 'student'));
    });
    expect(result.current.snapshot?.role).toBe('student');
  });

  it('失效後以訪客重連仍保留提示，重新選組（收到學生快照）後才清除', () => {
    const { result } = renderHook(() => useSnapshot());
    act(() => {
      fakeSocket.emit('session:invalid', { code: 'GROUP_NOT_FOUND' });
      fakeSocket.emit('connect');
      fakeSocket.emit('state', snapshot(20, 'guest'));
    });
    expect(result.current.sessionInvalid).toBe(true);
    act(() => {
      fakeSocket.emit('connect');
      fakeSocket.emit('state', snapshot(20, 'student'));
    });
    expect(result.current.sessionInvalid).toBe(false);
  });
});
