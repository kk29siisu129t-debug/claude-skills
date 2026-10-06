// 本文（固定 FV の後ろ）・本文用 CSS・表示用の最小 JS。v3（67f4b72 の後の全体改訂）
// 流れ: 講義の概要（講義／教材／あわせてご案内の役割ラベル）→ 悩み → 太い S 字の矢印 → 講師の実話 → 青い大きな数字の実績面
//       → 板書と設問で見る学習体験 → 講義参加者向けの配布教材 → 補足のプログラム特別案内 → 無料講義と CTA。
// 事実は REVIEW.md の出典表の範囲だけ。架空の引用・受講者の声・保証・数の追加・配布時期や形式などの運用条件は書かない。

// 太い S 字の矢印（参照 IMG_7510 を 400px 換算で採寸: 幅約150・高さ約335・線幅約25）。
// 中心線は直線で下り、右へ大きく振れて、左下向きの大きな矢印頭で終わる。初期状態は完成形（JS 無効・動きを減らす設定でもこのまま）。
const S_PATH = 'M14 0V90C14 162 142 150 142 250C142 274 139 287 132 298';
const S_HEAD = 'translate(132 298) rotate(122.5)';
const scurve = `<div class="lp-s" aria-hidden="true"><svg class="lp-s-svg" viewBox="0 0 170 340" width="170" height="340" focusable="false"><path class="lp-s-path" d="${S_PATH}"/><polygon class="lp-s-head" points="-2,-28 46,0 -2,28" transform="${S_HEAD}"/></svg></div>`;

