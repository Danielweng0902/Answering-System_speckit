import {
  SESSION_INVALID_EVENT,
  STATE_EVENT,
  type SessionInvalidPayload,
  type Snapshot,
} from '@classroom/shared';
import { useEffect, useRef, useState } from 'react';
import { clearToken } from './session';
import { connectSocket, getSocket } from './socket';

export type UseSnapshotResult = {
  /** 目前接受過的最新快照；尚未收到快照時為 null。 */
  snapshot: Snapshot | null;
  /** 是否收到 session:invalid；收到時 token 已經被清除。 */
  sessionInvalid: boolean;
  /** session:invalid 的原始內容，供呼叫者顯示對應訊息。 */
  sessionInvalidPayload: SessionInvalidPayload | null;
};

let cachedSnapshot: Snapshot | null = null;

/** 訂閱伺服器快照。只接受 revision 比目前接受值更新的完整快照。 */
export function useSnapshot(): UseSnapshotResult {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(cachedSnapshot);
  const [sessionInvalidPayload, setSessionInvalidPayload] =
    useState<SessionInvalidPayload | null>(null);
  const latestRevisionRef = useRef(cachedSnapshot?.revision ?? -1);

  useEffect(() => {
    const socket = getSocket();

    const handleState = (nextSnapshot: Snapshot): void => {
      if (nextSnapshot.revision <= latestRevisionRef.current) {
        return;
      }

      latestRevisionRef.current = nextSnapshot.revision;
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
    };

    socket.on('connect', handleConnect);
    socket.on(STATE_EVENT, handleState);
    socket.on(SESSION_INVALID_EVENT, handleSessionInvalid);
    connectSocket();

    return () => {
      socket.off('connect', handleConnect);
      socket.off(STATE_EVENT, handleState);
      socket.off(SESSION_INVALID_EVENT, handleSessionInvalid);
    };
  }, []);

  return {
    snapshot,
    sessionInvalid: sessionInvalidPayload !== null,
    sessionInvalidPayload,
  };
}
