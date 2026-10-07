#!/usr/bin/env node
// PASSLABO「共テ数学 時短戦略」特別講義（2026/10/17）: 未公開の確認用 LP（案A、元ページ https://utage-system.com/page/wIz60jkrqkDj の改善案）。
//   FONT_PKG=<@fontsource/noto-sans-jp の package/> node build.mjs  … out/passlabo-timestrategy.html
// - 事実は REVIEW.md の出典表の範囲だけ（元ページの公開本文と、確認済みのイベント条件）。成果保証・録画・限定人数・配布物の追加はしない
// - 申込は LINE への通常リンク（https://lin.ee/rTgblIH）。自動遷移・計測・フォーム送信は無い。JS は追従 CTA と S 字の表示だけ
// - 画像はリポジトリにある正規取得済みの素材だけ（本人 v3 透過写真、PASSLABO 公開教材の板書、講師プロフィール写真）。生成・加工しない
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const A = (f) => join(root, '../passlabo-fv-variants/assets', f);
const uri = (p, mime) => `data:${mime};base64,${readFileSync(p).toString('base64')}`;
const portrait = uri(A('portrait-retouched-v3.png'), 'image/png');
const board = uri(A('board-from-current-lp.webp'), 'image/webp');
const profile = uri(A('profile-circle-from-current-lp.webp'), 'image/webp');

export const LINE = 'https://lin.ee/rTgblIH';
const lineIcon = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.2.9c0 .3-.2 1 .9.5s6-3.5 8.2-6.1c1.5-1.6 2-3.1 2-4.7C22 6.6 17.5 3 12 3z"/></svg>`;
const cta = (cls) => `<a class="cta ${cls}" href="${LINE}" rel="noopener">${lineIcon}<span>LINEで参加申込へ進む</span></a>`;
const ctaNote = `<p class="cta-note">※LINE（PASSLABO 公式アカウント）に移動します。参加申込は LINE 内で行います。</p>`;

// S 字の矢印（承認済みの形。参照 IMG_7510 を 400px 換算で採寸）
const S_PATH = 'M14 0V90C14 162 142 150 142 250C142 274 139 287 132 298';
const scurve = `<div class="ts-s" aria-hidden="true"><svg class="ts-s-svg" viewBox="0 0 170 340" width="170" height="340" focusable="false"><path class="ts-s-path" d="${S_PATH}"/><polygon class="ts-s-head" points="-2,-28 46,0 -2,28" transform="translate(132 298) rotate(122.5)"/></svg></div>`;

