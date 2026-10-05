// エビデンス / claim validation。
// fail-closed の補助: 検出された主張は、そのセクションが claimRefs で指す verified evidence に
// 同じ数値・語が含まれていなければ「未解決」。safe export は未解決フィールドを出さない。

import { BRIEF_KEYS, BRIEF_LABELS, SECTION_CATALOG } from './sections.js';

// 参考LP固有のオファー・実績値。別ブランドへの転用を止める。
export const REFERENCE_DENYLIST = [
  '3日間', '三日間', '月100人', '100人限定', '先着100', '受講生1140', '1140人', '1,140人', '1140名', '1,140名',
];

const PATTERNS = [
  { category: 'number', label: '数値の主張', re: /[0-9０-９][0-9０-９,，.．]*\s*(?:万|億)?\s*(?:人|名|社|件|%|％|倍|円|年|ヶ月|か月|カ月|日間|日|時間|分|位|回|点|校|店舗|都道府県)/g },
  { category: 'superlative', label: '最上級・比較', re: /(No\.?\s?1|ナンバーワン|日本一|業界初|業界最|世界初|最高|最強|最安|唯一|圧倒的|他社より|どこよりも)/gi },
  { category: 'guarantee', label: '保証・断定', re: /(保証|絶対|必ず|確実に|100%|１００％|誰でも|リスクなし|ノーリスク|失敗しない|返金)/g },
  { category: 'urgency', label: '煽り・限定', re: /(今だけ|残りわずか|期間限定|限定|先着|締切間近|急いで|最後のチャンス|今すぐ)/g },
  { category: 'authority', label: '権威', re: /(医師|専門家|教授|監修|推奨|認定|受賞|公式|メディア掲載|特許)/g },
  { category: 'testimonial', label: '推薦・お客様の声', re: /(お客様の声|受講生の声|体験談|口コミ|満足度|推薦|喜びの声)/g },
  { category: 'offer', label: 'オファー・価格', re: /(無料|0円|０円|割引|半額|特典|通常価格|定価|キャンペーン|オフ\b|OFF)/gi },
];

const PHARMA = { category: 'pharma', label: '薬機法（効能効果）', re: /(治る|治す|治療|改善する|痩せる|やせる|効く|効果がある|若返|シミが消え|アンチエイジング|デトックス|免疫)/g };

export function normalize(text) {
  return String(text ?? '').normalize('NFKC').replace(/[\s,，]/g, '');
}

export function detectClaims(text, category = 'general') {
  const s = String(text ?? '');
  const found = [];
  const pats = ['health', 'beauty'].includes(category) ? [...PATTERNS, PHARMA] : PATTERNS;
  for (const p of pats) {
    for (const m of s.matchAll(p.re)) {
      found.push({ category: p.category, label: p.label, match: m[0], severity: p.category === 'pharma' ? 'block' : 'needs-evidence' });
    }
  }
  const norm = normalize(s);
  for (const d of REFERENCE_DENYLIST) {
    if (norm.includes(normalize(d))) {
      found.push({ category: 'reference', label: '参考LP固有の値', match: d, severity: 'block' });
    }
  }
  return found;
}

export const PLACEHOLDER_RE = /【(?:要記入|未入力|不明な差込)[^】]*】/;

const TOKEN_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/**
 * {{key}} をブリーフ値に置換。confirmed 以外は未解決として返す。
 * mode: 'draft' は値を入れて未確認を記録 / 'wf' はプレースホルダ表示 / 'safe' は未確認を記録（呼び出し側で除外）
 */
export function resolveTokens(text, brief) {
  const unresolved = [];
  const out = String(text ?? '').replace(TOKEN_RE, (all, key) => {
    if (!BRIEF_KEYS.includes(key)) { unresolved.push({ key, reason: 'unknown' }); return `【不明な差込: ${key}】`; }
    const f = brief[key];
    if (!f || f.status === 'missing' || !String(f.value).trim()) {
      unresolved.push({ key, reason: 'missing' });
      return `【未入力: ${BRIEF_LABELS[key]}】`;
    }
    if (f.status !== 'confirmed') unresolved.push({ key, reason: 'unconfirmed' });
    return f.value;
  });
  return { text: out, unresolved };
}

