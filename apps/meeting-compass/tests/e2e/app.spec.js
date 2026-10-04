import { test, expect } from '@playwright/test';
import { DEMO_STEPS } from '../../web/js/core/demo-script.js';

const shot = (testInfo, name) => `screenshots/${testInfo.project.name}-${name}.png`;

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

const lane = (page, id) => page.locator(`#${id} > li`);
const chip = (page) => page.locator('#chip-state');

/** 速さは「発言と速さ」の折り畳みの中にある */
async function setFastSpeed(page) {
  const more = page.locator('#controls-more');
  if (!(await more.evaluate((el) => el.open))) await more.locator('> summary').click();
  await page.selectOption('#speed', '900');
}

/** 折り畳みの「詳細」（要確認・履歴・音声・データ）を開く */
async function openDetails(page) {
  const fold = page.locator('#details-fold');
  if (!(await fold.evaluate((el) => el.open))) await fold.locator('> summary').click();
}

async function stepTimes(page, n) {
  for (let i = 0; i < n; i++) await page.locator('#btn-step').click();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('初期表示：由来の明記・停止状態・外部送信なし', async ({ page, baseURL }, testInfo) => {
  const g = await guard(page, baseURL);
  await page.goto('/');
  await expect(page.locator('#honesty')).toContainText('AIによる理解・音声認識・話者識別は');
  await expect(page.locator('#honesty')).toContainText('していません');
  await expect(chip(page)).toHaveText('停止中（未開始）');
  await expect(page.locator('.chips')).toContainText('外部送信: なし');
  await expect(page.locator('.chips')).toContainText('音声: 未接続');
  await expect(page.locator('#current-title')).toHaveText('まだ論点はありません');
  // 手入力は常に表示。詳細（要確認・履歴・音声・データ）は折り畳みで閉じている
  await expect(page.locator('#manual-form')).toBeVisible();
  expect(await page.locator('#details-fold').evaluate((el) => el.open)).toBe(false);
  for (const p of ['review', 'topics', 'log', 'audio', 'data']) await expect(page.locator(`#panel-${p}`)).toBeHidden();
  await openDetails(page);
  await page.locator('#tab-audio').click();
  await expect(page.locator('#list-routes li')).toHaveCount(3);
  await page.screenshot({ path: shot(testInfo, '01-initial'), fullPage: false });
  expect(g.external).toEqual([]);
  expect(g.errors).toEqual([]);
  expect(await page.evaluate(() => window.__mediaCalls)).toBe(0);
});

test('デモ：話題切替・脱線・戻り・撤回・訂正・合意未確認を一歩ずつ確認', async ({ page, baseURL }, testInfo) => {
  const g = await guard(page, baseURL);
  await page.goto('/');

  await stepTimes(page, 2);
  await expect(page.locator('#current-title')).toHaveText('週次定例の開催形式');
  await expect(chip(page)).toHaveText('一時停止中');
  // 差分更新：既存ノードが再利用されることを、DOM 要素に印を付けて確認
  await page.locator('#list-proposal > li[data-id="p-online"]').evaluate((el) => { el.__mark = 'keep'; });

  await stepTimes(page, 4); // s03〜s06
  await expect(lane(page, 'list-proposal')).toHaveCount(2);
  await expect(page.locator('#list-tentative > li[data-id="d-hybrid"]')).toContainText('仮案');
  await page.screenshot({ path: shot(testInfo, '02-first-topic'), fullPage: true });
  expect(await page.locator('#list-proposal > li[data-id="p-online"]').evaluate((el) => el.__mark)).toBe('keep');

  await stepTimes(page, 6); // s07〜s12（脱線）
  await expect(page.locator('#current-title')).toHaveText('休憩室のコーヒーの話（脱線）');
  await expect(page.locator('#current-meta')).toContainText('脱線した話題');
  await stepTimes(page, 1); // s13 未分類
  await expect(page.locator('#list-topic-unclassified > li')).toContainText('人による確認待ち');
  await page.screenshot({ path: shot(testInfo, '03-digression'), fullPage: true });

  await stepTimes(page, 1); // s14 戻り
  await expect(page.locator('#current-title')).toHaveText('週次定例の開催形式');
  await expect(page.locator('#current-meta')).toContainText('1回戻ってきています');
  // 訂正される理由の要素に印を付け、訂正後も同じ DOM ノードが差分更新されることを確認
  const reason = page.locator('#list-reason > li[data-id="r-travel"]');
  await reason.evaluate((el) => { el.__mark = 'keep'; });

  await stepTimes(page, 3); // s15〜s17 再検討→訂正→撤回
  await expect(reason).toContainText('1.5時間');
  expect(await reason.evaluate((el) => el.__mark)).toBe('keep');
  await reason.locator('details summary').click();
  await expect(reason.locator('details')).toContainText('3時間');
  await expect(page.locator('#list-withdrawn > li[data-id="d-hybrid"]')).toHaveCount(1);
  await expect(page.locator('#withdrawn-count')).toHaveText('1');
  await page.screenshot({ path: shot(testInfo, '04-withdraw-correct'), fullPage: true });

  await stepTimes(page, DEMO_STEPS.length - 17);
  await expect(chip(page)).toHaveText('再生終了（停止中）');
  await expect(page.locator('#btn-step')).toBeDisabled();
  await expect(page.locator('#list-confirmed > li[data-id="d-online"]')).toContainText('確定');
  const folders = page.locator('#list-tentative > li[data-id="d-folders"]');
  await expect(folders).toContainText('合意未確認');
  await expect(page.locator('#list-confirmed > li[data-id="d-folders"]')).toHaveCount(0);
  const action = page.locator('#list-actions > li[data-id="a-inventory"]');
  await expect(action).toContainText('担当: Bさん');
  await expect(action).toContainText('期限: 不明');
  await expect(page.locator('#list-log > li.is-rejected')).toHaveCount(1);
  await page.locator('#withdrawn-details > summary').click();
  await page.screenshot({ path: shot(testInfo, '04b-demo-end-withdrawn-open'), fullPage: true });

  // ID の重複が無い
  const ids = await page.evaluate(() => window.__meetingCompass.snapshot().items.map((i) => i.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(g.external).toEqual([]);
  expect(g.errors).toEqual([]);
});

test('再生・一時停止・再開・リセット', async ({ page }) => {
  await page.goto('/');
  await setFastSpeed(page);
  await page.locator('#btn-play').click();
  await expect(chip(page)).toHaveText('再生中');
  await expect(page.locator('#btn-pause')).toBeEnabled();
  await expect(page.locator('#progress-text')).toHaveText(/^[2-9] \//, { timeout: 5000 });
  // 自動再生中も論点・項目が画面に反映される
  await expect(page.locator('#current-title')).toHaveText('週次定例の開催形式');
  await expect(page.locator('#list-proposal > li').first()).toBeVisible();
  await page.locator('#btn-pause').click();
  await expect(chip(page)).toHaveText('一時停止中');
  const at = await page.locator('#progress-text').textContent();
  await page.waitForTimeout(1500);
  await expect(page.locator('#progress-text')).toHaveText(at ?? '');
  await expect(page.locator('#btn-play')).toHaveText('▶ 再開');
  await page.locator('#btn-play').click();
  await expect(chip(page)).toHaveText('再生中');
  await page.locator('#btn-reset').click();
  await expect(chip(page)).toHaveText('停止中（未開始）');
  await expect(page.locator('#current-title')).toHaveText('まだ論点はありません');
  await expect(page.locator('#list-log > li')).toHaveCount(0);
  await page.waitForTimeout(1200);
  await expect(page.locator('#list-log > li')).toHaveCount(0); // リセット後にタイマーが残っていない
});

test('手入力：空入力の拒否・規則分類・未分類・手動確定と修正', async ({ page, baseURL }, testInfo) => {
  const g = await guard(page, baseURL);
  await page.goto('/');
  const text = page.locator('#manual-text');
  const submit = page.locator('#manual-submit');
  const feedback = page.locator('#manual-feedback');

  await text.fill('   ');
  await submit.click();
  await expect(feedback).toHaveText(/入力が空です/);
  await expect(feedback).toHaveClass(/is-error/);

  await text.fill('議題: 新人研修の進め方');
  await submit.click();
  await expect(page.locator('#current-title')).toHaveText('新人研修の進め方');

  await text.fill('講師の負担が大きいのが心配');
  await submit.click();
  await expect(page.locator('#list-concern > li')).toContainText('キーワード「心配」');

  await text.fill('では研修はオンデマンド動画で決定しました');
  await submit.click();
  await expect(feedback).toContainText('仮案');
  const dec = page.locator('#list-tentative > li').first();
  await expect(dec).toContainText('仮案');
  await expect(page.locator('#list-confirmed > li')).toHaveCount(0);

  await text.fill('先週の続きの件');
  await submit.click();
  await expect(feedback).toContainText('自動では分類できませんでした');
  await expect(page.locator('#list-review > li')).toHaveCount(1);

  await text.fill('資料の棚卸しやります');
  await submit.click();
  const act = page.locator('#list-actions > li').first();
  await expect(act).toContainText('担当: 不明');
  await expect(act).toContainText('期限: 不明');
  await page.screenshot({ path: shot(testInfo, '06-manual'), fullPage: true });

  // ユーザーが確定
  await dec.getByRole('button', { name: '確定にする' }).click();
  await expect(page.locator('#list-confirmed > li')).toContainText('ユーザーが画面で確定操作');
  // 撤回 → 履歴に残る
  await page.locator('#list-confirmed > li').first().getByRole('button', { name: '撤回' }).click();
  await expect(page.locator('#withdrawn-count')).toHaveText('1');

  // 未分類を確認して分類
  await openDetails(page);
  await page.locator('#tab-review').click();
  const review = page.locator('#list-review > li').first();
  await review.getByRole('button', { name: '確認して分類' }).click();
  const editor = page.locator('#list-review form.editor');
  await editor.locator('select[name="kind"]').selectOption('open_question');
  await editor.locator('textarea[name="text"]').fill('先週の続きの件（何を決めるかを確認する）');
  await editor.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('#list-review > li')).toHaveCount(0);
  await expect(page.locator('#list-open > li')).toContainText('何を決めるかを確認する');

  // アクションの担当を入力、期限は空欄＝不明のまま
  await page.locator('#list-actions > li').first().getByRole('button', { name: '修正' }).click();
  const aed = page.locator('#list-actions form.editor');
  await aed.locator('input[name="owner"]').fill('自分');
  await aed.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('#list-actions > li').first()).toContainText('担当: 自分');
  await expect(page.locator('#list-actions > li').first()).toContainText('期限: 不明');
  await page.screenshot({ path: shot(testInfo, '07-manual-edited'), fullPage: true });
  expect(g.external).toEqual([]);
  expect(g.errors).toEqual([]);
});

test('危険な HTML 入力は文字として表示され、実行されない', async ({ page }, testInfo) => {
  await page.goto('/');
  const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  await page.locator('#manual-kind').selectOption('topic');
  await page.locator('#manual-text').fill(payload);
  await page.locator('#manual-submit').click();
  await page.locator('#manual-kind').selectOption('concern');
  await page.locator('#manual-text').fill(payload);
  await page.locator('#manual-submit').click();
  await expect(page.locator('#current-title')).toHaveText(payload);
  await expect(page.locator('#list-concern > li .item-text')).toHaveText(payload);
  expect(await page.locator('main img, main script').count()).toBe(0);
  // 空白のない長い入力でも横にはみ出さない
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => window.innerWidth)).toBe(page.viewportSize().width);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  // 編集フォームでも同様
  await page.locator('#list-concern > li').getByRole('button', { name: '修正' }).click();
  await expect(page.locator('#list-concern textarea[name="text"]')).toHaveValue(payload);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await page.screenshot({ path: shot(testInfo, '08-xss-as-text'), fullPage: false });
});

