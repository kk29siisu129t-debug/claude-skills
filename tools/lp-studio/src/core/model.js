// 共通データモデル（v2）への編集操作。すべて純関数（入力を変更せず新しい project を返す）。
// draft / review / commercial / WF は同じ project から描画されるので、ここを通せば全ビューが同期する。

import {
  SCHEMA_VERSION, DEMO_MODES, CATEGORIES, LEDGER_KINDS, REALITY, EVIDENCE_KINDS, ACTION_BEHAVIORS,
  CTA_TIMINGS, FONTS, METRIC_UNITS, VISUAL_KINDS, validateProject,
} from './schema.js';
import { ROLES } from './roles.js';
import { metricMatches } from './claims.js';
import { chooseAngle } from './generate.js';
import { clone, makeId, safeColor, safeUrl, stripControl, sectionHash, evidenceHash, isRealDate } from './util.js';

const txt = (v, max) => stripControl(String(v ?? '')).slice(0, max);

export function emptyProject(name = '新しいLP') {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: makeId('lp'),
    name,
    updatedAt: '',
    display: { brandName: '', serviceDescriptor: '', audienceLabel: '', demoMode: 'prototype', demoNotice: '試作のページです。お申し込みは受け付けていません。', operator: '', category: 'general' },
    brand: { primary: '#2741b8', accent: '#c42f57', ink: '#1b1f2b', paper: '#fbf8f3', font: 'sans' },
    inputs: {
      scene: { who: '', timing: '', trying: '', stuckAt: '' },
      efforts: { tried: '', whatHappened: '', alternatives: '' },
      promiseLayers: { canDo: [], expectedChange: [], cannotGuarantee: [] },
      mechanism: { receive: '', withWhom: '', sequence: '', frequency: '', differentiation: '', differentiationBasisRef: '' },
      action: { ctaLabel: '', behavior: 'none', url: '', price: '', duration: '', method: '', continuation: '', requiredInput: '', confirmed: { offer: false, price: false, duration: false, method: false, url: false } },
      doNotAssert: [],
    },
    ledger: [], quotes: [], evidence: [], insights: [], angles: [], chosenAngleId: '', sections: [], selfCheck: null,
    cta: { activeVariant: 'a', variants: [{ id: 'a', label: '', color: '#c42f57', timing: 'spec' }] },
    lpo: { dataset: null },
  };
}

function sec(p, id) {
  const i = p.sections.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`セクション ${id} が見つかりません`);
  return p.sections[i];
}
function touch(s) { s.origin = 'manual'; s.approved = false; s.approvedHash = ''; }
const INPUT_GROUPS = { scene: ['who', 'timing', 'trying', 'stuckAt'], efforts: ['tried', 'whatHappened', 'alternatives'], mechanism: ['receive', 'withWhom', 'sequence', 'frequency', 'differentiation', 'differentiationBasisRef'] };

