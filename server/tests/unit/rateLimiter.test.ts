import { describe, expect, it } from 'vitest';
import {
  createSlidingWindowLimiter,
  createTokenBucketLimiter,
  normalizeRateLimitSource,
} from '../../src/infra/http/rateLimiter.js';

describe('normalizeRateLimitSource', () => {
  it('同一台機器的 IPv4 與 IPv6 映射位址視為同一個來源', () => {
    expect(normalizeRateLimitSource('127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeRateLimitSource('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeRateLimitSource('::1')).toBe('127.0.0.1');
    expect(normalizeRateLimitSource('0:0:0:0:0:0:0:1')).toBe('127.0.0.1');
  });

  it('IPv6 取 /64 前綴作為同一個網段', () => {
    expect(normalizeRateLimitSource('2001:db8:1:2:3:4::5')).toBe(
      '2001:db8:1:2::/64',
    );
    expect(normalizeRateLimitSource('2001:db8:1234:5678::9')).toBe(
      '2001:db8:1234:5678::/64',
    );
  });

  it('無法解析的位址原樣保留', () => {
    expect(normalizeRateLimitSource('unknown')).toBe('unknown');
  });
});

describe('createSlidingWindowLimiter', () => {
  it('超過上限後拒絕，視窗過期後恢復', () => {
    let now = 1_000;
    const limiter = createSlidingWindowLimiter({
      windowMs: 60_000,
      maxEvents: 3,
      now: () => now,
    });

    expect(limiter.isWithinLimit('a')).toBe(true);
    limiter.record('a');
    expect(limiter.isWithinLimit('a')).toBe(true);
    limiter.record('a');
    expect(limiter.isWithinLimit('a')).toBe(true);
    limiter.record('a');
    expect(limiter.isWithinLimit('a')).toBe(false);

    // 視窗內的紀錄到期後重新可用。
    now += 60_001;
    expect(limiter.isWithinLimit('a')).toBe(true);
  });

  it('不同來源互相獨立', () => {
    const limiter = createSlidingWindowLimiter({
      windowMs: 60_000,
      maxEvents: 1,
      now: () => 1_000,
    });

    limiter.record('a');
    expect(limiter.isWithinLimit('a')).toBe(false);
    expect(limiter.isWithinLimit('b')).toBe(true);
  });

  it('被追蹤的來源數有上限，超過時淘汰最久未更新的來源', () => {
    let now = 1_000;
    const limiter = createSlidingWindowLimiter({
      windowMs: 60_000,
      maxEvents: 1,
      maxSources: 2,
      now: () => now,
    });

    limiter.record('a');
    now += 1;
    limiter.record('b');
    now += 1;
    limiter.record('c');

    // 'a' 是最久未更新的來源，應已被淘汰 → 額度重新可用。
    expect(limiter.isWithinLimit('a')).toBe(true);
    // 'c' 剛更新，仍在上限內。
    expect(limiter.isWithinLimit('c')).toBe(false);
  });
});

describe('createTokenBucketLimiter', () => {
  it('burst 額度用完前都發放，用完後改依持續速率發放', () => {
    let now = 0;
    const limiter = createTokenBucketLimiter({
      capacity: 3,
      perMinute: 60,
      now: () => now,
    });

    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(true);
    // burst 用完 → 拒絕。
    expect(limiter.take('a')).toBe(false);

    // 過一秒：補充 1 個額度（每分鐘 60 = 每秒 1）。
    now += 1_000;
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
  });

  it('不同來源互相獨立', () => {
    const limiter = createTokenBucketLimiter({
      capacity: 1,
      perMinute: 60,
      now: () => 0,
    });

    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
    expect(limiter.take('b')).toBe(true);
  });

  it('長時間沒有動用的來源，額度會回到 burst 上限', () => {
    let now = 0;
    const limiter = createTokenBucketLimiter({
      capacity: 2,
      perMinute: 60,
      now: () => now,
    });

    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);

    // 十分鐘後：補充 600 個，但受 burst 上限 2 限制。
    now += 600_000;
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
  });

  it('被追蹤的來源數有上限，超過時淘汰最久未更新的來源', () => {
    let now = 0;
    const limiter = createTokenBucketLimiter({
      capacity: 1,
      perMinute: 60,
      maxSources: 2,
      now: () => now,
    });

    expect(limiter.take('a')).toBe(true);
    now += 1;
    expect(limiter.take('b')).toBe(true);
    now += 1;
    expect(limiter.take('c')).toBe(true);

    // 'a' 是最久未更新的來源，應已被淘汰 → 額度重新可用。
    expect(limiter.take('a')).toBe(true);
  });
});
