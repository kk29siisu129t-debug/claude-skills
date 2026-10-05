// 生成アダプタ。
// - template: ブリーフ値を決まった型に差し込む「決定的テンプレート」。AI生成ではない。
// - claude-code: 生成指示（prompt）を出力 → Claude Code セッションが JSON を書く → ingest で検証して取り込む。
//   ブラウザからは推論APIを呼ばない（未接続）。新規APIキー・外部連携はしない。
// どちらの経路でも、生成物は approved:false、根拠は unverified に強制する（昇格は人の操作だけ）。

import { SECTION_CATALOG, SECTION_TYPES, DEFAULT_ORDER, BRIEF_KEYS, BRIEF_LABELS } from './sections.js';
import { validateShape } from './schema.js';
import { detectClaims, containsToken, REFERENCE_DENYLIST } from './claims.js';
import { clone, makeId } from './util.js';

export const ADAPTERS = {
  template: { id: 'template', label: 'テンプレート下書き（AI生成ではない）', connected: true },
  'claude-code': { id: 'claude-code', label: 'Claude Code 生成（prompt→JSON受け渡し）', connected: false },
};

const TODO = (what) => `【要記入: ${what}】`;

const TEMPLATES = {
  fv: () => ({ heading: '{{promise}}', lead: '{{audience}}のための{{product}}', body: '', items: [], itemsAlt: [], note: '' }),
  concept_video: () => ({ heading: 'コンセプト', lead: '', body: TODO('動画の説明。素材が無ければこのセクションを外す'), items: [], itemsAlt: [], note: '' }),
  empathy: () => ({ heading: 'こんな状態が続いていませんか', lead: '', body: '{{problem}}', items: [TODO('対象者が実際に口にした悩み（ヒアリングの言葉で）')], itemsAlt: [], note: '' }),
  reframe: () => ({ heading: 'うまくいかない理由は、別のところにあるかもしれません', lead: '', body: TODO('従来のやり方と、その限界（事実ベースで）'), items: [`これまで: ${TODO('従来の方法')}`], itemsAlt: [`{{product}}: ${TODO('違い')}`], note: '' }),
  origin: () => ({ heading: '{{product}}が生まれた理由', lead: '', body: TODO('開発の経緯と差別化（確認できる事実のみ）'), items: [], itemsAlt: [], note: '' }),
  steps: () => ({ heading: '申込後の流れ', lead: '', body: '', items: ['{{ctaLabel}}から申し込む', TODO('次に何が起きるか'), TODO('その後の流れ')], itemsAlt: [], note: '' }),
  scope: () => ({ heading: '提供範囲', lead: '', body: '', items: ['{{offer}}'], itemsAlt: [TODO('含まないもの')], note: '' }),
  recommit: () => ({ heading: '{{promise}}', lead: 'ここまで読んで、自分に当てはまると感じたら。', body: '', items: [], itemsAlt: [], note: '' }),
  proof: () => ({ heading: '根拠', lead: '確認できた事実と出典だけを載せています。', body: '', items: [], itemsAlt: [], note: '' }),
  price_reason: () => ({ heading: '価格・条件について', lead: '{{price}}', body: TODO('この価格・条件にしている理由'), items: [], itemsAlt: [], note: '' }),
  fit: () => ({ heading: '向いている人 / 向いていない人', lead: '', body: '', items: ['{{audience}}'], itemsAlt: [TODO('向いていない人')], note: '' }),
  closing: () => ({ heading: '{{promise}}', lead: '', body: TODO('行動した後の状態（約束できる範囲で）'), items: [], itemsAlt: [], note: '' }),
  footer: () => ({ heading: '', lead: '', body: '運営: {{operator}}', items: [], itemsAlt: [], note: '' }),
};

const ANGLE_TYPES = ['fv', 'recommit', 'closing'];

export function templateSection(type, project) {
  return {
    id: makeId(type.replace('_', '')),
    type,
    approved: false,
    approvedHash: '',
    needsReview: false,
    origin: 'template',
    fields: TEMPLATES[type](),
    claimRefs: type === 'proof' ? project.evidence.map((e) => e.id) : [],
  };
}

/** モード1: LP全体作成（template） */
export function generateAllTemplate(project, { includeVideo = false } = {}) {
  const p = clone(project);
  const order = includeVideo ? ['fv', 'concept_video', ...DEFAULT_ORDER.slice(1)] : DEFAULT_ORDER;
  p.sections = order.map((t) => templateSection(t, p));
  return p;
}

