import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, createState, findItem, selectView, MAX_TEXT_LENGTH } from '../../web/js/core/model.js';
import { DEMO_STEPS, allDemoEvents } from '../../web/js/core/demo-script.js';

function run(events, state = createState()) {
  const results = [];
  for (const ev of events) {
    const r = applyEvent(state, ev);
    results.push(r);
    state = r.state;
  }
  return { state, results };
}

const topic = (id, title, extra = {}) => ({ id: `e-${id}`, type: 'topic.open', topicId: id, title, by: 'fixture', ...extra });
const add = (eid, item) => ({ id: eid, type: 'item.add', by: 'fixture', item });

test('デモ全体が全イベント成功で適用でき、ID は台本どおりで安定している', () => {
  const a = run(allDemoEvents());
  const b = run(allDemoEvents());
  assert.ok(a.results.every((r) => r.ok), a.results.filter((r) => !r.ok).map((r) => r.message).join(','));
  assert.deepEqual(a.state.items.map((i) => i.id), b.state.items.map((i) => i.id));
  assert.deepEqual(a.state.topics.map((t) => t.id), ['t-format', 't-drive', 't-coffee']);
  // 台本の ID がそのまま使われる（振り直さない）
  const declared = DEMO_STEPS.flatMap((s) => s.events).filter((e) => e.type === 'item.add').map((e) => e.item.id);
  assert.deepEqual(a.state.items.map((i) => i.id), declared);
});

test('applyEvent は元の state を変更しない（差分適用）', () => {
  const s0 = createState();
  const frozen = JSON.stringify(s0);
  const r = applyEvent(s0, topic('t1', '論点1'));
  assert.equal(JSON.stringify(s0), frozen);
  assert.notEqual(r.state, s0);
});

test('同じイベントIDの再適用は重複として無視される', () => {
  const ev = add('e2', { id: 'p1', kind: 'proposal', text: '案A' });
  const { state, results } = run([topic('t1', '論点1'), ev, ev]);
  assert.equal(results[2].ok, false);
  assert.equal(results[2].duplicate, true);
  assert.equal(results[2].state, results[1].state, '重複時は state を差し替えない');
  assert.equal(state.items.length, 1);
});

test('既存の項目IDへの追加は別イベントIDでも拒否（重複項目を作らない）', () => {
  const { state, results } = run([
    topic('t1', '論点1'),
    add('e2', { id: 'p1', kind: 'proposal', text: '案A' }),
    add('e3', { id: 'p1', kind: 'proposal', text: '案A（再送）' }),
  ]);
  assert.equal(results[2].ok, false);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].text, '案A');
});

test('話題の切り替えと戻り：項目は元の論点に残り、戻り回数が記録される', () => {
  const { state } = run([
    topic('t1', '論点1'),
    add('e2', { id: 'p1', kind: 'proposal', text: '案A' }),
    topic('t2', '脱線', { digression: true }),
    add('e4', { id: 'u1', kind: 'unclassified', text: '雑談' }),
    { id: 'e5', type: 'topic.switch', topicId: 't1', by: 'fixture' },
    add('e6', { id: 'c1', kind: 'concern', text: '懸念X' }),
  ]);
  assert.equal(state.currentTopicId, 't1');
  assert.equal(findItem(state, 'p1').topicId, 't1');
  assert.equal(findItem(state, 'u1').topicId, 't2');
  assert.equal(findItem(state, 'c1').topicId, 't1');
  assert.equal(state.topics.find((t) => t.id === 't1').visits, 2);
  assert.equal(state.topics.find((t) => t.id === 't2').digression, true);
  const view = selectView(state, 't2');
  assert.equal(view.isViewingPast, true);
  assert.equal(view.current.id, 't1');
  assert.deepEqual(view.topicItems.unclassified.map((i) => i.id), ['u1']);
});

test('存在しない論点への切り替えは拒否', () => {
  const { results } = run([topic('t1', 'A'), { id: 'x', type: 'topic.switch', topicId: 'nope' }]);
  assert.equal(results[1].ok, false);
});

test('決定の撤回・再検討は上書きせず履歴に残る', () => {
  const { state } = run(allDemoEvents());
  const d = findItem(state, 'd-hybrid');
  assert.equal(d.status, 'withdrawn');
  assert.deepEqual(d.history.map((h) => h.change), ['追加', '再検討', '撤回']);
  assert.equal(d.history[1].from, 'tentative');
  assert.equal(d.history[2].from, 'revisit');
  assert.match(d.history[2].reason, /交通費/);
  // 撤回済みも一覧から消えず「撤回」に入る
  const view = selectView(state, null);
  assert.ok(view.decisions.withdrawn.some((x) => x.id === 'd-hybrid'));
});

test('訂正は元の文を履歴に保持する', () => {
  const { state } = run(allDemoEvents());
  const r = findItem(state, 'r-travel');
  assert.match(r.text, /1\.5時間/);
  const corr = r.history.find((h) => h.change === '訂正');
  assert.match(corr.from, /3時間/);
  assert.match(corr.reason, /2週分/);
});

