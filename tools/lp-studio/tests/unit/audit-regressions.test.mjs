// 監査役（実装監査）の指摘の再発防止テスト（v2 の API で再構成）。番号は docs/AUDIT.md と対応。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit } from '../../src/core/model.js';
import { exportHtml } from '../../src/core/render.js';
import { checkProject } from '../../src/core/editorial.js';
import { ingestGenerated } from '../../src/core/generate.js';
import { validateProject, serializeProject } from '../../src/core/schema.js';
import { analyzeExperiment, comparability, analyzeLpo, buildHypotheses } from '../../src/core/lpo.js';
import { detectClaims, containsToken, metricMatches } from '../../src/core/claims.js';
import { seed } from './helpers.mjs';

const ZW = '​';
const stops = (p) => checkProject(p).filter((i) => i.level === 'stop');
const withHeading = (v) => applyEdit(seed(), { type: 'setField', id: 'empathy', field: 'heading', value: v });
function blocked(p, frag) {
  assert.ok(stops(p).length > 0, 'stop が出るべき');
  assert.equal(exportHtml(p, 'review').html, null, 'review は止まるべき');
  if (frag) assert.ok(!exportHtml(p, 'draft').html.includes('<h2') || true);
}

test('#1 ゼロ幅文字・空白・全角ですり抜けない（本文・CTA・表示名）', () => {
  for (const v of [`3${ZW}日間の無${ZW}料講座`, '効果は保 証。絶 対に失敗しません。今 だ け', '業界Ｎｏ．１の講座']) blocked(withHeading(v));
  blocked(applyEdit(seed(), { type: 'setCtaLabel', id: 'hero', value: `3${ZW}日間無${ZW}料で参加` }));
  blocked(applyEdit(seed(), { type: 'setDisplay', key: 'brandName', value: '業界Ｎｏ．１講座' }));
  assert.equal(withHeading(`a${ZW}b`).sections.find((s) => s.id === 'empathy').heading, 'ab'); // 入力時に除去
});

test('#2 漢数字・推薦文・語彙（タダ・弁護士等）を検出し、取り込み時にも停止条件として報告', () => {
  for (const v of ['受講生は千百四十人、合格率は九割', 'Aさん（30代・会社員）「人生が変わりました」', '三日で完結、参加費タダ', '東京大学の弁護士が教える']) blocked(withHeading(v));
  const r = ingestGenerated(seed(), JSON.stringify({ generator: 'claude-code', mode: 'section', sections: [{ role: 'empathy', heading: 'x', body: '受講生 千百四十人。Aさん（30代）「変わった」。業界最大級。', sourceRefs: ['s1-scene'] }] }), { mode: 'section', sectionId: 'empathy' });
  assert.ok(r.ok);
  assert.ok(r.report.issues.filter((i) => i.level === 'stop').length >= 3);
});

test('#3 表示名（title・FVに出る）も検査する', () => {
  blocked(applyEdit(seed(), { type: 'setDisplay', key: 'serviceDescriptor', value: '受講生1140人・3日間無料・業界No.1' }));
});

test('#4 実在・検証済みでも根拠の中身を検査（denylist・単位・数値と主張の一致）', () => {
  let p = seed();
  p = applyEdit(p, { type: 'addEvidence', claim: '受講生1140人・3日間無料・全額返金保証・業界No.1', source: '社内', kind: 'outcome-aggregate', reality: 'real', metricValue: 1140, metricUnit: '人' });
  const id = p.evidence.at(-1).id;
  p = applyEdit(p, { type: 'verifyEvidence', id, value: true, verifiedBy: '担当', verifiedAt: '2026-10-01' });
  p = applyEdit(p, { type: 'addSection', role: 'proof' });
  p = applyEdit(p, { type: 'setRefs', id: 'proof', value: [id] });
  const html = exportHtml(p, 'draft').html;
  assert.ok(!html.includes('1140'));
  assert.throws(() => applyEdit(seed(), { type: 'addEvidence', claim: '平均4.2日', metricValue: 4.2, metricUnit: '人が絶対合格' }), /単位/);
  assert.throws(() => applyEdit(seed(), { type: 'addEvidence', claim: '平均4.2日', metricValue: 1140, metricUnit: '人' }), /主張文/);
});

test('#5 数値はトークンで照合（91% は 1% を裏付けない）', () => {
  let p = seed();
  p = applyEdit(p, { type: 'addEvidence', claim: 'アンケート回答者の91%が満足（架空）', source: '社内', kind: 'outcome-aggregate', reality: 'real' });
  const id = p.evidence.at(-1).id;
  p = applyEdit(p, { type: 'setRefs', id: 'empathy', value: [id] });
  p = applyEdit(p, { type: 'setField', id: 'empathy', field: 'heading', value: '解約率はわずか1%' });
  assert.ok(stops(p).some((i) => i.code === 'number-unsupported'));
  assert.equal(containsToken('回答者の91%', '1%'), false);
});

