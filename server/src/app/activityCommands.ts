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
import type { Ack, ActivityOpenInput, ActivityResetInput } from '@classroom/shared';
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
import {
  commandError,
  type CommandUseCase,
} from '../infra/socket/commandRouter.js';

export type ActivityCommandUseCases = {
  openActivity: CommandUseCase;
  closeActivity: CommandUseCase;
  resetActivity: CommandUseCase;
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
   * 組別與 sessions 由本子功能保留（data-model.md、FR-022）。
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
      });
      if (result.changed) {
        dependencies.onReset?.();
      }
      return { ok: true };
    },
  };
}