/** モード2: 訴求変更。約束する価値を差し替え、訴求系だけ作り直し、残りに要確認を立てる */
export function reangleTemplate(project, newPromise) {
  const p = clone(project);
  p.brief.promise = { value: String(newPromise).slice(0, 600), status: 'unconfirmed' };
  p.sections = p.sections.map((s) => {
    if (ANGLE_TYPES.includes(s.type)) {
      return { ...s, fields: TEMPLATES[s.type](), origin: 'template', approved: false, approvedHash: '', needsReview: false };
    }
    if (s.type === 'footer') return s;
    return { ...s, needsReview: true, approved: false, approvedHash: '' };
  });
  return p;
}

/** モード3: セクション単体の再生成（template） */
export function regenerateSectionTemplate(project, sectionId) {
  const p = clone(project);
  const i = p.sections.findIndex((s) => s.id === sectionId);
  if (i < 0) throw new Error('セクションが見つかりません');
  const s = p.sections[i];
  p.sections[i] = { ...s, fields: TEMPLATES[s.type](), origin: 'template', approved: false, approvedHash: '', needsReview: false,
    claimRefs: s.type === 'proof' ? p.evidence.map((e) => e.id) : s.claimRefs };
  return p;
}

// ---------------- claude-code アダプタ ----------------

const GENERATED_SECTION_SPEC = {
  t: 'object',
  fields: {
    type: { t: 'string', enum: SECTION_TYPES },
    fields: {
      t: 'object',
      fields: {
        heading: { t: 'string', max: 200 }, lead: { t: 'string', max: 400 }, body: { t: 'string', max: 2000 }, note: { t: 'string', max: 400 },
        items: { t: 'array', of: { t: 'string', max: 300 }, max: 12 },
        itemsAlt: { t: 'array', of: { t: 'string', max: 300 }, max: 12 },
      },
      required: [],
    },
    claimRefs: { t: 'array', of: { t: 'string', max: 40 }, max: 20 },
  },
  required: ['type', 'fields'],
};

const RESPONSE_SPEC = {
  t: 'object',
  fields: {
    generator: { t: 'string', enum: ['claude-code'] },
    mode: { t: 'string', enum: ['full', 'reangle', 'section'] },
    promise: { t: 'string', max: 600 },
    sections: { t: 'array', of: GENERATED_SECTION_SPEC, max: 20, min: 1 },
    evidenceCandidates: {
      t: 'array', max: 20,
      of: { t: 'object', fields: { claim: { t: 'string', max: 300 }, source: { t: 'string', max: 300 } }, required: ['claim', 'source'] },
    },
  },
  required: ['generator', 'mode', 'sections'],
};

