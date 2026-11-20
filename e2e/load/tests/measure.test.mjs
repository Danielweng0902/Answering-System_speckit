/**
 * e2e/load/lib/measure.mjs 的單元測試（node:test + node:assert）。
 * 執行：node --test e2e/load/tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { percentile, summarizeSamples } from '../lib/measure.mjs';

/** 快速造樣本：durations 對應延遲，timeouts 為逾時樣本數。 */
function makeSamples(durations, timeouts = 0) {
  const samples = durations.map((duration) => ({
    scheduledAt: 1000,
    completedAt: 1000 + duration,
    status: 'ok',
  }));
  for (let i = 0; i < timeouts; i += 1) {
    samples.push({ scheduledAt: 1000, completedAt: null, status: 'timeout' });
  }
  return samples;
}

test('percentile：最近秩法，ceil(p × n) 名、空樣本回 null、p 越界時夾在邊界', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20); // ceil(0.5×4)=2 → 第 2 小
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40); // ceil(3.8)=4
  assert.equal(percentile([10, 20, 30, 40], 0.99), 40); // ceil(3.96)=4
  assert.equal(percentile([10, 20, 30, 40], 1), 40);
  assert.equal(percentile([10, 20, 30, 40], 0), 10); // rank 0 夾回 1
  // 1..100：p50=50、p95=95、p99=99
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(hundred, 0.5), 50);
  assert.equal(percentile(hundred, 0.95), 95);
  assert.equal(percentile(hundred, 0.99), 99);
  assert.equal(percentile([7], 0.95), 7);
});

test('summarizeSamples：p50/p95/p99/max 使用最近秩，輸入不必先排序', () => {
  const durations = Array.from({ length: 100 }, (_, i) => 100 - i); // 100..1 倒序
  const summary = summarizeSamples(makeSamples(durations));
  assert.equal(summary.sampleCount, 100);
  assert.equal(summary.successCount, 100);
  assert.equal(summary.timeoutCount, 0);
  assert.equal(summary.timeoutRate, 0);
  assert.equal(summary.p50Ms, 50);
  assert.equal(summary.p95Ms, 95);
  assert.equal(summary.p99Ms, 99);
  assert.equal(summary.maxMs, 100);
});

test('summarizeSamples：逾時計入分母並給出逾時率與逾時數', () => {
  // 3 個完成（10/20/30ms）＋1 個逾時 → 分母 4
  const summary = summarizeSamples(makeSamples([30, 10, 20], 1));
  assert.equal(summary.sampleCount, 4);
  assert.equal(summary.successCount, 3);
  assert.equal(summary.timeoutCount, 1);
  assert.equal(summary.timeoutRate, 0.25);
  // 分位數只對完成的 3 個樣本算：p50=20、p95=30、p99=30
  assert.equal(summary.p50Ms, 20);
  assert.equal(summary.p95Ms, 30);
  assert.equal(summary.p99Ms, 30);
  assert.equal(summary.maxMs, 30);
});

test('summarizeSamples：空樣本時各項統計回 null、計數為 0', () => {
  const summary = summarizeSamples([]);
  assert.deepEqual(summary, {
    sampleCount: 0,
    successCount: 0,
    timeoutCount: 0,
    timeoutRate: null,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    maxMs: null,
  });
});

test('summarizeSamples：全部逾時時分位數回 null、逾時率為 1', () => {
  const summary = summarizeSamples(makeSamples([], 5));
  assert.equal(summary.sampleCount, 5);
  assert.equal(summary.successCount, 0);
  assert.equal(summary.timeoutCount, 5);
  assert.equal(summary.timeoutRate, 1);
  assert.equal(summary.p50Ms, null);
  assert.equal(summary.p95Ms, null);
  assert.equal(summary.p99Ms, null);
  assert.equal(summary.maxMs, null);
});

test('summarizeSamples：單調時間倒退要 throw（含「單調時間」字樣）', () => {
  const regressing = [{ scheduledAt: 1000, completedAt: 999, status: 'ok' }];
  assert.throws(() => summarizeSamples(regressing), /單調時間/);

  // 逾時樣本卻帶了倒退的 completedAt，一樣要 throw。
  const timeoutRegressing = [{ scheduledAt: 1000, completedAt: 500, status: 'timeout' }];
  assert.throws(() => summarizeSamples(timeoutRegressing), /單調時間/);
});

test('summarizeSamples：ok 樣本缺少完成時間或狀態未知要 throw', () => {
  assert.throws(
    () => summarizeSamples([{ scheduledAt: 1, completedAt: null, status: 'ok' }]),
    /完成時間/,
  );
  assert.throws(
    () => summarizeSamples([{ scheduledAt: 1, completedAt: 2, status: 'weird' }]),
    /未知的樣本狀態/,
  );
});
