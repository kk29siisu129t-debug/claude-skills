// 編集上の検査と公開判定（v2）。
// 公開判定は2段:
//   reviewPreview   … レビュー用に安全に描画できる（重大な停止条件が無い。CTA は実行されない）
//   commercialReady … 実販売向けに公開準備が整っている（live・条件確定・全承認・実在の根拠）
// 「verified」や seed の有無だけで事実性・公開可否を決めない。

import { refIndex } from './schema.js';
import { ROLES } from './roles.js';
import { canon, containsToken, detectClaims, PLACEHOLDER_RE } from './claims.js';
import { headingPhrases } from './segment.js';
import { safeUrl } from './util.js';

const TOKEN_RE = /\{\{[^}]*\}\}/;
const NUMBER_RE = /[0-9０-９][0-9０-９.,，．]*\s*(?:万|億)?(?:人|名|社|件|%|％|割|倍|円|年|ヶ月|か月|カ月|日間|日|時間|分|位|回|点)/g;
const DURATION = /(?:分|時間|日間|か月|ヶ月|週間)/;
const DURATION_Q = /[0-9０-９〇一二三四五六七八九十百]+\s*(?:分|時間|日間|か月|ヶ月|週間)/;
const COUNT_Q = /[0-9０-９〇一二三四五六七八九十百]+\s*(?:人|名|ユーザー|アカウント|席)/;
const PRICE = /(?:円|無料|0円|ゼロ円|割引|半額|税込|税抜)/;
const COUNT = /(?:人|名|ユーザー|アカウント|席)/;
const ATTR_TYPES = [
  { re: /(所要時間|時間|期間|日数)$/, type: 'duration', test: DURATION_Q },
  { re: /(料金|価格|費用|金額|販売価格)$/, type: 'price', test: PRICE },
  { re: /(人数|上限|ユーザー数上限|ユーザー数)$/, type: 'count', test: COUNT_Q },
];
const SYNONYMS = [['面談', '相談', 'カウンセリング', '打ち合わせ'], ['料金', '価格', '費用', '金額'], ['申込', '申し込み', '予約', '登録']];

function synonymsOf(word) {
  const g = SYNONYMS.find((s) => s.includes(word));
  return g || [word];
}

export function clauses(text) {
  return String(text ?? '').split(/[、。！？!?\n]/).map((s) => s.trim()).filter(Boolean);
}

/** 公開用コピーを、参照IDつきで列挙する */
export function collectTexts(project) {
  const out = [];
  const d = project.display;
  for (const k of ['brandName', 'serviceDescriptor', 'audienceLabel']) if (d[k]) out.push({ sectionId: null, role: 'display', field: `display.${k}`, text: d[k], refs: [] });
  for (const s of project.sections) {
    const base = s.sourceRefs || [];
    const itemRefs = s.items.flatMap((i) => i.sourceRefs || []);
    const push = (field, text, refs = []) => { if (text && String(text).trim()) out.push({ sectionId: s.id, role: s.role, field, text: String(text), refs: [...new Set([...refs, ...base])] }); };
    push('heading', s.heading, [...itemRefs, ...(s.visual?.sourceRefs || [])]); // 見出しは項目・図の参照もあわせて判断
    push('body', s.body);
    push('note', s.note);
    s.items.forEach((it, i) => { push(`items[${i}].heading`, it.heading, it.sourceRefs); push(`items[${i}].body`, it.body, it.sourceRefs); });
    if (s.visual) {
      const v = s.visual;
      for (const k of ['title', 'task', 'from', 'to', 'review', 'note']) push(`visual.${k}`, v[k], v.sourceRefs);
      (v.rows || []).forEach((row, i) => push(`visual.rows[${i}]`, row.join(' / '), v.sourceRefs));
    }
    if (s.cta) push('cta.label', s.cta.label);
    if (s.commercialPreview) { push('commercialPreview.label', s.commercialPreview.label); push('commercialPreview.note', s.commercialPreview.note); }
  }
  return out;
}

function unknownAttributes(project) {
  const res = [];
  for (const l of project.ledger.filter((x) => x.kind === 'unknown')) {
    const t = l.text.trim();
    for (const a of ATTR_TYPES) {
      const m = t.match(a.re);
      if (!m) continue;
      const subject = t.slice(0, m.index).replace(/の$/, '').trim();
      res.push({ id: l.id, text: t, subject, type: a.type, test: a.test });
      break;
    }
  }
  return res;
}

const ISSUE = (level, code, message, where = {}) => ({ level, code, message, ...where });

/**
 * 編集上の検査。level: stop（重大な停止条件）/ warn（要確認）/ info
 */
