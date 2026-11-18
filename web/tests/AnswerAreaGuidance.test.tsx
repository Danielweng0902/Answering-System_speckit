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
    serverNow: '2026-11-17T09:00:00.000Z',
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
        kind: 'group',
        prompt: '第一題題目',
        blanks: [
          { position: 1, prefix: '（1）' },
          { position: 2, prefix: '（2）' },
        ],
      },
    ],
    myAnswers: [{ questionNumber: 1, state: 'not_submitted', answers: [] }],
  };
}

describe('AnswerArea 的 web 指引修正（Modern Web Guidance 審查）', () => {
  beforeEach(() => {
    vi.mocked(sendCommand).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    storageValues.clear();
    vi.clearAllMocks();
  });

  it('答案欄位有 200 字上限並關閉拼字檢查（與伺服器驗證一致）', () => {
    render(<AnswerArea snapshot={snapshot()} />);

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input.getAttribute('maxlength')).toBe('200');
      expect(input.getAttribute('spellcheck')).toBe('false');
    }
  });

  it('有空格沒填就送出時，焦點移到第一個沒填的欄位', async () => {
    render(<AnswerArea snapshot={snapshot()} />);

    const first = screen.getByLabelText('第 1 題（1）答案');
    const second = screen.getByLabelText('第 1 題（2）答案');
    fireEvent.change(first, { target: { value: '甲' } });
    fireEvent.click(screen.getByRole('button', { name: '送出第 1 題' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(second);
    });
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
