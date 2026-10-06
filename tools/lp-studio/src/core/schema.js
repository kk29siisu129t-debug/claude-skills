// project JSON の schema（v2）/ v0・v1 からの移行 / validation。
// 方針: 既知のキーだけを新しいオブジェクトへコピーする（未知キーは警告して削除）。
// HTML は文字列として保持するだけで、描画時に必ず escape する。HTML import は存在しない。
//
// v2 のレイヤー（入力・仮説・公開用コピーを分ける）
//   display   表示用の名前（brandName / serviceDescriptor / audienceLabel / demoMode / demoNotice）
//   inputs    A 読者と場面 / B 既存の努力 / E 担える変化 / F 仕組み / H 行動条件 / 言ってはいけないこと
//   ledger    事実台帳（確認済み仕様・提供者の申告・顧客の観察・仮説・不明。参照ID付き）
//   quotes    C 顧客の原文（人が入れたものだけ。生成では入らない）
//   evidence  G 根拠（種類・実在/合成・適用範囲・公開同意・数値の定義）
//   insights  D インサイト仮説 / angles 訴求候補と選択
//   sections  公開用コピー（役割ごと。各主張に sourceRefs）

import { ROLE_IDS } from './roles.js';
import { safeUrl, safeColor, stripControl, sectionHash, evidenceHash, isRealDate } from './util.js';
import { metricMatches } from './claims.js';

export const SCHEMA_VERSION = 2;
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const DEMO_MODES = ['synthetic-demo', 'prototype', 'live'];
export const CATEGORIES = ['general', 'education', 'health', 'beauty', 'finance', 'employment', 'b2b-software'];
export const LEDGER_KINDS = ['verified-spec', 'provider-claim', 'customer-observation', 'customer-quote', 'hypothesis', 'unknown'];
export const REALITY = ['real', 'synthetic', 'unknown'];
export const EVIDENCE_KINDS = ['service-spec', 'real-screen', 'real-sample', 'outcome-aggregate', 'customer-quote', 'third-party', 'hypothesis', 'illustrative'];
export const EVIDENCE_STATUS = ['verified', 'unverified'];
export const PROVENANCE = ['human', 'template', 'claude-code', 'seed', 'fixture'];
export const ORIGINS = ['template', 'claude-code', 'manual', 'migrated'];
export const CONFIDENCE = ['low', 'medium', 'high'];
export const ACTION_BEHAVIORS = ['external-booking', 'external-signup', 'external-contact', 'purchase', 'none'];
export const CTA_BEHAVIORS = ['anchor'];
export const VISUAL_KINDS = ['task-card', 'flow', 'table', 'checklist'];
export const CTA_TIMINGS = ['spec', 'after-half'];
const CTA_TIMINGS_ACCEPTED = [...CTA_TIMINGS, 'always'];
export const METRIC_UNITS = ['', '人', '名', '社', '件', '%', '割', '倍', '円', '日', '日/週', '回/週', '分/日', '時間', '時間/週', '分', '回', '点', '年', 'か月', '位', '校', '店舗'];
export const FONTS = ['sans', 'serif', 'rounded'];

const str = (max, extra = {}) => ({ t: 'string', max, ...extra });
const ID = str(40, { pattern: /^[A-Za-z0-9_.-]{1,40}$/ });
const refs = { t: 'array', of: ID, max: 20 };
const strList = (max, n = 12) => ({ t: 'array', of: str(max), max: n });
const refText = { t: 'object', fields: { text: str(300), sourceRefs: refs }, required: ['text'] };

const variantSpec = {
  t: 'object',
  fields: {
    id: ID, name: str(80), expectedShare: { t: 'number', min: 0, max: 1 },
    unit: { t: 'string', enum: ['users', 'sessions', 'pageviews'] },
    conversionDefinition: str(200), measurement: str(200),
    visitors: { t: 'number', min: 0, int: true, nullable: true },
    ctaClicks: { t: 'number', min: 0, int: true, nullable: true },
    conversions: { t: 'number', min: 0, int: true, nullable: true },
  },
  required: ['id', 'name', 'unit', 'conversionDefinition', 'measurement', 'visitors', 'conversions'],
};
const experimentSpec = {
  t: 'object',
  fields: {
    id: ID, name: str(120), page: str(120),
    timezone: str(64, { pattern: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/ }),
    start: str(10, { pattern: /^\d{4}-\d{2}-\d{2}$/ }), end: str(10, { pattern: /^\d{4}-\d{2}-\d{2}$/ }),
    plannedEnd: str(10, { pattern: /^\d{4}-\d{2}-\d{2}$/ }),
    missingDays: { t: 'number', min: 0, int: true },
    variants: { t: 'array', of: variantSpec, max: 8, min: 1 }, notes: str(400),
  },
  required: ['id', 'name', 'timezone', 'start', 'end', 'plannedEnd', 'variants'],
};
export const DATASET_SPEC = {
  t: 'object',
  fields: { fictional: { t: 'bool' }, name: str(120), experiments: { t: 'array', of: experimentSpec, max: 20 } },
  required: ['fictional', 'name', 'experiments'],
};