/** Claude Code に渡す生成指示（Markdown）。JSON の契約と禁止事項を含む。 */
export function buildPrompt(project, mode = 'full', target = {}) {
  const lines = [];
  lines.push('# LP Studio 生成指示（Claude Code 用）', '');
  lines.push('あなたは LP の構成・コピーの**下書き**を書く。出力は下記 JSON 契約に従う JSON のみ（```json フェンス可）。');
  lines.push('この出力はツール側で schema 検証され、すべて「未承認」「根拠未検証」として取り込まれる。人が確認するまで公開されない。', '');
  lines.push('## 禁止事項（違反したフィールドは取り込み時に拒否・除外される）');
  lines.push('- ブリーフや根拠に無い数値・実績・受講者数・満足度・ランキング・受賞・メディア掲載を書かない');
  lines.push('- 推薦文・お客様の声・専門家/医師の権威づけを創作しない');
  lines.push('- 保証・断定（必ず/絶対/誰でも）、煽り（今だけ/残りわずか/限定）を書かない');
  lines.push('- 効能効果（治る/痩せる/効く 等）を書かない');
  lines.push(`- 参考LP固有の値を使わない: ${REFERENCE_DENYLIST.join(' / ')}`);
  lines.push('- ブリーフ値は {{key}} 差込で参照する（例: {{offer}}）。値を書き写さない。使えるキー: ' + BRIEF_KEYS.join(', '));
  lines.push('- 分からないこと・ヒアリングが要ることは 【要記入: 何が必要か】 と書く。埋め合わせない');
  lines.push('- HTML タグ・スクリプト・URL を書かない（プレーンテキストのみ）', '');
  lines.push('## ブリーフ（status: confirmed=確定 / unconfirmed=未確定 / missing=未入力）');
  for (const k of BRIEF_KEYS) {
    const f = project.brief[k];
    lines.push(`- ${k}（${BRIEF_LABELS[k]}）[${f.status}]: ${f.value || '（なし）'}`);
  }
  lines.push(`- category: ${project.brief.category}`, '');
  lines.push('## 根拠（id / status / 内容）。claimRefs には verified のものだけを入れる');
  if (!project.evidence.length) lines.push('- （なし）');
  for (const e of project.evidence) lines.push(`- ${e.id} [${e.status}] ${e.claim}（出典: ${e.source}）`);
  lines.push('');
  lines.push('## セクションの役割（参考構成の流れ）');
  for (const t of SECTION_TYPES) {
    const m = SECTION_CATALOG[t];
    lines.push(`- ${t}: ${m.label} — ${m.role}${m.required ? '（必須）' : '（任意）'}`);
  }
  lines.push('');
  lines.push('## 依頼');
  if (mode === 'full') {
    lines.push('LP全体の sections を上の順で書く（concept_video は素材が無いので不要）。');
  } else if (mode === 'reangle') {
    lines.push(`訴求を「${String(target.promise || '').slice(0, 200)}」に変える。promise と、fv / recommit / closing の 3 セクションだけを書く。`);
  } else {
    const s = project.sections.find((x) => x.id === target.sectionId);
    lines.push(`セクション ${s ? s.type : '(未指定)'} を 1 つだけ書き直す。現在の内容: ${s ? JSON.stringify(s.fields) : '-'}`);
  }
  lines.push('');
  lines.push('## JSON 契約');
  lines.push('```json');
  lines.push(JSON.stringify({
    generator: 'claude-code',
    mode,
    ...(mode === 'reangle' ? { promise: '新しい約束（プレーンテキスト）' } : {}),
    sections: [{ type: 'fv', fields: { heading: '', lead: '', body: '', note: '', items: [], itemsAlt: [] }, claimRefs: [] }],
    evidenceCandidates: [{ claim: '確認が必要な事実の候補', source: 'どこで確認できるか' }],
  }, null, 2));
  lines.push('```');
  return lines.join('\n');
}

