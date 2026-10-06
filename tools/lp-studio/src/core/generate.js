// 生成経路（v2）。事実台帳 → インサイト仮説 → 訴求の選択 → 構成/コピー → 図解データ → 検証つき取り込み。
// - 'skeleton'（ルールベース）: 入力から骨組みだけを作る。文章は書かず【要記入】を置く。AI生成ではない。
// - 'claude-code': buildPrompt の指示を Claude Code セッションが読み、JSON を書く → ingestGenerated で検証して取り込む。
//   ブラウザから推論APIは呼ばない。新規APIキー・外部連携なし。
// 生成物は常に「仮説・未承認・未検証」で入る。顧客の原文（quotes）は生成では作れない。

import { ROLES, ROLE_IDS, ANGLE_DEPENDENT } from './roles.js';
import { validateShape, validateProject, VISUAL_SPEC, VISUAL_KINDS, CONFIDENCE, PROJECT_SPEC } from './schema.js';
import { checkProject } from './editorial.js';
import { clone } from './util.js';

export const ADAPTERS = {
  skeleton: { id: 'skeleton', label: '骨組み（ルールベース・AI生成ではない）', connected: true },
  'claude-code': { id: 'claude-code', label: 'Claude Code 生成（prompt → JSON 受け渡し）', connected: false },
};

const TODO = (what) => `【要記入: ${what}】`;

/** ルールベースの骨組み。コピーは書かない（AI推論ではない）。 */
export function skeletonSections(project) {
  const mk = (role, extra = {}) => ({
    id: role, role, approved: false, approvedHash: '', needsReview: false, origin: 'template',
    heading: TODO(`${ROLES[role].label}の見出し`), headingPhrases: [], body: TODO(ROLES[role].purpose), note: '', sourceRefs: [], items: [], visual: null, cta: null, commercialPreview: null, ...extra,
  });
  return [mk('hero'), mk('empathy'), mk('mechanism'), mk('process'), mk('closing')];
}

export function applySkeleton(project) {
  const p = clone(project);
  p.sections = skeletonSections(p);
  return p;
}

/** 訴求を選び直す（ルールベース部分）。依存セクションを「要再確認・未承認」にし、無関係な編集は保持する。 */
export function chooseAngle(project, angleId) {
  const p = clone(project);
  if (!p.angles.some((a) => a.id === angleId)) throw new Error('訴求が見つかりません');
  if (p.chosenAngleId === angleId) return p;
  p.chosenAngleId = angleId;
  p.sections = p.sections.map((s) => (ANGLE_DEPENDENT.includes(s.role) ? { ...s, needsReview: true, approved: false, approvedHash: '' } : s));
  return p;
}

// ---------------- prompt ----------------

const SYSTEM_TEXT = `あなたは、入力資料からLPの訴求と日本語コピーを設計する編集者です。美辞麗句を増やすのでなく、読者の具体的な状況と、この商品を選ぶ理由をつなげてください。

まず入力を確認済み事実、提供者の申告、顧客の観察・原文、仮説、未確認情報に分けてください。商品名や数値が書かれているだけで、実在・検証済み・公開可能だとみなしてはいけません。デモデータは実績の根拠に使わないでください。

コピーを書く前に、対象者の場面、既にしている努力、止まる瞬間、欲しい変化、商品が提供する仕組み、申込前の不安を短いブリーフへまとめてください。心理や因果関係の推測には仮説と明記してください。顧客の実際の発言がなければ、引用や口コミを生成しないでください。

中心となる訴求を一つ選び、選択理由と根拠IDを示してください。その訴求から、FV、共感、仕組み、裏づけ、条件、CTAへつながる本文を作成してください。セクションの数や順番は入力の事実と読者の疑問に合わせます。事実のない創業話、実績、価格理由は作らず、省くか編集画面の確認事項にしてください。

見出しと本文は自然な日本語に書き直してください。入力文章を{{audience}}や{{promise}}でそのまま結合しないでください。価格、条件、URLなどの正確な値は参照元とひも付け、公開用コピーの自由な言い換えと分けてください。公開文の各主張にsourceRefsを付けて、意味が入力より強くなっていないか検査してください。

FVはSP（幅400px前後）を基準に設計し、PCはSPの構成を広げる順で考えてください。FVでは、対象者の具体的な詰まりと、サービスが手伝う内容を短い1訴求で伝え、主CTAは1つにしてください。説明文・注意書き・無効の申込ボタンはFVの下に置きます。デザイン上の小見出し、H1の意味ごとの改行候補、本文、CTA文言、隣接注記、必要な図解の内容を別フィールドで出してください。SPで語を途中分割してまで大きく見せる前提にしないでください。

CTAが何をするか、料金、時間、提供方法、契約条件に未確認項目があれば、実販売の公開を止める理由を出してください。別の数字や『無料』『お気軽に』で穴埋めしないでください。説明用の例は例と明記し、成果や実物の証拠として使わないでください。

最後に、事実の裏づけ、訴求の一貫性、日本語の自然さ、重要情報の不足、SPでの文字量を自己点検し、残る要確認事項を列挙してください。スコアだけで合格扱いにせず、停止条件が一つでもあれば公開不可にしてください。`;

