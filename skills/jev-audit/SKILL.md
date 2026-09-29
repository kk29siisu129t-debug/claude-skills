---
name: jev-audit
description: Jev（TypeSafe AI の判断特化モデル）で成果物を機械検品し、差し戻し予測・監査観点・5基準・提案資料の作法に当てて 合格/要修正/目視 を表で返す。Use when the user says /jev-audit, Jevで見て, 機械チェック, スコア出して, 判定して, or before kansayaku / reviewer run on a file. Do NOT use for generating text or checking arithmetic — Jev cannot write or calculate.
---

# Jev で機械検品する

Jev は文章を書かず、渡した文書に対して **判定だけ** を確率・点数で返す AI（TypeSafe AI、2026-09-15 提供開始）。
LLM の 20〜200 倍速く、料金は入力 $0.042/100万トークン、出力無料、月 $5 の無料枠。
1文書の検品は 0.1〜1 円以下。**費用を気にして回避しない。**

この持ち場の役割は、`kansayaku` と `reviewer` が読む **前** に、型の抜け（結論が1行目にない、分母がない、推奨が3つある、比喩がある）を機械で落とすこと。
人の監査は数字の正しさと一次資料の照合に集中できる。

## 使い方

```bash
node scripts/jev/jev.mjs check <file> --rubric <name> [--rubric <name2>] [--json]
```

`claude-hub` 直下で実行する。複数ルーブリックは 1 リクエストにまとまる（文書分のトークンは1回分しか課金されない）。

| 対象 | ルーブリック |
|---|---|
| 代表に出す報告・ブリーフ・打ち手（既定） | `output-contract` |
| 数字を含むもの・対外に出るもの（監査役の前段） | `kansayaku` |
| `content/` `reports/` に書いたファイル（品質審査の前段） | `reviewer` |
| 対外提案資料（JV・営業提案。HTML可） | `proposal` |

典型: `--rubric output-contract --rubric kansayaku`（報告物）、`--rubric proposal --rubric kansayaku`（提案書）。

その他:
- `node scripts/jev/jev.mjs ping` — 接続とキーの確認
- `node scripts/jev/jev.mjs rubrics` — ルーブリック一覧
- `node scripts/jev/jev.mjs ask --state @file --questions '{...}'` — 単発の定量化（下記）

## 結果の読み方

```
❌ 要修正 2件（目視 3・注意 1・対象外 4）
| 判定 | 項目 | 値 | 直し方 |
```

| 判定 | 意味 | 扱い |
|---|---|---|
| ❌ 要修正 | 閾値を割った | **直してから再実行。** 本人にはこの状態で出さない |
| ⚠️ 目視 | Jev が迷っている（noul 35〜65%、confidence < 0.55） | 人が原文を見て確定する。放置しない |
| ℹ️ 注意 | 規制業種など、落第ではないが人が見る項目 | `expert-domain-stance` を通す |
| ✅ 合格 | 閾値内 | そのまま |
| － 対象外 | 前提が成立しない（数字が無い文書に出典を求めない等） | 無視してよい |

終了コード: 0 = 要修正なし、2 = 要修正あり、1 = エラー。スクリプトから使うときはこれで分岐する。

## Jev にできないこと（ここを人が持つ）

- **数字が正しいかは検算しない。** 分母が書いてあるかは判るが、分母が合っているかは判らない。一次資料への降り方は `kansayaku` のまま
- 計算・日付比較・文章生成はできない
- **日本語は英語より精度が落ちる。** 質問文は英語で書いてある。「目視」が多いときは Jev の迷いで、文書の問題とは限らない
- 1リクエスト 64K トークン。長い文書は先頭 50,000 字で切る（表の2行目に ⚠️ が出る）
- **見た目は見えない。** HTML はタグと CSS を落として渡すので、文字サイズ・行間・追従見出し・グラフの重なりは判定できない。`proposal-doc-style` の回帰チェック6点は従来どおり人がレンダリングして見る
- **原文と突き合わせる項目は判定できない。** 引用が原文どおりか、出典の言い回しを格上げしていないか、相手の呼称が合っているかは、出典を横に置いて人が見る
- 「リードタイム最短か」は判定していない。期限の有無だけ

## 単発の定量化に使う

会議の発言や候補リストを、点数や分類に落としたいときは `ask` を使う。質問は英語、対象は日本語のまま。

```bash
node scripts/jev/jev.mjs ask --state @reports/xxx.md --questions '{
  "decided": {"type":"noul","instructions":"Was a decision actually made, rather than deferred to consider later?"},
  "severity": {"type":"score","instructions":"How urgent is this issue for the business?","criteria":["Cosmetic","Degraded with workaround","Blocking","Causing financial loss"]}
}'
```

型は3つ。`noul`（真偽 → 0〜1 の確率）、`choice`（選択 → 選ばれた候補と確率分布と confidence）、`score`（段階評価 → 段階の重み付き平均と confidence。criteria は低→高の配列、2〜10段階）。

## ルーブリックの直し方

`scripts/jev/rubrics/*.json`。**質問と閾値は全部ここにある。他の場所に散らさない。**

- `instructions` は英語。1問1命題。高い値＝Yes になる向きで書く
- `gate`: `{min}` / `{max}` / `{in:[...]}`。落第の閾値
- `flag_if`: 落第ではなく「注意」で出す
- `applies_if`: `{q: <同じルーブリック内の noul の id>, min: 0.5}`。前提が立たなければ「対象外」
- `fix`: 落ちたときに表に出す直し方。memory の型（output-contract / proposal-doc-style）の言葉をそのまま使う

本人からの差し戻しが新しく出たら、その一言を **質問1つ** に足す。それがこの仕組みの育て方。

## ログと費用

全呼び出しを `data/jev/log.jsonl` に残す（日時・ファイル・ルーブリック・入力トークン・落ちた項目）。
月の使用量は `input_tokens` を合計して × $0.042 / 1,000,000。無料枠 $5 は約 1.2 億トークン分で、現実には届かない。

## 監査役・品質審査との関係

`kansayaku` と `reviewer` は、ファイルを読む前にこれを走らせ、出力の表を審査記録の冒頭に貼る（各エージェント定義の「機械検品を先に回す」参照）。
Jev の合格は人の監査の省略ではない。**落ちた項目の確認から始められる**、というだけ。
