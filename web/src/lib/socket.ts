import type { Ack, CommandEvent, CommandPayloads } from '@classroom/shared';
import { io, type Socket } from 'socket.io-client';
import { getToken } from './session';
import { localizeErrorMessage } from './i18n/errors';
import { getCurrentLanguage } from './i18n/language';

let currentToken: string | null = getToken();
/**
 * 憑證來源模式：
 * - `'session'`：每次握手都讀 sessionStorage（學生端；重新整理後仍在）。
 * - `'explicit'`：固定用明確指定的 token；`null` 代表**不帶 token**
 *   （2026-11-22 D18：老師端改用 HttpOnly cookie，握手時不帶憑證）。
 */
let tokenMode: 'session' | 'explicit' = 'session';
/** 005：投影頁以 view='projector' 連線，伺服器改送不含作答資訊的投影快照。 */
export type SocketView = 'normal' | 'projector';
let currentView: SocketView = 'normal';
let connectRequested = false;

/** 同源 Socket.IO 連線；path 使用伺服器預設的 /socket.io。 */
const socket: Socket = io({
  autoConnect: false,
  // Handshake 函式在每次連線與自動重連時執行，因此學生端永遠讀取
  // sessionStorage 目前的 token；老師端則固定不帶 token（改用 cookie）。
  auth: (sendAuth) => {
    const token = tokenMode === 'session' ? getToken() : currentToken;
    sendAuth({
      token: token ?? undefined,
      view: currentView === 'projector' ? 'projector' : undefined,
    });
  },
  reconnection: true,
});

/** 取得共用的 Socket.IO client。 */
export function getSocket(): Socket {
  return socket;
}

/**
 * 確保以指定（或目前 sessionStorage 中的）token 連線。
 *
 * - `token` 省略：沿用 sessionStorage 的憑證（學生端）。
 * - `token` 為 `null`：不帶憑證，老師端靠 HttpOnly cookie 認證。
 * - `token` 為字串：使用這個憑證。
 *
 * token 改變時會重新建立 handshake；相同 token 的每次自動重連都會
 * 透過 auth callback 重新讀取 sessionStorage。
 */
export function connectSocket(
  token?: string | null,
  view?: SocketView,
): Socket {
  const nextToken = token === undefined ? getToken() : token;
  const nextMode: 'session' | 'explicit' =
    token === undefined ? 'session' : 'explicit';
  // 不指定檢視模式時沿用目前模式：投影頁登入後仍維持投影快照（005）。
  const nextView = view ?? currentView;

  if (
    nextToken !== currentToken ||
    nextMode !== tokenMode ||
    nextView !== currentView
  ) {
    currentToken = nextToken;
    tokenMode = nextMode;
    currentView = nextView;
    socket.disconnect();
    socket.connect();
    connectRequested = true;
    return socket;
  }

  if (!connectRequested) {
    socket.connect();
    connectRequested = true;
  }

  return socket;
}

/** 登出、測試或頁面卸載流程需要停止連線時使用。 */
export function disconnectSocket(): void {
  connectRequested = false;
  socket.disconnect();
}

/**
 * 2026-11-22（D18）：強制重新握手。
 *
 * 老師的登入狀態在 HttpOnly cookie 裡，token 從頭到尾都是 null，所以
 * 登入／登出之後**憑證沒有變化**、不能靠 token 差異觸發重連；這裡明確
 * 重新握手，讓伺服器用新的 cookie 重新判定身分。
 */
export function reconnectSocket(): void {
  socket.disconnect();
  socket.connect();
  connectRequested = true;
}

/** 等待伺服器回覆的上限；超過就讓畫面恢復可操作，避免按鈕永久停用。 */
export const COMMAND_TIMEOUT_MS = 10_000;

/** 007 i18n：伺服器沒回應時的訊息（依語言）。 */
const NO_RESPONSE_MESSAGES = {
  'zh-TW': '伺服器沒有回應，請稍後再試',
  en: 'The server did not respond, please try again later',
} as const;

/**
 * 指令結果：伺服器的 Ack，或前端自己判定的失敗（逾時、斷線）。
 * 前端失敗的 code 為 null，與 lib/api.ts 的寫法一致；contracts 沒有定義
 * 這類錯誤代碼，所以不冒用伺服器的代碼。
 */
export type CommandResult = Ack | { ok: false; error: { code: null; message: string } };

/** 依 contracts 以 Socket.IO ack 送出指令；伺服器沒有回覆時以逾時結束。 */
export async function sendCommand<E extends CommandEvent>(
  event: E,
  payload: CommandPayloads[E],
): Promise<CommandResult> {
  try {
    const ack = (await connectSocket()
      .timeout(COMMAND_TIMEOUT_MS)
      .emitWithAck(event, payload)) as Ack;
    // 007 i18n：伺服器回繁中，英文版在客戶端依錯誤代碼翻譯。
    if (!ack.ok) {
      return {
        ok: false,
        error: {
          code: ack.error.code,
          message: localizeErrorMessage(ack.error.code, ack.error.message),
        },
      };
    }
    return ack;
  } catch {
    return {
      ok: false,
      error: {
        code: null,
        message: NO_RESPONSE_MESSAGES[getCurrentLanguage()],
      },
    };
  }
}
