import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSnapshot } from '../../src/app/snapshot.js';
import { openDatabase } from '../../src/infra/db/database.js';
import {
  getActivity,
  updateActivity,
} from '../../src/infra/db/activityRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { replaceAll as replaceQuestions } from '../../src/infra/db/questionRepo.js';

const databases: ReturnType<typeof openDatabase>[] = [];
let db: ReturnType<typeof openDatabase>;

const fixedNow = new Date('2026-11-12T10:00:00.000Z');
const countdownEndsAt = '2026-11-12T10:01:00.000Z';

beforeEach(() => {
  db = database();
  insertGroup(db, { id: 'group-2', name: '第二組', position: 2 });
  insertGroup(db, { id: 'group-1', name: '第一組', position: 1 });

  const activity = getActivity(db);
  if (!activity) {
    throw new Error('activity was not initialized');
  }
  updateActivity(db, {
    ...activity,
    phase: 'open',
    countdownEndsAt,
    revision: 7,
  });
});

afterEach(() => {
  for (const open of databases.splice(0)) {
    open.close();
  }
});

function database(): ReturnType<typeof openDatabase> {
  const created = openDatabase(':memory:');
  databases.push(created);
  return created;
}

function readSessionId(): string {
  const row = db
    .prepare('SELECT session_id AS sessionId FROM activity WHERE id = 1')
    .get() as { sessionId: string | null };
  if (row.sessionId === null) {
    throw new Error('activity session_id was not initialized');
  }
  return row.sessionId;
}

