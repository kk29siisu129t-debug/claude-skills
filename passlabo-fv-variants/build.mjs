#!/usr/bin/env node
// PASSLABO 共通テスト数学 無料特別講義: SP ファーストビュー A/B 2案を、オフラインで開ける HTML に書き出す。
//   node build.mjs            … out/passlabo-fv-a.html・out/passlabo-fv-b.html
// - 文言と素材は src/content.json。素材（講師写真・板書/教材）は assets/ の現行ページ由来ファイルを data URI で埋め込む
// - 書体は Noto Sans JP（SIL OFL 1.1、@fontsource/noto-sans-jp 5.3.0）から、使う文字を含む分割ファイルだけを埋め込む
// - CTA は確認用: <button type="button">。form・外部 URL・スクリプトを含めない（CSP で外部通信と送信を禁止）
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const C = JSON.parse(readFileSync(join(root, 'src/content.json'), 'utf8'));
const e = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- 素材（現行 LP 由来の写真・教材を切り出したもの。無ければ止める: 架空の写真や枠のまま納品しない） ----
function asset(key) {
  const a = C.assets[key];
  const f = join(root, 'assets', a.file);
  if (!existsSync(f)) throw new Error(`素材がありません: assets/${a.file}`);
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[a.file.split('.').pop().toLowerCase()];
  return { uri: `data:${mime};base64,${readFileSync(f).toString('base64')}`, alt: a.alt };
}
const photo = asset('instructor');
const board = asset('board');
const sheet = asset('text');

// ---- 書体（使う文字を含む unicode-range の分割だけ） ----
const FONT_DIR = join(root, 'fonts');
const FONT_PKG = process.env.FONT_PKG; // 例: npm pack @fontsource/noto-sans-jp@5.3.0 を展開した package/
function fontFaces(text, weights) {
  const cps = new Set([...text].map((c) => c.codePointAt(0)));
  const out = [];
  for (const w of weights) {
    const cssPath = FONT_PKG ? join(FONT_PKG, `${w}.css`) : join(FONT_DIR, `${w}.css`);
    const css = readFileSync(cssPath, 'utf8');
    for (const block of css.split('@font-face').slice(1)) {
      const file = (block.match(/files\/([^)]+\.woff2)/) || [])[1];
      const range = (block.match(/unicode-range:\s*([^;]+);/) || [])[1];
      if (!file || !range) continue;
      const hit = range.split(',').some((r) => {
        const [a, b] = r.trim().replace(/^U\+/i, '').split('-').map((x) => parseInt(x, 16));
        for (const cp of cps) if (cp >= a && cp <= (b ?? a)) return true;
        return false;
      });
      if (!hit) continue;
      const src = FONT_PKG ? join(FONT_PKG, 'files', file) : join(FONT_DIR, 'files', file);
      if (FONT_PKG) { mkdirSync(join(FONT_DIR, 'files'), { recursive: true }); copyFileSync(src, join(FONT_DIR, 'files', file)); }
      out.push(`@font-face{font-family:"PL Sans";font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${readFileSync(src).toString('base64')}) format("woff2");unicode-range:${range}}`);
    }
    if (FONT_PKG) copyFileSync(cssPath, join(FONT_DIR, `${w}.css`));
  }
  if (FONT_PKG && existsSync(join(FONT_PKG, 'LICENSE'))) copyFileSync(join(FONT_PKG, 'LICENSE'), join(FONT_DIR, 'LICENSE-OFL.txt'));
  return out.join('\n');
}

// ---- 共通 ----
const lineIcon = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.2.9c0 .3-.2 1 .9.5s6-3.5 8.2-6.1c1.5-1.6 2-3.1 2-4.7C22 6.6 17.5 3 12 3z"/></svg>`;
const chevron = `<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`;
const cta = (cls = '') => `<button type="button" class="cta ${cls}" data-cta="line-preview" aria-describedby="cta-note">${lineIcon}<span>${e(C.ctaLabel)}</span>${chevron}</button>`;
const reviewNote = `<aside class="review" id="cta-note" role="note"><b>レビュー用の確認 HTML</b>：「${e(C.ctaLabel)}」は${e(C.ctaNote)}。LINE の実 URL は未確認。講師写真・板書・配布テキストは現行 LP の画像から必要な範囲だけを切り出したもの（出典は REVIEW.md）。</aside>`;
const phrases = (arr) => arr.map((p) => `<span class="nb">${e(p)}</span>`).join('');
const nameTag = (cls) => `<p class="${cls}"><span class="role">${e(C.instructorRole)}</span><span class="nm">${e(C.instructorName)}</span><span class="cred">${e(C.instructorCred)}</span></p>`;

