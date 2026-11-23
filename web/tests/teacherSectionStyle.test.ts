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

    // 2026-11-23（設計負責人意見，DESIGN.md v1.2）：按鈕高度統一
    // --control-height，只留左右留白 → 主要與次要動作用同一組規格。
    const expected = 'padding: 0 var(--control-padding-inline);';
    expect(exportButton).toContain(expected);
    expect(primaryButton).toContain(expected);
    expect(primaryButton).toContain('min-height: var(--control-height);');
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
