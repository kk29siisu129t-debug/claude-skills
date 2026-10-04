// 画面の配線。state は session（メモリ内）だけが持ち、ここでは差分描画とユーザー操作の変換を行う。

import { KIND_LABELS, STATUS_LABELS, ORIGIN_LABELS, selectView, findItem } from '../core/model.js';
import { createSession } from '../core/session.js';
import { PLAYER_STATUS_LABELS } from '../core/player.js';
import { toJSON, toMarkdown } from '../core/export.js';
import { createDemoProvider } from '../providers/demo-provider.js';
import { createManualProvider } from '../providers/manual-provider.js';
import { createAudioProvider } from '../providers/audio-provider.js';
import { h, reconcile, flash } from './dom.js';
import { download } from './download.js';

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** Claude Artifact 用の単一HTML版か（scripts/bundle-artifact.mjs が目印の要素を入れる） */
const ARTIFACT_BUILD = document.getElementById('mc-build')?.dataset.build === 'artifact';
const TABS = ['review', 'topics', 'log', 'audio', 'data'];

const session = createSession();
const ui = {
  /** 表示中の論点（null なら現在の論点） */
  viewTopicId: /** @type {string|null} */ (null),
  /** 編集中の要素キー（リスト名:項目ID）。編集中はデモ再生を止め、フォームを作り直さない */
  editingKey: /** @type {string|null} */ (null),
  tab: 'review',
  cleared: false,
  lastTopicId: /** @type {string|null} */ (null),
};