function evidenceCovers(ev, claim) {
  const evNorm = normalize(ev.claim);
  return evNorm.includes(normalize(claim.match));
}

/**
 * 1フィールドを評価する。
 * 返り値: { text, claims:[{..., resolved, evidenceId}], unresolvedTokens, publishable }
 */
export function assessText(project, section, rawText) {
  const { text, unresolved } = resolveTokens(rawText, project.brief);
  const refs = new Set(section.claimRefs || []);
  const verifiedRefs = (project.evidence || []).filter((e) => refs.has(e.id) && e.status === 'verified');
  const claims = detectClaims(text, project.brief.category).map((c) => {
    if (c.severity === 'block') return { ...c, resolved: false, evidenceId: null };
    const ev = verifiedRefs.find((e) => evidenceCovers(e, c));
    return { ...c, resolved: !!ev, evidenceId: ev ? ev.id : null };
  });
  const placeholder = PLACEHOLDER_RE.test(text);
  const publishable = !placeholder && unresolved.length === 0 && claims.every((c) => c.resolved);
  return { text, claims, unresolvedTokens: unresolved, placeholder, publishable };
}

/** プロジェクト全体の監査。UI の警告一覧と export レポートの元。 */
export function auditProject(project) {
  const issues = [];
  const brief = project.brief;
  const category = brief.category;
  // ブリーフ
  for (const key of BRIEF_KEYS) {
    const f = brief[key];
    if (f.status === 'missing' || !f.value.trim()) issues.push({ scope: 'brief', key, level: 'missing', message: `${BRIEF_LABELS[key]} が未入力` });
    else if (f.status === 'unconfirmed') issues.push({ scope: 'brief', key, level: 'unconfirmed', message: `${BRIEF_LABELS[key]} が未確定（公開HTMLには出しません）` });
    for (const c of detectClaims(f.value, category)) {
      if (c.category === 'reference') issues.push({ scope: 'brief', key, level: 'block', message: `${BRIEF_LABELS[key]}: 参考LP固有の値「${c.match}」。この事業で実際に決まった条件か確認してください` });
    }
  }
  // 根拠
  for (const e of project.evidence) {
    if (e.status !== 'verified') issues.push({ scope: 'evidence', key: e.id, level: 'unverified', message: `根拠「${e.claim.slice(0, 40)}」は未検証（公開HTMLには出しません）` });
  }
  // セクション
  for (const s of project.sections) {
    const meta = SECTION_CATALOG[s.type];
    if (!s.approved) issues.push({ scope: 'section', key: s.id, level: 'unapproved', message: `${meta.label}: 未承認（safe export に出ません）` });
    if (s.needsReview) issues.push({ scope: 'section', key: s.id, level: 'review', message: `${meta.label}: 訴求変更後の整合を要確認` });
    for (const [field, value] of fieldEntries(s)) {
      const a = assessText(project, s, value);
      for (const c of a.claims.filter((x) => !x.resolved)) {
        issues.push({ scope: 'section', key: s.id, field, level: c.severity === 'block' ? 'block' : 'claim', message: `${meta.label}/${field}: ${c.label}「${c.match}」に検証済みの根拠がありません` });
      }
      if (a.placeholder && !a.unresolvedTokens.length) issues.push({ scope: 'section', key: s.id, field, level: 'placeholder', message: `${meta.label}/${field}: 【要記入】が残っています` });
      for (const t of a.unresolvedTokens) {
        issues.push({ scope: 'section', key: s.id, field, level: 'token', message: `${meta.label}/${field}: ${BRIEF_LABELS[t.key] || t.key} が${t.reason === 'unconfirmed' ? '未確定' : '未入力'}` });
      }
    }
  }
  return issues;
}

export function fieldEntries(section) {
  const f = section.fields || {};
  const out = [];
  for (const k of ['heading', 'lead', 'body', 'note']) if (f[k]) out.push([k, f[k]]);
  for (const k of ['items', 'itemsAlt']) (f[k] || []).forEach((v, i) => out.push([`${k}[${i}]`, v]));
  return out;
}
