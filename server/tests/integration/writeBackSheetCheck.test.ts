import { afterEach, describe, expect, it } from 'vitest';
import { writeBackGuidedNotes } from '../../src/app/guidedNotesWriteBack.js';
import { openDatabase } from '../../src/infra/db/database.js';
import type {
  SheetWriter,
  SheetWriteRequest,
} from '../../src/infra/sheets/sheetWriter.js';
import type { DatabaseSync } from 'node:sqlite';
import {
  failingSheetFetch,
  fakeSheetFetch,
  fakeSheetFetchWithInsertedRow,
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

describe('006 寫回前的版面比對與自動對位（2026-11-19 review / T029）', () => {
  it('線上版面與匯入時相同 → 寫到原來的座標，並回報沒有對位', async () => {
    database = openDatabase(':memory:');
    await seedOfficialGroupLinkStructure(database);
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      fetchImpl: fakeSheetFetch('02-official-group.xlsx'),
    });

    expect(result).toEqual({ ok: true, writtenCells: 2, remapped: false });
    expect(requests[0]?.updates).toEqual([
      { cell: 'H5', value: '答案 A' },
      { cell: 'H6', value: '答案 B' },
    ]);
  });

  it('老師在線上插了一列 → 題目沒被改就自動對到線上現在的座標寫入（不再整體錯位）', async () => {
    database = openDatabase(':memory:');
    await seedOfficialGroupLinkStructure(database);
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      // 線上版本在最上方多了一列，題目整個往下移一列（G5→G6、G6→G7）。
      fetchImpl: await fakeSheetFetchWithInsertedRow(
        '02-official-group.xlsx',
        1,
      ),
    });

    expect(result).toEqual({ ok: true, writtenCells: 2, remapped: true });
    expect(requests[0]?.updates).toEqual([
      { cell: 'H6', value: '答案 A' },
      { cell: 'H7', value: '答案 B' },
    ]);
  });

  it('線上題幹被改掉 → 對應不起來，不寫入，回 SHEET_MODIFIED', async () => {
    database = openDatabase(':memory:');
    await seedOfficialGroupLinkStructure(database, {
      prompts: { 1: '老師改寫過的題目' },
    });
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      fetchImpl: fakeSheetFetch('02-official-group.xlsx'),
    });

    expect(result).toMatchObject({ ok: false, code: 'SHEET_MODIFIED' });
    expect(requests).toHaveLength(0);
  });

  it('兩題的內容互換（題號對調）→ 對應不起來，不寫入，回 SHEET_MODIFIED', async () => {
    database = openDatabase(':memory:');
    // 題號 1、2 互換：題號還在，但題幹對不上，不能寫。
    await seedOfficialGroupLinkStructure(database, {
      renumber: { 1: 2, 2: 1 },
    });
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      fetchImpl: fakeSheetFetch('02-official-group.xlsx'),
    });

    expect(result).toMatchObject({ ok: false, code: 'SHEET_MODIFIED' });
    expect(requests).toHaveLength(0);
  });

  it('線上題目的空格數變了 → 對應不起來，不寫入，回 SHEET_MODIFIED', async () => {
    database = openDatabase(':memory:');
    await seedOfficialGroupLinkStructure(database, {
      blanks: {
        1: [
          { position: 1, prefix: '（1）', cell: 'G5' },
          { position: 2, prefix: '（2）', cell: 'G6' },
          { position: 3, prefix: '（3）', cell: 'G7' },
        ],
      },
    });
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      fetchImpl: fakeSheetFetch('02-official-group.xlsx'),
    });

    expect(result).toMatchObject({ ok: false, code: 'SHEET_MODIFIED' });
    expect(requests).toHaveLength(0);
  });

  it('線上題目的前綴被改掉 → 對應不起來，不寫入，回 SHEET_MODIFIED', async () => {
    database = openDatabase(':memory:');
    await seedOfficialGroupLinkStructure(database, {
      blanks: {
        1: [
          { position: 1, prefix: '(1)', cell: 'G5' },
          { position: 2, prefix: '（2）', cell: 'G6' },
        ],
      },
    });
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      fetchImpl: fakeSheetFetch('02-official-group.xlsx'),
    });

    expect(result).toMatchObject({ ok: false, code: 'SHEET_MODIFIED' });
    expect(requests).toHaveLength(0);
  });

  it('線上是另一份學習單（題目完全不一樣）→ 對應不起來，不寫入，回 SHEET_MODIFIED', async () => {
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

  it('答案數與線上的空格數不一致 → 對不起來，不寫入，回 SHEET_MODIFIED', async () => {
    database = openDatabase(':memory:');
    // 直接給一筆答案數對不上的作答（正常流程不會產生，防守用）。
    await seedOfficialGroupLinkStructure(database, {
      submissionAnswers: ['A', 'B', 'C'],
    });
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      fetchImpl: fakeSheetFetch('02-official-group.xlsx'),
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
