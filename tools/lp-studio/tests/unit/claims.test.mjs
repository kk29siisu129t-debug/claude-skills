import test from 'node:test';
import assert from 'node:assert/strict';
import { detectClaims, resolveTokens, assessText, auditProject, REFERENCE_DENYLIST } from '../../src/core/claims.js';
import { applyEdit } from '../../src/core/model.js';
import { seed } from './helpers.mjs';

const cats = (t, c) => detectClaims(t, c).map((x) => x.category);

test('数値・最上級・保証・煽り・権威・推薦・オファーを検出する', () => {
  assert.ok(cats('受講生3,000人が参加').includes('number'));
  assert.ok(cats('業界No.1の実績').includes('superlative'));
  assert.ok(cats('必ず合格できます').includes('guarantee'));
  assert.ok(cats('今だけ限定').includes('urgency'));
  assert.ok(cats('医師が推奨').includes('authority'));
  assert.ok(cats('お客様の声').includes('testimonial'));
  assert.ok(cats('初回無料').includes('offer'));
  assert.deepEqual(cats('落ち着いて学べる'), []);
  // 過検出しない: 差込トークンや英単語の一部
  assert.deepEqual(cats('{{offer}} / office / Coffee'), []);
  assert.ok(cats('全品20%OFF').includes('offer'));
});

test('参考LP固有の値（denylist）と薬機法語彙', () => {
  assert.ok(REFERENCE_DENYLIST.length > 3);
  for (const t of ['3日間で学ぶ', '月100人まで', '受講生1,140人突破', '１１４０人']) {
    assert.ok(detectClaims(t).some((c) => c.category === 'reference' && c.severity === 'block'), t);
  }
  assert.ok(detectClaims('肌が若返る', 'beauty').some((c) => c.category === 'pharma'));
  assert.ok(!detectClaims('肌が若返る', 'education').some((c) => c.category === 'pharma'));
});

test('差込は confirmed のときだけ解決扱い', () => {
  const p = seed();
  const a = resolveTokens('{{product}} / {{offer}} / {{price}} / {{evil}}', p.brief);
  assert.match(a.text, /ミチシルベ/);
  assert.deepEqual(a.unresolved.map((u) => [u.key, u.reason]), [['offer', 'unconfirmed'], ['price', 'missing'], ['evil', 'unknown']]);
});

test('主張は claimRefs の verified 根拠に同じ値があれば解決、未検証では解決しない', () => {
  const p = seed();
  const fv = p.sections.find((s) => s.type === 'fv');
  assert.equal(assessText(p, fv, '毎晩15分').publishable, true);
  const noRef = { ...fv, claimRefs: [] };
  assert.equal(assessText(p, noRef, '毎晩15分').publishable, false);
  const proof = p.sections.find((s) => s.type === 'proof');
  assert.equal(assessText(p, proof, '満足度92%').publishable, false); // ev-voice は未検証
  assert.equal(assessText(p, proof, '週4.2日').publishable, true);
  assert.equal(assessText(p, proof, '【要記入: 何か】').publishable, false);
});

test('auditProject は未確定・未検証・未承認・根拠なしを列挙する', () => {
  let p = seed();
  p = applyEdit(p, { type: 'setField', id: 'closing', field: 'body', value: '業界No.1。必ず合格。' });
  const levels = auditProject(p).map((i) => i.level);
  for (const l of ['unconfirmed', 'missing', 'unverified', 'unapproved', 'claim']) assert.ok(levels.includes(l), l);
});
