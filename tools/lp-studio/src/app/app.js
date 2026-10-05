// LP Studio UI。core の純関数だけで状態を変える。DOM は h() で作り、文字列は textContent で入れる（innerHTML 不使用）。
// プレビューは sandbox="allow-scripts"（allow-same-origin なし）の iframe srcdoc。
import { parseProjectJson, serializeProject, SCHEMA_VERSION, CATEGORIES, SOURCE_TYPES, CTA_TIMINGS, FONTS } from '../core/schema.js';
import { BRIEF_KEYS, BRIEF_LABELS, SECTION_CATALOG, SECTION_TYPES, planSections } from '../core/sections.js';
import { applyEdit, emptyProject } from '../core/model.js';
import { generateAllTemplate, reangleTemplate, regenerateSectionTemplate, buildPrompt, ingestGenerated, ADAPTERS } from '../core/generate.js';
import { auditProject } from '../core/claims.js';
import { renderPage, exportHtml, contrastChecks } from '../core/render.js';
import { analyzeLpo } from '../core/lpo.js';

const AUTOSAVE_KEY = 'lp-studio:autosave:v1';
const UI_KEY = 'lp-studio:ui:v1';
const TABS = ['brief', 'plan', 'design', 'cta', 'export', 'lpo', 'gen'];
const STATUS_LABEL = { confirmed: '確定', unconfirmed: '未確定', missing: '未入力' };
const TIMING_LABEL = { spec: '仕様: FV後に表示（公開用）', 'after-half': '比較用: ページの半分を過ぎてから' };
const CATEGORY_LABEL = { general: '一般', education: '教育・学習', health: '健康', beauty: '美容', finance: '金融', employment: '就職・転職' };
const MODE_LABEL = { full: 'LP全体作成', reangle: '訴求変更', section: 'セクション編集' };

const state = {
  project: null,
  undo: [],
  redo: [],
  tab: 'brief',
  mode: 'section',
  selected: null,
  previewKind: 'preview',
  genMode: 'full',
  lastIngest: null,
};

// ---------------- DOM helper ----------------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const $ = (s) => document.querySelector(s);

function toast(msg, kind = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.dataset.kind = kind;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 4200);
}

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, v) { try { localStorage.setItem(key, v); } catch { /* 保存できない環境でも動く */ } }

// ---------------- 状態更新 ----------------
function commit(next, { record = true } = {}) {
  if (record && state.project) {
    state.undo.push(serializeProject(state.project));
    if (state.undo.length > 100) state.undo.shift();
    state.redo = [];
  }
  state.project = { ...next, updatedAt: new Date().toISOString() };
  storageSet(AUTOSAVE_KEY, serializeProject(state.project));
  render();
}

function edit(op) {
  try {
    commit(applyEdit(state.project, op));
    return true;
  } catch (e) {
    toast(e.message, 'error');
    render();
    return false;
  }
}

function restoreFrom(json) {
  const r = parseProjectJson(json);
  return r.ok ? r.project : null;
}

function undo() {
  if (!state.undo.length) return toast('これ以上戻せません');
  state.redo.push(serializeProject(state.project));
  state.project = restoreFrom(state.undo.pop());
  storageSet(AUTOSAVE_KEY, serializeProject(state.project));
  render();
  toast('元に戻しました');
}
function redo() {
  if (!state.redo.length) return toast('やり直す操作がありません');
  state.undo.push(serializeProject(state.project));
  state.project = restoreFrom(state.redo.pop());
  storageSet(AUTOSAVE_KEY, serializeProject(state.project));
  render();
  toast('やり直しました');
}

// 自己完結版（build-standalone.mjs）では seed が埋め込まれている
async function seedText(kind) {
  const embed = window.__LP_STUDIO_EMBED__;
  if (embed) return kind === 'dataset' ? embed.dataset : embed.seed;
  const res = await fetch(kind === 'dataset' ? '../../seed/lpo-dataset.fictional.json' : '../../seed/project.fictional.json', { cache: 'no-store' });
  return res.text();
}

async function loadSeed() {
  const r = parseProjectJson(await seedText('project'));
  if (!r.ok) throw new Error(r.errors.join(' / '));
  return r.project;
}

function loadJsonText(text, filename = '') {
  if (/\.html?$/i.test(filename)) return toast('HTMLは読み込めません。project JSON だけを受け付けます', 'error');
  const r = parseProjectJson(text);
  if (!r.ok) {
    toast(`読み込めません: ${r.errors.slice(0, 3).join(' / ')}`, 'error');
    return false;
  }
  state.selected = null;
  commit(r.project);
  toast(`読み込みました${r.warnings.length ? `（警告 ${r.warnings.length} 件: ${r.warnings[0]}）` : ''}`);
  return true;
}

// ---------------- タブとルーティング（戻る/進むでタブ移動） ----------------
function setTab(tab, push = true) {
  if (!TABS.includes(tab)) tab = 'brief';
  state.tab = tab;
  if (push && location.hash !== `#${tab}`) history.pushState({ tab }, '', `#${tab}`);
  storageSet(UI_KEY, JSON.stringify({ tab, selected: state.selected, mode: state.mode }));
  render();
}
window.addEventListener('popstate', () => setTab(location.hash.slice(1) || 'brief', false));

// ---------------- 共通パーツ ----------------
function statusSelect(id, value, onchange) {
  return h('select', { id, onchange, 'aria-label': 'ステータス' },
    ...['confirmed', 'unconfirmed', 'missing'].map((s) => h('option', { value: s, selected: s === value ? 'selected' : null, text: STATUS_LABEL[s] })));
}

