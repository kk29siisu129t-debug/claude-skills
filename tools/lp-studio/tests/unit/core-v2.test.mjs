// schema / model / generate / render（v2）の安全性と基本動作。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProjectJson, serializeProject, validateProject, MAX_JSON_BYTES, SCHEMA_VERSION } from '../../src/core/schema.js';
import { applyEdit, emptyProject } from '../../src/core/model.js';
import { buildPrompt, ingestGenerated, applySkeleton, ADAPTERS } from '../../src/core/generate.js';
import { renderPage, renderWireframe, exportHtml, HEAD_SCRIPT, RUNTIME_SCRIPT } from '../../src/core/render.js';
import { checkProject } from '../../src/core/editorial.js';
import { autoPhrases, headingPhrases } from '../../src/core/segment.js';
import { sha256Base64 } from '../../src/core/util.js';
import { seed, seed2, SEED_TEXT, brief } from './helpers.mjs';

test('schema: 不正なJSON・HTML・巨大入力・配列・未対応版を拒否', () => {
  assert.equal(parseProjectJson('{bad').ok, false);
  assert.match(parseProjectJson('<html><script>alert(1)</script></html>').errors[0], /HTML/);
  assert.equal(parseProjectJson('x'.repeat(MAX_JSON_BYTES + 1)).ok, false);
  assert.equal(parseProjectJson('[]').ok, false);
  const raw = JSON.parse(SEED_TEXT); raw.schemaVersion = 99;
  assert.equal(validateProject(raw).ok, false);
  assert.equal(SCHEMA_VERSION, 2);
});

test('schema: __proto__ / constructor を拒否し prototype を汚染しない', () => {
  assert.equal(parseProjectJson(SEED_TEXT.replace('"schemaVersion": 2,', '"schemaVersion": 2, "__proto__": {"polluted": true},')).ok, false);
  assert.equal({}.polluted, undefined);
  const raw = JSON.parse(SEED_TEXT); raw.display.constructor = { prototype: { x: 1 } };
  assert.equal(validateProject(raw).ok, false);
});

test('schema: 未知キーは削除、危険なURL・色・IDは拒否または除去', () => {
  const raw = JSON.parse(SEED_TEXT);
  raw.extra = '<script>'; raw.sections[0].onclick = 'alert(1)';
  raw.inputs.action.url = 'javascript:alert(1)';
  const r = validateProject(raw);
  assert.ok(r.ok);
  assert.equal('extra' in r.project, false);
  assert.equal('onclick' in r.project.sections[0], false);
  assert.equal(r.project.inputs.action.url, '');
  const c = JSON.parse(SEED_TEXT); c.brand.primary = '#000;}body{display:none';
  assert.equal(validateProject(c).ok, false);
  const i = JSON.parse(SEED_TEXT); i.sections[0].id = '"><img src=x>';
  assert.equal(validateProject(i).ok, false);
});

test('schema: 生成由来の顧客原文は削除、実在の原文に基づかないインサイトは仮説に戻す', () => {
  const raw = JSON.parse(SEED_TEXT);
  raw.quotes = [{ id: 'q1', text: 'すごく良かった', speakerId: 'A', method: '生成', date: '2026-10-01', usable: true, sourceRef: '', provenance: 'claude-code' }];
  raw.insights[0].status = 'supported';
  const r = validateProject(raw);
  assert.equal(r.project.quotes.length, 0);
  assert.equal(r.project.insights[0].status, 'hypothesis');
});

