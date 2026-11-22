/**
 * 同時在線連線數上限（2026-11-21 資安審計 C3）。
 *
 * 問題：Socket.IO 連線數原本只受作業系統限制，每一條連線都佔用記憶體，
 * 而且每次廣播都要對全部連線序列化快照——連線一多，連老師端自己的
 * health 請求都會被拖慢（審計實測 250 條連線時 health 要 2.3 秒）。
 *
 * 實作位置選在 **Engine.IO 握手層**（`allowRequest`）而不是 Socket.IO
 * 的 namespace 中介層，理由有二：
 * 1. 被拒的連線不會進入 Socket.IO 的連線集合，因此不會被廣播，也不會
 *    佔用 presence 的計數——攻擊者用大量連線灌水時，伺服器端的成本最低。
 * 2. 握手層被拒時，socket.io-client 收到的是傳輸層錯誤，**會自動退避重連**
 *    （實測確認）。因此遲到的學生會在有人離開、名額空出來時自動進場，
 *    不會被永久卡在「連線中」。
 *
 * 計數必須精準，否則上限形同虛設：`allowRequest` 被呼叫時，這次連線**尚未**
 * 計入 `engine.clientsCount`，所以同時接受多個握手時會全部通過。因此這裡
 * 另外維護「握手中」的保留名額，並在握手完成或失敗時釋放。
 */
import type { IncomingMessage } from 'node:http';
import type { Server as SocketIOServer } from 'socket.io';

/** 握手保留名額的最長存活時間；超過視為握手已死，釋放名額。 */
const RESERVATION_TTL_MS = 30_000;

export type ConnectionCapOptions = {
  /** 同時在線的連線數上限；0 表示不限制。 */
  maxConnections: number;
};

export type ConnectionCap = {
  /**
   * Engine.IO 的 `allowRequest` 攔截器：超過上限時拒絕這次新連線。
   *
   * 拒絕時回 403（Engine.IO 的 FORBIDDEN），socket.io-client 視為傳輸層
   * 失敗並自動退避重連。
   */
  allowRequest: (
    req: IncomingMessage,
    callback: (error: string | null | undefined, success: boolean) => void,
  ) => void;
  /** 綁定 Socket.IO 伺服器，用來追蹤已建立的連線並釋放保留名額。 */
  attach: (io: SocketIOServer) => void;
  /** 目前「已建立＋握手中」的連線數（供測試與觀察用）。 */
  readonly currentCount: number;
};

export function createConnectionCap(options: ConnectionCapOptions): ConnectionCap {
  const maxConnections = options.maxConnections;
  /**
   * 握手中（已放行但尚未建立）的握手，key 為該次握手的 request。
   *
   * 用 request 物件當 key（而不是單純計數）是必要的：`connection` 與
   * `connection_error` 事件不一定成對出現（放行後才被中止的握手只會有
   * 其中一種），用物件當 key 時 `delete` 對不上的就是什麼都不做。
   *
   * 大小天然有上限：只有當「已建立＋握手中」小於上限時才會新增保留名額，
   * 因此這個 Map 最多 maxConnections 筆。
   */
  const reservations = new Map<IncomingMessage, number>();
  /** 已建立的連線數由 io.engine.clientsCount 提供；attach 之前視為 0。 */
  let establishedCount = (): number => 0;

  function release(req: IncomingMessage): void {
    reservations.delete(req);
  }

  /** 清掉已經不可能完成的握手（連線在握手完成前就被中止）。 */
  function expireStaleReservations(now: number): void {
    for (const [req, reservedAt] of reservations) {
      if (now - reservedAt > RESERVATION_TTL_MS) {
        reservations.delete(req);
      }
    }
  }

  return {
    allowRequest(req, callback) {
      if (maxConnections <= 0) {
        callback(null, true);
        return;
      }

      const now = Date.now();
      expireStaleReservations(now);
      // establishedCount 是「已建立」的連線數；這次握手的連線尚未計入，
      // 因此要加上握手中的保留名額，才是真正會同時存在的連線數。
      const liveCount = establishedCount() + reservations.size;
      if (liveCount >= maxConnections) {
        callback('Too many connections', false);
        return;
      }

      reservations.set(req, now);
      // 底層 socket 關閉代表這次握手不可能完成了（被放行後客戶端中止）。
      // 立刻釋放名額，免得被刻意中止的握手占住名額、擋住其他人。
      // 連線成功時 'connection' 事件會先釋放（delete 對已不存在的 key 是
      // 無動作），所以這裡不會誤釋放別人的名額。
      req.socket.once('close', () => {
        release(req);
      });
      callback(null, true);
    },
    attach(io) {
      establishedCount = () => io.engine.clientsCount;
      // 握手完成 → 這筆保留名額轉成 engine 自己計算的已建立連線。
      io.engine.on('connection', (socket) => {
        release(socket.request);
      });
      // 握手失敗 → 釋放保留名額，否則名額會被慢慢吃光。
      io.engine.on('connection_error', ({ req }) => {
        release(req);
      });
    },
    get currentCount() {
      return establishedCount() + reservations.size;
    },
  };
}
