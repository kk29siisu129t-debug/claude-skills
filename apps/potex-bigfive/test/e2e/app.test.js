// 実ブラウザ（Chromium）での動作確認。dist/index.html をローカルの使い捨てサーバーから配信する。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const html = await readFile(new URL('../../dist/index.html', import.meta.url), 'utf8');
const shotDir = new URL('../../test-results/screenshots/', import.meta.url);
await mkdir(shotDir, { recursive: true });

/** @type {http.Server} */
let server;
let origin = '';
/** @type {import('playwright').Browser} */
let browser;
/** サーバーが受けたリクエスト（ページ読み込み以外が無いことを確かめる） */
const serverHits = [];

before(async () => {
  server = http.createServer((req, res) => {
    serverHits.push(req.url);
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

async function open({ width = 375, height = 812, ...rest } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'ja-JP', hasTouch: width < 600, ...rest });
  const page = await context.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${origin}/`);
  return { context, page, requests, errors };
}

const title = (page) => page.locator('#screen-title');

async function answer(page, value) {
  await page.locator(`label[for$="-a${value}"]`).click();
}

/** 全問を同じ値（または関数で決めた値）で答えて、回答の確認画面まで進む */
async function answerAll(page, valueFor) {
  await page.getByRole('button', { name: 'チェックを始める' }).click();
  await page.getByRole('button', { name: /質問に進む|続きから答える/ }).click();
  for (let i = 0; i < 20; i += 1) {
    await assert.doesNotReject(page.locator('.q-count', { hasText: `質問 ${i + 1} / 20` }).waitFor());
    await answer(page, typeof valueFor === 'function' ? valueFor(i) : valueFor);
    await page.waitForTimeout(360); // 連打ガード（350ms）を越えてから進む
    await page.locator('#next').click();
  }
  await assert.doesNotReject(title(page).filter({ hasText: '回答の確認' }).waitFor());
  await settle(page);
}

/** 画面切り替え直後の連打ガード（350ms）を越えるまで待つ */
const settle = (page) => page.waitForTimeout(360);

async function scores(page) {
  const out = {};
  for (const [k, name] of [['E', '外向性'], ['A', '協調性'], ['C', '誠実性'], ['N', '感情の揺れやすさ'], ['O', '開放性']]) {
    const section = page.locator('section.factor', { has: page.locator('h2', { hasText: name }) });
    out[k] = (await section.locator('.score-num').textContent()).trim();
  }
  return out;
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

async function assertNoPersistence(page, context) {
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookie: document.cookie,
    idb: indexedDB.databases ? (await indexedDB.databases()).length : 0,
    url: location.href,
  }));
  assert.equal(storage.local, 0, 'localStorage が空');
  assert.equal(storage.session, 0, 'sessionStorage が空');
  assert.equal(storage.cookie, '', 'cookie が無い');
  assert.equal(storage.idb, 0, 'IndexedDB が無い');
  assert.equal(storage.url, `${origin}/`, 'URL が変わらない');
  assert.deepEqual(await context.cookies(), []);
}

test('全3 → 全因子3.00、結果に免責文と出典がある', async () => {
  const { context, page, requests, errors } = await open();
  await answerAll(page, 3);
  await page.getByRole('button', { name: '結果を見る' }).click();
  await title(page).filter({ hasText: 'チェックの結果' }).waitFor();
  assert.deepEqual(await scores(page), { E: '3.00', A: '3.00', C: '3.00', N: '3.00', O: '3.00' });
  const text = await page.locator('main').innerText();
  assert.ok(text.includes('医療上の診断ではありません。結果は自己回答に基づく、その時点の傾向です。日本語訳の信頼性・妥当性は未検証です。'));
  assert.ok(text.includes('知能の高さを表すものではありません'));
  for (const banned of ['平均以上', '上位', 'IQ', '正常', '異常', 'あなたは', '%', 'パーセンタイル']) {
    assert.ok(!text.includes(banned), `結果画面に「${banned}」がない`);
  }
  // 内部記号（E+ / 逆 など）が画面に出ていない
  assert.ok(!/\b[EACNO][+-]|逆転|E逆|O逆/.test(await page.locator('body').innerText()));
  await page.locator('summary', { hasText: '質問の出典' }).click();
  for (const url of ['https://ipip.ori.org/MiniIPIPKey.htm', 'https://ipip.ori.org/newPermission.htm', 'https://ipip.ori.org/newScoringInstructions.htm']) {
    assert.equal(await page.locator(`a[href="${url}"]`).count(), 1);
  }
  assert.deepEqual(requests, [`${origin}/`], 'ページ以外のリクエストが無い');
  await assertNoPersistence(page, context);
  assert.deepEqual(errors, []);
  await context.close();
});

test('全5 → E/A/C/N=3, O=2 ／ 全1 → E/A/C/N=3, O=4', async () => {
  for (const [v, expected] of [
    [5, { E: '3.00', A: '3.00', C: '3.00', N: '3.00', O: '2.00' }],
    [1, { E: '3.00', A: '3.00', C: '3.00', N: '3.00', O: '4.00' }],
  ]) {
    const { context, page } = await open();
    await answerAll(page, v);
    await page.getByRole('button', { name: '結果を見る' }).click();
    assert.deepEqual(await scores(page), expected);
    await context.close();
  }
});

test('正5逆1 → 全5（画面経由）', async () => {
  const keyedPlus = new Set([1, 2, 3, 4, 5, 11, 12, 13, 14]);
  const { context, page } = await open();
  await answerAll(page, (i) => (keyedPlus.has(i + 1) ? 5 : 1));
  await page.getByRole('button', { name: '結果を見る' }).click();
  assert.deepEqual(await scores(page), { E: '5.00', A: '5.00', C: '5.00', N: '5.00', O: '5.00' });
  await context.close();
});

test('未回答では進めず、結果も出ない', async () => {
  const { context, page } = await open();
  await page.getByRole('button', { name: 'チェックを始める' }).click();
  await page.getByRole('button', { name: '質問に進む' }).click();
  // 初期状態でどの選択肢も選ばれていない
  assert.equal(await page.locator('input[type=radio]:checked').count(), 0);
  await settle(page);
  await page.locator('#next').click();
  await assert.doesNotReject(page.getByRole('alert').filter({ hasText: '1つ選ぶと' }).waitFor());
  assert.equal(await page.locator('.q-count').textContent(), '質問 1 / 20');

  await answer(page, 4);
  assert.equal(await page.getByRole('alert').count(), 0, '選ぶとエラーが消える');
  await page.waitForTimeout(360);
  await page.locator('#next').click();
  await page.getByRole('button', { name: '回答一覧を見る' }).click();
  await settle(page);
  await page.getByRole('button', { name: '結果を見る' }).click();
  const alert = page.getByRole('alert');
  await alert.waitFor();
  assert.match(await alert.textContent(), /未回答の質問があります（2、3、4/);
  assert.equal(await page.locator('section.factor').count(), 0);
  await context.close();
});

test('戻る・再編集で回答が保たれ、編集が結果に反映される', async () => {
  const { context, page } = await open();
  await page.getByRole('button', { name: 'チェックを始める' }).click();
  await page.getByRole('button', { name: '質問に進む' }).click();
  await answer(page, 5);
  await page.waitForTimeout(360);
  await page.locator('#next').click();
  await answer(page, 2);
  await page.waitForTimeout(360);
  await page.getByRole('button', { name: '前の質問へ' }).click();
  assert.equal(await page.locator('.q-count').textContent(), '質問 1 / 20');
  assert.equal(await page.locator('#q1-a5').isChecked(), true, '戻っても回答が残る');
  await page.waitForTimeout(360);
  await page.locator('#next').click();
  assert.equal(await page.locator('#q2-a2').isChecked(), true);

  // 説明画面まで戻ってから再開しても残る
  await page.waitForTimeout(360);
  await page.getByRole('button', { name: '前の質問へ' }).click();
  await page.waitForTimeout(360);
  await page.getByRole('button', { name: '説明へ戻る' }).click();
  await page.getByRole('button', { name: '続きから答える' }).click();
  assert.equal(await page.locator('#q1-a5').isChecked(), true);

  // 残りを3で埋めて確認画面へ
  await page.waitForTimeout(360);
  await page.locator('#next').click();
  await page.waitForTimeout(360);
  await page.locator('#next').click();
  for (let i = 2; i < 20; i += 1) {
    await answer(page, 3);
    await page.waitForTimeout(360);
    await page.locator('#next').click();
  }
  await title(page).filter({ hasText: '回答の確認' }).waitFor();
  await settle(page);
  // 1問目（E+）を 5 → 1 に変更すると E が 1 下がる
  await page.getByRole('button', { name: '結果を見る' }).click();
  const before = await scores(page);
  assert.equal(before.E, '3.50');
  await page.getByRole('button', { name: '回答を見直す' }).click();
  await page.getByRole('button', { name: '質問1の回答を変更' }).click();
  assert.equal(await page.locator('#next').textContent(), '回答一覧に戻る');
  await answer(page, 1);
  await page.waitForTimeout(360);
  await page.locator('#next').click();
  await title(page).filter({ hasText: '回答の確認' }).waitFor();
  await settle(page);
  await page.getByRole('button', { name: '結果を見る' }).click();
  const after = await scores(page);
  assert.equal(after.E, '2.50');
  assert.deepEqual({ ...after, E: null }, { ...before, E: null }, 'E以外は変わらない');
  await context.close();
});

test('連打しても質問を飛ばさない', async () => {
  const { context, page } = await open();
  await page.getByRole('button', { name: 'チェックを始める' }).click();
  await page.getByRole('button', { name: '質問に進む' }).click();
  await answer(page, 3);
  await page.waitForTimeout(360);
  await page.locator('#next').click({ clickCount: 1 });
  await page.locator('#next').click({ delay: 0 });
  await page.locator('#next').click({ delay: 0 });
  assert.equal(await page.locator('.q-count').textContent(), '質問 2 / 20');
  assert.equal(await page.getByRole('alert').count(), 0);
  // 選択肢の連打は同じ値のまま
  for (let n = 0; n < 5; n += 1) await answer(page, 4);
  assert.equal(await page.locator('input[type=radio]:checked').count(), 1);
  assert.equal(await page.locator('#answered-text').textContent(), '回答済み 2問');
  // 戻るの連打は1問目で止まる（説明画面へ飛び越えない）
  await page.waitForTimeout(360);
  await page.locator('#back').click();
  await page.locator('#back').click({ delay: 0 });
  assert.equal(await page.locator('.q-count').textContent(), '質問 1 / 20');
  await context.close();
});

test('スキップしてルートを見て、手動で選び・変え・行動を決められる', async () => {
  const { context, page, requests } = await open();
  await page.getByRole('button', { name: 'チェックを飛ばして、支援の使い方を考える' }).click();
  await title(page).filter({ hasText: '目標と希望の整理' }).waitFor();
  // 自由入力欄が無い
  assert.equal(await page.locator('input[type=text], input[type=email], input[type=tel], textarea').count(), 0);
  await page.locator('label[for="need-prefs-review"]').click();
  await page.locator('label[for="need-goals-sns"]').click();
  await page.locator('label[for="need-time-1to3"]').click();
  await page.getByRole('button', { name: '支援の使い方の案を見る' }).click();
  await title(page).filter({ hasText: '支援の使い方の案' }).waitFor();

  const routeTitles = await page.locator('.route-title').allTextContents();
  assert.deepEqual(routeTitles, ['個別伴走を中心に進める', '専門的な課題を解く支援を中心に進める', '学習と仲間の環境を活用して進める']);
  const coach = page.locator('article.route').nth(0);
  const expert = page.locator('article.route').nth(1);
  const community = page.locator('article.route').nth(2);
  assert.match(await coach.innerText(), /人と定期的に振り返りたい/);
  assert.match(await expert.innerText(), /SNS・発信.*担当者がいるかは確認が必要/);
  assert.match(await community.innerText(), /直接つながる項目はありません/);
  assert.equal(await page.locator('.route.is-selected').count(), 0, '最初は何も選ばれていない');

  await page.locator('#pick-expert').click();
  assert.equal(await page.locator('#pick-expert').getAttribute('aria-pressed'), 'true');
  await page.locator('#pick-community').click();
  assert.equal(await page.locator('#pick-expert').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#pick-community').getAttribute('aria-pressed'), 'true');
  assert.match(await community.innerText(), /選択中/);
  // 並び順は選択で変わらない
  assert.deepEqual(await page.locator('.route-title').allTextContents(), routeTitles);

  await page.getByRole('button', { name: '最初の小さな行動を選ぶ' }).click();
  await page.locator('label[for="act-community-focus"]').click();
  await page.getByRole('button', { name: '次のアクションをまとめる' }).click();
  await title(page).filter({ hasText: 'あなたの次のアクション' }).waitFor();
  const summary = await page.locator('main').innerText();
  assert.match(summary, /次にあなたがすること：週に1回、25分だけ集中する時間を自分の予定に入れる。/);
  assert.match(summary, /学習と仲間の環境を活用して進める/);
  assert.match(summary, /週1〜3時間/);
  assert.match(summary, /相談窓口は準備中です/);
  assert.equal(await page.locator('main a[href]').count(), 0, '相談・予約へのリンクが無い');
  assert.equal(await page.locator('form').count(), 0, '送信フォームが無い');

  // ルートを変えると、合わない行動は外れる
  await page.getByRole('button', { name: '支援の使い方を選び直す' }).click();
  await page.locator('#pick-coach').click();
  await page.getByRole('button', { name: '最初の小さな行動を選ぶ' }).click();
  assert.equal(await page.locator('input[name=first-action]:checked').count(), 0);
  await page.locator('label[for="act-general-time"]').click();
  await page.getByRole('button', { name: '支援の使い方の案へ' }).click();
  await page.locator('#pick-none').click();
  await page.getByRole('button', { name: '最初の小さな行動を選ぶ' }).click();
  assert.equal(await page.locator('#act-general-time').isChecked(), true, '共通の行動は残る');

  assert.deepEqual(requests, [`${origin}/`]);
  await assertNoPersistence(page, context);
  await context.close();
});

test('やり直しで回答・結果・選択がすべて消える', async () => {
  const { context, page } = await open();
  await answerAll(page, 4);
  await page.getByRole('button', { name: '結果を見る' }).click();
  await page.getByRole('button', { name: '支援の使い方を考える' }).click();
  await page.locator('label[for="need-goals-english"]').click();
  await page.getByRole('button', { name: '支援の使い方の案を見る' }).click();
  await page.locator('#pick-coach').click();

  await page.locator('#reset').click();
  const dialog = page.getByRole('alertdialog');
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'reset-cancel');
  // Escape で取り消すと何も消えない
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  assert.equal(await page.locator('#pick-coach').getAttribute('aria-pressed'), 'true');

  await page.locator('#reset').click();
  await page.getByRole('button', { name: 'すべて消して最初に戻る' }).click();
  await title(page).filter({ hasText: '自己理解チェック' }).waitFor();
  assert.equal(await page.locator('#reset').isHidden(), true);

  await page.getByRole('button', { name: 'チェックを始める' }).click();
  assert.equal(await page.getByRole('button', { name: '質問に進む' }).count(), 1, '「続きから」ではない');
  await page.getByRole('button', { name: '質問に進む' }).click();
  assert.equal(await page.locator('input[type=radio]:checked').count(), 0);
  assert.equal(await page.locator('#answered-text').textContent(), '回答済み 0問');
  await page.getByRole('button', { name: 'チェックを中断して、支援の使い方を考える' }).click();
  assert.equal(await page.locator('input:checked').count(), 0, '目標と希望の選択も消えている');
  await page.getByRole('button', { name: '支援の使い方の案を見る' }).click();
  assert.equal(await page.locator('.route.is-selected').count(), 0, '選んだ案も消えている');
  await context.close();
});

test('キーボードだけで回答でき、画面切り替えで見出しにフォーカスが移る', async () => {
  const { context, page } = await open({ width: 1280, height: 900 });
  await page.locator('#start').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'screen-title');
  await page.locator('#begin-questions').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '人の集まりでは、場を盛り上げる。');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab'); // 戻る → 最初の選択肢へ（タブ順は環境で変わるため、選択肢に入るまで進める）
  for (let n = 0; n < 6; n += 1) {
    const isRadio = await page.evaluate(() => document.activeElement?.getAttribute('type') === 'radio');
    if (isRadio) break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#q1-a3').isChecked(), true);
  await page.waitForTimeout(360);
  await page.locator('#next').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.q-count').textContent(), '質問 2 / 20');
  await context.close();
});

test('アクセシビリティの基本（ラベル・タップ領域・reduced-motion）', async () => {
  const { context, page } = await open({ width: 360, height: 740, reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'チェックを始める' }).click();
  await page.getByRole('button', { name: '質問に進む' }).click();
  // すべての入力にラベルが付いている
  const unlabeled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input')).filter((i) => !i.labels || i.labels.length === 0).length,
  );
  assert.equal(unlabeled, 0);
  // タップ領域が 44px 以上
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

const VIEWPORTS = [
  { name: '360x740', width: 360, height: 740 },
  { name: '390x844', width: 390, height: 844 },
  { name: 'desktop-1280x900', width: 1280, height: 900 },
];

for (const vp of VIEWPORTS) {
  test(`表示確認とスクリーンショット ${vp.name}`, async () => {
    const { context, page, errors, requests } = await open({ width: vp.width, height: vp.height });
    const shot = async (label) => {
      assert.ok(await noHorizontalOverflow(page), `${label}: 横スクロールが出ない`);
      await page.waitForTimeout(300); // 画面切り替えのフェードが終わってから撮る
      await page.screenshot({ path: new URL(`${vp.name}-${label}.png`, shotDir).pathname, fullPage: label !== 'question' });
    };
    await shot('01-home');
    await page.getByRole('button', { name: 'チェックを始める' }).click();
    await shot('02-about');
    await page.getByRole('button', { name: '質問に進む' }).click();
    await answer(page, 4);
    await shot('03-question');
    await page.waitForTimeout(360);
    await page.locator('#next').click();
    for (let i = 1; i < 20; i += 1) {
      await answer(page, ((i * 3) % 5) + 1);
      await page.waitForTimeout(360);
      await page.locator('#next').click();
    }
    await shot('04-review');
    await settle(page);
    await page.getByRole('button', { name: '結果を見る' }).click();
    await shot('05-results');
    await page.getByRole('button', { name: '支援の使い方を考える' }).click();
    await page.locator('label[for="need-goals-career"]').click();
    await page.locator('label[for="need-barriers-procrastinate"]').click();
    await page.locator('label[for="need-time-3to7"]').click();
    await page.locator('label[for="need-prefs-review"]').click();
    await page.locator('label[for="need-frequency-weekly"]').click();
    await shot('06-needs');
    await page.getByRole('button', { name: '支援の使い方の案を見る' }).click();
    await page.locator('#pick-coach').click();
    await shot('07-routes');
    await page.getByRole('button', { name: '最初の小さな行動を選ぶ' }).click();
    await page.locator('label[for="act-coach-frequency"]').click();
    await shot('08-action');
    await page.getByRole('button', { name: '次のアクションをまとめる' }).click();
    await shot('09-summary');
    await page.locator('#reset').click();
    await shot('10-reset-dialog');
    assert.deepEqual(requests, [`${origin}/`]);
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('ダークモードの表示（390x844）', async () => {
  const { context, page } = await open({ width: 390, height: 844, colorScheme: 'dark' });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, 'rgb(15, 21, 23)');
  await page.screenshot({ path: new URL('390x844-dark-home.png', shotDir).pathname, fullPage: true });
  await context.close();
});

test('サーバーにはページ本体以外のリクエストが届いていない', () => {
  assert.ok(serverHits.length > 0);
  assert.deepEqual([...new Set(serverHits)], ['/']);
});
