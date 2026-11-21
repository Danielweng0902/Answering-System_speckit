import type { DatabaseSync } from 'node:sqlite';
import type {
  AnswerBoardCell,
  AnswerBoardQuestion,
  AnswerProgress,
  QuestionResult,
  StudentClosedAnswer,
  StudentOpenAnswer,
  StudentQuestion,
} from '@classroom/shared';
import { computeSettlementFromRecords } from './answerSettlementService.js';
import { listAllSubmissions, listByGroup, type SubmissionRecord } from '../infra/db/answerRepo.js';
import { getActivity, type Activity } from '../infra/db/activityRepo.js';
import { listGroups, type Group } from '../infra/db/groupRepo.js';
import { list as listQuestions, type StoredQuestion } from '../infra/db/questionRepo.js';

/** Shared question list projection for open and closed student snapshots. */
export function toStudentQuestions(questions: readonly StoredQuestion[]): StudentQuestion[] {
  return questions.map((question) => ({
    number: question.number,
    kind: question.kind,
    prompt: question.prompt,
    blanks: question.blanks.map((blank) => ({
      position: blank.position,
      prefix: blank.prefix,
    })),
  }));
}

/** Shared question list projection for open and closed student snapshots. */
export function buildStudentQuestions(database: DatabaseSync): StudentQuestion[] {
  return toStudentQuestions(listQuestions(database));
}

type QuestionGroupSubmission = {
  valid: SubmissionRecord | null;
  latest: SubmissionRecord | null;
};

export type { QuestionGroupSubmission };

/**
 * 老師看板／結果／進度與學生作答投影共用的「作答資料視圖」。
 *
 * 內容等同 `listAllSubmissions` 的結果（含作廢歷史、同題內依 rank 升序），
 * 但來源可以是資料庫或行程內的增量索引；winner 一律由結算決定，視圖只
 * 提供有哪些作答、順位與答案（原則 VI）。所有成員都是唯讀用途：
 * 增量索引會在寫入成功後就地維護這些結構，投影不得修改它們。
 */
export type AnswerDataView = {
  /** 全場作答（含作廢歷史），同題內依 rank 升序；唯讀。 */
  readonly submissions: readonly SubmissionRecord[];
  /** questionId → groupId → 該題該組的最新／有效作答；唯讀。 */
  readonly byQuestionGroup: ReadonlyMap<string, ReadonlyMap<string, QuestionGroupSubmission>>;
  /** questionId → 目前有有效作答的組別集合（老師進度用）；唯讀。 */
  readonly validGroupIds: ReadonlyMap<string, ReadonlySet<string>>;
  /** groupId → 目前有有效作答的題數（老師進度用）；唯讀。 */
  readonly validQuestionCountByGroup: ReadonlyMap<string, number>;
};

/** 視圖的可變內部型別：只有建立與增量維護程式可以使用。 */
type MutableAnswerDataView = {
  submissions: SubmissionRecord[];
  byQuestionGroup: Map<string, Map<string, QuestionGroupSubmission>>;
  validGroupIds: Map<string, Set<string>>;
  validQuestionCountByGroup: Map<string, number>;
};

/**
 * 把一筆作答折入視圖（重建與增量插入共用同一條規則）。
 *
 * - latest 永遠指向最後折入的一筆（readAnswers 已依 rank 排序，插入序
 *   在同題同組內即 rank 升序）。
 * - 折入有效作答時更新 valid 與進度集合；折入已作廢的一筆只更新
 *   latest，保留先前的 valid（與舊版 createSubmissionIndex 相同）。
 * - 同一題同組只有一次有效作答（部分唯一索引保證），所以「由無有效
 *   變成有有效」才需要把該組加入進度集合與題數計數。
 */
