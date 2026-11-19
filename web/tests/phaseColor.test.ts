import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 階段顏色不能被各畫面的本地 class 蓋掉（2026-11-19 review）。
 *
 * 共用的階段色（`web/src/features/shared/phaseStyle.module.css`）與各畫面的
 * 本地 class 同樣是「單一 class 選擇器」，**誰在 bundle 裡後面誰贏**。
 * 所以本地 class 只能排版，顏色一律交給共用規則；CI 只跑單元測試不會發現
 * 覆蓋問題（要真的看畫面才知道），這裡用讀 CSS 原始檔的方式守住。
 */

function readCss(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

/** 取出某個選擇器的規則內容。 */
function ruleBody(css: string, selector: string): string {
  const match = new RegExp(
    `(^|[,}\\s])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`,
    'm',
  ).exec(css);
  if (match === null) {
    throw new Error(`找不到選擇器 ${selector}`);
  }
  return match[2] ?? '';
}

const PHASE_CLASSES = ['preparing', 'open', 'closed'] as const;

describe('階段顏色（design/DESIGN.md §3 階段對照表）', () => {
  it('共用規則定義三個階段的語意色', () => {
    const css = readCss('../src/features/shared/phaseStyle.module.css');

    expect(ruleBody(css, '.preparing')).toContain('--phase-preparing');
    expect(ruleBody(css, '.open')).toContain('--phase-open');
    expect(ruleBody(css, '.closed')).toContain('--phase-closed');
  });

  it('token 的階段色就是墨灰／朱紅／藍', () => {
    const tokens = readCss('../src/styles/tokens.css');

    expect(tokens).toContain('--phase-preparing: var(--color-ink-muted)');
    expect(tokens).toContain('--phase-open: var(--color-vermilion)');
    expect(tokens).toContain('--phase-closed: var(--color-indigo)');
  });

  it('老師端（PhaseControl）的階段 class 不設定 color', () => {
    const css = readCss('../src/features/teacher/PhaseControl.module.css');

    // .status 只留排版；一旦在這裡設色，就會蓋掉共用的階段色。
    expect(ruleBody(css, '.status')).not.toContain('color:');
  });

  it('學生端的階段 class 不設定 color，但組別那行保留墨灰', () => {
    const css = readCss('../src/features/student/StudentPage.module.css');

    expect(ruleBody(css, '.phaseStatus')).not.toContain('color:');
    expect(ruleBody(css, '.groupStatus')).toContain('--color-ink-muted');
  });

  it('投影看板的標題也不設定 color', () => {
    const css = readCss('../src/features/projector/ProjectorPage.module.css');

    expect(ruleBody(css, '.title')).not.toContain('color:');
  });

  it('三個畫面的階段 class 都來自共用的 phaseStyle', () => {
    const shared = readCss('../src/features/shared/phaseStyle.module.css');
    for (const phaseClass of PHASE_CLASSES) {
      expect(shared).toContain(`.${phaseClass}`);
    }

    // 各畫面的模組不自己定義階段色（避免出現第二套來源）。
    for (const path of [
      '../src/features/teacher/PhaseControl.module.css',
      '../src/features/student/StudentPage.module.css',
      '../src/features/projector/ProjectorPage.module.css',
    ]) {
      const css = readCss(path);
      expect(css).not.toContain('--phase-open');
      expect(css).not.toContain('--phase-closed');
      expect(css).not.toContain('--phase-preparing');
    }
  });
});
