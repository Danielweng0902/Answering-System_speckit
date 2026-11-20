import { DatabaseSync, StatementSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildBoard,
  buildClosedMyAnswers,
  buildMyAnswers,
  buildProgress,
  buildResults,
} from '../../src/app/answerProjections.js';
import { createProjectorSnapshot } from '../../src/app/snapshot.js';
import { insertSubmission } from '../../src/infra/db/answerRepo.js';
import { openDatabase } from '../../src/infra/db/database.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { replaceAll } from '../../src/infra/db/questionRepo.js';

const GROUP_COUNT = 50;
const QUESTION_COUNT = 20;
let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function seedFullRoom(): DatabaseSync {
  const target = openDatabase(':memory:');
  database = target;
  for (let index = 1; index <= GROUP_COUNT; index += 1) {
    insertGroup(target, {
      id: `group-${index}`,
      name: `第 ${index} 組`,
      position: index,
    });
  }
  replaceAll(
    target,
    {
      sourceKind: 'file',
      sourceUrl: null,
      fileName: '測試.xlsx',
      file: new Uint8Array(),
      sheetName: '學習單',
      importedAt: '2026-11-20T00:00:00.000Z',
    },
    Array.from({ length: QUESTION_COUNT }, (_value, index) => ({
      id: `q-${index + 1}`,
      number: index + 1,
      kind: 'single' as const,
      prompt: `第 ${index + 1} 題`,
      position: index + 1,
      blanks: [{ position: 1, prefix: '', cell: `G${index + 5}` }],
    })),
  );
  for (let question = 1; question <= QUESTION_COUNT; question += 1) {
    for (let group = 1; group <= GROUP_COUNT; group += 1) {
      insertSubmission(target, {
        id: `s-${question}-${group}`,
        questionId: `q-${question}`,
        groupId: `group-${group}`,
        rank: group,
        receivedAt: new Date(1_700_000_000_000 + group * 1000).toISOString(),
        answers: [`第 ${question} 題第 ${group} 組答案`],
      });
    }
  }
  return target;
}

/** 只計每次投影的 SQL 列讀取，不把建立種子資料的成本算進去。 */
function countReads(run: () => void): number {
  let count = 0;
  const originalAll = StatementSync.prototype.all;
  const originalGet = StatementSync.prototype.get;
  StatementSync.prototype.all = function (...args) {
    count += 1;
    return Reflect.apply(originalAll, this, args) as ReturnType<StatementSync['all']>;
  };
  StatementSync.prototype.get = function (...args) {
    count += 1;
    return Reflect.apply(originalGet, this, args) as ReturnType<StatementSync['get']>;
  };
  try {
    run();
  } finally {
    StatementSync.prototype.all = originalAll;
    StatementSync.prototype.get = originalGet;
  }
  return count;
}

describe('滿場作答投影的 SQL 讀取次數', () => {
  it('零揭曉投影不準備任何作答資料且輸出不變', () => {
    const target = seedFullRoom();
    const originalPrepare = DatabaseSync.prototype.prepare;
    let preparedSubmissionQuery = false;
    DatabaseSync.prototype.prepare = function (...args) {
      const [sql] = args;
      if (typeof sql === 'string' && sql.includes('FROM submissions')) {
        preparedSubmissionQuery = true;
      }
      return Reflect.apply(originalPrepare, this, args) as ReturnType<DatabaseSync['prepare']>;
    };
    let snapshot: ReturnType<typeof createProjectorSnapshot>;
    try {
      snapshot = createProjectorSnapshot(target);
    } finally {
      DatabaseSync.prototype.prepare = originalPrepare;
    }

    expect(preparedSubmissionQuery).toBe(false);
    expect(snapshot.reveal).toEqual({
      revealedQuestionCount: 0,
      questions: [],
      groupWinCounts: null,
    });
  });

  it.each([
    ['open 本組作答', (target: DatabaseSync) => buildMyAnswers(target, 'group-1')],
    ['closed 本組作答', (target: DatabaseSync) => buildClosedMyAnswers(target, 'group-1')],
    ['結果', (target: DatabaseSync) => buildResults(target)],
    ['看板', (target: DatabaseSync) => buildBoard(target)],
    ['進度', (target: DatabaseSync) => buildProgress(target)],
    ['零揭曉投影', (target: DatabaseSync) => createProjectorSnapshot(target)],
  ])('%s 不得逐筆重讀全場答案文字', (_name, projection) => {
    const target = seedFullRoom();

    const reads = countReads(() => {
      projection(target);
    });

    // 題目／組別與少量批讀查詢即可；一千筆作答不得放大成數萬次讀取。
    expect(reads).toBeLessThan(100);
  });
});
