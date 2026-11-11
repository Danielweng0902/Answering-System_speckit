/**
 * 組別規則（純函式）。依 spec.md FR-007–010、data-model.md「Group」
 * 與 contracts/socket-events.md 的錯誤代碼。
 *
 * 輸入目前 phase 與組別清單，回傳新清單或錯誤代碼；不修改輸入。
 */
import { randomUUID } from 'node:crypto';
import type { ErrorCode, Phase } from '@classroom/shared';

export type GroupRegistryEntry = {
  id: string;
  name: string;
  position: number;
};

export type GroupRegistryResult =
  | { ok: true; groups: GroupRegistryEntry[] }
  | { ok: false; code: ErrorCode };

export const MAX_GROUPS = 50;
export const MAX_GROUP_NAME_LENGTH = 30;

function failure(code: ErrorCode): GroupRegistryResult {
  return { ok: false, code };
}

function success(groups: GroupRegistryEntry[]): GroupRegistryResult {
  return { ok: true, groups };
}

/** 名稱去除前後空白後以 Unicode code point 數計算長度。 */
function lengthOf(name: string): number {
  return Array.from(name).length;
}

function checkPhase(phase: Phase): GroupRegistryResult | null {
  return phase === 'preparing' ? null : failure('INVALID_PHASE');
}

function checkName(
  trimmed: string,
  existingNames: readonly string[],
): GroupRegistryResult | null {
  if (trimmed.length === 0) {
    return failure('GROUP_NAME_EMPTY');
  }
  if (lengthOf(trimmed) > MAX_GROUP_NAME_LENGTH) {
    return failure('GROUP_NAME_TOO_LONG');
  }

  const duplicate = existingNames.some(
    (name) => name.trim() === trimmed,
  );
  if (duplicate) {
    return failure('GROUP_NAME_DUPLICATE');
  }

  return null;
}

export function createGroup(
  phase: Phase,
  groups: readonly GroupRegistryEntry[],
  name: string,
  generateId: () => string = randomUUID,
): GroupRegistryResult {
  const phaseError = checkPhase(phase);
  if (phaseError) {
    return phaseError;
  }

  const trimmed = name.trim();
  const nameError = checkName(
    trimmed,
    groups.map((group) => group.name),
  );
  if (nameError) {
    return nameError;
  }

  if (groups.length >= MAX_GROUPS) {
    return failure('GROUP_LIMIT_REACHED');
  }

  const position =
    groups.reduce((max, group) => Math.max(max, group.position), 0) + 1;

  return success([
    ...groups,
    { id: generateId(), name: trimmed, position },
  ]);
}

export function renameGroup(
  phase: Phase,
  groups: readonly GroupRegistryEntry[],
  groupId: string,
  name: string,
): GroupRegistryResult {
  const phaseError = checkPhase(phase);
  if (phaseError) {
    return phaseError;
  }

  const target = groups.find((group) => group.id === groupId);
  if (!target) {
    return failure('GROUP_NOT_FOUND');
  }

  const trimmed = name.trim();
  // 改名成自己原本的名字不算重複。
  const nameError = checkName(
    trimmed,
    groups.filter((group) => group.id !== groupId).map((group) => group.name),
  );
  if (nameError) {
    return nameError;
  }

  return success(
    groups.map((group) =>
      group.id === groupId ? { ...group, name: trimmed } : group,
    ),
  );
}

export function deleteGroup(
  phase: Phase,
  groups: readonly GroupRegistryEntry[],
  groupId: string,
): GroupRegistryResult {
  const phaseError = checkPhase(phase);
  if (phaseError) {
    return phaseError;
  }

  if (!groups.some((group) => group.id === groupId)) {
    return failure('GROUP_NOT_FOUND');
  }

  return success(groups.filter((group) => group.id !== groupId));
}