const BASE_CSS = `
:root{--navy:#0b1f5c;--blue:#123a9c;--ink:#111827;--sub:#374151;--paper:#f4f6fb;--line:#06c755;--line-d:#05a948;--gold:#f6c744;--red:#e0245e}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:var(--ink);font-family:"PL Sans","Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif;font-feature-settings:"palt";line-height:1.4}
.nb{display:inline-block}
img{display:block;max-width:100%}
.cta{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:64px;padding:0 20px;border-radius:999px;background:linear-gradient(180deg,#14d468,var(--line) 55%,var(--line-d));color:#fff;font-weight:900;font-size:20px;letter-spacing:.02em;box-shadow:0 5px 0 #04913d,0 10px 20px rgba(6,199,85,.3);cursor:pointer;text-align:center}
.cta:focus-visible{outline:3px solid #fff;box-shadow:0 0 0 6px var(--navy)}
.cta .ico{width:28px;height:28px;flex:none}.cta .chev{width:18px;height:18px;flex:none;margin-left:2px}
.paper{background:#fff;padding:4px;box-shadow:0 8px 18px rgba(0,0,0,.28)}
.paper img{width:100%;height:100%;object-fit:cover;object-position:0 0}
.review{margin:28px 16px 40px;padding:12px 14px;border:2px dashed #9aa6b8;border-radius:8px;font-size:13px;line-height:1.7;color:#374151;background:#fafbfc}
`;

