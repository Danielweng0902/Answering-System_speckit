import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { StudentOpenSnapshot } from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnswerArea } from '../src/features/student/AnswerArea';
import { sendCommand } from '../src/lib/socket';

vi.mock('../src/lib/socket', () => ({
  sendCommand: vi.fn(),
}));

const storageValues = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return storageValues.size;
  },
  clear() {
    storageValues.clear();
  },
  getItem(key) {
    return storageValues.get(String(key)) ?? null;
  },
  key(index) {
    return [...storageValues.keys()][index] ?? null;
  },
  removeItem(key) {
    storageValues.delete(String(key));
  },
  setItem(key, value) {
    storageValues.set(String(key), value);
  },
};
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageMock,
});

function snapshot(): StudentOpenSnapshot {
  return {
    revision: 1,
    serverNow: '2026-11-18T09:00:00.000Z',
    countdownEndsAt: null,
    groups: [{ id: 'group-one', name: '第一組' }],
    role: 'student',
    fairRankingEnabled: false,
    phase: 'open',
    myGroupId: 'group-one',
    sessionId: 'session-current',
    questions: [
      {
        number: 1,
        kind: 'single',
        prompt: '第一題題目',
        blanks: [{ position: 1, prefix: '' }],
      },
      {
        number: 2,
        kind: 'group',
        prompt: '第二題題目',
        blanks: [
          { position: 1, prefix: '（1）' },
          { position: 2, prefix: '（2）' },
        ],
      },
    ],
    myAnswers: [
      { questionNumber: 1, state: 'not_submitted', answers: [] },
      { questionNumber: 2, state: 'not_submitted', answers: [] },
    ],
  };
}

/** 送出這個 keydown 事件，並帶上指定的 IME 狀態。 */
function pressEnter(
  input: HTMLElement,
  options: { isComposing?: boolean; keyCode?: number } = {},
): void {
  fireEvent.keyDown(input, {
    key: 'Enter',
    code: 'Enter',
    keyCode: options.keyCode ?? 13,
    isComposing: options.isComposing ?? false,
  });
}

describe('作答的錯誤訊息與 Enter 送出（003 人工驗證建議；2026-11-18 兩組同意）', () => {
  beforeEach(() => {
    vi.mocked(sendCommand).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    storageValues.clear();
    vi.clearAllMocks();
  });

  it('單題沒填時提示「答案不可為空白」', async () => {
    render(<AnswerArea snapshot={snapshot()} />);

    fireEvent.click(screen.getByRole('button', { name: '送出第 1 題' }));

    expect((await screen.findByRole('alert')).textContent).toBe('答案不可為空白');
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('題組缺哪一格就點名哪一格', async () => {
    render(<AnswerArea snapshot={snapshot()} />);

    fireEvent.change(screen.getByLabelText('第 2 題（1）答案'), {
      target: { value: '甲' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送出第 2 題' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      '第（2）格不可為空白',
    );
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('答案填好時按 Enter 會送出該題', async () => {
    render(<AnswerArea snapshot={snapshot()} />);

    const input = screen.getByLabelText('第 1 題答案');
    fireEvent.change(input, { target: { value: '甲答案' } });
    pressEnter(input);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('answer:submit', {
        questionNumber: 1,
        answers: ['甲答案'],
      });
    });
  });

  it('中文輸入法組字／選字時的 Enter 不會送出（IME 安全）', async () => {
    render(<AnswerArea snapshot={snapshot()} />);

    const input = screen.getByLabelText('第 1 題答案');
    fireEvent.change(input, { target: { value: '甲答案' } });

    // isComposing：正在用輸入法組字。
    pressEnter(input, { isComposing: true });
    // Safari 的事件順序問題：確認選字的 Enter 帶 keyCode 229。
    pressEnter(input, { keyCode: 229 });

    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('題組還有後面的空格沒填時，Enter 只移到下一格、不送出也不顯示錯誤（人工驗證建議）', async () => {
    render(<AnswerArea snapshot={snapshot()} />);

    const first = screen.getByLabelText('第 2 題（1）答案');
    const second = screen.getByLabelText('第 2 題（2）答案');
    fireEvent.change(first, { target: { value: '甲' } });
    pressEnter(first);

    await waitFor(() => {
      expect(second).toBe(document.activeElement);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('只有這一格沒填時按 Enter 才會提示錯誤、不送出', async () => {
    render(<AnswerArea snapshot={snapshot()} />);

    const input = screen.getByLabelText('第 1 題答案');
    pressEnter(input);

    expect((await screen.findByRole('alert')).textContent).toBe('答案不可為空白');
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('顯示字數，讓貼上被截斷時看得到（人工驗證建議）', () => {
    render(<AnswerArea snapshot={snapshot()} />);

    const input = screen.getByLabelText('第 1 題答案');
    fireEvent.change(input, { target: { value: '甲答案' } });

    expect(screen.getByText('3／200')).toBeDefined();
  });
});
