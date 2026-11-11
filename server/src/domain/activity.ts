/**
 * 活動階段狀態機（純函式）。依 spec.md FR-013–017、data-model.md
 * 「Activity／狀態轉換」與 contracts/socket-events.md 的錯誤代碼。
 *
 * 輸入目前的活動狀態，不修改輸入；回傳新的活動狀態或合約錯誤代碼，
 * 並以 changed 標示是否真的改變（冪等操作回覆成功但 changed = false）。
 * 時間由呼叫方注入，保持純函式可測試。
 *
 * 倒數計時（countdownSeconds、countdownEndsAt）屬 Phase 7：T063 才會在
 * open 加入倒數參數與範圍檢查，目前 countdownEndsAt 一律維持 null。
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

function failure(code: ErrorCode): ActivityTransition {
  return { ok: false, code };
}

/** 冪等：回覆成功，但資料不變（沿用原物件，不重設任何時間欄位）。 */
function unchanged(activity: ActivityState): ActivityTransition {
  return { ok: true, activity, changed: false };
}

/**
 * open：preparing 且至少一組 → open，設定 openedAt（FR-015）。
 * preparing 沒有組別 → NO_GROUPS；open 再 open → 冪等成功；
 * closed → INVALID_PHASE（階段只能往前，AC-001-03）。
 */
export function open(
  activity: ActivityState,
  groupCount: number,
  now: string,
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

  return {
    ok: true,
    changed: true,
    activity: {
      phase: 'open',
      openedAt: now,
      // T063 才會依 countdownSeconds 設定倒數，目前維持 null。
      countdownEndsAt: null,
      closedAt: null,
    },
  };
}

/**
 * close：open → closed，設定 closedAt（FR-016）；closed 再 close 冪等成功
 * （AC-001-05、FR-017）；preparing 依 contracts 的允許階段（只有 open）
 * 拒絕 INVALID_PHASE。
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
