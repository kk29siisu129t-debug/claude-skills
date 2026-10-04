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

async function stepTimes(page, n) {
  for (let i = 0; i < n; i++) await page.locator('#btn-step').click();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('初期表示：由来の明記・停止状態・外部送信なし', async ({ page, baseURL }, testInfo) => {
  const g = await guard(page, baseURL);
  await page.goto('/');
  await expect(page.locator('#honesty')).toContainText('AIによる会議内容の理解・音声認識・話者識別は行っていません');
  await expect(chip(page)).toHaveText('停止中（未開始）');
  await expect(page.locator('.chips')).toContainText('外部送信: なし');
  await expect(page.locator('.chips')).toContainText('音声: 未接続');
  await expect(page.locator('#current-title')).toHaveText('まだ論点はありません');
  await expect(page.locator('#list-routes li')).toHaveCount(3);
  await page.screenshot({ path: shot(testInfo, '01-initial'), fullPage: true });
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
  await page.locator('details.withdrawn > summary').click();
  await page.screenshot({ path: shot(testInfo, '05-demo-end'), fullPage: true });

  // ID の重複が無い
  const ids = await page.evaluate(() => window.__meetingCompass.snapshot().items.map((i) => i.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(g.external).toEqual([]);
  expect(g.errors).toEqual([]);
});

test('再生・一時停止・再開・リセット', async ({ page }) => {
  await page.goto('/');
  await page.selectOption('#speed', '900');
  await page.locator('#btn-play').click();
  await expect(chip(page)).toHaveText('再生中');
  await expect(page.locator('#btn-pause')).toBeEnabled();
  await expect(page.locator('#progress-text')).toHaveText(/ステップ [2-9] /, { timeout: 5000 });
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
  await page.locator('#list-topics > li[data-id="t-format"]').getByRole('button', { name: '表示' }).click();
  await expect(page.locator('#past-banner')).toBeVisible();
  await expect(page.locator('#current-title')).toHaveText('週次定例の開催形式');
  await expect(page.locator('#current-meta')).toContainText('会議の現在の論点は「共有ドライブのフォルダ整理」');
  await page.getByRole('button', { name: '現在の論点に戻る' }).click();
  await expect(page.locator('#past-banner')).toBeHidden();
  await page.locator('#list-topics > li[data-id="t-format"]').getByRole('button', { name: '現在の論点にする' }).click();
  await expect(page.locator('#list-topics > li[data-id="t-format"]')).toContainText('現在');
  await expect(page.locator('#list-log > li').first()).toContainText('ユーザー入力');
});

test('書き出しは明示操作でのみ行い、消去で全て破棄される', async ({ page, baseURL }, testInfo) => {
  const g = await guard(page, baseURL);
  await page.goto('/');
  await stepTimes(page, 5);
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
