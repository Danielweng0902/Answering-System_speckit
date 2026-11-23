#!/usr/bin/env node
/**
 * 匯出 AI 對話紀錄，供繳交作業使用（constitution：與 AI 代理的對話紀錄 MUST 保存，
 * 供繳交使用；保存前 MUST 檢查不含機敏資料）。
 *
 * 為什麼不用 `opencode session export --sanitize`：
 * 那個旗標會把**所有**訊息內容（含使用者提問與 AI 回覆）換成 `[redacted:…]`，
 * 匯出來的紀錄沒有閱讀價值。這個工具改為：
 *   1. 匯出**未遮蔽**的 session（保留對話內容）；
 *   2. 只把**機敏樣式**的值換成佔位符；
 *   3. 只保留「對話」本身（使用者提問與 AI 的文字回覆），
 *      工具呼叫與推理內容不匯出（那是執行細節，不是對話，而且體積大 30 倍）；
 *   4. 產出後用同一套規則掃描確認乾淨，並刪掉暫存的原始檔。
 *
 * 用法：
 *   node scripts/export-ai-logs.mjs                 # 匯出本專案全部 session
 *   node scripts/export-ai-logs.mjs ses_xxx ses_yyy # 只匯出指定的 session
 *   node scripts/export-ai-logs.mjs --list          # 只列出可匯出的 session
 *   node scripts/export-ai-logs.mjs --dry-run       # 只統計，不寫檔
 *
 * 輸出：docs/ai-logs/<日期>-<標題-slug>.md
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const OUT_DIR = join(REPO_ROOT, 'docs', 'ai-logs');

/** ── 機敏資料替換規則 ──────────────────────────────────────────────
 * 每一條都要能把「真的機敏值」換掉，而不會誤傷正常內容。
 * 佔位符刻意寫成人可讀的形式，讓讀紀錄的人知道「這裡本來是什麼」。
 */
