#!/usr/bin/env node
// PASSLABO 共テ数学 特別講義: 未公開の確認用フル LP。
//   FONT_PKG=<@fontsource/noto-sans-jp を展開した package/> node build.mjs  … out/passlabo-full-lp.html
// - FV は固定: src/fv-a4p-4706a14.html（passlabo-fv-variants の commit 4706a14 の a4p と同一バイト。SHA256 を照合）を
//   そのまま使い、FV の後ろに本文、末尾にレビュー用の案内を足すだけ（FV のマークアップ・CSS・画像は変更しない）
// - 本文の事実は REVIEW.md の出典一覧の範囲だけ。架空の FAQ・日時・価格・受講者の声・点数の約束は書かない
// - CTA はすべて確認用 <button type="button">。form は含めない。外部 URL はフッターの法務リンク3つだけ（クリック時のみ）
// - JS は演出の開始と SP 追従 CTA の出し入れだけ（src/sections.mjs）。CSP は FV のものに、その1本のインラインスクリプトのハッシュだけを足す（送信・外部取得は禁止のまま）
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { body, css, script } from './src/sections.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const FV_SHA = '18f394bca55e60a145eb01d59c1abf09db304869808a341e372203c8d5d236e5';
const fv = readFileSync(join(root, 'src/fv-a4p-4706a14.html'));
if (createHash('sha256').update(fv).digest('hex') !== FV_SHA) throw new Error('固定 FV が 4706a14 の版と一致しません');
const fvHtml = fv.toString('utf8');

const e = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ASSETS = join(root, '../passlabo-fv-variants/assets');
const img = (f) => {
  const p = join(ASSETS, f);
  if (!existsSync(p)) throw new Error(`素材がありません: ${p}`);
  return `data:image/${f.split('.').pop()};base64,${readFileSync(p).toString('base64')}`;
};
const board = img('board-from-current-lp.webp');
const sheet = img('text-from-current-lp.webp');
const profile = img('profile-circle-from-current-lp.webp');

// FV と同じボタン（文言・アイコン・確認用の仕様）
// FV への承認済みの変更（3点だけ）: 日時の1行を追加、CTA を LINE への通常リンクにし文言を「LINEで参加申込へ進む」に。それ以外の FV は原本のまま（下で照合）
export const LINE = 'https://lin.ee/rTgblIH';
const FV_PATCHES = [
  ['<p class="f-gift">講義参加者全員に特別テキストを配布</p>\n', '<p class="f-gift">講義参加者全員に特別テキストを配布</p>\n    <p class="f-when"><b>10/17（土）20:00〜22:00</b>｜オンライン（Zoom）</p>\n'],
  ['<button type="button" class="cta f-cta" data-cta="line-preview" aria-describedby="cta-note">', `<a class="cta f-cta" href="${LINE}" rel="noopener" aria-describedby="cta-note">`],
  ['<span>LINEで無料講義を受け取る</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg></button>', '<span>LINEで参加申込へ進む</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg></a>'],
];
const patchFv = (h) => FV_PATCHES.reduce((acc, [from, to]) => { if (acc.split(from).length !== 2) throw new Error('FV の変更箇所が一意に見つかりません: ' + from.slice(0, 40)); return acc.replace(from, to); }, h);
const fvPatched = patchFv(fvHtml);
const ctaBtn = fvPatched.match(/<a class="cta f-cta"[\s\S]*?<\/a>/)[0].replace('class="cta f-cta"', 'class="cta lp-cta"');

const stickyBtn = ctaBtn.replace('class="cta lp-cta"', 'class="cta lp-sticky-cta"');
const BODY = body({ board, sheet, profile, ctaBtn, stickyBtn });
const LP_CSS = css;

