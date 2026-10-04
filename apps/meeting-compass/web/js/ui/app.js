// 画面の配線。state は session（メモリ内）だけが持ち、ここでは差分描画とユーザー操作の変換を行う。

import { KIND_LABELS, STATUS_LABELS, ORIGIN_LABELS, selectView, findItem } from '../core/model.js';
import { createSession } from '../core/session.js';
import { PLAYER_STATUS_LABELS } from '../core/player.js';
import { toJSON, toMarkdown } from '../core/export.js';
import { createDemoProvider } from '../providers/demo-provider.js';
import { createManualProvider } from '../providers/manual-provider.js';
import { createAudioProvider } from '../providers/audio-provider.js';
import { h, reconcile, flash } from './dom.js';

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const session = createSession();
const ui = {
  /** 表示中の論点（null なら現在の論点） */
  viewTopicId: /** @type {string|null} */ (null),
  /** 編集中の要素キー（リスト名:項目ID） */
  editingKey: /** @type {string|null} */ (null),
  cleared: false,
  lastTopicId: /** @type {string|null} */ (null),
};

const demo = createDemoProvider({
  session,
  onStep(step, index) {
    $('utterance').textContent = step.utterance;
    $('progress-text').textContent = `ステップ ${index + 1} / ${demo.player.total}`;
  },
  onStatus: () => renderStatus(),
});
const manual = createManualProvider({ session });
const audio = createAudioProvider();

// ---------- 描画 ----------

function topicTitle(state, id) {
  return state.topics.find((t) => t.id === id)?.title ?? '';
}

function badge(text, cls) {
  return h('span', { class: `badge ${cls}`, text });
}

function itemSignature(item, listName) {
  return `${item.rev}|${item.status}|${item.kind}|${ui.editingKey === `${listName}:${item.id}` ? 'edit' : ''}|${item.topicId}`;
}

function itemActions(item, listName) {
  const b = (action, label, cls = '') => h('button', {
    type: 'button', class: `btn btn-small ${cls}`, 'data-action': action, 'data-id': item.id, 'data-list': listName, text: label,
  });
  const out = [];
  if (item.kind === 'decision') {
    // 撤回済みはいきなり確定せず、再検討か仮案に戻してから確定する
    if (item.status === 'tentative' || item.status === 'revisit') out.push(b('confirm', '確定にする', 'btn-ok'));
    if (item.status !== 'tentative') out.push(b('tentative', '仮案に戻す'));
    if (item.status !== 'revisit') out.push(b('revisit', '再検討'));
    if (item.status !== 'withdrawn') out.push(b('withdraw', '撤回', 'btn-warn'));
  }
  if (['open_question', 'next', 'action'].includes(item.kind)) {
    if (item.status === 'open') out.push(b('resolve', item.kind === 'action' ? '完了' : '解決済みにする', 'btn-ok'));
    else out.push(b('reopen', '再オープン'));
  }
  out.push(b('edit', item.kind === 'unclassified' ? '確認して分類' : '修正'));
  return h('div', { class: 'item-actions' }, out);
}

function itemEditor(item, listName) {
  const options = Object.entries(KIND_LABELS).map(([k, label]) => h('option', { value: k, text: label, selected: k === item.kind }));
  const isAction = item.kind === 'action';
  return h('form', { class: 'editor', 'data-id': item.id, 'data-list': listName }, [
    h('label', { class: 'editor-label', text: '本文' }, [h('textarea', { name: 'text', rows: 3, maxlength: 500 }, [item.text])]),
    h('label', { class: 'editor-label', text: '種類' }, [h('select', { name: 'kind' }, options)]),
    isAction && h('label', { class: 'editor-label', text: '担当（空欄なら不明）' }, [h('input', { type: 'text', name: 'owner', value: item.owner ?? '', maxlength: 60, autocomplete: 'off' })]),
    isAction && h('label', { class: 'editor-label', text: '期限（空欄なら不明）' }, [h('input', { type: 'text', name: 'due', value: item.due ?? '', maxlength: 60, autocomplete: 'off' })]),
    h('label', { class: 'editor-label', text: '修正の理由（任意）' }, [h('input', { type: 'text', name: 'reason', maxlength: 200, autocomplete: 'off' })]),
    h('div', { class: 'item-actions' }, [
      h('button', { type: 'submit', class: 'btn btn-small btn-primary', text: '保存' }),
      h('button', { type: 'button', class: 'btn btn-small', 'data-action': 'edit-cancel', text: 'キャンセル' }),
    ]),
    h('p', { class: 'feedback editor-feedback', role: 'status' }),
  ]);
}

