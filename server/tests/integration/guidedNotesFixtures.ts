/**
 * 006 整合測試共用：以連結匯入的官方題組學習單（02）。
 *
 * 測試一律注入假的 fetch，不連網路；線上試算表的內容用 fixture 位元組模擬。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { insertSubmission } from '../../src/infra/db/answerRepo.js';
import { insertGroup } from '../../src/infra/db/groupRepo.js';
import { replaceAll } from '../../src/infra/db/questionRepo.js';

const FIXTURES = fileURLToPath(
  new URL('../../../fixtures/guided-notes/', import.meta.url),
);

export const OFFICIAL_GROUP_FILE = '02-official-group.xlsx';

/** 依 02 fixture 的四題結構存檔；版面比對要比完整結構。 */
export async function seedOfficialGroupLinkStructure(
  target: DatabaseSync,
): Promise<void> {
  insertGroup(target, { id: 'group-1', name: '第一組', position: 1 });
  insertGroup(target, { id: 'group-2', name: '第二組', position: 2 });
  replaceAll(
    target,
    {
      sourceKind: 'link',
      sourceUrl: 'https://docs.google.com/spreadsheets/d/sheet-id-123',
      fileName: OFFICIAL_GROUP_FILE,
      file: new Uint8Array(
        await readFile(`${FIXTURES}${OFFICIAL_GROUP_FILE}`),
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

/** 假的線上試算表回應：回傳指定 fixture 的位元組。 */
export function fakeSheetFetch(fileName: string): typeof fetch {
  return (async () => {
    const bytes = await readFile(`${FIXTURES}${fileName}`);
    return new Response(bytes, { status: 200 });
  }) as unknown as typeof fetch;
}

/** 讀不到線上試算表時的假 fetch。 */
export function failingSheetFetch(): typeof fetch {
  return (async () =>
    new Response('nope', { status: 500 })) as unknown as typeof fetch;
}
