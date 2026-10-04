// 会議構造のモデル。すべての変更は「イベント」を applyEvent に通して差分適用する。
// - ID は呼び出し側（台本・手入力プロバイダ）が付与し、モデルは決して振り直さない
// - 同じイベントIDの再適用や既存IDへの追加は無視（重複防止）
// - 訂正・撤回・再検討は上書きせず item.history に積む
// - 「確定」は明示的な合意根拠（explicit_agreement）かユーザー操作（user）がある場合のみ

/** @typedef {'proposal'|'reason'|'concern'|'tradeoff'|'decision'|'open_question'|'next'|'action'|'unclassified'} ItemKind */
/** @typedef {'fixture'|'rule'|'user'} Origin */

export const KIND_LABELS = /** @type {const} */ ({
  proposal: '提案',
  reason: '理由',
  concern: '懸念',
  tradeoff: 'トレードオフ',
  decision: '決定・仮案',
  open_question: '未解決',
  next: '次に決めること',
  action: 'アクション',
  unclassified: '未分類（要確認）',
});

export const STATUS_LABELS = /** @type {const} */ ({
  tentative: '仮案',
  confirmed: '確定',
  withdrawn: '撤回',
  revisit: '再検討中',
  open: '未解決',
  resolved: '解決済み',
  done: '完了',
  active: '有効',
});

export const ORIGIN_LABELS = /** @type {const} */ ({
  fixture: 'デモ台本',
  rule: 'ルール判定',
  user: 'ユーザー入力',
});

export const MAX_TEXT_LENGTH = 500;

/** 合意の根拠として認める種類。沈黙・反対なし・雰囲気は認めない。 */
export const ACCEPTED_EVIDENCE = Object.freeze(['explicit_agreement', 'user']);

const KINDS = Object.keys(KIND_LABELS);

export function initialStatus(kind) {
  switch (kind) {
    case 'decision': return 'tentative';
    case 'open_question':
    case 'next':
    case 'action': return 'open';
    default: return 'active';
  }
}

export function createState() {
  return {
    seq: 0,
    topics: [],
    items: [],
    currentTopicId: null,
    seenEventIds: {},
    log: [],
  };
}

/** 制御文字を除去し前後空白を落とす。HTML はエスケープせず「ただの文字列」として保持し、描画側で textContent を使う。 */
export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

export function findTopic(state, id) {
  return state.topics.find((t) => t.id === id) || null;
}

export function findItem(state, id) {
  return state.items.find((i) => i.id === id) || null;
}

class EventError extends Error {}

function fail(msg) {
  throw new EventError(msg);
}

function requireText(raw) {
  const text = normalizeText(raw);
  if (!text) fail('本文が空です');
  if (text.length > MAX_TEXT_LENGTH) fail(`本文が長すぎます（${MAX_TEXT_LENGTH}文字まで）`);
  return text;
}

function requireItem(state, id) {
  const item = findItem(state, id);
  if (!item) fail(`項目 ${id} が見つかりません`);
  return item;
}

function requireDecision(state, id) {
  const item = requireItem(state, id);
  if (item.kind !== 'decision') fail(`項目 ${id} は決定・仮案ではありません`);
  return item;
}

function pushHistory(item, seq, entry) {
  item.history.push({ seq, ...entry });
  item.rev += 1;
  item.updatedSeq = seq;
}

function setStatus(item, seq, status, change, by, reason) {
  const from = item.status;
  item.status = status;
  pushHistory(item, seq, { change, from, to: status, by, reason: reason || null });
}

/**
 * イベントを1件適用し、新しい state を返す（元の state は変更しない）。
 * @returns {{ state: any, ok: boolean, duplicate?: boolean, rejected?: boolean, message?: string, changedIds: string[] }}
 */
