// LP Studio UI（v2）。core の純関数だけで状態を変える。DOM は h() で作り、文字列は textContent で入れる（innerHTML 不使用）。
// プレビューは sandbox="allow-scripts"（allow-same-origin なし）の iframe srcdoc。
import { parseProjectJson, serializeProject, refIndex, SCHEMA_VERSION, DEMO_MODES, CATEGORIES, LEDGER_KINDS, REALITY, EVIDENCE_KINDS, ACTION_BEHAVIORS, CTA_TIMINGS, FONTS } from '../core/schema.js';
import { ROLES, ROLE_IDS, ANGLE_DEPENDENT } from '../core/roles.js';
import { applyEdit, emptyProject } from '../core/model.js';
import { buildPrompt, ingestGenerated, applySkeleton, ADAPTERS } from '../core/generate.js';
import { checkProject, gates } from '../core/editorial.js';
import { renderPage, renderWireframe, exportHtml, contrastChecks } from '../core/render.js';
import { analyzeLpo } from '../core/lpo.js';

const AUTOSAVE_KEY = 'lp-studio:autosave:v2';
const UI_KEY = 'lp-studio:ui:v2';
const TABS = ['inputs', 'insight', 'plan', 'design', 'export', 'cta', 'lpo', 'gen'];
const L = {
  kind: { 'verified-spec': '確認済み仕様', 'provider-claim': '提供者の申告', 'customer-observation': '顧客の観察', 'customer-quote': '顧客の原文', hypothesis: '仮説', unknown: '不明・未確定' },
  reality: { real: '実在', synthetic: '合成デモ', unknown: '不明' },
  demo: { 'synthetic-demo': '架空サービスのデモ', prototype: '試作', live: '実販売' },
  evKind: { 'service-spec': 'サービス仕様', 'real-screen': '実画面', 'real-sample': '実物見本', 'outcome-aggregate': '実績集計', 'customer-quote': '顧客の発言', 'third-party': '第三者資料', hypothesis: '仮説', illustrative: '説明用の架空例' },
  behavior: { 'external-booking': '外部の予約', 'external-signup': '外部の登録', 'external-contact': '問い合わせ', purchase: '購入', none: '未定' },
  timing: { spec: '仕様: FV後に表示（公開用）', 'after-half': '比較用: ページの半分を過ぎてから' },
  cat: { general: '一般', education: '教育・学習', health: '健康', beauty: '美容', finance: '金融', employment: '就職・転職', 'b2b-software': '業務用ソフト' },
  level: { stop: '停止', warn: '要確認', info: '情報' },
};

const state = { project: null, undo: [], redo: [], tab: 'inputs', selected: null, preview: { device: 'both', reduce: false, kind: 'review', nonce: 0 }, genMode: 'full', lastIngest: null };

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
  t.textContent = msg; t.dataset.kind = kind; t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 4200);
}
function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, v) { try { localStorage.setItem(key, v); } catch { /* 保存できない環境でも動く */ } }

// ---------------- 状態 ----------------
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
  try { commit(applyEdit(state.project, op)); return true; } catch (e) { toast(e.message, 'error'); render(); return false; }
}
const restore = (json) => parseProjectJson(json).project;
function undo() {
  if (!state.undo.length) return toast('これ以上戻せません');
  state.redo.push(serializeProject(state.project));
  state.project = restore(state.undo.pop());
  storageSet(AUTOSAVE_KEY, serializeProject(state.project));
  render(); toast('元に戻しました');
}
function redo() {
  if (!state.redo.length) return toast('やり直す操作がありません');
  state.undo.push(serializeProject(state.project));
  state.project = restore(state.redo.pop());
  storageSet(AUTOSAVE_KEY, serializeProject(state.project));
  render(); toast('やり直しました');
}
async function seedText(kind) {
  const embed = window.__LP_STUDIO_EMBED__;
  if (embed) return embed[kind];
  const path = kind === 'dataset' ? '../../seed/lpo-dataset.fictional.json' : `../../seed/${kind}.project.json`;
  return (await fetch(path, { cache: 'no-store' })).text();
}
async function loadSeed(id = 'michishirube') {
  const r = parseProjectJson(await seedText(id));
  if (!r.ok) throw new Error(r.errors.join(' / '));
  return r.project;
}
function loadJsonText(text, filename = '') {
  if (/\.html?$/i.test(filename)) { toast('HTMLは読み込めません。project JSON だけを受け付けます', 'error'); return false; }
  const r = parseProjectJson(text);
  if (!r.ok) { toast(`読み込めません: ${r.errors.slice(0, 3).join(' / ')}`, 'error'); return false; }
  state.selected = null;
  commit(r.project);
  toast(`読み込みました${r.warnings.length ? `（警告 ${r.warnings.length} 件: ${r.warnings[0]}）` : ''}`);
  return true;
}
function setTab(tab, push = true) {
  if (!TABS.includes(tab)) tab = 'inputs';
  state.tab = tab;
  if (push && location.hash !== `#${tab}`) history.pushState({ tab }, '', `#${tab}`);
  render();
}
window.addEventListener('popstate', () => setTab(location.hash.slice(1) || 'inputs', false));

// ---------------- 共通 ----------------
function sel(id, options, value, onchange, labels = {}) {
  return h('select', { id, onchange }, ...options.map((o) => h('option', { value: o, selected: o === value ? 'selected' : null, text: labels[o] || o })));
}
function field(label, input, hint) {
  return h('div', { class: 'field' }, h('label', { for: input.id, text: label }), input, hint ? h('p', { class: 'hint', text: hint }) : null);
}
const tinput = (id, value, onchange, max = 300, long = false) => (long
  ? h('textarea', { id, rows: 2, maxlength: max, value: value || '', onchange })
  : h('input', { id, type: 'text', maxlength: max, value: value || '', onchange }));
