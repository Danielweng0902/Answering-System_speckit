import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  StudentOpenSnapshot,
  StudentQuestion,
} from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnswerArea } from '../src/features/student/AnswerArea';
import { sendCommand } from '../src/lib/socket';

vi.mock('../src/lib/socket', () => ({
  sendCommand: vi.fn(),
}));

// Node 26 的原生 localStorage getter 會覆蓋 Vitest jsdom 的 Storage；只在這個
// 測試檔補一個記憶體 Storage，產品程式仍使用瀏覽器真正的 localStorage。
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
    storageValues.set(String(key), String(value));
  },
};
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageMock,
});

const CURRENT_SESSION = 'session-current';
const GROUP_ID = 'group-one';
const DRAFT_KEY = `classroom.buzz-in.drafts.${CURRENT_SESSION}.${GROUP_ID}`;

const questions: StudentQuestion[] = [
  {
    number: 1,
    kind: 'single',
    prompt: '第一題題目',
    blanks: [{ position: 1, prefix: '' }],
  },
  {
    number: 2,
    kind: 'single',
    prompt: '第二題題目',
    blanks: [{ position: 1, prefix: '' }],
  },
];

function snapshot(
  overrides: Partial<StudentOpenSnapshot> = {},
): StudentOpenSnapshot {
  return {
    revision: 1,
    serverNow: '2026-11-13T00:00:00.000Z',
    countdownEndsAt: null,
    groups: [{ id: GROUP_ID, name: '第一組' }],
    role: 'student',
    phase: 'open',
    myGroupId: GROUP_ID,
    sessionId: CURRENT_SESSION,
    questions,
    myAnswers: [
      { questionNumber: 1, state: 'not_submitted', answers: [] },
      { questionNumber: 2, state: 'not_submitted', answers: [] },
    ],
    ...overrides,
  };
}

function storedDrafts(): Record<number, string[]> {
  const value = window.localStorage.getItem(DRAFT_KEY);
  expect(value).not.toBeNull();
  return JSON.parse(value ?? '{}') as Record<number, string[]>;
}

const groupQuestion: StudentQuestion = {
  number: 1,
  kind: 'group',
  prompt: '題組題目',
  blanks: [
    { position: 1, prefix: '（1）' },
    { position: 2, prefix: '（2）' },
  ],
};

function groupSnapshot(
  overrides: Partial<StudentOpenSnapshot> = {},
): StudentOpenSnapshot {
  return snapshot({
    questions: [groupQuestion],
    myAnswers: [{ questionNumber: 1, state: 'not_submitted', answers: [] }],
    ...overrides,
  });
}

