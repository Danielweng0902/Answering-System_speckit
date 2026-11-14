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
    : { ...base, role: 'student', myGroupId: 'g1', sessionId: 'test-session' };
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

  it('connect 與 disconnect 時回傳對應的連線狀態', () => {
    const { result } = renderHook(() => useSnapshot());

    expect(result.current.connectionState).toBe('connecting');

    act(() => {
      fakeSocket.emit('disconnect');
    });
    expect(result.current.connectionState).toBe('reconnecting');

    act(() => {
      fakeSocket.emit('connect');
    });
    expect(result.current.connectionState).toBe('connected');
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

  it('同一連線上身分由 student 降級為 guest 時，接受 revision 較小的快照並重設比較基準（003 T025）', () => {
    const { result } = renderHook(() => useSnapshot());
    act(() => {
      fakeSocket.emit('state', snapshot(30, 'student'));
    });
    expect(result.current.snapshot?.role).toBe('student');

    act(() => {
      fakeSocket.emit('state', snapshot(12, 'guest'));
    });
    expect(result.current.snapshot?.role).toBe('guest');
    expect(result.current.snapshot?.revision).toBe(12);

    // 基準已重設為 guest 快照的 revision：更舊的 guest 快照仍被拒。
    act(() => {
      fakeSocket.emit('state', snapshot(11, 'guest'));
    });
    expect(result.current.snapshot?.revision).toBe(12);
    act(() => {
      fakeSocket.emit('state', snapshot(13, 'guest'));
    });
    expect(result.current.snapshot?.revision).toBe(13);
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
