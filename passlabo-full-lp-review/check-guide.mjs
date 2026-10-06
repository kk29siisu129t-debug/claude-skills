#!/usr/bin/env node
// 下へ伸びるガイド線の実ブラウザ検査（360/400/1280）と、0／途中／完成を同じ箇所で見せる短い録画（400px）
// - 線の長さ・矢印頭の位置 = スクロール位置から決まる進捗 p（画面の下85%→40% で 0→1）
// - 途中で止めれば途中の長さ、逆スクロールで縮む、一気に飛んでも正しい値
// - 操作できない（aria-hidden・pointer-events:none・フォーカス不可）、本文・写真に重ならない
// - 動きを減らす設定 / JS 無効では完成した静止矢印
import { launch } from '../tools/lp-studio/tests/e2e/pw.mjs';
import { writeFileSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const url = `file://${join(root, 'out/passlabo-full-lp.html')}`;
const b = await launch();
const res = {};
const probe = (i) => {
  const g = document.querySelectorAll('.lp-guide')[i], vh = innerHeight;
  const gr = g.getBoundingClientRect(), line = g.querySelector('.lp-guide-line').getBoundingClientRect(), head = g.querySelector('.lp-guide-head').getBoundingClientRect();
  let exp = (vh * .85 - gr.top) / (vh * .45); exp = Math.max(0, Math.min(1, exp));
  const H = parseFloat(getComputedStyle(g).getPropertyValue('--h'));
  return { top: Math.round(gr.top), p: +getComputedStyle(g).getPropertyValue('--p'), expected: +exp.toFixed(3), lineLen: +line.height.toFixed(1), expectedLen: +(H * exp).toFixed(1), headTipOffset: +(head.bottom - gr.top).toFixed(1) };
};
for (const w of [360, 400, 1280]) {
  const r = (res[w] = {});
  const ctx = await b.newContext({ viewport: { width: w, height: w > 900 ? 800 : 700 } }); const p = await ctx.newPage();
  await p.goto(url); await p.evaluate(() => document.fonts.ready);
  const n = await p.evaluate(() => document.querySelectorAll('.lp-guide').length);
  r.count = n;
  r.nonInteractive = await p.evaluate(() => [...document.querySelectorAll('.lp-guide')].map((g) => ({ ariaHidden: g.getAttribute('aria-hidden'), pe: getComputedStyle(g).pointerEvents, focusables: g.querySelectorAll('a,button,[tabindex],summary,[role=button]').length, tabindex: g.getAttribute('tabindex'), cursor: getComputedStyle(g).cursor })));
  r.overlapsContent = await p.evaluate(() => [...document.querySelectorAll('.lp-guide')].map((g) => { const a = g.getBoundingClientRect(); return [...document.querySelectorAll('.lp p,.lp h2,.lp h3,.lp li,.lp img,.lp figure,.lp blockquote,.cta')].filter((el) => { const c = el.getBoundingClientRect(); return c.width && !(c.right <= a.left || c.left >= a.right || c.bottom <= a.top || c.top >= a.bottom); }).length; }));
  // 各ガイドについて: 画面の下から上へ（順方向）→ 途中で停止 → 逆方向
  r.guides = [];
  for (let i = 0; i < n; i++) {
    const docTop = await p.evaluate((i) => document.querySelectorAll('.lp-guide')[i].getBoundingClientRect().top + scrollY, i);
    const vh = await p.evaluate(() => innerHeight);
    const samples = [];
    for (const frac of [1.0, 0.85, 0.7, 0.62, 0.55, 0.4, 0.3, 0.55, 0.7, 0.9]) { // 最後の3つは逆スクロール
      await p.evaluate((y) => scrollTo(0, y), Math.max(0, docTop - vh * frac)); await p.waitForTimeout(80);
      samples.push(await p.evaluate(probe, i));
    }
    const maxLenErr = Math.max(...samples.map((s) => Math.abs(s.lineLen - s.expectedLen)));
    const maxPErr = Math.max(...samples.map((s) => Math.abs(s.p - s.expected)));
    const midpoint = samples.find((s) => s.expected > 0.2 && s.expected < 0.8);
    r.guides.push({ i, maxLenErr, maxPErr, midpoint, samples: samples.map((s) => `${s.expected}:${s.lineLen}/${s.expectedLen} head@${s.headTipOffset}`) });
  }
  // 高速スクロール: 一気に最下部 → 全ガイドが完成、最上部へ戻る → 0
  await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(80);
  r.fastBottom = await p.evaluate(() => [...document.querySelectorAll('.lp-guide')].map((g) => getComputedStyle(g).getPropertyValue('--p')));
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(80);
  r.fastTop = await p.evaluate(() => [...document.querySelectorAll('.lp-guide')].map((g) => getComputedStyle(g).getPropertyValue('--p')));
  // Tab 移動でガイドにフォーカスが入らない
  const seen = [];
  for (let k = 0; k < 12; k++) { await p.keyboard.press('Tab'); const el = await p.evaluate(() => (document.activeElement.closest('.lp-guide') ? 'GUIDE' : document.activeElement.className || document.activeElement.tagName)); seen.push(el); if (el === 'BODY') break; }
  r.tabOrder = seen;
  await ctx.close();
  for (const mode of ['reduce', 'nojs']) {
    const c = await b.newContext({ viewport: { width: w, height: 700 }, ...(mode === 'reduce' ? { reducedMotion: 'reduce' } : { javaScriptEnabled: false }) }); const q = await c.newPage();
    await q.goto(url);
    r[mode] = await q.evaluate(() => [...document.querySelectorAll('.lp-guide')].map((g) => { const H = parseFloat(getComputedStyle(g).getPropertyValue('--h')); return +(g.querySelector('.lp-guide-line').getBoundingClientRect().height / H).toFixed(2); }));
    await c.close();
  }
}
// 録画: 400px、1本目のガイド（共感→実話）を 0 → 途中 → 完成 → 逆戻り で止めながら
const dir = join(root, 'out/video-guide'); rmSync(dir, { recursive: true, force: true });
const ctx = await b.newContext({ viewport: { width: 400, height: 700 }, recordVideo: { dir, size: { width: 400, height: 700 } } }); const p = await ctx.newPage();
await p.goto(url); await p.evaluate(() => document.fonts.ready);
const top = await p.evaluate(() => document.querySelector('.lp-guide').getBoundingClientRect().top + scrollY);
const glide = async (to, ms) => { const from = await p.evaluate(() => scrollY); const n = Math.round(ms / 33); for (let i = 1; i <= n; i++) { await p.evaluate((y) => scrollTo(0, y), from + (to - from) * i / n); await p.waitForTimeout(33); } };
await p.evaluate((y) => scrollTo(0, y), top - 700 * 1.05); await p.waitForTimeout(1200);   // 0
await glide(top - 700 * 0.62, 1500); await p.waitForTimeout(1500);                          // 途中
await glide(top - 700 * 0.3, 1500); await p.waitForTimeout(1500);                           // 完成
await glide(top - 700 * 0.62, 1200); await p.waitForTimeout(1200);                          // 逆スクロールで縮む
await glide(top - 700 * 0.1, 1800); await p.waitForTimeout(1200);                           // 実話の見出しへ
await ctx.close(); await b.close();
const f = readdirSync(dir).find((x) => x.endsWith('.webm')); renameSync(join(dir, f), join(root, 'out/lp-400-guide.webm')); rmSync(dir, { recursive: true, force: true });
writeFileSync(join(root, 'out/guide-check.json'), JSON.stringify(res, null, 1));
for (const w in res) { const r = res[w]; console.log(w, 'count', r.count, 'overlap', r.overlapsContent.join(), 'nonInteractive', JSON.stringify(r.nonInteractive[0]), 'fastBottom', r.fastBottom.join(), 'fastTop', r.fastTop.join(), 'reduce', r.reduce.join(), 'nojs', r.nojs.join(), 'tab', r.tabOrder.join('>')); for (const g of r.guides) console.log('  g' + g.i, 'maxLenErr', g.maxLenErr, 'maxPErr', g.maxPErr, 'mid', JSON.stringify(g.midpoint), '|', g.samples.join(' ')); }