const RULES = [
  'H1（hero.heading）は声に出して一息で読める長さ（目安24字以内）。ブランド名を入れない。headingPhrases に意味のまとまりごとの改行候補を入れる（連結すると heading と完全一致）',
  '対象者の呼びかけ（display.audienceLabel）と業態（display.serviceDescriptor）はデザイン側が1回だけ出す。コピー本文で繰り返さない',
  '数値は参照した事実にある意味のまま使う。ある数値を別の対象（例: 学習の単位 → 面談の所要時間）に移さない。不明な条件（料金・所要時間・方法など）を数値や「無料」で埋めない',
  '共感（empathy）は読者の場面を地の文で描く。顧客の原文が無いので、引用符つきの「お客様の声」・吹き出し・人物属性は作らない',
  'デモ（display.demoMode が live 以外）のあいだ、行動ボタンはページ内の説明用の例へのアンカー（cta.behavior = "anchor"、target = 移動先セクションの id）だけ。実際の予約・登録の文言は commercialPreview（無効表示）に置き、note でデモのため使えないことを書く',
  '図解（visual）は仕組みが分かる具体的な例。kind は task-card / flow / table / checklist から選ぶ。label に「〜のイメージ」「架空データ」など例であることを書き、note に「例であり実物・成果ではない」旨を書く。成果の数値を入れない',
  '本文の無い見出しだけ・CTAだけのセクションを作らない。該当する事実が無い役割（創業話・お客様の声・価格の理由・根拠など）は省く',
  '各セクションと各項目に sourceRefs（台帳の id）を付ける。unknown 種別の id は根拠に使わない',
  'です・ます調を基本にし、句点で文を終える。同じ話の繰り返し、入力文の貼り付け、意味の取り違え、不自然な助詞を声に出して点検する',
  'FV は SP 基準。FV 内の文字（呼びかけ・H1・図の文字・CTA・写真の注記・デモ表示）は fvDesign.maxChars（既定80字）以内、H1 は2行以内、主CTA は1つ',
  'FV の主役は顔のビジュアルを基本にする（assets.heroPortrait。人が用意した架空・由来明記の写真）。fvDesign に、顔の役割（visualRole）・視線の向き（gaze: 見出し／CTA の方へ）・商材と対象者への適合（fit）を書く。素材が無いときは fvDesign.requiredAssets に「顔写真（架空・由来明記・対象者に合う年代と場面）」と書き、無関係な写真・架空の肩書・顧客の証言で穴埋めしない。人物を講師・受講生・推薦者として紹介しない',
  'FV の補助の図（hero.visual）は、それだけで意味が伝わる場合にだけ置く。伝わらないなら null にし、具体例は下のセクションに置く',
  '心理学などの研究は fvDesign.researchNotes に「research（出典あり）／hypothesis（未検証）／design-condition（今回の設計条件）」を分けて書き、限界（caveat）を添える。FV 本文には入れない。離脱率・CVR の改善を約束しない。fvDesign.evaluationPlan に将来の比較方法（1要素だけ変える・定義を固定した CVR 等）を書く',
  '公開資料（publicSources）は insights の sourceRefs にだけ使える。体験談を口コミ・実績として転載しない。競合も同じ支援を提供しているなら「このサービスだけ」などの優位性を作らない',
  'H1 は読者の内心の問いや場面でもよい。その場合、直下の補助文（hero.sub）が提供内容でその問いに答える構成にする。補助文で商品ラベル（display.productLabel）の語を繰り返さない',
  'section の id は役割名（hero, empathy, mechanism, illustration, process, scope, faq, fit, closing など）にする',
];

