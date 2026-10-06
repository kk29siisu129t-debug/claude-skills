// ブラウザでの統合テスト（v2）。エディタの反復操作・戻る/再開・安全な読込・訴求変更、
// 書き出した LP の実寸検査（320/375/390/400/430/1280px、200% 相当、reduced-motion、JS 無効）。
// 実行: npm run test:e2e   （Chromium は /opt/pw-browsers を使用）
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './pw.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}/`;
const TMP = mkdtempSync(join(tmpdir(), 'lp-studio-e2e-'));
let server;
let browser;

before(async () => {
  server = spawn(process.execPath, ['serve.mjs', '--port', String(PORT)], { cwd: ROOT, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (String(d).includes('LP Studio')) resolve(); });
    server.on('error', reject);
    setTimeout(() => reject(new Error('server timeout')), 8000);
  });
  browser = await launch();
});
after(async () => { await browser?.close(); server?.kill(); });

async function openApp(context, viewport = { width: 1280, height: 900 }) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', async (d) => { errors.push(`dialog: ${d.message()}`); await d.dismiss(); });
  await page.goto(BASE);
  await page.waitForSelector('body[data-ready="1"]');
  return { page, errors };
}
const tab = async (page, name) => { await page.click(`#tab-${name}`); await page.waitForSelector(`#tab-${name}[aria-selected="true"]`); };
const frameText = (page, sel) => page.frameLocator(sel).locator('body').innerText();
async function downloadText(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  const path = join(TMP, `${Date.now()}-${dl.suggestedFilename()}`);
  await dl.saveAs(path);
  return { path, text: readFileSync(path, 'utf8'), name: dl.suggestedFilename() };
}