export function applyEdit(project, op) {
  const p = clone(project);
  switch (op.type) {
    case 'setName': p.name = txt(op.value, 120); break;
    case 'setDisplay': {
      const lim = { brandName: 40, serviceDescriptor: 60, audienceLabel: 60, productLabel: 30, demoNotice: 100, operator: 80 };
      if (op.key === 'demoMode') { if (!DEMO_MODES.includes(op.value)) throw new Error('不明なデモ区分'); p.display.demoMode = op.value; }
      else if (op.key === 'category') { if (!CATEGORIES.includes(op.value)) throw new Error('不明なカテゴリ'); p.display.category = op.value; }
      else if (lim[op.key]) p.display[op.key] = txt(op.value, lim[op.key]);
      else throw new Error('不明な表示項目');
      if (p.display.demoMode !== 'live' && !p.display.demoNotice.trim()) throw new Error('デモ・試作ではデモ表示を空にできません');
      break;
    }
    case 'setBrand': {
      if (op.key === 'font') { if (!FONTS.includes(op.value)) throw new Error('不明なフォント'); p.brand.font = op.value; break; }
      if (!['primary', 'accent', 'ink', 'paper'].includes(op.key)) throw new Error('不明なtoken');
      const c = safeColor(op.value);
      if (!c) throw new Error('色は #RRGGBB で指定してください');
      p.brand[op.key] = c;
      break;
    }
    case 'setInput': {
      const [g, k] = String(op.path).split('.');
      if (!INPUT_GROUPS[g]?.includes(k)) throw new Error('不明な入力項目');
      p.inputs[g][k] = txt(op.value, 300);
      break;
    }
    case 'setPromiseLayer': {
      if (!['canDo', 'expectedChange', 'cannotGuarantee'].includes(op.key)) throw new Error('不明な層');
      const lines = Array.isArray(op.value) ? op.value : String(op.value).split('\n');
      p.inputs.promiseLayers[op.key] = lines.map((t) => (typeof t === 'string' ? { text: txt(t, 300), sourceRefs: [] } : { text: txt(t.text, 300), sourceRefs: t.sourceRefs || [] })).filter((x) => x.text.trim()).slice(0, 8);
      break;
    }
    case 'setAction': {
      const a = p.inputs.action;
      if (op.key === 'behavior') { if (!ACTION_BEHAVIORS.includes(op.value)) throw new Error('不明な行動'); a.behavior = op.value; break; }
      if (op.key === 'url') {
        const v = txt(op.value, 400);
        if (v && !safeUrl(v)) throw new Error('リンク先は https: / mailto: / tel: / #id のみ使えます');
        a.url = v; a.confirmed.url = false; break;
      }
      if (!['ctaLabel', 'price', 'duration', 'method', 'continuation', 'requiredInput'].includes(op.key)) throw new Error('不明な行動条件');
      a[op.key] = txt(op.value, op.key === 'ctaLabel' ? 40 : 200);
      if (a.confirmed[op.key] !== undefined) a.confirmed[op.key] = false; // 値を変えたら確認し直し
      break;
    }
    case 'confirmAction': {
      const a = p.inputs.action;
      if (!(op.key in a.confirmed)) throw new Error('不明な確認項目');
      if (op.value && op.key !== 'offer' && !String(a[op.key] || '').trim()) throw new Error('空の値は確定にできません');
      a.confirmed[op.key] = !!op.value;
      break;
    }
    case 'setDoNotAssert': p.inputs.doNotAssert = String(op.value).split('\n').map((x) => txt(x, 60)).filter(Boolean).slice(0, 20); break;
    case 'addLedger': {
      if (!LEDGER_KINDS.includes(op.kind) || !REALITY.includes(op.reality || 'unknown')) throw new Error('不明な種別');
      if (op.kind === 'customer-quote') throw new Error('顧客の原文は「顧客の原文」欄に、出典つきで入れてください');
      const id = op.id && /^[A-Za-z0-9_.-]{1,40}$/.test(op.id) && !p.ledger.some((l) => l.id === op.id) ? op.id : makeId('f');
      p.ledger.push({ id, text: txt(op.text, 300), kind: op.kind, reality: op.reality || 'unknown', origin: txt(op.origin || '手入力', 200) });
      break;
    }
    case 'updateLedger': {
      const l = p.ledger.find((x) => x.id === op.id);
      if (!l) throw new Error('台帳の項目が見つかりません');
      if (op.text !== undefined) l.text = txt(op.text, 300);
      if (op.kind !== undefined) { if (!LEDGER_KINDS.includes(op.kind) || op.kind === 'customer-quote') throw new Error('不明な種別'); l.kind = op.kind; }
      if (op.reality !== undefined) { if (!REALITY.includes(op.reality)) throw new Error('不明な区分'); l.reality = op.reality; }
      for (const s of p.sections) if ([...s.sourceRefs, ...s.items.flatMap((i) => i.sourceRefs)].includes(l.id)) { s.needsReview = true; s.approved = false; s.approvedHash = ''; }
      break;
    }
    case 'removeLedger': {
      p.ledger = p.ledger.filter((l) => l.id !== op.id);
      for (const s of p.sections) {
        const had = s.sourceRefs.includes(op.id) || s.items.some((i) => i.sourceRefs.includes(op.id));
        s.sourceRefs = s.sourceRefs.filter((r) => r !== op.id);
        s.items = s.items.map((i) => ({ ...i, sourceRefs: i.sourceRefs.filter((r) => r !== op.id) }));
        if (had) { s.needsReview = true; s.approved = false; s.approvedHash = ''; }
      }
      break;
    }
    case 'addQuote': {
      // 顧客の原文は人の入力だけ。収集方法・日付・使用可否が必須
      if (!txt(op.text, 300).trim() || !txt(op.speakerId, 40).trim() || !txt(op.method, 60).trim()) throw new Error('原文・発言者の匿名ID・収集方法は必須です');
      if (!isRealDate(op.date || '')) throw new Error('日付は YYYY-MM-DD');
      p.quotes.push({ id: makeId('q'), text: txt(op.text, 300), speakerId: txt(op.speakerId, 40), method: txt(op.method, 60), date: op.date, usable: !!op.usable, sourceRef: txt(op.sourceRef, 200), provenance: 'human' });
      break;
    }
    case 'addEvidence': {
      if (!EVIDENCE_KINDS.includes(op.kind || 'service-spec') || !REALITY.includes(op.reality || 'unknown')) throw new Error('不明な根拠の種類');
      const claim = txt(op.claim, 300);
      const metricValue = Number.isFinite(op.metricValue) ? op.metricValue : null;
      const metricUnit = String(op.metricUnit || '');
      if (!METRIC_UNITS.includes(metricUnit)) throw new Error(`単位は次から選んでください: ${METRIC_UNITS.filter(Boolean).join(' ')}`);
      if (metricValue != null && !metricMatches(claim, metricValue, metricUnit)) throw new Error('数値と単位は、主張文に含まれている組（例: 4.2日）だけを使えます');
      p.evidence.push({
        id: makeId('ev'), claim, kind: op.kind || 'service-spec', reality: op.reality || 'unknown', source: txt(op.source, 300), scope: txt(op.scope, 200), consent: !!op.consent, checkedAt: '',
        status: 'unverified', verifiedBy: '', verifiedAt: '', verifiedHash: '', provenance: 'human',
        metricValue, metricUnit, metricTarget: txt(op.metricTarget, 100), metricPeriod: txt(op.metricPeriod, 60), metricDenominator: txt(op.metricDenominator, 100), metricDefinition: txt(op.metricDefinition, 200), note: '',
      });
      break;
    }
    case 'verifyEvidence': {
      const e = p.evidence.find((x) => x.id === op.id);
      if (!e) throw new Error('根拠が見つかりません');
      if (op.value) {
        if (!String(op.verifiedBy || '').trim()) throw new Error('確認者を入力してください');
        if (!isRealDate(op.verifiedAt || '') || op.verifiedAt > new Date().toISOString().slice(0, 10)) throw new Error('確認日は実在する今日以前の日付（YYYY-MM-DD）');
        if (!e.source.trim()) throw new Error('出典が空の根拠は検証済みにできません');
        e.status = 'verified'; e.verifiedBy = txt(op.verifiedBy, 80); e.verifiedAt = op.verifiedAt; e.provenance = 'human'; e.verifiedHash = evidenceHash(e);
      } else { e.status = 'unverified'; e.verifiedBy = ''; e.verifiedAt = ''; e.verifiedHash = ''; }
      break;
    }
    case 'removeEvidence': {
      p.evidence = p.evidence.filter((e) => e.id !== op.id);
      for (const s of p.sections) { s.sourceRefs = s.sourceRefs.filter((r) => r !== op.id); s.items = s.items.map((i) => ({ ...i, sourceRefs: i.sourceRefs.filter((r) => r !== op.id) })); }
      break;
    }
    case 'chooseAngle': return chooseAngle(p, op.id);
    case 'setField': {
      const s = sec(p, op.id);
      if (!['heading', 'body', 'sub', 'note'].includes(op.field)) throw new Error('不明なフィールド');
      s[op.field] = txt(op.value, op.field === 'body' ? 1200 : op.field === 'heading' ? 120 : 200);
      if (op.field === 'heading') s.headingPhrases = []; // 見出しを変えたら改行候補は作り直し
      touch(s);
      break;
    }
    case 'setPhrases': {
      const s = sec(p, op.id);
      const list = (Array.isArray(op.value) ? op.value : String(op.value).split('/')).map((x) => txt(x, 60)).filter(Boolean).slice(0, 8);
      if (list.length && list.join('') !== s.heading) throw new Error('改行候補をつなげると見出しと一致する必要があります（「/」で区切る）');
      s.headingPhrases = list;
      touch(s);
      break;
    }
    case 'setItems': {
      const s = sec(p, op.id);
      const lines = Array.isArray(op.value) ? op.value : String(op.value).split('\n').filter((x) => x.trim()).map((x) => { const [h, ...b] = x.split('｜'); return { heading: h, body: b.join('｜') }; });
      s.items = lines.slice(0, 10).map((it, i) => ({ heading: txt(it.heading, 120), body: txt(it.body, 400), sourceRefs: it.sourceRefs || s.items[i]?.sourceRefs || [] }));
      touch(s);
      break;
    }
    case 'setRefs': {
      const s = sec(p, op.id);
      const ids = new Set([...p.ledger.map((l) => l.id), ...p.evidence.map((e) => e.id), ...p.quotes.map((q) => q.id)]);
      s.sourceRefs = (op.value || []).filter((r) => ids.has(r));
      touch(s);
      break;
    }
    case 'setVisual': {
      const s = sec(p, op.id);
      if (!s.visual) throw new Error('このセクションに図はありません');
      if (op.key === 'kind') { if (!VISUAL_KINDS.includes(op.value)) throw new Error('不明な図の種類'); s.visual.kind = op.value; }
      else if (['label', 'title', 'task', 'note', 'from', 'to', 'review'].includes(op.key)) s.visual[op.key] = txt(op.value, op.key === 'note' ? 160 : 120);
      else throw new Error('不明な図の項目');
      if (!/イメージ|例|架空/.test(s.visual.label)) throw new Error('図のラベルには「イメージ」「例」「架空」のいずれかを含めてください（実物・成果と誤認させない）');
      touch(s);
      break;
    }
    case 'setCtaLabel': {
      const s = sec(p, op.id);
      if (!s.cta) throw new Error('このセクションにCTAはありません');
      s.cta.label = txt(op.value, 40);
      touch(s);
      break;
    }
    case 'addSection': {
      if (!ROLES[op.role]) throw new Error('不明な役割');
      let id = op.role;
      while (p.sections.some((s) => s.id === id)) id = `${op.role}-${p.sections.length + 1}`;
      const s = { id, role: op.role, approved: false, approvedHash: '', needsReview: false, origin: 'manual', heading: '', headingPhrases: [], body: '', note: '', sourceRefs: [], items: [], visual: null, cta: null, commercialPreview: null };
      const at = Number.isInteger(op.at) ? Math.max(0, Math.min(op.at, p.sections.length)) : p.sections.length;
      p.sections.splice(at, 0, s);
      break;
    }
    case 'removeSection': {
      const s = sec(p, op.id);
      if (ROLES[s.role].required) throw new Error('FVと締めは削除できません（並べ替えは可能）');
      p.sections = p.sections.filter((x) => x.id !== op.id);
      for (const x of p.sections) if (x.cta?.target === op.id) x.cta = null;
      break;
    }
    case 'moveSection': {
      const i = p.sections.findIndex((s) => s.id === op.id);
      const j = i + (op.delta || 0);
      if (i < 0 || j < 0 || j >= p.sections.length) throw new Error('これ以上移動できません');
      const [s] = p.sections.splice(i, 1);
      p.sections.splice(j, 0, s);
      break;
    }
    case 'approveSection': {
      const s = sec(p, op.id);
      s.approved = !!op.value;
      s.approvedHash = op.value ? sectionHash(s, p.assets?.heroPortrait) : '';
      if (op.value) s.needsReview = false;
      break;
    }
    case 'setCtaVariant': {
      const v = p.cta.variants.find((x) => x.id === op.id);
      if (!v) throw new Error('CTA案が見つかりません');
      if (op.label !== undefined) v.label = txt(op.label, 40);
      if (op.color !== undefined) { const c = safeColor(op.color); if (!c) throw new Error('色は #RRGGBB で指定してください'); v.color = c; }
      if (op.timing !== undefined) { if (!CTA_TIMINGS.includes(op.timing)) throw new Error('不明な表示タイミング'); v.timing = op.timing; }
      break;
    }
    case 'addCtaVariant': {
      if (p.cta.variants.length >= 4) throw new Error('CTA案は4つまで');
      const used = new Set(p.cta.variants.map((v) => v.id));
      p.cta.variants.push({ id: ['a', 'b', 'c', 'd'].find((x) => !used.has(x)), label: '', color: '#1f6f5c', timing: 'spec' });
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
