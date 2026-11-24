#!/usr/bin/env node
/**
 * 掃描對話紀錄裡的機敏資料（constitution：保存前 MUST 檢查不含機敏資料）。
 *
 * ⚠️ 掃描規則**直接引用** `scripts/lib/redact.mjs` 的遮蔽規則 —— 不要在這裡
 * 另寫一份。兩份實作各自演化會出現「掃描報了但其實沒問題」或反過來
 * 「沒報但真的沒遮乾淨」的落差（2026-11-23 就發生過：
 * 掃描器把 `SHEET_URL = "貼上你的試算表網址"` 這種說明文字報成機敏）。
 *
 * 所以掃描的語意是：**「實際套用遮蔽規則時，哪些地方會被改動」** ——
 * 報告出來就是「紀錄裡還沒被遮乾淨的東西」。
 *
 * 用法：node scripts/scan-ai-log-secrets.mjs <檔案|資料夾> [...]
 * 選項：--count-only（只印種類與數量，不印內容）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { KNOWN_TEST_VALUES, REDACTIONS, redactPaths } from './lib/redact.mjs';

/** 收集資料夾裡的 .md（遞迴一層就夠了）。 */
function collectMarkdown(target) {
  const info = statSync(target);
  if (info.isFile()) return target.endsWith('.md') ? [target] : [];
  return readdirSync(target)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(target, name));
}

/**
 * README 是我們自己寫的說明文件（裡面會出現「原始路徑 → 遮蔽後」的範例），
 * 不是對話紀錄 → 不掃描它。
 */
function isReadme(file) {
  return file.toLowerCase().endsWith('readme.md');
}

/**
 * 找出「會被遮蔽規則改動」的地方。
 *
 * 用與遮蔽器同一條 regex 與同一個 to() → 結果完全一致；
 * to() 回傳原樣的（例如環境變數名不像憑證）就跳過。
 */
function scan(text) {
  const findings = [];

  for (const { name, re, to } of REDACTIONS) {
    for (const match of text.matchAll(new RegExp(re.source, re.flags))) {
      const replaced = match[0].replace(new RegExp(re.source, re.flags), to);
      if (replaced === match[0]) continue; // 規則判定不用換（例如 SHEET_URL）
      findings.push({ kind: name, sample: match[0].slice(0, 70) });
    }
  }

  for (const value of KNOWN_TEST_VALUES) {
    let index = text.indexOf(value);
    while (index !== -1) {
      findings.push({ kind: '已知的測試密碼值（應換成佔位符）', sample: value });
      index = text.indexOf(value, index + value.length);
    }
  }

  if (redactPaths(text) !== text) {
    findings.push({ kind: '本機絕對路徑（應換成 <repo>／<home>）', sample: '（略）' });
  }

  return findings;
}

const args = process.argv.slice(2);
const countOnly = args.includes('--count-only');
const targets = args.filter((arg) => !arg.startsWith('--'));

if (targets.length === 0) {
  console.error('用法：node scripts/scan-ai-log-secrets.mjs <檔案|資料夾> [...] [--count-only]');
  process.exit(1);
}

const files = targets.flatMap(collectMarkdown).filter((file) => !isReadme(file));
if (files.length === 0) {
  console.error('沒有找到 .md 檔');
  process.exit(1);
}

let total = 0;
const all = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const findings = scan(text);
  total += findings.length;
  for (const finding of findings) {
    all.push({ file, ...finding });
  }
}

if (total === 0) {
  console.log(`✓ ${files.length} 個檔案：沒有會被遮蔽的機敏內容`);
} else {
  console.log(`⚠ ${files.length} 個檔案中掃到 ${total} 處需要處理：\n`);
  const byKind = new Map();
  for (const finding of all) {
    const list = byKind.get(finding.kind) ?? [];
    list.push(finding);
    byKind.set(finding.kind, list);
  }
  for (const [kind, list] of byKind) {
    console.log(`── ${kind}（${list.length} 處）`);
    if (!countOnly) {
      for (const finding of list.slice(0, 5)) {
        console.log(`   ${finding.file}: ${finding.sample}`);
      }
      if (list.length > 5) console.log(`   …另有 ${list.length - 5} 處`);
    }
    console.log();
  }
}

process.exitCode = total === 0 ? 0 : 1;
