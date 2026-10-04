import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, createState, findItem } from '../../web/js/core/model.js';
import { validateStructuring, applyStructuring, buildStructuringInput, STRUCTURING_SCHEMA, MAX_OPERATIONS } from '../../server/live/structuring.mjs';
import { assertNoNetworkAfterAll, op } from './live-helpers.mjs';

assertNoNetworkAfterAll();

function seeded() {
  let s = createState();
  for (const ev of [
    { id: 'e1', type: 'topic.open', topicId: 't1', title: '定例の形式', by: 'model' },
    { id: 'e2', type: 'item.add', by: 'model', item: { id: 'p1', kind: 'proposal', text: '全面オンライン' } },
    { id: 'e3', type: 'item.add', by: 'model', item: { id: 'd1', kind: 'decision', text: 'オンラインで試行' } },
    { id: 'e4', type: 'item.add', by: 'model', item: { id: 'd2', kind: 'decision', text: '対面は四半期に1回' } },
  ]) s = applyEvent(s, ev).state;
  return s;
}

function ids() {
  let n = 0;
  return (k) => `x-${k}${++n}`;
}

const BATCH = '議長「この案で決定してよいですか」全員「異議なしです」';

test('schema は全項目 required・追加キー禁止', () => {
  const opSchema = STRUCTURING_SCHEMA.properties.operations.items;
  assert.equal(STRUCTURING_SCHEMA.additionalProperties, false);
  assert.equal(opSchema.additionalProperties, false);
  assert.deepEqual(new Set(opSchema.required), new Set(Object.keys(opSchema.properties)));
});

test('validate：不正な応答（JSONでない・キー不足/過剰・型・enum・件数・長さ）を拒否', () => {
  const s = seeded();
  const good = { base_revision: s.seq, operations: [op({ op: 'add_item', kind: 'concern', text: '費用が心配' })] };
  assert.equal(validateStructuring(good).ok, true);
  const bad = [
    'not json',
    null,
    [],
    { base_revision: s.seq },
    { base_revision: s.seq, operations: [], extra: 1 },
    { base_revision: '4', operations: [] },
    { base_revision: s.seq, operations: {} },
    { base_revision: s.seq, operations: [{ op: 'add_item', kind: 'concern', text: 'x' }] },
    { base_revision: s.seq, operations: [op({ op: 'delete_everything' })] },
    { base_revision: s.seq, operations: [op({ op: 'add_item', kind: 'agreement', text: 'x' })] },
    { base_revision: s.seq, operations: [op({ op: 'add_item', kind: 'concern', text: 'x', extra: 1 })] },
    { base_revision: s.seq, operations: [op({ op: 'add_item', kind: 'concern', text: 123 })] },
    { base_revision: s.seq, operations: [op({ op: 'add_item', kind: 'concern', text: '   ' })] },
    { base_revision: s.seq, operations: [op({ op: 'add_item', kind: 'concern', text: 'あ'.repeat(301) })] },
    { base_revision: s.seq, operations: [op({ op: 'set_decision_status', item_id: 'd1', status: 'agreed' })] },
    { base_revision: s.seq, operations: Array.from({ length: MAX_OPERATIONS + 1 }, () => op({ op: 'add_item', kind: 'concern', text: 'x' })) },
  ];
  for (const b of bad) {
    const r = applyStructuring(s, b, { batchText: BATCH, nextId: ids() });
    assert.equal(r.ok, false, JSON.stringify(b).slice(0, 80));
    assert.match(r.reason, /^schema:/);
  }
});

test('apply：正しい差分はサーバー側IDで適用され、元の state は変わらない', () => {
  const s = seeded();
  const r = applyStructuring(s, {
    base_revision: s.seq,
    operations: [
      op({ op: 'add_item', kind: 'concern', text: '交通費がかかる', parent_id: 'p1' }),
      op({ op: 'open_topic', title: 'ドライブ整理' }),
      op({ op: 'add_item', kind: 'proposal', text: 'プロジェクト単位に' }),
    ],
  }, { batchText: BATCH, nextId: ids() });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.events.length, 3);
  assert.ok(r.events.every((e) => e.by === 'model' && e.id.startsWith('x-e')));
  assert.equal(r.events[0].item.id, 'x-i1');
  assert.equal(r.state.currentTopicId, 'x-t3');
  assert.equal(findItem(r.state, 'x-i5').topicId, 'x-t3');
  assert.equal(findItem(r.state, 'x-i1').origin, 'model');
  assert.equal(s.items.length, 3, '入力の state は不変');
});

