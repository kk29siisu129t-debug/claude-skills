import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, emptyProject } from '../../src/core/model.js';
import { validateProject, serializeProject } from '../../src/core/schema.js';
import { seed } from './helpers.mjs';

test('編集は純関数（元の project を変えない）で、結果は常に schema に通る', () => {
  const p = seed();
  const before = serializeProject(p);
  const ops = [
    { type: 'setBrief', key: 'offer', value: '初回面談', status: 'confirmed' },
    { type: 'setField', id: 'empathy', field: 'items', value: 'a\n\nb\nc' },
    { type: 'moveSection', id: 'recommit', delta: -1 },
    { type: 'addSection', sectionType: 'price_reason', at: 3 },
    { type: 'addSection', sectionType: 'concept_video', at: 1 },
    { type: 'setCtaVariant', id: 'b', color: '#123456', timing: 'always' },
    { type: 'addCtaVariant' },
    { type: 'addEvidence', claim: '面談は60分', source: '仕様書', sourceType: 'policy' },
  ];
  let q = p;
  for (const op of ops) {
    q = applyEdit(q, op);
    const v = validateProject(JSON.parse(serializeProject(q)));
    assert.ok(v.ok, `${op.type}: ${v.errors.join()}`);
  }
  assert.equal(serializeProject(p), before);
  assert.deepEqual(q.sections.find((s) => s.id === 'empathy').fields.items, ['a', 'b', 'c']);
  assert.equal(q.sections[1].type, 'concept_video');
});

test('必須セクションは削除できず、任意セクションは削除できる', () => {
  const p = seed();
  assert.throws(() => applyEdit(p, { type: 'removeSection', id: 'fv' }), /必須/);
  const q = applyEdit(p, { type: 'removeSection', id: 'recommit' });
  assert.ok(!q.sections.some((s) => s.id === 'recommit'));
});

test('編集すると承認が外れ、承認は明示操作', () => {
  const p = seed();
  assert.equal(p.sections[0].approved, true);
  const q = applyEdit(p, { type: 'setField', id: 'fv', field: 'heading', value: '新しい見出し' });
  assert.equal(q.sections[0].approved, false);
  assert.equal(q.sections[0].origin, 'manual');
  assert.equal(applyEdit(q, { type: 'approveSection', id: 'fv', value: true }).sections[0].approved, true);
});

test('根拠の検証済み化は確認者・確認日・出典が必須', () => {
  const p = seed();
  assert.throws(() => applyEdit(p, { type: 'verifyEvidence', id: 'ev-voice', value: true, verifiedBy: '', verifiedAt: '2026-10-01' }), /確認者/);
  assert.throws(() => applyEdit(p, { type: 'verifyEvidence', id: 'ev-voice', value: true, verifiedBy: '担当', verifiedAt: '10/1' }), /確認日/);
  const q = applyEdit(p, { type: 'verifyEvidence', id: 'ev-voice', value: true, verifiedBy: '担当', verifiedAt: '2026-10-01' });
  assert.equal(q.evidence.find((e) => e.id === 'ev-voice').status, 'verified');
  const r = applyEdit(q, { type: 'verifyEvidence', id: 'ev-voice', value: false });
  assert.equal(r.evidence.find((e) => e.id === 'ev-voice').verifiedBy, '');
});

test('危険な入力は編集段階で拒否', () => {
  const p = seed();
  assert.throws(() => applyEdit(p, { type: 'setBrief', key: 'ctaUrl', value: 'javascript:alert(1)' }), /https/);
  assert.throws(() => applyEdit(p, { type: 'setBrand', key: 'primary', value: 'red' }), /#RRGGBB/);
  assert.throws(() => applyEdit(p, { type: 'setCtaVariant', id: 'a', color: '#fff;x' }));
  assert.throws(() => applyEdit(p, { type: 'setBrief', key: '__proto__', value: 'x' }));
  assert.throws(() => applyEdit(p, { type: 'nope' }));
});

test('空の値は status を missing に、値を入れると unconfirmed に', () => {
  let p = emptyProject();
  p = applyEdit(p, { type: 'setBrief', key: 'product', value: 'X' });
  assert.equal(p.brief.product.status, 'unconfirmed');
  p = applyEdit(p, { type: 'setBrief', key: 'product', value: '' , status: 'confirmed' });
  assert.equal(p.brief.product.status, 'missing');
});
