import { describe, expect, it } from 'vitest';
import {
  close,
  open,
  reset,
  type ActivityState,
} from '../../src/domain/activity.js';

const OPENED_AT = '2026-11-12T08:00:00.000Z';
const CLOSED_AT = '2026-11-12T08:05:00.000Z';
const COUNTDOWN_ENDS_AT = '2026-11-12T08:03:00.000Z';

function state(overrides: Partial<ActivityState> = {}): ActivityState {
  return {
    phase: 'preparing',
    openedAt: null,
    countdownEndsAt: null,
    closedAt: null,
    ...overrides,
  };
}

describe('open', () => {
  it('preparing 且至少一組時轉為 open，設定 openedAt 並標示 changed', () => {
    const result = open(state(), 2, OPENED_AT);

    expect(result).toEqual({
      ok: true,
      changed: true,
      activity: {
        phase: 'open',
        openedAt: OPENED_AT,
        countdownEndsAt: null,
        closedAt: null,
      },
    });
  });

  it('不帶倒數時 countdownEndsAt 為 null（AC-001-25）', () => {
    const result = open(state(), 1, OPENED_AT);

    expect(result.ok && result.activity.countdownEndsAt).toBeNull();
  });

  it.each([9, 3601])('倒數 %i 秒不在範圍內，拒絕 COUNTDOWN_OUT_OF_RANGE（FR-023、AC-001-26）', (seconds) => {
    expect(open(state(), 1, OPENED_AT, seconds)).toEqual({
      ok: false,
      code: 'COUNTDOWN_OUT_OF_RANGE',
    });
  });

  it('倒數不是整數時也拒絕 COUNTDOWN_OUT_OF_RANGE', () => {
    expect(open(state(), 1, OPENED_AT, 10.5)).toEqual({
      ok: false,
      code: 'COUNTDOWN_OUT_OF_RANGE',
    });
  });

  it.each([
    [10, '2026-11-12T08:00:10.000Z'],
    [3600, '2026-11-12T09:00:00.000Z'],
  ] as const)('倒數 %i 秒被接受，countdownEndsAt = now + 秒數（%s）', (seconds, expected) => {
    const result = open(state(), 1, OPENED_AT, seconds);

    expect(result).toEqual({
      ok: true,
      changed: true,
      activity: {
        phase: 'open',
        openedAt: OPENED_AT,
        countdownEndsAt: expected,
        closedAt: null,
      },
    });
  });

  it('沒有組別時優先回 NO_GROUPS，倒數範圍在其後檢查', () => {
    expect(open(state(), 0, OPENED_AT, 9)).toEqual({
      ok: false,
      code: 'NO_GROUPS',
    });
  });

  it('preparing 但沒有組別時拒絕 NO_GROUPS', () => {
    expect(open(state(), 0, OPENED_AT)).toEqual({
      ok: false,
      code: 'NO_GROUPS',
    });
  });

  it('open 再 open 回覆成功但不改變資料（冪等）', () => {
    const current = state({ phase: 'open', openedAt: OPENED_AT });
    const result = open(current, 1, '2026-11-12T08:01:00.000Z');

    expect(result).toEqual({
      ok: true,
      changed: false,
      activity: current,
    });
    // 冪等不得重設 openedAt。
    expect(result.ok && result.activity.openedAt).toBe(OPENED_AT);
  });

  it('closed 不能回到 open，拒絕 INVALID_PHASE（AC-001-03）', () => {
    expect(
      open(
        state({
          phase: 'closed',
          openedAt: OPENED_AT,
          closedAt: CLOSED_AT,
        }),
        1,
        '2026-11-12T08:06:00.000Z',
      ),
    ).toEqual({ ok: false, code: 'INVALID_PHASE' });
  });

  it('失敗時不修改輸入（純函式）', () => {
    const noGroups = state();
    open(noGroups, 0, OPENED_AT);
    expect(noGroups).toEqual(state());

    const closed = state({
      phase: 'closed',
      openedAt: OPENED_AT,
      closedAt: CLOSED_AT,
    });
    open(closed, 1, '2026-11-12T08:06:00.000Z');
    expect(closed).toEqual(
      state({ phase: 'closed', openedAt: OPENED_AT, closedAt: CLOSED_AT }),
    );
  });

  it('成功時也不修改輸入，回傳新的狀態物件', () => {
    const current = state();
    const result = open(current, 1, OPENED_AT);

    expect(current).toEqual(state());
    if (result.ok) {
      expect(result.activity).not.toBe(current);
    } else {
      throw new Error('expected open to succeed');
    }
  });
});

