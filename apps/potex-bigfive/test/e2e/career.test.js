// キャリアの整理と「キャリアの道すじの例」の画面。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startEnv, settle, title, answerAll, assertNoPersistence } from './helpers.js';

let env;
before(async () => {
  env = await startEnv();
});
after(async () => {
  await env.stop();
});

const FACTOR_WORDS = ['外向性', '協調性', '誠実性', '感情の揺れやすさ', '神経症傾向', '開放性'];
const pick = (page, id) => page.locator(`label[for="${id}"]`).click();
const card = (page, id) => page.locator('article.path', { has: page.locator(`#path-${id}`) });

async function fillCareer(page) {
  await pick(page, 'career-style-org');
  await pick(page, 'career-fn-planning');
  await pick(page, 'career-fn-technical');
  await pick(page, 'career-experience-planning-assisted');
  await pick(page, 'career-evidence-planning-once');
  await pick(page, 'career-experience-technical-none');
  await pick(page, 'career-evidence-technical-none');
}

test('トップは「キャリアを考えるための自己理解」で、骨格を固定的な本質として扱わない', async () => {
  const { context, page } = await env.open();
  assert.equal(await title(page).textContent(), 'キャリアを考えるための自己理解');
  const text = await page.locator('main').innerText();
  assert.match(text, /キャリアの解像度を上げる/);
  assert.match(text, /変わらない本質を決めつけるものではなく、いま時点の自己理解/);
  assert.match(text, /4択/);
  await context.close();
});