function previewFrame(html, { width, height, title, id }) {
  const wrap = h('div', { class: 'frame-wrap', 'data-width': width, style: `--fw:${width}px;--fh:${height}px` });
  const iframe = h('iframe', { title, id, sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', loading: 'lazy', width, height });
  iframe.srcdoc = html;
  wrap.append(iframe);
  requestAnimationFrame(() => fitFrame(wrap));
  return wrap;
}
function fitFrame(wrap) {
  const w = Number(wrap.dataset.width);
  const parent = wrap.parentElement;
  if (!parent) return;
  const cs = getComputedStyle(parent);
  const avail = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
  const scale = Math.min(1, avail / w);
  wrap.style.setProperty('--scale', scale);
}
window.addEventListener('resize', () => document.querySelectorAll('.frame-wrap').forEach(fitFrame));

function issueBadge(level) {
  const map = { missing: '未入力', unconfirmed: '未確定', unverified: '未検証', unapproved: '未承認', review: '要再確認', claim: '根拠なし', token: '差込未確定', block: '公開不可', placeholder: '要記入' };
  return h('span', { class: `badge lv-${level}`, text: map[level] || level });
}

// ---------------- 1 ブリーフ ----------------
function renderBrief(p) {
  const issues = auditProject(p).filter((i) => i.scope === 'brief');
  const rows = BRIEF_KEYS.map((k) => {
    const f = p.brief[k];
    const long = ['problem', 'promise', 'offer', 'tone'].includes(k);
    const input = long
      ? h('textarea', { id: `brief-${k}`, rows: 2, maxlength: 600, value: f.value, onchange: (e) => edit({ type: 'setBrief', key: k, value: e.target.value }) })
      : h('input', { id: `brief-${k}`, type: k === 'ctaUrl' ? 'url' : 'text', maxlength: 600, value: f.value, onchange: (e) => edit({ type: 'setBrief', key: k, value: e.target.value }) });
    const msgs = issues.filter((i) => i.key === k);
    return h('div', { class: `field st-${f.status}` },
      h('label', { for: `brief-${k}`, text: BRIEF_LABELS[k] }),
      input,
      h('div', { class: 'row' },
        statusSelect(`brief-${k}-status`, f.status, (e) => edit({ type: 'setBrief', key: k, status: e.target.value })),
        ...msgs.map((m) => h('span', { class: `hint lv-${m.level}`, text: m.message }))));
  });
  const b = p.brand;
  const tokens = ['primary', 'accent', 'ink', 'paper'].map((k) => h('div', { class: 'token' },
    h('label', { for: `brand-${k}`, text: { primary: 'メイン', accent: 'アクセント', ink: '文字', paper: '紙面' }[k] }),
    h('input', { type: 'color', id: `brand-${k}`, value: b[k], onchange: (e) => edit({ type: 'setBrand', key: k, value: e.target.value }) }),
    h('input', { type: 'text', id: `brand-${k}-hex`, value: b[k], maxlength: 7, 'aria-label': `${k} の16進`, onchange: (e) => edit({ type: 'setBrand', key: k, value: e.target.value }) })));
  const contrast = contrastChecks(p, p.cta.variants.find((v) => v.id === p.cta.activeVariant));
  return h('div', { class: 'grid-2' },
    h('section', { class: 'card' },
      h('h2', { text: 'ブリーフ（ヒアリングの整理）' }),
      h('p', { class: 'muted', text: '未確定・未入力の項目は公開用HTML（safe export）に出ません。埋め合わせの実績・推薦・保証はツールが作りません。' }),
      h('div', { class: 'field' }, h('label', { for: 'brief-category', text: '商材カテゴリ（健康・美容では薬機法の語彙を公開不可にします）' }),
        h('select', { id: 'brief-category', onchange: (e) => edit({ type: 'setCategory', value: e.target.value }) },
          ...CATEGORIES.map((c) => h('option', { value: c, selected: c === p.brief.category ? 'selected' : null, text: CATEGORY_LABEL[c] })))),
      ...rows),
    h('section', { class: 'card' },
      h('h2', { text: 'ブランドtoken' }),
      h('div', { class: 'tokens' }, ...tokens),
      h('div', { class: 'field' }, h('label', { for: 'brand-font', text: '書体' }),
        h('select', { id: 'brand-font', onchange: (e) => edit({ type: 'setBrand', key: 'font', value: e.target.value }) },
          ...FONTS.map((f) => h('option', { value: f, selected: f === b.font ? 'selected' : null, text: { sans: 'ゴシック', serif: '明朝', rounded: '丸ゴシック' }[f] })))),
      h('h3', { text: 'コントラスト（4.5:1 未満は safe export を止めます）' }),
      h('ul', { class: 'plain' }, ...contrast.map((c) => h('li', { class: c.ok ? 'ok' : 'ng', text: `${c.ok ? '✓' : '✕'} ${c.name}: ${c.ratio}:1` })))));
}

// ---------------- 2 構成・WF（3モード） ----------------
function renderPlan(p) {
  const plan = planSections(p);
  if (!state.selected || !p.sections.some((s) => s.id === state.selected)) state.selected = p.sections[0]?.id || null;
  const modeBar = h('div', { class: 'modes', role: 'radiogroup', 'aria-label': '作業モード' },
    ...Object.entries(MODE_LABEL).map(([m, label]) => h('label', { class: `mode${state.mode === m ? ' on' : ''}` },
      h('input', { type: 'radio', name: 'mode', value: m, id: `mode-${m}`, checked: state.mode === m, onchange: () => { state.mode = m; render(); } }), label)));

  let modeBody;
  if (state.mode === 'full') {
    modeBody = h('div', { class: 'mode-body' },
      h('p', { text: '参考構成（FV→共感→リフレーム→起源→ステップ→提供範囲→再コミット→根拠→価格の理由→適合条件→クロージング→フッター）で全体を作り直します。今のセクションは置き換わります（戻すで復元可）。' }),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', id: 'opt-video' }), 'コンセプト動画セクションを含める（素材がある場合のみ）'),
      h('div', { class: 'row' },
        h('button', { type: 'button', id: 'btn-template-all', class: 'primary', onclick: () => { commit(generateAllTemplate(state.project, { includeVideo: $('#opt-video').checked })); toast('テンプレートで下書きしました（AI生成ではありません）'); } }, 'テンプレートで全体を下書き'),
        h('button', { type: 'button', onclick: () => { state.genMode = 'full'; setTab('gen'); } }, 'Claude Code 生成の指示を作る →')));
  } else if (state.mode === 'reangle') {
    modeBody = h('div', { class: 'mode-body' },
      h('p', { text: '約束する価値（訴求）を差し替えます。FV・再コミット・クロージングを作り直し、残りのセクションには「要再確認」を立てます。新しい訴求は「未確定」になります。' }),
      h('div', { class: 'field' }, h('label', { for: 'reangle-input', text: '新しい約束する価値' }), h('textarea', { id: 'reangle-input', rows: 2, maxlength: 600, value: p.brief.promise.value })),
      h('div', { class: 'row' },
        h('button', { type: 'button', id: 'btn-reangle', class: 'primary', onclick: () => {
          const v = $('#reangle-input').value.trim();
          if (!v) return toast('新しい訴求を入力してください', 'error');
          commit(reangleTemplate(state.project, v));
          toast('訴求を変更しました。要再確認のセクションを見直してください');
        } }, 'テンプレートで訴求を変更'),
        h('button', { type: 'button', onclick: () => { state.genMode = 'reangle'; setTab('gen'); } }, 'Claude Code で訴求変更の指示を作る →')));
  } else {
    modeBody = h('div', { class: 'mode-body' }, h('p', { text: '左の一覧からセクションを選んで編集します。追加・削除（任意セクションのみ）・並べ替えができます。編集すると承認は外れます。' }));
  }

  const list = h('ol', { class: 'plan', 'aria-label': 'セクション計画' }, ...plan.map((s, i) => {
    const sel = s.id === state.selected;
    return h('li', { class: `plan-item${sel ? ' sel' : ''}${s.required ? ' req' : ''}`, 'data-section-id': s.id },
      h('button', { type: 'button', class: 'pick', 'aria-pressed': sel ? 'true' : 'false', id: `pick-${s.id}`, onclick: () => { state.selected = s.id; state.mode = 'section'; render(); } },
        h('strong', { text: `${i + 1}. ${s.label}` }),
        h('span', { class: 'role', text: s.role })),
      h('div', { class: 'tags' },
        s.required ? h('span', { class: 'badge', text: '必須' }) : h('span', { class: 'badge soft', text: '任意' }),
        s.approved ? h('span', { class: 'badge ok', text: '承認済' }) : issueBadge('unapproved'),
        s.needsReview ? issueBadge('review') : null,
        h('span', { class: 'badge soft', text: s.origin === 'claude-code' ? 'Claude Code生成' : s.origin === 'template' ? 'テンプレート' : '手入力' }),
        ...s.missing.map((m) => h('span', { class: `badge lv-${m.level}`, text: `${m.label}${m.level === 'missing' ? 'なし' : '未確定'}` }))),
      h('div', { class: 'row tiny' },
        h('button', { type: 'button', 'aria-label': `${s.label}を上へ`, id: `up-${s.id}`, disabled: i === 0, onclick: () => edit({ type: 'moveSection', id: s.id, delta: -1 }) }, '↑'),
        h('button', { type: 'button', 'aria-label': `${s.label}を下へ`, id: `down-${s.id}`, disabled: i === plan.length - 1, onclick: () => edit({ type: 'moveSection', id: s.id, delta: 1 }) }, '↓'),
        s.required ? null : h('button', { type: 'button', class: 'danger', id: `del-${s.id}`, 'aria-label': `${s.label}を削除`, onclick: () => edit({ type: 'removeSection', id: s.id }) }, '削除')));
  }));
  const missingTypes = SECTION_TYPES.filter((t) => !p.sections.some((s) => s.type === t));
  const adder = missingTypes.length ? h('div', { class: 'row' },
    h('label', { for: 'add-type', class: 'sr', text: '追加するセクション' }),
    h('select', { id: 'add-type' }, ...missingTypes.map((t) => h('option', { value: t, text: SECTION_CATALOG[t].label }))),
    h('button', { type: 'button', id: 'btn-add-section', onclick: () => {
      const t = $('#add-type').value;
      const idx = p.sections.findIndex((s) => s.id === state.selected);
      if (edit({ type: 'addSection', sectionType: t, at: idx + 1 })) state.selected = state.project.sections[idx + 1]?.id;
      render();
    } }, '選択中の下に追加')) : null;

  const sel = p.sections.find((s) => s.id === state.selected);
  const editor = sel ? sectionEditor(p, sel, plan.find((x) => x.id === sel.id)) : h('p', { text: 'セクションがありません。「LP全体作成」で下書きしてください。' });
  const wf = renderPage(p, { view: 'wf' }).html;
  return h('div', { class: 'plan-layout' },
    h('section', { class: 'card span-all' }, h('h2', { text: '作業モード' }), modeBar, modeBody),
    h('section', { class: 'card' }, h('h2', { text: 'セクション計画' }), list, adder),
    h('section', { class: 'card' }, h('h2', { text: 'セクション編集' }), editor),
    h('section', { class: 'card' }, h('h2', { text: 'ワイヤーフレーム（同じデータから描画）' }), previewFrame(wf, { width: 760, height: 1100, title: 'ワイヤーフレーム', id: 'wf-frame' })));
}

function sectionEditor(p, s, planRow) {
  const meta = SECTION_CATALOG[s.type];
  const text = (field, label, rows = 1) => h('div', { class: 'field' },
    h('label', { for: `f-${field}`, text: label }),
    rows > 1
      ? h('textarea', { id: `f-${field}`, rows, value: s.fields[field], onchange: (e) => edit({ type: 'setField', id: s.id, field, value: e.target.value }) })
      : h('input', { id: `f-${field}`, type: 'text', value: s.fields[field], onchange: (e) => edit({ type: 'setField', id: s.id, field, value: e.target.value }) }));
  const listField = (field, label) => h('div', { class: 'field' },
    h('label', { for: `f-${field}`, text: `${label}（1行に1項目）` }),
    h('textarea', { id: `f-${field}`, rows: 4, value: s.fields[field].join('\n'), onchange: (e) => edit({ type: 'setField', id: s.id, field, value: e.target.value }) }));
  const [l1, l2] = s.type === 'scope' ? ['含まれるもの', '含まれないもの'] : s.type === 'fit' ? ['向いている人', '向いていない人'] : s.type === 'reframe' ? ['これまで', 'これから'] : ['項目', '項目（右列）'];
  const issues = auditProject(p).filter((i) => i.scope === 'section' && i.key === s.id);
  return h('div', { class: 'editor' },
    h('p', { class: 'muted' }, h('strong', { text: meta.label }), ` — ${meta.role}`),
    h('p', { class: 'muted small', text: `根拠（参考構成での位置づけ）: ${meta.rationale}` }),
    planRow.missing.length ? h('p', { class: 'warn small', text: `不足情報: ${planRow.missing.map((m) => `${m.label}（${m.level === 'missing' ? '未入力' : '未確定'}）`).join('、')}` }) : null,
    h('p', { class: 'muted small', text: '差込: {{product}} {{audience}} {{problem}} {{promise}} {{offer}} {{price}} {{ctaLabel}} {{operator}}（ブリーフを直すと全ビューに反映）' }),
    text('heading', '見出し'), text('lead', 'リード', 2), text('body', '本文', 4),
    listField('items', l1), listField('itemsAlt', l2), text('note', '注記'),
    h('fieldset', { class: 'refs' }, h('legend', { text: 'このセクションの主張を支える根拠（claimRefs）' }),
      p.evidence.length ? p.evidence.map((ev) => h('label', { class: 'inline' },
        h('input', { type: 'checkbox', id: `ref-${s.id}-${ev.id}`, checked: s.claimRefs.includes(ev.id), onchange: (e) => {
          const next = new Set(s.claimRefs);
          if (e.target.checked) next.add(ev.id); else next.delete(ev.id);
          edit({ type: 'setClaimRefs', id: s.id, value: [...next] });
        } }), `${ev.claim.slice(0, 50)}（${ev.status === 'verified' ? '検証済' : '未検証'}）`)) : h('p', { class: 'small', text: '根拠がまだありません（5 のタブで追加）' })),
    issues.length ? h('ul', { class: 'issues' }, ...issues.map((i) => h('li', {}, issueBadge(i.level), ` ${i.message}`))) : h('p', { class: 'ok small', text: '✓ このセクションに未解決の主張・差込はありません' }),
    h('div', { class: 'row' },
      h('button', { type: 'button', id: 'btn-approve', class: s.approved ? '' : 'primary', onclick: () => edit({ type: 'approveSection', id: s.id, value: !s.approved }) }, s.approved ? '承認を取り消す' : '内容を確認して承認'),
      h('button', { type: 'button', id: 'btn-regen-section', onclick: () => { commit(regenerateSectionTemplate(state.project, s.id)); toast('テンプレートで作り直しました（AI生成ではありません）'); } }, 'テンプレートで作り直す'),
      h('button', { type: 'button', onclick: () => { state.genMode = 'section'; setTab('gen'); } }, 'Claude Code で書き直す指示 →')));
}

// ---------------- 3 デザイン ----------------
function previewKindBar() {
  return h('div', { class: 'row', role: 'radiogroup', 'aria-label': 'プレビューの種類' },
    ...[['preview', '編集中（未確認に旗）'], ['safe', '公開用（safe）で見る']].map(([k, label]) => h('label', { class: `mode${state.previewKind === k ? ' on' : ''}` },
      h('input', { type: 'radio', name: 'pkind', id: `pkind-${k}`, checked: state.previewKind === k, onchange: () => { state.previewKind = k; render(); } }), label)));
}
function renderDesign(p) {
  const { html, report } = renderPage(p, { kind: state.previewKind });
  const notes = state.previewKind === 'safe'
    ? h('div', { class: report.blockers.length ? 'alert' : 'okbox' }, report.blockers.length ? [h('strong', { text: 'このままでは公開できません: ' }), report.blockers.join(' / ')] : '公開可能（safe）。除外された要素は 5 のタブで確認できます。')
    : h('p', { class: 'muted small', text: '黄色の旗は未確認・根拠なしの箇所です。公開用（safe）では出ません。' });
  return h('div', { class: 'design' },
    h('section', { class: 'card span-all' }, h('h2', { text: 'デザインプレビュー（PC 1280px / SP 400px）' }), previewKindBar(), notes),
    h('section', { class: 'card pc' }, h('h3', { text: 'PC（1280 × 800）' }), previewFrame(html, { width: 1280, height: 800, title: 'PCプレビュー', id: 'pc-frame' })),
    h('section', { class: 'card sp' }, h('h3', { text: 'SP（400 × 760）' }), previewFrame(html, { width: 400, height: 760, title: 'SPプレビュー', id: 'sp-frame' })));
}

// ---------------- 4 CTA比較 ----------------
function renderCta(p) {
  const cards = p.cta.variants.map((v) => {
    const { html } = renderPage(p, { kind: 'preview', ctaVariantId: v.id });
    const contrast = contrastChecks(p, v).filter((c) => c.name.includes('CTA'));
    return h('section', { class: `card cta-card${p.cta.activeVariant === v.id ? ' active' : ''}`, 'data-variant': v.id },
      h('h3', { text: `案 ${v.id.toUpperCase()}${p.cta.activeVariant === v.id ? '（採用中）' : ''}` }),
      h('div', { class: 'field' }, h('label', { for: `cta-${v.id}-label`, text: '文言（空ならブリーフのCTA文言）' }),
        h('input', { id: `cta-${v.id}-label`, type: 'text', maxlength: 40, value: v.label, placeholder: p.brief.ctaLabel.value, onchange: (e) => edit({ type: 'setCtaVariant', id: v.id, label: e.target.value }) })),
      h('div', { class: 'row' },
        h('label', { for: `cta-${v.id}-color`, text: '色' }),
        h('input', { id: `cta-${v.id}-color`, type: 'color', value: v.color, onchange: (e) => edit({ type: 'setCtaVariant', id: v.id, color: e.target.value }) }),
        h('label', { for: `cta-${v.id}-timing`, text: '固定CTA' }),
        h('select', { id: `cta-${v.id}-timing`, onchange: (e) => edit({ type: 'setCtaVariant', id: v.id, timing: e.target.value }) },
          ...CTA_TIMINGS.map((t) => h('option', { value: t, selected: t === v.timing ? 'selected' : null, text: TIMING_LABEL[t] })))),
      h('ul', { class: 'plain small' }, ...contrast.map((c) => h('li', { class: c.ok ? 'ok' : 'ng', text: `${c.ok ? '✓' : '✕'} ${c.name}: ${c.ratio}:1` }))),
      h('div', { class: 'row' },
        h('button', { type: 'button', id: `cta-${v.id}-use`, disabled: p.cta.activeVariant === v.id, onclick: () => edit({ type: 'setActiveCta', id: v.id }) }, 'この案を採用'),
        p.cta.variants.length > 1 ? h('button', { type: 'button', class: 'danger', onclick: () => edit({ type: 'removeCtaVariant', id: v.id }) }, '削除') : null),
      previewFrame(html, { width: 400, height: 700, title: `CTA案${v.id}のSPプレビュー`, id: `cta-frame-${v.id}` }));
  });
  return h('div', {},
    h('section', { class: 'card' }, h('h2', { text: 'CTAの文言・色・表示タイミングをプレビューで比較' }),
      h('p', { class: 'muted', text: 'プレビュー上の比較だけです。実サイトのAB配信・広告設定は行いません（未接続）。プレビュー内をスクロールすると固定CTAの出方を確認できます。' }),
      p.cta.variants.length < 4 ? h('button', { type: 'button', id: 'btn-add-cta', onclick: () => edit({ type: 'addCtaVariant' }) }, '案を追加') : null),
    h('div', { class: 'cta-grid' }, ...cards));
}

// ---------------- 5 根拠・検証・Export ----------------
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
// ファイル名は ASCII（ブラウザによって非ASCIIの download 名が無視されるため）
const safeName = (p) => String(p.id || 'lp').replace(/[^\w-]+/g, '_').slice(0, 60);

function renderExport(p) {
  const issues = auditProject(p);
  const safe = exportHtml(p, 'safe');
  const evRows = p.evidence.map((ev) => h('tr', { 'data-ev': ev.id },
    h('td', {}, ev.claim), h('td', {}, `${ev.source}（${ev.sourceType}）`), h('td', {}, ev.provenance),
    h('td', {}, ev.status === 'verified' ? h('span', { class: 'badge ok', text: `検証済 ${ev.verifiedBy} ${ev.verifiedAt}` }) : issueBadge('unverified')),
    h('td', {}, ev.status === 'verified'
      ? h('button', { type: 'button', id: `unverify-${ev.id}`, onclick: () => edit({ type: 'verifyEvidence', id: ev.id, value: false }) }, '検証を取り消す')
      : h('div', { class: 'row tiny' },
        h('input', { type: 'text', id: `vby-${ev.id}`, placeholder: '確認者', 'aria-label': '確認者', maxlength: 80 }),
        h('input', { type: 'date', id: `vat-${ev.id}`, 'aria-label': '確認日' }),
        h('button', { type: 'button', id: `verify-${ev.id}`, onclick: () => edit({ type: 'verifyEvidence', id: ev.id, value: true, verifiedBy: $(`#vby-${ev.id}`).value, verifiedAt: $(`#vat-${ev.id}`).value }) }, '出典を確認した')),
      h('button', { type: 'button', class: 'danger', onclick: () => edit({ type: 'removeEvidence', id: ev.id }) }, '削除'))));
  return h('div', { class: 'grid-2' },
    h('section', { class: 'card span-all' }, h('h2', { text: '根拠（evidence）' }),
      h('p', { class: 'muted', text: '検証済みにできるのは人の操作だけです（確認者・確認日・出典が必須）。生成された根拠候補は常に未検証で入ります。' }),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['主張', '出典', '由来', '状態', '操作'].map((t) => h('th', { text: t })))), h('tbody', {}, ...evRows))),
      h('div', { class: 'row' },
        h('input', { type: 'text', id: 'ev-claim', placeholder: '主張（例: 面談は1回60分）', 'aria-label': '根拠の主張', maxlength: 300 }),
        h('input', { type: 'text', id: 'ev-source', placeholder: '出典（資料名・URL）', 'aria-label': '出典', maxlength: 300 }),
        h('select', { id: 'ev-type', 'aria-label': '出典の種類' }, ...SOURCE_TYPES.map((t) => h('option', { value: t, text: t }))),
        h('input', { type: 'number', id: 'ev-metric', placeholder: '数値（任意）', 'aria-label': '数値', step: 'any' }),
        h('input', { type: 'text', id: 'ev-unit', placeholder: '単位', 'aria-label': '単位', maxlength: 12 }),
        h('button', { type: 'button', id: 'btn-add-ev', onclick: () => {
          const claim = $('#ev-claim').value.trim();
          if (!claim) return toast('主張を入力してください', 'error');
          const m = $('#ev-metric').value;
          edit({ type: 'addEvidence', claim, source: $('#ev-source').value, sourceType: $('#ev-type').value, metricValue: m === '' ? null : Number(m), metricUnit: $('#ev-unit').value });
        } }, '根拠を追加'))),
    h('section', { class: 'card' }, h('h2', { text: `検証結果（${issues.length} 件）` }),
      h('ul', { class: 'issues', id: 'issue-list' }, ...issues.map((i) => h('li', {}, issueBadge(i.level), ` ${i.message}`)))),
    h('section', { class: 'card' }, h('h2', { text: 'Export' }),
      h('h3', { text: 'レビュー用ドラフト' }),
      h('p', { class: 'small', text: '未確認の箇所を旗付きで含みます。noindex・「公開しないでください」バナー付き。社内レビュー専用。' }),
      h('button', { type: 'button', id: 'btn-export-draft', onclick: () => { download(`${safeName(p)}_draft.html`, exportHtml(state.project, 'draft').html, 'text/html'); toast('ドラフトを書き出しました（公開不可）'); } }, 'draft HTML を書き出す'),
      h('h3', { text: '公開用（safe export）' }),
      safe.report.blockers.length
        ? h('div', { class: 'alert', id: 'safe-blockers' }, h('strong', { text: '公開用に書き出せません:' }), h('ul', {}, ...safe.report.blockers.map((b) => h('li', { text: b }))))
        : h('div', { class: 'okbox', id: 'safe-ok', text: '承認済み・確定・検証済みの内容だけで書き出せます。' }),
      h('button', { type: 'button', id: 'btn-export-safe', class: 'primary', disabled: !safe.html, onclick: () => { const r = exportHtml(state.project, 'safe'); if (r.html) { download(`${safeName(p)}.html`, r.html, 'text/html'); toast('safe HTML を書き出しました'); } } }, 'safe HTML を書き出す'),
      safe.report.warnings.length ? h('ul', { class: 'small warn', id: 'safe-warnings' }, ...safe.report.warnings.map((w) => h('li', { text: w }))) : null,
      safe.report.removed.length ? h('details', { open: true }, h('summary', { text: `safe export で除外される箇所（${safe.report.removed.length}）` }),
        h('ul', { class: 'small', id: 'safe-removed' }, ...safe.report.removed.map((r) => h('li', { text: `[${r.section}] ${r.text} — ${r.reasons.join(' / ')}` })))) : null));
}

