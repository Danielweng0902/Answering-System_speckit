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
  | 'SHEET_TAB_NOT_FOUND'
  | 'SHEET_NOT_EDITABLE'
  | 'SHEET_NOT_NATIVE'
  | 'SHEET_API_DISABLED'
  | 'SHEET_AUTH_FAILED'
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

/** 取用 access token 失敗（金鑰格式錯、金鑰被停用、授權失敗）。 */
export class SheetAuthError extends Error {
  constructor() {
    super('Google access token request failed');
    this.name = 'SheetAuthError';
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

/**
 * 把 Google 的回應分類成可行動的錯誤代碼（006 T021；依 006 人工驗證建議 1）。
 *
 * 只讀取錯誤原因，不把回應內容寫進 log 或使用者訊息。
 */
async function classifyResponse(response: Response): Promise<SheetWriteErrorCode> {
  const body = await response.text().catch(() => '');
  const reason = extractErrorReason(body);

  if (response.status === 401) {
    return 'SHEET_AUTH_FAILED';
  }
  if (response.status === 403) {
    // 專案沒啟用 Sheets API 與「沒有編輯權限」都回 403，靠原因字串區分。
    return reason === 'SERVICE_DISABLED' ? 'SHEET_API_DISABLED' : 'SHEET_NOT_EDITABLE';
  }
  if (response.status === 404) {
    return 'SHEET_NOT_FOUND';
  }
  if (response.status === 400) {
    if (body.includes('not supported for this document')) {
      // 這是「以 Google 試算表開啟的 xlsx」，讀得到但 API 不允許寫。
      return 'SHEET_NOT_NATIVE';
    }
    if (body.includes('Unable to parse range')) {
      return 'SHEET_TAB_NOT_FOUND';
    }
    return 'SHEET_UNAVAILABLE';
  }
  return 'SHEET_UNAVAILABLE';
}

/** 從 Google 的錯誤 JSON 取出狀態字串（例如 `SERVICE_DISABLED`）。 */
function extractErrorReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { status?: unknown; errors?: { reason?: unknown }[] };
    };
    const status = parsed.error?.status;
    if (typeof status === 'string') {
      return status;
    }
    const reason = parsed.error?.errors?.[0]?.reason;
    return typeof reason === 'string' ? reason : '';
  } catch {
    return '';
  }
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
      const accessToken = await options.accessTokenProvider().catch(() => {
        // 取不到 token 是「伺服器設定／金鑰」的問題，不是「暫時無法寫入」。
        throw new SheetAuthError();
      });
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
        if (error instanceof SheetWriteError || error instanceof SheetAuthError) {
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
