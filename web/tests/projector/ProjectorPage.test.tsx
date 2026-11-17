import { cleanup, render, screen } from '@testing-library/react';
import type { ProjectorSnapshot, Snapshot } from '@classroom/shared';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectorPage } from '../../src/features/projector/ProjectorPage';

function projectorSnapshot(
  overrides: Partial<ProjectorSnapshot> = {},
): ProjectorSnapshot {
  return {
    role: 'projector',
    revision: 1,
    serverNow: '2026-11-17T09:00:00.000Z',
    phase: 'open',
    countdownEndsAt: null,
    groups: [
      { id: 'g1', name: '第一組' },
      { id: 'g2', name: '第二組' },
    ],
    fairRankingEnabled: false,
    groupStatus: [
      { id: 'g1', name: '第一組', online: true },
      { id: 'g2', name: '第二組', online: false },
    ],
    reveal: {
      revealedQuestionCount: 0,
      questions: [],
      groupWinCounts: null,
    },
    ...overrides,
  };
}

describe('005 投影看板頁面（US3；T024）', () => {
  afterEach(() => {
    cleanup();
  });

  it('搶答中只顯示階段、規則與各組在線狀態，不顯示任何作答資訊', () => {
    render(<ProjectorPage snapshot={projectorSnapshot()} />);

    expect(screen.getByRole('heading', { name: '搶答中' })).toBeDefined();
    expect(screen.getByText('本場先到先得')).toBeDefined();
    expect(screen.getByText('第一組')).toBeDefined();
    expect(screen.getByText('在線')).toBeDefined();
    expect(screen.getByText('離線')).toBeDefined();
    expect(screen.queryByText('答案')).toBeNull();
    expect(screen.queryByText('搶答結果')).toBeNull();
  });

  it('啟用公平順位時標示規則', () => {
    render(
      <ProjectorPage snapshot={projectorSnapshot({ fairRankingEnabled: true })} />,
    );

    expect(screen.getByText('本場使用公平順位')).toBeDefined();
  });

  it('已結束時只顯示已揭曉的題目結果', () => {
    render(
      <ProjectorPage
        snapshot={projectorSnapshot({
          phase: 'closed',
          reveal: {
            revealedQuestionCount: 1,
            questions: [
              {
                questionNumber: 1,
                winnerGroupName: '第一組',
                winnerAnswers: ['答案甲'],
              },
            ],
            groupWinCounts: null,
          },
        })}
      />,
    );

    expect(screen.getByText('第 1 題')).toBeDefined();
    expect(screen.getByText('第一組')).toBeDefined();
    expect(screen.getByText('答案甲')).toBeDefined();
    expect(screen.queryByText('第 2 題')).toBeNull();
  });

  it('全部揭曉後顯示各組搶答成功題數', () => {
    render(
      <ProjectorPage
        snapshot={projectorSnapshot({
          phase: 'closed',
          reveal: {
            revealedQuestionCount: 2,
            questions: [
              {
                questionNumber: 1,
                winnerGroupName: '第一組',
                winnerAnswers: ['答案甲'],
              },
              {
                questionNumber: 2,
                winnerGroupName: '第二組',
                winnerAnswers: ['答案乙'],
              },
            ],
            groupWinCounts: [
              { groupId: 'g1', groupName: '第一組', count: 1 },
              { groupId: 'g2', groupName: '第二組', count: 1 },
            ],
          },
        })}
      />,
    );

    expect(screen.getByText('各組搶答成功題數')).toBeDefined();
    expect(screen.getAllByText('1 題')).toHaveLength(2);
  });

  it('未以老師身分登入時提示需要老師身分', () => {
    const guest: Snapshot = {
      role: 'guest',
      revision: 1,
      serverNow: '2026-11-17T09:00:00.000Z',
      phase: 'preparing',
      countdownEndsAt: null,
      groups: [],
      fairRankingEnabled: false,
    };
    render(
      <MemoryRouter>
        <ProjectorPage snapshot={guest} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('status').textContent).toContain('老師身分');
    expect(screen.getByRole('link', { name: '前往老師端登入' })).toBeDefined();
  });
});
