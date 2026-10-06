// 本文（固定 FV の後ろ）・本文用 CSS・表示用の最小 JS。
// 流れ: 目標 → 共感（時間が足りない・点数が上がらない）→ 見方の転換（解く量だけでなく、解き方にも目を向ける）→ 3つのテーマ → 実物の教材 → 講師 → 参加特典 → 無料講義と最終 CTA。
// 説明口調の橋渡し行（中央寄せの一文＋小さな∨）は置かない。共感→本人の実話→転換→3テーマ→実物は、スクロール量に連動して下へ伸びるガイド線（.lp-guide）でつなぐ。
// 事実は REVIEW.md の出典表の範囲だけ。架空の引用・受講者の声・保証・数値の追加・動画の見せかけは置かない。

const guide = (tone) => `<div class="lp-guide lp-guide--${tone}" aria-hidden="true"><span class="lp-guide-track"></span><span class="lp-guide-line"></span><svg class="lp-guide-head" viewBox="0 0 22 14"><path d="M0 0h22L11 14z"/></svg></div>`;

export const body = ({ board, sheet, profile, ctaBtn, stickyBtn }) => `
<main class="lp" aria-label="講義の案内">
  <section class="lp-sec lp-goal" aria-labelledby="h-goal">
    <div class="lp-in">
      <p class="lp-kicker">この講義で目指すこと</p>
      <h2 id="h-goal" class="lp-goal-h">目指すのは、<br>時間内に解き切ること。</h2>
      <p class="lp-text">答えだけでなく、どう考えて解き進めるのか。講師の板書と手元で、その過程を見ながら学べる講義です。</p>
    </div>
  </section>

  <section class="lp-sec lp-feel" aria-labelledby="h-feel">
    <div class="lp-in">
      <h2 id="h-feel" class="lp-feel-h">時間が足りない。<br>点数が上がらない。</h2>
      <ul class="lp-feel-list">
        <li>最後の問題まで、手が回らないまま時間が終わる。</li>
        <li>演習を続けているのに、点数が思うように上がらない。</li>
        <li>何をどう勉強すればいいのか、迷ってしまう。</li>
      </ul>
      ${guide('dark')}
    </div>
  </section>

  <section class="lp-sec lp-story" aria-labelledby="h-story">
    <div class="lp-in lp-story-in">
      <div class="lp-story-body">
        <h2 id="h-story" class="lp-story-h">はじめから、<br>できたわけじゃない。</h2>
        <p class="lp-text">地方の公立高校に入学したとき、宇佐見天彗の成績は<strong>学年最下位</strong>。そこから勉強の戦略を磨き、学年1位に。<strong>東京大学理科Ⅱ類に現役合格</strong>しました。</p>
        <p class="lp-text">東京大学医学部医学科を卒業後、教育の道へ。<strong>構想7年の「高校数学解法大全」</strong>にも取り組んできました。</p>
      </div>
      <figure class="lp-story-fig">
        <img src="${profile}" alt="講師の宇佐見天彗さん" width="440" height="440">
        <blockquote class="lp-quote"><p>正しい情報と戦略を持てば、人は誰だって平等に挑戦できる</p><footer>宇佐見天彗（著書『超戦略的勉強法』の紹介文より。出典：<a href="https://www.kadokawa.co.jp/product/322003000286/">KADOKAWA 商品ページ</a>）</footer></blockquote>
      </figure>
    </div>
    <div class="lp-in">${guide('light')}</div>
  </section>

  <section class="lp-sec lp-turn" aria-labelledby="h-turn">
    <div class="lp-in">
      <p class="lp-turn-pre">解く量だけでなく、</p>
      <h2 id="h-turn" class="lp-turn-h">解き方にも、<br><span class="lp-mark" data-reveal>目を向ける。</span></h2>
      <p class="lp-text">戦略を磨いてきた講師の手元を見ながら、自分の考え方・手順を見直すきっかけに。この講義では、共通テストに取り組むときに必要な3つを扱います。</p>
    </div>
  </section>

  <section class="lp-sec lp-themes" aria-labelledby="h-themes">
    <div class="lp-in">
      <p class="lp-kicker">講義で扱う3つ</p>
      <h2 id="h-themes" class="lp-h2">時短戦略・思考法・<br class="sp">問題の取り組み方</h2>
      <ol class="lp-steps">
        <li class="lp-step" data-reveal><span class="lp-no" aria-hidden="true">01</span><div><h3>時短戦略</h3><p class="lp-q"><span>考える観点</span>時間を、どこに使うか。</p></div></li>
        <li class="lp-step" data-reveal><span class="lp-no" aria-hidden="true">02</span><div><h3>思考法</h3><p class="lp-q"><span>考える観点</span>問題を見て、まず何を考えるか。</p></div></li>
        <li class="lp-step" data-reveal><span class="lp-no" aria-hidden="true">03</span><div><h3>問題の取り組み方</h3><p class="lp-q"><span>考える観点</span>どこから、どう手をつけるか。</p></div></li>
      </ol>
      <p class="lp-how"><b>講義では</b>この3つを、講師の手元（板書）をお見せしながら解説します。</p>
      ${guide('pale')}
    </div>
  </section>

  <section class="lp-sec lp-mats" aria-labelledby="h-mats">
    <div class="lp-in">
      <p class="lp-kicker lp-kicker--on-dark">教材見本</p>
      <h2 id="h-mats" class="lp-h2 lp-h2--on-dark">実際の板書と<br class="sp">配布テキスト</h2>
      <div class="lp-mat-grid">
        <figure class="lp-mat" data-reveal>
          <img src="${board}" alt="講義の板書。二次関数の式とグラフを手書きで解説している" width="628" height="570">
          <figcaption>講義の板書</figcaption>
        </figure>
        <figure class="lp-mat" data-reveal>
          <img src="${sheet}" alt="配布テキストの問題ページ。二次関数のグラフと設問" width="584" height="508">
          <figcaption>配布テキスト「PASSLABO 共通テスト対策 数学特別講義（関数の徹底攻略）」</figcaption>
        </figure>
      </div>
      <p class="lp-note-on-dark">見本は2024年 共通テスト本試の二次関数の問題です。</p>
    </div>
  </section>

  <section class="lp-sec lp-prof" aria-labelledby="h-prof">
    <div class="lp-in lp-prof-in">
      <div class="lp-prof-body">
        <p class="lp-kicker">講師</p>
        <h2 id="h-prof" class="lp-prof-h">地方と都会の教育格差を、<br class="sp">なくすために。</h2>
        <p class="lp-prof-name">宇佐見 天彗<span lang="en">Subaru Usami</span></p>
        <ul class="lp-tags"><li>PASSLABO代表</li><li>東京大学医学部医学科卒</li><li>大学受験に特化した教育系YouTuber</li></ul>
        <p class="lp-text">地方と都会の教育格差の是正に向けて、オンライン個別指導や学校での講演・出張講義を全国で行っています。教材の制作や書籍の出版も手がけています。</p>
      </div>
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

  <section class="lp-sec lp-final" aria-labelledby="h-final">
    <div class="lp-final-bg" aria-hidden="true"><img src="${board}" alt=""></div>
    <div class="lp-in">
      <p class="lp-final-lead">目指すのは、時間内に解き切ること。<br>まずは、無料の特別講義から。</p>
      <p class="lp-final-free"><span>無料</span></p>
      <h2 id="h-final" class="lp-final-h">共テ数学 特別講義</h2>
      <ul class="lp-sum">
        <li>時短戦略・思考法・問題の取り組み方を、手元を見せながら解説</li>
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
/* 目標: 淡青の大きな面に強い一文 */
.lp-goal{background:var(--pale);padding-top:44px}
.lp-goal-h{margin:0;font-size:34px;font-weight:900;line-height:1.3;letter-spacing:-.01em;color:var(--n)}
/* 共感: 紺の面に大きな白い文字。結果と気持ちを3行で */
.lp-feel{background:var(--n);color:#fff}
.lp-feel-h{margin:0;font-size:36px;font-weight:900;line-height:1.3}
.lp-feel-list{list-style:none;margin:22px 0 0;padding:0;display:grid;gap:0}
.lp-feel-list li{padding:14px 0;border-top:1px solid rgba(255,255,255,.18);font-size:17px;font-weight:500;line-height:1.7;color:var(--pale)}
.lp-feel-list li:last-child{border-bottom:1px solid rgba(255,255,255,.18)}
/* 本人の実話: 白い面。強い見出し → 第三人称の事実 → 写真と本人の短い信念（出典つき） */
.lp-feel{padding-bottom:28px}
.lp-story{background:#fff;padding-bottom:28px}
.lp-story-in{display:grid;gap:22px}
.lp-story-h{margin:0;font-size:34px;font-weight:900;line-height:1.3;color:var(--n)}
.lp-story strong{font-weight:900;color:var(--n);background:linear-gradient(transparent 62%,#cfe9f5 62%)}
.lp-story-fig{margin:0}
.lp-story-fig{display:grid;grid-template-columns:96px 1fr;gap:14px;align-items:center}
.lp-story-fig .lp-quote footer{grid-column:1/-1}
.lp-story-fig img{width:96px;height:96px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 4px var(--pale)}
.lp-story-fig .lp-quote{margin:0}
.lp-quote{margin:14px 0 0;padding:14px 16px;border-left:4px solid var(--b);background:var(--pale)}
.lp-quote p{margin:0;font-size:18px;font-weight:700;line-height:1.6;color:var(--n)}
.lp-quote p::before{content:"「"}.lp-quote p::after{content:"」"}
.lp-quote footer{margin-top:8px;font-size:13px;line-height:1.6;color:#3d4a52}
.lp-quote a{color:var(--n);text-decoration:underline;text-underline-offset:2px}
.lp-quote a:focus-visible{outline:2px solid var(--b);outline-offset:2px}
.lp-turn{padding-top:28px}
.lp-themes{padding-bottom:28px}
/* 下へ伸びるガイド線: スクロール量（--p 0〜1）に連動して線が伸び、先端に矢印頭が付いてくる。操作できる部品ではない */
.lp-guide{--p:1;--h:120px;position:relative;width:24px;height:calc(var(--h) + 14px);margin:24px auto 0;pointer-events:none;color:var(--b)}
.lp-guide-track{position:absolute;left:50%;top:0;height:var(--h);border-left:2px dashed currentColor;opacity:.25;transform:translateX(-1px)}
.lp-guide-line{position:absolute;left:50%;top:0;width:4px;height:var(--h);margin-left:-2px;border-radius:2px;background:currentColor;transform-origin:50% 0;transform:scaleY(var(--p))}
.lp-guide-head{position:absolute;left:50%;top:0;width:22px;height:14px;margin-left:-11px;fill:currentColor;transform:translateY(calc(var(--h) * var(--p) - 2px))}
.lp-guide--dark{color:#9fd3ea}
/* 転換: 白い面に短い2行。「解き方そのもの。」に一度だけ下線 */
.lp-turn{background:#fff;padding-top:56px;padding-bottom:40px}
.lp-turn-pre{margin:0;font-size:18px;font-weight:700;color:#3d4a52}
.lp-turn-h{margin:10px 0 0;font-size:34px;font-weight:900;line-height:1.35;color:var(--n)}
.lp-mark{background-image:linear-gradient(var(--b),var(--b));background-repeat:no-repeat;background-position:0 94%;background-size:100% 6px;padding-bottom:2px}
/* 3つのテーマ: 番号つきの要点。観点（読み手の問い）と講義で扱うことを分ける */
.lp-themes{background:var(--pale)}
.lp-steps{list-style:none;margin:22px 0 0;padding:0;display:grid;gap:12px}
.lp-step{position:relative;display:grid;grid-template-columns:58px 1fr;align-items:start;background:#fff;padding:18px 18px 16px;border-top:4px solid #cfe3ee}
.lp-step::before{content:"";position:absolute;left:0;right:0;top:-4px;height:4px;background:var(--b);transform-origin:left center}
.lp-no{font-size:34px;font-weight:900;line-height:1;color:var(--b);letter-spacing:-.02em}
.lp-step h3{margin:0;font-size:22px;font-weight:900;line-height:1.3;color:var(--n)}
.lp-q{margin:8px 0 0;font-size:17px;font-weight:500;line-height:1.6}
.lp-q span{display:inline-block;margin-right:8px;font-size:13px;font-weight:700;color:var(--b);border:1px solid var(--b);border-radius:3px;padding:0 6px;vertical-align:2px}
.lp-how{margin:18px 0 0;padding:14px 16px;background:var(--n);color:#fff;font-size:17px;line-height:1.7;border-radius:6px}
.lp-how b{display:block;font-size:14px;color:#9fd3ea;letter-spacing:.1em}
/* 実物: 紺の面に大きく */
.lp-mats{background:var(--n);color:#fff}
.lp-mat-grid{display:grid;gap:20px;margin-top:22px}
.lp-mat{margin:0}
.lp-mat img{width:100%;height:auto;background:#fff;padding:4px;box-shadow:0 14px 30px rgba(0,0,0,.4)}
.lp-mat figcaption{margin-top:8px;font-size:14px;font-weight:500;line-height:1.6;color:var(--pale)}
.lp-note-on-dark{margin:16px 0 0;font-size:16px;line-height:1.7;color:var(--pale)}
/* 講師 */
.lp-prof{background:#fff}
.lp-prof-in{display:grid;gap:18px;justify-items:start}
.lp-prof-photo{width:156px;height:156px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 5px var(--pale)}
.lp-prof-h{margin:0;font-size:30px;font-weight:900;line-height:1.3;color:var(--n)}
.lp-prof-name{margin:14px 0 0;font-size:24px;font-weight:900;color:var(--ink);line-height:1.2}
.lp-prof-name span{display:inline-block;margin-left:10px;font-size:15px;font-weight:500;letter-spacing:.06em;color:#3d4a52}
.lp-tags{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.lp-tags li{background:var(--pale);color:var(--n);font-size:16px;font-weight:700;padding:4px 10px;border-radius:4px}
/* 特典: 青の面 */
.lp-gift{background:var(--b);color:#fff}
.lp-gift-h{margin:0;font-size:28px;font-weight:900;line-height:1.35}
.lp-bonus{margin-top:20px;background:#fff;color:var(--ink);padding:18px 18px 16px;border-radius:10px}
.lp-bonus-label{margin:0;display:inline-block;background:var(--n);color:#fff;font-size:14px;font-weight:700;letter-spacing:.08em;padding:3px 10px;border-radius:4px}
.lp-bonus-list{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:10px}
.lp-bonus-list li{display:flex;align-items:center;gap:12px;font-size:18px;font-weight:900;color:var(--n);line-height:1.4}
.lp-bn{flex:none;width:30px;height:30px;border-radius:50%;background:var(--b);color:#fff;font-size:16px;display:flex;align-items:center;justify-content:center}
.lp-bonus-note{margin:12px 0 0;font-size:16px;color:#3d4a52}
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
/* 演出（3つだけ・各1回）。JS が動き、動きを減らす設定でないときだけ。文字・カード・画像は最初から見える（opacity で隠さない）。途中で JS が止まっても強調が付かないだけ */
@media (prefers-reduced-motion:no-preference){
.js .lp-mark{background-size:0 6px;transition:background-size .55s cubic-bezier(.2,.7,.2,1) .15s}
.js .lp-mark.is-in{background-size:100% 6px}
.js .lp-step::before{transform:scaleX(0);transition:transform .45s cubic-bezier(.2,.7,.2,1)}
.js .lp-step .lp-no{display:inline-block;color:#8fb6c9;transform:translateY(6px);transition:color .45s ease-out,transform .45s ease-out}
.js .lp-step:nth-child(2)::before,.js .lp-step:nth-child(2) .lp-no{transition-delay:.1s}.js .lp-step:nth-child(3)::before,.js .lp-step:nth-child(3) .lp-no{transition-delay:.2s}
.js .lp-step.is-in::before{transform:none}.js .lp-step.is-in .lp-no{color:var(--b);transform:none}
.js .lp-mat img{transform:translateY(12px);box-shadow:0 4px 10px rgba(0,0,0,.3);transition:transform .5s cubic-bezier(.2,.7,.2,1),box-shadow .5s ease-out}
.js .lp-mat:nth-child(2) img{transition-delay:.08s}
.js .lp-mat.is-in img{transform:none;box-shadow:0 18px 34px rgba(0,0,0,.45)}
}
@media (max-width:389px){.lp-story-fig{grid-template-columns:1fr}.lp-story-fig img{width:88px;height:88px}.lp-story-h{font-size:31px}.lp-h2{font-size:28px}.lp-goal-h,.lp-turn-h{font-size:31px}.lp-feel-h{font-size:33px}.lp-final-h{font-size:34px}.lp-prof-h{font-size:28px}}
@media (min-width:900px){
.lp .sp{display:none}
.lp-sec{padding:80px 40px}
.lp-kicker{font-size:16px}
.lp-h2{font-size:36px}
.lp-goal-h,.lp-turn-h{font-size:48px}
.lp-feel-h{font-size:52px}
.lp-story-in{grid-template-columns:1.1fr 1fr;gap:56px;align-items:center}
.lp-story-fig{grid-template-columns:160px 1fr;gap:20px}.lp-story-fig img{width:160px;height:160px}
.lp-story-h{font-size:48px}
.lp-feel .lp-in{display:grid;grid-template-columns:1fr 1fr;column-gap:48px;align-items:center}
.lp-feel .lp-guide{grid-column:1/-1}
.lp-feel-list{margin:0}
.lp-text{max-width:720px}
.lp-steps{grid-template-columns:repeat(3,1fr);gap:20px}
.lp-step{grid-template-columns:1fr;row-gap:10px;padding:22px}
.lp-mat-grid{grid-template-columns:1.07fr 1fr;gap:28px;align-items:start}
.lp-gift .lp-in{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.lp-gift-h{font-size:36px}.lp-bonus{margin:0}
.lp-prof-in{grid-template-columns:1fr}
.lp-prof-photo{width:240px;height:240px}
.lp-prof-h{font-size:36px}
.lp-final{text-align:center}.lp-final-h{font-size:48px}.lp-sum{justify-items:center}.lp-sum li{text-align:left}.lp-cta{margin:0 auto}
.lp-final-bg img{width:900px}
.lp-sticky{display:none!important}
}
`;

