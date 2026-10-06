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

// ---- 案A 磨き直し（a2）: 白地＋濃紺〜青の1系統。講座名 → 本人＋板書/教材の一群 → 無料講義オファー → 緑の CTA（緑は CTA だけ） ----
const A2 = () => `
<header class="x-top"><span class="x-brand">${e(C.brand)}</span><p class="x-target">${e(C.target)}</p></header>
<section class="x-hero" aria-label="ファーストビュー">
  <div class="x-copy">
    <p class="x-cred">${e(C.credential)}</p>
    <h1 class="x-title"><span>共テ数学</span><span class="x-accent">特別講義</span></h1>
    <p class="x-sub">${phrases(C.subA)}</p>
  </div>
  <div class="x-panel"><figure class="x-photo"><img src="${photo.uri}" alt="${e(photo.alt)}"></figure></div>
  <p class="x-sign"><span>${e(C.instructorRole)}</span>${e(C.instructorName)}</p>
  <figure class="x-mats" aria-label="${e(C.materialLabel)}">
    <span class="x-paper x-board"><img src="${board.uri}" alt="${e(board.alt)}"></span>
    <span class="x-paper x-sheet"><img src="${sheet.uri}" alt="${e(sheet.alt)}"></span>
    <figcaption>${e(C.materialLabel)}</figcaption>
  </figure>
</section>
<section class="x-offer">
  <p class="x-main"><span class="x-free">無料</span>特別講義</p>
  <p class="x-gift">${e(C.offerSub)}</p>
  ${cta('x-cta')}
</section>
${reviewNote}`;
const A2_CSS = `
body[data-variant="a2"]{--x-navy:#0b1f5c;--x-blue:#1d4ed8;--x-text:#1f2a44;--x-mute:#4a5670;--x-rule:#d7e0f0;background:#fff}
.x-top{padding:12px 16px 10px;border-bottom:1px solid var(--x-rule)}
.x-brand{display:block;font-size:13px;font-weight:700;letter-spacing:.16em;color:var(--x-blue);line-height:1.2}
.x-target{margin:4px 0 0;font-size:18px;font-weight:700;color:var(--x-navy);letter-spacing:.02em;line-height:1.35;padding-left:10px;border-left:4px solid var(--x-blue)}
.x-hero{position:relative;height:350px;overflow:hidden;background:#fff}
.x-copy{position:absolute;z-index:3;left:16px;top:16px;width:230px}
.x-cred{margin:0;font-size:16px;font-weight:600;color:var(--x-blue);letter-spacing:.02em}
.x-title{margin:4px 0 0;font-size:50px;line-height:1.08;font-weight:900;letter-spacing:-.02em;color:var(--x-navy)}
.x-title span{display:block;white-space:nowrap}.x-title .x-accent{color:var(--x-blue)}
.x-sub{margin:10px 0 0;font-size:16px;font-weight:500;line-height:1.6;color:var(--x-text)}
.x-sub .nb{display:block}
/* 写真の濃紺の背景を、斜めに切った面としてそのまま背景につなぐ（白地に矩形写真を貼らない） */
.x-panel{position:absolute;z-index:1;right:0;top:0;bottom:0;width:46%;overflow:hidden;background:linear-gradient(90deg,#0c2f8e 0%,#0b2672 45%,#0e1a45 80%,#13151d 100%);clip-path:polygon(22% 0,100% 0,100% 100%,0 100%)}
.x-photo{position:absolute;right:-70px;bottom:0;height:300px;margin:0;aspect-ratio:656/585;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 28px);mask-image:linear-gradient(180deg,transparent 0,#000 28px)}
.x-photo img{width:100%;height:100%;object-fit:cover}
.x-sign{position:absolute;z-index:4;right:14px;top:12px;margin:0;font-size:15px;font-weight:600;color:#fff;letter-spacing:.06em}
.x-sign span{font-size:13px;font-weight:500;margin-right:8px;opacity:.85}
.x-mats{position:absolute;z-index:3;left:16px;bottom:14px;width:214px;height:118px;margin:0}
.x-paper{position:absolute;background:#fff;padding:3px;border:1px solid var(--x-rule);box-shadow:0 2px 6px rgba(11,31,92,.14)}
.x-paper img{width:100%;height:100%;object-fit:cover;object-position:0 0}
.x-board{left:0;top:0;width:112px;height:96px;transform:rotate(-1.5deg)}
.x-sheet{left:96px;top:4px;width:112px;height:96px;transform:rotate(1.5deg)}
.x-mats figcaption{position:absolute;left:0;bottom:-2px;font-size:13px;font-weight:500;color:var(--x-mute);white-space:nowrap}
.x-offer{padding:12px 16px 18px;border-top:1px solid var(--x-rule);text-align:center}
.x-main{margin:0;font-size:38px;font-weight:900;line-height:1.15;color:var(--x-navy);letter-spacing:-.01em}
.x-free{color:var(--x-blue)}
.x-gift{margin:4px 0 12px;font-size:15px;font-weight:500;color:var(--x-mute)}
body[data-variant="a2"] .cta{background:var(--line);box-shadow:none;border-radius:12px;min-height:60px;font-size:19px;font-weight:700}
body[data-variant="a2"] .cta:hover{background:#05b84e}
body[data-variant="a2"] .cta:active{background:var(--line-d)}
body[data-variant="a2"] .cta:focus-visible{outline:3px solid var(--x-navy);outline-offset:3px;box-shadow:none}
@media (max-width:389px){
.x-sign{right:12px;display:flex;flex-direction:column;align-items:flex-end;line-height:1.3}
.x-sign span{margin:0}
body[data-variant="a2"] .cta{font-size:17px}
}
@media (min-width:900px){
.x-top{display:flex;align-items:baseline;gap:20px;padding:14px max(24px,calc((100% - 1160px)/2))}
.x-target{margin:0;font-size:22px}
.x-hero{height:460px}
.x-copy{left:max(24px,calc((100% - 1160px)/2));top:34px;width:720px}
.x-cred{font-size:22px}.x-title{font-size:80px}.x-title span{display:inline-block;margin-right:.2em}.x-sub{font-size:22px;margin-top:16px}.x-sub .nb{display:inline}
.x-panel{width:46%}
.x-photo{right:-40px;height:100%;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 120px);mask-image:linear-gradient(90deg,transparent 0,#000 120px)}
.x-mats{left:max(24px,calc((100% - 1160px)/2));bottom:30px;width:420px;height:150px}
.x-board{width:190px;height:122px}.x-sheet{left:176px;width:190px;height:122px}
.x-mats figcaption{left:0;bottom:-24px}
.x-sign{right:max(24px,calc((100% - 1160px)/2));top:20px;font-size:20px}
.x-offer{display:grid;grid-template-columns:auto minmax(0,440px);justify-content:center;align-items:center;column-gap:48px;padding:22px;text-align:left}
.x-gift{grid-column:1;margin:4px 0 0}.x-offer .cta{grid-column:2;grid-row:1/3}
}`;

