import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Phase } from '@classroom/shared';

export type Activity = {
  id: number;
  phase: Phase;
  openedAt: string | null;
  countdownEndsAt: string | null;
  closedAt: string | null;
  revision: number;
  /** 005：本場是否啟用公平順位（預設關閉，只有準備中可改）。 */
  fairRankingEnabled: boolean;
  /** 005：投影看板已揭曉到第幾題（依題號順序）。 */
  revealedQuestionCount: number;
};

export function getActivity(database: DatabaseSync): Activity | null {
  const row = database
    .prepare(
      `SELECT id, phase,
              opened_at AS openedAt,
              countdown_ends_at AS countdownEndsAt,
              closed_at AS closedAt,
              revision,
              fair_ranking_enabled AS fairRankingEnabled,
              revealed_question_count AS revealedQuestionCount
       FROM activity
       WHERE id = 1`,
    )
    .get() as (Omit<Activity, 'fairRankingEnabled'> & {
    fairRankingEnabled: number;
  }) | undefined;

  if (row === undefined) {
    return null;
  }
  return { ...row, fairRankingEnabled: row.fairRankingEnabled === 1 };
}

export function updateActivity(
  database: DatabaseSync,
  activity: Activity,
): void {
  database
    .prepare(
      `UPDATE activity
       SET phase = ?, opened_at = ?, countdown_ends_at = ?,
           closed_at = ?, revision = ?,
           fair_ranking_enabled = ?, revealed_question_count = ?
       WHERE id = 1`,
    )
    .run(
      activity.phase,
      activity.openedAt,
      activity.countdownEndsAt,
      activity.closedAt,
      activity.revision,
      activity.fairRankingEnabled ? 1 : 0,
      activity.revealedQuestionCount,
    );
}

/** Global counter used only in the teacher snapshot revision (003 R4). */
export function getAnswerEventCount(database: DatabaseSync): number {
  const row = database
    .prepare(
      `SELECT answer_event_count AS answerEventCount
       FROM activity
       WHERE id = 1`,
    )
    .get() as { answerEventCount: number } | undefined;
  if (!row) {
    throw new Error('Activity state is not initialized');
  }
  return row.answerEventCount;
}

/** Increment atomically inside the submission use case's transaction. */
export function incrementAnswerEventCount(database: DatabaseSync): void {
  database
    .prepare(
      `UPDATE activity
       SET answer_event_count = answer_event_count + 1
       WHERE id = 1`,
    )
    .run();
}

/** Current draft-session identifier; database initialization guarantees it. */
export function getSessionId(database: DatabaseSync): string {
  const row = database
    .prepare('SELECT session_id AS sessionId FROM activity WHERE id = 1')
    .get() as { sessionId: string | null } | undefined;
  if (row?.sessionId == null) {
    throw new Error('Activity session_id is not initialized');
  }
  return row.sessionId;
}

/** Rotate the draft identifier (reset / question replacement use this later). */
export function newSessionId(
  database: DatabaseSync,
  id = randomUUID(),
): string {
  database.prepare('UPDATE activity SET session_id = ? WHERE id = 1').run(id);
  return id;
}
