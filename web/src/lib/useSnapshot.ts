import {
  SESSION_INVALID_EVENT,
  STATE_EVENT,
  type SessionInvalidPayload,
  type Snapshot,
} from '@classroom/shared';
import { useEffect, useRef, useState } from 'react';
import { clearToken } from './session';
import { connectSocket, getSocket } from './socket';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting';

export type UseSnapshotResult = {
  /** 目前接受過的最新快照；尚未收到快照時為 null。 */
  snapshot: Snapshot | null;
  /** 是否收到 session:invalid；收到時 token 已經被清除。 */
  sessionInvalid: boolean;
  /** session:invalid 的原始內容，供呼叫者顯示對應訊息。 */
  sessionInvalidPayload: SessionInvalidPayload | null;
  /**
   * 目前 Socket.IO 進程；hook 一律回傳。屬性保留為可選，避免既有
   * 直接組合 snapshot 三個原欄位的畫面測試或 mock 被迫新增狀態。
   */
  connectionState?: ConnectionState;
};

let cachedSnapshot: Snapshot | null = null;

/** 訂閱伺服器快照。只接受 revision 比目前接受值更新的完整快照。 */
export function useSnapshot(): UseSnapshotResult {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(cachedSnapshot);
  const [sessionInvalidPayload, setSessionInvalidPayload] =
    useState<SessionInvalidPayload | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    () => (getSocket().connected ? 'connected' : 'connecting'),
  );
  const latestRevisionRef = useRef(cachedSnapshot?.revision ?? -1);
  const latestRoleRef = useRef(cachedSnapshot?.role ?? null);

  useEffect(() => {
    const socket = getSocket();

    const handleState = (nextSnapshot: Snapshot): void => {
      // 同一連線上身分改變（例如學生離開組別降級為 guest）時，新身分的
      // revision 可能小於等於最後接受的學生快照；與重新連線同一原則，
      // role 變換時重設比較基準並接受。相同 role 內維持單調規則。
      const roleChanged = nextSnapshot.role !== latestRoleRef.current;
      if (!roleChanged && nextSnapshot.revision <= latestRevisionRef.current) {
        return;
      }

      latestRevisionRef.current = nextSnapshot.revision;
      latestRoleRef.current = nextSnapshot.role;
      cachedSnapshot = nextSnapshot;
      setSnapshot(nextSnapshot);
      // 重新選組成功後才清除「組別不存在」提示；以訪客重連時保留，讓學生看得到原因。
      if (nextSnapshot.role === 'student') {
        setSessionInvalidPayload(null);
      }
    };

    const handleSessionInvalid = (payload: SessionInvalidPayload): void => {
      clearToken();
      connectSocket(null);
      setSessionInvalidPayload(payload);
    };

    // 每次（重新）連線，伺服器都會立即送出依新身分產生的完整快照；
    // 身分改變時 revision 可能不變，所以新連線要重設比較基準。
    const handleConnect = (): void => {
      latestRevisionRef.current = -1;
      latestRoleRef.current = null;
      setConnectionState('connected');
    };

    const handleDisconnect = (): void => {
      setConnectionState('reconnecting');
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on(STATE_EVENT, handleState);
    socket.on(SESSION_INVALID_EVENT, handleSessionInvalid);
    connectSocket();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off(STATE_EVENT, handleState);
      socket.off(SESSION_INVALID_EVENT, handleSessionInvalid);
    };
  }, []);

  return {
    snapshot,
    sessionInvalid: sessionInvalidPayload !== null,
    sessionInvalidPayload,
    connectionState,
  };
}
