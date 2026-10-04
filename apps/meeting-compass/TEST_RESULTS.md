# テスト結果（自動生成ログ）

実行日時: 2026-10-04T02:56:36Z / Node v22.22.0 / Playwright 1.56.1 (Chromium) / 対象: 会話から育つ階層アウトラインへの作り替え（desktop 1440x900・390x844・360x740 縦）。音声・AI・外部APIは未接続

ユニットテストは tests/unit/no-network.mjs（外部通信を遮断）下で実行。E2E は外部リクエスト・マイク/画面API呼び出し 0 件を検証。

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
ok 64 - 初期状態は空のアウトラインで、固定の見出しを持たない
ok 65 - イベントから任意の見出しと枝が生まれ、入れ子になる
ok 66 - 同じイベントID・同じノードID・同じ親の下の同じ文は重複しない
ok 67 - 話題へ戻る（node.focus）は新しく作らず、既存の枝への追記になる
ok 68 - 訂正は同じノードを直し、変更履歴を残す。並び順は変わらない
ok 69 - 不正な入力は拒否し、state を変えない
ok 70 - 階層の深さに上限がある
ok 71 - 危険な HTML・制御文字：HTMLは文字列のまま、制御文字は除去
ok 72 - 台本デモ：全イベント成功・ID安定・誕生/枝分かれ/脱線/戻り/訂正を含み、固定見出しは無い
ok 73 - player: 再生・一時停止・一歩進める・再開・リセット
ok 74 - 台本デモ：最後まで流してもエラー無し、リセット＋消去で空に戻り、同じIDで再生し直せる
ok 75 - session.clear は内容と ID カウンタを破棄する
ok 76 - 音声プロバイダは未接続：start は失敗し、mediaDevices に触れない
ok 77 - export: 入れ子の Markdown（HTML は無害化）と、由来の注意書き付き JSON
ok 78 - 静的サーバー：index とセキュリティヘッダ、ディレクトリ外は 404
# tests 78
# pass 78
# fail 0
exit: 0
```

## npm run build
```
build ok: 15 files -> dist/
exit: 0
```

## npm run bundle:artifact
```
bundle-artifact ok: artifact/meeting-compass.html (60421 bytes, 11 modules)
exit: 0
```

## npm run test:e2e（通常版＋Artifact版、desktop / mobile-390 / mobile-360）
```
  ✓   1 [desktop] › tests/e2e/app.spec.js:54:1 › 初期表示：空のアウトラインと再生案内、固定の見出し枠なし、由来の明記、無通信
  ✓   2 [desktop] › tests/e2e/artifact.spec.js:69:1 › Artifact版：空のアウトラインと再生案内・由来の明記・書き出し無効・無通信・無メディア
  ✓   3 [desktop] › tests/e2e/app.spec.js:77:1 › 台本デモ：話題の誕生・枝分かれ・脱線・戻り（重複なし）・訂正（同じノード）
  ✓   4 [desktop] › tests/e2e/artifact.spec.js:96:1 › Artifact版：再生で見出しと枝が育つ・一時停止・戻り・訂正・折り畳み・手で書く・消去
  ✓   6 [desktop] › tests/e2e/artifact.spec.js:169:1 › Artifact版：ダークテーマ（OS設定・明示指定）でも背景と文字色がトークンから決まる
  ✓   7 [mobile-390] › tests/e2e/app.spec.js:54:1 › 初期表示：空のアウトラインと再生案内、固定の見出し枠なし、由来の明記、無通信
  ✓   5 [desktop] › tests/e2e/app.spec.js:130:1 › 再生・一時停止・再開・リセット
  ✓   8 [mobile-390] › tests/e2e/app.spec.js:77:1 › 台本デモ：話題の誕生・枝分かれ・脱線・戻り（重複なし）・訂正（同じノード）
  ✓   9 [desktop] › tests/e2e/app.spec.js:154:1 › 折り畳み：畳んだ枝は勝手に開かず「新しい追記あり」を出し、「最新の更新へ」で開いて移動
  ✓  11 [desktop] › tests/e2e/app.spec.js:172:1 › 読んでいる間は勝手にスクロール・並べ替えしない（上で追記されても読んでいる位置を保つ）
  ✓  12 [desktop] › tests/e2e/app.spec.js:196:1 › 手で書く：新しい見出し・選んだ枝に追記・重複は作らず既存へ・編集で訂正履歴
  ✓  10 [mobile-390] › tests/e2e/app.spec.js:130:1 › 再生・一時停止・再開・リセット
  ✓  13 [desktop] › tests/e2e/app.spec.js:254:1 › 再生中に編集を開くと自動で一時停止し、入力は消えない
  ✓  14 [mobile-390] › tests/e2e/app.spec.js:154:1 › 折り畳み：畳んだ枝は勝手に開かず「新しい追記あり」を出し、「最新の更新へ」で開いて移動
  ✓  15 [desktop] › tests/e2e/app.spec.js:279:1 › 編集は Esc でキャンセルできる
  ✓  17 [desktop] › tests/e2e/app.spec.js:291:1 › 長文・危険な HTML は文字として表示され、横にはみ出さない
  ✓  18 [desktop] › tests/e2e/app.spec.js:311:1 › 縦1列：操作の帯 → アウトライン → 手で書く → 詳細、同じ左端・余白16px以上・横スクロールなし
  ✓  16 [mobile-390] › tests/e2e/app.spec.js:172:1 › 読んでいる間は勝手にスクロール・並べ替えしない（上で追記されても読んでいる位置を保つ）
  ✓  19 [desktop] › tests/e2e/app.spec.js:335:1 › 書き出しは明示操作でのみ行い、消去で全て破棄される
  ✓  20 [mobile-390] › tests/e2e/app.spec.js:196:1 › 手で書く：新しい見出し・選んだ枝に追記・重複は作らず既存へ・編集で訂正履歴
  ✓  21 [desktop] › tests/e2e/app.spec.js:358:1 › リロードすると内容は残らない（メモリのみ）
  ✓  23 [desktop] › tests/e2e/app.spec.js:366:1 › 詳細のタブ（クリックと左右キー）と音声未接続の表示
  ✓  24 [mobile-390] › tests/e2e/artifact.spec.js:69:1 › Artifact版：空のアウトラインと再生案内・由来の明記・書き出し無効・無通信・無メディア
  ✓  22 [mobile-390] › tests/e2e/app.spec.js:254:1 › 再生中に編集を開くと自動で一時停止し、入力は消えない
  ✓  26 [mobile-390] › tests/e2e/app.spec.js:279:1 › 編集は Esc でキャンセルできる
  ✓  27 [mobile-390] › tests/e2e/app.spec.js:291:1 › 長文・危険な HTML は文字として表示され、横にはみ出さない
  ✓  28 [mobile-390] › tests/e2e/app.spec.js:311:1 › 縦1列：操作の帯 → アウトライン → 手で書く → 詳細、同じ左端・余白16px以上・横スクロールなし
  ✓  25 [mobile-390] › tests/e2e/artifact.spec.js:96:1 › Artifact版：再生で見出しと枝が育つ・一時停止・戻り・訂正・折り畳み・手で書く・消去
  ✓  29 [mobile-390] › tests/e2e/app.spec.js:335:1 › 書き出しは明示操作でのみ行い、消去で全て破棄される
  ✓  30 [mobile-390] › tests/e2e/artifact.spec.js:169:1 › Artifact版：ダークテーマ（OS設定・明示指定）でも背景と文字色がトークンから決まる
  ✓  31 [mobile-390] › tests/e2e/app.spec.js:358:1 › リロードすると内容は残らない（メモリのみ）
  ✓  32 [mobile-390] › tests/e2e/app.spec.js:366:1 › 詳細のタブ（クリックと左右キー）と音声未接続の表示
  ✓  33 [mobile-360] › tests/e2e/app.spec.js:54:1 › 初期表示：空のアウトラインと再生案内、固定の見出し枠なし、由来の明記、無通信
  ✓  35 [mobile-360] › tests/e2e/artifact.spec.js:69:1 › Artifact版：空のアウトラインと再生案内・由来の明記・書き出し無効・無通信・無メディア
  ✓  34 [mobile-360] › tests/e2e/app.spec.js:77:1 › 台本デモ：話題の誕生・枝分かれ・脱線・戻り（重複なし）・訂正（同じノード）
  ✓  36 [mobile-360] › tests/e2e/artifact.spec.js:96:1 › Artifact版：再生で見出しと枝が育つ・一時停止・戻り・訂正・折り畳み・手で書く・消去
  ✓  38 [mobile-360] › tests/e2e/artifact.spec.js:169:1 › Artifact版：ダークテーマ（OS設定・明示指定）でも背景と文字色がトークンから決まる
  ✓  37 [mobile-360] › tests/e2e/app.spec.js:130:1 › 再生・一時停止・再開・リセット
  ✓  39 [mobile-360] › tests/e2e/app.spec.js:154:1 › 折り畳み：畳んだ枝は勝手に開かず「新しい追記あり」を出し、「最新の更新へ」で開いて移動
  ✓  40 [mobile-360] › tests/e2e/app.spec.js:172:1 › 読んでいる間は勝手にスクロール・並べ替えしない（上で追記されても読んでいる位置を保つ）
  ✓  41 [mobile-360] › tests/e2e/app.spec.js:196:1 › 手で書く：新しい見出し・選んだ枝に追記・重複は作らず既存へ・編集で訂正履歴
  ✓  42 [mobile-360] › tests/e2e/app.spec.js:254:1 › 再生中に編集を開くと自動で一時停止し、入力は消えない
  ✓  43 [mobile-360] › tests/e2e/app.spec.js:279:1 › 編集は Esc でキャンセルできる
  ✓  44 [mobile-360] › tests/e2e/app.spec.js:291:1 › 長文・危険な HTML は文字として表示され、横にはみ出さない
  ✓  45 [mobile-360] › tests/e2e/app.spec.js:311:1 › 縦1列：操作の帯 → アウトライン → 手で書く → 詳細、同じ左端・余白16px以上・横スクロールなし
  ✓  46 [mobile-360] › tests/e2e/app.spec.js:335:1 › 書き出しは明示操作でのみ行い、消去で全て破棄される
  ✓  47 [mobile-360] › tests/e2e/app.spec.js:358:1 › リロードすると内容は残らない（メモリのみ）
  ✓  48 [mobile-360] › tests/e2e/app.spec.js:366:1 › 詳細のタブ（クリックと左右キー）と音声未接続の表示
  48 passed
