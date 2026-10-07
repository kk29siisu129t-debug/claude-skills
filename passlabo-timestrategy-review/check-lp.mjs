#!/usr/bin/env node
// 確認用 LP の実ブラウザ検査と出力（案A・案B 共通）。外部への通信はすべて遮断し、リンクはクリックせず href だけを検証する。
//   node check-lp.mjs <html> <出力フォルダ> <接頭辞> <sticky> <FVのCTA> <最終セクション> <追従CTA>
// 出力: <接頭辞>-{400,360,1280}-full.png・-400-1x-full.png・-{400,360}-split.png・-400-scroll.mp4（webm→ffmpeg）・<接頭辞>-check.json
import { launch } from '../tools/lp-studio/tests/e2e/pw.mjs';
import { writeFileSync, rmSync, readdirSync, renameSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
const [htmlArg, outArg, pre, STICKY, FVCTA, FINAL, STICKYCTA] = process.argv.slice(2);
const html = resolve(htmlArg), out = resolve(outArg); mkdirSync(out, { recursive: true });
const url = `file://${html}`, LINE = 'https://lin.ee/rTgblIH';
const b = await launch();
const res = { blockedRequests: [] };
async function ctx(opts = {}) {
  const c = await b.newContext(opts);
  await c.route(/^(https?|wss?):/, (r) => { res.blockedRequests.push(r.request().url()); return r.abort(); });
  return c;
}
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
for (const [w, scale, name] of [[400, 2, '400'], [360, 2, '360'], [1280, 1, '1280'], [400, 1, '400-1x']]) {
  const c = await ctx({ viewport: { width: w, height: w > 900 ? 800 : 700 }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(url); await p.evaluate(() => document.fonts.ready);
  const st = await p.addStyleTag({ content: `${STICKY}{display:none!important}` });
  await p.screenshot({ path: join(out, `${pre}-${name}-full.png`), fullPage: true });
  await st.evaluate((e) => e.remove());
  if (name !== '400-1x') res[name] = await p.evaluate(([FVCTA]) => {
    const vis = [...document.querySelectorAll('body *')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
    const clipped = vis.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map((el) => el.className || el.tagName);
    const ctas = [...document.querySelectorAll('.cta')].map((a) => ({ tag: a.tagName, href: a.getAttribute('href'), target: a.getAttribute('target'), text: a.textContent.trim() }));
    const fv = document.querySelector(FVCTA).getBoundingClientRect();
    return { height: document.documentElement.scrollHeight, hscroll: document.documentElement.scrollWidth > innerWidth, clipped, ctas, links: [...document.links].map((a) => a.getAttribute('href')), forms: document.forms.length, buttons: document.querySelectorAll('button').length, fvCtaBottom: Math.round(fv.bottom), minFont: Math.min(...vis.map((el) => parseFloat(getComputedStyle(el).fontSize))) };
  }, [FVCTA]);
  if (res[name]) res[name].errors = errs;
  await c.close();
}
// 追従 CTA（360/400）: 表示の正しさ・キーボード・フォーカス離脱・動きを減らす設定・JS 無効
for (const w of [360, 400, 1280]) {
  const r = (res[`sticky${w}`] = {});
  const c = await ctx({ viewport: { width: w, height: w > 900 ? 800 : 700 } }); const p = await c.newPage();
  await p.goto(url); await p.evaluate(() => document.fonts.ready);
  const H = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const mism = []; const shownAt = [];
  for (let y = 0; y <= H + 120; y += 120) {
    await p.evaluate((yy) => scrollTo(0, yy), y); await p.waitForTimeout(60);
    const s = await p.evaluate(([STICKY, FVCTA, FINAL]) => {
      const vh = innerHeight, st = document.querySelector(STICKY);
      const others = [...document.querySelectorAll('.cta')].filter((c) => !st.contains(c));
      const exp = innerWidth < 900 && document.querySelector(FVCTA).getBoundingClientRect().bottom < 0 && !others.some((c) => { const r = c.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; }) && document.querySelector(FINAL).getBoundingClientRect().top >= vh;
      // 表示中の追従 CTA が、通常の CTA に重なっていないか
      const sr = st.hidden ? null : st.getBoundingClientRect();
      const overCta = sr ? others.some((c) => { const r = c.getBoundingClientRect(); return r.bottom > sr.top && r.top < sr.bottom; }) : false;
      return { y: Math.round(scrollY), shown: !st.hidden, exp, overCta };
    }, [STICKY, FVCTA, FINAL]);
    if (s.shown !== s.exp || s.overCta) mism.push(s); if (s.shown) shownAt.push(s.y);
  }
  r.mismatches = mism; r.firstShownY = shownAt[0] ?? null; r.shownCount = shownAt.length;
  // キーボード: 先頭から Tab（Enter は押さない）。フォーカス先が追従 CTA に隠れないか
  await p.evaluate(() => scrollTo(0, 0)); await p.reload(); await p.waitForTimeout(100);
  const kb = [];
  for (let i = 0; i < 14; i++) { await p.keyboard.press('Tab'); await p.waitForTimeout(80); const k = await p.evaluate((STICKY) => { const a = document.activeElement, s = document.querySelector(STICKY), r = a.getBoundingClientRect(), sr = s.hidden ? null : s.getBoundingClientRect(); return { el: (a.className || a.tagName) + ':' + (a.textContent || '').trim().slice(0, 10), covered: !!(sr && !s.contains(a) && r.bottom > sr.top && r.top < sr.bottom), focusVisible: a.matches(':focus-visible') }; }, STICKY); kb.push(k); if (k.el.startsWith('BODY')) break; }
  r.keyboard = kb; r.keyboardCovered = kb.filter((k) => k.covered).length;
  if (w < 900) {
    // フォーカス離脱: 追従 CTA にフォーカス → 最終 CTA の位置へ → Tab で外へ → 追従 CTA は隠れる
    const pos = await p.evaluate((FINAL) => document.querySelector(FINAL).offsetTop, FINAL);
    await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight * 0.4)); await p.waitForTimeout(120);
    const shown = await p.evaluate((S) => !document.querySelector(S).hidden, STICKY);
    if (shown) { await p.focus(STICKYCTA); await p.evaluate((y) => scrollTo(0, y), pos); await p.waitForTimeout(120); const during = await p.evaluate((S) => !document.querySelector(S).hidden, STICKY); await p.keyboard.press('Tab'); await p.waitForTimeout(60); r.focusExit = { shownBefore: shown, whileFocused: during, afterTab: await p.evaluate((S) => !document.querySelector(S).hidden, STICKY) }; }
    else r.focusExit = { shownBefore: false };
  }
  await c.close();
  for (const mode of ['reduce', 'nojs']) {
    const c2 = await ctx({ viewport: { width: w, height: 700 }, ...(mode === 'reduce' ? { reducedMotion: 'reduce' } : { javaScriptEnabled: false }) }); const q = await c2.newPage();
    await q.goto(url);
    r[mode] = await q.evaluate((STICKY) => ({ stickyHidden: document.querySelector(STICKY).hidden, transparentText: [...document.querySelectorAll('main *, header *')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && +getComputedStyle(el).opacity < 1).length, sPathDash: (() => { const s = document.querySelector('[class$="-s-path"]'); return s ? getComputedStyle(s).strokeDasharray : null; })() }), STICKY);
    await c2.close();
  }
}
// 短いスクロール録画（400px、要所で止める）
const vdir = join(out, `video-${pre}`); rmSync(vdir, { recursive: true, force: true });
{ const c = await ctx({ viewport: { width: 400, height: 700 }, recordVideo: { dir: vdir, size: { width: 400, height: 700 } } }); const p = await c.newPage();
  await p.goto(url); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1300);
  const H = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= H; y += 18) { await p.evaluate((yy) => scrollTo(0, yy), y); await p.waitForTimeout(y % 700 < 18 ? 700 : 28); }
  await p.waitForTimeout(1200); await c.close(); }
