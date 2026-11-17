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

function readAnswers(database: DatabaseSync): SubmissionRecord[] {
  const rows = database
    .prepare(
      `SELECT s.id, s.question_id AS questionId, q.number AS questionNumber,
              s.group_id AS groupId, s.rank, s.received_at AS receivedAt,
              s.voided_at AS voidedAt
       FROM submissions s
       JOIN questions q ON q.id = s.question_id
       ORDER BY q.position, s.rank`,
    )
    .all() as SubmissionRow[];
  const answers = database.prepare(
    `SELECT answer_text AS answerText
     FROM submission_answers
     WHERE submission_id = ? ORDER BY blank_position`,
  );

  return rows.map((row) => ({
    ...row,
    answers: (answers.all(row.id) as { answerText: string }[]).map(
      (answer) => answer.answerText,
    ),
  }));
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
    readAnswers(database).find(
      (submission) =>
        submission.questionId === questionId &&
        submission.groupId === groupId &&
        submission.voidedAt === null,
    ) ?? null
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
  const candidates = readAnswers(database).filter(
    (submission) =>
      submission.questionId === questionId && submission.groupId === groupId,
  );
  return candidates.at(-1) ?? null;
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
  return readAnswers(database).filter(
    (submission) => submission.questionId === questionId,
  );
}

export function listValidByGroup(
  database: DatabaseSync,
  groupId: string,
): SubmissionRecord[] {
  return readAnswers(database).filter(
    (submission) =>
      submission.groupId === groupId && submission.voidedAt === null,
  );
}

/**
 * 004 US3（T019）：每個有效答案一列；作廢歷史完全不送進 CSV。
 * 是否搶答成功仍由 app 的 003 result projection 判定，不在 SQL 重算。
 */
export function listValidSubmissionsWithAnswers(
  database: DatabaseSync,
): ValidSubmissionAnswer[] {
  return database.prepare(
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
  ).all() as ValidSubmissionAnswer[];
}
