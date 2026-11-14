import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  exportGuidedNotes,
  exportResultCsv,
} from '../../src/app/exportCommands.js';
import { getActivity, updateActivity } from '../../src/infra/db/activityRepo.js';
import {
  insertSubmission,
  voidSubmission,
} from '../../src/infra/db/answerRepo.js';
import { openDatabase } from '../../src/infra/db/database.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import {
  list as listQuestions,
  replaceAll,
} from '../../src/infra/db/questionRepo.js';

const FIXTURES = new URL('../../../fixtures/guided-notes/', import.meta.url);
const NOW = new Date('2026-11-14T09:08:07.123Z');
const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type ExpectedBlank = { cell: string; prefix: string };
type ExpectedQuestion = { number: number; blanks: ExpectedBlank[] };
type ExpectedFile = {
  file: string;
  valid: boolean;
  sheet: string;
  questions: ExpectedQuestion[];
};

function fixturePath(fileName: string): string {
  return fileURLToPath(new URL(fileName, FIXTURES));
}

async function fixtureBytes(fileName: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixturePath(fileName)));
}

async function expectedFiles(): Promise<ExpectedFile[]> {
  return JSON.parse(
    await readFile(fixturePath('expected.json'), 'utf8'),
  ) as ExpectedFile[];
}

async function withDatabase<T>(
  run: (database: DatabaseSync) => Promise<T>,
): Promise<T> {
  const database = openDatabase(':memory:');
  try {
    return await run(database);
  } finally {
    database.close();
  }
}

async function seedFixture(
  database: DatabaseSync,
  entry: ExpectedFile,
): Promise<Uint8Array> {
  const bytes = await fixtureBytes(entry.file);
  replaceAll(
    database,
    {
      sourceKind: 'file',
      sourceUrl: null,
      fileName: entry.file,
      file: bytes,
      sheetName: entry.sheet,
      importedAt: NOW.toISOString(),
    },
    entry.questions.map((question, index) => ({
      id: `q-${question.number}`,
      number: question.number,
      kind: question.blanks.length > 1 ? ('group' as const) : ('single' as const),
      prompt: `題目 ${question.number}`,
      position: index + 1,
      blanks: question.blanks.map((blank, index) => ({
        position: index + 1,
        prefix: blank.prefix,
        cell: blank.cell,
      })),
    })),
  );
  return bytes;
}

function seedGroup(database: DatabaseSync): void {
  insertGroup(database, { id: 'group-1', name: '第一組', position: 1 });
}

function answer(
  database: DatabaseSync,
  questionNumber: number,
  answers: readonly string[],
  groupId = 'group-1',
  rank = 1,
): string {
  insertSubmission(database, {
    id: randomUUID(),
    questionId: `q-${questionNumber}`,
    groupId,
    rank,
    receivedAt: new Date(
      NOW.getTime() + questionNumber * 1_000,
    ).toISOString(),
    answers,
  });
  return `q-${questionNumber}`;
}

function closeActivity(database: DatabaseSync): void {
  const activity = getActivity(database);
  updateActivity(database, {
    ...activity!,
    phase: 'closed',
    closedAt: NOW.toISOString(),
    revision: activity!.revision + 1,
  });
}

async function worksheet(
  bytes: Uint8Array,
  sheetName: string,
): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const result = workbook.getWorksheet(sheetName);
  expect(result).toBeDefined();
  return result!;
}

async function zipEntries(
  bytes: Uint8Array,
): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(bytes);
  return new Map(
    await Promise.all(
      Object.entries(zip.files)
        .filter(([, entry]) => !entry.dir)
        .map(async ([path, entry]) => [
          path,
          await entry.async('uint8array'),
        ] as const),
    ),
  );
}

function csvText(bytes: Uint8Array): string {
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return Buffer.from(bytes.subarray(3)).toString('utf8');
}

