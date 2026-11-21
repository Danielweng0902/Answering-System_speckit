import type { DatabaseSync } from 'node:sqlite';
import type {
  ProjectorSnapshot,
  Snapshot,
  SnapshotBase,
} from '@classroom/shared';
import type { AccessIdentity } from './access.js';
import {
  buildBoard,
  buildClosedMyAnswers,
  buildMyAnswers,
  buildProgress,
  buildResults,
  buildStudentQuestions,
} from './answerProjections.js';
import {
  getActivity,
  getAnswerEventCount,
  getSessionId,
} from '../infra/db/activityRepo.js';
import { getGroupAnswerRevision } from '../infra/db/answerRepo.js';
import { listGroups } from '../infra/db/groupRepo.js';
import {
  getGuidedNotes,
  list as listQuestions,
} from '../infra/db/questionRepo.js';

export function createSnapshot(
  database: DatabaseSync,
  identity: AccessIdentity,
  presence: Readonly<Record<string, number>> = {},
  now = new Date(),
): Snapshot {
  const activity = getActivity(database);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }

  const revision =
    identity.role === 'teacher'
      ? activity.revision + getAnswerEventCount(database)
      : identity.role === 'student'
        ? activity.revision + getGroupAnswerRevision(database, identity.groupId)
        : activity.revision;

  const base: SnapshotBase = {
    revision,
    serverNow: now.toISOString(),
    phase: activity.phase,
    countdownEndsAt: activity.countdownEndsAt,
    groups: listGroups(database).map((group) => ({
      id: group.id,
      name: group.name,
    })),
    // 005 FR-001／FR-012：所有角色都知道本場用哪一種順位規則。
    fairRankingEnabled: activity.fairRankingEnabled,
  };

  switch (identity.role) {
    case 'guest':
      return { ...base, role: 'guest' };
    case 'student': {
      const studentBase = {
        ...base,
        role: 'student' as const,
        myGroupId: identity.groupId,
        sessionId: getSessionId(database),
      };
      if (activity.phase === 'preparing') {
        return { ...studentBase, phase: 'preparing' as const };
      }
      if (activity.phase === 'open') {
        return {
          ...studentBase,
          phase: 'open' as const,
          questions: buildStudentQuestions(database),
          myAnswers: buildMyAnswers(database, identity.groupId),
        };
      }
      // 003 US4（T035）：closed 學生快照含每題搶答結果與本組含順位的答案。
      return {
        ...studentBase,
        phase: 'closed' as const,
        questions: buildStudentQuestions(database),
        results: buildResults(database, now),
        myAnswers: buildClosedMyAnswers(database, identity.groupId, now),
      };
    }
    case 'teacher': {
      // 002（FR-016）：題目摘要與學習單資訊只有老師快照有；003 學生快照
      // 的 questions 另有自己（空格 prefix）與本組作答投影（原則 VI）。
      const guidedNotes = getGuidedNotes(database);
      return {
        ...base,
        role: 'teacher',
        presence: { ...presence },
        questions: listQuestions(database).map((question) => ({
          number: question.number,
          kind: question.kind,
          prompt: question.prompt,
          blankCount: question.blanks.length,
        })),
        guidedNotes: guidedNotes
          ? {
              sheetName: guidedNotes.sheetName,
              sourceKind: guidedNotes.sourceKind,
              fileName: guidedNotes.fileName,
              importedAt: guidedNotes.importedAt,
            }
          : null,
        // 003 US3（T030；FR-019–FR-022）：老師快照任何階段都輸出看板與進度。
        board: buildBoard(database, now),
        progress: buildProgress(database),
      };
    }
  }
}

/**
 * 005 投影快照（US3；T026；FR-014～FR-018、FR-022）。
 *
 * 只包含階段、倒數、各組是否在線、是否啟用公平順位與**已揭曉**的結果。
 * 搶答中不包含任何答案、送出狀態或送出數量（FR-015、SC-004）；這是
 * 伺服器端過濾後才送出的內容，不是前端隱藏（原則 VI、research R6）。
 */
export function createProjectorSnapshot(
  database: DatabaseSync,
  presence: Readonly<Record<string, number>> = {},
  now = new Date(),
): ProjectorSnapshot {
  const activity = getActivity(database);
  if (!activity) {
    throw new Error('Activity state is not initialized');
  }
  const groups = listGroups(database);
  // 逐題揭曉依題號順序（2026-11-17 兩組同意）。
  const questions = [...listQuestions(database)].sort(
    (a, b) => a.number - b.number,
  );
  const revealedCount = Math.min(
    activity.revealedQuestionCount,
    questions.length,
  );
  // 揭曉 0 題時投影不含任何作答資料，連結算與答案批讀都不進行；
  // 部分揭曉仍保留公平順位必要的跨題依賴，由 buildResults 判定。
  const allResults = revealedCount === 0 ? [] : buildResults(database, now);
  const results = new Map(
    allResults.map((result) => [result.questionNumber, result]),
  );
  const revealed = questions.slice(0, revealedCount).map((question) => {
    const result = results.get(question.number);
    return {
      questionNumber: question.number,
      winnerGroupName: result?.winner?.groupName ?? null,
      winnerAnswers: result?.winner?.answers ?? [],
    };
  });

  const winCounts = new Map<
    string,
    { groupId: string; groupName: string; count: number }
  >();
  for (const result of results.values()) {
    if (result.winner === null) {
      continue;
    }
    const entry = winCounts.get(result.winner.groupId) ?? {
      groupId: result.winner.groupId,
      groupName: result.winner.groupName,
      count: 0,
    };
    entry.count += 1;
    winCounts.set(result.winner.groupId, entry);
  }

  return {
    role: 'projector',
    // 投影的 revision **不含作答次數**：若含，觀察者即使看不到答案，也能從
    // revision 的跳動數出全場作答了幾次、何時作答（2026-11-21 資安審計實測：
    // 三題連續作答時投影收到 revision 7→8→9→10）。作答事件本來也不推給投影
    // （見 broadcaster.broadcastSubmissionChanged），這裡讓 revision 與作答脫鉤。
    revision: activity.revision,
    serverNow: now.toISOString(),
    phase: activity.phase,
    countdownEndsAt: activity.countdownEndsAt,
    groups: groups.map((group) => ({ id: group.id, name: group.name })),
    fairRankingEnabled: activity.fairRankingEnabled,
    groupStatus: groups.map((group) => ({
      id: group.id,
      name: group.name,
      online: (presence[group.id] ?? 0) > 0,
    })),
    reveal: {
      revealedQuestionCount: revealedCount,
      questions: revealed,
      // 全部揭曉後才顯示各組成功題數（FR-018）。
      groupWinCounts:
        revealedCount >= questions.length ? [...winCounts.values()] : null,
    },
  };
}