function extractJson(text) {
  const s = String(text ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fence ? fence[1] : s;
}

/**
 * 生成物のフィールドを検査する。次を含むフィールドは取り込まない:
 * HTML/URL、参考LP固有値・薬機法語彙・推薦文・権威（創作禁止）、
 * 確定ブリーフにも verified 根拠にも無い数値・最上級・保証・煽り・オファー表現。
 */
function screenFields(fields, project, report, label) {
  const confirmed = BRIEF_KEYS.filter((k) => project.brief[k].status === 'confirmed').map((k) => project.brief[k].value).join('\n');
  const verified = project.evidence.filter((e) => e.status === 'verified').map((e) => e.claim).join('\n');
  const bad = (v) => {
    if (/<\s*\/?\s*[a-z!]|javascript:|https?:\/\/|www\./i.test(v)) return 'HTML/URL を含む';
    for (const c of detectClaims(v, project.brief.category)) {
      if (['reference', 'pharma', 'testimonial', 'authority'].includes(c.category)) return `${c.label}「${c.match}」`;
      if (!containsToken(confirmed, c.match) && !containsToken(verified, c.match)) return `根拠の無い${c.label}「${c.match}」`;
    }
    return null;
  };
  const out = { heading: '', lead: '', body: '', note: '', items: [], itemsAlt: [] };
  for (const k of ['heading', 'lead', 'body', 'note']) {
    const v = fields[k] || '';
    const why = v && bad(v);
    if (why) report.rejected.push(`${label}.${k}: ${why}のため拒否`);
    else out[k] = v;
  }
  for (const k of ['items', 'itemsAlt']) {
    for (const v of fields[k] || []) {
      const why = bad(v);
      if (why) report.rejected.push(`${label}.${k}: ${why}のため拒否`);
      else out[k].push(v);
    }
  }
  return out;
}

/**
 * Claude Code の出力（JSON 文字列）を検証して project に取り込む。
 * 返り値: { ok, project, report: { errors, warnings, rejected, added } }
 */
export function ingestGenerated(project, responseText, { mode, sectionId } = {}) {
  const report = { errors: [], warnings: [], rejected: [], added: [] };
  let data;
  try {
    data = JSON.parse(extractJson(responseText), (k, v) => {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new Error(`禁止キー "${k}"`);
      return v;
    });
  } catch (e) {
    report.errors.push(`JSONとして読めません: ${String(e.message).slice(0, 120)}`);
    return { ok: false, project, report };
  }
  const shape = validateShape(RESPONSE_SPEC, data, '$response');
  report.errors.push(...shape.errors);
  report.warnings.push(...shape.warnings);
  if (shape.errors.length) return { ok: false, project, report };
  const r = shape.value;
  if (mode && r.mode !== mode) {
    report.errors.push(`mode が一致しません（期待: ${mode} / 応答: ${r.mode}）`);
    return { ok: false, project, report };
  }
  const p = clone(project);
  const evIds = new Set(p.evidence.map((e) => e.id));
  const toSection = (g, keep) => {
    const refs = (g.claimRefs || []).filter((id) => {
      if (!evIds.has(id)) { report.warnings.push(`claimRefs "${id}" は存在しないため外しました`); return false; }
      return true;
    });
    return {
      id: keep?.id || makeId(g.type.replace('_', '')),
      type: g.type,
      approved: false, // 強制
      approvedHash: '',
      needsReview: false,
      origin: 'claude-code',
      fields: screenFields(g.fields, p, report, g.type),
      claimRefs: refs,
    };
  };

  if (r.mode === 'full') {
    const seen = new Set();
    p.sections = [];
    for (const g of r.sections) {
      if (seen.has(g.type)) { report.warnings.push(`${g.type} が重複しているため2つ目以降を無視しました`); continue; }
      seen.add(g.type);
      p.sections.push(toSection(g));
    }
    for (const t of SECTION_TYPES.filter((t) => SECTION_CATALOG[t].required && !seen.has(t))) {
      p.sections.push(templateSection(t, p));
      report.warnings.push(`必須セクション ${t} が無いためテンプレートで補いました（AI生成ではありません）`);
    }
    report.added.push(`${p.sections.length} セクション`);
  } else if (r.mode === 'reangle') {
    if (r.promise) p.brief.promise = { value: r.promise, status: 'unconfirmed' };
    const byType = new Map(r.sections.filter((g) => ANGLE_TYPES.includes(g.type)).map((g) => [g.type, g]));
    for (const g of r.sections) if (!ANGLE_TYPES.includes(g.type)) report.warnings.push(`訴求変更では ${g.type} は対象外のため無視しました`);
    p.sections = p.sections.map((s) => {
      if (byType.has(s.type)) return toSection(byType.get(s.type), s);
      if (s.type === 'footer') return s;
      return { ...s, needsReview: true, approved: false, approvedHash: '' };
    });
    report.added.push(`${byType.size} セクションを差し替え`);
  } else {
    const i = p.sections.findIndex((s) => s.id === sectionId);
    if (i < 0) { report.errors.push('対象セクションが見つかりません'); return { ok: false, project, report }; }
    const g = r.sections.find((x) => x.type === p.sections[i].type);
    if (!g) { report.errors.push(`応答に ${p.sections[i].type} がありません`); return { ok: false, project, report }; }
    p.sections[i] = toSection(g, p.sections[i]);
    report.added.push('1 セクションを差し替え');
  }
  for (const c of r.evidenceCandidates || []) {
    const blocked = [...detectClaims(c.claim, p.brief.category), ...detectClaims(c.source, p.brief.category)].find((x) => x.severity === 'block');
    if (blocked || /<\s*\/?\s*[a-z!]|javascript:/i.test(c.claim + c.source)) {
      report.rejected.push(`根拠候補「${c.claim.slice(0, 30)}」: ${blocked ? blocked.label : 'HTML/スクリプト'}のため拒否`);
      continue;
    }
    const id = makeId('ev');
    p.evidence.push({ id, claim: c.claim, source: c.source, sourceType: 'other', status: 'unverified', provenance: 'claude-code', verifiedBy: '', verifiedAt: '', verifiedHash: '', metricValue: null, metricUnit: '', note: '生成時の候補。人が出典を確認するまで公開されない' });
    report.added.push(`根拠候補（未検証）: ${c.claim.slice(0, 30)}`);
  }
  return { ok: true, project: p, report };
}