test('根拠のない確定（沈黙・反対なし）は拒否され、仮案のまま「合意未確認」になる', () => {
  const { state } = run(allDemoEvents());
  const d = findItem(state, 'd-folders');
  assert.equal(d.status, 'tentative');
  assert.equal(d.consensus.kind, 'unverified');
  assert.ok(d.history.some((h) => h.change === '確定を見送り'));
  assert.ok(state.log.some((l) => l.rejected));
  const view = selectView(state, null);
  assert.ok(!view.decisions.confirmed.some((x) => x.id === 'd-folders'));
  assert.ok(view.decisions.tentative.some((x) => x.id === 'd-folders'));
});

test('明示的な合意根拠がある場合だけ確定になる', () => {
  const { state } = run(allDemoEvents());
  const d = findItem(state, 'd-online');
  assert.equal(d.status, 'confirmed');
  assert.equal(d.consensus.kind, 'explicit_agreement');
});

test('evidence 無しの確定、追加時の status:confirmed 指定も仮案になる', () => {
  const { state, results } = run([
    topic('t1', 'A'),
    add('e2', { id: 'd1', kind: 'decision', text: '決定X', status: 'confirmed' }),
    { id: 'e3', type: 'decision.confirm', itemId: 'd1' },
  ]);
  assert.equal(findItem(state, 'd1').status, 'tentative');
  assert.equal(results[2].rejected, true);
});

test('ユーザー操作による確定・仮案戻し・再検討・撤回', () => {
  let { state } = run([topic('t1', 'A'), add('e2', { id: 'd1', kind: 'decision', text: '決定X' })]);
  const step = (ev) => { const r = applyEvent(state, ev); assert.ok(r.ok, r.message); state = r.state; };
  step({ id: 'u1', type: 'decision.confirm', itemId: 'd1', by: 'user', evidence: { kind: 'user', note: '画面で確定' } });
  assert.equal(findItem(state, 'd1').status, 'confirmed');
  step({ id: 'u2', type: 'decision.tentative', itemId: 'd1', by: 'user' });
  assert.equal(findItem(state, 'd1').status, 'tentative');
  step({ id: 'u3', type: 'decision.revisit', itemId: 'd1', by: 'user' });
  step({ id: 'u4', type: 'decision.withdraw', itemId: 'd1', by: 'user' });
  assert.deepEqual(findItem(state, 'd1').history.map((h) => h.to), ['tentative', 'confirmed', 'tentative', 'revisit', 'withdrawn']);
});

test('手動修正：訂正・種類変更・担当/期限の更新（空欄は不明=null）', () => {
  let { state } = run([topic('t1', 'A'), add('e2', { id: 'u1', kind: 'unclassified', text: 'メモ' })]);
  const step = (ev) => { const r = applyEvent(state, ev); assert.ok(r.ok, r.message); state = r.state; };
  step({ id: 'x1', type: 'item.reclassify', itemId: 'u1', kind: 'action', by: 'user' });
  assert.equal(findItem(state, 'u1').needsReview, false);
  assert.equal(findItem(state, 'u1').owner, null);
  step({ id: 'x2', type: 'action.update', itemId: 'u1', owner: 'Cさん', due: '', by: 'user' });
  assert.equal(findItem(state, 'u1').owner, 'Cさん');
  assert.equal(findItem(state, 'u1').due, null);
  step({ id: 'x3', type: 'item.correct', itemId: 'u1', text: 'メモ（訂正）', by: 'user' });
  assert.equal(findItem(state, 'u1').rev, 4);
});

test('アクションの担当・期限は台本で明示されない限り不明(null)のまま', () => {
  const s = run(allDemoEvents().slice(0, 13)).state; // a-inventory 追加直後
  const a = findItem(s, 'a-inventory');
  assert.equal(a.owner, null);
  assert.equal(a.due, null);
  const full = run(allDemoEvents()).state;
  assert.equal(findItem(full, 'a-inventory').owner, 'Bさん');
  assert.equal(findItem(full, 'a-inventory').due, null);
});

test('空・空白のみ・長すぎる本文は拒否', () => {
  const base = run([topic('t1', 'A')]).state;
  for (const text of ['', '   ', '\n\t', 'あ'.repeat(MAX_TEXT_LENGTH + 1)]) {
    const r = applyEvent(base, add(`e-${text.length}`, { id: 'p', kind: 'proposal', text }));
    assert.equal(r.ok, false, JSON.stringify(text.slice(0, 5)));
  }
  assert.equal(applyEvent(createState(), topic('t9', '  ')).ok, false);
});

test('論点が無い状態での項目追加は拒否', () => {
  const r = applyEvent(createState(), add('e1', { id: 'p1', kind: 'proposal', text: '案' }));
  assert.equal(r.ok, false);
});

test('危険な HTML は文字列のまま保持される（実行・除去しない）', () => {
  const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const { state } = run([topic('t1', payload), add('e2', { id: 'p1', kind: 'proposal', text: payload })]);
  assert.equal(findItem(state, 'p1').text, payload);
  assert.equal(state.topics[0].title, payload);
});

test('制御文字は除去される', () => {
  const { state } = run([topic('t1', 'A'), add('e2', { id: 'p1', kind: 'proposal', text: '案\u0000A\u0007' })]);
  assert.equal(findItem(state, 'p1').text, '案A');
});

test('未知のイベント種別・未知の種類は拒否', () => {
  const s = run([topic('t1', 'A')]).state;
  assert.equal(applyEvent(s, { id: 'z', type: 'magic' }).ok, false);
  assert.equal(applyEvent(s, add('z2', { id: 'p', kind: 'agreement', text: 'x' })).ok, false);
});
