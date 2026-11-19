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

describe('006 寫回前的版面比對（人工驗證建議 3；T023；T026 的失敗分支）', () => {
  it('線上試算表與匯入時相同 → 直接寫回', async () => {
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

  it('線上試算表在匯入後被改過 → 回 SHEET_MODIFIED 且不寫入', async () => {
    database = openDatabase(':memory:');
    await seedOfficialGroupLinkStructure(database);
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      fetchImpl: fakeSheetFetch('04-mixed-groups.xlsx'),
    });

    expect(result).toMatchObject({ ok: false, code: 'SHEET_MODIFIED' });
    expect(requests).toHaveLength(0);
  });

  it('老師確認後（force）即使版面不同也寫回', async () => {
    database = openDatabase(':memory:');
    await seedOfficialGroupLinkStructure(database);
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      force: true,
      fetchImpl: fakeSheetFetch('04-mixed-groups.xlsx'),
    });

    expect(result).toEqual({ ok: true, writtenCells: 2 });
    expect(requests).toHaveLength(1);
  });

  it('讀不到線上試算表時不比對也不寫入：回 SHEET_CHECK_FAILED 請老師確認（006 T026）', async () => {
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

  it('老師確認後（force）即使比對失敗仍然寫回', async () => {
    database = openDatabase(':memory:');
    await seedOfficialGroupLinkStructure(database);
    const { writer, requests } = recordingWriter();

    const result = await writeBackGuidedNotes(database, writer, new Date(), {
      force: true,
      fetchImpl: failingSheetFetch(),
    });

    expect(result).toEqual({ ok: true, writtenCells: 2 });
    expect(requests).toHaveLength(1);
  });
});
