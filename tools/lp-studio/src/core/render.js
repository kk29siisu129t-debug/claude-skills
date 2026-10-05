// 同じ project から WF / デザイン（PC・SP は同一のレスポンシブHTML）/ draft / safe を描画する。
// すべての文字列は escapeHtml を通す。URL は safeUrl、色は safeColor を通した値だけを使う。
// script はツールが持つ固定文字列だけ（ユーザー入力を含まない）で、CSP の sha256 hash を付ける。

import { escapeHtml as e, safeUrl, safeColor, contrastRatio, readableOn, inkFor, sha256Base64 } from './util.js';
import { SECTION_CATALOG, BRIEF_LABELS } from './sections.js';
import { assessText, detectClaims, containsToken, metricMatches } from './claims.js';
import { activeCta } from './model.js';

export const RUNTIME_SCRIPT = `(function(){var d=document.documentElement,b=document.body;var rm=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);var io='IntersectionObserver' in window;if(!rm&&io)d.classList.add('js');
function fmt(v,dec){return Number(v).toLocaleString('ja-JP',{minimumFractionDigits:dec,maximumFractionDigits:dec})}
var els=document.querySelectorAll('.reveal');if(rm||!io){for(var i=0;i<els.length;i++)els[i].classList.add('in')}else{var ob=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');ob.unobserve(x.target)}})},{rootMargin:'0px 0px -8% 0px'});for(var j=0;j<els.length;j++)ob.observe(els[j])}
var cs=document.querySelectorAll('[data-count]');Array.prototype.forEach.call(cs,function(el){var raw=el.getAttribute('data-count');var to=parseFloat(raw);var dec=(raw.split('.')[1]||'').length;if(rm||!io||!isFinite(to)){el.textContent=fmt(to,dec);return}el.textContent=fmt(0,dec);var o=new IntersectionObserver(function(es){if(!es[0].isIntersecting)return;o.disconnect();var t0=performance.now();function step(t){var k=Math.min(1,(t-t0)/900);el.textContent=fmt(to*(1-Math.pow(1-k,3)),dec);if(k<1)requestAnimationFrame(step)}requestAnimationFrame(step)});o.observe(el)});
var bar=document.querySelector('.cta-sticky');if(!bar)return;var timing=b.getAttribute('data-cta-timing')||'spec';var fvVis=true,half=false,inl=document.querySelectorAll('.cta-inline'),vis=[];
function upd(){var anyInline=vis.some(function(v){return v});var show=!fvVis&&!anyInline&&(timing!=='after-half'||half);bar.classList.toggle('show',show);if(show){bar.removeAttribute('inert');bar.removeAttribute('aria-hidden')}else{bar.setAttribute('inert','');bar.setAttribute('aria-hidden','true')}}
if(io){var fv=document.querySelector('.fv');if(fv)new IntersectionObserver(function(es){fvVis=es[0].isIntersecting;upd()}).observe(fv);else fvVis=false;var io2=new IntersectionObserver(function(es){es.forEach(function(x){vis[Array.prototype.indexOf.call(inl,x.target)]=x.isIntersecting});upd()});Array.prototype.forEach.call(inl,function(x,i){vis[i]=false;io2.observe(x)})}else{fvVis=false}
function onScroll(){var h=document.documentElement;half=(h.scrollTop+window.innerHeight)/Math.max(1,h.scrollHeight)>0.5;upd()}addEventListener('scroll',onScroll,{passive:true});onScroll()})();`;

const FONT_STACK = {
  sans: '"Hiragino Sans","Noto Sans JP","Yu Gothic UI","Meiryo",system-ui,sans-serif',
  serif: '"Hiragino Mincho ProN","Noto Serif JP","Yu Mincho",serif',
  rounded: '"Hiragino Maru Gothic ProN","M PLUS Rounded 1c","Noto Sans JP",system-ui,sans-serif',
};

