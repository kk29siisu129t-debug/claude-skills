import test from 'node:test';
import assert from 'node:assert/strict';
import { PotexScoring as S } from './load.js';

const fill = (v) => new Array(20).fill(v);
const byKey = (fn) => S.ITEMS.map((item) => fn(item));

test('項目は20問・指定どおりの順序と符号', () => {
  assert.equal(S.ITEMS.length, 20);
  const expected = [
    ['E', 1, '人の集まりでは、場を盛り上げる。'],
    ['A', 1, '他の人の気持ちに共感する。'],
    ['C', 1, '日々の用事をすぐに片づける。'],
    ['N', 1, '気分がよく変わる。'],
    ['O', 1, '生き生きとした想像をする。'],
    ['E', -1, 'あまり話さない。'],
    ['A', -1, '他の人にあまり関心がない。'],
    ['C', -1, '物を元の場所に戻すのをよく忘れる。'],
    ['N', -1, 'たいていリラックスしている。'],
    ['O', -1, '抽象的な考えを理解するのが難しい。'],
    ['E', 1, '人の集まりでは、いろいろな人と話す。'],
    ['A', 1, '他の人の感情を自分も感じる。'],
    ['C', 1, '物事が整っているのが好きだ。'],
    ['N', 1, 'すぐに動揺する。'],
    ['O', -1, '抽象的な考えに関心がない。'],
    ['E', -1, '目立たないようにしている。'],
    ['A', -1, '他の人が抱える問題に関心がない。'],
    ['C', -1, '物を散らかしてしまう。'],
    ['N', -1, '気分が沈むことはめったにない。'],
    ['O', -1, '想像力が豊かなほうではない。'],
  ];
  S.ITEMS.forEach((item, i) => {
    assert.equal(item.no, i + 1);
    assert.deepEqual([item.factor, item.keyed, item.text], expected[i]);
  });
});

test('因子ごとの項目番号', () => {
  assert.deepEqual([...S.FACTOR_ITEMS.E], [1, 6, 11, 16]);
  assert.deepEqual([...S.FACTOR_ITEMS.A], [2, 7, 12, 17]);
  assert.deepEqual([...S.FACTOR_ITEMS.C], [3, 8, 13, 18]);
  assert.deepEqual([...S.FACTOR_ITEMS.N], [4, 9, 14, 19]);
  assert.deepEqual([...S.FACTOR_ITEMS.O], [5, 10, 15, 20]);
  for (const f of S.FACTOR_ORDER) {
    for (const no of S.FACTOR_ITEMS[f]) assert.equal(S.ITEMS[no - 1].factor, f);
  }
});

const scoresOf = (r) => ({ ...S.scoreResponses(r) });
const all = (v) => ({ E: v, A: v, C: v, N: v, O: v });

test('尺度は1〜4の4択', () => {
  assert.equal(S.SCALE_MIN, 1);
  assert.equal(S.SCALE_MAX, 4);
});

test('全4 → E/A/C/N=2.5, O=1.75', () => {
  assert.deepEqual(scoresOf(fill(4)), { E: 2.5, A: 2.5, C: 2.5, N: 2.5, O: 1.75 });
});

test('全1 → E/A/C/N=2.5, O=3.25', () => {
  assert.deepEqual(scoresOf(fill(1)), { E: 2.5, A: 2.5, C: 2.5, N: 2.5, O: 3.25 });
});

test('正項目4・逆項目1 → 全因子4', () => {
  assert.deepEqual(scoresOf(byKey((it) => (it.keyed === 1 ? 4 : 1))), all(4));
});

test('正項目1・逆項目4 → 全因子1', () => {
  assert.deepEqual(scoresOf(byKey((it) => (it.keyed === 1 ? 1 : 4))), all(1));
});

test('逆転は 5 − 回答（1↔4、2↔3）', () => {
  // O は 1問が正、3問が逆。正項目を2、逆項目を3にすると 2,2,2,2 → 2
  assert.equal(scoresOf(byKey((it) => (it.keyed === 1 ? 2 : 3))).O, 2);
  assert.equal(scoresOf(byKey((it) => (it.keyed === 1 ? 3 : 2))).O, 3);
});

