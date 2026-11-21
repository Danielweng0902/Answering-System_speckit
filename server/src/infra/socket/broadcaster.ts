import type { DatabaseSync } from 'node:sqlite';
import type { Server, Socket } from 'socket.io';
import {
  SESSION_INVALID_EVENT,
  STATE_EVENT,
  type Snapshot,
} from '@classroom/shared';
import type { AccessIdentity } from '../../app/access.js';
import { resolveIdentity } from '../../app/access.js';
import { recordPresenceChange } from '../../app/presence.js';
import type { AnswerDataView } from '../../app/answerProjections.js';
import { createProjectorSnapshot, createSnapshot } from '../../app/snapshot.js';
import { getGroupById, listGroups } from '../db/groupRepo.js';

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
   * Turn this connection into a guest after a successful student:leave and
   * remove it from the in-memory presence counts. Stateless data changes are
   * owned by the command use case.
   */
  demoteToGuest: (socket: Socket) => void;
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

export function createSocketBroadcaster(
  io: Server,
  database: DatabaseSync,
  options: StateBroadcasterOptions = {},
): StateBroadcaster {
  const connectedStudents = new Map<string, number>();

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
      const receivesSubmissionChange =
        identity.role === 'teacher' ||
        (identity.role === 'student' && identity.groupId === groupId);
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
    let identity = resolveIdentity(database, tokenFromSocket(socket));

    if (identity.role === 'student' && !getGroupById(database, identity.groupId)) {
      socket.emit(SESSION_INVALID_EVENT, { code: 'GROUP_NOT_FOUND' });
      identity = { role: 'guest' };
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

  function invalidateGroup(groupId: string): void {
    for (const socket of io.sockets.sockets.values()) {
      const identity = getSocketIdentity(socket);
      if (identity.role === 'student' && identity.groupId === groupId) {
        socket.emit(SESSION_INVALID_EVENT, { code: 'GROUP_NOT_FOUND' });
        socketData(socket).identity = { role: 'guest' };
        removeStudent(groupId);
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
    demoteToGuest,
  };
}
