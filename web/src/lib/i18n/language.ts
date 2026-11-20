import type { MessageKey, Messages } from './messages';

/** 支援的介面語言。 */
export type Language = 'zh-TW' | 'en';

export const LANGUAGE_STORAGE_KEY = 'classroom.language';

/**
 * 目前語言（模組層級）。
 *
 * 伺服器回來的錯誤訊息是在 `lib/api.ts`、`lib/socket.ts` 裡組出來的，那裡
 * 拿不到 React context，所以用這個模組層級的值讓它們也知道現在是英文版。
 */
let currentLanguage: Language = 'zh-TW';

export function getCurrentLanguage(): Language {
  return currentLanguage;
}

export function setCurrentLanguage(language: Language): void {
  currentLanguage = language;
}

/**
 * 判定一開始要用哪種語言：
 *
 * 1. 使用者（老師／學生）自己選過 → 用他選的（記在 localStorage）。
 * 2. 沒選過 → 看瀏覽器的語言清單：第一個 `en*` 用英文、第一個 `zh*` 用繁體中文。
 * 3. 都不是（例如日文）→ 繁體中文（這個系統本來就是繁中優先）。
 */
export function detectLanguage(
  stored: string | null = readStoredLanguage(),
  browserLanguages: readonly string[] = readBrowserLanguages(),
): Language {
  if (stored === 'zh-TW' || stored === 'en') {
    return stored;
  }
  for (const language of browserLanguages) {
    const normalized = language.toLowerCase();
    if (normalized.startsWith('en')) {
      return 'en';
    }
    if (normalized.startsWith('zh')) {
      return 'zh-TW';
    }
  }
  return 'zh-TW';
}

export function readStoredLanguage(): string | null {
  try {
    return globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY) ?? null;
  } catch {
    // 隱私模式或被封鎖時讀不到 → 當作沒選過。
    return null;
  }
}

export function storeLanguage(language: Language): void {
  try {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // 存不了就算了，這一頁仍然可以切換。
  }
}

function readBrowserLanguages(): readonly string[] {
  const navigatorLanguages = globalThis.navigator?.languages;
  if (Array.isArray(navigatorLanguages) && navigatorLanguages.length > 0) {
    return navigatorLanguages;
  }
  const single = globalThis.navigator?.language;
  return single === undefined ? [] : [single];
}

/**
 * 把 `{name}` 佔位符換成參數；沒給參數就留空字串（不顯示 `undefined`）。
 */
export function formatMessage(
  template: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return template.replace(/\{(\w+)\}/gu, (_match, key: string) => {
    const value = params[key];
    return value === undefined ? '' : String(value);
  });
}

/** 依語言取出訊息並代入參數。 */
export function translate(
  language: Language,
  messages: Messages,
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  return formatMessage(messages[key], params);
}
