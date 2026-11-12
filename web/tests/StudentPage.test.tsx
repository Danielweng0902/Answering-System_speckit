import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  ERROR_MESSAGES,
  type Ack,
  type GuestSnapshot,
  type Phase,
  type Snapshot,
  type StudentSnapshot,
} from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentPage } from '../src/features/student/StudentPage';
import { getToken, saveToken } from '../src/lib/session';
import { connectSocket, sendCommand } from '../src/lib/socket';

vi.mock('../src/lib/socket', () => ({
  connectSocket: vi.fn(),
  sendCommand: vi.fn(),
}));

const fetchMock = vi.fn<typeof fetch>();

const groups = [
  { id: 'g1', name: '第一組' },
  { id: 'g2', name: '第二組' },
];

function studentSnapshot(
  phase: Phase,
  overrides: Partial<StudentSnapshot> = {},
): StudentSnapshot {
  return {
    revision: 1,
    serverNow: '2026-11-12T00:00:00.000Z',
    phase,
    countdownEndsAt: null,
    groups,
    role: 'student',
    myGroupId: 'g1',
    ...overrides,
  };
}

function guestSnapshot(
  nextGroups: GuestSnapshot['groups'] = groups,
): GuestSnapshot {
  return {
    revision: 1,
    serverNow: '2026-11-12T00:00:00.000Z',
    phase: 'preparing',
    countdownEndsAt: null,
    groups: nextGroups,
    role: 'guest',
  };
}

function renderPage(
  snapshot: Snapshot | null,
  sessionInvalid = false,
): ReturnType<typeof render> {
  return render(
    <StudentPage
      snapshot={snapshot}
      sessionInvalid={sessionInvalid}
      sessionInvalidPayload={
        sessionInvalid ? { code: 'GROUP_NOT_FOUND' } : null
      }
    />,
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('StudentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const phaseCases: Array<{ phase: Phase; label: string; heading: string }> = [
    { phase: 'preparing', label: '準備中', heading: '等待老師開啟搶答' },
    { phase: 'open', label: '搶答中', heading: '作答區' },
    { phase: 'closed', label: '已結束', heading: '結果區' },
  ];

  it.each(phaseCases)('$phase 顯示正確畫面、目前階段與組名', (testCase) => {
    renderPage(studentSnapshot(testCase.phase));

    expect(screen.getByText('第一組')).toBeDefined();
    expect(screen.getByText(`目前階段：${testCase.label}`)).toBeDefined();
    expect(
      screen.getByRole('heading', { name: testCase.heading }),
    ).toBeDefined();
  });

  it('搶答中有倒數結束時間時顯示倒數', () => {
    const now = new Date();
    renderPage(
      studentSnapshot('open', {
        serverNow: now.toISOString(),
        countdownEndsAt: new Date(now.getTime() + 65_000).toISOString(),
      }),
    );

    expect(screen.getByRole('timer').textContent).toMatch(
      /^剩餘時間 \d{2}:\d{2}$/,
    );
  });

  it('搶答中沒有倒數結束時間時不顯示倒數', () => {
    renderPage(studentSnapshot('open'));

    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('準備中可更換組別，成功後清除 token 並以 guest 身分重新連線', async () => {
    saveToken('student-token');
    vi.mocked(sendCommand).mockResolvedValue({ ok: true });
    renderPage(studentSnapshot('preparing'));

    fireEvent.click(screen.getByRole('button', { name: '更換組別' }));

    await waitFor(() => {
      expect(connectSocket).toHaveBeenCalledWith(null);
    });
    expect(sendCommand).toHaveBeenCalledWith('student:leave', {});
    expect(getToken()).toBeNull();
  });

  it('更換組別失敗時顯示伺服器錯誤訊息', async () => {
    const ack: Ack = {
      ok: false,
      error: { code: 'INVALID_PHASE', message: '伺服器拒絕更換組別' },
    };
    vi.mocked(sendCommand).mockResolvedValue(ack);
    renderPage(studentSnapshot('preparing'));

    fireEvent.click(screen.getByRole('button', { name: '更換組別' }));

    await expect(
      screen.findByText('伺服器拒絕更換組別'),
    ).resolves.toBeDefined();
    expect(connectSocket).not.toHaveBeenCalledWith(null);
  });

  it('guest 快照顯示組別選擇，進場成功保存 token 並重新連線', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        token: 'joined-student-token',
        role: 'student',
        groupId: 'g1',
      }),
    );
    renderPage(guestSnapshot());

    fireEvent.click(screen.getByRole('button', { name: '第一組' }));

    await waitFor(() => {
      expect(connectSocket).toHaveBeenCalledWith('joined-student-token');
    });
    expect(getToken()).toBe('joined-student-token');
    expect(fetchMock).toHaveBeenCalledWith('/api/student/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: 'g1' }),
    });
  });

  it('進場失敗顯示伺服器錯誤訊息', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, {
        error: {
          code: 'GROUP_NOT_FOUND',
          message: '伺服器說這個組別不存在',
        },
      }),
    );
    renderPage(guestSnapshot());

    fireEvent.click(screen.getByRole('button', { name: '第一組' }));

    await expect(
      screen.findByText('伺服器說這個組別不存在'),
    ).resolves.toBeDefined();
    expect(getToken()).toBeNull();
    expect(connectSocket).not.toHaveBeenCalled();
  });

  it('沒有組別時顯示等待說明，清單隨快照更新', () => {
    const rendered = renderPage(guestSnapshot([]));

    expect(screen.getByText('老師尚未建立組別')).toBeDefined();
    expect(screen.queryByRole('button', { name: '第一組' })).toBeNull();

    rendered.rerender(
      <StudentPage
        snapshot={guestSnapshot()}
        sessionInvalid={false}
        sessionInvalidPayload={null}
      />,
    );
    expect(screen.getByRole('button', { name: '第一組' })).toBeDefined();
  });

  it('session:invalid 後顯示重新選組說明', () => {
    renderPage(studentSnapshot('preparing'), true);

    expect(screen.getByText(ERROR_MESSAGES.GROUP_NOT_FOUND)).toBeDefined();
    expect(screen.getByRole('heading', { name: '選擇組別' })).toBeDefined();
  });
});