// 本文で増えた文字の書体（FV に入っている分割は重ねない）
function fontFaces(text, skipText, weights) {
  const pkg = process.env.FONT_PKG;
  if (!pkg) throw new Error('FONT_PKG を指定してください（@fontsource/noto-sans-jp の package/）');
  const cpsOf = (t) => new Set([...t].map((c) => c.codePointAt(0)));
  const need = cpsOf(text), have = cpsOf(skipText);
  const out = [];
  for (const w of weights) {
    const css = readFileSync(join(pkg, `${w}.css`), 'utf8');
    for (const block of css.split('@font-face').slice(1)) {
      const file = (block.match(/files\/([^)]+\.woff2)/) || [])[1];
      const range = (block.match(/unicode-range:\s*([^;]+);/) || [])[1];
      if (!file || !range) continue;
      const hits = (cps) => range.split(',').some((r) => { const [a, b] = r.trim().replace(/^U\+/i, '').split('-').map((x) => parseInt(x, 16)); for (const cp of cps) if (cp >= a && cp <= (b ?? a)) return true; return false; });
      if (!hits(need) || hits(have)) continue; // FV がすでにこの分割を持っていれば足さない
      out.push(`@font-face{font-family:"PL Sans";font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${readFileSync(join(pkg, 'files', file)).toString('base64')}) format("woff2");unicode-range:${range}}`);
    }
  }
  return out.join('\n');
}
const strip = (h) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/src="data:[^"]+"/g, '').replace(/<[^>]+>/g, '');
const fvText = strip(fvHtml.split('<body')[1]) + 'LINEで無料講義を受け取る×';
const fonts = fontFaces(strip(BODY), fvText, [500, 700, 900]);

// 組み立て: FV の確認用注記（aside）の位置に本文を入れ、注記はフッターの短い確認表示（同じ id）にまとめる。FV 本体は1バイトも変えない
const asideRe = /\n<aside class="review" id="cta-note" role="note">[\s\S]*?<\/aside>\n/;
let html = fvPatched.replace(asideRe, `\n${BODY}</footer>\n`);
html = html.replace(/<title>[^<]*<\/title>/, '<title>PASSLABO 共テ数学 特別講義（未公開の確認用 LP・仮置き数値あり）</title>');
// 実績面の数字だけの表示書体: Titan One（SIL OFL 1.1、@fontsource/titan-one 5.3.0 の latin 分割。fonts-num/LICENSE-OFL.txt）。数字・カンマのみに使う
const numFace = `@font-face{font-family:"PL Num";font-weight:400;font-display:block;src:url(data:font/woff2;base64,${readFileSync(join(root, 'fonts-num/titan-one-latin-400-normal.woff2')).toString('base64')}) format("woff2");unicode-range:U+0030-0039,U+002C}`;
html = html.replace('</style></head>', `\n${fonts}\n${numFace}\n${LP_CSS}</style></head>`);
const scriptHash = createHash('sha256').update(script).digest('base64');
const cspOld = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";
if (!html.includes(cspOld)) throw new Error('FV の CSP が見つかりません');
html = html.replace(cspOld, `${cspOld}; script-src 'sha256-${scriptHash}'`);
html = html.replace('<meta name="viewport" content="width=device-width,initial-scale=1">', '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">');
html = html.replace('</body></html>', `<script>${script}</script>\n</body></html>`);
// 固定 FV の範囲（<body> から FV の </div> まで）が原本と同一であることを確かめる
const fvPart = (h) => h.slice(h.indexOf('<body'), h.indexOf('\n<main class="lp"') > 0 ? h.indexOf('\n<main class="lp"') : h.search(asideRe));
if (fvPart(html).trimEnd() !== patchFv(fvPart(fvHtml)).trimEnd()) throw new Error('FV 部分が、承認済みの3点以外で変わっています');

mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out/passlabo-full-lp.html'), html);
console.log(`out/passlabo-full-lp.html（${(html.length / 1e6).toFixed(2)} MB、FV は 4706a14 に承認済みの3点だけを適用）`);