export const body = ({ board, sheet, profile, ctaBtn, stickyBtn }) => `
<main class="lp" aria-label="講義の案内">
  <section class="lp-sec lp-about" aria-labelledby="h-about">
    <div class="lp-in">
      <p class="lp-about-tag"><span>無料</span>共テ数学 特別講義</p>
      <h2 id="h-about" class="lp-about-h">共テ数学の解き方を、<br>宇佐見の板書で学ぶ。</h2>
      <p class="lp-text">時短戦略・思考法・問題の取り組み方を、解答の手元を見せながら解説します。</p>
      <dl class="lp-roles">
        <div class="lp-role"><dt>講義</dt><dd>講師の板書と手元での解説</dd></div>
        <div class="lp-role"><dt>教材</dt><dd>特別テキスト<small>（全員に配布）</small>・講義板書／解説PDF<small>（参加特典）</small></dd></div>
        <div class="lp-role lp-role--sub"><dt>あわせてご案内</dt><dd>共テ数学プログラムの特別案内</dd></div>
      </dl>
    </div>
  </section>

  <section class="lp-sec lp-feel" aria-labelledby="h-feel">
    <div class="lp-in">
      <h2 id="h-feel" class="lp-feel-h">共テ数学で、<br>時間が足りない。<br>演習しても、<br>点数が伸びない。</h2>
      <ul class="lp-feel-list">
        <li>最後の問題まで、手が回らないまま時間が終わる。</li>
        <li>演習を続けているのに、点数が思うように上がらない。</li>
        <li>何をどう勉強すればいいのか、迷ってしまう。</li>
      </ul>
    </div>
  </section>

  <section class="lp-sec lp-story" aria-labelledby="h-story">
    ${scurve}
    <div class="lp-in lp-story-in">
      <div class="lp-story-body">
        <p class="lp-kicker">講師 宇佐見 天彗</p>
        <h2 id="h-story" class="lp-story-h">学年最下位から1位へ。<br>そして、東大に現役合格。</h2>
        <p class="lp-text">地方の公立高校に入学したときの成績は、学年最下位。独自の勉強法を確立して学年1位になり、<strong>東京大学理科Ⅱ類に現役合格</strong>しました。</p>
        <p class="lp-text">東京大学医学部医学科を卒業後は教育の道へ。自身の経験をもとに、勉強法や受験戦略を発信しています。</p>
      </div>
      <figure class="lp-story-fig">
        <img src="${profile}" alt="講師の宇佐見天彗さん" width="440" height="440">
        <blockquote class="lp-quote"><p>正しい情報と戦略を持てば、人は誰だって平等に挑戦できる</p><footer>宇佐見天彗（著書『超戦略的勉強法』の紹介文より。出典：<a href="https://www.kadokawa.co.jp/product/322003000286/">KADOKAWA 商品ページ</a>）</footer></blockquote>
      </figure>
    </div>
  </section>

  <section class="lp-sec lp-nums" aria-label="数字で見る取り組み">
    <svg class="lp-nums-bg" aria-hidden="true" focusable="false" viewBox="0 0 400 560" preserveAspectRatio="xMidYMid slice"><defs><pattern id="lp-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#3294c1" stroke-width=".6"/></pattern></defs><rect width="400" height="560" fill="url(#lp-grid)"/><path d="M0 300H400M200 0V560" stroke="#3294c1" stroke-width="1.4"/><path d="M40 60Q200 620 360 60" fill="none" stroke="#3294c1" stroke-width="2.4"/><path d="M0 470C90 410 150 520 230 450S350 380 400 420" fill="none" stroke="#3294c1" stroke-width="2"/></svg>
    <div class="lp-in">
      <div class="lp-num-row">
        <p class="lp-num"><span class="lp-num-v" lang="en">7</span><span class="lp-num-u">年</span></p>
        <p class="lp-num-l">「高校数学解法大全」の構想期間</p>
      </div>
      <div class="lp-num-row">
        <p class="lp-num"><span class="lp-num-v" lang="en">3,000</span><span class="lp-num-u">人</span></p>
        <p class="lp-num-note">※仮置き・実績未確認</p>
        <p class="lp-num-l">累計受講者数</p>
      </div>
    </div>
  </section>

  <section class="lp-sec lp-mats" aria-labelledby="h-mats">
    <div class="lp-in">
      <p class="lp-kicker lp-kicker--on-dark">講義で見ること</p>
      <h2 id="h-mats" class="lp-h2 lp-h2--on-dark">共テ数学の解答過程を、<br><span class="lp-mark" data-reveal>板書で解説。</span></h2>
      <figure class="lp-mat lp-mat--board" data-reveal>
        <figcaption class="lp-mat-h">グラフと式を、講師の板書で追う。</figcaption>
        <img src="${board}" alt="講義の板書。二次関数のグラフを描き、式を変形しながら解説している" width="628" height="570">
        <p class="lp-mat-cap">講義の板書（見本）。グラフと式を書き込みながら、解き進める過程を解説します。</p>
      </figure>
      <p class="lp-mat-topic"><span>見本の題材</span>2024年 共通テスト本試の二次関数の問題</p>
      <p class="lp-themes-line"><span>講義で扱う</span>時短戦略／思考法／問題の取り組み方</p>
    </div>
  </section>

  <section class="lp-sec lp-gift" aria-labelledby="h-gift">
    <div class="lp-in">
      <p class="lp-kicker">講義参加者向け教材</p>
      <h2 id="h-gift" class="lp-h2">講義参加者全員に、<br class="sp">特別テキストを配布。</h2>
      <div class="lp-kit">
        <figure class="lp-kit-item">
          <p class="lp-kit-tag">講義参加者全員に配布</p>
          <p class="lp-kit-name">特別テキスト</p>
          <p class="lp-kit-title">「PASSLABO 共通テスト対策 数学特別講義（関数の徹底攻略）」</p>
          <img class="lp-mat" data-reveal src="${sheet}" alt="特別テキストの設問ページ。2024年 共通テスト本試の二次関数のグラフと設問" width="584" height="508">
          <figcaption>設問ページ（見本）。2024年 共通テスト本試の二次関数の問題です。</figcaption>
        </figure>
        <figure class="lp-kit-item">
          <p class="lp-kit-tag">参加特典</p>
          <p class="lp-kit-name">講義板書／解説PDF</p>
          <div class="lp-kit-doc"><svg viewBox="0 0 48 60" width="48" height="60" aria-hidden="true" focusable="false"><path d="M4 2h28l12 12v44H4z" fill="#fff" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M32 2v12h12" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M12 26h24M12 34h24M12 42h16" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><p>講義の板書と解説の PDF です。</p></div>
        </figure>
      </div>
      <aside class="lp-prog" aria-label="あわせて">
        <p class="lp-prog-k">あわせて（参加特典）</p>
        <p class="lp-prog-name">共テ数学プログラムの特別案内</p>
        <p class="lp-prog-text">プログラム本体の受講とは別の、案内です。</p>
      </aside>
    </div>
  </section>

  <section class="lp-sec lp-final" aria-labelledby="h-final">
    <div class="lp-final-bg" aria-hidden="true"><img src="${board}" alt=""></div>
    <div class="lp-in">
      <p class="lp-final-lead">目指すのは、時間内に解き切ること。<br>まずは、無料の特別講義から。</p>
      <p class="lp-final-free"><span>無料</span></p>
      <h2 id="h-final" class="lp-final-h">共テ数学 特別講義</h2>
      <ul class="lp-sum">
        <li>時短戦略・思考法・問題の取り組み方を、講師の板書と手元で解説</li>
        <li>講義参加者全員に特別テキストを配布</li>
        <li>参加特典：講義板書／解説PDF、共テ数学プログラムの特別案内</li>
      </ul>
      ${ctaBtn}
    </div>
  </section>
</main>
<div class="lp-sticky" hidden>${stickyBtn}</div>
<footer class="lp-foot">
  <p class="lp-foot-brand">PASSLABO</p>
  <ul class="lp-foot-links" aria-label="運営情報"><li>運営会社：<a href="https://passlabo.jp/">株式会社ペイ・フォワード</a></li><li><a href="https://utage-system.com/p/jFyT8LCb2fti">プライバシーポリシー</a></li><li><a href="https://utage-system.com/p/S4us61iIRJc4">特定商取引法に基づく表記</a></li></ul>
  <p class="lp-review" id="cta-note" role="note">確認用・未公開。LINEボタンは未接続です。3,000人は仮置きで、実績未確認です。</p>
`;