test('過去の論点の参照と「現在の論点にする」', async ({ page }) => {
  await page.goto('/');
  await stepTimes(page, 9); // 2つ目の論点まで
  await expect(page.locator('#current-title')).toHaveText('共有ドライブのフォルダ整理');
  await openDetails(page);
  await page.locator('#tab-topics').click();
  await page.locator('#list-topics > li[data-id="t-format"]').getByRole('button', { name: '表示' }).click();
  await expect(page.locator('#past-banner')).toBeVisible();
  await expect(page.locator('#current-title')).toHaveText('週次定例の開催形式');
  await expect(page.locator('#current-meta')).toContainText('会議の現在の論点は「共有ドライブのフォルダ整理」');
  await page.getByRole('button', { name: '現在の論点に戻る' }).click();
  await expect(page.locator('#past-banner')).toBeHidden();
  await page.locator('#list-topics > li[data-id="t-format"]').getByRole('button', { name: '現在の論点にする' }).click();
  await expect(page.locator('#list-topics > li[data-id="t-format"]')).toContainText('現在');
  await openDetails(page);
  await page.locator('#tab-log').click();
  await expect(page.locator('#list-log > li').first()).toContainText('ユーザー入力');
});

test('書き出しは明示操作でのみ行い、消去で全て破棄される', async ({ page, baseURL }, testInfo) => {
  const g = await guard(page, baseURL);
  await page.goto('/');
  await stepTimes(page, 5);
  await openDetails(page);
  await page.locator('#tab-data').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'JSONを書き出す' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('meeting-compass-export.json');
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const json = JSON.parse(await readFile(path, 'utf8'));
  expect(json.notice).toContain('AIによる会議理解の結果ではありません');
  expect(json.items.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'すべて消去' }).click();
  await expect(page.locator('#clear-confirm')).toBeVisible();
  await page.getByRole('button', { name: 'やめる' }).click();
  await expect(page.locator('#list-proposal > li')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'すべて消去' }).click();
  await page.getByRole('button', { name: '消去する' }).click();
  await expect(chip(page)).toHaveText('停止中（消去済み）');
  await expect(page.locator('#current-title')).toHaveText('内容は消去されました');
  await expect(page.locator('#list-log > li')).toHaveCount(0);
  await expect(page.locator('#list-topics > li')).toHaveCount(0);
  expect(await page.evaluate(() => window.__meetingCompass.snapshot().items.length)).toBe(0);
  // ブラウザ保存を使っていない
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.screenshot({ path: shot(testInfo, '09-cleared'), fullPage: false });
  expect(g.external).toEqual([]);
});

