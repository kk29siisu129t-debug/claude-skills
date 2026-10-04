import test from 'node:test';
import assert from 'node:assert/strict';
import { PotexCareer as K, PotexContent as C } from './load.js';

const career = (patch = {}) => ({ ...K.emptyCareer(), ...patch });

test('3つの道すじは固定順で、4段階（入口→経験を広げる→責任を担う→長期の選択）', () => {
  assert.deepEqual(K.PATHS.map((p) => p.id), ['A', 'B', 'C']);
  for (const p of K.PATHS) {
    assert.deepEqual(p.stages.map((s) => s.stage), ['入口', '経験を広げる', '責任を担う', '長期の選択']);
  }
  const chain = (id) => K.PATHS.find((p) => p.id === id).stages.flatMap((s) => s.roles);
  assert.deepEqual(chain('A'), ['企画・事業支援担当', '事業責任者', '経営メンバー', '創業者・代表', '事業オーナー', '承継後の顧問']);
  assert.deepEqual(chain('B'), ['総合職・企画担当', '課長相当', '部長相当', '事業部長', '本部長・執行役員', '顧問']);
  assert.deepEqual(chain('C'), ['専門職', 'シニア', 'リード／プリンシパル', 'チーフ・上席', 'フェロー級', '現役の専門家・顧問']);
});

test('選択肢は指定どおり（職能・経験・根拠の種類）', () => {
  assert.deepEqual(K.FUNCTIONS.map((f) => f.label), ['課題整理・企画', '提案・営業', '実行・プロジェクト推進', '分析・改善', '専門技術']);
  assert.deepEqual(K.EXPERIENCE.map((f) => f.label), ['未経験', '学んだ', '支援付きで実施', '自力で実施し、成果を説明できる']);
  assert.deepEqual(K.EVIDENCE.map((f) => f.label), ['学習作品', '仕事や活動で1回試した', '複数回試した', '他者から具体的なフィードバックあり', 'まだ根拠なし']);
  assert.deepEqual(K.WORK_STYLES.map((w) => w.path), ['A', 'B', 'C', null]);
});

test('主候補は希望する働き方だけから決まり、手動の選択が優先される', () => {
  assert.equal(K.primaryPath(career({ style: 'build' }), 'auto'), 'A');
  assert.equal(K.primaryPath(career({ style: 'org' }), 'auto'), 'B');
  assert.equal(K.primaryPath(career({ style: 'expert' }), 'auto'), 'C');
  assert.equal(K.primaryPath(career({ style: 'undecided' }), 'auto'), null, 'まだ決めない → 主候補なし');
  assert.equal(K.primaryPath(career(), 'auto'), null);
  // 関心職能だけでは主候補を決めない
  assert.equal(K.primaryPath(career({ functions: ['technical'] }), 'auto'), null);
  assert.equal(K.primaryPath(career({ style: 'build' }), 'C'), 'C');
  assert.equal(K.primaryPath(career({ style: 'build' }), 'none'), null);
});

test('性格スコアを引数に取らない', () => {
  assert.equal(K.primaryPath.length, 2);
  assert.equal(K.pathView.length, 2);
  assert.equal(K.summary.length, 1);
});

test('根拠は本人の選択（希望・職能・経験）だけで、性格の言葉が入らない', () => {
  const c = career({
    style: 'expert',
    functions: ['technical', 'sales'],
    experience: { technical: 'solo', sales: 'none' },
    evidence: { technical: 'multiple', sales: 'none' },
  });
  const viewC = K.pathView('C', c);
  assert.match(K.roleReason('C', c, 'auto'), /希望する働き方で「専門性を深めたい」を選んだため/);
  assert.match(viewC.reasons[0], /「専門技術」.*経験「自力で実施し、成果を説明できる」、根拠「複数回試した」/);
  const viewA = K.pathView('A', c);
  assert.equal(viewA.reasons.length, 1, 'A は「提案・営業」とだけつながる');
  assert.ok(viewA.unknowns.some((u) => u.includes('関心は能力を示すものではない')), '未経験の関心は確かめる点に入る');
  assert.ok(viewA.actionIds.includes('project'), '未経験なら小さな自主課題');
  assert.ok(viewC.actionIds.includes('compare'));

  const all = JSON.stringify(K.PATHS.map((p) => K.pathView(p.id, c)));
  for (const f of Object.values(C.FACTORS)) assert.ok(!all.includes(f.name.slice(0, 3)), `「${f.name}」が出ない`);
  for (const w of ['外向', '協調', '誠実', '神経症', '開放', '性格']) assert.ok(!all.includes(w));
});