function badge(level, text) { return h('span', { class: `badge lv-${level}`, text: text || L.level[level] || level }); }
function previewFrame(html, { width, height, title, id, label = '' }) {
  const wrap = h('div', { class: 'frame-wrap', 'data-width': width, style: `--fw:${width}px;--fh:${height}px` });
  const scaleTag = h('span', { class: 'scale-tag', 'aria-live': 'polite', 'data-label': label });
  const iframe = h('iframe', { title, id, sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', width, height });
  iframe.srcdoc = html;
  wrap.append(iframe);
  const box = h('div', { class: 'frame-box' }, scaleTag, wrap);
  requestAnimationFrame(() => fitFrame(wrap, scaleTag));
  return box;
}
function fitFrame(wrap, tag) {
  const w = Number(wrap.dataset.width);
  const parent = wrap.parentElement?.parentElement;
  if (!parent) return;
  const cs = getComputedStyle(parent);
  const avail = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
  const scale = Math.min(1, avail / w);
  wrap.style.setProperty('--scale', scale);
  const actual = scale >= 0.985;
  if (actual) wrap.style.setProperty('--scale', 1);
  if (tag) { const lb = tag.dataset.label ? `${tag.dataset.label} ・ ` : ''; tag.textContent = actual ? `${lb}100%（実寸）` : `${lb}縮小 ${Math.round(scale * 100)}%（可読性は実寸で確認）`; tag.dataset.scaled = actual ? '0' : '1'; }
}
window.addEventListener('resize', () => document.querySelectorAll('.frame-wrap').forEach((w) => fitFrame(w, w.parentElement.querySelector('.scale-tag'))));
function refsText(p, refs) {
  const idx = refIndex(p);
  return refs.map((r) => { const x = idx.get(r); return x ? `${r}: ${x.text}` : `${r}: （台帳に無い）`; }).join('\n');
}

// ---------------- 1 入力・台帳 ----------------
function renderInputs(p) {
  const d = p.display;
  const i = p.inputs;
  const a = i.action;
  const ledgerRows = p.ledger.map((l) => h('tr', { 'data-ledger': l.id },
    h('td', { class: 'mono', text: l.id }),
    h('td', {}, tinput(`led-${l.id}-text`, l.text, (e) => edit({ type: 'updateLedger', id: l.id, text: e.target.value }), 300, true)),
    h('td', {}, sel(`led-${l.id}-kind`, LEDGER_KINDS.filter((k) => k !== 'customer-quote'), l.kind, (e) => edit({ type: 'updateLedger', id: l.id, kind: e.target.value }), L.kind)),
    h('td', {}, sel(`led-${l.id}-real`, REALITY, l.reality, (e) => edit({ type: 'updateLedger', id: l.id, reality: e.target.value }), L.reality)),
    h('td', { class: 'small', text: l.origin }),
    h('td', {}, h('button', { type: 'button', class: 'danger', onclick: () => edit({ type: 'removeLedger', id: l.id }) }, '削除'))));
  return h('div', { class: 'grid-2' },
    h('section', { class: 'card' },
      h('h2', { text: 'I 表示用の名前' }),
      field('ブランド名（見出しには入れない）', tinput('d-brand', d.brandName, (e) => edit({ type: 'setDisplay', key: 'brandName', value: e.target.value }), 40)),
      field('業態（短く1行）', tinput('d-desc', d.serviceDescriptor, (e) => edit({ type: 'setDisplay', key: 'serviceDescriptor', value: e.target.value }), 60)),
      field('対象者の呼びかけ（FVで1回だけ）', tinput('d-aud', d.audienceLabel, (e) => edit({ type: 'setDisplay', key: 'audienceLabel', value: e.target.value }), 60)),
      h('div', { class: 'row' }, field('区分', sel('d-mode', DEMO_MODES, d.demoMode, (e) => edit({ type: 'setDisplay', key: 'demoMode', value: e.target.value }), L.demo)),
        field('カテゴリ', sel('d-cat', CATEGORIES, d.category, (e) => edit({ type: 'setDisplay', key: 'category', value: e.target.value }), L.cat))),
      field('デモ表示（ページ上部・CTA近く・フッターに出る）', tinput('d-notice', d.demoNotice, (e) => edit({ type: 'setDisplay', key: 'demoNotice', value: e.target.value }), 100)),
      h('h2', { text: 'A 読者と場面 / B 既存の努力' }),
      ...[['scene.who', '誰が'], ['scene.timing', 'どんなタイミングで'], ['scene.trying', '何をしようとして'], ['scene.stuckAt', 'どこで止まるか'], ['efforts.tried', '既に試したこと'], ['efforts.whatHappened', 'そのとき起きたこと'], ['efforts.alternatives', '今使っている代替手段']].map(([path, label]) => {
        const [g, k] = path.split('.');
        return field(label, tinput(`in-${g}-${k}`, i[g][k], (e) => edit({ type: 'setInput', path, value: e.target.value }), 300, true));
      }),
      h('h2', { text: 'E 担える変化（約束できること／保証できないことを分ける）' }),
      ...[['canDo', '提供者が約束できる行為'], ['expectedChange', '使用後に期待する変化'], ['cannotGuarantee', '保証できない成果']].map(([k, label]) => field(`${label}（1行に1つ）`, h('textarea', { id: `pl-${k}`, rows: 3, value: i.promiseLayers[k].map((x) => x.text).join('\n'), onchange: (e) => edit({ type: 'setPromiseLayer', key: k, value: e.target.value }) }))),
      h('h2', { text: 'F 仕組み' }),
      ...[['receive', '何を受け取るか'], ['withWhom', '誰と何をするか'], ['sequence', 'どの順序で'], ['frequency', 'どれくらいの頻度で'], ['differentiation', '差別化（主張する場合は比較対象と根拠IDが必要）']].map(([k, label]) => field(label, tinput(`mech-${k}`, i.mechanism[k], (e) => edit({ type: 'setInput', path: `mechanism.${k}`, value: e.target.value }), 300, true)))),
    h('section', { class: 'card' },
      h('h2', { text: 'H 行動条件（確認できたものだけ「確定」に）' }),
      field('CTAで起きること', sel('act-behavior', ACTION_BEHAVIORS, a.behavior, (e) => edit({ type: 'setAction', key: 'behavior', value: e.target.value }), L.behavior)),
      ...[['ctaLabel', '実際の申込ボタンの文言', null], ['url', 'リンク先URL', 'url'], ['price', '料金', 'price'], ['duration', '所要時間', 'duration'], ['method', '実施方法', 'method'], ['continuation', '継続条件', null], ['requiredInput', '必要な入力', null]].map(([k, label, ck]) => h('div', { class: 'row field-row' },
        field(label, tinput(`act-${k}`, a[k], (e) => edit({ type: 'setAction', key: k, value: e.target.value }), k === 'url' ? 400 : 200)),
        ck ? h('label', { class: 'inline' }, h('input', { type: 'checkbox', id: `act-${k}-ok`, checked: a.confirmed[ck], onchange: (e) => edit({ type: 'confirmAction', key: ck, value: e.target.checked }) }), '確定') : null)),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', id: 'act-offer-ok', checked: a.confirmed.offer, onchange: (e) => edit({ type: 'confirmAction', key: 'offer', value: e.target.checked }) }), 'オファーの内容が確定している'),
      field('言わないこと（1行に1つ）', h('textarea', { id: 'dna', rows: 4, value: i.doNotAssert.join('\n'), onchange: (e) => edit({ type: 'setDoNotAssert', value: e.target.value }) })),
      h('h2', { text: 'ブランドtoken' }),
      h('div', { class: 'tokens' }, ...['primary', 'accent', 'ink', 'paper'].map((k) => h('div', { class: 'token' },
        h('label', { for: `brand-${k}`, text: { primary: 'メイン', accent: 'アクセント', ink: '文字', paper: '紙面' }[k] }),
        h('input', { type: 'color', id: `brand-${k}`, value: p.brand[k], onchange: (e) => edit({ type: 'setBrand', key: k, value: e.target.value }) }),
        h('input', { type: 'text', id: `brand-${k}-hex`, value: p.brand[k], maxlength: 7, 'aria-label': `${k} の16進`, onchange: (e) => edit({ type: 'setBrand', key: k, value: e.target.value }) })))),
      field('書体', sel('brand-font', FONTS, p.brand.font, (e) => edit({ type: 'setBrand', key: 'font', value: e.target.value }), { sans: 'ゴシック', serif: '明朝', rounded: '丸ゴシック' })),
      h('ul', { class: 'plain small' }, ...contrastChecks(p).map((c) => h('li', { class: c.ok ? 'ok' : 'ng', text: `${c.ok ? '✓' : '✕'} ${c.name}: ${c.ratio}:1` })))),
    h('section', { class: 'card span-all' },
      h('h2', { text: '事実台帳（参照IDつき。コピーの各主張はここを参照する）' }),
      h('p', { class: 'muted small', text: '確認済み仕様／提供者の申告／顧客の観察／仮説／不明 に分けます。合成デモの事実は、実在の根拠になりません。' }),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['ID', '内容', '種別', '実在/合成', '出所', ''].map((t) => h('th', { text: t })))), h('tbody', {}, ...ledgerRows))),
      h('div', { class: 'row' },
        h('input', { type: 'text', id: 'led-new-text', placeholder: '事実・不明点（例: 面談の所要時間）', 'aria-label': '台帳に追加する内容', maxlength: 300 }),
        sel('led-new-kind', LEDGER_KINDS.filter((k) => k !== 'customer-quote'), 'provider-claim', null, L.kind),
        sel('led-new-real', REALITY, 'unknown', null, L.reality),
        h('button', { type: 'button', id: 'btn-led-add', onclick: () => { const t = $('#led-new-text').value.trim(); if (!t) return toast('内容を入力してください', 'error'); edit({ type: 'addLedger', text: t, kind: $('#led-new-kind').value, reality: $('#led-new-real').value }); } }, '台帳に追加')),
      h('h3', { text: 'C 顧客の原文（人が入れたものだけ。生成では入りません）' }),
      p.quotes.length ? h('ul', { class: 'plain small' }, ...p.quotes.map((q) => h('li', { text: `${q.id}「${q.text}」— ${q.speakerId} / ${q.method} / ${q.date} / ${q.usable ? '使用可' : '使用不可'}` }))) : h('p', { class: 'small muted', text: '（なし。顧客の原文が無いので、口コミ・引用は作りません）' }),
      h('details', {}, h('summary', { text: '原文を追加する' }),
        h('div', { class: 'row' },
          h('input', { type: 'text', id: 'q-text', placeholder: '原文', 'aria-label': '原文', maxlength: 300 }),
          h('input', { type: 'text', id: 'q-speaker', placeholder: '発言者の匿名ID', 'aria-label': '発言者の匿名ID', maxlength: 40 }),
          h('input', { type: 'text', id: 'q-method', placeholder: '収集方法', 'aria-label': '収集方法', maxlength: 60 }),
          h('input', { type: 'date', id: 'q-date', 'aria-label': '日付' }),
          h('label', { class: 'inline' }, h('input', { type: 'checkbox', id: 'q-usable' }), '公開使用の同意あり'),
          h('button', { type: 'button', onclick: () => edit({ type: 'addQuote', text: $('#q-text').value, speakerId: $('#q-speaker').value, method: $('#q-method').value, date: $('#q-date').value, usable: $('#q-usable').checked }) }, '追加')))));
}

