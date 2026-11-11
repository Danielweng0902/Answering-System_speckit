import { describe, expect, it } from 'vitest';
import {
  close,
  open,
  type ActivityState,
} from '../../src/domain/activity.js';

const OPENED_AT = '2026-11-12T08:00:00.000Z';
const CLOSED_AT = '2026-11-12T08:05:00.000Z';

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

  it('倒數計時屬 Phase 7（T063）：countdownEndsAt 維持 null', () => {
    const result = open(state(), 1, OPENED_AT);

    expect(result.ok && result.activity.countdownEndsAt).toBeNull();
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
