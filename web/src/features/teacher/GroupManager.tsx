import { useI18n } from '../../lib/i18n/LanguageProvider';
import type { TeacherSnapshot } from '@classroom/shared';
import { useId, useState, type FormEvent } from 'react';
import { sendCommand } from '../../lib/socket';
import styles from './GroupManager.module.css';

export type GroupManagerProps = {
  snapshot: TeacherSnapshot;
};

export function GroupManager({ snapshot }: GroupManagerProps) {
  const { t } = useI18n();
  const newNameId = useId();
  const renameNameId = useId();
  const [newName, setNewName] = useState('');
  const [renameName, setRenameName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isPreparing = snapshot.phase === 'preparing';
  const controlsDisabled = !isPreparing || isSending;

  async function createGroup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setIsSending(true);

    try {
      const ack = await sendCommand('group:create', { name: newName });

      if (ack.ok) {
        setNewName('');
      } else {
        setErrorMessage(ack.error.message);
      }
    } finally {
      setIsSending(false);
    }
  }

  function startRename(groupId: string, currentName: string): void {
    setErrorMessage(null);
    setEditingGroupId(groupId);
    setRenameName(currentName);
  }

  function cancelRename(): void {
    setEditingGroupId(null);
    setRenameName('');
  }

  async function renameGroup(event: FormEvent<HTMLFormElement>, groupId: string): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setIsSending(true);

    try {
      const ack = await sendCommand('group:rename', {
        groupId,
        name: renameName,
      });

      if (ack.ok) {
        cancelRename();
      } else {
        setErrorMessage(ack.error.message);
      }
    } finally {
      setIsSending(false);
    }
  }

  async function deleteGroup(groupId: string, groupName: string): Promise<void> {
    if (!window.confirm(t('groups.deleteConfirm', { name: groupName }))) {
      return;
    }

    setErrorMessage(null);
    setIsSending(true);

    try {
      const ack = await sendCommand('group:delete', { groupId });

      if (!ack.ok) {
        setErrorMessage(ack.error.message);
      }
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="group-manager-title">
      <h2 id="group-manager-title" className={styles.title}>
        {t('groups.title')}
      </h2>

      {!isPreparing && <p className={styles.explanation}>{t('groups.locked')}</p>}
      {errorMessage !== null && (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      )}

      <form
        className={styles.form}
        onSubmit={(event) => {
          void createGroup(event);
        }}
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor={newNameId}>
            {t('groups.nameLabel')}
          </label>
          <input
            id={newNameId}
            className={styles.input}
            type="text"
            name="new-group-name"
            value={newName}
            disabled={controlsDisabled}
            onChange={(event) => {
              setNewName(event.target.value);
            }}
          />
        </div>
        <button className={styles.button} type="submit" disabled={controlsDisabled}>
          {t('groups.add')}
        </button>
      </form>

      {snapshot.groups.length === 0 ? (
        <p className={styles.empty}>{t('groups.empty')}</p>
      ) : (
        <ul className={styles.list} aria-label={t('groups.listLabel')}>
          {snapshot.groups.map((group) => {
            const onlineCount = snapshot.presence[group.id] ?? 0;
            const isEditing = editingGroupId === group.id;

            return (
              <li className={styles.group} key={group.id}>
                <div className={styles.groupHeader}>
                  <strong>{group.name}</strong>
                  <span
                    className={
                      onlineCount > 0
                        ? `${styles.presence} ${styles.presenceOnline}`
                        : styles.presence
                    }
                  >
                    {onlineCount > 0
                      ? t('groups.online', { count: onlineCount })
                      : t('groups.offline')}
                  </span>
                </div>

                {isEditing ? (
                  <form
                    className={styles.renameForm}
                    onSubmit={(event) => {
                      void renameGroup(event, group.id);
                    }}
                  >
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={renameNameId}>
                        {t('groups.renameLabel', { name: group.name })}
                      </label>
                      <input
                        id={renameNameId}
                        className={styles.input}
                        type="text"
                        name="rename-group-name"
                        value={renameName}
                        disabled={controlsDisabled}
                        onChange={(event) => {
                          setRenameName(event.target.value);
                        }}
                      />
                    </div>
                    <button className={styles.button} type="submit" disabled={controlsDisabled}>
                      {t('groups.save')}
                    </button>
                    <button
                      className={styles.button}
                      type="button"
                      disabled={controlsDisabled}
                      onClick={cancelRename}
                    >
                      {t('groups.cancel')}
                    </button>
                  </form>
                ) : (
                  <div className={styles.actions}>
                    <button
                      className={styles.button}
                      type="button"
                      disabled={controlsDisabled}
                      aria-label={t('groups.renameAria', { name: group.name })}
                      onClick={() => {
                        startRename(group.id, group.name);
                      }}
                    >
                      {t('groups.rename')}
                    </button>
                    <button
                      className={styles.button}
                      type="button"
                      disabled={controlsDisabled}
                      aria-label={t('groups.deleteAria', { name: group.name })}
                      onClick={() => {
                        void deleteGroup(group.id, group.name);
                      }}
                    >
                      {t('groups.delete')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default GroupManager;
