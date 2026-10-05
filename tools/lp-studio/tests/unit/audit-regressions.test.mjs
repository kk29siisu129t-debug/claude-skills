// 監査役（実装監査）の指摘 12 件の再発防止テスト。番号は docs/AUDIT.md と対応。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit } from '../../src/core/model.js';
import { exportHtml } from '../../src/core/render.js';
import { ingestGenerated } from '../../src/core/generate.js';
import { validateProject, serializeProject } from '../../src/core/schema.js';
import { analyzeExperiment, comparability } from '../../src/core/lpo.js';
import { seed } from './helpers.mjs';

const ZW = '​';
function publishWith(mut) {
  let p = mut(seed());
  for (const s of p.sections) if (!s.approved) p = applyEdit(p, { type: 'approveSection', id: s.id, value: true });
  return exportHtml(p, 'safe');
}

test('#1 ゼロ幅文字・空白・全角ですり抜けない（本文・CTA・FVチップ）', () => {
  for (const heading of [`3${ZW}日間の無${ZW}料講座`, '効果は保 証。絶 対に失敗しません。今 だ け', '業界Ｎｏ．１の講座']) {
    const { html, report } = publishWith((p) => applyEdit(p, { type: 'setField', id: 'empathy', field: 'heading', value: heading }));
    assert.ok(html, report.blockers.join());
    for (const w of ['日間の無', '保 証', '絶 対', 'Ｎｏ．１', 'No.1']) assert.ok(!html.includes(w), `${heading}: ${w}`);
  }
  const cta = publishWith((p) => applyEdit(p, { type: 'setCtaVariant', id: 'a', label: `3${ZW}日間無${ZW}料で参加` }));
  assert.equal(cta.html, null);
  const chip = publishWith((p) => applyEdit(p, { type: 'setBrief', key: 'product', value: '業界Ｎｏ．１講座', status: 'confirmed' }));
  assert.ok(chip.html === null || !chip.html.includes('No.1'));
  if (chip.html) assert.ok(!/業界(Ｎｏ．１|No\.1)講座/.test(chip.html));
  // 入力段階でゼロ幅文字を除去
  assert.equal(applyEdit(seed(), { type: 'setField', id: 'empathy', field: 'heading', value: `a${ZW}b` }).sections[1].fields.heading, 'ab');
});

test('#2 漢数字・推薦文・語彙（タダ・弁護士等）を検出し、ingest でも拒否', () => {
  for (const v of ['受講生は千百四十人、合格率は九割', 'Aさん（30代・会社員）「人生が変わりました」', '三日で完結、参加費タダ', '東京大学の弁護士が教える']) {
    const { html } = publishWith((p) => applyEdit(p, { type: 'setField', id: 'empathy', field: 'heading', value: v }));
    assert.ok(html && !html.includes(v.slice(0, 6)), v);
  }
  const r = ingestGenerated(seed(), JSON.stringify({ generator: 'claude-code', mode: 'section', sections: [{ type: 'empathy', fields: { items: ['受講生 千百四十人', 'Aさん（30代）「変わった」', '業界最大級', '毎晩15分で進める', '落ち着いて学べる'] } }] }), { mode: 'section', sectionId: 'empathy' });
  assert.ok(r.ok);
  assert.deepEqual(r.project.sections.find((s) => s.id === 'empathy').fields.items, ['毎晩15分で進める', '落ち着いて学べる']); // 15分は確定ブリーフ・verified 根拠にある
  assert.equal(r.report.rejected.length, 3);
});

test('#3 プロジェクト名（title）も検査する', () => {
  const { html, report } = publishWith((p) => applyEdit(p, { type: 'setName', value: '受講生1140人・3日間無料・業界No.1 保証' }));
  assert.equal(html, null);
  assert.ok(report.blockers.some((b) => /ページタイトル/.test(b)));
});