// ---- 案A3（未公開のレビュー稿）: 白〜ウォームグレーの一続きの背景に、透過の本人写真と教材を同じ光で置く。仮置きの数値バッジを含む ----
const portrait = asset('portrait');
const A3 = () => `
<div class="s-stage">
<header class="s-top"><span class="s-brand">${e(C.brand)}</span><p class="s-target">${e(C.target)}</p></header>
<section class="s-hero" aria-label="ファーストビュー">
  <div class="s-copy">
    <p class="s-cred">${e(C.credential)}</p>
    <h1 class="s-title"><span class="s-t1">共テ数学</span><span class="s-t2">特別講義</span></h1>
    <p class="s-sub">${phrases(C.subA)}</p>
  </div>
  <figure class="s-person"><img src="${portrait.uri}" alt="${e(portrait.alt)}" width="1330" height="1183"></figure>
  <p class="s-sign"><span>${e(C.instructorRole)}</span>${e(C.instructorName)}</p>
  <figure class="s-mats" aria-label="${e(C.materialLabel)}">
    <span class="s-paper s-board"><img src="${board.uri}" alt="${e(board.alt)}"></span>
    <span class="s-paper s-sheet"><img src="${sheet.uri}" alt="${e(sheet.alt)}"></span>
    <figcaption>${e(C.materialLabel)}</figcaption>
  </figure>
</section>
</div>
<section class="s-offer">
  <div class="s-badge" role="img" aria-label="${e(C.badgeLabel)} ${e(C.badgeValue + C.badgeUnit)}（${e(C.badgeNote.join('・').replace(/^※/, ''))}）">
    <span class="s-medal" aria-hidden="true"><span class="s-ml">${e(C.badgeLabel)}</span><span class="s-mv">${e(C.badgeValue)}<small>${e(C.badgeUnit)}</small></span></span>
    <span class="s-note" aria-hidden="true">${C.badgeNote.map((x) => `<span>${e(x)}</span>`).join('')}</span>
  </div>
  <p class="s-main"><span class="s-free">無料</span>特別講義</p>
  <p class="s-gift">${e(C.offerSub)}</p>
  ${cta('s-cta')}
</section>
<aside class="review" id="cta-note" role="note"><b>未公開のレビュー稿（案A3）</b>：バッジの「${e(C.badgeLabel)} ${e(C.badgeValue + C.badgeUnit)}」はユーザー指定の<b>仮置きの数値で、実績集計は未確認</b>（公開・本番反映はしない）。「${e(C.ctaLabel)}」は${e(C.ctaNote)}。LINE の実 URL は未確認。講師写真はユーザー提供のレタッチ済み透過写真、板書・配布テキストは現行 LP の画像から必要な範囲だけを切り出したもの（出典は REVIEW.md）。</aside>`;
const A3_CSS = `
body[data-variant="a3"]{--s-ink:#111111;--s-text:#2b2b2b;--s-mute:#5b5650;--s-blue:#1d4ed8;--s-blue-d:#1739a6;--s-shadow:rgba(64,52,40,.20);background:#fff}
/* 一続きのスタジオ背景（上: 白 → 下: 明るいウォームグレー）。光は左上から、影は右下へ統一 */
.s-stage{background:radial-gradient(120% 90% at 68% 28%,#ffffff 0%,#fbfaf8 38%,#f1eee9 72%,#e8e3dc 100%)}
.s-top{padding:12px 16px 0}
.s-brand{display:block;font-size:13px;font-weight:700;letter-spacing:.16em;color:var(--s-blue);line-height:1.2}
.s-target{margin:3px 0 0;font-size:17px;font-weight:700;color:var(--s-ink);letter-spacing:.04em;line-height:1.35}
.s-hero{position:relative;height:362px;overflow:hidden}
.s-copy{position:absolute;z-index:3;left:16px;top:16px}
.s-cred{margin:0;font-size:15px;font-weight:700;color:var(--s-blue);letter-spacing:.06em}
.s-title{margin:6px 0 0;font-weight:900;color:var(--s-ink);line-height:1}
.s-title span{display:block;white-space:nowrap}
.s-t1{font-size:54px;letter-spacing:-.03em}
.s-t2{margin-top:6px;font-size:39px;letter-spacing:.02em}
.s-sub{margin:12px 0 0;font-size:15px;font-weight:500;line-height:1.65;color:var(--s-text);letter-spacing:.02em}
.s-sub .nb{display:block}
/* 透過写真: 縦横比 1330:1183 のまま等倍率で縮小（切り抜きなし・変形なし）。下端はヒーローの下端にそろえる */
.s-person{position:absolute;z-index:1;right:-78px;bottom:0;height:332px;margin:0;aspect-ratio:1330/1183}
.s-person img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(8px 6px 14px var(--s-shadow))}
.s-sign{position:absolute;z-index:4;right:14px;top:10px;margin:0;font-size:14px;font-weight:700;color:var(--s-ink);letter-spacing:.06em}
.s-sign span{font-size:13px;font-weight:500;margin-right:6px;color:var(--s-mute)}
.s-mats{position:absolute;z-index:2;left:14px;bottom:20px;width:212px;height:122px;margin:0}
.s-paper{position:absolute;background:#fff;padding:3px;box-shadow:5px 7px 14px var(--s-shadow),0 0 0 1px rgba(64,52,40,.06)}
.s-paper img{width:100%;height:100%;object-fit:cover;object-position:0 0}
.s-board{left:0;top:6px;width:114px;height:98px;transform:rotate(-2deg)}
.s-sheet{left:94px;top:0;width:114px;height:98px;transform:rotate(1.5deg)}
.s-mats figcaption{position:absolute;z-index:1;left:0;bottom:-8px;font-size:13px;font-weight:500;color:var(--s-text);white-space:nowrap;background:rgba(251,250,248,.92);padding:1px 8px 1px 2px;border-radius:0 4px 4px 0}
/* 青の無料オファー面。バッジは面の右上にまたがせ、仮置きの注記をすぐ下に焼き込む */
.s-offer{position:relative;background:linear-gradient(180deg,var(--s-blue) 0%,var(--s-blue-d) 100%);padding:12px 16px 16px;color:#fff}
.s-badge{position:absolute;z-index:5;right:8px;top:-62px;width:96px;display:flex;flex-direction:column;align-items:center}
.s-medal{width:96px;height:96px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at 35% 30%,#fffdf6 0%,#f7ecd0 55%,#e7d3a1 100%);box-shadow:inset 0 0 0 3px #c8a24e,inset 0 0 0 6px #fffaf0,inset 0 0 0 7px rgba(200,162,78,.55),5px 7px 14px var(--s-shadow);color:#3b2f17}
.s-ml{font-size:13px;font-weight:700;letter-spacing:-.02em;line-height:1.1}
.s-mv{font-size:25px;font-weight:900;line-height:1.05;letter-spacing:-.02em}.s-mv small{font-size:14px;font-weight:700;margin-left:1px}
.s-note{margin-top:4px;display:flex;flex-direction:column;align-items:center;font-size:13px;font-weight:700;line-height:1.3;color:#fff;letter-spacing:.02em}
.s-main{margin:0;font-size:36px;font-weight:900;line-height:1.15;letter-spacing:.01em}
.s-free{display:inline-block;background:#fff;color:var(--s-blue);border-radius:6px;padding:0 6px;margin-right:6px;line-height:1.15}
.s-gift{margin:6px 0 14px;font-size:15px;font-weight:500;color:#e6ecff;letter-spacing:.02em}
body[data-variant="a3"] .cta{background:var(--line);box-shadow:0 3px 0 #04913d;border-radius:12px;min-height:60px;font-size:19px;font-weight:700}
body[data-variant="a3"] .cta:active{background:var(--line-d);box-shadow:none;transform:translateY(2px)}
body[data-variant="a3"] .cta:focus-visible{outline:3px solid #fff;outline-offset:3px}
@media (max-width:389px){
.s-t1{font-size:49px}.s-t2{font-size:35px}
.s-person{height:308px;right:-74px}
.s-gift{font-size:14px}
body[data-variant="a3"] .cta{font-size:17px}
}
@media (min-width:900px){
.s-top{display:flex;align-items:baseline;gap:20px;padding:16px max(24px,calc((100% - 1160px)/2)) 0}
.s-target{margin:0;font-size:22px}
.s-hero{height:500px;max-width:1160px;margin:0 auto}
.s-copy{left:24px;top:34px}
.s-cred{font-size:22px}.s-t1{font-size:96px}.s-t2{font-size:68px;margin-top:10px}.s-sub{font-size:22px;margin-top:18px}.s-sub .nb{display:inline}
.s-person{right:40px;height:480px}
.s-sign{right:24px;top:20px;font-size:20px}.s-sign span{font-size:16px}
.s-mats{left:24px;bottom:34px;width:440px;height:150px}
.s-board{width:200px;height:124px}.s-sheet{left:186px;width:200px;height:124px}
.s-mats figcaption{bottom:-26px}
.s-offer{display:grid;grid-template-columns:auto minmax(0,440px) 120px;justify-content:center;align-items:center;column-gap:40px;padding:22px}
.s-main,.s-gift{grid-column:1}.s-main{align-self:end;font-size:40px}.s-gift{margin:6px 0 0;align-self:start}.s-offer .cta{grid-column:2;grid-row:1/3}
.s-badge{position:static;grid-column:3;grid-row:1/3}.s-note{color:#fff}
}`;

