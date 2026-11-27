import type { DatabaseSync } from 'node:sqlite';
import type { Server, Socket } from 'socket.io';
import {
  SESSION_INVALID_EVENT,
  type SessionInvalidPayload,
  STATE_EVENT,
  type Snapshot,
} from '@classroom/shared';
import type { AccessIdentity } from '../../app/access.js';
import { resolveIdentity } from '../../app/access.js';
import { recordPresenceChange } from '../../app/presence.js';
import type { AnswerDataView } from '../../app/answerProjections.js';
import { createProjectorSnapshot, createSnapshot } from '../../app/snapshot.js';
import { getGroupById, listGroups } from '../db/groupRepo.js';
import { readTeacherCookieToken } from '../http/teacherSession.js';

export type SocketDataWithIdentity = {
  identity?: AccessIdentity;
  /** 005：投影檢視模式；只有老師身分會取得投影快照。 */
  view?: 'projector' | undefined;
};

export type StateBroadcaster = {
  /** Send one role-filtered snapshot to every connected socket. */
  broadcastState: () => void;
  /** Send answer changes only to teachers and students in the changed group. */
  broadcastSubmissionChanged: (groupId: string) => void;
  /** Current in-memory student connection counts by group. */
  getPresence: () => Record<string, number>;
  /**
   * Notify every connected student of a deleted group: send session:invalid
   * (GROUP_NOT_FOUND), demote the connection to guest, and drop it from
   * presence (contracts/socket-events.md).
   */
  invalidateGroup: (groupId: string) => void;
  /**
   * 2026-11-25（D2-1；OpenSpec 組同日確認並追加此要求）：活動被重設時，
   * **所有**已連線的學生的進場狀態都失效
   * —— 送 session:invalid（ACTIVITY_RESET）、把連線降為 guest、並從在線人數
   * 移除，讓學生回到選組頁（組別保留，重選只要點一下）。
   *
   * 為什麼連「已連線的」也要通知：另一組（OpenSpec 組）那邊的學生端沒有 token，
   * 每次送出都重新檢查，所以重設後他們那邊**一定**會全部重選；我們若不通知
   * 已連線的學生，會變成「同一班有人留在原組、有人要重選」。兩組行為必須一致。
   */
  invalidateAllStudents: () => void;
  /**
   * Turn this connection into a guest after a successful student:leave and
   * remove it from the in-memory presence counts. Stateless data changes are
   * owned by the command use case.
   */
  demoteToGuest: (socket: Socket) => void;
  /**
   * 2026-11-22（D20，100 組）：清除老師看板合併廣播的待處理計時器。
   *
   * 伺服器關閉時必須呼叫：計時器若在資料庫關閉後才觸發，會讀到已關閉的
   * SQLite 而拋出 ERR_INVALID_STATE（變成未處理的例外）。
   */
  dispose: () => void;
};

function socketData(socket: Socket): SocketDataWithIdentity {
  return socket.data as SocketDataWithIdentity;
}

/** Read the identity previously stored for a connection; default is guest. */
export function getSocketIdentity(socket: Socket): AccessIdentity {
  return socketData(socket).identity ?? { role: 'guest' };
}

