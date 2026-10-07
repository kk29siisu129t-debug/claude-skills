#!/usr/bin/env node
// 太い S 字の矢印の実ブラウザ検査（360/400/1280）と、0→途中→完成→逆戻りの録画（400px → out/lp-400-scurve.mp4 用 webm）
// - 描かれた長さ（stroke-dashoffset）＝スクロール位置から決まる進捗 p × 経路長。矢印頭は描かれた先端の点に、その接線の向きで付く
// - 途中で止めれば途中、逆スクロールで縮む、一気に飛んでも正しい値。操作できない・本文に重ならない
// - JS 無効／動きを減らす設定では完成した静止形
import { launch } from '../tools/lp-studio/tests/e2e/pw.mjs';
import { writeFileSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const url = `file://${join(root, 'out/passlabo-full-lp.html')}`;
const b = await launch(); /* CTA は実リンクのため、外部への通信はすべて遮断する */ { const _nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await _nc(o); await c.route(/^(https?|wss?):/, (r) => r.abort()); return c; }; b.newPage = async (o) => (await b.newContext(o)).newPage(); }
const probe = () => {
  const box = document.querySelector('.lp-s'), path = box.querySelector('.lp-s-path'), head = box.querySelector('.lp-s-head'), vh = innerHeight;
  const L = path.getTotalLength(), top = box.getBoundingClientRect().top;
  let exp = (vh * .85 - top) / (vh * .6); exp = Math.max(0, Math.min(1, exp));
  const off = parseFloat(getComputedStyle(path).strokeDashoffset) || 0;
  const drawn = L - off;
  const m = head.transform.baseVal.consolidate().matrix; // 矢印頭の基点（＝描かれた先端）
  const pt = path.getPointAtLength(Math.max(0.5, L * exp));
  return { expected: +exp.toFixed(3), drawnRatio: +(drawn / L).toFixed(3), headAt: [+m.e.toFixed(1), +m.f.toFixed(1)], pathAt: [+pt.x.toFixed(1), +pt.y.toFixed(1)], headAngle: +(Math.atan2(m.b, m.a) * 180 / Math.PI).toFixed(1) };
};
const res = {};
for (const w of [360, 400, 1280]) {
  const r = (res[w] = {});
  const ctx = await b.newContext({ viewport: { width: w, height: w > 900 ? 800 : 700 } }); const p = await ctx.newPage();
  await p.goto(url); await p.evaluate(() => document.fonts.ready);
  r.nonInteractive = await p.evaluate(() => { const g = document.querySelector('.lp-s'); return { ariaHidden: g.getAttribute('aria-hidden'), pe: getComputedStyle(g).pointerEvents, focusables: g.querySelectorAll('a,button,[tabindex],summary,[role=button]').length, cursor: getComputedStyle(g).cursor }; });
  r.overlap = await p.evaluate(() => { const a = document.querySelector('.lp-s').getBoundingClientRect(); return [...document.querySelectorAll('.lp p,.lp h2,.lp li,.lp img,.lp figure,.lp blockquote,.cta')].filter((el) => { const c = el.getBoundingClientRect(); return c.width && !(c.right <= a.left || c.left >= a.right || c.bottom <= a.top || c.top >= a.bottom); }).length; });
  r.size = await p.evaluate(() => { const b = document.querySelector('.lp-s-svg').getBBox(); return [Math.round(b.width), Math.round(b.height)]; });
  const docTop = await p.evaluate(() => document.querySelector('.lp-s').getBoundingClientRect().top + scrollY); const vh = await p.evaluate(() => innerHeight);
  const samples = [];
  for (const frac of [1.0, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1, 0.4, 0.7, 0.9]) { await p.evaluate((y) => scrollTo(0, y), Math.max(0, docTop - vh * frac)); await p.waitForTimeout(80); samples.push(await p.evaluate(probe)); }
  r.samples = samples.map((s) => `${s.expected}→drawn ${s.drawnRatio} head(${s.headAt}) path(${s.pathAt}) ${s.headAngle}°`);
  r.maxRatioErr = Math.max(...samples.map((s) => Math.abs(s.drawnRatio - s.expected)));
  r.maxHeadErr = Math.max(...samples.map((s) => Math.hypot(s.headAt[0] - s.pathAt[0], s.headAt[1] - s.pathAt[1])));
  await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(80); r.fastBottom = (await p.evaluate(probe)).drawnRatio;
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(80); r.fastTop = (await p.evaluate(probe)).drawnRatio;
  await ctx.close();
  for (const mode of ['reduce', 'nojs']) {
    const c = await b.newContext({ viewport: { width: w, height: 700 }, ...(mode === 'reduce' ? { reducedMotion: 'reduce' } : { javaScriptEnabled: false }) }); const q = await c.newPage();
    await q.goto(url);
    r[mode] = await q.evaluate(() => { const path = document.querySelector('.lp-s-path'); return { dash: getComputedStyle(path).strokeDasharray, head: document.querySelector('.lp-s-head').getAttribute('transform') }; });
    await c.close();
  }
}
// 録画
const dir = join(root, 'out/video-s'); rmSync(dir, { recursive: true, force: true });
const ctx = await b.newContext({ viewport: { width: 400, height: 700 }, recordVideo: { dir, size: { width: 400, height: 700 } } }); const p = await ctx.newPage();
await p.goto(url); await p.evaluate(() => document.fonts.ready); await p.addStyleTag({ content: '.lp-sticky{display:none!important}' });
const top = await p.evaluate(() => document.querySelector('.lp-s').getBoundingClientRect().top + scrollY);
const glide = async (to, ms) => { const from = await p.evaluate(() => scrollY); const n = Math.round(ms / 33); for (let i = 1; i <= n; i++) { await p.evaluate((y) => scrollTo(0, y), from + (to - from) * i / n); await p.waitForTimeout(33); } };
await p.evaluate((y) => scrollTo(0, y), top - 700 * 0.95); await p.waitForTimeout(1200);
await glide(top - 700 * 0.55, 1600); await p.waitForTimeout(1400);
await glide(top - 700 * 0.15, 1600); await p.waitForTimeout(1400);
await glide(top - 700 * 0.55, 1300); await p.waitForTimeout(1200);
await glide(top - 700 * 0.0, 1600); await p.waitForTimeout(1000);
await ctx.close(); await b.close();
const f = readdirSync(dir).find((x) => x.endsWith('.webm')); renameSync(join(dir, f), join(root, 'out/lp-400-scurve.webm')); rmSync(dir, { recursive: true, force: true });
writeFileSync(join(root, 'out/scurve-check.json'), JSON.stringify(res, null, 1));
for (const w in res) { const r = res[w]; console.log(w, 'size', r.size, 'overlap', r.overlap, JSON.stringify(r.nonInteractive), 'maxRatioErr', r.maxRatioErr, 'maxHeadErr', r.maxHeadErr.toFixed(2), 'fast', r.fastBottom, r.fastTop, 'reduce', JSON.stringify(r.reduce), 'nojs', JSON.stringify(r.nojs)); console.log('  ', r.samples.join(' | ')); }
