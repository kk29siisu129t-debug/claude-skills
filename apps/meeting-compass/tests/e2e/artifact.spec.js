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
async function steps(page, n) {
  for (let i = 0; i < n; i++) await page.locator('#btn-step').click();
}

test('Artifact版：初期表示・由来の明記・書き出し無効・無通信・無メディア', async ({ page }, testInfo) => {
  const g = await openArtifact(page);
  await expect(page.locator('#honesty')).toContainText('AIによる理解・音声認識・話者識別は');
  await expect(page.locator('#honesty')).toContainText('していません');
  await expect(page.locator('.chips')).toContainText('音声: 未接続');
  await expect(chip(page)).toHaveText('停止中（未開始）');
  await expect(page.locator('#footer-note')).toContainText('Claude Artifact 版');
  await expect(page.locator('#footer-note')).toContainText('AIによる理解・音声入力は未接続');
  await page.locator('#tab-data').click();
  await expect(page.locator('#btn-export-json')).toBeDisabled();
  await expect(page.locator('#btn-export-md')).toBeDisabled();
  await expect(page.locator('#btn-export-json')).toHaveText('JSONを書き出す（Artifact版では無効）');
  await expect(page.locator('#data-hint')).toContainText('書き出しを無効にしています');
  await page.locator('#tab-audio').click();
  await expect(page.locator('#panel-audio')).toContainText('実接続のアダプタは未実装');
  await expect(page.locator('#panel-audio button')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#tab-manual').click();
  await page.screenshot({ path: shot(testInfo, '01-initial'), fullPage: false });
  expect(g.requests).toEqual([]);
  expect(g.errors).toEqual([]);
  expect(await page.evaluate(() => window.__mediaCalls)).toBe(0);
});

test('Artifact版：デモ再生・一時停止・論点切替・訂正・撤回・手入力・修正・消去', async ({ page }, testInfo) => {
  const g = await openArtifact(page);

  // 再生と一時停止（自動再生でも構造が画面に反映される）
  await page.selectOption('#speed', '900');
  await page.locator('#btn-play').click();
  await expect(chip(page)).toHaveText('再生中');
  await expect(page.locator('#current-title')).toHaveText('週次定例の開催形式', { timeout: 5000 });
  await expect(page.locator('#list-proposal > li').first()).toBeVisible({ timeout: 5000 });
  await page.locator('#btn-pause').click();
  await expect(chip(page)).toHaveText('一時停止中');
  const at = await page.locator('#progress-text').textContent();
  await page.waitForTimeout(1500);
  await expect(page.locator('#progress-text')).toHaveText(at ?? '');

  // 一歩ずつ進めて脱線 → 戻り（論点切替）
  const cursor = Number((at ?? '0').split('/')[0].trim());
  await steps(page, 12 - cursor);
  await expect(page.locator('#current-title')).toHaveText('休憩室のコーヒーの話（脱線）');
  await steps(page, 2);
  await expect(page.locator('#current-title')).toHaveText('週次定例の開催形式');
  await expect(page.locator('#current-meta')).toContainText('1回戻ってきています');
  await page.screenshot({ path: shot(testInfo, '02-topic-return'), fullPage: false });

  // 訂正と撤回（台本）
  await steps(page, 3);
  await expect(page.locator('#list-reason > li[data-id="r-travel"]')).toContainText('1.5時間');
  await expect(page.locator('#count-withdrawn')).toHaveText('撤回 1');
  await steps(page, 6);
  await expect(chip(page)).toHaveText('再生終了（停止中）');
  await expect(page.locator('#list-confirmed .item-basis')).toContainText('根拠:');
  await expect(page.locator('#list-tentative > li[data-id="d-folders"]')).toContainText('合意未確認');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot(testInfo, '03-demo-end'), fullPage: false });

  // 論点チップで過去の論点を参照
  await page.locator('#topic-chips > li[data-id="t-format"] button').click();
  await expect(page.locator('#past-banner')).toBeVisible();
  await page.getByRole('button', { name: '現在の論点に戻る' }).click();

  // ユーザーによる撤回（確定済みの決定）
  const confirmed = page.locator('#list-confirmed > li[data-id="d-online"]');
  await confirmed.hover();
  await confirmed.getByRole('button', { name: '撤回' }).click();
  await expect(page.locator('#count-withdrawn')).toHaveText('撤回 2');

  // ユーザーによる訂正（修正フォーム）
  const prop = page.locator('#list-proposal > li[data-id="p-folders"]');
  await prop.hover();
  await prop.getByRole('button', { name: '修正' }).click();
  await prop.locator('textarea[name="text"]').fill('プロジェクト単位のフォルダ構成に統一する（移行は来月以降）');
  await prop.getByRole('button', { name: '保存' }).click();
  await expect(prop.locator('.item-text')).toHaveText('プロジェクト単位のフォルダ構成に統一する（移行は来月以降）');

  // 手入力（キーワード規則・決定語でも仮案）
  await page.locator('#tab-manual').click();
  await page.locator('#manual-text').fill('この方針で決定しました');
  await page.locator('#manual-submit').click();
  await expect(page.locator('#manual-feedback')).toContainText('仮案');
  await page.locator('#manual-text').fill('<img src=x onerror="window.__xss=1">');
  await page.locator('#manual-submit').click();
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await page.screenshot({ path: shot(testInfo, '04-manual'), fullPage: false });

  // 書き出しは押せない／ダウンロードは発生しない
  await page.locator('#tab-data').click();
  await page.locator('#btn-export-json').click({ force: true });
  await expect(page.locator('#data-feedback')).not.toContainText('書き出しました');

  // 消去
  await page.getByRole('button', { name: 'すべて消去' }).click();
  await page.getByRole('button', { name: '消去する' }).click();
  await expect(chip(page)).toHaveText('停止中（消去済み）');
  await expect(page.locator('#current-title')).toHaveText('内容は消去されました');
  expect(await page.evaluate(() => window.__meetingCompass.snapshot().items.length)).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot(testInfo, '05-cleared'), fullPage: false });

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
