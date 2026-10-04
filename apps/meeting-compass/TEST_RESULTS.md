# テスト結果（自動生成ログ）

実行日時: 2026-10-04T02:18:13Z / Node v22.22.0 / Playwright 1.56.1 (Chromium) / 対象: Claude Artifact 版バンドル追加後（実API・実音声は未検証）

ユニットテストは tests/unit/no-network.mjs（外部通信を遮断）下で実行。Artifact 版 E2E は全リクエストを記録・中止し、外部リクエスト 0 件を検証。

## npm run lint
```
exit: 0
```

## npm run typecheck
```
exit: 0
```

## npm run test:unit
```
ok 1 - ゲートが許可していなければ mediaDevices を一切呼ばない
ok 2 - 取得手段が未設定（注入なし）なら開始できない
ok 3 - Meet タブ＋マイク：映像 track は即停止、停止で全 track を止めリスナーも外す
ok 4 - タブ音声が共有されていなければ失敗し、取れた track を全部止める
ok 5 - マイク取得が拒否されたら、先に取ったタブ音声も止める
ok 6 - 共有の終了（track ended）で全体を停止
ok 7 - 対面マイク：画面共有は要求しない
ok 8 - 取得待ちの間に停止されたら、後から届いた stream も止める
ok 9 - PCM 変換と間引き
ok 10 - no-network ガード自体が fetch / WebSocket / 外部ソケットを遮断する
ok 11 - 既定（環境変数なし）は厳密に無効で、登録済みプロバイダは0件
ok 12 - 有効化だけ・プロバイダ名だけでは開始できない（実プロバイダ未登録）
ok 13 - ゲート：有効化・資格情報の存在・同意・開始操作が全部揃ったときだけ許可
ok 14 - 資格情報の値は設定オブジェクト・公開状態のどこにも含まれない
ok 15 - 未設定プロバイダは何も送らずに失敗する
ok 16 - budget：リクエスト数・1回の入力・合計トークン・時間・音声の上限を強制
ok 17 - budget：確保中の分も合計に含め、release で戻せる
ok 18 - README の1時間仮試算を概算関数で再現（約 $1.12、参考値）
ok 19 - batcher：final 区間だけを最大30秒でまとめ、重複・空は無視、全文は送らない
ok 20 - batcher：文字数上限で早めに送る・requeue・停止時に破棄
ok 21 - http-guard：Host・Origin・CSRF・Sec-Fetch-Site・Content-Type・本文サイズ
ok 22 - レート制限：トークンバケット
ok 23 - 無許可・未設定ではプロバイダを一切呼ばない
ok 24 - 二重開始は拒否
ok 25 - final だけを30秒でまとめて1回だけ構造化し、差分を適用する
ok 26 - プロバイダ失敗：記録してセッションは継続、予算は確保分で計上
ok 27 - 不正な JSON・schema 違反の応答は適用しない
ok 28 - 古い応答（送信中にユーザー操作で revision が進んだ）は破棄し、1回だけ再投入
ok 29 - 予算上限：構造化リクエスト回数に達したら停止
ok 30 - 予算上限：音声時間・セッション時間で停止
ok 31 - 音声片の検証：空・奇数バイト・大きすぎる片を拒否
ok 32 - タイムアウト：応答が返らなければ abort し、記録して継続
ok 33 - 停止：進行中リクエストの中止・文字起こしの close・未送信の破棄・遅れた応答の無視
ok 34 - プロバイダの onError で停止する
ok 35 - 開始中（open 待ち）に停止されたら、開いた接続も閉じる
ok 36 - sanitizeError は長いトークン状の文字列を伏せる
ok 37 - schema は全項目 required・追加キー禁止
ok 38 - validate：不正な応答（JSONでない・キー不足/過剰・型・enum・件数・長さ）を拒否
ok 39 - apply：正しい差分はサーバー側IDで適用され、元の state は変わらない
ok 40 - apply：未知のID（論点・項目・親）を拒否し、部分適用しない
ok 41 - apply：古い revision の応答は obsolete として拒否
ok 42 - apply：確定は今回の発話に含まれる引用が必要（根拠なし・捏造引用は拒否）
ok 43 - apply：ユーザーが最後に変更した項目・決定は自動で上書きしない
ok 44 - input：短い現在状態＋今回の発話だけ。上限を超えると項目を減らす
ok 45 - デモ全体が全イベント成功で適用でき、ID は台本どおりで安定している
ok 46 - applyEvent は元の state を変更しない（差分適用）
ok 47 - 同じイベントIDの再適用は重複として無視される
ok 48 - 既存の項目IDへの追加は別イベントIDでも拒否（重複項目を作らない）
ok 49 - 話題の切り替えと戻り：項目は元の論点に残り、戻り回数が記録される
ok 50 - 存在しない論点への切り替えは拒否
ok 51 - 決定の撤回・再検討は上書きせず履歴に残る
ok 52 - 訂正は元の文を履歴に保持する
ok 53 - 根拠のない確定（沈黙・反対なし）は拒否され、仮案のまま「合意未確認」になる
ok 54 - 明示的な合意根拠がある場合だけ確定になる
ok 55 - evidence 無しの確定、追加時の status:confirmed 指定も仮案になる
ok 56 - ユーザー操作による確定・仮案戻し・再検討・撤回
ok 57 - 手動修正：訂正・種類変更・担当/期限の更新（空欄は不明=null）
ok 58 - アクションの担当・期限は台本で明示されない限り不明(null)のまま
ok 59 - 空・空白のみ・長すぎる本文は拒否
ok 60 - 論点が無い状態での項目追加は拒否
ok 61 - 危険な HTML は文字列のまま保持される（実行・除去しない）
ok 62 - 制御文字は除去される
ok 63 - 未知のイベント種別・未知の種類は拒否
ok 64 - classify: キーワード規則による分類
ok 65 - classify: どの規則にも当てはまらなければ未分類
ok 66 - classify: 空入力・空白のみは失敗
ok 67 - classify: アクションの担当・期限は明記されたときだけ取り出す
ok 68 - 手入力：「決定しました」でも仮案。確定にはならない
ok 69 - 手入力：論点が無ければ「論点未設定」を自動で開き、ID は決定的
ok 70 - 手入力：空入力は拒否され、何も追加されない
ok 71 - 手入力：種類を指定するとユーザー入力として追加
ok 72 - player: 再生・一時停止・一歩進める・再開・リセット
ok 73 - デモプロバイダ：最後まで再生してもエラー無し、リセット＋消去で空に戻り再生し直せる
ok 74 - session.clear は内容と ID カウンタを破棄する
ok 75 - 音声プロバイダは未接続：start は失敗し、mediaDevices に触れない
ok 76 - どのプロバイダも外部送信しない宣言
ok 77 - export: Markdown は HTML を無害化し、JSON は由来の注意書きを含む
ok 78 - 静的サーバー：index とセキュリティヘッダ、ディレクトリ外は 404
# tests 78
# pass 78
# fail 0
exit: 0
```

