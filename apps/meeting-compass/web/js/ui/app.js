// 画面の配線。state は session（メモリ内）だけが持ち、ここでは差分描画とユーザー操作の変換を行う。
// 自動でスクロール・並べ替えはしない。移動するのは利用者が「最新の更新へ」などを押したときだけ。

import { ORIGIN_LABELS, ancestorsOf, flatten, getNode } from '../core/outline.js';
import { createSession } from '../core/session.js';
import { PLAYER_STATUS_LABELS } from '../core/player.js';
import { toJSON, toMarkdown } from '../core/export.js';
import { createDemoProvider } from '../providers/demo-provider.js';
import { createAudioProvider } from '../providers/audio-provider.js';
import { h, reconcile, flash } from './dom.js';
import { download } from './download.js';

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** Claude Artifact 用の単一HTML版か（scripts/bundle-artifact.mjs が目印の要素を入れる） */
const ARTIFACT_BUILD = document.getElementById('mc-build')?.dataset.build === 'artifact';
const TABS = ['log', 'audio', 'data'];
/** この件数以内に更新されたノードを控えめに強調する */
const FRESH_WINDOW = 2;

const session = createSession();
const ui = {
  /** 畳んでいるノード */
  collapsed: new Set(),
  /** 畳んだ枝の下に、畳んだ後で追記・訂正があったノード */
  unseenUnder: new Set(),
  /** 編集中のノードID。編集中はデモ再生を止め、フォームを作り直さない */
  editingId: /** @type {string|null} */ (null),
  /** 「最新の更新へ」を押してから増えた更新数 */
  sinceJump: 0,
  lastSeq: 0,
  tab: 'log',
  cleared: false,
};

const demo = createDemoProvider({
  session,
  onStep(step, index) {
    $('utterance').textContent = step.utterance;
    $('step-caption').textContent = `台本 ${index + 1}/${demo.player.total}：${step.caption}（事前に用意した構造イベント）`;
    $('progress-text').textContent = `${index + 1} / ${demo.player.total}`;
  },
  onStatus: () => renderStatus(),
});
const audio = createAudioProvider();

// ---------- 描画 ----------

function badge(text, cls) {
  return h('span', { class: `badge ${cls}`, text });
}

/** 畳まれている最も近い祖先（無ければ null） */
function collapsedAncestor(state, id) {
  for (const a of ancestorsOf(state, id)) if (ui.collapsed.has(a)) return a;
  return null;
}

function nodeSignature(state, n) {
  const fresh = n.updatedSeq > state.seq - FRESH_WINDOW;
  return [n.rev, n.label, n.childIds.length, ui.collapsed.has(n.id), ui.unseenUnder.has(n.id),
    state.activeId === n.id, fresh, ui.editingId === n.id].join('|');
}

function nodeEditor(n) {
  return h('form', { class: 'editor', 'data-id': n.id, 'data-rev': n.rev }, [
    h('p', { class: 'editor-note', text: '台本デモの再生は一時停止中です。保存かキャンセルで再開できます。' }),
    h('label', { class: 'editor-label', text: '内容' }, [h('textarea', { name: 'text', rows: 2, maxlength: 500 }, [n.text])]),
    h('label', { class: 'editor-label', text: '訂正の理由（任意）' }, [h('input', { type: 'text', name: 'reason', maxlength: 200, autocomplete: 'off' })]),
    h('div', { class: 'editor-actions' }, [
      h('button', { type: 'submit', class: 'btn btn-small btn-primary', text: '保存' }),
      h('button', { type: 'button', class: 'btn btn-small', 'data-action': 'edit-cancel', text: 'キャンセル' }),
    ]),
    h('p', { class: 'feedback editor-feedback', role: 'status' }),
  ]);
}