export const css = `
.lp{--n:#193c51;--b:#3294c1;--pale:#ebf7fb;--ink:#0d1a22;color:var(--ink);background:#fff}
.lp .sp{display:inline}
.lp p,.lp li,.lp h2,.lp h3,.lp figcaption,.lp-foot li,.lp-foot p{word-break:auto-phrase}
.lp-sec{position:relative;padding:48px 22px}
.lp-in{max-width:1000px;margin:0 auto;position:relative}
.lp-kicker{margin:0 0 8px;font-size:14px;font-weight:700;letter-spacing:.12em;color:var(--b)}
.lp-kicker--on-dark{color:#9fd3ea}
.lp-h2{margin:0;font-size:30px;font-weight:900;line-height:1.3;color:var(--n)}
.lp-h2--on-dark{color:#fff}
.lp-text{margin:16px 0 0;font-size:17px;font-weight:500;line-height:1.85}
/* 概要: FV 直下。何の講義かを一文で。下に「見る／配布／あわせて」の3層 */
.lp-about{background:#fff;padding-top:40px}
.lp-about-tag{margin:0;display:flex;align-items:center;gap:10px;font-size:18px;font-weight:900;color:var(--n)}.lp-about-tag span{background:var(--b);color:#fff;border-radius:4px;padding:1px 10px}
.lp-about-h{margin:12px 0 0;font-size:31px;font-weight:900;line-height:1.38;color:var(--n)}
.lp-roles{margin:22px 0 0;border-top:2px solid var(--n)}
.lp-role{display:grid;grid-template-columns:112px 1fr;gap:12px;align-items:baseline;padding:12px 0;border-bottom:1px solid #d6e4ec}
.lp-role dt{font-size:15px;font-weight:900;color:var(--b)}
.lp-role dd{margin:0;font-size:17px;font-weight:900;line-height:1.5;color:var(--n)}
.lp-role dd small{font-size:13px;font-weight:700;color:#3d4a52}
.lp-role--sub dd{font-size:15px;font-weight:700}
/* 悩み: 紺の面に大きな白い文字 */
.lp-feel{background:var(--n);color:#fff;padding-bottom:40px}
.lp-feel-h{margin:0;font-size:36px;font-weight:900;line-height:1.3}
.lp-feel-list{list-style:none;margin:22px 0 0;padding:0}
.lp-feel-list li{padding:14px 0;border-top:1px solid rgba(255,255,255,.18);font-size:17px;font-weight:500;line-height:1.7;color:var(--pale)}
.lp-feel-list li:last-child{border-bottom:1px solid rgba(255,255,255,.18)}
/* 太い S 字の矢印: 白い面の上で、悩みから講師の実話へ。操作できる部品ではない */
.lp-story{background:#fff;padding-top:24px}
.lp-s{width:170px;height:340px;margin:0 0 24px calc(50% - 14px);pointer-events:none}
.lp-s-svg{display:block;width:170px;height:340px;overflow:visible}
.lp-s-path{fill:none;stroke:var(--b);stroke-width:26;stroke-linecap:butt;stroke-linejoin:round}
.lp-s-head{fill:var(--b)}
/* 講師の実話 */
.lp-story-in{display:grid;gap:22px}
.lp-story-h{margin:0;font-size:32px;font-weight:900;line-height:1.38;color:var(--n)}
.lp-story strong{font-weight:900;color:var(--n);background:linear-gradient(transparent 62%,#cfe9f5 62%)}
.lp-story-fig{margin:0;display:grid;grid-template-columns:96px 1fr;gap:14px;align-items:center}
.lp-story-fig img{width:96px;height:96px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 4px var(--pale)}
.lp-quote{margin:0;padding:14px 16px;border-left:4px solid var(--b);background:var(--pale)}
.lp-quote p{margin:0;font-size:18px;font-weight:700;line-height:1.6;color:var(--n)}
.lp-quote p::before{content:"「"}.lp-quote p::after{content:"」"}
.lp-quote footer{margin-top:8px;font-size:13px;line-height:1.6;color:#3d4a52}
.lp-quote a{color:var(--n);text-decoration:underline;text-underline-offset:2px}
.lp-quote a:focus-visible{outline:2px solid var(--b);outline-offset:2px}
/* 実績面: 参照 IMG_7509 の型。白い全幅の面に、青い大きな数字 → 単位 → 黒い太字の意味 → 注記。細い区切り線で縦に積む */
.lp-nums{background:#fff;padding:8px 10px 40px;overflow:hidden}
.lp-nums-bg{position:absolute;inset:0;width:100%;height:100%;opacity:.09;pointer-events:none}
.lp-nums .lp-in{position:relative}
.lp-num-row{padding:30px 0 28px;border-top:1px solid #cfe3ee;text-align:center}
.lp-num-row:last-child{border-bottom:1px solid #cfe3ee}
.lp-num{margin:0;display:flex;justify-content:center;align-items:baseline;gap:6px;color:var(--b);line-height:1}
.lp-num-v{font-family:"PL Num","PL Sans",sans-serif;font-weight:400;font-size:min(116px,29vw);letter-spacing:-.04em;line-height:1;display:inline-block;transform:skewX(-6deg)}
.lp-num-u{font-size:30px;font-weight:900}
.lp-num-l{margin:16px 0 0;font-size:24px;font-weight:900;line-height:1.4;color:var(--ink)}
.lp-num-note{margin:10px auto 0;display:inline-block;padding:3px 12px;background:var(--ink);color:#fff;font-size:15px;font-weight:700;border-radius:4px}
.lp-num-note + .lp-num-l{margin-top:10px}
/* 学習体験: 紺の面で実物を大きく */
.lp-mats{background:var(--n);color:#fff}
.lp-mark{background-image:linear-gradient(#9fd3ea,#9fd3ea);background-repeat:no-repeat;background-position:0 94%;background-size:100% 6px;padding-bottom:2px}
.lp-mat--board{margin:26px 0 0}
.lp-mat-h{margin:0 0 12px;font-size:22px;font-weight:900;line-height:1.4;color:#fff}
.lp-mat--board img{width:100%;height:auto;background:#fff;padding:4px;box-shadow:0 14px 30px rgba(0,0,0,.4)}
.lp-mat-cap{margin:10px 0 0;font-size:16px;line-height:1.7;color:var(--pale)}
.lp-mat-topic,.lp-themes-line{margin:18px 0 0;font-size:17px;font-weight:700;line-height:1.6;color:#fff}
.lp-mat-topic span,.lp-themes-line span{display:inline-block;margin-right:10px;font-size:13px;font-weight:700;color:var(--n);background:#9fd3ea;border-radius:3px;padding:1px 8px;vertical-align:2px}
.lp-themes-line{margin-top:10px;color:var(--pale);font-weight:500}
/* 講義参加者向けの教材: 淡青の面。名称と見本を隣接させる */
.lp-gift{background:var(--pale)}
.lp-kit{display:grid;gap:22px;margin-top:22px}
.lp-kit-item{margin:0;background:#fff;padding:18px;border-top:4px solid var(--b)}
.lp-kit-tag{margin:0;display:inline-block;font-size:13px;font-weight:700;color:#fff;background:var(--n);border-radius:3px;padding:2px 8px}
.lp-kit-name{margin:8px 0 0;font-size:24px;font-weight:900;color:var(--n);line-height:1.3}
.lp-kit-title{margin:4px 0 0;font-size:15px;font-weight:700;line-height:1.6;color:#3d4a52}
.lp-kit-item img{display:block;width:100%;height:auto;margin-top:12px;border:1px solid #d6e4ec;box-shadow:0 8px 18px rgba(25,60,81,.18)}
.lp-kit-item figcaption{margin-top:8px;font-size:15px;line-height:1.6;color:#3d4a52}
.lp-kit-doc{display:flex;align-items:center;gap:14px;margin-top:12px;color:var(--n)}.lp-kit-doc svg{flex:none}.lp-kit-doc p{margin:0;font-size:16px;line-height:1.6;color:#3d4a52}
.lp-prog{margin-top:22px;padding:14px 16px;border:1px solid #9cc3d6;border-radius:6px;background:#fff}
.lp-prog-k{margin:0;font-size:13px;font-weight:700;color:var(--b)}
.lp-prog-name{margin:2px 0 0;font-size:17px;font-weight:900;color:var(--n)}
.lp-prog-text{margin:4px 0 0;font-size:15px;line-height:1.6;color:#3d4a52}
/* まとめと最終 CTA */
.lp-final{background:#0d1a22;color:#fff;overflow:hidden;padding-bottom:44px}
.lp-final-bg{position:absolute;inset:0}
.lp-final-bg img{position:absolute;left:50%;top:-30px;width:560px;max-width:none;transform:translateX(-30%) rotate(-5deg);opacity:.35;filter:grayscale(.35) blur(1.5px)}
.lp-final-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(13,26,34,.82),rgba(25,60,81,.88) 55%,#0d1a22)}
.lp-final-lead{margin:0 0 18px;font-size:18px;font-weight:700;line-height:1.7;color:var(--pale)}
.lp-final-free{margin:0}.lp-final-free span{display:inline-block;background:var(--b);color:#fff;font-size:22px;font-weight:900;padding:2px 12px;border-radius:6px}
.lp-final-h{margin:8px 0 0;font-size:36px;font-weight:900;line-height:1.15;letter-spacing:-.02em;text-shadow:0 4px 0 rgba(0,0,0,.35)}
.lp-sum{list-style:none;margin:18px 0 22px;padding:0;display:grid;gap:8px}
.lp-sum li{position:relative;padding-left:24px;font-size:16px;font-weight:500;line-height:1.6;color:var(--pale)}
.lp-sum li::before{content:"";position:absolute;left:2px;top:.5em;width:10px;height:6px;border-left:3px solid #9fd3ea;border-bottom:3px solid #9fd3ea;transform:rotate(-45deg)}
.lp-cta{max-width:520px}
/* SP の追従 CTA: FV の CTA が見えなくなった後だけ（JS が hidden を外す）。safe-area 込みの余白 */
.lp-sticky{position:fixed;z-index:50;left:0;right:0;bottom:0;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));background:rgba(13,26,34,.94);box-shadow:0 -6px 18px rgba(0,0,0,.25)}
.lp-sticky[hidden]{display:none}
body[data-variant^="a4"] .lp-sticky .cta{min-height:54px;box-shadow:0 3px 0 #04913d}
html.has-sticky{scroll-padding-bottom:96px}
/* フッター */
.lp-foot{background:#0d1a22;color:#c9d6dd;padding:24px 22px 40px;border-top:1px solid rgba(255,255,255,.08)}
.lp-foot-brand{margin:0 auto;max-width:1000px;font-size:14px;font-weight:700;letter-spacing:.18em;color:#9fd3ea}
.lp-foot-links a{color:#e2ebf0;text-decoration:underline;text-underline-offset:3px}.lp-foot-links a:focus-visible{outline:2px solid #fff;outline-offset:2px}
.lp-foot-links{list-style:none;max-width:1000px;margin:10px auto 0;padding:0;display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:#c9d6dd}
.lp-review{max-width:1000px;margin:14px auto 0;padding:10px 14px;border:1px dashed #6f8794;border-radius:6px;font-size:14px;line-height:1.6;color:#e2ebf0}
/* 一度きりの強調（JS が動き、動きを減らす設定でないときだけ）。文字・画像は最初から見え、opacity で隠さない */
@media (prefers-reduced-motion:no-preference){
.js .lp-mark{background-size:0 6px;transition:background-size .55s cubic-bezier(.2,.7,.2,1) .15s}
.js .lp-mark.is-in{background-size:100% 6px}
.js .lp-mat.is-in,.js .lp-mat{transition:transform .5s cubic-bezier(.2,.7,.2,1)}
.js .lp-mat:not(.is-in){transform:translateY(12px)}
}
@media (max-width:389px){.lp-about-h{font-size:28px}.lp-role{grid-template-columns:96px 1fr}.lp-story-h{font-size:28px}.lp-h2{font-size:28px}.lp-feel-h{font-size:33px}.lp-final-h{font-size:34px}.lp-num-l{font-size:22px}.lp-story-fig{grid-template-columns:1fr}.lp-story-fig img{width:88px;height:88px}}
@media (min-width:900px){
.lp .sp{display:none}
.lp-sec{padding:80px 40px}
.lp-kicker{font-size:16px}
.lp-h2{font-size:40px}
.lp-about-h{font-size:40px}
.lp-feel-h{font-size:52px}
.lp-feel .lp-in{display:grid;grid-template-columns:1fr 1fr;column-gap:48px;align-items:center}
.lp-feel-list{margin:0}
.lp-text{max-width:720px}
.lp-story-in{grid-template-columns:1.1fr 1fr;gap:56px;align-items:center}
.lp-story-h{font-size:44px}
.lp-story-fig{grid-template-columns:160px 1fr;gap:20px}.lp-story-fig img{width:160px;height:160px}
.lp-nums .lp-in{display:grid;grid-template-columns:1fr 1fr;column-gap:40px}
.lp-num-row:last-child{border-bottom:0}.lp-num-row{border-bottom:1px solid #cfe3ee}
.lp-num-v{font-size:120px}
.lp-mat--board{max-width:760px}
.lp-kit{grid-template-columns:1fr 1fr;align-items:start}
.lp-final{text-align:center}.lp-final-h{font-size:48px}.lp-sum{justify-items:center}.lp-sum li{text-align:left}.lp-cta{margin:0 auto}
.lp-final-bg img{width:900px}
.lp-sticky{display:none!important}
}
`;

