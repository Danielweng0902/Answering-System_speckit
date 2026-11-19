import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { writeBackGuidedNotes } from '../../src/app/guidedNotesWriteBack.js';
import { resolveGuidedNotesTargets } from '../../src/app/guidedNotesTargets.js';
import { openDatabase } from '../../src/infra/db/database.js';
import { insertSubmission } from '../../src/infra/db/answerRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { replaceAll } from '../../src/infra/db/questionRepo.js';
import { updateActivity, getActivity } from '../../src/infra/db/activityRepo.js';
import {
  SheetWriteError,
  type SheetWriter,
  type SheetWriteRequest,
} from '../../src/infra/sheets/sheetWriter.js';
import type { DatabaseSync } from 'node:sqlite';

const FIXTURES = fileURLToPath(
  new URL('../../../fixtures/guided-notes/', import.meta.url),
);

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

async function seedGuidedNotes(
  target: DatabaseSync,
  options: {
    sourceKind: 'link' | 'file';
    fileName: string;
    questions?: {
      id: string;
      number: number;
      blanks: { position: number; prefix: string; cell: string }[];
    }[];
  },
): Promise<void> {
  insertGroup(target, { id: 'group-1', name: '第一組', position: 1 });
  insertGroup(target, { id: 'group-2', name: '第二組', position: 2 });
  const file = new Uint8Array(
    await readFile(`${FIXTURES}${options.fileName}`),
  );
  replaceAll(
    target,
    {
      sourceKind: options.sourceKind,
      sourceUrl:
        options.sourceKind === 'link'
          ? 'https://docs.google.com/spreadsheets/d/sheet-id-123'
          : null,
      fileName: options.fileName,
      file,
      sheetName: '學習單',
      importedAt: '2026-11-17T09:00:00.000Z',
    },
    (
      options.questions ?? [
        {
          id: 'q-1',
          number: 1,
          kind: 'group',
          prompt: '第一題',
          position: 1,
          blanks: [
            { position: 1, prefix: '（1）', cell: 'G5' },
            { position: 2, prefix: '（2）', cell: 'G6' },
          ],
        },
      ]
    ).map((question) => ({
      id: question.id,
      number: question.number,
      kind: 'group' as const,
      prompt: '題目',
      position: 1,
      blanks: question.blanks,
    })),
  );
}

function submit(
  target: DatabaseSync,
  options: {
    id: string;
    questionId?: string;
    groupId: string;
    rank: number;
    answers: string[];
  },
): void {
  insertSubmission(target, {
    id: options.id,
    questionId: options.questionId ?? 'q-1',
    groupId: options.groupId,
    rank: options.rank,
    receivedAt: `2026-11-17T09:00:0${options.rank}.000Z`,
    answers: options.answers,
  });
}

function recordingWriter(): {
  writer: SheetWriter;
  requests: SheetWriteRequest[];
} {
  const requests: SheetWriteRequest[] = [];
  return {
    requests,
    writer: {
      async writeCells(request: SheetWriteRequest): Promise<void> {
        requests.push(request);
      },
    },
  };
}

