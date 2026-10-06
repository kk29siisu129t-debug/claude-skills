// docs/TESTS.md の「未カバー」の項目を埋めるテスト（v1 にあり、v2 で検査が抜けていたもの）
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { applyEdit } from '../../src/core/model.js';
import { renderPage, renderWireframe, exportHtml, contrastChecks } from '../../src/core/render.js';
import { checkProject, gates } from '../../src/core/editorial.js';
import { ingestGenerated, applySkeleton } from '../../src/core/generate.js';
import { validateProject, serializeProject, parseProjectJson } from '../../src/core/schema.js';
import { detectClaims, containsToken, metricMatches } from '../../src/core/claims.js';
import { ROLES } from '../../src/core/roles.js';
import { seed, brief, RESPONSE } from './helpers.mjs';

test('根拠の検証: 確認者・実在する日付・出典が必須、取り消しで確認者も消える', () => {
  const p = applyEdit(seed(), { type: 'addEvidence', claim: '架空の検証用メモ', kind: 'service-spec', reality: 'synthetic', source: '架空の社内資料' });
  const id = p.evidence.at(-1).id;
  assert.throws(() => applyEdit(p, { type: 'verifyEvidence', id, value: true, verifiedBy: '', verifiedAt: '2026-10-01' }), /確認者/);
  for (const d of ['2026-02-30', '2026/10/01', '20261001', '2999-01-01']) assert.throws(() => applyEdit(p, { type: 'verifyEvidence', id, value: true, verifiedBy: '確認者A', verifiedAt: d }), /確認日/, d);
  const v = applyEdit(p, { type: 'verifyEvidence', id, value: true, verifiedBy: '確認者A', verifiedAt: '2026-10-01' });
  assert.equal(v.evidence.at(-1).status, 'verified');
  const u = applyEdit(v, { type: 'verifyEvidence', id, value: false });
  assert.deepEqual([u.evidence.at(-1).status, u.evidence.at(-1).verifiedBy, u.evidence.at(-1).verifiedAt], ['unverified', '', '']);
  // 読込: 実在しない確認日は未検証に戻す
  const raw = JSON.parse(serializeProject(v));
  raw.evidence.at(-1).verifiedAt = '2026-02-30';
  const re = validateProject(raw);
  assert.equal(re.project.evidence.at(-1).status, 'unverified');
  assert.ok(re.warnings.some((w) => /未検証/.test(w)), JSON.stringify(re.warnings));
  // 検証後に主張を書き換えて読み込むと、未検証に戻し、その旨を警告する
  const raw2 = JSON.parse(serializeProject(v));
  raw2.evidence.at(-1).claim = '書き換えた主張';
  const re2 = validateProject(raw2);
  assert.equal(re2.project.evidence.at(-1).status, 'unverified');
  assert.ok(re2.warnings.some((w) => /未検証/.test(w)), JSON.stringify(re2.warnings));
});

test('schema: 重複したセクション id・型違い・null・v0 移行・未知キーと HTML 風の文字列の警告・架空でない LPO データ', () => {
  const p = JSON.parse(serializeProject(seed()));
  const dup = JSON.parse(JSON.stringify(p)); dup.sections[1].id = dup.sections[0].id;
  assert.equal(validateProject(dup).ok, false);
  const typ = JSON.parse(JSON.stringify(p)); typ.sections[0].approved = 'yes';
  assert.ok(validateProject(typ).errors.some((e) => /approved/.test(e)));
  assert.equal(parseProjectJson('null').ok, false);
  const unk = JSON.parse(JSON.stringify(p)); unk.extraKey = 1;
  const r = validateProject(unk);
  assert.ok(r.ok && !('extraKey' in r.project) && r.warnings.some((w) => /extraKey/.test(w)));
  const htmlish = applyEdit(seed(), { type: 'setField', id: 'empathy', field: 'body', value: '<b>太字</b>のつもり。' });
  const again = validateProject(JSON.parse(serializeProject(htmlish)));
  assert.ok(again.project.sections.find((s) => s.role === 'empathy').body.includes('<b>'), 'テキストとして保持');
  assert.ok(!renderPage(again.project, { kind: 'review' }).html.includes('<b>太字</b>'), '描画ではエスケープ');
  const lpo = JSON.parse(JSON.stringify(p)); lpo.lpo.dataset.fictional = false;
  assert.equal(validateProject(lpo).ok, false);
  // v0（版番号なし・ブリーフ値が素の文字列）→ v1 → v2 と移行し、未確認・未承認として扱う。未対応の版は拒否
  const v0src = JSON.parse(readFileSync(new URL('../../examples/v1/claude-code-run/project.reviewed.json', import.meta.url), 'utf8'));
  delete v0src.schemaVersion;
  for (const k of Object.keys(v0src.brief)) if (k !== 'category' && v0src.brief[k] && typeof v0src.brief[k] === 'object') v0src.brief[k] = v0src.brief[k].value;
  const v0 = validateProject(v0src);
  assert.ok(v0.ok, v0.errors.join());
  assert.equal(v0.project.schemaVersion, 2);
  assert.ok(v0.warnings.some((w) => /v0 → v1/.test(w)) && v0.warnings.some((w) => /v1 → v2/.test(w)));
  assert.ok(v0.project.sections.every((s) => !s.approved && s.needsReview));
  assert.equal(validateProject({ ...v0src, schemaVersion: 99 }).ok, false);
});

