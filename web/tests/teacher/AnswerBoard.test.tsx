import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { TeacherSnapshot } from '@classroom/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnswerBoard } from '../../src/features/teacher/AnswerBoard';
import { sendCommand } from '../../src/lib/socket';

vi.mock('../../src/lib/socket', () => ({
  sendCommand: vi.fn(),
}));

function snapshot(
  overrides: Partial<TeacherSnapshot> = {},
): TeacherSnapshot {
  return {
    revision: 1,
    serverNow: '2026-11-13T00:00:00.000Z',
    phase: 'open',
    countdownEndsAt: null,
    groups: [
      { id: 'group-1', name: '第一組' },
      { id: 'group-2', name: '第二組' },
    ],
    role: 'teacher',
    presence: {},
    questions: [
      { number: 1, kind: 'single', prompt: '第一題題目', blankCount: 1 },
    ],
    guidedNotes: null,
    board: [
      {
        questionNumber: 1,
        winnerGroupId: 'group-1',
        cells: [
          {
            questionNumber: 1,
            groupId: 'group-1',
            groupName: '第一組',
            state: 'submitted',
            answers: ['第一組答案'],
            rank: 1,
          },
          {
            questionNumber: 1,
            groupId: 'group-2',
            groupName: '第二組',
            state: 'voided',
            answers: ['第二組被作廢的答案'],
            rank: 2,
          },
        ],
      },
    ],
    progress: {
      perQuestion: [{ questionNumber: 1, submittedGroupCount: 1 }],
      perGroup: [
        { groupId: 'group-1', submittedQuestionCount: 1 },
        { groupId: 'group-2', submittedQuestionCount: 0 },
      ],
    },
    ...overrides,
  };
}

describe('AnswerBoard 作廢（US3；T053；FR-029）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('按作廢展開確認／取消，取消不送指令；再次確認才以正確 payload 送出', async () => {
    vi.mocked(sendCommand).mockResolvedValue({ ok: true });
    render(<AnswerBoard snapshot={snapshot()} />);

    expect(screen.getByRole('button', { name: '作廢' })).toBeDefined();
    expect(screen.getByText('已作廢：第二組被作廢的答案')).toBeDefined();
    expect(
      screen.getAllByRole('button', { name: '作廢' }),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '作廢' }));
    expect(sendCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(sendCommand).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '確認作廢' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '作廢' }));
    fireEvent.click(
      screen.getByRole('button', { name: '確認作廢' }),
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('answer:void', {
        groupId: 'group-1',
        questionNumber: 1,
      });
    });
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  it('ack 失敗時顯示伺服器訊息', async () => {
    vi.mocked(sendCommand).mockResolvedValue({
      ok: false,
      error: {
        code: 'SUBMISSION_NOT_FOUND',
        message: '找不到可以作廢的作答，請重新整理後再試',
      },
    });
    render(<AnswerBoard snapshot={snapshot()} />);

    fireEvent.click(screen.getByRole('button', { name: '作廢' }));
    fireEvent.click(
      screen.getByRole('button', { name: '確認作廢' }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      '找不到可以作廢的作答，請重新整理後再試',
    );
  });

  it('非 open 階段不顯示作廢入口', () => {
    render(<AnswerBoard snapshot={snapshot({ phase: 'closed' })} />);

    expect(screen.queryByRole('button', { name: '作廢' })).toBeNull();
    expect(screen.getByText('已送出：第一組答案')).toBeDefined();
  });
});
