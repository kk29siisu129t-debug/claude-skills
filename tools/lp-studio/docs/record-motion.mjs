// LP の「実際の動き」を録画・計測する。
//   node docs/record-motion.mjs <page.html> <出力名> [--reduced]
// 出力: docs/motion/<名>-{pc,sp}.mp4 / .gif と <名>-timeline.json
//  - 初回登場: FV の各要素が見え始め・見え終わる時刻（opacity を 16ms 間隔でサンプリング）
//  - スクロール: 固定CTAの表示/非表示がどの位置で切り替わったか、インラインCTAと重なったか
// 静止画ではなく録画で確認するためのもの。ffmpeg（/usr/bin/ffmpeg）で webm → mp4 / gif に変換する。
import { launch } from '../tests/e2e/pw.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , input, name = 'motion', ...flags] = process.argv;
if (!input) { console.error('usage: node docs/record-motion.mjs <page.html> <name> [--reduced]'); process.exit(1); }
const reduced = flags.includes('--reduced');
const out = fileURLToPath(new URL('./motion/', import.meta.url));
mkdirSync(out, { recursive: true });
const url = `file://${resolve(input)}`;

// ページ内で FV 要素の opacity と固定CTAの状態を時系列で記録する
const PROBE = `(() => {
  const t0 = performance.now();
  const log = { fv: {}, sticky: [] };
  const pick = () => ({
    kicker: document.querySelector('.fv .kicker'), h1: document.querySelector('.fv h1'),
    sub: document.querySelector('.fv .sub'), visual: document.querySelector('.fv-visual'),
    cta: document.querySelector('.fv .cta-inline'),
  });
  let last = null;
  function tick() {
    const t = Math.round(performance.now() - t0);
    for (const [k, el] of Object.entries(pick())) {
      if (!el) continue;
      const o = parseFloat(getComputedStyle(el.closest('.stage') || el).opacity);
      const r = (log.fv[k] ||= { firstVisible: null, fullyVisible: null });
      if (o > 0.05 && r.firstVisible == null) r.firstVisible = t;
      if (o > 0.99 && r.fullyVisible == null) r.fullyVisible = t;
    }
    const bar = document.querySelector('.cta-sticky');
    if (bar) {
      const shown = bar.classList.contains('show');
      if (shown !== last) { log.sticky.push({ t, shown, scrollY: Math.round(scrollY), pageHeight: document.documentElement.scrollHeight }); last = shown; }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.__motionLog = log;
})();`;

async function run(browser, tag, viewport) {
  const tmp = join(out, `.tmp-${name}-${tag}`);
  rmSync(tmp, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport, recordVideo: { dir: tmp, size: viewport }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(PROBE);
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(2200); // 初回登場を見せる
  // 人の読み方に近い速度でスクロール（本文→インラインCTA→末尾）
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const steps = 60;
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round((total * i) / steps));
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(800);
  const log = await page.evaluate(() => window.__motionLog);
  // インラインCTAが見えている間に固定CTAが出ていないか（上から順に確認）
  const overlap = [];
  const ctas = await page.evaluate(() => [...document.querySelectorAll('.cta-inline')].map((a) => a.getBoundingClientRect().top + scrollY));
  for (const y of ctas) {
    await page.evaluate((yy) => window.scrollTo(0, Math.max(0, yy - innerHeight / 2)), y);
    await page.waitForTimeout(400);
    overlap.push(await page.evaluate(() => document.querySelector('.cta-sticky')?.classList.contains('show') || false));
  }
  await ctx.close();
  const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
  const base = join(out, `${name}${reduced ? '-reduced' : ''}-${tag}`);
  renameSync(join(tmp, webm), `${base}.webm`);
  rmSync(tmp, { recursive: true, force: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${base}.webm`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', `${base}.mp4`]);
  // GIF は先頭 4 秒（初回登場）だけ、軽量に
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-t', '4', '-i', `${base}.webm`, '-vf', `fps=12,scale=${tag === 'pc' ? 640 : 320}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`, `${base}-fv.gif`]);
  rmSync(`${base}.webm`);
  return { tag, viewport, fv: log.fv, sticky: log.sticky, stickyShownWhileInlineCtaCentered: overlap };
}

const browser = await launch();
const result = { input, reduced, recordedAt: new Date().toISOString(), runs: [] };
result.runs.push(await run(browser, 'pc', { width: 1280, height: 800 }));
result.runs.push(await run(browser, 'sp', { width: 400, height: 760 }));
await browser.close();
writeFileSync(join(out, `${name}${reduced ? '-reduced' : ''}-timeline.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.runs.map((r) => ({ tag: r.tag, fv: r.fv, stickyToggles: r.sticky.length, inlineOverlap: r.stickyShownWhileInlineCtaCentered })), null, 1));
