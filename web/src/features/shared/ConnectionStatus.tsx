import type { ConnectionState } from '../../lib/useSnapshot';
import styles from './ConnectionStatus.module.css';

export type ConnectionStatusProps = {
  connectionState: ConnectionState;
};

/** 初始連線與斷線重連時都顯示全站共用的連線提示。 */
export function ConnectionStatus({ connectionState }: ConnectionStatusProps) {
  if (connectionState === 'connected') {
    return null;
  }

  return (
    <p className={styles.status} role="status">
      {connectionState === 'connecting' ? '連線中…' : '重新連線中…'}
    </p>
  );
}

export default ConnectionStatus;