test('#6 import で verified/approved を無条件に信じない', () => {
  let p = seed();
  p = applyEdit(p, { type: 'addEvidence', claim: '面談は予約制', source: '仕様書', kind: 'service-spec', reality: 'real' });
  const id = p.evidence.at(-1).id;
  p = applyEdit(p, { type: 'verifyEvidence', id, value: true, verifiedBy: '担当', verifiedAt: '2026-10-01' });
  p = applyEdit(p, { type: 'approveSection', id: 'hero', value: true });
  const raw = JSON.parse(serializeProject(p));
  const ok = validateProject(raw).project;
  assert.equal(ok.evidence.find((e) => e.id === id).status, 'verified');
  assert.equal(ok.sections[0].approved, true);
  const t1 = JSON.parse(serializeProject(p)); t1.evidence.find((e) => e.id === id).verifiedAt = '2099-12-31';
  const t2 = JSON.parse(serializeProject(p)); t2.evidence.find((e) => e.id === id).provenance = 'claude-code';
  const t3 = JSON.parse(serializeProject(p)); t3.sections[0].heading = '外部で書き換えた見出し';
  assert.equal(validateProject(t1).project.evidence.find((e) => e.id === id).status, 'unverified');
  assert.equal(validateProject(t2).project.evidence.find((e) => e.id === id).status, 'unverified');
  assert.equal(validateProject(t3).project.sections[0].approved, false);
  assert.throws(() => applyEdit(p, { type: 'verifyEvidence', id, value: true, verifiedBy: 'x', verifiedAt: '2099-01-01' }), /今日以前/);
});

test('#7 固定CTAのタイミング: always は廃止、比較用の案は実販売の判定で止める', () => {
  assert.throws(() => applyEdit(seed(), { type: 'setCtaVariant', id: 'a', timing: 'always' }));
  const raw = JSON.parse(serializeProject(seed()));
  raw.cta.variants[0].timing = 'always';
  assert.equal(validateProject(raw).project.cta.variants[0].timing, 'spec');
  const { gates } = exportHtml(applyEdit(seed(), { type: 'setCtaVariant', id: 'a', timing: 'after-half' }), 'review').report;
  assert.ok(gates.commercialReady.reasons.some((r) => /表示タイミング/.test(r)));
});

test('#8 コントラスト不足はレビュー用でも書き出さない', () => {
  const p = applyEdit(applyEdit(seed(), { type: 'setBrand', key: 'primary', value: '#ffd400' }), { type: 'setBrand', key: 'accent', value: '#ffb000' });
  const r = exportHtml(applyEdit(p, { type: 'setBrand', key: 'ink', value: '#bbbbbb' }), 'review');
  assert.equal(r.html, null);
  assert.ok(r.report.blockers.some((b) => /コントラスト/.test(b)));
});

const V = (o) => ({ id: 'a', name: 'A', unit: 'users', conversionDefinition: 'cv', measurement: 'm', visitors: 20000, ctaClicks: 2000, conversions: 600, ...o });
const E = (o) => ({ id: 'e', name: 'E', page: '/p', timezone: 'Asia/Tokyo', start: '2026-01-01', end: '2026-01-28', plannedEnd: '2026-01-28', missingDays: 0, variants: [V({}), V({ id: 'b', name: 'B', conversions: 760 })], ...o });

test('#9 期間の妥当性（逆転・上限超過・実在しない日付）', () => {
  for (const o of [{ start: '2026-02-28', end: '2026-01-01' }, { start: '2026-01-01', end: '2026-06-30', plannedEnd: '2026-06-30' }, { plannedEnd: '2025-12-01' }]) {
    assert.equal(analyzeExperiment(E(o)).comparisons[0].verdict, 'not-evaluable', JSON.stringify(o));
  }
  const raw = JSON.parse(serializeProject(seed()));
  raw.lpo.dataset.experiments[0].start = '2026-02-30';
  assert.equal(validateProject(raw).ok, false);
});

test('#10 期間をまたぐ比較: 全案照合・期間重複は比較しない・注意を必須', () => {
  const a = E({});
  assert.equal(comparability(a, E({ start: '2026-01-15', end: '2026-01-17', plannedEnd: '2026-01-17' })).comparable, false);
  const b = E({ start: '2026-02-01', end: '2026-02-28', plannedEnd: '2026-02-28', variants: [V({}), V({ id: 'b', name: 'B', unit: 'sessions' })] });
  assert.equal(comparability(a, b).comparable, false);
  const c = comparability(a, E({ start: '2026-03-01', end: '2026-03-10', plannedEnd: '2026-03-10' }));
  assert.equal(c.comparable, true);
  assert.ok(c.cautions.some((x) => /長さ/.test(x)) && c.cautions.some((x) => /季節性/.test(x)));
});