function dumpInputs(project) {
  const d = project.display;
  const i = project.inputs;
  const L = [];
  L.push('## 表示用の名前（display）');
  L.push(`- brandName: ${d.brandName}`, `- serviceDescriptor: ${d.serviceDescriptor}`, `- audienceLabel: ${d.audienceLabel}`, `- productLabel: ${d.productLabel || '（なし）'}`, `- demoMode: ${d.demoMode}`, `- demoNotice: ${d.demoNotice}`, '');
  L.push('## 事実台帳（id / 種別 / 実在or合成 / 内容）');
  for (const l of project.ledger) L.push(`- ${l.id} [${l.kind} / ${l.reality}] ${l.text}`);
  L.push('');
  L.push('## 根拠（evidence。合成の成果データはLPの根拠に使わない）');
  if (!project.evidence.length) L.push('- （なし）');
  for (const e of project.evidence) L.push(`- ${e.id} [${e.kind} / ${e.reality} / ${e.status}] ${e.claim}`);
  L.push('', '## 顧客の原文（quotes）', project.quotes.length ? project.quotes.map((q) => `- ${q.id} ${q.text}（${q.method} ${q.date}）`).join('\n') : '- （なし。引用・口コミは作らない）', '');
  L.push('## 公開資料（課題理解とインサイト仮説の材料。LP の根拠・口コミ・実績・優位性には使わない。sections の sourceRefs に入れない）');
  if (!(project.publicSources || []).length) L.push('- （なし）');
  for (const ps of project.publicSources || []) L.push(`- ${ps.id} [${ps.kind} / ${ps.use}] ${ps.title} ${ps.url}\n  観察: ${ps.observation}\n  限界: ${ps.caveat}`);
  L.push('');
  L.push('## FV の顔写真（assets.heroPortrait。人が用意する素材。画像そのものは渡さない）');
  const pt = project.assets?.heroPortrait;
  if (!pt) L.push('- なし（必要素材として fvDesign.requiredAssets に書く。無関係な写真・肩書・証言で埋めない）');
  else L.push(`- あり / alt: ${pt.alt} / 注記: ${pt.caption} / 由来: ${pt.origin} / 架空: ${pt.fictional ? 'はい' : 'いいえ'} / 視線: ${pt.gaze === 'right' ? '右' : '左'}向き`, '- 写真の中身について書けるのは alt に書かれたことだけ。人物を講師・受講生・推薦者・実績として紹介しない');
  L.push('');
  L.push('## A 読者と場面');
  for (const [k, v] of Object.entries(i.scene || {})) if (v) L.push(`- ${k}: ${v}`);
  L.push('## B 既存の努力と詰まり');
  for (const [k, v] of Object.entries(i.efforts || {})) if (v) L.push(`- ${k}: ${v}`);
  L.push('## E 商材が担える変化');
  for (const k of ['canDo', 'expectedChange', 'cannotGuarantee']) for (const x of i.promiseLayers[k] || []) L.push(`- ${k}: ${x.text} (${(x.sourceRefs || []).join(', ')})`);
  L.push('## F 仕組み');
  for (const [k, v] of Object.entries(i.mechanism || {})) if (v) L.push(`- ${k}: ${v}`);
  L.push('## H 行動条件（未確定は穴埋めしない）');
  const a = i.action;
  L.push(`- behavior: ${a.behavior} / ctaLabel: ${a.ctaLabel || '（なし）'} / url: ${a.url || '（なし）'}`);
  for (const k of ['price', 'duration', 'method', 'continuation', 'requiredInput']) L.push(`- ${k}: ${a[k] || '（未確定）'}${a.confirmed?.[k] ? '（確定）' : ''}`);
  L.push(`- 確定済み: ${Object.entries(a.confirmed || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'なし'}`);
  L.push('## 言わないこと（doNotAssert）');
  for (const x of i.doNotAssert || []) L.push(`- ${x}`);
  return L.join('\n');
}

