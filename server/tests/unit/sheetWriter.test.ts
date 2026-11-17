import { describe, expect, it } from 'vitest';
import {
  SheetWriteError,
  createGoogleSheetWriter,
  toSheetRange,
  type SheetWriteRequest,
} from '../../src/infra/sheets/sheetWriter.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const REQUEST: SheetWriteRequest = {
  spreadsheetId: 'sheet-id-123',
  sheetName: '學習單',
  updates: [
    { cell: 'H5', value: 'CPU' },
    { cell: 'H6', value: '作業系統' },
  ],
};

describe('Google 試算表寫入（006 US1）', () => {
  it('toSheetRange 用單引號包住工作表名稱，並把單引號跳脫', () => {
    expect(toSheetRange('學習單', 'H5')).toBe("'學習單'!H5");
    expect(toSheetRange("Bob's sheet", 'B2')).toBe("'Bob''s sheet'!B2");
  });

  it('以 values.batchUpdate 一次寫入所有儲存格，只送值不動格式', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const writer = createGoogleSheetWriter({
      accessTokenProvider: async () => 'token-abc',
      apiBaseUrl: 'https://sheets.test',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse(200, { spreadsheetId: 'sheet-id-123' });
      }) as unknown as typeof fetch,
    });

    await writer.writeCells(REQUEST);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://sheets.test/v4/spreadsheets/sheet-id-123/values:batchUpdate?valueInputOption=RAW',
    );
    expect(calls[0]?.init.method).toBe('POST');
    expect(
      (calls[0]?.init.headers as Record<string, string>).Authorization,
    ).toBe('Bearer token-abc');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      valueInputOption: 'RAW',
      data: [
        { range: "'學習單'!H5", values: [['CPU']] },
        { range: "'學習單'!H6", values: [['作業系統']] },
      ],
    });
  });

  it('沒有要寫的儲存格時不發任何請求', async () => {
    let called = false;
    const writer = createGoogleSheetWriter({
      accessTokenProvider: async () => 'token-abc',
      fetchImpl: (async () => {
        called = true;
        return jsonResponse(200, {});
      }) as unknown as typeof fetch,
    });

    await writer.writeCells({ ...REQUEST, updates: [] });

    expect(called).toBe(false);
  });

  it.each([
    { status: 401, body: {}, code: 'SHEET_NOT_EDITABLE' },
    { status: 403, body: {}, code: 'SHEET_NOT_EDITABLE' },
    { status: 404, body: {}, code: 'SHEET_NOT_FOUND' },
    {
      status: 400,
      body: { error: { message: 'Unable to parse range: 學習單!H5' } },
      code: 'SHEET_NOT_FOUND',
    },
    { status: 400, body: { error: { message: 'Invalid value' } }, code: 'SHEET_UNAVAILABLE' },
    { status: 429, body: {}, code: 'SHEET_UNAVAILABLE' },
    { status: 500, body: {}, code: 'SHEET_UNAVAILABLE' },
  ])('HTTP $status 映射成 $code', async ({ status, body, code }) => {
    const writer = createGoogleSheetWriter({
      accessTokenProvider: async () => 'token-abc',
      apiBaseUrl: 'https://sheets.test',
      fetchImpl: (async () => jsonResponse(status, body)) as unknown as typeof fetch,
    });

    await expect(writer.writeCells(REQUEST)).rejects.toMatchObject({
      name: 'SheetWriteError',
      code,
    });
  });

  it('網路錯誤與逾時都視為暫時不可用', async () => {
    const writer = createGoogleSheetWriter({
      accessTokenProvider: async () => 'token-abc',
      apiBaseUrl: 'https://sheets.test',
      fetchImpl: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    });

    await expect(writer.writeCells(REQUEST)).rejects.toBeInstanceOf(
      SheetWriteError,
    );
    await expect(writer.writeCells(REQUEST)).rejects.toMatchObject({
      code: 'SHEET_UNAVAILABLE',
    });
  });
});
