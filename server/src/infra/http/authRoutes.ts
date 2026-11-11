/**
 * HTTP 登入路由（contracts/http-api.md）。
 *
 * - 密碼比對先各自 sha256 再以 crypto.timingSafeEqual 比較（research R5）。
 * - 同一來源 60 秒內登入失敗 10 次後，之後請求一律 429，直到視窗過期。
 * - 任何地方都不輸出密碼或 token 到 log。
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import {
  ERROR_MESSAGES,
  studentJoinSchema,
  teacherLoginSchema,
  type ErrorCode,
} from '@classroom/shared';
import { issueSession } from '../../app/access.js';
import { getGroupById } from '../db/groupRepo.js';

const WINDOW_MS = 60_000;
const MAX_FAILURES = 10;

export type LoginRateLimiter = {
  /** 來源目前是否還能嘗試登入；false 時應回覆 429。 */
  isAllowed: (source: string) => boolean;
  /** 記錄一次登入失敗。 */
  recordFailure: (source: string) => void;
  /** 清空所有來源的紀錄（供測試使用）。 */
  reset: () => void;
};

export type LoginRateLimiterOptions = {
  windowMs?: number;
  maxFailures?: number;
  /** 可注入時鐘供測試控制。 */
  now?: () => number;
};

export function createLoginRateLimiter(
  options: LoginRateLimiterOptions = {},
): LoginRateLimiter {
  const windowMs = options.windowMs ?? WINDOW_MS;
  const maxFailures = options.maxFailures ?? MAX_FAILURES;
  const now = options.now ?? Date.now;
  const failures = new Map<string, number[]>();

  function recentFailures(source: string): number[] {
    const cutoff = now() - windowMs;
    const kept = (failures.get(source) ?? []).filter(
      (timestamp) => timestamp >= cutoff,
    );
    if (kept.length === 0) {
      failures.delete(source);
    } else {
      failures.set(source, kept);
    }
    return kept;
  }

  return {
    isAllowed(source) {
      return recentFailures(source).length < maxFailures;
    },
    recordFailure(source) {
      failures.set(source, [...recentFailures(source), now()]);
    },
    reset() {
      failures.clear();
    },
  };
}

export type AuthRoutesDependencies = {
  database: DatabaseSync;
  /** 每次請求即時讀取設定；undefined 或空字串代表未設定密碼。 */
  getTeacherPassword: () => string | undefined;
  rateLimiter?: LoginRateLimiter | undefined;
};

function errorBody(code: ErrorCode): {
  error: { code: ErrorCode; message: string };
} {
  return { error: { code, message: ERROR_MESSAGES[code] } };
}

/** 先雜湊再做固定時間比較，避免長度差別洩漏資訊。 */
function passwordsMatch(provided: string, configured: string): boolean {
  const providedHash = createHash('sha256').update(provided, 'utf8').digest();
  const configuredHash = createHash('sha256')
    .update(configured, 'utf8')
    .digest();
  return timingSafeEqual(providedHash, configuredHash);
}

export function createAuthRouter(dependencies: AuthRoutesDependencies): Router {
  const router = Router();
  const limiter =
    dependencies.rateLimiter ?? createLoginRateLimiter();

  router.post('/api/teacher/login', (request, response) => {
    const parsed = teacherLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(errorBody('INVALID_INPUT'));
      return;
    }

    const configuredPassword = dependencies.getTeacherPassword();
    if (configuredPassword === undefined || configuredPassword.length === 0) {
      response.status(503).json(errorBody('TEACHER_PASSWORD_NOT_SET'));
      return;
    }

    const source = request.ip ?? 'unknown';
    if (!limiter.isAllowed(source)) {
      response.status(429).json(errorBody('TOO_MANY_ATTEMPTS'));
      return;
    }

    if (!passwordsMatch(parsed.data.password, configuredPassword)) {
      limiter.recordFailure(source);
      response.status(401).json(errorBody('WRONG_PASSWORD'));
      return;
    }

    const token = issueSession(dependencies.database, { role: 'teacher' });
    response.status(200).json({ token, role: 'teacher' });
  });

  router.post('/api/student/join', (request, response) => {
    const parsed = studentJoinSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(errorBody('INVALID_INPUT'));
      return;
    }

    const { groupId } = parsed.data;
    if (getGroupById(dependencies.database, groupId) === null) {
      response.status(404).json(errorBody('GROUP_NOT_FOUND'));
      return;
    }

    // Students may join during any activity phase (AC-001-09).
    const token = issueSession(dependencies.database, {
      role: 'student',
      groupId,
    });
    response.status(200).json({ token, role: 'student', groupId });
  });

  return router;
}
