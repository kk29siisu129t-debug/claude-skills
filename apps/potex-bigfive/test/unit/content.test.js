import test from 'node:test';
import assert from 'node:assert/strict';
import { PotexContent as C, PotexLogic as L } from './load.js';

const DISCLAIMER =
  'IPIPの項目を参考に、独自の日本語訳と4択形式に変更した自己理解用の簡易分析です。この形式の信頼性・妥当性は未検証です。医療上の診断ではありません。';

test('免責文は指定どおり', () => {
  assert.equal(C.DISCLAIMER, DISCLAIMER);
});

test('標準版や検証済み日本語版と誤認させない説明がある', () => {
  const notes = C.SOURCE_NOTES.join('');
  assert.match(notes, /4択/);
  assert.match(notes, /標準版の Mini-IPIP でも、検証済みの日本語版でもありません/);
  assert.match(C.UNCERTAINTY_NOTE, /比べられません/);
});

test('因子の日本語名', () => {
  assert.equal(C.FACTORS.E.name, '外向性');
  assert.equal(C.FACTORS.A.name, '協調性');
  assert.equal(C.FACTORS.C.name, '誠実性');
  assert.equal(C.FACTORS.N.name, '感情の揺れやすさ（神経症傾向）');
  assert.equal(C.FACTORS.O.name, '開放性（想像力・抽象的な関心）');
  assert.match(C.FACTORS.O.note, /知能の高さを表すものではありません/);
  assert.match(C.FACTORS.N.note, /値が大きいほど、気分が揺れやすい方向/);
});

test('回答の選択肢は上から「当てはまる」の4択で、中立の選択肢がない', () => {
  assert.deepEqual(
    C.SCALE.map((s) => [s.value, s.label]),
    [
      [4, '当てはまる'],
      [3, 'やや当てはまる'],
      [2, 'あまり当てはまらない'],
      [1, '当てはまらない'],
    ],
  );
  const text = JSON.stringify(C);
  assert.ok(!text.includes('どちらともいえない'));
  assert.ok(!text.includes('とても当てはまる'));
  assert.ok(!text.includes('まったく当てはまらない'));
});

test('出典URLとDonnellanらの文献', () => {
  const urls = C.REFERENCES.map((r) => r.url);
  assert.deepEqual(urls, [
    'https://ipip.ori.org/MiniIPIPKey.htm',
    'https://ipip.ori.org/newPermission.htm',
    'https://ipip.ori.org/newScoringInstructions.htm',
  ]);
  assert.match(C.CITATION, /Donnellan.*Oswald.*Baird.*Lucas.*2006.*Psychological Assessment, 18, 192–203/);
});

// 画面に出る全文言から、禁止表現が無いことを確かめる
function allText(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allText(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => allText(v, out));
  return out;
}

test('禁止表現（優劣・人口比較・IQ・タイプ・価格など）を含まない', () => {
  const text = allText(C).join('\n');
  const banned = [
    '平均以上', '平均以下', '上位', '下位', 'パーセンタイル', '偏差値', 'IQ', '知能指数', '正常', '異常',
    'タイプ', '優れ', '劣', '順位', 'ランキング', 'おすすめ', '最適', '円', '料金プラン名', '成約', '解約', '入会',
    '信頼区間', '%',
  ];
  for (const word of banned) {
    const hits = text.split('\n').filter((line) => line.includes(word));
    // 「タイプ分けはしません」「順位づけはしません」のような否定の説明は app.js 側にのみ置く
    assert.deepEqual(hits, [], `「${word}」を含む文言: ${hits.join(' / ')}`);
  }
});

test('ルートは3案で固定順', () => {
  assert.deepEqual(C.ROUTES.map((r) => r.id), ['coach', 'expert', 'community']);
  assert.deepEqual(C.ROUTES.map((r) => r.title), [
    '個別伴走を中心に進める',
    '専門的な課題を解く支援を中心に進める',
    '学習と仲間の環境を活用して進める',
  ]);
});

test('理由は明示した選択だけから作られる', () => {
  const none = L.emptyNeeds();
  for (const r of C.ROUTES) assert.deepEqual(L.reasonsFor(r.id, none), []);

  const needs = { ...L.emptyNeeds(), prefs: ['review'], goals: ['sns'], barriers: ['alone'] };
  const coach = L.reasonsFor('coach', needs);
  const expert = L.reasonsFor('expert', needs);
  const community = L.reasonsFor('community', needs);
  assert.equal(coach.length, 1);
  assert.match(coach[0], /人と定期的に振り返りたい/);
  assert.equal(expert.length, 1);
  assert.match(expert[0], /SNS・発信.*対応できる担当者がいるかは確認が必要/);
  assert.equal(community.length, 1);
  assert.match(community[0], /相談相手や仲間がいない.*任意/);
});

test('reasonsFor は性格スコアを受け取らない（引数2つ）', () => {
  assert.equal(L.reasonsFor.length, 2);
});

test('行動の候補とまとめ文', () => {
  assert.deepEqual(L.actionsFor(null).map((a) => a.id), ['general-compare', 'general-time']);
  assert.equal(L.actionsFor('coach').length, 5);
  const s = L.buildSummary({
    routeId: 'expert',
    actionId: 'expert-questions',
    needs: { ...L.emptyNeeds(), time: '1to3', goals: ['english'] },
  });
  assert.equal(s.headline, '次にあなたがすること：専門家に聞きたい質問を3つ書き出す。');
  assert.ok(s.lines.some((l) => l.includes('専門的な課題を解く支援を中心に進める')));
  assert.ok(s.lines.some((l) => l.includes('週1〜3時間')));
  assert.ok(s.lines.some((l) => l.includes('英語')));
  assert.ok(s.confirm.some((l) => l.includes('追加料金')));

  const empty = L.buildSummary({ routeId: null, actionId: null, needs: L.emptyNeeds() });
  assert.match(empty.headline, /まだ選んでいません/);
  assert.deepEqual(empty.confirm, []);
});