function tokenFromSocket(socket: Socket): string | undefined {
  const token: unknown = socket.handshake.auth.token;
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/**
 * 2026-11-22（D18）：老師的 Socket.IO 連線不再帶 token，改帶 HttpOnly
 * cookie（瀏覽器同源連線會自動帶上）。因此握手時的身分解析順序是：
 *
 * 1. `auth.token`（學生的 sessionStorage token）
 * 2. cookie 裡的老師 session
 * 3. guest
 */
function resolveSocketIdentity(
  socket: Socket,
  database: DatabaseSync,
): AccessIdentity {
  const token = tokenFromSocket(socket);
  if (token !== undefined) {
    return resolveIdentity(database, token);
  }
  const cookieToken = readTeacherCookieToken(socket.handshake.headers.cookie);
  if (cookieToken !== null) {
    return resolveIdentity(database, cookieToken);
  }
  return { role: 'guest' };
}

/** 005：握手時的檢視模式；只有 'projector' 會改變快照內容。 */
function viewFromSocket(socket: Socket): 'projector' | undefined {
  const view: unknown = socket.handshake.auth.view;
  return view === 'projector' ? 'projector' : undefined;
}

export type StateBroadcasterOptions = {
  /**
   * 2026-11-21 冷啟效能修正 P1：每輪廣播呼叫一次，取得行程內作答索引的
   * 視圖；未提供時快照維持直接讀庫（測試與基準腳本路徑）。
   */
  answersView?: (() => AnswerDataView) | undefined;
};

/**
 * 老師看板合併廣播的時間窗（毫秒）。
 *
 * 2026-11-22（D20，100 組）：倒數歸零全班同時送出時，每筆作答都重建並
 * 送出全場看板（100 組約 600 KB／份）會塞滿事件迴圈。改成同一個時間窗內
 * 只送一份最新看板；120 ms 遠小於契約的「2 秒內更新看板」，行為不變。
 */
export const TEACHER_BOARD_COALESCE_MS = 120;

export function createSocketBroadcaster(
  io: Server,
  database: DatabaseSync,
  options: StateBroadcasterOptions = {},
): StateBroadcaster {
  const connectedStudents = new Map<string, number>();
  // 2026-11-22（D20，100 組）：老師看板的合併廣播計時器。
  let teacherBoardTimer: ReturnType<typeof setTimeout> | null = null;

  function getPresence(): Record<string, number> {
    const presence: Record<string, number> = {};
    for (const group of listGroups(database)) {
      presence[group.id] = connectedStudents.get(group.id) ?? 0;
    }
    return presence;
  }

  /**
   * 005（FR-015、FR-022、research R6）：投影檢視模式連線只收到投影快照，
   * 內容在伺服器端就沒有作答資訊；非老師身分則維持一般快照。
   *
   * 2026-11-21 冷啟效能修正 P2：同一輪廣播裡，快照只由「角色種類＋（學生）
   * 所屬組別／投影檢視」決定，與個別 socket 無關；同組學生用本組 revision、
   * 老師用全場 revision、guest 用活動 revision，key 不同就不會混用。
   * 因此一輪裡每個 key 只建一份，同 key 的 socket 共用同一份快照物件
   * （emit 時各自序列化，內容與逐 socket 重建完全相同）。
   */
  function snapshotForSocket(
    socket: Socket,
    presence: Readonly<Record<string, number>>,
    now: Date,
    answersView: AnswerDataView | undefined,
    cache: Map<string, Snapshot>,
  ): Snapshot {
    const identity = getSocketIdentity(socket);
    const isProjectorView =
      socketData(socket).view === 'projector' && identity.role === 'teacher';
    const key = isProjectorView
      ? 'projector'
      : identity.role === 'student'
        ? `student:${identity.groupId}`
        : identity.role;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const snapshot = isProjectorView
      ? createProjectorSnapshot(database, presence, now, answersView)
      : createSnapshot(database, identity, presence, now, answersView);
    cache.set(key, snapshot);
    return snapshot;
  }

  function sendSnapshot(socket: Socket): void {
    socket.emit(
      STATE_EVENT,
      snapshotForSocket(
        socket,
        getPresence(),
        new Date(),
        options.answersView?.(),
        new Map(),
      ),
    );
  }

  function emitSnapshotSafely(
    socket: Socket,
    createForSocket: () => Snapshot,
  ): void {
    try {
      socket.emit(STATE_EVENT, createForSocket());
    } catch {
      // 單一連線的 snapshot/emit 失敗不得中止迴圈，其他客戶端仍要在
      // 同一輪收到依其身分過濾的 state（FR-005、FR-021、FR-030）。
      // 只記錄固定事件類型，不記錄 snapshot、identity、DB 或例外內容。
      console.error(`Broadcast ${STATE_EVENT} failed.`);
    }
  }

  function broadcastState(): void {
    const now = new Date();
    const presence = getPresence();
    const answersView = options.answersView?.();
    // P2：這一輪的快照快取只活在本次廣播內；跨輪必須重建（資料已變）。
    const cache = new Map<string, Snapshot>();

    for (const socket of io.sockets.sockets.values()) {
      emitSnapshotSafely(socket, () =>
        snapshotForSocket(socket, presence, now, answersView, cache),
      );
    }
  }

  /**
   * 2026-11-22（D20，100 組）：**老師看板的廣播合併**。
   *
   * 老師看板是全場快照，100 組 × 20 題時每份約 600 KB；倒數歸零的瞬間
   * 全班同時送出，舊做法會送出「每筆作答一份看板」＝一輪 60 MB 的序列化
   * 與寫入，事件迴圈被塞滿，學生的 ACK 也跟著排隊（實測 100 組冷啟：
   * ACK p50 1.6 s、逾時 12%；50 組則是 p50 90 ms、逾時 0%）。
   *
   * 這裡改成：**同一個時間窗內只送一份最新看板**。時間窗
   * `TEACHER_BOARD_COALESCE_MS`（120 ms）遠小於契約要求的「2 秒內更新
   * 看板」，所以行為不變（老師仍會在 2 秒內看到順位），但一輪的看板
   * 廣播從 N 份降到約 N × 120ms 內的份數。
   *
   * 學生的 ACK 與自己組的快照**不受影響**（立即送出）。
   */
  function flushTeacherBoard(): void {
    teacherBoardTimer = null;
    try {
      const now = new Date();
      const presence = getPresence();
      const answersView = options.answersView?.();
      const cache = new Map<string, Snapshot>();

      for (const socket of io.sockets.sockets.values()) {
        // 投影檢視連線的身分也是老師，但它只收投影快照：不能混進看板廣播。
        if (socketData(socket).view === 'projector') {
          continue;
        }
        if (getSocketIdentity(socket).role !== 'teacher') {
          continue;
        }
        emitSnapshotSafely(socket, () =>
          snapshotForSocket(socket, presence, now, answersView, cache),
        );
      }
    } catch {
      // 伺服器可能已在計時器觸發前關閉（資料庫已關閉）：不得讓計時器的例外
      // 變成未處理的例外而中止行程。只記錄固定事件字串，不記錄資料或堆疊。
      console.error('Broadcast teacher board failed.');
    }
  }

  function scheduleTeacherBoard(): void {
    if (teacherBoardTimer !== null) {
      return;
    }
    teacherBoardTimer = setTimeout(flushTeacherBoard, TEACHER_BOARD_COALESCE_MS);
    // 沒有其他待辦時不因為這個計時器而延後行程結束。
    teacherBoardTimer.unref?.();
  }

  function broadcastSubmissionChanged(groupId: string): void {
    const now = new Date();
    const presence = getPresence();
    const answersView = options.answersView?.();
    const cache = new Map<string, Snapshot>();

    for (const socket of io.sockets.sockets.values()) {
      const identity = getSocketIdentity(socket);
      // 投影檢視不需要作答事件：推給它只會讓投影的 revision 隨每次作答跳動，
      // 等於用 revision 洩漏「全場作答次數與時機」（2026-11-21 資安審計實測：
      // 三題連續作答時投影收到 revision 7→8→9→10）。順帶也少一輪廣播成本。
      if (socketData(socket).view === 'projector') {
        continue;
      }
      // 老師看板改走合併廣播（見 flushTeacherBoard）。
      if (identity.role === 'teacher') {
        scheduleTeacherBoard();
        continue;
      }
      const receivesSubmissionChange =
        identity.role === 'student' && identity.groupId === groupId;
      if (!receivesSubmissionChange) {
        continue;
      }
      // 用 snapshotForSocket 而不是 createSnapshot：投影檢視的連線必須拿到
      // **投影快照**。用 createSnapshot 會送一般老師快照給投影頁，
      // 前端看到 role 變成 'teacher' 就跳回登入畫面（投影看板在學生送出答案
      // 時掉出看板），而且一般快照含作答資訊，等於把答案送到投影連線
      // （2026-11-19 review 時用截圖發現：projector-buzzing.png 顯示的是登入頁）。
      emitSnapshotSafely(socket, () =>
        snapshotForSocket(socket, presence, now, answersView, cache),
      );
    }
  }

  function addStudent(groupId: string): void {
    connectedStudents.set(groupId, (connectedStudents.get(groupId) ?? 0) + 1);
  }

  function removeStudent(groupId: string): void {
    const current = connectedStudents.get(groupId) ?? 0;
    if (current <= 1) {
      connectedStudents.delete(groupId);
    } else {
      connectedStudents.set(groupId, current - 1);
    }
  }

  io.on('connection', (socket) => {
    let identity = resolveSocketIdentity(socket, database);
    const hasAuthToken = tokenFromSocket(socket) !== undefined;

    if (identity.role === 'student' && !getGroupById(database, identity.groupId)) {
      socket.emit(SESSION_INVALID_EVENT, { code: 'GROUP_NOT_FOUND' });
      identity = { role: 'guest' };
    } else if (identity.role === 'guest' && hasAuthToken) {
      // 學生帶著已刪除的 session token 重連時，資料庫已無法分辨是重設或刪組；
      // 在第一份 state 前通知前端清除舊 token，避免每次重連都再送死 token。
      // 只看 auth.token：老師的 HttpOnly cookie 路徑不應收到學生失效通知。
      socket.emit(SESSION_INVALID_EVENT, { code: 'SESSION_EXPIRED' });
    }

    socketData(socket).identity = identity;
    socketData(socket).view = viewFromSocket(socket);

    if (identity.role === 'student') {
      addStudent(identity.groupId);
      // Presence changes must bump activity.revision before broadcasting;
      // clients ignore snapshots whose revision is not newer.
      recordPresenceChange(database);
      // Send this connection its first state and tell teacher connections that
      // its group came online.
      broadcastState();
    } else {
      // Guest and teacher connections do not alter presence; only send their
      // contract-required initial state.
      sendSnapshot(socket);
    }

    socket.on('disconnect', () => {
      const disconnectedIdentity = getSocketIdentity(socket);
      if (disconnectedIdentity.role === 'student') {
        removeStudent(disconnectedIdentity.groupId);
        recordPresenceChange(database);
        broadcastState();
      }
    });
  });

  /** 把某個學生的連線降為 guest：通知他、移除在線人數。 */
  function invalidateStudentSocket(
    socket: Socket,
    groupId: string,
    code: SessionInvalidPayload['code'],
  ): void {
    socket.emit(SESSION_INVALID_EVENT, { code });
    socketData(socket).identity = { role: 'guest' };
    removeStudent(groupId);
  }

  function invalidateGroup(groupId: string): void {
    for (const socket of io.sockets.sockets.values()) {
      const identity = getSocketIdentity(socket);
      if (identity.role === 'student' && identity.groupId === groupId) {
        invalidateStudentSocket(socket, groupId, 'GROUP_NOT_FOUND');
      }
    }
  }

  /** D2-1（2026-11-25）：活動重設 → 所有已連線的學生都回到選組頁。 */
  function invalidateAllStudents(): void {
    for (const socket of io.sockets.sockets.values()) {
      const identity = getSocketIdentity(socket);
      if (identity.role === 'student') {
        invalidateStudentSocket(socket, identity.groupId, 'ACTIVITY_RESET');
      }
    }
  }

  function demoteToGuest(socket: Socket): void {
    const identity = getSocketIdentity(socket);
    socketData(socket).identity = { role: 'guest' };
    if (identity.role === 'student') {
      removeStudent(identity.groupId);
    }
  }

  return {
    broadcastState,
    broadcastSubmissionChanged,
    getPresence,
    invalidateGroup,
    invalidateAllStudents,
    demoteToGuest,
    dispose: () => {
      if (teacherBoardTimer !== null) {
        clearTimeout(teacherBoardTimer);
        teacherBoardTimer = null;
      }
    },
  };
}
