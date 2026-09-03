# 稼働記録の書き方

`runs.jsonl` に1行1件で追記する（JSON Lines）。ダッシュボードはこれを読む。

```json
{"ts":"2026-08-26T17:05:00+09:00","crew":"auditor","status":"running","task":"POTEXの達成率を検算","detail":"報告84.9%と実算71.2%の差を追う","found":0}
{"ts":"2026-08-26T17:12:00+09:00","crew":"auditor","status":"done","task":"POTEXの達成率を検算","detail":"基準が2つ混在。経過日ベースと目標比","found":2}
```

| キー | 意味 |
|---|---|
| `ts` | ISO8601。タイムゾーン込み |
| `crew` | slug。`auditor` `chief-of-staff` `legal` `finance` `data-steward` |
| `status` | `running` 着手 / `done` 完了 / `blocked` 詰まった / `skipped` 見送り |
| `task` | 何をしているか。**一文で、動詞から始める** |
| `detail` | 補足。空でよい |
| `found` | 出した指摘・成果物の件数 |

## 規則

1. **着手時に `running` を1行書く。** 書かないとダッシュボードで「動いている」が見えない
2. 終わったら同じ `task` で `done` を書く。`running` のまま放置しない
3. 詰まったら `blocked` を書く。理由を `detail` に。**黙って止まらない**
4. `running` のまま24時間経った行は、ダッシュボードで「停滞」として赤く出る

追記したら `scripts/hub.ps1 save`。

## 書き方は1つに揃える（2026-09-04）

**正は `ts` / `status` / `detail`。**

```json
{"ts":"2026-09-04T07:40:00+09:00","crew":"marketing","biz":"Tクリニック",
 "status":"done","task":"何をしたか","detail":"結果と、次に効くこと"}
```

`status` は `running` / `done` / `blocked` / `skipped`。

### 起きた事故

2026-09-02 まで、`at` / `state` / `note` で書いていた時期がある。
**ビルダーは `ts` / `status` しか読まないので、その13件は画面に一度も出なかった。**
担当が「8日前から動いていない」と表示され続けていたが、実際は毎日動いていた。

**ログの形が違うと、動いていても止まって見える。**
過去分は消さず、読むときに揃える処理をビルダー側に入れた（`_norm`）。
**新しく書くときは上の形に揃えること。**
