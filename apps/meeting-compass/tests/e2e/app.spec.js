import { test, expect } from '@playwright/test';
import { OUTLINE_DEMO_STEPS } from '../../web/js/core/outline-demo.js';

const shot = (testInfo, name) => `screenshots/${testInfo.project.name}-${name}.png`;
/** 以前の固定スロット。会話から生まれていない見出しが先に並ばないこと */
const FIXED_SLOTS = ['いまの論点', '提案', '理由', '懸念', 'トレードオフ', '決定と仮案', '決定・仮案', '未解決', '次に決めること', 'あなたのアクション'];

/** 外部リクエストとマイク・画面取得 API の呼び出しを監視する */
async function guard(page, baseURL) {
  const external = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(baseURL) && !url.startsWith('data:') && !url.startsWith('blob:')) external.push(url);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__mediaCalls = 0;
    const md = navigator.mediaDevices;
    if (md) {
      for (const name of ['getUserMedia', 'getDisplayMedia']) {
        if (md[name]) md[name] = () => { window.__mediaCalls += 1; return Promise.reject(new Error('blocked in test')); };
      }
    }
  });
  return { external, errors };
}

const chip = (page) => page.locator('#chip-state');
const node = (page, id) => page.locator(`#outline li[data-id="${id}"]`);
const nodeText = (page, id) => node(page, id).locator(':scope > .node-row .node-text-inner');

async function stepTimes(page, n) {
  for (let i = 0; i < n; i++) await page.locator('#btn-step').click();
}
async function setFastSpeed(page) {
  const more = page.locator('#controls-more');
  if (!(await more.evaluate((el) => el.open))) await more.locator('> summary').click();
  await page.selectOption('#speed', '900');
}
async function openDetails(page) {
  const fold = page.locator('#details-fold');
  if (!(await fold.evaluate((el) => el.open))) await fold.locator('> summary').click();
}
async function noHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => window.innerWidth)).toBe(page.viewportSize().width);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('初期表示：空のアウトラインと再生案内、固定の見出し枠なし、由来の明記、無通信', async ({ page, baseURL }, testInfo) => {
  const g = await guard(page, baseURL);
  await page.goto('/');
  await expect(page.locator('#honesty')).toContainText('事前に用意した構造イベント');
  await expect(page.locator('#honesty')).toContainText('AIによる理解・音声認識・話者識別は');
  await expect(chip(page)).toHaveText('停止中（未開始）');
  await expect(page.locator('.chips')).toContainText('音声: 未接続');
  await expect(page.locator('#outline-empty')).toBeVisible();
  await expect(page.locator('#outline-empty')).toContainText('再生');
  await expect(page.locator('#outline > li')).toHaveCount(0);
  const headings = await page.locator('main h2, main h3').allTextContents();
  for (const slot of FIXED_SLOTS) expect(headings.map((t) => t.trim())).not.toContain(slot);
  expect(headings.map((t) => t.trim())).toEqual(['会話のアウトライン', '手で書く']);
  // 手入力にキーワード自動分類の選択肢は無い（追加先だけ）
  await expect(page.locator('#manual-kind')).toHaveCount(0);
  expect(await page.locator('#details-fold').evaluate((el) => el.open)).toBe(false);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: shot(testInfo, '01-initial'), fullPage: false });
  expect(g.external).toEqual([]);
  expect(g.errors).toEqual([]);
  expect(await page.evaluate(() => window.__mediaCalls)).toBe(0);
});

