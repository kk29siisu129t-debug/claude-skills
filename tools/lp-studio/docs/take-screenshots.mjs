// 実スクリーンショットを docs/screenshots/v5/ に撮る（v2・v3・v3-face・v5-sp-ad は比較用に残す）（実ブラウザ・実レンダリング）。
//   node docs/take-screenshots.mjs
// LP: examples/v2/<id>/review.html（brief → Claude Code の JSON → ingest → review 書き出し）
// エディタ: serve.mjs を起動して実際の UI を撮る。全ページ画像は reduced-motion で撮る（スクロールで現れる要素も表示するため）。
import { launch } from '../tests/e2e/pw.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = `${root}docs/screenshots/v5/`;
mkdirSync(dir, { recursive: true });
const b = await launch();
for (const id of ['michishirube', 'mitsumoriban']) {
  const url = `file://${root}examples/v2/${id}/review.html`;
  for (const [w, h, tag] of [[1280, 800, 'pc'], [400, 760, 'sp400'], [360, 800, 'sp360'], [320, 640, 'sp320']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    await p.goto(url);
    await p.waitForTimeout(1500); // 図の登場が終わってから
    await p.screenshot({ path: `${dir}${id}-${tag}-fv.png` });
    await ctx.close();
  }
  for (const [w, h, tag] of [[1280, 800, 'pc'], [400, 760, 'sp400']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(url);
    await p.screenshot({ path: `${dir}${id}-${tag}-full.png`, fullPage: true });
    await ctx.close();
  }
}
// エディタ
const port = 4400 + Math.floor(Math.random() * 300);
const srv = spawn(process.execPath, ['serve.mjs', '--port', String(port)], { cwd: root });
await new Promise((r) => srv.stdout.on('data', r));
for (const [w, h, tag] of [[1440, 1000, 'pc'], [375, 812, 'sp']]) {
  for (const id of ['michishirube', 'mitsumoriban']) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForSelector('body[data-ready="1"]');
    await page.selectOption('#seed-pick', id);
    await page.waitForTimeout(4600); // 通知が消えるまで
    for (const t of id === 'michishirube' ? ['insight', 'plan', 'design', 'export'] : ['design', 'plan']) {
      await page.click(`#tab-${t}`);
      await page.waitForTimeout(1700);
      if (tag === 'sp' && t === 'design') { await page.evaluate(() => document.querySelector('#sp-frame')?.scrollIntoView({ block: 'start', behavior: 'instant' })); await page.waitForTimeout(1700); }
      await page.screenshot({ path: `${dir}editor-${id}-${tag}-${t}.png` });
    }
    await ctx.close();
  }
}
srv.kill();
await b.close();
console.log('ok');
