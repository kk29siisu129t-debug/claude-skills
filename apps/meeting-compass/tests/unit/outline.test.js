import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOutlineEvent, createOutline, getNode, flatten, ancestorsOf, MAX_DEPTH, MAX_TEXT_LENGTH } from '../../web/js/core/outline.js';
import { OUTLINE_DEMO_STEPS, allOutlineDemoEvents } from '../../web/js/core/outline-demo.js';

function run(events, state = createOutline()) {
  const results = [];
  for (const ev of events) {
    const r = applyOutlineEvent(state, ev);
    results.push(r);
    state = r.state;
  }
  return { state, results };
}
const add = (eid, id, text, parentId = null, label = null) => ({ id: eid, type: 'node.add', by: 'user', node: { id, parentId, text, label } });

/** 以前の固定スロット。会話から生まれていないのに先に並ぶ見出しは無いこと */
const FIXED_SLOTS = ['いまの論点', '提案', '理由', '懸念', 'トレードオフ', '決定', '決定・仮案', '未解決', '次に決めること', 'アクション', 'あなたのアクション'];

test('初期状態は空のアウトラインで、固定の見出しを持たない', () => {
  const s = createOutline();
  assert.deepEqual(s.rootIds, []);
  assert.deepEqual(s.nodes, {});
});

test('イベントから任意の見出しと枝が生まれ、入れ子になる', () => {
  const { state, results } = run([
    add('e1', 'a', '倉庫の棚の配置を変える'),
    add('e2', 'a1', '通路を広げたい', 'a'),
    add('e3', 'a1x', 'フォークリフトがすれ違えない', 'a1', '理由として出た話'),
    add('e4', 'b', '来月の棚卸し'),
  ]);
  assert.ok(results.every((r) => r.ok));
  assert.deepEqual(state.rootIds, ['a', 'b']);
  assert.deepEqual(getNode(state, 'a').childIds, ['a1']);
  assert.equal(getNode(state, 'a1x').label, '理由として出た話');
  assert.deepEqual(ancestorsOf(state, 'a1x'), ['a1', 'a']);
  assert.deepEqual(flatten(state).map((f) => [f.id, f.depth]), [['a', 0], ['a1', 1], ['a1x', 2], ['b', 0]]);
  assert.equal(state.activeId, 'b');
});

test('同じイベントID・同じノードID・同じ親の下の同じ文は重複しない', () => {
  const ev = add('e1', 'a', '採用計画');
  const { state, results } = run([ev, ev, add('e2', 'a', '別の文'), add('e3', 'z', '  採用計画 ')]);
  assert.equal(results[1].duplicate, true);
  assert.equal(results[2].ok, false);
  assert.equal(results[3].ok, false);
  assert.equal(results[3].existingId, 'a');
  assert.equal(state.rootIds.length, 1);
  // 親が違えば同じ文でもよい
  const r = run([add('e4', 'c1', '採用計画', 'a')], state);
  assert.equal(r.results[0].ok, true);
});

test('話題へ戻る（node.focus）は新しく作らず、既存の枝への追記になる', () => {
  const { state } = run([
    add('e1', 'a', '勉強会'), add('e2', 'a1', '昼の案', 'a'),
    add('e3', 'b', '（脱線）コーヒー'),
    { id: 'e4', type: 'node.focus', by: 'user', nodeId: 'a1' },
    add('e5', 'a1r', '録画する', 'a1'),
  ]);
  assert.deepEqual(state.rootIds, ['a', 'b']);
  assert.deepEqual(getNode(state, 'a1').childIds, ['a1r']);
  assert.equal(state.activeId, 'a1r');
  assert.equal(state.log.find((l) => l.eventId === 'e4').nodeId, 'a1');
});