export const VISUAL_SPEC = {
  t: 'object',
  nullable: true,
  fields: {
    kind: { t: 'string', enum: VISUAL_KINDS },
    label: str(60), title: str(60), task: str(120), note: str(160),
    from: str(120), to: str(120), review: str(120),
    columns: strList(20, 6), rows: { t: 'array', of: strList(40, 6), max: 6 }, highlight: { t: 'number', min: -1, max: 5, int: true },
    sourceRefs: refs,
    notEvidence: { t: 'bool' },
  },
  required: ['kind', 'label', 'note'],
};

const itemSpec = { t: 'object', fields: { heading: str(120), body: str(400), sourceRefs: refs }, required: [] };

export const SECTION_SPEC = {
  t: 'object',
  fields: {
    id: ID,
    role: { t: 'string', enum: ROLE_IDS },
    approved: { t: 'bool' }, approvedHash: str(64), needsReview: { t: 'bool' },
    origin: { t: 'string', enum: ORIGINS },
    heading: str(120),
    headingPhrases: strList(60, 8),
    body: str(1200),
    sub: str(60), // FV の補助文（hero だけ。H1 の直下に1行）
    note: str(200),
    sourceRefs: refs,
    items: { t: 'array', of: itemSpec, max: 10 },
    visual: VISUAL_SPEC,
    cta: { t: 'object', nullable: true, fields: { label: str(40), behavior: { t: 'string', enum: CTA_BEHAVIORS }, target: ID }, required: ['label', 'behavior', 'target'] },
    commercialPreview: { t: 'object', nullable: true, fields: { label: str(40), note: str(80) }, required: ['label'] },
  },
  required: ['id', 'role'],
};