test('編集段階でも危険な色・キーを拒否する', () => {
  assert.throws(() => applyEdit(seed(), { type: 'setBrand', key: 'primary', value: 'red;background:url(x)' }));
  assert.throws(() => applyEdit(seed(), { type: 'setBrand', key: '__proto__', value: '#000000' }));
  const vid = seed().cta.variants[0].id;
  for (const c of ['red', '#fff', 'url(x)', '#12345g']) assert.throws(() => applyEdit(seed(), { type: 'setCtaVariant', id: vid, color: c }), /#RRGGBB/, c);
  assert.throws(() => applyEdit(seed(), { type: 'setCtaVariant', id: vid, timing: 'always' }), /タイミング/);
});

test('ingest: URL を含む欄は除外、骨組みは必須セクションを揃える', () => {
  const r = JSON.parse(RESPONSE('michishirube'));
  r.sections.find((s) => s.role === 'empathy').body = '詳しくは https://example.com を見てください。';
  const g = ingestGenerated(brief('michishirube'), JSON.stringify(r), { mode: 'full' });
  assert.equal(g.project.sections.find((s) => s.role === 'empathy').body, '');
  assert.ok(g.report.rejected.some((x) => /empathy\.body/.test(x)));
  const sk = applySkeleton(brief('mitsumoriban'));
  for (const role of Object.keys(ROLES).filter((k) => ROLES[k].required)) assert.ok(sk.sections.some((s) => s.role === role), role);
});

test('コントラスト: 色を変えても、読めない組み合わせのまま書き出さない（主色だけの変更も含む）', () => {
  for (const [key, value] of [['primary', '#f4f4f4'], ['primary', '#ffff00'], ['accent', '#fafafa'], ['ink', '#cccccc'], ['paper', '#000000']]) {
    const p = applyEdit(seed(), { type: 'setBrand', key, value });
    const html = exportHtml(p, 'review').html;
    if (html) assert.ok(contrastChecks(p).every((c) => c.ok), `${key} ${value}: 読めない組み合わせで書き出した`);
  }
  assert.equal(exportHtml(applyEdit(seed(), { type: 'setBrand', key: 'ink', value: '#cccccc' }), 'review').html, null);
});

test('数値の照合: 4 は 4.2 に無い・120人は 12 を裏付けない・X/Y 単位', () => {
  assert.equal(containsToken('平均4.2日', '4'), false);
  assert.equal(containsToken('120人が参加', '12'), false);
  assert.equal(containsToken('12人が参加', '12'), true);
  assert.equal(metricMatches('週4.2日', 4.2, '日/週'), true);
  assert.equal(metricMatches('1週あたり4.2日', 4.2, '日/週'), true);
  assert.equal(metricMatches('4.2日', 4.2, '日/週'), false); // 「/週」側が無い
  assert.equal(metricMatches('月4.2日', 4.2, '日/週'), false); // 対象の期間が違う
  assert.equal(metricMatches('1日あたり30分', 30, '分/日'), true);
  assert.equal(metricMatches('週30分', 30, '分/日'), false);
  assert.equal(metricMatches('満足度92%', 92, '%'), true);
  assert.equal(metricMatches('満足度9%', 92, '%'), false);
  assert.equal(containsToken('91%', '1%'), false);
  assert.equal(containsToken('2026年', '202'), false);
  // 「十分」は熟語のときだけ除外し、所要時間の主張（十分で終わる）は数値として扱う
  assert.equal(detectClaims('十分に注意します。').length, 0);
  const ten = applyEdit(seed(), { type: 'setItems', id: 'faq', value: [{ heading: '面談について', body: '面談は十分で終わります。' }] });
  assert.ok(checkProject(ten).some((i) => i.level === 'stop'), '十分（10分）の面談');
  // 根拠の追加: 主張文に無い数値・単位の組は拒否（120人 に 12人 は無い）
  assert.throws(() => applyEdit(seed(), { type: 'addEvidence', claim: '参加者は120人', kind: 'outcome-aggregate', reality: 'real', source: '例', metricValue: 12, metricUnit: '人' }), /主張文/);
  assert.throws(() => applyEdit(seed(), { type: 'addEvidence', claim: '平均4.2日', kind: 'outcome-aggregate', reality: 'real', source: '例', metricValue: 4.2, metricUnit: '日/週' }), /主張文/);
  // 読込: 主張文と合わない指標は外して警告
  const raw = JSON.parse(serializeProject(seed()));
  raw.evidence[0].metricValue = 9.9;
  const r = validateProject(raw);
  assert.ok(r.ok);
  assert.ok(r.project.evidence[0].metricValue === null || r.warnings.some((w) => /metric|指標|数値/.test(w)), JSON.stringify(r.warnings));
});

test('XSS: 根拠の文言・プロジェクト名からも注入されない', () => {
  const x = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
  let p = applyEdit(seed(), { type: 'setName', value: x });
  p = applyEdit(p, { type: 'addEvidence', claim: x, kind: 'service-spec', reality: 'synthetic', source: x });
  for (const kind of ['draft', 'review']) {
    const h = renderPage(p, { kind }).html;
    assert.equal((h.match(/<script\b/g) || []).length, 2);
    assert.doesNotMatch(h.replace(/="[^"]*"/g, '=""'), /<img[^>]*onerror/);
  }
});

test('実販売の判定: 未承認・運営者未確定・薬機法の語彙を理由に出す', () => {
  const g = gates(seed()).commercialReady;
  assert.ok(g.reasons.some((r) => r.startsWith('未承認')));
  assert.ok(g.reasons.some((r) => /運営者/.test(r)));
  // 薬機法の語彙は業種（美容・健康）の project で、checkProject を通して止める
  const beauty = { ...applyEdit(seed(), { type: 'setField', id: 'empathy', field: 'body', value: '使うほど肌が若返る。' }), display: { ...seed().display, category: 'beauty' } };
  assert.ok(checkProject(beauty).some((i) => i.level === 'stop' && /若返/.test(i.message)), JSON.stringify(checkProject(beauty).filter((i) => i.level === 'stop').map((i) => i.message)));
});

test('セクションの並べ替えは保存→再読込で保たれる（境界は拒否）', () => {
  const p = applyEdit(seed(), { type: 'moveSection', id: 'faq', delta: -1 });
  const order = p.sections.map((s) => s.id);
  assert.notDeepEqual(order, seed().sections.map((s) => s.id));
  assert.deepEqual(validateProject(JSON.parse(serializeProject(p))).project.sections.map((s) => s.id), order);
  assert.throws(() => applyEdit(seed(), { type: 'moveSection', id: seed().sections[0].id, delta: -1 }));
});

test('CTA の文言（FV・締め・固定CTAの案）も、主張には対象・意味・単位の合う根拠が要る', () => {
  const stopCodes = (p) => checkProject(p).filter((i) => i.level === 'stop').map((i) => i.code);
  for (const id of ['hero', 'closing']) {
    for (const [v, code] of [['無料で相談する', 'claim-unsupported'], ['合格率No.1の講座を見る', 'claim-unsupported'], ['必ず合格できる計画', 'claim-unsupported'], ['満足度92%の計画を見る', 'number-unsupported'], ['15分で終わる面談を予約', 'unknown-filled'], ['30分の面談を予約', 'number-unsupported']]) {
      assert.ok(stopCodes(applyEdit(seed(), { type: 'setCtaLabel', id, value: v })).includes(code), `${id}: ${v}`);
    }
    assert.deepEqual(stopCodes(applyEdit(seed(), { type: 'setCtaLabel', id, value: '学習サポートを見る' })), []);
  }
  // 固定CTAの文言案
  const vid = seed().cta.variants[0].id;
  for (const v of ['無料で相談する', '満足度92%の講座']) assert.ok(stopCodes(applyEdit(seed(), { type: 'setCtaVariant', id: vid, label: v })).length > 0, v);
  // 単位・期間の取り違え: 実在・検証済みの「週4.2日」を参照しても「月4.2日」「4.2時間」は止める。「週4.2日」は通す
  let p = applyEdit(seed(), { type: 'addEvidence', claim: '利用者の平均学習日数は週4.2日', kind: 'outcome-aggregate', reality: 'real', source: '社内集計（検証用の例）', metricValue: 4.2, metricUnit: '日/週', metricTarget: '利用者', metricPeriod: '4週間', metricDenominator: '100人', metricDefinition: '学習した日数の週平均' });
  const ev = p.evidence.at(-1).id;
  p = applyEdit(p, { type: 'verifyEvidence', id: ev, value: true, verifiedBy: '確認者A', verifiedAt: '2026-10-01' });
  p = applyEdit(p, { type: 'setRefs', id: 'closing', value: [...p.sections.find((s) => s.role === 'closing').sourceRefs, ev] });
  for (const [v, ok] of [['週4.2日の学習を見る', true], ['月4.2日の学習を見る', false], ['4.2時間の学習を見る', false]]) {
    const codes = stopCodes(applyEdit(p, { type: 'setCtaLabel', id: 'closing', value: v }));
    assert.equal(!codes.includes('metric-mismatch') && !codes.includes('number-unsupported'), ok, `${v}: ${codes}`);
  }
  // 提供者の申告・未検証の根拠だけで裏づけた主張は、レビュー用は出せても実販売の理由に残る
  const prov = applyEdit(seed(), { type: 'addLedger', text: '当社の講座は業界No.1', kind: 'provider-claim' });
  const lid = prov.ledger.at(-1).id;
  const q = applyEdit(applyEdit(prov, { type: 'setRefs', id: 'closing', value: [...prov.sections.find((s) => s.role === 'closing').sourceRefs, lid] }), { type: 'setCtaLabel', id: 'closing', value: '業界No.1の講座を見る' });
  assert.ok(!stopCodes(q).includes('claim-unsupported'));
  assert.ok(gates(q).commercialReady.reasons.some((r) => /No\.1/.test(r) && /検証済み/.test(r)));
  // 断り書き（保証するものではありません）は主張として扱わない
  assert.ok(!checkProject(seed()).some((i) => i.code === 'claim-unverified'));
});

test('XSS: project のすべての文字列欄（約200か所）から、タグ・属性・スクリプトを注入できない', () => {
  const payload = '"><script>alert(1)</script><img src=x onerror=alert(2)><svg onload=alert(3)>\'`';
  const base = JSON.parse(serializeProject(seed()));
  base.sections.find((s) => s.role === 'process').items[0].body = 'x'; // 空欄も対象にする
  const paths = [];
  (function walk(o, path) {
    if (typeof o === 'string') { paths.push(path); return; }
    if (Array.isArray(o)) o.forEach((v, i) => walk(v, [...path, i]));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, [...path, k]);
  })(base, []);
  let rendered = 0;
  for (const path of paths) {
    const p = JSON.parse(JSON.stringify(base));
    let o = p;
    for (const k of path.slice(0, -1)) o = o[k];
    o[path.at(-1)] = payload;
    const r = validateProject(p);
    if (!r.ok) continue; // 形式の合わない欄（id・URL・色・日付・画像など）は読込で拒否
    rendered++;
    for (const html of [renderPage(r.project, { kind: 'draft' }).html, renderPage(r.project, { kind: 'review' }).html, renderWireframe(r.project)]) {
      // 実際のタグだけを見る（属性値は伏せる。escape された文字列はタグにならない）
      const tags = html.replace(/="[^"]*"/g, '=""').match(/<[a-z][^>]*>/gi) || [];
      assert.ok(tags.filter((t) => /^<script\b/i.test(t)).length <= 2, path.join('.'));
      assert.ok(!tags.some((t) => /\son[a-z]+\s*=|^<svg|^<iframe|^<object|^<embed/i.test(t)), `${path.join('.')}: ${tags.find((t) => /\son[a-z]+\s*=|^<svg/i.test(t))}`);
      assert.ok(tags.filter((t) => /^<img\b/i.test(t)).length <= 1, path.join('.'));
      assert.ok(!/<img[^>]+src="x"/.test(html), path.join('.'));
      assert.ok(!html.includes('<script>alert'), path.join('.'));
    }
  }
  assert.ok(rendered > 150, `描画まで通った欄 ${rendered}`);
});

test('保存→再読込で、インサイトの公開資料の参照に誤った警告を出さず、そのまま保つ', () => {
  const r = validateProject(JSON.parse(serializeProject(seed())));
  assert.ok(r.ok);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.project, seed());
});
