// 構造化出力の JSON Schema（ベンダー非依存）、厳格な検証、差分イベントへの変換。
// モデル応答は信用しない：
//   - schema 不一致・未知のキー・長すぎる文字列 → 拒否
//   - base_revision が現在の revision と違う（古い応答）→ 拒否（呼び出し側で再投入可）
//   - 存在しない論点/項目 ID → 拒否
//   - 「確定」は、今回の新しい発話に含まれる引用（evidence_quote）が無ければ拒否
//   - ユーザーが最後に変更した項目の上書き・状態変更 → 拒否
// 1件でも拒否すべき操作があれば応答全体を適用しない（部分適用しない）。

import { applyEvent, findItem, findTopic, normalizeText, KIND_LABELS } from '../../web/js/core/model.js';
import { estimateTokens } from './budget.mjs';

export const OPS = Object.freeze(['open_topic', 'switch_topic', 'add_item', 'correct_item', 'set_decision_status']);
export const ITEM_KINDS = Object.freeze(Object.keys(KIND_LABELS));
export const DECISION_STATUSES = Object.freeze(['tentative', 'revisit', 'withdrawn', 'confirmed']);
export const MAX_OPERATIONS = 12;
const MAX_LEN = { title: 120, text: 300, evidence_quote: 200, reason: 200, id: 64 };
const OP_FIELDS = ['op', 'topic_id', 'title', 'kind', 'text', 'item_id', 'parent_id', 'status', 'evidence_quote', 'reason'];

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

/** プロバイダに渡す JSON Schema。全項目 required・追加キー禁止（不要な項目は null）。 */
export const STRUCTURING_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['base_revision', 'operations'],
  properties: {
    base_revision: { type: 'integer' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: OP_FIELDS,
        properties: {
          op: { type: 'string', enum: [...OPS] },
          topic_id: nullable({ type: 'string' }),
          title: nullable({ type: 'string' }),
          kind: nullable({ type: 'string', enum: [...ITEM_KINDS] }),
          text: nullable({ type: 'string' }),
          item_id: nullable({ type: 'string' }),
          parent_id: nullable({ type: 'string' }),
          status: nullable({ type: 'string', enum: [...DECISION_STATUSES] }),
          evidence_quote: nullable({ type: 'string' }),
          reason: nullable({ type: 'string' }),
        },
      },
    },
  },
});

export const STRUCTURING_INSTRUCTIONS = [
  'あなたは会議の構造化を補助する。逐語録や話者識別は不要。',
  'new_utterances（今回の確定した発話）だけを根拠に、current_state への差分操作を operations に出す。',
  '存在する ID は current_state に載っているものだけを使う。新しい ID を作らない（論点・項目の ID はサーバーが付与する）。',
  'base_revision には current_state.revision をそのまま入れる。',
  '決定らしい発言は add_item(kind=decision) で仮案として追加する。',
  'status=confirmed は、出席者の明示的な合意が new_utterances にあるときだけ使い、その発言を evidence_quote に原文のまま引用する。沈黙・反対なし・雰囲気は合意ではない。',
  '判断できない内容は kind=unclassified にする。何も無ければ operations は空配列。',
].join('\n');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * schema と追加の上限を検証する。
 * @returns {{ ok: boolean, value?: { base_revision: number, operations: any[] }, reason?: string }}
 */