// ---------------- 2 インサイト・訴求 ----------------
function renderInsight(p) {
  const ins = p.insights.map((x) => h('article', { class: 'card hyp', 'data-insight': x.id },
    h('h3', {}, badge(x.status === 'hypothesis' ? 'warn' : 'ok', x.status === 'hypothesis' ? '仮説（顧客の原文・観察で未確認）' : '原文・観察で裏づけあり'), ` ${x.statement}`),
    h('dl', { class: 'kv' },
      h('dt', { text: '資料から読んだこと' }), h('dd', { text: x.readFromSource || '—' }),
      h('dt', { text: '推測したこと' }), h('dd', { text: x.inferred || '—' }),
      h('dt', { text: '根拠ID' }), h('dd', { class: 'mono', title: refsText(p, x.sourceRefs), text: x.sourceRefs.join(', ') || '—' }),
      h('dt', { text: '確度' }), h('dd', { text: { low: '低', medium: '中', high: '高' }[x.confidence] || '—' }),
      h('dt', { text: '別の解釈' }), h('dd', { text: x.alternatives.join(' / ') || '—' }),
      h('dt', { text: '確認したい質問' }), h('dd', { text: x.questions.join(' / ') || '—' }))));
  const angles = p.angles.map((a) => {
    const sc = a.scores || {};
    const chosen = p.chosenAngleId === a.id;
    return h('tr', { class: chosen ? 'chosen' : '', 'data-angle': a.id },
      h('td', {}, h('strong', { text: a.statement }), h('div', { class: 'small muted', text: a.rationale })),
      h('td', { class: 'mono small', title: refsText(p, a.sourceRefs), text: a.sourceRefs.join(', ') }),
      h('td', { class: 'small', text: `根拠${sc.evidence ?? '-'} / 適合${sc.fit ?? '-'} / 具体${sc.specificity ?? '-'} / 次の行動${sc.nextAction ?? '-'}` }),
      h('td', {}, chosen ? h('span', { class: 'badge ok', text: '選択中' }) : h('button', { type: 'button', id: `angle-${a.id}`, onclick: () => { if (edit({ type: 'chooseAngle', id: a.id })) toast(`訴求を変更しました。${ANGLE_DEPENDENT.map((r) => ROLES[r].label).join('・')} は要再確認です（「8 生成」で依存セクションの再生成指示を作れます）`); } }, 'この訴求にする')));
  });
  const sc = p.selfCheck;
  return h('div', {},
    h('section', { class: 'card' }, h('h2', { text: 'インサイト仮説' }),
      h('p', { class: 'muted small', text: 'コピー本文には出しません。資料から読んだことと推測を分けています。顧客の原文・観察が無いあいだは仮説のままです。' }),
      ins.length ? ins : h('p', { text: 'まだありません。「8 生成」で Claude Code に作らせてください。' })),
    h('section', { class: 'card' }, h('h2', { text: '訴求の候補と選択' }),
      h('p', { class: 'muted small', text: '根拠・サービス適合・場面の具体性・次の行動で比べます。訴求を変えると、共感・仕組み・図解・根拠・締めを再検討の対象にします（手動編集した他のセクションは保持）。' }),
      angles.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['訴求と理由', '根拠ID', '評価', ''].map((t) => h('th', { text: t })))), h('tbody', {}, ...angles))) : h('p', { text: '候補がありません。' })),
    sc ? h('section', { class: 'card' }, h('h2', { text: '生成時の自己点検' }),
      h('dl', { class: 'kv' },
        h('dt', { text: '声に出して直した点' }), h('dd', { text: (sc.readAloud || []).join(' / ') || '—' }),
        h('dt', { text: '一貫性' }), h('dd', { text: sc.consistency || '—' }),
        h('dt', { text: '不足している重要情報' }), h('dd', { text: (sc.missing || []).join(' / ') || '—' }),
        h('dt', { text: 'SPでの文字量' }), h('dd', { text: sc.spLength || '—' }),
        h('dt', { text: '残る要確認事項' }), h('dd', { text: (sc.openQuestions || []).join(' / ') || '—' }))) : null);
}

