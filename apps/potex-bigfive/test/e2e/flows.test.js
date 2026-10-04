// 画面の流れ（スキップ・支援の使い方・やり直し）と、縦画面／デスクトップの表示確認。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startEnv, settle, title, answer, startQuestions, answerAll, assertNoPersistence, activeId, shotDir } from './helpers.js';

let env;
before(async () => {
  env = await startEnv();
});
after(async () => {
  await env.stop();
});

/** 支援の使い方の画面（POTEX）まで、目標と希望を選んで進む */
async function chooseNeedsAndOpenRoutes(page) {
  await page.locator('label[for="need-prefs-review"]').click();
  await page.locator('label[for="need-goals-sns"]').click();
  await page.locator('label[for="need-time-1to3"]').click();
  await page.getByRole('button', { name: '支援の使い方の案を見る' }).click();
  await settle(page);
  await title(page).filter({ hasText: '支援の使い方の案' }).waitFor();
}

test('スキップしてPOTEXの支援の使い方を見て、手動で選び・変え・行動を決められる', async () => {
  const { context, page, requests } = await env.open();
  await page.locator('#skip-to-needs').click();
  await settle(page);
  await title(page).filter({ hasText: '目標と希望の整理' }).waitFor();
  assert.equal(await page.locator('input[type=text], input[type=email], input[type=tel], input[type=number], textarea').count(), 0, '自由入力欄が無い');
  await chooseNeedsAndOpenRoutes(page);

  const routeTitles = await page.locator('.route-title').allTextContents();
  assert.deepEqual(routeTitles, ['個別伴走を中心に進める', '専門的な課題を解く支援を中心に進める', '学習と仲間の環境を活用して進める']);
  const [coach, expert, community] = [0, 1, 2].map((n) => page.locator('article.route').nth(n));
  assert.match(await coach.innerText(), /人と定期的に振り返りたい/);
  assert.match(await expert.innerText(), /SNS・発信.*担当者がいるかは確認が必要/);
  assert.match(await community.innerText(), /直接つながる項目はありません/);
  assert.match(await expert.innerText(), /追加料金/, '提供条件の確認表示');
  assert.equal(await page.locator('.route.is-selected').count(), 0, '最初は何も選ばれていない');

  await page.locator('#pick-expert').click();
  assert.equal(await page.locator('#pick-expert').getAttribute('aria-pressed'), 'true');
  await page.locator('#pick-community').click();
  assert.equal(await page.locator('#pick-expert').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#pick-community').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.locator('.route-title').allTextContents(), routeTitles, '並び順は変わらない');

  await page.getByRole('button', { name: '最初の小さな行動を選ぶ' }).click();
  await settle(page);
  await page.locator('label[for="act-community-focus"]').click();
  await page.getByRole('button', { name: '次のアクションをまとめる' }).click();
  await settle(page);
  await title(page).filter({ hasText: 'あなたの次のアクション' }).waitFor();
  const summary = await page.locator('main').innerText();
  assert.match(summary, /週に1回、25分だけ集中する時間を自分の予定に入れる/);
  assert.match(summary, /相談窓口は準備中です/);
  assert.equal(await page.locator('main a[href]').count(), 0, '相談・予約へのリンクが無い');
  assert.equal(await page.locator('form').count(), 0, '送信フォームが無い');

  await page.getByRole('button', { name: '支援の使い方を選び直す' }).click();
  await settle(page);
  await page.locator('#pick-coach').click();
  await page.getByRole('button', { name: '最初の小さな行動を選ぶ' }).click();
  await settle(page);
  assert.equal(await page.locator('input[name=first-action]:checked').count(), 0, '合わない行動は外れる');

  assert.deepEqual(requests, [`${env.origin}/`]);
  await assertNoPersistence(page, context, env.origin);
  await context.close();
});

test('回答の途中で中断してもスキップでき、回答は保たれる', async () => {
  const { context, page } = await env.open();
  await startQuestions(page);
  await answer(page, 4);
  await settle(page);
  await page.locator('#question-skip').click();
  await settle(page);
  assert.notEqual(await title(page).textContent(), '回答の確認');
  await page.locator('#back').click();
  await settle(page);
  assert.equal(await page.locator('#answered-text').textContent(), '回答済み 1問');
  await context.close();
});

test('やり直しで回答・結果・選択がすべて消える（キャンセルでは消えない）', async () => {
  const { context, page } = await env.open();
  await answerAll(page, 3);
  await settle(page);
  await page.getByRole('button', { name: '結果を見る' }).click();
  await settle(page);
  await page.locator('#to-needs').click();
  await settle(page);
  await chooseNeedsAndOpenRoutes(page);
  await page.locator('#pick-coach').click();

  await page.locator('#reset').click();
  const dialog = page.getByRole('alertdialog');
  await dialog.waitFor();
  assert.equal(await activeId(page), 'reset-cancel', '安全な「キャンセル」にフォーカス');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  assert.equal(await page.locator('#pick-coach').getAttribute('aria-pressed'), 'true');

  await page.locator('#reset').click();
  await page.getByRole('button', { name: 'すべて消して最初に戻る' }).click();
  await settle(page);
  assert.equal(await activeId(page), 'screen-title');
  assert.equal(await page.locator('#reset').isHidden(), true);

  await startQuestions(page);
  assert.equal(await page.locator('button.answer[aria-pressed="true"]').count(), 0);
  assert.equal(await page.locator('#answered-text').textContent(), '回答済み 0問');
  await page.locator('#question-skip').click();
  await settle(page);
  assert.equal(await page.locator('input:checked').count(), 0, '選択も消えている');
  await context.close();
});

const VIEWPORTS = [
  { name: '360x740', width: 360, height: 740 },
  { name: '390x844', width: 390, height: 844 },
  { name: 'desktop-1280x900', width: 1280, height: 900 },
];

for (const vp of VIEWPORTS) {
  test(`表示確認とスクリーンショット ${vp.name}`, async () => {
    const { context, page, errors, requests } = await env.open({ width: vp.width, height: vp.height });
    const shot = async (label, fullPage = true) => {
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${label}: 横スクロールが出ない`,
      );
      await page.waitForTimeout(300);
      await page.screenshot({ path: new URL(`${vp.name}-${label}.png`, shotDir).pathname, fullPage });
    };
    await shot('01-home');
    await page.getByRole('button', { name: '簡易分析を始める' }).click();
    await settle(page);
    await shot('02-about');
    await page.getByRole('button', { name: '質問に進む' }).click();
    await settle(page);
    await shot('03-question', false);
    for (let i = 0; i < 20; i += 1) {
      await answer(page, (i % 4) + 1);
      await settle(page);
    }
    await shot('04-review');
    await page.getByRole('button', { name: '結果を見る' }).click();
    await settle(page);
    await shot('05-results');
    assert.deepEqual(requests, [`${env.origin}/`]);
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('ダークモードの表示（390x844）', async () => {
  const { context, page } = await env.open({ colorScheme: 'dark' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(15, 21, 23)');
  await startQuestions(page);
  await page.screenshot({ path: new URL('390x844-dark-question.png', shotDir).pathname });
  await context.close();
});

test('サーバーにはページ本体以外のリクエストが届いていない', () => {
  assert.ok(env.serverHits.length > 0);
  assert.deepEqual([...new Set(env.serverHits)], ['/']);
});