const BODY = `
<header class="ts-fv" aria-label="ファーストビュー">
  <div class="ts-fv-in">
    <p class="ts-brand">PASSLABO <span>無料特別講義</span></p>
    <p class="ts-target">共テ数学で、時間が足りない人へ</p>
    <h1 class="ts-h1"><span class="ts-h1-a">共テ数学</span><span class="ts-h1-b">時間内に<br>解き切るための<br>考え方を学ぶ</span></h1>
    <p class="ts-fv-sub">共通テスト形式の問題で、<br>時間短縮の考え方を実戦解説する2時間。</p>
    <figure class="ts-fv-person"><img src="${portrait}" alt="講師の宇佐見天彗さん" width="1330" height="1183"></figure>
    <p class="ts-fv-name"><span>講師</span>宇佐見 天彗</p>
  </div>
  <div class="ts-fv-offer">
    <dl class="ts-when">
      <div><dt>日時</dt><dd><b>10/17</b>（土）<b>20:00〜22:00</b></dd></div>
      <div><dt>形式</dt><dd>オンライン（Zoom）・<b>参加無料</b></dd></div>
    </dl>
    ${cta('ts-cta ts-cta-fv')}
    ${ctaNote}
  </div>
</header>

<main class="ts-main">
  <section class="ts-sec ts-what" aria-labelledby="h-what">
    <div class="ts-in">
      <p class="ts-kicker">2時間の講義で扱うこと</p>
      <h2 id="h-what" class="ts-h2">共テ数学の問題で、<br>時間を短くできる場所を<br class="sp">実戦で解説。</h2>
      <ol class="ts-points">
        <li><span class="ts-no">01</span><div><h3>問題文・誘導・選択肢の着眼点</h3><p>問題のどこに、時短のヒントが隠れているか。</p></div></li>
        <li><span class="ts-no">02</span><div><h3>解く処理の選び方</h3><p>真正面から解くところと、そうでないところの判断。</p></div></li>
        <li><span class="ts-no">03</span><div><h3>計算・判断の負荷を減らす工夫</h3><p>計算・判断・思考の負荷を減らす、実戦の工夫。</p></div></li>
      </ol>
      <figure class="ts-board">
        <img src="${board}" alt="PASSLABO の公開教材の板書。二次関数のグラフを描き、式を変形しながら解説している" width="628" height="570">
        <figcaption><b>板書の例：グラフと式を行き来しながら、解き進める過程を追う。</b><span>PASSLABO の公開教材より・2024年本試の解説例。10/17 の講義で扱う問題・配布物ではありません。</span></figcaption>
      </figure>
    </div>
  </section>

  <section class="ts-sec ts-feel" aria-labelledby="h-feel">
    <div class="ts-in">
      <h2 id="h-feel" class="ts-feel-h">家では解けるのに、<br>本番形式では<br>最後まで届かない。</h2>
      <ul class="ts-feel-list">
        <li>1問に時間をかけすぎてしまう</li>
        <li>焦るとミスが一気に増える</li>
        <li>後半の大問までたどり着かない</li>
      </ul>
      <p class="ts-feel-p">その原因は、“数学力”だけではないかもしれません。共テ数学で点を取るには、解く力と、時間の使い方（処理の仕方）の両方が必要です。</p>
    </div>
  </section>

  <section class="ts-sec ts-who" aria-labelledby="h-who">
    ${scurve}
    <div class="ts-in">
      <p class="ts-kicker">講師 宇佐見 天彗</p>
      <h2 id="h-who" class="ts-h2">70分の試験を、<br>約60分で解き終える。</h2>
      <p class="ts-text">2026年の共通テスト数学ⅡBCを、本番の会場で約60分で解答。そのとき、どこを見て、何を省き、どう処理しているのか。その一部を、この講義で実戦解説します。</p>
      <div class="ts-nums">
        <div class="ts-num"><p class="ts-num-v"><span lang="en">6</span><small>年連続</small></p><p class="ts-num-l">共通テスト数学を会場受験</p></div>
        <div class="ts-num"><p class="ts-num-v"><span lang="en">95</span><small>点</small></p><p class="ts-num-l">2026 数学ⅠA</p></div>
        <div class="ts-num"><p class="ts-num-v"><span lang="en">100</span><small>点</small></p><p class="ts-num-l">2026 数学ⅡBC</p></div>
      </div>
      <p class="ts-fine">※講師個人が共通テスト本番を会場受験した際の得点・解答時間です（PASSLABO の講義案内ページに掲載）。受講によって同様の得点や解答時間を保証するものではありません。</p>
      <div class="ts-prof"><img src="${profile}" alt="講師の宇佐見天彗さん" width="440" height="440"><p><b>宇佐見 天彗</b>PASSLABO代表。東京大学医学部医学科卒。YouTube での数学解説や、学校講演・出張講義を続けています。</p></div>
    </div>
  </section>

  <section class="ts-sec ts-for" aria-labelledby="h-for">
    <div class="ts-in">
      <p class="ts-kicker">対象と予習</p>
      <h2 id="h-for" class="ts-h2">共テ数学で8割を目指す人へ。</h2>
      <p class="ts-text">共テ数学で8割を目指す人に向けた内容です。どなたでも参加できます。</p>
      <p class="ts-text">参加申込のあと、LINE で予習課題が届きます。一度取り組んでから参加すると、講義の内容を自分の解き方と照らし合わせやすくなります。</p>
    </div>
  </section>

  <section class="ts-sec ts-join" aria-labelledby="h-join">
    <div class="ts-in">
      <p class="ts-kicker">参加の流れ</p>
      <h2 id="h-join" class="ts-h2">参加申込は LINE で。<br>メールアドレスの入力はありません。</h2>
      <ol class="ts-steps">
        <li><span>1</span><div><b>LINE を追加</b>下のボタンから PASSLABO の LINE へ</div></li>
        <li><span>2</span><div><b>LINE 内で参加申込</b>予習課題と Zoom の URL を LINE で受け取る</div></li>
        <li><span>3</span><div><b>10/17（土）20:00 に参加</b>Zoom で2時間の講義</div></li>
      </ol>
      <dl class="ts-table">
        <div><dt>テーマ</dt><dd>共通テスト数学 時短戦略</dd></div>
        <div><dt>日時</dt><dd>2026年10月17日（土）20:00〜22:00</dd></div>
        <div><dt>形式</dt><dd>オンライン（Zoom）</dd></div>
        <div><dt>参加費</dt><dd>無料</dd></div>
        <div><dt>講師</dt><dd>宇佐見 天彗（PASSLABO）</dd></div>
        <div><dt>対象</dt><dd>どなたでも参加可能（共テ数学で8割を目指す人に向けた内容）</dd></div>
      </dl>
    </div>
  </section>

  <section class="ts-sec ts-final" aria-labelledby="h-final">
    <div class="ts-in">
      <p class="ts-final-lead">本番の70分を、最後まで戦い切るために。</p>
      <h2 id="h-final" class="ts-final-h">10/17（土）20:00〜22:00<br><span>共テ数学 時短戦略 特別講義</span></h2>
      <p class="ts-final-meta">オンライン（Zoom）・参加無料</p>
      ${cta('ts-cta ts-cta-final')}
      ${ctaNote}
    </div>
  </section>
</main>
<div class="ts-sticky" hidden>${cta('ts-cta ts-cta-sticky')}</div>
<footer class="ts-foot">
  <p>© PASSLABO</p>
  <p class="ts-review" role="note">確認用・未公開（改善案A）。ボタンは PASSLABO の LINE（https://lin.ee/rTgblIH）への通常のリンクです。得点・解答時間は講師個人のもので、第三者による検証は未了です。</p>
</footer>
`;