// ---------------- 3 構成・コピー ----------------
function renderPlan(p) {
  if (!state.selected || !p.sections.some((s) => s.id === state.selected)) state.selected = p.sections[0]?.id || null;
  const issues = checkProject(p);
  const list = h('ol', { class: 'plan', 'aria-label': 'セクション' }, ...p.sections.map((s, i) => {
    const own = issues.filter((x) => x.sectionId === s.id && x.level !== 'info');
    const selOn = s.id === state.selected;
    return h('li', { class: `plan-item${selOn ? ' sel' : ''}`, 'data-section-id': s.id },
      h('button', { type: 'button', class: 'pick', id: `pick-${s.id}`, 'aria-pressed': selOn ? 'true' : 'false', onclick: () => { state.selected = s.id; render(); } },
        h('strong', { text: `${i + 1}. ${ROLES[s.role].label}` }), h('span', { class: 'role', text: s.heading || '（見出しなし）' })),
      h('div', { class: 'tags' },
        s.approved ? h('span', { class: 'badge ok', text: '承認済' }) : badge('warn', '未承認'),
        s.needsReview ? badge('warn', '要再確認') : null,
        h('span', { class: 'badge soft', text: { 'claude-code': 'Claude Code生成', template: '骨組み', manual: '手入力', migrated: '移行' }[s.origin] }),
        ...own.slice(0, 3).map((x) => badge(x.level, x.level === 'stop' ? '停止条件' : '要確認'))),
      h('div', { class: 'row tiny' },
        h('button', { type: 'button', id: `up-${s.id}`, 'aria-label': '上へ', disabled: i === 0, onclick: () => edit({ type: 'moveSection', id: s.id, delta: -1 }) }, '↑'),
        h('button', { type: 'button', id: `down-${s.id}`, 'aria-label': '下へ', disabled: i === p.sections.length - 1, onclick: () => edit({ type: 'moveSection', id: s.id, delta: 1 }) }, '↓'),
        ROLES[s.role].required ? null : h('button', { type: 'button', class: 'danger', id: `del-${s.id}`, onclick: () => edit({ type: 'removeSection', id: s.id }) }, '削除')));
  }));
  const adder = h('div', { class: 'row' }, h('label', { for: 'add-role', class: 'sr', text: '追加する役割' }), sel('add-role', ROLE_IDS, 'faq', null, Object.fromEntries(ROLE_IDS.map((r) => [r, ROLES[r].label]))),
    h('button', { type: 'button', id: 'btn-add-section', onclick: () => { const idx = p.sections.findIndex((s) => s.id === state.selected); if (edit({ type: 'addSection', role: $('#add-role').value, at: idx + 1 })) { state.selected = state.project.sections[idx + 1]?.id; render(); } } }, '選択中の下に追加'));
  const s = p.sections.find((x) => x.id === state.selected);
  return h('div', { class: 'plan-layout' },
    h('section', { class: 'card' }, h('h2', { text: '構成（入力と読者の疑問に合わせて選ぶ）' }), list, adder,
      p.sections.length ? null : h('button', { type: 'button', onclick: () => commit(applySkeleton(state.project)) }, '骨組みを置く（ルールベース・AI生成ではない）')),
    h('section', { class: 'card' }, h('h2', { text: 'セクション編集' }), s ? sectionEditor(p, s, issues) : h('p', { text: 'セクションがありません。' })),
    h('section', { class: 'card' }, h('h2', { text: 'ワイヤーフレーム（同じデータ）' }), previewFrame(renderWireframe(p), { width: 760, height: 1200, title: 'ワイヤーフレーム', id: 'wf-frame' })));
}
function sectionEditor(p, s, issues) {
  const idx = refIndex(p);
  const own = issues.filter((x) => x.sectionId === s.id);
  const allRefs = [...p.ledger.map((l) => ({ id: l.id, text: l.text, tag: L.kind[l.kind] })), ...p.evidence.map((e) => ({ id: e.id, text: e.claim, tag: `根拠・${L.reality[e.reality]}` })), ...p.quotes.map((q) => ({ id: q.id, text: q.text, tag: '顧客の原文' }))];
  return h('div', { class: 'editor' },
    h('p', { class: 'muted' }, h('strong', { text: ROLES[s.role].label }), ` — ${ROLES[s.role].purpose}`),
    field('見出し', tinput('f-heading', s.heading, (e) => edit({ type: 'setField', id: s.id, field: 'heading', value: e.target.value }), 120)),
    field('見出しの改行候補（意味のまとまりを「/」で区切る。空なら自動）', tinput('f-phrases', s.headingPhrases.join('/'), (e) => edit({ type: 'setPhrases', id: s.id, value: e.target.value }), 300)),
    field('本文', h('textarea', { id: 'f-body', rows: 5, value: s.body, onchange: (e) => edit({ type: 'setField', id: s.id, field: 'body', value: e.target.value }) })),
    field('項目（1行に1つ。「見出し｜本文」）', h('textarea', { id: 'f-items', rows: 4, value: s.items.map((i) => (i.body ? `${i.heading}｜${i.body}` : i.heading)).join('\n'), onchange: (e) => edit({ type: 'setItems', id: s.id, value: e.target.value }) })),
    field('注記', tinput('f-note', s.note, (e) => edit({ type: 'setField', id: s.id, field: 'note', value: e.target.value }), 200)),
    s.visual ? h('fieldset', { class: 'refs' }, h('legend', { text: `図（${s.visual.kind}・説明用の例。成果の証拠ではない）` }),
      ...['label', 'title', 'task', 'from', 'to', 'review', 'note'].filter((k) => s.visual[k] !== undefined && (s.visual[k] || ['label', 'note'].includes(k))).map((k) => field(k, tinput(`v-${k}`, s.visual[k], (e) => edit({ type: 'setVisual', id: s.id, key: k, value: e.target.value }), 160)))) : null,
    s.cta ? field(`CTA（ページ内の #${s.cta.target} へ移動）`, tinput('f-cta', s.cta.label, (e) => edit({ type: 'setCtaLabel', id: s.id, value: e.target.value }), 40)) : null,
    s.commercialPreview ? h('p', { class: 'small muted', text: `実際の申込ボタン「${s.commercialPreview.label}」は、実販売の公開準備が整うまで無効表示です。` }) : null,
    h('fieldset', { class: 'refs' }, h('legend', { text: 'このセクションの参照ID（主張の裏づけ）' }),
      ...allRefs.map((r) => h('label', { class: 'inline' }, h('input', { type: 'checkbox', id: `ref-${s.id}-${r.id}`, checked: s.sourceRefs.includes(r.id), onchange: (e) => { const n = new Set(s.sourceRefs); if (e.target.checked) n.add(r.id); else n.delete(r.id); edit({ type: 'setRefs', id: s.id, value: [...n] }); } }), h('span', { class: 'mono', text: r.id }), ` ${r.text.slice(0, 40)}`, h('span', { class: 'badge soft', text: r.tag })))),
    s.items.some((i) => i.sourceRefs.length) ? h('p', { class: 'small muted', text: `項目の参照: ${s.items.map((i, k) => `${k + 1}) ${i.sourceRefs.map((r) => (idx.get(r) ? r : `${r}?`)).join(',') || '—'}`).join('  ')}` }) : null,
    own.length ? h('ul', { class: 'issues' }, ...own.map((x) => h('li', {}, badge(x.level), ` ${x.message}`))) : h('p', { class: 'ok small', text: '✓ このセクションに停止条件・要確認はありません' }),
    h('div', { class: 'row' },
      h('button', { type: 'button', id: 'btn-approve', class: s.approved ? '' : 'primary', onclick: () => edit({ type: 'approveSection', id: s.id, value: !s.approved }) }, s.approved ? '承認を取り消す' : '内容を確認して承認'),
      h('button', { type: 'button', onclick: () => { state.genMode = 'section'; setTab('gen'); } }, 'Claude Code で書き直す指示 →')));
}