export function buildPrompt(project, mode = 'full', target = {}) {
  const L = ['# LP Studio 生成指示 v2（Claude Code 用）', '', SYSTEM_TEXT, '', '## 守ること', ...RULES.map((r) => `- ${r}`), '', dumpInputs(project), ''];
  L.push('## 使えるセクション役割（全部使う必要はない）');
  for (const r of ROLE_IDS) L.push(`- ${r}: ${ROLES[r].label} — ${ROLES[r].purpose}`);
  L.push(`- 図解の kind: ${VISUAL_KINDS.join(' / ')}`, '');
  L.push('## 依頼');
  if (mode === 'full') {
    L.push('事実台帳の分類 → 読者ブリーフ → インサイト仮説（2〜3案）→ 訴求候補（比較して1つ選ぶ）→ セクション → 自己点検 の順に考え、下の JSON を1つだけ出力する。');
  } else if (mode === 'reangle') {
    const angle = project.angles.find((a) => a.id === (target.angleId || project.chosenAngleId));
    L.push(`訴求を「${angle ? angle.statement : String(target.statement || '').slice(0, 200)}」に変える。この訴求に依存する役割（${ANGLE_DEPENDENT.join(', ')}）のセクションを書き直す。依存しないセクションは出力しない（手動編集を保持するため）。`);
    L.push('現在のセクション:', '```json', JSON.stringify(project.sections.map((s) => ({ id: s.id, role: s.role, heading: s.heading, body: s.body })), null, 1), '```');
  } else {
    const s = project.sections.find((x) => x.id === target.sectionId);
    L.push(`セクション ${s ? `${s.id}（${s.role}）` : '(未指定)'} を1つだけ書き直す。現在: ${s ? JSON.stringify({ heading: s.heading, body: s.body, items: s.items }) : '-'}`);
  }
  L.push('', '## JSON 契約（この形だけを出力する）', '```json', JSON.stringify({
    generator: 'claude-code',
    mode,
    analysis: {
      factClasses: { verifiedSpec: [], providerClaims: ['s1-...'], customerObservations: [], hypotheses: [], unknowns: ['u1-...'] },
      readerBrief: '場面・既にしている努力・止まる瞬間・欲しい変化・仕組み・申込前の不安を短く',
      objections: ['申込前に読者が持つ疑問'],
    },
    insights: [{ id: 'i1', statement: '〜したいが、〜なので、〜してしまう。そこで〜が必要ではないか（仮説）', readFromSource: '資料から読んだこと', inferred: '推測したこと', sourceRefs: ['s1-...'], confidence: 'low', alternatives: ['別の解釈'], questions: ['確認したい質問'] }],
    angles: [{ id: 'a1', statement: '訴求', insightId: 'i1', sourceRefs: ['s1-...'], rationale: '選んだ・選ばなかった理由', scores: { evidence: 0, fit: 0, specificity: 0, nextAction: 0 } }],
    chosenAngleId: 'a1',
    sections: [{
      id: 'hero', role: 'hero', heading: '', headingPhrases: [''], sub: 'FV の補助文（H1 の問い・場面に、提供内容で答える短い1行）', subPhrases: ['補助文の改行候補（連結すると sub と一致）'], body: '', note: '', sourceRefs: [],
      items: [{ heading: '', body: '', sourceRefs: [] }],
      visual: { kind: 'task-card', label: '〜のイメージ', title: '', task: '', note: '例であり実物・成果ではない旨', sourceRefs: [] },
      cta: { label: '', behavior: 'anchor', target: 'illustration' },
      commercialPreview: { label: '実際の申込ボタンの文言', note: 'デモのため使えない旨' },
    }],
    fvDesign: { viewportFirst: 'sp', visualRole: '顔写真の役割', gaze: 'toward-copy', fit: '商材・対象者との適合', maxChars: 80, primaryCtas: 1, requiredAssets: ['不足している素材'], researchNotes: [{ claim: '', source: '出典', status: 'research', caveat: '限界' }], evaluationPlan: '将来の比較検証の方法と指標' },
    selfCheck: { readAloud: ['声に出して直した点'], consistency: 'FV→共感→仕組み→裏づけ→CTA が同じ話か', missing: ['重要情報の不足'], spLength: 'SPでの文字量', openQuestions: ['残る要確認事項'] },
  }, null, 2), '```');
  return L.join('\n');
}

