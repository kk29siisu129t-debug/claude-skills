// 確定仕様の criticalSemanticTests / generalizationAcceptance / 重大な停止条件。
// 2つの架空ブリーフ（簿記の学習計画・見積もり共有ツール）を、同じ生成経路（prompt → Claude Code の JSON → ingest）で通した結果を検査する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit } from '../../src/core/model.js';
import { exportHtml, renderPage } from '../../src/core/render.js';
import { checkProject, gates, collectTexts, fvTextOf } from '../../src/core/editorial.js';
import { ingestGenerated, chooseAngle, buildPrompt } from '../../src/core/generate.js';
import { serializeProject, validateProject } from '../../src/core/schema.js';
import { seed, seed2, brief, RESPONSE } from './helpers.mjs';

const stops = (p) => checkProject(p).filter((i) => i.level === 'stop');
const text = (html) => html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<\/?span\b[^>]*>/g, '').replace(/<[^>]+>/g, ' '); // span（句・語の単位）は語の区切りではない
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
    // FV v3: FV の中は「架空デモ」バッジだけ。デモで申し込めないことは FV のすぐ下（after-fv）の注意書きと、無効の予約ボタンの直近に書く
    const hero = html.match(/<header class="hero[\s\S]*?<\/header>/)[0];
    assert.match(text(hero), /架空デモ/);
    assert.doesNotMatch(hero, /disabled|予約する/);
    const after = html.slice(html.indexOf('</header>')).match(/<section class="after-fv"[\s\S]*?<\/section>/);
    assert.ok(after, 'FV の直後に after-fv がある');
    assert.ok(text(after[0]).replace(/\s/g, '').includes(notice.replace(/\s/g, '').slice(0, 12)));
    const disabled = [...html.matchAll(/<span class="btn btn-disabled"[\s\S]*?<\/div>\s*<p class="cta-note">([\s\S]*?)<\/p>/g)];
    assert.equal(disabled.length, p.sections.filter((x) => x.commercialPreview).length, p.id); // 無効の予約ボタンは commercialPreview の数だけ・すべてに注記
    for (const m of disabled) assert.match(text(m[1]).replace(/\s/g, ''), /デモ/); // 無効の予約ボタンの直近にデモの旨
    assert.equal((html.match(/class="btn btn-disabled"/g) || []).length, disabled.length); // すべての無効ボタンに注記
    // v3: 上部の帯（demo-bar）はユーザー指示で FV 内の小さな「架空デモ」バッジに置き換え。詳細は FV 直下とフッター
    assert.match(hero, /<span class="demo-badge">架空デモ<\/span>/);
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
  // FV の主役: 簿記は顔写真（図なし）、見積もり番は架空データの一覧。仕組みの図も別の種類
  assert.ok(a.assets.heroPortrait && !heroA.visual && heroB.visual.kind === 'table' && !b.assets.heroPortrait);
  assert.notEqual(a.sections.find((s) => s.role === 'mechanism').visual.kind, b.sections.find((s) => s.role === 'mechanism').visual.kind);
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
  // 改行候補の期待値は fixture にハードコードせず、Claude Code が書いた response.json（入力）から取る
  for (const [p, id] of [[seed(), 'michishirube'], [seed2(), 'mitsumoriban']]) {
    const phrases = JSON.parse(RESPONSE(id)).sections.find((s) => s.role === 'hero').headingPhrases;
    assert.ok(phrases.length >= 2 && phrases.length <= 3, id); // H1 は意味の区切りで 2〜3 句（表示は E2E で2行以内を確認）
    assert.ok(p.insights.length && p.insights.every((i) => i.status === 'hypothesis'));
    const hero = p.sections.find((s) => s.role === 'hero');
    assert.deepEqual(hero.headingPhrases, phrases);
    const { html } = renderPage(p, { kind: 'review' });
    const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/)[1];
    assert.deepEqual(h1.split('<span class="ph">').slice(1).map((x) => x.replace(/<[^>]+>/g, '').replace(/&#39;|&quot;/g, '')), phrases.map((x) => x.replace(/["']/g, '')));
    // FV の補助文（無ければ本文）は、一般的な「サポート」「効率化」ではなく提供内容の動作を書く
    const support = hero.sub || hero.body;
    assert.ok(support.length >= 15 && /計画|見直|記録|分け|決め/.test(support), support);
  }
});

test('表示名・業態・試作表示を分け、対象者の呼びかけはFVで1回', () => {
  for (const p of [seed(), seed2()]) {
    const { html } = review(p);
    const t = text(html);
    // FV のラベルは商品ラベル（あれば）か対象者の呼びかけ。どちらも1回だけ
    const label = p.display.productLabel || p.display.audienceLabel;
    assert.equal(t.split(label).length - 1, 1, label);
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
  // rev3（監査役の指摘）で文言を「記録した案件は、担当者や状況で絞り込めます」に変更。存在する操作（絞り込み）だけを見せる
  assert.ok(tb.includes('担当者や状況で絞り込めます'));
  assert.match(seed2().sections.find((s) => s.role === 'mechanism').visual.title, /^絞り込み/);
  const { html } = review(seed());
  assert.match(html, /\.closing\{background:linear-gradient\(160deg,var\(--ink\)/);
  assert.match(html, /"IPAPGothic","IPAGothic"[^;]*,sans-serif/);
  assert.doesNotMatch(html.match(/--font:[^;]*/)[0], /Mincho|serif"/);
  const ta = text(html).replace(/\s/g, '');
  assert.ok((ta.match(/15分/g) || []).length <= 6, `15分 x${(ta.match(/15分/g) || []).length}`);
  assert.ok(!seed().sections.some((s) => s.role === 'illustration'));
  assert.equal(seed().sections.find((s) => s.role === 'mechanism').visual.kind, 'flow');
  // 調査ブリーフ版: FV の CTA は直下の提供内容の説明（process）へ移動する
  const ss = seed().sections;
  const heroI = ss.findIndex((s) => s.role === 'hero');
  assert.equal(ss[heroI].cta.target, ss[heroI + 1].id);
  assert.ok(ss[heroI + 1].items.length >= 3);
});

test('FV の汎用仕様: SP基準・文字量・主CTA1つ・顔素材が無ければ必要素材として示す・研究は設計メモだけ', () => {
  const a = seed();
  assert.equal(a.fvDesign.viewportFirst, 'sp');
  assert.equal(a.fvDesign.primaryCtas, 1);
  assert.ok(fvTextOf(a).length <= a.fvDesign.maxChars);
  assert.ok(!checkProject(a).some((i) => ['fv-long', 'asset-missing', 'research-in-copy'].includes(i.code)));
  // 研究・仮説・設計条件を分ける。出典の無い research は仮説へ落とす
  assert.deepEqual([...new Set(a.fvDesign.researchNotes.map((n) => n.status))].sort(), ['design-condition', 'hypothesis', 'research']);
  assert.ok(a.fvDesign.researchNotes.filter((n) => n.status === 'research').every((n) => n.source && n.caveat));
  const v = validateProject({ ...a, fvDesign: { ...a.fvDesign, researchNotes: [{ claim: '顔があると離脱が減る', status: 'research' }] } });
  assert.equal(v.project.fvDesign.researchNotes[0].status, 'hypothesis');
  // 研究や CVR を FV の文で主張したら停止
  const bad = applyEdit(a, { type: 'setField', id: 'hero', field: 'body', value: '心理学の研究で、離脱率が下がると分かっています。' });
  assert.ok(checkProject(bad).some((i) => i.code === 'research-in-copy' && i.level === 'stop'));
  // 研究の文言は LP 本文に出さない
  const html = renderPage(a, { kind: 'review' }).html;
  for (const n of a.fvDesign.researchNotes) assert.ok(!html.includes(n.claim), n.claim);
  assert.doesNotMatch(html, /Hutton|Sajjacholapunt|Tuch|Palcu|CVR|離脱率/);
  // 顔素材が無い2つ目のケース: 必要素材として示し、写真は出さない（無関係な写真・肩書・証言で埋めない）
  const b = seed2();
  assert.equal(b.assets.heroPortrait, null);
  assert.ok(checkProject(b).some((i) => i.code === 'asset-missing'));
  assert.doesNotMatch(renderPage(b, { kind: 'review' }).html, /<img\b/);
  // 架空と記録されていない顔写真はデモで停止
  const real = { ...a, assets: { heroPortrait: { ...a.assets.heroPortrait, fictional: false } } };
  assert.ok(checkProject(real).some((i) => i.code === 'portrait-not-fictional' && i.level === 'stop'));
  // FV の文字が多すぎると警告（説明は FV の下へ）
  const long = applyEdit(a, { type: 'setField', id: 'hero', field: 'sub', value: '面談で進み具合と使える時間を確認し、学習計画を一緒につくり、取り組む内容を細かく分けて、週ごとに見直します。' });
  assert.ok(checkProject(long).some((i) => i.code === 'fv-long'));
  // 生成指示に FV の汎用仕様が入っている
  const prompt = buildPrompt(brief('michishirube'), 'full');
  for (const w of ['SP（幅400px前後）を基準', 'maxChars', '主CTA は1つ', 'requiredAssets', '無関係な写真・架空の肩書・顧客の証言で穴埋めしない', 'researchNotes', 'design-condition', 'evaluationPlan', 'CVR の改善を約束しない']) assert.ok(prompt.includes(w), w);
});

test('FV の補助カードはユーザー差し戻しで撤去（顔・見出し・CTA だけ）。具体例は下のセクション', () => {
  const p = seed();
  const hero = p.sections.find((s) => s.role === 'hero');
  assert.equal(hero.visual, null);
  const h = renderPage(p, { kind: 'review' }).html.match(/<header class="hero[\s\S]*?<\/header>/)[0];
  assert.doesNotMatch(h, /hero-visual|class="plan|class="ring/);
  assert.ok(p.sections.find((s) => s.role === 'mechanism').visual); // 仕組みの図は下に残る
});

test('公開資料（学習者の体験・競合）は課題理解とインサイト仮説だけ。LP の根拠・口コミ・優位性にしない', () => {
  const p = seed();
  assert.ok(p.publicSources.length >= 3 && p.publicSources.every((x) => x.url.startsWith('https://') && x.caveat));
  assert.ok(p.publicSources.some((x) => x.kind === 'competitor' && /優位性/.test(x.caveat)));
  // インサイト仮説は公開資料を参照できる（仮説のまま）
  assert.ok(p.insights.some((i) => i.sourceRefs.some((r) => r.startsWith('pub-')) && i.status === 'hypothesis'));
  // LP 本文の参照には使わない
  assert.ok(p.sections.every((s) => [...s.sourceRefs, ...s.items.flatMap((i) => i.sourceRefs), ...(s.visual?.sourceRefs || [])].every((r) => !r.startsWith('pub-'))));
  // 編集 UI からは付けられない（台帳・根拠・原文の id だけ）
  assert.deepEqual(applyEdit(p, { type: 'setRefs', id: 'empathy', value: ['s1-scene', 'pub-funda-31'] }).sections.find((s) => s.role === 'empathy').sourceRefs, ['s1-scene']);
  // JSON を直接書き換えて付けても停止条件になる
  const bad = JSON.parse(JSON.stringify(p));
  bad.sections.find((s) => s.role === 'empathy').sourceRefs.push('pub-funda-31');
  assert.ok(checkProject(bad).some((i) => i.code === 'public-as-evidence' && i.level === 'stop'));
  // 取り込み時にも、セクションの参照から外す
  const r = JSON.parse(RESPONSE('michishirube'));
  r.sections.find((s) => s.role === 'empathy').sourceRefs.push('pub-crear-2kyu');
  const g = ingestGenerated(brief('michishirube'), JSON.stringify(r), { mode: 'full' });
  assert.ok(g.ok);
  assert.ok(!g.project.sections.find((s) => s.role === 'empathy').sourceRefs.includes('pub-crear-2kyu'));
  assert.ok(g.report.warnings.some((w) => /公開資料/.test(w)));
  assert.ok(g.project.insights.some((i) => i.sourceRefs.includes('pub-crear-2kyu')));
  // 描画に出さない（URL・体験談の要約・競合名）
  const html = renderPage(p, { kind: 'review' }).html;
  for (const x of p.publicSources) { assert.ok(!html.includes(x.url)); assert.ok(!html.includes(x.observation.slice(0, 20))); }
  assert.doesNotMatch(html, /スタディング|CREAR|Funda|合格体験|このサービスだけ|他社/);
  // 生成指示には、限界つきで入る
  const prompt = buildPrompt(brief('michishirube'), 'full');
  assert.ok(prompt.includes('pub-funda-31') && prompt.includes('LP の根拠・口コミ・実績・優位性には使わない'));
  // https 以外は記録しない
  const v = validateProject({ ...p, publicSources: [{ ...p.publicSources[0], url: 'javascript:alert(1)' }] });
  assert.ok(v.ok && v.project.publicSources.length === 0);
});

test('調査ブリーフ版の FV: 内心の問い＋提供内容で答える補助文＋CTA1つ。言わないことを守る', () => {
  const p = seed();
  const hero = p.sections.find((s) => s.role === 'hero');
  assert.equal(p.display.productLabel.length > 0, true);
  assert.ok(!hero.sub.includes('簿記2級')); // 商品ラベルの語を補助文で繰り返さない
  assert.equal(hero.visual, null);
  const t = text(review(p).html);
  for (const w of ['毎週面談', '専任講師', 'いつでも相談', 'し放題', '学力診断', '間に合う', '短期で合格', '得点が上がる', 'このサービスだけ', '合格率', 'お客様の声']) assert.ok(!t.includes(w), w);
  assert.ok(p.ledger.some((l) => l.id === 'u1-review' && l.kind === 'unknown'));
  assert.ok(!gates(p).commercialReady.ok);
  assert.ok(gates(p).commercialReady.reasons.some((r) => r.includes('週ごとの見直しの担当者')));
});
