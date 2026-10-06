#!/usr/bin/env node
// 400px の実画面を収録（要所で止める）: 概要 → 悩み → S 字 → 講師の実話 → 実績面 → 板書 → 配布教材・案内 → 追従 CTA の出現/退避 → 最終 CTA・フッター
import { launch } from '../tools/lp-studio/tests/e2e/pw.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, readdirSync, renameSync } from 'node:fs';
const root = dirname(fileURLToPath(import.meta.url));
const dir = join(root, 'out/video-rec'); rmSync(dir, { recursive: true, force: true });
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 400, height: 700 }, reducedMotion: 'no-preference', recordVideo: { dir, size: { width: 400, height: 700 } } });
const p = await ctx.newPage();
await p.goto(`file://${join(root, 'out/passlabo-full-lp.html')}`); await p.evaluate(() => document.fonts.ready);
const top = (sel, off = 0) => p.evaluate(([s, o]) => document.querySelector(s).getBoundingClientRect().top + scrollY - o, [sel, off]);
async function glide(to, ms) { const from = await p.evaluate(() => scrollY); const n = Math.max(1, Math.round(ms / 33)); for (let i = 1; i <= n; i++) { const t = i / n, e = t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; await p.evaluate((y) => scrollTo(0, y), from + (to - from) * e); await p.waitForTimeout(33); } }
await p.waitForTimeout(1500);                                   // FV（追従 CTA なし）
await glide(await top('.lp-about', 40), 1200); await p.waitForTimeout(1800);  // 講義の概要（見る／配布／あわせて）
await glide(await top('.lp-feel', 30), 1100); await p.waitForTimeout(1300);   // 悩み
{ const s0 = await top('.lp-s'); await glide(s0 - 700 * 0.55, 1300); await p.waitForTimeout(900); await glide(s0 - 700 * 0.1, 1300); await p.waitForTimeout(900); } // S 字が経路に沿って描かれる
await glide(await top('.lp-story-body', 30), 1100); await p.waitForTimeout(1800); // 講師の実話
await glide(await top('.lp-nums', 0), 1100); await p.waitForTimeout(1800);    // 青い数字の実績面
await glide(await top('.lp-mats', 0), 1100); await p.waitForTimeout(1800);    // 板書で見る（下線）
await glide(await top('.lp-gift', 0), 1300); await p.waitForTimeout(1500);    // 配布教材
await glide(await top('.lp-prog', 300), 1100); await p.waitForTimeout(1200);  // 教材の続き・特別案内
await glide(await top('.lp-final', 40), 1100); await p.waitForTimeout(1500);  // 最終 CTA が入ると追従 CTA は退避
await glide(await p.evaluate(() => document.documentElement.scrollHeight), 900); await p.waitForTimeout(1200); // フッター
await ctx.close(); await b.close();
const f = readdirSync(dir).find((x) => x.endsWith('.webm')); renameSync(join(dir, f), join(root, 'out/lp-400-scroll.webm'));
