// ブラウザでの統合テスト（v2）。エディタの反復操作・戻る/再開・安全な読込・訴求変更、
// 書き出した LP の実寸検査（320/375/390/400/430/1280px、200% 相当、reduced-motion、JS 無効）。
// 実行: npm run test:e2e   （Chromium は /opt/pw-browsers を使用）
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, existsSync, rmSync, symlinkSync } from 'node:fs';
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
  const hero = JSON.parse(readFileSync(join(ROOT, 'examples/v2/mitsumoriban/response.json'), 'utf8')).sections[0];
  assert.ok(t.includes(hero.headingPhrases[0]) && t.includes(hero.visual.label) && t.includes(hero.visual.rows[0][0]), '見積もり番の見出し・架空の一覧が出る');
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
  // 色を変えると、その案のプレビュー（実際の描画）に反映される
  await page.locator('#cta-b-color').evaluate((el) => { el.value = '#0f5c4a'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => /#0f5c4a/i.test(document.querySelector('#cta-frame-b')?.srcdoc || ''));
  assert.ok(!/#0f5c4a/i.test(await page.locator('#cta-frame-a').getAttribute('srcdoc')), '案Aのプレビューは変わらない');
  assert.match(await page.locator('#cta-frame-b').getAttribute('srcdoc'), /data-timing="after-half"/);
  assert.match(await page.locator('#cta-frame-a').getAttribute('srcdoc'), /data-timing="spec"/);
  await page.click('#cta-b-use');
  await page.waitForSelector('[data-variant="b"].active');
  // 比較用のタイミングを採用すると、実販売の理由に出る（配信はしない）
  await tab(page, 'export');
  assert.match(await page.locator('#gate-commercial').innerText(), /固定CTAの表示タイミングが比較用の案/);
  // LPO 画面: 未接続の一覧・観測と推測の分離・guardrail・停止条件
  await tab(page, 'lpo');
  const lpo = await page.locator('#panel').innerText();
  for (const w of ['未接続:', '観測（架空集計）', '仮説と検証計画', 'guardrail', '停止条件']) assert.ok(lpo.includes(w), w);
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

test('エディタ: 320/375/390/400/430/1280px で横スクロールなし', async () => {
  for (const width of [320, 375, 390, 400, 430, 1280]) {
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
        const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const h1el = document.querySelector('.hero h1');
        const hero = document.querySelector('.hero');
        return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, broken, fs: cs.fontSize, lh: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize), h1: parseFloat(getComputedStyle(h1el).fontSize), h1Lines: Math.round(h1el.getBoundingClientRect().height / parseFloat(getComputedStyle(h1el).lineHeight)), ctaBottom: cta.bottom, heroBottom: hero.getBoundingClientRect().bottom, fw: getComputedStyle(document.querySelector('.ph')).fontWeight, bodyW: getComputedStyle(document.body).fontWeight,
          portrait: hero.classList.contains('hero-portrait'), ctas: hero.querySelectorAll('.btn').length, disabled: hero.querySelectorAll('[aria-disabled],[disabled]').length,
          chars: hero.innerText.replace(/\s/g, '').length, vis: r('.hero-visual'), h1r: r('.hero h1'), ctar: r('.hero .btn-primary'), photo: r('.hero-photo img'), cap: r('.photo-cap'), sub: r('.hero-sub'), badge: hero.querySelector('.demo-badge')?.textContent };
      });
      assert.ok(m.sw <= m.cw, `${id} ${w}: h-scroll`);
      assert.deepEqual(m.broken, [], `${id} ${w}: 見出しの文節が途中で割れた`);
      assert.equal(m.fs, '16px');
      assert.ok(Math.abs(m.lh - 1.8) < 0.05);
      assert.equal(m.bodyW, '400');
      // FV v3（ユーザーレビューで旧 FV は不合格）: H1 は顔写真版 PC 56 / SP 12vw（400px で 48・360px で 43.2・320px で 38.4）、図版 PC 64 / SP 36 / 〜359px 30
      const expectH1 = m.portrait ? (w < 768 ? Math.min(48, Math.max(36, w * 0.12)) : 56) : (w < 360 ? 30 : w < 768 ? 36 : 64);
      assert.ok(Math.abs(m.h1 - expectH1) < 0.1, `${id} ${w}: h1 ${m.h1}`);
      assert.ok(m.h1Lines <= 2, `${id} ${w}: H1 ${m.h1Lines}行`);
      assert.equal(m.ctas, 1, `${id} ${w}: FV の CTA は1つ`);
      assert.equal(m.disabled, 0, `${id} ${w}: FV に無効の予約ボタンを置かない`);
      assert.ok(m.chars <= 80, `${id} ${w}: FV の文字 ${m.chars}字`);
      assert.equal(m.badge, '架空デモ');
      assert.ok(m.ctaBottom <= hgt, `${id} ${w}: 主CTAが最初の画面に無い`);
      assert.ok(m.h1r.b <= hgt, `${id} ${w}: 見出しが最初の画面に無い`);
      const overlap = (x, y) => !!(x && y) && x.l < y.r && y.l < x.r && x.t < y.b && y.t < x.b;
      assert.ok(!overlap(m.vis, m.h1r) && !overlap(m.vis, m.ctar) && !overlap(m.h1r, m.ctar), `${id} ${w}: 図・見出し・CTA が重なった`);
      if (m.portrait) {
        // SP アートディレクション: 大きな問い（H1）→ 右の顔と左の解決（補助文）→ 1つの CTA。写真を文字の上に重ねない
        if (w < 768) {
          assert.ok(m.h1r.b <= m.photo.t + 1, `${id} ${w}: H1 が写真より先（上）`);
          assert.ok(m.ctar.t >= m.photo.b - 1, `${id} ${w}: CTA は写真の下`);
          assert.ok(m.sub && m.sub.t >= m.photo.t && m.sub.b <= m.photo.b && m.sub.r <= m.photo.l + (m.photo.r - m.photo.l) * 0.2, `${id} ${w}: 補助文は顔の左。写真の左端に幅の20%まで重なってよい（構図の判断: 顔の左の暗くない部分。顔には重ねない）`);
          assert.ok(m.photo.r >= w - 1 && m.photo.l >= w * 0.35, `${id} ${w}: 人物は右`);
          assert.ok(m.photo.b - m.photo.t >= Math.min(320, w * 0.8) - 1, `${id} ${w}: 顔写真が小さすぎる`);
        } else assert.ok(m.h1r.r <= w * 0.5 && (!m.sub || m.sub.r <= w * 0.5), `${id} ${w}: PC の見出しと補助文は左の余白側`);
        assert.ok(m.cap && !overlap(m.cap, m.h1r) && !overlap(m.cap, m.ctar), `${id} ${w}: 写真の注記`);
      } else if (w === 400) assert.ok(m.heroBottom <= 720 && m.vis.b < m.ctaBottom, `${id} 400: FV ${m.heroBottom}`);
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
  const op = await page.evaluate(() => ['.hero h1', '.hero .btn-primary', '.demo-badge', '.hero-photo img', '.photo-cap', '.after-fv .lead'].map((s) => { let o = 1; for (let n = document.querySelector(s); n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; }));
  assert.deepEqual(op, [1, 1, 1, 1, 1, 1]); // 見出し・CTA・デモ表示・顔写真・写真の注記は最初の描画から見える（動くのは計画カードだけ）
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
  assert.ok(review.text.replace(/<\/?span\b[^>]*>/g, '').includes(JSON.parse(readFileSync(join(ROOT, 'examples/v2/mitsumoriban/response.json'), 'utf8')).sections[0].headingPhrases[0])); // 句・語の span を除いて比べる
  assert.match(review.text, /<meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*form-action 'none'/);
  const saved = await downloadText(page, '#btn-save');
  assert.equal(JSON.parse(saved.text).schemaVersion, 2);
  assert.match(await page.locator('meta[name="lp-studio-source"]').getAttribute('content'), /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('LP: 主CTAのクリックと Enter で図解へ移動し、無効の予約は遷移・送信・外部通信をしない', async () => {
  for (const id of ['michishirube', 'mitsumoriban']) {
    const file = await exportReview(id);
    for (const [w, h] of [[1280, 800], [400, 760]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      await ctx.addInitScript(() => { window.__submits = 0; addEventListener('submit', () => { window.__submits++; }, true); });
      const p = await ctx.newPage();
      const external = []; const popups = [];
      p.on('request', (r) => { if (!/^(file|data):/.test(r.url())) external.push(r.url()); });
      ctx.on('page', (np) => popups.push(np.url()));
      await p.goto(`file://${file}`);
      await p.waitForTimeout(1300);
      const target = await p.getAttribute('.hero .btn-primary', 'href');
      assert.match(target, /^#[a-z0-9-]+$/);
      const inView = () => p.evaluate((t) => { const el = document.querySelector(`${t} .vis`) || document.querySelector(t); const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }, target);
      await p.click('.hero .btn-primary');
      await p.waitForTimeout(1000);
      assert.equal(await p.evaluate(() => location.hash), target, `${id} ${w} click`);
      assert.ok(await inView(), `${id} ${w}: クリック後に図解が見える`);
      await p.evaluate(() => { history.replaceState(null, '', location.pathname); window.scrollTo({ top: 0, behavior: 'instant' }); });
      await p.waitForTimeout(300);
      assert.equal(await p.evaluate(() => scrollY), 0, 'Enter の前に先頭へ戻す');
      await p.focus('.hero .btn-primary');
      await p.keyboard.press('Enter');
      await p.waitForTimeout(1000);
      assert.equal(await p.evaluate(() => location.hash), target, `${id} ${w} Enter`);
      assert.ok(await inView(), `${id} ${w}: Enter 後に図解が見える`);
      const dis = p.locator('.btn-disabled');
      const n = await dis.count();
      await p.evaluate(() => { history.replaceState(null, '', location.pathname + '#before'); window.scrollTo({ top: 0, behavior: 'instant' }); });
      const before = await p.evaluate(() => location.href);
      for (let i = 0; i < n; i++) { await dis.nth(i).scrollIntoViewIfNeeded(); await dis.nth(i).click({ force: true }); await p.waitForTimeout(200); }
      assert.equal(await p.evaluate(() => location.href), before, `${id} ${w}: 無効の予約で遷移した`);
      for (let i = 0; i < n; i++) {
        const a = await dis.nth(i).evaluate((el) => ({ tag: el.tagName, href: el.getAttribute('href'), tabindex: el.tabIndex, aria: el.getAttribute('aria-disabled') }));
        assert.deepEqual([a.tag, a.href, a.aria], ['SPAN', null, 'true']);
        assert.ok(a.tabindex < 0, 'フォーカスが乗らない');
      }
      assert.equal(await p.evaluate(() => window.__submits), 0);
      assert.deepEqual(external, []);
      assert.deepEqual(popups, []);
      await ctx.close();
    }
  }
});

test('ZIP を展開しても同じ版が動く（git の無い展開先で版と全ファイルを検証・再梱包・改変の検出）', async () => {
  const sh = (cmd, args, cwd, env) => new Promise((res) => { let o = ''; const c = spawn(cmd, args, { cwd, env: env || (() => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; })() }); c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; }); c.on('exit', (code) => res({ code, o })); });
  const node = (args, cwd) => sh(process.execPath, args, cwd);
  const unzipTo = async (zip, dir) => {
    const names = (await sh('unzip', ['-Z1', zip], TMP)).o.split('\n').filter(Boolean);
    assert.ok(names.length > 10);
    assert.ok(names.every((n) => !n.startsWith('/') && !n.split('/').includes('..')), 'ZIP の項目名に絶対パス・.. が無い');
    assert.equal(new Set(names).size, names.length, 'ZIP の項目名に重複が無い');
    assert.equal((await sh('unzip', ['-q', zip, '-d', dir], TMP)).code, 0);
    return join(dir, 'lp-studio');
  };
  // ROOT が git の作業ツリーか、展開した配布物（git なし）か。配布物なら、まず ROOT 自身を検証し、検証済みの commit を版とする
  const inRepo = (await sh('git', ['rev-parse', '--is-inside-work-tree'], ROOT)).o.trim() === 'true';
  let head, dirtyTree;
  if (inRepo) {
    head = (await sh('git', ['rev-parse', 'HEAD'], ROOT)).o.trim();
    dirtyTree = (await sh('git', ['status', '--porcelain', '--', '.'], ROOT)).o.trim() !== '';
  } else {
    const self = await node(['verify-dist.mjs'], ROOT);
    assert.ok([0, 2].includes(self.code), `展開した配布物そのものが検証に通らない\n${self.o}`);
    head = /commit ([0-9a-f]{40})/.exec(self.o)[1];
    dirtyTree = self.code === 2;
  }
  // 1) 作業ツリー（git）から full と lite を作る
  for (const [flag, name] of [[[], 'full'], [['--lite'], 'lite']]) {
    const p = await node(['pack.mjs', '--allow-dirty', ...flag, '--out', join(TMP, `${name}.zip`)], ROOT);
    assert.equal(p.code, 0, p.o);
  }
  const full = await unzipTo(join(TMP, 'full.zip'), join(TMP, 'unz-full'));
  const lite = await unzipTo(join(TMP, 'lite.zip'), join(TMP, 'unz-lite'));
  for (const base of [full, lite]) {
    // 2) 展開先（git の無い場所）で、VERSION・MANIFEST・全ファイルを検証
    const v = await node(['verify-dist.mjs'], base);
    assert.equal(v.code, dirtyTree ? 2 : 0, v.o);
    assert.match(v.o, /整合のみ確認。commit の真正性は未検証（git が無い）/);
    assert.match(readFileSync(join(base, 'VERSION.txt'), 'utf8'), new RegExp(`^commit ${head}\\n`));
    // 3) この repo の commit とも照合（clean なら blob まで、dirty なら blob 照合をしていないことを明示）
    const g = await node(['verify-dist.mjs', base, '--git', ROOT], ROOT);
    assert.equal(g.code, dirtyTree ? 2 : 0, g.o);
    assert.match(g.o, !inRepo ? /整合のみ確認。commit の真正性は未検証（git が無い）/ : dirtyTree ? /git の blob 照合はしていない/ : /git の commit の内容（blob）とも一致/);
    // 4) 展開先だけで: 単一HTMLの作り直しが一致・単体テストが通る
    const chk = await node(['build-standalone.mjs', '--check'], base);
    assert.equal(chk.code, 0, chk.o);
    const ut = await node(['--test', ...readdirSync(join(base, 'tests/unit')).filter((f) => f.endsWith('.test.mjs')).map((f) => `tests/unit/${f}`)], base);
    assert.equal(ut.code, 0, ut.o.slice(-800));
    assert.match(ut.o, /# fail 0/);
  }
  assert.ok(!existsSync(join(lite, 'docs/screenshots')) && !existsSync(join(lite, 'docs/motion')) && existsSync(join(lite, 'PACKAGING-NOTES.txt')));
  // 5) 展開先（git なし）で再梱包 → もう一度展開すると、全ファイル（MANIFEST・VERSION を含む）がバイト単位で同じ
  for (const [base, name] of [[full, 'full'], [lite, 'lite']]) {
    const rp = await node(['pack.mjs', '--out', join(TMP, `re-${name}.zip`)], base);
    assert.equal(rp.code, 0, rp.o);
    assert.match(rp.o, /検証済みの配布物から再梱包/);
    const again = await unzipTo(join(TMP, `re-${name}.zip`), join(TMP, `unz-re-${name}`));
    assert.equal((await sh('diff', ['-r', base, again], TMP)).code, 0, `${name}: 再梱包で中身が変わった`);
    assert.equal((await node(['verify-dist.mjs'], again)).code, dirtyTree ? 2 : 0);
  }
  // 6) 改変の検出: verify-dist は失敗（exit 1）し、git の無い場所での pack も拒否する
  const fresh = async (label) => { const d = join(TMP, `tamper-${label}`); await sh('cp', ['-r', lite, d], TMP); return d; };
  const manifestOf = (d) => JSON.parse(readFileSync(join(d, 'MANIFEST.json'), 'utf8'));
  const { stableStringify, sha256 } = await import(join(ROOT, 'verify-dist.mjs'));
  const writeConsistent = (d, m) => { // 偽造: MANIFEST と VERSION の両方を一貫して書き換える
    const text = stableStringify(m) + '\n';
    writeFileSync(join(d, 'MANIFEST.json'), text);
    writeFileSync(join(d, 'VERSION.txt'), readFileSync(join(d, 'VERSION.txt'), 'utf8').replace(/^manifest-sha256 \S+/m, `manifest-sha256 ${sha256(Buffer.from(text))}`));
  };
  const cases = {
    'ソースを1バイト変える': (d) => writeFileSync(join(d, 'src/core/editorial.js'), readFileSync(join(d, 'src/core/editorial.js'), 'utf8') + ' '),
    'VERSION の commit を書き換える': (d) => writeFileSync(join(d, 'VERSION.txt'), readFileSync(join(d, 'VERSION.txt'), 'utf8').replace(/^commit \S+/m, `commit ${'0'.repeat(40)}`)),
    'MANIFEST だけをソースに合わせて書き換える': (d) => { writeFileSync(join(d, 'src/core/editorial.js'), 'x'); const m = manifestOf(d); m.files['src/core/editorial.js'] = sha256(Buffer.from('x')); writeFileSync(join(d, 'MANIFEST.json'), stableStringify(m) + '\n'); },
    'ファイルを1つ追加': (d) => writeFileSync(join(d, 'src/core/extra.js'), 'export const x = 1;\n'),
    'ファイルを1つ削除': (d) => rmSync(join(d, 'seed/michishirube.project.json')),
    'manifest に ../x': (d) => { const m = manifestOf(d); m.files['../x'] = sha256(Buffer.from('')); writeConsistent(d, m); },
    'manifest に絶対パス': (d) => { const m = manifestOf(d); m.files['/etc/passwd'] = sha256(Buffer.from('')); writeConsistent(d, m); },
    '大文字小文字だけ違う重複': (d) => { const m = manifestOf(d); writeFileSync(join(d, 'README.MD'), readFileSync(join(d, 'README.md'))); m.files['README.MD'] = m.files['README.md']; writeConsistent(d, m); },
    'シンボリックリンク': (d) => symlinkSync('README.md', join(d, 'link.md')),
  };
  for (const [label, act] of Object.entries(cases)) {
    const d = await fresh(label.replace(/[^\w]/g, '') || String(Math.random()).slice(2));
    act(d);
    const v = await node(['verify-dist.mjs'], d);
    assert.equal(v.code, 1, `${label}: 検出できなかった\n${v.o}`);
    const p = await node(['pack.mjs', '--out', join(TMP, 'never.zip')], d);
    assert.equal(p.code, 1, `${label}: 改変した配布物を再梱包できてしまった`);
  }
  // lite の excluded を宣言外の欠落と入れ替える（MANIFEST・VERSION を一貫して偽造）→ git の照合で検出
  {
    const d = await fresh('excluded');
    const m = manifestOf(d);
    m.excluded = ['docs/screenshots', 'docs/motion', 'seed/assets'];
    for (const k of Object.keys(m.files)) if (k.startsWith('seed/assets/')) { delete m.files[k]; rmSync(join(d, k)); }
    writeConsistent(d, m);
    const v = await node(['verify-dist.mjs'], d);
    assert.equal(v.code, 1, v.o); // 除外してよい一覧（固定）に無い除外は、git が無くても拒否
    assert.match(v.o, /除外してよい一覧.*seed\/assets/);
    assert.equal((await node(['pack.mjs', '--out', join(TMP, 'never.zip')], d)).code, 1);
    const m2 = manifestOf(lite); m2.excluded = ['docs/screenshots']; // docs/motion を宣言から外す（宣言外の欠落）
    const d2 = await fresh('excluded2'); writeConsistent(d2, m2);
    const g2 = await node(['verify-dist.mjs', d2, '--git', ROOT], ROOT);
    if (inRepo) {
      assert.equal(g2.code, 1, g2.o);
      assert.match(g2.o, /宣言外の欠落.*docs\/motion/);
    } else assert.match(g2.o, /整合のみ確認。commit の真正性は未検証（git が無い）/); // git が無い場所の限界（明記済み）
    assert.equal((await node(['verify-dist.mjs'], d2)).code, dirtyTree ? 2 : 0, 'git が無い場所では、許可された除外の範囲の欠落は整合のみ（限界: PACKAGING-NOTES と README に明記）');
  }
  // 7) 展開した自己完結版がブラウザで動く
  const ctx = await browser.newContext({ viewport: { width: 400, height: 760 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(`file://${join(lite, 'dist/lp-studio-standalone.html')}`);
  await p.waitForSelector('body[data-ready="1"]');
  await p.click('#tab-design');
  await p.waitForTimeout(600);
  assert.equal(await p.frameLocator('#sp-frame').locator('.hero-portrait').count(), 1, '展開後の自己完結版でも顔主体FV');
  await p.goto(`file://${join(lite, 'examples/v2/michishirube/review.html')}`);
  assert.equal(await p.locator('.hero-portrait img[src^="data:image/webp;base64,"]').count(), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('エディタ: セクションの並べ替えは描画・保存・再読込で保たれる', async () => {
  const context = await browser.newContext({ acceptDownloads: true });
  const { page, errors } = await openApp(context);
  await tab(page, 'plan');
  const order = () => page.locator('ol.plan > li').evaluateAll((lis) => lis.map((li) => li.querySelector('[id^="pick-"]')?.id.replace('pick-', '')));
  const before = await order();
  const i = before.indexOf('faq');
  await page.click('#up-faq');
  const after = await order();
  assert.equal(after.indexOf('faq'), i - 1);
  await tab(page, 'design');
  const ids = await page.frameLocator('#sp-frame').locator('main > section[id], main > header[id]').evaluateAll((els) => els.map((e) => e.id));
  assert.ok(ids.indexOf('faq') < ids.indexOf(after[i]), `描画順 ${ids}`);
  const saved = await downloadText(page, '#btn-save');
  assert.deepEqual(JSON.parse(saved.text).sections.map((s) => s.id), after);
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]');
  await tab(page, 'plan');
  assert.deepEqual(await order(), after);
  await page.click('#btn-new');
  await page.setInputFiles('#file-load', saved.path);
  await tab(page, 'plan');
  await page.waitForFunction((n) => document.querySelectorAll('ol.plan > li').length === n, after.length);
  assert.deepEqual(await order(), after);
  assert.equal(await page.locator(`#up-${after[0]}`).isDisabled(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('エディタ: 根拠の検証は人の操作（確認者・実在の日付）。内容が変わると検証・承認は外れる', async () => {
  const context = await browser.newContext({ acceptDownloads: true });
  const { page, errors } = await openApp(context);
  await tab(page, 'export');
  await page.fill('#ev-claim', '架空の仕様メモ（検証の操作確認用）');
  await page.fill('#ev-source', '架空の社内資料');
  await page.click('#btn-add-ev');
  const row = page.locator('tr[data-ev]').last();
  const evId = await row.getAttribute('data-ev');
  // 確認者なし・未来の日付は拒否
  await page.fill(`#vat-${evId}`, '2026-10-01');
  await page.click(`#verify-${evId}`);
  await page.waitForSelector('#toast.show[data-kind="error"]');
  await page.fill(`#vby-${evId}`, '確認者A');
  await page.fill(`#vat-${evId}`, '2099-01-01');
  await page.click(`#verify-${evId}`);
  await page.waitForFunction(() => /確認日/.test(document.querySelector('#toast').textContent));
  await page.fill(`#vby-${evId}`, '確認者A');
  await page.fill(`#vat-${evId}`, '2026-10-01');
  await page.click(`#verify-${evId}`);
  await page.waitForSelector(`#unverify-${evId}`);
  assert.match(await page.locator(`tr[data-ev="${evId}"]`).innerText(), /出典確認 確認者A 2026-10-01/);
  // FV を承認 → 見出しを変えると承認が外れる
  await tab(page, 'plan');
  await page.click('#pick-hero');
  await page.click('#btn-approve');
  await page.waitForFunction(() => /承認を取り消す/.test(document.querySelector('#btn-approve').textContent));
  await page.fill('#f-heading', 'このペースで、大丈夫かな。（編集）');
  await page.locator('#f-heading').press('Tab');
  await page.waitForFunction(() => /内容を確認して承認/.test(document.querySelector('#btn-approve').textContent));
  // 検証・承認の後に JSON の中身を書き換えて読み込むと、未検証・未承認に戻る
  await page.click('#btn-approve');
  const saved = await downloadText(page, '#btn-save');
  const j = JSON.parse(saved.text);
  j.evidence.find((e) => e.id === evId).claim = '書き換えた主張';
  j.assets.heroPortrait.caption = '写真はイメージ（差し替え）';
  const edited = join(TMP, 'edited.json');
  writeFileSync(edited, JSON.stringify(j));
  await page.setInputFiles('#file-load', edited);
  await tab(page, 'export');
  await page.waitForSelector(`#verify-${evId}`);
  assert.match(await page.locator(`tr[data-ev="${evId}"]`).innerText(), /未検証/);
  await tab(page, 'plan');
  await page.click('#pick-hero');
  assert.match(await page.locator('#btn-approve').innerText(), /内容を確認して承認/); // 写真の注記を変えたので FV の承認も外れる
  assert.deepEqual(errors.filter((e) => !/dialog/.test(e)), []);
  await context.close();
});

test('LP: 固定CTAの比較用タイミング（ページの半分を過ぎてから）が実際の表示に反映される', async () => {
  // 途中の CTA 帯（無効の申込）が無い版で比べる: spec は FV を過ぎたら表示、after-half は半分を過ぎるまで出さない
  const make = async (timing) => {
    const j = JSON.parse(readFileSync(join(ROOT, 'seed/michishirube.project.json'), 'utf8'));
    j.cta.variants[0].timing = timing;
    for (const sec of j.sections) if (sec.role === 'hero') sec.commercialPreview = null;
    const pj = join(TMP, `t-${timing}.json`); writeFileSync(pj, JSON.stringify(j));
    const out = join(TMP, `t-${timing}.html`);
    const r = spawn(process.execPath, ['cli.mjs', 'export', '--project', pj, '--kind', 'review', '--out', out], { cwd: ROOT });
    assert.equal(await new Promise((res) => r.on('exit', res)), 0);
    return out;
  };
  for (const [timing, early] of [['spec', true], ['after-half', false]]) {
    const f = await make(timing);
    const ctx = await browser.newContext({ viewport: { width: 400, height: 760 } });
    const page = await ctx.newPage();
    await page.goto(`file://${f}`);
    assert.equal(await page.getAttribute('body', 'data-timing'), timing);
    const y = await page.evaluate(() => { const max = document.documentElement.scrollHeight - innerHeight; for (let t = 0.05; t < 0.5; t += 0.01) { window.scrollTo({ top: max * t, behavior: 'instant' }); if (![...document.querySelectorAll('.cta-zone')].some((z) => { const b = z.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; })) return t; } return -1; });
    assert.ok(y > 0 && y < 0.5, `CTA の帯が見えない前半の位置 ${y}`);
    await page.waitForTimeout(700);
    assert.equal((await sticky(page)).shown, early, `${timing}: 前半`);
    const y2 = await page.evaluate(() => { const max = document.documentElement.scrollHeight - innerHeight; for (let t = 0.52; t < 0.95; t += 0.01) { window.scrollTo({ top: max * t, behavior: 'instant' }); if (![...document.querySelectorAll('.cta-zone')].some((z) => { const b = z.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; })) return t; } return -1; });
    assert.ok(y2 > 0.5, `後半の位置 ${y2}`);
    await page.waitForTimeout(700);
    assert.equal((await sticky(page)).shown, true, `${timing}: 後半`);
    await ctx.close();
  }
});

test('エディタ: 運営者は明示的に確認したときだけ確定（未定・仮は不可）。レビュー用は出せ、実販売は出せないまま', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await tab(page, 'inputs');
  await page.fill('#d-op', '未定');
  await page.locator('#d-op').press('Tab');
  await page.click('#d-op-ok'); // 確認済みにしようとしても拒否され、チェックは外れたまま
  await page.waitForSelector('#toast.show[data-kind="error"]');
  assert.equal(await page.isChecked('#d-op-ok'), false);
  await tab(page, 'export');
  assert.match(await page.locator('#gate-commercial').innerText(), /運営者（事業者名）が確認されていません/);
  await tab(page, 'inputs');
  await page.fill('#d-op', 'ミチシルベ学習株式会社');
  await page.locator('#d-op').press('Tab');
  await page.click('#d-op-ok');
  await page.waitForFunction(() => document.querySelector('#d-op-ok').checked);
  await tab(page, 'export');
  const com = await page.locator('#gate-commercial').innerText();
  assert.ok(!/運営者（事業者名）が確認されていません/.test(com));
  assert.match(com, /商用公開不可/); // 架空デモ・未確定の条件・未承認などで実販売は不可のまま
  assert.match(await page.locator('#gate-review').innerText(), /安全に描画できます/);
  assert.equal(await page.locator('#btn-export-commercial').isDisabled(), true);
  assert.equal(await page.locator('#btn-export-review').isDisabled(), false);
  // 補助文の上限（60文字）
  await tab(page, 'plan');
  await page.click('#pick-hero');
  assert.equal(await page.getAttribute('#f-sub', 'maxlength'), '60');
  assert.deepEqual(errors, []);
  await context.close();
});

test('LP: 空白を含む見出し・補助文・商品ラベルは、描画（innerText）でも空白が残り、語の途中で割れない', async () => {
  const j = JSON.parse(readFileSync(join(ROOT, 'seed/michishirube.project.json'), 'utf8'));
  j.display.productLabel = 'Team Quote Tracker 共有';
  const hero = j.sections.find((s) => s.role === 'hero'); hero.sub = 'Excel と メール を、ひとつに。'; hero.subPhrases = [];
  j.sections.find((s) => s.role === 'empathy').heading = 'Excel と メール を、ひとつに。'; j.sections.find((s) => s.role === 'empathy').headingPhrases = [];
  const pj = join(TMP, 'ws.json'); writeFileSync(pj, JSON.stringify(j));
  const out = join(TMP, 'ws.html');
  const r = spawn(process.execPath, ['cli.mjs', 'export', '--project', pj, '--kind', 'review', '--out', out], { cwd: ROOT });
  assert.equal(await new Promise((res) => r.on('exit', res)), 0);
  for (const [w, h] of [[400, 760], [1280, 800], [320, 640]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`file://${out}`);
    const t = await page.evaluate(() => ({ label: document.querySelector('.hero .aud').innerText, sub: document.querySelector('.hero-sub').innerText, h2: document.querySelector('#empathy h2').innerText }));
    const flat = (x) => x.replace(/\n/g, '');
    assert.equal(flat(t.label), 'Team Quote Tracker 共有', `${w}: ${t.label}`);
    assert.ok(/Excel と ?メール を、ひとつに。/.test(flat(t.sub).replace(/ +/g, ' ')) && flat(t.sub).includes('Excel と'), `${w} sub: ${JSON.stringify(t.sub)}`);
    assert.ok(flat(t.h2).includes('Excel と') && flat(t.h2).includes('メール を'), `${w} h2: ${JSON.stringify(t.h2)}`);
    await ctx.close();
  }
});
