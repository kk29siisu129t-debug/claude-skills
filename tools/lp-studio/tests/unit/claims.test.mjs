import test from 'node:test';
import assert from 'node:assert/strict';
import { detectClaims, REFERENCE_DENYLIST } from '../../src/core/claims.js';

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

