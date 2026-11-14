/**
 * 活動階段狀態機（純函式）。依 spec.md FR-013–017、FR-022、FR-023、
 * data-model.md「Activity／狀態轉換」與 contracts/socket-events.md 的錯誤代碼。
 *
 * 輸入目前的活動狀態，不修改輸入；回傳新的活動狀態或合約錯誤代碼，
 * 並以 changed 標示是否真的改變（冪等操作回覆成功但 changed = false）。
 * 時間由呼叫方注入，保持純函式可測試。
 */
import type { ErrorCode, Phase } from '@classroom/shared';

export type ActivityState = {
  phase: Phase;
  openedAt: string | null;
  countdownEndsAt: string | null;
  closedAt: string | null;
};

export type ActivityTransition =
  | { ok: true; activity: ActivityState; changed: boolean }
  | { ok: false; code: ErrorCode };

/** 倒數秒數的允許範圍（FR-023：10 秒到 60 分鐘）。 */
export const MIN_COUNTDOWN_SECONDS = 10;
export const MAX_COUNTDOWN_SECONDS = 3600;

function failure(code: ErrorCode): ActivityTransition {
  return { ok: false, code };
}

/** 冪等：回覆成功，但資料不變（沿用原物件，不重設任何時間欄位）。 */
function unchanged(activity: ActivityState): ActivityTransition {
  return { ok: true, activity, changed: false };
}

/**
 * open：preparing 且至少一組、至少一題 → open，設定 openedAt（FR-015）。
 * preparing 沒有組別 → NO_GROUPS；沒有題目 → QUESTIONS_REQUIRED（002、
 * FR-020）；open 再 open → 冪等成功；closed → INVALID_PHASE（階段只能
 * 往前，AC-001-03）。
 *
 * countdownSeconds（T063、FR-023）：有值時必須是 10–3600 的整數，
 * 否則 COUNTDOWN_OUT_OF_RANGE。檢查順序固定為
 * NO_GROUPS → QUESTIONS_REQUIRED → COUNTDOWN_OUT_OF_RANGE
 * （contracts/socket-events.md）。有效時 countdownEndsAt = now + 秒數
 * （ISO 字串）；沒帶時 countdownEndsAt = null（AC-001-25）。
 */
export function open(
  activity: ActivityState,
  groupCount: number,
  questionCount: number,
  now: string,
  countdownSeconds?: number,
): ActivityTransition {
  if (activity.phase === 'open') {
    return unchanged(activity);
  }
  if (activity.phase === 'closed') {
    return failure('INVALID_PHASE');
  }
  if (groupCount < 1) {
    return failure('NO_GROUPS');
  }
  if (questionCount < 1) {
    return failure('QUESTIONS_REQUIRED');
  }
  if (
    countdownSeconds !== undefined &&
    (!Number.isInteger(countdownSeconds) ||
      countdownSeconds < MIN_COUNTDOWN_SECONDS ||
      countdownSeconds > MAX_COUNTDOWN_SECONDS)
  ) {
    return failure('COUNTDOWN_OUT_OF_RANGE');
  }

  return {
    ok: true,
    changed: true,
    activity: {
      phase: 'open',
      openedAt: now,
      countdownEndsAt:
        countdownSeconds === undefined
          ? null
          : new Date(
              Date.parse(now) + countdownSeconds * 1000,
            ).toISOString(),
      closedAt: null,
    },
  };
}

/**
 * close：open → closed，設定 closedAt（FR-016）；closed 再 close 冪等成功
 * （AC-001-05、FR-017）；preparing 依 contracts 的允許階段（只有 open）
 * 拒絕 INVALID_PHASE。
 *
 * 倒數歸零與手動結束共用此函式：對已結束的活動不做任何事，
 * 所以同時發生也只結束一次（FR-026）。
 */
export function close(
  activity: ActivityState,
  now: string,
): ActivityTransition {
  if (activity.phase === 'closed') {
    return unchanged(activity);
  }
  if (activity.phase === 'preparing') {
    return failure('INVALID_PHASE');
  }

  return {
    ok: true,
    changed: true,
    activity: { ...activity, phase: 'closed', closedAt: now },
  };
}

/**
 * reset：closed 且 confirm === true → preparing（FR-022、AC-001-27），
 * 清空 openedAt、countdownEndsAt、closedAt；組別與 sessions 不在此狀態內，
 * 由呼叫方保留（data-model.md：重設時老師與學生的 Session 都保留）。
 *
 * 檢查順序：階段不是 closed 先回 INVALID_PHASE（AC-001-29），
 * 再檢查 confirm !== true → CONFIRM_REQUIRED（未確認，AC-001-28）。
 */
export function reset(
  activity: ActivityState,
  confirm: unknown,
): ActivityTransition {
  if (activity.phase !== 'closed') {
    return failure('INVALID_PHASE');
  }
  if (confirm !== true) {
    return failure('CONFIRM_REQUIRED');
  }

  return {
    ok: true,
    changed: true,
    activity: {
      phase: 'preparing',
      openedAt: null,
      countdownEndsAt: null,
      closedAt: null,
    },
  };
}
