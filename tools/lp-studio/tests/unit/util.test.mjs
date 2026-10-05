import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { escapeHtml, safeUrl, safeColor, contrastRatio, sha256Base64, inkFor } from '../../src/core/util.js';

test('escapeHtml は HTML 特殊文字をすべて変換する', () => {
  assert.equal(escapeHtml(`<script>"'&\``), '&lt;script&gt;&quot;&#39;&amp;&#96;');
  assert.equal(escapeHtml(null), '');
});

test('safeUrl は allowlist 以外を拒否する', () => {
  const bad = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', ' javascript:alert(1)', 'java\u0000script:x', '//evil.example', '\\\\evil', 'data:text/html,<b>x</b>', 'vbscript:x', 'http://example.com', 'file:///etc/passwd', '/relative/path', 'relative', '#', '#1bad', 'https://user:pass@example.com', 'https://exa mple.com', ''];
  for (const u of bad) assert.equal(safeUrl(u), null, u);
  assert.equal(safeUrl('https://example.com/a?utm_content=ut002'), 'https://example.com/a?utm_content=ut002');
  assert.equal(safeUrl('mailto:info@example.com'), 'mailto:info@example.com');
  assert.equal(safeUrl('tel:0120000000'), 'tel:0120000000');
  assert.equal(safeUrl('#apply'), '#apply');
});

test('safeColor は #RRGGBB のみ', () => {
  assert.equal(safeColor('#A1b2C3'), '#a1b2c3');
  for (const c of ['red', '#fff', 'url(x)', '#123456;}body{display:none', 'expression(1)']) assert.equal(safeColor(c), null);
});

test('contrastRatio と inkFor', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.ok(contrastRatio(inkFor('#ff88aa', '#ffffff'), '#ffffff') >= 4.5);
});

test('sha256Base64 は Node crypto と一致する', () => {
  for (const s of ['', 'abc', 'あいう'.repeat(100), 'x'.repeat(1000)]) {
    assert.equal(sha256Base64(s), createHash('sha256').update(s).digest('base64'));
  }
});