export function checkProject(project) {
  const issues = [];
  const idx = refIndex(project);
  const texts = collectTexts(project);
  const unknowns = unknownAttributes(project);
  const doNot = (project.inputs.doNotAssert || []).filter(Boolean);
  const quantities = new Map(); // subject|type → Set(values)

  for (const t of texts) {
    const where = { sectionId: t.sectionId, field: t.field };
    const label = t.role === 'display' ? `表示名/${t.field.slice(8)}` : `${ROLES[t.role]?.label || t.role}/${t.field}`;
    if (TOKEN_RE.test(t.text)) issues.push(ISSUE('stop', 'token', `${label}: 未展開の差込「${t.text.match(TOKEN_RE)[0]}」があります`, where));
    if (PLACEHOLDER_RE.test(t.text)) issues.push(ISSUE('stop', 'placeholder', `${label}: 【要記入】が残っています`, where));
    const refTexts = [];
    for (const r of t.refs) {
      const hit = idx.get(r);
      if (!hit) { issues.push(ISSUE('stop', 'ref-missing', `${label}: 参照ID「${r}」が台帳にありません`, where)); continue; }
      if (hit.type === 'ledger' && hit.kind === 'unknown') issues.push(ISSUE('stop', 'unknown-as-fact', `${label}: 不明な項目「${hit.text}」を根拠にしています`, where));
      if (hit.type === 'evidence' && hit.kind === 'outcome-aggregate' && hit.reality !== 'real') issues.push(ISSUE('stop', 'synthetic-outcome', `${label}: 合成・未確認の成果データ「${hit.text.slice(0, 30)}」を根拠にしています（成果としては出せません）`, where));
      refTexts.push(hit.text);
    }
    const refJoined = refTexts.join('\n');
    // 数値は参照先にあること
    const ct = canon(t.text);
    for (const m of ct.matchAll(NUMBER_RE)) {
      const tok = m[0];
      if (ct[m.index - 1] === '月' || /^[0-9]+月/.test(ct.slice(m.index))) continue; // 日付（10月8日）は数量の主張ではない
      if (!refTexts.some((rt) => containsToken(rt, tok))) issues.push(ISSUE('stop', 'number-unsupported', `${label}: 数値「${tok}」が参照した事実にありません`, where));
    }
    // 未確定の条件を別の数値で埋めていないか（例: 学習の15分を面談の15分にする）
    for (const c of clauses(t.text)) {
      const cc = canon(c);
      for (const u of unknowns) {
        const subjHit = u.subject ? synonymsOf(u.subject).some((w) => cc.includes(canon(w))) : true;
        if (subjHit && u.test.test(cc)) {
          issues.push(ISSUE('stop', 'unknown-filled', `${label}: 「${u.text}」は未確定なのに「${c}」と書いています（別の数値や条件で埋めない）`, where));
        }
      }
      // 同じ対象に別々の数値が付いていないか
      for (const m of cc.matchAll(NUMBER_RE)) {
        const words = cc.replace(m[0], ' ').match(/[\p{Script=Han}\p{Script=Katakana}ー]{2,}/gu) || [];
        const type = DURATION.test(m[0]) ? 'duration' : PRICE.test(m[0]) ? 'price' : COUNT.test(m[0]) ? 'count' : 'other';
        for (const w of words) {
          const key = `${w}|${type}`;
          if (!quantities.has(key)) quantities.set(key, new Map());
          quantities.get(key).set(m[0], label);
        }
      }
    }
    // 根拠の要る主張（最上級・保証・煽り・権威・推薦・オファー・薬機法・参考LP固有値）
    for (const c of detectClaims(t.text, project.display.category)) {
      if (c.category === 'number') continue;
      if (c.severity === 'block') { issues.push(ISSUE('stop', 'claim-blocked', `${label}: ${c.label}「${c.match}」は出せません`, where)); continue; }
      if (!containsToken(refJoined, c.match)) issues.push(ISSUE('stop', 'claim-unsupported', `${label}: ${c.label}「${c.match}」に裏づけがありません`, where));
      if (c.category === 'testimonial' && !t.refs.some((r) => idx.get(r)?.type === 'quote')) issues.push(ISSUE('stop', 'invented-quote', `${label}: 顧客の原文が無いのに口コミ・声のような表現「${c.match}」があります`, where));
    }
    for (const d of doNot) if (canon(t.text).includes(canon(d))) issues.push(ISSUE('stop', 'do-not-assert', `${label}: 言わないと決めた「${d}」が入っています`, where));
    // 入力文の貼り付け
    for (const l of project.ledger) {
      if (l.text.length >= 24 && canon(t.text).includes(canon(l.text))) issues.push(ISSUE('warn', 'pasted-input', `${label}: 台帳の文「${l.text.slice(0, 20)}…」をそのまま貼り付けています。読者向けに書き直してください`, where));
    }
    if (t.field === 'body' && !/[。！？」）]$/.test(t.text.trim())) issues.push(ISSUE('warn', 'no-period', `${label}: 文末に句点がありません`, where));
    if (!t.refs.length && ['body', 'heading'].includes(t.field) && !['faq'].includes(t.role)) issues.push(ISSUE('warn', 'no-refs', `${label}: 参照ID（sourceRefs）がありません`, where));
  }
  for (const [key, vals] of quantities) {
    const [word, type] = key.split('|');
    if (type !== 'other' && vals.size > 1) issues.push(ISSUE('stop', 'conflict', `「${word}」に異なる${type === 'duration' ? '時間' : type === 'price' ? '料金' : '数'}が書かれています: ${[...vals.keys()].join(' / ')}`));
  }

  // 構成
  const hero = project.sections.find((s) => s.role === 'hero');
  if (!hero) issues.push(ISSUE('stop', 'no-hero', 'FV（hero）がありません'));
  if (!project.sections.some((s) => s.role === 'closing')) issues.push(ISSUE('warn', 'no-closing', '締め（closing）がありません'));
  for (const s of project.sections) {
    const hasContent = s.body.trim() || s.items.some((i) => i.heading || i.body) || s.visual;
    if (!hasContent && s.role !== 'proof') issues.push(ISSUE('warn', 'empty-section', `${ROLES[s.role].label}: 本文が無いため出力しません（見出し・CTAだけを残さない）`, { sectionId: s.id }));
    if (s.heading) {
      const hp = headingPhrases(s.heading, s.headingPhrases);
      if (hp.source === 'fallback-mismatch') issues.push(ISSUE('warn', 'phrases-mismatch', `${ROLES[s.role].label}: 改行候補が見出しと一致しないため自動で区切ります`, { sectionId: s.id }));
      const limit = s.role === 'hero' ? 26 : 32;
      if ([...s.heading].length > limit) issues.push(ISSUE('warn', 'heading-long', `${ROLES[s.role].label}: 見出しが${[...s.heading].length}字です（目安${limit}字以内）`, { sectionId: s.id }));
    }
    if (s.role === 'proof') {
      const ev = s.sourceRefs.map((r) => idx.get(r)).filter(Boolean);
      if (!ev.some((x) => x.type === 'evidence' && x.reality === 'real' && x.item.status === 'verified')) issues.push(ISSUE('warn', 'proof-empty', '根拠セクションに、実在・検証済みの根拠がありません（出力しません）', { sectionId: s.id }));
    }
  }
  if (hero) {
    const heroText = [hero.heading, hero.body].join('\n');
    const d = project.display;
    if (d.brandName && canon(hero.heading).includes(canon(d.brandName))) issues.push(ISSUE('warn', 'brand-in-headline', 'FV見出しにブランド名が入っています（見出しは読者の場面と変化に使う）', { sectionId: hero.id }));
    if (d.audienceLabel && heroText.includes(d.audienceLabel)) issues.push(ISSUE('warn', 'repeat-audience', 'FVで対象者の呼びかけを繰り返しています（呼びかけは1回）', { sectionId: hero.id }));
  }
  if (!project.chosenAngleId) issues.push(ISSUE('warn', 'no-angle', '訴求が選ばれていません'));
  if (project.display.demoMode !== 'live' && !project.display.demoNotice.trim()) issues.push(ISSUE('stop', 'demo-unlabelled', 'デモ・試作の表示がありません'));
  for (const ins of project.insights) if (ins.status === 'hypothesis') issues.push(ISSUE('info', 'hypothesis', `インサイト「${ins.statement.slice(0, 30)}…」は仮説です（顧客の原文・観察で未確認）`));
  return issues;
}

