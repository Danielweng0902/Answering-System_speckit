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
import { createSnapshot } from '../../app/snapshot.js';
import { getGroupById, listGroups } from '../db/groupRepo.js';

export type SocketDataWithIdentity = {
  identity?: AccessIdentity;
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

export function createSocketBroadcaster(
  io: Server,
  database: DatabaseSync,
): StateBroadcaster {
  const connectedStudents = new Map<string, number>();

  function getPresence(): Record<string, number> {
    const presence: Record<string, number> = {};
    for (const group of listGroups(database)) {
      presence[group.id] = connectedStudents.get(group.id) ?? 0;
    }
    return presence;
  }

  function sendSnapshot(socket: Socket): void {
    const snapshot: Snapshot = createSnapshot(
      database,
      getSocketIdentity(socket),
      getPresence(),
    );
    socket.emit(STATE_EVENT, snapshot);
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

    for (const socket of io.sockets.sockets.values()) {
      emitSnapshotSafely(socket, () =>
        createSnapshot(
          database,
          getSocketIdentity(socket),
          presence,
          now,
        ),
      );
    }
  }

  function broadcastSubmissionChanged(groupId: string): void {
    const now = new Date();
    const presence = getPresence();

    for (const socket of io.sockets.sockets.values()) {
      const identity = getSocketIdentity(socket);
      const receivesSubmissionChange =
        identity.role === 'teacher' ||
        (identity.role === 'student' && identity.groupId === groupId);
      if (!receivesSubmissionChange) {
        continue;
      }
      emitSnapshotSafely(socket, () =>
        createSnapshot(database, identity, presence, now),
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