test('リロードすると内容は残らない（メモリのみ）', async ({ page }) => {
  await page.goto('/');
  await stepTimes(page, 3);
  await page.reload();
  await expect(page.locator('#current-title')).toHaveText('まだ論点はありません');
});

// ---------- 追加：レイアウト・編集保護 ----------

async function box(page, sel) {
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`no box: ${sel}`);
  return b;
}

test('縦1カラム：論点→構造→決定/仮案→未解決→次に決めること→アクションの順、横スクロールなし', async ({ page }, testInfo) => {
  await page.goto('/');
  // 初期状態でも、いまの論点が最初の画面に見える
  const vh = page.viewportSize().height;
  const vw = page.viewportSize().width;
  let cur = await box(page, '#current-title');
  expect(cur.y + cur.height, 'いまの論点が最初の画面外').toBeLessThanOrEqual(vh * 0.5);
  for (let i = 0; i < DEMO_STEPS.length; i++) await page.locator('#btn-step').click();
  await expect(chip(page)).toHaveText('再生終了（停止中）');
  await page.evaluate(() => window.scrollTo(0, 0));
  cur = await box(page, '#current-title');
  expect(cur.y + cur.height).toBeLessThanOrEqual(vh * 0.5);

  // 順序（上から下）と同じ左端・同じ幅＝縦1カラム
  const order = ['#controls-more', '#current', '#lanes', '#sum-decisions', '#sum-open', '#sum-next', '#sum-actions', '#manual', '#details-fold'];
  const boxes = [];
  for (const sel of order) boxes.push({ sel, ...(await box(page, sel)) });
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].y, `${boxes[i].sel} は ${boxes[i - 1].sel} の下`).toBeGreaterThan(boxes[i - 1].y);
  }
  const cards = boxes.slice(1);
  for (const b of cards) {
    expect(Math.abs(b.x - cards[0].x), `${b.sel} の左端`).toBeLessThanOrEqual(1);
    expect(Math.abs(b.width - cards[0].width), `${b.sel} の幅`).toBeLessThanOrEqual(1);
    expect(b.x).toBeGreaterThanOrEqual(15); // 左右16pxの余白
    expect(b.x + b.width).toBeLessThanOrEqual(vw - 15);
  }

  // 提案/理由/懸念/トレードオフも縦に並ぶ
  const lanes = [];
  for (const k of ['proposal', 'reason', 'concern', 'tradeoff']) lanes.push(await box(page, `.lane-${k}`));
  for (let i = 1; i < lanes.length; i++) {
    expect(lanes[i].y).toBeGreaterThan(lanes[i - 1].y + lanes[i - 1].height - 1);
    expect(Math.abs(lanes[i].x - lanes[0].x)).toBeLessThanOrEqual(1);
  }

  // 横スクロールなし・はみ出す要素なし（タブ列は自身の中でスクロール）
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const overflow = await page.evaluate(() => [...document.querySelectorAll('main *')]
    .filter((el) => !el.closest('.tabs') && el.getClientRects().length && el.getBoundingClientRect().right > window.innerWidth + 0.5)
    .map((el) => el.id || el.className).slice(0, 5));
  expect(overflow).toEqual([]);

  // 確定・仮案・撤回の区別と根拠
  await expect(page.locator('#count-confirmed')).toHaveText('確定 1');
  await expect(page.locator('#count-tentative')).toHaveText('仮案 1');
  await expect(page.locator('#count-withdrawn')).toHaveText('撤回 1');
  await expect(page.locator('#list-confirmed .item-basis')).toContainText('根拠: 議長の確認に対し');
  await expect(page.locator('#list-tentative .item-basis')).toContainText('明示的な合意確認がない');
  // デモ操作の詳細・履歴などは折り畳み
  expect(await page.locator('#controls-more').evaluate((el) => el.open)).toBe(false);
  expect(await page.locator('#details-fold').evaluate((el) => el.open)).toBe(false);
  await page.screenshot({ path: shot(testInfo, '05-demo-end'), fullPage: false });
  await page.screenshot({ path: shot(testInfo, '05-demo-end-full'), fullPage: true });

  // 早見サマリーから各セクションへ移動
  await page.locator('#quick-next').click();
  await expect(page.locator('#sum-next-title')).toBeInViewport();
  await page.locator('#quick-withdrawn').click();
  await expect(page.locator('#withdrawn-details')).toHaveAttribute('open', '');
  await expect(page.locator('#list-withdrawn .item-basis')).toContainText('撤回理由: 交通費');
});

