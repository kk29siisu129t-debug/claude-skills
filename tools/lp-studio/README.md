# LP Studio — LP / LPO 自動化ツール

ヒアリングを整理したブリーフから、次の工程を **1つの project JSON（共通データモデル）** で一続きに扱うツールです。

構成案 → 編集できるWF → PC/SPデザイン → HTML出力 → 根拠付きのLPO仮説と検証計画

- 依存パッケージはありません（Node 22 と、テスト用にプリインストールの Playwright/Chromium を使います）。
- `tools/lp-studio/` の中で完結しています。既存の hub / crew / skills のファイルは変更していません。
- 設計判断と監査役との壁打ちの記録は `docs/DESIGN.md`、実装監査（差し戻し→修正→再検証）の記録は `docs/AUDIT.md` にあります。
- 実スクリーンショットは `docs/screenshots/` にあります。撮り直すときは `node docs/take-screenshots.mjs` と `LP_STUDIO_SHOTS=$PWD/docs/screenshots npm run test:e2e` を実行します。

## すぐ使う

### A. ダブルクリックで開く（推奨・インストール不要）

`dist/lp-studio-standalone.html` をブラウザで開くだけで使えます。

- Chrome / Edge / Safari / Firefox の現行版で動きます。
- 1ファイルで自己完結しています（外部通信なし、seed 埋め込み、CSP 付き）。
- 編集内容はブラウザの localStorage に自動保存されます。
- 作り直すときは `node build-standalone.mjs` を実行します。

### B. ローカルサーバーで開く（開発用）

```bash
cd tools/lp-studio
npm start                 # http://127.0.0.1:4173/ （127.0.0.1 のみ。公開・デプロイ用ではない）
npm test                  # unit 69件（core / schema / claim / LPO / render / export / 監査の回帰）
npm run test:e2e          # ブラウザ統合 14件（Chromium。Playwright が必要）
```

Node 22 以上が必要です。依存パッケージはありません。

## AI生成について（動く範囲を正確に）

| 経路 | 新しい secret | 実際に動くか | 中身 |
|---|---|---|---|
| **テンプレート下書き**（ブラウザ / CLI `template`） | 不要 | 動く | **ルールベース**です。ブリーフ値を `{{promise}}` 等で決まった型に差し込み、分からない所は `【要記入】` にします。文章は生成せず、AI推論もしません |
| **seed** | 不要 | 動く | 人が書いた架空のデモ原稿です。AI生成ではありません |
| **Claude Code 生成**（CLI `prompt` → Claude Code → `ingest`） | 不要 | **動く（Claude Code セッションが推論する）** | ツールは指示と JSON 契約を出し、検証・取り込みをするだけです。文章と構成を考えるのは Claude Code セッションのモデルです |
| **ブラウザから推論APIを直接呼ぶ** | 必要になる | **未接続** | APIキー・OAuth・外部連携は追加していません |

### Claude Code 生成で、ブリーフから文章と構成を作る

```bash
node cli.mjs seed --out /tmp/p.json                                          # またはブリーフを入れた自分の project JSON
node cli.mjs prompt --project /tmp/p.json --mode full > /tmp/prompt.md        # reangle --promise "…" / section --section <id>
#   ↓ Claude Code に「/tmp/prompt.md を読んで JSON 契約どおりの JSON を /tmp/r.json に書いて」と頼む
node cli.mjs ingest --project /tmp/p.json --response /tmp/r.json --mode full --out /tmp/p2.json
node cli.mjs export --project /tmp/p2.json --kind draft --out /tmp/draft.html # レビュー用
#   ↓ UI（JSON読込）で内容を確認して各セクションを承認し、根拠を検証する
node cli.mjs export --project /tmp/p3.json --kind safe --out /tmp/page.html   # ブロッカーがあれば終了コード3で出力しない
```

**実地例**: `examples/claude-code-run/` に、このリポジトリの作業セッションで実際に行った一連の記録があります。

1. `prompt.md`（ツールの出力）
2. `response.json`（Claude Code が書いた JSON）
3. `ingest-report.txt`
4. `project.after.json`（全セクション未承認・根拠候補は未検証）
5. `draft.html`
6. `approve-demo.mjs`（**デモの確認者による承認を模したスクリプト**です。実運用では人が UI で承認します）
7. `project.reviewed.json`
8. `safe.html` と `safe-report.txt`