test('編集→WF→PC/SP→保存→再読込→書き出しを3回繰り返しても整合する', async () => {
  const context = await browser.newContext({ acceptDownloads: true });
  const { page, errors } = await openApp(context);
  for (let round = 1; round <= 3; round++) {
    const heading = `平日は迷う。${'一二三'[round - 1]}巡目の見出し。`;
    await tab(page, 'plan');
    await page.click('#pick-empathy');
    await page.fill('#f-heading', heading);
    await page.locator('#f-heading').press('Tab');
    await page.waitForFunction((hd) => document.querySelector('#wf-frame')?.srcdoc.includes(hd), heading);
    await tab(page, 'design');
    for (const f of ['#pc-frame', '#sp-frame']) assert.ok((await frameText(page, f)).replace(/\s/g, '').includes(heading.replace(/\s/g, '')), f);
    const saved = await downloadText(page, '#btn-save');
    assert.match(saved.name, /\.lpstudio\.json$/);
    const json = JSON.parse(saved.text);
    assert.equal(json.schemaVersion, 2);
    assert.equal(json.sections.find((s) => s.id === 'empathy').heading, heading);
    await page.click('#btn-new');
    await page.setInputFiles('#file-load', saved.path);
    await tab(page, 'plan');
    await page.waitForFunction((hd) => document.querySelector('#wf-frame')?.srcdoc.includes(hd), heading);
    await page.reload();
    await page.waitForSelector('body[data-ready="1"]');
    await tab(page, 'plan');
    assert.ok((await page.locator('#wf-frame').getAttribute('srcdoc')).includes(heading));
    await tab(page, 'export');
    const draft = await downloadText(page, '#btn-export-draft');
    assert.match(draft.text, /社内確認用ドラフト/);
    const review = await downloadText(page, '#btn-export-review');
    const plain = review.text.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '');
    assert.ok(plain.includes(heading), heading); // 見出しは文節ごとの span に分かれて出力される
    assert.ok(!/4\.2|満足度92|根拠あり/.test(review.text.replace(/<style>[\s\S]*?<\/style>/, '')));
    assert.equal(await page.locator('#btn-export-commercial').isDisabled(), true);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('戻る/やり直す、ブラウザの戻る/進む、再読込で再開', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await tab(page, 'plan');
  const count = () => page.locator('ol.plan > li').count();
  const n0 = await count();
  await page.selectOption('#add-role', 'fit');
  await page.click('#btn-add-section');
  assert.equal(await count(), n0 + 1);
  await page.click('#del-faq');
  assert.equal(await count(), n0);
  await page.click('#btn-undo');
  assert.equal(await count(), n0 + 1);
  await page.click('#btn-undo');
  assert.equal(await count(), n0);
  await page.click('#btn-redo');
  assert.equal(await count(), n0 + 1);
  assert.equal(await page.locator('#del-hero').count(), 0);
  await tab(page, 'design');
  await tab(page, 'lpo');
  await page.goBack();
  await page.waitForSelector('#tab-design[aria-selected="true"]');
  await page.goBack();
  await page.waitForSelector('#tab-plan[aria-selected="true"]');
  await page.goForward();
  await page.waitForSelector('#tab-design[aria-selected="true"]');
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]');
  await page.waitForSelector('#tab-design[aria-selected="true"]');
  await tab(page, 'plan');
  assert.equal(await count(), n0 + 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('インサイトは仮説として表示され、訴求を変えると依存セクションが要再確認になる（手動編集は保持）', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await tab(page, 'insight');
  assert.equal(await page.locator('[data-insight] .badge').first().innerText(), '仮説（顧客の原文・観察で未確認）');
  await page.click('#angle-a2');
  await tab(page, 'plan');
  for (const id of ['empathy', 'mechanism', 'closing']) assert.match(await page.locator(`[data-section-id="${id}"] .tags`).innerText(), /要再確認/);
  assert.doesNotMatch(await page.locator('[data-section-id="faq"] .tags').innerText(), /要再確認/);
  await tab(page, 'gen');
  await page.click('#gmode-reangle');
  assert.match(await page.locator('#gen-prompt').inputValue(), /依存する役割/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('2つ目の業種（見積もり共有ツール）も同じエディタで開け、語彙と図が変わる', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await page.selectOption('#seed-pick', 'mitsumoriban');
  await page.waitForFunction(() => document.querySelector('#project-name').value.includes('見積もり番'));
  await tab(page, 'design');
  const t = await frameText(page, '#pc-frame');
  assert.match(t, /返事待ちの見積もりを/);
  assert.match(t, /共有一覧のイメージ・架空データ/);
  for (const w of ['15分', '簿記', '合格']) assert.ok(!t.includes(w), w);
  assert.deepEqual(errors, []);
  await context.close();
});

test('安全な読込: スクリプト入りJSONはテキスト扱い、HTML・不正JSONは拒否', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  const seed = JSON.parse(readFileSync(join(ROOT, 'seed/michishirube.project.json'), 'utf8'));
  seed.name = '<img src=x onerror=alert(1)>';
  seed.sections[1].heading = '<script>alert(1)</script>見出し';
  seed.inputs.action.url = 'javascript:alert(1)';
  const evilPath = join(TMP, 'evil.json');
  writeFileSync(evilPath, JSON.stringify(seed));
  await page.setInputFiles('#file-load', evilPath);
  await tab(page, 'plan');
  await page.waitForFunction(() => document.querySelector('#wf-frame')?.srcdoc.includes('&lt;script&gt;'));
  assert.match(await frameText(page, '#wf-frame'), /<script>alert\(1\)<\/script>見出し/);
  await tab(page, 'design');
  const hrefs = await page.frameLocator('#pc-frame').locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  assert.ok(hrefs.every((h) => h.startsWith('#')));
  const htmlPath = join(TMP, 'page.html');
  writeFileSync(htmlPath, '<html><script>alert(1)</script></html>');
  await page.setInputFiles('#file-load', htmlPath);
  await page.waitForSelector('#toast.show[data-kind="error"]');
  const badPath = join(TMP, 'bad.json');
  writeFileSync(badPath, '{"schemaVersion":2, broken');
  await page.setInputFiles('#file-load', badPath);
  await page.waitForFunction(() => /読み込めません/.test(document.querySelector('#toast').textContent));
  assert.equal(await page.locator('#project-name').inputValue(), '<img src=x onerror=alert(1)>');
  assert.deepEqual(errors, []);
  await context.close();
});

test('検証・公開判定: レビュー用と実販売を分け、合成データは検証用として表示', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await tab(page, 'export');
  assert.match(await page.locator('#gate-review').innerText(), /安全に描画できます/);
  const com = await page.locator('#gate-commercial').innerText();
  for (const w of ['商用公開不可', '架空サービスのデモ', '料金が未確定', 'example ドメイン', '面談の所要時間']) assert.ok(com.includes(w), w);
  assert.match(await page.locator('tr.synthetic').first().innerText(), /LPの成果根拠には出しません/);
  // 15分を面談に転用すると停止条件になり、レビュー用も止まる
  await tab(page, 'plan');
  await page.click('#pick-hero');
  await page.fill('#f-cta', 'まず15分の相談を予約する');
  await page.locator('#f-cta').press('Tab');
  await tab(page, 'export');
  assert.match(await page.locator('#gate-review').innerText(), /停止条件があります[\s\S]*面談の所要時間/);
  assert.equal(await page.locator('#btn-export-review').isDisabled(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Claude Code の JSON 取り込み（仮説・未承認、停止条件の表示）', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await tab(page, 'plan');
  await page.click('#pick-empathy');
  await tab(page, 'gen');
  await page.click('#gmode-section');
  await page.fill('#gen-response', JSON.stringify({ generator: 'claude-code', mode: 'section', sections: [{ role: 'empathy', heading: '平日は迷う。', body: '受講生1140人が満足。', sourceRefs: ['s1-scene'] }] }));
  await page.click('#btn-ingest');
  await page.waitForSelector('#ingest-report');
  assert.match(await page.locator('#ingest-report').innerText(), /停止/);
  await tab(page, 'plan');
  assert.match(await page.locator('[data-section-id="empathy"] .tags').innerText(), /Claude Code生成[\s\S]*停止条件|停止条件[\s\S]*Claude Code生成|未承認/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('プレビュー操作: 1440×1000 で開始位置 y≤220、端末切替・動きを減らす・再生・縮小率表示', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context, { width: 1440, height: 1000 });
  await tab(page, 'design');
  const y = await page.evaluate(() => document.querySelector('.frame-wrap').getBoundingClientRect().top);
  assert.ok(y <= 220, `preview y=${y}`);
  assert.match(await page.locator('#pc-frame').locator('xpath=../..').locator('.scale-tag').innerText(), /縮小 \d+%/);
  await page.click('#dev-sp');
  assert.equal(await page.locator('#pc-frame').count(), 0);
  assert.match(await page.locator('.scale-tag').innerText(), /100%（実寸）/);
  await page.check('#pv-reduce');
  assert.ok((await page.locator('#sp-frame').getAttribute('srcdoc')).includes('data-reduce-motion'));
  const before = await page.locator('#sp-frame').getAttribute('srcdoc');
  await page.click('#pv-replay');
  assert.notEqual(await page.locator('#sp-frame').getAttribute('srcdoc'), before);
  assert.deepEqual(errors, []);
  await context.close();
});

test('LPO と CTA 比較（配信しない）', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await tab(page, 'lpo');
  assert.match(await page.locator('#lpo-banner').innerText(), /架空データ/);
  assert.match(await page.locator('#panel').innerText(), /判定しない[\s\S]*比較しない/);
  await tab(page, 'cta');
  assert.match(await page.locator('#panel').innerText(), /AB配信・広告設定は行いません/);
  await page.click('#btn-add-cta');
  await page.selectOption('#cta-b-timing', 'after-half');
  await page.click('#cta-b-use');
  await page.waitForSelector('[data-variant="b"].active');
  assert.deepEqual(errors, []);
  await context.close();
});

test('キーボード: タブは矢印キーで移動し、入力欄へ Tab で進める', async () => {
  const context = await browser.newContext();
  const { page } = await openApp(context);
  await page.focus('#tab-inputs');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('#tab-insight[aria-selected="true"]');
  await page.keyboard.press('End');
  await page.waitForSelector('#tab-gen[aria-selected="true"]');
  await page.keyboard.press('Home');
  await page.waitForSelector('#tab-inputs[aria-selected="true"]');
  await page.focus('#d-brand');
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement.tagName)));
  await context.close();
});

test('エディタ: 320/375/390/430/1280px で横スクロールなし', async () => {
  for (const width of [320, 375, 390, 430, 1280]) {
    const context = await browser.newContext();
    const { page, errors } = await openApp(context, { width, height: 800 });
    for (const t of ['inputs', 'insight', 'plan', 'design', 'export', 'cta', 'lpo', 'gen']) {
      await tab(page, t);
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(sw <= cw, `app ${width}px ${t}: ${sw} > ${cw}`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

// ---- 書き出した LP の実寸検査 ----
function exportReview(id) {
  const out = join(TMP, `${id}.html`);
  const r = spawn(process.execPath, ['cli.mjs', 'export', '--project', `seed/${id}.project.json`, '--kind', 'review', '--out', out], { cwd: ROOT });
  return new Promise((res, rej) => r.on('exit', (c) => (c === 0 ? res(out) : rej(new Error(`export ${c}`)))));
}
async function sticky(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.sticky-cta');
    const r = bar.getBoundingClientRect();
    const shown = bar.classList.contains('show') && getComputedStyle(bar).visibility === 'visible';
    const inl = [...document.querySelectorAll('.cta-zone')].map((a) => a.getBoundingClientRect()).filter((b) => b.bottom > 0 && b.top < innerHeight);
    const overlap = shown && inl.some((b) => !(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom));
    return { shown, inert: bar.hasAttribute('inert'), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), overlap };
  });
}

test('LP: 2ケース × 320/375/390/400/430/1280px — 横スクロールなし・見出しを文節の途中で割らない・本文16px・FVの収まり', async () => {
  for (const id of ['michishirube', 'mitsumoriban']) {
    const file = await exportReview(id);
    for (const [w, hgt] of [[320, 640], [375, 740], [390, 844], [400, 760], [430, 932], [1280, 800]]) {
      const context = await browser.newContext({ viewport: { width: w, height: hgt } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`file://${file}`);
      await page.waitForTimeout(1300);
      const m = await page.evaluate(() => {
        const ph = [...document.querySelectorAll('h1 .ph, h2 .ph')];
        const broken = ph.filter((s) => s.getClientRects().length > 1 && s.getBoundingClientRect().width < s.parentElement.getBoundingClientRect().width * 0.98).map((s) => s.textContent);
        const p = document.querySelector('.sec .body p');
        const cs = getComputedStyle(p);
        const cta = document.querySelector('.hero .btn-primary').getBoundingClientRect();
        const vis = document.querySelector('.hero-visual').getBoundingClientRect();
        return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, broken, fs: cs.fontSize, lh: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize), h1: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize), ctaBottom: cta.bottom, visBottom: vis.bottom, heroBottom: document.querySelector('.hero').getBoundingClientRect().bottom, fw: getComputedStyle(document.querySelector('.ph')).fontWeight, bodyW: getComputedStyle(document.body).fontWeight };
      });
      assert.ok(m.sw <= m.cw, `${id} ${w}: h-scroll`);
      assert.deepEqual(m.broken, [], `${id} ${w}: 見出しの文節が途中で割れた`);
      assert.equal(m.fs, w >= 768 ? '16px' : '16px');
      assert.ok(Math.abs(m.lh - 1.8) < 0.05);
      assert.equal(m.bodyW, '400');
      const expectH1 = w < 360 ? 26 : w < 400 ? 28 : w < 768 ? 31 : 52;
      assert.equal(m.h1, expectH1, `${id} ${w}: h1 ${m.h1}`);
      assert.ok(m.ctaBottom <= hgt, `${id} ${w}: 主CTAが最初の画面に無い`);
      if (w === 400) assert.ok(m.heroBottom <= 680 + 40 && m.visBottom < m.ctaBottom, `${id} 400: FV ${m.heroBottom}`); // デモ帯を除くFVは約680px以内
      if (w === 360 || w === 375) assert.ok(m.heroBottom <= 760);
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
});

test('LP: 固定CTAの表示ルール・寸法・重なり（PC 1280 / SP 400 / SP 360 / 200%相当 640）', async () => {
  for (const id of ['michishirube', 'mitsumoriban']) {
    const file = await exportReview(id);
    for (const [w, hgt] of [[1280, 800], [400, 760], [360, 800], [640, 400]]) {
      const context = await browser.newContext({ viewport: { width: w, height: hgt } });
      const page = await context.newPage();
      await page.goto(`file://${file}`);
      await page.waitForTimeout(400);
      let s = await sticky(page);
      assert.equal(s.shown, false, `${id} ${w} FV`);
      assert.equal(s.inert, true);
      await page.evaluate(() => document.querySelector('#mechanism').scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.waitForTimeout(800); // 固定CTAの出入り（0.25秒）が終わってから測る
      s = await sticky(page);
      assert.equal(s.shown, true, `${id} ${w} 本文`);
      if (w === 1280) { assert.deepEqual([s.w, s.h, s.right], [340, 60, 24]); assert.ok(Math.abs(s.bottom - 24) <= 1, `bottom ${s.bottom}`); }
      else { assert.equal(s.h, 56); assert.equal(s.w, w - 24); assert.ok(s.bottom >= 11, `${id} ${w} bottom ${s.bottom}`); }
      await page.evaluate(() => document.querySelector('.closing .cta-row').scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForTimeout(500);
      s = await sticky(page);
      assert.equal(s.shown, false, `${id} ${w} 締めのCTA`);
      assert.equal(s.overlap, false);
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await page.waitForTimeout(500);
      const cover = await page.evaluate(() => {
        const bar = document.querySelector('.sticky-cta');
        if (!bar.classList.contains('show')) return false;
        const r = bar.getBoundingClientRect();
        return [...document.querySelectorAll('footer *')].some((p) => { const b = p.getBoundingClientRect(); return b.height && !(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom); });
      });
      assert.equal(cover, false, `${id} ${w} フッターと重なる`);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      assert.ok(sw, `${id} ${w} h-scroll`);
      await context.close();
    }
  }
});

test('LP: 文字とCTAは最初の描画から読める／reduced-motion・JS無効でも全情報が見える', async () => {
  const file = await exportReview('michishirube');
  const ctx = await browser.newContext({ viewport: { width: 400, height: 760 } });
  const page = await ctx.newPage();
  await page.goto(`file://${file}`, { waitUntil: 'commit' });
  await page.waitForSelector('h1');
  const op = await page.evaluate(() => ['h1', '.lead', '.hero .btn-primary'].map((s) => { let o = 1; for (let n = document.querySelector(s); n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; }));
  assert.deepEqual(op, [1, 1, 1]);
  await ctx.close();
  for (const opts of [{ reducedMotion: 'reduce' }, { javaScriptEnabled: false }]) {
    const c = await browser.newContext({ viewport: { width: 400, height: 760 }, ...opts });
    const p = await c.newPage();
    await p.goto(`file://${file}`);
    const r = await p.evaluate(() => ({ js: document.documentElement.classList.contains('js'), hidden: [...document.querySelectorAll('.reveal, .hero-visual')].filter((e) => getComputedStyle(e).opacity !== '1').length }));
    assert.equal(r.js, false);
    assert.equal(r.hidden, 0, JSON.stringify(opts));
    await c.close();
  }
});

test('自己完結版（dist/lp-studio-standalone.html）を file:// で開いて操作できる', async () => {
  const built = spawn(process.execPath, ['build-standalone.mjs'], { cwd: ROOT });
  await new Promise((r) => built.on('exit', r));
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`file://${join(ROOT, 'dist/lp-studio-standalone.html')}`);
  await page.waitForSelector('body[data-ready="1"]');
  await tab(page, 'design');
  await page.waitForTimeout(500);
  assert.equal(await page.frameLocator('#pc-frame').locator('html').getAttribute('class'), 'js');
  await page.selectOption('#seed-pick', 'mitsumoriban');
  await page.waitForFunction(() => document.querySelector('#project-name').value.includes('見積もり番'));
  await tab(page, 'export');
  const review = await downloadText(page, '#btn-export-review');
  assert.match(review.text, /返事待ちの見積もりを/);
  assert.deepEqual(errors, []);
  await context.close();
});