// 表示用の最小 JS（外部取得なし）。演出の開始と SP 追従 CTA の出し入れだけ。
export const script = `(function(){
var d=document,root=d.documentElement,reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!reduce)root.classList.add('js');
var items=[].slice.call(d.querySelectorAll('[data-reveal]'));
var sticky=d.querySelector('.lp-sticky'),fvCta=d.querySelector('.f-cta'),stop=d.querySelector('.lp-final');
var ctas=[].slice.call(d.querySelectorAll('.cta')).filter(function(c){return !sticky.contains(c)});
var guides=[].slice.call(d.querySelectorAll('.lp-guide'));
var ticking=false;
function update(){
  ticking=false;var vh=innerHeight;
  // 画面に入ったもの、または素早く通り過ぎて上にあるものは表示状態にする（読めないまま残さない）
  items=items.filter(function(el){if(el.getBoundingClientRect().top<vh*.88){el.classList.add('is-in');return false}return true});
  // ガイド線: 画面の下 85% に入ってから、画面の 40% まで上がる間に 0→1 まで伸びる（戻れば縮む）
  if(!reduce)guides.forEach(function(g){var t=g.getBoundingClientRect().top,p=(vh*.85-t)/(vh*.45);p=p<0?0:p>1?1:p;g.style.setProperty('--p',p.toFixed(3))});
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
