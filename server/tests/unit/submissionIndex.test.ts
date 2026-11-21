/**
 * 冷啟效能修正 P1：行程內作答索引的正確性測試。
 *
 * 對拍策略：每走一步寫入（作答、作廢、作廢後重送、活動重設），都把
 * 索引維護的視圖當作投影輸入，與「直接讀資料庫」的既有投影逐一比對；
 * 兩者必須在任何時點完全一致。另外覆蓋兩個索引生命週期路徑：
 * 1. 伺服器重啟 → 索引初始為 dirty，第一次讀取整份重建。
 * 2. 索引尚未具體化（dirty）就收到 COMMIT 後的增量通知 → 必須略過，
 *    等重建時從資料庫讀到同一筆，不能重複折入。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildBoard,
  buildBoardFromView,
  buildClosedMyAnswers,
  buildClosedMyAnswersFromView,
  buildMyAnswers,
  buildMyAnswersFromView,
  buildProgress,
  buildProgressFromView,
  buildResults,
  buildResultsFromView,
  createAnswerDataView,
} from '../../src/app/answerProjections.js';
import { createSubmissionIndex } from '../../src/app/submissionIndex.js';
import type { Activity } from '../../src/infra/db/activityRepo.js';
import { getActivity, updateActivity } from '../../src/infra/db/activityRepo.js';
import {
  clearAll,
  insertSubmission,
  listAllSubmissions,
  maxRank,
  type SubmissionRecord,
  voidSubmission,
} from '../../src/infra/db/answerRepo.js';
import { openDatabase } from '../../src/infra/db/database.js';
import { insertGroup, listGroups } from '../../src/infra/db/groupRepo.js';
import {
  list as listQuestions,
  replaceAll as replaceQuestions,
} from '../../src/infra/db/questionRepo.js';

type Database = ReturnType<typeof openDatabase>;

const databases: Database[] = [];
let db: Database;

const fixedNow = new Date('2026-11-21T10:00:00.000Z');

const GROUP_IDS = ['group-1', 'group-2', 'group-3'];

function activity(): Activity {
  const found = getActivity(db);
  if (!found) {
    throw new Error('activity was not initialized');
  }
  return found;
}

/** 以倉庫函式模擬一次已 COMMIT 的作答，回傳索引要收到的同一筆資料。 */
function submitCommitted(groupId: string, questionNumber: number): SubmissionRecord {
  const question = listQuestions(db).find((candidate) => candidate.number === questionNumber);
  if (!question) {
    throw new Error('question not found');
  }
  const record: SubmissionRecord = {
    id: `sub-${groupId}-q${questionNumber}-${String(Date.now())}-${Math.random()}`,
    questionId: question.id,
    questionNumber,
    groupId,
    rank: maxRank(db, question.id) + 1,
    receivedAt: `2026-11-21T10:${nextReceivedMinute()}:00.000Z`,
    voidedAt: null,
    answers: question.blanks.map((blank) => `ans${String(blank.position)}`),
  };
  insertSubmission(db, {
    id: record.id,
    questionId: record.questionId,
    groupId: record.groupId,
    rank: record.rank,
    receivedAt: record.receivedAt,
    answers: record.answers,
  });
  return record;
}

let receivedMinute = 0;
/** 每筆測試作答給一個合法且遞增的送達時間（ISO 分鐘兩位數補零）。 */
function nextReceivedMinute(): string {
  receivedMinute = (receivedMinute + 1) % 60;
  return String(receivedMinute).padStart(2, '0');
}

