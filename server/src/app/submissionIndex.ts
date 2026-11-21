/**
 * 行程內作答索引（2026-11-21 冷啟效能修正 P1）。
 *
 * 問題：舊版每次廣播老師／學生快照都呼叫 `listAllSubmissions`，把整場
 * 作答連同答案明細重新 JOIN 讀出；第一輪最後 50 筆廣播裡這一步就占
 * 350.9 ms（53.6%），是事件迴圈排隊的最大單一來源。
 *
 * 做法：伺服器行程內維護一份與 submissions 資料表等價的
 * `AnswerDataView`（作答清單、每題×每組的最新／有效紀錄、有效進度集合）。
 * 寫入路徑只在 **transaction COMMIT 之後** 呼叫 applyInsert／applyVoid，
 * 快照改由索引組出，不再每次全場重讀。
 *
 * 一致性以**資料庫代際計數器**保證（answer_data_generation，database.ts
 * 的 trigger 維護）：
 * - 每次 view() 先比對代際（一次單列讀取）：任何繞過指令層的直寫——
 *   整合測試的播種、未來新的寫入路徑、外部腳本——都會讓代際不同，
 *   索引整份重建後才提供投影，絶不回傳過期內容。
 * - 指令掛鉤在 COMMIT 後讀回代際：恰好只多了自己這一筆（序列化的同步
 *   指令執行下就是 +1）才允許增量折入並記住新代際；其他任何差距一律
 *   退回整份重建，無法逐筆對應時不信任手上的視圖。
 * - 代際的 trigger 更新與外層交易同進退；ROLLBACK 不會留下代際變化，
 *   索引也不會收到失敗作答的通知。
 *
 * 正確性邊界：
 * - winner／順位仍每次由 `computeSettlementFromRecords` 即時結算；公平
 *   順位的跨題改判不需要索引保存任何判定結果，索引只提供作答資料。
 * - 作廢後重送是一筆新 rank 的插入，走 applyInsert，自然成為 latest。
 * - 活動重設（清空作答）與換題組呼叫 invalidate()；下次讀取整份重建。
 * - 伺服器重啟後索引自動重建：初始即未具體化，第一次讀取就重建。
 *
 * 單一行程、單一 DatabaseSync 連線，所有操作都是同步的；SQLite 的讀寫
 * 仍由現有的 BEGIN IMMEDIATE／COMMIT 交易保護，索引不是第二個真相來源，
 * 只是已提交資料的記憶體投影。
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  listAllSubmissions,
  readSubmissionGeneration,
  type SubmissionRecord,
} from '../infra/db/answerRepo.js';
import {
  appendToAnswerDataView,
  createAnswerDataView,
  voidInAnswerDataView,
  type AnswerDataView,
} from './answerProjections.js';

export type SubmissionVoidEvent = {
  questionId: string;
  groupId: string;
  voidedAt: string;
};

export type SubmissionIndex = {
  /**
   * 目前的作答資料視圖；代際不符（含第一次、invalidate 之後、任何直寫）
   * 時先整份重建。回傳的結構由索引維護，呼叫端**不得修改**。
   */
  view(): AnswerDataView;
  /**
   * 記錄**已 COMMIT** 的一次新作答。手邊視圖與資料庫同步時增量折入；
   * 否則丟棄視圖，讓下一次 view() 整份重建。
   */
  applyInsert(record: SubmissionRecord): void;
  /**
   * 記錄**已 COMMIT** 的一次作廢。規則同 applyInsert；找不到對應有效
   * 作答時同樣丟棄視圖以防不一致。
   */
  applyVoid(event: SubmissionVoidEvent): void;
  /**
   * 作答資料整批改變（activity:reset 清空作答、questions:confirm 換題
   * 組）後呼叫；下次 view() 整份重建。便宜（只丟棄手上視圖）。
   */
  invalidate(): void;
};

export function createSubmissionIndex(
  database: DatabaseSync,
): SubmissionIndex {
  let materialized: AnswerDataView | null = null;
  /** 手邊視圖對應的資料庫代際；materialized 為 null 時無意義。 */
  let syncedGeneration = -1;

  /** 丟棄手邊視圖；下次 view() 會整份重建。 */
  function drop(): void {
    materialized = null;
  }

  /**
   * 在指令 COMMIT 後的掛鉤裡判斷是否可以增量折入：讀回代際，必須恰好
   * 只多了自己這一筆（每筆 submit 是一次 INSERT、void 是一次 UPDATE，
   * 各對應代際 +1）。任何其他差距代表期間有繞過指令層的寫入或手邊
   * 視圖並非最新，這時不能逐筆對應，直接丟棄視圖。
   */
  function tryIncremental(apply: (view: AnswerDataView) => boolean): void {
    if (materialized === null) {
      // 本來就沒有具體化的視圖（含 invalidate 之後）：重建會讀到這一
      // 筆，不需要做任何事。
      return;
    }
    const generation = readSubmissionGeneration(database);
    if (generation !== syncedGeneration + 1) {
      drop();
      return;
    }
    const view = materialized;
    if (!apply(view)) {
      drop();
      return;
    }
    syncedGeneration = generation;
  }

  return {
    view() {
      if (
        materialized === null ||
        readSubmissionGeneration(database) !== syncedGeneration
      ) {
        materialized = createAnswerDataView(listAllSubmissions(database));
        syncedGeneration = readSubmissionGeneration(database);
      }
      return materialized;
    },

    applyInsert(record) {
      tryIncremental((view) => {
        appendToAnswerDataView(view, record);
        return true;
      });
    },

    applyVoid(event) {
      tryIncremental((view) =>
        voidInAnswerDataView(
          view,
          event.questionId,
          event.groupId,
          event.voidedAt,
        ),
      );
    },

    invalidate() {
      drop();
    },
  };
}
