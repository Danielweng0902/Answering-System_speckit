import { useI18n } from '../../lib/i18n/LanguageProvider';
import type { ConnectionState } from '../../lib/useSnapshot';
import styles from './ConnectionStatus.module.css';

export type ConnectionStatusProps = {
  connectionState: ConnectionState;
};

/** 初始連線與斷線重連時都顯示全站共用的連線提示。 */
export function ConnectionStatus({ connectionState }: ConnectionStatusProps) {
  const { t } = useI18n();

  if (connectionState === 'connected') {
    return null;
  }

  return (
    <p className={styles.status} role="status">
      {connectionState === 'connecting'
        ? t('connection.connecting')
        : t('connection.reconnecting')}
    </p>
  );
}

export default ConnectionStatus;
