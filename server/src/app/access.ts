import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  deleteSession,
  deleteSessionsByRole,
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

/**
 * 2026-11-22（D18）：登出——立即讓這個 session 失效。
 *
 * 呼叫端同時清除瀏覽器端 cookie，所以這裡刪掉伺服器端的 session 後，
 * 即使 cookie 還在（被複製或延遲送出）也已經不能使用。
 */
export function revokeSession(database: DatabaseSync, token: string): void {
  deleteSession(database, hashToken(token));
}

/**
 * 2026-11-22（D18）：伺服器重新啟動時清掉所有老師 session，讓重啟前的
 * 登入狀態一律失效（與 OpenSpec 組 teacher-auth 規格一致）。學生的
 * session 不受影響。
 */
export function deleteTeacherSessions(database: DatabaseSync): void {
  deleteSessionsByRole(database, 'teacher');
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
