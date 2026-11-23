#!/usr/bin/env node
/**
 * 掃描 opencode session 匯出檔裡可能含機敏資料的地方。
 *
 * 用途：constitution 要求「與 AI 代理的對話紀錄 MUST 保存，供繳交使用；
 * 保存前 MUST 檢查不含機敏資料」。這支工具是那個「檢查」步驟。
 *
 * 用法：node scripts/scan-ai-log-secrets.mjs <匯出檔.json> [...]
 */
import { readFileSync } from 'node:fs';

/** 機敏資料的樣式。每一項都附「為什麼算機敏」。 */
const PATTERNS = [
  { name: '環境變數指派（可能含密碼）', re: /\b[A-Z][A-Z0-9_]{2,}\s*=\s*['"][^'"\s]{4,}['"]/g },
  {
    name: '密碼／token 關鍵字後的值',
    re: /(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*['"][^'"\s]{4,}['"]/gi,
  },
  { name: '看起來像 Bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
  { name: 'Google 服務帳號私鑰', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    name: 'JWT（三段 base64）',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
];

/** 常見的「測試用」值 —— 不是真的機敏，但匯出前應該被換掉。 */
const KNOWN_TEST_VALUES = [
  'local-shot-pw-2026',
  'token-demo-pw-2026',
  'teacher-demo-pw',
  'demo-pw',
  'test-password',
  'e2e-teacher-password',
];

/** 已知的假憑證（測試 fixture 用的，無害）。 */
const KNOWN_FAKE = ['-----BEGIN PRIVATE KEY-----\\nMIIEv', 'test-private-key', 'fake-private-key'];

function scan(text, label) {
  const findings = [];
  for (const { name, re } of PATTERNS) {
    const matches = text.match(re);
    if (matches === null) continue;
    for (const raw of matches) {
      if (KNOWN_FAKE.some((fake) => raw.includes(fake))) continue;
      // 已經被換成佔位符的值不算問題（否則無法驗證「替換已完成」）
      if (raw.includes('<redacted')) continue;
      findings.push({ label, kind: name, sample: raw.slice(0, 70) });
    }
  }
  for (const value of KNOWN_TEST_VALUES) {
    let index = text.indexOf(value);
    while (index !== -1) {
      findings.push({ label, kind: '已知的測試密碼值（應換成佔位符）', sample: value });
      index = text.indexOf(value, index + value.length);
    }
  }
  return findings;
}

let total = 0;
const all = [];
/** 只印種類與數量，不印實際內容（避免把真實機敏資料印進 log）。 */
const countOnly = process.argv.includes('--count-only');
const files = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const findings = scan(text, file);
  total += findings.length;
  all.push(...findings);
}

if (total === 0) {
  console.log('✓ 沒掃到機敏資料樣式');
} else {
  console.log(`⚠ 掃到 ${total} 處需要處理：\n`);
  const byKind = new Map();
  for (const f of all) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
  }
  for (const [kind, list] of byKind) {
    console.log(`── ${kind}（${list.length} 處）`);
    if (!countOnly) {
      for (const f of list.slice(0, 5)) {
        console.log(`   ${f.label}: ${f.sample}`);
      }
      if (list.length > 5) console.log(`   …另有 ${list.length - 5} 處`);
    }
    console.log();
  }
}
process.exitCode = total === 0 ? 0 : 1;
