/**
 * 活動階段指令用例：身分由指令路由把關（只有 teacher），這裡負責
 * 呼叫 domain → 成功且真的改變（changed）才在同一 transaction 保存並
 * activity.revision +1（依 T051／FR-018）。
 *
 * 冪等（open 再 open、closed 再 close）回覆 { ok: true } 但不寫入資料，
 * revision 不變。注意：commandRouter 目前對所有 ok ack 都會廣播，冪等時
 * 會再送一次相同 revision 的 state；前端只接受較新 revision（T027），
 * 因此會忽略，不改 commandRouter 以免影響既有指令與測試。
 *
 * 倒數（T063、T064）與重設（T069）經由 dependencies 讓 index.ts 掛上
 * 計時器與後續子功能的清理：掛載點都在 transaction COMMIT 之後才呼叫，
 * 失敗或冪等不寫入時不會觸發改變類的掛載點。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { Ack, ActivityFairRankingPayload, ActivityOpenInput, ActivityResetInput } from '@classroom/shared';
import {
  close as closePhase,
  open as openPhase,
  reset as resetPhase,
  type ActivityTransition,
} from '../domain/activity.js';
import {
  getActivity,
  newSessionId,
  updateActivity,
  type Activity,
} from '../infra/db/activityRepo.js';
import { clearAll as clearAllAnswers } from '../infra/db/answerRepo.js';
import { countGroups } from '../infra/db/groupRepo.js';
import { count as countQuestions } from '../infra/db/questionRepo.js';
import { deleteSessionsByRole } from '../infra/db/sessionRepo.js';
import {
  commandError,
  type CommandUseCase,
} from '../infra/socket/commandRouter.js';

export type ActivityCommandUseCases = {
  openActivity: CommandUseCase;
  closeActivity: CommandUseCase;
  resetActivity: CommandUseCase;
  /** 005：老師在準備中切換是否啟用公平順位。 */
  setFairRanking: CommandUseCase;
  /**
   * 倒數到期（T064）：與 closeActivity 共用同一條 close 路徑，回傳是否
   * 真的改變狀態，由呼叫方（index.ts）決定是否廣播；對已結束的活動
   * 不做事，所以與手動結束同時發生也只結束一次（FR-026）。
   */
  closeExpiredActivity: () => boolean;
};

export type ActivityCommandDependencies = {
  /** 指令使用的時鐘（ISO 字串）；預設真實時鐘，測試與 scheduler 對齊。 */
  now?: (() => string) | undefined;
  /**
   * open 成功且真的改變後（COMMIT 之後）呼叫；countdownEndsAt 為 null
   * 表示這次開啟沒有倒數。
   */
  onOpened?: ((countdownEndsAt: string | null) => void) | undefined;
  /** close 回覆成功（含冪等）後呼叫，用來取消倒數計時。 */
  onClosed?: (() => void) | undefined;
  /**
   * reset 成功後（COMMIT 之後）呼叫，讓後續子功能清空各自的資料；
   * 組別與老師的 session 由本子功能保留（data-model.md、FR-022）——
   * 學生的 session 在 transaction 內直接作廢（2026-11-24，D2-1）。
   */
  onReset?: (() => void) | undefined;
};