取り込みでは、生成物はすべて未承認、根拠候補は未検証になります。さらに次のものを含むフィールドを拒否します。

- HTML・URL
- 参考LP固有値・薬機法の語彙・推薦文・権威
- 確定ブリーフにも verified 根拠にも無い数値・保証・煽り

ブラウザUIでは「7 生成（Claude Code）」タブで、同じことをコピーと貼り付けで行えます。

## 画面と工程

1. **ブリーフ**: 商材・対象者・課題・約束する価値・オファー・価格・CTA・トーン・運営者表記を入力します。
   - 各項目に「確定 / 未確定 / 未入力」を付けます。
   - 商材カテゴリを選びます（健康・美容では薬機法の語彙を公開不可にします）。
   - ブランドtoken（色4つ・書体）を設定し、コントラストを判定します。
2. **構成・WF**: 3つの作業モードがあります。
   - **LP全体作成**: 参考構成でテンプレートから全体を下書きするか、Claude Code に渡す指示を作ります。
   - **訴求変更**: FV・再コミット・クロージングを作り直し、残りのセクションに「要再確認」を立てます。
   - **セクション編集**: 1つのセクションを直接編集するか、単体で作り直します。
   - セクション計画には、各セクションの役割・根拠（参考構成での位置づけ）・不足情報が出ます。
   - 任意セクションの追加・削除、全セクションの並べ替え、テキスト編集、承認、claimRefs（主張を支える根拠）の指定ができます。
   - WF は同じデータから描画されます。
3. **デザイン PC/SP**: 1280px と 400px のプレビューです。「編集中（未確認に旗）」と「公開用（safe）」を切り替えられます。
4. **CTA比較**: 文言・色・固定CTAの表示タイミング（FV後 / 常時 / 半分以降）を最大4案まで、SPプレビューで並べて比べます。**実配信・広告変更はしません**。
5. **根拠・検証・Export**: 根拠の追加と検証ができます（検証済みにするには確認者・確認日・出典が必須）。検証結果の一覧と、2種類の書き出しがあります。
   - **draft**: レビュー用です。未確認の箇所に旗を付け、noindex と「公開しないでください」バナーを入れます。
   - **safe**: 公開可能なものだけを出す **fail-closed** の書き出しです。
     - 承認済みのセクションだけを出し、未確定の値・根拠のない主張・要記入をフィールド単位で除外します。
     - 必須セクションの欠落、運営者表記の未確定、CTAの未確定、コントラスト不足があれば書き出しません。
6. **LPO**: 架空の集計データだけを扱います（`fictional: true` が必須）。
   - 観測（数値・95%CI・SRM）と、推測（仮説と検証計画）を分けて表示します。
   - 「架空データ」のバナーを固定で出し、ヒートマップ・メール・外部分析・広告配信が未接続であることを明示します。
7. **生成（Claude Code）**: 上記の受け渡しを行います。

上部バーの機能は次のとおりです。

- 戻す / やり直す（Ctrl+Z / Ctrl+Shift+Z）
- JSON保存 / JSON読込（JSONのみ。HTMLは拒否）
- 架空seed / 新規

ブラウザの戻る / 進むはタブ単位で動きます。

## 安全の作り

- **入力**:
  - schema v1 で検証します。未知キーは削除し、`__proto__` / `constructor` / `prototype` は拒否します。上限は2MBです。
  - schemaVersion が無い v0 は v1 に移行し、未知の版は拒否します。
  - verified なのに確認者・確認日が無い根拠は、読込時に未検証へ降格します。
- **描画**:
  - すべての文字列を escape し、アプリ側も `textContent` だけで描画します（innerHTML は使いません）。
  - URL は `https:` / `mailto:` / `tel:` / `#id` だけを許可します。色は `#RRGGBB` だけです。
  - export HTML の script はツールが持つ固定文字列だけで、CSP の `sha256` を付けています。
  - プレビューは `sandbox="allow-scripts"`（same-origin なし）の iframe で表示します。
- **主張の検査**:
  - 対象: 数値、最上級、保証、煽り、権威、推薦、オファー、参考LP固有値、薬機法の語彙（health/beauty）。
  - そのセクションの claimRefs が指す **検証済み** 根拠に同じ値・語が無ければ「根拠なし」とします。

## LPO の判定ルール（固定）

