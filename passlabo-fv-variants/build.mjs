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

// ---- 素材（無ければ「差し替え待ち」の枠。架空の写真は入れない） ----
function asset(key, label) {
  const a = C.assets[key];
  const f = a.file && join(root, 'assets', a.file);
  if (f && existsSync(f)) {
    const ext = a.file.split('.').pop().toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext];
    return { uri: `data:${mime};base64,${readFileSync(f).toString('base64')}`, alt: a.alt, real: true };
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" preserveAspectRatio="none"><rect width="300" height="300" fill="#e9edf3"/><rect x="4" y="4" width="292" height="292" fill="none" stroke="#9aa6b8" stroke-width="3" stroke-dasharray="10 8"/></svg>`;
  return { uri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, alt: `差し替え待ち: ${label}`, real: false, label };
}
const photo = asset('instructor', '講師写真（現行ページ）');
const material = asset('material', '板書・教材見本（現行ページ）');
const ph = (a) => (a.real ? '' : `<span class="ph-label">差し替え待ち<br>${e(a.label)}</span>`);

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
const reviewNote = `<aside class="review" id="cta-note" role="note"><b>レビュー用の確認 HTML</b>：「${e(C.ctaLabel)}」は${e(C.ctaNote)}。LINE の実 URL は未確認。講師写真・板書は現行ページ由来（出典は REVIEW.md）。</aside>`;
const phrases = (arr) => arr.map((p) => `<span class="nb">${e(p)}</span>`).join('');

const BASE_CSS = `
:root{--navy:#0f2a5c;--blue:#1d4ed8;--ink:#111827;--sub:#374151;--paper:#f5f7fb;--line:#06c755;--line-d:#05a948;--yellow:#ffd23f}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:var(--ink);font-family:"PL Sans","Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif;font-feature-settings:"palt";line-height:1.4}
.nb{display:inline-block}
img{display:block;max-width:100%}
.cta{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:64px;padding:0 20px;border-radius:999px;background:linear-gradient(180deg,#14d468,var(--line) 55%,var(--line-d));color:#fff;font-weight:900;font-size:20px;letter-spacing:.02em;box-shadow:0 6px 0 #04913d,0 10px 22px rgba(6,199,85,.32);cursor:pointer;text-align:center}
.cta:focus-visible{outline:3px solid var(--navy);outline-offset:3px}
.cta .ico{width:28px;height:28px;flex:none}.cta .chev{width:18px;height:18px;flex:none;margin-left:2px}
.ph-label{position:absolute;inset:0;display:grid;place-items:center;text-align:center;font-size:13px;font-weight:700;color:#5b6577;line-height:1.5;padding:8px}
.review{margin:28px 16px 40px;padding:12px 14px;border:2px dashed #9aa6b8;border-radius:8px;font-size:13px;line-height:1.7;color:#374151;background:#fafbfc}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

// ---- 案A: 商品名 → 講師本人 → 教材の具体物 → 無料オファー → CTA（参考の主従を、事実の範囲で） ----
const A = () => `
<header class="a-band"><p>${phrases(['時間が足りない・', '点数が伸びない人へ'])}</p></header>
<section class="a-hero" aria-label="ファーストビュー">
  <div class="a-copy">
    <p class="a-subject">${e(C.subject)}</p>
    <h1 class="a-title">${e(C.product)}</h1>
    <p class="a-change">${phrases(C.changePhrases)}</p>
  </div>
  <figure class="a-photo"><img src="${photo.uri}" alt="${e(photo.alt)}">${ph(photo)}</figure>
  <p class="a-name" aria-label="${e(C.instructorRole)} ${e(C.instructorName)}"><span class="a-role">${e(C.instructorRole)}</span>${e(C.instructorName)}</p>
  <figure class="a-material"><img src="${material.uri}" alt="${e(material.alt)}">${ph(material)}<figcaption>${e(C.materialLabel)}</figcaption></figure>
</section>
<section class="a-offer">
  <p class="a-strip"><span class="a-chip">受講料</span><span class="a-zero">0<small>円</small></span><span class="a-via">${phrases(C.offerVia)}</span></p>
  ${cta()}