function renderItemInto(el, item, isNew, listName, state, opts = {}) {
  const sig = itemSignature(item, listName);
  if (el.dataset.sig === sig) return;
  const hadSig = !!el.dataset.sig;
  const wasOpen = el.querySelector('details')?.open ?? false;
  el.dataset.sig = sig;
  el.dataset.id = item.id;
  el.className = `item kind-${item.kind} status-${item.status}`;
  el.replaceChildren();

  if (ui.editingKey === `${listName}:${item.id}`) {
    el.append(itemEditor(item, listName));
    return;
  }

  const head = h('div', { class: 'item-head' }, [
    opts.showKind !== false && badge(KIND_LABELS[item.kind], `badge-kind kind-${item.kind}`),
    (item.kind === 'decision' || item.status === 'resolved' || item.status === 'done') && badge(STATUS_LABELS[item.status], `badge-status st-${item.status}`),
    item.consensus?.kind === 'unverified' && item.status !== 'confirmed' && badge('合意未確認', 'badge-warn'),
    item.needsReview && badge('人による確認待ち', 'badge-warn'),
    badge(ORIGIN_LABELS[item.origin], 'badge-origin'),
    opts.showTopic && badge(`論点: ${topicTitle(state, item.topicId)}`, 'badge-topic'),
  ]);
  const parent = item.parentId ? findItem(state, item.parentId) : null;
  const body = [
    head,
    h('p', { class: 'item-text', text: item.text }),
    parent && h('p', { class: 'item-sub', text: `↳ 対象: ${KIND_LABELS[parent.kind]}「${parent.text}」` }),
    item.kind === 'action' && h('p', { class: 'item-sub item-meta' }, [
      h('span', { text: `担当: ${item.owner ?? '不明'}`, class: item.owner ? '' : 'unknown' }),
      h('span', { text: `期限: ${item.due ?? '不明'}`, class: item.due ? '' : 'unknown' }),
    ]),
    item.consensus && item.consensus.note && h('p', { class: 'item-sub', text: `合意の根拠: ${item.consensus.note}` }),
    item.ruleNote && h('p', { class: 'item-sub', text: item.ruleNote }),
  ];
  if (item.history.length > 1) {
    const hist = h('details', { class: 'history', open: wasOpen }, [
      h('summary', { text: `履歴 ${item.history.length}件（訂正・撤回を含む）` }),
      h('ol', {}, item.history.map((x) => h('li', {}, [
        h('span', { class: 'history-seq', text: `#${x.seq}` }),
        h('span', { text: `${x.change}${x.from && x.to && x.from !== x.to ? `：${x.from} → ${x.to}` : ''}` }),
        x.reason && h('span', { class: 'muted', text: `（${x.reason}）` }),
        h('span', { class: 'muted', text: ` ・${ORIGIN_LABELS[x.by] ?? x.by}` }),
      ]))),
    ]);
    body.push(hist);
  }
  body.push(itemActions(item, listName));
  el.append(...body.filter(Boolean));
  if (!isNew || hadSig) flash(el, 'flash');
  else flash(el, 'flash-new');
}

function renderList(id, items, state, opts = {}) {
  const list = $(id);
  reconcile(list, items, (i) => i.id, (el, item, isNew) => renderItemInto(el, item, isNew, id, state, opts));
}

