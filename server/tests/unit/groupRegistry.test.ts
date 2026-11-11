import { describe, expect, it } from 'vitest';
import {
  createGroup,
  renameGroup,
  deleteGroup,
  type GroupRegistryEntry,
} from '../../src/domain/groupRegistry.js';

function groups(...names: string[]): GroupRegistryEntry[] {
  return names.map((name, index) => ({
    id: `group-${index + 1}`,
    name,
    position: index + 1,
  }));
}

const fixedId = (): string => 'new-group-id';

describe('createGroup', () => {
  it('adds a trimmed group with a generated id and next position', () => {
    const current = groups('第一組');
    const result = createGroup('preparing', current, '  第二組  ', fixedId);

    expect(result).toEqual({
      ok: true,
      groups: [
        { id: 'group-1', name: '第一組', position: 1 },
        { id: 'new-group-id', name: '第二組', position: 2 },
      ],
    });
    // 純函式：不得修改輸入清單。
    expect(current).toEqual([{ id: 'group-1', name: '第一組', position: 1 }]);
  });

  it('uses position 1 for the first group', () => {
    const result = createGroup('preparing', [], '第一組', fixedId);

    expect(result).toEqual({
      ok: true,
      groups: [{ id: 'new-group-id', name: '第一組', position: 1 }],
    });
  });

  it('rejects any phase other than preparing before other checks', () => {
    for (const phase of ['open', 'closed'] as const) {
      expect(createGroup(phase, [], '', fixedId)).toEqual({
        ok: false,
        code: 'INVALID_PHASE',
      });
    }
  });

  it('rejects names that are empty after trimming', () => {
    expect(createGroup('preparing', [], '   ', fixedId)).toEqual({
      ok: false,
      code: 'GROUP_NAME_EMPTY',
    });
  });

  it('rejects names longer than 30 Unicode code points', () => {
    expect(createGroup('preparing', [], 'a'.repeat(31), fixedId)).toEqual({
      ok: false,
      code: 'GROUP_NAME_TOO_LONG',
    });
    // Emoji 佔兩個 UTF-16 code units，但只算一個 code point。
    expect(createGroup('preparing', [], '🎉'.repeat(31), fixedId)).toEqual({
      ok: false,
      code: 'GROUP_NAME_TOO_LONG',
    });
    expect(createGroup('preparing', [], '🎉'.repeat(30), fixedId).ok).toBe(true);
    expect(createGroup('preparing', [], '界'.repeat(30), fixedId).ok).toBe(true);
  });

  it('rejects names duplicating another group after trimming', () => {
    const current = groups('第一組');

    expect(createGroup('preparing', current, ' 第一組 ', fixedId)).toEqual({
      ok: false,
      code: 'GROUP_NAME_DUPLICATE',
    });
  });

  it('rejects the 51st group', () => {
    const current = Array.from({ length: 50 }, (_, index) => ({
      id: `group-${index + 1}`,
      name: `組別${index + 1}`,
      position: index + 1,
    }));

    expect(createGroup('preparing', current, '新組別', fixedId)).toEqual({
      ok: false,
      code: 'GROUP_LIMIT_REACHED',
    });
  });
});

describe('renameGroup', () => {
  it('renames with trimming and keeps id and position', () => {
    const result = renameGroup('preparing', groups('第一組', '第二組'), 'group-2', ' 新名字 ');

    expect(result).toEqual({
      ok: true,
      groups: [
        { id: 'group-1', name: '第一組', position: 1 },
        { id: 'group-2', name: '新名字', position: 2 },
      ],
    });
  });

  it('allows renaming a group to its own current name', () => {
    const result = renameGroup('preparing', groups('第一組'), 'group-1', ' 第一組 ');

    expect(result).toEqual({
      ok: true,
      groups: [{ id: 'group-1', name: '第一組', position: 1 }],
    });
  });

  it('rejects renaming in phases other than preparing', () => {
    expect(renameGroup('open', groups('第一組'), 'group-1', '新名字')).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
  });

  it('rejects renaming a missing group', () => {
    expect(renameGroup('preparing', groups('第一組'), 'missing', '新名字')).toEqual({
      ok: false,
      code: 'GROUP_NOT_FOUND',
    });
  });

  it('rejects empty, too long, and duplicate names', () => {
    const current = groups('第一組', '第二組');

    expect(renameGroup('preparing', current, 'group-2', '  ')).toEqual({
      ok: false,
      code: 'GROUP_NAME_EMPTY',
    });
    expect(renameGroup('preparing', current, 'group-2', 'a'.repeat(31))).toEqual({
      ok: false,
      code: 'GROUP_NAME_TOO_LONG',
    });
    expect(renameGroup('preparing', current, 'group-2', ' 第一組 ')).toEqual({
      ok: false,
      code: 'GROUP_NAME_DUPLICATE',
    });
  });
});

describe('deleteGroup', () => {
  it('removes the group and keeps the remaining groups unchanged', () => {
    const result = deleteGroup('preparing', groups('第一組', '第二組'), 'group-1');

    expect(result).toEqual({
      ok: true,
      groups: [{ id: 'group-2', name: '第二組', position: 2 }],
    });
  });

  it('rejects deletion in phases other than preparing', () => {
    expect(deleteGroup('closed', groups('第一組'), 'group-1')).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
  });

  it('rejects deleting a missing group', () => {
    expect(deleteGroup('preparing', groups('第一組'), 'missing')).toEqual({
      ok: false,
      code: 'GROUP_NOT_FOUND',
    });
  });
});
