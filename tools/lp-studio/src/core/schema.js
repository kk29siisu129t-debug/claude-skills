// project JSON の schema / version / validation / migration。
// 方針: 既知のキーだけを新しいオブジェクトへコピーする（未知キーは警告して削除）。
// HTML は文字列として保持するだけで、描画時に必ず escape する。HTML import は存在しない。

import { SECTION_TYPES, BRIEF_KEYS } from './sections.js';
import { safeUrl, safeColor, stripControl } from './util.js';

export const SCHEMA_VERSION = 1;
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const BRIEF_STATUS = ['confirmed', 'unconfirmed', 'missing'];
export const CATEGORIES = ['general', 'education', 'health', 'beauty', 'finance', 'employment'];
export const EVIDENCE_STATUS = ['verified', 'unverified'];
export const SOURCE_TYPES = ['document', 'url', 'internal-data', 'customer-consent', 'policy', 'other'];
export const PROVENANCE = ['human', 'template', 'claude-code', 'seed'];
export const ORIGINS = ['template', 'claude-code', 'manual'];
export const CTA_TIMINGS = ['spec', 'always', 'after-half'];
export const FONTS = ['sans', 'serif', 'rounded'];

const str = (max, extra = {}) => ({ t: 'string', max, ...extra });
const briefField = { t: 'object', fields: { value: str(600), status: { t: 'string', enum: BRIEF_STATUS } }, required: ['value', 'status'] };

const variantSpec = {
  t: 'object',
  fields: {
    id: str(40, { pattern: /^[A-Za-z0-9_-]{1,40}$/ }),
    name: str(80),
    expectedShare: { t: 'number', min: 0, max: 1 },
    unit: { t: 'string', enum: ['users', 'sessions', 'pageviews'] },
    conversionDefinition: str(200),
    measurement: str(200),
    visitors: { t: 'number', min: 0, int: true, nullable: true },
    ctaClicks: { t: 'number', min: 0, int: true, nullable: true },
    conversions: { t: 'number', min: 0, int: true, nullable: true },
  },
  required: ['id', 'name', 'unit', 'conversionDefinition', 'measurement', 'visitors', 'conversions'],
};

const experimentSpec = {
  t: 'object',
  fields: {
    id: str(40, { pattern: /^[A-Za-z0-9_-]{1,40}$/ }),
    name: str(120),
    page: str(120),
    timezone: str(64, { pattern: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/ }),
    start: str(10, { pattern: /^\d{4}-\d{2}-\d{2}$/ }),
    end: str(10, { pattern: /^\d{4}-\d{2}-\d{2}$/ }),
    plannedEnd: str(10, { pattern: /^\d{4}-\d{2}-\d{2}$/ }),
    missingDays: { t: 'number', min: 0, int: true },
    variants: { t: 'array', of: variantSpec, max: 8, min: 1 },
    notes: str(400),
  },
  required: ['id', 'name', 'timezone', 'start', 'end', 'plannedEnd', 'variants'],
};

export const DATASET_SPEC = {
  t: 'object',
  fields: {
    fictional: { t: 'bool' },
    name: str(120),
    experiments: { t: 'array', of: experimentSpec, max: 20 },
  },
  required: ['fictional', 'name', 'experiments'],
};

export const PROJECT_SPEC = {
  t: 'object',
  fields: {
    schemaVersion: { t: 'number', int: true },
    id: str(40, { pattern: /^[A-Za-z0-9_-]{1,40}$/ }),
    name: str(120),
    updatedAt: str(40),
    brief: {
      t: 'object',
      fields: {
        ...Object.fromEntries(BRIEF_KEYS.map((k) => [k, briefField])),
        category: { t: 'string', enum: CATEGORIES },
      },
      required: [...BRIEF_KEYS, 'category'],
    },
    brand: {
      t: 'object',
      fields: {
        primary: str(7), accent: str(7), ink: str(7), paper: str(7),
        font: { t: 'string', enum: FONTS },
      },
      required: ['primary', 'accent', 'ink', 'paper', 'font'],
    },
    evidence: {
      t: 'array', max: 100,
      of: {
        t: 'object',
        fields: {
          id: str(40, { pattern: /^[A-Za-z0-9_-]{1,40}$/ }),
          claim: str(300),
          sourceType: { t: 'string', enum: SOURCE_TYPES },
          source: str(300),
          status: { t: 'string', enum: EVIDENCE_STATUS },
          verifiedBy: str(80),
          verifiedAt: str(10),
          provenance: { t: 'string', enum: PROVENANCE },
          metricValue: { t: 'number', nullable: true },
          metricUnit: str(12),
          note: str(300),
        },
        required: ['id', 'claim', 'sourceType', 'source', 'status', 'provenance'],
      },
    },
    sections: {
      t: 'array', max: 40,
      of: {
        t: 'object',
        fields: {
          id: str(40, { pattern: /^[A-Za-z0-9_-]{1,40}$/ }),
          type: { t: 'string', enum: SECTION_TYPES },
          approved: { t: 'bool' },
          needsReview: { t: 'bool' },
          origin: { t: 'string', enum: ORIGINS },
          fields: {
            t: 'object',
            fields: {
              heading: str(200), lead: str(400), body: str(2000), note: str(400),
              items: { t: 'array', of: str(300), max: 12 },
              itemsAlt: { t: 'array', of: str(300), max: 12 },
            },
            required: [],
          },
          claimRefs: { t: 'array', of: str(40), max: 20 },
        },
        required: ['id', 'type', 'fields'],
      },
    },
    cta: {
      t: 'object',
      fields: {
        activeVariant: str(40),
        variants: {
          t: 'array', max: 4, min: 1,
          of: {
            t: 'object',
            fields: {
              id: str(40, { pattern: /^[A-Za-z0-9_-]{1,40}$/ }),
              label: str(40),
              color: str(7),
              timing: { t: 'string', enum: CTA_TIMINGS },
            },
            required: ['id', 'label', 'color', 'timing'],
          },
        },
      },
      required: ['activeVariant', 'variants'],
    },
    lpo: { t: 'object', fields: { dataset: { ...DATASET_SPEC, nullable: true } }, required: [] },
  },
  required: ['schemaVersion', 'id', 'name', 'brief', 'brand', 'evidence', 'sections', 'cta'],
};

