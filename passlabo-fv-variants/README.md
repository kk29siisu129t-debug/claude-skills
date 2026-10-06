# PASSLABO 共通テスト数学 無料特別講義: SP ファーストビュー A/B（作業中）

**状態: 骨組み。納品物ではありません。** 講師写真・板書/教材見本と講義内容の文言は、現行ページ（https://utage-system.com/p/IyDWey4w9kRg）からの素材の到着待ちです。この環境からは現行ページへの接続がネットワーク方針で拒否されるため、素材は直接添付してもらう前提です。到着までは「差し替え待ち」の枠と【確認待ち】の文言を置いています。

- `src/content.json` … 文言と素材の出典（架空の実績・受講者数・点数保証・未検証の数値は入れない）
- `build.mjs` … `out/passlabo-fv-a.html`・`out/passlabo-fv-b.html` を作る（素材・書体を内包し、オフラインで表示できる）
- `shoot.mjs [参照SP画像]` … 400px（A/B 同じ高さ）・1280px の PNG、参照との比較画像、計測 `out/measure.json`
- `fonts/` … Noto Sans JP（SIL OFL 1.1、@fontsource/noto-sans-jp 5.3.0）のうち、使う文字を含む分割ファイルだけ
- CTA「LINEで無料講義を見る」は確認用の `<button type="button">` です。form・外部 URL・スクリプトを含みません（CSP で外部通信と送信を禁止）。LINE の実 URL は未確認です。

案A: 商品名（共通テスト数学・無料特別講義）→ 講師本人 → 教材の具体物 → 受講料0円 → CTA。
案B: 悩み（時間が足りない・点数が伸びない）→ 受講後の変化 → 板書と講師 → 商品名と無料 → CTA。