// ---- 案A4（未公開のレビュー稿）: 減光した実教材を背景に敷いた1枚の濃紺グラフィック。白い極太の講座名 → 本人/教材 → 無料オファー → 単一の緑 CTA。人物あり(a4p)/なし(a4n) ----
const A4 = (withPerson) => `
<div class="f-stage${withPerson ? ' f-with' : ' f-without'}">
  <div class="f-bg" aria-hidden="true"><img class="f-bg1" src="${board.uri}" alt=""><img class="f-bg2" src="${sheet.uri}" alt=""></div>
  <header class="f-top"><span class="f-brand">${e(C.brand)}</span><p class="f-target">${e(C.target)}</p></header>
  <section class="f-hero" aria-label="ファーストビュー">
    <p class="f-cred">${e(C.credential)}</p>
    <h1 class="f-title"><span>共テ数学</span><span>特別講義</span></h1>
    <p class="f-sub">${phrases(C.subA)}</p>
    ${withPerson ? `<figure class="f-person"><img src="${portrait.uri}" alt="${e(portrait.alt)}" width="1330" height="1183"></figure>` : ''}
    <figure class="f-mats" aria-label="${e(C.materialLabel)}">
      <span class="f-paper f-board"><img src="${board.uri}" alt="${e(board.alt)}"></span>
      <span class="f-paper f-sheet"><img src="${sheet.uri}" alt="${e(sheet.alt)}"></span>
      <figcaption>${e(C.materialLabel)}</figcaption>
    </figure>
    <p class="f-sign"><span class="f-role">${e(C.instructorRole)}</span><span class="f-nm">${e(C.instructorName)}</span></p>
    <div class="f-badge" role="img" aria-label="${e(C.badgeLabel)} ${e(C.badgeValue + C.badgeUnit)}（${e(C.badgeNote.join('・').replace(/^※/, ''))}）">
      <span class="f-medal" aria-hidden="true"><span class="f-ml">${e(C.badgeLabel)}</span><span class="f-mv">${e(C.badgeValue)}<small>${e(C.badgeUnit)}</small></span></span>
      <span class="f-note" aria-hidden="true">${C.badgeNote.map((x) => `<span>${e(x)}</span>`).join('')}</span>
    </div>
  </section>
  <section class="f-offer">
    <p class="f-main"><span class="f-free">無料</span>特別講義</p>
    <p class="f-gift">${e(C.offerSub)}</p>
    ${cta('f-cta')}
  </section>
</div>
<aside class="review" id="cta-note" role="note"><b>未公開のレビュー稿（案A4・${withPerson ? '人物あり' : '人物なし'}）</b>：バッジの「${e(C.badgeLabel)} ${e(C.badgeValue + C.badgeUnit)}」はユーザー指定の<b>仮置きの数値で、実績集計は未確認</b>（公開・本番反映はしない）。構図は参照 LP の考え方（減光した実物の背景・白い極太見出し・単一 CTA）に沿うが、参照の作字・ロゴ・実績・作品・人物は使っていない。「${e(C.ctaLabel)}」は${e(C.ctaNote)}。LINE の実 URL は未確認。${withPerson ? '講師写真はユーザー提供のレタッチ済み透過写真。' : ''}板書・配布テキストは現行 LP の画像から必要な範囲だけを切り出したもの（出典は REVIEW.md）。</aside>`;
const A4_CSS = `
body[data-variant^="a4"]{--f-ink:#0d1a22;--f-navy:#193c51;--f-blue:#3294c1;--f-pale:#ebf7fb;background:#0d1a22}
.f-stage{position:relative;overflow:hidden;background:#0d1a22;color:#fff}
/* 背景: 現行の板書・配布テキスト（2点だけ）を大きく敷き、ぼかして減光。文字の邪魔をしない */
.f-bg{position:absolute;inset:0;z-index:0}
.f-bg img{position:absolute;max-width:none;opacity:.5;filter:grayscale(.35) blur(1.5px)}
.f-bg1{left:-40px;top:-20px;width:300px;transform:rotate(-6deg)}
.f-bg2{right:-60px;top:150px;width:300px;transform:rotate(5deg)}
.f-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(13,26,34,.80) 0%,rgba(25,60,81,.80) 45%,rgba(13,26,34,.93) 78%,#0d1a22 100%)}
.f-top,.f-hero,.f-offer{position:relative;z-index:1}
.f-top{padding:12px 22px 0}
.f-brand{display:block;font-size:13px;font-weight:700;letter-spacing:.18em;color:#9fd3ea;line-height:1.2}
.f-target{margin:3px 0 0;font-size:16px;font-weight:700;color:#fff;letter-spacing:.04em;line-height:1.35}
.f-hero{position:relative;padding:0 22px}
.f-cred{margin:12px 0 0;font-size:15px;font-weight:700;color:#9fd3ea;letter-spacing:.08em}
.f-title{position:relative;z-index:3;margin:4px 0 0;font-weight:900;line-height:1.02;letter-spacing:-.04em;color:#fff;-webkit-text-stroke:1.2px #fff;text-shadow:0 4px 0 rgba(0,0,0,.35),0 10px 24px rgba(0,0,0,.45)}
.f-title span{display:block;white-space:nowrap}
.f-sub{position:relative;z-index:3;margin:10px 0 0;font-size:15px;font-weight:500;line-height:1.6;color:var(--f-pale);letter-spacing:.03em}
.f-paper{position:absolute;background:#fff;padding:3px;box-shadow:6px 10px 20px rgba(0,0,0,.5)}
.f-paper img{width:100%;height:100%;object-fit:cover;object-position:0 0}
.f-mats{position:absolute;z-index:2;margin:0}
.f-mats figcaption{position:absolute;left:0;font-size:13px;font-weight:500;color:var(--f-pale);white-space:nowrap}
.f-sign{position:absolute;z-index:3;margin:0;display:flex;flex-wrap:wrap;align-items:baseline;column-gap:6px;color:#fff;font-weight:700}
.f-role{font-size:13px;font-weight:500;color:#9fd3ea}.f-nm{font-size:16px;letter-spacing:.06em}.f-cr{font-size:13px;font-weight:500;color:var(--f-pale)}
.f-badge{position:absolute;z-index:4;width:88px;display:flex;flex-direction:column;align-items:center}
.f-medal{width:88px;height:88px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at 35% 30%,#fffdf6 0%,#f4e7c6 55%,#dcc48a 100%);box-shadow:inset 0 0 0 3px #c39a45,inset 0 0 0 5px #fffaf0,inset 0 0 0 6px rgba(195,154,69,.55),4px 8px 16px rgba(0,0,0,.5);color:#3b2f17}
.f-ml{font-size:12px;font-weight:700;letter-spacing:-.03em;line-height:1.1}
.f-mv{font-size:23px;font-weight:900;line-height:1.05;letter-spacing:-.02em}.f-mv small{font-size:13px;font-weight:700;margin-left:1px}
.f-note{margin-top:4px;display:flex;flex-direction:column;align-items:center;font-size:13px;font-weight:700;line-height:1.3;color:#fff;background:rgba(13,26,34,.78);padding:2px 6px;border-radius:4px}
.f-offer{padding:0 22px 22px}
.f-main{margin:0;font-size:34px;font-weight:900;line-height:1.15;letter-spacing:.01em}
.f-free{display:inline-block;background:var(--f-blue);color:#fff;border-radius:6px;padding:0 7px;margin-right:6px}
.f-gift{margin:4px 0 12px;font-size:15px;font-weight:500;color:var(--f-pale);letter-spacing:.02em}
body[data-variant^="a4"] .cta{background:var(--line);box-shadow:0 4px 0 #04913d,0 10px 24px rgba(6,199,85,.25);border-radius:12px;min-height:66px;font-size:19px;font-weight:900}
body[data-variant^="a4"] .cta:active{background:var(--line-d);box-shadow:none;transform:translateY(3px)}
body[data-variant^="a4"] .cta:focus-visible{outline:3px solid #fff;outline-offset:3px}
body[data-variant^="a4"] .review{background:#f4f7f9}
/* 人物あり: タイトルの下に頭を置き、顔とタイトルを重ねない。教材は左で腕の手前 */
.f-with .f-hero{height:420px}
.f-with .f-title{font-size:74px}
.f-with .f-sub{margin-top:12px;font-size:26px;font-weight:900;line-height:1.28;color:#fff;letter-spacing:.01em}.f-with .f-sub .nb{display:block}
.f-person{position:absolute;z-index:1;right:-66px;bottom:0;height:240px;margin:0;aspect-ratio:1330/1183}
.f-person::before{content:"";position:absolute;inset:18% 4% -10% 8%;background:radial-gradient(closest-side,rgba(50,148,193,.45),rgba(50,148,193,0));z-index:-1}
.f-person img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(6px 10px 18px rgba(0,0,0,.55))}
.f-with .f-mats{left:18px;top:272px;width:196px;height:112px}
.f-with .f-board{left:0;top:6px;width:104px;height:92px;transform:rotate(-3deg)}
.f-with .f-sheet{left:86px;top:0;width:104px;height:92px;transform:rotate(2deg)}
.f-with .f-mats figcaption{top:102px}
.f-with .f-sign{left:22px;bottom:6px;flex-wrap:nowrap}
.f-with .f-badge{right:10px;bottom:-20px}
.f-with .f-offer{padding-top:8px}
/* 人物なし: タイトルをさらに大きく、教材を前景の主役に。講師名と肩書は残す */
.f-without .f-hero{height:398px}
.f-without .f-title{font-size:86px}
.f-without .f-sub .nb{display:inline}
.f-without .f-mats{left:22px;top:276px;width:250px;height:118px}
.f-without .f-board{left:0;top:4px;width:128px;height:96px;transform:rotate(-3deg)}
.f-without .f-sheet{left:112px;top:0;width:128px;height:96px;transform:rotate(2deg)}
.f-without .f-mats figcaption{top:102px}
.f-without .f-sign{left:22px;top:244px}
.f-without .f-badge{right:14px;top:262px}
.f-without .f-offer{padding-top:12px}
@media (max-width:389px){
.f-with .f-title{font-size:67px}.f-without .f-title{font-size:78px}
.f-person{height:226px;right:-70px}
.f-with .f-sub{font-size:23px}
.f-with .f-mats{transform:scale(.92);transform-origin:0 0}
.f-without .f-mats{transform:scale(.9);transform-origin:0 0}
.f-main{font-size:31px}.f-gift{font-size:14px}
body[data-variant^="a4"] .cta{font-size:17px;padding:0 12px;gap:8px;letter-spacing:0}
.f-nm{font-size:15px}.f-sign{column-gap:5px}
}
@media (min-width:900px){
.f-top{display:flex;align-items:baseline;gap:20px;padding:18px max(24px,calc((100% - 1160px)/2)) 0}
.f-target{margin:0;font-size:22px}
.f-bg1{left:4%;top:-40px;width:560px}.f-bg2{right:6%;top:60px;width:560px}
.f-hero{max-width:1160px;margin:0 auto;padding:0 24px}
.f-with .f-hero,.f-without .f-hero{height:470px}
.f-cred{font-size:22px;margin-top:22px}
.f-with .f-title,.f-without .f-title{font-size:120px}.f-title span{display:inline-block;margin-right:.12em}
.f-sub .nb,.f-with .f-sub .nb{display:inline}.f-sub{font-size:22px;margin-top:16px}
.f-with .f-sub{font-size:22px;font-weight:500;line-height:1.6;color:var(--f-pale);margin-top:16px;letter-spacing:.03em}
.f-person{right:24px;height:430px}
.f-with .f-mats,.f-without .f-mats{left:24px;top:300px;width:420px;height:140px}
.f-with .f-board,.f-without .f-board{width:190px;height:120px}.f-with .f-sheet,.f-without .f-sheet{left:170px;width:190px;height:120px}
.f-with .f-mats figcaption,.f-without .f-mats figcaption{top:132px}
.f-with .f-sign,.f-without .f-sign{left:420px;top:auto;bottom:40px;max-width:none}
.f-with .f-badge{right:420px;bottom:20px}.f-without .f-badge{right:auto;left:760px;top:auto;bottom:34px;transform:scale(1.2);transform-origin:50% 100%}
.f-offer{display:grid;grid-template-columns:auto minmax(0,460px);justify-content:center;align-items:center;column-gap:48px;padding:20px 24px 30px;max-width:1160px;margin:0 auto}
.f-main,.f-gift{grid-column:1}.f-main{align-self:end;font-size:40px}.f-gift{margin:6px 0 0;align-self:start}.f-offer .cta{grid-column:2;grid-row:1/3}
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
writeFileSync(join(root, 'out/passlabo-fv-a2.html'), page('a2', 'PASSLABO FV 案A 磨き直し（確認用）', A2(), A2_CSS));
console.log('out/passlabo-fv-a.html, out/passlabo-fv-b.html, out/passlabo-fv-a2.html（現行 LP 由来の素材を内包）');
writeFileSync(join(root, 'out/passlabo-fv-a3.html'), page('a3', 'PASSLABO FV 案A3（未公開レビュー稿・仮置き数値あり）', A3(), A3_CSS));
console.log('out/passlabo-fv-a3.html（未公開レビュー稿。バッジの数値は仮置き）');
writeFileSync(join(root, 'out/passlabo-fv-a4p.html'), page('a4p', 'PASSLABO FV 案A4 人物あり（未公開レビュー稿・仮置き数値あり）', A4(true), A4_CSS));
writeFileSync(join(root, 'out/passlabo-fv-a4n.html'), page('a4n', 'PASSLABO FV 案A4 人物なし（未公開レビュー稿・仮置き数値あり）', A4(false), A4_CSS));
console.log('out/passlabo-fv-a4p.html・out/passlabo-fv-a4n.html（未公開レビュー稿。バッジの数値は仮置き）');