describe('006 寫回線上 Google 試算表（US1）', () => {
  it('題組前綴格保持原樣，答案寫進右側的獨立答案格', async () => {
    database = openDatabase(':memory:');
    await seedGuidedNotes(database, {
      sourceKind: 'link',
      fileName: '02-official-group.xlsx',
    });
    submit(database, {
      id: 's1',
      groupId: 'group-1',
      rank: 1,
      answers: ['CPU', '作業系統'],
    });

    const targets = await resolveGuidedNotesTargets(database);

    expect(targets?.sheetName).toBe('學習單');
    expect(targets?.writes).toEqual([
      { cell: 'H5', content: 'CPU' },
      { cell: 'H6', content: '作業系統' },
    ]);
  });

  it('前綴在合併填答區時，寫回該合併格並保留前綴文字', async () => {
    database = openDatabase(':memory:');
    // 04 的第 2 題是 G7（合併填答區 G7:I7，內含前綴「（1）」）。
    await seedGuidedNotes(database, {
      sourceKind: 'link',
      fileName: '04-mixed-groups.xlsx',
      questions: [
        {
          id: 'q-2',
          number: 2,
          blanks: [
            { position: 1, prefix: '（1）', cell: 'G7' },
            { position: 2, prefix: '（2）', cell: 'G8' },
          ],
        },
      ],
    });
    submit(database, {
      id: 's2',
      questionId: 'q-2',
      groupId: 'group-1',
      rank: 1,
      answers: ['甲', '乙'],
    });

    const targets = await resolveGuidedNotesTargets(database);

    expect(targets?.writes).toEqual([
      { cell: 'G7', content: '（1）甲' },
      { cell: 'G8', content: '（2）乙' },
    ]);
  });

  it('連結來源會呼叫寫入器，帶上試算表 ID、工作表與要寫的儲存格', async () => {
    database = openDatabase(':memory:');
    await seedGuidedNotes(database, {
      sourceKind: 'link',
      fileName: '02-official-group.xlsx',
    });
    submit(database, {
      id: 's3',
      groupId: 'group-1',
      rank: 1,
      answers: ['CPU', '作業系統'],
    });
    const { writer, requests } = recordingWriter();

    // 版面比對另有 writeBackSheetCheck.test.ts 專測；這裡略過比對，測試不連網路。
    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      force: true,
    });

    expect(result).toEqual({ ok: true, writtenCells: 2 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.spreadsheetId).toBe('sheet-id-123');
    expect(requests[0]?.sheetName).toBe('學習單');
    expect(requests[0]?.updates).toEqual([
      { cell: 'H5', value: 'CPU' },
      { cell: 'H6', value: '作業系統' },
    ]);
  });

  it('上傳的 xlsx 沒有雲端目標，不呼叫寫入器', async () => {
    database = openDatabase(':memory:');
    await seedGuidedNotes(database, {
      sourceKind: 'file',
      fileName: '02-official-group.xlsx',
    });
    submit(database, {
      id: 's4',
      groupId: 'group-1',
      rank: 1,
      answers: ['CPU', '作業系統'],
    });
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      force: true,
    });

    expect(result).toMatchObject({ ok: false, code: 'GUIDED_NOTES_NOT_LINK' });
    expect(requests).toHaveLength(0);
  });

  it('伺服器沒有設定服務帳號時回 SHEET_NOT_CONFIGURED', async () => {
    database = openDatabase(':memory:');
    await seedGuidedNotes(database, {
      sourceKind: 'link',
      fileName: '02-official-group.xlsx',
    });

    const result = await writeBackGuidedNotes(database, null);

    expect(result).toMatchObject({ ok: false, code: 'SHEET_NOT_CONFIGURED' });
  });

  it('沒有搶答成功的答案時不寫任何儲存格', async () => {
    database = openDatabase(':memory:');
    await seedGuidedNotes(database, {
      sourceKind: 'link',
      fileName: '02-official-group.xlsx',
    });
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      force: true,
    });

    expect(result).toEqual({ ok: true, writtenCells: 0 });
    expect(requests).toHaveLength(0);
  });

  it('寫入失敗時把錯誤代碼回給上層，不洩漏 API 回應內容', async () => {
    database = openDatabase(':memory:');
    await seedGuidedNotes(database, {
      sourceKind: 'link',
      fileName: '02-official-group.xlsx',
    });
    submit(database, {
      id: 's5',
      groupId: 'group-1',
      rank: 1,
      answers: ['CPU', '作業系統'],
    });
    const writer: SheetWriter = {
      async writeCells(): Promise<void> {
        throw new SheetWriteError('SHEET_NOT_EDITABLE');
      },
    };

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      force: true,
    });

    expect(result).toMatchObject({ ok: false, code: 'SHEET_NOT_EDITABLE' });
    expect(JSON.stringify(result)).not.toContain('spreadsheetId');
  });

  it('本地資料不被寫回動作改變（唯讀）', async () => {
    database = openDatabase(':memory:');
    await seedGuidedNotes(database, {
      sourceKind: 'link',
      fileName: '02-official-group.xlsx',
    });
    submit(database, {
      id: 's6',
      groupId: 'group-1',
      rank: 1,
      answers: ['CPU', '作業系統'],
    });
    const before = JSON.stringify(
      database
        .prepare(
          `SELECT s.id, s.rank, s.received_at AS receivedAt, s.voided_at AS voidedAt
           FROM submissions s ORDER BY s.rank`,
        )
        .all(),
    );
    const { writer } = recordingWriter();

    await writeBackGuidedNotes(database, writer, new Date(), { force: true });

    const after = JSON.stringify(
      database
        .prepare(
          `SELECT s.id, s.rank, s.received_at AS receivedAt, s.voided_at AS voidedAt
           FROM submissions s ORDER BY s.rank`,
        )
        .all(),
    );
    expect(after).toBe(before);
    expect(getActivity(database)?.revision).toBe(0);
    expect(
      updateActivity === undefined ? undefined : getActivity(database)?.phase,
    ).toBe('preparing');
  });
});