function baseCss(project, cta) {
  const b = project.brand;
  const primary = safeColor(b.primary) || '#2f3cbe';
  const accent = safeColor(b.accent) || '#e0567a';
  const ink = safeColor(b.ink) || '#1d2230';
  const paper = safeColor(b.paper) || '#fbf8f2';
  const ctaColor = safeColor(cta.color) || '#d93d63';
  const ctaText = readableOn(ctaColor);
  const fvText = readableOn(primary);
  return `:root{--primary:${primary};--accent:${accent};--ink:${ink};--paper:${paper};--cta:${ctaColor};--cta-text:${ctaText};--fv-text:${fvText};--accent-ink:${inkFor(accent, '#f1f1f3')};--primary-ink:${inkFor(primary, '#ffffff')};--cta-ink:${inkFor(ctaColor, '#ffffff')};--font:${FONT_STACK[b.font] || FONT_STACK.sans}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--font);color:var(--ink);background:var(--paper);font-size:17.5px;line-height:34.1px;overflow-wrap:anywhere;padding-bottom:110px}
img,video{max-width:100%}
.wrap{max-width:720px;margin:0 auto;padding:0 24px}
.wide{max-width:1040px;margin:0 auto;padding:0 24px}
section{padding:88px 0;position:relative}
h1,h2,h3{line-height:1.35;margin:0 0 20px;letter-spacing:.01em}
h2{font-size:36px;font-weight:800}
h3{font-size:21px}
p{margin:0 0 18px}
.eyebrow{display:inline-block;font-size:13px;letter-spacing:.14em;font-weight:700;text-transform:uppercase;line-height:1.6;padding:4px 12px;border-radius:999px;border:1.5px solid currentColor;margin-bottom:18px}
.lead{font-size:20px;line-height:1.8;font-weight:600}
.bg-paper{background:color-mix(in srgb,var(--accent) 5%,var(--paper));background-image:radial-gradient(color-mix(in srgb,var(--ink) 7%,transparent) 1px,transparent 1.2px);background-size:22px 22px}
.bg-grid{background-color:color-mix(in srgb,var(--accent) 3%,#fff);background-image:linear-gradient(color-mix(in srgb,var(--accent) 10%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--accent) 10%,transparent) 1px,transparent 1px);background-size:30px 30px}
.fv{padding:0;overflow:hidden;background:var(--paper)}
.fv-top{background:linear-gradient(90deg,var(--primary),var(--accent));color:var(--fv-text);text-align:center;font-weight:800;font-size:22px;line-height:1.5;padding:12px 0;letter-spacing:.04em}
.fv-hero{position:relative;background:linear-gradient(180deg,#fafafa,#f1f1f3);overflow:hidden}
.fv-hero::before{content:"";position:absolute;top:0;bottom:0;right:0;width:36%;background:color-mix(in srgb,var(--ink) 9%,#ececef);clip-path:polygon(22% 0,100% 0,100% 100%,0 100%)}
.hero-grid{position:relative;display:grid;grid-template-columns:1.55fr 1fr;gap:28px;align-items:center;padding-top:34px;padding-bottom:30px}
.kicker{color:var(--accent-ink);font-weight:900;font-size:28px;line-height:1.3;margin:0 0 6px;letter-spacing:.02em}
.kicker.long{font-size:22px}
.fv h1{font-size:52px;font-weight:900;line-height:1.22;margin:0 0 16px;color:var(--ink);letter-spacing:.01em}
.fv .sub{font-weight:800;font-size:20px;line-height:1.75;color:var(--ink)}
.fv .sub p{margin:0 0 4px}
.fv-visual{position:relative;min-height:280px}
.bp-card{position:absolute;width:44%;aspect-ratio:3/4;border-radius:10px;background:linear-gradient(160deg,#fff 0 58%,color-mix(in srgb,var(--primary) 18%,#fff) 58%);box-shadow:0 14px 28px rgba(0,0,0,.18);border:1px solid color-mix(in srgb,var(--ink) 10%,transparent);padding:14px 12px;display:flex;flex-direction:column;gap:8px}
.bp-card b{font-size:13px;letter-spacing:.12em;color:var(--primary-ink);line-height:1}
.bp-card i{display:block;height:7px;border-radius:4px;background:color-mix(in srgb,var(--ink) 14%,transparent)}
.bp-card i:nth-of-type(2){width:72%}.bp-card i:nth-of-type(3){width:84%;background:color-mix(in srgb,var(--accent) 40%,transparent)}
.bp-card.c1{left:0;bottom:6%;transform:rotate(-6deg)}.bp-card.c2{left:28%;bottom:12%;transform:rotate(2deg);z-index:1}.bp-card.c3{left:56%;bottom:4%;transform:rotate(7deg)}
.bp-chip{position:absolute;left:6%;bottom:-2%;z-index:2;background:var(--ink);color:#fff;font-weight:800;font-size:15px;line-height:1.5;padding:6px 14px;border-radius:8px;max-width:90%}
.badge{text-decoration:none;position:absolute;right:16px;top:18px;z-index:3;width:138px;height:138px;border-radius:50%;display:grid;place-items:center;text-align:center;background:radial-gradient(circle,#fff 0 56%,transparent 57%),repeating-conic-gradient(var(--accent) 0 10deg,color-mix(in srgb,var(--accent) 70%,#fff) 10deg 20deg);box-shadow:0 8px 20px rgba(0,0,0,.18);color:var(--ink);font-weight:900;line-height:1.15;font-size:13px}
.badge strong{display:block;font-size:30px;color:var(--accent-ink)}
.fv-offer{position:relative;background:linear-gradient(90deg,var(--primary),var(--accent));color:var(--fv-text);padding:20px 0 14px;text-align:center}
.fv-offer::before,.fv-offer::after{content:"✦";position:absolute;font-size:14px;opacity:.6}.fv-offer::before{left:6%;top:38%}.fv-offer::after{right:9%;top:60%}
.offer-row{display:flex;align-items:center;justify-content:center;gap:22px;flex-wrap:wrap}
.offer-tag{display:inline-block;background:color-mix(in srgb,var(--ink) 75%,#5a0f0f);color:#fff;font-weight:800;font-size:15px;line-height:1.5;padding:10px 26px;clip-path:polygon(6% 0,100% 0,94% 100%,0 100%)}
.offer-big{font-size:44px;font-weight:900;line-height:1.25;letter-spacing:.02em}
.fv-offer .cta-inline{margin:16px auto 4px}
.scroll-hint{display:block;font-size:22px;line-height:1;opacity:.75}
.cta-inline{display:flex;align-items:center;justify-content:center;gap:14px;min-height:76px;width:100%;max-width:600px;padding:12px 28px;border-radius:999px;background:#fff;color:var(--cta-ink);font-weight:900;font-size:24px;line-height:1.35;text-decoration:none;box-shadow:0 12px 26px rgba(0,0,0,.18);margin:28px 0 8px}
.cta-ico{flex:none;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--cta),color-mix(in srgb,var(--cta) 55%,var(--accent)));position:relative}
.cta-ico::after{content:"";position:absolute;left:15px;top:12px;border-left:13px solid #fff;border-top:8px solid transparent;border-bottom:8px solid transparent}
.on-light .cta-inline{background:var(--cta);color:var(--cta-text)}
.on-light .cta-ico{background:#fff}.on-light .cta-ico::after{border-left-color:var(--cta)}
.cta-inline:focus-visible,.cta-sticky a:focus-visible{outline:3px solid #ffbf00;outline-offset:3px}
.cta-inline::after{content:"›";font-weight:900;font-size:1.3em;line-height:1}
.cta-note{font-size:13px;line-height:1.7}
.cta-sticky{position:fixed;right:24px;bottom:24px;width:340px;height:66px;z-index:50;visibility:hidden;opacity:0;transform:translateY(12px);transition:opacity .35s,transform .35s,visibility .35s}
.cta-sticky.show{visibility:visible;opacity:1;transform:none}
.cta-sticky a{display:flex;align-items:center;justify-content:center;gap:12px;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--cta),color-mix(in srgb,var(--cta) 70%,var(--accent)));color:var(--cta-text);font-weight:800;font-size:18px;line-height:1.3;text-decoration:none;box-shadow:0 12px 30px rgba(0,0,0,.25);padding:0 20px;text-align:center}
.cta-sticky .cta-ico{width:30px;height:30px;background:#fff}.cta-sticky .cta-ico::after{left:11px;top:8px;border-left:10px solid var(--cta);border-top:7px solid transparent;border-bottom:7px solid transparent}
.cta-sticky a::after{content:"›";font-size:1.3em;line-height:1}
.cards{display:grid;gap:16px}
.card{background:#fff;border-radius:18px;padding:22px 24px;box-shadow:0 1px 0 color-mix(in srgb,var(--ink) 10%,transparent),0 8px 24px color-mix(in srgb,var(--ink) 7%,transparent);border:1px solid color-mix(in srgb,var(--ink) 8%,transparent)}
.bubble{position:relative;font-weight:600}
.bubble::before{content:"“";color:var(--accent);font-size:34px;line-height:0;vertical-align:-12px;margin-right:6px;font-weight:900}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.compare .col{border-radius:18px;padding:22px}
.compare .before{background:color-mix(in srgb,var(--ink) 6%,#fff)}
.compare .after{background:color-mix(in srgb,var(--primary) 12%,#fff);border:2px solid var(--primary)}
.compare h3{font-size:16px;letter-spacing:.1em;color:var(--ink)}
ul.plain{list-style:none;padding:0;margin:0}
ul.plain li{padding:10px 0;border-bottom:1px dashed color-mix(in srgb,var(--ink) 18%,transparent)}
ol.steps{list-style:none;padding:0;margin:0;counter-reset:s;display:grid;gap:28px}
.ncard{counter-increment:s;position:relative;overflow:hidden;background:#fff;border-radius:6px;padding:34px 36px 30px;box-shadow:0 18px 40px color-mix(in srgb,var(--accent) 16%,rgba(0,0,0,.08))}
.ncard::before{content:counter(s,decimal-leading-zero);position:absolute;right:18px;top:-14px;font-size:96px;font-weight:900;line-height:1;color:color-mix(in srgb,var(--accent) 12%,#fff);z-index:0}
.ncard h3{position:relative;z-index:1;display:flex;gap:10px;align-items:flex-start;font-size:22px;line-height:1.5;margin:0;padding-bottom:16px;border-bottom:2px dotted color-mix(in srgb,var(--ink) 18%,transparent)}
.ncard h3::before{content:"✓";flex:none;width:28px;height:28px;margin-top:3px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff;font-size:15px;line-height:1}
.ncard h3:only-child{border-bottom:0;padding-bottom:0}
.ncard .nbody{position:relative;z-index:1;padding-top:14px}
.yes li::before{content:"✓ ";color:var(--primary-ink);font-weight:900}
.no li::before{content:"— ";color:var(--ink);font-weight:900}
.band{background:linear-gradient(120deg,color-mix(in srgb,var(--primary) 92%,#000),var(--accent));color:var(--fv-text)}
.proof-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}
.metric{font-size:44px;font-weight:900;line-height:1.1;color:var(--primary-ink);display:block;margin-bottom:6px}
.metric small{font-size:18px;margin-left:4px}
.src{font-size:13px;line-height:1.6;display:block;margin-top:8px}
.closing{text-align:left}
footer{padding:40px 0 30px;font-size:13px;line-height:1.8;background:color-mix(in srgb,var(--ink) 92%,#000);color:#f4f4f4}
.reveal{transition:opacity .7s ease,transform .7s ease}
.js .reveal{opacity:0;transform:translateY(18px)}
.js .reveal.in{opacity:1;transform:none}
.js .fv .stage{opacity:0;animation:rise .8s cubic-bezier(.2,.7,.2,1) forwards}
.js .fv .s1{animation-delay:.05s}.js .fv .s2{animation-delay:.2s;animation-duration:.6s}.js .fv .s3{animation-delay:.35s;animation-duration:.7s}.js .fv .s4{animation-delay:.5s;animation-duration:.9s}
@keyframes rise{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.js .reveal,.js .fv .stage{opacity:1!important;transform:none!important}}
.flag{background:repeating-linear-gradient(45deg,#fff3b0,#fff3b0 6px,#ffe58a 6px,#ffe58a 12px);color:#3b2f00;border-radius:4px;padding:0 3px}
.flag-tag{display:inline-block;font-size:11px;line-height:1.5;font-weight:800;background:#7a1f00;color:#fff;border-radius:4px;padding:0 5px;margin-left:4px;vertical-align:2px}
.draft-banner{position:sticky;top:0;z-index:60;background:#7a1f00;color:#fff;font-size:13px;line-height:1.6;padding:8px 16px;text-align:center}
@media (max-width:600px){
body{font-size:16px;line-height:31.2px}
.wrap,.wide{padding:0 18px}
section{padding:64px 0}
h2{font-size:30px}
.fv-top{font-size:15px;padding:9px 12px}
.fv-hero::before{width:44%;top:auto;height:58%}
.hero-grid{display:block;padding-top:22px;padding-bottom:18px}
.kicker{font-size:21px;margin-bottom:6px;padding-right:100px}
.kicker.long{font-size:17px;line-height:1.5}
.fv h1{font-size:38px;line-height:1.2;margin-bottom:10px;padding-right:0}
.fv .sub{font-size:16px;line-height:1.7}
.fv-visual{min-height:118px;margin-top:16px}
.bp-card{width:24%;padding:8px 7px;gap:5px}.bp-card b{font-size:10px}.bp-card i{height:5px}
.bp-card.c1{left:0;bottom:4%}.bp-card.c2{left:17%;bottom:10%}.bp-card.c3{left:34%;bottom:2%}
.bp-chip{left:auto;right:0;bottom:6%;font-size:13px;max-width:48%}
.badge{text-decoration:none;position:absolute;right:12px;top:14px;width:96px;height:96px;font-size:10px}.badge strong{font-size:21px}
.hero-grid{position:static}.fv-hero{position:relative}
.fv-offer{padding:16px 0 12px}
.offer-row{gap:10px;flex-direction:column}
.offer-tag{display:block;width:100%;font-size:14px;padding:7px 14px;clip-path:polygon(2% 0,100% 0,98% 100%,0 100%)}
.offer-big{font-size:30px}
.cta-inline{font-size:19px;min-height:62px;margin-top:12px;padding:10px 18px;gap:10px}.cta-ico{width:34px;height:34px}.cta-ico::after{left:13px;top:10px;border-left-width:11px;border-top-width:7px;border-bottom-width:7px}.ncard{padding:26px 20px 22px}.ncard h3{font-size:20px}.ncard::before{font-size:76px}
.compare{grid-template-columns:1fr}
.metric{font-size:38px}
.cta-sticky{left:12px;right:12px;bottom:10px;width:auto;height:54px}
.cta-sticky a{font-size:16px}
body{padding-bottom:84px}
}`;
}

