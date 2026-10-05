import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAllTemplate, reangleTemplate, regenerateSectionTemplate, buildPrompt, ingestGenerated, ADAPTERS } from '../../src/core/generate.js';
import { SECTION_CATALOG } from '../../src/core/sections.js';
import { validateProject, serializeProject } from '../../src/core/schema.js';
import { seed } from './helpers.mjs';

const ok = (p) => assert.ok(validateProject(JSON.parse(serializeProject(p))).ok);

test('アダプタの接続状態を偽らない', () => {
  assert.equal(ADAPTERS.template.connected, true);
  assert.match(ADAPTERS.template.label, /AI生成ではない/);
  assert.equal(ADAPTERS['claude-code'].connected, false);
});

test('モード1: テンプレート全体作成は必須セクションを揃え、全て未承認', () => {
  const p = generateAllTemplate(seed());
  ok(p);
  for (const [t, m] of Object.entries(SECTION_CATALOG)) if (m.required) assert.ok(p.sections.some((s) => s.type === t), t);
  assert.ok(p.sections.every((s) => !s.approved && s.origin === 'template'));
  assert.ok(!p.sections.some((s) => s.type === 'concept_video'));
  assert.ok(generateAllTemplate(seed(), { includeVideo: true }).sections.some((s) => s.type === 'concept_video'));
  // 架空の実績値を作らない
  const text = JSON.stringify(p.sections);
  assert.doesNotMatch(text, /\d+\s*(人|名|%|％)/);
});

test('モード2: 訴求変更は訴求系だけ作り直し、残りに要再確認', () => {
  const p = reangleTemplate(seed(), '週末に崩れない学習リズムをつくる');
  ok(p);
  assert.equal(p.brief.promise.status, 'unconfirmed');
  const empathy = p.sections.find((s) => s.type === 'empathy');
  assert.equal(empathy.needsReview, true);
  assert.equal(empathy.fields.heading, seed().sections.find((s) => s.type === 'empathy').fields.heading); // 内容は保持
  assert.equal(p.sections.find((s) => s.type === 'footer').needsReview, false);
  assert.equal(p.sections.find((s) => s.type === 'fv').origin, 'template');
});

test('モード3: セクション単体の作り直し', () => {
  const p = regenerateSectionTemplate(seed(), 'empathy');
  ok(p);
  assert.equal(p.sections.find((s) => s.id === 'empathy').origin, 'template');
  assert.equal(p.sections.find((s) => s.id === 'fv').origin, 'manual');
});

test('buildPrompt は禁止事項・denylist・ブリーフ状態・JSON契約を含む', () => {
  const t = buildPrompt(seed(), 'full');
  for (const s of ['禁止事項', '1140人', 'offer（オファー（条件））[unconfirmed]', '"generator": "claude-code"', '【要記入']) assert.ok(t.includes(s), s);
});

const resp = (o) => JSON.stringify({ generator: 'claude-code', mode: 'full', ...o });

test('ingest: 生成物は未承認・根拠候補は未検証に強制される', () => {
  const r = ingestGenerated(seed(), resp({
    sections: [{ type: 'fv', fields: { heading: '{{promise}}', lead: 'テスト' }, claimRefs: ['ev-plan', 'ev-nope'] }],
    evidenceCandidates: [{ claim: '面談満足度98%', source: '要確認' }],
  }), { mode: 'full' });
  assert.ok(r.ok, r.report.errors.join());
  ok(r.project);
  assert.ok(r.project.sections.every((s) => s.approved === false));
  assert.equal(r.project.sections[0].origin, 'claude-code');
  assert.deepEqual(r.project.sections[0].claimRefs, ['ev-plan']);
  const cand = r.project.evidence.find((e) => e.claim === '面談満足度98%');
  assert.equal(cand.status, 'unverified');
  assert.equal(cand.provenance, 'claude-code');
  assert.ok(r.report.warnings.some((w) => /テンプレートで補い/.test(w)));
});

test('ingest: denylist・HTML・URL を含むフィールドは拒否', () => {
  const r = ingestGenerated(seed(), resp({ sections: [{ type: 'fv', fields: { heading: '受講生1,140人が選んだ', lead: '<script>alert(1)</script>', body: 'https://evil.example', items: ['3日間で完成', 'ok'] } }] }), { mode: 'full' });
  assert.ok(r.ok);
  const fv = r.project.sections.find((s) => s.type === 'fv');
  assert.equal(fv.fields.heading, '');
  assert.equal(fv.fields.lead, '');
  assert.equal(fv.fields.body, '');
  assert.deepEqual(fv.fields.items, ['ok']);
  assert.equal(r.report.rejected.length, 4);
});

test('ingest: 不正な応答は取り込まない', () => {
  const p = seed();
  for (const bad of ['not json', '{}', resp({ sections: [] }), resp({ sections: [{ type: 'evil', fields: {} }] }), '{"__proto__":{"x":1},"generator":"claude-code","mode":"full","sections":[]}', JSON.stringify({ generator: 'other', mode: 'full', sections: [{ type: 'fv', fields: {} }] })]) {
    const r = ingestGenerated(p, bad, { mode: 'full' });
    assert.equal(r.ok, false, bad);
    assert.equal(r.project, p);
  }
  assert.equal(ingestGenerated(p, resp({ sections: [{ type: 'fv', fields: {} }] }), { mode: 'reangle' }).ok, false);
});

test('ingest: 訴求変更とセクション編集', () => {
  const p = seed();
  const r = ingestGenerated(p, JSON.stringify({ generator: 'claude-code', mode: 'reangle', promise: '新しい約束', sections: [{ type: 'fv', fields: { heading: '{{promise}}' } }, { type: 'empathy', fields: { heading: 'x' } }] }), { mode: 'reangle' });
  assert.ok(r.ok);
  assert.equal(r.project.brief.promise.value, '新しい約束');
  assert.equal(r.project.sections.find((s) => s.type === 'fv').id, 'fv'); // ID保持
  assert.equal(r.project.sections.find((s) => s.type === 'empathy').needsReview, true);
  const s = ingestGenerated(p, '```json\n' + JSON.stringify({ generator: 'claude-code', mode: 'section', sections: [{ type: 'empathy', fields: { heading: '書き直し' } }] }) + '\n```', { mode: 'section', sectionId: 'empathy' });
  assert.ok(s.ok, s.report.errors.join());
  assert.equal(s.project.sections.find((x) => x.id === 'empathy').fields.heading, '書き直し');
});
