import type {
  Ack,
  CommandEvent,
  CommandPayloads,
} from '@classroom/shared';
import { io, type Socket } from 'socket.io-client';
import { getToken } from './session';

let currentToken: string | null = getToken();
let connectRequested = false;

/** 同源 Socket.IO 連線；path 使用伺服器預設的 /socket.io。 */
const socket: Socket = io({
  autoConnect: false,
  auth: { token: currentToken ?? undefined },
  reconnection: true,
});

/** 取得共用的 Socket.IO client。 */
export function getSocket(): Socket {
  return socket;
}

/**
 * 確保以指定（或目前 sessionStorage 中的）token 連線。
 * token 改變時會重新建立 handshake；相同 token 的自動重連交給 Socket.IO。
 */
export function connectSocket(token?: string | null): Socket {
  const nextToken = token === undefined ? getToken() : token;

  if (nextToken !== currentToken) {
    currentToken = nextToken;
    socket.auth = nextToken === null ? {} : { token: nextToken };
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

/** 依 contracts 以 Socket.IO ack 送出指令；成功與失敗都由伺服器回覆。 */
export function sendCommand<E extends CommandEvent>(
  event: E,
  payload: CommandPayloads[E],
): Promise<Ack> {
  return connectSocket().emitWithAck(event, payload) as Promise<Ack>;
}