// 表示用の最小 JS（外部取得なし）。一度きりの強調、S 字の描画、SP 追従 CTA の出し入れだけ。
export const script = `(function(){
var d=document,root=d.documentElement,reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!reduce)root.classList.add('js');
var items=[].slice.call(d.querySelectorAll('[data-reveal]'));
var sticky=d.querySelector('.lp-sticky'),fvCta=d.querySelector('.f-cta'),stop=d.querySelector('.lp-final');
var ctas=[].slice.call(d.querySelectorAll('.cta')).filter(function(c){return !sticky.contains(c)});
var sBox=d.querySelector('.lp-s'),sPath=sBox&&sBox.querySelector('.lp-s-path'),sHead=sBox&&sBox.querySelector('.lp-s-head'),sLen=0;
if(sPath&&!reduce&&sPath.getTotalLength){sLen=sPath.getTotalLength();sPath.style.strokeDasharray=sLen+' '+sLen;}
function drawS(p){
  var at=Math.max(0.5,sLen*p),pt=sPath.getPointAtLength(at),pb=sPath.getPointAtLength(Math.max(0,at-2));
  var ang=Math.atan2(pt.y-pb.y,pt.x-pb.x)*180/Math.PI;
  sPath.style.strokeDashoffset=(sLen*(1-p)).toFixed(1);
  sHead.setAttribute('transform','translate('+pt.x.toFixed(1)+' '+pt.y.toFixed(1)+') rotate('+ang.toFixed(1)+')');
  sBox.setAttribute('data-p',p.toFixed(3));
}
var ticking=false;
function update(){
  ticking=false;var vh=innerHeight;
  items=items.filter(function(el){if(el.getBoundingClientRect().top<vh*.88){el.classList.add('is-in');return false}return true});
  // S 字: 上端が画面の下 85% に入ってから、画面の 25% まで上がる間に、経路に沿って 0→1 まで描かれる（戻れば縮む）
  if(sLen){var t=sBox.getBoundingClientRect().top,p=(vh*.85-t)/(vh*.6);p=p<0?0:p>1?1:p;drawS(p)}
  var show=false;
  if(innerWidth<900&&fvCta){
    var passed=fvCta.getBoundingClientRect().bottom<0;
    var ctaInView=ctas.some(function(c){var r=c.getBoundingClientRect();return r.bottom>0&&r.top<vh});
    var nearEnd=stop.getBoundingClientRect().top<vh;
    show=passed&&!ctaInView&&!nearEnd;
  }
  if(sticky.hidden===show){
    if(!show&&sticky.contains(d.activeElement))return;
    sticky.hidden=!show;root.classList.toggle('has-sticky',show);
  }
}
function req(){if(!ticking){ticking=true;requestAnimationFrame(update)}}
addEventListener('scroll',req,{passive:true});addEventListener('resize',req);
sticky.addEventListener('focusout',function(){setTimeout(update,0)});
update();
})();`;
