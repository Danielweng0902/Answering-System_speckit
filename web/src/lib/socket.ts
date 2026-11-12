import type { Ack, CommandEvent, CommandPayloads } from '@classroom/shared';
import { io, type Socket } from 'socket.io-client';
import { getToken } from './session';

let currentToken: string | null = getToken();
let connectRequested = false;

/** 同源 Socket.IO 連線；path 使用伺服器預設的 /socket.io。 */
const socket: Socket = io({
  autoConnect: false,
  // Handshake 函式在每次連線與自動重連時執行，因此永遠讀取
  // sessionStorage 目前的 token，而不是沿用建立 client 時的舊值。
  auth: (sendAuth) => {
    currentToken = getToken();
    sendAuth({ token: currentToken ?? undefined });
  },
  reconnection: true,
});

/** 取得共用的 Socket.IO client。 */
export function getSocket(): Socket {
  return socket;
}

/**
 * 確保以指定（或目前 sessionStorage 中的）token 連線。
 * token 改變時會重新建立 handshake；相同 token 的每次自動重連都會
 * 透過 auth callback 重新讀取 sessionStorage。
 */
export function connectSocket(token?: string | null): Socket {
  const nextToken = token === undefined ? getToken() : token;

  if (nextToken !== currentToken) {
    currentToken = nextToken;
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

/** 等待伺服器回覆的上限；超過就讓畫面恢復可操作，避免按鈕永久停用。 */
export const COMMAND_TIMEOUT_MS = 10_000;

const NO_RESPONSE_MESSAGE = '伺服器沒有回應，請稍後再試';

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
    return (await connectSocket().timeout(COMMAND_TIMEOUT_MS).emitWithAck(event, payload)) as Ack;
  } catch {
    return { ok: false, error: { code: null, message: NO_RESPONSE_MESSAGE } };
  }
}
