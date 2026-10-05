// ブラウザでの統合テスト: 編集 → WF → PC/SP → 保存 → 再読込 → export の反復、戻る/再開、安全な読込、
// レスポンシブ（320/375/400/1280）、固定CTAの表示ルール、reduced-motion、キーボード操作。
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
const SHOTS = process.env.LP_STUDIO_SHOTS || '';
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
after(async () => {
  await browser?.close();
  server?.kill();
});

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
  const path = join(TMP, dl.suggestedFilename());
  await dl.saveAs(path);
  return { path, text: readFileSync(path, 'utf8'), name: dl.suggestedFilename() };
}

test('編集→WF→PC/SP→保存→再読込→export を3回繰り返しても整合する', async () => {
  const context = await browser.newContext({ acceptDownloads: true });
  const { page, errors } = await openApp(context);
  for (let round = 1; round <= 3; round++) {
    const heading = `反復${'一二三'[round - 1]}巡目の見出し`; // 数字を含めると「数値の主張」として safe で除外されるため
    // 編集（セクション編集モード）
    await tab(page, 'plan');
    await page.click('#mode-section');
    await page.click('#pick-empathy');
    await page.fill('#f-heading', heading);
    await page.locator('#f-heading').press('Tab');
    await page.waitForFunction((h) => document.querySelector('#wf-frame')?.srcdoc.includes(h), heading);
    assert.match(await frameText(page, '#wf-frame'), new RegExp(heading));
    // ブリーフ変更が全ビューに伝播
    const promise = `毎晩${round}0分の「次にやること」が決まっている状態をつくる`;
    await tab(page, 'brief');
    await page.fill('#brief-promise', promise);
    await page.locator('#brief-promise').press('Tab');
    // PC / SP
    await tab(page, 'design');
    for (const f of ['#pc-frame', '#sp-frame']) {
      const t = await frameText(page, f);
      assert.ok(t.includes(heading), `${f} heading`);
      assert.ok(t.includes(promise.slice(0, 8)), `${f} promise`);
    }
    await tab(page, 'plan');
    assert.match(await frameText(page, '#wf-frame'), new RegExp(promise.slice(0, 8)));
    // 保存
    const saved = await downloadText(page, '#btn-save');
    assert.match(saved.name, /\.lpstudio\.json$/);
    const json = JSON.parse(saved.text);
    assert.equal(json.schemaVersion, 1);
    assert.equal(json.sections.find((s) => s.id === 'empathy').fields.heading, heading);
    // 別の状態にしてからファイルを読み込み直す
    await page.click('#btn-new');
    await tab(page, 'plan');
    assert.ok(!(await page.locator('#wf-frame').getAttribute('srcdoc')).includes(heading));
    await page.setInputFiles('#file-load', saved.path);
    await page.waitForFunction((h) => document.querySelector('#wf-frame')?.srcdoc.includes(h), heading);
    // ページ再読込（autosave から再開）
    await page.reload();
    await page.waitForSelector('body[data-ready="1"]');
    await tab(page, 'plan');
    assert.match(await frameText(page, '#wf-frame'), new RegExp(heading));
    // export（編集で empathy が未承認になっているので、承認してから safe）
    await page.click('#pick-empathy');
    await page.click('#btn-approve');
    await tab(page, 'export');
    const draft = await downloadText(page, '#btn-export-draft');
    assert.match(draft.text, /公開しないでください/);
    assert.ok(draft.text.includes(heading));
    const safe = await downloadText(page, '#btn-export-safe');
    assert.ok(safe.text.includes(heading));
    assert.ok(!safe.text.includes('満足度92'));
    assert.ok(!safe.text.includes('class="flag'));
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('戻る/やり直す、ブラウザの戻る/進む、再読込で再開', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await tab(page, 'plan');
  const count = async () => page.locator('ol.plan > li').count();
  const n0 = await count();
  await page.selectOption('#add-type', 'price_reason');
  await page.click('#btn-add-section');
  assert.equal(await count(), n0 + 1);
  await page.click('#del-recommit');
  assert.equal(await count(), n0);
  await page.click('#btn-undo');
  assert.equal(await count(), n0 + 1);
  await page.click('#btn-undo');
  assert.equal(await count(), n0);
  await page.click('#btn-redo');
  assert.equal(await count(), n0 + 1);
  // 並べ替え
  const firstTwo = async () => page.locator('ol.plan > li').evaluateAll((els) => els.slice(0, 2).map((e) => e.dataset.sectionId));
  const [a, b] = await firstTwo();
  await page.click(`#down-${a}`);
  assert.deepEqual(await firstTwo(), [b, a]);
  // 必須は削除ボタンが無い
  assert.equal(await page.locator('#del-fv').count(), 0);
  // ブラウザの戻る/進む（タブ単位）
  await tab(page, 'design');
  await tab(page, 'lpo');
  await page.goBack();
  await page.waitForSelector('#tab-design[aria-selected="true"]');
  await page.goBack();
  await page.waitForSelector('#tab-plan[aria-selected="true"]');
  await page.goForward();
  await page.waitForSelector('#tab-design[aria-selected="true"]');
  // 再読込で同じタブ・同じ内容
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]');
  await page.waitForSelector('#tab-design[aria-selected="true"]');
  await tab(page, 'plan');
  assert.deepEqual(await firstTwo(), [b, a]);
  assert.equal(await count(), n0 + 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('3モード: 全体作成・訴求変更・セクション編集', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await tab(page, 'plan');
  await page.click('#mode-full');
  await page.click('#btn-template-all');
  const origins = await page.locator('ol.plan > li .tags').allInnerTexts();
  assert.ok(origins.every((t) => t.includes('テンプレート') && t.includes('未承認')));
  await page.click('#btn-undo');
  await page.click('#mode-reangle');
  await page.fill('#reangle-input', '週末に崩れない学習リズムをつくる');
  await page.click('#btn-reangle');
  assert.match(await frameText(page, '#wf-frame'), /週末に崩れない学習リズム/);
  assert.ok((await page.locator('ol.plan').innerText()).includes('要再確認'));
  await page.click('#mode-section');
  await page.click('#pick-steps');
  await page.click('#btn-regen-section');
  assert.ok((await page.locator('[data-section-id="steps"] .tags').innerText()).includes('テンプレート'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('安全な読込: スクリプト入りJSONはテキスト扱い、HTML・不正JSONは拒否', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  const seed = JSON.parse(readFileSync(join(ROOT, 'seed/project.fictional.json'), 'utf8'));
  seed.name = '<img src=x onerror=alert(1)>';
  seed.sections[1].fields.heading = '<script>alert(1)</script>見出し';
  seed.brief.ctaUrl.value = 'javascript:alert(1)';
  const evilPath = join(TMP, 'evil.json');
  writeFileSync(evilPath, JSON.stringify(seed));
  await page.setInputFiles('#file-load', evilPath);
  await tab(page, 'plan');
  await page.waitForFunction(() => document.querySelector('#wf-frame')?.srcdoc.includes('&lt;script&gt;'));
  assert.match(await frameText(page, '#wf-frame'), /<script>alert\(1\)<\/script>見出し/);
  await tab(page, 'design');
  const hrefs = await page.frameLocator('#pc-frame').locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  assert.ok(hrefs.every((h) => !/^javascript:/i.test(h)));
  assert.equal(await page.locator('#project-name').inputValue(), '<img src=x onerror=alert(1)>');
  // HTML ファイル
  const htmlPath = join(TMP, 'page.html');
  writeFileSync(htmlPath, '<html><script>alert(1)</script></html>');
  await page.setInputFiles('#file-load', htmlPath);
  await page.waitForSelector('#toast.show[data-kind="error"]');
  assert.match(await page.locator('#toast').innerText(), /HTML/);
  // 不正 JSON
  const badPath = join(TMP, 'bad.json');
  writeFileSync(badPath, '{"schemaVersion":1, broken');
  await page.setInputFiles('#file-load', badPath);
  await page.waitForFunction(() => /読み込めません/.test(document.querySelector('#toast').textContent));
  assert.equal(await page.locator('#project-name').inputValue(), '<img src=x onerror=alert(1)>'); // 状態は変わらない
  assert.deepEqual(errors, []);
  await context.close();
});

test('Claude Code 生成JSONの取り込み（未承認・未検証・denylist拒否）', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await tab(page, 'gen');
  assert.match(await page.locator('#gen-prompt').inputValue(), /禁止事項/);
  await page.fill('#gen-response', JSON.stringify({
    generator: 'claude-code', mode: 'full',
    sections: [{ type: 'fv', fields: { heading: '{{promise}}', lead: '受講生1140人の実績' } }, { type: 'empathy', fields: { heading: '生成された共感見出し' } }],
    evidenceCandidates: [{ claim: '継続率90%', source: '要確認' }],
  }));
  await page.click('#btn-ingest');
  await page.waitForSelector('#ingest-report');
  const rep = await page.locator('#ingest-report').innerText();
  assert.match(rep, /拒否/);
  assert.match(rep, /テンプレートで補い/);
  await tab(page, 'plan');
  assert.match(await page.locator('[data-section-id] .tags').first().innerText(), /Claude Code生成/);
  assert.ok(!(await frameText(page, '#wf-frame')).includes('1140'));
  await tab(page, 'export');
  assert.match(await page.locator('table').innerText(), /継続率90%[\s\S]*未検証/);
  assert.equal(await page.locator('#btn-export-safe').isDisabled(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('根拠の検証は人の操作（確認者・日付）で、検証すると safe に出る', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await tab(page, 'export');
  assert.match(await page.locator('#safe-removed').innerText(), /満足度92/);
  await page.click('#verify-ev-voice');
  await page.waitForSelector('#toast.show[data-kind="error"]');
  await page.fill('#vby-ev-voice', 'E2E確認者');
  await page.fill('#vat-ev-voice', '2026-10-05');
  await page.click('#verify-ev-voice');
  await page.waitForSelector('#unverify-ev-voice');
  assert.ok(!(await page.locator('#safe-removed').innerText()).includes('満足度92'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('LPO: 架空バナー・未接続・判定しない・比較しない', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await tab(page, 'lpo');
  assert.match(await page.locator('#lpo-banner').innerText(), /架空データ/);
  assert.match(await page.locator('#lpo-connections').innerText(), /ヒートマップ.*メール.*外部アクセス解析/);
  const body = await page.locator('#panel').innerText();
  assert.match(body, /判定しない/);
  assert.match(body, /比較しない — タイムゾーンが異なる/);
  assert.match(body, /停止条件/);
  assert.match(body, /guardrail/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('CTA比較: 文言・色・タイミングがプレビューに反映（配信はしない）', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);
  await tab(page, 'cta');
  await page.fill('#cta-b-label', 'E2E比較用の文言');
  await page.locator('#cta-b-label').press('Tab');
  await page.waitForFunction(() => document.querySelector('#cta-frame-b')?.srcdoc.includes('E2E比較用の文言'));
  await page.selectOption('#cta-b-timing', 'always');
  await page.waitForFunction(() => document.querySelector('#cta-frame-b')?.srcdoc.includes('data-cta-timing="always"'));
  await page.click('#cta-b-use');
  await page.waitForSelector('[data-variant="b"].active');
  assert.match(await page.locator('#panel').innerText(), /AB配信・広告設定は行いません/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('キーボード: タブは矢印キーで移動、操作要素にフォーカス可能', async () => {
  const context = await browser.newContext();
  const { page } = await openApp(context);
  await page.focus('#tab-brief');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('#tab-plan[aria-selected="true"]');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-plan');
  await page.keyboard.press('End');
  await page.waitForSelector('#tab-gen[aria-selected="true"]');
  await page.keyboard.press('Home');
  await page.waitForSelector('#tab-brief[aria-selected="true"]');
  // Tab で入力欄へ進める
  await page.focus('#brief-product');
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement.tagName)));
  await context.close();
});

test('アプリ: 320/375/400/1280px で横スクロールなし', async () => {
  for (const width of [320, 375, 400, 1280]) {
    const context = await browser.newContext();
    const { page, errors } = await openApp(context, { width, height: 800 });
    for (const t of ['brief', 'plan', 'design', 'cta', 'export', 'lpo', 'gen']) {
      await tab(page, t);
      await page.waitForTimeout(50);
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(sw <= cw, `app ${width}px ${t}: scrollWidth ${sw} > ${cw}`);
      if (SHOTS && (width === 375 || width === 1280) && ['plan', 'design', 'lpo', 'export'].includes(t)) await page.screenshot({ path: join(SHOTS, `app-${t}-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

// ---- export した LP の検査 ----
function exportSafe() {
  const out = join(TMP, 'safe.html');
  const r = spawn(process.execPath, ['cli.mjs', 'export', '--project', 'seed/project.fictional.json', '--kind', 'safe', '--out', out], { cwd: ROOT });
  return new Promise((resolve, reject) => r.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`export exit ${code}`)))));
}

async function stickyState(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.cta-sticky');
    const r = bar.getBoundingClientRect();
    const visible = getComputedStyle(bar).visibility === 'visible' && bar.classList.contains('show');
    const inlines = [...document.querySelectorAll('.cta-inline')].map((a) => a.getBoundingClientRect()).filter((b) => b.bottom > 0 && b.top < innerHeight);
    const overlapInline = visible && inlines.some((b) => !(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom));
    return { visible, inert: bar.hasAttribute('inert'), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), overlapInline };
  });
}

test('export LP: 4幅で横スクロールなし・本文寸法・固定CTAの表示ルールと重なりなし', async () => {
  const file = await exportSafe();
  for (const [width, height] of [[320, 640], [375, 740], [400, 760], [1280, 800]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); // CSP 違反もここに出る
    await page.goto(`file://${file}`);
    await page.waitForTimeout(1100);
    const m = await page.evaluate(() => {
      const p = document.querySelector('section .wrap p, section .wrap li');
      const cs = getComputedStyle(p);
      const wrap = document.querySelector('section .wrap');
      const h2 = getComputedStyle(document.querySelector('section h2'));
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, fs: cs.fontSize, lh: cs.lineHeight, wrapW: wrap.getBoundingClientRect().width, h2: parseFloat(h2.fontSize), js: document.documentElement.classList.contains('js') };
    });
    assert.ok(m.sw <= m.cw, `LP ${width}: scrollWidth ${m.sw} > ${m.cw}`);
    assert.ok(m.js, 'JS 有効時は js クラス');
    if (width === 1280) {
      assert.equal(m.fs, '17.5px'); assert.equal(m.lh, '34.1px'); assert.equal(Math.round(m.wrapW), 720);
    } else {
      assert.equal(m.fs, '16px'); assert.equal(m.lh, '31.2px'); assert.ok(m.h2 >= 30 && m.h2 <= 32, `h2 ${m.h2}`);
    }
    // FV 表示中は固定CTAを隠す（フォーカス不可）
    let s = await stickyState(page);
    assert.equal(s.visible, false, `${width} FV中は非表示`);
    assert.equal(s.inert, true);
    if (SHOTS && [400, 1280].includes(width)) await page.screenshot({ path: join(SHOTS, `lp-fv-${width}.png`) });
    // 本文中は表示（寸法）
    await page.evaluate(() => document.querySelector('ol.steps').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(700);
    s = await stickyState(page);
    assert.equal(s.visible, true, `${width} 本文では表示`);
    assert.equal(s.inert, false);
    if (width === 1280) {
      assert.deepEqual([s.w, s.h, s.right, s.bottom], [340, 66, 24, 24]);
    } else {
      assert.equal(s.h, 54);
      assert.equal(s.w, width - 24);
    }
    if (SHOTS && [400, 1280].includes(width)) await page.screenshot({ path: join(SHOTS, `lp-body-${width}.png`) });
    // 大きいインラインCTAが見えている間は隠す
    await page.evaluate(() => { const c = document.querySelectorAll('.cta-inline'); c[c.length - 1].scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(700);
    s = await stickyState(page);
    assert.equal(s.visible, false, `${width} インラインCTA表示中は非表示`);
    assert.equal(s.overlapInline, false);
    // ページ末尾: 固定CTAがフッターの文字に重ならない
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(700);
    const overlapFooter = await page.evaluate(() => {
      const bar = document.querySelector('.cta-sticky');
      if (!bar.classList.contains('show')) return false;
      const r = bar.getBoundingClientRect();
      return [...document.querySelectorAll('footer p')].some((p) => { const b = p.getBoundingClientRect(); return !(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom); });
    });
    assert.equal(overlapFooter, false, `${width} フッターと重なる`);
    assert.deepEqual(errors, [], `${width}: ${errors.join()}`);
    await context.close();
  }
});

test('export LP: reduced-motion では動きを止め、本文とカウンターを即時表示', async () => {
  const file = await exportSafe();
  const context = await browser.newContext({ viewport: { width: 400, height: 760 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`file://${file}`);
  const r = await page.evaluate(() => ({
    js: document.documentElement.classList.contains('js'),
    hidden: [...document.querySelectorAll('.reveal')].filter((e) => getComputedStyle(e).opacity !== '1').length,
    counter: document.querySelector('[data-count]')?.textContent,
  }));
  assert.equal(r.js, false);
  assert.equal(r.hidden, 0);
  assert.equal(r.counter, '4.2');
  await context.close();
});

test('export LP: JS 無効でも本文が見える（progressive enhancement）', async () => {
  const file = await exportSafe();
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`file://${file}`);
  const visible = await page.locator('.reveal').first().isVisible();
  assert.equal(visible, true);
  const op = await page.locator('.reveal').first().evaluate((e) => getComputedStyle(e).opacity);
  assert.equal(op, '1');
  await context.close();
});
