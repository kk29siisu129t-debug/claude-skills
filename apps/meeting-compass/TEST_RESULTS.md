# テスト結果（自動生成ログ）

実行日時: 2026-10-04T01:06:07Z / Node v22.22.0 / Playwright 1.56.1 (Chromium)

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
ok 1 - デモ全体が全イベント成功で適用でき、ID は台本どおりで安定している
ok 2 - applyEvent は元の state を変更しない（差分適用）
ok 3 - 同じイベントIDの再適用は重複として無視される
ok 4 - 既存の項目IDへの追加は別イベントIDでも拒否（重複項目を作らない）
ok 5 - 話題の切り替えと戻り：項目は元の論点に残り、戻り回数が記録される
ok 6 - 存在しない論点への切り替えは拒否
ok 7 - 決定の撤回・再検討は上書きせず履歴に残る
ok 8 - 訂正は元の文を履歴に保持する
ok 9 - 根拠のない確定（沈黙・反対なし）は拒否され、仮案のまま「合意未確認」になる
ok 10 - 明示的な合意根拠がある場合だけ確定になる
ok 11 - evidence 無しの確定、追加時の status:confirmed 指定も仮案になる
ok 12 - ユーザー操作による確定・仮案戻し・再検討・撤回
ok 13 - 手動修正：訂正・種類変更・担当/期限の更新（空欄は不明=null）
ok 14 - アクションの担当・期限は台本で明示されない限り不明(null)のまま
ok 15 - 空・空白のみ・長すぎる本文は拒否
ok 16 - 論点が無い状態での項目追加は拒否
ok 17 - 危険な HTML は文字列のまま保持される（実行・除去しない）
ok 18 - 制御文字は除去される
ok 19 - 未知のイベント種別・未知の種類は拒否
ok 20 - classify: キーワード規則による分類
ok 21 - classify: どの規則にも当てはまらなければ未分類
ok 22 - classify: 空入力・空白のみは失敗
ok 23 - classify: アクションの担当・期限は明記されたときだけ取り出す
ok 24 - 手入力：「決定しました」でも仮案。確定にはならない
ok 25 - 手入力：論点が無ければ「論点未設定」を自動で開き、ID は決定的
ok 26 - 手入力：空入力は拒否され、何も追加されない
ok 27 - 手入力：種類を指定するとユーザー入力として追加
ok 28 - player: 再生・一時停止・一歩進める・再開・リセット
ok 29 - デモプロバイダ：最後まで再生してもエラー無し、リセット＋消去で空に戻り再生し直せる
ok 30 - session.clear は内容と ID カウンタを破棄する
ok 31 - 音声プロバイダは未接続：start は失敗し、mediaDevices に触れない
ok 32 - どのプロバイダも外部送信しない宣言
ok 33 - export: Markdown は HTML を無害化し、JSON は由来の注意書きを含む
ok 34 - 静的サーバー：index とセキュリティヘッダ、ディレクトリ外は 404
# tests 34
# pass 34
# fail 0
exit: 0
```

## npm run build
```
build ok: 14 files -> dist/
exit: 0
```

## npm run test:e2e
```
  ✓   1 [desktop] › tests/e2e/app.spec.js:38:1 › 初期表示：由来の明記・停止状態・外部送信なし (488ms)
  ✓   2 [mobile] › tests/e2e/app.spec.js:38:1 › 初期表示：由来の明記・停止状態・外部送信なし (933ms)
  ✓   3 [desktop] › tests/e2e/app.spec.js:53:1 › デモ：話題切替・脱線・戻り・撤回・訂正・合意未確認を一歩ずつ確認 (2.5s)
  ✓   4 [mobile] › tests/e2e/app.spec.js:53:1 › デモ：話題切替・脱線・戻り・撤回・訂正・合意未確認を一歩ずつ確認 (4.9s)
  ✓   5 [desktop] › tests/e2e/app.spec.js:113:1 › 再生・一時停止・再開・リセット (5.0s)
  ✓   7 [desktop] › tests/e2e/app.spec.js:136:1 › 手入力：空入力の拒否・規則分類・未分類・手動確定と修正 (1.4s)
  ✓   8 [desktop] › tests/e2e/app.spec.js:204:1 › 危険な HTML 入力は文字として表示され、実行されない (424ms)
  ✓   9 [desktop] › tests/e2e/app.spec.js:224:1 › 過去の論点の参照と「現在の論点にする」 (695ms)
  ✓   6 [mobile] › tests/e2e/app.spec.js:113:1 › 再生・一時停止・再開・リセット (5.0s)
  ✓  10 [desktop] › tests/e2e/app.spec.js:239:1 › 書き出しは明示操作でのみ行い、消去で全て破棄される (715ms)
  ✓  12 [desktop] › tests/e2e/app.spec.js:271:1 › リロードすると内容は残らない（メモリのみ） (507ms)
  ✓  11 [mobile] › tests/e2e/app.spec.js:136:1 › 手入力：空入力の拒否・規則分類・未分類・手動確定と修正 (2.4s)
  ✓  13 [mobile] › tests/e2e/app.spec.js:204:1 › 危険な HTML 入力は文字として表示され、実行されない (549ms)
  ✓  14 [mobile] › tests/e2e/app.spec.js:224:1 › 過去の論点の参照と「現在の論点にする」 (729ms)
  ✓  15 [mobile] › tests/e2e/app.spec.js:239:1 › 書き出しは明示操作でのみ行い、消去で全て破棄される (870ms)
  ✓  16 [mobile] › tests/e2e/app.spec.js:271:1 › リロードすると内容は残らない（メモリのみ） (371ms)
  16 passed (17.0s)
```