test('台本デモ：話題の誕生・枝分かれ・脱線・戻り（重複なし）・訂正（同じノード）', async ({ page, baseURL }, testInfo) => {
  const g = await guard(page, baseURL);
  await page.goto('/');

  await stepTimes(page, 1);
  await expect(page.locator('#outline > li')).toHaveCount(1);
  await expect(nodeText(page, 'n-study')).toHaveText('社内勉強会を月1回はじめる');
  await expect(page.locator('#step-caption')).toContainText('話題が生まれる');
  await expect(page.locator('#step-caption')).toContainText('事前に用意した構造イベント');

  await stepTimes(page, 3); // 枝・補足・別案（枝分かれ）
  await expect(node(page, 'n-study').locator(':scope > ol.children > li')).toHaveCount(2);
  await expect(node(page, 'n-lunch').locator(':scope > ol.children > li[data-id="n-lunch-why"]')).toHaveCount(1);
  await expect(node(page, 'n-evening').locator(':scope > .node-row .badge-label')).toHaveText('対比');
  await node(page, 'n-lunch').evaluate((el) => { el.__mark = 'keep'; });

  await stepTimes(page, 1); // 脱線＝別の見出し
  await expect(page.locator('#outline > li')).toHaveCount(2);
  await expect(node(page, 'n-coffee')).toHaveClass(/is-latest/);
  await page.screenshot({ path: shot(testInfo, '02-digression'), fullPage: true });

  await stepTimes(page, 1); // 同じ話題へ戻る
  await expect(page.locator('#outline > li')).toHaveCount(2, { timeout: 2000 });
  await expect(page.locator('#outline .node-text-inner', { hasText: '社内勉強会を月1回はじめる' })).toHaveCount(1);
  await expect(node(page, 'n-lunch').locator(':scope > ol.children > li')).toHaveCount(2);
  await expect(node(page, 'n-lunch-rec')).toHaveClass(/is-latest/);

  await stepTimes(page, 1); // 訂正
  await expect(nodeText(page, 'n-lunch')).toHaveText('昼休みの45分で試す');
  expect(await node(page, 'n-lunch').evaluate((el) => el.__mark)).toBe('keep'); // 同じ DOM ノードを更新
  await expect(node(page, 'n-lunch').locator(':scope > .node-row .badge-fix')).toHaveText('訂正 1');
  await node(page, 'n-lunch').locator(':scope > .node-row details.history > summary').click();
  await expect(node(page, 'n-lunch').locator(':scope > .node-row details.history')).toContainText('昼休みの30分で試す');
  await expect(node(page, 'n-lunch').locator(':scope > .node-row details.history')).toContainText('30分ではなく45分');

  await stepTimes(page, OUTLINE_DEMO_STEPS.length - 7);
  await expect(chip(page)).toHaveText('再生終了（停止中）');
  await expect(page.locator('#outline > li')).toHaveCount(3);
  // 並び順は会話に出た順のまま
  expect(await page.locator('#outline > li').evaluateAll((els) => els.map((e) => e.dataset.id))).toEqual(['n-study', 'n-coffee', 'n-first']);
  // 合意・担当・期限を作らない
  const all = await page.locator('#outline').innerText();
  expect(all).not.toMatch(/合意|担当|期限|決定しました/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot(testInfo, '03-demo-end'), fullPage: false });
  await page.screenshot({ path: shot(testInfo, '03-demo-end-full'), fullPage: true });
  await noHorizontalOverflow(page);
  const ids = await page.evaluate(() => Object.keys(window.__meetingCompass.snapshot().nodes));
  expect(new Set(ids).size).toBe(ids.length);
  expect(g.external).toEqual([]);
  expect(g.errors).toEqual([]);
});

test('再生・一時停止・再開・リセット', async ({ page }) => {
  await page.goto('/');
  await setFastSpeed(page);
  await page.locator('#btn-play').click();
  await expect(chip(page)).toHaveText('再生中');
  await expect(page.locator('#outline > li').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#progress-text')).toHaveText(/^[2-9] \//, { timeout: 5000 });
  await page.locator('#btn-pause').click();
  await expect(chip(page)).toHaveText('一時停止中');
  const at = await page.locator('#progress-text').textContent();
  const count = await page.locator('#outline li').count();
  await page.waitForTimeout(1500);
  await expect(page.locator('#progress-text')).toHaveText(at ?? '');
  expect(await page.locator('#outline li').count()).toBe(count);
  await page.locator('#btn-play').click();
  await expect(chip(page)).toHaveText('再生中');
  await page.locator('#btn-reset').click();
  await expect(chip(page)).toHaveText('停止中（未開始）');
  await expect(page.locator('#outline > li')).toHaveCount(0);
  await expect(page.locator('#outline-empty')).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.locator('#outline > li')).toHaveCount(0);
});