// ---------------- 4 プレビュー ----------------
function renderDesign(p) {
  const pv = state.preview;
  const { html, report } = renderPage(p, { kind: pv.kind, reduceMotion: pv.reduce });
  const stops = report.issues.filter((x) => x.level === 'stop').length;
  const toolbar = h('div', { class: 'pv-toolbar', role: 'toolbar', 'aria-label': 'プレビュー操作' },
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '表示する端末' }, ...[['both', 'PC＋SP'], ['pc', 'PC 1280'], ['sp', 'SP 400']].map(([k, t]) => h('label', { class: `mode${pv.device === k ? ' on' : ''}` }, h('input', { type: 'radio', name: 'dev', id: `dev-${k}`, checked: pv.device === k, onchange: () => { pv.device = k; render(); } }), t))),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '描画の種類' }, ...[['review', 'レビュー用'], ['draft', '社内確認（参照ID表示）']].map(([k, t]) => h('label', { class: `mode${pv.kind === k ? ' on' : ''}` }, h('input', { type: 'radio', name: 'pkind', id: `pkind-${k}`, checked: pv.kind === k, onchange: () => { pv.kind = k; render(); } }), t))),
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', id: 'pv-reduce', checked: pv.reduce, onchange: (e) => { pv.reduce = e.target.checked; render(); } }), '動きを減らす'),
    h('button', { type: 'button', id: 'pv-replay', onclick: () => { pv.nonce++; render(); } }, '▶ 登場アニメーションを再生'),
    h('button', { type: 'button', id: 'pv-open', onclick: () => { const url = URL.createObjectURL(new Blob([html], { type: 'text/html' })); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000); } }, '実寸で開く'),
    h('span', { class: `pv-status ${stops ? 'ng' : 'ok'}`, text: stops ? `停止条件 ${stops} 件（5で確認）` : 'レビュー用に描画できます' }));
  const frames = [];
  const tagged = html.replace('<body', `<body data-nonce="${pv.nonce}"`);
  if (pv.device !== 'sp') frames.push(h('section', { class: 'card pc pv-card' }, previewFrame(tagged, { width: 1280, height: 800, title: 'PCプレビュー', id: 'pc-frame', label: 'PC 1280×800' })));
  if (pv.device !== 'pc') frames.push(h('section', { class: 'card sp pv-card' }, previewFrame(tagged, { width: 400, height: 760, title: 'SPプレビュー', id: 'sp-frame', label: 'SP 400×760' })));
  return h('div', {}, toolbar, h('div', { class: `design dev-${pv.device}` }, ...frames));
}