## npm run build
```
build ok: 16 files -> dist/
exit: 0
```

## npm run bundle:artifact
```
bundle-artifact ok: artifact/meeting-compass.html (99914 bytes, 13 modules)
exit: 0
```

## npm run test:e2e（通常版＋Artifact版、desktop/mobile）
```
  ✓   2 [desktop] › tests/e2e/app.spec.js:38:1 › 初期表示：由来の明記・停止状態・外部送信なし
  ✓   1 [desktop] › tests/e2e/artifact.spec.js:55:1 › Artifact版：初期表示・由来の明記・書き出し無効・無通信・無メディア
  ✓   3 [desktop] › tests/e2e/app.spec.js:57:1 › デモ：話題切替・脱線・戻り・撤回・訂正・合意未確認を一歩ずつ確認
  ✓   4 [desktop] › tests/e2e/artifact.spec.js:79:1 › Artifact版：デモ再生・一時停止・論点切替・訂正・撤回・手入力・修正・消去
  ✓   6 [desktop] › tests/e2e/artifact.spec.js:163:1 › Artifact版：ダークテーマ（OS設定・明示指定）でも背景と文字色がトークンから決まる
  ✓   5 [desktop] › tests/e2e/app.spec.js:117:1 › 再生・一時停止・再開・リセット
  ✓   7 [mobile] › tests/e2e/app.spec.js:38:1 › 初期表示：由来の明記・停止状態・外部送信なし
  ✓   8 [desktop] › tests/e2e/app.spec.js:143:1 › 手入力：空入力の拒否・規則分類・未分類・手動確定と修正
  ✓  10 [desktop] › tests/e2e/app.spec.js:212:1 › 危険な HTML 入力は文字として表示され、実行されない
  ✓  11 [desktop] › tests/e2e/app.spec.js:232:1 › 過去の論点の参照と「現在の論点にする」
  ✓   9 [mobile] › tests/e2e/app.spec.js:57:1 › デモ：話題切替・脱線・戻り・撤回・訂正・合意未確認を一歩ずつ確認
  ✓  12 [desktop] › tests/e2e/app.spec.js:249:1 › 書き出しは明示操作でのみ行い、消去で全て破棄される
  ✓  14 [desktop] › tests/e2e/app.spec.js:282:1 › リロードすると内容は残らない（メモリのみ）
  ✓  15 [desktop] › tests/e2e/app.spec.js:297:1 › 初期 viewport 内に現在論点・決定・次に決めること・アクションが収まる
  ✓  13 [mobile] › tests/e2e/app.spec.js:117:1 › 再生・一時停止・再開・リセット
  ✓  17 [mobile] › tests/e2e/app.spec.js:143:1 › 手入力：空入力の拒否・規則分類・未分類・手動確定と修正
  ✓  16 [desktop] › tests/e2e/app.spec.js:354:1 › 再生中に修正を開くと自動で一時停止し、入力は消えない
  ✓  18 [mobile] › tests/e2e/app.spec.js:212:1 › 危険な HTML 入力は文字として表示され、実行されない
  ✓  19 [desktop] › tests/e2e/app.spec.js:386:1 › 編集は Esc でキャンセルでき、再生ボタンが戻る
  ✓  20 [mobile] › tests/e2e/app.spec.js:232:1 › 過去の論点の参照と「現在の論点にする」
  ✓  22 [mobile] › tests/e2e/app.spec.js:249:1 › 書き出しは明示操作でのみ行い、消去で全て破棄される
  ✓  23 [mobile] › tests/e2e/app.spec.js:282:1 › リロードすると内容は残らない（メモリのみ）
  ✓  21 [desktop] › tests/e2e/app.spec.js:399:1 › 再生中も手入力欄の入力は保持される
  ✓  25 [desktop] › tests/e2e/app.spec.js:409:1 › タブ切り替え（クリックと左右キー）と要確認への導線
  ✓  24 [mobile] › tests/e2e/app.spec.js:297:1 › 初期 viewport 内に現在論点・決定・次に決めること・アクションが収まる
  ✓  27 [mobile] › tests/e2e/artifact.spec.js:55:1 › Artifact版：初期表示・由来の明記・書き出し無効・無通信・無メディア
  ✓  26 [mobile] › tests/e2e/app.spec.js:354:1 › 再生中に修正を開くと自動で一時停止し、入力は消えない
  ✓  29 [mobile] › tests/e2e/app.spec.js:386:1 › 編集は Esc でキャンセルでき、再生ボタンが戻る
  ✓  28 [mobile] › tests/e2e/artifact.spec.js:79:1 › Artifact版：デモ再生・一時停止・論点切替・訂正・撤回・手入力・修正・消去
  ✓  31 [mobile] › tests/e2e/artifact.spec.js:163:1 › Artifact版：ダークテーマ（OS設定・明示指定）でも背景と文字色がトークンから決まる
  ✓  30 [mobile] › tests/e2e/app.spec.js:399:1 › 再生中も手入力欄の入力は保持される
  ✓  32 [mobile] › tests/e2e/app.spec.js:409:1 › タブ切り替え（クリックと左右キー）と要確認への導線
  32 passed
exit: 0
```

