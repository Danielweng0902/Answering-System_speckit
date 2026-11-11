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
});