function wfCss() {
  return `*,*::before,*::after{box-sizing:border-box}body{margin:0;font-family:system-ui,"Noto Sans JP",sans-serif;background:#eef0f3;color:#222;font-size:15px;line-height:1.7;overflow-wrap:anywhere;padding:16px 0 40px}
.wf{max-width:760px;margin:0 auto;padding:0 12px;display:grid;gap:12px}
.box{background:#fff;border:2px dashed #9aa3b2;border-radius:10px;padding:14px 16px}
.box.req{border-style:solid}
.meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;font-size:12px}
.tag{background:#e3e7ee;border-radius:4px;padding:1px 6px;font-weight:700}
.tag.req{background:#2f3cbe;color:#fff}.tag.ok{background:#1f6f5c;color:#fff}.tag.warn{background:#7a1f00;color:#fff}
.role{font-size:12px;color:#555;margin:0 0 8px}
.h{font-weight:800;font-size:18px;margin:4px 0}
.ph{background:#dfe3ea;border-radius:6px;padding:6px 8px;color:#444;font-size:13px;margin:6px 0}
.cta{display:inline-block;border:2px solid #222;border-radius:999px;padding:6px 16px;font-weight:700;margin-top:6px}
.miss{font-size:12px;color:#7a1f00;margin:6px 0 0;padding-left:18px}
.flag{background:#fff3b0;border-radius:3px}
ul{margin:4px 0;padding-left:20px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}@media (max-width:600px){.two{grid-template-columns:1fr}}`;
}