const CSS = `
:root{--n:#193c51;--b:#3294c1;--pale:#ebf7fb;--ink:#0d1a22;--line:#06c755;--line-d:#05a948}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:var(--ink);font-family:"PL Sans","Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif;font-feature-settings:"palt";line-height:1.5}
img{display:block;max-width:100%}
.sp{display:inline}
p,li,h1,h2,h3,dd,figcaption{word-break:auto-phrase}
.cta{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:62px;padding:0 16px;border-radius:12px;background:var(--line);color:#fff;font-weight:900;font-size:19px;text-decoration:none;box-shadow:0 4px 0 #04913d}
.cta:hover{background:#05b84e}.cta:active{background:var(--line-d);box-shadow:none;transform:translateY(3px)}
.cta:focus-visible{outline:3px solid #fff;outline-offset:3px;box-shadow:0 0 0 6px var(--n)}
.cta .ico{width:26px;height:26px;flex:none}
.cta-note{margin:8px 0 0;font-size:13px;line-height:1.6;color:#d8e4ea}
/* FV: 紺の面。学ぶ目的を大きく、本人は右下に。日時・形式・CTA を一望 */
.ts-fv{position:relative;background:linear-gradient(180deg,#0d1a22 0%,#193c51 100%);color:#fff;overflow:hidden}
.ts-fv-in{position:relative;padding:16px 20px 0;min-height:420px}
.ts-brand{margin:0;font-size:13px;font-weight:700;letter-spacing:.14em;color:#9fd3ea}.ts-brand span{margin-left:8px;letter-spacing:.04em;color:#fff;background:var(--b);padding:1px 8px;border-radius:3px}
.ts-target{margin:12px 0 0;font-size:17px;font-weight:700;padding-bottom:6px;border-bottom:2px solid #9fd3ea;display:inline-block}
.ts-h1{position:relative;z-index:2;margin:12px 0 0;font-weight:900;line-height:1.1}
.ts-h1-a{display:block;font-size:30px;color:#9fd3ea;letter-spacing:.04em}
.ts-h1-b{display:block;margin-top:6px;font-size:40px;letter-spacing:-.02em;line-height:1.18;text-shadow:0 3px 0 rgba(0,0,0,.35)}
.ts-fv-sub{position:relative;z-index:2;margin:12px 0 0;font-size:15px;font-weight:700;line-height:1.6;color:var(--pale);max-width:230px}
.ts-fv-person{position:absolute;z-index:1;right:-58px;bottom:0;height:230px;margin:0;aspect-ratio:1330/1183}
.ts-fv-person img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(6px 10px 18px rgba(0,0,0,.5))}
.ts-fv-name{position:absolute;z-index:2;right:12px;bottom:8px;margin:0;font-size:15px;font-weight:900;background:rgba(13,26,34,.8);padding:2px 8px;border-radius:4px}.ts-fv-name span{font-size:12px;font-weight:700;color:#9fd3ea;margin-right:6px}
.ts-fv-offer{position:relative;z-index:3;padding:14px 20px 20px;background:#0d1a22}
.ts-when{margin:0 0 12px;display:grid;gap:4px}
.ts-when div{display:flex;gap:10px;align-items:baseline}
.ts-when dt{flex:none;font-size:13px;font-weight:700;color:#0d1a22;background:#9fd3ea;border-radius:3px;padding:0 7px}
.ts-when dd{margin:0;font-size:16px;font-weight:700}.ts-when b{font-size:20px;font-weight:900}
/* 本文 */
.ts-sec{padding:48px 22px}
.ts-in{max-width:1000px;margin:0 auto;position:relative}
.ts-kicker{margin:0 0 8px;font-size:14px;font-weight:700;letter-spacing:.1em;color:var(--b)}
.ts-h2{margin:0;font-size:29px;font-weight:900;line-height:1.35;color:var(--n)}
.ts-text{margin:14px 0 0;font-size:17px;line-height:1.85}
.ts-what{background:#fff}
.ts-points{list-style:none;margin:22px 0 0;padding:0;border-top:2px solid var(--n)}
.ts-points li{display:grid;grid-template-columns:52px 1fr;gap:6px;padding:14px 0;border-bottom:1px solid #d6e4ec}
.ts-no{font-family:"PL Num","PL Sans",sans-serif;font-size:30px;line-height:1;color:var(--b)}
.ts-points h3{margin:0;font-size:19px;font-weight:900;line-height:1.4;color:var(--n)}
.ts-points p{margin:4px 0 0;font-size:16px;line-height:1.65}
.ts-board{margin:26px 0 0;background:var(--n);padding:14px 14px 16px;border-radius:8px;color:#fff}
.ts-board img{width:100%;height:auto;background:#fff;padding:4px}
.ts-board figcaption{margin-top:10px;font-size:15px;line-height:1.65}
.ts-board figcaption b{display:block;font-size:17px;font-weight:900}
.ts-board figcaption span{display:block;margin-top:4px;font-size:13px;color:#cfe3ee}
.ts-feel{background:var(--n);color:#fff;padding-bottom:36px}
.ts-feel-h{margin:0;font-size:32px;font-weight:900;line-height:1.35}
.ts-feel-list{list-style:none;margin:20px 0 0;padding:0}
.ts-feel-list li{padding:12px 0;border-top:1px solid rgba(255,255,255,.18);font-size:17px;font-weight:700;color:var(--pale)}
.ts-feel-list li:last-child{border-bottom:1px solid rgba(255,255,255,.18)}
.ts-feel-p{margin:18px 0 0;font-size:17px;line-height:1.85;color:#fff}
.ts-who{background:#fff;padding-top:24px;overflow:hidden}
.ts-s{width:170px;height:340px;margin:0 0 24px calc(50% - 14px);pointer-events:none}
.ts-s-svg{display:block;width:170px;height:340px;overflow:visible}
.ts-s-path{fill:none;stroke:var(--b);stroke-width:26;stroke-linecap:butt;stroke-linejoin:round}
.ts-s-head{fill:var(--b)}
.ts-nums{margin:24px 0 0;border-top:1px solid #cfe3ee}
.ts-num{padding:18px 0 16px;border-bottom:1px solid #cfe3ee;text-align:center}
.ts-num-v{margin:0;color:var(--b);line-height:1;display:flex;justify-content:center;align-items:baseline;gap:6px}
.ts-num-v span{font-family:"PL Num","PL Sans",sans-serif;font-size:84px;letter-spacing:-.03em;display:inline-block;transform:skewX(-6deg)}
.ts-num-v small{font-size:24px;font-weight:900}
.ts-num-l{margin:8px 0 0;font-size:20px;font-weight:900;color:var(--ink)}
.ts-fine{margin:12px 0 0;font-size:13px;line-height:1.7;color:#3d4a52}
.ts-prof{margin-top:22px;display:grid;grid-template-columns:84px 1fr;gap:14px;align-items:center}
.ts-prof img{width:84px;height:84px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 4px var(--pale)}
.ts-prof p{margin:0;font-size:15px;line-height:1.7}.ts-prof b{display:block;font-size:18px;color:var(--n)}
.ts-for{background:var(--pale)}
.ts-join{background:#fff}
.ts-steps{list-style:none;margin:22px 0 0;padding:0;display:grid;gap:10px}
.ts-steps li{display:grid;grid-template-columns:40px 1fr;gap:12px;align-items:start;padding:14px;background:var(--pale);border-radius:8px;font-size:15px;line-height:1.6}
.ts-steps span{width:36px;height:36px;border-radius:50%;background:var(--b);color:#fff;font-weight:900;font-size:18px;display:flex;align-items:center;justify-content:center}
.ts-steps b{display:block;font-size:18px;color:var(--n)}
.ts-table{margin:22px 0 0;border-top:2px solid var(--n)}
.ts-table div{display:grid;grid-template-columns:76px 1fr;gap:10px;padding:10px 0;border-bottom:1px solid #d6e4ec}
.ts-table dt{font-size:14px;font-weight:900;color:var(--b)}.ts-table dd{margin:0;font-size:16px;font-weight:700;line-height:1.55}
.ts-final{background:linear-gradient(180deg,#193c51,#0d1a22);color:#fff}
.ts-final-lead{margin:0;font-size:18px;font-weight:700;color:var(--pale)}
.ts-final-h{margin:10px 0 0;font-size:28px;font-weight:900;line-height:1.3}.ts-final-h span{display:block;margin-top:4px;font-size:24px;color:#9fd3ea}
.ts-final-meta{margin:8px 0 18px;font-size:16px;font-weight:700}
.ts-sticky{position:fixed;z-index:50;left:0;right:0;bottom:0;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));background:rgba(13,26,34,.94);box-shadow:0 -6px 18px rgba(0,0,0,.25)}
.ts-sticky[hidden]{display:none}.ts-sticky .cta{min-height:54px}
html.has-sticky{scroll-padding-bottom:96px}
.ts-foot{background:#0d1a22;color:#c9d6dd;padding:20px 22px 36px;font-size:13px}
.ts-foot p{max-width:1000px;margin:0 auto}
.ts-review{margin-top:10px!important;padding:10px 12px;border:1px dashed #6f8794;border-radius:6px;line-height:1.6}
@media (max-width:389px){.ts-h1-b{font-size:36px}.ts-fv-person{height:210px;right:-62px}.ts-h2{font-size:27px}.ts-feel-h{font-size:29px}.ts-num-v span{font-size:76px}.cta{font-size:17px}}
@media (min-width:900px){
.sp{display:none}
.ts-fv-in{max-width:1160px;margin:0 auto;min-height:520px;padding:28px 24px 0}
.ts-h1-a{font-size:44px}.ts-h1-b{font-size:68px}.ts-fv-sub{font-size:20px;max-width:none}
.ts-fv-person{right:40px;height:480px}.ts-fv-name{right:60px;bottom:20px;font-size:20px}
.ts-fv-offer{display:grid;grid-template-columns:auto minmax(0,440px);justify-content:center;align-items:center;column-gap:40px}
.ts-fv-offer .cta-note{grid-column:2}
.ts-sec{padding:80px 40px}.ts-h2{font-size:40px}
.ts-points{display:grid;grid-template-columns:repeat(3,1fr);column-gap:24px}
.ts-board{max-width:760px}
.ts-nums{display:grid;grid-template-columns:repeat(3,1fr);column-gap:24px}
.ts-steps{grid-template-columns:repeat(3,1fr)}
.ts-final{text-align:center}.ts-final .cta{max-width:480px;margin:0 auto}
.ts-sticky{display:none!important}
}
@media (prefers-reduced-motion:reduce){.cta:active{transform:none}}
`;

