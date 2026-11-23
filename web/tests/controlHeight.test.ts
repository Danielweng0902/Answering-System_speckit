import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 表單控制項的統一規格（2026-11-23，設計負責人意見）。
 *
 * 為什麼讀 CSS 原始檔而不是測 DOM：這是純樣式 invariant，專案既有的
 * `teacherSectionStyle.test.ts` 與 `phaseColor.test.ts` 開頭就寫明了這點
 * （純樣式問題 CI 不會紅，所以用讀原始檔的方式守住）。
 *
 * 要守住的三件事：
 * 1. 輸入框與按鈕用同一個 `--control-height`，同一列才會自然對齊；
 * 2. 按鈕只留左右留白（上下由高度決定），不再各自用不同的 padding；
 * 3. 上傳檔案的原生按鈕也被套成次要按鈕的樣式。
 */

/** 這些按鈕是「表單控制項」，要統一高度與左右留白。 */
const CONTROL_BUTTONS = [
  '../src/features/student/AnswerArea.module.css',
  '../src/features/student/StudentPage.module.css',
  '../src/features/teacher/PhaseControl.module.css',
  '../src/features/teacher/QuestionImport.module.css',
  '../src/features/teacher/TeacherLogin.module.css',
  '../src/features/teacher/GroupManager.module.css',
];

/** 老師端頁首的匯出按鈕（class 名不同，但同樣是表單控制項）。 */
const EXPORT_BUTTON = {
  path: '../src/features/teacher/TeacherPage.module.css',
  selector: '.exportButton',
};

/** 這些輸入框與按鈕同列出現，要與按鈕同高。 */
const CONTROL_INPUTS = [
  '../src/features/teacher/PhaseControl.module.css',
  '../src/features/teacher/QuestionImport.module.css',
  '../src/features/teacher/TeacherLogin.module.css',
  '../src/features/teacher/GroupManager.module.css',
];

function readCss(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

/** 取出某個選擇器的規則內容（第一個符合的）。 */
function ruleBody(css: string, selector: string): string {
  const match = new RegExp(`(^|[,}\\s])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm').exec(
    css,
  );
  if (match === null) {
    throw new Error(`找不到選擇器 ${selector}`);
  }
  return match[2] ?? '';
}

describe('表單控制項的統一規格（--control-height）', () => {
  it('token 存在，且是 44px（constitution 要求的點擊目標最小高度）', () => {
    const tokens = readCss('../src/styles/tokens.css');

    expect(tokens).toContain('--control-height: 2.75rem;');
    expect(tokens).toContain('--control-padding-inline: var(--space-4);');
  });

  it('每個表單控制項的按鈕都用 --control-height，且只留左右留白', () => {
    for (const path of CONTROL_BUTTONS) {
      const body = ruleBody(readCss(path), '.button');

      expect(body, path).toContain('min-height: var(--control-height);');
      expect(body, path).toContain('padding: 0 var(--control-padding-inline);');
      // 不能再各自用不同的上下左右 padding（那是 2026-11-23 之前的樣子）。
      expect(body, path).not.toMatch(/padding:\s*var\(--space-\d+\)\s+var\(--space-\d+\)/);
      // 文字要在框內垂直置中。
      expect(body, path).toContain('align-items: center;');
    }
  });

  it('老師端頁首的匯出按鈕也走同一組規格', () => {
    const body = ruleBody(readCss(EXPORT_BUTTON.path), EXPORT_BUTTON.selector);

    expect(body).toContain('min-height: var(--control-height);');
    expect(body).toContain('padding: 0 var(--control-padding-inline);');
  });

  it('與按鈕同列的輸入框用同一個高度', () => {
    for (const path of CONTROL_INPUTS) {
      const body = ruleBody(readCss(path), '.input');

      expect(body, path).toContain('min-height: var(--control-height);');
      expect(body, path).not.toMatch(/padding:\s*var\(--space-2\)\s+var\(--space-3\)/);
    }
  });

  it('上傳檔案的原生按鈕套成次要按鈕樣式', () => {
    const css = readCss('../src/features/teacher/QuestionImport.module.css');
    const body = ruleBody(css, '.fileInput::file-selector-button');

    expect(body).toContain('min-height: var(--control-height);');
    expect(body).toContain('padding: 0 var(--control-padding-inline);');
    expect(body).toContain('border: var(--border-width-thin) solid var(--color-ink);');
  });

  it('學生端的組別清單維持原樣（它是清單列，不是表單控制項）', () => {
    // 組別清單每一列是「列表項」（只有下框線、滿寬），套固定高度會破壞
    // 「試卷上的組別清單」的樣子 —— 刻意不納入統一規格。
    const body = ruleBody(readCss('../src/features/student/GroupPicker.module.css'), '.button');

    expect(body).not.toContain('--control-height');
    expect(body).toContain('border-block-end');
  });

  it('語言切換維持小按鈕（DESIGN.md §5 明文：方角小按鈕、欄標大小）', () => {
    // 語言切換器在頁首右上角，是「工具列按鈕」不是表單控制項；
    // 套上 44px 會變成大按鈕，反而搶走主要動作的視線（DESIGN.md §5）。
    const css = readCss('../src/features/shared/LanguageSwitch.module.css');

    expect(css).not.toContain('--control-height');
    expect(css).toContain('font-size: var(--font-size-caption);');
  });
});
