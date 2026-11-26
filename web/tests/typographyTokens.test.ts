import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 字級與密度的樣式守衛（2026-11-23）。
 *
 * 為什麼讀 CSS 原始檔而不是測 DOM：這裡要守的是「純樣式 invariant」——
 * 專案既有的 `teacherSectionStyle.test.ts` 與 `phaseColor.test.ts` 開頭
 * 就寫明了這點（純樣式問題 CI 不會紅，所以用讀原始檔的方式守住）。
 *
 * 這一次要守的三件事：
 * 1. 投影看板的答案／贏家組別用「投影專用」token，不會跟學生端互相牽動。
 * 2. 學生端輸入框是最大的可填元素（--font-size-input）。
 * 3. 窄螢幕（手機）media query 裡的輸入框**不會**又被壓回小字級 ——
 *    這正是 2026-11-23 實測發現的缺口（see docs/verification/web-typography-and-density.md）。
 */

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

/**
 * 取出某個 media query 區塊的內容。
 *
 * 用來檢查「窄螢幕」分支裡的規則 —— 這次踩到的坑就是主規則對了、
 * media query 裡又把它改回去。
 */
function mediaBlock(css: string, condition: string): string {
  const match = new RegExp(
    `@media\\s*\\(${condition.replace(/[()]/g, '\\$&')}\\)\\s*\\{`,
    'm',
  ).exec(css);
  if (match === null) {
    throw new Error(`找不到 @media (${condition})`);
  }
  const start = match.index + match[0].length;
  let depth = 1;
  let index = start;
  while (index < css.length && depth > 0) {
    const char = css[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    index += 1;
  }
  return css.slice(start, index - 1);
}

/**
 * 取出某個選擇器的**所有**規則內容。
 *
 * 為什麼不能只用上面的 ruleBody：像 StudentResults 的 `.answers`、`.mine`
 * 既是 margin 歸零群組的一員、又有自己的規則，第一個符合的規則會是
 * margin 那條，拿不到 font-family。
 */
function ruleBodies(css: string, selector: string): string[] {
  const pattern = new RegExp(`(^|[,}\\s])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'gm');
  const bodies: string[] = [];
  let match = pattern.exec(css);
  while (match !== null) {
    bodies.push(match[2] ?? '');
    match = pattern.exec(css);
  }
  return bodies;
}

/** 某個選擇器有沒有任何一條規則宣告 `font-family: <value>`。 */
function declaresFontFamily(css: string, selector: string, value: string): boolean {
  return ruleBodies(css, selector).some((body) => body.includes(`font-family: ${value}`));
}

const tokens = () => readCss('../src/styles/tokens.css');
const answerArea = () => readCss('../src/features/student/AnswerArea.module.css');
const studentResults = () => readCss('../src/features/student/StudentResults.module.css');
const answerBoard = () => readCss('../src/features/teacher/AnswerBoard.module.css');
const projector = () => readCss('../src/features/projector/ProjectorPage.module.css');

describe('字級 token（2026-11-23）', () => {
  it('投影答案與贏家組別用「投影專用」token，不跟學生端共用', () => {
    const css = tokens();

    // 投影答案 1.75rem = 28px、贏家組別 2rem = 32px（8 公尺要看得清）
    expect(css).toContain('--font-size-projector-answer: 1.75rem;');
    expect(css).toContain('--font-size-projector-winner: 2rem;');
  });

  it('學生端輸入框是獨立的級別（比題目文字大）', () => {
    const css = tokens();

    expect(css).toContain('--font-size-input: 1.5rem;');
    // 輸入框的級別必須大於題目文字（--font-size-question: 1.375rem）
    expect(css).toContain('--font-size-question: 1.375rem;');
  });

  it('投影頁的答案與贏家組別真的引用了投影專用 token', () => {
    const css = projector();

    expect(ruleBody(css, '.revealAnswers')).toContain(
      'font-size: var(--font-size-projector-answer)',
    );
    expect(ruleBody(css, '.revealWinner')).toContain(
      'font-size: var(--font-size-projector-winner)',
    );
  });
});

describe('學生端作答區的字級層級', () => {
  it('輸入框用 --font-size-input，題目文字用 --font-size-question', () => {
    const css = answerArea();

    expect(ruleBody(css, '.input')).toContain('font-size: var(--font-size-input)');
    expect(ruleBody(css, '.prompt')).toContain('font-size: var(--font-size-question)');
  });

  it('窄螢幕（手機）media query 裡，輸入框維持 --font-size-input', () => {
    // 2026-11-23 實測發現的缺口：media query 裡的 .input 把輸入框壓回
    // --font-size-large（18px），與 .prompt 的 18px 同級，
    // 等於這次調整在學生端真正使用的手機寬度下完全沒生效。
    const narrow = mediaBlock(answerArea(), 'max-width: 30rem');

    expect(ruleBody(narrow, '.input')).toContain('font-size: var(--font-size-input)');
    expect(ruleBody(narrow, '.input')).not.toContain('--font-size-large');
  });

  it('窄螢幕仍會收窄題目字級（避免水平溢出）', () => {
    const narrow = mediaBlock(answerArea(), 'max-width: 30rem');

    expect(ruleBody(narrow, '.prompt')).toContain('font-size: var(--font-size-large)');
  });
});

/**
 * 答案文字的字體（2026-11-26 答案字體可讀性修正）。
 *
 * 規則：**只有答案文字**（學生輸入、已送出的作答、結果區的答案、
 * 投影揭曉的答案）用 --font-family-base；題幹與標題維持
 * --font-family-display 的原設計不動。
 *
 * 為什麼要守：純樣式問題 CI 不會紅——字體改錯不會讓任何元件測試失敗，
 * 只有人眼在教室裡才看得出來（這是這次修正的起因）。
 */
describe('答案文字的字體（2026-11-26）', () => {
  it('作答輸入框與已送出的作答用 --font-family-base', () => {
    const css = answerArea();

    expect(declaresFontFamily(css, '.input', 'var(--font-family-base)')).toBe(true);
    expect(declaresFontFamily(css, '.input', 'var(--font-family-display)')).toBe(false);
    expect(declaresFontFamily(css, '.submitted', 'var(--font-family-base)')).toBe(true);
  });

  it('作答區的題幹與標題維持 --font-family-display', () => {
    const css = answerArea();

    expect(declaresFontFamily(css, '.prompt', 'var(--font-family-display)')).toBe(true);
    expect(declaresFontFamily(css, '.title', 'var(--font-family-display)')).toBe(true);
  });

  it('結果區的答案文字用 --font-family-base', () => {
    const css = studentResults();

    expect(declaresFontFamily(css, '.answers', 'var(--font-family-base)')).toBe(true);
    expect(declaresFontFamily(css, '.answers', 'var(--font-family-display)')).toBe(false);
    expect(declaresFontFamily(css, '.mine', 'var(--font-family-base)')).toBe(true);
  });

  it('結果區的題幹與標題維持 --font-family-display', () => {
    const css = studentResults();

    expect(declaresFontFamily(css, '.prompt', 'var(--font-family-display)')).toBe(true);
    expect(declaresFontFamily(css, '.title', 'var(--font-family-display)')).toBe(true);
  });

  it('老師看板儲存格裡的答案文字用 --font-family-base', () => {
    const css = answerBoard();

    expect(declaresFontFamily(css, '.cell', 'var(--font-family-base)')).toBe(true);
  });

  it('投影揭曉的答案用 --font-family-base，勝出組別名維持 display', () => {
    const css = projector();

    // 這裡原本誤用 --font-family-display（2026-11-26 修正）。
    expect(declaresFontFamily(css, '.revealAnswers', 'var(--font-family-base)')).toBe(true);
    expect(declaresFontFamily(css, '.revealAnswers', 'var(--font-family-display)')).toBe(false);
    // 勝出組別名不是答案文字，維持原設計。
    expect(declaresFontFamily(css, '.revealWinner', 'var(--font-family-display)')).toBe(true);
  });
});