describe('createSnapshot', () => {
  it('guest 快照欄位符合 contract 且沒有 presence', () => {
    const snapshot = createSnapshot(db, { role: 'guest' }, undefined, fixedNow);

    expect(snapshot).toEqual({
      role: 'guest',
      revision: 7,
      serverNow: fixedNow.toISOString(),
      phase: 'open',
      countdownEndsAt,
      groups: [
        { id: 'group-1', name: '第一組' },
        { id: 'group-2', name: '第二組' },
      ],
    });
    expect(snapshot).not.toHaveProperty('presence');
    // 002（FR-016）：questions、guidedNotes 只有老師快照有。
    expect(snapshot).not.toHaveProperty('questions');
    expect(snapshot).not.toHaveProperty('guidedNotes');
  });

  it('student 快照欄位符合 contract 且沒有 presence', () => {
    const snapshot = createSnapshot(
      db,
      { role: 'student', groupId: 'group-1' },
      { 'group-1': 2 },
      fixedNow,
    );

    expect(snapshot).toEqual({
      role: 'student',
      myGroupId: 'group-1',
      revision: 7,
      serverNow: fixedNow.toISOString(),
      phase: 'open',
      countdownEndsAt,
      groups: [
        { id: 'group-1', name: '第一組' },
        { id: 'group-2', name: '第二組' },
      ],
      sessionId: readSessionId(),
      questions: [],
      myAnswers: [],
    });
    expect(snapshot).not.toHaveProperty('presence');
    expect(snapshot).not.toHaveProperty('guidedNotes');
    // 003（FR-017）：open 的學生快照一律沒有 rank。
    expect(JSON.stringify(snapshot)).not.toContain('"rank"');
  });

  it('學生 preparing 快照只有新增的 sessionId，沒有 questions、myAnswers 或 results（003 T011）', () => {
    const activity = getActivity(db);
    if (!activity) throw new Error('activity was not initialized');
    updateActivity(db, {
      ...activity,
      phase: 'preparing',
      countdownEndsAt: null,
      revision: 3,
    });

    const snapshot = createSnapshot(
      db,
      { role: 'student', groupId: 'group-1' },
      { 'group-1': 1 },
      fixedNow,
    );

    expect(snapshot).toEqual({
      role: 'student',
      myGroupId: 'group-1',
      revision: 3,
      serverNow: fixedNow.toISOString(),
      phase: 'preparing',
      countdownEndsAt: null,
      groups: [
        { id: 'group-1', name: '第一組' },
        { id: 'group-2', name: '第二組' },
      ],
      sessionId: readSessionId(),
    });
    for (const field of [
      'questions',
      'myAnswers',
      'results',
      'presence',
      'guidedNotes',
    ]) {
      expect(snapshot).not.toHaveProperty(field);
    }
  });

  it('學生 open 快照含依 position 排列的 questions 與每題 myAnswers，只含本組最新答案且絕不含 rank（003 T011）', () => {
    replaceQuestions(
      db,
      {
        sourceKind: 'file',
        sourceUrl: null,
        fileName: '學習單.xlsx',
        file: new Uint8Array(),
        sheetName: '學習單',
        importedAt: '2026-11-12T09:00:00.000Z',
      },
      [
        {
          id: 'question-1',
          number: 1,
          kind: 'single',
          prompt: '第一題題目',
          position: 1,
          blanks: [{ position: 1, prefix: '', cell: 'G5' }],
        },
        {
          id: 'question-2',
          number: 2,
          kind: 'group',
          prompt: '第二題題目',
          position: 2,
          blanks: [
            { position: 1, prefix: '（1）', cell: 'G7' },
            { position: 2, prefix: '（2）', cell: 'G8' },
          ],
        },
      ],
    );
    for (const submission of [
      {
        id: 'submission-group-1',
        groupId: 'group-1',
        rank: 1,
        answer: '本組已送答案',
      },
      {
        id: 'submission-group-2',
        groupId: 'group-2',
        rank: 2,
        answer: '其他組答案不可見',
      },
    ]) {
      db.prepare(
        `INSERT INTO submissions
           (id, question_id, group_id, rank, received_at, voided_at)
         VALUES (?, 'question-1', ?, ?, '2026-11-12T09:59:00.000Z', NULL)`,
      ).run(submission.id, submission.groupId, submission.rank);
      db.prepare(
        `INSERT INTO submission_answers
           (submission_id, blank_position, answer_text)
         VALUES (?, 1, ?)`,
      ).run(submission.id, submission.answer);
    }

    const snapshot = createSnapshot(
      db,
      { role: 'student', groupId: 'group-1' },
      { 'group-1': 2 },
      fixedNow,
    );

    expect(snapshot).toMatchObject({
      role: 'student',
      phase: 'open',
      myGroupId: 'group-1',
      sessionId: readSessionId(),
      questions: [
        {
          number: 1,
          kind: 'single',
          prompt: '第一題題目',
          blanks: [{ position: 1, prefix: '' }],
        },
        {
          number: 2,
          kind: 'group',
          prompt: '第二題題目',
          blanks: [
            { position: 1, prefix: '（1）' },
            { position: 2, prefix: '（2）' },
          ],
        },
      ],
      myAnswers: [
        { questionNumber: 1, state: 'submitted', answers: ['本組已送答案'] },
        { questionNumber: 2, state: 'not_submitted', answers: [] },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain('其他組答案不可見');
    expect(JSON.stringify(snapshot)).not.toContain('"rank"');
    for (const field of ['presence', 'guidedNotes', 'results', 'board', 'progress']) {
      expect(snapshot).not.toHaveProperty(field);
    }
  });

  it('學生 closed 快照含 questions、每題 results（decideWinner）與含 rank 的 myAnswers（003 T034、T035）', () => {
    replaceQuestions(
      db,
      {
        sourceKind: 'file',
        sourceUrl: null,
        fileName: '學習單.xlsx',
        file: new Uint8Array(),
        sheetName: '學習單',
        importedAt: '2026-11-12T09:00:00.000Z',
      },
      [
        {
          id: 'question-1',
          number: 1,
          kind: 'single',
          prompt: '第一題題目',
          position: 1,
          blanks: [{ position: 1, prefix: '', cell: 'G5' }],
        },
        {
          id: 'question-2',
          number: 2,
          kind: 'group',
          prompt: '第二題題目',
          position: 2,
          blanks: [
            { position: 1, prefix: '（1）', cell: 'G7' },
            { position: 2, prefix: '（2）', cell: 'G8' },
          ],
        },
      ],
    );
    // 第 1 題：group-1 rank 1、group-2 rank 2；第 2 題：group-2 rank 1。
    db.prepare(
      `INSERT INTO submissions
         (id, question_id, group_id, rank, received_at, voided_at)
       VALUES
         ('sub-1-a', 'question-1', 'group-1', 1, '2026-11-12T09:59:00.000Z', NULL),
         ('sub-1-b', 'question-1', 'group-2', 2, '2026-11-12T09:59:01.000Z', NULL),
         ('sub-2-b', 'question-2', 'group-2', 1, '2026-11-12T09:59:02.000Z', NULL)`,
    ).run();
    const insertAnswer = db.prepare(
      `INSERT INTO submission_answers
         (submission_id, blank_position, answer_text)
       VALUES (?, ?, ?)`,
    );
    insertAnswer.run('sub-1-a', 1, '第一組第一題');
    insertAnswer.run('sub-1-b', 1, '第二組第一題');
    insertAnswer.run('sub-2-b', 1, '第二組第二題（1）');
    insertAnswer.run('sub-2-b', 2, '第二組第二題（2）');

    const activity = getActivity(db);
    if (!activity) throw new Error('activity was not initialized');
    updateActivity(db, { ...activity, phase: 'closed', revision: 9 });

    const expectedResults = [
      {
        questionNumber: 1,
        winner: {
          groupId: 'group-1',
          groupName: '第一組',
          answers: ['第一組第一題'],
        },
      },
      {
        questionNumber: 2,
        winner: {
          groupId: 'group-2',
          groupName: '第二組',
          answers: ['第二組第二題（1）', '第二組第二題（2）'],
        },
      },
    ];
    const groupOne = createSnapshot(
      db,
      { role: 'student', groupId: 'group-1' },
      {},
      fixedNow,
    );

    expect(groupOne).toEqual({
      role: 'student',
      myGroupId: 'group-1',
      revision: 9,
      serverNow: fixedNow.toISOString(),
      phase: 'closed',
      countdownEndsAt,
      groups: [
        { id: 'group-1', name: '第一組' },
        { id: 'group-2', name: '第二組' },
      ],
      sessionId: readSessionId(),
      questions: [
        {
          number: 1,
          kind: 'single',
          prompt: '第一題題目',
          blanks: [{ position: 1, prefix: '' }],
        },
        {
          number: 2,
          kind: 'group',
          prompt: '第二題題目',
          blanks: [
            { position: 1, prefix: '（1）' },
            { position: 2, prefix: '（2）' },
          ],
        },
      ],
      results: expectedResults,
      myAnswers: [
        {
          questionNumber: 1,
          state: 'submitted',
          answers: ['第一組第一題'],
          rank: 1,
        },
        { questionNumber: 2, state: 'not_submitted', answers: [], rank: null },
      ],
    });
    for (const field of ['presence', 'guidedNotes', 'board', 'progress']) {
      expect(groupOne).not.toHaveProperty(field);
    }

    // 另一組：myAnswers 依各自順位計算，results 相同。
    const groupTwo = createSnapshot(
      db,
      { role: 'student', groupId: 'group-2' },
      {},
      fixedNow,
    );
    expect(groupTwo).toMatchObject({
      phase: 'closed',
      myAnswers: [
        { questionNumber: 1, state: 'submitted', rank: 2 },
        { questionNumber: 2, state: 'submitted', rank: 1 },
      ],
    });
    expect(groupTwo).toMatchObject({ results: expectedResults });
  });

  it('無人作答題目的 closed 快照：winner 為 null（003 T034；FR-025）', () => {
    replaceQuestions(
      db,
      {
        sourceKind: 'file',
        sourceUrl: null,
        fileName: '學習單.xlsx',
        file: new Uint8Array(),
        sheetName: '學習單',
        importedAt: '2026-11-12T09:00:00.000Z',
      },
      [
        {
          id: 'question-1',
          number: 1,
          kind: 'single',
          prompt: '第一題題目',
          position: 1,
          blanks: [{ position: 1, prefix: '', cell: 'G5' }],
        },
      ],
    );
    const activity = getActivity(db);
    if (!activity) throw new Error('activity was not initialized');
    updateActivity(db, { ...activity, phase: 'closed' });

    const snapshot = createSnapshot(
      db,
      { role: 'student', groupId: 'group-1' },
      {},
      fixedNow,
    );

    expect(snapshot).toMatchObject({
      phase: 'closed',
      results: [{ questionNumber: 1, winner: null }],
      myAnswers: [
        { questionNumber: 1, state: 'not_submitted', answers: [], rank: null },
      ],
    });
  });

  it('guest 快照沒有 sessionId、questions、myAnswers、results 或作答看板（003 T011）', () => {
    const snapshot = createSnapshot(db, { role: 'guest' }, {}, fixedNow);

    for (const field of [
      'sessionId',
      'questions',
      'myAnswers',
      'results',
      'board',
      'progress',
      'presence',
      'guidedNotes',
    ]) {
      expect(snapshot).not.toHaveProperty(field);
    }
  });

  it('teacher 快照欄位符合 contract 且只有 teacher 有 presence', () => {
    const presence = { 'group-1': 2, 'group-2': 0 };
    const snapshot = createSnapshot(db, { role: 'teacher' }, presence, fixedNow);

    expect(snapshot).toEqual({
      role: 'teacher',
      presence,
      revision: 7,
      serverNow: fixedNow.toISOString(),
      phase: 'open',
      countdownEndsAt,
      groups: [
        { id: 'group-1', name: '第一組' },
        { id: 'group-2', name: '第二組' },
      ],
      // 尚未匯入：空清單與 null。
      questions: [],
      guidedNotes: null,
      // 003（T027、T030；FR-019–FR-022）：老師快照任何階段都有看板與進度。
      board: [],
      progress: {
        perQuestion: [],
        perGroup: [
          { groupId: 'group-1', submittedQuestionCount: 0 },
          { groupId: 'group-2', submittedQuestionCount: 0 },
        ],
      },
    });
    expect(snapshot).toHaveProperty('presence');
  });

  it('teacher、各組 student 與 guest 依各自作答 counter 計算 revision（003 T023；research R4）', () => {
    db.prepare(
      'UPDATE activity SET answer_event_count = 5 WHERE id = 1',
    ).run();
    db.prepare(
      `INSERT INTO group_answer_revisions (group_id, answer_revision)
       VALUES ('group-1', 2), ('group-2', 4)`,
    ).run();

    expect(createSnapshot(db, { role: 'teacher' }, {}, fixedNow).revision).toBe(
      12,
    );
    expect(
      createSnapshot(
        db,
        { role: 'student', groupId: 'group-1' },
        {},
        fixedNow,
      ).revision,
    ).toBe(9);
    expect(
      createSnapshot(
        db,
        { role: 'student', groupId: 'group-2' },
        {},
        fixedNow,
      ).revision,
    ).toBe(11);
    expect(createSnapshot(db, { role: 'guest' }, {}, fixedNow).revision).toBe(7);
  });

  it('teacher 快照含 002 題目摘要（依 position）與學習單資訊（不含原檔）', () => {
    replaceQuestions(
      db,
      {
        sourceKind: 'link',
        sourceUrl: 'https://docs.google.com/spreadsheets/d/abc123',
        fileName: null,
        file: new Uint8Array([1, 2, 3]),
        sheetName: '學習單',
        importedAt: '2026-11-12T09:00:00.000Z',
      },
      [
        {
          id: randomUUID(),
          number: 2,
          kind: 'group',
          prompt: '第二題',
          position: 2,
          blanks: [
            { position: 1, prefix: '（1）', cell: 'G9' },
            { position: 2, prefix: '（2）', cell: 'G10' },
          ],
        },
        {
          id: randomUUID(),
          number: 1,
          kind: 'single',
          prompt: '第一題',
          position: 1,
          blanks: [{ position: 1, prefix: '', cell: 'G5' }],
        },
      ],
    );

    const snapshot = createSnapshot(db, { role: 'teacher' }, {}, fixedNow);

    expect(snapshot).toMatchObject({
      role: 'teacher',
      questions: [
        { number: 1, kind: 'single', prompt: '第一題', blankCount: 1 },
        { number: 2, kind: 'group', prompt: '第二題', blankCount: 2 },
      ],
      guidedNotes: {
        sheetName: '學習單',
        sourceKind: 'link',
        fileName: null,
        importedAt: '2026-11-12T09:00:00.000Z',
      },
    });
    // 快照不含原檔位元組。
    expect(JSON.stringify(snapshot)).not.toContain('sourceUrl');
  });
});

describe('老師作答看板與進度（003 US3；T027；AC-003-13–16、FR-019–FR-022）', () => {
  function seedBoardQuestions(): void {
    replaceQuestions(
      db,
      {
        sourceKind: 'file',
        sourceUrl: null,
        fileName: '學習單.xlsx',
        file: new Uint8Array(),
        sheetName: '學習單',
        importedAt: '2026-11-12T09:00:00.000Z',
      },
      [
        {
          id: 'question-1',
          number: 1,
          kind: 'single',
          prompt: '第一題題目',
          position: 1,
          blanks: [{ position: 1, prefix: '', cell: 'G5' }],
        },
        {
          id: 'question-2',
          number: 2,
          kind: 'group',
          prompt: '第二題題目',
          position: 2,
          blanks: [
            { position: 1, prefix: '（1）', cell: 'G7' },
            { position: 2, prefix: '（2）', cell: 'G8' },
          ],
        },
      ],
    );
  }

  function seedBoardSubmissions(): void {
    db.prepare(
      `INSERT INTO submissions
         (id, question_id, group_id, rank, received_at, voided_at)
       VALUES
         ('board-1-a', 'question-1', 'group-1', 1, '2026-11-12T09:59:00.000Z', NULL),
         ('board-1-b', 'question-1', 'group-2', 2, '2026-11-12T09:59:01.000Z', NULL),
         ('board-2-b', 'question-2', 'group-2', 1, '2026-11-12T09:59:02.000Z', NULL)`,
    ).run();
    const insertAnswer = db.prepare(
      `INSERT INTO submission_answers
         (submission_id, blank_position, answer_text)
       VALUES (?, ?, ?)`,
    );
    insertAnswer.run('board-1-a', 1, '第一組第一題答案');
    insertAnswer.run('board-1-b', 1, '第二組第一題答案');
    // 刻意以相反順序寫入空格：看板 answers 必須依 blank position 排列
    // （AC-003-25 老師側；T027）。
    insertAnswer.run('board-2-b', 2, '第二組第二題（2）');
    insertAnswer.run('board-2-b', 1, '第二組第二題（1）');
  }

  const expectedBoard = [
    {
      questionNumber: 1,
      winnerGroupId: 'group-1',
      cells: [
        {
          questionNumber: 1,
          groupId: 'group-1',
          groupName: '第一組',
          state: 'submitted',
          answers: ['第一組第一題答案'],
          rank: 1,
        },
        {
          questionNumber: 1,
          groupId: 'group-2',
          groupName: '第二組',
          state: 'submitted',
          answers: ['第二組第一題答案'],
          rank: 2,
        },
      ],
    },
    {
      questionNumber: 2,
      winnerGroupId: 'group-2',
      cells: [
        {
          questionNumber: 2,
          groupId: 'group-1',
          groupName: '第一組',
          state: 'not_submitted',
          answers: [],
          rank: null,
        },
        {
          questionNumber: 2,
          groupId: 'group-2',
          groupName: '第二組',
          state: 'submitted',
          answers: ['第二組第二題（1）', '第二組第二題（2）'],
          rank: 1,
        },
      ],
    },
  ];
  const expectedProgress = {
    perQuestion: [
      { questionNumber: 1, submittedGroupCount: 2 },
      { questionNumber: 2, submittedGroupCount: 1 },
    ],
    perGroup: [
      { groupId: 'group-1', submittedQuestionCount: 1 },
      { groupId: 'group-2', submittedQuestionCount: 2 },
    ],
  };

  it('老師 open 快照：board 每題每組固定一筆 cell、winnerGroupId 由 decideWinner 判定，progress 計每題組數與每組題數（AC-003-13、15）', () => {
    seedBoardQuestions();
    seedBoardSubmissions();

    const snapshot = createSnapshot(db, { role: 'teacher' }, {}, fixedNow);
    if (snapshot.role !== 'teacher') {
      throw new Error('預期為老師快照');
    }

    expect(snapshot.board).toEqual(expectedBoard);
    expect(snapshot.progress).toEqual(expectedProgress);
  });

  it('老師 preparing 快照：board 每格 not_submitted、progress 全為 0，任何階段都輸出（FR-019–FR-022）', () => {
    seedBoardQuestions();
    const activity = getActivity(db);
    if (!activity) throw new Error('activity was not initialized');
    updateActivity(db, {
      ...activity,
      phase: 'preparing',
      countdownEndsAt: null,
    });

    const snapshot = createSnapshot(db, { role: 'teacher' }, {}, fixedNow);
    if (snapshot.role !== 'teacher') {
      throw new Error('預期為老師快照');
    }

    expect(snapshot.board).toEqual([
      {
        questionNumber: 1,
        winnerGroupId: null,
        cells: [
          {
            questionNumber: 1,
            groupId: 'group-1',
            groupName: '第一組',
            state: 'not_submitted',
            answers: [],
            rank: null,
          },
          {
            questionNumber: 1,
            groupId: 'group-2',
            groupName: '第二組',
            state: 'not_submitted',
            answers: [],
            rank: null,
          },
        ],
      },
      {
        questionNumber: 2,
        winnerGroupId: null,
        cells: [
          {
            questionNumber: 2,
            groupId: 'group-1',
            groupName: '第一組',
            state: 'not_submitted',
            answers: [],
            rank: null,
          },
          {
            questionNumber: 2,
            groupId: 'group-2',
            groupName: '第二組',
            state: 'not_submitted',
            answers: [],
            rank: null,
          },
        ],
      },
    ]);
    expect(snapshot.progress).toEqual({
      perQuestion: [
        { questionNumber: 1, submittedGroupCount: 0 },
        { questionNumber: 2, submittedGroupCount: 0 },
      ],
      perGroup: [
        { groupId: 'group-1', submittedQuestionCount: 0 },
        { groupId: 'group-2', submittedQuestionCount: 0 },
      ],
    });
  });

  it('老師 closed 快照：board 維持結束當下內容，每題以 winnerGroupId 標示搶答成功（AC-003-16）', () => {
    seedBoardQuestions();
    seedBoardSubmissions();
    const activity = getActivity(db);
    if (!activity) throw new Error('activity was not initialized');
    updateActivity(db, { ...activity, phase: 'closed', revision: 9 });

    const snapshot = createSnapshot(db, { role: 'teacher' }, {}, fixedNow);
    if (snapshot.role !== 'teacher') {
      throw new Error('預期為老師快照');
    }

    expect(snapshot.board).toEqual(expectedBoard);
    expect(snapshot.progress).toEqual(expectedProgress);
  });
});
