#!/usr/bin/env node
// ダブルクリックで開ける自己完結版（1ファイル）を作る: dist/lp-studio-standalone.html
// ES modules を依存順に IIFE へ包んで連結し、CSS・架空seed・架空LPOデータを埋め込む。外部通信なし。
//   node build-standalone.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RUNTIME_SCRIPT } from './src/core/render.js';

const root = new URL('.', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// 依存順（後ろのものは前のものだけを import する）
const MODULES = [
  ['util', 'src/core/util.js'],
  ['sections', 'src/core/sections.js'],
  ['schema', 'src/core/schema.js'],
  ['claims', 'src/core/claims.js'],
  ['generate', 'src/core/generate.js'],
  ['model', 'src/core/model.js'],
  ['render', 'src/core/render.js'],
  ['lpo', 'src/core/lpo.js'],
  ['app', 'src/app/app.js'],
];

function transform(name, src) {
  const exports = [];
  let out = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm, (_, names, from) => {
    const mod = from.split('/').pop().replace(/\.js$/, '');
    const binds = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '));
    return `const { ${binds.join(', ')} } = __mods.${mod};`;
  });
  out = out.replace(/^export\s+(async\s+)?function\s+(\w+)/gm, (_, a, n) => { exports.push(n); return `${a || ''}function ${n}`; });
  out = out.replace(/^export\s+(const|let)\s+(\w+)/gm, (_, k, n) => { exports.push(n); return `${k} ${n}`; });
  out = out.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_, names) => {
    for (const s of names.split(',').map((x) => x.trim()).filter(Boolean)) {
      const [a, b] = s.split(/\s+as\s+/);
      exports.push(b ? `${b}: ${a}` : a);
    }
    return '';
  });
  if (/^\s*(import|export)\s/m.test(out)) throw new Error(`${name}: 変換できない import/export が残っています`);
  return `__mods.${name} = (() => {\n${out}\nreturn { ${exports.join(', ')} };\n})();\n`;
}

const seed = read('seed/project.fictional.json');
const dataset = read('seed/lpo-dataset.fictional.json');
const js = [
  '(() => {',
  '"use strict";',
  'const __mods = {};',
  // seed を埋め込み（fetch の代わり）。JSON は script 内で </ を壊さないよう escape
  `window.__LP_STUDIO_EMBED__ = { seed: ${JSON.stringify(seed).replace(/</g, '\\u003c')}, dataset: ${JSON.stringify(dataset).replace(/</g, '\\u003c')} };`,
  ...MODULES.map(([n, p]) => transform(n, read(p))),
  '})();',
].join('\n').replace(/<\/(script|style)/gi, '<\\/$1'); // 埋め込み先の </script> で途切れないように（JS内では同じ意味）

const hash = (s) => createHash('sha256').update(s).digest('base64');
const css = read('src/app/styles.css');
let html = read('src/app/index.html');
const csp = `default-src 'none'; script-src 'sha256-${hash(js)}' 'sha256-${hash(RUNTIME_SCRIPT)}'; style-src 'unsafe-inline'; img-src data:; frame-src 'self' about:; child-src 'self' about: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta http-equiv="Content-Security-Policy" content="${csp}">`);
html = html.replace('<link rel="stylesheet" href="./styles.css">', () => `<style>${css}</style>`);
html = html.replace('<script type="module" src="./app.js"></script>', () => `<script>${js}</script>`);
html = html.replace('<title>LP Studio</title>', '<title>LP Studio（自己完結版）</title>');
mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/lp-studio-standalone.html', root), html);
console.log(`dist/lp-studio-standalone.html (${(html.length / 1024).toFixed(0)} KB)`);