// ---------------- ingest ----------------

const item = { t: 'object', fields: { heading: { t: 'string', max: 120 }, body: { t: 'string', max: 400 }, sourceRefs: { t: 'array', of: { t: 'string', max: 40 }, max: 20 } }, required: [] };
const GEN_SECTION = {
  t: 'object',
  fields: {
    id: { t: 'string', max: 40, pattern: /^[a-z][a-z0-9_-]{0,39}$/ },
    role: { t: 'string', enum: ROLE_IDS },
    heading: { t: 'string', max: 120 }, headingPhrases: { t: 'array', of: { t: 'string', max: 60 }, max: 8 },
    body: { t: 'string', max: 1200 }, sub: { t: 'string', max: 60 }, subPhrases: { t: 'array', of: { t: 'string', max: 40 }, max: 6 }, note: { t: 'string', max: 200 },
    sourceRefs: { t: 'array', of: { t: 'string', max: 40 }, max: 20 },
    items: { t: 'array', of: item, max: 10 },
    visual: VISUAL_SPEC,
    cta: { t: 'object', nullable: true, fields: { label: { t: 'string', max: 40 }, behavior: { t: 'string', enum: ['anchor'] }, target: { t: 'string', max: 40 } }, required: ['label', 'behavior', 'target'] },
    commercialPreview: { t: 'object', nullable: true, fields: { label: { t: 'string', max: 40 }, note: { t: 'string', max: 80 } }, required: ['label'] },
  },
  required: ['role'],
};
const STR_LIST = (n, max = 300) => ({ t: 'array', of: { t: 'string', max }, max: n });
const RESPONSE_SPEC = {
  t: 'object',
  fields: {
    generator: { t: 'string', enum: ['claude-code'] },
    mode: { t: 'string', enum: ['full', 'reangle', 'section'] },
    analysis: { t: 'object', fields: { factClasses: { t: 'object', fields: { verifiedSpec: STR_LIST(40, 40), providerClaims: STR_LIST(40, 40), customerObservations: STR_LIST(40, 40), hypotheses: STR_LIST(40, 40), unknowns: STR_LIST(40, 40) }, required: [] }, readerBrief: { t: 'string', max: 800 }, objections: STR_LIST(10) }, required: [] },
    insights: { t: 'array', max: 5, of: { t: 'object', fields: { id: { t: 'string', max: 40, pattern: /^[A-Za-z0-9_-]{1,40}$/ }, statement: { t: 'string', max: 300 }, readFromSource: { t: 'string', max: 300 }, inferred: { t: 'string', max: 300 }, sourceRefs: STR_LIST(20, 40), confidence: { t: 'string', enum: CONFIDENCE }, alternatives: STR_LIST(5, 200), questions: STR_LIST(5, 200) }, required: ['id', 'statement', 'sourceRefs'] } },
    angles: { t: 'array', max: 6, of: { t: 'object', fields: { id: { t: 'string', max: 40, pattern: /^[A-Za-z0-9_-]{1,40}$/ }, statement: { t: 'string', max: 200 }, insightId: { t: 'string', max: 40 }, sourceRefs: STR_LIST(20, 40), rationale: { t: 'string', max: 400 }, scores: { t: 'object', fields: { evidence: { t: 'number', min: 0, max: 3, int: true }, fit: { t: 'number', min: 0, max: 3, int: true }, specificity: { t: 'number', min: 0, max: 3, int: true }, nextAction: { t: 'number', min: 0, max: 3, int: true } }, required: [] } }, required: ['id', 'statement', 'sourceRefs'] } },
    chosenAngleId: { t: 'string', max: 40 },
    sections: { t: 'array', of: GEN_SECTION, max: 14 },
    fvDesign: PROJECT_SPEC.fields.fvDesign,
    selfCheck: { t: 'object', fields: { readAloud: STR_LIST(12, 200), consistency: { t: 'string', max: 400 }, missing: STR_LIST(12, 200), spLength: { t: 'string', max: 300 }, openQuestions: STR_LIST(12, 200) }, required: [] },
  },
  required: ['generator', 'mode', 'sections'],
};