test('#4 verified 根拠の中身も検査（denylist・単位 allowlist・数値と主張の一致）', () => {
  let p = seed();
  p = applyEdit(p, { type: 'addEvidence', claim: '受講生1140人・3日間無料・全額返金保証・業界No.1', source: '社内', sourceType: 'internal-data', metricValue: 1140, metricUnit: '人' });
  const id = p.evidence.at(-1).id;
  p = applyEdit(p, { type: 'verifyEvidence', id, value: true, verifiedBy: '担当', verifiedAt: '2026-10-01' });
  const proof = p.sections.find((s) => s.type === 'proof');
  p = applyEdit(p, { type: 'setClaimRefs', id: proof.id, value: [...proof.claimRefs, id] });
  p = applyEdit(p, { type: 'approveSection', id: proof.id, value: true });
  const { html, report } = exportHtml(p, 'safe');
  assert.ok(html);
  assert.ok(!html.includes('1140') && !html.includes('1,140'));
  assert.ok(report.removed.some((r) => /参考LP固有/.test(r.reasons.join())));
  assert.throws(() => applyEdit(seed(), { type: 'addEvidence', claim: '平均4.2日', metricValue: 4.2, metricUnit: '人が絶対合格' }), /単位/);
  assert.throws(() => applyEdit(seed(), { type: 'addEvidence', claim: '平均4.2日', metricValue: 1140, metricUnit: '人' }), /主張文/);
  const cand = ingestGenerated(seed(), JSON.stringify({ generator: 'claude-code', mode: 'section', sections: [{ type: 'empathy', fields: {} }], evidenceCandidates: [{ claim: '受講生1140人', source: 'x' }] }), { mode: 'section', sectionId: 'empathy' });
  assert.ok(!cand.project.evidence.some((e) => e.claim.includes('1140')));
});

test('#5 数値はトークンで照合（91% は 1% を裏付けない）、CTA は参照根拠に限定', () => {
  let p = seed();
  p = applyEdit(p, { type: 'addEvidence', claim: 'アンケート回答者の91%が満足（架空）', source: '社内', sourceType: 'internal-data' });
  const id = p.evidence.at(-1).id;
  p = applyEdit(p, { type: 'verifyEvidence', id, value: true, verifiedBy: '担当', verifiedAt: '2026-10-01' });
  p = applyEdit(p, { type: 'setClaimRefs', id: 'empathy', value: [id] });
  p = applyEdit(p, { type: 'setField', id: 'empathy', field: 'heading', value: '解約率はわずか1%' });
  p = applyEdit(p, { type: 'approveSection', id: 'empathy', value: true });
  const { html } = exportHtml(p, 'safe');
  assert.ok(html && !html.includes('解約率はわずか1%'));
  // CTA 文言は FV/再コミット/クロージングが参照していない根拠では解決しない
  const q = applyEdit(p, { type: 'setCtaVariant', id: 'a', label: '91%が満足の面談を予約' });
  assert.equal(exportHtml(q, 'safe').html, null);
});

test('#6 import で verified/approved を無条件に信じない', () => {
  const raw = JSON.parse(serializeProject(seed()));
  raw.evidence[2].status = 'verified';
  raw.evidence[2].verifiedBy = 'x';
  raw.evidence[2].verifiedAt = '2099-12-31';
  raw.evidence[1].provenance = 'claude-code';
  raw.sections[1].fields.heading = '外部で書き換えた見出し';
  const r = validateProject(raw);
  assert.ok(r.ok);
  assert.equal(r.project.evidence[2].status, 'unverified');
  assert.equal(r.project.evidence[1].status, 'unverified');
  assert.equal(r.project.sections[1].approved, false);
  assert.equal(r.project.sections[0].approved, true);
  raw.evidence[0].verifiedAt = '2026-02-30';
  assert.equal(validateProject(raw).project.evidence[0].status, 'unverified');
  assert.throws(() => applyEdit(seed(), { type: 'verifyEvidence', id: 'ev-voice', value: true, verifiedBy: 'x', verifiedAt: '2099-01-01' }), /今日以前/);
});