function databaseSnapshot(database: DatabaseSync): string {
  const tables = [
    'activity',
    'groups',
    'group_answer_revisions',
    'guided_notes',
    'questions',
    'blanks',
    'submissions',
    'submission_answers',
  ];
  return JSON.stringify(
    tables.map((table) => [
      table,
      database.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}

describe('004 US1 匯出 Guided Notes（T008）', () => {
  it('單題勝出答案寫入結構解析所得的位置，檔名與 MIME 符合契約', async () => {
    await withDatabase(async (database) => {
      const entry = (await expectedFiles())[0]!;
      await seedFixture(database, entry);
      seedGroup(database);
      answer(database, 1, ['直接寫入的答案']);
      closeActivity(database);

      const file = await exportGuidedNotes(database, NOW);
      const output = await worksheet(file.bytes, entry.sheet);

      expect(output.getCell('G5').text).toBe('直接寫入的答案');
      expect(output.getCell('G7').text).toBe('');
      expect(file.fileName).toBe('搶答結果_20261114_0908.xlsx');
      expect(file.contentType).toBe(XLSX_TYPE);
    });
  });

  it('五種版面所有空格都寫在 expected.json 位置，未改動其他 zip entry', async () => {
    const entries = (await expectedFiles()).filter((entry) => entry.valid);
    expect(entries).toHaveLength(5);

    for (const entry of entries) {
      await withDatabase(async (database) => {
        const original = await seedFixture(database, entry);
        seedGroup(database);
        for (const question of entry.questions) {
          answer(
            database,
            question.number,
            question.blanks.map(
              (_, index) => `題${question.number}第${index + 1}格答案`,
            ),
          );
        }
        closeActivity(database);
        const file = await exportGuidedNotes(database, NOW);
        const output = await worksheet(file.bytes, entry.sheet);

        for (const question of entry.questions) {
          for (const [index, blank] of question.blanks.entries()) {
            expect(output.getCell(blank.cell).text).toBe(
              `${blank.prefix}題${question.number}第${index + 1}格答案`,
            );
          }
        }

        if (entry.file === '05-two-sheets.xlsx') {
          const before = await zipEntries(original);
          const after = await zipEntries(file.bytes);
          const changedPaths = [...after.entries()]
            .filter(
              ([path, bytes]) =>
                !before.has(path) ||
                !Buffer.from(before.get(path)!).equals(Buffer.from(bytes)),
            )
            .map(([path]) => path);
          expect(changedPaths).toEqual(['xl/worksheets/sheet2.xml']);
        }
      });
    }
  });

  it('未作答與僅有作廢作答的題目保持原檔；唯讀且重複匯出內容相同', async () => {
    await withDatabase(async (database) => {
      const entry = (await expectedFiles())[0]!;
      const original = await seedFixture(database, entry);
      seedGroup(database);
      answer(database, 1, ['保留這一題']);
      const voidedQuestionId = answer(database, 2, ['不能出現在匯出']);
      voidSubmission(
        database,
        voidedQuestionId,
        'group-1',
        '2026-11-14T09:09:00.000Z',
      );
      closeActivity(database);
      const before = databaseSnapshot(database);
      const revisionBefore = getActivity(database)!.revision;

      const first = await exportGuidedNotes(database, NOW);
      const second = await exportGuidedNotes(
        database,
        new Date('2026-11-14T09:10:00.000Z'),
      );

      const output = await worksheet(first.bytes, entry.sheet);
      expect(output.getCell('G5').text).toBe('保留這一題');
      expect(output.getCell('G7').text).toBe('');
      expect(output.getCell('G9').text).toBe('');
      expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(
        true,
      );
      expect(databaseSnapshot(database)).toBe(before);
      expect(getActivity(database)!.revision).toBe(revisionBefore);

      const originalZips = await zipEntries(original);
      const exportedZips = await zipEntries(first.bytes);
      expect(exportedZips.size).toBe(originalZips.size);
    });
  });

  it('完全沒有有效作答時不回寫任何空格，也不變更原始檔位元組', async () => {
    await withDatabase(async (database) => {
      const entry = (await expectedFiles())[1]!;
      const original = await seedFixture(database, entry);
      seedGroup(database);
      closeActivity(database);

      const file = await exportGuidedNotes(database, NOW);
      const output = await worksheet(file.bytes, entry.sheet);

      expect(output.getCell('G5').text).toBe('（1）');
      expect(output.getCell('G6').text).toBe('（2）');
      expect(Buffer.from(file.bytes).equals(Buffer.from(original))).toBe(true);
    });
  });

  it('題組每格保留原前綴，未作答維持原內容，單題不加額外符號（T014）', async () => {
    await withDatabase(async (database) => {
      const entry = (await expectedFiles())[1]!;
      await seedFixture(database, entry);
      seedGroup(database);
      answer(database, 1, ['CPU', '作業系統']);
      closeActivity(database);

      const file = await exportGuidedNotes(database, NOW);
      const output = await worksheet(file.bytes, entry.sheet);

      expect(output.getCell('G5').text).toBe('（1）CPU');
      expect(output.getCell('G6').text).toBe('（2）作業系統');
      expect(output.getCell('G8').text).toBe('（1）');
      expect(output.getCell('G9').text).toBe('（2）');
      expect(output.getCell('G5').address).toBe('G5');
      expect(output.getCell('G6').address).toBe('G6');
      expect(output.getCell('G11').text).toBe('');
    });
  });

  it('CSV 與看板有效作答、順位、勝出旗標、空格序與 ISO 時間一致；作廢不列（T018）', async () => {
    await withDatabase(async (database) => {
      const entry = (await expectedFiles())[1]!;
      await seedFixture(database, entry);
      seedGroup(database);
      insertGroup(database, { id: 'group-2', name: '第二組', position: 2 });
      answer(database, 1, ['CPU', '作業系統']);
      answer(database, 1, ['CPU二', '作業系統二'], 'group-2', 2);
      const voided = answer(database, 2, ['不列出一', '不列出二']);
      voidSubmission(database, voided, 'group-1', '2026-11-14T09:09:00.000Z');
      answer(database, 3, ['單題答案'], 'group-2');
      answer(database, 4, ['也不列出']);
      voidSubmission(database, 'q-4', 'group-1', '2026-11-14T09:09:00.000Z');
      closeActivity(database);
      const before = databaseSnapshot(database);

      const file = await exportResultCsv(database, NOW);
      const rows = csvText(file.bytes).split('\r\n');
      const questionOneTime = '2026-11-14T09:08:08.123Z';
      const questionThreeTime = '2026-11-14T09:08:10.123Z';

      expect(rows).toEqual([
        '題號,空格序,組別,答案,順位,是否搶答成功,送出時間',
        `1,1,第一組,CPU,1,是,${questionOneTime}`,
        `1,2,第一組,作業系統,1,是,${questionOneTime}`,
        `1,1,第二組,CPU二,2,否,${questionOneTime}`,
        `1,2,第二組,作業系統二,2,否,${questionOneTime}`,
        `3,1,第二組,單題答案,1,是,${questionThreeTime}`,
      ]);
      expect(rows).toHaveLength(6);
      expect(file.fileName).toBe('搶答結果_20261114_0908.csv');
      expect(file.contentType).toBe('text/csv; charset=utf-8');
      expect(databaseSnapshot(database)).toBe(before);
    });
  });

  it('CSV 沒有任何有效作答時只有 header（T018）', async () => {
    await withDatabase(async (database) => {
      const entry = (await expectedFiles())[0]!;
      await seedFixture(database, entry);
      seedGroup(database);
      closeActivity(database);

      const file = await exportResultCsv(database, NOW);
      expect(csvText(file.bytes)).toBe(
        '題號,空格序,組別,答案,順位,是否搶答成功,送出時間',
      );
    });
  });

  it('50 組 × 30 題由呼叫匯出到完整位元組在 5 秒內完成（SC-003）', async () => {
    await withDatabase(async (database) => {
      const workbook = new ExcelJS.Workbook();
      const source = workbook.addWorksheet('學習單');
      const questions = Array.from({ length: 30 }, (_, index) => {
        const number = index + 1;
        source.getCell(`G${number + 4}`).value = '原版題目';
        return {
          id: `q-${number}`,
          number,
          kind: 'single' as const,
          prompt: '效能驗證',
          position: number,
          blanks: [{ position: 1, prefix: '', cell: `G${number + 4}` }],
        };
      });
      const written = await workbook.xlsx.writeBuffer();
      const original = new Uint8Array(written as unknown as Uint8Array);
      const ids = Array.from({ length: 50 }, (_, index) => `g-${index + 1}`);
      for (const [index, id] of ids.entries()) {
        insertGroup(database, {
          id,
          name: `第${index + 1}組`,
          position: index + 1,
        });
      }
      replaceAll(
        database,
        {
          sourceKind: 'file',
          sourceUrl: null,
          fileName: 'load.xlsx',
          file: original,
          sheetName: '學習單',
          importedAt: NOW.toISOString(),
        },
        questions,
      );
      for (const number of Array.from({ length: 30 }, (_, index) => index + 1)) {
        for (const [index, id] of ids.entries()) {
          answer(database, number, [`題${number}-${id}`], id, index + 1);
        }
      }
      closeActivity(database);
      expect(listQuestions(database)).toHaveLength(30);

      const started = performance.now();
      const file = await exportGuidedNotes(database, NOW);
      const elapsed = performance.now() - started;

      const output = await worksheet(file.bytes, '學習單');
      expect(output.getCell('G5').text).toBe('題1-g-1');
      expect(elapsed).toBeLessThan(5_000);
    });
  }, 20_000);
});