export const PROJECT_SPEC = {
  t: 'object',
  fields: {
    schemaVersion: { t: 'number', int: true },
    id: ID,
    name: str(120),
    updatedAt: str(40),
    display: {
      t: 'object',
      fields: {
        brandName: str(40), serviceDescriptor: str(60), audienceLabel: str(60), productLabel: str(30),
        demoMode: { t: 'string', enum: DEMO_MODES }, demoNotice: str(100), operator: str(80),
        category: { t: 'string', enum: CATEGORIES },
      },
      required: ['brandName', 'serviceDescriptor', 'audienceLabel', 'demoMode'],
    },
    brand: {
      t: 'object',
      fields: { primary: str(7), accent: str(7), ink: str(7), paper: str(7), font: { t: 'string', enum: FONTS } },
      required: ['primary', 'accent', 'ink', 'paper', 'font'],
    },
    inputs: {
      t: 'object',
      fields: {
        scene: { t: 'object', fields: { who: str(200), timing: str(200), trying: str(200), stuckAt: str(300) }, required: [] },
        efforts: { t: 'object', fields: { tried: str(300), whatHappened: str(300), alternatives: str(300) }, required: [] },
        promiseLayers: { t: 'object', fields: { canDo: { t: 'array', of: refText, max: 8 }, expectedChange: { t: 'array', of: refText, max: 8 }, cannotGuarantee: { t: 'array', of: refText, max: 8 } }, required: [] },
        mechanism: { t: 'object', fields: { receive: str(300), withWhom: str(200), sequence: str(300), frequency: str(200), differentiation: str(300), differentiationBasisRef: str(40) }, required: [] },
        action: {
          t: 'object',
          fields: {
            ctaLabel: str(40), behavior: { t: 'string', enum: ACTION_BEHAVIORS }, url: str(400),
            price: str(100), duration: str(100), method: str(100), continuation: str(200), requiredInput: str(200),
            confirmed: { t: 'object', fields: { offer: { t: 'bool' }, price: { t: 'bool' }, duration: { t: 'bool' }, method: { t: 'bool' }, url: { t: 'bool' } }, required: [] },
          },
          required: [],
        },
        doNotAssert: strList(60, 20),
      },
      required: [],
    },
    ledger: {
      t: 'array', max: 80,
      of: { t: 'object', fields: { id: ID, text: str(300), kind: { t: 'string', enum: LEDGER_KINDS }, reality: { t: 'string', enum: REALITY }, origin: str(200) }, required: ['id', 'text', 'kind', 'reality'] },
    },
    quotes: {
      t: 'array', max: 40,
      of: { t: 'object', fields: { id: ID, text: str(300), speakerId: str(40), method: str(60), date: str(10), usable: { t: 'bool' }, sourceRef: str(200), provenance: { t: 'string', enum: PROVENANCE } }, required: ['id', 'text', 'speakerId', 'method', 'date', 'usable'] },
    },
    evidence: {
      t: 'array', max: 100,
      of: {
        t: 'object',
        fields: {
          id: ID, claim: str(300), kind: { t: 'string', enum: EVIDENCE_KINDS }, reality: { t: 'string', enum: REALITY },
          source: str(300), scope: str(200), consent: { t: 'bool' }, checkedAt: str(10),
          status: { t: 'string', enum: EVIDENCE_STATUS }, verifiedBy: str(80), verifiedAt: str(10), verifiedHash: str(64),
          provenance: { t: 'string', enum: PROVENANCE },
          metricValue: { t: 'number', nullable: true }, metricUnit: { t: 'string', enum: METRIC_UNITS },
          metricTarget: str(100), metricPeriod: str(60), metricDenominator: str(100), metricDefinition: str(200),
          note: str(300),
        },
        required: ['id', 'claim', 'kind', 'reality', 'source', 'status', 'provenance'],
      },
    },
    insights: {
      t: 'array', max: 10,
      of: {
        t: 'object',
        fields: {
          id: ID, statement: str(300), readFromSource: str(300), inferred: str(300), sourceRefs: refs,
          confidence: { t: 'string', enum: CONFIDENCE }, alternatives: strList(200, 5), questions: strList(200, 5),
          status: { t: 'string', enum: ['hypothesis', 'supported'] }, provenance: { t: 'string', enum: PROVENANCE },
        },
        required: ['id', 'statement', 'sourceRefs', 'status'],
      },
    },
    angles: {
      t: 'array', max: 6,
      of: {
        t: 'object',
        fields: {
          id: ID, statement: str(200), insightId: str(40), sourceRefs: refs, rationale: str(400),
          scores: { t: 'object', fields: { evidence: { t: 'number', min: 0, max: 3, int: true }, fit: { t: 'number', min: 0, max: 3, int: true }, specificity: { t: 'number', min: 0, max: 3, int: true }, nextAction: { t: 'number', min: 0, max: 3, int: true } }, required: [] },
        },
        required: ['id', 'statement', 'sourceRefs'],
      },
    },
    chosenAngleId: str(40),
    sections: { t: 'array', of: SECTION_SPEC, max: 20 },
    // 公開資料（学習者の公開体験・競合のページ）。課題理解とインサイト仮説の材料だけに使い、LP の根拠・口コミ・実績には使わない
    publicSources: {
      t: 'array', max: 20,
      of: { t: 'object', fields: { id: ID, url: str(300), title: str(120), kind: { t: 'string', enum: ['learner-story', 'competitor', 'article'] }, observation: str(400), use: { t: 'string', enum: ['context', 'supporting-hypothesis', 'competitor-check'] }, caveat: str(400) }, required: ['id', 'url', 'kind', 'observation', 'caveat'] },
    },
    // FV の設計メモ（生成・人が書く）。研究の参照は「設計の根拠」であり効果の保証ではない。FV の本文には出さない
    fvDesign: {
      t: 'object', nullable: true,
      fields: {
        viewportFirst: { t: 'string', enum: ['sp', 'pc'] },
        visualRole: str(200), gaze: { t: 'string', enum: ['toward-copy', 'toward-cta', 'front', 'none'] }, fit: str(300),
        maxChars: { t: 'number', min: 20, max: 200, int: true }, primaryCtas: { t: 'number', min: 1, max: 1, int: true },
        requiredAssets: strList(200, 8),
        researchNotes: { t: 'array', max: 12, of: { t: 'object', fields: { claim: str(300), source: str(300), status: { t: 'string', enum: ['research', 'hypothesis', 'design-condition'] }, caveat: str(300) }, required: ['claim', 'status'] } },
        evaluationPlan: str(500),
      },
      required: [],
    },
    selfCheck: {
      t: 'object', nullable: true,
      fields: { readAloud: strList(200, 12), consistency: str(400), missing: strList(200, 12), spLength: str(300), openQuestions: strList(200, 12) },
      required: [],
    },
    cta: {
      t: 'object',
      fields: {
        activeVariant: str(40),
        variants: { t: 'array', max: 4, min: 1, of: { t: 'object', fields: { id: ID, label: str(40), color: str(7), timing: { t: 'string', enum: CTA_TIMINGS_ACCEPTED } }, required: ['id', 'label', 'color', 'timing'] } },
      },
      required: ['activeVariant', 'variants'],
    },
    lpo: { t: 'object', fields: { dataset: { ...DATASET_SPEC, nullable: true } }, required: [] },
    // 人が用意した素材。生成では作らない・上書きしない
    assets: {
      t: 'object',
      fields: {
        // FV の人物写真（架空のイメージ人物）。実在の顧客・講師・推薦者として扱わない
        heroPortrait: {
          t: 'object', nullable: true,
          fields: {
            dataUri: str(1600000, { pattern: /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/ }),
            alt: str(80), caption: str(40), gaze: { t: 'string', enum: ['left', 'right'] }, flip: { t: 'bool' },
            focusX: { t: 'number', min: 0, max: 100 }, focusY: { t: 'number', min: 0, max: 100 },
            zoomSp: { t: 'number', min: 1, max: 3 }, focusYPc: { t: 'number', min: 0, max: 100 }, focusXSp: { t: 'number', min: 0, max: 100 }, zoomPc: { t: 'number', min: 1, max: 3 },
            origin: { t: 'string', enum: ['ai_generated', 'stock', 'own_photo', 'unknown'] }, fictional: { t: 'bool' },
            source: str(200),
          },
          required: ['dataUri', 'alt', 'caption'],
        },
      },
      required: [],
    },
  },
  required: ['schemaVersion', 'id', 'name', 'display', 'brand', 'inputs', 'ledger', 'evidence', 'sections', 'cta'],
};

