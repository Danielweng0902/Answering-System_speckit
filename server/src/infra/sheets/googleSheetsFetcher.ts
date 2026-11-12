/**
 * Google 試算表連結的辨識與 xlsx 下載（research R4）。
 * 每個轉址都由伺服器檢查 HTTPS 與允許主機；不使用 fetch 的自動轉址。
 */
import { ERROR_MESSAGES } from '@classroom/shared';
import {
  assertWorkbookSize,
  WorkbookReadError,
} from '../xlsx/workbookReader.js';

const SHEET_LINK_PATTERN =
  /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:[/?#]|$)/;
const SHEET_TIMEOUT_MS = 10_000;
const MAX_SHEET_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type SheetFetchErrorCode =
  | 'LINK_UNREACHABLE'
  | 'LINK_NOT_SHARED'
  | 'FILE_INVALID'
  | 'FILE_TOO_LARGE';

/** 可預期的連結／下載錯誤；訊息不夾帶網址或回應內容。 */
export class SheetFetchError extends Error {
  readonly code: SheetFetchErrorCode;

  constructor(code: SheetFetchErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'SheetFetchError';
    this.code = code;
  }
}

/** 解析老師貼上的連結；不符合形式時回 null（對應 LINK_INVALID）。 */
export function parseSheetLink(url: string): { id: string } | null {
  const match = SHEET_LINK_PATTERN.exec(url.trim());
  const id = match?.[1];
  return id === undefined ? null : { id };
}

/** 存進資料庫的正規化網址，不含查詢字串與 gid。 */
export function normalizeSheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}`;
}

export function exportUrl(id: string): string {
  return `${normalizeSheetUrl(id)}/export?format=xlsx`;
}

export type FetchSheetOptions = {
  /** 可注入的 fetch；測試一律注入假的，不連網路。 */
  fetchImpl?: typeof fetch | undefined;
  /** 呼叫端可合併自己的取消訊號。 */
  signal?: AbortSignal | undefined;
  /** 以下兩個時鐘接點供單元測試手動觸發；預設仍是固定 10 秒。 */
  timeoutMs?: number | undefined;
  setTimeoutImpl?:
    | ((callback: () => void, milliseconds: number) => unknown)
    | undefined;
  clearTimeoutImpl?: ((handle: unknown) => void) | undefined;
};

function isAllowedDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      (host === 'docs.google.com' || host.endsWith('.googleusercontent.com'))
    );
  } catch {
    return false;
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 不讀取內容；釋放連線失敗不改變原本的錯誤分類。
  }
}

function looksLikeXlsxArchive(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** 逐塊讀取，超過 5 MB 時取消 reader，絕不等到 arrayBuffer 全部載入。 */
async function readResponseBytes(
  response: Response,
  abortController: AbortController,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_SHEET_DOWNLOAD_BYTES
  ) {
    await discardBody(response);
    abortController.abort();
    throw new SheetFetchError('FILE_TOO_LARGE');
  }

  if (response.body === null) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_SHEET_DOWNLOAD_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // 即使底層取消失敗，大小上限仍然成立。
        }
        abortController.abort();
        throw new SheetFetchError('FILE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SheetFetchError) {
      throw error;
    }
    throw new SheetFetchError('LINK_UNREACHABLE');
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function downloadSheet(
  id: string,
  options: FetchSheetOptions,
  abortController: AbortController,
): Promise<Uint8Array> {
  const doFetch = options.fetchImpl ?? fetch;
  let currentUrl = exportUrl(id);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;
    try {
      response = await doFetch(currentUrl, {
        redirect: 'manual',
        signal: abortController.signal,
      });
    } catch {
      throw new SheetFetchError('LINK_UNREACHABLE');
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      if (redirectCount === MAX_REDIRECTS) {
        await discardBody(response);
        throw new SheetFetchError('LINK_UNREACHABLE');
      }
      const location = response.headers.get('location');
      if (location === null) {
        await discardBody(response);
        throw new SheetFetchError('LINK_NOT_SHARED');
      }
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        await discardBody(response);
        throw new SheetFetchError('LINK_NOT_SHARED');
      }
      if (!isAllowedDownloadUrl(nextUrl)) {
        // 登入頁與任意外部主機都在發出下一個請求、讀取本體之前拒絕。
        await discardBody(response);
        throw new SheetFetchError('LINK_NOT_SHARED');
      }
      await discardBody(response);
      currentUrl = nextUrl;
      continue;
    }

    if (
      !response.ok &&
      (response.status === 401 || response.status === 403 || response.status === 404)
    ) {
      await discardBody(response);
      throw new SheetFetchError('LINK_NOT_SHARED');
    }
    if (!response.ok) {
      await discardBody(response);
      throw new SheetFetchError('LINK_UNREACHABLE');
    }

    const bytes = await readResponseBytes(response, abortController);
    if (!looksLikeXlsxArchive(bytes)) {
      throw new SheetFetchError('LINK_NOT_SHARED');
    }
    try {
      // 與直接上傳採相同壓縮炸彈／損毀檢查；仍不讓 exceljs 先展開。
      await assertWorkbookSize(bytes);
    } catch (error) {
      if (error instanceof WorkbookReadError) {
        throw new SheetFetchError(error.code);
      }
      throw error;
    }
    return bytes;
  }

  throw new SheetFetchError('LINK_UNREACHABLE');
}

/** 下載成功回 xlsx 位元組；失敗只拋出帶 contracts code 的 SheetFetchError。 */
export async function fetchSheetXlsx(
  id: string,
  options: FetchSheetOptions = {},
): Promise<Uint8Array> {
  if (options.signal?.aborted) {
    throw new SheetFetchError('LINK_UNREACHABLE');
  }

  const abortController = new AbortController();
  const schedule: (callback: () => void, milliseconds: number) => unknown =
    options.setTimeoutImpl ??
    ((callback, milliseconds) => globalThis.setTimeout(callback, milliseconds));
  const cancel: (handle: unknown) => void =
    options.clearTimeoutImpl ??
    ((handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  let rejectTimeout: (error: SheetFetchError) => void = () => undefined;
  const timeoutFailure = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timeoutHandle = schedule(() => {
    abortController.abort();
    rejectTimeout(new SheetFetchError('LINK_UNREACHABLE'));
  }, options.timeoutMs ?? SHEET_TIMEOUT_MS);
  const onExternalAbort = (): void => {
    abortController.abort();
    rejectTimeout(new SheetFetchError('LINK_UNREACHABLE'));
  };
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    return await Promise.race([
      downloadSheet(id, options, abortController),
      timeoutFailure,
    ]);
  } finally {
    cancel(timeoutHandle);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}
