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
import {
  failingSheetFetch,
  fakeSheetFetch,
  seedOfficialGroupLinkStructure,
} from './guidedNotesFixtures.js';

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

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

/**
 * 2026-11-19 review 的實測：在匯入後、寫回前於線上試算表最上方新增一列，
 * 照舊座標寫會整體錯位。這裡用「儲存座標與線上座標不同、但題號與前綴
 * 一致」模擬同一種情況：系統必須改用線上現在的座標寫入。
 */
async function seedWithShiftedStoredCells(
  target: DatabaseSync,
): Promise<void> {
  insertGroup(target, { id: 'group-1', name: '第一組', position: 1 });
  insertGroup(target, { id: 'group-2', name: '第二組', position: 2 });
  replaceAll(
    target,
    {
      sourceKind: 'link',
      sourceUrl: 'https://docs.google.com/spreadsheets/d/sheet-id-123',
      fileName: '02-official-group.xlsx',
      file: new Uint8Array(),
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
          // 匯入當時的座標（假設當時表上還多一列，所以比線上多了一列）
          { position: 1, prefix: '（1）', cell: 'G6' },
          { position: 2, prefix: '（2）', cell: 'G7' },
        ],
      },
    ],
  );
  insertSubmission(target, {
    id: 's1',
    questionId: 'q-1',
    groupId: 'group-1',
    rank: 1,
    receivedAt: '2026-11-17T09:30:00.000Z',
    answers: ['甲答案', '乙答案'],
  });
}

describe('006 寫回時的座標來源（2026-11-19 review）', () => {
  it('線上版面與匯入時相同 → 寫到線上現在的座標', async () => {
    database = openDatabase(':memory:');
    await seedOfficialGroupLinkStructure(database);
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

  it('老師在匯入後把列往下移 → 題號與前綴還對得上時，改用線上現在的座標寫入（不會整體錯位）', async () => {
    database = openDatabase(':memory:');
    await seedWithShiftedStoredCells(database);
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      fetchImpl: fakeSheetFetch('02-official-group.xlsx'),
    });

    expect(result).toEqual({ ok: true, writtenCells: 2 });
    // 用線上解析出的 H5／H6，而不是儲存的 H7／H8。
    expect(requests[0]?.updates).toEqual([
      { cell: 'H5', value: '甲答案' },
      { cell: 'H6', value: '乙答案' },
    ]);
  });

  it('線上題目被改掉（題號／空格數不同）→ 對應不起來，不寫入，回 SHEET_MODIFIED', async () => {
    database = openDatabase(':memory:');
    await seedOfficialGroupLinkStructure(database);
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      // 04 是另一種版面：第 1 題只有一個空格，與儲存的兩空格題組對不起來。
      fetchImpl: fakeSheetFetch('04-mixed-groups.xlsx'),
    });

    expect(result).toMatchObject({ ok: false, code: 'SHEET_MODIFIED' });
    expect(requests).toHaveLength(0);
  });

  it('讀不到線上試算表 → 無法確認要寫到哪裡，不寫入，回 SHEET_CHECK_FAILED', async () => {
    database = openDatabase(':memory:');
    await seedOfficialGroupLinkStructure(database);
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      fetchImpl: failingSheetFetch(),
    });

    // 讀不到不代表服務帳號不能寫 → 不能靜默照舊座標寫入，先停下來問老師。
    expect(result).toMatchObject({ ok: false, code: 'SHEET_CHECK_FAILED' });
    expect(requests).toHaveLength(0);
  });
});
