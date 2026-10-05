# LP Studio 生成指示（Claude Code 用）

あなたは LP の構成・コピーの**下書き**を書く。出力は下記 JSON 契約に従う JSON のみ（```json フェンス可）。
この出力はツール側で schema 検証され、すべて「未承認」「根拠未検証」として取り込まれる。人が確認するまで公開されない。

## 禁止事項（違反したフィールドは取り込み時に拒否・除外される）
- ブリーフや根拠に無い数値・実績・受講者数・満足度・ランキング・受賞・メディア掲載を書かない
- 推薦文・お客様の声・専門家/医師の権威づけを創作しない
- 保証・断定（必ず/絶対/誰でも）、煽り（今だけ/残りわずか/限定）を書かない
- 効能効果（治る/痩せる/効く 等）を書かない
- 参考LP固有の値を使わない: 3日間 / 三日間 / 月100人 / 100人限定 / 先着100 / 受講生1140 / 1140人 / 1,140人 / 1140名 / 1,140名
- ブリーフ値は {{key}} 差込で参照する（例: {{offer}}）。値を書き写さない。使えるキー: product, audience, problem, promise, offer, price, ctaLabel, ctaUrl, tone, operator
- 分からないこと・ヒアリングが要ることは 【要記入: 何が必要か】 と書く。埋め合わせない
- HTML タグ・スクリプト・URL を書かない（プレーンテキストのみ）

## ブリーフ（status: confirmed=確定 / unconfirmed=未確定 / missing=未入力）
- product（商材）[confirmed]: ミチシルベ簿記（オンライン学習伴走・架空）
- audience（対象者）[confirmed]: 仕事と両立しながら簿記2級を目指す社会人
- problem（課題）[confirmed]: 教材は買ったが、平日の夜に何から手をつけるか決められず、週末にまとめてやろうとして崩れる
- promise（約束する価値）[confirmed]: 毎晩15分の「次にやること」が決まっている状態をつくる
- offer（オファー（条件））[unconfirmed]: 初回の学習設計面談（オンライン）
- price（価格）[missing]: （なし）
- ctaLabel（CTA文言）[confirmed]: 学習設計面談を予約する
- ctaUrl（CTAリンク先）[confirmed]: https://example.com/apply?utm_content=demo01
- tone（トーン）[confirmed]: 落ち着いて具体的。煽らない。
- operator（運営者表記）[confirmed]: 架空株式会社ミチシルベ（デモ用の架空事業者）
- category: education

## 根拠（id / status / 内容）。claimRefs には verified のものだけを入れる
- ev-hours [verified] 【架空】面談後4週間の平均学習日数は週4.2日（出典: 架空の社内集計（デモ用・2026年8月））
- ev-plan [verified] 学習計画は面談で一緒に作り、毎晩15分の単位に分けて、週ごとに見直す（出典: 架空のサービス仕様書 v1（デモ用））
- ev-voice [unverified] 【架空・未確認】受講者アンケートで満足度92%（出典: 出典未確認）

## セクションの役割（参考構成の流れ）
- fv: FV（ファーストビュー） — 誰の・どんな状態を・どう変えるかを3秒で伝え、最初のCTAを置く（必須）
- concept_video: コンセプト動画（任意） — 世界観を短時間で伝える。素材がある場合だけ置く（任意）
- empathy: 共感 — 対象者の現状の痛みを本人の言葉で言語化する（必須）
- reframe: リフレーム / 比較 — うまくいかない理由を捉え直し、従来の方法と比較する（必須）
- origin: 解決策の起源 / 差別化 — なぜこの解決策が生まれたか、何が違うかを示す（必須）
- steps: ステップ — 申込後に何が起きるかを手順で見せ、不安を減らす（必須）
- scope: 提供範囲 — 含むもの / 含まないものを明示する（必須）
- recommit: 再コミット（中間CTA） — ここまでの要点を一文で束ね、もう一度行動を促す（任意）
- proof: 根拠 — 検証済みの事実・出典だけで主張を支える（必須）
- price_reason: 価格 / 条件の理由 — 価格やオファー条件がなぜその設定なのかを説明する（任意）
- fit: 適合条件 — 向いている人 / 向いていない人を明示する（必須）
- closing: 未来のクロージング — 行動した後の状態を描き、最後のCTAを置く（必須）
- footer: フッター — 運営者表記・注記（必須）

## 依頼
LP全体の sections を上の順で書く（concept_video は素材が無いので不要）。

## JSON 契約
```json
{
  "generator": "claude-code",
  "mode": "full",
  "sections": [
    {
      "type": "fv",
      "fields": {
        "heading": "",
        "lead": "",
        "body": "",
        "note": "",
        "items": [],
        "itemsAlt": []
      },
      "claimRefs": []
    }
  ],
  "evidenceCandidates": [
    {
      "claim": "確認が必要な事実の候補",
      "source": "どこで確認できるか"
    }
  ]
}
```