## Artifact から読み戻した掲載 HTML（外枠込み）での E2E

掲載版（version 1791080239-e210）を Artifact の read で取得し、ローカルの artifact/meeting-compass.html と本文が一致することを確認したうえで、MC_ARTIFACT_SERVED に渡して実行。
```
  ✓  1 [desktop] › tests/e2e/artifact.spec.js:55:1 › Artifact版：初期表示・由来の明記・書き出し無効・無通信・無メディア
  ✓  2 [mobile] › tests/e2e/artifact.spec.js:55:1 › Artifact版：初期表示・由来の明記・書き出し無効・無通信・無メディア
  ✓  3 [desktop] › tests/e2e/artifact.spec.js:79:1 › Artifact版：デモ再生・一時停止・論点切替・訂正・撤回・手入力・修正・消去
  ✓  5 [desktop] › tests/e2e/artifact.spec.js:163:1 › Artifact版：ダークテーマ（OS設定・明示指定）でも背景と文字色がトークンから決まる
  ✓  4 [mobile] › tests/e2e/artifact.spec.js:79:1 › Artifact版：デモ再生・一時停止・論点切替・訂正・撤回・手入力・修正・消去
  ✓  6 [mobile] › tests/e2e/artifact.spec.js:163:1 › Artifact版：ダークテーマ（OS設定・明示指定）でも背景と文字色がトークンから決まる
  6 passed
exit: 0
```
