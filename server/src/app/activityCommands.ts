/**
 * 活動階段指令用例：身分由指令路由把關（只有 teacher），這裡負責
 * 呼叫 domain → 成功且真的改變（changed）才在同一 transaction 保存並
 * activity.revision +1（依 T051／FR-018）。
 *
 * 冪等（open 再 open、closed 再 close）回覆 { ok: true } 但不寫入資料，
 * revision 不變。注意：commandRouter 目前對所有 ok ack 都會廣播，冪等時
 * 會再送一次相同 revision 的 state；前端只接受較新 revision（T027），
 * 因此會忽略，不改 commandRouter 以免影響既有指令與測試。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { Ack } from '@classroom/shared';
import {
  close as closePhase,
  open as openPhase,
  type ActivityTransition,
} from '../domain/activity.js';
import {
  getActivity,
  updateActivity,
  type Activity,
} from '../infra/db/activityRepo.js';
import { countGroups } from '../infra/db/groupRepo.js';
import {
  commandError,
  type CommandUseCase,
} from '../infra/socket/commandRouter.js';

export type ActivityCommandUseCases = {
  openActivity: CommandUseCase;
  closeActivity: CommandUseCase;
};

export function createActivityCommands(
  database: DatabaseSync,
): ActivityCommandUseCases {
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
  ): void {
    if (!result.changed) {
      return;
    }

    database.exec('BEGIN');
    try {
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

  return {
    openActivity(): Ack {
      // activity:open 的 payload 已由路由以 zod 驗證；countdownSeconds
      // 屬 Phase 7（T063），本階段先忽略，countdownEndsAt 維持 null。
      const current = readActivity();
      const result = openPhase(
        current,
        countGroups(database),
        new Date().toISOString(),
      );
      if (!result.ok) {
        // 失敗不得改變任何資料，也不會觸發廣播（contracts 規則）。
        return commandError(result.code);
      }

      persist(result, current);
      return { ok: true };
    },

    closeActivity(): Ack {
      const current = readActivity();
      const result = closePhase(current, new Date().toISOString());
      if (!result.ok) {
        return commandError(result.code);
      }

      persist(result, current);
      return { ok: true };
    },
  };
}