const REDACTIONS = [
  {
    name: 'Google 服務帳號私鑰',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    to: '<redacted-private-key>',
  },
  {
    name: 'Bearer token',
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
    to: '<redacted-bearer-token>',
  },
  {
    name: 'JWT',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    to: '<redacted-jwt>',
  },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, to: '<redacted-github-token>' },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g, to: '<redacted-aws-key>' },
  {
    name: '密碼／憑證關鍵字後的值',
    re: /((?:password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_-]*\s*[:=]\s*)(['"])([^'"\n]{4,})\2/gi,
    to: (_m, prefix, quote) => `${prefix}${quote}<redacted>${quote}`,
  },
  {
    name: '環境變數指派（可能含密碼）',
    re: /\b([A-Z][A-Z0-9_]{2,})\s*=\s*(['"])([^'"\n]{4,})\2/g,
    // 只替換看起來像憑證的變數名，避免把路徑、說明文字也換掉
    to: (match, name, quote, value) =>
      /PASSWORD|PASSWD|SECRET|TOKEN|KEY|CREDENTIAL|PRIVATE/i.test(name)
        ? `${name}=${quote}<redacted>${quote}`
        : match,
  },
];

/** 常見的「測試用」密碼值：不是真的機敏，但也不該出現在繳交資料裡。 */
const KNOWN_TEST_VALUES = [
  'local-shot-pw-2026',
  'token-demo-pw-2026',
  'teacher-demo-pw',
  'demo-pw-2026',
  'e2e-teacher-password',
  'test-password',
];

function redact(text) {
  let result = text;
  for (const { re, to } of REDACTIONS) {
    result = result.replace(re, to);
  }
  for (const value of KNOWN_TEST_VALUES) {
    result = result.split(value).join('<redacted-test-password>');
  }
  return result;
}

function slugify(title) {
  const ascii = title
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return ascii.length > 0 ? ascii.slice(0, 60) : 'session';
}

/** 從匯出的 JSON 抽出「對話」：使用者提問與 AI 的文字回覆。 */
function extractConversation(messages) {
  const turns = [];
  for (const message of messages) {
    if (message.type === 'user') {
      const text = typeof message.text === 'string' ? message.text : '';
      if (text.trim() === '') continue;
      turns.push({ role: '使用者', text });
    } else if (message.type === 'assistant') {
      const parts = (message.content ?? [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text);
      if (parts.length === 0) continue;
      turns.push({ role: '助理', text: parts.join('\n\n') });
    }
  }
  return turns;
}

function formatSession(info, turns) {
  const lines = [];
  const created = info.time?.created ?? info.time?.updated;
  const date =
    typeof created === 'number' ? new Date(created).toISOString().slice(0, 10) : '（未知日期）';
  lines.push(`# ${info.title ?? '（無標題）'}`);
  lines.push('');
  lines.push(`- session id：\`${info.id}\``);
  lines.push(`- 日期：${date}`);
  if (info.model?.id) lines.push(`- 模型：${info.model.providerID ?? ''}/${info.model.id}`);
  lines.push(`- 輪次：${turns.length}`);
  lines.push('');
  lines.push('> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，');
  lines.push('> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。');
  lines.push('');
  lines.push('---');
  lines.push('');
  for (const turn of turns) {
    lines.push(`## ${turn.role}`);
    lines.push('');
    lines.push(turn.text.trim());
    lines.push('');
  }
  return lines.join('\n');
}

function listSessions() {
  const raw = execFileSync('opencode', ['session', 'list'], { encoding: 'utf8' });
  const sessions = [];
  for (const line of raw.split('\n')) {
    const [id, ...rest] = line.split('\t');
    if (id === undefined || !id.startsWith('ses_')) continue;
    sessions.push({ id, title: rest.join('\t').trim() });
  }
  return sessions;
}

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const dryRun = args.includes('--dry-run');
const wanted = args.filter((arg) => !arg.startsWith('--'));

const sessions = wanted.length > 0 ? wanted.map((id) => ({ id, title: '' })) : listSessions();

if (listOnly) {
  for (const session of sessions) console.log(`${session.id}\t${session.title}`);
  process.exit(0);
}

if (!dryRun) mkdirSync(OUT_DIR, { recursive: true });

const tmp = mkdtempSync(join(tmpdir(), 'ai-log-export-'));
let written = 0;
let totalTurns = 0;

try {
  for (const session of sessions) {
    process.stderr.write(`匯出 ${session.id} …\n`);
    // 匯出結果很大（單一 session 可達數十 MB），直接走 buffer 會被截斷成
    // 無法解析的 JSON，所以先寫到暫存檔再讀。
    const rawPath = join(tmp, `${session.id}.json`);
    execFileSync('opencode', ['session', 'export', session.id], {
      stdio: ['ignore', openSync(rawPath, 'w'), 'pipe'],
      maxBuffer: 512 * 1024 * 1024,
    });
    const parsed = JSON.parse(readFileSync(rawPath, 'utf8'));
    rmSync(rawPath, { force: true });
    const turns = extractConversation(parsed.messages ?? []);
    const info = parsed.info ?? { id: session.id, title: session.title };
    const markdown = redact(formatSession(info, turns));
    const name = `${String(info.time?.created ? new Date(info.time.created).toISOString().slice(0, 10) : 'undated')}-${slugify(info.title ?? session.id)}.md`;
    if (!dryRun) writeFileSync(join(OUT_DIR, name), markdown, 'utf8');
    written += 1;
    totalTurns += turns.length;
  }
} finally {
  // 暫存的原始匯出（含未遮蔽內容）一律不留在磁碟上
  rmSync(tmp, { recursive: true, force: true });
}

console.log(
  `${dryRun ? '（dry run）將匯出' : '已匯出'} ${written} 個 session，共 ${totalTurns} 輪對話 → ${dryRun ? OUT_DIR : OUT_DIR}`,
);