const SCRIPT = `(function(){
var d=document,root=d.documentElement,reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var sticky=d.querySelector('.ts-sticky'),fvCta=d.querySelector('.ts-cta-fv'),stop=d.querySelector('.ts-final');
var ctas=[].slice.call(d.querySelectorAll('.cta')).filter(function(c){return !sticky.contains(c)});
var sBox=d.querySelector('.ts-s'),sPath=sBox&&sBox.querySelector('.ts-s-path'),sHead=sBox&&sBox.querySelector('.ts-s-head'),sLen=0;
if(sPath&&!reduce&&sPath.getTotalLength){sLen=sPath.getTotalLength();sPath.style.strokeDasharray=sLen+' '+sLen;}
function drawS(p){var at=Math.max(0.5,sLen*p),pt=sPath.getPointAtLength(at),pb=sPath.getPointAtLength(Math.max(0,at-2));var ang=Math.atan2(pt.y-pb.y,pt.x-pb.x)*180/Math.PI;sPath.style.strokeDashoffset=(sLen*(1-p)).toFixed(1);sHead.setAttribute('transform','translate('+pt.x.toFixed(1)+' '+pt.y.toFixed(1)+') rotate('+ang.toFixed(1)+')');sBox.setAttribute('data-p',p.toFixed(3));}
var ticking=false;
function update(){
  ticking=false;var vh=innerHeight;
  if(sLen){var t=sBox.getBoundingClientRect().top,p=(vh*.85-t)/(vh*.6);p=p<0?0:p>1?1:p;drawS(p)}
  var show=false;
  if(innerWidth<900&&fvCta){
    var passed=fvCta.getBoundingClientRect().bottom<0;
    var ctaInView=ctas.some(function(c){var r=c.getBoundingClientRect();return r.bottom>0&&r.top<vh});
    var nearEnd=stop.getBoundingClientRect().top<vh;
    show=passed&&!ctaInView&&!nearEnd;
  }
  if(sticky.hidden===show){if(!show&&sticky.contains(d.activeElement))return;sticky.hidden=!show;root.classList.toggle('has-sticky',show);}
}
function req(){if(!ticking){ticking=true;requestAnimationFrame(update)}}
addEventListener('scroll',req,{passive:true});addEventListener('resize',req);
sticky.addEventListener('focusout',function(){setTimeout(update,0)});
update();
})();`;

