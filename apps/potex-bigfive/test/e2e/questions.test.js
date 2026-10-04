// 4択・押すとすぐ次へ進む回答画面と、採点結果の確認。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startEnv,
  settle,
  title,
  qCount,
  answer,
  startQuestions,
  answerAll,
  scores,
  assertNoPersistence,
  activeText,
  activeId,
} from './helpers.js';

let env;
before(async () => {
  env = await startEnv();
});
after(async () => {
  await env.stop();
});

const DISCLAIMER =
  'IPIPの項目を参考に、独自の日本語訳と4択形式に変更した自己理解用の簡易分析です。この形式の信頼性・妥当性は未検証です。医療上の診断ではありません。';
const KEYED_PLUS = new Set([1, 2, 3, 4, 5, 11, 12, 13, 14]);

test('回答は上から「当てはまる」の4択ボタンで、初期状態では何も選ばれていない', async () => {
  const { context, page } = await env.open();
  await page.getByRole('button', { name: '簡易分析を始める' }).click();
  await settle(page);
  assert.ok((await page.locator('main').innerText()).includes(DISCLAIMER), '開始前に免責文');
  await page.getByRole('button', { name: '質問に進む' }).click();
  await settle(page);
  const labels = await page.locator('button.answer').allTextContents();
  assert.deepEqual(labels, ['当てはまる', 'やや当てはまる', 'あまり当てはまらない', '当てはまらない']);
  const ids = await page.locator('button.answer').evaluateAll((els) => els.map((e) => e.id));
  assert.deepEqual(ids, ['q1-a4', 'q1-a3', 'q1-a2', 'q1-a1']);
  assert.deepEqual(
    await page.locator('button.answer').evaluateAll((els) => els.map((e) => e.getAttribute('aria-pressed'))),
    ['false', 'false', 'false', 'false'],
  );
  // ラジオや「次へ」ボタンは無い（矢印キーで勝手に確定しない）
  assert.equal(await page.locator('input[type=radio]').count(), 0);
  assert.equal(await page.getByRole('button', { name: '次へ', exact: true }).count(), 0);
  assert.equal(await page.locator('#keep-next').count(), 0, '未回答なら「回答を変えずに」も出ない');
  // 旧形式の5に当たるボタンが無い
  assert.equal(await page.locator('[id$="-a5"]').count(), 0);
  const body = await page.locator('body').innerText();
  for (const old of ['どちらともいえない', 'とても当てはまる', 'まったく当てはまらない', '5段階']) {
    assert.ok(!body.includes(old), `「${old}」が残っていない`);
  }
  await context.close();
});

test('1回押すとすぐ次の質問へ進み、新しい質問の見出しにフォーカスが移る', async () => {
  const { context, page } = await env.open();
  await startQuestions(page);
  await answer(page, 3);
  assert.equal(await qCount(page), '質問 2 / 20');
  assert.equal(await activeId(page), 'screen-title');
  assert.equal(await activeText(page), '他の人の気持ちに共感する。');
  assert.equal(await page.locator('#answered-text').textContent(), '回答済み 1問');
  await context.close();
});

test('全4 → E/A/C/N=2.50, O=1.75。結果にも免責文、出典、1〜4の目盛り', async () => {
  const { context, page, requests, errors } = await env.open();
  await answerAll(page, 4);
  await page.getByRole('button', { name: '結果を見る' }).click();
  await title(page).filter({ hasText: '結果' }).waitFor();
  await settle(page);
  assert.deepEqual(await scores(page), { E: '2.50', A: '2.50', C: '2.50', N: '2.50', O: '1.75' });
  const text = await page.locator('main').innerText();
  assert.ok(text.includes(DISCLAIMER), '結果に免責文');
  assert.ok(text.includes('（1〜4）'));
  assert.ok(text.includes('知能の高さを表すものではありません'));
  assert.deepEqual(await page.locator('section.factor').first().locator('.scale-labels span').allTextContents(), ['1', '2', '3', '4']);
  for (const banned of ['平均以上', '上位', 'IQ', '正常', '異常', '%', 'パーセンタイル', '1〜5', '中立', '採用', '適性', 'タイプです']) {
    assert.ok(!text.includes(banned), `結果画面に「${banned}」がない`);
  }
  assert.ok(!/\b[EACNO][+-]|逆転|E逆|O逆/.test(await page.locator('body').innerText()), '内部記号が出ない');
  await page.locator('summary', { hasText: '質問の出典' }).click();
  for (const url of [
    'https://ipip.ori.org/MiniIPIPKey.htm',
    'https://ipip.ori.org/newPermission.htm',
    'https://ipip.ori.org/newScoringInstructions.htm',
  ]) {
    assert.equal(await page.locator(`a[href="${url}"]`).count(), 1);
  }
  assert.match(await page.locator('.sources').innerText(), /標準版の Mini-IPIP でも、検証済みの日本語版でもありません/);
  assert.deepEqual(requests, [`${env.origin}/`], 'ページ以外のリクエストが無い');
  await assertNoPersistence(page, context, env.origin);
  assert.deepEqual(errors, []);
  await context.close();
});