function renderRow(el, state, n, isNew) {
  const sig = nodeSignature(state, n);
  if (el.dataset.sig === sig) return;
  const row = el.querySelector(':scope > .node-row');
  if (ui.editingId === n.id && row?.querySelector('form.editor')) {
    // 編集中は入力を消さない。下で内容が変わったことだけ知らせる
    const form = row.querySelector('form.editor');
    const fb = form.querySelector('.editor-feedback');
    if (fb && Number(/** @type {HTMLElement} */ (form).dataset.rev) !== n.rev) {
      fb.textContent = '編集中にこの項目が更新されました。保存すると入力内容で訂正します。';
      fb.classList.add('is-error');
    }
    el.dataset.sig = sig;
    return;
  }
  const hadSig = !!el.dataset.sig;
  const prevRev = Number(el.dataset.rev || 0);
  const historyOpen = row?.querySelector('details.history')?.open ?? false;
  el.dataset.sig = sig;
  el.dataset.rev = String(n.rev);
  el.className = [
    'node', n.parentId ? 'is-branch' : 'is-heading',
    state.activeId === n.id ? 'is-latest' : '',
    n.updatedSeq > state.seq - FRESH_WINDOW ? 'is-fresh' : '',
    ui.collapsed.has(n.id) ? 'is-collapsed' : '',
  ].filter(Boolean).join(' ');

  const newRow = h('div', { class: 'node-row' });
  if (ui.editingId === n.id) {
    newRow.append(nodeEditor(n));
  } else {
    const hasKids = n.childIds.length > 0;
    newRow.append(
      hasKids
        ? h('button', {
          type: 'button', class: 'twisty', 'data-action': 'toggle', 'data-id': n.id,
          'aria-expanded': String(!ui.collapsed.has(n.id)),
          'aria-label': ui.collapsed.has(n.id) ? '開く' : '畳む',
          text: ui.collapsed.has(n.id) ? '▸' : '▾',
        })
        : h('span', { class: 'twisty twisty-leaf', 'aria-hidden': 'true', text: '•' }),
      h('div', { class: 'node-body' }, [
        h('p', { class: 'node-text' }, [
          n.label ? badge(n.label, 'badge-label') : null,
          h('span', { class: 'node-text-inner', text: n.text }),
        ]),
        h('p', { class: 'node-meta' }, [
          h('span', { text: ORIGIN_LABELS[n.origin] ?? n.origin }),
          n.history.length > 1 ? badge(`訂正 ${n.history.length - 1}`, 'badge-fix') : null,
          ui.collapsed.has(n.id) && hasKids ? h('span', { class: 'muted', text: `${n.childIds.length}件を畳んでいます` }) : null,
          ui.unseenUnder.has(n.id) ? badge('新しい追記あり', 'badge-new') : null,
        ]),
        n.history.length > 1 ? h('details', { class: 'history', open: historyOpen }, [
          h('summary', { text: '変更履歴' }),
          h('ol', {}, n.history.map((x) => h('li', {}, [
            h('span', { class: 'history-seq', text: `#${x.seq}` }),
            h('span', { text: x.change === '追加' ? `追加：${x.to}` : `${x.change}：${x.from} → ${x.to}` }),
            x.reason ? h('span', { class: 'muted', text: `（${x.reason}）` }) : null,
          ]))),
        ]) : null,
        h('div', { class: 'item-actions' }, [
          h('button', { type: 'button', class: 'btn btn-small', 'data-action': 'add-under', 'data-id': n.id, text: '＋ ここに追記' }),
          h('button', { type: 'button', class: 'btn btn-small', 'data-action': 'edit', 'data-id': n.id, text: '編集' }),
        ]),
      ]),
    );
  }
  if (row) row.replaceWith(newRow);
  else el.prepend(newRow);
  if (isNew) flash(el, 'flash-new');
  else if (hadSig && prevRev !== n.rev) flash(newRow, 'flash');
}

function renderChildren(container, state, ids) {
  reconcile(container, ids, (id) => id, (el, id, isNew) => {
    const n = state.nodes[id];
    el.dataset.id = id;
    renderRow(el, state, n, isNew);
    let kids = /** @type {HTMLElement|null} */ (el.querySelector(':scope > ol.children'));
    const showKids = n.childIds.length > 0 && !ui.collapsed.has(id);
    if (showKids) {
      if (!kids) {
        kids = h('ol', { class: 'children' });
        el.append(kids);
      }
      renderChildren(kids, state, n.childIds);
    } else if (kids) {
      kids.remove();
    }
  });
}

function renderTargets(state) {
  const sel = /** @type {HTMLSelectElement} */ ($('manual-target'));
  const current = sel.value;
  const opts = [h('option', { value: '', text: '新しい見出し' })];
  for (const f of flatten(state)) {
    const t = f.text.length > 28 ? `${f.text.slice(0, 28)}…` : f.text;
    opts.push(h('option', { value: f.id, text: `${'　'.repeat(f.depth + 1)}└ ${t}` }));
  }
  sel.replaceChildren(...opts);
  sel.value = getNode(state, current) ? current : '';
}

function renderLog(state) {
  const entries = state.log.slice(-120).reverse();
  reconcile($('list-log'), entries, (e) => String(e.seq), (el, e) => {
    if (el.dataset.sig) return;
    el.dataset.sig = '1';
    el.className = 'log-entry';
    el.append(
      h('span', { class: 'history-seq', text: `#${e.seq}` }),
      h('span', { class: 'log-text', text: e.summary }),
      h('span', { class: 'muted', text: e.by === 'fixture' ? '台本' : '手で整理' }),
    );
  });
  $('tabcount-log').textContent = String(state.log.length);
}