function fontFaces(text, weights) {
  const pkg = process.env.FONT_PKG;
  if (!pkg) throw new Error('FONT_PKG を指定してください');
  const cps = new Set([...text].map((c) => c.codePointAt(0)));
  const out = [];
  for (const w of weights) {
    const css = readFileSync(join(pkg, `${w}.css`), 'utf8');
    for (const block of css.split('@font-face').slice(1)) {
      const file = (block.match(/files\/([^)]+\.woff2)/) || [])[1];
      const range = (block.match(/unicode-range:\s*([^;]+);/) || [])[1];
      if (!file || !range) continue;
      const hit = range.split(',').some((r) => { const [a, b] = r.trim().replace(/^U\+/i, '').split('-').map((x) => parseInt(x, 16)); for (const cp of cps) if (cp >= a && cp <= (b ?? a)) return true; return false; });
      if (hit) out.push(`@font-face{font-family:"PL Sans";font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${readFileSync(join(pkg, 'files', file)).toString('base64')}) format("woff2");unicode-range:${range}}`);
    }
  }
  return out.join('\n');
}
const text = BODY.replace(/<[^>]+>/g, '').replace(/data:[^"]+/g, '');
const numFace = `@font-face{font-family:"PL Num";font-display:block;src:url(data:font/woff2;base64,${readFileSync(join(root, '../passlabo-full-lp-review/fonts-num/titan-one-latin-400-normal.woff2')).toString('base64')}) format("woff2");unicode-range:U+0030-0039,U+002C}`;
const hash = createHash('sha256').update(SCRIPT).digest('base64');
const csp = `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; form-action 'none'; base-uri 'none'`;
const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>PASSLABO 共テ数学 時短戦略 特別講義（未公開の確認用 LP・改善案A）</title>
<style>${fontFaces(text + 'LINEで参加申込へ進む', [500, 700, 900])}
${numFace}
${CSS}</style></head>
<body>
${BODY}
<script>${SCRIPT}</script>
</body></html>`;
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out/passlabo-timestrategy.html'), html);
console.log(`out/passlabo-timestrategy.html（${(html.length / 1e6).toFixed(2)} MB）`);