// ---------------- テキスト評価と描画 ----------------

function renderInline(project, section, raw, kind, ctx) {
  const a = assessText(project, section, raw);
  if (kind === 'safe') {
    if (!a.publishable) {
      ctx.removed.push({ section: SECTION_CATALOG[section.type].label, text: a.text.slice(0, 60), reasons: reasonsOf(a) });
      return null;
    }
    return e(a.text);
  }
  if (a.publishable) return e(a.text);
  const why = reasonsOf(a).join(' / ');
  return `<span class="flag" title="${e(why)}">${e(a.text)}</span><span class="flag-tag">未確認</span>`;
}

function reasonsOf(a) {
  const r = [];
  if (a.placeholder) r.push('要記入が残っている');
  for (const t of a.unresolvedTokens) r.push(`${BRIEF_LABELS[t.key] || t.key}が${t.reason === 'unconfirmed' ? '未確定' : '未入力'}`);
  for (const c of a.claims.filter((x) => !x.resolved)) r.push(`${c.label}「${c.match}」の根拠なし`);
  return r;
}

function paragraphs(html) {
  if (html == null) return '';
  return html.split(/\n+/).filter(Boolean).map((p) => `<p>${p}</p>`).join('');
}

function list(project, s, key, kind, ctx) {
  return (s.fields[key] || []).map((v) => renderInline(project, s, v, kind, ctx)).filter((x) => x != null);
}