export function applyEvent(prev, event) {
  if (!event || typeof event.id !== 'string' || !event.id) {
    return { state: prev, ok: false, message: 'イベントIDがありません', changedIds: [] };
  }
  if (prev.seenEventIds[event.id]) {
    return { state: prev, ok: false, duplicate: true, message: `イベント ${event.id} は適用済みです`, changedIds: [] };
  }
  const state = structuredClone(prev);
  const seq = state.seq + 1;
  const by = event.by || 'user';
  /** @type {string[]} */
  const changedIds = [];
  let summary = '';
  let rejected = false;

  try {
    switch (event.type) {
      case 'topic.open': {
        if (!event.topicId) fail('論点IDがありません');
        if (findTopic(state, event.topicId)) fail(`論点 ${event.topicId} は既にあります`);
        const title = requireText(event.title);
        state.topics.push({
          id: event.topicId,
          title,
          digression: !!event.digression,
          origin: by,
          openedSeq: seq,
          lastActiveSeq: seq,
          visits: 1,
        });
        state.currentTopicId = event.topicId;
        changedIds.push(event.topicId);
        summary = `${event.digression ? '脱線' : '論点'}「${title}」に移りました`;
        break;
      }
      case 'topic.switch': {
        const topic = findTopic(state, event.topicId);
        if (!topic) fail(`論点 ${event.topicId} が見つかりません`);
        if (state.currentTopicId === topic.id) fail('既に現在の論点です');
        state.currentTopicId = topic.id;
        topic.lastActiveSeq = seq;
        topic.visits += 1;
        changedIds.push(topic.id);
        summary = `論点「${topic.title}」に戻りました`;
        break;
      }
      case 'topic.rename': {
        const topic = findTopic(state, event.topicId);
        if (!topic) fail(`論点 ${event.topicId} が見つかりません`);
        const title = requireText(event.title);
        summary = `論点名を「${topic.title}」→「${title}」に訂正`;
        topic.title = title;
        changedIds.push(topic.id);
        break;
      }
      case 'item.add': {
        const src = event.item || {};
        if (!src.id) fail('項目IDがありません');
        if (findItem(state, src.id)) fail(`項目 ${src.id} は既にあります`);
        if (!KINDS.includes(src.kind)) fail(`未知の種類です: ${String(src.kind)}`);
        const topicId = src.topicId || state.currentTopicId;
        if (!topicId || !findTopic(state, topicId)) fail('論点が未設定です');
        const text = requireText(src.text);
        let status = initialStatus(src.kind);
        // 追加時に「確定」を指定されても、根拠がなければ仮案として扱う
        let consensus = null;
        if (src.kind === 'decision') {
          if (src.status === 'confirmed' && isAcceptedEvidence(src.evidence)) {
            status = 'confirmed';
            consensus = { ...src.evidence };
          } else if (src.status === 'confirmed') {
            consensus = { kind: 'unverified', note: '合意の根拠が示されていないため仮案として記録' };
          }
        }
        const item = {
          id: src.id,
          kind: src.kind,
          topicId,
          text,
          status,
          parentId: src.parentId || null,
          owner: src.kind === 'action' ? (normalizeText(src.owner) || null) : null,
          due: src.kind === 'action' ? (normalizeText(src.due) || null) : null,
          origin: by,
          ruleNote: src.ruleNote || null,
          needsReview: src.kind === 'unclassified' || !!src.needsReview,
          consensus,
          createdSeq: seq,
          updatedSeq: seq,
          rev: 1,
          history: [{ seq, change: '追加', from: null, to: status, by, reason: src.note || null }],
        };
        state.items.push(item);
        const topic = findTopic(state, topicId);
        if (topic) topic.lastActiveSeq = seq;
        changedIds.push(item.id);
        summary = `${KIND_LABELS[item.kind]}を追加: ${clip(text)}`;
        break;
      }
      case 'item.correct': {
        const item = requireItem(state, event.itemId);
        const text = requireText(event.text);
        if (text === item.text) fail('訂正前と同じ内容です');
        const from = item.text;
        item.text = text;
        pushHistory(item, seq, { change: '訂正', from, to: text, by, reason: event.reason || null });
        changedIds.push(item.id);
        summary = `${KIND_LABELS[item.kind]}を訂正: ${clip(text)}`;
        break;
      }
      case 'item.reclassify': {
        const item = requireItem(state, event.itemId);
        if (!KINDS.includes(event.kind)) fail(`未知の種類です: ${String(event.kind)}`);
        if (event.kind === item.kind) fail('種類が変わっていません');
        const fromKind = item.kind;
        item.kind = event.kind;
        item.status = initialStatus(event.kind);
        item.needsReview = event.kind === 'unclassified';
        if (event.kind !== 'action') { item.owner = null; item.due = null; }
        if (event.kind !== 'decision') item.consensus = null;
        pushHistory(item, seq, {
          change: '種類を変更', from: KIND_LABELS[fromKind], to: KIND_LABELS[event.kind], by, reason: event.reason || null,
        });
        changedIds.push(item.id);
        summary = `種類を変更: ${KIND_LABELS[fromKind]} → ${KIND_LABELS[event.kind]}`;
        break;
      }
      case 'decision.confirm': {
        const item = requireDecision(state, event.itemId);
        if (item.status === 'confirmed') fail('既に確定しています');
        if (!isAcceptedEvidence(event.evidence)) {
          // 根拠なき合意判定は拒否し、その事実を履歴に残す
          rejected = true;
          const note = event.evidence && event.evidence.note ? `（示された根拠: ${normalizeText(event.evidence.note)}）` : '';
          item.consensus = { kind: 'unverified', note: `明示的な合意確認がないため確定にしていません${note}` };
          pushHistory(item, seq, {
            change: '確定を見送り', from: item.status, to: item.status, by, reason: item.consensus.note,
          });
          changedIds.push(item.id);
          summary = `確定を見送り（合意根拠なし）: ${clip(item.text)}`;
          break;
        }
        item.consensus = { kind: event.evidence.kind, note: normalizeText(event.evidence.note) || null };
        setStatus(item, seq, 'confirmed', '確定', by, item.consensus.note);
        changedIds.push(item.id);
        summary = `決定を確定: ${clip(item.text)}`;
        break;
      }
      case 'decision.tentative': {
        const item = requireDecision(state, event.itemId);
        if (item.status === 'tentative') fail('既に仮案です');
        setStatus(item, seq, 'tentative', '仮案に戻す', by, event.reason);
        item.consensus = null;
        changedIds.push(item.id);
        summary = `仮案に戻しました: ${clip(item.text)}`;
        break;
      }
      case 'decision.withdraw': {
        const item = requireDecision(state, event.itemId);
        if (item.status === 'withdrawn') fail('既に撤回済みです');
        setStatus(item, seq, 'withdrawn', '撤回', by, event.reason);
        changedIds.push(item.id);
        summary = `決定・仮案を撤回: ${clip(item.text)}`;
        break;
      }
      case 'decision.revisit': {
        const item = requireDecision(state, event.itemId);
        if (item.status === 'revisit') fail('既に再検討中です');
        setStatus(item, seq, 'revisit', '再検討', by, event.reason);
        changedIds.push(item.id);
        summary = `再検討に戻しました: ${clip(item.text)}`;
        break;
      }
      case 'item.resolve': {
        const item = requireItem(state, event.itemId);
        if (!['open_question', 'next', 'action'].includes(item.kind)) fail('この種類は解決・完了にできません');
        const to = item.kind === 'action' ? 'done' : 'resolved';
        if (item.status === to) fail('既に解決・完了しています');
        setStatus(item, seq, to, item.kind === 'action' ? '完了' : '解決', by, event.reason);
        changedIds.push(item.id);
        summary = `${STATUS_LABELS[to]}にしました: ${clip(item.text)}`;
        break;
      }
      case 'item.reopen': {
        const item = requireItem(state, event.itemId);
        if (!['resolved', 'done'].includes(item.status)) fail('解決・完了していません');
        setStatus(item, seq, 'open', '再オープン', by, event.reason);
        changedIds.push(item.id);
        summary = `再オープン: ${clip(item.text)}`;
        break;
      }
      case 'action.update': {
        const item = requireItem(state, event.itemId);
        if (item.kind !== 'action') fail('アクションではありません');
        const owner = normalizeText(event.owner) || null;
        const due = normalizeText(event.due) || null;
        if (owner === item.owner && due === item.due) fail('担当・期限が変わっていません');
        const from = `担当: ${item.owner || '不明'} / 期限: ${item.due || '不明'}`;
        item.owner = owner;
        item.due = due;
        const to = `担当: ${owner || '不明'} / 期限: ${due || '不明'}`;
        pushHistory(item, seq, { change: '担当・期限を変更', from, to, by, reason: null });
        changedIds.push(item.id);
        summary = `アクションの${to}`;
        break;
      }
      default:
        fail(`未知のイベント種別です: ${String(event.type)}`);
    }
  } catch (err) {
    if (err instanceof EventError) {
      return { state: prev, ok: false, message: err.message, changedIds: [] };
    }
    throw err;
  }

  state.seq = seq;
  state.seenEventIds[event.id] = true;
  state.log.push({
    seq,
    eventId: event.id,
    type: event.type,
    by,
    topicId: state.currentTopicId,
    summary,
    rejected,
  });
  return { state, ok: true, rejected, changedIds };
}