test('全1 → E/A/C/N=2.50, O=3.25', async () => {
  const { context, page } = await env.open();
  await answerAll(page, 1);
  await page.getByRole('button', { name: '結果を見る' }).click();
  assert.deepEqual(await scores(page), { E: '2.50', A: '2.50', C: '2.50', N: '2.50', O: '3.25' });
  await context.close();
});

test('正4逆1 → 全4.00（画面経由）', async () => {
  const { context, page } = await env.open();
  await answerAll(page, (i) => (KEYED_PLUS.has(i + 1) ? 4 : 1));
  await page.getByRole('button', { name: '結果を見る' }).click();
  assert.deepEqual(await scores(page), { E: '4.00', A: '4.00', C: '4.00', N: '4.00', O: '4.00' });
  await context.close();
});

test('正1逆4 → 全1.00（画面経由）', async () => {
  const { context, page } = await env.open();
  await answerAll(page, (i) => (KEYED_PLUS.has(i + 1) ? 1 : 4));
  await page.getByRole('button', { name: '結果を見る' }).click();
  assert.deepEqual(await scores(page), { E: '1.00', A: '1.00', C: '1.00', N: '1.00', O: '1.00' });
  await context.close();
});

test('二重クリックでも次の質問まで回答したことにならない', async () => {
  const { context, page } = await env.open();
  await startQuestions(page);
  await page.locator('#q1-a4').dblclick();
  assert.equal(await qCount(page), '質問 2 / 20');
  assert.equal(await page.locator('#answered-text').textContent(), '回答済み 1問');
  assert.equal(await page.locator('button.answer[aria-pressed="true"]').count(), 0, '質問2は未回答のまま');
  // 3連続クリックでも同じ
  await settle(page);
  await page.locator('#q2-a3').click({ clickCount: 3, delay: 40 });
  assert.equal(await qCount(page), '質問 3 / 20');
  assert.equal(await page.locator('#answered-text').textContent(), '回答済み 2問');
  await context.close();
});

test('二重タップでも次の質問まで回答したことにならない', async () => {
  const { context, page } = await env.open({ width: 390, height: 844, hasTouch: true, isMobile: true });
  await startQuestions(page);
  const box = await page.locator('#q1-a2').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(80);
  await page.touchscreen.tap(x, y);
  assert.equal(await qCount(page), '質問 2 / 20');
  assert.equal(await page.locator('#answered-text').textContent(), '回答済み 1問');
  assert.equal(await page.locator('button.answer[aria-pressed="true"]').count(), 0);
  await context.close();
});

test('Enter の押し続けでも次の質問まで回答したことにならない', async () => {
  const { context, page } = await env.open({ width: 1280, height: 900 });
  await startQuestions(page);
  await page.locator('#q1-a3').focus();
  // 押し続け: 2回目以降の keydown は repeat=true になる
  for (let n = 0; n < 8; n += 1) await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  assert.equal(await qCount(page), '質問 2 / 20');
  assert.equal(await page.locator('#answered-text').textContent(), '回答済み 1問');
  assert.equal(await page.locator('button.answer[aria-pressed="true"]').count(), 0);
  // 押し続けの間にフォーカスは新しい見出しにある
  assert.equal(await activeId(page), 'screen-title');
  await context.close();
});

test('キーボードだけで回答できる（Tab で選び、Enter / Space で確定）', async () => {
  const { context, page } = await env.open({ width: 1280, height: 900 });
  await page.locator('#start').focus();
  await page.keyboard.press('Enter');
  await settle(page);
  assert.equal(await activeId(page), 'screen-title');
  await page.locator('#begin-questions').focus();
  await page.keyboard.press('Enter');
  await settle(page);
  assert.equal(await activeText(page), '人の集まりでは、場を盛り上げる。');
  await page.keyboard.press('Tab');
  assert.equal(await activeId(page), 'q1-a4', '見出しの次は先頭の回答ボタン');
  await page.keyboard.press('Tab');
  assert.equal(await activeId(page), 'q1-a3');
  await page.keyboard.press('Enter');
  await settle(page);
  assert.equal(await activeText(page), '他の人の気持ちに共感する。');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(await activeId(page), 'q2-a2');
  await page.keyboard.press('Space');
  await settle(page);
  assert.equal(await qCount(page), '質問 3 / 20');
  // 矢印キーでは回答が確定しない
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  assert.equal(await qCount(page), '質問 3 / 20');
  assert.equal(await page.locator('#answered-text').textContent(), '回答済み 2問');
  await context.close();
});