function walk(spec, value, path, ctx) {
  if (value === null && spec.nullable) return null;
  switch (spec.t) {
    case 'string': {
      if (typeof value !== 'string') { ctx.errors.push(`${path}: 文字列ではありません`); return undefined; }
      const v = stripControl(value);
      if (v.length > spec.max) { ctx.errors.push(`${path}: ${spec.max}文字を超えています`); return undefined; }
      if (spec.enum && !spec.enum.includes(v)) { ctx.errors.push(`${path}: 許可されない値 "${v.slice(0, 40)}"`); return undefined; }
      if (spec.pattern && !spec.pattern.test(v)) { ctx.errors.push(`${path}: 形式が不正です`); return undefined; }
      if (/<\s*\/?\s*[a-z!]|javascript:/i.test(v)) ctx.warnings.push(`${path}: HTML/スクリプトらしき文字列があります（テキストとして扱い、実行しません）`);
      return v;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) { ctx.errors.push(`${path}: 数値ではありません`); return undefined; }
      if (spec.int && !Number.isInteger(value)) { ctx.errors.push(`${path}: 整数ではありません`); return undefined; }
      if (spec.min != null && value < spec.min) { ctx.errors.push(`${path}: ${spec.min}未満です`); return undefined; }
      if (spec.max != null && value > spec.max) { ctx.errors.push(`${path}: ${spec.max}を超えています`); return undefined; }
      return value;
    }
    case 'bool':
      if (typeof value !== 'boolean') { ctx.errors.push(`${path}: true/false ではありません`); return undefined; }
      return value;
    case 'array': {
      if (!Array.isArray(value)) { ctx.errors.push(`${path}: 配列ではありません`); return undefined; }
      if (spec.max != null && value.length > spec.max) { ctx.errors.push(`${path}: 要素が${spec.max}件を超えています`); return undefined; }
      if (spec.min != null && value.length < spec.min) { ctx.errors.push(`${path}: 要素が${spec.min}件未満です`); return undefined; }
      const out = [];
      value.forEach((item, i) => {
        const v = walk(spec.of, item, `${path}[${i}]`, ctx);
        if (v !== undefined) out.push(v);
      });
      return out;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) { ctx.errors.push(`${path}: オブジェクトではありません`); return undefined; }
      const out = {};
      for (const key of Object.keys(value)) {
        if (DANGEROUS_KEYS.has(key)) { ctx.errors.push(`${path}.${key}: 禁止キーです`); continue; }
        if (!Object.prototype.hasOwnProperty.call(spec.fields, key)) { ctx.warnings.push(`${path}.${key}: 未知のキーを削除しました`); continue; }
        const v = walk(spec.fields[key], value[key], `${path}.${key}`, ctx);
        if (v !== undefined) out[key] = v;
      }
      for (const key of spec.required || []) {
        if (!(key in value)) ctx.errors.push(`${path}.${key}: 必須項目がありません`);
      }
      return out;
    }
    default:
      ctx.errors.push(`${path}: schema 定義エラー`);
      return undefined;
  }
}

