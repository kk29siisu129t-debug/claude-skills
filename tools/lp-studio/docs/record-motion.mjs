// LP の「実際の動き」を録画・計測する（実ブラウザの画面録画。画像をつないだ疑似動画ではない）。
//   node docs/record-motion.mjs <page.html> <出力名> [--reduced]
// 出力（docs/motion/）:
//   <名>[-reduced]-{pc,sp400,sp360}.mp4  … 冷えた状態から約8秒: 2秒静止 → スクロール → 固定CTA出現 → インラインCTAで非表示 → 上へ戻って非表示
//   <名>[-reduced]-{…}-fv.gif           … 先頭3秒（初回登場）
//   <名>[-reduced]-{…}-t{300,700,1200}.png … 0.3/0.7/1.2 秒時点の実描画
//   <名>[-reduced]-timeline.json         … 見出し・本文・CTA・図の可視化時刻、CLS、固定CTAの出入り、CTAが1つも見えない瞬間
import { launch } from '../tests/e2e/pw.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [, , input, name = 'motion', ...flags] = process.argv;
if (!input) { console.error('usage: node docs/record-motion.mjs <page.html> <name> [--reduced]'); process.exit(1); }
const reduced = flags.includes('--reduced');
const out = fileURLToPath(new URL('./motion/', import.meta.url));
mkdirSync(out, { recursive: true });
const url = `file://${resolve(input)}`;
const htmlHash = createHash('sha256').update(readFileSync(resolve(input))).digest('hex').slice(0, 12);

const PROBE = `(() => {
  const t0 = performance.now();
  const log = { visible: {}, cls: 0, sticky: [], ctaGap: [] };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) log.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  const pick = () => ({ h1: document.querySelector('.hero h1'), lead: document.querySelector('.hero .hero-sub, .hero .lead'), photo: document.querySelector('.hero-photo img'), cta: document.querySelector('.hero .btn-primary'), visual: document.querySelector('.hero-visual'), highlight: document.querySelector('.hero-visual .hl') });
  const op = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  let last = null, gapOpen = null;
  function tick() {
    const t = Math.round(performance.now() - t0);
    for (const [k, el] of Object.entries(pick())) {
      if (!el) continue;
      const r = (log.visible[k] ||= { first: null, full: null });
      const o = op(el);
      if (o > 0.05 && r.first == null) r.first = t;
      if (o > 0.99 && r.full == null) r.full = t;
    }
    const bar = document.querySelector('.sticky-cta');
    if (bar) {
      const shown = bar.classList.contains('show');
      if (shown !== last) { log.sticky.push({ t, shown, scrollY: Math.round(scrollY) }); last = shown; }
      const inView = [...document.querySelectorAll('.cta-zone')].some((a) => { const b = a.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; });
      const none = !shown && !inView;
      if (none && gapOpen == null) gapOpen = t;
      if (!none && gapOpen != null) { log.ctaGap.push([gapOpen, t]); gapOpen = null; }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.__motionLog = log;
})();`;

async function run(browser, tag, viewport) {
  const suffix = `${reduced ? '-reduced' : ''}-${tag}`;
  const tmp = join(out, `.tmp-${name}${suffix}`);
  rmSync(tmp, { recursive: true, force: true });
  // 1) 0.3/0.7/1.2 秒の実描画（別コンテキストで冷えた状態から）
  for (const ms of [300, 700, 1200]) {
    const c = await browser.newContext({ viewport, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const p = await c.newPage();
    const t0 = Date.now();
    await p.goto(url, { waitUntil: 'commit' });
    await p.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
    await p.screenshot({ path: join(out, `${name}${suffix}-t${ms}.png`) });
    await c.close();
  }
  // 2) 録画
  const ctx = await browser.newContext({ viewport, recordVideo: { dir: tmp, size: viewport }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(PROBE);
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(2000);
  const smooth = async (to, ms) => {
    const from = await page.evaluate(() => scrollY);
    const steps = Math.max(1, Math.round(ms / 50));
    for (let i = 1; i <= steps; i++) { await page.evaluate((y) => window.scrollTo(0, y), Math.round(from + ((to - from) * i) / steps)); await page.waitForTimeout(50); }
  };
  const y = (sel, pos = 'top') => page.evaluate(([s, p]) => { const el = document.querySelector(s); if (!el) return 0; const b = el.getBoundingClientRect(); return Math.max(0, Math.round(scrollY + (p === 'center' ? b.top - innerHeight / 2 + b.height / 2 : b.top - 80))); }, [sel, pos]);
  await smooth(await y('#mechanism, .sec:nth-of-type(2)'), 1500); // 本文へ → 固定CTAが出る
  await page.waitForTimeout(700);
  await smooth(await y('.closing .cta-row, .closing', 'center'), 1600); // 締めのCTAへ → 固定CTAが隠れる
  await page.waitForTimeout(800);
  await smooth(0, 1400); // 上へ戻る → FVのCTAで隠れる
  await page.waitForTimeout(800);
  const log = await page.evaluate(() => window.__motionLog);
  await ctx.close();
  const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
  const base = join(out, `${name}${suffix}`);
  renameSync(join(tmp, webm), `${base}.webm`);
  rmSync(tmp, { recursive: true, force: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${base}.webm`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', `${base}.mp4`]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-t', '3', '-i', `${base}.webm`, '-vf', `fps=15,scale=${viewport.width > 600 ? 640 : 300}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`, `${base}-fv.gif`]);
  rmSync(`${base}.webm`);
  return { tag, viewport, visible: log.visible, cls: Math.round(log.cls * 1000) / 1000, sticky: log.sticky, ctaGapMs: log.ctaGap.map(([a, b]) => b - a).filter((d) => d > 120) };
}

const browser = await launch();
const result = { input, htmlSha256: htmlHash, reduced, recordedAt: new Date().toISOString(), runs: [] };
result.runs.push(await run(browser, 'pc', { width: 1280, height: 800 }));
result.runs.push(await run(browser, 'sp400', { width: 400, height: 760 }));
result.runs.push(await run(browser, 'sp360', { width: 360, height: 800 }));
await browser.close();
writeFileSync(join(out, `${name}${reduced ? '-reduced' : ''}-timeline.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.runs.map((r) => ({ tag: r.tag, visible: r.visible, cls: r.cls, sticky: r.sticky.map((s) => `${s.t}ms:${s.shown ? 'show' : 'hide'}@${s.scrollY}`), ctaGapMs: r.ctaGapMs })), null, 1));