exit: 0
```

## Artifact から読み戻した掲載 HTML（Version 4, 1791082580-0773、外枠込み）での E2E

読み戻した本文がローカルの artifact/meeting-compass.html と一致することを確認したうえで MC_ARTIFACT_SERVED に渡して実行。
```
  ✓  2 [desktop] › tests/e2e/artifact.spec.js:69:1 › Artifact版：空のアウトラインと再生案内・由来の明記・書き出し無効・無通信・無メディア
  ✓  1 [mobile-390] › tests/e2e/artifact.spec.js:69:1 › Artifact版：空のアウトラインと再生案内・由来の明記・書き出し無効・無通信・無メディア
  ✓  3 [desktop] › tests/e2e/artifact.spec.js:96:1 › Artifact版：再生で見出しと枝が育つ・一時停止・戻り・訂正・折り畳み・手で書く・消去
  ✓  5 [desktop] › tests/e2e/artifact.spec.js:169:1 › Artifact版：ダークテーマ（OS設定・明示指定）でも背景と文字色がトークンから決まる
  ✓  4 [mobile-390] › tests/e2e/artifact.spec.js:96:1 › Artifact版：再生で見出しと枝が育つ・一時停止・戻り・訂正・折り畳み・手で書く・消去
  ✓  6 [mobile-390] › tests/e2e/artifact.spec.js:169:1 › Artifact版：ダークテーマ（OS設定・明示指定）でも背景と文字色がトークンから決まる
  ✓  7 [mobile-360] › tests/e2e/artifact.spec.js:69:1 › Artifact版：空のアウトラインと再生案内・由来の明記・書き出し無効・無通信・無メディア
  ✓  8 [mobile-360] › tests/e2e/artifact.spec.js:96:1 › Artifact版：再生で見出しと枝が育つ・一時停止・戻り・訂正・折り畳み・手で書く・消去
  ✓  9 [mobile-360] › tests/e2e/artifact.spec.js:169:1 › Artifact版：ダークテーマ（OS設定・明示指定）でも背景と文字色がトークンから決まる
  9 passed
exit: 0
```
