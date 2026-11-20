import { cleanup, render, screen, within } from '@testing-library/react';
import type { StudentClosedSnapshot } from '@classroom/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { StudentPage } from '../src/features/student/StudentPage';

/**
 * 2026-11-19 review：開公平順位而且有改判時，學生端結果頁的
 * 「本題因公平順位改判」多一行，舊的 grid 排法讓「本組順位」被擠到
 * 題號那一欄（偏移到隔壁格）。修法是題號欄固定、內容全部放同一個欄位，
 * 這裡用結構斷言守住。
 */

afterEach(() => {
  cleanup();
});

function closedSnapshot(): StudentClosedSnapshot {
  return {
    revision: 3,
    serverNow: '2026-11-20T09:00:00.000Z',
    countdownEndsAt: null,
    groups: [
      { id: 'g1', name: '第一組' },
      { id: 'g2', name: '第二組' },
    ],
    fairRankingEnabled: true,
    role: 'student',
    myGroupId: 'g1',
    sessionId: 'test-session',
    phase: 'closed',
    questions: [
      {
        number: 2,
        kind: 'single',
        prompt: '第二題題目',
        blanks: [{ position: 1, prefix: '（1）' }],
      },
    ],
    results: [
      {
        questionNumber: 2,
        winner: {
          groupId: 'g2',
          groupName: '第二組',
          answers: ['答案 B'],
        },
        fairnessApplied: true,
      },
    ],
    myAnswers: [
      {
        questionNumber: 2,
        state: 'submitted',
        answers: ['答案 A'],
        rank: 2,
      },
    ],
  };
}

describe('學生端結果頁的欄位（005 改判）', () => {
  it('改判說明、答案與順位都在同一個內容欄裡，不會擠到題號欄', () => {
    render(
      <StudentPage
        snapshot={closedSnapshot()}
        sessionInvalid={false}
        sessionInvalidPayload={null}
      />,
    );

    const question = screen.getByRole('region', { name: '第 2 題' });
    // 題號欄只有題號本身。
    expect(question.querySelector('h3')?.textContent).toContain('第 2 題');

    // 內容欄（同一個父層）裝著改判說明、本組答案與本組順位。
    const content = question.querySelector('div');
    expect(content).not.toBeNull();
    expect(within(content as HTMLElement).getByText('本題因公平順位改判')).toBeDefined();
    expect(within(content as HTMLElement).getByText(/本組答案/)).toBeDefined();
    expect(within(content as HTMLElement).getByText(/本組順位/)).toBeDefined();

    // 這兩行必須在內容欄裡（不是題號欄的兄弟節點），否則會被排到隔壁欄。
    for (const text of ['本題因公平順位改判', /本組順位/]) {
      const element = within(content as HTMLElement).getByText(text);
      expect(element.parentElement).toBe(content);
    }
  });
});