test('model: 編集は純関数で、結果は常に schema に通る。編集すると承認が外れる', () => {
  const p = seed();
  const before = serializeProject(p);
  const ops = [
    { type: 'setDisplay', key: 'audienceLabel', value: '働きながら簿記2級を目指す方へ' },
    { type: 'setInput', path: 'scene.timing', value: '平日の夜' },
    { type: 'setAction', key: 'price', value: '未定' },
    { type: 'addLedger', text: '面談の場所', kind: 'unknown', reality: 'synthetic' },
    { type: 'setField', id: 'empathy', field: 'body', value: '平日の夜、どこから始めるかが決まらない。' },
    { type: 'setPhrases', id: 'empathy', value: '平日は迷う。/週末には、/やることがたまる。' },
    { type: 'setItems', id: 'process', value: '今の進み具合を整理する｜面談で一緒に確認します。' },
    { type: 'addSection', role: 'fit', at: 3 },
    { type: 'moveSection', id: 'faq', delta: -1 },
    { type: 'approveSection', id: 'hero', value: true },
  ];
  let q = p;
  for (const op of ops) {
    q = applyEdit(q, op);
    const v = validateProject(JSON.parse(serializeProject(q)));
    assert.ok(v.ok, `${op.type}: ${v.errors.join()}`);
  }
  assert.equal(serializeProject(p), before);
  assert.equal(q.sections.find((s) => s.id === 'empathy').approved, false);
  assert.equal(q.sections.find((s) => s.id === 'hero').approved, true);
});

test('model: 必須の削除禁止・改行候補の一致・図のラベル・URL・確定の条件・顧客原文の必須項目', () => {
  const p = seed();
  assert.throws(() => applyEdit(p, { type: 'removeSection', id: 'hero' }), /削除できません/);
  assert.throws(() => applyEdit(p, { type: 'setPhrases', id: 'hero', value: '何から/やろう' }), /一致/);
  assert.throws(() => applyEdit(p, { type: 'setVisual', id: 'mechanism', key: 'label', value: '受講生の実績' }), /イメージ/); // FV の図は撤去したので仕組みの図で確認
  assert.throws(() => applyEdit(p, { type: 'setVisual', id: 'hero', key: 'label', value: 'x' }), /図はありません/);
  assert.throws(() => applyEdit(p, { type: 'setAction', key: 'url', value: 'javascript:alert(1)' }), /https/);
  assert.throws(() => applyEdit(p, { type: 'confirmAction', key: 'price', value: true }), /空の値/);
  assert.throws(() => applyEdit(p, { type: 'addQuote', text: 'よかった', speakerId: '', method: '', date: '2026-10-01' }), /必須/);
  assert.throws(() => applyEdit(p, { type: 'addLedger', text: 'x', kind: 'customer-quote' }), /原文/);
  assert.throws(() => applyEdit(p, { type: 'setDisplay', key: 'demoNotice', value: '' }), /デモ表示/);
  assert.throws(() => applyEdit(p, { type: 'nope' }));
  const e = emptyProject();
  assert.equal(validateProject(JSON.parse(serializeProject(e))).ok, true);
});

test('generate: アダプタの区別・骨組みはAI生成ではない・prompt の内容', () => {
  assert.equal(ADAPTERS['claude-code'].connected, false);
  assert.match(ADAPTERS.skeleton.label, /AI生成ではない/);
  const sk = applySkeleton(brief('mitsumoriban'));
  assert.ok(sk.sections.every((s) => s.origin === 'template' && /【要記入/.test(s.heading)));
  assert.ok(checkProject(sk).some((i) => i.code === 'placeholder'));
  const t = buildPrompt(brief('michishirube'), 'full');
  for (const w of ['事実台帳', 's1-mechanism', 'u1-duration [unknown', '必ず続けられる', '顧客の実際の発言がなければ', 'headingPhrases', 'commercialPreview', '"insights"', '"angles"']) assert.ok(t.includes(w), w);
});

test('generate: 取り込みは仮説・未承認に強制、HTML/URL を除外、参照の無いIDを外す、不正な応答は拒否', () => {
  const b = brief('michishirube');
  const r = ingestGenerated(b, JSON.stringify({
    generator: 'claude-code', mode: 'full',
    insights: [{ id: 'i1', statement: 's', sourceRefs: ['s1-scene', 'nope'] }],
    sections: [{ role: 'hero', heading: '見出し', body: '<img src=x onerror=alert(1)>', sourceRefs: ['s1-scene', 'ghost'], cta: { label: 'x', behavior: 'anchor', target: 'missing' } }],
  }), { mode: 'full' });
  assert.ok(r.ok);
  const hero = r.project.sections[0];
  assert.equal(hero.approved, false); assert.equal(hero.origin, 'claude-code');
  assert.equal(hero.body, '');
  assert.deepEqual(hero.sourceRefs, ['s1-scene']);
  assert.equal(hero.cta, null);
  assert.equal(r.project.insights[0].status, 'hypothesis');
  for (const bad of ['not json', '{}', JSON.stringify({ generator: 'x', mode: 'full', sections: [] }), JSON.stringify({ generator: 'claude-code', mode: 'full', sections: [{ role: 'empathy' }] }), '{"__proto__":{"x":1}}']) {
    const x = ingestGenerated(b, bad, { mode: 'full' });
    assert.equal(x.ok, false, bad);
    assert.equal(x.project, b);
  }
  assert.equal(ingestGenerated(b, JSON.stringify({ generator: 'claude-code', mode: 'full', sections: [{ role: 'hero' }] }), { mode: 'reangle' }).ok, false);
});