test('分析 → 結果 → キャリアの整理 → 道すじの例 → まとめ（主候補は希望から、手動で変更できる）', async () => {
  const { context, page, requests, errors } = await env.open();
  await answerAll(page, 3);
  await settle(page);
  await page.getByRole('button', { name: '結果を見る' }).click();
  await settle(page);
  const results = await page.locator('main').innerText();
  assert.match(results, /職種の向き不向きや、キャリアの道すじの候補には使いません/);
  assert.match(results, /働き方と学び方を考える問い/);
  await page.locator('#to-career').click();
  await settle(page);
  await title(page).filter({ hasText: 'キャリアの整理' }).waitFor();
  const careerText = await page.locator('main').innerText();
  assert.match(careerText, /独立したい気持ちと、独立の準備ができているかは別/);
  assert.match(careerText, /関心は、能力や向き不向きを示すものではありません/);
  for (const w of FACTOR_WORDS) assert.ok(!careerText.includes(w), `キャリアの整理に「${w}」が出ない`);
  assert.equal(await page.locator('input[type=text], input[type=number], input[type=email], textarea, select').count(), 0, '自由入力・年齢欄が無い');

  await fillCareer(page);
  assert.equal(await page.locator('section.self-report').count(), 2, '選んだ職能ごとに自己申告');
  assert.match(await page.locator('main').innerText(), /資格や採用の評価ではなく、自分で整理するための自己申告/);
  await page.locator('#to-paths').click();
  await settle(page);
  await title(page).filter({ hasText: 'キャリアの道すじの例' }).waitFor();

  // 3つとも常に表示、固定順
  assert.deepEqual(await page.locator('article.path .route-title').allTextContents(), [
    '事業づくり・独立も検討する',
    '組織の中で経営責任を広げる',
    '専門性を深める',
  ]);
  assert.match(await card(page, 'B').innerText(), /主候補/);
  assert.match(await card(page, 'A').innerText(), /比較候補/);
  assert.match(await card(page, 'C').innerText(), /比較候補/);
  assert.equal(await page.locator('#primary-B').getAttribute('aria-pressed'), 'true');
  const b = await card(page, 'B').innerText();
  assert.match(b, /入口\s*総合職・企画担当/);
  assert.match(b, /責任を担う\s*部長相当 → 事業部長/);
  assert.match(b, /希望する働き方で「組織の中で経営の責任を広げたい」を選んだため、暫定の主候補/);
  assert.match(await card(page, 'A').innerText(), /主候補の「組織の中で経営責任を広げる」と比べるための比較候補/);
  assert.match(b, /「課題整理・企画」.*経験「支援付きで実施」、根拠「仕事や活動で1回試した」/);
  assert.equal(await page.locator('#details-B').getAttribute('open'), '', '主候補の詳細は開いている');
  assert.equal(await page.locator('#details-C').getAttribute('open'), null, '比較候補の詳細は閉じている');
  await page.locator('#details-C summary').click();
  const c = await card(page, 'C').innerText();
  assert.match(c, /「専門技術」は関心として選んでいます。関心は能力を示すものではない/);
  assert.match(c, /小さな自主課題を1つ決めて、成果物を1つ作る/);
  const pathsText = await page.locator('main').innerText();
  assert.match(pathsText, /実際の昇進の予測や、向き不向きの判定ではありません/);
  assert.match(pathsText, /退職や契約など、大きな決断を勧めるものではありません/);
  assert.match(pathsText, /行き来できます/);
  for (const w of FACTOR_WORDS) assert.ok(!pathsText.includes(w), `道すじの例に「${w}」が出ない`);

  // 主候補を手動で変える → 決めずに比べる
  await page.locator('#primary-C').click();
  assert.equal(await page.locator('#primary-C').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#primary-B').getAttribute('aria-pressed'), 'false');
  assert.match(await card(page, 'B').innerText(), /比較候補/);
  await page.locator('#primary-none').click();
  assert.equal(await page.locator('.route-chosen, .route-compare').count(), 0, '主候補なしでは優劣の表示が無い');
  assert.match(await page.locator('#path-status').textContent(), /優劣なく/);
  await page.locator('#primary-A').click();

  assert.match(await card(page, 'A').innerText(), /あなたが暫定の主候補として選びました/);
  await pick(page, 'cact-A-onepager');
  await pick(page, 'timing-2w');
  await page.locator('#paths-summary').click();
  await settle(page);
  await title(page).filter({ hasText: 'あなたの次のアクション' }).waitFor();
  const summary = await page.locator('main').innerText();
  assert.equal(
    await page.locator('#next-career').textContent(),
    '「事業づくり・独立も検討する」を暫定の主候補として、今週はまず「身近な事業の課題を1つ選び、改善案を1枚にまとめる」を試します。2週間後に振り返り、続けるか、別の道すじを試すかを考えます。',
  );
  assert.match(summary, /暫定の主候補の道すじ：「事業づくり・独立も検討する」/);
  assert.match(summary, /関心のある職能：課題整理・企画、専門技術/);
  assert.match(summary, /POTEXの支援の使い方（任意）\s*まだ考えていません/);
  assert.match(summary, /相談窓口は準備中です/);

  // まとめから POTEX の支援へ（キャリアの後の任意のステップ）
  await page.locator('#summary-routes').click();
  await settle(page);
  await title(page).filter({ hasText: '目標と希望の整理' }).waitFor();
  await page.locator('label[for="need-prefs-expert"]').click();
  await page.getByRole('button', { name: '支援の使い方の案を見る' }).click();
  await settle(page);
  assert.match(await page.locator('main').innerText(), /追加料金/, '提供条件の確認表示');
  await page.locator('#pick-expert').click();
  await page.getByRole('button', { name: '最初の小さな行動を選ぶ' }).click();
  await settle(page);
  await pick(page, 'act-expert-questions');
  await page.getByRole('button', { name: '次のアクションをまとめる' }).click();
  await settle(page);
  const both = await page.locator('main').innerText();
  assert.match(both, /今週はまず「身近な事業の課題/);
  assert.match(both, /POTEXの支援で最初にすること：専門家に聞きたい質問を3つ書き出す。/);

  assert.deepEqual(requests, [`${env.origin}/`]);
  await assertNoPersistence(page, context, env.origin);
  assert.deepEqual(errors, []);
  await context.close();
});

test('「まだ決めない」では主候補を出さず、3案を優劣なく比べる', async () => {
  const { context, page } = await env.open();
  await page.locator('#skip-to-career').click();
  await settle(page);
  await pick(page, 'career-style-undecided');
  await pick(page, 'career-fn-sales');
  await page.locator('#to-paths').click();
  await settle(page);
  assert.equal(await page.locator('article.path').count(), 3);
  assert.equal(await page.locator('.route-chosen, .route-compare').count(), 0);
  assert.equal(await page.locator('#primary-none').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#path-status').textContent(), /主候補を決めずに、3つの道すじを優劣なく/);
  // 未定のままでも「まず1つ試して確かめる」を選べる
  await pick(page, 'cact-reflect');
  await pick(page, 'timing-self');
  await page.locator('#paths-summary').click();
  await settle(page);
  assert.match(await page.locator('#next-career').textContent(), /^道すじはまだ決めずに、今週はまず「これまでの仕事や活動の事例を1つ振り返り.*」を試して確かめます。振り返る日は自分で決め/);
  // 変更できる
  await page.locator('#summary-paths').click();
  await settle(page);
  assert.equal(await page.locator('#cact-reflect').isChecked(), true);
  await pick(page, 'timing-1w');
  await page.locator('#primary-B').click();
  await page.locator('#paths-summary').click();
  await settle(page);
  assert.match(await page.locator('#next-career').textContent(), /^「組織の中で経営責任を広げる」を暫定の主候補として.*1週間後に振り返り/);
  await context.close();
});

test('性格の回答が違っても、同じ選択なら道すじの例はまったく同じ（性格から職業を判定しない）', async () => {
  const texts = [];
  for (const v of [4, 1]) {
    const { context, page } = await env.open();
    await answerAll(page, v);
    await settle(page);
    await page.getByRole('button', { name: '結果を見る' }).click();
    await settle(page);
    await page.locator('#to-career').click();
    await settle(page);
    await fillCareer(page);
    await page.locator('#to-paths').click();
    await settle(page);
    texts.push(await page.locator('.route-list').innerText());
    await context.close();
  }
  assert.equal(texts[0], texts[1]);
});

test('職能の選択を外すと自己申告欄も消え、戻っても選択が保たれる', async () => {
  const { context, page } = await env.open();
  await page.locator('#skip-to-career').click();
  await settle(page);
  await fillCareer(page);
  await pick(page, 'career-fn-technical');
  assert.equal(await page.locator('section.self-report').count(), 1);
  await page.locator('#to-paths').click();
  await settle(page);
  await page.locator('#back').click();
  await settle(page);
  assert.equal(await page.locator('#career-style-org').isChecked(), true);
  assert.equal(await page.locator('#career-experience-planning-assisted').isChecked(), true);
  assert.equal(await page.locator('#career-fn-technical').isChecked(), false);
  await context.close();
});