function renderTopics(view) {
  reconcile($('list-topics'), view.topics, (t) => t.id, (el, t) => {
    const viewing = view.shown?.id === t.id;
    const sig = `${t.title}|${t.isCurrent}|${t.visits}|${t.itemCount}|${viewing}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.dataset.id = t.id;
    el.className = `topic${t.isCurrent ? ' is-current' : ''}${viewing ? ' is-viewing' : ''}`;
    el.replaceChildren(
      h('div', { class: 'topic-main' }, [
        h('span', { class: 'topic-title', text: t.title }),
        h('span', { class: 'topic-meta' }, [
          t.isCurrent && badge('現在', 'badge-current'),
          t.digression && badge('脱線', 'badge-warn'),
          t.visits > 1 && badge(`戻り ${t.visits - 1}回`, 'badge-origin'),
          h('span', { class: 'muted', text: `${t.itemCount}項目` }),
        ]),
      ]),
      h('div', { class: 'item-actions' }, [
        !viewing && h('button', { type: 'button', class: 'btn btn-small', 'data-action': 'view-topic', 'data-id': t.id, text: '表示' }),
        !t.isCurrent && h('button', { type: 'button', class: 'btn btn-small', 'data-action': 'switch-topic', 'data-id': t.id, text: '現在の論点にする' }),
      ]),
    );
  });
}

function renderLog(view) {
  const entries = view.log.slice(-80).reverse();
  reconcile($('list-log'), entries, (e) => String(e.seq), (el, e) => {
    if (el.dataset.sig) return; // 履歴は不変
    el.dataset.sig = '1';
    el.className = `log-entry${e.rejected ? ' is-rejected' : ''}`;
    el.append(
      h('span', { class: 'history-seq', text: `#${e.seq}` }),
      h('span', { class: 'log-text', text: e.summary }),
      h('span', { class: 'muted', text: ORIGIN_LABELS[e.by] ?? e.by }),
    );
  });
}

function renderCurrent(view, state) {
  const { shown, current } = view;
  $('past-banner').hidden = !view.isViewingPast;
  $('current').classList.toggle('is-past', view.isViewingPast);
  $('current-eyebrow').textContent = view.isViewingPast ? '過去の論点（参照中）' : 'いまの論点';
  if (!shown) {
    $('current-title').textContent = ui.cleared ? '内容は消去されました' : 'まだ論点はありません';
    $('current-meta').textContent = 'デモを再生するか、下の手入力で「議題: ○○」と入力してください。';
  } else {
    $('current-title').textContent = shown.title;
    const bits = [];
    if (shown.digression) bits.push('脱線した話題');
    if (shown.visits > 1) bits.push(`この論点に${shown.visits - 1}回戻ってきています`);
    if (view.isViewingPast && current) bits.push(`会議の現在の論点は「${current.title}」`);
    bits.push(`由来: ${ORIGIN_LABELS[shown.origin]}`);
    $('current-meta').textContent = bits.join(' ・ ');
  }
  $('current').classList.toggle('is-digression', !!shown?.digression);
  const ti = view.topicItems;
  renderList('list-proposal', ti.proposal, state, { showKind: false });
  renderList('list-reason', ti.reason, state, { showKind: false });
  renderList('list-concern', ti.concern, state, { showKind: false });
  renderList('list-tradeoff', ti.tradeoff, state, { showKind: false });
  renderList('list-topic-decision', ti.decision, state, { showKind: false });
  renderList('list-topic-unclassified', ti.unclassified, state, { showKind: false });
}

function renderStatus() {
  const chip = $('chip-state');
  const st = demo.player.status;
  chip.dataset.state = st;
  chip.textContent = ui.cleared && st === 'idle' ? '停止中（消去済み）' : PLAYER_STATUS_LABELS[st];
  /** @type {HTMLButtonElement} */ ($('btn-play')).disabled = st === 'playing' || st === 'ended';
  /** @type {HTMLButtonElement} */ ($('btn-pause')).disabled = st !== 'playing';
  /** @type {HTMLButtonElement} */ ($('btn-step')).disabled = st === 'ended';
  $('btn-play').textContent = st === 'paused' ? '▶ 再開' : '▶ 再生';
  const pct = demo.player.total ? (demo.player.cursor / demo.player.total) * 100 : 0;
  $('progress-bar').style.width = `${pct}%`;
  if (st === 'idle') {
    $('progress-text').textContent = `ステップ 0 / ${demo.player.total}`;
    $('utterance').textContent = '再生すると、台本上の発言の要約（参考表示・逐語録ではありません）がここに出ます。';
  }
}

