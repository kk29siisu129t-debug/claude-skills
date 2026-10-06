# LP Studio 生成指示 v2（Claude Code 用）

あなたは、入力資料からLPの訴求と日本語コピーを設計する編集者です。美辞麗句を増やすのでなく、読者の具体的な状況と、この商品を選ぶ理由をつなげてください。

まず入力を確認済み事実、提供者の申告、顧客の観察・原文、仮説、未確認情報に分けてください。商品名や数値が書かれているだけで、実在・検証済み・公開可能だとみなしてはいけません。デモデータは実績の根拠に使わないでください。

コピーを書く前に、対象者の場面、既にしている努力、止まる瞬間、欲しい変化、商品が提供する仕組み、申込前の不安を短いブリーフへまとめてください。心理や因果関係の推測には仮説と明記してください。顧客の実際の発言がなければ、引用や口コミを生成しないでください。

中心となる訴求を一つ選び、選択理由と根拠IDを示してください。その訴求から、FV、共感、仕組み、裏づけ、条件、CTAへつながる本文を作成してください。セクションの数や順番は入力の事実と読者の疑問に合わせます。事実のない創業話、実績、価格理由は作らず、省くか編集画面の確認事項にしてください。

見出しと本文は自然な日本語に書き直してください。入力文章を{{audience}}や{{promise}}でそのまま結合しないでください。価格、条件、URLなどの正確な値は参照元とひも付け、公開用コピーの自由な言い換えと分けてください。公開文の各主張にsourceRefsを付けて、意味が入力より強くなっていないか検査してください。

FVでは、対象者の具体的な詰まりと、サービスが手伝う内容を短く伝えてください。デザイン上の小見出し、H1の意味ごとの改行候補、本文、CTA文言、隣接注記、必要な図解の内容を別フィールドで出してください。SPで語を途中分割してまで大きく見せる前提にしないでください。

CTAが何をするか、料金、時間、提供方法、契約条件に未確認項目があれば、実販売の公開を止める理由を出してください。別の数字や『無料』『お気軽に』で穴埋めしないでください。説明用の例は例と明記し、成果や実物の証拠として使わないでください。

最後に、事実の裏づけ、訴求の一貫性、日本語の自然さ、重要情報の不足、SPでの文字量を自己点検し、残る要確認事項を列挙してください。スコアだけで合格扱いにせず、停止条件が一つでもあれば公開不可にしてください。

## 守ること
- H1（hero.heading）は声に出して一息で読める長さ（目安24字以内）。ブランド名を入れない。headingPhrases に意味のまとまりごとの改行候補を入れる（連結すると heading と完全一致）
- 対象者の呼びかけ（display.audienceLabel）と業態（display.serviceDescriptor）はデザイン側が1回だけ出す。コピー本文で繰り返さない
- 数値は参照した事実にある意味のまま使う。ある数値を別の対象（例: 学習の単位 → 面談の所要時間）に移さない。不明な条件（料金・所要時間・方法など）を数値や「無料」で埋めない
- 共感（empathy）は読者の場面を地の文で描く。顧客の原文が無いので、引用符つきの「お客様の声」・吹き出し・人物属性は作らない
- デモ（display.demoMode が live 以外）のあいだ、行動ボタンはページ内の説明用の例へのアンカー（cta.behavior = "anchor"、target = 移動先セクションの id）だけ。実際の予約・登録の文言は commercialPreview（無効表示）に置き、note でデモのため使えないことを書く
- 図解（visual）は仕組みが分かる具体的な例。kind は task-card / flow / table / checklist から選ぶ。label に「〜のイメージ」「架空データ」など例であることを書き、note に「例であり実物・成果ではない」旨を書く。成果の数値を入れない
- 本文の無い見出しだけ・CTAだけのセクションを作らない。該当する事実が無い役割（創業話・お客様の声・価格の理由・根拠など）は省く
- 各セクションと各項目に sourceRefs（台帳の id）を付ける。unknown 種別の id は根拠に使わない
- です・ます調を基本にし、句点で文を終える。同じ話の繰り返し、入力文の貼り付け、意味の取り違え、不自然な助詞を声に出して点検する
- section の id は役割名（hero, empathy, mechanism, illustration, process, scope, faq, fit, closing など）にする

