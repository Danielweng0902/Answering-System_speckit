import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { writeBackGuidedNotes } from '../../src/app/guidedNotesWriteBack.js';
import { openDatabase } from '../../src/infra/db/database.js';
import { insertSubmission } from '../../src/infra/db/answerRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { replaceAll } from '../../src/infra/db/questionRepo.js';
import type {
  SheetWriter,
  SheetWriteRequest,
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

/** 依 02 fixture 的四題結構存檔（版面比對要比完整結構）。 */
async function seedFullStructure(target: DatabaseSync): Promise<void> {
  insertGroup(target, { id: 'group-1', name: '第一組', position: 1 });
  insertGroup(target, { id: 'group-2', name: '第二組', position: 2 });
  replaceAll(
    target,
    {
      sourceKind: 'link',
      sourceUrl: 'https://docs.google.com/spreadsheets/d/sheet-id-123',
      fileName: '02-official-group.xlsx',
      file: new Uint8Array(
        await readFile(`${FIXTURES}02-official-group.xlsx`),
      ),
      sheetName: '學習單',
      importedAt: '2026-11-17T09:00:00.000Z',
    },
    [
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
      {
        id: 'q-2',
        number: 2,
        kind: 'group',
        prompt: '第二題',
        position: 2,
        blanks: [
          { position: 1, prefix: '（1）', cell: 'G8' },
          { position: 2, prefix: '（2）', cell: 'G9' },
        ],
      },
      {
        id: 'q-3',
        number: 3,
        kind: 'single',
        prompt: '第三題',
        position: 3,
        blanks: [{ position: 1, prefix: '', cell: 'G11' }],
      },
      {
        id: 'q-4',
        number: 4,
        kind: 'single',
        prompt: '第四題',
        position: 4,
        blanks: [{ position: 1, prefix: '', cell: 'G13' }],
      },
    ],
  );
  // 有一筆搶答成功的作答，才有東西要寫回。
  insertSubmission(target, {
    id: 's1',
    questionId: 'q-1',
    groupId: 'group-1',
    rank: 1,
    receivedAt: '2026-11-17T09:30:00.000Z',
    answers: ['甲答案', '乙答案'],
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

/** 假的線上試算表回應：回傳指定 fixture 的位元組。 */
function fakeSheetFetch(fileName: string): typeof fetch {
  return (async () => {
    const bytes = await readFile(`${FIXTURES}${fileName}`);
    return new Response(bytes, { status: 200 });
  }) as unknown as typeof fetch;
}

describe('006 寫回前的版面比對（人工驗證建議 3；T023）', () => {
  it('線上試算表與匯入時相同 → 直接寫回', async () => {
    database = openDatabase(':memory:');
    await seedFullStructure(database);
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      fetchImpl: fakeSheetFetch('02-official-group.xlsx'),
    });

    expect(result).toEqual({ ok: true, writtenCells: 2 });
    expect(requests[0]?.updates).toEqual([
      { cell: 'H5', value: '甲答案' },
      { cell: 'H6', value: '乙答案' },
    ]);
  });

  it('線上試算表在匯入後被改過 → 回 SHEET_MODIFIED 且不寫入', async () => {
    database = openDatabase(':memory:');
    await seedFullStructure(database);
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      fetchImpl: fakeSheetFetch('04-mixed-groups.xlsx'),
    });

    expect(result).toMatchObject({ ok: false, code: 'SHEET_MODIFIED' });
    expect(requests).toHaveLength(0);
  });

  it('老師確認後（force）即使版面不同也寫回', async () => {
    database = openDatabase(':memory:');
    await seedFullStructure(database);
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      force: true,
      fetchImpl: fakeSheetFetch('04-mixed-groups.xlsx'),
    });

    expect(result).toEqual({ ok: true, writtenCells: 2 });
    expect(requests).toHaveLength(1);
  });

  it('讀不到線上試算表時不比對、不阻擋寫回', async () => {
    database = openDatabase(':memory:');
    await seedFullStructure(database);
    const { writer } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      fetchImpl: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
  });
});