// ---------------- 5 検証・公開判定 ----------------
function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const fileBase = (p) => String(p.id || 'lp').replace(/[^\w-]+/g, '_').slice(0, 60);
function renderExport(p) {
  const issues = checkProject(p);
  const g = gates(p, issues);
  const review = exportHtml(p, 'review');
  const evRows = p.evidence.map((ev) => h('tr', { 'data-ev': ev.id, class: ev.reality !== 'real' ? 'synthetic' : '' },
    h('td', {}, ev.claim, ev.reality !== 'real' ? h('div', { class: 'small ng', text: '合成・不明のデータ。LPの成果根拠には出しません（検証用データ）' }) : null),
    h('td', { class: 'small', text: `${L.evKind[ev.kind]} / ${L.reality[ev.reality]}` }),
    h('td', { class: 'small', text: [ev.source, ev.metricTarget && `対象: ${ev.metricTarget}`, ev.metricPeriod && `期間: ${ev.metricPeriod}`, ev.metricDenominator && `分母: ${ev.metricDenominator}`, ev.metricDefinition && `定義: ${ev.metricDefinition}`].filter(Boolean).join(' / ') }),
    h('td', {}, ev.status === 'verified' ? h('span', { class: 'badge ok', text: `出典確認 ${ev.verifiedBy} ${ev.verifiedAt}` }) : badge('warn', '未検証'), h('div', { class: 'small muted', text: '※出典の確認は、事実性や公開可否を意味しません' })),
    h('td', {}, ev.status === 'verified'
      ? h('button', { type: 'button', id: `unverify-${ev.id}`, onclick: () => edit({ type: 'verifyEvidence', id: ev.id, value: false }) }, '取り消す')
      : h('div', { class: 'row tiny' }, h('input', { type: 'text', id: `vby-${ev.id}`, placeholder: '確認者', 'aria-label': '確認者', maxlength: 80 }), h('input', { type: 'date', id: `vat-${ev.id}`, 'aria-label': '確認日' }),
        h('button', { type: 'button', id: `verify-${ev.id}`, onclick: () => edit({ type: 'verifyEvidence', id: ev.id, value: true, verifiedBy: $(`#vby-${ev.id}`).value, verifiedAt: $(`#vat-${ev.id}`).value }) }, '出典を確認した')))));
  const issueList = (lv) => issues.filter((x) => x.level === lv).map((x) => h('li', {}, badge(lv), ` ${x.message}`));
  return h('div', { class: 'grid-2' },
    h('section', { class: 'card span-all gates' },
      h('div', { class: `gate ${g.reviewPreview.ok ? 'ok' : 'ng'}`, id: 'gate-review' }, h('h2', { text: `レビュー用プレビュー: ${g.reviewPreview.ok ? '安全に描画できます' : '停止条件があります'}` }),
        h('p', { class: 'small', text: '架空・未確定の内容を含んだまま、社内やレビュー担当が見るためのものです。CTAはページ内の例だけが動き、予約・登録・送信は行いません。' }),
        g.reviewPreview.ok ? null : h('ul', {}, ...g.reviewPreview.reasons.map((r) => h('li', { text: r })))),
      h('div', { class: `gate ${g.commercialReady.ok ? 'ok' : 'ng'}`, id: 'gate-commercial' }, h('h2', { text: `実販売の公開準備: ${g.commercialReady.ok ? '整っています' : '整っていません（商用公開不可）'}` }),
        h('ul', {}, ...g.commercialReady.reasons.map((r) => h('li', { text: r }))))),
    h('section', { class: 'card' }, h('h2', { text: `停止条件・要確認（${issues.filter((x) => x.level !== 'info').length}）` }),
      h('ul', { class: 'issues', id: 'issue-list' }, ...issueList('stop'), ...issueList('warn'), ...issueList('info'))),
    h('section', { class: 'card' }, h('h2', { text: '書き出し' }),
      h('button', { type: 'button', id: 'btn-export-draft', onclick: () => { download(`${fileBase(p)}_draft.html`, exportHtml(state.project, 'draft').html, 'text/html'); toast('社内確認用ドラフトを書き出しました（公開不可）'); } }, '社内確認用 draft'),
      h('p', { class: 'small muted', text: '役割・参照ID・停止条件をページ上に表示します。' }),
      h('button', { type: 'button', id: 'btn-export-review', class: 'primary', disabled: !review.html, onclick: () => { const r = exportHtml(state.project, 'review'); if (r.html) { download(`${fileBase(p)}_review.html`, r.html, 'text/html'); toast('レビュー用HTMLを書き出しました（noindex・デモ表示つき）'); } } }, 'レビュー用 HTML'),
      review.html ? null : h('ul', { class: 'small ng', id: 'review-blockers' }, ...review.report.blockers.map((b) => h('li', { text: b }))),
      h('button', { type: 'button', id: 'btn-export-commercial', disabled: !g.commercialReady.ok, onclick: () => { const r = exportHtml(state.project, 'commercial'); if (r.html) download(`${fileBase(p)}.html`, r.html, 'text/html'); } }, '実販売用 HTML'),
      h('p', { class: 'small muted', text: g.commercialReady.ok ? '' : '実販売の公開準備が整うまで書き出せません。' }),
      review.report.removed.length ? h('p', { class: 'small', text: `出力しないセクション: ${review.report.removed.map((r) => `${ROLES[r.role].label}（${r.reason}）`).join(' / ')}` }) : null),
    h('section', { class: 'card span-all' }, h('h2', { text: '根拠（G）と検証用データ' }),
      h('p', { class: 'muted small', text: '合成・不明のデータ（例: 架空の満足度・学習日数）は、ここで検証用に確認できますが、LPの成果根拠には出しません。' }),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['主張', '種類', '出典・定義', '状態', '操作'].map((t) => h('th', { text: t })))), h('tbody', {}, ...evRows))),
      h('div', { class: 'row' },
        h('input', { type: 'text', id: 'ev-claim', placeholder: '主張', 'aria-label': '根拠の主張', maxlength: 300 }),
        h('input', { type: 'text', id: 'ev-source', placeholder: '出典', 'aria-label': '出典', maxlength: 300 }),
        sel('ev-kind', EVIDENCE_KINDS, 'service-spec', null, L.evKind), sel('ev-real', REALITY, 'unknown', null, L.reality),
        h('button', { type: 'button', id: 'btn-add-ev', onclick: () => { const c = $('#ev-claim').value.trim(); if (!c) return toast('主張を入力してください', 'error'); edit({ type: 'addEvidence', claim: c, source: $('#ev-source').value, kind: $('#ev-kind').value, reality: $('#ev-real').value }); } }, '根拠を追加'))));
}

