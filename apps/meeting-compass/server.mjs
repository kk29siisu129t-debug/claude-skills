// 依存ゼロの静的ファイルサーバー。127.0.0.1 のみで待ち受け、web/ 配下だけを配信する。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('./web/', import.meta.url)));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 5178);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(), camera=(), display-capture=(), geolocation=()',
  'Cache-Control': 'no-store',
};

export function resolveRequestPath(urlPath) {
  let p;
  try {
    p = decodeURIComponent(new URL(urlPath, 'http://x').pathname);
  } catch {
    return null;
  }
  if (p.endsWith('/')) p += 'index.html';
  const full = normalize(join(ROOT, p));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

export function startServer(port = PORT, host = HOST) {
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, SECURITY_HEADERS).end();
      return;
    }
    const file = resolveRequestPath(req.url || '/');
    try {
      if (!file || !(await stat(file)).isFile()) throw new Error('not found');
      const body = await readFile(file);
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  return new Promise((ok) => server.listen(port, host, () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(() => {
    console.log(`Meeting Compass: http://${HOST}:${PORT}/  （Ctrl+C で停止）`);
  });
}
