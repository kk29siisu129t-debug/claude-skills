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
  await expect(page.locator('#honesty')).toContainText('AIによる理解・音声認識・話者識別は');
  await expect(page.locator('#honesty')).toContainText('していません');
  await expect(chip(page)).toHaveText('停止中（未開始）');
  await expect(page.locator('.chips')).toContainText('外部送信: なし');
  await expect(page.locator('.chips')).toContainText('音声: 未接続');
  await expect(page.locator('#current-title')).toHaveText('まだ論点はありません');
  await expect(page.locator('#list-routes li')).toHaveCount(3);
  // 詳細は折り畳み（タブ）。初期は手入力タブだけ開いている
  await expect(page.locator('#panel-manual')).toBeVisible();
  for (const p of ['review', 'topics', 'log', 'audio', 'data']) await expect(page.locator(`#panel-${p}`)).toBeHidden();
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
  await page.screenshot({ path: shot(testInfo, '05-demo-end-full'), fullPage: true });

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
  await page.locator('#tab-topics').click();
  await page.locator('#list-topics > li[data-id="t-format"]').getByRole('button', { name: '表示' }).click();
  await expect(page.locator('#past-banner')).toBeVisible();
  await expect(page.locator('#current-title')).toHaveText('週次定例の開催形式');
  await expect(page.locator('#current-meta')).toContainText('会議の現在の論点は「共有ドライブのフォルダ整理」');
  await page.getByRole('button', { name: '現在の論点に戻る' }).click();
  await expect(page.locator('#past-banner')).toBeHidden();
  await page.locator('#list-topics > li[data-id="t-format"]').getByRole('button', { name: '現在の論点にする' }).click();
  await expect(page.locator('#list-topics > li[data-id="t-format"]')).toContainText('現在');
  await page.locator('#tab-log').click();
  await expect(page.locator('#list-log > li').first()).toContainText('ユーザー入力');
});

test('書き出しは明示操作でのみ行い、消去で全て破棄される', async ({ page, baseURL }, testInfo) => {
  const g = await guard(page, baseURL);
  await page.goto('/');
  await stepTimes(page, 5);
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

test('初期 viewport 内に現在論点・決定・次に決めること・アクションが収まる', async ({ page }, testInfo) => {
  await page.goto('/');
  for (let i = 0; i < DEMO_STEPS.length; i++) await page.locator('#btn-step').click();
  await expect(chip(page)).toHaveText('再生終了（停止中）');
  await page.evaluate(() => window.scrollTo(0, 0));
  const vh = page.viewportSize().height;
  if (testInfo.project.name === 'desktop') {
    // 1440x900 でスクロールせずに主要サマリーが見える
    for (const sel of ['#current-title', '#list-confirmed > li', '#list-tentative > li', '#sum-next-title', '#list-next > li:last-child', '#sum-actions-title', '#list-actions > li']) {
      const b = await box(page, sel);
      expect(b.y, sel).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, `${sel} が画面外`).toBeLessThanOrEqual(vh);
    }
    // 確定・仮案・撤回の区別と根拠
    await expect(page.locator('#count-confirmed')).toHaveText('確定 1');
    await expect(page.locator('#count-tentative')).toHaveText('仮案 1');
    await expect(page.locator('#count-withdrawn')).toHaveText('撤回 1');
    await expect(page.locator('#list-confirmed .item-basis')).toContainText('根拠: 議長の確認に対し');
    await expect(page.locator('#list-tentative .item-basis')).toContainText('明示的な合意確認がない');
    await expect(page.locator('#list-withdrawn .item-basis')).toContainText('撤回理由: 交通費');
    // 詳細（履歴・ログ・音声・データ）はタブに畳まれている
    await expect(page.locator('#panel-log')).toBeHidden();
    await expect(page.locator('#panel-audio')).toBeHidden();
    await expect(page.locator('#panel-data')).toBeHidden();
  } else {
    // モバイル：論点 → サマリー → 内訳 の順で、論点は最初の画面内
    const cur = await box(page, '#current-title');
    expect(cur.y + cur.height).toBeLessThanOrEqual(vh);
    const current = await box(page, '#current');
    const summary = await box(page, '#summary');
    const lanes = await box(page, '#lanes');
    expect(summary.y).toBeGreaterThanOrEqual(current.y + current.height - 1);
    expect(lanes.y).toBeGreaterThanOrEqual(summary.y + summary.height - 1);
    // 最初の画面内に早見サマリー（件数）が見え、押すと各セクションへ移動する
    const quick = await box(page, '#quick-summary');
    expect(quick.y + quick.height, '早見サマリーが最初の画面外').toBeLessThanOrEqual(vh);
    await expect(page.locator('#quick-confirmed')).toHaveText('確定 1');
    await expect(page.locator('#quick-tentative')).toHaveText('仮案 1');
    await expect(page.locator('#quick-withdrawn')).toHaveText('撤回 1');
    await expect(page.locator('#quick-next')).toHaveText('次に決める 2');
    await expect(page.locator('#quick-actions')).toHaveText('アクション 1');
    await page.screenshot({ path: shot(testInfo, '05-demo-end'), fullPage: false });
    await page.locator('#quick-next').click();
    await expect(page.locator('#sum-next-title')).toBeInViewport();
    await expect(page.locator('#list-next > li').first()).toBeInViewport();
    await page.screenshot({ path: shot(testInfo, '11-jump-next'), fullPage: false });
    await page.locator('#quick-withdrawn').click();
    await expect(page.locator('#withdrawn-details')).toHaveAttribute('open', '');
    await expect(page.locator('#list-withdrawn .item-basis')).toContainText('撤回理由: 交通費');
    // 横スクロールが発生しない
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    return;
  }
  await expect(page.locator('#quick-summary')).toBeHidden(); // デスクトップは右カラムで常時表示
  await page.screenshot({ path: shot(testInfo, '05-demo-end'), fullPage: false });
});

test('再生中に修正を開くと自動で一時停止し、入力は消えない', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.selectOption('#speed', '900');
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
  await page.selectOption('#speed', '900');
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
  await expect(page.locator('#panel-manual')).toBeHidden();
  await page.locator('#tab-review').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-topics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#list-topics > li')).toHaveCount(3);
  await expect(page.locator('#tabcount-topics')).toHaveText('3');
  // 論点チップから過去の論点を参照できる
  await page.locator('#topic-chips > li[data-id="t-format"] button').click();
  await expect(page.locator('#past-banner')).toBeVisible();
});
