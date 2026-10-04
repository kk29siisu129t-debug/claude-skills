// Claude Artifact 用の単一 HTML（artifact/meeting-compass.html）を、Artifact の外枠に近い形で包んで試験する。
// - 外枠：charset / viewport(viewport-fit=cover) / 小さなリセット（公式の page contract の記述に合わせた近似）
// - CSP：Artifact より厳しめ（インライン以外の読み込みと connect を全面禁止）にして、外部依存が無いことを確かめる
// - ページ以外のリクエストはすべて記録して中止する
// 実際の claude.ai の閲覧画面そのものではない（ログインが必要なため、この環境からは開けない）。

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUNDLE = readFileSync(fileURLToPath(new URL('../../artifact/meeting-compass.html', import.meta.url)), 'utf8');
const PAGE_URL = 'http://artifact.local.test/';
// MC_ARTIFACT_SERVED に Artifact から読み戻した掲載 HTML（外枠込み）のパスを渡すと、それをそのまま使う
const SERVED = process.env.MC_ARTIFACT_SERVED ? readFileSync(process.env.MC_ARTIFACT_SERVED, 'utf8') : null;
const SHELL = SERVED ?? `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui;background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>${BUNDLE}</body></html>`;

const shot = (testInfo, name) => `screenshots/artifact-${SERVED ? 'served-' : ''}${testInfo.project.name}-${name}.png`;