export function createActivityCommands(
  database: DatabaseSync,
  dependencies: ActivityCommandDependencies = {},
): ActivityCommandUseCases {
  const now = dependencies.now ?? (() => new Date().toISOString());

  function readActivity(): Activity {
    const activity = getActivity(database);
    if (!activity) {
      throw new Error('Activity state is not initialized');
    }
    return activity;
  }

  /** 只有 changed 才保存並 revision +1；冪等直接略過。 */
  function persist(
    result: Extract<ActivityTransition, { ok: true }>,
    current: Activity,
    withinTransaction?: () => void,
    overrides?: Partial<Activity>,
  ): void {
    if (!result.changed) {
      return;
    }

    database.exec('BEGIN');
    try {
      withinTransaction?.();
      updateActivity(database, {
        ...current,
        ...result.activity,
        revision: current.revision + 1,
        ...overrides,
      });
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  /** 手動 close 與倒數到期共用的 close 路徑（T064、FR-026）。 */
  function closeCurrent(): { ack: Ack; changed: boolean } {
    const current = readActivity();
    const result = closePhase(current, now());
    if (!result.ok) {
      // 失敗不得改變任何資料，也不會觸發廣播（contracts 規則）。
      return { ack: commandError(result.code), changed: false };
    }

    persist(result, current);
    // 成功（含冪等）都取消倒數：冪等 close 時已無計時，取消是無害操作。
    dependencies.onClosed?.();
    return { ack: { ok: true }, changed: result.changed };
  }

  return {
    openActivity(_identity, payload): Ack {
      const { countdownSeconds } = payload as ActivityOpenInput;
      const current = readActivity();
      const result = openPhase(
        current,
        countGroups(database),
        // 002（FR-020）：沒有題目不能開啟搶答 → QUESTIONS_REQUIRED。
        countQuestions(database),
        now(),
        countdownSeconds,
      );
      if (!result.ok) {
        // 失敗不得改變任何資料，也不會觸發廣播（contracts 規則）。
        return commandError(result.code);
      }

      persist(result, current);
      if (result.changed) {
        dependencies.onOpened?.(result.activity.countdownEndsAt);
      }
      return { ok: true };
    },

    closeActivity(): Ack {
      return closeCurrent().ack;
    },

    /**
     * 005（FR-001、AC-005-09、AC-005-10）：只有準備中能切換公平順位。
     * 設定成與現況相同時回成功但不寫入、不遞增 revision（冪等）。
     */
    setFairRanking(_identity, payload): Ack {
      const { enabled } = payload as ActivityFairRankingPayload;
      const current = readActivity();
      if (current.phase !== 'preparing') {
        return commandError('INVALID_PHASE');
      }
      if (current.fairRankingEnabled === enabled) {
        return { ok: true };
      }

      database.exec('BEGIN');
      try {
        updateActivity(database, {
          ...current,
          fairRankingEnabled: enabled,
          revision: current.revision + 1,
        });
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      return { ok: true };
    },

    closeExpiredActivity(): boolean {
      return closeCurrent().changed;
    },

    resetActivity(_identity, payload): Ack {
      const { confirm } = payload as ActivityResetInput;
      const current = readActivity();
      const result = resetPhase(current, confirm);
      if (!result.ok) {
        return commandError(result.code);
      }

      persist(result, current, () => {
        // 003 US6 / R8：答案與空格答案、sessionId 必須和 phase/revision
        // 在同一 transaction 改變；兩個作答 counter 刻意保留以維持單調 revision。
        clearAllAnswers(database);
        newSessionId(database);
        // 2026-11-24（D2-1）：重設 = 新的一場 → 一併作廢學生的 session
        // （token 立即失效）。只作廢學生，**老師的 session 保留**（老師還在
        // 操作同一個後端，重設不該把老師踢出）。
        //
        // 2026-11-25（OpenSpec 組同意並追加要求）：**已連線的學生也要被通知**
        // —— socket 的身分是在 connection 時解析一次就存著的，每個指令不重查
        // sessions 表，所以只刪 sessions 表不足以讓已連線的學生回到選組頁。
        // 這裡的 onReset 掛載點會呼叫 broadcaster.invalidateAllStudents()
        // （送 session:invalid、code = 'ACTIVITY_RESET'），把已連線的學生降為
        // guest。理由：另一組的學生端每次送出都重新檢查，重設後一定全部重選；
        // 我們不通知的話，同一班會有人留在原組、有人要重選（兩組必須一致）。
        //
        // 對應條文：Feature Contract D19、001 的 FR-022／AC-001-27。
        deleteSessionsByRole(database, 'student');
      }, {
        // 005 FR-001／FR-023：重設後公平順位回到預設（不啟用）、揭曉進度清空。
        fairRankingEnabled: false,
        revealedQuestionCount: 0,
      });
      if (result.changed) {
        dependencies.onReset?.();
      }
      return { ok: true };
    },
  };
}
