#!/usr/bin/env node
// ローカル確認用の静的サーバー（依存なし・127.0.0.1 のみ）。公開・デプロイ用ではない。
//   node serve.mjs [--port 4173]  →  http://127.0.0.1:4173/
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 4173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };
const ALLOWED = ['/src/', '/seed/', '/docs/'];

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') { res.writeHead(302, { Location: '/src/app/index.html' }); return res.end(); }
    if (!ALLOWED.some((p) => path.startsWith(p))) { res.writeHead(404); return res.end('not found'); }
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    const st = await stat(file);
    if (!st.isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`LP Studio: http://127.0.0.1:${port}/`));