test('折り畳み：畳んだ枝は勝手に開かず「新しい追記あり」を出し、「最新の更新へ」で開いて移動', async ({ page }, testInfo) => {
  await page.goto('/');
  await stepTimes(page, 5);
  await node(page, 'n-study').locator(':scope > .node-row .twisty').click();
  await expect(node(page, 'n-study').locator(':scope > ol.children')).toHaveCount(0);
  await expect(node(page, 'n-study').locator(':scope > .node-row .twisty')).toHaveAttribute('aria-expanded', 'false');
  await stepTimes(page, 1); // 畳んだ枝の下（昼の案）に追記
  await expect(node(page, 'n-study').locator(':scope > ol.children')).toHaveCount(0);
  await expect(node(page, 'n-study').locator(':scope > .node-row .badge-new')).toHaveText('新しい追記あり');
  await expect(page.locator('#jump-count')).toBeVisible();
  await page.screenshot({ path: shot(testInfo, '04-collapsed'), fullPage: false });
  await page.locator('#btn-jump').click();
  await expect(node(page, 'n-lunch-rec')).toBeVisible();
  await expect(node(page, 'n-lunch-rec')).toBeInViewport();
  await expect(node(page, 'n-study').locator(':scope > .node-row .badge-new')).toHaveCount(0);
  await expect(page.locator('#jump-count')).toBeHidden();
});

test('読んでいる間は勝手にスクロール・並べ替えしない（上で追記されても読んでいる位置を保つ）', async ({ page }) => {
  await page.goto('/');
  await stepTimes(page, 5);
  // 下の方を長くして、読む位置を作る
  for (let i = 1; i <= 14; i++) {
    await page.locator('#manual-text').fill(`読み返し用のメモ ${i}：過去の話をここで読んでいる`);
    await page.locator('#manual-submit').click();
  }
  const anchor = page.locator('#outline > li').last();
  await anchor.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -40));
  const before = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  const orderBefore = await page.locator('#outline > li').evaluateAll((els) => els.map((e) => e.dataset.id));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  // 読んでいる間に台本が進む状況：ボタンまでスクロールせずに1歩進める（自動再生と同じ）
  await page.evaluate(() => document.getElementById('btn-step').click());
  await expect(node(page, 'n-lunch-rec')).toHaveCount(1); // 上の方（昼の案の下）に追記が入る
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(scrollBefore); // 上へ引き戻さない
  const after = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  await expect(page.locator('#outline > li')).toHaveCount(orderBefore.length);
  expect(await page.locator('#outline > li').evaluateAll((els) => els.map((e) => e.dataset.id))).toEqual(orderBefore);
});