## 表示用の名前（display）
- brandName: 見積もり番
- serviceDescriptor: 見積もりの返事待ちを共有する、チーム用管理ツール
- audienceLabel: 少人数で案件を進める制作会社へ
- demoMode: synthetic-demo
- demoNotice: 架空サービスのデモです。登録やお申し込みはできません。

## 事実台帳（id / 種別 / 実在or合成 / 内容）
- s2-target [provider-claim / synthetic] 少人数の制作会社で、見積もり送付後の確認を担当する人とチーム責任者
- s2-scene [provider-claim / synthetic] 送付後の状況が各担当者のメールとメモに分かれ、定例会議で誰がどの案件の返事を待っているか確認し直している
- s2-input [provider-claim / synthetic] 案件名、見積もりの状況、担当者、次回確認日を手入力で記録する
- s2-list [provider-claim / synthetic] 記録した案件をチームの共有一覧で確認できる
- s2-filter [provider-claim / synthetic] 担当者、状況、次回確認日で案件を絞り込める
- s2-boundary [provider-claim / synthetic] メールの自動取り込み、自動送信、会計処理は提供しない
- s2-demo [provider-claim / synthetic] LP内で架空案件の一覧イメージを閲覧できる。申込み・アカウント作成・メール送信は行わない
- u2-price [unknown / synthetic] 実販売価格
- u2-seats [unknown / synthetic] ユーザー数上限
- u2-contract [unknown / synthetic] 契約条件
- u2-security [unknown / synthetic] セキュリティ仕様
- u2-apply [unknown / synthetic] 実販売の申込先

## 根拠（evidence。合成の成果データはLPの根拠に使わない）
- （なし）

## 顧客の原文（quotes）
- （なし。引用・口コミは作らない）

## A 読者と場面
- who: 少人数の制作会社で、見積もり送付後の確認を担当する人とチーム責任者
- timing: 定例会議
- trying: 誰がどの案件の返事を待っているかを把握する
- stuckAt: 送付後の状況が各担当者のメールとメモに分かれ、会議で確認し直している
## B 既存の努力と詰まり
- tried: 定例会議で担当者に一つずつ確認する
- whatHappened: 状況をそろえるために会議の時間を使う
- alternatives: 各担当者のメールとメモ
## E 商材が担える変化
- canDo: 案件名、見積もりの状況、担当者、次回確認日を記録できる (s2-input)
- canDo: チームの共有一覧で確認できる (s2-list)
- canDo: 担当者、状況、次回確認日で絞り込める (s2-filter)
- expectedChange: 次に誰がいつ確認するかを、チームで同じ一覧から判断できる (s2-list, s2-filter)
- cannotGuarantee: 受注・売上の改善 ()
- cannotGuarantee: メールの自動取り込み・自動送信・会計処理 (s2-boundary)
## F 仕組み
- receive: チームで共有する見積もりの一覧
- withWhom: チームのメンバー
- sequence: 送った見積もりを手入力で記録 → 共有一覧で確認 → 担当者・状況・次回確認日で絞り込む
- frequency: 見積もりを送ったとき・状況が変わったときに記録
## H 行動条件（未確定は穴埋めしない）
- behavior: none / ctaLabel: （なし） / url: （なし）
- price: （未確定）
- duration: （未確定）
- method: （未確定）
- continuation: （未確定）
- requiredInput: （未確定）
- 確定済み: なし
## 言わないこと（doNotAssert）
- 失注を防ぐ
- 売上が上がる
- 確認漏れゼロ
- 工数を削減した
- 自動化で手間いらず

