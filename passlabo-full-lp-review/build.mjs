#!/usr/bin/env node
// PASSLABO 共テ数学 特別講義: 未公開の確認用フル LP。
//   FONT_PKG=<@fontsource/noto-sans-jp を展開した package/> node build.mjs  … out/passlabo-full-lp.html
// - FV は固定: src/fv-a4p-4706a14.html（passlabo-fv-variants の commit 4706a14 の a4p と同一バイト。SHA256 を照合）を
//   そのまま使い、FV の後ろに本文、末尾にレビュー用の案内を足すだけ（FV のマークアップ・CSS・画像は変更しない）
// - 本文の事実は REVIEW.md の出典一覧の範囲だけ。架空の FAQ・日時・価格・受講者の声・点数の約束は書かない
// - CTA はすべて確認用 <button type="button">。form・外部 URL・スクリプトを含めない（FV の CSP をそのまま使う）
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const ctaBtn = fvHtml.match(/<button type="button" class="cta f-cta"[\s\S]*?<\/button>/)[0].replace('class="cta f-cta"', 'class="cta lp-cta"');

const BODY = `
<main class="lp" aria-label="講義の案内">
  <section class="lp-sec lp-pain" aria-labelledby="h-pain">
    <div class="lp-in">
      <p class="lp-kicker">こんな人へ</p>
      <h2 id="h-pain" class="lp-h2">共テ数学、<br class="sp">時間が足りない。</h2>
      <ul class="lp-pains">
        <li>最後の大問まで手が回らない</li>
        <li><span class="nb">解き方は分かるのに、</span><span class="nb">時間内に終わらない</span></li>
        <li>どこから手をつけるかで迷ってしまう</li>
      </ul>
    </div>
  </section>

  <section class="lp-sec lp-points" aria-labelledby="h-points">
    <div class="lp-in">
      <p class="lp-kicker">講義で扱うこと</p>
      <h2 id="h-points" class="lp-h2">時間内に解くための<br class="sp">3つの視点</h2>
      <ol class="lp-steps">
        <li><span class="lp-no" aria-hidden="true">01</span><div><h3>時短戦略</h3><p>どこに時間をかけ、どこを速く進めるかを考えます。</p></div></li>
        <li><span class="lp-no" aria-hidden="true">02</span><div><h3>思考法</h3><p>問題を見たとき、何から考えるかの順番を整理します。</p></div></li>
        <li><span class="lp-no" aria-hidden="true">03</span><div><h3>問題へのアプローチ</h3><p>実際の問題で、手のつけ方を確かめます。</p></div></li>
      </ol>
      <p class="lp-lead">講師の板書と手元を見ながら進めます。</p>
    </div>
  </section>

  <section class="lp-sec lp-mats" aria-labelledby="h-mats">
    <div class="lp-in">
      <p class="lp-kicker lp-kicker--on-dark">教材見本</p>
      <h2 id="h-mats" class="lp-h2 lp-h2--on-dark">実際の板書と<br class="sp">配布テキスト</h2>
      <div class="lp-mat-grid">
        <figure class="lp-mat">
          <img src="${board}" alt="講義の板書。二次関数の式とグラフを手書きで解説している" width="628" height="570">
          <figcaption>講義の板書</figcaption>
        </figure>
        <figure class="lp-mat">
          <img src="${sheet}" alt="配布テキストの問題ページ。二次関数のグラフと設問" width="584" height="508">
          <figcaption>配布テキスト「PASSLABO 共通テスト対策 数学特別講義（関数の徹底攻略）」</figcaption>
        </figure>
      </div>
      <p class="lp-note-on-dark">見本は2024年 共通テスト本試の二次関数の問題です。</p>
    </div>
  </section>

  <section class="lp-sec lp-gift" aria-labelledby="h-gift">
    <div class="lp-in">
      <h2 id="h-gift" class="lp-gift-h">講義参加者全員に<br class="sp">特別テキストを配布</h2>
      <div class="lp-bonus">
        <p class="lp-bonus-label">参加特典</p>
        <ol class="lp-bonus-list">
          <li><span class="lp-bn" aria-hidden="true">1</span>講義板書／解説PDF</li>
          <li><span class="lp-bn" aria-hidden="true">2</span>共テ数学プログラムの特別案内</li>
        </ol>
        <p class="lp-bonus-note">講義に参加した方への特典です。</p>
      </div>
    </div>
  </section>

  <section class="lp-sec lp-prof" aria-labelledby="h-prof">
    <div class="lp-in lp-prof-in">
      <img class="lp-prof-photo" src="${profile}" alt="講師の宇佐見天彗さん" width="440" height="440">
      <div class="lp-prof-body">
        <p class="lp-kicker">講師</p>
        <h2 id="h-prof" class="lp-prof-name">宇佐見 天彗<span lang="en">Subaru Usami</span></h2>
        <ul class="lp-tags"><li>PASSLABO代表</li><li>東京大学医学部医学科卒</li><li>大学受験に特化した教育系YouTuber</li></ul>
        <p class="lp-prof-text">地方の公立高校から東大理科Ⅱ類に現役合格。東京大学医学部医学科を卒業後、教育の道へ。</p>
        <p class="lp-prof-text">全国の学校での講演・出張講義、教材の制作、書籍の出版、オンライン個別指導を行っています。</p>
      </div>
    </div>
  </section>

  <section class="lp-sec lp-final" aria-labelledby="h-final">
    <div class="lp-final-bg" aria-hidden="true"><img src="${board}" alt=""></div>
    <div class="lp-in">
      <p class="lp-final-free"><span>無料</span></p>
      <h2 id="h-final" class="lp-final-h">共テ数学 特別講義</h2>
      <ul class="lp-sum">
        <li>時短戦略・思考法・問題へのアプローチを板書で解説</li>
        <li>講義参加者全員に特別テキストを配布</li>
        <li>参加特典：講義板書／解説PDF、共テ数学プログラムの特別案内</li>
      </ul>
      ${ctaBtn}
    </div>
  </section>
</main>
<footer class="lp-foot">
  <p class="lp-foot-brand">PASSLABO</p>
  <div class="lp-review" role="note">
    <p class="lp-review-h">確認用ページについて（未公開）</p>
    <ul>
      <li>このページは社内確認用です。公開・本番反映はしていません。</li>
      <li>ファーストビューのバッジ「累計受講者数 3,000人」はユーザー指定の仮置きで、実績集計は未確認です。</li>
      <li>「LINEで無料講義を受け取る」はすべて確認用ボタンです（外部送信・外部遷移はしません）。LINE の実 URL は未確認です。</li>
      <li>特典の配布時期、フッターの法務リンク（特定商取引法に基づく表記・プライバシーポリシー等）は確認中のため載せていません。</li>
    </ul>
  </div>
`;