test('apply：未知のID（論点・項目・親）を拒否し、部分適用しない', () => {
  const s = seeded();
  for (const bad of [
    op({ op: 'switch_topic', topic_id: 't-unknown' }),
    op({ op: 'correct_item', item_id: 'nope', text: 'x' }),
    op({ op: 'add_item', kind: 'reason', text: 'x', parent_id: 'nope' }),
    op({ op: 'add_item', kind: 'reason', text: 'x', topic_id: 'nope' }),
    op({ op: 'set_decision_status', item_id: 'nope', status: 'withdrawn' }),
    op({ op: 'set_decision_status', item_id: 'p1', status: 'withdrawn' }),
  ]) {
    const r = applyStructuring(s, { base_revision: s.seq, operations: [op({ op: 'add_item', kind: 'concern', text: '先に正しい操作' }), bad] }, { batchText: BATCH, nextId: ids() });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.events, undefined);
  }
});

test('apply：古い revision の応答は obsolete として拒否', () => {
  const s = seeded();
  const r = applyStructuring(s, { base_revision: s.seq - 1, operations: [] }, { batchText: BATCH, nextId: ids() });
  assert.equal(r.ok, false);
  assert.equal(r.obsolete, true);
});

test('apply：確定は今回の発話に含まれる引用が必要（根拠なし・捏造引用は拒否）', () => {
  const s = seeded();
  const tryConfirm = (quote) => applyStructuring(s, {
    base_revision: s.seq, operations: [op({ op: 'set_decision_status', item_id: 'd1', status: 'confirmed', evidence_quote: quote })],
  }, { batchText: BATCH, nextId: ids() });
  assert.equal(tryConfirm(null).ok, false);
  assert.equal(tryConfirm('反対意見なし').ok, false);
  assert.equal(tryConfirm('異議').ok, false, '短すぎる引用');
  const r = tryConfirm('全員「異議なしです」');
  assert.equal(r.ok, true, r.reason);
  const d = findItem(r.state, 'd1');
  assert.equal(d.status, 'confirmed');
  assert.match(d.consensus.note, /自動抽出の引用/);
});

test('apply：ユーザーが最後に変更した項目・決定は自動で上書きしない', () => {
  let s = seeded();
  s = applyEvent(s, { id: 'u1', type: 'decision.withdraw', itemId: 'd2', by: 'user' }).state;
  s = applyEvent(s, { id: 'u2', type: 'item.correct', itemId: 'p1', text: '全面オンライン（ユーザー訂正）', by: 'user' }).state;
  const nid = ids();
  assert.equal(applyStructuring(s, { base_revision: s.seq, operations: [op({ op: 'set_decision_status', item_id: 'd2', status: 'tentative' })] }, { batchText: BATCH, nextId: nid }).ok, false);
  assert.equal(applyStructuring(s, { base_revision: s.seq, operations: [op({ op: 'correct_item', item_id: 'p1', text: '別の文' })] }, { batchText: BATCH, nextId: nid }).ok, false);
  // モデル由来の項目は訂正・撤回できる（履歴に残る）
  const r = applyStructuring(s, { base_revision: s.seq, operations: [op({ op: 'set_decision_status', item_id: 'd1', status: 'withdrawn', reason: '撤回の発言' })] }, { batchText: BATCH, nextId: nid });
  assert.equal(r.ok, true);
  assert.deepEqual(findItem(r.state, 'd1').history.map((h) => h.change), ['追加', '撤回']);
});

test('input：短い現在状態＋今回の発話だけ。上限を超えると項目を減らす', () => {
  let s = seeded();
  for (let i = 0; i < 80; i++) {
    s = applyEvent(s, { id: `f${i}`, type: 'item.add', by: 'model', item: { id: `q${i}`, kind: 'open_question', text: `未解決の論点その${i}`.repeat(10) } }).state;
  }
  const built = buildStructuringInput(s, { segments: [{ segmentId: 'a', text: '新しい発言' }], recentContext: ['直前の発言'] }, { maxInputTokensPerRequest: 4000 });
  assert.ok(built.estimatedTokens <= 4000, String(built.estimatedTokens));
  assert.ok(built.input.current_state.items.length <= 30);
  assert.ok(built.input.current_state.items.every((i) => i.text.length <= 121));
  assert.deepEqual(built.input.new_utterances, ['新しい発言']);
  assert.deepEqual(built.input.recent_context, ['直前の発言']);
  assert.equal(built.input.current_state.revision, s.seq);
  assert.equal(built.batchText, '新しい発言');
  const small = buildStructuringInput(s, { segments: [{ segmentId: 'a', text: 'x' }], recentContext: [] }, { maxInputTokensPerRequest: 600 });
  assert.ok(small.estimatedTokens <= 600 || small.input.current_state.items.length === 0);
});