function render() {
  const state = session.getState();
  if (ui.viewTopicId && !state.topics.some((t) => t.id === ui.viewTopicId)) ui.viewTopicId = null;
  const view = selectView(state, ui.viewTopicId);

  renderCurrent(view, state);
  renderList('list-confirmed', view.decisions.confirmed, state, { showKind: false, showTopic: true });
  renderList('list-tentative', view.decisions.tentative, state, { showKind: false, showTopic: true });
  renderList('list-withdrawn', view.decisions.withdrawn, state, { showKind: false, showTopic: true });
  $('withdrawn-count').textContent = String(view.decisions.withdrawn.length);
  renderList('list-open', view.openQuestions, state, { showKind: false, showTopic: true });
  renderList('list-next', view.nextItems, state, { showKind: false, showTopic: true });
  renderList('list-actions', view.actions, state, { showKind: false, showTopic: true });
  renderList('list-review', view.needsReview, state, { showKind: false, showTopic: true });
  renderTopics(view);
  renderLog(view);
  renderStatus();

  if (state.currentTopicId !== ui.lastTopicId) {
    ui.lastTopicId = state.currentTopicId;
    if (view.current) $('live').textContent = `論点が「${view.current.title}」に切り替わりました`;
  }
}

function renderRoutes() {
  $('list-routes').replaceChildren(...audio.routes.map((r) => h('li', { class: 'route' }, [
    h('div', { class: 'route-head' }, [
      h('span', { class: 'route-label', text: `${r.priority}. ${r.label}` }),
      badge(r.status === 'not_available' ? '現時点で採用しない' : '未接続', 'badge-off'),
    ]),
    h('p', { class: 'item-sub', text: r.detail }),
  ])));
}

// ---------- 操作 ----------

function userEvent(type, fields) {
  return session.dispatch({ id: session.nextId('u'), type, by: 'user', ...fields });
}

function setFeedback(id, text, ok = true) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('is-error', !ok);
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { 'data-download': filename });
  /** @type {HTMLAnchorElement} */ (a).href = url;
  /** @type {HTMLAnchorElement} */ (a).download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clearAll() {
  demo.player.reset();
  session.clear();
  ui.viewTopicId = null;
  ui.editingKey = null;
  ui.lastTopicId = null;
  ui.cleared = true;
  render();
}