test('再生中に修正を開くと自動で一時停止し、入力は消えない', async ({ page }, testInfo) => {
  await page.goto('/');
  await setFastSpeed(page);
  await page.locator('#btn-play').click();
  const item = page.locator('#list-proposal > li[data-id="p-online"]');
  await expect(item).toHaveCount(1, { timeout: 5000 });
  await item.hover();
  await item.getByRole('button', { name: '修正' }).click();
  await expect(chip(page)).toHaveText('一時停止中');
  await expect(page.locator('#control-note')).toBeVisible();
  await expect(page.locator('#btn-play')).toBeDisabled();
  await expect(page.locator('#btn-step')).toBeDisabled();
  const at = await page.locator('#progress-text').textContent();
  const ta = item.locator('textarea[name="text"]');
  await expect(ta).toBeFocused();
  await ta.fill('週次定例を全面オンラインに切り替える（試行は3か月）');
  await item.locator('input[name="reason"]').fill('期間を追記');
  await page.waitForTimeout(2500); // 以前は再生で作り直されて入力が消えていた
  await expect(ta).toHaveValue('週次定例を全面オンラインに切り替える（試行は3か月）');
  await expect(page.locator('#progress-text')).toHaveText(at ?? '');
  // 無効な再生ボタンを押しても進まない
  await page.locator('#btn-step').click({ force: true });
  await expect(page.locator('#progress-text')).toHaveText(at ?? '');
  await page.screenshot({ path: shot(testInfo, '10-editing-paused'), fullPage: false });
  await item.getByRole('button', { name: '保存' }).click();
  await expect(item.locator('.item-text')).toHaveText('週次定例を全面オンラインに切り替える（試行は3か月）');
  await expect(page.locator('#control-note')).toBeHidden();
  await expect(page.locator('#btn-play')).toBeEnabled();
  await page.locator('#btn-play').click();
  await expect(chip(page)).toHaveText('再生中');
});

