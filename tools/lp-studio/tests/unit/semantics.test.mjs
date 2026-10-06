// 確定仕様の criticalSemanticTests / generalizationAcceptance / 重大な停止条件。
// 2つの架空ブリーフ（簿記の学習計画・見積もり共有ツール）を、同じ生成経路（prompt → Claude Code の JSON → ingest）で通した結果を検査する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit } from '../../src/core/model.js';
import { exportHtml, renderPage } from '../../src/core/render.js';
import { checkProject, gates, collectTexts } from '../../src/core/editorial.js';
import { ingestGenerated, chooseAngle, buildPrompt } from '../../src/core/generate.js';
import { serializeProject, validateProject } from '../../src/core/schema.js';
import { seed, seed2, brief, RESPONSE } from './helpers.mjs';

const stops = (p) => checkProject(p).filter((i) => i.level === 'stop');
const text = (html) => html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
const review = (p) => exportHtml(p, 'review');

test('両ケースとも同じ経路（brief → response → ingest）で生成され、停止条件なしでレビュー用に描画できる', () => {
  for (const id of ['michishirube', 'mitsumoriban']) {
    const r = ingestGenerated(brief(id), RESPONSE(id), { mode: 'full' });
    assert.ok(r.ok, r.report.errors.join());
    assert.deepEqual(r.report.issues.filter((i) => i.level === 'stop'), []);
    assert.ok(review(r.project).html);
  }
});

test('criticalSemantic: 学習の15分を面談の所要時間に変えない', () => {
  for (const [op, label] of [
    [{ type: 'setField', id: 'mechanism', field: 'body', value: 'まずは15分の面談で、今の状況をうかがいます。' }, '本文'],
    [{ type: 'setCtaLabel', id: 'hero', value: 'まず15分の相談を予約する' }, 'CTA'],
    [{ type: 'setField', id: 'closing', field: 'body', value: '相談は15分ほどです。' }, '同義語'],
  ]) {
    const s = stops(applyEdit(seed(), op));
    assert.ok(s.some((i) => i.code === 'unknown-filled'), label);
  }
  // 学習の単位としての15分は通る
  assert.deepEqual(stops(applyEdit(seed(), { type: 'setField', id: 'mechanism', field: 'body', value: '取り組む内容を毎晩15分の単位に分けます。' })), []);
});

test('criticalSemantic: オファー未確定なら実際の申込CTAは動かない（無効表示・リンクなし・実販売は書き出さない）', () => {
  const p = seed();
  const { html } = review(p);
  assert.match(html, /class="btn btn-disabled"[^>]*aria-disabled="true">学習設計面談を予約する/);
  assert.ok(!html.includes('example.com'));
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 0 && hrefs.every((h) => h.startsWith('#')), hrefs.join());
  assert.equal(exportHtml(p, 'commercial').html, null);
  assert.equal(gates(p).commercialReady.ok, false);
});

test('criticalSemantic: 本文を消したら、見出しだけ・CTAだけのセクションを出力しない', () => {
  let p = applyEdit(seed(), { type: 'setField', id: 'empathy', field: 'body', value: '' });
  p = applyEdit(p, { type: 'addSection', role: 'fit' });
  p = applyEdit(p, { type: 'setField', id: 'fit', field: 'heading', value: '向いている人' });
  const { html, report } = review(p);
  assert.ok(!html.includes('平日は迷う'));
  assert.ok(!html.includes('向いている人'));
  assert.deepEqual(report.removed.map((r) => r.id).sort(), ['empathy', 'fit']);
  assert.ok(checkProject(p).some((i) => i.code === 'empty-section'));
});

test('criticalSemantic: 合成の成果指標は検証用データにだけ残り、LPの成果根拠には出ない', () => {
  const p = seed();
  assert.ok(p.evidence.some((e) => e.metricValue === 4.2 && e.reality === 'synthetic')); // データとしては残る
  const all = [review(p).html, exportHtml(p, 'draft').html].join('');
  for (const w of ['4.2', '92%', '満足度', '根拠あり']) assert.ok(!text(all).includes(w), w);
  // コピーから合成成果を参照したら停止
  const q = applyEdit(p, { type: 'setRefs', id: 'mechanism', value: ['s1-mechanism', 'ev-hours'] });
  assert.ok(stops(q).some((i) => i.code === 'synthetic-outcome'));
  // 根拠セクションを足しても合成データは出ない
  let r = applyEdit(p, { type: 'addSection', role: 'proof' });
  r = applyEdit(r, { type: 'setRefs', id: 'proof', value: ['ev-hours', 'ev-voice'] });
  assert.ok(!text(review(r).html || exportHtml(r, 'draft').html).includes('4.2'));
});

