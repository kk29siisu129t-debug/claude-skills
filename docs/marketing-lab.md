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
| `data/marketing-lab/measurement/*.json` | 計測の正規化レイヤーの合成fixture（架空事業アルファ／ベータ・架空の数値） |
| `scripts/measurement.py` | 計測の正規化・検証レイヤー（値状態・比較可能性・比の判定・親子の突き合わせ） |
| `tests/test_measurement.py` | 計測レイヤーの回帰テスト |
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
- 終了コード: 0 = 全事業を検証できた／2 = 検証停止の事業がある、または fixture が0件（画面は作り、止まった理由を出す）
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
| `results` | `periods[{id,label,start,end,population,metric_def,occurred{from,to},source_updated_at,fetched_at,counts,spend_yen,basis,timezone,currency,cost_basis}]`、`comparisons[{a,b}]`、`data_quality[]`、`next_hypotheses[]`。counts の値は 整数／null（未取得）／`{raw, declared_state}`（計測レイヤーで状態に直す）。`basis` は `occurrence` のみ、`timezone` は IANA 名 |

## 判定のルール

**検証停止**（その事業はレビュー・集計を出さず、理由だけ出す。他の事業は巻き込まない）

- 読めないJSON、`NaN` / `Infinity`、`1e999` のような有限でない数値、4300桁を超える整数リテラル（読込時に拒否）
- 形の違反（`marketing_lab.SHAPE`）: 必須キーの欠け、配列・オブジェクト・文字列の型違い。形が壊れた事業は意味の検証も描画もしない
- fixture が0件なら画面に「検証停止」を出す。想定外の例外も事業単位の検証停止に変え、画面全体は落とさない
- 不明ID・重複ID・他事業のIDや他事業向け承認の混入
- 負数、整数でない件数、bool、有限でない数値（Python から直接渡された `float('inf')` / `nan` も）、
  上限 1000兆（`MAX_VALUE = 10**15`）を超える件数・金額、予約ドメイン以外のURL
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

## hub 入口の結合確認（実データなし）

`tests/test_marketing_lab.py` の `OfficeIntegration` は、一時ディレクトリに `build-office.py`・`build-marketing-lab.py`・
`marketing_lab.py`・架空fixture と、空の stub `data/issues.json`（`{"issues":[],"priority":{"weights":{}}}`）だけを置いて
両方のビルドを走らせる。build-office.py の読込先は自分のディレクトリ基準（`HUB`）なので、実データは参照されない。
Python の監査フックで open を記録し、一時ディレクトリと Python 本体以外を開いていないこと、
`data/` で読んだのが stub だけであることを確かめたうえで、`office.html` の入口リンク先 `marketing-lab.html` が
隣に生成されていることを見る。stub は課題0件なので、office.html の中身（部屋・課題の表示）の確認にはならない。

## 計測の正規化・検証レイヤー（合成データ）

画面の「計測の正規化（合成データ）」タブ。**架空事業アルファ／ベータの合成データだけ**で動き、元データのシート・API・実集計には
つながない。出典は `synthetic://` の placeholder 以外を検証停止にする（実 sheet ID や URL を入れられない）。

### 値の状態（0 と欠測を混ぜない）

| 状態 | 元の値の例 | 扱い |
|---|---|---|
| 値あり | `120` `"180,000"` | 正規化値を持つ |
| 0（実測） | `0` `"0"` | **0 のまま保持**。比の分子にも使う。分母なら「判定不可（分母が0）」 |
| 空欄 | `null` `""` `"  "` | 0 にしない。足さない・比べない |
| 取得不可 | `declared_state: "unavailable"` | 元が空のときだけ宣言できる |
| 元データエラー | `"#REF!"` `"#DIV/0!"` `"-"` `"abc"` 負数・小数の件数・bool・巨大値 | 理由を出す。値として使わない |
| 対象外 | `declared_state: "not_applicable"` | 元が空のときだけ宣言できる。値があるのに宣言したら矛盾としてエラー |

原値（`null` と `""` と `0` と `"0"` を見分けられる形）と状態を、画面の全行で並べて出す。

### 観測行が持つもの

事業・ブランド、source（`synthetic://` placeholder・IANA timezone・データ cutoff・取得時刻）、指標定義（id/版・ラベル・
`unit`＝行数/人数（ユニーク）/金額・`basis`＝発生日/登録cohort・`purpose`＝マーケ計測/手数料請求の対象判定・金額なら通貨と費用基準・
`population_of`）、報告期間、cohort（開始・終了・観測終了日）、階層（campaign / ad / creative）、creative の元のID、元の位置（架空）、原値。

### 判定のルール

- **系列**: 定義・版・単位・基準・用途・timezone・通貨/費用基準・階層が1つでも違えば別の表。同じ系列・対象・期間・source の行が
  2つあれば検証停止（上書きも合算もしない）
- **conversion rate と呼べるのは**、分子と分母が同じ対象・同じ期間・同じ登録cohort、分子が分母の母集団の部分集合として定義され
  （`population_of`）、両方とも測れていて分母が0でなく、cohort の観測が cutoff までに終わっているときだけ