// ---- 案A: 濃紺の1枚の広告。商品名（共テ数学 特別講義）→ 講師本人 → 板書と配布テキスト → 無料・特別テキスト → CTA ----
const A = () => `
<header class="a-band"><span class="a-brand">${e(C.brand)}</span><p>${e(C.target)}</p></header>
<section class="a-hero" aria-label="ファーストビュー">
  <div class="a-copy">
    <p class="a-cred">${e(C.credential)}</p>
    <h1 class="a-title">${C.productA.map((x) => `<span>${e(x)}</span>`).join('')}</h1>
    <p class="a-sub">${phrases(C.subA)}</p>
  </div>
  <figure class="a-photo"><img src="${photo.uri}" alt="${e(photo.alt)}"></figure>
  <p class="a-name"><span class="role">${e(C.instructorRole)}</span><span class="nm">${e(C.instructorName)}</span></p>
  <figure class="a-mats" aria-label="${e(C.materialLabel)}">
    <span class="paper a-sheet"><img src="${sheet.uri}" alt="${e(sheet.alt)}"></span>
    <span class="paper a-board"><img src="${board.uri}" alt="${e(board.alt)}"></span>
    <figcaption>${e(C.materialLabel)}</figcaption>
  </figure>
</section>
<section class="a-offer">
  <p class="a-main">${e(C.offerMain)}</p><p class="a-subgift">${e(C.offerSub)}</p>
  ${cta()}
</section>
${reviewNote}`;
const A_CSS = `
.a-band{background:var(--gold);text-align:center;padding:8px 12px;position:relative}
.a-brand{display:block;font-size:13px;font-weight:900;letter-spacing:.14em;color:var(--navy);opacity:.85;line-height:1.2}
.a-band p{margin:0;font-size:19px;font-weight:900;color:var(--navy);letter-spacing:.04em}
.a-hero{position:relative;height:372px;overflow:hidden;background:linear-gradient(90deg,#0c2f8e 0%,#0b2672 45%,#0e1a45 75%,#13151d 100%);color:#fff}
.a-copy{position:absolute;z-index:3;left:16px;top:16px;width:60%}
.a-cred{margin:0;font-size:18px;font-weight:900;color:var(--gold);letter-spacing:.02em}
.a-title{margin:4px 0 0;font-size:48px;line-height:1.06;font-weight:900;letter-spacing:-.02em}
.a-title span{display:block;white-space:nowrap}
.a-title span:last-child{color:#fff;-webkit-text-stroke:0}
.a-sub{margin:10px 0 0;font-size:16px;font-weight:700;line-height:1.55;color:#e8edff}
.a-sub .nb{display:block}
.a-photo{position:absolute;z-index:1;right:-84px;top:0;height:100%;margin:0;aspect-ratio:656/585}
.a-photo img{height:100%;width:100%;object-fit:cover}
.a-name{position:absolute;z-index:4;right:10px;bottom:14px;margin:0;display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.a-name .role{background:var(--gold);color:var(--navy);font-size:13px;font-weight:900;padding:1px 8px}
.a-name .nm{background:#fff;color:var(--navy);font-size:18px;font-weight:900;padding:2px 10px;letter-spacing:.06em}
.a-name .cred{background:var(--navy);color:#fff;font-size:13px;font-weight:700;padding:2px 8px}
.a-mats{position:absolute;z-index:2;left:14px;bottom:16px;width:210px;height:138px;margin:0}
.a-sheet{position:absolute;left:62px;top:0;width:134px;height:118px;transform:rotate(4deg)}
.a-board{position:absolute;left:0;top:10px;width:128px;height:116px;transform:rotate(-5deg)}
.a-mats figcaption{position:absolute;left:0;bottom:-6px;font-size:13px;font-weight:900;color:#fff;background:rgba(11,31,92,.9);padding:2px 8px;white-space:nowrap}
.a-offer{background:#fff8e1;padding:14px 16px 20px;border-top:4px solid var(--gold)}
.a-main{margin:0;text-align:center;font-size:40px;font-weight:900;color:var(--red);line-height:1.1;letter-spacing:-.02em}
.a-subgift{margin:4px 0 12px;text-align:center;font-size:16px;font-weight:700;color:var(--navy)}
.a-free{font-size:40px;font-weight:900;color:var(--red);line-height:1;letter-spacing:-.02em;white-space:nowrap;flex:none}
.a-gift{font-size:18px;font-weight:900;color:var(--navy);line-height:1.35}
@media (min-width:900px){
.a-band p{font-size:24px}
.a-hero{height:480px;background:linear-gradient(90deg,#0c2f8e 0,#0d2f8c 62%,#0e1a45 86%,#13151d 100%)}
.a-copy{left:max(24px,calc((100% - 1160px)/2));top:44px;width:560px}
.a-cred{font-size:26px}.a-title{font-size:96px}.a-title span{display:inline-block;margin-right:.25em}.a-sub{font-size:24px;margin-top:18px}
.a-photo{right:max(0px,calc((100% - 1260px)/2));-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 90px);mask-image:linear-gradient(90deg,transparent 0,#000 90px)}
.a-mats{left:calc(max(24px,(100% - 1160px)/2) + 470px);bottom:44px;width:300px;height:210px}
.a-sheet{left:100px;width:190px;height:172px}.a-board{width:180px;height:168px}
.a-name{right:max(24px,calc((100% - 1160px)/2));bottom:28px}.a-name .nm{font-size:30px}
.a-offer{display:grid;grid-template-columns:auto minmax(0,460px);justify-content:center;align-items:center;gap:44px;padding:22px}
.a-main{grid-column:1;text-align:left}.a-subgift{grid-column:1;margin:4px 0 0;text-align:left}.a-offer .cta{grid-column:2;grid-row:1/3}
}`;

