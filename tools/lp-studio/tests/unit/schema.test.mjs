import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectJson, serializeProject, validateProject, SCHEMA_VERSION, MAX_JSON_BYTES } from '../../src/core/schema.js';
import { seed, SEED_TEXT } from './helpers.mjs';

test('seed は schema に通り、保存→再読込で完全に一致する（roundtrip）', () => {
  const p = seed();
  assert.equal(p.schemaVersion, SCHEMA_VERSION);
  const again = parseProjectJson(serializeProject(p));
  assert.ok(again.ok);
  assert.deepEqual(again.project, p);
  assert.deepEqual(parseProjectJson(serializeProject(again.project)).project, p);
});

test('不正な JSON・HTML・巨大入力を拒否する', () => {
  assert.equal(parseProjectJson('{bad').ok, false);
  const html = parseProjectJson('<html><script>alert(1)</script></html>');
  assert.equal(html.ok, false);
  assert.match(html.errors[0], /HTML/);
  assert.equal(parseProjectJson('x'.repeat(MAX_JSON_BYTES + 1)).ok, false);
  assert.equal(parseProjectJson('[]').ok, false);
  assert.equal(parseProjectJson('null').ok, false);
});

test('__proto__ / constructor キーを拒否し、prototype を汚染しない', () => {
  const evil = SEED_TEXT.replace('"schemaVersion": 1,', '"schemaVersion": 1, "__proto__": {"polluted": true},');
  const r = parseProjectJson(evil);
  assert.equal(r.ok, false);
  assert.equal({}.polluted, undefined);
  const evil2 = JSON.parse(SEED_TEXT);
  evil2.brief.constructor = { prototype: { x: 1 } };
  assert.equal(validateProject(evil2).ok, false);
});

test('未対応バージョンは拒否、v0 は移行する', () => {
  const p = JSON.parse(SEED_TEXT);
  p.schemaVersion = 99;
  assert.equal(validateProject(p).ok, false);
  const v0 = JSON.parse(SEED_TEXT);
  delete v0.schemaVersion;
  for (const k of Object.keys(v0.brief)) if (k !== 'category') v0.brief[k] = v0.brief[k].value;
  const r = validateProject(v0);
  assert.ok(r.ok, r.errors.join());
  assert.equal(r.project.brief.product.status, 'unconfirmed');
  assert.ok(r.warnings.some((w) => /v0/.test(w)));
});

test('未知キーは削除して警告、型違いはエラー', () => {
  const p = JSON.parse(SEED_TEXT);
  p.unknownThing = '<script>';
  p.sections[0].fields.onclick = 'alert(1)';
  const r = validateProject(p);
  assert.ok(r.ok);
  assert.equal('unknownThing' in r.project, false);
  assert.equal('onclick' in r.project.sections[0].fields, false);
  assert.ok(r.warnings.length >= 2);
  const q = JSON.parse(SEED_TEXT);
  q.sections[0].approved = 'yes';
  assert.equal(validateProject(q).ok, false);
});

test('危険なURL・色・ID・未検証の昇格を扱う', () => {
  const p = JSON.parse(SEED_TEXT);
  p.brief.ctaUrl.value = 'javascript:alert(document.cookie)';
  p.brand.primary = '#000;}body{display:none';
  let r = validateProject(p);
  assert.equal(r.ok, false); // 色はエラー
  p.brand.primary = '#2741b8';
  r = validateProject(p);
  assert.ok(r.ok);
  assert.equal(r.project.brief.ctaUrl.value, '');
  assert.equal(r.project.brief.ctaUrl.status, 'missing');

  const q = JSON.parse(SEED_TEXT);
  q.evidence[2].status = 'verified'; // 確認者・確認日なし
  const r2 = validateProject(q);
  assert.equal(r2.project.evidence[2].status, 'unverified');

  const s = JSON.parse(SEED_TEXT);
  s.sections[1].id = s.sections[0].id;
  assert.equal(validateProject(s).ok, false);
  const t = JSON.parse(SEED_TEXT);
  t.sections[0].id = '"><img src=x>';
  assert.equal(validateProject(t).ok, false);
});

test('LPO データセットは fictional:true のみ', () => {
  const p = JSON.parse(SEED_TEXT);
  p.lpo.dataset.fictional = false;
  assert.equal(validateProject(p).ok, false);
});

test('HTMLらしき文字列はテキストとして保持し警告する（実行しない）', () => {
  const p = JSON.parse(SEED_TEXT);
  p.sections[0].fields.heading = '<img src=x onerror=alert(1)>';
  const r = validateProject(p);
  assert.ok(r.ok);
  assert.equal(r.project.sections[0].fields.heading, '<img src=x onerror=alert(1)>');
  assert.ok(r.warnings.some((w) => /HTML/.test(w)));
});
