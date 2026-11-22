/**
 * HTTP 登入路由（contracts/http-api.md）。
 *
 * - 密碼比對先各自 sha256 再以 crypto.timingSafeEqual 比較（research R5）。
 * - 同一來源 60 秒內登入失敗 10 次後，之後請求一律 429，直到視窗過期。
 * - 進場（`/api/student/join`）另有令牌桶節流（2026-11-21 資安審計 D2-3）。
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
import {
  createSlidingWindowLimiter,
  createTokenBucketLimiter,
  normalizeRateLimitSource,
  RATE_LIMIT_WINDOW_MS,
  type TokenBucketLimiter,
} from './rateLimiter.js';

const MAX_FAILURES = 10;

/**
 * 進場請求的令牌桶參數（2026-11-21 資安審計 D2-3）。
 *
 * `/api/student/join` 原本完全沒有節流：實測 1000 次 join 在 0.6 秒內全部
 * 成功，每次都新增一筆 session（sessions 表因此可無限成長）。
 *
 * 門檻的形狀來自「一堂課的實際樣態」：
 * - **burst（capacity）**：整班學生在上課瞬間一起進場是正常行為，50 組班級
 *   加上壓測工具的滿房情境都是 200 名學生自同一個來源（NAT）進場，所以
 *   瞬間額度必須容得下整班。
 * - **sustained（perMinute）**：持續灌水要壓到很低。
 *
 * 兩者都由環境變數調整（見 `server/src/config.ts`）：
 * `JOIN_RATE_LIMIT_BURST`（預設 600）與 `JOIN_RATE_LIMIT_PER_MINUTE`（預設 30）。
 */
export const DEFAULT_JOIN_RATE_LIMIT_BURST = 600;
export const DEFAULT_JOIN_RATE_LIMIT_PER_MINUTE = 30;

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

export type JoinRateLimiter = {
  /**
   * 嘗試為這個來源取得一次進場額度。
   *
   * 額度不足時回 false（呼叫端應回覆 429）；取得成功時額度被扣減，
   * 因此「檢查」與「扣減」是同一步驟，不會有競態。
   */
  tryAcquire: (source: string) => boolean;
  /** 清空所有來源的額度（供測試使用）。 */
  reset: () => void;
};

export type JoinRateLimiterOptions = {
  /** 瞬間可用的進場額度（burst）。 */
  burst?: number;
  /** 每分鐘補充的進場額度（sustained）。 */
  perMinute?: number;
  /** 可注入時鐘供測試控制。 */
  now?: () => number;
};

export { normalizeRateLimitSource };

export function createLoginRateLimiter(
  options: LoginRateLimiterOptions = {},
): LoginRateLimiter {
  const limiter = createSlidingWindowLimiter({
    windowMs: options.windowMs ?? RATE_LIMIT_WINDOW_MS,
    maxEvents: options.maxFailures ?? MAX_FAILURES,
    now: options.now,
  });

  return {
    isAllowed: (source) => limiter.isWithinLimit(source),
    recordFailure: (source) => limiter.record(source),
    reset: () => limiter.reset(),
  };
}

/**
 * 進場請求的速率限制（2026-11-21 資安審計 D2-3）。
 *
 * 計數的是「請求次數」而不是「成功次數」：連不存在的組別也會動到資料庫，
 * 因此一併限制。burst 與 perMinute 為 0 時不限制（供測試與特殊部署使用）。
 */
export function createJoinRateLimiter(
  options: JoinRateLimiterOptions = {},
): JoinRateLimiter {
  const burst = options.burst ?? DEFAULT_JOIN_RATE_LIMIT_BURST;
  const perMinute = options.perMinute ?? DEFAULT_JOIN_RATE_LIMIT_PER_MINUTE;

  if (burst <= 0 || perMinute <= 0) {
    return {
      tryAcquire: () => true,
      reset: () => undefined,
    };
  }

  const limiter: TokenBucketLimiter = createTokenBucketLimiter({
    capacity: burst,
    perMinute,
    now: options.now,
  });

  return {
    tryAcquire: (source) => limiter.take(source),
    reset: () => limiter.reset(),
  };
}

export type AuthRoutesDependencies = {
  database: DatabaseSync;
  /** 每次請求即時讀取設定；undefined 或空字串代表未設定密碼。 */
  getTeacherPassword: () => string | undefined;
  rateLimiter?: LoginRateLimiter | undefined;
  /** 進場請求的速率限制；未注入時使用預設門檻。 */
  joinRateLimiter?: JoinRateLimiter | undefined;
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
  const joinLimiter =
    dependencies.joinRateLimiter ?? createJoinRateLimiter();

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
    // 2026-11-21 資安審計 D2-3：進場端點原本無任何節流，這裡加上
    // 與登入同樣的來源限流。超過門檻回 429 TOO_MANY_ATTEMPTS，
    // 沿用既有錯誤代碼，不新增代碼也不改變既有成功路徑的行為。
    const source = normalizeRateLimitSource(request.ip ?? 'unknown');
    if (!joinLimiter.tryAcquire(source)) {
      response.status(429).json(errorBody('TOO_MANY_ATTEMPTS'));
      return;
    }

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
