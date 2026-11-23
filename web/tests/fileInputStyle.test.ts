import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 檔案上傳的自製按鈕（2026-11-23，007 人工驗證）。
 *
 * 為什麼讀 CSS 原始檔而不是測 DOM：這是純樣式 invariant，專案既有的
 * `teacherSectionStyle.test.ts`、`phaseColor.test.ts`、`controlHeight.test.ts`
 * 開頭就寫明了這點（純樣式問題 CI 不會紅，所以用讀原始檔的方式守住）。
 *
 * 要守住三件事：
 * 1. 原生檔案元件是**視覺隱藏**而不是 `display: none`（後者會失去可聚焦性）；
 * 2. 隱藏的 input 被 Tab 聚焦時，焦點外框要顯示在自製按鈕上；
 * 3. 自製按鈕與其他次要按鈕同規格（`--control-height` ＋ 只留左右留白）。
 *
 * 註一：這裡用整份 CSS 的字串比對而不是逐條規則解析 —— 因為要檢查的其中
 * 一條是複合選擇器（`:focus-visible + ...`），規則解析反而會把選擇器切錯。
 *
 * 註二：CSS 路徑**必須當參數傳入**。Vite 會靜態改寫
 * `new URL('<字面量>', import.meta.url)`（當成 asset import → 變成 dev server 的
 * http:// 網址），`fileURLToPath` 就會失敗。傳變數 Vite 無法靜態分析，
 * 維持 file:// 協定（既有的 CSS 守衛都是這個寫法）。
 */
function readCss(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const css = readCss('../src/features/teacher/QuestionImport.module.css');

describe('檔案上傳的自製按鈕（007 人工驗證）', () => {
  it('原生檔案元件是視覺隱藏，而不是 display:none（否則失去可聚焦性）', () => {
    expect(css).toContain('.fileInputHidden {');
    expect(css).toMatch(/\.fileInputHidden \{[^}]*position: absolute;/);
    expect(css).toMatch(/\.fileInputHidden \{[^}]*clip-path: inset\(50%\);/);
    // display:none 會讓元素失去可聚焦性 → Tab 就到不了它。
    expect(css).not.toMatch(/\.fileInputHidden \{[^}]*display: none;/);
  });

  it('隱藏的 input 被 Tab 聚焦時，焦點外框落在自製按鈕上', () => {
    expect(css).toContain('.fileInputHidden:focus-visible + .filePicker .fileButton {');
    expect(css).toMatch(
      /\.fileInputHidden:focus-visible \+ \.filePicker \.fileButton \{[^}]*outline: var\(--focus-outline-width\) solid var\(--color-vermilion\);/,
    );
  });

  it('自製按鈕與其他次要按鈕同規格（--control-height ＋ 只留左右留白）', () => {
    expect(css).toMatch(/\.fileButton \{[^}]*min-height: var\(--control-height\);/);
    expect(css).toMatch(/\.fileButton \{[^}]*padding: 0 var\(--control-padding-inline\);/);
    expect(css).toMatch(
      /\.fileButton \{[^}]*border: var\(--border-width-thin\) solid var\(--color-ink\);/,
    );
    expect(css).toMatch(/\.fileButton \{[^}]*border-radius: 0;/);
  });

  it('原生 input 的舊樣式名不再留著（原生按鈕已經不會畫出來）', () => {
    expect(css).not.toMatch(/^\.fileInput \{/m);
    // PR #39 加的 ::file-selector-button 樣式化也一併移除（input 已隱藏）——
    // 註解裡提到它不算，要看的是有沒有「規則」。
    expect(css).not.toMatch(/::file-selector-button\s*\{/);
  });
});