function renderTabs() {
  for (const t of TABS) {
    const on = ui.tab === t;
    $(`tab-${t}`).setAttribute('aria-selected', String(on));
    $(`tab-${t}`).tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
  }
}

function renderStatus() {
  const chip = $('chip-state');
  const st = demo.player.status;
  const editing = !!ui.editingId;
  chip.dataset.state = st;
  chip.textContent = ui.cleared && st === 'idle' ? '停止中（消去済み）' : PLAYER_STATUS_LABELS[st];
  /** @type {HTMLButtonElement} */ ($('btn-play')).disabled = editing || st === 'playing' || st === 'ended';
  /** @type {HTMLButtonElement} */ ($('btn-pause')).disabled = st !== 'playing';
  /** @type {HTMLButtonElement} */ ($('btn-step')).disabled = editing || st === 'ended';
  $('btn-play').textContent = st === 'paused' ? '▶ 再開' : '▶ 再生';
  const note = $('control-note');
  note.hidden = !editing;
  note.textContent = editing ? '項目を編集中のため、台本デモの再生を止めています。保存かキャンセルで再開できます。' : '';
  const pct = demo.player.total ? (demo.player.cursor / demo.player.total) * 100 : 0;
  $('progress-bar').style.width = `${pct}%`;
  if (st === 'idle') {
    $('progress-text').textContent = `0 / ${demo.player.total}`;
    $('step-caption').textContent = '台本デモは、事前に用意した構造イベントを1つずつ流します。';
    $('utterance').textContent = 'まだ再生していません。';
  }
}

function render() {
  const state = session.getState();
  if (ui.editingId && !getNode(state, ui.editingId)) ui.editingId = null;
  // 新しく適用された更新を数え、畳まれた枝の下なら「新しい追記あり」を付ける（自動では開かない）
  for (const entry of state.log) {
    if (entry.seq <= ui.lastSeq) continue;
    ui.sinceJump += 1;
    const hidden = entry.nodeId && collapsedAncestor(state, entry.nodeId);
    if (hidden) ui.unseenUnder.add(hidden);
  }
  ui.lastSeq = state.seq;
  for (const id of [...ui.collapsed]) if (!getNode(state, id)) ui.collapsed.delete(id);

  $('outline-empty').hidden = state.rootIds.length > 0;
  if (ui.cleared && !state.rootIds.length) {
    $('outline-empty').firstElementChild.textContent = '内容は消去されました。';
  } else {
    $('outline-empty').firstElementChild.replaceChildren(h('strong', { text: 'まだ何もありません。' }), '話題が出るたびに、ここへ見出しと枝が増えていきます。');
  }
  renderChildren($('outline'), state, state.rootIds);
  renderTargets(state);
  renderLog(state);
  renderTabs();
  renderStatus();
  const jump = /** @type {HTMLButtonElement} */ ($('btn-jump'));
  jump.disabled = !state.activeId;
  $('jump-count').hidden = ui.sinceJump === 0 || !state.activeId;
  $('jump-count').textContent = `${ui.sinceJump}件`;
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
  ui.collapsed.clear();
  ui.unseenUnder.clear();
  ui.editingId = null;
  ui.sinceJump = 0;
  ui.lastSeq = 0;
  ui.cleared = cleared;
}