// ---- 案B: 白地で悩みから入る縦の流れ。悩み → 学ぶこと → 配布テキストと板書＋講師本人 → 無料の特別講義 → CTA ----
const B = () => `
<header class="b-top"><span class="b-brand">${e(C.brand)}</span><span class="b-pill">${e(C.product)}</span></header>
<section class="b-hero" aria-label="ファーストビュー">
  <ul class="b-pains">${C.pains.map((p) => `<li>${e(p)}</li>`).join('')}</ul>
  <p class="b-arrow" aria-hidden="true"></p>
  <h1 class="b-change">${phrases(C.changePhrases)}</h1>
  <div class="b-stage">
    <span class="paper b-sheet"><img src="${sheet.uri}" alt="${e(sheet.alt)}"></span>
    <span class="paper b-board"><img src="${board.uri}" alt="${e(board.alt)}"></span>
    <figure class="b-photo"><img src="${photo.uri}" alt="${e(photo.alt)}"></figure>
    ${nameTag('b-name')}
  </div>
</section>
<section class="b-offer">
  <p class="b-product"><span class="b-free">無料</span><b>${e(C.product)}</b></p>
  <p class="b-gift">${phrases(C.offerText)}</p>
  ${cta()}
</section>
${reviewNote}`;
const B_CSS = `
.b-top{display:flex;align-items:center;justify-content:space-between;padding:9px 16px;background:var(--navy);color:#fff}
.b-brand{font-weight:900;font-size:16px;letter-spacing:.08em}.b-pill{font-size:16px;font-weight:900;background:var(--gold);color:var(--navy);padding:3px 12px;border-radius:999px}
.b-hero{background:#fff;padding:12px 16px 0}
.b-pains{list-style:none;margin:0;padding:0;display:flex;gap:8px;justify-content:center}
.b-pains li{font-size:18px;font-weight:900;color:#9f1239;background:#fff1f2;border:2px solid #fecdd3;border-radius:8px;padding:5px 10px}
.b-pains li::before{content:"×";margin-right:6px;color:#e11d48}
.b-arrow{width:0;height:0;margin:6px auto 4px;border-left:13px solid transparent;border-right:13px solid transparent;border-top:13px solid var(--blue)}
.b-change{margin:0;text-align:center;font-size:40px;line-height:1.18;font-weight:900;letter-spacing:-.03em;color:var(--ink)}
.b-stage{position:relative;margin:10px -16px 0;height:180px;background:linear-gradient(180deg,#fff 0 22%,var(--paper) 22%)}
.b-sheet{position:absolute;left:14px;top:4px;width:140px;height:166px;transform:rotate(-3deg);z-index:2}
.b-board{position:absolute;left:116px;top:36px;width:116px;height:112px;transform:rotate(4deg);z-index:1}
.b-photo{position:absolute;right:0;bottom:0;width:170px;height:180px;margin:0;overflow:hidden}
.b-photo img{width:100%;height:100%;object-fit:cover;object-position:62% 0}
.b-name{position:absolute;z-index:3;right:8px;bottom:10px;margin:0;display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.b-name .role{background:var(--gold);color:var(--navy);font-size:13px;font-weight:900;padding:1px 8px}
.b-name .nm{background:#fff;color:var(--navy);font-size:20px;font-weight:900;padding:1px 10px;letter-spacing:.06em}
.b-name .cred{background:var(--navy);color:#fff;font-size:13px;font-weight:700;padding:1px 8px}
.b-offer{background:var(--navy);padding:10px 16px 18px;text-align:center;color:#fff}
.b-product{margin:0;font-weight:900;display:flex;align-items:center;justify-content:center;gap:10px}
.b-product b{font-size:34px;letter-spacing:-.02em;white-space:nowrap}
.b-free{background:var(--red);color:#fff;font-size:20px;padding:3px 10px;border-radius:4px}
.b-gift{margin:2px 0 10px;font-size:17px;font-weight:700;color:var(--gold)}
@media (min-width:900px){
.b-top{padding:12px max(24px,calc((100% - 1160px)/2))}
.b-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);grid-template-areas:"pains stage" "arrow stage" "change stage";grid-template-rows:auto auto 1fr;column-gap:40px;padding:40px max(24px,calc((100% - 1160px)/2)) 0;align-content:center}
.b-pains{grid-area:pains;justify-content:flex-start;align-self:start;align-items:flex-start;margin-top:72px}.b-pains li{font-size:24px}
.b-arrow{grid-area:arrow;margin:16px 0 12px 80px}
.b-change{grid-area:change;text-align:left;font-size:60px;align-self:start}
.b-stage{grid-area:stage;height:420px;margin:0}
.b-sheet{width:229px;height:264px;top:16px}.b-board{left:90px;top:250px;width:167px;height:141px}.b-photo{width:340px;height:420px}
.b-offer{display:grid;grid-template-columns:auto minmax(0,460px);justify-content:center;align-items:center;column-gap:44px;padding:22px;text-align:left}
.b-gift{grid-column:1;margin:0}.b-offer .cta{grid-column:2;grid-row:1/3}
}`;

function page(id, title, body, css) {
  const text = body.replace(/<[^>]+>/g, '') + C.ctaLabel + '×';
  const fonts = fontFaces(text, [500, 700, 900]);
  const csp = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="robots" content="noindex,nofollow">
<title>${e(title)}</title>
<style>${fonts}
${BASE_CSS}
${css}</style></head>
<body data-variant="${id}">
${body}
</body></html>`;
}

mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out/passlabo-fv-a.html'), page('a', 'PASSLABO FV 案A（確認用）', A(), A_CSS));
writeFileSync(join(root, 'out/passlabo-fv-b.html'), page('b', 'PASSLABO FV 案B（確認用）', B(), B_CSS));
console.log('out/passlabo-fv-a.html, out/passlabo-fv-b.html（現行 LP 由来の素材を内包）');