const LP_CSS = `
.lp{--n:#193c51;--b:#3294c1;--pale:#ebf7fb;--ink:#0d1a22;color:var(--ink);background:#fff}
.lp .sp{display:inline}
.lp p,.lp li,.lp h2,.lp h3,.lp figcaption,.lp-foot li{word-break:auto-phrase}
.lp-sec{position:relative;padding:44px 22px}
.lp-in{max-width:1000px;margin:0 auto;position:relative}
.lp-kicker{margin:0 0 6px;font-size:14px;font-weight:700;letter-spacing:.12em;color:var(--b)}
.lp-kicker--on-dark{color:#9fd3ea}
.lp-h2{margin:0;font-size:30px;font-weight:900;line-height:1.3;letter-spacing:.01em;color:var(--n)}
.lp-h2--on-dark{color:#fff}
.lp-lead{margin:18px 0 0;font-size:16px;font-weight:500;line-height:1.8}
/* 悩み: 淡青の面に、太い線の見出しと3行 */
.lp-pain{background:var(--pale)}
.lp-pains{list-style:none;margin:20px 0 0;padding:0;display:grid;gap:10px}
.lp-pains li{position:relative;padding:12px 14px 12px 44px;background:#fff;border-left:4px solid var(--b);font-size:17px;font-weight:700;line-height:1.5}
.lp-pains li::before{content:"";position:absolute;left:16px;top:50%;width:14px;height:14px;margin-top:-7px;border:2.5px solid var(--n);border-radius:50%}
/* 3つの視点: 白地に大きな番号 */
.lp-steps{list-style:none;margin:22px 0 0;padding:0;display:grid;gap:0;counter-reset:s}
.lp-steps li{display:grid;grid-template-columns:62px 1fr;align-items:start;padding:16px 0;border-top:1px solid #d6e4ec}
.lp-steps li:last-child{border-bottom:1px solid #d6e4ec}
.lp-no{font-size:36px;font-weight:900;line-height:1;color:var(--b);letter-spacing:-.02em}
.lp-steps h3{margin:2px 0 4px;font-size:20px;font-weight:900;color:var(--n)}
.lp-steps p{margin:0;font-size:16px;line-height:1.7}
/* 教材見本: 紺の面に実物を大きく */
.lp-mats{background:var(--n);color:#fff}
.lp-mat-grid{display:grid;gap:18px;margin-top:22px}
.lp-mat{margin:0}
.lp-mat img{width:100%;height:auto;background:#fff;padding:4px;box-shadow:0 10px 24px rgba(0,0,0,.35)}
.lp-mat figcaption{margin-top:8px;font-size:14px;font-weight:500;line-height:1.6;color:var(--pale)}
.lp-note-on-dark{margin:16px 0 0;font-size:15px;line-height:1.7;color:var(--pale)}
/* 特典: 青の面 */
.lp-gift{background:var(--b);color:#fff}
.lp-gift-h{margin:0;font-size:28px;font-weight:900;line-height:1.35}
.lp-bonus{margin-top:20px;background:#fff;color:var(--ink);padding:18px 18px 16px;border-radius:10px}
.lp-bonus-label{margin:0;display:inline-block;background:var(--n);color:#fff;font-size:14px;font-weight:700;letter-spacing:.08em;padding:3px 10px;border-radius:4px}
.lp-bonus-list{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:10px}
.lp-bonus-list li{display:flex;align-items:center;gap:12px;font-size:18px;font-weight:900;color:var(--n);line-height:1.4}
.lp-bn{flex:none;width:30px;height:30px;border-radius:50%;background:var(--b);color:#fff;font-size:16px;display:flex;align-items:center;justify-content:center}
.lp-bonus-note{margin:12px 0 0;font-size:14px;color:#3d4a52}
/* 講師 */
.lp-prof{background:#fff}
.lp-prof-in{display:grid;gap:18px;justify-items:start}
.lp-prof-photo{width:148px;height:148px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 4px var(--pale)}
.lp-prof-name{margin:0;font-size:30px;font-weight:900;color:var(--n);line-height:1.2}
.lp-prof-name span{display:block;margin-top:4px;font-size:15px;font-weight:500;letter-spacing:.06em;color:#3d4a52}
.lp-tags{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.lp-tags li{background:var(--pale);color:var(--n);font-size:14px;font-weight:700;padding:4px 10px;border-radius:4px}
.lp-prof-text{margin:12px 0 0;font-size:16px;line-height:1.8}
/* まとめと最終 CTA: FV と同じ暗い実教材の面 */
.lp-final{background:#0d1a22;color:#fff;overflow:hidden;padding-bottom:40px}
.lp-final-bg{position:absolute;inset:0}
.lp-final-bg img{position:absolute;left:50%;top:-30px;width:560px;max-width:none;transform:translateX(-30%) rotate(-5deg);opacity:.35;filter:grayscale(.35) blur(1.5px)}
.lp-final-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(13,26,34,.82),rgba(25,60,81,.88) 55%,#0d1a22)}
.lp-final-free{margin:0}.lp-final-free span{display:inline-block;background:var(--b);color:#fff;font-size:22px;font-weight:900;padding:2px 12px;border-radius:6px}
.lp-final-h{margin:8px 0 0;font-size:40px;font-weight:900;line-height:1.15;letter-spacing:-.02em;text-shadow:0 4px 0 rgba(0,0,0,.35)}
.lp-sum{list-style:none;margin:18px 0 22px;padding:0;display:grid;gap:8px}
.lp-sum li{position:relative;padding-left:24px;font-size:16px;font-weight:500;line-height:1.6;color:var(--pale)}
.lp-sum li::before{content:"";position:absolute;left:2px;top:.5em;width:10px;height:6px;border-left:3px solid #9fd3ea;border-bottom:3px solid #9fd3ea;transform:rotate(-45deg)}
.lp-cta{max-width:520px}
/* フッターと確認用の案内 */
.lp-foot{background:#0d1a22;color:#c9d6dd;padding:24px 22px 40px;border-top:1px solid rgba(255,255,255,.08)}
.lp-foot-brand{margin:0 auto;max-width:1000px;font-size:14px;font-weight:700;letter-spacing:.18em;color:#9fd3ea}
.lp-review{max-width:1000px;margin:16px auto 0;padding:14px 16px;border:2px dashed #6f8794;border-radius:8px;background:#13242e}
.lp-review-h{margin:0 0 6px;font-size:15px;font-weight:700;color:#fff}
.lp-review ul{margin:0;padding-left:1.2em;font-size:14px;line-height:1.7}
body[data-variant] .lp-foot .review{margin:14px auto 0;max-width:1000px;background:#13242e;color:#c9d6dd;border-color:#6f8794}
@media (max-width:389px){.lp-h2{font-size:28px}.lp-final-h{font-size:36px}.lp-pains li{font-size:16px}}
@media (min-width:900px){
.lp .sp{display:none}
.lp-sec{padding:72px 40px}
.lp-kicker{font-size:16px}
.lp-h2{font-size:36px}
.lp-pains{grid-template-columns:repeat(3,1fr);gap:14px}
.lp-steps{grid-template-columns:repeat(3,1fr);gap:24px}
.lp-steps li{grid-template-columns:1fr;border:0;border-top:3px solid var(--b);padding-top:18px}
.lp-steps li:last-child{border-bottom:0}
.lp-mat-grid{grid-template-columns:1.07fr 1fr;gap:28px;align-items:start}
.lp-gift .lp-in{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.lp-gift-h{font-size:36px}.lp-bonus{margin:0}
.lp-prof-in{grid-template-columns:220px 1fr;gap:40px;align-items:center}
.lp-prof-photo{width:220px;height:220px}
.lp-final{text-align:center}.lp-final-h{font-size:60px}.lp-sum{justify-items:center}.lp-sum li{text-align:left}.lp-cta{margin:0 auto}
.lp-final-bg img{width:900px}
}
`;

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