function foldSubmission(view: MutableAnswerDataView, record: SubmissionRecord): void {
  view.submissions.push(record);
  let byGroup = view.byQuestionGroup.get(record.questionId);
  if (byGroup === undefined) {
    byGroup = new Map();
    view.byQuestionGroup.set(record.questionId, byGroup);
  }
  const previous = byGroup.get(record.groupId);
  const hadValid = previous?.valid != null;
  byGroup.set(record.groupId, {
    valid: record.voidedAt === null ? record : (previous?.valid ?? null),
    latest: record,
  });
  if (record.voidedAt === null && !hadValid) {
    let groups = view.validGroupIds.get(record.questionId);
    if (groups === undefined) {
      groups = new Set();
      view.validGroupIds.set(record.questionId, groups);
    }
    if (!groups.has(record.groupId)) {
      groups.add(record.groupId);
      view.validQuestionCountByGroup.set(
        record.groupId,
        (view.validQuestionCountByGroup.get(record.groupId) ?? 0) + 1,
      );
    }
  }
}

/**
 * 讓視圖反映一筆已確認的作廢（與資料庫的 UPDATE 同步）。
 * 找不到對應的有效紀錄代表索引與資料庫不一致，回傳 false 讓呼叫端
 * 觸發整份重建；正常寫入路徑不會走到這裡。
 */
function foldVoid(
  view: MutableAnswerDataView,
  questionId: string,
  groupId: string,
  voidedAt: string,
): boolean {
  const entry = view.byQuestionGroup.get(questionId)?.get(groupId);
  const valid = entry?.valid;
  if (entry === undefined || valid == null) {
    return false;
  }
  valid.voidedAt = voidedAt;
  entry.valid = null;
  const groups = view.validGroupIds.get(questionId);
  if (groups?.delete(groupId) === true) {
    const remaining = (view.validQuestionCountByGroup.get(groupId) ?? 1) - 1;
    if (remaining <= 0) {
      view.validQuestionCountByGroup.delete(groupId);
    } else {
      view.validQuestionCountByGroup.set(groupId, remaining);
    }
  }
  return true;
}

/**
 * 由完整的作答清單建立視圖（資料庫回退路徑與索引重建共用）。
 * 傳入的可以是指定單一組別的作答（學生本組投影），規則不變。
 */
export function createAnswerDataView(submissions: readonly SubmissionRecord[]): AnswerDataView {
  const view: MutableAnswerDataView = {
    submissions: [],
    byQuestionGroup: new Map(),
    validGroupIds: new Map(),
    validQuestionCountByGroup: new Map(),
  };
  for (const submission of submissions) {
    foldSubmission(view, submission);
  }
  return view;
}

/**
 * 行程內增量索引專用（2026-11-21 冷啟效能修正 P1）：把一筆**已 COMMIT**
 * 的新作答折入既有視圖。一般投影不應呼叫；快照一律把視圖當唯讀。
 */
export function appendToAnswerDataView(view: AnswerDataView, record: SubmissionRecord): void {
  foldSubmission(view as MutableAnswerDataView, record);
}

/**
 * 增量索引專用：讓既有視圖反映一筆**已 COMMIT** 的作廢；找不到對應的
 * 有效作答時回傳 false，由索引標記整份重建。
 */
export function voidInAnswerDataView(
  view: AnswerDataView,
  questionId: string,
  groupId: string,
  voidedAt: string,
): boolean {
  return foldVoid(view as MutableAnswerDataView, questionId, groupId, voidedAt);
}

function submissionFor(
  index: AnswerDataView,
  questionId: string,
  groupId: string,
): QuestionGroupSubmission | undefined {
  return index.byQuestionGroup.get(questionId)?.get(groupId);
}

/** open 快照的本組作答：最新一筆（含已作廢）決定狀態，不含順位。 */
export function buildMyAnswersFromView(
  view: AnswerDataView,
  groupId: string,
  questions: readonly StoredQuestion[],
): StudentOpenAnswer[] {
  return questions.map((question) => {
    const submission = submissionFor(view, question.id, groupId)?.latest;
    if (submission == null) {
      return {
        questionNumber: question.number,
        state: 'not_submitted',
        answers: [],
      };
    }
    return {
      questionNumber: question.number,
      state: submission.voidedAt === null ? 'submitted' : 'voided',
      answers: [...submission.answers],
    };
  });
}

