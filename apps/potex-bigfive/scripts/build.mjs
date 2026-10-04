// 依存なしのビルド。src の CSS と JS をそのまま1つの HTML に埋め込む。
// - dist/index.html    : 単体で開ける完全な HTML（CSP 付き）
// - dist/artifact.html : Claude Artifact 用（ホスト側が <html><head><body> の骨組みを付けるため本文だけ）
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const src = (f) => path.join(appDir, 'src', f);

export const SCRIPT_ORDER = ['scoring.js', 'content.js', 'logic.js', 'app.js'];

const TITLE = 'POTEX 自己理解チェック';
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'none'",
  "connect-src 'none'",
  "font-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

async function main() {
  const css = await readFile(src('styles.css'), 'utf8');
  const scripts = await Promise.all(SCRIPT_ORDER.map((f) => readFile(src(f), 'utf8')));
  // </script> がソース内に現れると埋め込みが壊れるので確認する
  for (const [i, code] of scripts.entries()) {
    if (/<\/script/i.test(code)) throw new Error(`${SCRIPT_ORDER[i]} に </script が含まれています`);
  }
  const js = `'use strict';\n${scripts.join('\n')}`;
  const body = [
    `<title>${TITLE}</title>`,
    `<meta name="description" content="Mini-IPIPをもとにした独自日本語訳の20問で自分の傾向を振り返り、支援の使い方を自分で選ぶ公開デモ。回答は送信・保存しません。">`,
    `<meta name="referrer" content="no-referrer">`,
    `<style>\n${css}</style>`,
    `<div id="app" lang="ja"></div>`,
    `<noscript><p style="padding:16px">このツールの表示には JavaScript が必要です。</p></noscript>`,
    `<script>\n${js}</script>`,
  ].join('\n');

  const full = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
${body.replace(/<div id="app"[\s\S]*$/, '')}
</head>
<body>
<div id="app" lang="ja"></div>
<noscript><p style="padding:16px">このツールの表示には JavaScript が必要です。</p></noscript>
<script>
${js}</script>
</body>
</html>
`;

  await mkdir(path.join(appDir, 'dist'), { recursive: true });
  await writeFile(path.join(appDir, 'dist', 'index.html'), full);
  await writeFile(path.join(appDir, 'dist', 'artifact.html'), `${body}\n`);
  console.log('built dist/index.html, dist/artifact.html');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