function ctaInline(ctaInfo, note = '') {
  return `<a class="cta-inline" href="${e(ctaInfo.href)}"${ctaInfo.external ? ' rel="noopener noreferrer"' : ''}><span class="cta-ico" aria-hidden="true"></span><span>${ctaInfo.labelHtml}</span></a>${note}`;
}

// 検証済みでも、参考LP固有値・薬機法語彙を含む根拠や、同意の無い推薦は公開しない
export function evidencePublishable(project, ev) {
  if (ev.status !== 'verified') return { ok: false, reason: '未検証の根拠' };
  const claims = [ev.claim, ev.source, ev.metricUnit].flatMap((t) => detectClaims(t, project.brief.category));
  const block = claims.find((c) => c.severity === 'block');
  if (block) return { ok: false, reason: `${block.label}「${block.match}」を含む` };
  if (claims.some((c) => c.category === 'testimonial') && ev.sourceType !== 'customer-consent') return { ok: false, reason: '推薦・声は本人同意（customer-consent）の出典が必要' };
  if (ev.metricValue != null && !metricMatches(ev.claim, ev.metricValue, ev.metricUnit)) return { ok: false, reason: '数値・単位が主張文と一致しない' };
  return { ok: true };
}

// FVのバッジ: 根拠セクションが参照する verified かつ数値付きの evidence がある場合だけ出す（未検証の実績は出さない）
function fvBadge(project, kind) {
  const proof = project.sections.find((x) => x.type === 'proof' && (kind !== 'safe' || x.approved));
  if (!proof) return '';
  const ev = project.evidence.find((x) => proof.claimRefs.includes(x.id) && Number.isFinite(x.metricValue) && evidencePublishable(project, x).ok);
  if (!ev) return '';
  return `<a class="badge stage s4" href="#s-${e(proof.id)}" aria-label="${e(ev.claim)}（根拠へ）"><span><strong>${e(ev.metricValue.toLocaleString('ja-JP'))}</strong>${e(ev.metricUnit)}<br>根拠あり</span></a>`;
}

