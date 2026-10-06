// LP の描画（v2）。同じ project から draft（社内確認）/ review（レビュー用プレビュー）/ commercial（実販売）を描く。
// - すべての文字列は escapeHtml を通す。URL は safeUrl、色は safeColor を通した値だけを使う。
// - script はツールが持つ固定文字列だけ（ユーザー入力を含まない）。CSP の sha256 hash を付ける。
// - 見出し・本文・CTA は最初の描画から読める。動くのは仕組みを説明する図だけ（1.2秒以内に静止）。
// - デモ（live 以外）では、行動ボタンはページ内の例へのアンカーだけ。実際の申込ボタンは無効表示。

import { escapeHtml as e, safeUrl, safeColor, contrastRatio, readableOn, inkFor, sha256Base64 } from './util.js';
import { detectClaims } from './claims.js';
import { ROLES } from './roles.js';
import { headingPhrases } from './segment.js';
import { checkProject, gates } from './editorial.js';
import { refIndex } from './schema.js';

// head で js クラスを付ける（動きを減らす設定なら付けない）。body 末尾で付けると一瞬の明滅が起きうるため
export const HEAD_SCRIPT = `(function(){try{var d=document.documentElement;var rm=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);if(!rm&&!d.hasAttribute('data-reduce-motion')&&'IntersectionObserver' in window)d.classList.add('js')}catch(e){}})();`;

export const RUNTIME_SCRIPT = `(function(){var d=document.documentElement;var io='IntersectionObserver' in window;
var els=document.querySelectorAll('.reveal');function showAll(){for(var i=0;i<els.length;i++)els[i].classList.add('in')}
if(!d.classList.contains('js')||!io){showAll()}else{var ob=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');ob.unobserve(x.target)}})},{rootMargin:'0px 0px -6% 0px'});for(var j=0;j<els.length;j++)ob.observe(els[j])}
addEventListener('hashchange',showAll);addEventListener('beforeprint',showAll);if(location.hash)showAll();
var bar=document.querySelector('.sticky-cta');if(!bar)return;var zones=document.querySelectorAll('.cta-zone'),vis=[];
function upd(){var any=false;for(var i=0;i<vis.length;i++)if(vis[i])any=true;var show=!any;bar.classList.toggle('show',show);if(show){bar.removeAttribute('inert');bar.removeAttribute('aria-hidden')}else{bar.setAttribute('inert','');bar.setAttribute('aria-hidden','true')}}
if(io){var z=new IntersectionObserver(function(es){es.forEach(function(x){vis[Array.prototype.indexOf.call(zones,x.target)]=x.isIntersecting});upd()});Array.prototype.forEach.call(zones,function(x,i){vis[i]=true;z.observe(x)});upd()}else{bar.classList.add('show');bar.removeAttribute('inert');bar.removeAttribute('aria-hidden')}})();`;

// 日本語ゴシックを OS ごとに指定し、最後にこの検証環境に実在する IPA ゴシックを置く。
// 名前を並べるだけでは描画を保証しないため、実際の描画フォントは docs/fonts.mjs（CDP の getPlatformFontsForNode）で確認する。
const JA_SANS = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Yu Gothic","YuGothic","Meiryo","Noto Sans JP","Noto Sans CJK JP","Source Han Sans JP","IPAPGothic","IPAGothic","IPAexGothic"';
const FONT_STACK = {
  sans: `${JA_SANS},sans-serif`,
  serif: '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Noto Serif CJK JP","IPAPMincho","IPAMincho",serif',
  rounded: `"Hiragino Maru Gothic ProN","M PLUS Rounded 1c",${JA_SANS},sans-serif`,
};

function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v * (1 - t) + pb[i] * t).toString(16).padStart(2, '0')).join('');
}

function tokens(project) {
  const b = project.brand;
  const v = project.cta.variants.find((x) => x.id === project.cta.activeVariant) || project.cta.variants[0];
  const primary = safeColor(b.primary) || '#2741b8';
  const accent = safeColor(b.accent) || '#c42f57';
  const ink = safeColor(b.ink) || '#1b1f2b';
  const paper = safeColor(b.paper) || '#fbf8f3';
  const cta = safeColor(v?.color) || accent;
  return { primary, accent, ink, paper, cta, ctaText: readableOn(cta), primaryInk: inkFor(primary, '#ffffff'), accentInk: inkFor(accent, '#ffffff'), bandText: readableOn(primary), font: FONT_STACK[b.font] || FONT_STACK.sans, timing: v?.timing || 'spec' };
}

export function contrastChecks(project) {
  const t = tokens(project);
  return [
    { name: '本文（文字色 / 紙面）', ratio: contrastRatio(t.ink, t.paper) },
    { name: '本文（文字色 / 白）', ratio: contrastRatio(t.ink, '#ffffff') },
    { name: '補足（文字色の補足 / 白）', ratio: contrastRatio(mixHex(t.ink, '#ffffff', 0.25), '#ffffff') },
    { name: '強調（メイン色 / 白）', ratio: contrastRatio(t.primaryInk, '#ffffff') },
    { name: '呼びかけ（アクセント色 / 白）', ratio: contrastRatio(t.accentInk, '#ffffff') },
    { name: 'CTA（文字 / ボタン色）', ratio: contrastRatio(t.ctaText, t.cta) },
    { name: '締めの帯（白文字 / 文字色の帯）', ratio: contrastRatio('#ffffff', t.ink) },
    { name: '締めの帯（白文字 / 帯の終端）', ratio: contrastRatio('#ffffff', mixHex(t.ink, t.primary, 0.22)) },
    { name: '締めの帯（注記 / 帯）', ratio: contrastRatio('#e6e8ee', mixHex(t.ink, t.primary, 0.22)) },
  ].map((c) => ({ ...c, ok: c.ratio >= 4.5 }));
}

