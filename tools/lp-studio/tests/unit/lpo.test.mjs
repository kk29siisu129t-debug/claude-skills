import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLpo, analyzeExperiment, comparability, requiredSamplePerArm, twoProportionP, chiSquareP, LPO_RULES } from '../../src/core/lpo.js';
import { seed } from './helpers.mjs';

const V = (o) => ({ id: 'a', name: 'A', expectedShare: 0.5, unit: 'users', conversionDefinition: 'cv', measurement: 'm', visitors: 20000, ctaClicks: 2000, conversions: 600, ...o });
const E = (o) => ({ id: 'e', name: 'E', page: '/p', timezone: 'Asia/Tokyo', start: '2026-01-01', end: '2026-01-28', plannedEnd: '2026-01-28', missingDays: 0, variants: [V({}), V({ id: 'b', name: 'B', conversions: 760 })], ...o });

test('統計関数の妥当性', () => {
  const n = requiredSamplePerArm(0.03);
  assert.ok(n > 13000 && n < 15000, String(n));
  assert.ok(twoProportionP(100, 1000, 100, 1000) > 0.99);
  assert.ok(Math.abs(chiSquareP(3.841, 1) - 0.05) < 0.002);
});

test('十分なサンプル・整合したデータでのみ差を判定する', () => {
  const a = analyzeExperiment(E({}));
  assert.equal(a.comparisons[0].verdict, 'difference-observed');
  assert.match(a.comparisons[0].reasons.join(), /因果/);
  const same = analyzeExperiment(E({ variants: [V({}), V({ id: 'b', name: 'B', conversions: 610 })] }));
  assert.equal(same.comparisons[0].verdict, 'no-detectable-difference');
  assert.match(same.comparisons[0].reasons.join(), /証明ではない/);
});

test('サンプル不足・欠損・期間未了・欠損日・定義違い・SRM では判定しない', () => {
  const cases = [
    E({ variants: [V({ visitors: 900, conversions: 40 }), V({ id: 'b', name: 'B', visitors: 900, conversions: 80 })] }),
    E({ variants: [V({}), V({ id: 'b', name: 'B', conversions: null })] }),
    E({ plannedEnd: '2026-02-15' }),
    E({ missingDays: 1 }),
    E({ variants: [V({}), V({ id: 'b', name: 'B', conversions: 760, unit: 'sessions' })] }),
    E({ variants: [V({}), V({ id: 'b', name: 'B', conversionDefinition: 'click', conversions: 760 })] }),
    E({ variants: [V({ visitors: 20000 }), V({ id: 'b', name: 'B', visitors: 17000, conversions: 760 })] }),
    E({ variants: [V({ conversions: 30000 }), V({ id: 'b', name: 'B', conversions: 760 })] }),
  ];
  for (const [i, c] of cases.entries()) {
    const a = analyzeExperiment(c);
    assert.equal(a.comparisons[0].verdict, 'not-evaluable', `case ${i}`);
    assert.equal(a.comparisons[0].p, null);
  }
  assert.ok(analyzeExperiment(cases[6]).srm.detected);
});

test('期間・分母・TZ・定義が異なる実験は比較しない', () => {
  const later = E({ start: '2026-02-01', end: '2026-02-28', plannedEnd: '2026-02-28' });
  const ok = comparability(E({}), later);
  assert.equal(ok.comparable, true);
  assert.ok(ok.cautions.some((c) => /季節性/.test(c)));
  assert.equal(comparability(E({}), E({})).comparable, false); // 期間重複
  const r = comparability(E({}), E({ timezone: 'UTC', variants: [V({ unit: 'sessions', conversionDefinition: 'click' })] }));
  assert.equal(r.comparable, false);
  assert.equal(r.reasons.length, 4); // TZ・分母・CV定義・期間重複
  assert.ok(r.reasons.some((x) => /重複/.test(x)));
});

test('seed の LPO: 架空バナー・未接続表示・観測と推測の分離・仮説の必須項目', () => {
  const a = analyzeLpo(seed());
  assert.ok(a.ok && a.fictional);
  assert.match(a.banner, /架空/);
  assert.ok(Object.values(a.connections).every((c) => c.connected === false));
  const byName = Object.fromEntries(a.analyses.map((x) => [x.id, x]));
  assert.equal(byName['exp-fv-aug'].comparisons[0].verdict, 'not-evaluable'); // 各群 約13,911 未満
  assert.equal(byName['exp-fv-full'].comparisons[0].verdict, 'difference-observed');
  assert.equal(byName['exp-cta-sep'].comparisons[0].verdict, 'not-evaluable');
  assert.ok(a.crossPeriod.some((c) => !c.comparable && c.reasons.some((r) => /分母/.test(r))));
  assert.ok(a.hypotheses.length >= 3);
  for (const h of a.hypotheses) {
    for (const k of ['id', 'title', 'evidenceType', 'basis', 'hypothesis', 'metric', 'guardrails', 'stopConditions', 'priority', 'caution']) assert.ok(k in h, `${h.id}.${k}`);
    assert.ok(['observed-fictional', 'project-audit', 'heuristic'].includes(h.evidenceType));
    assert.ok(h.stopConditions.length > 0);
  }
  for (let i = 1; i < a.hypotheses.length; i++) assert.ok(a.hypotheses[i - 1].priority.score >= a.hypotheses[i].priority.score);
});

test('出力に断定語（原因・勝者・確実・必ず・証明された）を含まない', () => {
  const text = JSON.stringify(analyzeLpo(seed()));
  for (const w of ['原因は', '原因です', '勝者', '確実', '必ず', '証明された']) assert.ok(!text.includes(w), w);
});

test('データセット未設定・実データは扱わない', () => {
  const p = seed();
  assert.equal(analyzeLpo({ ...p, lpo: { dataset: null } }).ok, false);
  assert.equal(analyzeLpo({ ...p, lpo: { dataset: { ...p.lpo.dataset, fictional: false } } }).ok, false);
  assert.equal(LPO_RULES.alpha, 0.05);
});