/**
 * Build the per-question own-group answer state for open student snapshots.
 * 最新 Submission（rank 最大）決定 submitted／voided，與 closed 投影及
 * buildBoard 的「最新」語意一致；open 快照仍不含 rank（FR-030、FR-017）。
 */
export function buildMyAnswers(database: DatabaseSync, groupId: string): StudentOpenAnswer[] {
  return buildMyAnswersFromView(
    createAnswerDataView(listByGroup(database, groupId)),
    groupId,
    listQuestions(database),
  );
}

/**
 * 結束後每題的搶答結果（003 US4；FR-023、FR-025）。winner 一律只由
 * 判定服務決定（005 FR-009、原則 VI）；無有效作答為 null。
 */
export function buildResultsFromView(
  view: AnswerDataView,
  groups: readonly Group[],
  activity: Activity | null,
  questions: readonly StoredQuestion[],
  now: Date = new Date(),
): QuestionResult[] {
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const settlement = computeSettlementFromRecords(
    { activity, submissions: view.submissions, questions },
    now,
  );

  return questions.map((question) => {
    const result = settlement.get(question.number);
    const winnerGroupId = result?.winnerGroupId ?? null;
    const winnerSubmission =
      winnerGroupId === null
        ? null
        : (submissionFor(view, question.id, winnerGroupId)?.valid ?? null);
    return {
      questionNumber: question.number,
      winner:
        winnerGroupId === null || winnerSubmission === null
          ? null
          : {
              groupId: winnerGroupId,
              groupName: groupNames.get(winnerGroupId) ?? '',
              answers: [...winnerSubmission.answers],
            },
      fairnessApplied: result?.fairnessApplied ?? false,
    };
  });
}

/**
 * 結束後每題的搶答結果（003 US4；FR-023、FR-025）。winner 一律只由
 * 判定服務決定（005 FR-009、原則 VI）；無有效作答為 null。
 */
export function buildResults(database: DatabaseSync, now: Date = new Date()): QuestionResult[] {
  return buildResultsFromView(
    createAnswerDataView(listAllSubmissions(database)),
    listGroups(database),
    getActivity(database),
    listQuestions(database),
    now,
  );
}

/**
 * 結束後本組每題的答案與順位（003 US4；FR-024）。有有效作答時為其順位
 * （啟用公平順位時為公平順位，005 FR-021）；未送出或只有作廢作答時 rank
 * 為 null；作廢保留最新一筆答案供標示。
 */
export function buildClosedMyAnswersFromView(
  view: AnswerDataView,
  groupId: string,
  activity: Activity | null,
  questions: readonly StoredQuestion[],
  now: Date = new Date(),
): StudentClosedAnswer[] {
  const settlement = computeSettlementFromRecords(
    { activity, submissions: view.submissions, questions },
    now,
  );

  return questions.map((question) => {
    const submission = submissionFor(view, question.id, groupId);
    const submitted = submission?.valid;
    if (submitted != null) {
      const rank =
        settlement.get(question.number)?.ranks.find((entry) => entry.groupId === groupId)?.rank ??
        null;
      return {
        questionNumber: question.number,
        state: 'submitted',
        answers: [...submitted.answers],
        rank,
      };
    }
    const latestVoided = submission?.latest;
    if (latestVoided != null && latestVoided.voidedAt !== null) {
      return {
        questionNumber: question.number,
        state: 'voided',
        answers: [...latestVoided.answers],
        rank: null,
      };
    }
    return {
      questionNumber: question.number,
      state: 'not_submitted',
      answers: [],
      rank: null,
    };
  });
}

/**
 * 結束後本組每題的答案與順位（003 US4；FR-024）。有有效作答時為其順位
 * （啟用公平順位時為公平順位，005 FR-021）；未送出或只有作廢作答時 rank
 * 為 null；作廢保留最新一筆答案供標示。
 */
