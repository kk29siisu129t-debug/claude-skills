// Claude Artifact 掲載用に、デモ画面（web/）を単一の HTML 断片へまとめる。
// - Artifact は <html>/<head>/<body> を自前で付けるため、title・style・本文・script だけを出力する
// - JS は esbuild で IIFE 1本にまとめてインライン化（外部 CDN は使わない）
// - サーバー・ライブ経路・秘密値は含めない（web/js/ui/app.js から辿れるものだけ）
// - 出力に送信・メディア取得・永続保存の API や外部 URL が含まれていたら失敗させる

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'artifact', 'meeting-compass.html');

const html = await readFile(join(root, 'web', 'index.html'), 'utf8');
const css = await readFile(join(root, 'web', 'styles.css'), 'utf8');

const result = await build({
  entryPoints: [join(root, 'web', 'js', 'ui', 'app.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: false,
  write: false,
  legalComments: 'none',
  charset: 'utf8',
  metafile: true,
  plugins: [{
    // ダウンロード処理は Artifact 版に含めない（ボタンも無効表示にする）
    name: 'artifact-stub-download',
    setup(b) {
      b.onResolve({ filter: /\/download\.js$/ }, (args) => (
        args.importer.endsWith('/web/js/ui/app.js') ? { path: join(root, 'scripts', 'artifact-stubs', 'download.js') } : undefined
      ));
    },
  }],
});
const js = result.outputFiles[0].text;
const inputs = Object.keys(result.metafile.inputs);

const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
if (!bodyMatch) throw new Error('web/index.html に <body> がありません');
const body = bodyMatch[1].trim();

const out = [
  '<title>Meeting Compass デモ</title>',
  `<style>\n${css.trim()}\n</style>`,
  '<div id="mc-build" data-build="artifact" hidden></div>',
  body,
  `<script>\n${js.replace(/<\/script/gi, '<\\/script')}</script>`,
  '',
].join('\n');

// ---- 検査 ----
const problems = [];
const forbiddenInputs = inputs.filter((p) => /(^|\/)server\/|\/live\/|server\.mjs|web\/js\/ui\/download\.js/.test(p));
if (forbiddenInputs.length) problems.push(`サーバー/ライブ経路のコードが含まれています: ${forbiddenInputs.join(', ')}`);
const forbidden = [
  /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bEventSource\b/, /\bsendBeacon\b/,
  /\.mediaDevices\b/, /\bget(?:User|Display)Media\s*\(/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/,
  /\bwindow\.open\s*\(/, /createObjectURL/, /\.download\s*=/, /\beval\s*\(/, /\bnew Function\s*\(/, /\.innerHTML\s*=/, /insertAdjacentHTML/,
];
for (const re of forbidden) if (re.test(js)) problems.push(`禁止 API を含みます: ${re}`);
const urls = out.match(/\bhttps?:\/\/[^\s"'<>)]+/g) || [];
if (urls.length) problems.push(`外部 URL を含みます: ${[...new Set(urls)].join(', ')}`);
if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(out)) problems.push('Artifact が付ける外枠タグ（doctype/html/head/body）を含みます');
if (!/AIによる理解・音声認識・話者識別は/.test(out)) problems.push('「AIによる理解・音声認識は行っていない」旨の表示がありません');
const bytes = Buffer.byteLength(out, 'utf8');
if (bytes > 16 * 1024 * 1024) problems.push(`サイズ超過: ${bytes} bytes`);
if (problems.length) {
  console.error(`bundle-artifact: 失敗\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, out, 'utf8');
console.log(`bundle-artifact ok: ${outFile.replace(root + '/', '')} (${bytes} bytes, ${inputs.length} modules)`);
console.log(inputs.map((p) => `  - ${p}`).join('\n'));
