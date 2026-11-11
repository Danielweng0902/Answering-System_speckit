import type { DatabaseSync } from 'node:sqlite';
import type { Role } from '@classroom/shared';

export type SessionRole = Exclude<Role, 'guest'>;

export type Session = {
  tokenHash: string;
  role: SessionRole;
  groupId: string | null;
  createdAt: string;
};

const SESSION_FIELDS = `
  token_hash AS tokenHash,
  role,
  group_id AS groupId,
  created_at AS createdAt
`;

export function insertSession(
  database: DatabaseSync,
  session: Session,
): void {
  database
    .prepare(
      `INSERT INTO sessions (token_hash, role, group_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      session.tokenHash,
      session.role,
      session.groupId,
      session.createdAt,
    );
}

export function findSessionByTokenHash(
  database: DatabaseSync,
  tokenHash: string,
): Session | null {
  const row = database
    .prepare(`SELECT ${SESSION_FIELDS} FROM sessions WHERE token_hash = ?`)
    .get(tokenHash) as Session | undefined;

  return row ?? null;
}

export function findSessionsByGroupId(
  database: DatabaseSync,
  groupId: string,
): Session[] {
  return database
    .prepare(`SELECT ${SESSION_FIELDS} FROM sessions WHERE group_id = ?`)
    .all(groupId) as Session[];
}

export function deleteSession(
  database: DatabaseSync,
  tokenHash: string,
): void {
  database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteSessionsByGroupId(
  database: DatabaseSync,
  groupId: string,
): void {
  database.prepare('DELETE FROM sessions WHERE group_id = ?').run(groupId);
}