function css(project) {
  const t = tokens(project);
  return `:root{--primary:${t.primary};--accent:${t.accent};--ink:${t.ink};--paper:${t.paper};--cta:${t.cta};--cta-text:${t.ctaText};--primary-ink:${t.primaryInk};--accent-ink:${t.accentInk};--band-text:${t.bandText};--sub:${mixHex(t.ink, '#ffffff', 0.25)};--line:${mixHex(t.ink, '#ffffff', 0.86)};--tint:${mixHex(t.primary, '#ffffff', 0.93)};--hl:${mixHex(t.accent, '#ffffff', 0.86)};--font:${t.font}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-bottom:96px;scroll-behavior:smooth}
body{margin:0;font-family:var(--font);color:var(--ink);background:#fff;font-size:16px;line-height:1.8;font-weight:400;overflow-wrap:break-word;line-break:strict;padding-bottom:96px}
p{margin:0 0 1em}
.ph{display:inline-block;max-width:100%}
h1,h2,h3{margin:0;font-feature-settings:"palt" 1}
.demo-bar{background:var(--ink);color:#fff;font-size:14px;line-height:1.6;text-align:center;padding:8px 16px}
.demo-bar b{font-weight:700}
.hero{background:linear-gradient(180deg,var(--paper),#fff);border-bottom:1px solid var(--line)}
.hero-in{max-width:1160px;margin:0 auto;padding:56px 32px 64px;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);grid-template-areas:"copy visual" "cta visual";column-gap:40px;align-items:start}
.hero-copy{grid-area:copy}
.hero-cta{grid-area:cta;margin-top:28px}
.hero-visual{grid-area:visual;align-self:center;margin:0}
.hero-meta{font-size:13px;line-height:1.5;color:var(--sub);margin:0 0 18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hero-meta b{color:var(--ink);font-weight:700;margin-right:.6em}
.aud{font-size:15px;line-height:1.5;font-weight:700;color:var(--accent-ink);margin:0 0 12px}
.hero h1{font-size:52px;line-height:1.3;font-weight:800;letter-spacing:-.02em;margin:0 0 20px;text-wrap:balance}
.lead{font-size:17px;line-height:1.8;max-width:34em;margin:0}
.cta-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:56px;padding:12px 28px;border-radius:12px;font-size:17px;line-height:1.4;font-weight:700;text-decoration:none;text-align:center}
.btn-primary{background:var(--cta);color:var(--cta-text);box-shadow:0 6px 16px color-mix(in srgb,var(--cta) 28%,transparent)}
.btn-primary:focus-visible,.sticky-cta a:focus-visible{outline:3px solid #ffbf00;outline-offset:3px}
.arw{display:inline-block;width:.6em;height:.6em;border-top:2.5px solid currentColor;border-right:2.5px solid currentColor;transform:rotate(45deg);margin-left:2px}
.btn-disabled{background:#fff;color:var(--sub);border:1.5px dashed var(--line);cursor:not-allowed;font-weight:700;min-height:48px;font-size:15px;padding:10px 18px}
.cta-note{font-size:14px;line-height:1.7;color:var(--sub);margin:10px 0 0;text-wrap:pretty}
.vis{background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 32px color-mix(in srgb,var(--ink) 9%,transparent);padding:20px 22px}
.vis-label{display:inline-block;font-size:12px;line-height:1.5;font-weight:700;color:var(--primary-ink);background:var(--tint);border-radius:6px;padding:3px 8px;margin-bottom:12px}
.vis-title{font-size:20px;line-height:1.4;font-weight:800;margin:0 0 12px;font-variant-numeric:tabular-nums}
.vis-row{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:14px 14px;font-size:16px;line-height:1.6;font-weight:700}
.vis-box{flex:none;width:20px;height:20px;border-radius:5px;border:2px solid var(--primary-ink);margin-top:2px}
.vis-note{font-size:13px;line-height:1.6;color:var(--sub);margin:12px 0 0;text-wrap:pretty}
.vis-filter{display:inline-block;font-size:13px;line-height:1.5;font-weight:700;border:1px solid var(--line);border-radius:8px;padding:4px 10px;margin:0 0 8px 8px}
.vis-table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;font-variant-numeric:tabular-nums}
.vis-table th{text-align:left;font-size:12px;color:var(--sub);font-weight:700;padding:6px 8px;border-bottom:1px solid var(--line)}
.vis-table td{padding:10px 8px;border-bottom:1px solid var(--line)}
.vis-table tr.hl td{font-weight:700}
.tag{display:inline-block;font-size:12px;line-height:1.4;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--tint);color:var(--primary-ink)}
.flow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:12px;align-items:stretch}
.flow-step{border:1px solid var(--line);border-radius:12px;padding:16px 18px;font-size:15px;line-height:1.7;background:#fff;min-width:0}
.vis-wrap{margin-top:24px}
.flow-step.main{border:2px solid var(--primary-ink);font-weight:700}
.flow-arrow{align-self:center;width:14px;height:14px;border-top:2.5px solid var(--sub);border-right:2.5px solid var(--sub);transform:rotate(45deg)}
.check-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.check-list li{display:flex;gap:10px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:15px}
.sec{padding:80px 0}
.sec:nth-of-type(even){background:var(--paper)}
.sec-in{max-width:760px;margin:0 auto;padding:0 32px}
.sec-in.wide{max-width:1040px}
.sec h2{font-size:36px;line-height:1.35;font-weight:800;letter-spacing:-.01em;margin:0 0 24px;text-wrap:balance}
.sec .body{max-width:640px}
.sec-empathy .body{border-left:4px solid var(--accent);padding-left:20px}
.points{list-style:none;padding:0;margin:20px 0 0;display:grid;gap:12px}
.points li{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 20px}
.points b{display:block;font-size:17px}
.steps{list-style:none;padding:0;margin:0;display:grid;gap:16px;counter-reset:st}
.steps li{counter-increment:st;display:grid;grid-template-columns:44px minmax(0,1fr);gap:16px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px 32px 24px 24px}
.steps li::before{content:counter(st);width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--tint);color:var(--primary-ink);font-weight:800;font-size:18px;line-height:1;font-variant-numeric:tabular-nums}
.steps h3{font-size:19px;line-height:1.5;font-weight:700;margin:6px 0 6px}
.steps p{margin:0}
.scope-box{background:#fff;border:1px solid var(--line);border-radius:14px;padding:28px 32px}
.faq{margin:0;display:grid;gap:16px}
.faq div{background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px 32px}
.faq dt{font-weight:700;font-size:17px;line-height:1.6;margin:0 0 8px}
.faq dt::before{content:"Q.";color:var(--primary-ink);margin-right:.4em}
.faq dd{margin:0}
.illus .vis{padding:28px 32px}
.closing{background:linear-gradient(160deg,var(--ink),${mixHex(t.ink, t.primary, 0.22)});color:#fff;padding:80px 0;border-top:4px solid var(--accent)}
.closing h2{color:inherit;font-size:36px;line-height:1.35;font-weight:800;margin:0 0 20px;text-wrap:balance}
.closing .body{max-width:640px;margin-bottom:28px}
.closing .btn-primary{background:var(--cta);color:var(--cta-text);box-shadow:0 8px 20px rgba(0,0,0,.3)}
.closing .btn-disabled{background:transparent;color:#e6e8ee;border-color:rgba(255,255,255,.5)}
.closing .cta-note{color:#e6e8ee}
footer{padding:32px 0;font-size:14px;line-height:1.7;color:var(--sub);border-top:1px solid var(--line)}
footer .sec-in{max-width:1040px}
.sticky-cta{position:fixed;right:24px;bottom:24px;width:340px;height:60px;z-index:50;visibility:hidden;opacity:0;transform:translateY(10px);transition:opacity .25s,transform .25s,visibility .25s}
.sticky-cta.show{visibility:visible;opacity:1;transform:none}
.sticky-cta a{display:flex;align-items:center;justify-content:center;gap:10px;height:100%;border-radius:14px;background:var(--cta);color:var(--cta-text);font-weight:700;font-size:16px;line-height:1.3;text-decoration:none;box-shadow:0 10px 26px rgba(0,0,0,.22);padding:0 18px;text-align:center}
.draft-banner{background:#7a1f00;color:#fff;font-size:13px;line-height:1.6;padding:8px 16px}
.draft-meta{font-size:12px;line-height:1.5;color:#7a1f00;background:#fff3e0;border:1px dashed #e0a060;border-radius:6px;padding:4px 8px;margin:0 0 12px;font-family:ui-monospace,Menlo,monospace}
.reveal{transition:opacity .45s ease,transform .45s ease}
.js .reveal{opacity:0;transform:translateY(12px)}
.js .reveal.in{opacity:1;transform:none}
.js .hero-visual{animation:vin .6s cubic-bezier(.2,.7,.2,1) .28s both}
.js .hero-visual .hl{animation:hl .4s ease .7s both}
@keyframes vin{from{opacity:0;transform:translateY(18px) scale(.98)}to{opacity:1;transform:none}}
@keyframes hl{from{background-color:#fff;box-shadow:inset 0 0 0 0 var(--accent)}to{background-color:var(--hl);box-shadow:inset 4px 0 0 0 var(--accent)}}
.hl{background-color:var(--hl);box-shadow:inset 4px 0 0 0 var(--accent)}
tr.hl td{background-color:var(--hl)}
.js .hero-visual tr.hl td{animation:hlc .4s ease .7s both}
@keyframes hlc{from{background-color:#fff}to{background-color:var(--hl)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}html{scroll-behavior:auto}}
@media print{.reveal{opacity:1!important;transform:none!important}.sticky-cta{display:none}}
@media (min-width:768px) and (max-width:1023px){.hero h1{font-size:42px}}
@media (max-width:767px){
.hero-in{grid-template-columns:minmax(0,1fr);grid-template-areas:"copy" "visual" "cta";padding:16px 20px 24px}
.hero-meta{margin-bottom:12px;font-size:12px}
.aud{font-size:14px;margin-bottom:8px}
.hero h1{font-size:31px;margin-bottom:12px}
.lead{font-size:16px}
.hero-visual{margin-top:14px;align-self:stretch}
.hero-visual .vis{padding:14px 16px;border-radius:14px}
.hero-visual .vis-label{margin-bottom:8px}
.hero-visual .vis-title{font-size:17px;margin-bottom:8px}
.hero-visual .vis-row{padding:10px 12px;font-size:15px}
.hero-visual .vis-note{margin-top:6px;font-size:12px;line-height:1.5}
.hero-visual .vis-table tr{padding:6px 6px}
.hero-cta{margin-top:14px}
.cta-note{font-size:13px;margin-top:6px}
.demo-bar{font-size:13px;padding:6px 12px}
.cta-row{flex-direction:column;align-items:stretch;gap:8px}
.btn{width:100%;min-height:56px;font-size:16px;padding:12px 16px}
.btn-disabled{min-height:40px;font-size:14px;padding:6px 12px}
.sec{padding:56px 0}
.closing{padding:56px 0}
.sec-in{padding:0 20px}
.sec h2,.closing h2{font-size:28px;line-height:1.4;margin-bottom:18px}
.sec-empathy .body{padding-left:14px}
.steps li{grid-template-columns:36px minmax(0,1fr);gap:12px;padding:20px 24px 20px 16px}
.steps li::before{width:36px;height:36px;font-size:16px}
.steps h3{font-size:17px;margin-top:4px}
.faq div,.scope-box{padding:20px 24px}
.illus .vis{padding:20px 18px}
.flow{grid-template-columns:minmax(0,1fr);gap:8px}
.flow-arrow{justify-self:center;transform:rotate(135deg);margin:2px 0 6px}
.vis-table thead{display:none}
.vis-table,.vis-table tbody{display:block;width:100%}
.vis-table tr{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"a b" "c d";column-gap:8px;row-gap:2px;border-bottom:1px solid var(--line);padding:8px 8px}
.vis-table td{border:0;padding:0;display:block}
.vis-table td:nth-child(1){grid-area:a;font-weight:700}
.vis-table td:nth-child(2){grid-area:b;justify-self:end}
.vis-table td:nth-child(3){grid-area:c;font-size:13px;color:var(--sub)}
.vis-table td:nth-child(4){grid-area:d;justify-self:end;font-size:13px;color:var(--sub)}
.vis-table td:nth-child(4)::before{content:attr(data-label) " ";font-size:11px}
.vis-table tr.hl td{font-weight:700}
.sticky-cta{left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));width:auto;height:56px}
}
@media (max-width:399px){.hero h1{font-size:28px}.hero-meta{white-space:normal}}
@media (max-width:359px){.hero-in{padding:16px 16px 24px}.sec-in{padding:0 16px}.hero h1{font-size:26px}}
/* ---- FV（v3: 1訴求・大きな図・1CTA） ---- */
@property --p{syntax:'<number>';inherits:false;initial-value:25}
.hero{background:var(--paper);border-bottom:0;overflow:hidden}
.hero-bar{max-width:1160px;margin:0 auto;padding:16px 32px 0;display:flex;align-items:center;gap:10px}
.logo{font-size:14px;font-weight:800;letter-spacing:.02em}
.demo-badge{font-size:12px;line-height:1;font-weight:700;color:#fff;background:var(--ink);border-radius:999px;padding:5px 10px}
.hero-in{max-width:1160px;margin:0 auto;padding:40px 32px 72px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-areas:"copy visual" "cta visual";column-gap:56px;align-items:center}
.hero-copy{grid-area:copy;align-self:end}
.hero .aud{font-size:16px;line-height:1.5;font-weight:700;color:var(--accent-ink);margin:0 0 14px}
.hero h1{font-size:64px;line-height:1.22;font-weight:800;letter-spacing:-.03em;margin:0}
.hero-cta{grid-area:cta;align-self:start;margin-top:36px}
.btn-hero{min-width:300px;min-height:64px;font-size:18px;border-radius:14px}
.hero-visual{grid-area:visual;margin:0;align-self:center}
.plan{padding:28px 30px 30px;border-radius:24px;box-shadow:0 24px 60px color-mix(in srgb,var(--ink) 14%,transparent);border:1px solid var(--line)}
.plan .vis-label{font-size:13px;margin-bottom:18px}
.plan-main{display:flex;align-items:center;gap:22px;margin-bottom:20px}
.ring{flex:none;width:132px;height:132px;border-radius:50%;background:conic-gradient(var(--accent) calc(var(--p) * 1%),color-mix(in srgb,var(--accent) 10%,#fff) 0);display:grid;place-items:center;position:relative;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 25%,transparent)}
.ring span{width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px var(--accent)}
.ring::before{content:"";position:absolute;inset:6px;border-radius:50%;background:repeating-conic-gradient(from -1deg,rgba(255,255,255,.95) 0 2deg,transparent 2deg 30deg);-webkit-mask:radial-gradient(circle,transparent 82%,#000 83%);mask:radial-gradient(circle,transparent 82%,#000 83%)}
.plan-title{font-size:34px;line-height:1.25;font-weight:800;margin:0;letter-spacing:-.02em}
.plan-task{font-size:20px;padding:18px 20px;border-radius:14px;gap:14px}
.plan-task .vis-box{width:24px;height:24px;margin-top:3px}
.js .hero-visual .ring{animation:ring .6s cubic-bezier(.3,.7,.2,1) .35s both}
@keyframes ring{from{--p:0}to{--p:25}}
.after-fv{background:#fff;border-top:1px solid var(--line);padding:32px 0 8px}
.after-fv .sec-in{max-width:760px}
.after-notice{font-size:14px;line-height:1.7;border:1px solid var(--line);border-left:4px solid var(--ink);border-radius:8px;padding:10px 14px;margin:0 0 18px;background:var(--paper)}
.after-fv .lead{font-size:17px;line-height:1.8;margin:0 0 10px}
.after-note{font-size:13px;color:var(--sub);margin:0 0 8px}
.after-cp .cta-row{margin-top:8px}
@media (min-width:768px) and (max-width:1023px){.hero h1{font-size:48px}.hero-in{column-gap:32px}}
@media (max-width:767px){
.hero-bar{padding:12px 20px 0}
.hero-in{grid-template-columns:minmax(0,1fr);grid-template-areas:"copy" "visual" "cta";padding:20px 20px 28px}
.hero .aud{font-size:15px;margin-bottom:8px}
.hero h1{font-size:36px;line-height:1.25}
.hero-visual{margin-top:22px}
.plan{padding:20px 20px 22px;border-radius:20px}
.plan .vis-label{margin-bottom:14px}
.plan-main{gap:16px;margin-bottom:16px}
.ring{width:96px;height:96px}.ring span{width:12px;height:12px}
.plan-title{font-size:28px}
.plan-task{font-size:17px;padding:14px 16px}
.hero-cta{margin-top:20px}
.btn-hero{width:100%;min-width:0;min-height:58px;font-size:17px}
.after-fv{padding:24px 0 0}
.after-fv .lead{font-size:16px}
}
@media (max-width:359px){.hero-bar{padding:10px 16px 0}.hero-in{padding:16px 16px 24px}.hero h1{font-size:30px}.plan-title{font-size:24px}.ring{width:84px;height:84px}}
/* ---- FV 人物写真版: 写真を全面に敷き、顔が主役。見出し・小さな計画カード・CTA を視線の先（余白側）に置く ---- */
.hero-portrait{position:relative;background:#f4ece4;isolation:isolate}
.hero-photo{position:absolute;inset:0;z-index:-1;overflow:hidden;margin:0}
.hero-photo img{width:100%;height:100%;object-fit:cover;object-position:var(--fx) var(--fyp);transform:scale(var(--zp));transform-origin:var(--fx) var(--fyp);display:block}
.hero-photo img.flip{transform:scale(var(--zp)) scaleX(-1)}
.gaze-left .hero-photo::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(250,246,241,.92) 0%,rgba(250,246,241,.78) 34%,rgba(250,246,241,0) 56%)}
.gaze-right .hero-photo::after{content:"";position:absolute;inset:0;background:linear-gradient(270deg,rgba(250,246,241,.92) 0%,rgba(250,246,241,.78) 34%,rgba(250,246,241,0) 56%)}
.hero-portrait .hero-in{grid-template-columns:minmax(0,500px) minmax(0,1fr);grid-template-areas:"copy ." "visual ." "cta .";min-height:min(640px,calc(100vh - 56px));align-content:center;padding-top:24px;padding-bottom:56px;row-gap:0}
.gaze-right .hero-in{grid-template-columns:minmax(0,1fr) minmax(0,500px);grid-template-areas:". copy" ". visual" ". cta"}
.hero-portrait .hero-copy{align-self:auto}
.hero-portrait h1{font-size:56px}
.hero-visual.mini{grid-area:visual;margin:28px 0 0;max-width:340px;align-self:start}
.hero-visual.mini .plan{padding:16px 18px 18px;border-radius:18px;box-shadow:0 18px 40px color-mix(in srgb,var(--ink) 18%,transparent)}
.hero-visual.mini .vis-label{font-size:12px;margin-bottom:10px}
.hero-visual.mini .plan-main{gap:12px;margin-bottom:12px}
.hero-visual.mini .ring{width:56px;height:56px}.hero-visual.mini .ring span{width:8px;height:8px;box-shadow:0 0 0 2px var(--accent)}
.hero-visual.mini .plan-title{font-size:22px}
.hero-visual.mini .plan-task{font-size:15px;padding:10px 12px;gap:10px}
.hero-visual.mini .plan-task .vis-box{width:18px;height:18px;margin-top:2px}
.hero-portrait .hero-cta{margin-top:28px}
.photo-cap{position:absolute;right:16px;bottom:12px;margin:0;font-size:11px;line-height:1.4;color:#fff;background:rgba(20,22,30,.55);border-radius:6px;padding:3px 8px}
@media (max-width:767px){
.hero-portrait{background:var(--paper)}
.hero-portrait .hero-bar{position:absolute;top:0;left:0;right:0;z-index:2}
.hero-portrait .logo{background:rgba(255,255,255,.86);border-radius:999px;padding:4px 10px}
.hero-photo{position:relative;inset:auto;z-index:auto;height:300px}
.hero-photo img{object-position:var(--fxs) var(--fy);transform:scale(var(--zs));transform-origin:var(--fxs) var(--fy)}
.hero-photo img.flip{transform:scale(var(--zs)) scaleX(-1)}
.gaze-left .hero-photo::after,.gaze-right .hero-photo::after{display:none}
.hero-portrait .hero-in,.gaze-right .hero-in{grid-template-columns:minmax(0,1fr);grid-template-areas:"visual" "copy" "cta";min-height:0;padding:0 20px 24px}
.hero-visual.mini{margin:14px 0 0;max-width:236px;position:relative;z-index:1}
.gaze-right .hero-visual.mini{justify-self:end}
.hero-visual.mini .plan{padding:12px 14px 14px;border-radius:14px}
.hero-visual.mini .vis-label{font-size:11px;margin-bottom:8px;padding:2px 6px}
.hero-visual.mini .plan-main{gap:10px;margin-bottom:10px}
.hero-visual.mini .ring{width:40px;height:40px}
.hero-visual.mini .plan-title{font-size:18px}
.hero-visual.mini .plan-task{font-size:14px;padding:8px 10px}
.hero-portrait .hero-copy{margin-top:18px}
.hero-portrait h1{font-size:32px}
.hero-portrait .hero-cta{margin-top:18px}
.photo-cap{bottom:auto;right:10px;top:270px;font-size:10px}
}
@media (max-width:359px){.hero-photo{height:260px}.photo-cap{top:230px}.hero-portrait .hero-in{padding-bottom:16px}.hero-portrait .hero-visual.mini{margin-top:10px}.hero-portrait .hero-copy{margin-top:12px}.hero-portrait .hero-cta{margin-top:14px}.hero-portrait h1{font-size:28px}.hero-visual.mini{max-width:210px}}
`;
}