const EXAMPLE_HOST = /(^|\.)example\.(com|org|net)$/i;

export function gates(project, issues = checkProject(project)) {
  const stops = issues.filter((i) => i.level === 'stop');
  const review = { ok: stops.length === 0, reasons: stops.map((s) => s.message) };
  const reasons = [];
  const d = project.display;
  const a = project.inputs.action;
  if (d.demoMode !== 'live') reasons.push(d.demoMode === 'synthetic-demo' ? '架空サービスのデモです' : '試作です');
  if (!review.ok) reasons.push('重大な停止条件があります');
  if (a.behavior === 'none') reasons.push('CTAで何が起きるか（申込・予約など）が決まっていません');
  const labels = { offer: 'オファー', price: '料金', duration: '所要時間', method: '実施方法', url: 'リンク先' };
  for (const [k, label] of Object.entries(labels)) if (!a.confirmed[k]) reasons.push(`${label}が未確定です`);
  const url = safeUrl(a.url);
  if (!url || !url.startsWith('https:')) reasons.push('リンク先が https の確定URLではありません');
  else if (EXAMPLE_HOST.test(new URL(url).hostname)) reasons.push('リンク先が example ドメイン（説明用）です');
  for (const l of project.ledger.filter((x) => x.kind === 'unknown')) reasons.push(`未確定: ${l.text}`);
  if (project.ledger.some((l) => l.reality !== 'real') || project.evidence.some((e) => e.reality !== 'real')) reasons.push('台帳・根拠に実在でない（合成・不明）項目があります');
  for (const s of project.sections) if (!s.approved) reasons.push(`未承認: ${ROLES[s.role].label}`);
  const v = project.cta.variants.find((x) => x.id === project.cta.activeVariant);
  if (v && v.timing !== 'spec') reasons.push('固定CTAの表示タイミングが比較用の案です（公開は仕様どおりの案だけ）');
  return { reviewPreview: review, commercialReady: { ok: reasons.length === 0, reasons: [...new Set(reasons)] } };
}
