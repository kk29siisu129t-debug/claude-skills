# 2026-09-09 3事業へ絞り込み

代表の指示：**「EXTAGE、passlabo、Tクリニックだけやればいい。それ以外は全部破棄」「78件も破棄」**

## 何を外したか

| | 前 | 後 |
|---|---|---|
| 事業 | 10 | **3**（EXTAGE / passlabo / Tクリニック） |
| 経営課題 | 86 | **42** |
| 代表のタスク | 114 | **19** |
| 部屋 | 12（全社・誤アサイン含む） | **3** |

**外した事業：** POTEX / origin / エクソソーム / 失業保険 / 補助金コンサル / MUSE / AI company
**外したタスク：** 3事業以外の44件 ＋「人に振れる」分類の78件（重複含む・合計95件）

## ここに退避したもの

- `issues.json` — 86件すべて（絞り込み前）
- `mytasks.json` — 114件すべて（絞り込み前）
- `runs.jsonl` — 稼働記録（絞り込み前）
- `businesses/` — 外した7事業の蓄積ファイル
- `drafts/` — POTEX向けに作ったドラフト3件（未送信のまま）

**削除していない。**戻すときは `data/` へ戻して `BIZ_ORDER` を書き換える。

## 戻し方

```
scripts/build-office.py の BIZ_ORDER に事業名を足す
data/issues.json に archive/issues.json の該当分を戻す
data/mytasks.json も同様
```
