// 共通データモデルへの編集操作。すべて純関数（入力を変更せず新しい project を返す）。
// WF / PC / SP / export は同じ project から描画されるので、ここを通せば全ビューが同期する。

import { SCHEMA_VERSION, BRIEF_STATUS, SOURCE_TYPES, CTA_TIMINGS, FONTS, CATEGORIES, METRIC_UNITS, validateProject } from './schema.js';
import { metricMatches } from './claims.js';
import { SECTION_CATALOG, BRIEF_KEYS } from './sections.js';
import { templateSection } from './generate.js';
import { clone, makeId, safeColor, safeUrl, stripControl, sectionHash, evidenceHash, isRealDate } from './util.js';

const txt = (v, max) => stripControl(String(v ?? '')).slice(0, max);

export function emptyProject(name = '新しいLP') {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: makeId('lp'),
    name,
    updatedAt: '',
    brief: { ...Object.fromEntries(BRIEF_KEYS.map((k) => [k, { value: '', status: 'missing' }])), category: 'general' },
    brand: { primary: '#2f3cbe', accent: '#e0567a', ink: '#1d2230', paper: '#fbf8f2', font: 'sans' },
    evidence: [],
    sections: [],
    cta: { activeVariant: 'a', variants: [{ id: 'a', label: '', color: '#d93d63', timing: 'spec' }] },
    lpo: { dataset: null },
  };
}

function findSection(p, id) {
  const i = p.sections.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`セクション ${id} が見つかりません`);
  return i;
}

const TEXT_FIELDS = ['heading', 'lead', 'body', 'note'];
const LIST_FIELDS = ['items', 'itemsAlt'];

/**
 * op: { type, ... }
 * 失敗時は Error を投げる（UI はメッセージを表示し、project は変わらない）。
 */
