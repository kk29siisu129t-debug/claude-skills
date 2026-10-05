// 架空seed project を生成する（seed/project.fictional.json）。中身はすべて架空。実在の事業・人物・実績ではない。
import { writeFileSync, readFileSync } from 'node:fs';
import { validateProject, serializeProject } from '../src/core/schema.js';
import { sectionHash, evidenceHash } from '../src/core/util.js';

const dataset = JSON.parse(readFileSync(new URL('./lpo-dataset.fictional.json', import.meta.url), 'utf8'));
const B = (value, status = 'confirmed') => ({ value, status });
const S = (id, type, fields, extra = {}) => ({
  id, type, approved: false, needsReview: false, origin: 'manual',
  fields: { heading: '', lead: '', body: '', note: '', items: [], itemsAlt: [], ...fields }, claimRefs: [], ...extra,
});

const project = {
  schemaVersion: 1,
  id: 'seed-michishirube',
  name: 'ミチシルベ簿記（架空デモ）',
  updatedAt: '2026-10-05T00:00:00.000Z',
  brief: {
    product: B('ミチシルベ簿記（オンライン学習伴走・架空）'),
    audience: B('仕事と両立しながら簿記2級を目指す社会人'),
    problem: B('教材は買ったが、平日の夜に何から手をつけるか決められず、週末にまとめてやろうとして崩れる'),
    promise: B('毎晩15分の「次にやること」が決まっている状態をつくる'),
    offer: B('初回の学習設計面談（オンライン）', 'unconfirmed'),
    price: B('', 'missing'),
    ctaLabel: B('学習設計面談を予約する'),
    ctaUrl: B('https://example.com/apply?utm_content=demo01'),
    tone: B('落ち着いて具体的。煽らない。'),
    operator: B('架空株式会社ミチシルベ（デモ用の架空事業者）'),
    category: 'education',
  },
  brand: { primary: '#2741b8', accent: '#c42f57', ink: '#1b1f2b', paper: '#fbf8f3', font: 'sans' },
  evidence: [
    { id: 'ev-hours', claim: '【架空】面談後4週間の平均学習日数は週4.2日', sourceType: 'internal-data', source: '架空の社内集計（デモ用・2026年8月）', status: 'verified', verifiedBy: 'デモ確認者（架空）', verifiedAt: '2026-09-20', provenance: 'seed', metricValue: 4.2, metricUnit: '日/週', note: 'デモ用の架空値' },
    { id: 'ev-plan', claim: '学習計画は面談で一緒に作り、毎晩15分の単位に分けて、週ごとに見直す', sourceType: 'policy', source: '架空のサービス仕様書 v1（デモ用）', status: 'verified', verifiedBy: 'デモ確認者（架空）', verifiedAt: '2026-09-20', provenance: 'seed', metricValue: null, metricUnit: '', note: '' },
    { id: 'ev-voice', claim: '【架空・未確認】受講者アンケートで満足度92%', sourceType: 'other', source: '出典未確認', status: 'unverified', verifiedBy: '', verifiedAt: '', provenance: 'seed', metricValue: 92, metricUnit: '%', note: '未検証の例。safe export には出ない' },
  ],
  sections: [
    S('fv', 'fv', { heading: '{{promise}}', lead: '{{audience}}のための学習伴走', body: '教材を増やすのではなく、毎日の「次の一手」を先に決めておく。' }, { approved: true, claimRefs: ['ev-plan'] }),
    S('empathy', 'empathy', { heading: 'こんな夜が続いていませんか', body: '{{problem}}', items: ['帰宅して机に向かっても、どこから再開するかを考えるうちに時間が過ぎる', '週末に取り返そうとして、結局どちらも中途半端になる', '進んでいるのか遅れているのか、自分では判断がつかない'] }, { approved: true }),
    S('reframe', 'reframe', { heading: '足りないのは、やる気ではなく「次の一手」の設計かもしれません', body: '時間が取れない日ほど、何をやるかを考える負担が重くなります。', items: ['その日の気分で範囲を決める', '遅れたら週末にまとめて取り返す'], itemsAlt: ['15分で終わる単位に分けておく', '週ごとに計画そのものを見直す'] }, { approved: true, claimRefs: ['ev-plan'] }),
    S('origin', 'origin', { heading: 'なぜ「伴走」なのか', body: '教材の良し悪しより、続ける段取りでつまずく人が多い、という問題意識から設計しました。\n内容は講座ではなく、学習計画を一緒に作り、週ごとに見直す仕組みです。' }, { approved: true, claimRefs: ['ev-plan'] }),
    S('steps', 'steps', { heading: '申込後の流れ', items: ['「{{ctaLabel}}」から日時を選ぶ', '面談で、今の進み具合と使える時間を一緒に確認する', '1週間分の「毎晩15分」の計画を受け取る', '週に一度、計画を見直す'] }, { approved: true, claimRefs: ['ev-plan'] }),
    S('scope', 'scope', { heading: '提供範囲', items: ['{{offer}}', '週ごとの計画の見直し'], itemsAlt: ['教材の販売', '試験の合格の約束'] }, { approved: true }),
    S('recommit', 'recommit', { heading: '次にやることが決まっていれば、15分でも前に進める', lead: '当てはまると感じたら、まず今の状況を一緒に整理しましょう。' }, { approved: true, claimRefs: ['ev-plan'] }),
    S('proof', 'proof', { heading: '根拠', lead: '確認できた事実と出典だけを載せています。' }, { approved: true, claimRefs: ['ev-hours', 'ev-plan', 'ev-voice'] }),
    S('fit', 'fit', { heading: '向いている人 / 向いていない人', items: ['{{audience}}', '毎晩15分なら確保できる人'], itemsAlt: ['短期間での一発合格だけを求める人', '教材選びの相談だけをしたい人'] }, { approved: true, claimRefs: ['ev-plan'] }),
    S('closing', 'closing', { heading: '机に向かったら、すぐ手が動く毎日へ', body: '計画は面談で一緒に作ります。まずは今の状況を聞かせてください。' }, { approved: true }),
    S('footer', 'footer', { body: '運営: {{operator}}', note: 'このページはデモ用の架空事業です。' }, { approved: true }),
  ],
  cta: {
    activeVariant: 'a',
    variants: [
      { id: 'a', label: '', color: '#d6335d', timing: 'spec' },
      { id: 'b', label: 'まず15分の相談を予約する', color: '#1f6f5c', timing: 'after-half' },
    ],
  },
  lpo: { dataset },
};

// seed の承認は「デモの確認者が内容を確認した」扱い。承認と内容を hash で対応づける
for (const s of project.sections) if (s.approved) s.approvedHash = sectionHash(s);
for (const e of project.evidence) if (e.status === 'verified') e.verifiedHash = evidenceHash(e);

const check = validateProject(project);
if (!check.ok) {
  console.error(check.errors.join('\n'));
  process.exit(1);
}
writeFileSync(new URL('./project.fictional.json', import.meta.url), serializeProject(check.project) + '\n');
console.log('seed/project.fictional.json を書き出しました', check.warnings.length ? check.warnings : '');