export function validateStructuring(json) {
  const bad = (reason) => ({ ok: false, reason });
  if (!isObj(json)) return bad('ルートがオブジェクトではありません');
  const keys = Object.keys(json);
  if (keys.length !== 2 || !('base_revision' in json) || !('operations' in json)) return bad('ルートのキーが不正です');
  if (!Number.isInteger(json.base_revision) || json.base_revision < 0) return bad('base_revision が不正です');
  if (!Array.isArray(json.operations)) return bad('operations が配列ではありません');
  if (json.operations.length > MAX_OPERATIONS) return bad(`operations が多すぎます（${MAX_OPERATIONS}件まで）`);
  for (const [i, op] of json.operations.entries()) {
    if (!isObj(op)) return bad(`operations[${i}] がオブジェクトではありません`);
    const k = Object.keys(op);
    if (k.length !== OP_FIELDS.length || !OP_FIELDS.every((f) => f in op)) return bad(`operations[${i}] のキーが不正です`);
    if (!OPS.includes(op.op)) return bad(`operations[${i}].op が不正です`);
    for (const f of OP_FIELDS.slice(1)) {
      const v = op[f];
      if (v !== null && typeof v !== 'string') return bad(`operations[${i}].${f} の型が不正です`);
      const max = f.endsWith('_id') ? MAX_LEN.id : (MAX_LEN[f] ?? MAX_LEN.text);
      if (typeof v === 'string' && v.length > max) return bad(`operations[${i}].${f} が長すぎます`);
    }
    if (op.kind !== null && !ITEM_KINDS.includes(op.kind)) return bad(`operations[${i}].kind が不正です`);
    if (op.status !== null && !DECISION_STATUSES.includes(op.status)) return bad(`operations[${i}].status が不正です`);
    const need = { open_topic: ['title'], switch_topic: ['topic_id'], add_item: ['kind', 'text'], correct_item: ['item_id', 'text'], set_decision_status: ['item_id', 'status'] }[op.op];
    for (const f of need) {
      if (op[f] === null || !normalizeText(op[f])) return bad(`operations[${i}] (${op.op}) に ${f} がありません`);
    }
  }
  return { ok: true, value: json };
}

const compact = (s) => normalizeText(s).replace(/\s+/g, '');

/** ユーザーが最後に手を入れた項目か。 */
function lastTouchedByUser(item) {
  return item.history[item.history.length - 1]?.by === 'user';
}

/**
 * 検証済みでない生の応答を受け取り、適用すべきイベント列か拒否理由を返す（state は変更しない）。
 * @param {any} state 現在の state（model.js）
 * @param {unknown} json プロバイダ応答
 * @param {{ batchText: string, nextId: (kind: 'e'|'t'|'i') => string }} ctx
 * @returns {{ ok: boolean, events?: any[], state?: any, obsolete?: boolean, reason?: string }}
 */