/** 利用者の操作でだけ呼ぶ：祖先を開いて、その項目まで移動する */
function revealNode(id) {
  const state = session.getState();
  if (!getNode(state, id)) return;
  for (const a of ancestorsOf(state, id)) {
    ui.collapsed.delete(a);
    ui.unseenUnder.delete(a);
  }
  render();
  const el = document.querySelector(`#outline li[data-id="${CSS.escape(id)}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: 'center' });
    el.querySelector('.node-row')?.classList.add('is-target');
    window.setTimeout(() => el.querySelector('.node-row')?.classList.remove('is-target'), 1600);
  }
}

document.addEventListener('click', (ev) => {
  const target = /** @type {HTMLElement} */ (ev.target);
  const btn = target.closest('[data-action]');
  if (!(btn instanceof HTMLElement) || btn.tagName === 'FORM') return;
  const { action, id } = btn.dataset;
  switch (action) {
    case 'play': if (!ui.editingId) { ui.cleared = false; demo.player.play(); } break;
    case 'pause': demo.player.pause(); break;
    case 'step': if (!ui.editingId) { ui.cleared = false; demo.player.step(); } break;
    case 'reset':
      resetAll(false);
      setFeedback('data-feedback', 'リセットしました。台本デモは最初から、手で書いた内容も破棄されています。');
      break;
    case 'toggle':
      if (!id) break;
      if (ui.collapsed.has(id)) {
        ui.collapsed.delete(id);
        ui.unseenUnder.delete(id);
      } else {
        ui.collapsed.add(id);
      }
      break;
    case 'jump-latest': {
      const latest = session.getState().activeId;
      ui.sinceJump = 0;
      if (latest) revealNode(latest);
      break;
    }
    case 'add-under': {
      const sel = /** @type {HTMLSelectElement} */ ($('manual-target'));
      sel.value = id ?? '';
      $('manual').scrollIntoView({ block: 'nearest' });
      $('manual-text').focus();
      return;
    }
    case 'edit':
      // 編集を開いたら再生を自動で一時停止し、編集中は再生・一歩進めるを無効にする
      demo.player.pause();
      ui.editingId = id ?? null;
      break;
    case 'edit-cancel': ui.editingId = null; break;
    case 'tab': ui.tab = TABS.includes(btn.dataset.tab ?? '') ? /** @type {string} */ (btn.dataset.tab) : 'log'; break;
    case 'export-json':
    case 'export-md':
      // Artifact の閲覧画面はページからのダウンロードを止めるため、この版では書き出さない
      if (ARTIFACT_BUILD) {
        setFeedback('data-feedback', 'Artifact 版では書き出しは使えません。', false);
        break;
      }
      if (action === 'export-md') {
        download('meeting-compass-outline.md', toMarkdown(session.getState(), new Date().toISOString()), 'text/markdown');
        setFeedback('data-feedback', 'Markdownを書き出しました（この端末への保存のみ）。');
      } else {
        download('meeting-compass-outline.json', toJSON(session.getState(), new Date().toISOString()), 'application/json');
        setFeedback('data-feedback', 'JSONを書き出しました（この端末への保存のみ）。');
      }
      break;
    case 'clear-ask': $('clear-confirm').hidden = false; break;
    case 'clear-no': $('clear-confirm').hidden = true; break;
    case 'clear-yes':
      $('clear-confirm').hidden = true;
      resetAll(true);
      setFeedback('data-feedback', 'すべて消去しました。メモリ上の内容は破棄され、台本デモは停止しています。');
      break;
    default: return;
  }
  render();
  if (action === 'edit') {
    const form = document.querySelector(`form.editor[data-id="${CSS.escape(id ?? '')}"]`);
    form?.querySelector('textarea')?.focus();
  }
});

document.addEventListener('keydown', (ev) => {
  const target = /** @type {HTMLElement} */ (ev.target);
  if (ev.key === 'Escape' && target.closest('form.editor')) {
    ui.editingId = null;
    render();
    return;
  }
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
    const parentId = /** @type {HTMLSelectElement} */ ($('manual-target')).value || null;
    if (!text.trim()) {
      setFeedback('manual-feedback', '入力が空です。内容を入力してください。', false);
      return;
    }
    const nodeId = session.nextId(parentId ? 'b' : 'h');
    const r = userEvent('node.add', { node: { id: nodeId, parentId, text } });
    if (r.ok) {
      ui.cleared = false;
      /** @type {HTMLTextAreaElement} */ ($('manual-text')).value = '';
      setFeedback('manual-feedback', parentId ? '枝に追記しました。' : '見出しを追加しました。');
      render();
    } else if (r.existingId) {
      // 同じ話題・同じ内容は増やさず、既存の項目を「いまの場所」にして移動する
      userEvent('node.focus', { nodeId: r.existingId });
      setFeedback('manual-feedback', '同じ内容が既にあるため、新しく作らずに既存の項目へ移動しました。', false);
      revealNode(r.existingId);
    } else {
      setFeedback('manual-feedback', r.message || '追加できませんでした', false);
      render();
    }
    return;
  }
  if (form.classList.contains('editor')) {
    const id = form.dataset.id ?? '';
    const fd = new FormData(form);
    const r = userEvent('node.edit', { nodeId: id, text: String(fd.get('text') ?? ''), reason: String(fd.get('reason') ?? '') || 'ユーザーが訂正' });
    if (!r.ok && r.message !== '訂正前と同じ内容です') {
      const fb = form.querySelector('.editor-feedback');
      if (fb) { fb.textContent = r.message; fb.classList.add('is-error'); }
      return;
    }
    ui.editingId = null;
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
  value: Object.freeze({ snapshot: () => structuredClone(session.getState()), providers: [demo.id, audio.id] }),
});
