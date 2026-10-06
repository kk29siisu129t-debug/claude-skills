#!/usr/bin/env node
// 確認用 HTML を実ブラウザで撮影し、A/B（400px・同じ高さ）、PC 1280px、参照画像との比較画像を作る。
//   node shoot.mjs [参照SP画像のパス]   … out/*.png と計測 out/measure.json
import { launch } from '../tools/lp-studio/tests/e2e/pw.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = (f) => join(root, 'out', f);
const H = 640; // A/B 共通の SP 画像の高さ（FV の目安 620px を含む）
const ref = process.argv[2];
const b = await launch();
const measure = existsSync(out('measure.json')) ? JSON.parse(readFileSync(out('measure.json'), 'utf8')) : {}; // 撮らなかった案の計測は残す
for (const v of (process.env.VARIANTS || 'a,b,a2').split(',')) {
  const file = `file://${out(`passlabo-fv-${v}.html`)}`;
  const ctx = await b.newContext({ viewport: { width: 400, height: H }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const req = [];
  p.on('request', (r) => { if (!/^(file|data):/.test(r.url())) req.push(r.url()); });
  await p.goto(file);
  await p.evaluate(() => document.fonts.ready);
  // 選定用の画像は FV 本体だけ（HTML 内の確認用注記は残すが、撮影では隠す。下は同じページ背景）
  const hideNote = await p.addStyleTag({ content: '.review{display:none!important}' });
  await p.screenshot({ path: out(`passlabo-fv-${v}-sp400.png`) });
  if (v === 'a3') { await p.setViewportSize({ width: 360, height: H }); await p.screenshot({ path: out(`passlabo-fv-${v}-sp360.png`) }); await p.setViewportSize({ width: 400, height: H }); }
  await hideNote.evaluate((el) => el.remove());
  measure[v] = await p.evaluate(() => {
    const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; };
    const fs = (s) => { const el = document.querySelector(s); return el ? parseFloat(getComputedStyle(el).fontSize) : null; };
    const cta = document.querySelector('.cta');
    return { ctaBottom: Math.round(cta.getBoundingClientRect().bottom), h1: fs('h1'), h1Box: r('h1'), photo: r('figure img[alt*="講師"], .a-photo img, .b-photo img'), material: r('.a-material, .b-material'), hscroll: document.documentElement.scrollWidth > innerWidth, minFont: Math.min(...[...document.querySelectorAll('body *')].filter((el) => el.closest('.review') === null && el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((el) => parseFloat(getComputedStyle(el).fontSize))), fonts: [...document.fonts].filter((f) => f.status === 'loaded').length };
  });
  // CTA を押しても何も起きない（外部遷移・送信なし）
  const before = p.url();
  await p.click('.cta'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  measure[v].ctaNoNav = p.url() === before; measure[v].externalRequests = req;
  await ctx.close();
  const pc = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const pp = await pc.newPage();
  await pp.goto(file); await pp.evaluate(() => document.fonts.ready);
  await pp.addStyleTag({ content: '.review{display:none!important}' });
  await pp.screenshot({ path: out(`passlabo-fv-${v}-pc1280.png`) });
  await pc.close();
}
await b.close();
writeFileSync(out('measure.json'), JSON.stringify(measure, null, 1));
// 比較: 参照（400 幅にそろえる）・A・B を同じ高さで横に並べる
const scale = (src, dst) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `scale=800:-1,pad=800:max(ih\\,${H * 2}):0:0:white,crop=800:${H * 2}:0:0`, dst]);
const parts = [];
if (ref && existsSync(ref)) { scale(ref, out('_ref.png')); parts.push(out('_ref.png')); }
for (const v of ['a', 'b']) parts.push(out(`passlabo-fv-${v}-sp400.png`));
execFileSync('ffmpeg', ['-v', 'error', '-y', ...parts.flatMap((p) => ['-i', p]), '-filter_complex', `${parts.map((_, i) => `[${i}:v]pad=iw+24:ih:0:0:white[p${i}]`).join(';')};${parts.map((_, i) => `[p${i}]`).join('')}hstack=inputs=${parts.length}`, out('compare-sp400.png')]);
console.log(JSON.stringify(measure, null, 1));
// 案A 磨き直し: 旧A（afb6dab の保存版）と新A、参照・旧A・新Aの同寸比較
const oldA = join(root, 'out/archive-a-afb6dab/passlabo-fv-a-sp400.png');
const newA = out('passlabo-fv-a2-sp400.png');
if (existsSync(oldA) && existsSync(newA)) {
  const stack = (inputs, dst) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs.flatMap((p) => ['-i', p]), '-filter_complex', `${inputs.map((_, i) => `[${i}:v]pad=iw+24:ih:0:0:white[p${i}]`).join(';')};${inputs.map((_, i) => `[p${i}]`).join('')}hstack=inputs=${inputs.length}`, dst]);
  stack([oldA, newA], out('compare-a-old-new.png'));
  if (existsSync(out('passlabo-fv-a3-sp400.png'))) stack([newA, out('passlabo-fv-a3-sp400.png')], out('compare-a2-a3.png'));
  if (existsSync(out('_ref.png'))) stack([out('_ref.png'), oldA, newA], out('compare-ref-a-old-new.png'));
}