const f = readdirSync(vdir).find((x) => x.endsWith('.webm'));
ff('-i', join(vdir, f), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-movflags', '+faststart', join(out, `${pre}-400-scroll.mp4`)); rmSync(vdir, { recursive: true, force: true });
await b.close();
// 分割画像
for (const [w] of [[400], [360]]) {
  const src = join(out, `${pre}-${w}-full.png`), sm = join(out, `_${pre}${w}.png`);
  ff('-i', src, '-vf', `scale=${w}:-1`, sm);
  const H = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=height', '-of', 'csv=p=0', sm]).toString(); const P = Math.ceil(H / 4);
  const parts = [0, 1, 2, 3].map((i) => { const o = join(out, `_${pre}${w}-${i}.png`); ff('-i', sm, '-vf', `crop=${w}:min(${P}\\,ih-${i * P}):0:${i * P},pad=${w}:${P}:0:0:white`, o); return o; });
  ff(...parts.flatMap((x) => ['-i', x]), '-filter_complex', 'hstack=4', join(out, `${pre}-${w}-split.png`));
  [sm, ...parts].forEach((x) => rmSync(x));
}
res.lineHrefOk = ['400', '360', '1280'].every((k) => res[k].ctas.length && res[k].ctas.every((c) => c.tag === 'A' && c.href === LINE && !c.target));
writeFileSync(join(out, `${pre}-check.json`), JSON.stringify(res, null, 1));
const brief = { lineHrefOk: res.lineHrefOk, blocked: res.blockedRequests.length };
for (const k of ['400', '360', '1280']) brief[k] = { h: res[k].height, hscroll: res[k].hscroll, clipped: res[k].clipped.length, ctas: res[k].ctas.map((c) => c.text).join('/'), links: res[k].links.length, forms: res[k].forms, buttons: res[k].buttons, fvCtaBottom: res[k].fvCtaBottom, minFont: res[k].minFont, errors: res[k].errors.length };
for (const w of [360, 400, 1280]) { const r = res[`sticky${w}`]; brief[`sticky${w}`] = { mism: r.mismatches.length, firstY: r.firstShownY, kbCovered: r.keyboardCovered, kb: r.keyboard.map((k) => k.el.slice(0, 14)).join(' > '), focusExit: r.focusExit, reduce: r.reduce, nojs: r.nojs }; }
console.log(JSON.stringify(brief, null, 1));
