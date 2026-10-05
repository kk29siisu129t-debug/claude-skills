# LP Studio 設計メモ（v1）

ブリーフ → セクション計画 → 編集可能WF → PC/SPデザイン → HTML export → LPO仮説と検証計画 を、
1つの project JSON（共通データモデル）で一続きに扱うツール。既存の hub / crew 機能とは独立（`tools/lp-studio/` 配下で完結、既存ファイルを変更しない）。

## 入力資料の範囲

- 下記仕様、架空seed（`seed/`）、実装コード。
- 参考URL 2件はこの実行環境のネットワークポリシーで接続拒否（403 CONNECT）。**ページ本体は未閲覧**。
  依頼文に記載された観察結果（構成の流れ・寸法・挙動）を「参考仕様」として使う。元LPの文章・ロゴ・写真・実績値は一切持ち込まない。

## データモデル（project JSON, `schemaVersion: 1`）

```
project
├ schemaVersion, id, updatedAt
├ brief        商材/対象者/課題/約束する価値/オファー/CTA/トーン/証拠[]/ブランドtoken
│              各フィールドは { value, status: confirmed|unconfirmed|missing }
├ evidence[]   { id, claim, source, status: verified|unverified, note }
├ sections[]   { id, type, enabled, fields{見出し,本文,...}, claimRefs[] }
├ cta          { label, href, variants[] {id,label,color,showRule} , activeVariant }
├ lpo          { dataset (架空), analysis 結果はキャッシュせず都度計算 }
└ history      undo 用はUI側メモリのみ（保存しない）
```

- WF / PC / SP は**同じ sections[] から描画**。WF は要素の箱と役割、PC/SP は brand token で描画。
- 編集はすべて `applyEdit(project, op)` を通す純関数。UI はその結果を再描画するだけ → 戻る/再読込で整合。

## セクション計画（参考構成の役割に準拠）

| type | 役割 | 必須 |
|---|---|---|
| fv | 誰の何をどう変えるかを3秒で | ✔ |
| concept_video | 任意。動画素材があるときだけ | |
| empathy | 対象者の現状の痛みを言語化 | ✔ |
| reframe | 「なぜ今までうまくいかないか」の捉え直し/比較 | ✔ |
| origin | 解決策の起源/差別化 | ✔ |
| steps | 提供のステップ | ✔ |
| scope | 提供範囲（含む/含まない） | ✔ |
| recommit | 再コミット（中間CTA） | |
| proof | 根拠（検証済みevidenceのみ公開） | ✔ |
| price_reason | 価格（またはオファー条件）の理由 | |
| fit | 適合条件（向く人/向かない人） | ✔ |
| closing | 未来像のクロージング + CTA | ✔ |
| footer | 運営者表記・注記 | ✔ |

オファー（無料・期間・人数等）は **brief.offer からのみ**差し込む。固定文言にしない。
FAQ・ページ内フォームはカタログ外（必須でない）。

## 3モード

1. **LP全体作成**: brief → 生成アダプタ → sections[] を丸ごと作る
2. **訴求変更**: 約束する価値/角度を差し替え、fv・closing・recommit の訴求系フィールドだけ再生成（他は保持）
3. **セクション編集**: 1セクションのフィールドを直接編集 or 単体再生成

## 生成アダプタ（AI生成とデモの区別）

- `template` アダプタ: ブリーフ値を決まった型に差し込む**決定的テンプレート**。UIでは「テンプレート下書き（AI生成ではない）」と表示。
- `claude-code` アダプタ: `node cli.mjs prompt` で生成指示（brief + schema + 禁止事項）を出力 → **Claude Code セッションが JSON を書く** → `node cli.mjs ingest` / UIの「生成JSONを取り込む」で schema 検証して取り込む。
  新規APIキー・外部API接続はしない。ブラウザ単体からはAIは呼ばれない（未接続と明示）。

## 安全