function voidCommitted(
  groupId: string,
  questionNumber: number,
): { questionId: string; voidedAt: string } {
  const question = listQuestions(db).find((candidate) => candidate.number === questionNumber);
  if (!question) {
    throw new Error('question not found');
  }
  const voidedAt = '2026-11-21T11:00:00.000Z';
  voidSubmission(db, question.id, groupId, voidedAt);
  return { questionId: question.id, voidedAt };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  databases.push(db);
  receivedMinute = 0;

  insertGroup(db, { id: 'group-2', name: '第二組', position: 2 });
  insertGroup(db, { id: 'group-1', name: '第一組', position: 1 });
  insertGroup(db, { id: 'group-3', name: '第三組', position: 3 });
  replaceQuestions(
    db,
    {
      sourceKind: 'file',
      sourceUrl: null,
      fileName: 'notes.xlsx',
      file: new Uint8Array([1, 2, 3]),
      sheetName: '工作表1',
      importedAt: '2026-11-21T09:00:00.000Z',
    },
    [
      {
        id: 'question-1',
        number: 1,
        kind: 'single',
        prompt: '第一題',
        position: 1,
        blanks: [
          { position: 1, prefix: '(1)', cell: 'A2' },
          { position: 2, prefix: '(2)', cell: 'B2' },
        ],
      },
      {
        id: 'question-2',
        number: 2,
        kind: 'single',
        prompt: '第二題',
        position: 2,
        blanks: [
          { position: 1, prefix: '(1)', cell: 'A3' },
          { position: 2, prefix: '(2)', cell: 'B3' },
        ],
      },
    ],
  );

  const current = activity();
  updateActivity(db, { ...current, phase: 'open', revision: 3 });
});

afterEach(() => {
  for (const open of databases.splice(0)) {
    open.close();
  }
});

describe('createSubmissionIndex', () => {
  it('初始（伺服器重啟情境）第一次 view() 就從資料庫整份重建', () => {
    const committed = submitCommitted('group-1', 1);
    submitCommitted('group-2', 1);
    const index = createSubmissionIndex(db);

    const view = index.view();
    expect(view.submissions).toHaveLength(2);
    expect(view.submissions[0]).toEqual(committed);
    // 進度集合與直接讀庫一致
    expect(buildProgressFromView(view, listGroups(db), listQuestions(db))).toEqual(
      buildProgress(db),
    );
  });

  it('所有寫入路徑的每一步，索引投影與直接讀庫投影完全一致', () => {
    const index = createSubmissionIndex(db);
    const groups = listGroups(db);
    const questions = listQuestions(db);

    const assertParity = (): void => {
      const view = index.view();
      const currentActivity = activity();
      expect(buildBoardFromView(view, groups, currentActivity, questions, fixedNow)).toEqual(
        buildBoard(db, fixedNow),
      );
      expect(buildProgressFromView(view, groups, questions)).toEqual(buildProgress(db));
      expect(buildResultsFromView(view, groups, currentActivity, questions, fixedNow)).toEqual(
        buildResults(db, fixedNow),
      );
      for (const groupId of GROUP_IDS) {
        expect(buildMyAnswersFromView(view, groupId, questions)).toEqual(
          buildMyAnswers(db, groupId),
        );
        expect(
          buildClosedMyAnswersFromView(view, groupId, currentActivity, questions, fixedNow),
        ).toEqual(buildClosedMyAnswers(db, groupId, fixedNow));
      }
      // 結構也直接對拍一次（排序後序列化比較 Map／Set 內容）。
      expect(sortView(view)).toEqual(sortView(createAnswerDataView(listAllSubmissions(db))));
    };

    // 起步空場
    assertParity();

    // 三組交錯作答兩題
    index.applyInsert(submitCommitted('group-1', 1));
    assertParity();
    index.applyInsert(submitCommitted('group-2', 1));
    assertParity();
    index.applyInsert(submitCommitted('group-1', 2));
    assertParity();
    index.applyInsert(submitCommitted('group-3', 2));
    assertParity();

    // 作廢 group-1 第一題 → latest 變 voided、valid 消失、進度扣回
    {
      const { questionId, voidedAt } = voidCommitted('group-1', 1);
      index.applyVoid({ questionId, groupId: 'group-1', voidedAt });
      assertParity();
      const cell = buildBoardFromView(
        index.view(),
        groups,
        activity(),
        questions,
        fixedNow,
      )[0]?.cells.find((entry) => entry.groupId === 'group-1');
      expect(cell?.state).toBe('voided');
    }

    // 作廢後重送：新 rank 的插入成為 latest 與 valid
    {
      const record = submitCommitted('group-1', 1);
      index.applyInsert(record);
      assertParity();
      const cell = buildBoardFromView(
        index.view(),
        groups,
        activity(),
        questions,
        fixedNow,
      )[0]?.cells.find((entry) => entry.groupId === 'group-1');
      expect(cell?.state).toBe('submitted');
      expect(cell?.rank).toBe(record.rank);
    }

    // 公平順位旗標切換：索引只提供作答，winner 由結算即時決定
    {
      const current = activity();
      updateActivity(db, { ...current, fairRankingEnabled: true });
      assertParity();
      updateActivity(db, { ...current, fairRankingEnabled: false });
      assertParity();
    }

    // 活動重設（清空作答）→ invalidate 後整份重建為空
    {
      clearAll(db);
      index.invalidate();
      assertParity();
      expect(index.view().submissions).toHaveLength(0);
      expect(index.view().validGroupIds.size).toBe(0);
      expect(index.view().validQuestionCountByGroup.size).toBe(0);
    }

    // 重設後繼續作答仍正確
    index.applyInsert(submitCommitted('group-2', 2));
    assertParity();
  });

  it('索引尚未具體化（dirty）時收到增量通知：略過、重建時由資料庫讀到同一筆', () => {
    const index = createSubmissionIndex(db);
    const committed = submitCommitted('group-1', 1);

    // 尚未讀過 view()（dirty）就收到 COMMIT 後通知；不應重複折入。
    index.applyInsert(committed);
    index.applyVoid({
      questionId: committed.questionId,
      groupId: committed.groupId,
      voidedAt: '2099-01-01T00:00:00.000Z',
    });

    const view = index.view();
    expect(view.submissions).toHaveLength(1);
    // 上面的 void 並未真的 COMMIT 到資料庫，所以重建後應仍是有效作答；
    // dirty 期間的增量通知完全被忽略，以資料庫為準。
    expect(view.submissions[0]?.voidedAt).toBeNull();
    expect(view.byQuestionGroup.get(committed.questionId)?.size).toBe(1);
  });

  it('繞過指令層的直寫（整合測試播種情境）會被代際偵測並整份重建', () => {
    const index = createSubmissionIndex(db);
    // 先具體化（等同連線建立時的第一次廣播，空場）。
    expect(index.view().submissions).toHaveLength(0);

    // 不經索引通知的直接寫庫（helpers 播種路徑）。
    const committed = submitCommitted('group-1', 1);
    submitCommitted('group-2', 1);

    const view = index.view();
    expect(view.submissions).toHaveLength(2);
    expect(view.byQuestionGroup.get(committed.questionId)?.size).toBe(2);
  });

  it('applyVoid 找不到對應有效作答時標記整份重建，不自相矛盾', () => {
    const index = createSubmissionIndex(db);
    index.view();
    const applied = index.view();
    expect(applied.submissions).toHaveLength(0);

    // 對不存在的作答作廢：索引必須退化為重建（此處重建後仍為空）。
    index.applyVoid({
      questionId: 'question-1',
      groupId: 'group-9',
      voidedAt: '2026-11-21T11:00:00.000Z',
    });
    expect(index.view().submissions).toHaveLength(0);
  });
});

