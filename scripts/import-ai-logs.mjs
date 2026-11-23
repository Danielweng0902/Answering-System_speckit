#!/usr/bin/env node
/**
 * 匯入組員用其他工具整理好的 AI 對話紀錄，放進 `docs/ai-logs/`（繳交用）。
 *
 * 背景：constitution 要求「與 AI 代理的對話紀錄 MUST 保存，供繳交使用」。
 * 組員的測試與 review 對話也是專案開發過程的一部分，必須一併收錄 ——
 * 但那些對話不一定跑在 opencode 上（可能用 claude.ai 等），所以需要一支
 * 「匯入外部紀錄並套用同一套遮蔽規則」的工具。
 *
 * 遮蔽規則與 `export-ai-logs.mjs` 共用（`scripts/lib/redact.mjs`），
 * 兩邊行為一致，不會出現「一邊遮了、一邊沒遮」。
 *
 * 用法：
 *   node scripts/import-ai-logs.mjs <來源資料夾>
 *   node scripts/import-ai-logs.mjs <來源資料夾> --dry-run
 *
 * 來源資料夾裡的每個 .md 會被複製到 `docs/ai-logs/`，並套用遮蔽規則。
 * 已存在同名檔案時會覆蓋（並在輸出中提示）。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { redact } from './lib/redact.mjs';

const REPO_ROOT = process.cwd();
const OUT_DIR = join(REPO_ROOT, 'docs', 'ai-logs');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourceDir = args.find((arg) => !arg.startsWith('--'));

if (sourceDir === undefined) {
  console.error('用法：node scripts/import-ai-logs.mjs <來源資料夾> [--dry-run]');
  process.exit(1);
}
if (!existsSync(sourceDir)) {
  console.error(`找不到來源資料夾：${sourceDir}`);
  process.exit(1);
}

const files = readdirSync(sourceDir)
  .filter((name) => name.endsWith('.md'))
  .sort();

if (files.length === 0) {
  console.error(`${sourceDir} 裡沒有 .md 檔`);
  process.exit(1);
}

if (!dryRun) mkdirSync(OUT_DIR, { recursive: true });

let imported = 0;
let replaced = 0;
let totalBytes = 0;

for (const name of files) {
  const source = join(sourceDir, name);
  const target = join(OUT_DIR, name);
  const existed = existsSync(target);

  const original = readFileSync(source, 'utf8');
  const redacted = redact(original);

  if (!dryRun) writeFileSync(target, redacted, 'utf8');
  totalBytes += Buffer.byteLength(redacted, 'utf8');
  imported += 1;
  if (existed) replaced += 1;

  const changed = original === redacted ? '無需遮蔽' : '已套用遮蔽';
  console.log(`${existed ? '覆寫' : '新增'} ${name}（${changed}）`);
}

console.log(
  `\n${dryRun ? '（dry run）將' : '已'}匯入 ${imported} 個檔案` +
    `${replaced > 0 ? `（其中 ${replaced} 個覆寫了既有檔案）` : ''}` +
    `，共 ${(totalBytes / 1024).toFixed(0)} KB → ${OUT_DIR}`,
);
console.log('接著請跑：node scripts/scan-ai-log-secrets.mjs docs/ai-logs/*.md');
