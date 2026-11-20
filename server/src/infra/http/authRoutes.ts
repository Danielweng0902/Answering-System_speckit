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
import { isIPv6 } from 'node:net';
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

/**
 * 速率限制的來源位址正規化（2026-11-21 資安審計 GLM 覆核）。
 *
 * 原本直接用 `request.ip` 當 key，但同一台機器的 IPv4（127.0.0.1）與
 * IPv6（::1）是兩個不同的 key → 換一種位址表示法就能完全繞過限流（實測：
 * 猜 10 次 → 429；改用 [::1] 立刻恢復可猜）。
 *
 * 規則：
 * - IPv4（或 IPv4-mapped 的 IPv6）→ 取 IPv4 部分，維持「同一個出口位址算同一個來源」。
 * - IPv6 → 取 /64 前綴（同一個 IPv6 網段算同一個來源）。
 *
 * 這與 IPv4 的既有行為一致，只是補上 IPv6 的同一性；不影響正常登入。
 */
export function normalizeRateLimitSource(address: string): string {
  const trimmed = address.trim();
  const lower = trimmed.toLowerCase();
  const ipv4Mapped = '::ffff:';
  if (lower.startsWith(ipv4Mapped)) {
    return trimmed.slice(ipv4Mapped.length);
  }
  if (!isIPv6(trimmed)) {
    return trimmed;
  }
  // IPv6 迴圈位址與 IPv4 迴圈位址是同一台機器 → 視為同一個來源，
  // 否則攻擊者只要在 127.0.0.1 與 ::1 之間交替就能完全繞過限流
  // （2026-11-21 資安審計實測）。
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') {
    return '127.0.0.1';
  }
  const head = trimmed.split('::')[0] ?? '';
  const hextets = head.split(':').filter((hextet) => hextet.length > 0);
  return `${hextets.slice(0, 4).join(':')}::/64`;
}

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

    const source = normalizeRateLimitSource(request.ip ?? 'unknown');
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