function sortView(view: {
  submissions: readonly SubmissionRecord[];
  byQuestionGroup: ReadonlyMap<
    string,
    ReadonlyMap<string, { valid: SubmissionRecord | null; latest: SubmissionRecord | null }>
  >;
  validGroupIds: ReadonlyMap<string, ReadonlySet<string>>;
  validQuestionCountByGroup: ReadonlyMap<string, number>;
}): string {
  return JSON.stringify({
    // 扁平行列比較內容而非排列：資料庫讀取是「題目位置、rank」全排序，
    // 索引是 commit 插入序（跨題交錯）；結算按 questionId 分桶，同題桶
    // 內兩者都是 rank 升序，語意等價（六個投影的深等於已逐步驗證）。
    submissions: [...view.submissions].map((submission) => submission.id).sort(),
    byQuestionGroup: [...view.byQuestionGroup.entries()]
      .map(
        ([questionId, byGroup]): [
          string,
          Array<[string, string | null, string | null, string | null]>,
        ] => [
          questionId,
          [...byGroup.entries()].map(
            ([groupId, entry]): [string, string | null, string | null, string | null] => [
              groupId,
              entry.valid?.id ?? null,
              entry.latest?.id ?? null,
              entry.latest?.voidedAt ?? null,
            ],
          ),
        ],
      )
      .sort(([a], [b]) => a.localeCompare(b)),
    validGroupIds: [...view.validGroupIds.entries()]
      .map(([questionId, groups]): [string, string[]] => [questionId, [...groups].sort()])
      .sort(([a], [b]) => a.localeCompare(b)),
    validQuestionCountByGroup: [...view.validQuestionCountByGroup.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  });
}