document.addEventListener('click', (ev) => {
  const target = /** @type {HTMLElement} */ (ev.target);
  const btn = target.closest('[data-action]');
  if (!(btn instanceof HTMLElement) || btn.tagName === 'FORM') return;
  const { action, id } = btn.dataset;
  switch (action) {
    case 'play': ui.cleared = false; demo.player.play(); break;
    case 'pause': demo.player.pause(); break;
    case 'step': ui.cleared = false; demo.player.step(); break;
    case 'reset':
      demo.player.reset();
      session.clear();
      ui.viewTopicId = null; ui.editingKey = null; ui.lastTopicId = null; ui.cleared = false;
      setFeedback('data-feedback', 'リセットしました。デモは最初から、手入力の内容も破棄されています。');
      break;
    case 'view-topic': ui.viewTopicId = id ?? null; break;
    case 'view-current': ui.viewTopicId = null; break;
    case 'switch-topic': userEvent('topic.switch', { topicId: id }); ui.viewTopicId = null; break;
    case 'confirm': userEvent('decision.confirm', { itemId: id, evidence: { kind: 'user', note: 'ユーザーが画面で確定操作' } }); break;
    case 'tentative': userEvent('decision.tentative', { itemId: id, reason: 'ユーザー操作' }); break;
    case 'revisit': userEvent('decision.revisit', { itemId: id, reason: 'ユーザー操作' }); break;
    case 'withdraw': userEvent('decision.withdraw', { itemId: id, reason: 'ユーザー操作' }); break;
    case 'resolve': userEvent('item.resolve', { itemId: id, reason: 'ユーザー操作' }); break;
    case 'reopen': userEvent('item.reopen', { itemId: id, reason: 'ユーザー操作' }); break;
    case 'edit': ui.editingKey = `${btn.dataset.list}:${id}`; break;
    case 'edit-cancel': ui.editingKey = null; break;
    case 'export-json': {
      const stamp = new Date().toISOString();
      download('meeting-compass-export.json', toJSON(session.getState(), stamp), 'application/json');
      setFeedback('data-feedback', 'JSONを書き出しました（この端末への保存のみ）。');
      break;
    }
    case 'export-md': {
      const stamp = new Date().toISOString();
      download('meeting-compass-export.md', toMarkdown(session.getState(), stamp), 'text/markdown');
      setFeedback('data-feedback', 'Markdownを書き出しました（この端末への保存のみ）。');
      break;
    }
    case 'clear-ask': $('clear-confirm').hidden = false; break;
    case 'clear-no': $('clear-confirm').hidden = true; break;
    case 'clear-yes':
      $('clear-confirm').hidden = true;
      clearAll();
      setFeedback('data-feedback', 'すべて消去しました。メモリ上の内容は破棄され、デモは停止しています。');
      break;
    default: return;
  }
  render();
  if (action === 'edit') {
    const form = document.querySelector(`form.editor[data-id="${CSS.escape(id ?? '')}"]`);
    form?.querySelector('textarea')?.focus();
  }
});

document.addEventListener('submit', (ev) => {
  const form = /** @type {HTMLFormElement} */ (ev.target);
  ev.preventDefault();
  if (form.id === 'manual-form') {
    const text = /** @type {HTMLTextAreaElement} */ ($('manual-text')).value;
    const kind = /** @type {HTMLSelectElement} */ ($('manual-kind')).value;
    const res = manual.submit(text, kind);
    setFeedback('manual-feedback', res.message, res.ok);
    if (res.ok) {
      ui.cleared = false;
      ui.viewTopicId = null;
      /** @type {HTMLTextAreaElement} */ ($('manual-text')).value = '';
    }
    render();
    return;
  }
  if (form.classList.contains('editor')) {
    const id = form.dataset.id ?? '';
    const item = findItem(session.getState(), id);
    if (!item) return;
    const fd = new FormData(form);
    const reason = String(fd.get('reason') ?? '') || 'ユーザーが修正';
    const text = String(fd.get('text') ?? '');
    const kind = String(fd.get('kind') ?? item.kind);
    const errors = [];
    if (text.trim() !== item.text) {
      const r = userEvent('item.correct', { itemId: id, text, reason });
      if (!r.ok) errors.push(r.message);
    }
    if (!errors.length && kind !== item.kind) {
      const r = userEvent('item.reclassify', { itemId: id, kind, reason });
      if (!r.ok) errors.push(r.message);
    }
    if (!errors.length && item.kind === 'action' && kind === 'action') {
      const owner = String(fd.get('owner') ?? '').trim() || null;
      const due = String(fd.get('due') ?? '').trim() || null;
      if (owner !== item.owner || due !== item.due) {
        const r = userEvent('action.update', { itemId: id, owner, due });
        if (!r.ok) errors.push(r.message);
      }
    }
    if (errors.length) {
      const fb = form.querySelector('.editor-feedback');
      if (fb) { fb.textContent = errors.join(' / '); fb.classList.add('is-error'); }
      return;
    }
    ui.editingKey = null;
    render();
  }
});

$('speed').addEventListener('change', (ev) => {
  demo.player.setInterval(Number(/** @type {HTMLSelectElement} */ (ev.target).value));
});

renderRoutes();
render();
// テスト・デバッグ用の読み取り専用フック（state の複製を返すだけ）
Object.defineProperty(window, '__meetingCompass', {
  value: Object.freeze({ snapshot: () => structuredClone(session.getState()), providers: [demo.id, manual.id, audio.id] }),
});