- **open cohort**（観測終了日の翌日0時が cutoff より後）は「暫定比（未成熟・CVRではない）」。値は出すが確定 CVR として扱わない
- **発生日基準の同期間の比**は「件数比（CVRではない）」。分子の人が分母に含まれる保証が無いため
- **期間・基準・対象・timezone・単位が違う比**、金額を含む比は「計算しない」（値を出さない）
- **手数料請求の対象判定**の定義を含む比は CVR にしない。マーケの定義が請求ルールを `rule_ref` や `population_of` に持つと検証停止
- **費用 ÷ 件数**は同じ対象・期間・timezone で、通貨と費用基準を必ず表示。期間が締まっていなければ計算しない
- **親子**: 親の値と子の行は足さない。子が全部測れていれば「行のある子の合計」と親との差を出し、どちらが正しいかは決めない。
  人数（ユニーク）は重複しうるので子を足さない。子に空欄やエラーがあれば合計を出さない
- **creative**: ID が空の行は「ID欠落（未紐付け）」、台帳に無い・所属が違う ID は「ID不一致（未紐付け）」。成果は捨てずに未紐付けとして残し、
  名前付き creative と比べない。行の無い creative は「行なし（0の証拠ではありません）」
- **比較**: 両方測れていて、定義・版・単位・基準・用途・timezone・通貨/費用基準・期間の長さ・階層が同じで、どちらも締まっていて、
  未紐付けでないときだけ差を出す。差は観測値で、原因は検証していない
- **timezone**: IANA 名をそのまま持つ。固定時差や東京への置き換えはしない。標準の `zoneinfo` で引けたものだけ「検証済み」とし、
  cutoff・取得時刻の時差がその時点の時差（夏時間を含む）と合わなければ検証停止。未知の名前も検証停止。
  timezone データベースが無い環境（Windows で `tzdata` が無い等）では「未検証」と表示し、成熟判定・比・比較を止める
- **既存の期間集計**（施策の結果）も同じ考え方に寄せた: 期間は発生日基準として明示し、`主要CV÷クリック` と段階間の比は
  「件数比（同期間・CVRではない）」と表示。CPA には通貨・費用基準を出し、基準・timezone・通貨・費用基準が違う期間は比較しない

### 合成fixtureの例と、比較を止める理由

| 例（架空事業アルファ／ベータ） | 判定 |
|---|---|
| 8月登録cohort 相談19 ÷ 登録者95（観測終了9/30・cutoff 10/1 0時） | conversion rate（確定）20.00% |
| 9月登録cohort 相談7 ÷ 登録者110（観測終了10/31） | 暫定比 6.36%（open cohort） |
| 9月 相談（発生日）`0` ÷ 登録（発生日）120 | 件数比 0.00%（0は保持。CVRではない） |
| 8月cohortの相談 ÷ 9月の登録（発生日） | 計算しない（期間・基準が違う） |
| 手数料請求の対象5 ÷ 登録120 | 件数比（請求判定の定義を含むのでCVRではない） |
| 8月 相談 `""` ÷ 登録 `"#REF!"` | 判定不可（空欄・数式エラー） |
| 費用（税込・America/Los_Angeles）÷ 申込（Asia/Tokyo） | 計算しない（timezone が違う） |
| 申込（行数）÷ 申込者（人数） | 計算しない（単位が違う） |
| 広告B-AD-1の申込30 と creative行 18＋ID欠落12、B-CR-2 は行なし | 行のある子の合計30。B-CR-2 は0扱いしない |
| キャンペーン費用 300,000 と 広告の合計 310,000 | 差 JPY -10,000 を表示し、どちらが正しいかは決めない |
| 申込者（人数）45 と 広告 28・19 | 合計を出さない（人数は重複しうる） |

## 本番接続までの未確定事項

1. 各事業の本番の段階定義（何を登録・相談・体験・来院・契約・着金と数えるか）と定義版の管理者
2. 実績データの取得元・締め日・更新頻度（POTEX の元数値管理シートには書き戻さない前提）
3. 代理店・クライアントの承認者、承認の記録場所、証跡の形式
4. フォーム / Thanks / CVイベントの実装とQAの実施者・証跡の置き場所
5. 素材の権利・使用期限の台帳
6. office.html からの入口の公開方法（Artifact の構成）
7. 書き込み（依頼の起票や承認の記録）を画面から行うか。現状は fixture を直してビルドし直す読取り専用
8. 計測レイヤー: 実データの取得元ごとの timezone・cutoff・取得時刻の持ち方、`population_of` を誰が定義するか、
   cohort の観測期間の長さ、費用基準（税抜/税込・手数料込）、creative の台帳と元のIDの対応。いずれも合成fixtureで形だけ決めた段階
9. Windows で動かす場合、`tzdata` が無いと timezone は「未検証」になり、比・比較が止まる（安全側。インストールはしていない）
