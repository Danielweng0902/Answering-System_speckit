import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadGuidedNotes, downloadResultCsv } from '../src/lib/api';
import { saveToken } from '../src/lib/session';

describe('Guided Notes 下載 API（004 T012）', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveToken('teacher-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('帶 bearer token 下載 blob，解析 UTF-8 檔名', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([80, 75, 3, 4]), {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="guided-notes.xlsx"; filename*=UTF-8''${encodeURIComponent('搶答結果_20261114_0908.xlsx')}`,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadGuidedNotes();

    expect(fetchMock).toHaveBeenCalledWith('/api/export/guided-notes', {
      headers: { authorization: 'Bearer teacher-token' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileName).toBe('搶答結果_20261114_0908.xlsx');
      expect(result.blob.size).toBe(4);
    }
  });

  it('CSV 使用 results.csv 端點與相同 token，並解析檔名', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0xef, 0xbb, 0xbf]), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="results.csv"; filename*=UTF-8''${encodeURIComponent('搶答結果_20261114_0908.csv')}`,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadResultCsv();

    expect(fetchMock).toHaveBeenCalledWith('/api/export/results.csv', {
      headers: { authorization: 'Bearer teacher-token' },
    });
    if (result.ok) {
      expect(result.fileName).toBe('搶答結果_20261114_0908.csv');
      expect(result.blob.size).toBe(3);
    } else {
      expect.fail(result.error.message);
    }
  });

  it('失敗時保留伺服器的中文訊息，不把它當成下載 blob', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'NO_GUIDED_NOTES',
              message: '這個活動沒有匯入過學習單，請先匯入學習單',
            },
          }),
          {
            status: 422,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    await expect(downloadGuidedNotes()).resolves.toEqual({
      ok: false,
      error: {
        code: 'NO_GUIDED_NOTES',
        message: '這個活動沒有匯入過學習單，請先匯入學習單',
      },
    });
  });
});