export function applyEdit(project, op) {
  const p = clone(project);
  switch (op.type) {
    case 'setName':
      p.name = txt(op.value, 120);
      break;
    case 'setBrief': {
      if (!BRIEF_KEYS.includes(op.key)) throw new Error('不明なブリーフ項目');
      const cur = p.brief[op.key];
      let value = op.value !== undefined ? txt(op.value, 600) : cur.value;
      let status = op.status !== undefined ? op.status : cur.status;
      if (!BRIEF_STATUS.includes(status)) throw new Error('不明なステータス');
      if (op.key === 'ctaUrl' && value && !safeUrl(value)) throw new Error('リンク先は https: / mailto: / tel: / #id のみ使えます');
      if (!value.trim()) status = 'missing';
      else if (status === 'missing') status = 'unconfirmed';
      p.brief[op.key] = { value, status };
      break;
    }
    case 'setCategory':
      if (!CATEGORIES.includes(op.value)) throw new Error('不明なカテゴリ');
      p.brief.category = op.value;
      break;
    case 'setBrand': {
      if (op.key === 'font') {
        if (!FONTS.includes(op.value)) throw new Error('不明なフォント');
        p.brand.font = op.value;
      } else {
        if (!['primary', 'accent', 'ink', 'paper'].includes(op.key)) throw new Error('不明なtoken');
        const c = safeColor(op.value);
        if (!c) throw new Error('色は #RRGGBB で指定してください');
        p.brand[op.key] = c;
      }
      break;
    }
    case 'setField': {
      const i = findSection(p, op.id);
      if (TEXT_FIELDS.includes(op.field)) p.sections[i].fields[op.field] = txt(op.value, op.field === 'body' ? 2000 : op.field === 'heading' ? 200 : 400);
      else if (LIST_FIELDS.includes(op.field)) {
        const list = Array.isArray(op.value) ? op.value : String(op.value).split('\n');
        p.sections[i].fields[op.field] = list.map((v) => txt(v, 300)).filter((v) => v.trim()).slice(0, 12);
      } else throw new Error('不明なフィールド');
      p.sections[i].origin = 'manual';
      p.sections[i].approved = false; // 編集したら承認し直し
      p.sections[i].approvedHash = '';
      break;
    }
    case 'addSection': {
      const meta = SECTION_CATALOG[op.sectionType];
      if (!meta) throw new Error('不明なセクション種別');
      if (p.sections.some((s) => s.type === op.sectionType)) throw new Error(`${meta.label} はすでにあります`);
      const s = templateSection(op.sectionType, p);
      const at = Number.isInteger(op.at) ? Math.max(0, Math.min(op.at, p.sections.length)) : p.sections.length;
      p.sections.splice(at, 0, s);
      break;
    }
    case 'removeSection': {
      const i = findSection(p, op.id);
      if (SECTION_CATALOG[p.sections[i].type].required) throw new Error('必須セクションは削除できません（並べ替えは可能）');
      p.sections.splice(i, 1);
      break;
    }
    case 'moveSection': {
      const i = findSection(p, op.id);
      const j = i + (op.delta || 0);
      if (j < 0 || j >= p.sections.length) throw new Error('これ以上移動できません');
      const [s] = p.sections.splice(i, 1);
      p.sections.splice(j, 0, s);
      break;
    }
    case 'approveSection': {
      const i = findSection(p, op.id);
      p.sections[i].approved = !!op.value;
      p.sections[i].approvedHash = op.value ? sectionHash(p.sections[i]) : '';
      if (op.value) p.sections[i].needsReview = false;
      break;
    }
    case 'setClaimRefs': {
      const i = findSection(p, op.id);
      const ids = new Set(p.evidence.map((e) => e.id));
      p.sections[i].claimRefs = (op.value || []).filter((r) => ids.has(r));
      p.sections[i].approved = false;
      p.sections[i].approvedHash = '';
      break;
    }
    case 'addEvidence': {
      if (!SOURCE_TYPES.includes(op.sourceType || 'other')) throw new Error('不明な出典種別');
      const claim = txt(op.claim, 300);
      const metricValue = Number.isFinite(op.metricValue) ? op.metricValue : null;
      const metricUnit = String(op.metricUnit || '');
      if (!METRIC_UNITS.includes(metricUnit)) throw new Error(`単位は次から選んでください: ${METRIC_UNITS.filter(Boolean).join(' ')}`);
      if (metricValue != null && !metricMatches(claim, metricValue, metricUnit)) throw new Error('数値と単位は、主張文に含まれている組（例: 4.2日）だけを使えます');
      p.evidence.push({
        id: makeId('ev'), claim, source: txt(op.source, 300),
        sourceType: op.sourceType || 'other', status: 'unverified', provenance: 'human', verifiedBy: '', verifiedAt: '', verifiedHash: '',
        metricValue, metricUnit, note: '',
      });
      break;
    }
    case 'verifyEvidence': {
      // 昇格は人の操作だけ。確認者と確認日が必須
      const e = p.evidence.find((x) => x.id === op.id);
      if (!e) throw new Error('根拠が見つかりません');
      if (op.value) {
        if (!String(op.verifiedBy || '').trim()) throw new Error('確認者を入力してください');
        if (!isRealDate(op.verifiedAt || '') || op.verifiedAt > new Date().toISOString().slice(0, 10)) throw new Error('確認日は実在する今日以前の日付（YYYY-MM-DD）');
        if (!e.source.trim()) throw new Error('出典が空の根拠は検証済みにできません');
        e.status = 'verified';
        e.verifiedBy = txt(op.verifiedBy, 80);
        e.provenance = 'human';
        e.verifiedHash = evidenceHash(e);
        e.verifiedAt = op.verifiedAt;
      } else {
        e.status = 'unverified';
        e.verifiedBy = '';
        e.verifiedAt = '';
        e.verifiedHash = '';
      }
      break;
    }
    case 'removeEvidence': {
      p.evidence = p.evidence.filter((e) => e.id !== op.id);
      for (const s of p.sections) s.claimRefs = s.claimRefs.filter((r) => r !== op.id);
      break;
    }
    case 'setCtaVariant': {
      const v = p.cta.variants.find((x) => x.id === op.id);
      if (!v) throw new Error('CTA案が見つかりません');
      if (op.label !== undefined) v.label = txt(op.label, 40);
      if (op.color !== undefined) {
        const c = safeColor(op.color);
        if (!c) throw new Error('色は #RRGGBB で指定してください');
        v.color = c;
      }
      if (op.timing !== undefined) {
        if (!CTA_TIMINGS.includes(op.timing)) throw new Error('不明な表示タイミング');
        v.timing = op.timing;
      }
      break;
    }
    case 'addCtaVariant': {
      if (p.cta.variants.length >= 4) throw new Error('CTA案は4つまで');
      const used = new Set(p.cta.variants.map((v) => v.id));
      const id = ['a', 'b', 'c', 'd'].find((x) => !used.has(x));
      p.cta.variants.push({ id, label: '', color: '#1f6f5c', timing: 'spec' });
      break;
    }
    case 'removeCtaVariant': {
      if (p.cta.variants.length <= 1) throw new Error('CTA案は最低1つ必要です');
      p.cta.variants = p.cta.variants.filter((v) => v.id !== op.id);
      if (!p.cta.variants.some((v) => v.id === p.cta.activeVariant)) p.cta.activeVariant = p.cta.variants[0].id;
      break;
    }
    case 'setActiveCta':
      if (!p.cta.variants.some((v) => v.id === op.id)) throw new Error('CTA案が見つかりません');
      p.cta.activeVariant = op.id;
      break;
    case 'setDataset': {
      const check = validateProject({ ...p, lpo: { dataset: op.value } });
      if (!check.ok) throw new Error(check.errors.join(' / '));
      p.lpo = { dataset: check.project.lpo.dataset };
      break;
    }
    default:
      throw new Error(`不明な操作: ${op.type}`);
  }
  return p;
}

export function activeCta(project) {
  const v = project.cta.variants.find((x) => x.id === project.cta.activeVariant) || project.cta.variants[0];
  return { ...v, label: v.label || project.brief.ctaLabel.value };
}