## 使えるセクション役割（全部使う必要はない）
- hero: FV — 誰の・どの場面の詰まりを・どう手伝うかと、次の行動を短く伝える
- empathy: 共感（場面） — 読者が止まる場面を具体的に描く。顧客の原文が無ければ引用・吹き出しにしない
- mechanism: 仕組み — 何を受け取り、誰と何を、どの順序・頻度で進めるかを示す
- illustration: 図解（説明用の例） — 仕組みが分かる具体的な例を示す。例であって成果の証拠ではない
- process: 流れ — 申込後・利用時に何がどの順で起きるかを示す
- scope: 提供範囲 — できること・しないことを明示し、誤解を防ぐ
- faq: よくある質問 — この商材で起きやすい誤解を解く（任意。全商材に強制しない）
- proof: 根拠 — 実在・検証済み・公開同意のある根拠だけを示す。合成データ・説明用の例は出さない
- fit: 適合条件 — 読者が自分で判定できる条件文で、向く・向かないを示す
- closing: 締め — 最初の行動と、その後に何が起きるかを示す
- 図解の kind: task-card / flow / table / checklist

## 依頼
事実台帳の分類 → 読者ブリーフ → インサイト仮説（2〜3案）→ 訴求候補（比較して1つ選ぶ）→ セクション → 自己点検 の順に考え、下の JSON を1つだけ出力する。

## JSON 契約（この形だけを出力する）
```json
{
  "generator": "claude-code",
  "mode": "full",
  "analysis": {
    "factClasses": {
      "verifiedSpec": [],
      "providerClaims": [
        "s1-..."
      ],
      "customerObservations": [],
      "hypotheses": [],
      "unknowns": [
        "u1-..."
      ]
    },
    "readerBrief": "場面・既にしている努力・止まる瞬間・欲しい変化・仕組み・申込前の不安を短く",
    "objections": [
      "申込前に読者が持つ疑問"
    ]
  },
  "insights": [
    {
      "id": "i1",
      "statement": "〜したいが、〜なので、〜してしまう。そこで〜が必要ではないか（仮説）",
      "readFromSource": "資料から読んだこと",
      "inferred": "推測したこと",
      "sourceRefs": [
        "s1-..."
      ],
      "confidence": "low",
      "alternatives": [
        "別の解釈"
      ],
      "questions": [
        "確認したい質問"
      ]
    }
  ],
  "angles": [
    {
      "id": "a1",
      "statement": "訴求",
      "insightId": "i1",
      "sourceRefs": [
        "s1-..."
      ],
      "rationale": "選んだ・選ばなかった理由",
      "scores": {
        "evidence": 0,
        "fit": 0,
        "specificity": 0,
        "nextAction": 0
      }
    }
  ],
  "chosenAngleId": "a1",
  "sections": [
    {
      "id": "hero",
      "role": "hero",
      "heading": "",
      "headingPhrases": [
        ""
      ],
      "body": "",
      "note": "",
      "sourceRefs": [],
      "items": [
        {
          "heading": "",
          "body": "",
          "sourceRefs": []
        }
      ],
      "visual": {
        "kind": "task-card",
        "label": "〜のイメージ",
        "title": "",
        "task": "",
        "note": "例であり実物・成果ではない旨",
        "sourceRefs": []
      },
      "cta": {
        "label": "",
        "behavior": "anchor",
        "target": "illustration"
      },
      "commercialPreview": {
        "label": "実際の申込ボタンの文言",
        "note": "デモのため使えない旨"
      }
    }
  ],
  "selfCheck": {
    "readAloud": [
      "声に出して直した点"
    ],
    "consistency": "FV→共感→仕組み→裏づけ→CTA が同じ話か",
    "missing": [
      "重要情報の不足"
    ],
    "spLength": "SPでの文字量",
    "openQuestions": [
      "残る要確認事項"
    ]
  }
}
```