function sectionHtml(project, s, kind, ctx, ctaInfo, bgIndex) {
  const t = s.type;
  const F = (k) => (s.fields[k] ? renderInline(project, s, s.fields[k], kind, ctx) : null);
  const heading = F('heading');
  const lead = F('lead');
  const body = F('body');
  const note = F('note');
  const items = list(project, s, 'items', kind, ctx);
  const alt = list(project, s, 'itemsAlt', kind, ctx);
  const bg = bgIndex % 2 === 0 ? 'bg-paper' : 'bg-grid';
  const h2 = heading ? `<h2>${heading}</h2>` : '';
  const leadP = lead ? `<p class="lead">${lead}</p>` : '';
  const noteP = note ? `<p class="src">${note}</p>` : '';
  const anchor = `id="s-${e(s.id)}"`;
  let content = '';
  switch (t) {
    case 'fv': {
      const top = project.brief.audience.value ? renderInline(project, s, '{{audience}}へ', kind, ctx) : null;
      const product = project.brief.product.value ? renderInline(project, s, '{{product}}', kind, ctx) : null;
      const offer = project.brief.offer.value ? renderInline(project, s, '{{offer}}', kind, ctx) : null;
      const badge = fvBadge(project, kind);
      return `<header class="fv" ${anchor}>
${top ? `<div class="fv-top stage s1"><div class="wide">${top}</div></div>` : ''}
<div class="fv-hero"><div class="wide hero-grid"><div class="copy">
${lead ? `<p class="kicker stage s1${lead.replace(/<[^>]+>/g, '').length > 26 ? ' long' : ''}">${lead}</p>` : ''}
${heading ? `<h1 class="stage s2">${heading}</h1>` : ''}
${body ? `<div class="sub stage s3">${paragraphs(body)}</div>` : ''}
</div><div class="fv-visual stage s3" aria-hidden="true">
<div class="bp-card c1"><b>01</b><i></i><i></i><i></i></div><div class="bp-card c2"><b>02</b><i></i><i></i><i></i></div><div class="bp-card c3"><b>03</b><i></i><i></i><i></i></div>
${product ? `<span class="bp-chip">${product}</span>` : ''}</div>${badge}</div></div>
<div class="fv-offer stage s4"><div class="wide"><div class="offer-row"><span class="offer-tag">今回のご案内</span>${offer ? `<span class="offer-big">${offer}</span>` : ''}</div>
${ctaInline(ctaInfo)}<span class="scroll-hint" aria-hidden="true">⌄</span></div></div></header>`;
    }
    case 'concept_video':
      content = `${h2}${leadP}<div class="card" role="note">${body ? paragraphs(body) : ''}</div>`;
      break;
    case 'empathy':
      content = `${h2}${leadP}${body ? paragraphs(body) : ''}<div class="cards">${items.map((i) => `<div class="card bubble reveal">${i}</div>`).join('')}</div>`;
      break;
    case 'reframe':
      content = `${h2}${leadP}${body ? paragraphs(body) : ''}${items.length || alt.length ? `<div class="compare reveal"><div class="col before"><h3>これまで</h3><ul class="plain">${items.map((i) => `<li>${i}</li>`).join('')}</ul></div><div class="col after"><h3>これから</h3><ul class="plain">${alt.map((i) => `<li>${i}</li>`).join('')}</ul></div></div>` : ''}`;
      break;
    case 'steps':
      content = `${h2}${leadP}${body ? paragraphs(body) : ''}<ol class="steps">${items.map((i) => `<li class="ncard reveal"><h3>${i}</h3></li>`).join('')}</ol>`;
      break;
    case 'scope':
    case 'fit': {
      const [a, b] = t === 'scope' ? ['含まれるもの', '含まれないもの'] : ['向いている人', '向いていない人'];
      content = `${h2}${leadP}${body ? paragraphs(body) : ''}<div class="compare reveal"><div class="col after"><h3>${a}</h3><ul class="plain yes">${items.map((i) => `<li>${i}</li>`).join('')}</ul></div><div class="col before"><h3>${b}</h3><ul class="plain no">${alt.map((i) => `<li>${i}</li>`).join('')}</ul></div></div>`;
      break;
    }
    case 'recommit':
      return `<section class="band" ${anchor}><div class="wrap reveal">${h2}${leadP}${body ? paragraphs(body) : ''}${ctaInline(ctaInfo)}</div></section>`;
    case 'proof': {
      const refs = new Set(s.claimRefs);
      const all = project.evidence.filter((x) => refs.has(x.id));
      const evs = all.filter((x) => kind !== 'safe' || evidencePublishable(project, x).ok);
      const cards = evs.map((ev) => {
        const pub = evidencePublishable(project, ev);
        const flagged = !pub.ok;
        const metric = Number.isFinite(ev.metricValue)
          ? (flagged ? `<span class="metric">${e(String(ev.metricValue))}<small>${e(ev.metricUnit)}</small></span>`
            : `<span class="metric"><span data-count="${e(String(ev.metricValue))}">${e(String(ev.metricValue))}</span><small>${e(ev.metricUnit)}</small></span>`)
          : '';
        const claimHtml = flagged ? `<span class="flag" title="${e(pub.reason)}">${e(ev.claim)}</span><span class="flag-tag">${ev.status === 'verified' ? '公開不可' : '未検証'}</span>` : e(ev.claim);
        return `<div class="card reveal">${metric}<div>${claimHtml}</div><span class="src">出典: ${e(ev.source)}${flagged ? '' : `（確認 ${e(ev.verifiedAt)}）`}</span></div>`;
      });
      ctx.proofCount = evs.length;
      if (kind === 'safe') {
        for (const ev of all.filter((x) => !evidencePublishable(project, x).ok)) ctx.removed.push({ section: '根拠', text: ev.claim.slice(0, 60), reasons: [evidencePublishable(project, ev).reason] });
      }
      content = `${h2}${leadP}${body ? paragraphs(body) : ''}<div class="proof-grid">${cards.join('')}</div>`;
      break;
    }
    case 'closing':
      return `<section class="band closing" ${anchor}><div class="wrap reveal">${h2}${leadP}${body ? paragraphs(body) : ''}${ctaInline(ctaInfo, noteP)}</div></section>`;
    case 'footer':
      return `<footer ${anchor}><div class="wrap">${body ? paragraphs(body) : ''}${noteP}</div></footer>`;
    default:
      content = `${h2}${leadP}${body ? `<div class="reveal">${paragraphs(body)}</div>` : ''}`;
  }
  return `<section class="${bg}" ${anchor}><div class="wrap">${content}${t === 'concept_video' ? '' : noteP}</div></section>`;
}

function sectionHasContent(s, html) {
  if (s.type === 'proof') return /class="card/.test(html);
  return /<(h1|h2|p|li|div class="card)/.test(html.replace(/<span class="eyebrow[^]*?<\/span>/, ''));
}

