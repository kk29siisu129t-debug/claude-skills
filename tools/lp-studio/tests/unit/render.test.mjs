import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPage, exportHtml, RUNTIME_SCRIPT } from '../../src/core/render.js';
import { applyEdit } from '../../src/core/model.js';
import { sha256Base64 } from '../../src/core/util.js';
import { seed } from './helpers.mjs';

const scripts = (html) => html.match(/<script\b/gi) || [];

test('seed の safe export は公開可能で、未検証・未確定は出ない', () => {
  const { html, report } = exportHtml(seed(), 'safe');
  assert.ok(html, report.blockers.join());
  assert.equal(report.publishable, true);
  assert.doesNotMatch(html, /満足度92/);
  assert.doesNotMatch(html, /初回の学習設計面談（オンライン）/); // offer 未確定
  assert.doesNotMatch(html, /class="flag/);
  assert.doesNotMatch(html, /noindex/);
  assert.match(html, /4\.2/); // verified の数値
  assert.match(html, /utm_content=demo01/); // CTA href の UTM を保持
  assert.ok(report.removed.length >= 3);
});

test('draft はバナー・noindex・旗付きで未確認を含む', () => {
  const { html } = exportHtml(seed(), 'draft');
  assert.match(html, /公開しないでください/);
  assert.match(html, /noindex/);
  assert.match(html, /満足度92/);
  assert.match(html, /未検証/);
});

test('XSS: どの入力欄からもタグ・属性が注入されない', () => {
  const payload = `"><script>alert(1)</script><img src=x onerror=alert(2)>'\`{{x}}`;
  let p = seed();
  p = applyEdit(p, { type: 'setName', value: payload });
  p = applyEdit(p, { type: 'setBrief', key: 'product', value: payload, status: 'confirmed' });
  p = applyEdit(p, { type: 'setBrief', key: 'audience', value: payload, status: 'confirmed' });
  for (const s of p.sections) for (const f of ['heading', 'lead', 'body', 'note']) p = applyEdit(p, { type: 'setField', id: s.id, field: f, value: payload });
  p = applyEdit(p, { type: 'setField', id: 'empathy', field: 'items', value: payload });
  p = applyEdit(p, { type: 'setCtaVariant', id: 'a', label: payload.slice(0, 40) });
  p = applyEdit(p, { type: 'addEvidence', claim: payload, source: payload });
  for (const kind of ['preview', 'draft', 'safe']) {
    for (const view of ['design', 'wf']) {
      const { html } = renderPage(p, { kind, view });
      assert.equal(scripts(html).length, view === 'wf' ? 0 : 1, `${kind}/${view}`);
      assert.doesNotMatch(html, /<img/i);
      assert.doesNotMatch(html, /<[a-z][^>]*\sonerror\s*=/i);
      assert.ok(!html.includes('"><script'));
    }
  }
});

test('CSP は固定スクリプトの sha256 と一致し、アプリの CSP にも同じ hash がある', () => {
  const { html } = renderPage(seed(), { kind: 'safe' });
  const hash = sha256Base64(RUNTIME_SCRIPT);
  assert.ok(html.includes(`'sha256-${hash}'`)); // CSP はユーザー入力を含まない定数
  assert.ok(html.includes(`<script>${RUNTIME_SCRIPT}</script>`));
  assert.match(html, /default-src 'none'/);
  const app = readFileSync(new URL('../../src/app/index.html', import.meta.url), 'utf8');
  assert.ok(app.includes(`'sha256-${hash}'`), 'src/app/index.html の CSP hash を更新してください');
  assert.doesNotMatch(RUNTIME_SCRIPT, /innerHTML|eval|Function\(/);
});

test('safe export は fail-closed: 必須の未承認・運営者未確定・コントラスト・CTA未確定でブロック', () => {
  const cases = [
    [(p) => applyEdit(p, { type: 'setField', id: 'empathy', field: 'body', value: '変更' }), /未承認/],
    [(p) => applyEdit(p, { type: 'setBrief', key: 'operator', status: 'unconfirmed' }), /運営者/],
    [(p) => applyEdit(p, { type: 'setBrand', key: 'ink', value: '#dddddd' }), /コントラスト/],
    [(p) => applyEdit(p, { type: 'setBrief', key: 'ctaUrl', status: 'unconfirmed' }), /CTAリンク/],
    [(p) => applyEdit(p, { type: 'setCtaVariant', id: 'a', label: '今だけ無料で予約' }), /CTA文言に根拠の無い主張/],
    [(p) => applyEdit(p, { type: 'removeSection', id: 'recommit' }) && applyEdit(p, { type: 'verifyEvidence', id: 'ev-hours', value: false }) && applyEdit(applyEdit(p, { type: 'verifyEvidence', id: 'ev-hours', value: false }), { type: 'verifyEvidence', id: 'ev-plan', value: false }), /根拠|公開できる内容/],
  ];
  for (const [mut, re] of cases) {
    const { html, report } = exportHtml(mut(seed()), 'safe');
    assert.equal(html, null);
    assert.ok(report.blockers.some((b) => re.test(b)), report.blockers.join(' | '));
  }
});

test('safe export は根拠の無い主張・参考LP固有値・薬機法語彙をフィールド単位で除外', () => {
  let p = seed();
  p = applyEdit(p, { type: 'setField', id: 'closing', field: 'body', value: '受講生1140人が実感。' });
  p = applyEdit(p, { type: 'setField', id: 'origin', field: 'body', value: '業界No.1の伴走' });
  p = applyEdit(p, { type: 'setCategory', value: 'health' });
  p = applyEdit(p, { type: 'setField', id: 'empathy', field: 'body', value: '飲むだけで痩せる' });
  for (const id of ['closing', 'origin', 'empathy']) p = applyEdit(p, { type: 'approveSection', id, value: true });
  const { html, report } = exportHtml(p, 'safe');
  assert.ok(html, report.blockers.join());
  for (const t of ['1140', 'No.1', '痩せる']) assert.ok(!html.includes(t), t);
  assert.equal(report.removed.filter((r) => /1140|No\.1|痩せる/.test(r.text)).length, 3);
});

test('固定CTA・寸法・本文幅のスタイル契約', () => {
  const { html } = renderPage(seed(), { kind: 'safe' });
  for (const s of ['max-width:720px', 'font-size:17.5px;line-height:34.1px', 'width:340px;height:66px', 'font-size:16px;line-height:31.2px', 'height:54px', 'prefers-reduced-motion', 'data-cta-timing="spec"', 'inert']) assert.ok(html.includes(s), s);
});

test('WF と デザインは同じデータから描画される（編集が両方に反映）', () => {
  const p = applyEdit(seed(), { type: 'setField', id: 'empathy', field: 'heading', value: '同期テスト見出し' });
  assert.match(renderPage(p, { view: 'wf' }).html, /同期テスト見出し/);
  assert.match(renderPage(p, { kind: 'preview' }).html, /同期テスト見出し/);
});