export function isAcceptedEvidence(evidence) {
  return !!evidence && ACCEPTED_EVIDENCE.includes(evidence.kind);
}

function clip(text, n = 40) {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

/** 画面で使う派生ビュー。 */
export function selectView(state, viewTopicId) {
  const current = findTopic(state, state.currentTopicId);
  const shown = (viewTopicId && findTopic(state, viewTopicId)) || current;
  const inTopic = (id) => state.items.filter((i) => i.topicId === id);
  const byKind = (items, kind) => items.filter((i) => i.kind === kind);
  const shownItems = shown ? inTopic(shown.id) : [];
  const decisions = byKind(state.items, 'decision');
  return {
    current,
    shown,
    isViewingPast: !!shown && !!current && shown.id !== current.id,
    topicItems: {
      proposal: byKind(shownItems, 'proposal'),
      reason: byKind(shownItems, 'reason'),
      concern: byKind(shownItems, 'concern'),
      tradeoff: byKind(shownItems, 'tradeoff'),
      decision: byKind(shownItems, 'decision'),
      unclassified: byKind(shownItems, 'unclassified'),
    },
    decisions: {
      confirmed: decisions.filter((d) => d.status === 'confirmed'),
      tentative: decisions.filter((d) => d.status === 'tentative' || d.status === 'revisit'),
      withdrawn: decisions.filter((d) => d.status === 'withdrawn'),
    },
    openQuestions: state.items.filter((i) => i.kind === 'open_question' && i.status === 'open'),
    nextItems: state.items.filter((i) => i.kind === 'next' && i.status === 'open'),
    actions: byKind(state.items, 'action'),
    needsReview: state.items.filter((i) => i.needsReview),
    topics: state.topics.map((t) => ({ ...t, itemCount: inTopic(t.id).length, isCurrent: t.id === state.currentTopicId })),
    log: state.log,
  };
}