describe('close', () => {
  it('open 轉為 closed，設定 closedAt 並保留 openedAt', () => {
    const result = close(
      state({ phase: 'open', openedAt: OPENED_AT }),
      CLOSED_AT,
    );

    expect(result).toEqual({
      ok: true,
      changed: true,
      activity: {
        phase: 'closed',
        openedAt: OPENED_AT,
        countdownEndsAt: null,
        closedAt: CLOSED_AT,
      },
    });
  });

  it('closed 再 close 回覆成功但不改變資料（冪等，AC-001-05）', () => {
    const current = state({
      phase: 'closed',
      openedAt: OPENED_AT,
      closedAt: CLOSED_AT,
    });
    const result = close(current, '2026-11-12T08:07:00.000Z');

    expect(result).toEqual({
      ok: true,
      changed: false,
      activity: current,
    });
    // 冪等不得重設 closedAt。
    expect(result.ok && result.activity.closedAt).toBe(CLOSED_AT);
  });

  it('preparing 不能 close，拒絕 INVALID_PHASE（contracts 只允許 open）', () => {
    expect(close(state(), CLOSED_AT)).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
  });

  it('失敗與成功都不修改輸入（純函式）', () => {
    const preparing = state();
    close(preparing, CLOSED_AT);
    expect(preparing).toEqual(state());

    const openState = state({ phase: 'open', openedAt: OPENED_AT });
    const result = close(openState, CLOSED_AT);
    expect(openState).toEqual(state({ phase: 'open', openedAt: OPENED_AT }));
    if (result.ok) {
      expect(result.activity).not.toBe(openState);
    } else {
      throw new Error('expected close to succeed');
    }
  });
});

describe('reset', () => {
  it('closed 且 confirm:true 時回到 preparing，清空所有時間欄位（FR-022、AC-001-27）', () => {
    const current = state({
      phase: 'closed',
      openedAt: OPENED_AT,
      countdownEndsAt: COUNTDOWN_ENDS_AT,
      closedAt: CLOSED_AT,
    });
    const result = reset(current, true);

    expect(result).toEqual({
      ok: true,
      changed: true,
      activity: {
        phase: 'preparing',
        openedAt: null,
        countdownEndsAt: null,
        closedAt: null,
      },
    });
    // 純函式：不修改輸入。
    expect(current).toEqual(
      state({
        phase: 'closed',
        openedAt: OPENED_AT,
        countdownEndsAt: COUNTDOWN_ENDS_AT,
        closedAt: CLOSED_AT,
      }),
    );
  });

  it.each(['preparing', 'open'] as const)('%s 時 reset 拒絕 INVALID_PHASE，即使已確認（AC-001-29）', (phase) => {
    const current = state({ phase, openedAt: OPENED_AT });
    expect(reset(current, true)).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
    expect(current).toEqual(state({ phase, openedAt: OPENED_AT }));
  });

  it.each([undefined, false, 'true', 1])('closed 但 confirm 為 %s 時拒絕 CONFIRM_REQUIRED（AC-001-28）', (confirm) => {
    const current = state({
      phase: 'closed',
      openedAt: OPENED_AT,
      closedAt: CLOSED_AT,
    });
    expect(reset(current, confirm)).toEqual({
      ok: false,
      code: 'CONFIRM_REQUIRED',
    });
    expect(current).toEqual(
      state({ phase: 'closed', openedAt: OPENED_AT, closedAt: CLOSED_AT }),
    );
  });
});
