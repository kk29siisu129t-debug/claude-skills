#!/usr/bin/env node
// 確認用 LP を実ブラウザで撮影（SP 400/360 は全体、PC 1280 は全体）し、計測を out/measure.json に書く
import { launch } from '../tools/lp-studio/tests/e2e/pw.mjs';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const out = (f) => join(root, 'out', f);
const b = await launch();
const measure = {};
for (const [w, scale] of [[400, 2], [360, 2], [1280, 1]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: w > 900 ? 800 : 640 }, deviceScaleFactor: scale });
  const p = await ctx.newPage();
  const req = [];
  p.on('request', (r) => { if (!/^(file|data):/.test(r.url())) req.push(r.url()); });
  await p.goto(`file://${out('passlabo-full-lp.html')}`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: out(`lp-${w}-full.png`), fullPage: true });
  measure[w] = await p.evaluate(() => {
    const vis = [...document.querySelectorAll('body *')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
    const clipped = vis.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map((el) => el.className || el.tagName);
    return { height: document.documentElement.scrollHeight, hscroll: document.documentElement.scrollWidth > innerWidth, clippedText: clipped, minFont: Math.min(...vis.filter((el) => !el.closest('.review,.lp-review')).map((el) => parseFloat(getComputedStyle(el).fontSize))), ctas: [...document.querySelectorAll('.cta')].map((c) => c.type), forms: document.forms.length, links: document.links.length, imgsWithoutAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length };
  });
  const before = p.url();
  for (const c of await p.$$('.cta')) { await c.scrollIntoViewIfNeeded(); await c.click(); await p.keyboard.press('Enter'); }
  await p.waitForTimeout(300);
  measure[w].ctaNoNav = p.url() === before; measure[w].externalRequests = req;
  await ctx.close();
}
await b.close();
writeFileSync(out('measure.json'), JSON.stringify(measure, null, 1));
console.log(JSON.stringify(measure, null, 1));