test('訂正は同じノードを直し、変更履歴を残す。並び順は変わらない', () => {
  const { state } = run([add('e1', 'a', '30分で試す'), add('e2', 'b', '別の話'),
    { id: 'e3', type: 'node.edit', by: 'user', nodeId: 'a', text: '45分で試す', reason: '言い間違い' }]);
  const a = getNode(state, 'a');
  assert.equal(a.text, '45分で試す');
  assert.equal(a.rev, 2);
  assert.deepEqual(a.history.map((x) => [x.change, x.from, x.to]), [['追加', null, '30分で試す'], ['訂正', '30分で試す', '45分で試す']]);
  assert.equal(a.history[1].reason, '言い間違い');
  assert.deepEqual(state.rootIds, ['a', 'b']);
});

test('不正な入力は拒否し、state を変えない', () => {
  const base = run([add('e1', 'a', 'x')]).state;
  for (const ev of [
    add('f1', 'p', ''), add('f2', 'p', '   \n'), add('f3', 'p', 'あ'.repeat(MAX_TEXT_LENGTH + 1)),
    add('f4', 'p', 'ok', 'missing'),
    { id: 'f5', type: 'node.edit', nodeId: 'missing', text: 'x' },
    { id: 'f6', type: 'node.edit', nodeId: 'a', text: 'x' },
    { id: 'f7', type: 'node.focus', nodeId: 'missing' },
    { id: 'f8', type: 'magic' },
    { type: 'node.add' },
  ]) {
    const r = applyOutlineEvent(base, ev);
    assert.equal(r.ok, false, JSON.stringify(ev).slice(0, 60));
    assert.equal(r.state, base);
  }
});

test('階層の深さに上限がある', () => {
  let s = createOutline();
  let parent = null;
  for (let i = 0; i <= MAX_DEPTH; i++) {
    const r = applyOutlineEvent(s, add(`e${i}`, `n${i}`, `段${i}`, parent));
    assert.equal(r.ok, true);
    s = r.state;
    parent = `n${i}`;
  }
  assert.equal(applyOutlineEvent(s, add('ex', 'deep', '深すぎ', parent)).ok, false);
});

test('危険な HTML・制御文字：HTMLは文字列のまま、制御文字は除去', () => {
  const html = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const { state } = run([add('e1', 'a', html), add('e2', 'b', '制御\u0000文字\u0007')]);
  assert.equal(getNode(state, 'a').text, html);
  assert.equal(getNode(state, 'b').text, '制御文字');
});

test('台本デモ：全イベント成功・ID安定・誕生/枝分かれ/脱線/戻り/訂正を含み、固定見出しは無い', () => {
  const a = run(allOutlineDemoEvents());
  const b = run(allOutlineDemoEvents());
  assert.ok(a.results.every((r) => r.ok), a.results.filter((r) => !r.ok).map((r) => r.message).join(','));
  assert.deepEqual(Object.keys(a.state.nodes), Object.keys(b.state.nodes));
  const types = new Set(allOutlineDemoEvents().map((e) => e.type));
  assert.deepEqual([...types].sort(), ['node.add', 'node.edit', 'node.focus']);
  assert.ok(OUTLINE_DEMO_STEPS.every((s) => s.caption && s.events.every((e) => e.by === 'fixture')));
  const texts = Object.values(a.state.nodes).map((n) => n.text);
  for (const slot of FIXED_SLOTS) assert.ok(!texts.includes(slot), `固定見出し「${slot}」がある`);
  // 脱線は別の見出し、戻りは既存の枝への追記、訂正は同じノード
  assert.equal(a.state.rootIds.length, 3);
  assert.deepEqual(a.state.nodes['n-lunch'].childIds, ['n-lunch-why', 'n-lunch-rec']);
  assert.equal(a.state.nodes['n-lunch'].text, '昼休みの45分で試す');
  assert.equal(a.state.nodes['n-lunch'].history.length, 2);
  // 合意・担当・期限を作らない
  assert.ok(!texts.some((t) => /決定しました|合意|担当|期限/.test(t)));
});