test('手で書く：新しい見出し・選んだ枝に追記・重複は作らず既存へ・編集で訂正履歴', async ({ page, baseURL }, testInfo) => {
  const g = await guard(page, baseURL);
  await page.goto('/');
  const text = page.locator('#manual-text');
  const submit = page.locator('#manual-submit');
  const feedback = page.locator('#manual-feedback');

  await text.fill('   ');
  await submit.click();
  await expect(feedback).toHaveText(/入力が空です/);
  await expect(page.locator('#outline > li')).toHaveCount(0);

  await text.fill('倉庫レイアウトの見直し');
  await submit.click();
  await expect(feedback).toHaveText('見出しを追加しました。');
  const head = page.locator('#outline > li').first();
  const headId = await head.getAttribute('data-id');

  // 項目の「＋ ここに追記」で追加先がその枝になる
  await head.locator(':scope > .node-row').hover();
  await head.locator(':scope > .node-row').getByRole('button', { name: '＋ ここに追記' }).click();
  await expect(page.locator('#manual-target')).toHaveValue(headId ?? '');
  await text.fill('通路を広げたい');
  await submit.click();
  await expect(feedback).toHaveText('枝に追記しました。');
  await expect(head.locator(':scope > ol.children > li')).toHaveCount(1);
  const branch = head.locator(':scope > ol.children > li').first();

  // 選択肢から枝を選んで、さらに下へ
  const branchId = await branch.getAttribute('data-id');
  await page.selectOption('#manual-target', branchId ?? '');
  await text.fill('フォークリフトがすれ違えない');
  await submit.click();
  await expect(branch.locator(':scope > ol.children > li')).toHaveCount(1);

  // 同じ見出しを入れても増えない
  await page.selectOption('#manual-target', '');
  await text.fill('倉庫レイアウトの見直し');
  await submit.click();
  await expect(feedback).toContainText('新しく作らずに既存の項目へ移動しました');
  await expect(page.locator('#outline > li')).toHaveCount(1);

  // 編集＝訂正。同じノードで履歴が残る
  await branch.locator(':scope > .node-row').hover();
  await branch.locator(':scope > .node-row').getByRole('button', { name: '編集' }).click();
  const editor = branch.locator(':scope > .node-row form.editor');
  await editor.locator('textarea[name="text"]').fill('通路を1.5倍に広げたい');
  await editor.locator('input[name="reason"]').fill('数字を補足');
  await editor.getByRole('button', { name: '保存' }).click();
  await expect(branch.locator(':scope > .node-row .node-text-inner')).toHaveText('通路を1.5倍に広げたい');
  await expect(branch.locator(':scope > .node-row .badge-fix')).toHaveText('訂正 1');
  await openDetails(page);
  await expect(page.locator('#list-log > li').first()).toContainText('訂正');
  await page.screenshot({ path: shot(testInfo, '05-manual'), fullPage: false });
  expect(g.external).toEqual([]);
  expect(g.errors).toEqual([]);
});

test('再生中に編集を開くと自動で一時停止し、入力は消えない', async ({ page }, testInfo) => {
  await page.goto('/');
  await setFastSpeed(page);
  await page.locator('#btn-play').click();
  const target = node(page, 'n-study');
  await expect(target).toHaveCount(1, { timeout: 5000 });
  await target.locator(':scope > .node-row').hover();
  await target.locator(':scope > .node-row').getByRole('button', { name: '編集' }).click();
  await expect(chip(page)).toHaveText('一時停止中');
  await expect(page.locator('#control-note')).toBeVisible();
  await expect(page.locator('#btn-play')).toBeDisabled();
  await expect(page.locator('#btn-step')).toBeDisabled();
  const ta = target.locator(':scope > .node-row textarea[name="text"]');
  await expect(ta).toBeFocused();
  await ta.fill('社内勉強会を月1回はじめる（まず3か月）');
  await page.waitForTimeout(2500);
  await expect(ta).toHaveValue('社内勉強会を月1回はじめる（まず3か月）');
  await page.screenshot({ path: shot(testInfo, '06-editing-paused'), fullPage: false });
  await target.locator(':scope > .node-row').getByRole('button', { name: '保存' }).click();
  await expect(nodeText(page, 'n-study')).toHaveText('社内勉強会を月1回はじめる（まず3か月）');
  await expect(page.locator('#btn-play')).toBeEnabled();
  await page.locator('#btn-play').click();
  await expect(chip(page)).toHaveText('再生中');
});

test('編集は Esc でキャンセルできる', async ({ page }) => {
  await page.goto('/');
  await stepTimes(page, 1);
  const row = node(page, 'n-study').locator(':scope > .node-row');
  await row.hover();
  await row.getByRole('button', { name: '編集' }).click();
  await row.locator('textarea[name="text"]').fill('書きかけ');
  await page.keyboard.press('Escape');
  await expect(nodeText(page, 'n-study')).toHaveText('社内勉強会を月1回はじめる');
  await expect(page.locator('#btn-step')).toBeEnabled();
});