test('編集は Esc でキャンセルでき、再生ボタンが戻る', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-step').click();
  await page.locator('#btn-step').click();
  const item = page.locator('#list-proposal > li[data-id="p-online"]');
  await item.hover();
  await item.getByRole('button', { name: '修正' }).click();
  await item.locator('textarea[name="text"]').fill('書きかけ');
  await page.keyboard.press('Escape');
  await expect(item.locator('.item-text')).toHaveText('週次定例を全面オンラインに切り替える');
  await expect(page.locator('#btn-step')).toBeEnabled();
});

test('再生中も手入力欄の入力は保持される', async ({ page }) => {
  await page.goto('/');
  await setFastSpeed(page);
  await page.locator('#btn-play').click();
  await page.locator('#manual-text').fill('入力途中のメモ');
  await page.waitForTimeout(2200);
  await expect(page.locator('#manual-text')).toHaveValue('入力途中のメモ');
  await page.locator('#btn-pause').click();
});

test('タブ切り替え（クリックと左右キー）と要確認への導線', async ({ page }) => {
  await page.goto('/');
  for (let i = 0; i < 13; i++) await page.locator('#btn-step').click();
  await expect(page.locator('#review-link')).toBeVisible();
  await page.locator('#review-link-btn').click();
  await expect(page.locator('#tab-review')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-review')).toBeVisible();
  expect(await page.locator('#details-fold').evaluate((el) => el.open)).toBe(true);
  await page.locator('#tab-review').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-topics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#list-topics > li')).toHaveCount(3);
  await expect(page.locator('#tabcount-topics')).toHaveText('3');
  // 論点チップから過去の論点を参照できる
  await page.locator('#topic-chips > li[data-id="t-format"] button').click();
  await expect(page.locator('#past-banner')).toBeVisible();
});