test('前へ戻ると回答が残り、同じ値の再選択でも次へ進む', async () => {
  const { context, page } = await env.open();
  await startQuestions(page);
  await answer(page, 4);
  await settle(page);
  await answer(page, 2);
  await settle(page);
  assert.equal(await qCount(page), '質問 3 / 20');
  await page.getByRole('button', { name: '前の質問へ' }).click();
  await settle(page);
  assert.equal(await qCount(page), '質問 2 / 20');
  assert.equal(await page.locator('#q2-a2').getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '前の質問へ' }).click();
  await settle(page);
  assert.equal(await page.locator('#q1-a4').getAttribute('aria-pressed'), 'true');
  // 同じ値を押し直すと、そのまま次へ
  await answer(page, 4);
  await settle(page);
  assert.equal(await qCount(page), '質問 2 / 20');
  assert.equal(await page.locator('#q2-a2').getAttribute('aria-pressed'), 'true', '次の質問の回答も残る');
  // 回答を変えずに進むボタン
  await page.getByRole('button', { name: '回答を変えずに、次の質問へ' }).click();
  await settle(page);
  assert.equal(await qCount(page), '質問 3 / 20');
  assert.equal(await page.locator('#answered-text').textContent(), '回答済み 2問');
  // 説明画面まで戻っても残る
  await page.getByRole('button', { name: '前の質問へ' }).click();
  await settle(page);
  await page.getByRole('button', { name: '前の質問へ' }).click();
  await settle(page);
  await page.getByRole('button', { name: '説明へ戻る' }).click();
  await settle(page);
  await page.getByRole('button', { name: '続きから答える' }).click();
  await settle(page);
  assert.equal(await page.locator('#q1-a4').getAttribute('aria-pressed'), 'true');
  await context.close();
});

test('回答一覧から編集すると確認画面に戻り、結果に反映される（逆項目1→4で当該因子のみ0.75減）', async () => {
  const { context, page } = await env.open();
  await answerAll(page, (i) => (i === 5 ? 1 : 2)); // 質問6（外向性・逆）だけ1
  await page.getByRole('button', { name: '結果を見る' }).click();
  await settle(page);
  const before = await scores(page);
  assert.deepEqual(before, { E: '2.75', A: '2.50', C: '2.50', N: '2.50', O: '2.75' });
  await page.getByRole('button', { name: '回答を見直す' }).click();
  await settle(page);
  await page.getByRole('button', { name: '質問6の回答を変更' }).click();
  await settle(page);
  assert.equal(await page.locator('#q6-a1').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#q-hint').textContent(), /回答の確認画面に進みます/);
  await answer(page, 4);
  await title(page).filter({ hasText: '回答の確認' }).waitFor();
  assert.equal(await activeId(page), 'screen-title');
  await settle(page);
  await page.getByRole('button', { name: '結果を見る' }).click();
  const after = await scores(page);
  assert.deepEqual(after, { ...before, E: '2.00' }, 'E だけが 0.75 下がる');
  await context.close();
});

test('最後の質問で連打しても、確認画面の先へ飛ばない', async () => {
  const { context, page } = await env.open();
  await startQuestions(page);
  for (let i = 0; i < 19; i += 1) {
    await answer(page, 3);
    await settle(page);
  }
  assert.equal(await qCount(page), '質問 20 / 20');
  assert.match(await page.locator('#q-hint').textContent(), /回答の確認画面に進みます/);
  await page.locator('#q20-a2').click({ clickCount: 3, delay: 40 });
  await title(page).filter({ hasText: '回答の確認' }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(await title(page).textContent(), '回答の確認', '確認画面にとどまる');
  assert.equal(await page.locator('section.factor').count(), 0, '結果へ進んでいない');
  assert.equal(await page.getByRole('alertdialog').count(), 0, 'やり直しの確認も開かない');
  assert.match(await page.locator('main').innerText(), /20問中 20問に回答済み/);
  await context.close();
});

test('未回答があると結果は出ない', async () => {
  const { context, page } = await env.open();
  await startQuestions(page);
  await answer(page, 4);
  await settle(page);
  await page.getByRole('button', { name: '回答一覧を見る' }).click();
  await settle(page);
  await page.getByRole('button', { name: '結果を見る' }).click();
  const alert = page.getByRole('alert');
  await alert.waitFor();
  assert.match(await alert.textContent(), /未回答の質問があります（2、3、4/);
  assert.equal(await page.locator('section.factor').count(), 0);
  await page.getByRole('button', { name: '未回答の質問へ' }).click();
  await settle(page);
  assert.equal(await qCount(page), '質問 2 / 20');
  await context.close();
});

test('アクセシビリティの基本（ラベル・押下状態・タップ領域・reduced-motion）', async () => {
  const { context, page } = await env.open({ width: 360, height: 740, reducedMotion: 'reduce' });
  await startQuestions(page);
  await answer(page, 4);
  await settle(page);
  await page.getByRole('button', { name: '前の質問へ' }).click();
  await settle(page);
  const group = page.getByRole('group', { name: '人の集まりでは、場を盛り上げる。' });
  assert.equal(await group.getByRole('button').count(), 4, '4つの回答ボタンが質問名のグループに入る');
  assert.equal(await page.getByRole('button', { name: '当てはまる', exact: true, pressed: true }).count(), 1);
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, label.option, label.chip'))
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ t: el.textContent, h: el.getBoundingClientRect().height }))
      .filter((x) => x.h < 44),
  );
  assert.deepEqual(small, []);
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('main')).animationName);
  assert.equal(anim, 'none');
  await context.close();
});
