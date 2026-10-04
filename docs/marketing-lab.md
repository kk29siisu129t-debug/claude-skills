# 3事業マーケ施策レビュー（試作品・第1段階）

PASSLABO / POTEX / Tクリニック で、架空の施策を1件ずつ
**依頼 → CR比較 → LP差分 → 計測QA → 承認レビュー → 実験結果・次の仮説** の順に追える、読取り中心の試作品。

- **すべて架空データ。** 広告・LP・フォーム・計測・Google Sheets には接続していない
- 公開・配信・停止・増額・承認を実行するボタンは無い。画面は表示だけ
- 指標の段階定義はデモ用。本番の定義が確定したわけではない

## ファイル

| パス | 役割 |
|---|---|
| `data/marketing-lab/fixtures/*.json` | 事業ごとの架空fixture（1ファイル＝1 business_id） |
| `scripts/marketing_lab.py` | 読込・検証・評価・HTML描画の共通モジュール（標準ライブラリのみ） |
| `scripts/build-marketing-lab.py` | preview 生成。hub の private データ（issues / people / mytasks / カレンダー等）は読まない |
| `tests/test_marketing_lab.py` | 自動テスト（unittest） |
| `scripts/build-office.py` | ヘッダに「マーケ試作（架空）」の入口リンクを1つ追加しただけ |

## 作り方・見方

```
OFFICE_NOW=2026-10-04T09:00:00+09:00 OFFICE_TODAY=2026-10-04 python scripts/build-marketing-lab.py <出力パス>
python -m unittest discover -s tests -v
```

- 出力パスを省くと hub 直下の `marketing-lab.html`。**生成物なので commit しない**（`hub.ps1 save` は `git add -A` なので、
  生成した場合は保存前に消すか、対象ファイルだけ stage する）
- `OFFICE_NOW` は時差付きISO、`OFFICE_TODAY` は `YYYY-MM-DD` か build-office.py と同じ `MM-DD`
- `--fixtures <dir>` で別の fixture を読める（テストで使用）
- 終了コード: 0 = 全事業を検証できた／2 = 検証停止の事業がある（画面は作り、止まった理由を出す）
- office.html の入口は相対リンク `marketing-lab.html`。**Artifact として office.html だけを公開した場合はリンク先が無い。**
  公開の方法（同じ Artifact に files で載せるか、別 Artifact にするか）は未決定で、この段階では公開しない

## データ契約（`schema: "marketing-lab/v1"`）

1ファイル = 1事業。`demo: true` が必須。ID はすべて**同じ事業の中だけ**で引く。

| キー | 中身 |
|---|---|
| `business_id` / `business_name` | 事業の分離キー。ファイル間で重複したら検証停止 |
| `metric_definitions[]` | `id` / `version` / `status` / `stages[{key,label,definition}]` / `primary_cv_stage` |
| `lps[]` | `id` / `current_version` / `url`（予約ドメインのみ） |
| `flows[]` | 導線・対応表。`id` / `version` / `lp_id` / `form_id` / `events[{name,stage,rule}]` / `utm_rule` / `id_carry` |
| `checklist[]` | 本番前に足りない接続・定義・承認条件 `{item,state,note}` |
| `campaigns[]` | 下記 |

施策 (`campaigns[]`):

| キー | 中身 |
|---|---|
| `campaign_id` / `title` | |
| `request` | `product` / `persona`（個人情報なし）/ `objective` / `primary_cv{stage,label,definition}` / `period{start,end}` / `hypothesis` / `budget_cap{media_yen,production_yen}`。null は「未確認」表示。上限は支出許可ではない |
| `creatives` | `appeal_axes`×3、`tone_axes`×3、`items`×9（各 `id`/`version`/`appeal`/`tone`/`hypothesis`/`copy`/`cta`/`asset{source,rights,rights_checked,expires}`） |
| `selected_creative` | `{id, version}` |
| `metric_def_ref` / `flow_ref` | `{id, version}` |
| `lp_change` | `lp_id` / `url` / `current_version` / `proposed_version` / `creative_ref` / `changes[{where,before,after}]` / `expected_action` / `alignment{appeal,price,cta}` / `measurement_impact` / `reviewer` / `rollback_version` |
| `qa` | `target{creative,lp,flow,form_id}` と `items[{key,plan,status,evidence,checked_at,checker}]`。key は `mobile` `links` `form_thanks` `utm_id` `duplicate` `event_once` の6つ必須。status は `未検証`/`合格`/`失敗`、初期は `未検証` |
| `approvals` | `required[{role,label}]` と `records[{id,role,status(未了/OK/NG),target{business_id,campaign_id,creative,lp},at,scope,evidence}]` |
| `results` | `periods[{id,label,start,end,population,metric_def,occurred{from,to},source_updated_at,fetched_at,counts,spend_yen}]`、`comparisons[{a,b}]`、`data_quality[]`、`next_hypotheses[]`。counts の未取得は null（0 と区別） |

## 判定のルール

**検証停止**（その事業はレビュー・集計を出さず、理由だけ出す。他の事業は巻き込まない）

- 不明ID・重複ID・他事業のIDや他事業向け承認の混入
- 負数、整数でない件数、bool、NaN / Infinity（読込時に拒否）、予約ドメイン以外のURL
- 日付が読めない、時差の無い日時、開始＞終了、発生期間が集計期間の外、元更新＞取得、取得が未来、期間終了前の取得、承認・QA確認日時が未来
- 9提案（訴求3×トンマナ3）がそろわない、QA6項目の欠け、状態値の不正

**レビュー未完了**（理由を全部並べる）

- 選定CRの版が現行でない／素材の権利未確認・期限切れ（期限当日までは有効）・期限未確認
- LP変更票やQAの対象版が現行CR・提案LP・現行導線と違う
- QA の未検証・失敗、合格/失敗なのに証跡か確認日時が無い
- 必要な役割（代理店・クライアントを別判定）の未了・NG、古いCR/LP版へのOK、証跡・日時・範囲の欠けたOK
- 同じ役割に記録が複数あれば、日時（時差を考慮）の新しいものを採る

すべて満たすと「条件充足（デモ）」になるが、それでも実行ボタンは出ない。

**指標**: CTR = クリック ÷ 表示、CVR = 主要CV ÷ クリック、CPA = 費用 ÷ 主要CV、加えて段階間の率。
分母ゼロ・分子/分母の未取得は「判定不可」と理由を出す（Infinity / NaN / 誤った0%は出さない）。
比較は母集団か定義版が違えば止め、期間の長さが違えば件数を比べず率だけ並べる。差は観測値で、因果は検証していない。

## 本番接続までの未確定事項

1. 各事業の本番の段階定義（何を登録・相談・体験・来院・契約・着金と数えるか）と定義版の管理者
2. 実績データの取得元・締め日・更新頻度（POTEX の元数値管理シートには書き戻さない前提）
3. 代理店・クライアントの承認者、承認の記録場所、証跡の形式
4. フォーム / Thanks / CVイベントの実装とQAの実施者・証跡の置き場所
5. 素材の権利・使用期限の台帳
6. office.html からの入口の公開方法（Artifact の構成）
7. 書き込み（依頼の起票や承認の記録）を画面から行うか。現状は fixture を直してビルドし直す読取り専用
