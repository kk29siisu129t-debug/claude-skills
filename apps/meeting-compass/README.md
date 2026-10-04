# Meeting Compass（プロトタイプ）

会議の横に置いて、**「いま何の論点か」「提案・理由・懸念・トレードオフ」「確定した決定と仮案」「未解決」「次に決めること」「アクション」**を構造で見るための画面です。逐語録・話者識別は目的にしていません。

> **正直な前提**：この段階は、架空会議の**台本（fixture）**を順に流すデモと、**キーワード規則**による手入力の簡易分類だけです。AI による理解・音声認識は行っておらず、画面上部に常時そう表示しています。

## 起動

Node.js 20 以上。実行時の依存はありません。

```bash
cd apps/meeting-compass
node server.mjs          # または npm start
# → http://127.0.0.1:5178/ を開く（127.0.0.1 のみで待ち受け）
```

`PORT=xxxx node server.mjs` でポートを変えられます。`file://` で直接開くと ES Modules が読み込めないため、上のサーバーを使ってください。

## 使い方

- **デモ再生**：再生／一時停止（再開）／一歩進める／リセット、速さの切り替え。架空会議は「週次定例の開催形式」→「共有ドライブ整理」→ 脱線（コーヒー）→ 定例に戻る → 仮案の再検討・数字の訂正・撤回 → 明示的合意で確定 → 沈黙だけの「確定」は見送り、という流れです。
- **手入力**：`議題: ○○` で新しい論点。それ以外はキーワード規則で仮分類し、当てはまらなければ「未分類（要確認）」に入ります。種類を自分で選ぶこともできます。
- **修正と確定**：各項目の「修正」で本文・種類・（アクションは）担当／期限を直せます。決定は「確定にする／仮案に戻す／再検討／撤回」。すべて履歴に残ります。
- **論点の履歴**：過去の論点を「表示」で参照（現在の論点とは区別して表示）、「現在の論点にする」で会議の論点を戻せます。
- **データ**：内容はタブのメモリ上だけ。再読み込み・「すべて消去」で破棄。JSON / Markdown の書き出しはボタンを押したときだけ。

## 設計上の約束

| 要件 | 実装 |
|---|---|
| 安定した ID・差分更新 | 全変更はイベント（`web/js/core/model.js` の `applyEvent`）で適用。ID は台本／手入力側が付与し振り直さない。画面はキー付き差分更新（`web/js/ui/dom.js`）で既存ノードを再利用 |
| 重複防止 | 同じイベントID、既存の項目IDへの追加は無視 |
| 訂正・撤回・再検討の保持 | 上書きせず `item.history` と変更履歴に残す。撤回は「撤回済み」として残る |
| 根拠なき合意の禁止 | 確定は `explicit_agreement`（台本で明示）か `user`（画面操作）だけ。沈黙・反対なしは拒否し「合意未確認」と表示。手入力の「決定しました」も仮案 |
| 担当・期限 | 明記されたときだけ設定。それ以外は「不明」 |
| 外部送信なし | CSP `connect-src 'none'`、外部フォント等なし。ESLint で `fetch`/`WebSocket`/`localStorage` 等を禁止 |
| XSS | データは `textContent` のみで描画、`innerHTML` 等は ESLint で禁止、CSP で inline script 不可。Markdown 書き出しは `<` `>` を実体参照化 |
| 音声 | 未接続。マイク・画面許可は要求しない（`Permissions-Policy` でも禁止）。将来案は [docs/audio-path.md](docs/audio-path.md) |

## 構成

```
server.mjs                    依存ゼロの静的サーバー（web/ のみ配信、セキュリティヘッダ付与）
web/index.html, styles.css    画面（日本語、デスクトップ中心・スマホ対応、ダークモード対応）
web/js/core/model.js          状態とイベント適用（純粋関数）
web/js/core/rules.js          手入力のキーワード規則
web/js/core/demo-script.js    架空会議の台本
web/js/core/player.js         再生器（タイマー注入可能）
web/js/core/session.js        メモリ内セッション
web/js/core/export.js         明示操作時の書き出し
web/js/providers/             入力プロバイダ（contract / demo / manual / audio[未接続]）
web/js/ui/                    差分描画と操作
tests/unit/                   node:test（34件）
tests/e2e/                    Playwright（desktop 1440x900 / mobile Pixel 7、各8件）
screenshots/                  E2E が保存したスクリーンショット
```

## テスト・検査

```bash
npm install          # 開発用依存（eslint, typescript, @playwright/test）のみ
npm run lint         # ESLint（危険API禁止ルール込み）
npm run typecheck    # tsc --checkJs
npm run test:unit    # node:test
npm run build        # web/ を dist/ に複製し参照切れを検査（バンドル不要）
npm run test:e2e     # Playwright。ブラウザを別途入れる場合は `npx playwright install chromium`
```

Playwright は 1.56.1 に固定。手元の Chromium を使う場合は `PW_CHROMIUM_PATH=/path/to/chromium npm run test:e2e`。
E2E を実行すると `screenshots/` が上書きされます。

## 制限（まだできないこと）

- 実会議への参加、音声取得、文字起こし、AI による構造化は**できません**（デモ台本とキーワード規則のみ）。
- キーワード規則は語の有無だけを見ます。否定文・皮肉・文脈は理解しません（例：「心配はない」も懸念に入る）。必ず人が確認・修正する前提です。
- 保存はメモリのみで、複数人での共有・同期はありません。
- 元に戻す（undo）はありません。訂正・撤回は履歴に残ります。
- 再生中に編集中の項目が台本で更新されると、編集フォームは更新後の内容で開き直されます（一時停止してから編集するのが確実）。

## 次の段階（案）

1. 自前サーバー（API キーはサーバー側のみ）を用意し、文字起こし結果 → 構造化イベントに変換する provider を追加。出力は「自動抽出（要確認）」として表示。
2. デスクトップ Chrome の Meet タブ音声＋マイク取得（同意・録音中表示・全 track 停止と破棄・送信範囲・保持期間の明示を先に実装）。
3. 共有・同期（閲覧専用リンク等）と、会議後のレビュー画面。