| 項目 | ルール |
|---|---|
| 有意水準 | α=0.05（両側）。多重比較は Bonferroni で補正 |
| 必要サンプル | 検出力0.8、MDEは相対20% |
| 最低限の量 | 各群の分母が1000以上、かつCVが30以上 |
| 割付比のずれ | SRM（カイ二乗）p<0.001 なら判定しない |
| データの欠損 | 欠損日・欠損セル・CV>分母のどれかがあれば判定しない |
| 期間 | 予定期間が未了なら判定しない |
| 定義の一致 | 案の間で分母・CV定義・計測条件が違えば比較しない |
| 実験をまたぐ比較 | TZ・分母・CV定義・計測条件・ページが全部一致するときだけ「比較の前提を満たす」と表示 |

有意差が出ても、ラベルは「差が観測された（この期間・この定義の範囲で）」にとどめます。因果と汎化は未確認と添えます。

仮説には次の項目を必ず付けます。

- 根拠種別（架空集計の観測 / このLPの監査結果 / 一般論）
- 優先度（影響×確度÷工数）
- 観測・理由、仮説（推測）、評価指標、guardrail、停止条件、注意

## 参考資料の扱い

**公開参考の観察仕様と添付スクリーンショットで検証しました。Claude からの参考URLの直接閲覧は、ネットワーク制限で実施していません。**

この実行環境のネットワークポリシーで、次の2つの参考URLへの接続が拒否されました（CONNECT 403）。

- 構成参考 `startdash.potex.jp/intro_ut`
- デザイン/動き参考 `members.katanumahotori.com/story-design-bootcamp`

使った根拠は次の2つです。

- 依頼文に書かれた観察仕様（構成の流れ、本文 720px / 17.5px / 34.1px、SP 16px / 31.2px、見出し30〜32px、固定CTA 340×66 / 54 等）
- ユーザーが添付したデザイン参考のスクリーンショット3枚（PCのFV、400pxのSPのFV、400pxの本文カードと固定CTA）

スクリーンショットからは次を取り込みました。

- 上部の対象者帯、淡色面と斜めの切り替え
- アクセント色の小見出し→極太の大見出し→補足の階層
- オファー帯（濃色の平行四辺形ラベル＋白いピル型CTA＋スクロール誘導）
- SPでの縦積み再配置（素材は下段に横並び、バッジは右上）
- 番号の透かし＋チェック丸＋点線区切りの本文カード
- グラデーションのピル型固定CTA、グリッド紙の背景

次のものは持ち込んでいません。

- 元サイトの人物・表紙・ロゴ・コピー・実績値（「受講者1,140名」等）
- 添付画像そのもの（アプリのassetにもexportにも入れていません）

FV右上のバッジには、**検証済みかつ数値付き** の根拠があるときだけ、その値を出します。

## 未実装・制約

- **ブラウザから推論APIを直接呼ぶ生成**: 未接続です（上記のとおり、意図して付けていません）。
- **画像・動画素材のアップロード**: 未実装です。FVの図解は、ブランドtokenで描いたオリジナルの図形です。コンセプト動画セクションには説明文の枠だけがあります。
- **実データのLPO**: 扱いません。ヒートマップ・メール・外部分析・広告配信は未接続です。実配信のAB・広告変更・公開・デプロイもしません。
- **原稿の文体（トーン）**: テンプレートは反映しません。トーンは Claude Code 生成の指示にだけ渡します。
- **主張の検出**: 語彙ベースです。言い換えをすべて拾うことはできません。そのため、承認済みセクションだけを公開する fail-closed を主たる防御にしています。

## ファイル

```
tools/lp-studio/
  cli.mjs            Claude Code から使う CLI
  build-standalone.mjs  自己完結版のビルド → dist/lp-studio-standalone.html
  sync-csp.mjs       プレビュー用スクリプトの CSP hash をアプリに反映
  examples/          Claude Code 生成の実地例
  serve.mjs          ローカル確認用の静的サーバー（127.0.0.1）
  src/core/          schema / sections / model / claims / generate / render / lpo / util（UI と CLI で共通）
  src/app/           ブラウザUI（index.html / app.js / styles.css）
  seed/              架空seed（make-seed.mjs で再生成）・架空LPOデータ
  tests/unit/        node:test
  tests/e2e/         Playwright（グローバル導入済みを利用）
  docs/              DESIGN.md / AUDIT.md / screenshots/
```