test('独立の気持ちと準備は別と明記し、大きな決断を勧めない', () => {
  assert.match(K.NOTES.style, /独立したい気持ちと、独立の準備ができているかは別/);
  assert.ok(K.PATHS[0].unknowns[0].includes('独立したい気持ちと、独立の準備ができているかは別'));
  assert.match(K.NOTES.noBigMoves, /退職や契約など、大きな決断を勧めるものではありません/);
  assert.match(K.NOTES.move, /行き来できます/);
  assert.match(K.NOTES.paths, /実際の昇進の予測や、向き不向きの判定ではありません/);
});

test('年齢・収入・健康・社名の推薦などを含まない', () => {
  const text = JSON.stringify(K);
  for (const w of ['年齢', '歳', '年収', '収入', '健康', '病', '株式会社', 'おすすめ', '向いています', '適性があり', '上位', '%', '合格', '不合格', '辞め', '退職しましょう']) {
    assert.ok(!text.includes(w), `「${w}」を含まない`);
  }
});

test('検証行動は主候補のものが先頭、どれも選べる', () => {
  assert.equal(K.actionChoices('B')[0].id, 'B-scope');
  assert.equal(K.actionChoices(null).length, 7);
  assert.equal(new Set(K.actionChoices('C').map((a) => a.id)).size, 7);
});

test('行動文：暫定ルート・今週まず試すこと・振り返る時期を明示する', () => {
  assert.equal(
    K.actionSentence({ primary: 'C', actionId: 'project', timingId: '1w' }),
    '「専門性を深める」を暫定の主候補として、今週はまず「小さな自主課題を1つ決めて、成果物を1つ作る」を試します。1週間後に振り返り、続けるか、別の道すじを試すかを考えます。',
  );
  assert.equal(
    K.actionSentence({ primary: null, actionId: 'reflect', timingId: 'self' }),
    '道すじはまだ決めずに、今週はまず「これまでの仕事や活動の事例を1つ振り返り、何をして何が起きたかを書き出す」を試して確かめます。振り返る日は自分で決め、続けるか、別の道すじを試すかを考えます。',
  );
  assert.match(K.actionSentence({ primary: 'A', actionId: 'compare', timingId: null }), /振り返る時期は、まだ決めていません/);
  assert.equal(K.actionSentence({ primary: 'A', actionId: null, timingId: '2w' }), '');
  assert.deepEqual(K.REVIEW_TIMINGS.map((t) => t.label), ['1週間後', '2週間後', '自分で決める']);
});

test('主候補・比較候補の理由は本人の希望か手動の選択だけで説明する', () => {
  const c = career({ style: 'org' });
  assert.match(K.roleReason('B', c, 'auto'), /希望する働き方で「組織の中で経営の責任を広げたい」を選んだため、暫定の主候補/);
  assert.match(K.roleReason('A', c, 'auto'), /主候補の「組織の中で経営責任を広げる」と比べるための比較候補/);
  assert.match(K.roleReason('C', c, 'C'), /あなたが暫定の主候補として選びました/);
  assert.match(K.roleReason('C', c, 'none'), /同じ扱い/);
  assert.equal(K.roleReason.length, 3);
});

test('副業や独立は手段であり、全員の目標にしない', () => {
  assert.match(K.NOTES.style, /副業や独立は目標を実現する手段のひとつで、全員が目指すものではありません/);
  assert.match(K.PATHS[0].summary, /独立はこの道すじの手段のひとつ/);
});

test('まとめ文', () => {
  const s = K.summary({ career: career({ functions: ['analysis'] }), primary: 'C', actionId: 'project', timingId: '2w' });
  assert.match(s.action, /今週はまず「小さな自主課題を1つ決めて、成果物を1つ作る」を試します。2週間後に振り返り/);
  assert.match(s.lines[0], /暫定の主候補の道すじ：「専門性を深める」/);
  assert.match(s.lines[1], /分析・改善/);
  const none = K.summary({ career: career(), primary: null, actionId: null });
  assert.equal(none.action, '');
  assert.match(none.lines[0], /優劣なく/);
});
