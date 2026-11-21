import type { DatabaseSync } from 'node:sqlite';

export type SubmissionRecord = {
  id: string;
  questionId: string;
  questionNumber: number;
  groupId: string;
  rank: number;
  receivedAt: string;
  voidedAt: string | null;
  answers: string[];
};

export type NewSubmission = {
  id: string;
  questionId: string;
  groupId: string;
  rank: number;
  receivedAt: string;
  answers: readonly string[];
};

export type ValidSubmissionAnswer = {
  questionNumber: number;
  blankPosition: number;
  groupId: string;
  groupName: string;
  answer: string;
  rank: number;
  receivedAt: string;
};

type SubmissionRow = Omit<SubmissionRecord, 'answers'>;

type SubmissionAnswerRow = SubmissionRow & {
  answerText: string | null;
};

type SubmissionFilter = {
  questionId?: string;
  groupId?: string;
  validOnly?: boolean;
};

/**
 * 依題目順位與空格順序一次讀回 Submission 及其答案。
 * 過濾條件由固定的幾種呼叫端組合，不接受任意 SQL 字串；LEFT JOIN 保留
 * 沒有答案明細的歷史紀錄，輸出與舊版逐筆查答案的順序完全一致。
 */
function readAnswers(
  database: DatabaseSync,
  filter: SubmissionFilter = {},
): SubmissionRecord[] {
  const conditions: string[] = [];
  const parameters: string[] = [];
  if (filter.questionId !== undefined) {
    conditions.push('s.question_id = ?');
    parameters.push(filter.questionId);
  }
  if (filter.groupId !== undefined) {
    conditions.push('s.group_id = ?');
    parameters.push(filter.groupId);
  }
  if (filter.validOnly === true) {
    conditions.push('s.voided_at IS NULL');
  }
  const where =
    conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
  const rows = database
    .prepare(
      `SELECT s.id, s.question_id AS questionId, q.number AS questionNumber,
              s.group_id AS groupId, s.rank, s.received_at AS receivedAt,
              s.voided_at AS voidedAt, a.answer_text AS answerText
       FROM submissions s
       JOIN questions q ON q.id = s.question_id
       LEFT JOIN submission_answers a ON a.submission_id = s.id
       ${where}
       ORDER BY q.position, s.rank, a.blank_position`,
    )
    .all(...parameters) as SubmissionAnswerRow[];

  const submissions: SubmissionRecord[] = [];
  let current: SubmissionRecord | undefined;
  for (const row of rows) {
    if (current?.id !== row.id) {
      current = {
        id: row.id,
        questionId: row.questionId,
        questionNumber: row.questionNumber,
        groupId: row.groupId,
        rank: row.rank,
        receivedAt: row.receivedAt,
        voidedAt: row.voidedAt,
        answers: [],
      };
      submissions.push(current);
    }
    if (row.answerText !== null) {
      current.answers.push(row.answerText);
    }
  }
  return submissions;
}

/** A group starts at zero and persists independently of answer data resets. */
export function getGroupAnswerRevision(
  database: DatabaseSync,
  groupId: string,
): number {
  const row = database
    .prepare(
      `SELECT answer_revision AS answerRevision
       FROM group_answer_revisions
       WHERE group_id = ?`,
    )
    .get(groupId) as { answerRevision: number } | undefined;
  return row?.answerRevision ?? 0;
}

/** Delete every answer and its blank values inside the caller's transaction. */
export function clearAll(database: DatabaseSync): void {
  database.exec('DELETE FROM submission_answers; DELETE FROM submissions;');
}

/**
 * 2026-11-21 冷啟效能修正 P1：作答資料代際（單列計數器，見 database.ts
 * 的 trigger）。記憶體作答索引用這個純量判斷手上的投影與 submissions
 * 資料表是否仍然一致；任何 INSERT／UPDATE／DELETE 都會遞增它。
 */
export function readSubmissionGeneration(database: DatabaseSync): number {
  const row = database
    .prepare(
      `SELECT generation FROM answer_data_generation WHERE id = 1`,
    )
    .get() as { generation: number } | undefined;
  return row?.generation ?? 0;
}

/** Atomically insert the initial counter or advance an existing one. */
export function incrementGroupAnswerRevision(
  database: DatabaseSync,
  groupId: string,
): void {
  database
    .prepare(
      `INSERT INTO group_answer_revisions (group_id, answer_revision)
       VALUES (?, 1)
       ON CONFLICT(group_id) DO UPDATE
       SET answer_revision = answer_revision + 1`,
    )
    .run(groupId);
}