function resolveCta(project, kind, ctx, variantId) {
  const base = variantId ? project.cta.variants.find((v) => v.id === variantId) : null;
  const v = base ? { ...base, label: base.label || project.brief.ctaLabel.value } : activeCta(project);
  const url = safeUrl(project.brief.ctaUrl.value);
  const urlOk = url && project.brief.ctaUrl.status === 'confirmed';
  const labelFromBrief = !(base ? base.label : project.cta.variants.find((x) => x.id === project.cta.activeVariant)?.label);
  const labelOk = v.label && (!labelFromBrief || project.brief.ctaLabel.status === 'confirmed');
  // CTA を置くセクション（FV・再コミット・クロージング）が参照する verified 根拠だけで照合
  const ctaRefs = new Set(project.sections.filter((s) => ['fv', 'recommit', 'closing'].includes(s.type)).flatMap((s) => s.claimRefs));
  const verified = project.evidence.filter((x) => x.status === 'verified' && ctaRefs.has(x.id));
  const labelClaims = detectClaims(v.label, project.brief.category).filter((c) => c.severity === 'block' || !verified.some((ev) => containsToken(ev.claim, c.match)));
  if (kind === 'safe') {
    if ((v.timing || 'spec') !== 'spec') ctx.blockers.push('固定CTAの表示タイミングが仕様（FV後に表示）ではありません。比較用の案は公開用に使えません');
    if (!urlOk) ctx.blockers.push('CTAリンク先が確定していない、または許可されないURLです');
    if (!labelOk) ctx.blockers.push('CTA文言が確定していません');
    if (labelClaims.length) ctx.blockers.push(`CTA文言に根拠の無い主張: ${labelClaims.map((c) => c.match).join(', ')}`);
  }
  const ok = urlOk && labelOk && !labelClaims.length;
  const labelHtml = ok || kind === 'safe' ? e(v.label || 'CTA') : `<span class="flag">${e(v.label || '【CTA文言 未入力】')}</span><span class="flag-tag">未確認</span>`;
  return { href: url || '#', external: !!url && url.startsWith('https:'), labelHtml, variant: v };
}

function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v * (1 - t) + pb[i] * t).toString(16).padStart(2, '0')).join('');
}

export function contrastChecks(project, variant) {
  const b = project.brand;
  const fvText = readableOn(b.primary);
  const ctaText = readableOn(variant.color);
  return [
    { name: '本文（ink / paper）', ratio: contrastRatio(b.ink, b.paper) },
    { name: '本文（ink / 白カード）', ratio: contrastRatio(b.ink, '#ffffff') },
    { name: 'FV見出し（ink / 淡色面）', ratio: contrastRatio(b.ink, '#f1f1f3') },
    { name: `CTA「${variant.id}」固定バー 文字 / 背景`, ratio: contrastRatio(ctaText, variant.color) },
    { name: `CTA「${variant.id}」固定バー 文字 / グラデーション終端`, ratio: contrastRatio(ctaText, mixHex(variant.color, b.accent, 0.3)) },
    { name: `CTA「${variant.id}」白ピル 文字`, ratio: contrastRatio(inkFor(variant.color, '#ffffff'), '#ffffff') },
    { name: '数値・強調（primary系 / 白）', ratio: contrastRatio(inkFor(b.primary, '#ffffff'), '#ffffff') },
    { name: '小見出し（accent系 / 淡色面）', ratio: contrastRatio(inkFor(b.accent, '#f1f1f3'), '#f1f1f3') },
    { name: '比較カード（ink / primary淡色）', ratio: contrastRatio(b.ink, mixHex(b.primary, '#ffffff', 0.88)) },
    { name: '上部帯・オファー帯の文字', ratio: Math.min(contrastRatio(fvText, b.primary), contrastRatio(fvText, b.accent)) },
  ].map((c) => ({ ...c, ok: c.ratio >= 4.5 }));
}

/**
 * kind: 'preview'（編集中の確認。未確認は旗付き）/ 'draft'（レビュー用export。バナー+noindex）/ 'safe'（公開可能なものだけ）
 * view: 'design' | 'wf'
 */