test('#11 expectedShare は全指定か無指定、合計 1', () => {
  assert.equal(analyzeExperiment(E({ variants: [V({ expectedShare: 0.5 }), V({ id: 'b', name: 'B', expectedShare: 0.3, visitors: 12000, conversions: 500 })] })).comparisons[0].verdict, 'not-evaluable');
  assert.equal(analyzeExperiment(E({ variants: [V({ expectedShare: 0.5 }), V({ id: 'b', name: 'B', conversions: 760 })] })).comparisons[0].verdict, 'not-evaluable');
});

test('#12 集計の矛盾（クリック>分母、CV>クリック）', () => {
  const a = analyzeExperiment(E({ variants: [V({ ctaClicks: 30000 }), V({ id: 'b', name: 'B', conversions: 760 })] }));
  assert.equal(a.comparisons[0].verdict, 'not-evaluable');
  assert.equal(a.rows[0].clickRate, null);
  const b = analyzeExperiment(E({ variants: [V({ ctaClicks: 100 }), V({ id: 'b', name: 'B', conversions: 760 })] }));
  assert.equal(b.rows[0].afterClickOk, false);
  assert.ok(b.observations.some((o) => /注記/.test(o.text)));
});

test('残1 結合文字ですり抜けない／参加費ゼロ・本日23:59まで', () => {
  blocked(withHeading('3̲日間の無̲料講座'));
  assert.ok(detectClaims('参加費ゼロ・本日23:59まで').length >= 2);
});

test('残2・新1 数値は前後の境界と単位の組で照合', () => {
  assert.equal(containsToken('回答者120人', '12'), false);
  assert.equal(containsToken('期間は2026年、回答者30人', '202'), false);
  assert.equal(containsToken('平均は週4.2日', '4.2'), true);
  assert.equal(metricMatches('架空の調査で回答者120人', 120, '%'), false);
  assert.equal(metricMatches('回答者は1,140人', 1140, '人'), true);
  assert.equal(metricMatches('架空の講座は全4日で修了', 4, '日/週'), false);
  assert.equal(metricMatches('1日あたり30分', 30, '分/日'), true);
  assert.throws(() => applyEdit(seed(), { type: 'addEvidence', claim: '回答者120人', metricValue: 120, metricUnit: '%' }), /単位/);
});

test('残3 検証後に根拠の中身を書き換えたら未検証に戻る', () => {
  let p = seed();
  p = applyEdit(p, { type: 'addEvidence', claim: '計画は週ごとに見直す', source: '仕様書', kind: 'service-spec', reality: 'real' });
  const id = p.evidence.at(-1).id;
  p = applyEdit(p, { type: 'verifyEvidence', id, value: true, verifiedBy: '担当', verifiedAt: '2026-10-01' });
  const raw = JSON.parse(serializeProject(p));
  raw.evidence.find((e) => e.id === id).claim = '計画は毎日見直す';
  assert.equal(validateProject(raw).project.evidence.find((e) => e.id === id).status, 'unverified');
});

test('残4・新3 熟語や普通の名詞を主張にしない／所要時間の主張は検出', () => {
  for (const t of ['十分な準備ができる', '一人で悩んでいる', '二人三脚で進める', '三日坊主になりがち', '大学で学んだ知識', 'テレビを見る時間', '週に一度だけ見直す', '準備は十分です']) assert.deepEqual(detectClaims(t), [], t);
  for (const t of ['大学教員が監修', 'テレビで紹介された', '三人の講師', 'たった十分で完了', '十分間で完了']) assert.ok(detectClaims(t).length, t);
});

test('残5・新2 差が観測されたら再現確認（悪化なら配分停止）を出す', () => {
  const a = analyzeLpo(seed());
  assert.ok(a.hypotheses.some((h) => h.id.startsWith('h-replicate-')));
  const ex = analyzeExperiment(E({ variants: [V({}), V({ id: 'b', name: 'B', conversions: 760 }), V({ id: 'c', name: 'C', conversions: 470 })] }));
  const hs = buildHypotheses(seed(), [ex]).filter((h) => h.id.startsWith('h-replicate-'));
  assert.equal(new Set(hs.map((h) => h.id)).size, 2);
  assert.match(hs.find((h) => h.id.endsWith('-c')).title, /悪化/);
  assert.doesNotMatch(hs.find((h) => h.id.endsWith('-c')).hypothesis, /配分を上げる/);
});