</section>
${reviewNote}`;
const A_CSS = `
.a-band{background:linear-gradient(90deg,var(--navy),var(--blue));color:#fff;text-align:center;padding:10px 12px}
.a-band p{margin:0;font-size:17px;font-weight:900;letter-spacing:.02em}
.a-hero{position:relative;display:grid;grid-template-columns:58% 42%;grid-template-areas:"copy photo" "mat photo";background:linear-gradient(115deg,var(--paper) 0 62%,#dfe7f4 62% 100%);min-height:388px;overflow:hidden}
.a-copy{grid-area:copy;padding:18px 0 0 16px;position:relative;z-index:2}
.a-subject{margin:0;font-size:27px;font-weight:900;color:var(--blue);letter-spacing:-.01em;white-space:nowrap}
.a-title{margin:2px 0 0;font-size:50px;line-height:1.08;font-weight:900;letter-spacing:-.03em;color:var(--ink);white-space:nowrap}
.a-change{margin:10px 0 0;font-size:18px;font-weight:700;line-height:1.5;color:var(--sub)}
.a-photo{grid-area:photo;position:relative;margin:0;align-self:end;justify-self:end;width:100%;height:330px;z-index:1}
.a-photo img{width:100%;height:100%;object-fit:cover;object-position:50% 20%}
.a-name{position:absolute;z-index:3;right:calc(42% - 22px);bottom:20px;margin:0;writing-mode:vertical-rl;background:var(--navy);color:#fff;font-size:22px;font-weight:900;letter-spacing:.12em;padding:12px 7px}
.a-role{color:var(--yellow);font-size:15px;margin-bottom:8px}
.a-material{grid-area:mat;position:relative;margin:12px 0 18px 16px;width:calc(100% - 26px);height:150px;transform:rotate(-2.5deg);background:#fff;padding:6px;box-shadow:0 8px 18px rgba(15,42,92,.22);z-index:2;align-self:end}
.a-material img{width:100%;height:calc(100% - 22px);object-fit:cover}
.a-material figcaption{font-size:12px;font-weight:700;color:var(--sub);text-align:center;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.a-offer{background:linear-gradient(90deg,var(--navy),#163a7a);padding:14px 16px 20px}
.a-strip{margin:0 0 14px;display:flex;align-items:center;justify-content:center;gap:10px;color:#fff}
.a-chip{background:var(--yellow);color:var(--navy);font-weight:900;font-size:16px;padding:4px 10px;border-radius:4px}
.a-zero{font-size:44px;font-weight:900;line-height:1;color:var(--yellow);letter-spacing:-.02em}.a-zero small{font-size:22px;margin-left:2px}
.a-via{font-size:18px;font-weight:900;line-height:1.3}
@media (min-width:900px){
.a-band p{font-size:24px}.a-band{padding:14px}
.a-hero{max-width:none;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr) minmax(0,.8fr);grid-template-areas:"copy mat photo";min-height:470px;padding:0 max(24px,calc((100% - 1160px)/2));background:linear-gradient(115deg,var(--paper) 0 66%,#dfe7f4 66% 100%)}
.a-copy{padding:40px 0 0 0}.a-subject{font-size:40px}.a-title{font-size:84px}.a-change{font-size:24px;margin-top:18px}
.a-material{height:250px;margin:0 24px 46px 0;width:auto}
.a-photo{height:440px}.a-name{right:calc(max(24px,(100% - 1160px)/2) + 0px);font-size:28px}
.a-offer{display:grid;grid-template-columns:auto minmax(0,460px);justify-content:center;align-items:center;gap:40px;padding:22px}
.a-strip{margin:0}
}`;

// ---- 案B: 悩み → 変化 → 板書（具体物）＋講師本人 → 商品名と無料 → CTA（悩みから入る縦の流れ） ----
const B = () => `
<header class="b-top"><span class="b-brand">${e(C.brand)}</span><span class="b-subject">${e(C.subject)}</span></header>
<section class="b-hero" aria-label="ファーストビュー">
  <ul class="b-pains">${C.pains.map((p) => `<li>${e(p)}</li>`).join('')}</ul>
  <p class="b-arrow" aria-hidden="true"></p>
  <h1 class="b-change">${phrases(C.changePhrases)}</h1>
  <div class="b-stage">
    <figure class="b-material"><img src="${material.uri}" alt="${e(material.alt)}">${ph(material)}<figcaption>${e(C.materialLabel)}</figcaption></figure>
    <figure class="b-photo"><img src="${photo.uri}" alt="${e(photo.alt)}">${ph(photo)}<figcaption><span>${e(C.instructorRole)}</span>${e(C.instructorName)}</figcaption></figure>
  </div>
</section>
<section class="b-offer">
  <p class="b-product"><span class="b-free">無料</span>${e(C.subject)}<br><b>${e(C.product)}</b></p>
  ${cta()}
</section>
${reviewNote}`;
const B_CSS = `
.b-top{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:var(--navy);color:#fff}
.b-brand{font-weight:900;font-size:16px;letter-spacing:.08em}.b-subject{font-size:15px;font-weight:900;background:#fff;color:var(--navy);padding:3px 10px;border-radius:999px}
.b-hero{background:linear-gradient(180deg,#fff,var(--paper));padding:14px 16px 0}
.b-pains{list-style:none;margin:0;padding:0;display:flex;gap:8px;justify-content:center}
.b-pains li{font-size:18px;font-weight:900;color:#9f1239;background:#fff1f2;border:2px solid #fecdd3;border-radius:8px;padding:6px 10px;position:relative}
.b-pains li::before{content:"×";margin-right:6px;color:#e11d48}
.b-arrow{width:0;height:0;margin:8px auto 6px;border-left:14px solid transparent;border-right:14px solid transparent;border-top:14px solid var(--blue)}
.b-change{margin:0;text-align:center;font-size:40px;line-height:1.18;font-weight:900;letter-spacing:-.03em;color:var(--ink)}
.b-stage{position:relative;margin-top:12px;height:206px}
.b-material{position:absolute;left:0;top:0;width:76%;height:184px;margin:0;background:#fff;padding:6px;box-shadow:0 8px 18px rgba(15,42,92,.18)}
.b-material img{width:100%;height:calc(100% - 22px);object-fit:cover}
.b-material figcaption{font-size:12px;font-weight:700;color:var(--sub);text-align:center;margin-top:3px}
.b-photo{position:absolute;right:-16px;bottom:0;width:44%;height:206px;margin:0;background:#dfe7f4}
.b-photo img{width:100%;height:100%;object-fit:cover;object-position:50% 20%}
.b-photo figcaption{position:absolute;left:-10px;bottom:10px;background:var(--navy);color:#fff;font-weight:900;font-size:18px;padding:4px 10px;letter-spacing:.06em}
.b-photo figcaption span{color:var(--yellow);font-size:13px;margin-right:6px}
.b-offer{background:var(--navy);padding:14px 16px 20px}
.b-product{margin:0 0 14px;color:#fff;text-align:center;font-size:20px;font-weight:900;line-height:1.25}
.b-product b{font-size:36px;letter-spacing:-.02em}
.b-free{display:inline-block;background:var(--yellow);color:var(--navy);font-size:18px;padding:2px 10px;border-radius:4px;margin-right:8px;vertical-align:3px}
@media (min-width:900px){
.b-top{padding:12px max(24px,calc((100% - 1160px)/2))}
.b-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-areas:"pains stage" "arrow stage" "change stage";column-gap:40px;padding:36px max(24px,calc((100% - 1160px)/2)) 30px;align-content:center}
.b-pains{grid-area:pains;justify-content:flex-start}.b-pains li{font-size:22px}
.b-arrow{grid-area:arrow;margin:14px 0 10px 60px}
.b-change{grid-area:change;text-align:left;font-size:58px}
.b-stage{grid-area:stage;height:400px;margin:0}.b-material{height:330px}.b-photo{right:0;height:400px}
.b-offer{display:grid;grid-template-columns:auto minmax(0,460px);justify-content:center;align-items:center;gap:40px;padding:22px}
.b-product{margin:0;text-align:left}
}`;

function page(id, title, body, css) {
  const text = body.replace(/<[^>]+>/g, '') + C.ctaLabel + '×円0';
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
console.log(`out/passlabo-fv-a.html, out/passlabo-fv-b.html（素材: 講師写真 ${photo.real ? 'あり' : '差し替え待ち'}・板書 ${material.real ? 'あり' : '差し替え待ち'}）`);