test('#7 固定CTAのタイミング: always は廃止、safe は spec のみ', () => {
  assert.throws(() => applyEdit(seed(), { type: 'setCtaVariant', id: 'a', timing: 'always' }));
  const { html, report } = publishWith((p) => applyEdit(p, { type: 'setCtaVariant', id: 'a', timing: 'after-half' }));
  assert.equal(html, null);
  assert.ok(report.blockers.some((b) => /表示タイミング/.test(b)));
  const raw = JSON.parse(serializeProject(seed()));
  raw.cta.variants[0].timing = 'always';
  assert.equal(validateProject(raw).project.cta.variants[0].timing, 'spec');
});

test('#8 コントラスト: 描画している primary/白 の組合せも検査', () => {
  const { html, report } = publishWith((p) => applyEdit(applyEdit(p, { type: 'setBrand', key: 'primary', value: '#ffd400' }), { type: 'setBrand', key: 'accent', value: '#ffb000' }));
  assert.equal(html, null);
  assert.ok(report.blockers.some((b) => /コントラスト/.test(b)));
  const css = exportHtml(seed(), 'safe').html;
  assert.doesNotMatch(css, /\.src\{[^}]*opacity/); // 出典表記は不透明度で薄めない
  assert.match(css, /\.metric\{[^}]*var\(--primary-ink\)/);
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
  const bad = analyzeExperiment(E({ variants: [V({ expectedShare: 0.5 }), V({ id: 'b', name: 'B', expectedShare: 0.3, visitors: 12000, conversions: 500 })] }));
  assert.equal(bad.comparisons[0].verdict, 'not-evaluable');
  const partial = analyzeExperiment(E({ variants: [V({ expectedShare: 0.5 }), V({ id: 'b', name: 'B', conversions: 760 })] }));
  assert.equal(partial.comparisons[0].verdict, 'not-evaluable');
});

test('#12 集計の矛盾（クリック>分母、CV>クリック）', () => {
  const a = analyzeExperiment(E({ variants: [V({ ctaClicks: 30000 }), V({ id: 'b', name: 'B', conversions: 760 })] }));
  assert.equal(a.comparisons[0].verdict, 'not-evaluable');
  assert.equal(a.rows[0].clickRate, null);
  const b = analyzeExperiment(E({ variants: [V({ ctaClicks: 100 }), V({ id: 'b', name: 'B', conversions: 760 })] }));
  assert.equal(b.rows[0].afterClickOk, false);
});

// ---- 再検証（2回目）で残った指摘 ----
import { detectClaims, containsToken } from '../../src/core/claims.js';
import { analyzeLpo } from '../../src/core/lpo.js';

test('残1 結合文字（下線・濁点の付け外し）ですり抜けない', () => {
  const { html } = publishWith((p) => applyEdit(p, { type: 'setField', id: 'empathy', field: 'heading', value: '3̲日間の無̲料講座' }));
  assert.ok(html && !html.includes('日間の無'));
  assert.ok(detectClaims('参加費ゼロ・本日23:59まで').length >= 2);
});

test('残2 数値は前後の境界で照合（120人に12、2026年に202は無い）', () => {
  assert.equal(containsToken('回答者120人', '12'), false);
  assert.equal(containsToken('期間は2026年、回答者30人', '202'), false);
  assert.equal(containsToken('平均は週4.2日', '4.2'), true);
  assert.equal(containsToken('平均は週4.2日', '4'), false);
  assert.throws(() => applyEdit(seed(), { type: 'addEvidence', claim: '回答者120人', metricValue: 12, metricUnit: '人' }), /主張文/);
});

test('残3 検証後に根拠の中身を書き換えたら未検証に戻る', () => {
  const raw = JSON.parse(serializeProject(seed()));
  raw.evidence[0].claim = '【架空】面談後4週間の平均学習日数は週6.9日（書き換え）';
  raw.evidence[0].metricValue = null;
  const r = validateProject(raw);
  assert.equal(r.project.evidence[0].status, 'unverified');
  assert.ok(r.warnings.some((w) => /内容/.test(w)));
  assert.equal(validateProject(JSON.parse(serializeProject(seed()))).project.evidence[0].status, 'verified');
});

