import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getToken } from '../../src/lib/session';
import { connectSocket } from '../../src/lib/socket';
import { TeacherLogin } from '../../src/features/teacher/TeacherLogin';

const TEACHER_PW = 'teacher-pass-123';

vi.mock('../../src/lib/socket', () => ({
  connectSocket: vi.fn(),
}));

const fetchMock = vi.fn<typeof fetch>();

function mockLoginResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TeacherLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('錯誤密碼顯示伺服器錯誤訊息、清空密碼並留在登入畫面', async () => {
    fetchMock.mockResolvedValue(
      mockLoginResponse(401, {
        error: { code: 'WRONG_PASSWORD', message: '伺服器說密碼不對' },
      }),
    );

    render(<TeacherLogin />);

    const passwordInput = screen.getByLabelText<HTMLInputElement>('老師密碼');
    fireEvent.change(passwordInput, { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('伺服器說密碼不對');
    expect(passwordInput.value).toBe('');
    expect(getToken()).toBeNull();
    expect(connectSocket).not.toHaveBeenCalled();
    expect(screen.getByLabelText('老師密碼')).toBeDefined();
    expect(screen.getByRole('button', { name: '登入' })).toBeDefined();
  });

  it('登入成功保存 token、以 token 連線並通知父元件', async () => {
    const onLoginSuccess = vi.fn();
    fetchMock.mockResolvedValue(
      mockLoginResponse(200, { token: 'teacher-token', role: 'teacher' }),
    );

    render(<TeacherLogin onLoginSuccess={onLoginSuccess} />);

    const passwordInput = screen.getByLabelText<HTMLInputElement>('老師密碼');
    fireEvent.change(passwordInput, { target: { value: TEACHER_PW } });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => {
      expect(connectSocket).toHaveBeenCalledWith('teacher-token');
    });
    expect(getToken()).toBe('teacher-token');
    expect(onLoginSuccess).toHaveBeenCalledWith('teacher-token');
    expect(passwordInput.value).toBe('');
    expect(fetchMock).toHaveBeenCalledWith('/api/teacher/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEACHER_PW }),
    });
  });
});
