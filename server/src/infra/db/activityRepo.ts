import type { DatabaseSync } from 'node:sqlite';
import type { Phase } from '@classroom/shared';

export type Activity = {
  id: number;
  phase: Phase;
  openedAt: string | null;
  countdownEndsAt: string | null;
  closedAt: string | null;
  revision: number;
};

export function getActivity(database: DatabaseSync): Activity | null {
  const row = database
    .prepare(
      `SELECT id, phase,
              opened_at AS openedAt,
              countdown_ends_at AS countdownEndsAt,
              closed_at AS closedAt,
              revision
       FROM activity
       WHERE id = 1`,
    )
    .get() as Activity | undefined;

  return row ?? null;
}

export function updateActivity(
  database: DatabaseSync,
  activity: Activity,
): void {
  database
    .prepare(
      `UPDATE activity
       SET phase = ?, opened_at = ?, countdown_ends_at = ?,
           closed_at = ?, revision = ?
       WHERE id = 1`,
    )
    .run(
      activity.phase,
      activity.openedAt,
      activity.countdownEndsAt,
      activity.closedAt,
      activity.revision,
    );
}
