import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Countdown } from '../src/features/shared/Countdown';

const SERVER_NOW = '2026-11-12T00:00:00.000Z';

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('裝置時鐘比伺服器快 30 秒時仍顯示正確剩餘時間', () => {
    vi.setSystemTime('2026-11-12T00:00:30.000Z');

    render(
      <Countdown
        serverNow={SERVER_NOW}
        countdownEndsAt="2026-11-12T00:01:05.000Z"
      />,
    );

    expect(
      screen.getByRole('timer', { name: '剩餘時間 01:05' }).textContent,
    ).toBe('剩餘時間 01:05');
  });

  it('時間推進後剩餘時間遞減', () => {
    vi.setSystemTime(SERVER_NOW);
    render(
      <Countdown
        serverNow={SERVER_NOW}
        countdownEndsAt="2026-11-12T00:01:05.000Z"
      />,
    );

    expect(screen.getByRole('timer').textContent).toBe('剩餘時間 01:05');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByRole('timer').textContent).toBe('剩餘時間 01:04');
  });

  it('時間到 0 後停在 00:00', () => {
    vi.setSystemTime(SERVER_NOW);
    render(
      <Countdown
        serverNow={SERVER_NOW}
        countdownEndsAt="2026-11-12T00:00:02.000Z"
      />,
    );

    expect(screen.getByRole('timer').textContent).toBe('剩餘時間 00:02');

    act(() => {
      vi.advanceTimersByTime(2250);
    });
    expect(screen.getByRole('timer').textContent).toBe('剩餘時間 00:00');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole('timer').textContent).toBe('剩餘時間 00:00');
  });

  it('沒有倒數結束時間時不顯示', () => {
    vi.setSystemTime(SERVER_NOW);
    const rendered = render(
      <Countdown serverNow={SERVER_NOW} countdownEndsAt={null} />,
    );

    expect(screen.queryByRole('timer')).toBeNull();
    expect(rendered.container.firstChild).toBeNull();
  });
});
