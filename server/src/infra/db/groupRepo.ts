import type { DatabaseSync } from 'node:sqlite';

export type Group = {
  id: string;
  name: string;
  position: number;
};

export function listGroups(database: DatabaseSync): Group[] {
  return database
    .prepare(
      `SELECT id, name, position
       FROM groups
       ORDER BY position ASC, rowid ASC`,
    )
    .all() as Group[];
}

export function getGroupById(
  database: DatabaseSync,
  id: string,
): Group | null {
  const row = database
    .prepare('SELECT id, name, position FROM groups WHERE id = ?')
    .get(id) as Group | undefined;

  return row ?? null;
}

export function insertGroup(database: DatabaseSync, group: Group): void {
  database
    .prepare('INSERT INTO groups (id, name, position) VALUES (?, ?, ?)')
    .run(group.id, group.name, group.position);
}

export function updateGroupName(
  database: DatabaseSync,
  id: string,
  name: string,
): void {
  database.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, id);
}

export function deleteGroup(database: DatabaseSync, id: string): void {
  database.prepare('DELETE FROM groups WHERE id = ?').run(id);
}

export function countGroups(database: DatabaseSync): number {
  const row = database.prepare('SELECT COUNT(*) AS count FROM groups').get() as {
    count: number;
  };

  return row.count;
}