function extractJson(text) {
  const s = String(text ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fence ? fence[1] : s;
}

const UNSAFE = /<\s*\/?\s*[a-z!]|javascript:|https?:\/\/|www\./i;

function toSection(g, idFor, report) {
  const clean = (v, where) => {
    if (typeof v !== 'string') return v;
    if (UNSAFE.test(v)) { report.rejected.push(`${where}: HTML/URL を含むため除外`); return ''; }
    return v;
  };
  const s = {
    id: idFor(g), role: g.role, approved: false, approvedHash: '', needsReview: false, origin: 'claude-code',
    heading: clean(g.heading || '', `${g.role}.heading`), headingPhrases: (g.headingPhrases || []).map((x) => clean(x, `${g.role}.headingPhrases`)),
    body: clean(g.body || '', `${g.role}.body`), sub: g.role === 'hero' ? clean(g.sub || '', 'hero.sub') : '', subPhrases: g.role === 'hero' ? (g.subPhrases || []).map((x) => clean(x, 'hero.subPhrases')) : [], note: clean(g.note || '', `${g.role}.note`), sourceRefs: g.sourceRefs || [],
    items: (g.items || []).map((it, i) => ({ heading: clean(it.heading || '', `${g.role}.items[${i}]`), body: clean(it.body || '', `${g.role}.items[${i}]`), sourceRefs: it.sourceRefs || [] })),
    visual: g.visual ? { title: '', task: '', from: '', to: '', review: '', columns: [], rows: [], highlight: -1, sourceRefs: [], ...g.visual, notEvidence: true } : null,
    cta: g.cta && clean(g.cta.label, `${g.role}.cta.label`) ? { ...g.cta, label: g.cta.label } : null,
    commercialPreview: g.commercialPreview ? { label: clean(g.commercialPreview.label, `${g.role}.commercialPreview.label`), note: clean(g.commercialPreview.note || '', `${g.role}.commercialPreview.note`) } : null,
  };
  if (s.visual) for (const k of ['label', 'title', 'task', 'note', 'from', 'to', 'review']) s.visual[k] = clean(s.visual[k] || '', `${g.role}.visual.${k}`);
  return s;
}

/**
 * Claude Code の出力（JSON 文字列）を検証して取り込む。
 * 返り値: { ok, project, report: { errors, warnings, rejected, added, issues } }
 */
export function ingestGenerated(project, responseText, { mode, sectionId } = {}) {
  const report = { errors: [], warnings: [], rejected: [], added: [], issues: [] };
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
  if (mode && r.mode !== mode) { report.errors.push(`mode が一致しません（期待: ${mode} / 応答: ${r.mode}）`); return { ok: false, project, report }; }
  const p = clone(project);
  const known = new Set([...p.ledger.map((l) => l.id), ...p.evidence.map((e) => e.id), ...p.quotes.map((q) => q.id), ...(p.publicSources || []).map((x) => x.id)]);
  const publicIds = new Set((p.publicSources || []).map((x) => x.id));
  // LP 本文の根拠に公開資料は使わない（インサイト仮説の材料だけ）
  const copyRefs = (list, where) => checkRefs(list, where).filter((id) => { if (publicIds.has(id)) { report.warnings.push(`${where}: 公開資料 "${id}" は LP の根拠に使えないため外しました`); return false; } return true; });
  const checkRefs = (list, where) => list.filter((id) => { if (!known.has(id)) { report.warnings.push(`${where}: 参照 "${id}" は台帳に無いため外しました`); return false; } return true; });

  if (r.insights && r.mode !== 'section') {
    // 生成されたインサイトは常に仮説
    p.insights = r.insights.map((x) => ({ ...x, sourceRefs: checkRefs(x.sourceRefs, `insight ${x.id}`), confidence: x.confidence || 'low', alternatives: x.alternatives || [], questions: x.questions || [], readFromSource: x.readFromSource || '', inferred: x.inferred || '', status: 'hypothesis', provenance: 'claude-code' }));
    report.added.push(`インサイト仮説 ${p.insights.length} 件（すべて仮説）`);
  }
  if (r.angles && r.mode !== 'section') {
    p.angles = r.angles.map((x) => ({ ...x, sourceRefs: checkRefs(x.sourceRefs, `angle ${x.id}`), insightId: x.insightId || '', rationale: x.rationale || '', scores: x.scores || {} }));
    if (r.chosenAngleId && p.angles.some((a) => a.id === r.chosenAngleId)) p.chosenAngleId = r.chosenAngleId;
    report.added.push(`訴求候補 ${p.angles.length} 件（選択: ${p.chosenAngleId || 'なし'}）`);
  }
  if (r.fvDesign && r.mode !== 'section') {
    const v = validateProject({ ...p, fvDesign: r.fvDesign });
    p.fvDesign = v.ok ? v.project.fvDesign : p.fvDesign;
  }
  if (r.selfCheck) p.selfCheck = { readAloud: [], consistency: '', missing: [], spLength: '', openQuestions: [], ...r.selfCheck };
  if (r.analysis?.objections?.length && p.selfCheck) p.selfCheck.openQuestions = [...new Set([...(p.selfCheck.openQuestions || []), ...r.analysis.objections.map((o) => `読者の疑問: ${o}`)])].slice(0, 12);

  const used = new Set();
  const idFor = (g) => {
    let id = g.id || g.role;
    while (used.has(id)) id = `${g.role}-${used.size + 1}`;
    used.add(id);
    return id;
  };
  const gen = r.sections.map((g) => {
    const s = toSection(g, idFor, report);
    s.sourceRefs = copyRefs(s.sourceRefs, `${s.id}.sourceRefs`);
    s.items = s.items.map((it, i) => ({ ...it, sourceRefs: copyRefs(it.sourceRefs, `${s.id}.items[${i}]`) }));
    if (s.visual) s.visual.sourceRefs = copyRefs(s.visual.sourceRefs, `${s.id}.visual`);
    return s;
  });

  if (r.mode === 'full') {
    if (!gen.some((s) => s.role === 'hero')) { report.errors.push('hero（FV）がありません'); return { ok: false, project, report }; }
    p.sections = gen;
  } else if (r.mode === 'reangle') {
    const byRole = new Map(gen.filter((s) => ANGLE_DEPENDENT.includes(s.role)).map((s) => [s.role, s]));
    for (const s of gen) if (!ANGLE_DEPENDENT.includes(s.role)) report.warnings.push(`訴求変更では ${s.role} は対象外のため無視しました（手動編集を保持）`);
    p.sections = p.sections.map((s) => {
      if (byRole.has(s.role)) { const n = byRole.get(s.role); byRole.delete(s.role); return { ...n, id: s.id }; }
      if (ANGLE_DEPENDENT.includes(s.role)) return { ...s, needsReview: true, approved: false, approvedHash: '' };
      return s;
    });
    for (const s of byRole.values()) p.sections.push(s);
    report.added.push('訴求に依存するセクションを差し替え');
  } else {
    const i = p.sections.findIndex((s) => s.id === sectionId);
    if (i < 0) { report.errors.push('対象セクションが見つかりません'); return { ok: false, project, report }; }
    const g = gen.find((s) => s.role === p.sections[i].role);
    if (!g) { report.errors.push(`応答に ${p.sections[i].role} がありません`); return { ok: false, project, report }; }
    p.sections[i] = { ...g, id: p.sections[i].id };
  }
  // CTA の移動先は存在する id に限る
  const ids = new Set(p.sections.map((s) => s.id));
  for (const s of p.sections) if (s.cta && !ids.has(s.cta.target)) { report.warnings.push(`${s.id}.cta: 移動先 "${s.cta.target}" が無いため外しました`); s.cta = null; }
  report.added.push(`${gen.length} セクション（すべて未承認）`);
  report.issues = checkProject(p);
  return { ok: true, project: p, report };
}
