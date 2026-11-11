import type { Ack, TeacherSnapshot } from '@classroom/shared';
import { useId, useState, type FormEvent } from 'react';
import { sendCommand } from '../../lib/socket';
import styles from './GroupManager.module.css';

export type GroupManagerProps = {
  snapshot: TeacherSnapshot;
};

export function GroupManager({ snapshot }: GroupManagerProps) {
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
      const ack: Ack = await sendCommand('group:create', { name: newName });

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

  async function renameGroup(
    event: FormEvent<HTMLFormElement>,
    groupId: string,
  ): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setIsSending(true);

    try {
      const ack: Ack = await sendCommand('group:rename', {
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
    if (!window.confirm(`確定要刪除「${groupName}」嗎？`)) {
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
        組別管理
      </h2>

      {!isPreparing && (
        <p className={styles.explanation}>
          組別只能在準備中新增、改名或刪除。
        </p>
      )}
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
            新增組別名稱
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
        <button
          className={styles.button}
          type="submit"
          disabled={controlsDisabled}
        >
          新增組別
        </button>
      </form>

      {snapshot.groups.length === 0 ? (
        <p className={styles.empty}>尚未建立組別。</p>
      ) : (
        <ul className={styles.list} aria-label="組別清單">
          {snapshot.groups.map((group) => {
            const onlineCount = snapshot.presence[group.id] ?? 0;
            const isEditing = editingGroupId === group.id;

            return (
              <li className={styles.group} key={group.id}>
                <div className={styles.groupHeader}>
                  <strong>{group.name}</strong>
                  <span className={styles.presence}>
                    {onlineCount > 0 ? `在線 ${onlineCount} 人` : '離線'}
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
                        {`組別 ${group.name} 的新名稱`}
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
                    <button
                      className={styles.button}
                      type="submit"
                      disabled={controlsDisabled}
                    >
                      儲存
                    </button>
                    <button
                      className={styles.button}
                      type="button"
                      disabled={controlsDisabled}
                      onClick={cancelRename}
                    >
                      取消
                    </button>
                  </form>
                ) : (
                  <div className={styles.actions}>
                    <button
                      className={styles.button}
                      type="button"
                      disabled={controlsDisabled}
                      aria-label={`改名 ${group.name}`}
                      onClick={() => {
                        startRename(group.id, group.name);
                      }}
                    >
                      改名
                    </button>
                    <button
                      className={styles.button}
                      type="button"
                      disabled={controlsDisabled}
                      aria-label={`刪除 ${group.name}`}
                      onClick={() => {
                        void deleteGroup(group.id, group.name);
                      }}
                    >
                      刪除
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
