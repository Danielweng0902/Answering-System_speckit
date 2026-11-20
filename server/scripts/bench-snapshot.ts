/**
 * 快照與廣播的效能基準（2026-11-20 效能優化）。
 *
 * 用最壞情況量測「一次作答變更要付出多少成本」：
 *   - 50 組（契約 D20 的上限）× 20 題 × 每題每組都送出
 *   - 量測：老師快照、學生快照、投影快照、看板、進度、結算
 *
 * 用法：
 *   npm run bench --workspace @classroom/server
 *
 * 輸出是「每次呼叫的毫秒數」；優化前後用同一組數字比較。
 */
import { performance } from 'node:perf_hooks';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/infra/db/database.js';
import { insertGroup } from '../src/infra/db/groupRepo.js';
import { replaceAll } from '../src/infra/db/questionRepo.js';
import { insertSubmission } from '../src/infra/db/answerRepo.js';
import { updateActivity, getActivity } from '../src/infra/db/activityRepo.js';
import { createSnapshot, createProjectorSnapshot } from '../src/app/snapshot.js';
import { buildBoard, buildProgress, buildResults } from '../src/app/answerProjections.js';
import { computeSettlement } from '../src/app/answerSettlementService.js';

const GROUP_COUNT = 50;
const QUESTION_COUNT = 20;

function time(label: string, iterations: number, run: () => void): void {
  // 先暖身一次，避免第一次的 JIT／查詢計畫成本。
  run();
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    run();
  }
  const total = performance.now() - started;
  console.log(
    `${label.padEnd(34)} ${(total / iterations).toFixed(3)} ms/次`,
  );
}

function seed(database: DatabaseSync): void {
  for (let index = 1; index <= GROUP_COUNT; index += 1) {
    insertGroup(database, {
      id: `group-${index}`,
      name: `第${index}組`,
      position: index,
    });
  }

  replaceAll(
    database,
    {
      sourceKind: 'file',
      sourceUrl: null,
      fileName: 'bench.xlsx',
      file: new Uint8Array(),
      sheetName: '學習單',
      importedAt: new Date().toISOString(),
    },
    Array.from({ length: QUESTION_COUNT }, (_value, index) => ({
      id: `q-${index + 1}`,
      number: index + 1,
      kind: 'single' as const,
      prompt: `第 ${index + 1} 題的題目敘述`,
      position: index + 1,
      blanks: [{ position: 1, prefix: '', cell: `G${index + 5}` }],
    })),
  );

  // 每題每組都送出（最壞情況）。
  let rank = 1;
  for (let question = 1; question <= QUESTION_COUNT; question += 1) {
    for (let group = 1; group <= GROUP_COUNT; group += 1) {
      insertSubmission(database, {
        id: `s-${question}-${group}`,
        questionId: `q-${question}`,
        groupId: `group-${group}`,
        rank,
        receivedAt: new Date(Date.now() + rank * 10).toISOString(),
        answers: [`答案 ${question}-${group}`],
      });
      rank += 1;
    }
  }

  const activity = getActivity(database);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }
  updateActivity(database, {
    ...activity,
    phase: 'open',
    revision: activity.revision + 1,
  });
}

const database = openDatabase(':memory:');
seed(database);

console.log(
  `基準：${String(GROUP_COUNT)} 組 × ${String(QUESTION_COUNT)} 題 × 每人每題都送出（${String(
    GROUP_COUNT * QUESTION_COUNT,
  )} 筆作答）`,
);
console.log('');

const now = new Date();
const presence: Record<string, number> = {};

time('結算（computeSettlement）', 20, () => {
  computeSettlement(database, now);
});
time('結果投影（buildResults）', 20, () => {
  buildResults(database, now);
});
time('看板（buildBoard）', 20, () => {
  buildBoard(database, now);
});
time('進度（buildProgress）', 20, () => {
  buildProgress(database);
});
time('老師快照（createSnapshot）', 20, () => {
  createSnapshot(database, { role: 'teacher' }, presence, now);
});
time('學生快照（createSnapshot）', 20, () => {
  createSnapshot(database, { role: 'student', groupId: 'group-1' }, presence, now);
});
time('投影快照（createProjectorSnapshot）', 20, () => {
  createProjectorSnapshot(database, presence, now);
});

database.close();
