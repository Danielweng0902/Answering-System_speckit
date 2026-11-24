/**
 * 對話紀錄的機敏資料遮蔽規則（`scripts/lib/redact.mjs`）。
 *
 * 為什麼要測這個：遮蔽規則之間會互相影響，而且**遮蔽值本身可能被另一條
 * 規則再匹配到** —— 2026-11-23 就發生過：
 *   `token-demo-pw-2026` → `<redacted-test-password>` → 因為佔位符裡含
 *   `test-password`（清單裡的另一項）→ 再被替換一次 →
 *   `<redacted-<redacted-test-password>>`
 * 這種自我替換產生的畸形輸出很難從結果看出問題，所以用測試釘住。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KNOWN_TEST_VALUES,
  KNOWN_TEST_VALUE_PLACEHOLDER,
  redact,
  redactPaths,
} from '../lib/redact.mjs';

test('已知測試密碼值被換成佔位符，而且不會自我嵌套', () => {
  for (const value of KNOWN_TEST_VALUES) {
    const out = redact(`程式實際寫死 '${value}'；`);
    assert.ok(!out.includes(value), `${value} 沒被換掉`);
    assert.ok(!out.includes('<redacted-<'), `出現自我嵌套：${out}`);
    assert.ok(out.includes(KNOWN_TEST_VALUE_PLACEHOLDER), `沒有用佔位符：${out}`);
  }
});

test('佔位符本身不含任何已知測試值（否則會被後續規則再替換）', () => {
  for (const value of KNOWN_TEST_VALUES) {
    assert.ok(
      !KNOWN_TEST_VALUE_PLACEHOLDER.includes(value),
      `佔位符 ${KNOWN_TEST_VALUE_PLACEHOLDER} 含有會被再替換的值 ${value}`,
    );
  }
});

test('多次套用遮蔽規則不會改變結果（冪等）', () => {
  const text = "寫死 'token-demo-pw-2026' 與 TEACHER_PASSWORD='local-shot-pw-2026'";
  const once = redact(text);
  assert.equal(redact(once), once);
});

test('真正的私鑰被整段換掉', () => {
  const key = [
    '-----BEGIN PRIVATE KEY-----',
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
    '-----END PRIVATE KEY-----',
  ].join('\n');
  const out = redact(`金鑰是：${key}`);
  assert.ok(!out.includes('MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'));
  assert.ok(out.includes('<redacted-private-key>'));
});

test('路徑遮蔽：repo 路徑與家目錄路徑分別處理', () => {
  assert.equal(
    redactPaths('/Users/someone/Answering-System_speckit/docs/a.md'),
    '<repo>/docs/a.md',
  );
  assert.equal(redactPaths('C:\\Answering-System_speckit\\docs\\a.md'), '<repo>\\docs\\a.md');
  assert.equal(redactPaths('/Users/someone/Desktop/a.md'), '<home>/Desktop/a.md');
  assert.equal(redactPaths('C:\\Users\\someone\\Desktop\\a.md'), '<home>\\Desktop\\a.md');
  // 相對路徑不動。
  assert.equal(redactPaths('docs/EXECUTION-PLAYBOOK.md'), 'docs/EXECUTION-PLAYBOOK.md');
});

test('一般的說明文字不會被誤傷', () => {
  const samples = [
    '貼上你的試算表網址',
    'SHEET_URL = "貼上你的試算表網址"',
    '-----BEGIN PRIVATE KEY----- 這一段，不是真正的金鑰內容，可以放心貼。',
    'tokenUrl = "https://oauth2.googleapis.com/token"',
  ];
  for (const sample of samples) {
    assert.equal(redact(sample), sample, `被誤改了：${sample}`);
  }
});
