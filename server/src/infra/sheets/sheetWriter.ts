/**
 * Google 試算表寫入連接層（006 US1）。
 *
 * 只呼叫 `spreadsheets.values.batchUpdate`：只寫答案值，老師原本的格式、
 * 公式與版面都不會被改動（這是 006 規格的決定）。不重建整張表。
 *
 * 認證用服務帳號（JWT bearer）：金鑰只在環境變數，不進版控、不進 log
 * （憲法原則 IV）。本檔案不記錄任何 token、金鑰或回應內容。
 */
import { ERROR_MESSAGES } from '@classroom/shared';

const DEFAULT_API_BASE_URL = 'https://sheets.googleapis.com';
const DEFAULT_TIMEOUT_MS = 10_000;

export type SheetWriteErrorCode =
  | 'SHEET_NOT_FOUND'
  | 'SHEET_NOT_EDITABLE'
  | 'SHEET_UNAVAILABLE';

/** 可預期的寫入失敗；訊息取自共用錯誤代碼，不夾帶 API 回應內容。 */
export class SheetWriteError extends Error {
  readonly code: SheetWriteErrorCode;

  constructor(code: SheetWriteErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'SheetWriteError';
    this.code = code;
  }
}

export type SheetCellUpdate = {
  /** A1 座標，例如 `H5`（不含工作表名稱）。 */
  cell: string;
  /** 要寫入的文字。 */
  value: string;
};

export type SheetWriteRequest = {
  /** Google 試算表 ID。 */
  spreadsheetId: string;
  /** 工作表名稱（002 匯入時保存的那一個）。 */
  sheetName: string;
  updates: readonly SheetCellUpdate[];
};

/** 可注入的寫入介面：測試用假的，實作用 Google API。 */
export type SheetWriter = {
  writeCells: (request: SheetWriteRequest) => Promise<void>;
};

export type GoogleSheetWriterOptions = {
  /** 取得 OAuth access token；測試注入假的。 */
  accessTokenProvider: () => Promise<string>;
  fetchImpl?: typeof fetch | undefined;
  apiBaseUrl?: string | undefined;
  timeoutMs?: number | undefined;
};

/** 工作表名稱可能有空格或單引號，一律用單引號包住並把 ' 跳脫成 ''。 */
export function toSheetRange(sheetName: string, cell: string): string {
  const escaped = sheetName.replace(/'/g, "''");
  return `'${escaped}'!${cell}`;
}

async function classifyResponse(response: Response): Promise<SheetWriteErrorCode> {
  if (response.status === 401 || response.status === 403) {
    return 'SHEET_NOT_EDITABLE';
  }
  if (response.status === 404) {
    return 'SHEET_NOT_FOUND';
  }
  if (response.status === 400) {
    // Google 對「工作表不存在／範圍無法解析」回 400；其餘 400 視為暫時不可用。
    const body = await response.text().catch(() => '');
    return body.includes('Unable to parse range')
      ? 'SHEET_NOT_FOUND'
      : 'SHEET_UNAVAILABLE';
  }
  return 'SHEET_UNAVAILABLE';
}

/** 建立以服務帳號呼叫 Google Sheets API 的寫入器。 */
export function createGoogleSheetWriter(
  options: GoogleSheetWriterOptions,
): SheetWriter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async writeCells(request: SheetWriteRequest): Promise<void> {
      if (request.updates.length === 0) {
        return;
      }
      const accessToken = await options.accessTokenProvider();
      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        abortController.abort();
      }, timeoutMs);

      try {
        const response = await fetchImpl(
          `${apiBaseUrl}/v4/spreadsheets/${encodeURIComponent(
            request.spreadsheetId,
          )}/values:batchUpdate?valueInputOption=RAW`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              valueInputOption: 'RAW',
              data: request.updates.map((update) => ({
                range: toSheetRange(request.sheetName, update.cell),
                values: [[update.value]],
              })),
            }),
            signal: abortController.signal,
          },
        );

        if (!response.ok) {
          throw new SheetWriteError(await classifyResponse(response));
        }
      } catch (error) {
        if (error instanceof SheetWriteError) {
          throw error;
        }
        // 逾時與網路問題對老師來說都一樣：暫時寫不進去。
        throw new SheetWriteError('SHEET_UNAVAILABLE');
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
