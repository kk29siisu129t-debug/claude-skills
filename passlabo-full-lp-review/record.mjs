#!/usr/bin/env node
// 400px の実画面を約20秒収録（要所で止める）: 転換の下線 → 3テーマ → 教材の浮上 → 追従 CTA の出現/退避 → 最終 CTA・フッター
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
await glide(await top('.lp-goal', 60), 1200); await p.waitForTimeout(1300);   // 目標・追従 CTA が出る
await glide(await top('.lp-feel', 40), 1000); await p.waitForTimeout(1300);   // 共感
await glide(await top('.lp-turn', 80), 1000); await p.waitForTimeout(1600);   // 下線が走る
await glide(await top('.lp-themes', 20), 1000); await p.waitForTimeout(1600); // 3テーマが順に
await glide(await top('.lp-mats', 0), 1000); await p.waitForTimeout(1600);    // 教材が浮上
await glide(await top('.lp-prof', 0), 1000); await p.waitForTimeout(1200);    // 講師
await glide(await top('.lp-gift', 0), 900); await p.waitForTimeout(900);      // 特典
await glide(await top('.lp-final', 40), 1000); await p.waitForTimeout(1500);  // 最終 CTA が入ると追従 CTA は退避
await glide(await p.evaluate(() => document.documentElement.scrollHeight), 900); await p.waitForTimeout(1200); // フッター
await ctx.close(); await b.close();
const f = readdirSync(dir).find((x) => x.endsWith('.webm')); renameSync(join(dir, f), join(root, 'out/lp-400-scroll.webm'));