export function renderPage(project, { kind = 'preview', view = 'design', ctaVariantId = null } = {}) {
  const ctx = { removed: [], blockers: [], warnings: [], proofCount: 0 };
  if (view === 'wf') return { html: renderWireframe(project), report: ctx };
  const ctaInfo = resolveCta(project, kind, ctx, ctaVariantId);
  const variant = ctaInfo.variant;
  const contrast = contrastChecks(project, variant);
  for (const c of contrast.filter((x) => !x.ok)) {
    (kind === 'safe' ? ctx.blockers : ctx.warnings).push(`コントラスト不足: ${c.name} ${c.ratio}:1（4.5:1 以上が必要）`);
  }
  const parts = [];
  let bgIndex = 0;
  for (const s of project.sections) {
    const meta = SECTION_CATALOG[s.type];
    if (kind === 'safe' && !s.approved) {
      if (meta.required) ctx.blockers.push(`必須セクション「${meta.label}」が未承認です`);
      else ctx.removed.push({ section: meta.label, text: '(セクション全体)', reasons: ['未承認'] });
      continue;
    }
    const html = sectionHtml(project, s, kind, ctx, ctaInfo, s.type === 'fv' ? 0 : bgIndex++);
    if (kind === 'safe' && !sectionHasContent(s, html)) {
      if (meta.required) ctx.blockers.push(`必須セクション「${meta.label}」に公開できる内容がありません`);
      else ctx.removed.push({ section: meta.label, text: '(セクション全体)', reasons: ['公開できる内容なし'] });
      continue;
    }
    if (kind === 'safe' && !['fv', 'footer', 'proof'].includes(s.type) && !/<(p|li|div class="card)/.test(html.replace(/<h2>[^]*?<\/h2>/, ''))) {
      ctx.warnings.push(`「${meta.label}」は見出しだけが公開されます（本文が除外されたか未入力）`);
    }
    parts.push(html);
  }
  if (kind === 'safe') {
    for (const t of Object.keys(SECTION_CATALOG).filter((t) => SECTION_CATALOG[t].required)) {
      if (!project.sections.some((s) => s.type === t)) ctx.blockers.push(`必須セクション「${SECTION_CATALOG[t].label}」がありません`);
    }
    if (project.brief.operator.status !== 'confirmed') ctx.blockers.push('運営者表記が確定していません');
    const nameCheck = assessText(project, { claimRefs: [] }, project.name);
    if (!nameCheck.publishable) ctx.blockers.push(`ページタイトル（プロジェクト名）に根拠の無い主張・未確定の値があります: ${reasonsOf(nameCheck).join(' / ')}`);
  }
  const scriptHash = sha256Base64(RUNTIME_SCRIPT);
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; img-src data:; base-uri 'none'; form-action 'none'`;
  const banner = kind === 'draft' ? '<div class="draft-banner" role="note">レビュー用ドラフト — 未確認の内容（旗付き）を含みます。公開しないでください。</div>' : '';
  const robots = kind === 'safe' ? '' : '<meta name="robots" content="noindex,nofollow">';
  const timing = variant.timing || 'spec';
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">${robots}
<meta name="generator" content="lp-studio (${kind})">
<title>${e(project.name)}</title><style>${baseCss(project, variant)}</style></head>
<body data-cta-timing="${e(timing)}" data-kind="${e(kind)}">${banner}
<main>${parts.join('\n')}</main>
<div class="cta-sticky" aria-hidden="true" inert><a href="${e(ctaInfo.href)}"${ctaInfo.external ? ' rel="noopener noreferrer"' : ''}><span class="cta-ico" aria-hidden="true"></span><span>${ctaInfo.labelHtml}</span></a></div>
<script>${RUNTIME_SCRIPT}</script>
</body></html>`;
  return { html, report: { ...ctx, contrast, publishable: kind === 'safe' ? ctx.blockers.length === 0 : false } };
}

/** export。safe はブロッカーがあれば HTML を返さない（fail-closed）。 */
export function exportHtml(project, kind) {
  if (!['draft', 'safe'].includes(kind)) throw new Error('kind は draft か safe');
  const { html, report } = renderPage(project, { kind });
  if (kind === 'safe' && !report.publishable) return { html: null, report };
  return { html, report };
}

// ---------------- WF ----------------

function renderWireframe(project) {
  const cta = activeCta(project);
  const boxes = project.sections.map((s) => {
    const meta = SECTION_CATALOG[s.type];
    const fieldHtml = (raw) => {
      const a = assessText(project, s, raw);
      return a.publishable ? e(a.text) : `<span class="flag" title="${e(reasonsOf(a).join(' / '))}">${e(a.text)}</span>`;
    };
    const f = s.fields;
    const listHtml = (arr) => (arr.length ? `<ul>${arr.map((v) => `<li>${fieldHtml(v)}</li>`).join('')}</ul>` : '');
    const missing = [];
    for (const k of meta.needs) {
      const b = project.brief[k];
      if (b.status !== 'confirmed') missing.push(`${BRIEF_LABELS[k]}（${b.status === 'missing' ? '未入力' : '未確定'}）`);
    }
    const tags = [
      `<span class="tag">${e(meta.label)}</span>`,
      meta.required ? '<span class="tag req">必須</span>' : '<span class="tag">任意</span>',
      s.approved ? '<span class="tag ok">承認済</span>' : '<span class="tag warn">未承認</span>',
      s.needsReview ? '<span class="tag warn">要再確認</span>' : '',
      `<span class="tag">${e(s.origin)}</span>`,
    ].join('');
    const visual = s.type === 'fv' ? '<div class="ph">［ビジュアル枠］PC: 右カラム / SP: 見出しの下にチップ列で再配置</div>' : '';
    const ctaBox = ['fv', 'recommit', 'closing'].includes(s.type) ? `<div class="cta">CTA: ${e(cta.label || '未入力')}</div>` : '';
    const proof = s.type === 'proof'
      ? `<div class="ph">根拠カード: 参照 ${s.claimRefs.length} 件 / うち検証済み ${project.evidence.filter((x) => s.claimRefs.includes(x.id) && x.status === 'verified').length} 件</div>` : '';
    return `<div class="box${meta.required ? ' req' : ''}" data-section-id="${e(s.id)}"><div class="meta">${tags}</div><p class="role">役割: ${e(meta.role)}</p>
${f.heading ? `<div class="h">${fieldHtml(f.heading)}</div>` : ''}${f.lead ? `<div>${fieldHtml(f.lead)}</div>` : ''}${f.body ? `<div>${fieldHtml(f.body)}</div>` : ''}
${f.items.length || f.itemsAlt.length ? `<div class="two"><div>${listHtml(f.items)}</div><div>${listHtml(f.itemsAlt)}</div></div>` : ''}
${visual}${proof}${ctaBox}${missing.length ? `<ul class="miss">${missing.map((m) => `<li>不足: ${e(m)}</li>`).join('')}</ul>` : ''}</div>`;
  });
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="robots" content="noindex,nofollow">
<title>WF: ${e(project.name)}</title><style>${wfCss()}</style></head><body><div class="wf">${boxes.join('\n')}</div></body></html>`;
}
