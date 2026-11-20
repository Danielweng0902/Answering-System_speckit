import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { MESSAGES, type MessageKey } from './messages';
import {
  detectLanguage,
  setCurrentLanguage,
  storeLanguage,
  type Language,
} from './language';

export type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  /** 取訊息並代入 `{name}` 佔位符。 */
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
};

/**
 * 沒有 Provider 時的預設值：繁體中文。
 *
 * 這讓單獨渲染元件的測試不必到處包 Provider；正式 App 一定有
 * `LanguageProvider`（`app/App.tsx`）。
 */
const DEFAULT_CONTEXT: I18nContextValue = {
  language: 'zh-TW',
  setLanguage: () => {
    // 沒有 Provider 時不切換語言。
  },
  t: (key, params) =>
    MESSAGES['zh-TW'][key].replace(/\{(\w+)\}/gu, (_match, name: string) => {
      const value = params?.[name];
      return value === undefined ? '' : String(value);
    }),
};

const I18nContext = createContext<I18nContextValue>(DEFAULT_CONTEXT);

/**
 * 語言提供者：預設依使用者的系統語言，之後用右上角的切換器改，
 * 選擇會記在 localStorage（換頁、重新整理都保留）。
 */
export function LanguageProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  /** 測試用：直接指定一開始的語言。 */
  initialLanguage?: Language;
}) {
  const [language, setLanguageState] = useState<Language>(
    () => initialLanguage ?? detectLanguage(),
  );

  useEffect(() => {
    setCurrentLanguage(language);
  }, [language]);

  /**
   * WCAG 3.1.1（Language of Page）：頁面語言改變時 `<html lang>` 也要跟著改，
   * 否則螢幕閱讀器會用中文發音規則念英文（2026-11-19 review）。
   * 用 useLayoutEffect 是為了在瀏覽器繪製前就更新，不會有一瞬間用錯語言。
   */
  useLayoutEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    storeLanguage(next);
  }, []);

  // 同一個瀏覽器開了多個分頁時，切換語言會一起跟著變。
  useEffect(() => {
    const handleStorage = (event: StorageEvent): void => {
      if (event.key !== 'classroom.language') {
        return;
      }
      if (event.newValue === 'zh-TW' || event.newValue === 'en') {
        setLanguageState(event.newValue);
      }
    };
    globalThis.addEventListener?.('storage', handleStorage);
    return () => {
      globalThis.removeEventListener?.('storage', handleStorage);
    };
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, params) => {
        const template = MESSAGES[language][key];
        return template.replace(/\{(\w+)\}/gu, (_match, name: string) => {
          const value = params?.[name];
          return value === undefined ? '' : String(value);
        });
      },
    }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** 取得語言與翻譯函式。 */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