const demo = createDemoProvider({
  session,
  onStep(step, index) {
    $('utterance').textContent = step.utterance;
    $('progress-text').textContent = `${index + 1} / ${demo.player.total}`;
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

function lastReason(item, change) {
  for (let i = item.history.length - 1; i >= 0; i--) {
    if (item.history[i].change === change) return item.history[i].reason;
  }
  return null;
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
  return h('form', { class: 'editor', 'data-id': item.id, 'data-list': listName, 'data-rev': item.rev }, [
    h('p', { class: 'editor-note', text: 'デモ再生は一時停止中です。保存かキャンセルで編集を終えると再開できます。' }),
    h('label', { class: 'editor-label', text: '本文' }, [h('textarea', { name: 'text', rows: 3, maxlength: 500 }, [item.text])]),
    h('label', { class: 'editor-label', text: '種類' }, [h('select', { name: 'kind' }, options)]),
    isAction && h('label', { class: 'editor-label', text: '担当（空欄なら不明）' }, [h('input', { type: 'text', name: 'owner', value: item.owner ?? '', maxlength: 60, autocomplete: 'off' })]),
    isAction && h('label', { class: 'editor-label', text: '期限（空欄なら不明）' }, [h('input', { type: 'text', name: 'due', value: item.due ?? '', maxlength: 60, autocomplete: 'off' })]),
    h('label', { class: 'editor-label', text: '修正の理由（任意）' }, [h('input', { type: 'text', name: 'reason', maxlength: 200, autocomplete: 'off' })]),
    h('div', { class: 'editor-actions' }, [
      h('button', { type: 'submit', class: 'btn btn-small btn-primary', text: '保存' }),
      h('button', { type: 'button', class: 'btn btn-small', 'data-action': 'edit-cancel', text: 'キャンセル' }),
    ]),
    h('p', { class: 'feedback editor-feedback', role: 'status' }),
  ]);
}

function renderItemInto(el, item, isNew, listName, state, opts = {}) {
  const editing = ui.editingKey === `${listName}:${item.id}`;
  if (editing) {
    // 編集中のフォームは作り直さない（入力を消さない）。下で内容が変わった場合だけ知らせる
    const form = el.querySelector('form.editor');
    if (form) {
      const fb = form.querySelector('.editor-feedback');
      if (fb && Number(form.dataset.rev) !== item.rev) {
        fb.textContent = '編集中にこの項目が更新されました。保存すると入力内容で訂正します。';
        fb.classList.add('is-error');
      }
      return;
    }
  }
  const sig = itemSignature(item, listName);
  if (el.dataset.sig === sig) return;
  const hadSig = !!el.dataset.sig;
  const wasOpen = el.querySelector('details')?.open ?? false;
  el.dataset.sig = sig;
  el.dataset.id = item.id;
  el.className = `item kind-${item.kind} status-${item.status}${editing ? ' is-editing' : ''}`;
  el.replaceChildren();

  if (editing) {
    el.append(itemEditor(item, listName));
    return;
  }

  const head = [
    opts.showKind !== false && badge(KIND_LABELS[item.kind], `badge-kind kind-${item.kind}`),
    (item.kind === 'decision' || item.status === 'resolved' || item.status === 'done') && badge(STATUS_LABELS[item.status], `badge-status st-${item.status}`),
    item.consensus?.kind === 'unverified' && item.status !== 'confirmed' && badge('合意未確認', 'badge-warn'),
    item.needsReview && badge('人による確認待ち', 'badge-warn'),
  ].filter(Boolean);

  const parent = item.parentId ? findItem(state, item.parentId) : null;
  const metaBits = [
    item.ruleNote ? `${ORIGIN_LABELS[item.origin]}（${item.ruleNote}）` : ORIGIN_LABELS[item.origin],
    opts.showTopic && `論点: ${topicTitle(state, item.topicId)}`,
    parent && `↳ ${KIND_LABELS[parent.kind]}「${parent.text}」`,
  ].filter(Boolean).join(' ・ ');

  /** 確定・合意未確認・撤回・再検討の根拠／理由は必ず表示する */
  let basis = null;
  if (item.kind === 'decision') {
    if (item.status === 'confirmed' && item.consensus?.note) basis = `根拠: ${item.consensus.note}`;
    else if (item.status === 'withdrawn') basis = `撤回理由: ${lastReason(item, '撤回') ?? '記録なし'}`;
    else if (item.status === 'revisit') basis = `再検討の理由: ${lastReason(item, '再検討') ?? '記録なし'}`;
    else if (item.consensus?.kind === 'unverified') basis = item.consensus.note;
  }

  const body = [
    head.length ? h('div', { class: 'item-head' }, head) : null,
    h('p', { class: 'item-text', text: item.text }),
    item.kind === 'action' && h('p', { class: 'item-sub item-meta' }, [
      h('span', { text: `担当: ${item.owner ?? '不明'}`, class: item.owner ? '' : 'unknown' }),
      h('span', { text: `期限: ${item.due ?? '不明'}`, class: item.due ? '' : 'unknown' }),
    ]),
    basis && h('p', { class: 'item-basis', text: basis, title: basis }),
    h('p', { class: 'item-sub item-origin', text: metaBits, title: metaBits }),
  ];
  // サマリー（compact）では行履歴を省き、根拠・理由の1〜2行だけを残す
  if (item.history.length > 1 && !opts.compact) {
    body.push(h('details', { class: 'history', open: wasOpen }, [
      h('summary', { text: `履歴 ${item.history.length}件` }),
      h('ol', {}, item.history.map((x) => h('li', {}, [
        h('span', { class: 'history-seq', text: `#${x.seq}` }),
        h('span', { text: `${x.change}${x.from && x.to && x.from !== x.to ? `：${x.from} → ${x.to}` : ''}` }),
        x.reason && h('span', { class: 'muted', text: `（${x.reason}）` }),
        h('span', { class: 'muted', text: ` ・${ORIGIN_LABELS[x.by] ?? x.by}` }),
      ]))),
    ]));
  }
  body.push(itemActions(item, listName));
  el.append(...body.filter(Boolean));
  if (!isNew || hadSig) flash(el, 'flash');
  else flash(el, 'flash-new');
}

function renderList(id, items, state, opts = {}) {
  reconcile($(id), items, (i) => i.id, (el, item, isNew) => renderItemInto(el, item, isNew, id, state, opts));
}

function renderTopicChips(view) {
  reconcile($('topic-chips'), view.topics, (t) => t.id, (el, t) => {
    const viewing = view.shown?.id === t.id;
    const sig = `${t.title}|${t.isCurrent}|${viewing}|${t.digression}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.dataset.id = t.id;
    el.className = `topic-chip${t.isCurrent ? ' is-current' : ''}${viewing ? ' is-viewing' : ''}${t.digression ? ' is-digression' : ''}`;
    el.replaceChildren(h('button', {
      type: 'button',
      'data-action': t.isCurrent ? 'view-current' : 'view-topic',
      'data-id': t.id,
      'aria-current': t.isCurrent ? 'true' : null,
      title: t.isCurrent ? '会議の現在の論点' : '押すと参照（会議の論点は変わりません）',
      text: `${t.isCurrent ? '● ' : ''}${t.title}`,
    }));
  });
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
      h('div', { class: 'topic-actions' }, [
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
  $('lanes').classList.toggle('is-past', view.isViewingPast);
  $('current-eyebrow').textContent = view.isViewingPast ? '過去の論点（参照中）' : 'いまの論点';
  if (!shown) {
    $('current-title').textContent = ui.cleared ? '内容は消去されました' : 'まだ論点はありません';
    $('current-meta').textContent = 'デモを再生するか、下の「手入力」で「議題: ○○」と入力してください。';
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
  renderTopicChips(view);
  const ti = view.topicItems;
  renderList('list-proposal', ti.proposal, state, { showKind: false });
  renderList('list-reason', ti.reason, state, { showKind: false });
  renderList('list-concern', ti.concern, state, { showKind: false });
  renderList('list-tradeoff', ti.tradeoff, state, { showKind: false });
  renderList('list-topic-decision', ti.decision, state, { showKind: false });
  renderList('list-topic-unclassified', ti.unclassified, state, { showKind: false });
}

function renderTabs(view) {
  for (const t of TABS) {
    const on = ui.tab === t;
    $(`tab-${t}`).setAttribute('aria-selected', String(on));
    $(`tab-${t}`).tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
  }
  $('tabcount-review').textContent = String(view.needsReview.length);
  $('tabcount-topics').textContent = String(view.topics.length);
  $('tabcount-log').textContent = String(view.log.length);
  $('review-link').hidden = view.needsReview.length === 0;
  $('review-link-btn').textContent = `要確認（未分類） ${view.needsReview.length}件を見る`;
}

function renderStatus() {
  const chip = $('chip-state');
  const st = demo.player.status;
  const editing = !!ui.editingKey;
  chip.dataset.state = st;
  chip.textContent = ui.cleared && st === 'idle' ? '停止中（消去済み）' : PLAYER_STATUS_LABELS[st];
  /** @type {HTMLButtonElement} */ ($('btn-play')).disabled = editing || st === 'playing' || st === 'ended';
  /** @type {HTMLButtonElement} */ ($('btn-pause')).disabled = st !== 'playing';
  /** @type {HTMLButtonElement} */ ($('btn-step')).disabled = editing || st === 'ended';
  $('btn-play').textContent = st === 'paused' ? '▶ 再開' : '▶ 再生';
  const note = $('control-note');
  note.hidden = !editing;
  note.textContent = editing ? '項目を編集中のため、デモ再生を止めています。保存かキャンセルで再開できます。' : '';
  const pct = demo.player.total ? (demo.player.cursor / demo.player.total) * 100 : 0;
  $('progress-bar').style.width = `${pct}%`;
  if (st === 'idle') {
    $('progress-text').textContent = `0 / ${demo.player.total}`;
    $('utterance').textContent = '再生すると、台本上の発言の要約がここに出ます（逐語録ではありません）。';
  }
}

function render() {
  const state = session.getState();
  if (ui.viewTopicId && !state.topics.some((t) => t.id === ui.viewTopicId)) ui.viewTopicId = null;
  if (ui.editingKey && !findItem(state, ui.editingKey.split(':')[1])) ui.editingKey = null;
  const view = selectView(state, ui.viewTopicId);

  renderCurrent(view, state);
  renderList('list-confirmed', view.decisions.confirmed, state, { showKind: false, showTopic: true, compact: true });
  renderList('list-tentative', view.decisions.tentative, state, { showKind: false, showTopic: true, compact: true });
  renderList('list-withdrawn', view.decisions.withdrawn, state, { showKind: false, showTopic: true, compact: true });
  $('withdrawn-count').textContent = String(view.decisions.withdrawn.length);
  $('count-confirmed').textContent = `確定 ${view.decisions.confirmed.length}`;
  $('count-tentative').textContent = `仮案 ${view.decisions.tentative.length}`;
  $('count-withdrawn').textContent = `撤回 ${view.decisions.withdrawn.length}`;
  const unknownOwner = view.actions.filter((a) => a.status === 'open' && !a.owner).length;
  $('quick-confirmed').textContent = `確定 ${view.decisions.confirmed.length}`;
  $('quick-tentative').textContent = `仮案 ${view.decisions.tentative.length}`;
  $('quick-withdrawn').textContent = `撤回 ${view.decisions.withdrawn.length}`;
  $('quick-next').textContent = `次に決める ${view.nextItems.length}`;
  $('quick-actions').textContent = `アクション ${view.actions.filter((a) => a.status === 'open').length}${unknownOwner ? `（担当不明 ${unknownOwner}）` : ''}`;
  $('quick-open').textContent = `未解決 ${view.openQuestions.length}`;
  renderList('list-next', view.nextItems, state, { showKind: false, showTopic: true, compact: true });
  renderList('list-actions', view.actions, state, { showKind: false, showTopic: true, compact: true });
  renderList('list-open', view.openQuestions, state, { showKind: false, showTopic: true, compact: true });
  renderList('list-review', view.needsReview, state, { showKind: false, showTopic: true });
  renderTopics(view);
  renderLog(view);
  renderTabs(view);
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

function resetAll(cleared) {
  demo.player.reset();
  session.clear();
  ui.viewTopicId = null;
  ui.editingKey = null;
  ui.lastTopicId = null;
  ui.cleared = cleared;
}

function focusEditor(id) {
  const form = document.querySelector(`form.editor[data-id="${CSS.escape(id ?? '')}"]`);
  form?.querySelector('textarea')?.focus();
}

document.addEventListener('click', (ev) => {
  const target = /** @type {HTMLElement} */ (ev.target);
  const btn = target.closest('[data-action]');
  if (!(btn instanceof HTMLElement) || btn.tagName === 'FORM') return;
  const { action, id } = btn.dataset;
  switch (action) {
    case 'play': if (!ui.editingKey) { ui.cleared = false; demo.player.play(); } break;
    case 'pause': demo.player.pause(); break;
    case 'step': if (!ui.editingKey) { ui.cleared = false; demo.player.step(); } break;
    case 'reset':
      resetAll(false);
      setFeedback('data-feedback', 'リセットしました。デモは最初から、手入力の内容も破棄されています。');
      break;
    case 'tab':
      ui.tab = TABS.includes(btn.dataset.tab ?? '') ? /** @type {string} */ (btn.dataset.tab) : 'review';
      // 詳細は折り畳み。外（要確認への導線など）から開いたときは展開する
      /** @type {HTMLDetailsElement} */ ($('details-fold')).open = true;
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
    case 'edit':
      // 編集を開いたら再生を自動で一時停止し、編集中は再生・一歩進めるを無効にする
      demo.player.pause();
      ui.editingKey = `${btn.dataset.list}:${id}`;
      break;
    case 'edit-cancel': ui.editingKey = null; break;
    case 'export-json':
    case 'export-md':
      // Artifact の閲覧画面はページからのダウンロードを止めるため、この版では書き出さない
      if (ARTIFACT_BUILD) {
        setFeedback('data-feedback', 'Artifact 版では書き出しは使えません。', false);
        break;
      }
      if (action === 'export-md') {
        download('meeting-compass-export.md', toMarkdown(session.getState(), new Date().toISOString()), 'text/markdown');
        setFeedback('data-feedback', 'Markdownを書き出しました（この端末への保存のみ）。');
        break;
      }
      download('meeting-compass-export.json', toJSON(session.getState(), new Date().toISOString()), 'application/json');
      setFeedback('data-feedback', 'JSONを書き出しました（この端末への保存のみ）。');
      break;
    case 'jump': {
      const dest = document.getElementById(btn.dataset.target ?? '');
      if (dest instanceof HTMLDetailsElement) dest.open = true;
      dest?.scrollIntoView({ block: 'start' });
      return;
    }
    case 'clear-ask': $('clear-confirm').hidden = false; break;
    case 'clear-no': $('clear-confirm').hidden = true; break;
    case 'clear-yes':
      $('clear-confirm').hidden = true;
      resetAll(true);
      setFeedback('data-feedback', 'すべて消去しました。メモリ上の内容は破棄され、デモは停止しています。');
      break;
    default: return;
  }
  render();
  if (action === 'edit') focusEditor(id);
  if (action === 'tab' && btn.id === 'review-link-btn') $('details-fold').scrollIntoView({ block: 'start' });
});

document.addEventListener('keydown', (ev) => {
  const target = /** @type {HTMLElement} */ (ev.target);
  if (ev.key === 'Escape' && target.closest('form.editor')) {
    ui.editingKey = null;
    render();
    return;
  }
  // タブの左右キー移動
  if ((ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') && target.getAttribute('role') === 'tab') {
    const i = TABS.indexOf(ui.tab);
    ui.tab = TABS[(i + (ev.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    render();
    $(`tab-${ui.tab}`).focus();
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

// 自動再生など、クリック以外で state が変わったときも描画する（同じタスク内の複数イベントは1回にまとめる）
let renderQueued = false;
session.subscribe(() => {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    render();
  });
});

/** Artifact 版：使えない書き出しは無効と明示し、送信・保存の説明をこの版に合わせる */
function applyArtifactBuild() {
  if (!ARTIFACT_BUILD) return;
  for (const id of ['btn-export-json', 'btn-export-md']) {
    const b = /** @type {HTMLButtonElement} */ ($(id));
    b.disabled = true;
    b.textContent = `${b.textContent}（Artifact版では無効）`;
  }
  $('data-hint').textContent = '内容はこのタブのメモリ上だけにあり、再読み込みや「消去」で失われます。Claude Artifact の閲覧画面はページからのファイル保存を止めるため、この版では書き出しを無効にしています。';
  $('footer-note').textContent = 'Meeting Compass プロトタイプ（Claude Artifact 版）・ 架空のデモデータのみ ・ 外部へ送信するコードを含みません ・ AIによる理解・音声入力は未接続';
}

applyArtifactBuild();
renderRoutes();
render();
// テスト・デバッグ用の読み取り専用フック（state の複製を返すだけ）
Object.defineProperty(window, '__meetingCompass', {
  value: Object.freeze({ snapshot: () => structuredClone(session.getState()), providers: [demo.id, manual.id, audio.id] }),
});
