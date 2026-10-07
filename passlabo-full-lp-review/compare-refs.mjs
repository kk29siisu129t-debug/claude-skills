#!/usr/bin/env node
// 参照（IMG_7509 実績面・IMG_7510 S 字）と制作案を同じ 400px 幅で横に並べた監査用の比較画像を作り、青い部分の寸法を測る。
//   node compare-refs.mjs <参照1> <参照2>   → out/compare-ref-numbers.png・out/compare-ref-scurve.png・out/compare-ref.json
// 参照画像は比較用だけで、LP には埋め込まない。
import { launch } from '../tools/lp-studio/tests/e2e/pw.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const [ref1, ref2] = process.argv.slice(2);
const tmp = mkdtempSync(join(tmpdir(), 'cmp-'));
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
const b = await launch(); /* CTA は実リンクのため、外部への通信はすべて遮断する */ { const _nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await _nc(o); await c.route(/^(https?|wss?):/, (r) => r.abort()); return c; }; b.newPage = async (o) => (await b.newContext(o)).newPage(); } const p = await b.newPage({ viewport: { width: 400, height: 800 }, reducedMotion: 'reduce' });
await p.goto(`file://${join(root, 'out/passlabo-full-lp.html')}`); await p.evaluate(() => document.fonts.ready);
const y = async (s) => p.evaluate((s) => document.querySelector(s).getBoundingClientRect().top + scrollY, s);
const nums = await y('.lp-nums'); const sTop = await y('.lp-s');
await p.screenshot({ path: join(tmp, 'mine-nums.png'), fullPage: true, clip: { x: 0, y: nums, width: 400, height: 560 } });
await p.screenshot({ path: join(tmp, 'mine-s.png'), fullPage: true, clip: { x: 0, y: sTop - 60, width: 400, height: 440 } });
await b.close();
ff('-i', ref1, '-vf', 'scale=400:-1,crop=400:560:0:140', join(tmp, 'ref-nums.png'));
ff('-i', ref2, '-vf', 'scale=400:-1,crop=400:440:0:240', join(tmp, 'ref-s.png'));
const label = (inp, txt, out) => ff('-i', inp, '-vf', `pad=iw:ih+28:0:28:white,drawtext=text='${txt}':x=8:y=6:fontsize=16:fontcolor=black`, out);
const pair = (a, bb, out) => { label(a, 'reference (400px)', join(tmp, 'a.png')); label(bb, 'this LP (400px)', join(tmp, 'b.png')); ff('-i', join(tmp, 'a.png'), '-i', join(tmp, 'b.png'), '-filter_complex', '[0]pad=iw+16:ih:0:0:white[l];[l][1]hstack', out); };
try { pair(join(tmp, 'ref-nums.png'), join(tmp, 'mine-nums.png'), join(root, 'out/compare-ref-numbers.png')); pair(join(tmp, 'ref-s.png'), join(tmp, 'mine-s.png'), join(root, 'out/compare-ref-scurve.png')); }
catch { ff('-i', join(tmp, 'ref-nums.png'), '-i', join(tmp, 'mine-nums.png'), '-filter_complex', '[0]pad=iw+16:ih:0:0:white[l];[l][1]hstack', join(root, 'out/compare-ref-numbers.png')); ff('-i', join(tmp, 'ref-s.png'), '-i', join(tmp, 'mine-s.png'), '-filter_complex', '[0]pad=iw+16:ih:0:0:white[l];[l][1]hstack', join(root, 'out/compare-ref-scurve.png')); }
// 青い画素のかたまり（行のまとまり）ごとの高さ・幅
function blue(f) {
  const d = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); const w = 400, H = d.length / (w * 3);
  const isb = (x, yy) => { const i = (yy * w + x) * 3, r = d[i], g = d[i + 1], bl = d[i + 2]; return bl > 150 && r < 120 && g > 100 && g < 190; };
  const rows = []; for (let yy = 0; yy < H; yy++) { let c = 0; for (let x = 0; x < w; x += 2) if (isb(x, yy)) c++; if (c > 2) rows.push(yy); }
  const g = []; let s = rows[0], pv = rows[0]; for (const r of rows.slice(1)) { if (r - pv > 6) { g.push([s, pv]); s = r; } pv = r; } if (rows.length) g.push([s, pv]);
  return g.map(([a, z]) => { let x0 = w, x1 = 0; for (let yy = a; yy <= z; yy++) for (let x = 0; x < w; x++) if (isb(x, yy)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); } return { top: a, height: z - a + 1, left: x0, width: x1 - x0 + 1 }; });
}
const res = { refNumbers: blue(join(tmp, 'ref-nums.png')), mineNumbers: blue(join(tmp, 'mine-nums.png')), refS: blue(join(tmp, 'ref-s.png')), mineS: blue(join(tmp, 'mine-s.png')) };
writeFileSync(join(root, 'out/compare-ref.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