export function validateShape(spec, value, path = '$') {
  const ctx = { errors: [], warnings: [] };
  const out = walk(spec, value, path, ctx);
  return { value: out, errors: ctx.errors, warnings: ctx.warnings };
}

// ---------------- 移行 ----------------

const V1_ROLE = { fv: 'hero', empathy: 'empathy', reframe: 'empathy', origin: 'mechanism', steps: 'process', scope: 'scope', recommit: 'closing', proof: 'proof', fit: 'fit', closing: 'closing' };
const V1_EVIDENCE_KIND = { policy: 'service-spec', 'internal-data': 'outcome-aggregate', 'customer-consent': 'customer-quote', url: 'third-party', document: 'third-party', other: 'hypothesis' };

function v1ToV2(p) {
  const b = p.brief || {};
  const val = (k) => (b[k] && typeof b[k] === 'object' ? String(b[k].value || '') : '');
  const ok = (k) => !!(b[k] && b[k].status === 'confirmed' && b[k].value);
  const ledger = [];
  const add = (id, k, kind) => { if (val(k)) ledger.push({ id, text: val(k), kind: ok(k) ? kind : 'unknown', reality: 'unknown', origin: `v1 brief.${k}` }); };
  add('v1-audience', 'audience', 'provider-claim');
  add('v1-problem', 'problem', 'provider-claim');
  add('v1-promise', 'promise', 'provider-claim');
  add('v1-offer', 'offer', 'provider-claim');
  const seenRoles = new Set();
  const sections = [];
  for (const s of p.sections || []) {
    const role = V1_ROLE[s.type];
    if (!role || (seenRoles.has(role) && ['hero', 'closing'].includes(role))) continue;
    seenRoles.add(role);
    const f = s.fields || {};
    sections.push({
      id: String(s.id || role).slice(0, 40), role, approved: false, approvedHash: '', needsReview: true, origin: 'migrated',
      heading: String(f.heading || '').slice(0, 120), headingPhrases: [],
      body: [f.lead, f.body].filter(Boolean).join('\n').slice(0, 1200), note: String(f.note || '').slice(0, 200),
      sourceRefs: [], items: [...(f.items || []), ...(f.itemsAlt || [])].slice(0, 10).map((t) => ({ heading: String(t).slice(0, 120), body: '', sourceRefs: [] })),
      visual: null, cta: null, commercialPreview: null,
    });
  }
  return {
    schemaVersion: 2, id: p.id, name: p.name || 'v1から移行したLP', updatedAt: p.updatedAt || '',
    display: { brandName: val('product').slice(0, 40), serviceDescriptor: '', audienceLabel: val('audience').slice(0, 60), demoMode: 'prototype', demoNotice: '試作のページです。お申し込みは受け付けていません。', operator: val('operator').slice(0, 80), category: ['general', 'education', 'health', 'beauty', 'finance', 'employment'].includes(b.category) ? b.category : 'general' },
    brand: p.brand,
    inputs: {
      scene: { who: val('audience'), timing: '', trying: '', stuckAt: val('problem') },
      efforts: {}, promiseLayers: { canDo: [], expectedChange: [], cannotGuarantee: [] }, mechanism: {},
      action: { ctaLabel: val('ctaLabel'), behavior: 'external-booking', url: val('ctaUrl'), price: val('price'), duration: '', method: '', continuation: '', requiredInput: '', confirmed: { offer: ok('offer'), price: ok('price'), duration: false, method: false, url: ok('ctaUrl') } },
      doNotAssert: [],
    },
    ledger,
    quotes: [],
    evidence: (p.evidence || []).map((e) => ({
      id: e.id, claim: e.claim, kind: V1_EVIDENCE_KIND[e.sourceType] || 'hypothesis', reality: 'unknown', source: e.source || '', scope: '', consent: false, checkedAt: '',
      status: 'unverified', verifiedBy: '', verifiedAt: '', verifiedHash: '', provenance: e.provenance === 'seed' ? 'seed' : (e.provenance || 'human'),
      metricValue: e.metricValue ?? null, metricUnit: e.metricUnit || '', metricTarget: '', metricPeriod: '', metricDenominator: '', metricDefinition: '', note: e.note || '',
    })),
    insights: [], angles: [], chosenAngleId: '', sections, selfCheck: null,
    cta: p.cta, lpo: p.lpo || { dataset: null },
  };
}