export function buildClosedMyAnswers(
  database: DatabaseSync,
  groupId: string,
  now: Date = new Date(),
): StudentClosedAnswer[] {
  return buildClosedMyAnswersFromView(
    createAnswerDataView(listAllSubmissions(database)),
    groupId,
    getActivity(database),
    listQuestions(database),
    now,
  );
}

/**
 * 老師看板（003 US3；T029；FR-019、FR-022）：題 × 組完整矩陣，每題每組固
 * 定一筆 cell。winnerGroupId 只由判定服務決定（005 FR-009、原則 VI）。
 * cell 取該組該題最新 Submission（rank 最大＝最新，語意同 findLatest）：
 * 有有效作答顯示 submitted 與其順位（啟用公平順位時為公平順位，005 FR-021）；
 * 只有已作廢作答顯示最新一筆 voided 並保留答案與原順位；未送出為
 * not_submitted、[] 與 null。
 */
export function buildBoardFromView(
  view: AnswerDataView,
  groups: readonly Group[],
  activity: Activity | null,
  questions: readonly StoredQuestion[],
  now: Date = new Date(),
): AnswerBoardQuestion[] {
  const settlement = computeSettlementFromRecords(
    { activity, submissions: view.submissions, questions },
    now,
  );

  return questions.map((question) => {
    const result = settlement.get(question.number);
    const winnerGroupId = result?.winnerGroupId ?? null;
    const rankByGroup = new Map((result?.ranks ?? []).map((entry) => [entry.groupId, entry.rank]));
    const cells: AnswerBoardCell[] = groups.map((group) => {
      const submission = submissionFor(view, question.id, group.id);
      const valid = submission?.valid;
      const latest = valid ?? submission?.latest;
      return {
        questionNumber: question.number,
        groupId: group.id,
        groupName: group.name,
        state:
          valid !== undefined && valid !== null
            ? 'submitted'
            : latest !== undefined && latest !== null
              ? 'voided'
              : 'not_submitted',
        answers: latest == null ? [] : [...latest.answers],
        rank:
          valid !== undefined && valid !== null
            ? (rankByGroup.get(group.id) ?? null)
            : latest == null
              ? null
              : latest.rank,
      };
    });
    return {
      questionNumber: question.number,
      cells,
      winnerGroupId,
      settling: result?.settling ?? false,
      fairnessApplied: result?.fairnessApplied ?? false,
    };
  });
}

/**
 * 老師看板（003 US3；T029；FR-019、FR-022）：題 × 組完整矩陣，每題每組固
 * 定一筆 cell。winnerGroupId 只由判定服務決定（005 FR-009、原則 VI）。
 */
export function buildBoard(database: DatabaseSync, now: Date = new Date()): AnswerBoardQuestion[] {
  return buildBoardFromView(
    createAnswerDataView(listAllSubmissions(database)),
    listGroups(database),
    getActivity(database),
    listQuestions(database),
    now,
  );
}

/**
 * 老師進度（003 US3；T029；FR-020）：每題有效送出的組數、每組有效送出的
 * 題數，只計 voided_at IS NULL 的作答。
 */
export function buildProgressFromView(
  view: AnswerDataView,
  groups: readonly Group[],
  questions: readonly StoredQuestion[],
): AnswerProgress {
  return {
    perQuestion: questions.map((question) => ({
      questionNumber: question.number,
      submittedGroupCount: view.validGroupIds.get(question.id)?.size ?? 0,
    })),
    perGroup: groups.map((group) => ({
      groupId: group.id,
      submittedQuestionCount: view.validQuestionCountByGroup.get(group.id) ?? 0,
    })),
  };
}

/**
 * 老師進度（003 US3；T029；FR-020）：每題有效送出的組數、每組有效送出的
 * 題數，只計 voided_at IS NULL 的作答。
 */
export function buildProgress(database: DatabaseSync): AnswerProgress {
  return buildProgressFromView(
    createAnswerDataView(listAllSubmissions(database)),
    listGroups(database),
    listQuestions(database),
  );
}