test('逆項目を1→4にすると、その因子の平均だけが0.75下がる', () => {
  const reversed = S.ITEMS.filter((it) => it.keyed === -1);
  assert.equal(reversed.length, 11);
  for (const item of reversed) {
    const base = fill(2);
    base[item.no - 1] = 1;
    const changed = fill(2);
    changed[item.no - 1] = 4;
    const a = S.scoreResponses(base);
    const b = S.scoreResponses(changed);
    for (const f of S.FACTOR_ORDER) {
      assert.equal(a[f] - b[f], f === item.factor ? 0.75 : 0, `項目${item.no}: 因子${f}`);
    }
  }
});

test('正項目を1→4にすると、その因子の平均だけが0.75上がる', () => {
  for (const item of S.ITEMS.filter((it) => it.keyed === 1)) {
    const lo = fill(2);
    lo[item.no - 1] = 1;
    const hi = fill(2);
    hi[item.no - 1] = 4;
    const a = S.scoreResponses(lo);
    const b = S.scoreResponses(hi);
    for (const f of S.FACTOR_ORDER) assert.equal(b[f] - a[f], f === item.factor ? 0.75 : 0);
  }
});

test('結果は1〜4の範囲で0.25刻み', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) % 4) + 1;
  for (let n = 0; n < 500; n += 1) {
    const r = Array.from({ length: 20 }, rand);
    const s = S.scoreResponses(r);
    for (const f of S.FACTOR_ORDER) {
      assert.ok(s[f] >= 1 && s[f] <= 4);
      assert.equal((s[f] * 4) % 1, 0);
    }
  }
});

test('未回答を拒否する（初期値で埋めない）', () => {
  const r = fill(3);
  r[4] = null;
  const v = S.validateResponses(r);
  assert.equal(v.ok, false);
  assert.deepEqual([...v.missing], [5]);
  assert.throws(() => S.scoreResponses(r), RangeError);

  const u = fill(3);
  u[19] = undefined;
  assert.throws(() => S.scoreResponses(u), RangeError);

  const sparse = new Array(20);
  assert.equal(S.validateResponses(sparse).missing.length, 20);
  assert.throws(() => S.scoreResponses(sparse), RangeError);
  assert.throws(() => S.scoreResponses(new Array(20).fill(null)), RangeError);
});

test('旧形式の5を無効値として拒否する', () => {
  assert.equal(S.isValidAnswer(5), false);
  const r = fill(3);
  r[0] = 5;
  const v = S.validateResponses(r);
  assert.equal(v.ok, false);
  assert.deepEqual([...v.invalid], [1]);
  assert.match(v.message, /1〜4の整数ではない/);
  assert.throws(() => S.scoreResponses(r), RangeError);
  assert.throws(() => S.scoreResponses(fill(5)), RangeError);
});

test('範囲外・非整数・型違いを拒否する', () => {
  for (const bad of [0, 5, 6, -1, 2.5, 3.0000001, NaN, Infinity, '3', true, {}, [3]]) {
    const r = fill(3);
    r[10] = bad;
    const v = S.validateResponses(r);
    assert.equal(v.ok, false, `値 ${String(bad)}`);
    assert.deepEqual([...v.invalid], [11]);
    assert.throws(() => S.scoreResponses(r), RangeError);
  }
});

test('長さ違い・配列以外を拒否する', () => {
  for (const bad of [fill(3).slice(0, 19), [...fill(3), 3], null, undefined, '33333', { length: 20 }]) {
    assert.equal(S.validateResponses(bad).ok, false);
    assert.throws(() => S.scoreResponses(bad), RangeError);
  }
});

test('isValidAnswer', () => {
  for (const ok of [1, 2, 3, 4]) assert.equal(S.isValidAnswer(ok), true);
  for (const ng of [0, 5, 6, 1.5, '1', null, undefined, NaN]) assert.equal(S.isValidAnswer(ng), false);
});

test('表示は小数第2位まで', () => {
  assert.equal(S.formatScore(2.5), '2.50');
  assert.equal(S.formatScore(1.75), '1.75');
});

test('入力配列を書き換えない', () => {
  const r = fill(4);
  const copy = r.slice();
  S.scoreResponses(r);
  assert.deepEqual(r, copy);
});
