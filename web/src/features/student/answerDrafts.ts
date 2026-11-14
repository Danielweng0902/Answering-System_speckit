/**
 * 學生未送出草稿（003 research R7）。
 *
 * 草稿只存在學生裝置的 localStorage，不傳到伺服器。key 以活動識別與組別
 * 命名，讓 reset 或換題後的新 sessionId 能精準清掉本功能舊草稿，而不用
 * 影響其他功能或其他應用的資料。
 */
const DRAFT_NAMESPACE = 'classroom.buzz-in.drafts.';

export type AnswerDraftMap = Record<number, string[]>;

function storageKey(sessionId: string, groupId: string): string {
  return `${DRAFT_NAMESPACE}${sessionId}.${groupId}`;
}

function storage(): Storage {
  return window.localStorage;
}

function parseStoredDrafts(value: unknown): AnswerDraftMap {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const drafts: AnswerDraftMap = {};
  for (const [questionNumberText, answers] of Object.entries(value)) {
    const questionNumber = Number(questionNumberText);
    if (
      !Number.isInteger(questionNumber) ||
      questionNumber <= 0 ||
      !Array.isArray(answers) ||
      !answers.every((answer) => typeof answer === 'string')
    ) {
      continue;
    }
    drafts[questionNumber] = answers as string[];
  }
  return drafts;
}

export function readAnswerDrafts(
  sessionId: string,
  groupId: string,
): AnswerDraftMap {
  const stored = storage().getItem(storageKey(sessionId, groupId));
  if (stored === null) {
    return {};
  }

  try {
    return parseStoredDrafts(JSON.parse(stored));
  } catch {
    // 無法解析的草稿不送給使用者介面；原值由下一次變更覆蓋。
    return {};
  }
}

export function writeAnswerDrafts(
  sessionId: string,
  groupId: string,
  drafts: AnswerDraftMap,
): void {
  const key = storageKey(sessionId, groupId);
  if (Object.keys(drafts).length === 0) {
    storage().removeItem(key);
    return;
  }
  storage().setItem(key, JSON.stringify(drafts));
}

/**
 * 進入當次活動：刪除本功能所有舊 session 的草稿（保留同 session 其他組），
 * 再讀取目前組別的草稿。這是 sessionId 更換後 R7 要求的精準清理。
 */
export function activateDraftSession(
  sessionId: string,
  groupId: string,
): AnswerDraftMap {
  const currentSessionPrefix = `${DRAFT_NAMESPACE}${sessionId}.`;
  const currentStorage = storage();
  const staleKeys: string[] = [];

  for (let index = 0; index < currentStorage.length; index += 1) {
    const key = currentStorage.key(index);
    if (
      key !== null &&
      key.startsWith(DRAFT_NAMESPACE) &&
      !key.startsWith(currentSessionPrefix)
    ) {
      staleKeys.push(key);
    }
  }
  for (const key of staleKeys) {
    currentStorage.removeItem(key);
  }

  return readAnswerDrafts(sessionId, groupId);
}