test('render: XSS — どの入力からもタグ・属性・スクリプトが注入されない', () => {
  const payload = `"><script>alert(1)</script><img src=x onerror=alert(2)>'\``;
  let p = seed();
  for (const k of ['brandName', 'serviceDescriptor', 'audienceLabel', 'demoNotice']) p = applyEdit(p, { type: 'setDisplay', key: k, value: payload });
  for (const s of p.sections) for (const f of ['heading', 'body', 'note']) p = applyEdit(p, { type: 'setField', id: s.id, field: f, value: payload });
  p = applyEdit(p, { type: 'setItems', id: 'process', value: [{ heading: payload, body: payload }] });
  p = applyEdit(p, { type: 'setCtaLabel', id: 'hero', value: payload.slice(0, 40) });
  // FV の人物写真: alt / caption も escape。画像は data:image の1枚だけ
  p.assets.heroPortrait = { ...p.assets.heroPortrait, alt: payload.slice(0, 80), caption: `イメージ${payload}`.slice(0, 40) };
  for (const kind of ['draft', 'review']) {
    const { html } = renderPage(p, { kind });
    assert.equal((html.match(/<script\b/gi) || []).length, 2, kind); // head と runtime の固定スクリプトだけ
    const imgs = html.match(/<img\b[^>]*>/gi) || [];
    assert.equal(imgs.length, 1, kind);
    assert.match(imgs[0], /^<img src="data:image\/webp;base64,[A-Za-z0-9+/=]+" alt="&quot;&gt;&lt;script&gt;/);
    assert.doesNotMatch(html.replace(/="[^"]*"/g, '=""'), /<[a-z][^>]*\sonerror\s*=/i); // 引用符内の escape 済み文字列は属性にならない
    assert.doesNotMatch(html, /alt="[^"]*"[^>]*onerror/i);
  }
  assert.doesNotMatch(renderWireframe(p), /<script|<img/i);
});

test('assets.heroPortrait: data:image 以外は拒否し、架空のイメージである表示と由来を必ず持つ', () => {
  const base = seed();
  const hp = base.assets.heroPortrait;
  assert.equal(hp.origin, 'ai_generated');
  assert.equal(hp.fictional, true);
  assert.match(hp.caption, /イメージ|架空/);
  for (const bad of ['https://example.com/a.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)', 'data:text/html;base64,PGI+']) {
    const r = validateProject({ ...base, assets: { heroPortrait: { ...hp, dataUri: bad } } });
    assert.equal(r.ok, false, bad);
  }
  const r = validateProject({ ...base, assets: { heroPortrait: { ...hp, caption: '受講生の田中さん' } } });
  assert.ok(r.ok);
  assert.match(r.project.assets.heroPortrait.caption, /架空|イメージ/); // 口コミ・肩書のような表示にはしない
});

test('render: CSP は固定スクリプトの hash と一致し、アプリの CSP にも同じ hash', () => {
  const { html } = renderPage(seed(), { kind: 'review' });
  for (const s of [HEAD_SCRIPT, RUNTIME_SCRIPT]) {
    assert.ok(html.includes(`'sha256-${sha256Base64(s)}'`));
    assert.ok(html.includes(`<script>${s}</script>`));
  }
  const app = readFileSync(new URL('../../src/app/index.html', import.meta.url), 'utf8');
  for (const s of [HEAD_SCRIPT, RUNTIME_SCRIPT]) assert.ok(app.includes(`'sha256-${sha256Base64(s)}'`), 'node sync-csp.mjs を実行してください');
  assert.doesNotMatch(RUNTIME_SCRIPT + HEAD_SCRIPT, /innerHTML|eval|Function\(|fetch|XMLHttpRequest/);
  assert.match(html, /default-src 'none'/);
});

test('render: 視覚仕様の契約（文字・見出し・CTA・固定CTA・動き）— FV v3（1訴求・主役1つ・CTA1つ）', () => {
  // 旧 v2 仕様（H1 52/31/28/26px・2カラム 1.35fr）はユーザーレビューで FV が不合格になったため v3 に置き換えた。
  // 実際に効いている値（cascade の結果）は E2E の getComputedStyle で 320/360/400/1280 ごとに確認する。
  for (const p of [seed(), seed2()]) {
    const { html } = renderPage(p, { kind: 'review' });
    const css = html.match(/<style>[\s\S]*?<\/style>/)[0];
    for (const s of [
      'font-size:16px;line-height:1.8;font-weight:400', // 本文
      '.hero h1{font-size:64px;line-height:1.22;font-weight:800;letter-spacing:-.03em', // PC H1
      '.hero h1{font-size:36px;line-height:1.25}', // SP H1
      '.hero h1{font-size:30px}', // 〜359px
      '.sec h2{font-size:36px;line-height:1.35', 'font-size:28px;line-height:1.4', // H2 PC / SP
      'max-width:1160px', 'max-width:640px', 'scroll-padding-bottom:96px',
      'height:56px', 'bottom:max(12px,env(safe-area-inset-bottom))', // 固定CTA
      'prefers-reduced-motion', '.hl{animation:hl .4s ease .7s both}', '.btn-hero{min-width:300px;min-height:64px',
    ]) assert.ok(css.includes(s), `${p.id}: ${s}`);
    // 旧 FV の上書きされた H1 指定を残さない（指定の出どころを1つにする）
    for (const dead of ['.hero h1{font-size:52px', '.hero h1{font-size:31px', '.hero h1{font-size:28px}', '.hero h1{font-size:26px}', '.hero h1{font-size:42px}']) assert.ok(!css.includes(dead), dead);
    assert.doesNotMatch(html, /data-count|infinite|rotate\(3/); // カウントアップ・無限の動き・飾りの回転なし
    assert.match(html, /<html lang="ja"><head>[\s\S]*<script>[^<]*classList\.add\('js'\)/); // js クラスは head で付ける
    assert.doesNotMatch(css, /\.js \.hero h1|\.js \.lead|\.js \.btn|\.js \.hero-copy|\.js \.hero-cta|\.js \.hero-photo/); // 文字・CTA・顔写真は動かさない（図だけ登場）
    // FV: CTA は1つだけ・無効の予約ボタンは FV に置かない
    const hero = html.match(/<header class="hero[\s\S]*?<\/header>/)[0];
    assert.equal((hero.match(/class="btn /g) || []).length, 1, p.id);
    assert.doesNotMatch(hero, /disabled|aria-disabled/);
    assert.equal((hero.match(/<h1>/g) || []).length, 1);
  }
  // 顔写真版は写真の上に文字を重ねない SP 配置と、PC での見出し 56px
  const { html } = renderPage(seed(), { kind: 'review' });
  assert.match(html, /\.hero-portrait h1\{font-size:56px\}/);
  assert.match(html, /\.hero-portrait h1\{font-size:32px\}/);
  assert.match(html, /\.js \.hero-visual\{animation:vin \.6s cubic-bezier\(\.2,\.7,\.2,1\) \.28s both\}/);
});

test('segment: 意味のまとまりで区切り、語の途中で切らない', () => {
  assert.deepEqual(autoPhrases('今夜やることは、もう決まっている。'), ['今夜やることは、', 'もう', '決まっている。']);
  assert.deepEqual(autoPhrases('都合のよい日時を選ぶ'), ['都合のよい', '日時を', '選ぶ']);
  for (const t of ['「何からやろう」で、今夜を終わらせない。', '返事待ちの見積もりを、チームで追える一覧に。']) assert.equal(autoPhrases(t).join(''), t);
  assert.equal(headingPhrases('ab', ['a', 'c']).source, 'fallback-mismatch');
});