export function applyStructuring(state, json, { batchText, nextId }) {
  const v = validateStructuring(json);
  if (!v.ok) return { ok: false, reason: `schema: ${v.reason}` };
  const res = v.value;
  if (res.base_revision !== state.seq) {
    return { ok: false, obsolete: true, reason: `古い応答です（base_revision=${res.base_revision}, 現在=${state.seq}）` };
  }
  const batch = compact(batchText);
  let work = state;
  const events = [];
  for (const [i, op] of res.operations.entries()) {
    let ev;
    switch (op.op) {
      case 'open_topic':
        ev = { type: 'topic.open', topicId: nextId('t'), title: op.title };
        break;
      case 'switch_topic':
        if (!findTopic(work, op.topic_id)) return { ok: false, reason: `未知の論点ID: ${op.topic_id}` };
        ev = { type: 'topic.switch', topicId: op.topic_id };
        break;
      case 'add_item': {
        if (op.topic_id !== null && !findTopic(work, op.topic_id)) return { ok: false, reason: `未知の論点ID: ${op.topic_id}` };
        if (op.parent_id !== null && !findItem(work, op.parent_id)) return { ok: false, reason: `未知の項目ID: ${op.parent_id}` };
        ev = {
          type: 'item.add',
          item: { id: nextId('i'), kind: op.kind, text: op.text, topicId: op.topic_id || undefined, parentId: op.parent_id, ruleNote: '自動抽出（要確認）' },
        };
        break;
      }
      case 'correct_item': {
        const item = findItem(work, op.item_id);
        if (!item) return { ok: false, reason: `未知の項目ID: ${op.item_id}` };
        if (lastTouchedByUser(item)) return { ok: false, reason: `ユーザーが変更した項目は自動で上書きしません: ${op.item_id}` };
        ev = { type: 'item.correct', itemId: op.item_id, text: op.text, reason: op.reason ? `自動抽出: ${op.reason}` : '自動抽出による訂正' };
        break;
      }
      case 'set_decision_status': {
        const item = findItem(work, op.item_id);
        if (!item) return { ok: false, reason: `未知の項目ID: ${op.item_id}` };
        if (item.kind !== 'decision') return { ok: false, reason: `決定・仮案ではありません: ${op.item_id}` };
        if (lastTouchedByUser(item)) return { ok: false, reason: `ユーザーが変更した決定は自動で変更しません: ${op.item_id}` };
        if (op.status === 'confirmed') {
          const quote = op.evidence_quote ? compact(op.evidence_quote) : '';
          if (quote.length < 4 || !batch.includes(quote)) {
            return { ok: false, reason: `根拠となる発話の引用が今回の発話に見つからないため確定を拒否: ${op.item_id}` };
          }
          ev = { type: 'decision.confirm', itemId: op.item_id, evidence: { kind: 'explicit_agreement', note: `自動抽出の引用「${normalizeText(op.evidence_quote)}」（要確認）` } };
        } else {
          const type = { tentative: 'decision.tentative', revisit: 'decision.revisit', withdrawn: 'decision.withdraw' }[op.status];
          ev = { type, itemId: op.item_id, reason: op.reason ? `自動抽出: ${op.reason}` : '自動抽出' };
        }
        break;
      }
      default:
        return { ok: false, reason: `未知の操作: ${String(op.op)}` };
    }
    const full = { id: nextId('e'), by: 'model', ...ev };
    const r = applyEvent(work, full);
    if (!r.ok || r.rejected) return { ok: false, reason: `operations[${i}] を適用できません: ${r.message || '拒否'}` };
    work = r.state;
    events.push(full);
  }
  return { ok: true, events, state: work };
}

/**
 * プロバイダへ渡す短い入力を作る（全文は送らない）。
 * @param {any} state
 * @param {{ segments: { text: string }[], recentContext: string[] }} batch
 * @param {{ maxInputTokensPerRequest: number }} limits
 */
export function buildStructuringInput(state, batch, limits) {
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const current = findTopic(state, state.currentTopicId);
  const topics = state.topics.slice(-8).map((t) => ({ id: t.id, title: clip(t.title, 60), digression: t.digression }));
  // 現在の論点の項目と、未解決系・仮案の決定を新しい順に
  const relevant = state.items
    .filter((i) => i.topicId === state.currentTopicId
      || (i.kind === 'decision' && i.status !== 'withdrawn')
      || (['open_question', 'next', 'action'].includes(i.kind) && i.status === 'open'))
    .slice()
    .reverse()
    .map((i) => ({ id: i.id, kind: i.kind, status: i.status, topic_id: i.topicId, text: clip(i.text, 120) }));
  const newUtterances = batch.segments.map((s) => s.text);
  let items = relevant.slice(0, 30);
  const make = () => ({
    instructions: STRUCTURING_INSTRUCTIONS,
    current_state: {
      revision: state.seq,
      current_topic: current ? { id: current.id, title: clip(current.title, 60) } : null,
      topics,
      items,
    },
    recent_context: batch.recentContext,
    new_utterances: newUtterances,
  });
  let input = make();
  let text = JSON.stringify(input);
  while (estimateTokens(text) > limits.maxInputTokensPerRequest && items.length) {
    items = items.slice(0, Math.floor(items.length / 2));
    input = make();
    text = JSON.stringify(input);
  }
  return { input, text, estimatedTokens: estimateTokens(text), batchText: newUtterances.join('\n') };
}
