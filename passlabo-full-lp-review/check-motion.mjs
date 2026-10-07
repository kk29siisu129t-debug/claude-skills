#!/usr/bin/env node
// 演出と SP 追従 CTA の実ブラウザ検査（360/400/1280）。結果は out/motion-check.json、400px の動きは out/lp-400-scroll.webm（→ mp4）
// - 通常スクロール: 追従 CTA は「FV の CTA が画面外に出た後」かつ「通常 CTA が画面に無い」かつ「最終セクションより前」のときだけ表示
// - 高速スクロール: 一気に最下部へ飛んでも、演出対象が全部表示状態になる
// - 動きを減らす設定 / JS 無効: 最初から全文が見える（opacity 1）、追従 CTA は出ない（JS 無効時）
// - キーボード: Tab で移動したフォーカス先が追従 CTA に隠れない
import { launch } from '../tools/lp-studio/tests/e2e/pw.mjs';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const url = `file://${join(root, 'out/passlabo-full-lp.html')}`;
const b = await launch(); /* CTA は実リンクのため、外部への通信はすべて遮断する */ { const _nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await _nc(o); await c.route(/^(https?|wss?):/, (r) => r.abort()); return c; }; b.newPage = async (o) => (await b.newContext(o)).newPage(); }
const res = {};
const state = () => {
  const vh = innerHeight, s = document.querySelector('.lp-sticky');
  const fv = document.querySelector('.f-cta').getBoundingClientRect();
  const inView = [...document.querySelectorAll('.cta')].filter((c) => !s.contains(c)).some((c) => { const r = c.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; });
  const nearEnd = document.querySelector('.lp-final').getBoundingClientRect().top < vh;
  const expected = innerWidth < 900 && fv.bottom < 0 && !inView && !nearEnd;
  const sec = [...document.querySelectorAll('.lp-sec,.lp-foot')].find((el) => { const r = el.getBoundingClientRect(); return r.top <= vh / 2 && r.bottom > vh / 2; });
  return { y: Math.round(scrollY), sticky: !s.hidden, expected, section: sec ? sec.className.replace('lp-sec ', '') : 'fv' };
};
for (const w of [360, 400, 1280]) {
  const r = (res[w] = {});
  const ctx = await b.newContext({ viewport: { width: w, height: w > 900 ? 800 : 700 }, reducedMotion: 'no-preference', ...(w === 400 ? { recordVideo: { dir: join(root, 'out/video'), size: { width: 400, height: 700 } } } : {}) });
  const p = await ctx.newPage();
  const ext = []; const errs = [];
  p.on('request', (q) => { if (!/^(file|data):/.test(q.url())) ext.push(q.url()); });
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(url); await p.evaluate(() => document.fonts.ready);
  r.jsClass = await p.evaluate(() => document.documentElement.classList.contains('js'));
  r.stepsOpacityBeforeScroll = await p.evaluate(() => [...document.querySelectorAll('.lp-role')].map((el) => getComputedStyle(el).opacity));
  // 通常スクロール（160px ずつ、各 120ms）
  const H = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const log = [];
  const step = w === 400 ? 40 : 160;
  for (let y = 0; y <= H + step; y += step) { await p.evaluate((yy) => scrollTo(0, yy), y); await p.waitForTimeout(w === 400 ? 45 : 60); log.push(await p.evaluate(state)); }
  r.stickyMismatches = log.filter((s) => s.sticky !== s.expected);
  r.stickyShownSections = [...new Set(log.filter((s) => s.sticky).map((s) => s.section))];
  r.stickyHiddenSections = [...new Set(log.filter((s) => !s.sticky).map((s) => s.section))];
  r.stickyFirstShownAtY = (log.find((s) => s.sticky) || {}).y ?? null;
  r.allRevealedAfterScroll = await p.evaluate(() => [...document.querySelectorAll('[data-reveal]')].every((el) => el.classList.contains('is-in')));
  r.stepsOpacityAfter = await p.evaluate(() => [...document.querySelectorAll('.lp-role')].map((el) => getComputedStyle(el).opacity));
  // 演出の長さ（宣言値）
  r.transitions = await p.evaluate(() => ['.lp-mark', '.lp-role', '.lp-mat img'].map((s) => { const c = getComputedStyle(document.querySelector(s)); return `${s}: ${c.transitionDuration} / delay ${c.transitionDelay}`; }));
  r.infiniteAnimations = await p.evaluate(() => [...document.querySelectorAll('*')].filter((el) => getComputedStyle(el).animationIterationCount === 'infinite').length);
  // 追従 CTA がフッター・最終 CTA を覆っていないか（最下部）
  await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(200);
  r.stickyAtBottom = await p.evaluate(() => !document.querySelector('.lp-sticky').hidden);
  // 追従 CTA 自体も確認用（クリック・Enter で遷移なし）
  if (w < 900) {
    await p.evaluate(() => { const t = document.querySelector('.lp-mats'); scrollTo(0, t.offsetTop + 40); }); await p.waitForTimeout(200);
    const shown = await p.evaluate(() => !document.querySelector('.lp-sticky').hidden);
    const before = p.url();
    if (shown) { await p.click('.lp-sticky-cta'); await p.keyboard.press('Enter'); await p.waitForTimeout(200); }
    r.stickyClickedNoNav = shown && p.url() === before;
    r.stickyRect = shown ? await p.evaluate(() => { const b = document.querySelector('.lp-sticky').getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), innerHeight]; }) : null;
    if (w === 400 && shown) await p.screenshot({ path: join(root, 'out/lp-400-sticky.png') });
  }
  // キーボード: Tab で全フォーカス先を巡り、追従 CTA に隠れたものを数える
  await p.reload(); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(100);
  const focus = [];
  for (let i = 0; i < 12; i++) {
    await p.keyboard.press('Tab'); await p.waitForTimeout(120);
    focus.push(await p.evaluate(() => { const a = document.activeElement, s = document.querySelector('.lp-sticky'); const r = a.getBoundingClientRect(); const st = s.hidden ? null : s.getBoundingClientRect(); return { el: (a.className || a.tagName) + (a.textContent || '').trim().slice(0, 12), covered: !!(st && !s.contains(a) && r.bottom > st.top && r.top < st.bottom), visible: r.top >= 0 && r.bottom <= innerHeight }; }));
    if (focus[focus.length - 1].el.startsWith('BODY')) break;
  }
  r.keyboard = focus;
  r.externalRequests = ext; r.consoleErrors = errs;
  await ctx.close();
  // 例外1: 追従 CTA にフォーカスしたまま最終 CTA が見える位置・最下部へ → Tab / Shift+Tab で外へ出たら、スクロール無しで追従 CTA が消える
  if (w < 900) {
    const c5 = await b.newContext({ viewport: { width: w, height: 700 } }); const p5 = await c5.newPage();
    const seq = async (key, where) => {
      await p5.goto(url); await p5.evaluate(() => document.fonts.ready);
      await p5.evaluate(() => scrollTo(0, document.querySelector('.lp-mats').offsetTop + 40)); await p5.waitForTimeout(150);
      const shownBefore = await p5.evaluate(() => !document.querySelector('.lp-sticky').hidden);
      await p5.focus('.lp-sticky-cta');
      await p5.evaluate((wh) => { if (wh === 'final') { const c = document.querySelector('.lp-cta'); scrollTo(0, c.getBoundingClientRect().top + scrollY - innerHeight / 2); } else scrollTo(0, document.documentElement.scrollHeight); }, where);
      await p5.waitForTimeout(150);
      const whileFocused = await p5.evaluate(() => ({ shown: !document.querySelector('.lp-sticky').hidden, focusKept: document.activeElement.classList.contains('lp-sticky-cta') }));
      const y = await p5.evaluate(() => scrollY);
      await p5.keyboard.press(key); await p5.waitForTimeout(60); // スクロールイベントを起こさずに確認
      const after = await p5.evaluate(() => ({ shown: !document.querySelector('.lp-sticky').hidden, focused: (document.activeElement.className || document.activeElement.tagName) + ':' + (document.activeElement.textContent || '').trim().slice(0, 10) }));
      return { key, where, shownBefore, whileFocused, after, scrolledByKey: (await p5.evaluate(() => scrollY)) !== y };
    };
    r.focusExit = [await seq('Tab', 'final'), await seq('Shift+Tab', 'final'), await seq('Tab', 'bottom')];
    await c5.close();
  }
  // 例外2: js クラスは付いたが表示更新が来ない（途中失敗）状態でも、本文・テーマ・教材が全部読める
  const c6 = await b.newContext({ viewport: { width: w, height: 700 } }); const p6 = await c6.newPage();
  await p6.goto(url);
  r.partialFailure = await p6.evaluate(() => {
    document.documentElement.classList.add('js');
    document.querySelectorAll('.is-in').forEach((el) => el.classList.remove('is-in'));
    const hidden = [...document.querySelectorAll('.lp *')].filter((el) => { const c = getComputedStyle(el); return +c.opacity < 1 || c.visibility === 'hidden' || (c.display === 'none' && !el.closest('[hidden]')); }).map((el) => el.className || el.tagName);
    return { jsClass: document.documentElement.classList.contains('js'), hiddenOrTransparent: hidden, stepsOpacity: [...document.querySelectorAll('.lp-role,.lp-role dt,.lp-role dd')].map((el) => getComputedStyle(el).opacity).join('') };
  });
  await c6.close();
  // 高速スクロール: 読み込み直後に最下部へ飛ぶ → 上にある演出対象も全部表示状態
  const c2 = await b.newContext({ viewport: { width: w, height: 700 } }); const p2 = await c2.newPage();
  await p2.goto(url); await p2.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p2.waitForTimeout(80);
  r.fastScrollAllRevealed = await p2.evaluate(() => [...document.querySelectorAll('[data-reveal]')].every((el) => el.classList.contains('is-in')));
  await p2.waitForTimeout(700);
  r.fastScrollStepsOpacity = await p2.evaluate(() => [...document.querySelectorAll('.lp-role')].map((el) => getComputedStyle(el).opacity));
  await c2.close();
  // 動きを減らす設定
  const c3 = await b.newContext({ viewport: { width: w, height: 700 }, reducedMotion: 'reduce' }); const p3 = await c3.newPage();
  await p3.goto(url);
  r.reducedMotion = await p3.evaluate(() => ({ jsClass: document.documentElement.classList.contains('js'), stepsOpacity: [...document.querySelectorAll('.lp-role')].map((el) => getComputedStyle(el).opacity), matTransform: getComputedStyle(document.querySelector('.lp-mat img')).transform, markSize: getComputedStyle(document.querySelector('.lp-mark')).backgroundSize }));
  await c3.close();
  // JS 無効
  const c4 = await b.newContext({ viewport: { width: w, height: 700 }, javaScriptEnabled: false }); const p4 = await c4.newPage();
  await p4.goto(url);
  r.noJs = await p4.evaluate(() => ({ stepsOpacity: [...document.querySelectorAll('.lp-role')].map((el) => getComputedStyle(el).opacity), stickyHidden: document.querySelector('.lp-sticky').hidden, markSize: getComputedStyle(document.querySelector('.lp-mark')).backgroundSize }));
  await c4.close();
}
await b.close();
writeFileSync(join(root, 'out/motion-check.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