async function openArtifact(page) {
  const requests = [];
  const errors = [];
  const downloads = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url === PAGE_URL) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SHELL });
    requests.push(url);
    return route.abort();
  });
  await page.addInitScript(() => {
    window.__mediaCalls = 0;
    const md = navigator.mediaDevices;
    if (md) {
      for (const name of ['getUserMedia', 'getDisplayMedia', 'enumerateDevices']) {
        if (md[name]) md[name] = () => { window.__mediaCalls += 1; return Promise.reject(new Error('blocked')); };
      }
    }
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(PAGE_URL);
  return { requests, errors, downloads };
}

const chip = (page) => page.locator('#chip-state');
/** 速さは「発言と速さ」の折り畳みの中にある */
async function setFastSpeed(page) {
  const more = page.locator('#controls-more');
  if (!(await more.evaluate((el) => el.open))) await more.locator('> summary').click();
  await page.selectOption('#speed', '900');
}

async function openDetails(page) {
  const fold = page.locator('#details-fold');
  if (!(await fold.evaluate((el) => el.open))) await fold.locator('> summary').click();
}
async function steps(page, n) {
  for (let i = 0; i < n; i++) await page.locator('#btn-step').click();
}

const node = (page, id) => page.locator(`#outline li[data-id="${id}"]`);
const nodeText = (page, id) => node(page, id).locator(':scope > .node-row .node-text-inner');

test('Artifact版：空のアウトラインと再生案内・由来の明記・書き出し無効・無通信・無メディア', async ({ page }, testInfo) => {
  const g = await openArtifact(page);
  await expect(page.locator('#honesty')).toContainText('事前に用意した構造イベント');
  await expect(page.locator('#honesty')).toContainText('AIによる理解・音声認識・話者識別は');
  await expect(page.locator('.chips')).toContainText('音声: 未接続');
  await expect(chip(page)).toHaveText('停止中（未開始）');
  await expect(page.locator('#outline-empty')).toBeVisible();
  await expect(page.locator('#outline > li')).toHaveCount(0);
  expect((await page.locator('main h2, main h3').allTextContents()).map((t) => t.trim())).toEqual(['会話のアウトライン', '手で書く']);
  await expect(page.locator('#footer-note')).toContainText('Claude Artifact 版');
  await expect(page.locator('#footer-note')).toContainText('AIによる理解・音声入力は未接続');
  await page.screenshot({ path: shot(testInfo, '01-initial'), fullPage: false });
  await openDetails(page);
  await page.locator('#tab-data').click();
  await expect(page.locator('#btn-export-json')).toBeDisabled();
  await expect(page.locator('#btn-export-md')).toBeDisabled();
  await expect(page.locator('#btn-export-json')).toHaveText('JSONを書き出す（Artifact版では無効）');
  await expect(page.locator('#data-hint')).toContainText('書き出しを無効にしています');
  await page.locator('#tab-audio').click();
  await expect(page.locator('#panel-audio')).toContainText('実接続は未実装');
  await expect(page.locator('#panel-audio button')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(g.requests).toEqual([]);
  expect(g.errors).toEqual([]);
  expect(await page.evaluate(() => window.__mediaCalls)).toBe(0);
});

test('Artifact版：再生で見出しと枝が育つ・一時停止・戻り・訂正・折り畳み・手で書く・消去', async ({ page }, testInfo) => {
  const g = await openArtifact(page);

  // 再生と一時停止（自動再生でも見出しが画面に出る）
  await setFastSpeed(page);
  await page.locator('#btn-play').click();
  await expect(chip(page)).toHaveText('再生中');
  await expect(nodeText(page, 'n-study')).toHaveText('社内勉強会を月1回はじめる', { timeout: 5000 });
  await page.locator('#btn-pause').click();
  await expect(chip(page)).toHaveText('一時停止中');
  const at = await page.locator('#progress-text').textContent();
  await page.waitForTimeout(1500);
  await expect(page.locator('#progress-text')).toHaveText(at ?? '');

  // 脱線 → 戻り（重複しない）→ 訂正
  const cursor = Number((at ?? '0').split('/')[0].trim());
  await steps(page, 5 - cursor);
  await expect(page.locator('#outline > li')).toHaveCount(2);
  await steps(page, 1);
  await expect(page.locator('#outline > li')).toHaveCount(2);
  await expect(node(page, 'n-lunch').locator(':scope > ol.children > li')).toHaveCount(2);
  await steps(page, 1);
  await expect(nodeText(page, 'n-lunch')).toHaveText('昼休みの45分で試す');
  await expect(node(page, 'n-lunch').locator(':scope > .node-row .badge-fix')).toHaveText('訂正 1');
  await steps(page, 2);
  await expect(chip(page)).toHaveText('再生終了（停止中）');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot(testInfo, '02-demo-end'), fullPage: false });
  await page.screenshot({ path: shot(testInfo, '02-demo-end-full'), fullPage: true });

  // 折り畳みと「最新の更新へ」
  await node(page, 'n-first').locator(':scope > .node-row .twisty').click();
  await expect(node(page, 'n-first').locator(':scope > ol.children')).toHaveCount(0);
  await page.locator('#btn-jump').click();
  await expect(node(page, 'n-first-other')).toBeInViewport();

  // 手で書く（新しい見出し・枝への追記・編集）と XSS
  await page.locator('#manual-text').fill('次回までに調べること');
  await page.locator('#manual-submit').click();
  const head = page.locator('#outline > li').last();
  await page.selectOption('#manual-target', (await head.getAttribute('data-id')) ?? '');
  await page.locator('#manual-text').fill('<img src=x onerror="window.__xss=1">');
  await page.locator('#manual-submit').click();
  await expect(head.locator(':scope > ol.children > li .node-text-inner')).toHaveText('<img src=x onerror="window.__xss=1">');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  const row = node(page, 'n-coffee').locator(':scope > .node-row');
  await row.hover();
  await row.getByRole('button', { name: '編集' }).click();
  await row.locator('textarea[name="text"]').fill('休憩室のコーヒー豆が変わった（雑談）');
  await row.getByRole('button', { name: '保存' }).click();
  await expect(nodeText(page, 'n-coffee')).toHaveText('休憩室のコーヒー豆が変わった（雑談）');
  await page.screenshot({ path: shot(testInfo, '03-manual'), fullPage: false });

  // 書き出しは押せない／ダウンロードは発生しない
  await openDetails(page);
  await page.locator('#tab-data').click();
  await page.locator('#btn-export-json').click({ force: true });
  await expect(page.locator('#data-feedback')).not.toContainText('書き出しました');

  // 消去
  await page.getByRole('button', { name: 'すべて消去' }).click();
  await page.getByRole('button', { name: '消去する' }).click();
  await expect(chip(page)).toHaveText('停止中（消去済み）');
  await expect(page.locator('#outline > li')).toHaveCount(0);
  await expect(page.locator('#outline-empty')).toContainText('内容は消去されました');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  expect(g.requests).toEqual([]);
  expect(g.downloads).toEqual([]);
  expect(g.errors).toEqual([]);
  expect(await page.evaluate(() => window.__mediaCalls)).toBe(0);
});

test('Artifact版：ダークテーマ（OS設定・明示指定）でも背景と文字色がトークンから決まる', async ({ page }) => {
  await openArtifact(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBg).toBe('rgb(15, 18, 24)');
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(15, 18, 24)');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(244, 245, 247)');
});