// ---------------- 6 LPO ----------------
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(2)}%`);
function renderLpo(p) {
  const a = analyzeLpo(p);
  const loader = h('div', { class: 'row' },
    h('button', { type: 'button', id: 'btn-lpo-seed', onclick: async () => {
      try { if (edit({ type: 'setDataset', value: JSON.parse(await seedText('dataset')) })) toast('架空データを読み込みました'); } catch (e) { toast(e.message, 'error'); }
    } }, '架空データを読み込む'),
    h('details', {}, h('summary', { text: 'データセットJSONを貼り付け' }),
      h('textarea', { id: 'lpo-json', rows: 6, 'aria-label': 'データセットJSON' }),
      h('button', { type: 'button', id: 'btn-lpo-apply', onclick: () => {
        try { if (edit({ type: 'setDataset', value: JSON.parse($('#lpo-json').value) })) toast('データセットを適用しました'); } catch (e) { toast(`JSONとして読めません: ${e.message}`, 'error'); }
      } }, '適用')));
  const conn = h('p', { class: 'small', id: 'lpo-connections' }, h('strong', { text: '未接続: ' }), Object.values(a.connections).map((c) => c.label).join(' / '), '（ヒートマップ・メール・外部分析・広告配信の数値は取り込んでいません）');
  if (!a.ok) return h('section', { class: 'card' }, h('h2', { text: 'LPO' }), conn, h('p', { text: a.message }), loader);
  const exps = a.analyses.map((an) => h('section', { class: 'card exp' },
    h('h3', { text: an.name }),
    h('p', { class: 'small', text: `期間 ${an.period} / 分母 ${an.unit} / CV定義: ${an.conversionDefinition} / 計測: ${an.measurement}` }),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['案', '分母', 'CTAクリック', 'CV', 'CV率', '95%CI'].map((t) => h('th', { text: t })))),
      h('tbody', {}, ...an.rows.map((r) => h('tr', {}, h('td', { text: r.name }), h('td', { text: r.visitors ?? '欠損' }), h('td', { text: r.ctaClicks ?? '—' }), h('td', { text: r.conversions ?? '欠損' }), h('td', { text: pct(r.rate) }), h('td', { text: r.ci ? `${pct(r.ci[0])}〜${pct(r.ci[1])}` : '—' })))))),
    an.srm ? h('p', { class: 'small', text: `割付比チェック（SRM）: p=${an.srm.p.toFixed(4)} ${an.srm.detected ? '→ ずれを検出' : '→ 問題なし'}` }) : null,
    an.comparisons.length ? h('ul', { class: 'verdicts' }, ...an.comparisons.map((c) => h('li', { class: `v-${c.verdict}` },
      h('strong', { text: `${c.variant}: ${c.label}` }), c.p != null ? ` (p=${c.p.toExponential(2)}, 補正後α=${c.alphaAdjusted.toFixed(3)})` : '',
      h('ul', {}, ...c.reasons.map((r) => h('li', { text: r })))))) : h('p', { class: 'small', text: '比較対象の案がありません（単一群の参考集計）。' })));
  const cross = h('ul', { class: 'small' }, ...a.crossPeriod.map((c) => h('li', { class: c.comparable ? '' : 'ng', text: `${c.a} × ${c.b}: ${c.comparable ? `定義一致・期間重複なし（比較の前提を満たす。注意: ${c.cautions.join(' / ')}）` : `比較しない — ${c.reasons.join(' / ')}`}` })));
  const hyps = a.hypotheses.map((x) => h('article', { class: 'card hyp', 'data-h': x.id },
    h('h3', {}, h('span', { class: `prio p-${x.priority.level}`, text: `優先度 ${x.priority.level}` }), ` ${x.title}`),
    h('p', { class: 'small', text: `根拠種別: ${{ 'observed-fictional': '架空集計の観測', 'project-audit': 'このLPの監査結果', heuristic: '一般論（未検証）' }[x.evidenceType]} / スコア ${x.priority.score}（影響${x.priority.impact}×確度${x.priority.confidence}÷工数${x.priority.effort}）` }),
    h('h4', { text: '観測・理由' }), h('ul', {}, ...x.basis.map((b) => h('li', { text: b }))),
    h('h4', { text: '仮説（推測）' }), h('p', { text: x.hypothesis }),
    h('h4', { text: '評価指標' }), h('p', { text: x.metric }),
    x.guardrails.length ? [h('h4', { text: 'guardrail' }), h('ul', {}, ...x.guardrails.map((g) => h('li', { text: g })))] : null,
    h('h4', { text: '停止条件' }), h('ul', {}, ...x.stopConditions.map((g) => h('li', { text: g }))),
    h('p', { class: 'warn small', text: x.caution })));
  return h('div', {},
    h('div', { class: 'fiction-banner', role: 'note', id: 'lpo-banner', text: `⚠ ${a.banner}` }),
    h('section', { class: 'card' }, h('h2', { text: 'LPO（観測と推測を分けて表示）' }), conn,
      h('p', { class: 'small', text: `判定ルール（固定）: α=${a.rules.alpha}（両側・多重比較はBonferroni）/ 検出力 ${a.rules.power} / MDE 相対${a.rules.mdeRelative * 100}% / 各群 ${a.rules.minVisitorsPerArm} 以上かつ CV ${a.rules.minConversionsPerArm} 以上 / SRM p<${a.rules.srmP} / 欠損日・期間未了は判定しない` }),
      loader),
    h('h2', { class: 'sec-title', text: '観測（架空集計）' }), ...exps,
    h('section', { class: 'card' }, h('h3', { text: '期間をまたぐ比較の前提チェック' }), cross),
    h('h2', { class: 'sec-title', text: '仮説と検証計画（推測・優先順）' }), ...hyps);
}

// ---------------- 7 生成（Claude Code） ----------------
function renderGen(p) {
  const sel = p.sections.find((s) => s.id === state.selected) || p.sections[0];
  const prompt = buildPrompt(p, state.genMode, { promise: $('#reangle-input')?.value || p.brief.promise.value, sectionId: sel?.id });
  const r = state.lastIngest;
  return h('div', { class: 'grid-2' },
    h('section', { class: 'card span-all' }, h('h2', { text: '生成アダプタ' }),
      h('ul', { class: 'plain' },
        h('li', {}, h('strong', { text: ADAPTERS.template.label }), ' — 利用可。ブリーフ値を決まった型に差し込むだけで、文章は生成しません。'),
        h('li', {}, h('strong', { text: ADAPTERS['claude-code'].label }), ' — ブラウザからは未接続。下の指示を Claude Code に渡し、返ってきた JSON を貼り付けて取り込みます（CLI: node cli.mjs prompt / ingest）。新規APIキー・外部APIは使いません。'))),
    h('section', { class: 'card' }, h('h2', { text: '① 指示を作る' }),
      h('div', { class: 'row', role: 'radiogroup', 'aria-label': '生成モード' }, ...['full', 'reangle', 'section'].map((m) => h('label', { class: `mode${state.genMode === m ? ' on' : ''}` },
        h('input', { type: 'radio', name: 'gmode', id: `gmode-${m}`, checked: state.genMode === m, onchange: () => { state.genMode = m; render(); } }), MODE_LABEL[m]))),
      state.genMode === 'section' ? h('p', { class: 'small', text: `対象: ${sel ? SECTION_CATALOG[sel.type].label : '-'}（2 のタブで選択）` }) : null,
      h('textarea', { id: 'gen-prompt', rows: 16, readonly: true, value: prompt, 'aria-label': '生成指示' }),
      h('button', { type: 'button', id: 'btn-copy-prompt', onclick: async () => { try { await navigator.clipboard.writeText(prompt); toast('コピーしました'); } catch { $('#gen-prompt').select(); toast('選択しました。Ctrl+C でコピーしてください'); } } }, '指示をコピー')),
    h('section', { class: 'card' }, h('h2', { text: '② Claude Code の出力 JSON を取り込む' }),
      h('p', { class: 'small', text: '取り込んだセクションは「未承認」、根拠候補は「未検証」になります。HTML・URL・参考LP固有値を含むフィールドは拒否します。' }),
      h('textarea', { id: 'gen-response', rows: 12, 'aria-label': '生成JSON' }),
      h('button', { type: 'button', id: 'btn-ingest', class: 'primary', onclick: () => {
        const res = ingestGenerated(state.project, $('#gen-response').value, { mode: state.genMode, sectionId: sel?.id });
        state.lastIngest = res.report;
        if (res.ok) { commit(res.project); toast('取り込みました（未承認）'); } else { toast(`取り込めません: ${res.report.errors[0]}`, 'error'); render(); }
      } }, '検証して取り込む'),
      r ? h('div', { class: 'small', id: 'ingest-report' }, ...['errors', 'rejected', 'warnings', 'added'].flatMap((k) => r[k].map((m) => h('div', { class: `rep-${k}`, text: `${{ errors: 'エラー', rejected: '拒否', warnings: '警告', added: '追加' }[k]}: ${m}` })))) : null));
}

// ---------------- render ----------------
function render() {
  const p = state.project;
  if (!p) return;
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : null;
  const scrollY = window.scrollY;
  $('#project-name').value = p.name;
  $('#btn-undo').disabled = !state.undo.length;
  $('#btn-redo').disabled = !state.redo.length;
  $('#ai-status').textContent = 'AI生成: ブラウザからは未接続。テンプレート下書き（AI生成ではない）と、Claude Code との prompt→JSON 受け渡しのみ動作します。';
  document.querySelectorAll('[role=tab]').forEach((t) => {
    const on = t.dataset.tab === state.tab;
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
  });
  const panel = $('#panel');
  panel.setAttribute('aria-labelledby', `tab-${state.tab}`);
  const view = { brief: renderBrief, plan: renderPlan, design: renderDesign, cta: renderCta, export: renderExport, lpo: renderLpo, gen: renderGen }[state.tab](p);
  panel.replaceChildren(view);
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }
  window.scrollTo(0, scrollY);
  storageSet(UI_KEY, JSON.stringify({ tab: state.tab, selected: state.selected, mode: state.mode }));
}

// ---------------- 起動 ----------------
function bindChrome() {
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-save').addEventListener('click', () => {
    download(`${safeName(state.project)}.lpstudio.json`, serializeProject({ ...state.project, schemaVersion: SCHEMA_VERSION }), 'application/json');
    toast('project JSON を保存しました');
  });
  $('#file-load').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast('ファイルが大きすぎます（2MBまで）', 'error'); return; }
    loadJsonText(await f.text(), f.name);
    e.target.value = '';
  });
  $('#btn-load').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file-load').click(); } });
  $('#btn-seed').addEventListener('click', async () => { try { state.selected = null; commit(await loadSeed()); toast('架空seedを読み込みました'); } catch (e) { toast(e.message, 'error'); } });
  $('#btn-new').addEventListener('click', () => { state.selected = null; commit(emptyProject()); toast('新規プロジェクト（ブリーフから入力してください）'); setTab('brief'); });
  $('#project-name').addEventListener('change', (e) => edit({ type: 'setName', value: e.target.value }));
  const tabs = [...document.querySelectorAll('[role=tab]')];
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => setTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = tabs.length - 1;
      if (j != null) { e.preventDefault(); setTab(tabs[j].dataset.tab); tabs[j].focus(); }
    });
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  });
}

async function boot() {
  bindChrome();
  const ui = (() => { try { return JSON.parse(storageGet(UI_KEY) || '{}'); } catch { return {}; } })();
  if (ui.mode && MODE_LABEL[ui.mode]) state.mode = ui.mode;
  if (ui.selected) state.selected = ui.selected;
  const saved = storageGet(AUTOSAVE_KEY);
  const restored = saved ? parseProjectJson(saved) : null;
  if (restored && restored.ok) {
    state.project = restored.project;
    toast('前回の編集を復元しました（再開）');
  } else {
    try { state.project = await loadSeed(); } catch { state.project = emptyProject(); }
    if (saved) toast('前回の保存データが読めなかったため架空seedで開きました', 'error');
  }
  const hashTab = location.hash.slice(1);
  state.tab = TABS.includes(hashTab) ? hashTab : (TABS.includes(ui.tab) ? ui.tab : 'brief');
  history.replaceState({ tab: state.tab }, '', `#${state.tab}`);
  render();
  document.body.dataset.ready = '1';
}
boot();