test('criticalSemantic: 出典確認（verified）は事実性・実販売の準備を意味しない', () => {
  let p = seed();
  p = applyEdit(p, { type: 'addEvidence', claim: '学習計画は週ごとに見直す（架空の仕様書）', source: '架空の仕様書', kind: 'service-spec', reality: 'synthetic' });
  const id = p.evidence.at(-1).id;
  p = applyEdit(p, { type: 'verifyEvidence', id, value: true, verifiedBy: '担当', verifiedAt: '2026-10-01' });
  for (const s of p.sections) p = applyEdit(p, { type: 'approveSection', id: s.id, value: true });
  const g = gates(p);
  assert.equal(g.commercialReady.ok, false);
  assert.ok(g.commercialReady.reasons.some((r) => /実在でない/.test(r)));
  assert.ok(g.commercialReady.reasons.some((r) => /デモ/.test(r)));
});

test('criticalSemantic: デモは見える場所に表示され、登録・予約・送信をしない', () => {
  for (const p of [seed(), seed2()]) {
    const { html } = review(p);
    const notice = p.display.demoNotice;
    const plain = text(html).replace(/\s/g, '');
    assert.ok(plain.split(notice.replace(/\s/g, '').slice(0, 12)).length - 1 >= 2, notice); // 上部・フッター
    const heroCta = text(html.match(/<div class="hero-cta">([\s\S]*?)<\/div><\/header>/)[1]);
    assert.match(heroCta.replace(/\s/g, ''), /デモ/); // CTA の直近にもデモで申し込めないことを書く
    assert.match(html, /class="demo-bar"/);
    assert.doesNotMatch(html, /<form|<input|fetch\(|XMLHttpRequest|sendBeacon/);
    assert.match(html, /form-action 'none'/);
    assert.match(html, /noindex/);
    // 商品名・見出しの中に「架空」を混ぜない
    assert.ok(!p.display.brandName.includes('架空'));
    assert.ok(!p.sections.find((s) => s.role === 'hero').heading.includes('架空'));
  }
});

test('criticalSemantic: 別の業種のブリーフでは、場面・仕組み・根拠・CTA・語彙が一貫して変わる', () => {
  const a = seed();
  const b = seed2();
  const ta = text(review(a).html);
  const tb = text(review(b).html);
  for (const w of ['15分', '簿記', '学習面談', '合格', '週ごとの伴走', '売上が上がる', '失注ゼロ', 'メール自動連携']) assert.ok(!tb.includes(w), `見積もり番に「${w}」`);
  for (const w of ['4.2日/週', '92%満足度', '根拠ありバッジ', 'まず15分の相談を予約する', 'お客様の声']) assert.ok(!ta.includes(w), `簿記に「${w}」`);
  for (const w of ['見積もり', '担当者', '案件']) assert.ok(!ta.includes(w), `簿記に「${w}」`);
  const heroA = a.sections.find((s) => s.role === 'hero');
  const heroB = b.sections.find((s) => s.role === 'hero');
  assert.notEqual(heroA.visual.kind, heroB.visual.kind);
  assert.notEqual(heroA.cta.label, heroB.cta.label);
  assert.ok(heroA.sourceRefs.every((r) => r.startsWith('s1-')) && heroB.sourceRefs.every((r) => r.startsWith('s2-')));
  // 両方とも、関係ない空の起源・推薦・価格理由セクションを持たない
  for (const p of [a, b]) assert.ok(!p.sections.some((s) => ['proof', 'fit'].includes(s.role) && !s.body));
});

test('criticalSemantic: 訴求を変えると、依存する共感・仕組み・図解・締めを見直し対象にし、無関係な手動編集は保持', () => {
  let p = applyEdit(seed(), { type: 'setItems', id: 'faq', value: [{ heading: '手動で直した質問？', body: '手動で直した答えです。' }] });
  p = applyEdit(p, { type: 'approveSection', id: 'faq', value: true });
  p = applyEdit(p, { type: 'approveSection', id: 'empathy', value: true });
  const q = chooseAngle(p, 'a2');
  for (const id of ['hero', 'empathy', 'mechanism', 'closing']) {
    const s = q.sections.find((x) => x.id === id);
    assert.equal(s.needsReview, true, id); assert.equal(s.approved, false, id);
  }
  const faq = q.sections.find((x) => x.id === 'faq');
  assert.equal(faq.items[0].heading, '手動で直した質問？');
  assert.equal(faq.approved, true);
  assert.match(buildPrompt(q, 'reangle'), /依存する役割/);
  // reangle 応答は依存セクションだけを差し替え、無関係なセクションは無視する
  const resp = JSON.stringify({ generator: 'claude-code', mode: 'reangle', sections: [{ role: 'empathy', heading: '週末にまとめる勉強が、負担になっていませんか。', body: '平日に進まなかった分を、週末にまとめていませんか。', sourceRefs: ['s1-scene'] }, { role: 'faq', heading: 'x', body: '上書きされてはいけない。' }] });
  const r = ingestGenerated(q, resp, { mode: 'reangle' });
  assert.ok(r.ok);
  assert.equal(r.project.sections.find((x) => x.id === 'faq').items[0].heading, '手動で直した質問？');
  assert.equal(r.project.sections.find((x) => x.id === 'empathy').heading, '週末にまとめる勉強が、負担になっていませんか。');
  assert.ok(r.report.warnings.some((w) => /faq/.test(w)));
});

test('criticalSemantic: 自由な言い換えは可。ただし条件の数値・料金は参照元に忠実', () => {
  assert.ok(stops(applyEdit(seed(), { type: 'setField', id: 'closing', field: 'body', value: '面談料金は3,000円です。' })).some((i) => ['number-unsupported', 'unknown-filled'].includes(i.code)));
  assert.ok(stops(applyEdit(seed(), { type: 'setField', id: 'closing', field: 'body', value: 'お気軽にどうぞ。初回は無料です。' })).some((i) => /claim|unknown/.test(i.code)));
  assert.ok(stops(applyEdit(seed2(), { type: 'setField', id: 'scope', field: 'body', value: '最大10人まで使えます。' })).length > 0);
});

test('停止条件: 言わないこと・口コミの創作・未展開の差込・参照の無い主張', () => {
  assert.ok(stops(applyEdit(seed(), { type: 'setField', id: 'closing', field: 'body', value: 'これなら必ず続けられる。' })).some((i) => i.code === 'do-not-assert'));
  assert.ok(stops(applyEdit(seed(), { type: 'setField', id: 'empathy', field: 'body', value: 'Aさん（30代）「人生が変わりました」。' })).some((i) => i.code === 'invented-quote' || i.code === 'claim-unsupported'));
  assert.ok(stops(applyEdit(seed(), { type: 'setField', id: 'empathy', field: 'body', value: '{{audience}}のための学習。' })).some((i) => i.code === 'token'));
  assert.ok(stops(applyEdit(seed2(), { type: 'setField', id: 'mechanism', field: 'body', value: '確認漏れゼロで、売上が上がる。' })).length >= 2);
});

test('一般化: 両ケースとも仮説は仮説のまま・FVは仕組みを具体的に説明・見出しは指定の改行候補', () => {
  for (const [p, phrases] of [[seed(), ['「何からやろう」で、', '今夜を終わらせない。']], [seed2(), ['返事待ちの見積もりを、', 'チームで追える一覧に。']]]) {
    assert.ok(p.insights.length && p.insights.every((i) => i.status === 'hypothesis'));
    const hero = p.sections.find((s) => s.role === 'hero');
    assert.deepEqual(hero.headingPhrases, phrases);
    const { html } = renderPage(p, { kind: 'review' });
    const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/)[1];
    assert.deepEqual([...h1.matchAll(/<span class="ph">([^<]*)<\/span>/g)].map((m) => m[1].replace(/&#39;|&quot;/g, '')), phrases.map((x) => x.replace(/["']/g, '')));
    assert.ok(hero.body.length > 30 && /記録|分け|決め/.test(hero.body)); // 一般的な「サポート」「効率化」ではなく動作を書く
  }
});

test('表示名・業態・試作表示を分け、対象者の呼びかけはFVで1回', () => {
  for (const p of [seed(), seed2()]) {
    const { html } = review(p);
    const t = text(html);
    const n = t.split(p.display.audienceLabel).length - 1;
    assert.equal(n, 1, p.display.audienceLabel);
    assert.ok(!collectTexts(p).some((x) => x.role !== 'display' && x.text.includes(p.display.serviceDescriptor)));
  }
});

test('保存→再読込でv2の全レイヤーが一致（roundtrip）、v1 からの移行', async () => {
  for (const p of [seed(), seed2()]) {
    const again = validateProject(JSON.parse(serializeProject(p)));
    assert.ok(again.ok);
    assert.deepEqual(again.project, p);
  }
  const { readFileSync } = await import('node:fs');
  const v1 = JSON.parse(readFileSync(new URL('../../examples/v1/claude-code-run/project.reviewed.json', import.meta.url), 'utf8'));
  const m = validateProject(v1);
  assert.ok(m.ok, m.errors.join());
  assert.equal(m.project.schemaVersion, 2);
  assert.ok(m.project.sections.every((s) => !s.approved && s.needsReview));
  assert.ok(m.warnings.some((w) => /v1 → v2/.test(w)));
});

test('中間レビューの指摘: 存在しない並べ替えを見せない・締め帯の統一・和文ゴシック・簿記の繰り返しを減らす', () => {
  const tb = text(review(seed2()).html);
  for (const w of ['近い順', '今週確認する案件だけ', '並べ替え', 'ソート']) assert.ok(!tb.includes(w), w);
  assert.ok(tb.includes('確認したい案件を絞り込めます'));
  const { html } = review(seed());
  assert.match(html, /\.closing\{background:linear-gradient\(160deg,var\(--ink\)/);
  assert.match(html, /"IPAPGothic","IPAGothic"[^;]*,sans-serif/);
  assert.doesNotMatch(html.match(/--font:[^;]*/)[0], /Mincho|serif"/);
  const ta = text(html).replace(/\s/g, '');
  assert.ok((ta.match(/15分/g) || []).length <= 6, `15分 x${(ta.match(/15分/g) || []).length}`);
  assert.ok(!seed().sections.some((s) => s.role === 'illustration'));
  assert.equal(seed().sections.find((s) => s.role === 'mechanism').visual.kind, 'flow');
  assert.equal(seed().sections.find((s) => s.role === 'hero').cta.target, 'mechanism');
});