// ---------------- 部品 ----------------

const paras = (text) => String(text || '').split(/\n+/).filter((x) => x.trim()).map((x) => `<p>${e(x)}</p>`).join('');

function phrasesHtml(heading, preferred) {
  const { phrases } = headingPhrases(heading, preferred);
  return phrases.map((p) => `<span class="ph">${e(p)}</span>`).join('');
}

function visualHtml(v, { hero = false } = {}) {
  if (!v) return '';
  const label = `<span class="vis-label">${e(v.label)}</span>`;
  const note = v.note ? `<p class="vis-note">${phrasesHtml(v.note)}</p>` : '';
  if (v.kind === 'task-card' && hero) {
    return `<div class="vis plan">${label}<div class="plan-main"><div class="ring" aria-hidden="true"><span></span></div><p class="vis-title plan-title">${e(v.title)}</p></div><div class="vis-row plan-task hl"><span class="vis-box" aria-hidden="true"></span><span>${e(v.task)}</span></div></div>`;
  }
  if (v.kind === 'table' && hero) {
    const cols = v.columns || [];
    const rows = (v.rows || []).map((r, i) => `<tr${i === v.highlight ? ' class="hl"' : ''}>${r.map((c, j) => `<td data-label="${e(cols[j] || '')}">${j === 1 ? `<span class="tag">${e(c)}</span>` : e(c)}</td>`).join('')}</tr>`).join('');
    return `<div class="vis vis-tablebox">${label}<table class="vis-table"><thead><tr>${cols.map((c) => `<th scope="col">${e(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  if (v.kind === 'task-card') {
    return `<div class="vis vis-taskcard">${label}${v.title ? `<p class="vis-title">${e(v.title)}</p>` : ''}<div class="vis-row hl"><span class="vis-box" aria-hidden="true"></span><span>${e(v.task)}</span></div>${note}</div>`;
  }
  if (v.kind === 'flow') {
    const steps = [v.from, v.to, v.review].filter(Boolean);
    const html = steps.map((s, i) => `<div class="flow-step${i === 1 ? ' main' : ''}">${phrasesHtml(s)}</div>`).join('<span class="flow-arrow" aria-hidden="true"></span>');
    return `<div class="vis vis-flow">${label}<div class="flow" role="list">${html}</div>${note}</div>`;
  }
  if (v.kind === 'table') {
    const cols = v.columns || [];
    const rows = (v.rows || []).map((r, i) => `<tr${i === v.highlight ? ' class="hl"' : ''}>${r.map((c, j) => `<td data-label="${e(cols[j] || '')}">${j === 1 ? `<span class="tag">${e(c)}</span>` : e(c)}</td>`).join('')}</tr>`).join('');
    return `<div class="vis vis-tablebox">${label}${v.title ? `<p class="vis-filter">${e(v.title)}</p>` : ''}<table class="vis-table"><thead><tr>${cols.map((c) => `<th scope="col">${e(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>${note}</div>`;
  }
  if (v.kind === 'checklist') {
    const items = [v.title, v.task, v.from, v.to, v.review].filter(Boolean);
    return `<div class="vis">${label}<ul class="check-list">${items.map((x, i) => `<li${i === 0 ? ' class="hl"' : ''}><span class="vis-box" aria-hidden="true"></span>${e(x)}</li>`).join('')}</ul>${note}</div>`;
  }
  return '';
}

function ctaHtml(s, mode) {
  if (!s.cta && !s.commercialPreview) return '';
  const parts = [];
  if (s.cta) parts.push(`<a class="btn btn-primary" href="#${e(s.cta.target)}">${e(s.cta.label)}<span class="arw" aria-hidden="true"></span></a>`);
  if (s.commercialPreview) {
    if (mode.commercial) {
      parts.push(`<a class="btn btn-primary" href="${e(mode.commercialUrl)}" rel="noopener noreferrer">${e(s.commercialPreview.label)}<span class="arw" aria-hidden="true"></span></a>`);
    } else {
      parts.push(`<span class="btn btn-disabled" role="link" aria-disabled="true">${e(s.commercialPreview.label)}</span>`);
    }
  }
  const note = !mode.commercial ? (s.commercialPreview?.note || mode.demoNotice) : '';
  return `<div class="cta-row cta-zone">${parts.join('')}</div>${note ? `<p class="cta-note">${phrasesHtml(note)}</p>` : ''}`;
}

function hasContent(s) {
  if (s.role === 'proof') return true; // 出せる根拠があるかは sectionHtml が判断する
  return !!(s.body.trim() || s.items.some((i) => (i.heading || i.body).trim()) || s.visual);
}

function draftMeta(s, mode) {
  if (!mode.draft) return '';
  const refs = [...new Set([...s.sourceRefs, ...s.items.flatMap((i) => i.sourceRefs), ...(s.visual?.sourceRefs || [])])];
  const st = s.approved ? '承認済' : '未承認';
  return `<p class="draft-meta">${e(ROLES[s.role].label)} / ${st}${s.needsReview ? ' / 要再確認' : ''} / 参照: ${e(refs.join(', ') || 'なし')}</p>`;
}

function sectionHtml(project, s, mode) {
  const id = e(s.id);
  const h2 = s.heading ? `<h2>${phrasesHtml(s.heading, s.headingPhrases)}</h2>` : '';
  const meta = draftMeta(s, mode);
  switch (s.role) {
    case 'hero': {
      // FV は 1つの訴求・大きな主役（人物写真 または 計画の図）・1つのCTA。説明・デモの注意書き・実際の申込ボタンは FV の下（after-fv）
      const d = project.display;
      const badge = d.demoMode !== 'live' ? `<span class="demo-badge">${d.demoMode === 'synthetic-demo' ? '架空デモ' : '試作'}</span>` : '';
      const cta = s.cta ? `<a class="btn btn-primary btn-hero" href="#${e(s.cta.target)}">${e(s.cta.label)}<span class="arw" aria-hidden="true"></span></a>` : '';
      const pt = project.assets?.heroPortrait;
      const copy = `<div class="hero-copy">${meta}${d.audienceLabel ? `<p class="aud">${e(d.audienceLabel)}</p>` : ''}<h1>${phrasesHtml(s.heading, s.headingPhrases)}</h1></div>`;
      if (pt && pt.dataUri) {
        // 顔が主役。写真を全面に敷き、視線（gaze）の先に見出し・小さな計画カード・CTA を置く。人物は架空のイメージで、口コミ・実績・肩書と結び付けない
        const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
        const vars = `--fx:${num(pt.focusX, 50)}%;--fy:${num(pt.focusY, 30)}%;--fyp:${num(pt.focusYPc, num(pt.focusY, 30))}%;--fxs:${num(pt.focusXSp, num(pt.focusX, 50))}%;--zs:${num(pt.zoomSp, 1)};--zp:${num(pt.zoomPc, 1)}`;
        return `<header class="hero hero-portrait gaze-${pt.gaze === 'right' ? 'right' : 'left'} cta-zone" id="${id}" style="${vars}"><figure class="hero-photo"><img src="${e(pt.dataUri)}" alt="${e(pt.alt)}"${pt.flip ? ' class="flip"' : ''} decoding="async"></figure><div class="hero-bar"><span class="logo">${e(d.brandName)}</span>${badge}</div><div class="hero-in">
${copy}
${s.visual ? `<div class="hero-visual mini" aria-label="${e(s.visual.label)}">${visualHtml(s.visual, { hero: true })}</div>` : ''}
<div class="hero-cta">${cta}</div>
</div><p class="photo-cap">${e(pt.caption)}</p></header>`;
      }
      return `<header class="hero cta-zone" id="${id}"><div class="hero-bar"><span class="logo">${e(d.brandName)}</span>${badge}</div><div class="hero-in">
${copy}
${s.visual ? `<figure class="hero-visual" aria-label="${e(s.visual.label)}">${visualHtml(s.visual, { hero: true })}</figure>` : ''}
<div class="hero-cta">${cta}</div>
</div></header>`;
    }
    case 'closing':
      return `<section class="closing" id="${id}"><div class="sec-in">${meta}${h2}${s.body ? `<div class="body">${paras(s.body)}</div>` : ''}${ctaHtml(s, mode)}</div></section>`;
    case 'process':
      return `<section class="sec sec-process" id="${id}"><div class="sec-in">${meta}${h2}${s.body ? `<div class="body reveal">${paras(s.body)}</div>` : ''}<ol class="steps">${s.items.map((it) => `<li class="reveal"><div><h3>${phrasesHtml(it.heading)}</h3>${it.body ? `<p>${e(it.body)}</p>` : ''}</div></li>`).join('')}</ol>${ctaHtml(s, mode)}</div></section>`;
    case 'faq':
      return `<section class="sec sec-faq" id="${id}"><div class="sec-in">${meta}<h2>${s.heading ? phrasesHtml(s.heading, s.headingPhrases) : 'よくある質問'}</h2>${s.body ? `<div class="body">${paras(s.body)}</div>` : ''}<dl class="faq">${s.items.map((it) => `<div class="reveal"><dt>${e(it.heading)}</dt><dd>${e(it.body)}</dd></div>`).join('')}</dl></div></section>`;
    case 'illustration':
      return `<section class="sec sec-illus illus" id="${id}"><div class="sec-in wide">${meta}${h2}${s.body ? `<div class="body">${paras(s.body)}</div>` : ''}<div class="reveal">${visualHtml(s.visual)}</div>${ctaHtml(s, mode)}</div></section>`;
    case 'scope':
      return `<section class="sec sec-scope" id="${id}"><div class="sec-in">${meta}${h2}<div class="scope-box reveal">${paras(s.body)}${s.items.length ? `<ul>${s.items.map((it) => `<li>${e(it.heading)}${it.body ? `：${e(it.body)}` : ''}</li>`).join('')}</ul>` : ''}</div>${ctaHtml(s, mode)}</div></section>`;
    case 'proof': {
      const idx = refIndex(project);
      const ev = s.sourceRefs.map((r) => idx.get(r)).filter((x) => x && x.type === 'evidence' && x.reality === 'real' && x.item.status === 'verified' && !['illustrative', 'hypothesis'].includes(x.item.kind) && !(x.item.kind === 'customer-quote' && !x.item.consent) && ![x.item.claim, x.item.source].some((t) => detectClaims(t, project.display.category).some((c) => c.severity === 'block')));
      if (!ev.length) return '';
      return `<section class="sec sec-proof" id="${id}"><div class="sec-in">${meta}${h2}${s.body ? `<div class="body">${paras(s.body)}</div>` : ''}<ul class="points">${ev.map((x) => `<li class="reveal">${e(x.text)}<br><small>出典: ${e(x.item.source)}</small></li>`).join('')}</ul></div></section>`;
    }
    default: {
      const items = s.items.filter((it) => it.heading || it.body);
      return `<section class="sec sec-${e(s.role)}${s.visual ? ' illus' : ''}" id="${id}"><div class="sec-in${s.visual ? ' wide' : ''}">${meta}${h2}${s.body ? `<div class="body reveal">${paras(s.body)}</div>` : ''}${items.length ? `<ul class="points">${items.map((it) => `<li class="reveal">${it.heading ? `<b>${e(it.heading)}</b>` : ''}${it.body ? e(it.body) : ''}</li>`).join('')}</ul>` : ''}${s.visual ? `<div class="reveal vis-wrap">${visualHtml(s.visual)}</div>` : ''}${ctaHtml(s, mode)}</div></section>`;
    }
  }
}

/**
 * kind: 'draft'（社内確認。役割・参照IDと検査結果を表示）/ 'review'（レビュー用プレビュー。デモ表示・CTAはページ内のみ）/ 'commercial'（実販売。判定が通った場合だけ）
 * options.reduceMotion: true なら動きなしで描画（プレビューの「動きを減らす」）
 */
export function renderPage(project, { kind = 'review', reduceMotion = false } = {}) {
  const d = project.display;
  const issues = checkProject(project);
  const g = gates(project, issues);
  const contrast = contrastChecks(project);
  const commercial = kind === 'commercial' && g.commercialReady.ok;
  const mode = {
    draft: kind === 'draft',
    commercial,
    commercialUrl: commercial ? safeUrl(project.inputs.action.url) : '#',
    demoNotice: project.display.demoMode !== 'live' ? project.display.demoNotice : '',
  };
  const removed = [];
  const parts = [];
  for (const s of project.sections) {
    if (!hasContent(s) && s.role !== 'hero') { removed.push({ id: s.id, role: s.role, reason: '本文が無い（見出し・CTAだけを残さない）' }); continue; }
    let html = sectionHtml(project, s, mode);
    if (s.role === 'hero') {
      const notice = d.demoMode !== 'live' ? `<p class="after-notice" role="note"><b>${d.demoMode === 'synthetic-demo' ? '架空サービスのデモです。' : '試作のページです。'}</b>${phrasesHtml(d.demoNotice.replace(/^.*?デモです。|^.*?ページです。/, ''))}</p>` : '';
      const cp = s.commercialPreview ? `<div class="after-cp">${ctaHtml({ ...s, cta: null }, mode)}</div>` : '';
      const note = s.visual?.note ? `<p class="after-note">図: ${phrasesHtml(s.visual.note)}</p>` : '';
      html += `<section class="after-fv" aria-label="このページについて"><div class="sec-in">${notice}${s.body ? `<p class="lead">${e(s.body)}</p>` : ''}${note}${cp}</div></section>`;
    }
    if (!html) { removed.push({ id: s.id, role: s.role, reason: '出せる根拠が無い' }); continue; }
    parts.push(html);
  }
  const hero = project.sections.find((s) => s.role === 'hero');
  const stickyTarget = hero?.cta;
  const sticky = stickyTarget ? `<div class="sticky-cta" aria-hidden="true" inert><a href="#${e(stickyTarget.target)}">${e(stickyTarget.label)}<span class="arw" aria-hidden="true"></span></a></div>` : '';
  const demoBar = d.demoMode !== 'live' && !hero ? `<div class="demo-bar" role="note"><b>${d.demoMode === 'synthetic-demo' ? 'デモ' : '試作'}</b> ${phrasesHtml(d.demoNotice)}</div>` : '';
  const stops = issues.filter((i) => i.level === 'stop');
  const warns = issues.filter((i) => i.level === 'warn');
  const banner = kind === 'draft' ? `<div class="draft-banner" role="note">社内確認用ドラフト — 停止条件 ${stops.length} 件 / 要確認 ${warns.length} 件。${stops.slice(0, 3).map((x) => e(x.message)).join(' ／ ')}</div>` : '';
  const footer = `<footer><div class="sec-in"><b>${e(d.brandName)}</b>${d.operator ? ` ・ 運営: ${e(d.operator)}` : ''}${d.demoMode !== 'live' ? `<br>${e(d.demoNotice)}` : ''}</div></footer>`;
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${sha256Base64(HEAD_SCRIPT)}' 'sha256-${sha256Base64(RUNTIME_SCRIPT)}'; img-src data:; base-uri 'none'; form-action 'none'`;
  const robots = commercial ? '' : '<meta name="robots" content="noindex,nofollow">';
  const html = `<!doctype html>
<html lang="ja"${reduceMotion ? ' data-reduce-motion' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">${robots}
<meta name="generator" content="lp-studio v2 (${kind})">
<title>${e(d.brandName)}${d.serviceDescriptor ? `｜${e(d.serviceDescriptor)}` : ''}</title>
<script>${HEAD_SCRIPT}</script>
<style>${css(project)}</style></head>
<body data-kind="${e(kind)}" data-demo="${e(d.demoMode)}">${banner}${demoBar}
<main>${parts.join('\n')}</main>
${footer}
${sticky}
<script>${RUNTIME_SCRIPT}</script>
</body></html>`;
  return { html, report: { issues, gates: g, contrast, removed } };
}

/**
 * 書き出し。review は停止条件（コントラスト不足を含む）があれば出さない。commercial は実販売の判定が通ったときだけ。
 */
export function exportHtml(project, kind) {
  if (!['draft', 'review', 'commercial', 'safe'].includes(kind)) throw new Error('kind は draft / review / commercial');
  const k = kind === 'safe' ? 'commercial' : kind;
  const { html, report } = renderPage(project, { kind: k });
  const contrastFail = report.contrast.filter((c) => !c.ok).map((c) => `コントラスト不足: ${c.name} ${c.ratio}:1`);
  if (k === 'review' && (!report.gates.reviewPreview.ok || contrastFail.length)) return { html: null, report: { ...report, blockers: [...report.gates.reviewPreview.reasons, ...contrastFail] } };
  if (k === 'commercial' && (!report.gates.commercialReady.ok || contrastFail.length)) return { html: null, report: { ...report, blockers: [...report.gates.commercialReady.reasons, ...contrastFail] } };
  return { html, report: { ...report, blockers: [] } };
}

/** ワイヤーフレーム（同じデータ。役割・参照・検査結果を見せる） */
export function renderWireframe(project) {
  const issues = checkProject(project);
  const boxes = project.sections.map((s) => {
    const own = issues.filter((i) => i.sectionId === s.id);
    const refs = [...new Set([...s.sourceRefs, ...s.items.flatMap((i) => i.sourceRefs), ...(s.visual?.sourceRefs || [])])];
    return `<div class="box${ROLES[s.role].required ? ' req' : ''}" data-section-id="${e(s.id)}"><div class="meta"><span class="tag">${e(ROLES[s.role].label)}</span>${s.approved ? '<span class="tag ok">承認済</span>' : '<span class="tag warn">未承認</span>'}${s.needsReview ? '<span class="tag warn">要再確認</span>' : ''}<span class="tag">${e(s.origin)}</span></div>
${s.heading ? `<div class="h">${e(s.heading)}</div>` : ''}${s.body ? `<div>${e(s.body)}</div>` : ''}
${s.items.length ? `<ul>${s.items.map((it) => `<li>${e(it.heading)}${it.body ? ` — ${e(it.body)}` : ''}</li>`).join('')}</ul>` : ''}
${s.visual ? `<div class="ph">［図: ${e(s.visual.label)}（${e(s.visual.kind)}）］</div>` : ''}
${s.cta ? `<div class="cta">CTA: ${e(s.cta.label)} → #${e(s.cta.target)}</div>` : ''}${s.commercialPreview ? `<div class="cta off">無効表示: ${e(s.commercialPreview.label)}</div>` : ''}
<p class="refs">参照: ${e(refs.join(', ') || 'なし')}</p>
${own.length ? `<ul class="miss">${own.map((i) => `<li>${i.level === 'stop' ? '停止' : '要確認'}: ${e(i.message)}</li>`).join('')}</ul>` : ''}</div>`;
  });
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="robots" content="noindex,nofollow">
<title>WF: ${e(project.name)}</title><style>*,*::before,*::after{box-sizing:border-box}body{margin:0;font-family:system-ui,"Noto Sans JP",sans-serif;background:#eef0f3;color:#222;font-size:14px;line-height:1.7;padding:16px 0 40px}
.wf{max-width:760px;margin:0 auto;padding:0 12px;display:grid;gap:12px}.box{background:#fff;border:2px dashed #9aa3b2;border-radius:10px;padding:12px 14px}.box.req{border-style:solid}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}.tag{background:#e3e7ee;border-radius:4px;padding:1px 6px;font-size:12px;font-weight:700}.tag.ok{background:#1f6f5c;color:#fff}.tag.warn{background:#7a1f00;color:#fff}
.h{font-weight:800;font-size:16px}.ph{background:#dfe3ea;border-radius:6px;padding:6px 8px;margin:6px 0;font-size:13px}.cta{display:inline-block;border:2px solid #222;border-radius:8px;padding:4px 12px;font-weight:700;margin-top:6px}.cta.off{border-style:dashed;color:#666;margin-left:6px}
.refs{font-size:12px;color:#555;margin:6px 0 0;font-family:ui-monospace,monospace}.miss{font-size:12px;color:#7a1f00;margin:6px 0 0;padding-left:18px}ul{margin:4px 0;padding-left:20px}</style></head><body><div class="wf">${boxes.join('\n')}</div></body></html>`;
}
