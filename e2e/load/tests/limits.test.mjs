/** 壓測工具的參數上限（B2）與 managed 伺服器的綁定位址（B4）。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';

import {
  assertWithinLimit,
  MAX_GROUPS,
  MAX_QUESTIONS,
  MAX_RATE_PER_SECOND,
  MAX_ROUNDS,
  MAX_SECONDS,
  MAX_STUDENTS,
} from '../lib/limits.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const httpTool = fileURLToPath(new URL('../http.mjs', import.meta.url));
const socketTool = fileURLToPath(new URL('../socket.mjs', import.meta.url));

/** 跑壓測工具的參數解析（故意用不存在的目標，讓它在解析階段就結束）。 */
async function parseFails(tool, args) {
  const result = await runTool(tool, args);
  if (result.code === 0) {
    throw new Error(`預期參數被拒絕，但工具正常結束了：${tool} ${args.join(' ')}`);
  }
  return result;
}

/** 執行壓測工具並收集輸出（不因非零退出碼而拋錯）。 */
async function runTool(tool, args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [tool, ...args], {
      cwd: repoRoot,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('B2：--rate 超過上限時被拒絕，錯誤訊息說明上限與原因', async () => {
  // 秒數壓到最小：萬一上限被改壞而沒拒絕，也不會真的跑一輪高頻量測把 CI 卡住。
  const result = await parseFails(httpTool, [
    '--rate',
    String(MAX_RATE_PER_SECOND + 1),
    '--url',
    'http://127.0.0.1:1',
    '--seconds',
    '1',
    '--warmup',
    '0',
  ]);
  assert.match(result.stderr, /--rate 不得超過/);
  assert.match(result.stderr, /對外壓測器/);
});

test('B2：--rate 在上限以內時通過解析（上限沒有誤擋合法值）', async () => {
  // 用不存在的本機 port：解析會通過、接著才連線失敗。輸出裡必須沒有
  // 「不得超過」，才能證明上限沒有誤擋合法值。
  // 秒數壓到 1、暖身 0，避免真的跑一輪高頻量測。
  const result = await runTool(httpTool, [
    '--rate',
    String(MAX_RATE_PER_SECOND),
    '--url',
    'http://127.0.0.1:1',
    '--seconds',
    '1',
    '--warmup',
    '0',
  ]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(output, /不得超過/);
  // 確實有跑起來（量測摘要），而不是在參數解析就結束。
  assert.match(output, /rate=1000/);
});

test('B2：rate 清單裡只要有一個超標，整個清單被拒絕', async () => {
  // 秒數壓到最小：萬一上限被改壞而沒拒絕，也不會真的跑一輪高頻量測把 CI 卡住。
  const result = await parseFails(httpTool, [
    '--rate',
    `10,${MAX_RATE_PER_SECOND + 1}`,
    '--url',
    'http://127.0.0.1:1',
    '--seconds',
    '1',
    '--warmup',
    '0',
  ]);
  assert.match(result.stderr, /--rate 不得超過/);
});

test('B2：--students、--seconds、--warmup 都有上限', async () => {
  const students = await parseFails(httpTool, ['--students', String(MAX_STUDENTS + 1)]);
  assert.match(students.stderr, /--students 不得超過/);

  const seconds = await parseFails(httpTool, ['--seconds', String(MAX_SECONDS + 1)]);
  assert.match(seconds.stderr, /--seconds 不得超過/);

  const warmup = await parseFails(httpTool, ['--warmup', '99999']);
  assert.match(warmup.stderr, /--warmup 不得超過/);
});

test('B2：socket 工具的 --groups、--questions、--rounds 也有上限', async () => {
  const groups = await parseFails(socketTool, ['--groups', String(MAX_GROUPS + 1)]);
  assert.match(groups.stderr, /--groups 不得超過/);

  const questions = await parseFails(socketTool, [
    '--groups',
    '2',
    '--questions',
    String(MAX_QUESTIONS + 1),
  ]);
  assert.match(questions.stderr, /--questions 不得超過/);

  const rounds = await parseFails(socketTool, [
    '--groups',
    '2',
    '--rounds',
    String(MAX_ROUNDS + 1),
  ]);
  assert.match(rounds.stderr, /--rounds 不得超過/);
});

test('assertWithinLimit：邊界值允許、超出即擲出、下限也會擲出', () => {
  assert.equal(assertWithinLimit('--x', 10, { min: 1, max: 10 }), 10);
  assert.throws(() => assertWithinLimit('--x', 11, { min: 1, max: 10 }), /不得超過 10/);
  assert.throws(() => assertWithinLimit('--x', 0, { min: 1, max: 10 }), /不得小於 1/);
  assert.throws(() => assertWithinLimit('--x', 1.5, { max: 10, integer: true }), /須為整數/);
  assert.throws(() => assertWithinLimit('--x', Number.NaN, { max: 10 }), /有限數值/);
});

test('B4：managed 伺服器只綁 loopback，量測期間不對 LAN 開放', async () => {
  const { startServer } = await import('../lib/server.mjs');
  const { networkInterfaces } = await import('node:os');
  const { timedRequest } = await import('../lib/httpClient.mjs');

  const server = await startServer();
  try {
    const lanAddresses = Object.values(networkInterfaces())
      .flat()
      .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
      .map((entry) => entry.address);

    // 行為驗證：從 LAN 位址連不進去。
    // （伺服器 stdout 印的本來就是 http://127.0.0.1:port，看 URL 證明不了
    //   實際監聽位址 —— 沒有 HOST 時它一樣印 127.0.0.1，但實際綁的是所有介面。）
    for (const address of lanAddresses) {
      const result = await timedRequest({
        url: `http://${address}:${server.port}/api/health`,
        timeoutMs: 1000,
      });
      assert.notEqual(
        result.status,
        200,
        `managed 伺服器不該能從 LAN 位址 ${address}:${server.port} 連到（量測期間不對 LAN 開放）`,
      );
    }

    // 輔助確認：實際監聽的 socket 位址。lsof 不在時略過（行為驗證已足夠）。
    try {
      const { stdout } = await execFileAsync('lsof', [
        '-nP',
        '-iTCP:' + server.port,
        '-sTCP:LISTEN',
      ]);
      assert.match(stdout, /127\.0\.0\.1:/, `實際監聽位址應為 127.0.0.1：\n${stdout}`);
      assert.doesNotMatch(stdout, /\*:/, `不應綁定所有介面：\n${stdout}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('（lsof 不可用，略過監聽位址的輔助確認）');
      } else {
        throw error;
      }
    }
  } finally {
    await server.stop();
  }
});
