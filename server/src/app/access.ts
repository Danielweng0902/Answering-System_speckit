import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  deleteSession,
  findSessionByTokenHash,
  insertSession,
} from '../infra/db/sessionRepo.js';

export type GuestIdentity = { role: 'guest' };
export type StudentIdentity = { role: 'student'; groupId: string };
export type TeacherIdentity = { role: 'teacher' };
export type AccessIdentity =
  | GuestIdentity
  | StudentIdentity
  | TeacherIdentity;

export type NewSessionIdentity =
  | { role: 'teacher' }
  | { role: 'student'; groupId: string };

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Issue a bearer token and persist only its SHA-256 digest. */
export function issueSession(
  database: DatabaseSync,
  identity: NewSessionIdentity,
  createdAt = new Date().toISOString(),
): string {
  const token = generateToken();
  insertSession(database, {
    tokenHash: hashToken(token),
    role: identity.role,
    groupId: identity.role === 'student' ? identity.groupId : null,
    createdAt,
  });
  return token;
}

/** Remove the student's persisted session when they leave their group. */
export function leaveGroup(database: DatabaseSync, token: string): void {
  deleteSession(database, hashToken(token));
}

/** Missing, empty, unknown, and malformed session tokens are guests. */
export function resolveIdentity(
  database: DatabaseSync,
  token?: string | null,
): AccessIdentity {
  if (!token) {
    return { role: 'guest' };
  }

  const session = findSessionByTokenHash(database, hashToken(token));
  if (!session) {
    return { role: 'guest' };
  }
  if (session.role === 'teacher') {
    return { role: 'teacher' };
  }
  if (session.groupId === null) {
    return { role: 'guest' };
  }

  return { role: 'student', groupId: session.groupId };
}