export function migrate(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { value: input, notes: [] };
  const notes = [];
  let p = input;
  if (p.schemaVersion === undefined) {
    p = { ...p, schemaVersion: 1 };
    if (p.brief && typeof p.brief === 'object') {
      const brief = {};
      for (const [k, v] of Object.entries(p.brief)) {
        if (DANGEROUS_KEYS.has(k)) continue;
        brief[k] = typeof v === 'string' && k !== 'category' ? { value: v, status: v.trim() ? 'unconfirmed' : 'missing' } : v;
      }
      p.brief = brief;
    }
    notes.push('v0 → v1 に移行しました（ブリーフ値はすべて「未確認」扱い）');
  }
  if (p.schemaVersion === 1) {
    p = v1ToV2(p);
    notes.push('v1 → v2 に移行しました。セクションは「要再確認・未承認」、根拠は「未検証」になります。インサイトと訴求は空なので、生成から作り直してください');
  }
  return { value: p, notes };
}

// ---------------- 意味の検証 ----------------

export function validateProject(input) {
  const migrated = migrate(input);
  const warnings = [...migrated.notes];
  const raw = migrated.value;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['$: project はオブジェクトである必要があります'], warnings, project: null };
  }
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, errors: [`$.schemaVersion: 未対応の版です（${String(raw.schemaVersion).slice(0, 10)}）。対応: ${SCHEMA_VERSION}`], warnings, project: null };
  }
  const shape = validateShape(PROJECT_SPEC, raw);
  const errors = [...shape.errors];
  warnings.push(...shape.warnings);
  const p = shape.value;
  if (errors.length || !p) return { ok: false, errors, warnings, project: null };

  p.display = { demoNotice: '', operator: '', category: 'general', ...p.display };
  p.inputs = {
    scene: {}, efforts: {}, promiseLayers: { canDo: [], expectedChange: [], cannotGuarantee: [] }, mechanism: {},
    action: { confirmed: {} }, doNotAssert: [], ...p.inputs,
  };
  p.inputs.action = { ctaLabel: '', behavior: 'none', url: '', price: '', duration: '', method: '', continuation: '', requiredInput: '', ...p.inputs.action, confirmed: { offer: false, price: false, duration: false, method: false, url: false, ...(p.inputs.action.confirmed || {}) } };
  p.inputs.promiseLayers = { canDo: [], expectedChange: [], cannotGuarantee: [], ...p.inputs.promiseLayers };
  p.quotes = p.quotes || [];
  p.insights = p.insights || [];
  p.angles = p.angles || [];
  p.chosenAngleId = p.chosenAngleId || '';
  if (p.selfCheck === undefined) p.selfCheck = null;
  if (p.fvDesign === undefined) p.fvDesign = null;
  p.publicSources = (p.publicSources || []).filter((x) => {
    if (/^https:\/\//.test(x.url)) return true;
    warnings.push(`$.publicSources.${x.id}: https の URL だけを記録します`);
    return false;
  });
  if (p.fvDesign) {
    p.fvDesign = { viewportFirst: 'sp', visualRole: '', gaze: 'none', fit: '', maxChars: 80, primaryCtas: 1, requiredAssets: [], researchNotes: [], evaluationPlan: '', ...p.fvDesign };
    // 出典の無い「研究」は仮説として扱う
    p.fvDesign.researchNotes = p.fvDesign.researchNotes.map((n) => ({ source: '', caveat: '', ...n, status: n.status === 'research' && !String(n.source || '').trim() ? 'hypothesis' : n.status }));
  }

  if (p.inputs.action.url && !safeUrl(p.inputs.action.url)) {
    warnings.push('$.inputs.action.url: 許可されないURLのため除去しました（https / mailto / tel / #id のみ）');
    p.inputs.action.url = '';
    p.inputs.action.confirmed.url = false;
  }
  if (p.display.demoMode !== 'live' && !p.display.demoNotice.trim()) {
    p.display.demoNotice = p.display.demoMode === 'synthetic-demo' ? '架空サービスのデモです。お申し込みは受け付けていません。' : '試作のページです。お申し込みは受け付けていません。';
    warnings.push('$.display.demoNotice: デモ表示が空のため既定の文を入れました');
  }
  for (const k of ['primary', 'accent', 'ink', 'paper']) {
    if (!safeColor(p.brand[k])) errors.push(`$.brand.${k}: 色は #RRGGBB 形式のみ`);
    else p.brand[k] = safeColor(p.brand[k]);
  }
  for (const [i, v] of p.cta.variants.entries()) {
    if (!safeColor(v.color)) errors.push(`$.cta.variants[${i}].color: 色は #RRGGBB 形式のみ`);
    else v.color = safeColor(v.color);
    if (v.timing === 'always') { v.timing = 'spec'; warnings.push(`$.cta.variants.${v.id}.timing: "always" は廃止。仕様どおりに置き換えました`); }
  }
  if (!p.cta.variants.some((v) => v.id === p.cta.activeVariant)) p.cta.activeVariant = p.cta.variants[0].id;

  const uniq = (list, label, key = 'id') => {
    const seen = new Set();
    for (const item of list) {
      if (seen.has(item[key])) errors.push(`${label}: ID "${item[key]}" が重複しています`);
      seen.add(item[key]);
    }
    return seen;
  };
  const ledgerIds = uniq(p.ledger, '$.ledger');
  const evIds = uniq(p.evidence, '$.evidence');
  const quoteIds = uniq(p.quotes, '$.quotes');
  const sectionIds = uniq(p.sections, '$.sections');
  uniq(p.insights, '$.insights');
  uniq(p.angles, '$.angles');
  uniq(p.cta.variants, '$.cta.variants');
  const allRefs = new Set([...ledgerIds, ...evIds, ...quoteIds]);
  for (const id of ledgerIds) if (evIds.has(id)) errors.push(`ID "${id}" が台帳と根拠で重複しています`);

  // 顧客の原文: 生成由来は入れない
  p.quotes = p.quotes.filter((q) => {
    if (q.provenance === 'claude-code' || q.provenance === 'template') { warnings.push(`$.quotes.${q.id}: 生成由来の文は顧客の原文として扱えないため削除しました`); return false; }
    return true;
  });

  // 根拠: 数値と単位、検証の要件
  const today = new Date().toISOString().slice(0, 10);
  for (const e of p.evidence) {
    e.consent = !!e.consent;
    for (const k of ['scope', 'checkedAt', 'verifiedBy', 'verifiedAt', 'verifiedHash', 'metricUnit', 'metricTarget', 'metricPeriod', 'metricDenominator', 'metricDefinition', 'note']) e[k] = e[k] || '';
    if (e.metricValue === undefined) e.metricValue = null;
    if (e.metricValue != null && !metricMatches(e.claim, e.metricValue, e.metricUnit)) {
      warnings.push(`$.evidence.${e.id}.metricValue: 主張文に「${e.metricValue}${e.metricUnit.split('/')[0]}」が無いため数値を外しました`);
      e.metricValue = null;
    }
    if (e.status !== 'verified') continue;
    let why = null;
    if (!e.verifiedBy.trim()) why = '確認者が無い';
    else if (!isRealDate(e.verifiedAt) || e.verifiedAt > today) why = '確認日が実在しないか未来';
    else if (e.provenance === 'template' || e.provenance === 'claude-code') why = '生成由来の根拠は人が検証し直す必要がある';
    else if (e.verifiedHash !== evidenceHash(e)) why = '検証後に内容が変わっている';
    if (why) {
      e.status = 'unverified'; e.verifiedBy = ''; e.verifiedAt = ''; e.verifiedHash = '';
      warnings.push(`$.evidence.${e.id}: ${why}ため unverified に降格しました`);
    }
  }

  // インサイト: 顧客の原文・観察に基づかない限り hypothesis
  for (const ins of p.insights) {
    const supported = ins.sourceRefs.some((r) => quoteIds.has(r) || p.ledger.some((l) => l.id === r && (l.kind === 'customer-observation' || l.kind === 'customer-quote') && l.reality === 'real'));
    if (ins.status === 'supported' && !supported) { ins.status = 'hypothesis'; warnings.push(`$.insights.${ins.id}: 実在の顧客の原文・観察に基づかないため仮説に戻しました`); }
    for (const r of ins.sourceRefs) if (!allRefs.has(r)) warnings.push(`$.insights.${ins.id}: 参照 "${r}" が台帳にありません`);
  }
  if (p.chosenAngleId && !p.angles.some((a) => a.id === p.chosenAngleId)) { warnings.push('$.chosenAngleId: 存在しない訴求のため外しました'); p.chosenAngleId = ''; }

  // 顔写真（承認 hash に含めるため、セクションより先に整える）
  p.assets = { heroPortrait: null, ...(p.assets || {}) };
  const hp = p.assets.heroPortrait;
  if (hp) {
    p.assets.heroPortrait = { gaze: 'left', flip: false, focusX: 50, focusY: 30, zoomSp: 1, zoomPc: 1, origin: 'unknown', fictional: false, source: '', ...hp }; // 由来と架空かどうかは明示が必要（既定は「不明・架空ではない」= デモでは停止）
    if (!/架空|イメージ/.test(hp.caption)) { p.assets.heroPortrait.caption = '写真はイメージ（架空の人物）'; warnings.push('$.assets.heroPortrait.caption: 架空のイメージ人物である表示に置き換えました'); }
  }
  // セクション
  for (const s of p.sections) {
    s.approved = !!s.approved; s.approvedHash = s.approvedHash || ''; s.needsReview = !!s.needsReview; s.origin = s.origin || 'manual';
    for (const k of ['heading', 'body', 'sub', 'note']) s[k] = s[k] || '';
    s.headingPhrases = s.headingPhrases || []; s.sourceRefs = s.sourceRefs || [];
    s.items = (s.items || []).map((it) => ({ heading: it.heading || '', body: it.body || '', sourceRefs: it.sourceRefs || [] }));
    if (s.visual === undefined) s.visual = null;
    if (s.visual) s.visual = { title: '', task: '', from: '', to: '', review: '', columns: [], rows: [], highlight: -1, sourceRefs: [], ...s.visual, notEvidence: true };
    if (s.cta === undefined) s.cta = null;
    if (s.cta && !sectionIds.has(s.cta.target)) { warnings.push(`$.sections.${s.id}.cta: 移動先 "${s.cta.target}" が無いため外しました`); s.cta = null; }
    if (s.commercialPreview === undefined) s.commercialPreview = null;
    if (s.commercialPreview) s.commercialPreview = { note: '', ...s.commercialPreview };
    if (s.approved && s.approvedHash !== sectionHash(s, p.assets?.heroPortrait)) {
      s.approved = false; s.approvedHash = '';
      warnings.push(`$.sections.${s.id}: 承認後に内容が変わっているため承認を外しました`);
    }
  }
  for (const [i, x] of (p.lpo?.dataset?.experiments || []).entries()) {
    for (const k of ['start', 'end', 'plannedEnd']) if (!isRealDate(x[k])) errors.push(`$.lpo.dataset.experiments[${i}].${k}: 実在しない日付です`);
  }
  if (!p.lpo) p.lpo = { dataset: null };
  if (p.lpo.dataset === undefined) p.lpo.dataset = null;
  if (p.lpo.dataset && p.lpo.dataset.fictional !== true) errors.push('$.lpo.dataset.fictional: このツールは架空データのみ扱います（fictional: true が必要）');
  return { ok: errors.length === 0, errors, warnings, project: errors.length ? null : p };
}