/** Atomically insert one submission and every blank answer (nested-safe). */
export function insertSubmission(
  database: DatabaseSync,
  submission: NewSubmission,
): void {
  database.exec('SAVEPOINT submission_insert');
  try {
    database
      .prepare(
        `INSERT INTO submissions
           (id, question_id, group_id, rank, received_at, voided_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        submission.id,
        submission.questionId,
        submission.groupId,
        submission.rank,
        submission.receivedAt,
      );

    const insertAnswer = database.prepare(
      `INSERT INTO submission_answers
         (submission_id, blank_position, answer_text)
       VALUES (?, ?, ?)`,
    );
    for (const [index, answer] of submission.answers.entries()) {
      insertAnswer.run(submission.id, index + 1, answer);
    }
    database.exec('RELEASE SAVEPOINT submission_insert');
  } catch (error) {
    database.exec(
      'ROLLBACK TO SAVEPOINT submission_insert; RELEASE SAVEPOINT submission_insert',
    );
    throw error;
  }
}

export function findValid(
  database: DatabaseSync,
  questionId: string,
  groupId: string,
): SubmissionRecord | null {
  return (
    readAnswers(database, { questionId, groupId, validOnly: true })[0] ?? null
  );
}

/**
 * Latest submission by rank, including voided history. readAnswers orders a
 * question's rows by ascending rank, so the group's last row is the newest.
 */
export function findLatest(
  database: DatabaseSync,
  questionId: string,
  groupId: string,
): SubmissionRecord | null {
  return readAnswers(database, { questionId, groupId }).at(-1) ?? null;
}

/** 一次讀回某組全部作答與作廢歷史，仍按題目順位與空格順序排列。 */
export function listByGroup(
  database: DatabaseSync,
  groupId: string,
): SubmissionRecord[] {
  return readAnswers(database, { groupId });
}

/** Mark the group's only valid submission voided inside the caller transaction. */
export function voidSubmission(
  database: DatabaseSync,
  questionId: string,
  groupId: string,
  now: string,
): void {
  database
    .prepare(
      `UPDATE submissions
       SET voided_at = ?
       WHERE question_id = ? AND group_id = ? AND voided_at IS NULL`,
    )
    .run(now, questionId, groupId);
}

/** The maximum rank includes voided submissions; ranks are never reused. */
export function maxRank(database: DatabaseSync, questionId: string): number {
  const row = database
    .prepare(
      `SELECT COALESCE(MAX(rank), 0) AS maxRank
       FROM submissions WHERE question_id = ?`,
    )
    .get(questionId) as { maxRank: number };
  return row.maxRank;
}

export function listByQuestion(
  database: DatabaseSync,
  questionId: string,
): SubmissionRecord[] {
  return readAnswers(database, { questionId });
}

/**
 * 005 判定用：一次讀出全部作答（依題目 position、rank 排序）。
 * 判定需要跨題的送達資料，逐題呼叫 listByQuestion 會重複掃描整張表。
 */
export function listAllSubmissions(database: DatabaseSync): SubmissionRecord[] {
  return readAnswers(database);
}

/** 005：某題目前的有效作答筆數（用來判斷是不是該題的第一個答案）。 */
export function countValidForQuestion(
  database: DatabaseSync,
  questionId: string,
): number {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM submissions
       WHERE question_id = ? AND voided_at IS NULL`,
    )
    .get(questionId) as { count: number };
  return row.count;
}

export function listValidByGroup(
  database: DatabaseSync,
  groupId: string,
): SubmissionRecord[] {
  return readAnswers(database, { groupId, validOnly: true });
}

export type ValidSubmissionPair = {
  questionId: string;
  groupId: string;
};

/** 老師進度只需要有效「題目×組別」，不得為了計數讀回答案文字。 */
export function listValidSubmissionPairs(
  database: DatabaseSync,
): ValidSubmissionPair[] {
  return database
    .prepare(
      `SELECT question_id AS questionId, group_id AS groupId
       FROM submissions
       WHERE voided_at IS NULL`,
    )
    .all() as ValidSubmissionPair[];
}

/**
 * 004 US3（T019）：每個有效答案一列；作廢歷史完全不送進 CSV。
 * 是否搶答成功仍由 app 的 003 result projection 判定，不在 SQL 重算。
 */
export function listValidSubmissionsWithAnswers(
  database: DatabaseSync,
): ValidSubmissionAnswer[] {
  return database
    .prepare(
      `SELECT q.number AS questionNumber,
            a.blank_position AS blankPosition,
            s.group_id AS groupId,
            g.name AS groupName,
            a.answer_text AS answer,
            s.rank,
            s.received_at AS receivedAt
     FROM submissions s
     JOIN questions q ON q.id = s.question_id
     JOIN groups g ON g.id = s.group_id
     JOIN submission_answers a ON a.submission_id = s.id
     WHERE s.voided_at IS NULL
     ORDER BY q.number, s.rank, a.blank_position`,
    )
    .all() as ValidSubmissionAnswer[];
}
