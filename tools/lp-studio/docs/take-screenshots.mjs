// スクリーンショットを docs/screenshots/ に撮る（実ブラウザ・実レンダリング）。
//   node docs/take-screenshots.mjs
// 生成LP: examples/claude-code-run/safe.html（Claude Code が書いた JSON → 検証 → デモ承認 → safe export）
import { launch } from '../tests/e2e/pw.mjs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('./screenshots/', import.meta.url));
const lp = fileURLToPath(new URL('../examples/claude-code-run/safe.html', import.meta.url));
const b = await launch();
for (const [w, h, tag] of [[1280, 800, 'pc'], [400, 760, 'sp']]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  await page.goto(`file://${lp}`);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${dir}gen-lp-${tag}-fv.png` });
  await page.evaluate(() => document.querySelector('ol.steps').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${dir}gen-lp-${tag}-body.png` });
  await page.evaluate(() => document.querySelector('.proof-grid').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${dir}gen-lp-${tag}-proof.png` });
  await page.close();
  // 全体（動きは止めて全要素を表示）
  const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const full = await ctx.newPage();
  await full.goto(`file://${lp}`);
  await full.screenshot({ path: `${dir}gen-lp-${tag}-full.png`, fullPage: true });
  await ctx.close();
}

// エディタ（Claude Code 生成版を読み込んだ状態）。プレビューの登場アニメーション完了を待って撮る
const { spawn } = await import('node:child_process');
const root = fileURLToPath(new URL('../', import.meta.url));
const port = 4400 + Math.floor(Math.random() * 300);
const srv = spawn(process.execPath, ['serve.mjs', '--port', String(port)], { cwd: root });
await new Promise((r) => srv.stdout.on('data', r));
const reviewed = fileURLToPath(new URL('../examples/claude-code-run/project.reviewed.json', import.meta.url));
for (const [w, h, tag] of [[1440, 1000, 'pc'], [375, 812, 'sp']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('body[data-ready="1"]');
  await page.setInputFiles('#file-load', reviewed);
  await page.waitForTimeout(4600); // 読込通知（toast）が消えるまで待つ
  for (const t of ['plan', 'design', 'export', 'lpo']) {
    await page.click(`#tab-${t}`);
    if (t === 'design') await page.click('#pkind-safe');
    await page.waitForTimeout(1600);
    if (tag === 'sp' && t === 'design') {
      await page.evaluate(() => document.querySelector('#sp-frame').scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(1800); // lazy iframe の読込と登場アニメーション
    }
    await page.screenshot({ path: `${dir}editor-${tag}-${t}.png` });
  }
  await ctx.close();
}
srv.kill();
await b.close();
console.log('ok');
