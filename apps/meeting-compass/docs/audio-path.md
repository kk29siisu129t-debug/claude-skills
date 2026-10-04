# 音声経路（将来案）— このプロトタイプでは未実装

現状、Meeting Compass は音声を一切取得しません。マイク・画面共有の許可も要求せず、
サーバー側の `Permissions-Policy: microphone=(), camera=(), display-capture=()` と
CSP `connect-src 'none'; media-src 'none'` で、ブラウザ上でも取得・送信できない状態にしています。

## 経路の優先順位

| 優先 | 経路 | 状態 | 備考 |
|---|---|---|---|
| 1 | デスクトップ Chrome で Meet タブの音声を `getDisplayMedia` で共有し、自分の声は別途 `getUserMedia` で取得 | 未接続 | Chrome 公式: https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture 。スマホ版 Meet の音声取得は約束しない |
| 2 | Google Meet Media API | 現時点で採用しない | 公式情報では Developer Preview の制約があり、新規サインアップ停止と記載: https://developers.google.com/workspace/meet/media-api/guides/overview |
| 3 | 対面会議の端末マイク | 未接続（任意） | |

## 実装前に必要な条件（未実装の要件）

1. **同意**：開始前に、参加者へ告知したことを確認する UI。同意がなければ開始できない。
2. **録音中表示**：取得中は常時、目立つ「録音中」表示。タブのタイトルにも出す。
3. **停止**：停止操作で `stream.getTracks().forEach(t => t.stop())` を全 track（タブ音声＋マイク）に行い、未送信バッファを破棄する。共有終了（Chrome 側の「共有を停止」）でも同じ処理。
4. **送信範囲の明示**：音声そのものを送るのか、文字起こし結果だけを送るのかを画面と設定に明記。
5. **secret 管理**：文字起こし・言語モデルの API キーは**サーバー側だけ**で保持する。ブラウザ・localStorage・Git には置かない。ブラウザはアプリ自身のサーバーへだけ送る。
6. **保持期間**：サーバー側でも音声は保存しない／保存する場合の期間と削除手段を明記。
7. **正直な表示**：モデルの出力は「自動抽出（要確認）」として表示し、合意判定は現行どおり明示的な根拠がある場合のみ。

## コード上の分離

- `web/js/providers/contract.js` — 全プロバイダ共通の契約。出力は `applyEvent` が受け付ける構造化イベントのみ。
- `web/js/providers/audio-provider.js` — 現在は `start()` が `AudioNotConfiguredError` を投げるだけ。`navigator.mediaDevices` には触れない（ユニットテストで確認）。
- 将来は `audio-provider.js` → 自前サーバー（文字起こし・構造化）→ 構造化イベント → `session.dispatch` の順に流す。UI・モデル層は変更不要にする。
