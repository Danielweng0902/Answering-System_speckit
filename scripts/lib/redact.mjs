/**
 * 對話紀錄的機敏資料遮蔽規則（`docs/ai-logs/` 共用）。
 *
 * 為什麼要有共用模組：對話紀錄有兩個來源 ——
 *   - `export-ai-logs.mjs`：本機 opencode 的 session 匯出；
 *   - `import-ai-logs.mjs`：組員用其他工具整理後交來的紀錄。
 * 兩邊必須用**同一套規則**，否則會出現「一邊遮了、一邊沒遮」的不一致。
 *
 * 規則設計原則：
 *   1. 只替換「真的可能機敏」的樣式，不動一般內容；
 *   2. 佔位符寫成人可讀的形式，讓讀紀錄的人知道「這裡本來是什麼」；
 *   3. 順序固定：先替換機敏值，最後才遮蔽路徑（反過來會漏掉）。
 */

/** ── 機敏資料替換規則 ──────────────────────────────────────────────
 * 每一條都要能把「真的機敏值」換掉，而不會誤傷正常內容。
 */
export const REDACTIONS = [
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
    // 關鍵字要有詞邊界：`tokenUrl`、`token_endpoint` 這類公開端點不是機密，
    // 但 `token` 開頭 + 後接字母會被誤判 → 用前後斷言擋掉。
    re: /((?<![A-Za-z0-9_])(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)(?![A-Za-z0-9_])[A-Za-z0-9_-]*\s*[:=]\s*)(['"])([^'"\n]{4,})\2/gi,
    to: (_m, prefix, quote) => `${prefix}${quote}<redacted>${quote}`,
  },
  {
    name: '環境變數指派（可能含密碼）',
    re: /\b([A-Z][A-Z0-9_]{2,})\s*=\s*(['"])([^'"\n]{4,})\2/g,
    // 只替換看起來像憑證的變數名，避免把路徑、說明文字也換掉。
    // `_URL`／`_URI`／`_ENDPOINT` 結尾的是公開端點，不動。
    to: (match, name, quote, value) =>
      /PASSWORD|PASSWD|SECRET|TOKEN|KEY|CREDENTIAL|PRIVATE/i.test(name) &&
      !/_(URL|URI|ENDPOINT)$/i.test(name)
        ? `${name}=${quote}<redacted>${quote}`
        : match,
  },
];

/** 常見的「測試用」密碼值：不是真的機敏，但也不該出現在繳交資料裡。 */
export const KNOWN_TEST_VALUES = [
  'local-shot-pw-2026',
  'token-demo-pw-2026',
  'teacher-demo-pw',
  'demo-pw-2026',
  'e2e-teacher-password',
  'test-password',
];

/**
 * 已知測試密碼值的佔位符。
 *
 * ⚠️ 這個字串**刻意不含**任何 `KNOWN_TEST_VALUES` 的成員（例如不要寫成
 * `<redacted-test-password>`，因為 `test-password` 本身就在清單裡）。
 * 否則會出現自我替換：`token-demo-pw-2026` → `<redacted-test-password>`
 * → 再被 `test-password` 那條規則替換一次 → `<redacted-<redacted-test-password>>`。
 */
export const KNOWN_TEST_VALUE_PLACEHOLDER = '<redacted-test-pw>';

/** 把已知測試密碼值一次換掉。
 *
 * 用單一 regex 聯集而不是逐個 `split().join()`：逐個替換時，前一個規則的
 * 佔位符可能被後一個規則再匹配到（見 KNOWN_TEST_VALUE_PLACEHOLDER 的說明）。
 * 一次 replace 完就不會再被掃到。
 */
function redactKnownTestValues(text) {
  const escaped = KNOWN_TEST_VALUES.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.replace(new RegExp(escaped.join('|'), 'g'), KNOWN_TEST_VALUE_PLACEHOLDER);
}

/**
 * 本機絕對路徑 → 佔位符。
 *
 * 理由：repo 是公開的，紀錄裡帶著 `/Users/<使用者名稱>/…` 會暴露本機使用者名稱
 * 與家目錄結構。repo 自己的路徑換成 `<repo>`，其他家目錄路徑換成 `<home>/…`，
 * 語意保留、資訊不外洩。
 */
export const REPO_DIR_NAME = 'Answering-System_speckit';

export function redactPaths(text) {
  return (
    text
      // Unix 的 repo 路徑
      .replace(new RegExp(`\\/Users\\/[^/\\s"']+\\/${REPO_DIR_NAME}`, 'g'), '<repo>')
      // Windows 的 repo 路徑（C:\Answering-System_speckit，不含使用者名稱）
      .replace(new RegExp(`[A-Za-z]:\\\\${REPO_DIR_NAME}`, 'g'), '<repo>')
      // 其他家目錄路徑
      .replace(/\/Users\/[^/\s"']+\//g, '<home>/')
      .replace(/[A-Za-z]:\\Users\\[^\\\s"']+\\/g, '<home>\\')
  );
}

/** 對一段文字套用全部遮蔽規則。 */
export function redact(text) {
  let result = text;
  for (const { re, to } of REDACTIONS) {
    result = result.replace(re, to);
  }
  result = redactKnownTestValues(result);
  // 最後才遮蔽路徑：前面的規則可能會把路徑裡的片段改掉，先做路徑會漏掉。
  return redactPaths(result);
}