export function parseProjectJson(text) {
  if (typeof text !== 'string') return { ok: false, errors: ['入力が文字列ではありません'], warnings: [], project: null };
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_JSON_BYTES) return { ok: false, errors: [`JSONが大きすぎます（${bytes} bytes > ${MAX_JSON_BYTES}）`], warnings: [], project: null };
  const trimmed = text.trim();
  if (/^</.test(trimmed)) return { ok: false, errors: ['HTMLは読み込めません。project JSON だけを受け付けます'], warnings: [], project: null };
  let data;
  try {
    data = JSON.parse(trimmed, (key, value) => {
      if (DANGEROUS_KEYS.has(key)) throw new Error(`禁止キー "${key}" を含んでいます`);
      return value;
    });
  } catch (e) {
    return { ok: false, errors: [`JSONとして読めません: ${String(e.message).slice(0, 120)}`], warnings: [], project: null };
  }
  return validateProject(data);
}

export function serializeProject(project) {
  return JSON.stringify(project, null, 2);
}

/** 参照IDで台帳・根拠・原文を引く */
export function refIndex(project) {
  const map = new Map();
  for (const l of project.ledger) map.set(l.id, { type: 'ledger', text: l.text, kind: l.kind, reality: l.reality, item: l });
  for (const e of project.evidence) map.set(e.id, { type: 'evidence', text: e.claim, kind: e.kind, reality: e.reality, item: e });
  for (const q of project.quotes) map.set(q.id, { type: 'quote', text: q.text, kind: 'customer-quote', reality: 'real', item: q });
  for (const ps of project.publicSources || []) map.set(ps.id, { type: 'public', text: ps.observation, kind: ps.kind, reality: 'public', item: ps });
  const a = project.inputs.action;
  for (const k of ['price', 'duration', 'method', 'continuation']) {
    if (a[k] && a.confirmed[k]) map.set(`action.${k}`, { type: 'action', text: a[k], kind: 'verified-spec', reality: project.display.demoMode === 'live' ? 'real' : 'synthetic', item: a });
  }
  return map;
}
