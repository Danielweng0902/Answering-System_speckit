import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 老師端區塊樣式的回歸防呆（2026-11-19 review）。
 *
 * review 發現「匯出結果」「投影看板」兩個區塊的標題與按鈕**沒有**跟其他區塊
 * 一起調整（標題還是小的灰色、按鈕文字貼著框線），而且每個區塊都畫上下兩條線，
 * 區塊之間會出現兩條線（像「雙下巴」）。
 *
 * 這些都是純樣式問題、CI 不會紅，所以用讀 CSS 原始檔的方式守住。
 */

function readCss(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

/** 取出某個選擇器的規則內容。 */
function ruleBody(css: string, selector: string): string {
  const match = new RegExp(`(^|[,}\\s])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm').exec(
    css,
  );
  if (match === null) {
    throw new Error(`找不到選擇器 ${selector}`);
  }
  return match[2] ?? '';
}

/** 老師端每個「區塊」的選擇器 → 所在的 CSS module。 */
const TEACHER_SECTIONS: Array<{ path: string; selector: string }> = [
  {
    path: '../src/features/teacher/PhaseControl.module.css',
    selector: '.section',
  },
  {
    path: '../src/features/teacher/GroupManager.module.css',
    selector: '.section',
  },
  {
    path: '../src/features/teacher/QuestionImport.module.css',
    selector: '.section',
  },
  {
    path: '../src/features/teacher/QuestionList.module.css',
    selector: '.section',
  },
  { path: '../src/features/teacher/AnswerBoard.module.css', selector: '.board' },
  {
    path: '../src/features/teacher/TeacherPage.module.css',
    selector: '.exportSection',
  },
];

describe('老師端區塊樣式（design/DESIGN.md §5）', () => {
  it('「匯出結果」「投影看板」的標題和其他區塊一樣：黑色、大於內文', () => {
    const css = readCss('../src/features/teacher/TeacherPage.module.css');
    const title = ruleBody(css, '.exportTitle');

    expect(title).toContain('--font-size-large');
    expect(title).toContain('color: var(--color-ink)');
    expect(title).not.toContain('--color-ink-muted');
  });

  it('次要按鈕的留白與主要動作一致（文字不會貼著框線）', () => {
    const teacher = readCss('../src/features/teacher/TeacherPage.module.css');
    const phase = readCss('../src/features/teacher/PhaseControl.module.css');

    const exportButton = ruleBody(teacher, '.exportButton');
    const primaryButton = ruleBody(phase, '.button');

    const expected = 'padding: var(--space-3) var(--space-6);';
    expect(exportButton).toContain(expected);
    expect(primaryButton).toContain(expected);
  });

  it('區塊之間只留一條線：每個區塊只畫下框線', () => {
    for (const section of TEACHER_SECTIONS) {
      const body = ruleBody(readCss(section.path), section.selector);
      // 只允許 border-block-end（單線分隔）；border-block 會造成「雙下巴」。
      expect(body).not.toContain('border-block:');
      expect(body).toContain('border-block-end: var(--border-width-thin)');
    }
  });
});

/**
 * 組別管理的每列版面（2026-11-23）。
 *
 * 組數上限統一為 100 組（D20）後，「組別管理」佔老師端整頁高度的
 * 76%。原本每組一列是「名稱列 + 按鈕列」上下疊兩行（每列 103 px，
 * 整頁要捲 15 屏），改成同一列後每列 67 px（區塊 -34%）。
 *
 * 這是純樣式 invariant、CI 不會紅 —— 與本檔既有的守衛同一道理，
 * 用讀 CSS 原始檔的方式守住，避免日後有人改回 grid 而密度成果無聲消失。
 */
describe('組別管理每列的版面（design/DESIGN.md §5）', () => {
  const groupManagerCss = () => readCss('../src/features/teacher/GroupManager.module.css');

  /**
   * 取出某個選擇器的**最後一條**規則內容。
   *
   * `.actions` 在檔案內有兩條（共用規則 + 專屬覆寫），只取第一條會
   * 拿到沒有 `flex` 的共用規則，因此需要這個版本。
   */
  function lastRuleBody(css: string, selector: string): string {
    const pattern = new RegExp(`(^|[,}\\s])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'gm');
    let last: string | null = null;
    for (const match of css.matchAll(pattern)) {
      last = match[2] ?? '';
    }
    if (last === null) {
      throw new Error(`找不到選擇器 ${selector}`);
    }
    return last;
  }

  it('每組的名稱與按鈕在同一列（不是上下兩行）', () => {
    const group = ruleBody(groupManagerCss(), '.group');

    expect(group).toContain('display: flex');
    expect(group).toContain('justify-content: space-between');
    // 窄視窗時按鈕列可整列換行（降級），但不可被壓縮。
    expect(group).toContain('flex-wrap: wrap');
    expect(group).not.toContain('display: grid');
  });

  it('按鈕列不被壓縮，空間不足時整列換行靠右', () => {
    const actions = lastRuleBody(groupManagerCss(), '.actions');

    expect(actions).toContain('flex: 0 0 auto');
    expect(actions).toContain('margin-inline-start: auto');
  });

  it('改名中的表單獨佔一列，不跟組名擠在一起', () => {
    const renameForm = lastRuleBody(groupManagerCss(), '.renameForm');

    expect(renameForm).toContain('flex: 1 1 100%');
  });

  it('按鈕仍保留 DESIGN.md §5 規定的留白（不能為了密度拿掉）', () => {
    const button = ruleBody(groupManagerCss(), '.button');

    expect(button).toContain('padding: var(--space-3) var(--space-6);');
  });
});
