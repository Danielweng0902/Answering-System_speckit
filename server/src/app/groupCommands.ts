/**
 * 組別指令用例：呼叫 domain → 成功才保存 → activity.revision 加 1。
 * 身分由指令路由把關；廣播由路由在 ack 為 ok 時觸發。
 */
import type { DatabaseSync } from 'node:sqlite';
import type {
  Ack,
  GroupCreateInput,
  GroupDeleteInput,
  GroupRenameInput,
  Phase,
} from '@classroom/shared';
import {
  MAX_GROUPS,
  createGroup as registryCreateGroup,
  deleteGroup as registryDeleteGroup,
  renameGroup as registryRenameGroup,
  type GroupRegistryEntry,
  type GroupRegistryResult,
} from '../domain/groupRegistry.js';
import { getActivity, updateActivity } from '../infra/db/activityRepo.js';
import {
  deleteGroup as deleteGroupRow,
  insertGroup,
  listGroups,
  updateGroupName,
  type Group,
} from '../infra/db/groupRepo.js';
import {
  commandError,
  type CommandUseCase,
} from '../infra/socket/commandRouter.js';

export type GroupCommandUseCases = {
  createGroup: CommandUseCase;
  renameGroup: CommandUseCase;
  deleteGroup: CommandUseCase;
};

export type GroupCommandDependencies = {
  /**
   * 刪除成功後（transaction 已 COMMIT）通知 socket 層，讓該組學生收到
   * session:invalid 並降為 guest（contracts/socket-events.md）。
   */
  onGroupDeleted?: ((groupId: string) => void) | undefined;
};

type CommandContext = { phase: Phase; groups: Group[] };

export function createGroupCommands(
  database: DatabaseSync,
  dependencies: GroupCommandDependencies = {},
): GroupCommandUseCases {
  function readContext(): CommandContext {
    const activity = getActivity(database);
    if (!activity) {
      throw new Error('Activity state is not initialized');
    }
    return { phase: activity.phase, groups: listGroups(database) };
  }

  /**
   * 組別異動與 activity.revision +1 在同一個 transaction 內完成；
   * 任何一步失敗都回復，確認失敗不改變任何資料。
   */
  function transact(apply: () => void): void {
    database.exec('BEGIN');
    try {
      apply();
      const activity = getActivity(database);
      if (!activity) {
        throw new Error('Activity state is not initialized');
      }
      updateActivity(database, {
        ...activity,
        revision: activity.revision + 1,
      });
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function evaluate(
    run: (phase: Phase, groups: GroupRegistryEntry[]) => GroupRegistryResult,
    apply: (
      nextGroups: GroupRegistryEntry[],
      previousGroups: GroupRegistryEntry[],
    ) => void,
  ): Ack {
    const context = readContext();
    const result = run(context.phase, context.groups);
    if (!result.ok) {
      // 失敗不得改變任何資料，也不會觸發廣播（contracts 規則）。
      return commandError(result.code);
    }

    transact(() => {
      apply(result.groups, context.groups);
    });
    return { ok: true };
  }

  const createdOf = (
    before: readonly GroupRegistryEntry[],
    after: readonly GroupRegistryEntry[],
  ): GroupRegistryEntry => {
    const previousIds = new Set(before.map((group) => group.id));
    const created = after.find((group) => !previousIds.has(group.id));
    if (!created || after.length > MAX_GROUPS) {
      throw new Error('Group registry returned an inconsistent list');
    }
    return created;
  };

  return {
    createGroup(_identity, payload): Ack {
      const { name } = payload as GroupCreateInput;
      return evaluate(
        (phase, groups) => registryCreateGroup(phase, groups, name),
        (nextGroups, previousGroups) => {
          insertGroup(database, createdOf(previousGroups, nextGroups));
        },
      );
    },

    renameGroup(_identity, payload): Ack {
      const { groupId, name } = payload as GroupRenameInput;
      return evaluate(
        (phase, groups) => registryRenameGroup(phase, groups, groupId, name),
        (groups) => {
          const renamed = groups.find((group) => group.id === groupId);
          if (!renamed) {
            throw new Error('Group registry returned an inconsistent list');
          }
          updateGroupName(database, groupId, renamed.name);
        },
      );
    },

    deleteGroup(_identity, payload): Ack {
      const { groupId } = payload as GroupDeleteInput;
      const ack = evaluate(
        (phase, groups) => registryDeleteGroup(phase, groups, groupId),
        () => {
          deleteGroupRow(database, groupId);
        },
      );
      if (ack.ok) {
        dependencies.onGroupDeleted?.(groupId);
      }
      return ack;
    },
  };
}
