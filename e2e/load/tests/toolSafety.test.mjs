/** 壓測工具的目標限制、HTTPS 與逾期暫存目錄清理。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanupStaleLoadDirs } from '../lib/server.mjs';
import { createAgentForUrl, timedRequest } from '../lib/httpClient.mjs';
import { isLoopbackHostname, resolveTargetUrl } from '../lib/targetSafety.mjs';

test('only-loopback：localhost、127/8 與 ::1 預設可用，其他主機遭拒絕', () => {
  for (const hostname of ['localhost', '127.0.0.1', '127.0.0.9', '::1', '[::1]']) {
    assert.equal(isLoopbackHostname(hostname), true);
  }
  assert.equal(isLoopbackHostname('localhost.example.com'), false);
  assert.equal(isLoopbackHostname('192.168.1.10'), false);
  assert.equal(resolveTargetUrl('http://127.0.0.1:3000', {}).href, 'http://127.0.0.1:3000/');
  assert.throws(() => resolveTargetUrl('http://example.com', {}), /--allow-remote/);
});

test('only-loopback：明確放行遠端後仍只准 HTTPS，避免密碼與 token 明文穿網路', () => {
  assert.equal(
    resolveTargetUrl('https://example.com/base', { allowRemote: true }).href,
    'https://example.com/base',
  );
  assert.throws(() => resolveTargetUrl('http://example.com', { allowRemote: true }), /HTTPS/i);
  assert.throws(() => resolveTargetUrl('ftp://127.0.0.1', {}), /HTTP/);
});

test('HTTPS client：建立 TLS agent，且 https URL 不再拋 ERR_INVALID_PROTOCOL', async () => {
  const agent = createAgentForUrl('https://example.com', { keepAlive: true });
  assert.equal(agent.protocol, 'https:');
  agent.destroy();

  // port 1 預期是本機拒絕連線；重點是可由 node:https 嘗試，不能在建立請求時拋錯。
  const result = await timedRequest({ url: 'https://127.0.0.1:1', timeoutMs: 250 });
  assert.equal(result.error, 'network');
});

test('stale cleanup：逾期且父程序不存在時終止孤兒並刪目錄，活躍程序與新目錄保留', async () => {
  const root = await mkdtemp(join(tmpdir(), 'classroom-load-cleanup-test-'));
  const oldTime = new Date(Date.UTC(2026, 0, 1));
  const alive = new Set([202]);
  const killed = [];
  try {
    const orphan = join(root, 'classroom-load-orphan');
    const active = join(root, 'classroom-load-active');
    const recent = join(root, 'classroom-load-recent');
    for (const [directory, parentPid] of [
      [orphan, 101],
      [active, 102],
      [recent, 103],
    ]) {
      await mkdir(directory);
      await writeFile(
        join(directory, 'load-owner.json'),
        JSON.stringify({ parentPid, childPid: 202 }),
        'utf8',
      );
    }
    await utimes(orphan, oldTime, oldTime);
    await utimes(active, oldTime, oldTime);
    alive.add(102); // active 的負載父程序仍在，即使目錄很舊也不能清掉。

    const result = await cleanupStaleLoadDirs({
      root,
      olderThanMs: 30 * 60 * 1000,
      currentTimeMs: Date.UTC(2026, 0, 2),
      isProcessAlive: (pid) => alive.has(pid),
      terminateProcess: (pid, signal) => killed.push([pid, signal]),
    });

    assert.deepEqual(result.removed, [orphan]);
    assert.deepEqual(killed, [[202, 'SIGTERM']]);
    await assert.rejects(stat(orphan));
    await stat(active);
    await stat(recent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