test('長文・危険な HTML は文字として表示され、横にはみ出さない', async ({ page }, testInfo) => {
  await page.goto('/');
  const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  const long = 'あ'.repeat(40) + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(6);
  await page.locator('#manual-text').fill(payload);
  await page.locator('#manual-submit').click();
  const head = page.locator('#outline > li').first();
  await page.selectOption('#manual-target', (await head.getAttribute('data-id')) ?? '');
  await page.locator('#manual-text').fill(long);
  await page.locator('#manual-submit').click();
  await expect(head.locator(':scope > .node-row .node-text-inner')).toHaveText(payload);
  await expect(page.locator('#outline .node-text-inner', { hasText: 'ABCDEFG' })).toHaveCount(1);
  expect(await page.locator('main img, main script').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  // 追加先の選択肢にも文字として入る
  expect(await page.locator('#manual-target option').nth(1).textContent()).toContain('<img');
  await noHorizontalOverflow(page);
  await page.screenshot({ path: shot(testInfo, '07-xss-long'), fullPage: false });
});

test('縦1列：操作の帯 → アウトライン → 手で書く → 詳細、同じ左端・余白16px以上・横スクロールなし', async ({ page }) => {
  await page.goto('/');
  await stepTimes(page, OUTLINE_DEMO_STEPS.length);
  await page.evaluate(() => window.scrollTo(0, 0));
  const vw = page.viewportSize().width;
  const order = ['.controls', '#outline-card', '#manual', '#details-fold'];
  const boxes = [];
  for (const sel of order) boxes.push(await page.locator(sel).boundingBox());
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
  for (const b of boxes) {
    expect(Math.abs(b.x - boxes[0].x)).toBeLessThanOrEqual(1);
    expect(b.x).toBeGreaterThanOrEqual(15);
    expect(b.x + b.width).toBeLessThanOrEqual(vw - 15);
  }
  // 最初の見出しは最初の画面に見える
  const first = await page.locator('#outline > li').first().boundingBox();
  expect(first.y).toBeLessThan(page.viewportSize().height * 0.6);
  await noHorizontalOverflow(page);
  const overflow = await page.evaluate(() => [...document.querySelectorAll('main *')]
    .filter((el) => !el.closest('.tabs') && el.getClientRects().length && el.getBoundingClientRect().right > window.innerWidth + 0.5)
    .map((el) => el.id || el.className).slice(0, 5));
  expect(overflow).toEqual([]);
});

test('書き出しは明示操作でのみ行い、消去で全て破棄される', async ({ page, baseURL }, testInfo) => {
  const g = await guard(page, baseURL);
  await page.goto('/');
  await stepTimes(page, 4);
  await openDetails(page);
  await page.locator('#tab-data').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSONを書き出す' }).click()]);
  expect(download.suggestedFilename()).toBe('meeting-compass-outline.json');
  const { readFile } = await import('node:fs/promises');
  const json = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(json.notice).toContain('AIによる会議理解の結果ではありません');
  expect(Object.keys(json.nodes).length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'すべて消去' }).click();
  await page.getByRole('button', { name: '消去する' }).click();
  await expect(chip(page)).toHaveText('停止中（消去済み）');
  await expect(page.locator('#outline > li')).toHaveCount(0);
  await expect(page.locator('#outline-empty')).toContainText('内容は消去されました');
  expect(await page.evaluate(() => Object.keys(window.__meetingCompass.snapshot().nodes).length)).toBe(0);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.screenshot({ path: shot(testInfo, '08-cleared'), fullPage: false });
  expect(g.external).toEqual([]);
});

test('リロードすると内容は残らない（メモリのみ）', async ({ page }) => {
  await page.goto('/');
  await stepTimes(page, 3);
  await page.reload();
  await expect(page.locator('#outline > li')).toHaveCount(0);
  await expect(page.locator('#outline-empty')).toBeVisible();
});

test('詳細のタブ（クリックと左右キー）と音声未接続の表示', async ({ page }) => {
  await page.goto('/');
  await openDetails(page);
  await expect(page.locator('#panel-log')).toBeVisible();
  await page.locator('#tab-log').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-audio')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#list-routes li')).toHaveCount(3);
  await expect(page.locator('#panel-audio button')).toBeDisabled();
});
