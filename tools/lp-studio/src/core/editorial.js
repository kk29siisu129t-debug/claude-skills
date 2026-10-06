// 編集上の検査と公開判定（v2）。
// 公開判定は2段:
//   reviewPreview   … レビュー用に安全に描画できる（重大な停止条件が無い。CTA は実行されない）
//   commercialReady … 実販売向けに公開準備が整っている（live・条件確定・全承認・実在の根拠）
// 「verified」や seed の有無だけで事実性・公開可否を決めない。

import { refIndex, isRealOperator } from './schema.js';
import { ROLES } from './roles.js';
import { canon, containsToken, detectClaims, metricMatches, PLACEHOLDER_RE } from './claims.js';
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
  for (const k of ['brandName', 'serviceDescriptor', 'audienceLabel', 'productLabel']) if (d[k]) out.push({ sectionId: null, role: 'display', field: `display.${k}`, text: d[k], refs: [] });
  for (const s of project.sections) {
    const base = s.sourceRefs || [];
    const itemRefs = s.items.flatMap((i) => i.sourceRefs || []);
    const push = (field, text, refs = [], context = '') => { if (text && String(text).trim()) out.push({ sectionId: s.id, role: s.role, field, text: String(text), refs: [...new Set([...refs, ...base])], context }); };
    push('heading', s.heading, [...itemRefs, ...(s.visual?.sourceRefs || [])]); // 見出しは項目・図の参照もあわせて判断
    push('body', s.body, [], s.heading);
    push('sub', s.sub);
    push('note', s.note);
    s.items.forEach((it, i) => { push(`items[${i}].heading`, it.heading, it.sourceRefs, s.heading); push(`items[${i}].body`, it.body, it.sourceRefs, `${s.heading}\n${it.heading}`); });
    if (s.visual) {
      const v = s.visual;
      for (const k of ['title', 'task', 'from', 'to', 'review', 'note']) push(`visual.${k}`, v[k], v.sourceRefs);
      (v.rows || []).forEach((row, i) => push(`visual.rows[${i}]`, row.join(' / '), v.sourceRefs));
    }
    if (s.cta) push('cta.label', s.cta.label);
    if (s.commercialPreview) { push('commercialPreview.label', s.commercialPreview.label); push('commercialPreview.note', s.commercialPreview.note); }
  }
  // 固定CTAの文言案も公開される文言。FV と締めの参照で裏づける
  const ctaRefs = project.sections.filter((s) => s.role === 'hero' || s.role === 'closing').flatMap((s) => s.sourceRefs || []);
  for (const v of project.cta?.variants || []) if (v.label?.trim()) out.push({ sectionId: null, role: 'cta', field: `cta.variants.${v.id}`, text: v.label, refs: [...new Set(ctaRefs)] });
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
  const numWarned = new Set(); // 数値の裏づけ警告は数値ごとに1件

  for (const t of texts) {
    const where = { sectionId: t.sectionId, field: t.field };
    const label = t.role === 'display' ? `表示名/${t.field.slice(8)}` : `${ROLES[t.role]?.label || t.role}/${t.field}`;
    if (TOKEN_RE.test(t.text)) issues.push(ISSUE('stop', 'token', `${label}: 未展開の差込「${t.text.match(TOKEN_RE)[0]}」があります`, where));
    if (PLACEHOLDER_RE.test(t.text)) issues.push(ISSUE('stop', 'placeholder', `${label}: 【要記入】が残っています`, where));
    const refTexts = [];
    const refHits = [];
    for (const r of t.refs) {
      const hit = idx.get(r);
      if (!hit) { issues.push(ISSUE('stop', 'ref-missing', `${label}: 参照ID「${r}」が台帳にありません`, where)); continue; }
      if (hit.type === 'public') { issues.push(ISSUE('stop', 'public-as-evidence', `${label}: 公開資料「${hit.item.title || hit.item.id}」を LP の根拠にしています（公開体験・競合資料は課題理解とインサイト仮説だけに使う）`, where)); continue; }
      if (hit.type === 'ledger' && hit.kind === 'unknown') issues.push(ISSUE('stop', 'unknown-as-fact', `${label}: 不明な項目「${hit.text}」を根拠にしています`, where));
      if (hit.type === 'evidence' && hit.kind === 'outcome-aggregate' && hit.reality !== 'real') issues.push(ISSUE('stop', 'synthetic-outcome', `${label}: 合成・未確認の成果データ「${hit.text.slice(0, 30)}」を根拠にしています（成果としては出せません）`, where));
      refTexts.push(hit.text);
      refHits.push(hit);
    }
    const refJoined = refTexts.join('\n');
    // 数値は参照先にあること
    const ct = canon(t.text);
    for (const m of ct.matchAll(NUMBER_RE)) {
      const tok = m[0];
      if ((ct[m.index - 1] === '月' && /[0-9]/.test(ct[m.index - 2] || '')) || /^[0-9]{1,2}月[0-9]{1,2}日/.test(ct.slice(m.index))) continue; // 日付（10月8日）は数量の主張ではない（「月4.2日」は数量）
      if (!refTexts.some((rt) => containsToken(rt, tok))) { issues.push(ISSUE('stop', 'number-unsupported', `${label}: 数値「${tok}」が参照した事実にありません`, where)); continue; }
      // 期間の取り違え: 参照先の文で数値に付いている期間（週・月・日・年）と、コピーの期間が違えば止める（指標の有無によらない）
      const periodOf = (str, at) => { const m2 = str.slice(Math.max(0, at - 7), at).match(/(毎週|1週間あたり|1週あたり|1週間で|1週間に|週平均|週に|週|毎月|1か月あたり|1か月で|1カ月で|1ヶ月で|月平均|月に|月|毎日|1日あたり|1日で|日平均|日に|毎年|1年で|年間|年に|年)$/); return m2 ? (m2[1].match(/[週月日年]/)?.[0] || '') : ''; };
      const mine = periodOf(ct, m.index);
      const theirs = refTexts.map((rt) => { const c2 = canon(rt); const at = c2.search(new RegExp(`(?<![0-9.])${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)); return at >= 0 ? periodOf(c2, at) : null; }).filter((x) => x !== null);
      if (theirs.length && !theirs.includes(mine)) issues.push(ISSUE('stop', 'metric-mismatch', `${label}: 「${mine}${tok}」は参照先の「${theirs[0]}${tok}」と期間が合いません`, where));
      // 実販売: 数値の裏づけは、実在・検証済みの根拠か、確定した仕様（verified-spec・確定した行動条件）だけ
      const numVerified = refHits.some((h) => containsToken(h.text, tok) && ((h.type === 'evidence' && h.reality === 'real' && h.item.status === 'verified') || (h.type === 'ledger' && h.kind === 'verified-spec' && h.reality === 'real') || h.type === 'action'));
      if (!numVerified && !numWarned.has(tok)) { numWarned.add(tok); issues.push(ISSUE('warn', 'claim-unverified', `${label} ほか: 数値「${tok}」の裏づけが実在・検証済みの根拠・確定した仕様ではありません（実販売では出せません）`, where)); }
      // 指標つきの根拠と同じ数値なら、単位・期間（X/Y）まで一致すること（週4.2日 ≠ 月4.2日 ≠ 4.2時間）
      const num = parseFloat(tok.replace(/[^0-9.]/g, ''));
      for (const h of refHits.filter((x) => x.type === 'evidence' && x.item.metricValue === num && x.item.metricUnit)) {
        if (!metricMatches(t.text, h.item.metricValue, h.item.metricUnit)) issues.push(ISSUE('stop', 'metric-mismatch', `${label}: 「${tok}」は根拠「${h.item.id}」の単位（${h.item.metricUnit}）と対象が合いません`, where));
      }
    }
    // 未確定の条件を別の数値で埋めていないか（例: 学習の15分を面談の15分にする）
    // 対象（面談など）が、この文・前の文・項目の見出し・セクションの見出しのどこかで出たあと、数量が出たら止める。
    // ただし、その数量が参照先の事実で別の対象に付いている語（例: 「15分の単位」の「単位」）と一緒に書かれていれば、その事実の意味なので止めない
    const cls = clauses(t.text);
    const subjOf = (u, cc) => (u.subject ? synonymsOf(u.subject).some((w) => cc.includes(canon(w))) : true);
    const ctx = canon(t.context || '');
    const filled = new Set();
    // 免除: 参照先の事実で数値が修飾している対象（学習・計画・内容など。数値の隣の語や未確定の対象そのものは除く）が、同じ文の中で明示されているとき
    const unknownWords = new Set(unknowns.flatMap((u) => synonymsOf(u.subject)));
    const factSubjects = (cc) => {
      const out = new Set();
      for (const m of cc.matchAll(NUMBER_RE)) {
        const tok = canon(m[0]);
        for (const rt of refTexts) {
          const c2 = canon(rt);
          const at = c2.indexOf(tok);
          if (at < 0) continue;
          const near = c2.slice(Math.max(0, at - 6), at + tok.length + 6);
          for (const w of c2.match(/[\p{Script=Han}]{2,}/gu) || []) {
            if (near.includes(w) || unknownWords.has(w) || [...unknownWords].some((u) => w.includes(u))) continue;
            for (let k = 0; k + 2 <= w.length; k++) out.add(w.slice(k, k + 2));
          }
        }
      }
      return out;
    };
    let seen = '';
    const sentences = String(t.text).split(/(?<=[。！？!?\n])/);
    for (const sentence of sentences) {
      let sent = '';
      for (const c of clauses(sentence)) {
      const cc = canon(c);
      seen += cc;
      sent += cc;
      for (const u of unknowns) {
        if (filled.has(u.id) || !u.test.test(cc)) continue;
        if (!(subjOf(u, cc) || subjOf(u, seen) || subjOf(u, ctx))) continue;
        if (!subjOf(u, cc)) { const fs = factSubjects(cc); if ([...fs].some((w) => sent.includes(w))) continue; }
        filled.add(u.id);
        issues.push(ISSUE('stop', 'unknown-filled', `${label}: 「${u.text}」は未確定なのに「${c}」と書いています（別の数値や条件で埋めない）`, where));
      }
      }
    }
    for (const c of cls) {
      const cc = canon(c);
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
      if (!containsToken(refJoined, c.match)) { issues.push(ISSUE('stop', 'claim-unsupported', `${label}: ${c.label}「${c.match}」に裏づけがありません`, where)); continue; }
      // 実販売では、主張の裏づけは実在・検証済みの根拠だけ（提供者の申告・未検証の根拠では出さない）
      const verified = refHits.some((h) => h.type === 'evidence' && h.reality === 'real' && h.item.status === 'verified' && containsToken(h.text, c.match));
      const at = t.text.indexOf(c.match);
      const negated = at >= 0 && /^[^。！？]{0,12}?(ではありません|しません|はしない|ではない|できません)/.test(t.text.slice(at + c.match.length)); // 「保証するものではありません」は主張でなく断り書き
      if (!verified && !negated) issues.push(ISSUE('warn', 'claim-unverified', `${label}: ${c.label}「${c.match}」の裏づけが実在・検証済みの根拠ではありません（実販売では出せません）`, where));
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
  else if (!hero.heading.trim()) issues.push(ISSUE('stop', 'empty-heading', 'FV の見出し（H1）が空です', { sectionId: hero.id }));
  for (const s of project.sections) if (s.role === 'faq') s.items.forEach((it, i) => { if (!!it.heading.trim() !== !!it.body.trim()) issues.push(ISSUE('warn', 'faq-incomplete', `よくある質問/${i + 1}: 質問と答えの片方が空のため出力しません`, { sectionId: s.id })); });
  if (!project.sections.some((s) => s.role === 'closing')) issues.push(ISSUE('warn', 'no-closing', '締め（closing）がありません'));
  for (const s of project.sections) {
    const hasContent = s.body.trim() || (s.role === 'hero' && s.sub?.trim()) || s.items.some((i) => i.heading || i.body) || s.visual;
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
    const heroText = [hero.heading, hero.sub, hero.body].join('\n');
    const d = project.display;
    if (d.brandName && canon(hero.heading).includes(canon(d.brandName))) issues.push(ISSUE('warn', 'brand-in-headline', 'FV見出しにブランド名が入っています（見出しは読者の場面と変化に使う）', { sectionId: hero.id }));
    if (d.audienceLabel && heroText.includes(d.audienceLabel)) issues.push(ISSUE('warn', 'repeat-audience', 'FVで対象者の呼びかけを繰り返しています（呼びかけは1回）', { sectionId: hero.id }));
    // FV は SP 基準で短く: FV 内に出る文字（説明文・注記は FV の下に出るので数えない）
    const fv = fvTextOf(project, hero);
    const max = project.fvDesign?.maxChars || 80;
    if (fv.length > max) issues.push(ISSUE('warn', 'fv-long', `FV の文字が${fv.length}字です（目安${max}字以内。説明は FV の下へ）`, { sectionId: hero.id }));
    // 顔のビジュアルは人が用意する素材。無ければ必要素材として示し、無関係な写真や架空の肩書・証言で埋めない
    const pt = project.assets?.heroPortrait;
    if (!pt) issues.push(ISSUE('warn', 'asset-missing', `必要素材: FV の顔写真（架空・由来明記・対象者に合う場面）が未設定です${project.fvDesign?.requiredAssets?.length ? `（${project.fvDesign.requiredAssets.join(' / ')}）` : ''}`, { sectionId: hero.id }));
    else if (pt.fictional !== true && d.demoMode !== 'live') issues.push(ISSUE('stop', 'portrait-not-fictional', 'デモの顔写真が架空と記録されていません（実在の人物をデモに使わない）', { sectionId: hero.id }));
    if (pt) {
      // 写真を講師・受講生・推薦者・実績と結び付けない（alt と注記も検査する）
      for (const [k, v] of [['alt', pt.alt], ['caption', pt.caption]]) {
        const cv = canon(v || '');
        const hit = cv.match(PORTRAIT_ROLE_RE) || cv.match(PORTRAIT_NAME_RE) || detectClaims(String(v || ''), d.category).find((c) => ['authority', 'testimonial'].includes(c.category))?.match;
        if (hit) issues.push(ISSUE('stop', 'portrait-claim', `FV の写真（${k}）に「${Array.isArray(hit) ? hit[0] : hit}」とあります（人物を講師・受講生・推薦者・資格者・実績として紹介しない）`, { sectionId: hero.id }));
      }
      if (pt.origin !== 'ai_generated' && /AI生成/.test(pt.caption)) issues.push(ISSUE('stop', 'portrait-origin-mismatch', 'FV の写真の注記は「AI生成」ですが、由来が AI 生成と記録されていません', { sectionId: hero.id }));
      if (pt.origin === 'ai_generated' && !/AI|イメージ|架空/.test(pt.caption)) issues.push(ISSUE('warn', 'portrait-origin-mismatch', 'AI 生成の写真であることが注記から分かりません', { sectionId: hero.id }));
    }
    // 研究・心理学・CVR を FV の本文で主張しない（設計メモ fvDesign.researchNotes に書く）
    if (/心理学|研究で|研究によ|CVR|離脱率|コンバージョン/.test([heroText, hero.cta?.label, hero.commercialPreview?.label, hero.commercialPreview?.note, d.productLabel].join('\n'))) issues.push(ISSUE('stop', 'research-in-copy', 'FV の本文で研究・心理学・CVR を主張しています（設計メモに書き、効果を約束しない）', { sectionId: hero.id }));
  }
  if (!project.chosenAngleId) issues.push(ISSUE('warn', 'no-angle', '訴求が選ばれていません'));
  if (project.display.demoMode !== 'live' && !project.display.demoNotice.trim()) issues.push(ISSUE('stop', 'demo-unlabelled', 'デモ・試作の表示がありません'));
  for (const ins of project.insights) if (ins.status === 'hypothesis') issues.push(ISSUE('info', 'hypothesis', `インサイト「${ins.statement.slice(0, 30)}…」は仮説です（顧客の原文・観察で未確認）`));
  return issues;
}

/** FV 内に表示される文字（空白を除く）。render の FV と同じ要素を数える */
export function fvTextOf(project, hero = project.sections.find((s) => s.role === 'hero')) {
  if (!hero) return '';
  const d = project.display;
  const v = hero.visual;
  const vis = !v ? [] : v.kind === 'table' ? [v.label, v.title, ...(v.columns || []), ...(v.rows || []).flat()] : [v.label, v.title, v.task, v.from, v.to, v.review]; // 描画される欄をすべて数える
  const parts = [d.brandName, d.demoMode !== 'live' ? (d.demoMode === 'synthetic-demo' ? '架空デモ' : '試作') : '', d.productLabel || d.audienceLabel, hero.heading, hero.sub, ...vis, hero.cta?.label, project.assets?.heroPortrait?.caption];
  return parts.filter(Boolean).join('').replace(/\s/g, '');
}

// 写真の人物に役割・資格・権威・実績を与える語（canon 後の文字列に当てる。空白・全角・結合文字ですり抜けない）
const PORTRAIT_ROLE_RE = /講師|先生|教師|教員|指導者|受講生|受講者|在校生|卒業生|修了生|合格者|合格|取得者|取得した|資格者|有資格|会計士|税理士|教え手|ガイド役|先輩|ホルダー|ベテラン|熟練|簿記検定|検定[0-9０-９一二三]級|[0-9０-９一二三]級保持|監修|専門家|プロ|コーチ|トレーナー|インストラクター|メンター|チューター|アドバイザー|カウンセラー|コンサルタント|担当者|担当の|お客様|利用者|ユーザーの声|の声|体験談|口コミ|推薦|実績|代表|スタッフ|社員|creator|coach|mentor|tutor|teacher|instructor/i;
// 「〇〇さん」「〇〇様」「〇〇氏」の形（人名）だけを止める。「皆様」「お客様（上で扱う）」は名前ではない
const PORTRAIT_NAME_RE = /(?<![\p{Script=Han}\p{Script=Katakana}ーおご])(?!皆|各位|みな)(?:[\p{Script=Han}]{1,4}|[\p{Script=Katakana}ー]{2,8}|[A-Za-z]{2,})(?:さん|様|氏|先生)/u;

const EXAMPLE_HOST = /(^|\.)example\.(com|org|net)$/i;

export function gates(project, issues = checkProject(project)) {
  const stops = issues.filter((i) => i.level === 'stop');
  const review = { ok: stops.length === 0, reasons: stops.map((s) => s.message) };
  const reasons = [];
  const d = project.display;
  const a = project.inputs.action;
  if (d.demoMode !== 'live') reasons.push(d.demoMode === 'synthetic-demo' ? '架空サービスのデモです' : '試作です');
  if (!isRealOperator(d.operator) || d.operatorConfirmed !== true) reasons.push('運営者（事業者名）が確認されていません'); // v1 から引き継ぐ商用の必須条件（空・仮の値・未確認は不可）
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
  for (const i of issues.filter((x) => x.code === 'claim-unverified')) reasons.push(i.message);
  const v = project.cta.variants.find((x) => x.id === project.cta.activeVariant);
  if (v && v.timing !== 'spec') reasons.push('固定CTAの表示タイミングが比較用の案です（公開は仕様どおりの案だけ）');
  return { reviewPreview: review, commercialReady: { ok: reasons.length === 0, reasons: [...new Set(reasons)] } };
}
