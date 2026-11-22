/**
 * 速率限制的共用元件（登入與進場共用同一份來源正規化）。
 *
 * 2026-11-21 資安審計：
 * - D2-3：`/api/student/join` 原本完全沒有節流，實測 1000 次 join 在 0.6 秒
 *   內全部成功（每次都新增一筆 session）。這裡為進場加上令牌桶。
 * - C6：速率限制的來源紀錄原本沒有總數上限，大量不同來源會把記憶體撐爆；
 *   兩種限制器都改為上限 + LRU 淘汰。
 *
 * 兩種限制器解決的問題不同，所以形狀不同：
 * - 滑動視窗（登入）：計算「最近 60 秒內的失敗次數」，成功登入不計入。
 * - 令牌桶（進場）：計算「可用的進場額度」。整班學生在上課瞬間同時進場是
 *   正常行為（甚至可能共用同一個 NAT 位址），所以必須允許「短時間大量 burst」，
 *   但持續的灌水要被壓到很低的速率——這正是令牌桶擅長的形狀。
 */
import { isIPv6 } from 'node:net';

/** 速率限制的時間視窗長度（毫秒）。 */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * 被追蹤的來源數上限。超過時以 LRU（最久未更新）淘汰最舊的來源，
 * 避免攻擊者用大量不同來源把 Map 撐爆（審計 C6）。
 */
export const MAX_TRACKED_SOURCES = 10_000;

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

/**
 * 淘汰最久未更新的來源，直到回到上限以內。
 *
 * `Map` 保持插入順序；每次更新都先刪除再重新寫入，讓插入順序等同
 * 「最近更新時間由舊到新」，因此第一個就是最該淘汰的來源。
 *
 * 必須在**寫入新來源之後**呼叫，否則 Map 會比上限多一筆。
 */
function evictOverflowingSources<T>(
  sources: Map<string, T>,
  maxSources: number,
): void {
  while (sources.size > maxSources) {
    const oldest = sources.keys().next();
    if (oldest.done) {
      return;
    }
    sources.delete(oldest.value);
  }
}

/**
 * 滑動視窗計數器：每個 key 保留最近 windowMs 內的紀錄時間。
 * 用於登入：只記錄失敗次數。
 */
export type SlidingWindowLimiter = {
  /** 是否仍在上限內（不計數，只檢查）。 */
  isWithinLimit: (key: string) => boolean;
  /** 記錄一次事件。 */
  record: (key: string) => void;
  /** 清空所有來源的紀錄（供測試使用）。 */
  reset: () => void;
};

export type SlidingWindowLimiterOptions = {
  windowMs?: number | undefined;
  maxEvents: number;
  maxSources?: number | undefined;
  now?: (() => number) | undefined;
};

export function createSlidingWindowLimiter(
  options: SlidingWindowLimiterOptions,
): SlidingWindowLimiter {
  const windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const maxEvents = options.maxEvents;
  const maxSources = options.maxSources ?? MAX_TRACKED_SOURCES;
  const now = options.now ?? Date.now;
  const events = new Map<string, number[]>();

  function recent(key: string): number[] {
    const cutoff = now() - windowMs;
    const kept = (events.get(key) ?? []).filter((timestamp) => timestamp >= cutoff);
    if (kept.length === 0) {
      events.delete(key);
    } else {
      // 重新寫入讓 Map 的插入順序代表「最近更新時間」。
      events.delete(key);
      events.set(key, kept);
    }
    return kept;
  }

  return {
    isWithinLimit(key) {
      return recent(key).length < maxEvents;
    },
    record(key) {
      const kept = recent(key);
      events.set(key, [...kept, now()]);
      evictOverflowingSources(events, maxSources);
    },
    reset() {
      events.clear();
    },
  };
}

/**
 * 令牌桶：每個來源有一份額度（token），額度會隨時間補充。
 *
 * - `capacity`（burst）：允許的瞬間用量。整班學生同時進場需要這個餘裕，
 *   即使全班共用同一個 NAT 位址也不能被擋。
 * - `perMinute`（sustained）：持續用量。灌水因此被壓到很低。
 */
export type TokenBucketLimiter = {
  /** 取用一個 token；額度不足時回 false（不扣任何額度）。 */
  take: (key: string) => boolean;
  /** 清空所有來源的額度（供測試使用）。 */
  reset: () => void;
};

export type TokenBucketLimiterOptions = {
  /** 瞬間可用的額度（burst）。 */
  capacity: number;
  /** 每分鐘補充的額度（sustained）。 */
  perMinute: number;
  maxSources?: number | undefined;
  now?: (() => number) | undefined;
};

export function createTokenBucketLimiter(
  options: TokenBucketLimiterOptions,
): TokenBucketLimiter {
  const capacity = options.capacity;
  const refillPerMs = options.perMinute / 60_000;
  const maxSources = options.maxSources ?? MAX_TRACKED_SOURCES;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();

  return {
    take(key) {
      const timestamp = now();
      const bucket = buckets.get(key);

      if (bucket === undefined) {
        buckets.set(key, { tokens: capacity - 1, updatedAt: timestamp });
        evictOverflowingSources(buckets, maxSources);
        return true;
      }

      const elapsed = Math.max(0, timestamp - bucket.updatedAt);
      const tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
      if (tokens < 1) {
        // 額度不足：更新時間但不發放 token。
        buckets.delete(key);
        buckets.set(key, { tokens, updatedAt: timestamp });
        return false;
      }

      buckets.delete(key);
      buckets.set(key, { tokens: tokens - 1, updatedAt: timestamp });
      return true;
    },
    reset() {
      buckets.clear();
    },
  };
}