describe('AnswerArea 本機草稿（AC-003-28、32；FR-027）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('重新掛載時還原未送出答案，輸入變更依題號寫回目前 session/group 的 key', () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ 1: ['重新整理前的第一題'], 2: ['重新整理前的第二題'] }),
    );

    render(<AnswerArea snapshot={snapshot()} />);

    expect(
      (screen.getByLabelText('第 1 題答案') as HTMLInputElement).value,
    ).toBe('重新整理前的第一題');
    expect(
      (screen.getByLabelText('第 2 題答案') as HTMLInputElement).value,
    ).toBe('重新整理前的第二題');

    fireEvent.change(screen.getByLabelText('第 2 題答案'), {
      target: { value: '更新後尚未送出的答案' },
    });

    expect(storedDrafts()).toEqual({
      1: ['重新整理前的第一題'],
      2: ['更新後尚未送出的答案'],
    });
  });

  it('啟用目前 session 時只移除非目前 session 的草稿，保留其他組與無關 key', () => {
    const oldKey = 'classroom.buzz-in.drafts.old-session.group-one';
    const otherGroupKey = `classroom.buzz-in.drafts.${CURRENT_SESSION}.group-two`;
    window.localStorage.setItem(oldKey, JSON.stringify({ 1: ['上一次活動'] }));
    window.localStorage.setItem(otherGroupKey, JSON.stringify({ 1: ['同活動別組'] }));
    window.localStorage.setItem('unrelated.preference', 'keep-me');
    window.localStorage.setItem('classroom.other-feature.old-session', 'also-keep');

    render(<AnswerArea snapshot={snapshot()} />);

    expect(window.localStorage.getItem(oldKey)).toBeNull();
    expect(window.localStorage.getItem(otherGroupKey)).toBe(
      JSON.stringify({ 1: ['同活動別組'] }),
    );
    expect(window.localStorage.getItem('unrelated.preference')).toBe('keep-me');
    expect(window.localStorage.getItem('classroom.other-feature.old-session')).toBe(
      'also-keep',
    );
  });

  it('送出使用本機草稿，成功後只移除已送出的題目並保留其他未送出草稿', async () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ 1: ['要送出的草稿'], 2: ['繼續填寫的草稿'] }),
    );
    vi.mocked(sendCommand).mockResolvedValue({ ok: true });

    render(<AnswerArea snapshot={snapshot()} />);
    fireEvent.click(
      screen.getByRole('button', { name: '送出第 1 題' }),
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('answer:submit', {
        questionNumber: 1,
        answers: ['要送出的草稿'],
      });
    });
    await waitFor(() => {
      expect(storedDrafts()).toEqual({ 2: ['繼續填寫的草稿'] });
    });
  });

  it('伺服器已標示送出的題目以快照答案為準，不被本機舊草稿覆蓋', () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ 1: ['本機舊草稿'] }));

    render(
      <AnswerArea
        snapshot={snapshot({
          myAnswers: [
            { questionNumber: 1, state: 'submitted', answers: ['伺服器答案'] },
            { questionNumber: 2, state: 'not_submitted', answers: [] },
          ],
        })}
      />,
    );

    const input = screen.getByLabelText('第 1 題答案') as HTMLInputElement;
    expect(input.value).toBe('伺服器答案');
    expect(input.disabled).toBe(true);
    expect(screen.getByText('本組已送出：伺服器答案')).not.toBeNull();
  });

  it('作廢狀態顯示提示並解鎖輸入，可重新送出（FR-030）', async () => {
    vi.mocked(sendCommand).mockResolvedValue({ ok: true });
    render(
      <AnswerArea
        snapshot={snapshot({
          myAnswers: [
            { questionNumber: 1, state: 'voided', answers: ['被作廢的答案'] },
            { questionNumber: 2, state: 'not_submitted', answers: [] },
          ],
        })}
      />,
    );

    const question = screen.getByRole('region', { name: '第 1 題' });
    expect(
      screen.getByText('老師已作廢這一題的作答，請重新送出'),
    ).not.toBeNull();
    const input = screen.getByLabelText('第 1 題答案') as HTMLInputElement;
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { value: '重新送出的答案' } });
    fireEvent.click(
      within(question).getByRole('button', { name: '送出第 1 題' }),
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('answer:submit', {
        questionNumber: 1,
        answers: ['重新送出的答案'],
      });
    });
  });
});

describe('AnswerArea 題組（US5；AC-003-22、23）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('每個空格顯示快照的前綴，並依空格順序寫入 string[] 草稿（AC-003-22）', () => {
    render(<AnswerArea snapshot={groupSnapshot()} />);

    expect(screen.getByText('（1）')).not.toBeNull();
    expect(screen.getByText('（2）')).not.toBeNull();
    const first = screen.getByLabelText('第 1 題（1）答案', {
      exact: true,
    }) as HTMLInputElement;
    const second = screen.getByLabelText('第 1 題（2）答案', {
      exact: true,
    }) as HTMLInputElement;

    fireEvent.change(first, { target: { value: '前綴一的草稿' } });
    fireEvent.change(second, { target: { value: '前綴二的草稿' } });

    expect(storedDrafts()).toEqual({
      1: ['前綴一的草稿', '前綴二的草稿'],
    });
  });

  it('只填部分空格或空格是純空白時，前端先拒絕並指出未填的前綴（AC-003-23）', async () => {
    vi.mocked(sendCommand).mockResolvedValue({ ok: true });
    render(<AnswerArea snapshot={groupSnapshot()} />);

    fireEvent.change(
      screen.getByLabelText('第 1 題（1）答案', { exact: true }),
      { target: { value: '已填的第一格' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: '送出第 1 題' }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      '每個空格都要填寫答案；尚未填寫的空格：（2）',
    );
    expect(sendCommand).not.toHaveBeenCalled();

    fireEvent.change(
      screen.getByLabelText('第 1 題（2）答案', { exact: true }),
      { target: { value: ' 　 ' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: '送出第 1 題' }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      '每個空格都要填寫答案；尚未填寫的空格：（2）',
    );
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