// ---------------- 6 CTA比較 ----------------
function renderCta(p) {
  const cards = p.cta.variants.map((v) => {
    const q = applyEdit(p, { type: 'setActiveCta', id: v.id });
    const { html } = renderPage(q, { kind: 'review' });
    return h('section', { class: `card cta-card${p.cta.activeVariant === v.id ? ' active' : ''}`, 'data-variant': v.id },
      h('h3', { text: `案 ${v.id.toUpperCase()}${p.cta.activeVariant === v.id ? '（採用中）' : ''}` }),
      h('div', { class: 'row' }, h('label', { for: `cta-${v.id}-color`, text: '色' }), h('input', { id: `cta-${v.id}-color`, type: 'color', value: v.color, onchange: (e) => edit({ type: 'setCtaVariant', id: v.id, color: e.target.value }) }),
        h('label', { for: `cta-${v.id}-timing`, text: '固定CTA' }), sel(`cta-${v.id}-timing`, CTA_TIMINGS, v.timing, (e) => edit({ type: 'setCtaVariant', id: v.id, timing: e.target.value }), L.timing)),
      h('div', { class: 'row' }, h('button', { type: 'button', id: `cta-${v.id}-use`, disabled: p.cta.activeVariant === v.id, onclick: () => edit({ type: 'setActiveCta', id: v.id }) }, 'この案を採用'),
        p.cta.variants.length > 1 ? h('button', { type: 'button', class: 'danger', onclick: () => edit({ type: 'removeCtaVariant', id: v.id }) }, '削除') : null),
      previewFrame(html, { width: 400, height: 700, title: `CTA案${v.id}`, id: `cta-frame-${v.id}` }));
  });
  return h('div', {},
    h('section', { class: 'card' }, h('h2', { text: 'CTAの色・表示タイミングをプレビューで比較' }),
      h('p', { class: 'muted small', text: '同じ行動のCTAは文言・色をそろえます。比較はプレビュー上だけで、実サイトのAB配信・広告設定は行いません（未接続）。' }),
      p.cta.variants.length < 4 ? h('button', { type: 'button', id: 'btn-add-cta', onclick: () => edit({ type: 'addCtaVariant' }) }, '案を追加') : null),
    h('div', { class: 'cta-grid' }, ...cards));
}

