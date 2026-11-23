import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('未設定 PORT 時使用 3000', () => {
    expect(loadConfig({}).port).toBe(3000);
  });

  it('接受 0–65535 的整數 PORT', () => {
    expect(loadConfig({ PORT: '8080' }).port).toBe(8080);
  });

  it('PORT 不是 0–65535 的整數時啟動失敗，而不是用 NaN 監聽', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow('PORT');
    expect(() => loadConfig({ PORT: '70000' })).toThrow('PORT');
    expect(() => loadConfig({ PORT: '30.5' })).toThrow('PORT');
  });

  it('未設定連線上限時使用預設值（1000 條連線、進場爆發 1000、持續 30／分）', () => {
    const config = loadConfig({});
    expect(config.maxConnections).toBe(1000);
    expect(config.joinRateLimitBurst).toBe(1000);
    expect(config.joinRateLimitPerMinute).toBe(30);
  });

  it('連線上限與進場限流可以從環境變數調整，0 代表不限制', () => {
    const config = loadConfig({
      MAX_CONNECTIONS: '0',
      JOIN_RATE_LIMIT_BURST: '0',
      JOIN_RATE_LIMIT_PER_MINUTE: '0',
    });
    expect(config.maxConnections).toBe(0);
    expect(config.joinRateLimitBurst).toBe(0);
    expect(config.joinRateLimitPerMinute).toBe(0);
  });

  it('上限值不是非負整數時啟動失敗，而不是默默用壞掉的值', () => {
    expect(() => loadConfig({ MAX_CONNECTIONS: 'abc' })).toThrow(
      'MAX_CONNECTIONS',
    );
    expect(() => loadConfig({ MAX_CONNECTIONS: '-1' })).toThrow(
      'MAX_CONNECTIONS',
    );
    expect(() => loadConfig({ JOIN_RATE_LIMIT_BURST: '1.5' })).toThrow(
      'JOIN_RATE_LIMIT_BURST',
    );
    expect(() => loadConfig({ JOIN_RATE_LIMIT_PER_MINUTE: 'many' })).toThrow(
      'JOIN_RATE_LIMIT_PER_MINUTE',
    );
  });
});