function walk(spec, value, path, ctx) {
  if (value === null && spec.nullable) return null;
  switch (spec.t) {
    case 'string': {
      if (typeof value !== 'string') { ctx.errors.push(`${path}: 文字列ではありません`); return undefined; }
      let v = stripControl(value);
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

/** schemaVersion 欠落（v0: brief の値が素の文字列）→ v1 */
export function migrate(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { value: input, notes: [] };
  }
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
  return { value: p, notes };
}

/**
 * 形の検証に加えて意味の検証（ID一意・参照・URL・色・verified の要件）。
 * 返り値の project は安全に使える正規化済みのコピー。
 */
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

  // CTA URL
  if (p.brief.ctaUrl.value && !safeUrl(p.brief.ctaUrl.value)) {
    warnings.push('$.brief.ctaUrl: 許可されないURLのため除去しました（https / mailto / tel / #id のみ）');
    p.brief.ctaUrl = { value: '', status: 'missing' };
  }
  // 色
  for (const k of ['primary', 'accent', 'ink', 'paper']) {
    if (!safeColor(p.brand[k])) errors.push(`$.brand.${k}: 色は #RRGGBB 形式のみ`);
    else p.brand[k] = safeColor(p.brand[k]);
  }
  for (const [i, v] of p.cta.variants.entries()) {
    if (!safeColor(v.color)) errors.push(`$.cta.variants[${i}].color: 色は #RRGGBB 形式のみ`);
    else v.color = safeColor(v.color);
  }
  if (!p.cta.variants.some((v) => v.id === p.cta.activeVariant)) {
    warnings.push('$.cta.activeVariant: 存在しないため先頭に戻しました');
    p.cta.activeVariant = p.cta.variants[0].id;
  }
  // ID一意
  const uniq = (list, label) => {
    const seen = new Set();
    for (const item of list) {
      if (seen.has(item.id)) errors.push(`${label}: ID "${item.id}" が重複しています`);
      seen.add(item.id);
    }
    return seen;
  };
  const evIds = uniq(p.evidence, '$.evidence');
  uniq(p.sections, '$.sections');
  uniq(p.cta.variants, '$.cta.variants');
  // verified の要件（確認者・確認日が無ければ降格）
  for (const e of p.evidence) {
    if (e.status === 'verified' && (!e.verifiedBy?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(e.verifiedAt || ''))) {
      e.status = 'unverified';
      warnings.push(`$.evidence.${e.id}: 確認者・確認日が無いため unverified に降格しました`);
    }
  }
  for (const s of p.sections) {
    s.approved = !!s.approved;
    s.needsReview = !!s.needsReview;
    s.origin = s.origin || 'manual';
    s.fields = { heading: '', lead: '', body: '', note: '', items: [], itemsAlt: [], ...s.fields };
    s.claimRefs = (s.claimRefs || []).filter((r) => {
      if (!evIds.has(r)) { warnings.push(`$.sections.${s.id}.claimRefs: 存在しない根拠 "${r}" を外しました`); return false; }
      return true;
    });
  }
  if (!p.lpo) p.lpo = { dataset: null };
  if (p.lpo.dataset === undefined) p.lpo.dataset = null;
  if (p.lpo.dataset && p.lpo.dataset.fictional !== true) {
    errors.push('$.lpo.dataset.fictional: このツールは架空データのみ扱います（fictional: true が必要）');
  }
  return { ok: errors.length === 0, errors, warnings, project: errors.length ? null : p };
}

/** 文字列 → project。HTML は受け付けない。 */
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
