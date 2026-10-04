// 会話から育つ階層アウトライン。固定の項目（提案・決定など）は持たない。
// - ノードは「見出し（親なし）」か「枝（親あり）」だけ。中身の言葉は会話・入力から来る
// - ID は呼び出し側（台本・手入力）が付け、モデルは振り直さない
// - 同じイベントIDの再適用、既存IDへの追加、同じ親の下の同じ文の重複は拒否
// - 訂正は同じノードの history に積む（上書きで消さない）
// - 並び順は追加順のまま。更新があっても並べ替えない

export const MAX_TEXT_LENGTH = 500;
export const MAX_LABEL_LENGTH = 20;
export const MAX_DEPTH = 6;
export const MAX_NODES = 2000;

/** 各項目に出す由来（短く）。台本＝事前に用意した構造イベントである旨は画面上部と進行表示で常に明記する */
export const ORIGIN_LABELS = Object.freeze({
  fixture: '台本',
  user: '手で整理',
});

export function createOutline() {
  return { seq: 0, nodes: {}, rootIds: [], activeId: null, seenEventIds: {}, log: [] };
}

/** 制御文字を除いて前後の空白を落とす。HTML はエスケープせず文字列として保持し、描画側で textContent を使う。 */
export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

const sameText = (a, b) => normalizeText(a).replace(/\s+/g, ' ') === normalizeText(b).replace(/\s+/g, ' ');

class OutlineError extends Error {
  constructor(message, extra = {}) {
    super(message);
    Object.assign(this, extra);
  }
}

function requireText(raw, max = MAX_TEXT_LENGTH) {
  const text = normalizeText(raw);
  if (!text) throw new OutlineError('本文が空です');
  if (text.length > max) throw new OutlineError(`長すぎます（${max}文字まで）`);
  return text;
}

export function getNode(state, id) {
  return Object.prototype.hasOwnProperty.call(state.nodes, id) ? state.nodes[id] : null;
}

export function depthOf(state, id) {
  let d = 0;
  let n = getNode(state, id);
  while (n && n.parentId) {
    d += 1;
    n = getNode(state, n.parentId);
  }
  return d;
}

/** 祖先の ID（親から根へ）。 */
export function ancestorsOf(state, id) {
  const out = [];
  let n = getNode(state, id);
  while (n && n.parentId) {
    out.push(n.parentId);
    n = getNode(state, n.parentId);
  }
  return out;
}

const siblingsOf = (state, parentId) => (parentId ? getNode(state, parentId).childIds : state.rootIds);

/**
 * イベントを1件適用して新しい state を返す（元の state は変えない）。
 * @returns {{ state: any, ok: boolean, duplicate?: boolean, existingId?: string, message?: string, changedId?: string }}
 */
export function applyOutlineEvent(prev, event) {
  if (!event || typeof event.id !== 'string' || !event.id) return { state: prev, ok: false, message: 'イベントIDがありません' };
  if (prev.seenEventIds[event.id]) return { state: prev, ok: false, duplicate: true, message: `イベント ${event.id} は適用済みです` };
  const state = structuredClone(prev);
  const seq = state.seq + 1;
  const by = event.by === 'fixture' ? 'fixture' : 'user';
  let summary;
  let changedId;
  try {
    switch (event.type) {
      case 'node.add': {
        const src = event.node || {};
        if (typeof src.id !== 'string' || !src.id) throw new OutlineError('ノードIDがありません');
        if (getNode(state, src.id)) throw new OutlineError(`ノード ${src.id} は既にあります`);
        if (Object.keys(state.nodes).length >= MAX_NODES) throw new OutlineError('ノード数の上限です');
        const parentId = src.parentId || null;
        if (parentId && !getNode(state, parentId)) throw new OutlineError('追加先の枝が見つかりません');
        if (parentId && depthOf(state, parentId) + 1 > MAX_DEPTH) throw new OutlineError(`階層は${MAX_DEPTH}段までです`);
        const text = requireText(src.text);
        const label = src.label ? requireText(src.label, MAX_LABEL_LENGTH) : null;
        const twin = siblingsOf(state, parentId).find((sid) => sameText(state.nodes[sid].text, text));
        if (twin) throw new OutlineError('同じ内容が既にあります', { existingId: twin });
        state.nodes[src.id] = {
          id: src.id, parentId, text, label, origin: by, childIds: [],
          createdSeq: seq, updatedSeq: seq, rev: 1,
          history: [{ seq, change: '追加', from: null, to: text, by, reason: null }],
        };
        siblingsOf(state, parentId).push(src.id);
        changedId = src.id;
        summary = parentId ? `「${clip(getNode(state, parentId).text)}」に追記: ${clip(text)}` : `見出し: ${clip(text)}`;
        break;
      }
      case 'node.edit': {
        const node = getNode(state, event.nodeId);
        if (!node) throw new OutlineError('対象が見つかりません');
        const text = requireText(event.text);
        if (text === node.text) throw new OutlineError('訂正前と同じ内容です');
        const parentSiblings = siblingsOf(state, node.parentId).filter((sid) => sid !== node.id);
        const twin = parentSiblings.find((sid) => sameText(state.nodes[sid].text, text));
        if (twin) throw new OutlineError('同じ内容が既にあります', { existingId: twin });
        const from = node.text;
        node.text = text;
        node.rev += 1;
        node.updatedSeq = seq;
        node.history.push({ seq, change: '訂正', from, to: text, by, reason: normalizeText(event.reason) || null });
        changedId = node.id;
        summary = `訂正: ${clip(from)} → ${clip(text)}`;
        break;
      }
      case 'node.focus': {
        // 話題が戻った：新しく作らず、既存の枝を「いま話している場所」にする
        const node = getNode(state, event.nodeId);
        if (!node) throw new OutlineError('対象が見つかりません');
        changedId = node.id;
        summary = `話題が戻った: ${clip(node.text)}`;
        break;
      }
      default:
        throw new OutlineError(`未知のイベント種別です: ${String(event.type)}`);
    }
  } catch (err) {
    if (err instanceof OutlineError) return { state: prev, ok: false, message: err.message, existingId: /** @type {any} */ (err).existingId };
    throw err;
  }
  state.seq = seq;
  state.activeId = changedId;
  state.seenEventIds[event.id] = true;
  state.log.push({ seq, eventId: event.id, type: event.type, nodeId: changedId, by, summary });
  return { state, ok: true, changedId };
}

function clip(text, n = 32) {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

/** 深さ優先で並べた（追加順を保った）ノード一覧。手入力の追加先の選択肢に使う。 */
export function flatten(state) {
  const out = [];
  const walk = (ids, depth) => {
    for (const id of ids) {
      const n = state.nodes[id];
      out.push({ id, depth, text: n.text });
      walk(n.childIds, depth + 1);
    }
  };
  walk(state.rootIds, 0);
  return out;
}
