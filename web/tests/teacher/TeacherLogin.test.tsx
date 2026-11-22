import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getToken } from '../../src/lib/session';
import { connectSocket, reconnectSocket } from '../../src/lib/socket';
import { TeacherLogin } from '../../src/features/teacher/TeacherLogin';

const TEACHER_PW = 'teacher-pass-123';

vi.mock('../../src/lib/socket', () => ({
  connectSocket: vi.fn(),
  reconnectSocket: vi.fn(),
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

  it('密碼欄位是必填、有 current-password 自動填寫與「完成」鍵盤標示', () => {
    render(<TeacherLogin />);

    const passwordInput = screen.getByLabelText<HTMLInputElement>('老師密碼');
    expect(passwordInput.required).toBe(true);
    expect(passwordInput.getAttribute('autocomplete')).toBe('current-password');
    expect(passwordInput.getAttribute('enterkeyhint')).toBe('done');
    expect(passwordInput.type).toBe('password');
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

  it('登入成功不保存 token（改用 HttpOnly cookie）、以 cookie 身分連線並通知父元件', async () => {
    const onLoginSuccess = vi.fn();
    fetchMock.mockResolvedValue(
      mockLoginResponse(200, { role: 'teacher', authenticated: true }),
    );

    render(<TeacherLogin onLoginSuccess={onLoginSuccess} />);

    const passwordInput = screen.getByLabelText<HTMLInputElement>('老師密碼');
    fireEvent.change(passwordInput, { target: { value: TEACHER_PW } });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => {
      expect(connectSocket).toHaveBeenCalledWith(null);
    });
    // 2026-11-22（D18）：憑證在 cookie 裡，token 沒有變化，所以要明確
    // 重新握手讓伺服器用新的 cookie 判定身分。
    expect(reconnectSocket).toHaveBeenCalled();
    // 2026-11-22（D18）：頁面 JavaScript 不得持有憑證。
    expect(getToken()).toBeNull();
    expect(onLoginSuccess).toHaveBeenCalledWith();
    expect(passwordInput.value).toBe('');
    expect(fetchMock).toHaveBeenCalledWith('/api/teacher/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEACHER_PW }),
    });
  });
});