// 組み立て: FV の確認用注記（aside）はフッターへ移し、その位置に本文を入れる。FV 本体は1バイトも変えない
const asideRe = /\n<aside class="review" id="cta-note" role="note">[\s\S]*?<\/aside>\n/;
const aside = fvHtml.match(asideRe)[0].trim();
let html = fvHtml.replace(asideRe, `\n${BODY}\n  ${aside}\n</footer>\n`);
html = html.replace(/<title>[^<]*<\/title>/, '<title>PASSLABO 共テ数学 特別講義（未公開の確認用 LP・仮置き数値あり）</title>');
html = html.replace('</style></head>', `\n${fonts}\n${LP_CSS}</style></head>`);
// 固定 FV の範囲（<body> から FV の </div> まで）が原本と同一であることを確かめる
const fvPart = (h) => h.slice(h.indexOf('<body'), h.indexOf('\n<main class="lp"') > 0 ? h.indexOf('\n<main class="lp"') : h.search(asideRe));
if (fvPart(html).trimEnd() !== fvPart(fvHtml).trimEnd()) throw new Error('FV 部分が変わっています');

mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out/passlabo-full-lp.html'), html);
console.log(`out/passlabo-full-lp.html（${(html.length / 1e6).toFixed(2)} MB、FV は 4706a14 と同一）`);
