// E2E の共通部品。dist/index.html をローカルの使い捨てサーバーから配信し、Chromium で開く。
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

export const shotDir = new URL('../../test-results/screenshots/', import.meta.url);

/** 画面切り替え直後のロック（450ms）を越えるまで待つ */
export const settle = (page) => page.waitForTimeout(500);

export async function startEnv() {
  const html = await readFile(new URL('../../dist/index.html', import.meta.url), 'utf8');
  await mkdir(shotDir, { recursive: true });
  const serverHits = [];
  const server = http.createServer((req, res) => {
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
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();

  async function open({ width = 390, height = 844, ...rest } = {}) {
    const context = await browser.newContext({
      viewport: { width, height },
      locale: 'ja-JP',
      hasTouch: width < 600,
      ...rest,
    });
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

  async function stop() {
    await browser.close();
    await new Promise((r) => server.close(r));
  }

  return { origin, open, stop, serverHits };
}

export const title = (page) => page.locator('#screen-title');
export const qCount = (page) => page.locator('.q-count').textContent();

/** 表示中の質問で、値 value（1〜4）の回答ボタンを押す */
export async function answer(page, value) {
  await page.locator(`button.answer[id$="-a${value}"]`).click();
}

export async function startQuestions(page) {
  await page.getByRole('button', { name: '簡易分析を始める' }).click();
  await settle(page);
  await page.getByRole('button', { name: /質問に進む|続きから答える/ }).click();
  await settle(page);
}

/** 全問を答えて回答の確認画面まで進む（各回答ですぐ次へ進む） */
export async function answerAll(page, valueFor) {
  await startQuestions(page);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(await qCount(page), `質問 ${i + 1} / 20`);
    await answer(page, typeof valueFor === 'function' ? valueFor(i) : valueFor);
    await settle(page);
  }
  await title(page).filter({ hasText: '回答の確認' }).waitFor();
}

export async function scores(page) {
  const out = {};
  for (const [k, name] of [
    ['E', '外向性'],
    ['A', '協調性'],
    ['C', '誠実性'],
    ['N', '感情の揺れやすさ'],
    ['O', '開放性'],
  ]) {
    const section = page.locator('section.factor', { has: page.locator('h2', { hasText: name }) });
    out[k] = (await section.locator('.score-num').textContent()).trim();
  }
  return out;
}

export async function assertNoPersistence(page, context, origin) {
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

export const activeText = (page) => page.evaluate(() => document.activeElement?.textContent ?? '');
export const activeId = (page) => page.evaluate(() => document.activeElement?.id ?? '');