test('残4 熟語や普通の名詞を主張にしない（過検出の防止）', () => {
  for (const t of ['十分な準備ができる', '一人で悩んでいる', '二人三脚で進める', '三日坊主になりがち', '大学で学んだ知識', 'テレビを見る時間', '週に一度だけ見直す']) {
    assert.deepEqual(detectClaims(t), [], t);
  }
  for (const t of ['大学教員が監修', 'テレビで紹介された', '三人の講師', '千百四十人']) assert.ok(detectClaims(t).length, t);
});

test('残5 差が観測されたら再現確認の計画を出し、CV>クリックは注記する', () => {
  const a = analyzeLpo(seed());
  assert.ok(a.hypotheses.some((h) => h.id.startsWith('h-replicate-') && h.stopConditions.length && h.guardrails.length));
  const r = analyzeExperiment(E({ variants: [V({ ctaClicks: 100 }), V({ id: 'b', name: 'B', conversions: 760 })] }));
  assert.ok(r.observations.some((o) => /注記/.test(o.text)));
});

// ---- 最終再検証で出た指摘 ----
import { metricMatches } from '../../src/core/claims.js';
import { buildHypotheses } from '../../src/core/lpo.js';

test('新1 バッジの数値は単位と組で主張文に照合する', () => {
  assert.equal(metricMatches('架空の調査で回答者120人', 120, '%'), false);
  assert.equal(metricMatches('架空の調査で回答者120人', 120, '人'), true);
  assert.equal(metricMatches('平均学習日数は週4.2日', 4.2, '日/週'), true);
  assert.equal(metricMatches('回答者は1,140人', 1140, '人'), true);
  assert.throws(() => applyEdit(seed(), { type: 'addEvidence', claim: '回答者120人', metricValue: 120, metricUnit: '%' }), /単位/);
  const raw = JSON.parse(serializeProject(seed()));
  raw.evidence[0].metricUnit = '%';
  const r = validateProject(raw);
  assert.equal(r.project.evidence[0].metricValue, null); // 数値を外す
});

test('新2 悪化した案には配分を上げる提案を出さず、id は案ごとに一意', () => {
  const ex = E({ variants: [V({}), V({ id: 'b', name: 'B', conversions: 760 }), V({ id: 'c', name: 'C', conversions: 470 })] });
  const a = analyzeExperiment(ex);
  assert.deepEqual(a.comparisons.map((c) => c.verdict), ['difference-observed', 'difference-observed']);
  const hs = buildHypotheses(seed(), [a]).filter((h) => h.id.startsWith('h-replicate-'));
  assert.equal(new Set(hs.map((h) => h.id)).size, 2);
  const c = hs.find((h) => h.id.endsWith('-c'));
  assert.match(c.title, /悪化/);
  assert.doesNotMatch(c.hypothesis, /配分を上げる/);
  assert.match(hs.find((h) => h.id.endsWith('-b')).title, /改善/);
});

test('新3 「十分」は熟語のときだけ除外し、所要時間の主張は検出する', () => {
  for (const t of ['たった十分で完了', '十分間で完了', '十分で習得']) assert.ok(detectClaims(t).length, t);
  for (const t of ['十分な準備', '準備は十分です', '十分に理解する']) assert.deepEqual(detectClaims(t), [], t);
});

test('最終条件 「X/Y」単位は「/Y」側も主張文と照合する', () => {
  assert.equal(metricMatches('架空の講座は全4日で修了', 4, '日/週'), false);
  assert.equal(metricMatches('計3時間', 3, '時間/週'), false);
  assert.equal(metricMatches('週3回', 3, '回/週'), true);
  assert.equal(metricMatches('1日あたり30分', 30, '分/日'), true);
  assert.equal(metricMatches('平均学習日数は週4.2日', 4.2, '日/週'), true);
  assert.equal(metricMatches('学習は4.2日/週', 4.2, '日/週'), true);
});
