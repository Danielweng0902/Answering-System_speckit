import { cleanup, render, screen } from '@testing-library/react';
import type { Snapshot, TeacherSnapshot } from '@classroom/shared';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../src/app/routes';

let routeSnapshot: Snapshot | null = null;

vi.mock('../../src/lib/useSnapshot', () => ({
  useSnapshot: () => ({
    snapshot: routeSnapshot,
    sessionInvalid: false,
    sessionInvalidPayload: null,
  }),
}));

vi.mock('../../src/lib/socket', () => ({
  connectSocket: vi.fn(),
  sendCommand: vi.fn(),
}));

const teacherSnapshot: TeacherSnapshot = {
  revision: 1,
  serverNow: '2026-11-12T00:00:00.000Z',
  phase: 'open',
  countdownEndsAt: null,
  groups: [{ id: 'g1', name: '第一組' }],
  presence: { g1: 1 },
  role: 'teacher',
};

function renderTeacherRoute(): void {
  render(
    <MemoryRouter initialEntries={['/teacher']}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('/teacher', () => {
  afterEach(() => {
    cleanup();
  });

  it('未登入時顯示老師登入表單', () => {
    routeSnapshot = null;
    renderTeacherRoute();

    expect(screen.getByLabelText('老師密碼')).toBeDefined();
    expect(
      screen.queryByRole('heading', { name: '組別管理' }),
    ).toBeNull();
  });

  it('有老師快照時顯示階段與組別管理', () => {
    routeSnapshot = teacherSnapshot;
    renderTeacherRoute();

    expect(screen.queryByLabelText('老師密碼')).toBeNull();
    expect(screen.getByText('目前階段：搶答中')).toBeDefined();
    expect(
      screen.getByRole('heading', { name: '組別管理' }),
    ).toBeDefined();
    expect(screen.getByText('第一組')).toBeDefined();
    expect(screen.getByText('在線 1 人')).toBeDefined();
  });
});