// ---------------- 7 LPO ----------------
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(2)}%`);
function renderLpo(p) {
  const a = analyzeLpo(p);
  const loader = h('div', { class: 'row' },
    h('button', { type: 'button', id: 'btn-lpo-seed', onclick: async () => { try { if (edit({ type: 'setDataset', value: JSON.parse(await seedText('dataset')) })) toast('架空データを読み込みました'); } catch (e) { toast(e.message, 'error'); } } }, '架空データを読み込む'));
  const conn = h('p', { class: 'small', id: 'lpo-connections' }, h('strong', { text: '未接続: ' }), Object.values(a.connections).map((c) => c.label).join(' / '));
  if (!a.ok) return h('section', { class: 'card' }, h('h2', { text: 'LPO' }), conn, h('p', { text: a.message }), loader);
  const exps = a.analyses.map((an) => h('section', { class: 'card exp' },
    h('h3', { text: an.name }), h('p', { class: 'small', text: `期間 ${an.period} / 分母 ${an.unit} / CV定義: ${an.conversionDefinition} / 計測: ${an.measurement}` }),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['案', '分母', 'CTAクリック', 'CV', 'CV率', '95%CI'].map((t) => h('th', { text: t })))),
      h('tbody', {}, ...an.rows.map((r) => h('tr', {}, h('td', { text: r.name }), h('td', { text: r.visitors ?? '欠損' }), h('td', { text: r.ctaClicks ?? '—' }), h('td', { text: r.conversions ?? '欠損' }), h('td', { text: pct(r.rate) }), h('td', { text: r.ci ? `${pct(r.ci[0])}〜${pct(r.ci[1])}` : '—' })))))),
    an.comparisons.length ? h('ul', { class: 'verdicts' }, ...an.comparisons.map((c) => h('li', { class: `v-${c.verdict}` }, h('strong', { text: `${c.variant}: ${c.label}` }), h('ul', {}, ...c.reasons.map((r) => h('li', { text: r })))))) : h('p', { class: 'small', text: '比較対象の案がありません。' })));
  const hyps = a.hypotheses.map((x) => h('article', { class: 'card hyp', 'data-h': x.id },
    h('h3', {}, h('span', { class: `prio p-${x.priority.level}`, text: `優先度 ${x.priority.level}` }), ` ${x.title}`),
    h('h4', { text: '観測・理由' }), h('ul', {}, ...x.basis.map((b) => h('li', { text: b }))),
    h('h4', { text: '仮説（推測）' }), h('p', { text: x.hypothesis }), h('h4', { text: '評価指標' }), h('p', { text: x.metric }),
    x.guardrails.length ? [h('h4', { text: 'guardrail' }), h('ul', {}, ...x.guardrails.map((g) => h('li', { text: g })))] : null,
    h('h4', { text: '停止条件' }), h('ul', {}, ...x.stopConditions.map((g) => h('li', { text: g }))), h('p', { class: 'warn small', text: x.caution })));
  return h('div', {}, h('div', { class: 'fiction-banner', role: 'note', id: 'lpo-banner', text: `⚠ ${a.banner}` }),
    h('section', { class: 'card' }, h('h2', { text: 'LPO（観測と推測を分けて表示）' }), conn, loader),
    h('h2', { class: 'sec-title', text: '観測（架空集計）' }), ...exps,
    h('section', { class: 'card' }, h('h3', { text: '期間をまたぐ比較の前提' }), h('ul', { class: 'small' }, ...a.crossPeriod.map((c) => h('li', { class: c.comparable ? '' : 'ng', text: `${c.a} × ${c.b}: ${c.comparable ? `定義一致・期間重複なし（注意: ${c.cautions.join(' / ')}）` : `比較しない — ${c.reasons.join(' / ')}`}` })))),
    h('h2', { class: 'sec-title', text: '仮説と検証計画（推測・優先順）' }), ...hyps);
}

// ---------------- 8 生成 ----------------
function renderGen(p) {
  const s = p.sections.find((x) => x.id === state.selected) || p.sections[0];
  const prompt = buildPrompt(p, state.genMode, { angleId: p.chosenAngleId, sectionId: s?.id });
  const r = state.lastIngest;
  return h('div', { class: 'grid-2' },
    h('section', { class: 'card span-all' }, h('h2', { text: '生成経路' }),
      h('ul', { class: 'plain' },
        h('li', {}, h('strong', { text: ADAPTERS.skeleton.label }), ' — 構成の骨組みを置くだけ。文章は書きません。'),
        h('li', {}, h('strong', { text: ADAPTERS['claude-code'].label }), ' — ブラウザからは未接続。下の指示を Claude Code に渡し、返った JSON を貼り付けて取り込みます（CLI: node cli.mjs prompt / ingest）。新規APIキー・外部APIは使いません。'))),
    h('section', { class: 'card' }, h('h2', { text: '① 指示を作る' }),
      h('div', { class: 'row', role: 'radiogroup', 'aria-label': '生成モード' }, ...[['full', 'LP全体'], ['reangle', '訴求変更（依存セクション）'], ['section', 'このセクションだけ']].map(([m, t]) => h('label', { class: `mode${state.genMode === m ? ' on' : ''}` }, h('input', { type: 'radio', name: 'gmode', id: `gmode-${m}`, checked: state.genMode === m, onchange: () => { state.genMode = m; render(); } }), t))),
      h('textarea', { id: 'gen-prompt', rows: 18, readonly: true, value: prompt, 'aria-label': '生成指示' }),
      h('button', { type: 'button', id: 'btn-copy-prompt', onclick: async () => { try { await navigator.clipboard.writeText(prompt); toast('コピーしました'); } catch { $('#gen-prompt').select(); toast('選択しました。Ctrl+C でコピーしてください'); } } }, '指示をコピー')),
    h('section', { class: 'card' }, h('h2', { text: '② Claude Code の JSON を取り込む' }),
      h('p', { class: 'small', text: '取り込んだインサイトは仮説、セクションは未承認、根拠は未検証になります。HTML・URLを含むフィールドは除外し、停止条件を表示します。' }),
      h('textarea', { id: 'gen-response', rows: 12, 'aria-label': '生成JSON' }),
      h('button', { type: 'button', id: 'btn-ingest', class: 'primary', onclick: () => {
        const res = ingestGenerated(state.project, $('#gen-response').value, { mode: state.genMode, sectionId: s?.id });
        state.lastIngest = res.report;
        if (res.ok) { commit(res.project); toast('取り込みました（未承認）'); } else { toast(`取り込めません: ${res.report.errors[0]}`, 'error'); render(); }
      } }, '検証して取り込む'),
      r ? h('div', { class: 'small', id: 'ingest-report' }, ...['errors', 'rejected', 'warnings', 'added'].flatMap((k) => r[k].map((m) => h('div', { class: `rep-${k}`, text: `${{ errors: 'エラー', rejected: '除外', warnings: '警告', added: '追加' }[k]}: ${m}` }))), ...(r.issues || []).filter((x) => x.level !== 'info').map((x) => h('div', { class: `rep-${x.level}`, text: `${L.level[x.level]}: ${x.message}` }))) : null));
}

// ---------------- render ----------------
function render() {
  const p = state.project;
  if (!p) return;
  const focusId = document.activeElement?.id || null;
  const scrollY = window.scrollY;
  $('#project-name').value = p.name;
  $('#btn-undo').disabled = !state.undo.length;
  $('#btn-redo').disabled = !state.redo.length;
  $('#ai-status').title = 'ブラウザから推論APIは呼びません。骨組み（ルールベース）と、Claude Code との prompt→JSON 受け渡しだけが動きます。';
  document.querySelectorAll('[role=tab]').forEach((t) => { const on = t.dataset.tab === state.tab; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; });
  const panel = $('#panel');
  panel.setAttribute('aria-labelledby', `tab-${state.tab}`);
  const view = { inputs: renderInputs, insight: renderInsight, plan: renderPlan, design: renderDesign, export: renderExport, cta: renderCta, lpo: renderLpo, gen: renderGen }[state.tab](p);
  panel.replaceChildren(view);
  if (focusId) { const el = document.getElementById(focusId); if (el && el !== document.activeElement) el.focus({ preventScroll: true }); }
  window.scrollTo(0, scrollY);
  storageSet(UI_KEY, JSON.stringify({ tab: state.tab, selected: state.selected, preview: state.preview }));
}

function bindChrome() {
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-save').addEventListener('click', () => { download(`${fileBase(state.project)}.lpstudio.json`, serializeProject({ ...state.project, schemaVersion: SCHEMA_VERSION }), 'application/json'); toast('project JSON を保存しました'); });
  $('#file-load').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast('ファイルが大きすぎます（2MBまで）', 'error'); return; }
    loadJsonText(await f.text(), f.name);
    e.target.value = '';
  });
  $('#btn-load').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file-load').click(); } });
  $('#seed-pick').addEventListener('change', async (e) => { const v = e.target.value; e.target.value = ''; if (!v) return; try { state.selected = null; commit(await loadSeed(v)); toast('架空seedを開きました'); } catch (err) { toast(err.message, 'error'); } });
  $('#btn-new').addEventListener('click', () => { state.selected = null; commit(emptyProject()); toast('新規プロジェクト（入力・台帳から始めてください）'); setTab('inputs'); });
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
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  });
}

async function boot() {
  bindChrome();
  const ui = (() => { try { return JSON.parse(storageGet(UI_KEY) || '{}'); } catch { return {}; } })();
  if (ui.selected) state.selected = ui.selected;
  if (ui.preview && typeof ui.preview === 'object') state.preview = { ...state.preview, ...ui.preview, nonce: 0 };
  const saved = storageGet(AUTOSAVE_KEY);
  const restored = saved ? parseProjectJson(saved) : null;
  if (restored && restored.ok) { state.project = restored.project; toast('前回の編集を復元しました（再開）'); } else {
    try { state.project = await loadSeed('michishirube'); } catch { state.project = emptyProject(); }
    if (saved) toast('前回の保存データが読めなかったため架空seedで開きました', 'error');
  }
  const hashTab = location.hash.slice(1);
  state.tab = TABS.includes(hashTab) ? hashTab : (TABS.includes(ui.tab) ? ui.tab : 'inputs');
  history.replaceState({ tab: state.tab }, '', `#${state.tab}`);
  render();
  document.body.dataset.ready = '1';
}
boot();
