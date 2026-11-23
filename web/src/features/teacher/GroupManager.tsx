import { useI18n } from '../../lib/i18n/LanguageProvider';
import type { TeacherSnapshot } from '@classroom/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
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

  /*
   * 2026-11-23（issue #31）：改名時的鍵盤焦點。
   *
   * 原本點「改名」後，含被聚焦按鈕的 `.actions` 會被卸載、改名表單掛上，
   * 瀏覽器因此把焦點掉回 `<body>` —— 鍵盤使用者接下來按 Tab 會從頁首重新
   * 開始，螢幕閱讀器使用者也會突然失去上下文。
   *
   * 這裡改成：
   * 1. 進入改名 → 焦點移到改名輸入框並選取原文字（可直接改字）；
   * 2. 取消或存檔成功 → 焦點回到剛才那一列的「改名」按鈕，位置不跳走。
   */
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  // 要把焦點還給哪一組的「改名」按鈕。用 state（不是 ref）→ render 期間可以讀它
  // 來決定按鈕要不要掛 ref；由 startRename 清掉，所以不需要在 effect 裡 setState。
  const [restoreFocusToGroupId, setRestoreFocusToGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (editingGroupId !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
      return;
    }
    if (restoreFocusToGroupId !== null) {
      // 取消或存檔後，該列的「改名」按鈕已重新掛上 → 把焦點還回去。
      renameButtonRef.current?.focus();
    }
  }, [editingGroupId, restoreFocusToGroupId]);

  const isPreparing = snapshot.phase === 'preparing';
  /**
   * 送出期間（isSending）只用 readOnly、不用 disabled。
   *
   * 2026-11-23 review（Philip 在 Windows + Chrome 實測）：**真實瀏覽器在已聚焦的
   * 元素變成 disabled 時，會把焦點移到 `<body>`**。所以送出期間把輸入框 disabled
   * 的話，回覆失敗、輸入框恢復可用時，焦點已經掉了，使用者按 Tab 也回不到輸入框。
   *
   * readOnly 仍然不能修改內容，但不會失去焦點 → 失敗後可以直接繼續改。
   * （jsdom 不會在 disabled 時移走焦點，所以這條只有真實瀏覽器才測得到。）
   */
  const controlsDisabled = !isPreparing || isSending;
  /** 送出期間：輸入框改成 readOnly（保住焦點），按鈕維持 disabled。 */
  const inputReadOnly = isPreparing && isSending;

  const newNameInputRef = useRef<HTMLInputElement>(null);

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
        // 失敗時把焦點放回輸入框，使用者可以直接改（2026-11-23 review）。
        newNameInputRef.current?.focus();
      }
    } finally {
      setIsSending(false);
    }
  }

  function startRename(groupId: string, currentName: string): void {
    setErrorMessage(null);
    setEditingGroupId(groupId);
    setRenameName(currentName);
    // 這次是「進去改名」，不是「從改名出來」→ 不還原焦點到按鈕。
    setRestoreFocusToGroupId(null);
  }

  /**
   * 結束改名。
   * @param restoreFocus 取消或存檔成功時，把焦點還回該列的「改名」按鈕。
   */
  function cancelRename(restoreFocus = false): void {
    if (restoreFocus && editingGroupId !== null) {
      setRestoreFocusToGroupId(editingGroupId);
    }
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
        // 存檔成功 → 焦點回到「改名」按鈕（按鈕此時才重新出現）。
        cancelRename(true);
      } else {
        setErrorMessage(ack.error.message);
        // 失敗時把焦點放回輸入框，使用者可以直接繼續改（2026-11-23 review）。
        renameInputRef.current?.focus();
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
            ref={newNameInputRef}
            className={styles.input}
            type="text"
            name="new-group-name"
            value={newName}
            readOnly={inputReadOnly}
            disabled={!isPreparing}
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
                        ref={renameInputRef}
                        className={styles.input}
                        type="text"
                        name="rename-group-name"
                        value={renameName}
                        readOnly={inputReadOnly}
                        disabled={!isPreparing}
                        onChange={(event) => {
                          setRenameName(event.target.value);
                        }}
                        onKeyDown={(event) => {
                          // Esc 取消改名（2026-11-23 review 的建議）。
                          // 焦點同樣還給「改名」按鈕，與按「取消」一致。
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelRename(true);
                          }
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
                      onClick={() => {
                        // 取消 → 焦點還回剛才那一列的「改名」按鈕（issue #31）。
                        cancelRename(true);
                      }}
                    >
                      {t('groups.cancel')}
                    </button>
                  </form>
                ) : (
                  <div className={styles.actions}>
                    <button
                      className={styles.button}
                      type="button"
                      // 只有「剛才正在改名的那一組」掛 ref —— 取消或存檔後
                      // 焦點要還回這一列的「改名」按鈕（issue #31）。
                      ref={group.id === restoreFocusToGroupId ? renameButtonRef : undefined}
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