- import は JSON のみ。HTML import は存在しない。schema validation で未知キー削除、型・長さ・列挙を検査。
- 全テキストは描画時に escape。URL は `https:` / `mailto:` / `tel:` / 相対(#)のみ許可、それ以外は `#` に。
- プレビューは `iframe sandbox`（scripts 不許可の静的プレビュー + 親側で reveal 制御はしない）。export HTML 内の script はツールが生成する固定の小スクリプトのみ（reveal/固定CTA/カウンター）、ユーザー文字列を script に入れない。CSP meta 付与。
- **claim validation**: 数値・実績・権威・保証・煽り語を検出。evidence が verified でない claim は
  - draft export: 黄色の「未確認」注記付きで出す（noindex, レビュー用バナー）
  - safe export: 該当文を除去し、除去一覧をレポート。未確認ブリーフ項目も出さない。

## LPO

- 架空の集計データ（期間・TZ・分母定義・CV定義・計測条件・バリアント別集計）。
- 比較前に整合チェック（期間/TZ/分母/CV定義が一致しない → 比較しない）。
- サンプル不足（最小サンプル・検出力の目安）なら「勝者判定不可」。
- 出力: 観測（数値そのもの）と推測（仮説）を分離。仮説ごとに 優先度・理由・評価指標・guardrail・停止条件。
- ヒートマップ / メール / 外部分析は未接続と表示。

## デザイン token と動き

- PC本文幅 720px・17.5px/34.1px、SP(≤600) 16px/31.2px、見出し SP 30–32px。FVはSPで縦積み再配置。
- 段階的登場 0.5–0.9s、IntersectionObserver reveal、カウンター（検証済み数値のみ）。
- 固定CTA: FV可視中は非表示、本文で表示、インラインCTA可視中は非表示。PC右下 340×66、SP 全幅-余白 高さ54。
- `prefers-reduced-motion` で動きを停止。コントラスト比を token 検査（4.5:1 未満は警告）。
- 本文末尾に固定CTA分の余白を確保し、重なりを防ぐ。

---

## v2 — 監査役（設計壁打ち）指摘への対応

判定は「条件付き承認」。10件と補足2件をすべて採用した。

| # | 指摘 | 採否 | 設計の変更 |
|---|---|---|---|
| 1 | safe export が検出器任せ | 採用 | **fail-closed**。セクションごとに `approved`（人の承認）を持つ。safe export は承認済みセクションしか出さない。生成・再生成・訴求変更をすると承認は外れる。承認済みでも、検出器が根拠なしの主張を見つけたフィールドは除外する。proof の項目は verified の evidence だけから描画する |
| 2 | verified を誰が付けるか | 採用 | template / claude-code の生成物を取り込むとき、evidence は常に `unverified`、セクションは `approved:false` に強制する。verified への昇格は UI の人手操作（`verifiedBy`・`verifiedAt` が必須）だけ。evidence には `sourceType`・`provenance` を持たせる。verified なのに確認者・日付が欠けている evidence は、読込時に unverified へ降格する |
| 3 | 参考LP固有値の denylist | 採用 | `REFERENCE_DENYLIST`（3日間・無料・月100人・受講生1140人 など）を置く。ingest では、確定済みのブリーフに無い一致を含むフィールドを拒否する。brief と export では警告を出し、safe export では除外する |
| 4 | 景表法・薬機法 | 採用 | オファー・価格・限定・無料・比較価格は claim として扱い、verified の evidence が必要。`brief.category` が health / beauty のときは、薬機法の語彙（治る・痩せる・効く 等）を block 扱いにする |
| 5 | 除去の単位 | 採用 | 除去はフィールド単位。必須セクションが空になる、または footer の運営者表記（`brief.operator`）が confirmed でない場合、safe export は**ブロック**する |
| 6 | LPO の判定基準 | 採用 | 固定値: α=0.05（両側）、検出力0.8、MDE は相対20%、各群 visitors≥1000 かつ conversions≥30、SRM はカイ二乗 p<0.001 で判定不可、欠損日があれば判定不可、予定期間が未了なら判定不可（途中で覗く問題）、多重比較は Bonferroni。分母・CV定義・TZ・計測条件は variant 単位で一致を検査する |
| 7 | 架空データの表示 | 採用 | LPO の出力すべてに「架空データ」の固定バナーを出す。仮説ごとに根拠種別（`observed-fictional` / `project-audit` / `heuristic`）を必須にする。「原因」「勝者」の断定語を出力しないことをテストで検査する |
| 8 | 注入対策 | 採用 | 色は `#RRGGBB` だけ。URL は URL パーサで正規化し、`https:` / `mailto:` / `tel:` と `#id` 以外を拒否する（`//` と制御文字も拒否）。`__proto__` / `constructor` / `prototype` キーは拒否する。export の inline script には sha256 hash の CSP を付ける |
| 9 | reveal と no-JS | 採用 | 隠す状態は `html.js` が付いたときだけ。reduced-motion とカウンターでは最終値を即時に表示する |
| 10 | 幅と a11y | 採用 | 320/375/400/1280 で scrollWidth と重なりを自動検査する（受け入れ条件）。非表示中の固定CTAは `visibility:hidden` と `inert`。コントラストが4.5:1未満なら safe export をブロックする（CTA variant も対象） |
| 補 | 訴求変更の整合 | 採用 | 訴求変更をすると、再生成しない残りのセクションにも `needsReview` を立てる |
| 補 | migration | 採用 | `migrate()` を用意する。v0（schemaVersion 欠落）→ v1。未知の版は拒否する |
