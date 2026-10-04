import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startServer, resolveRequestPath } from '../../server.mjs';

function get(port, path) {
  return new Promise((ok, ng) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', ng);
    req.end();
  });
}

test('静的サーバー：index とセキュリティヘッダ、ディレクトリ外は 404', async () => {
  const server = await startServer(0, '127.0.0.1');
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  try {
    const index = await get(port, '/');
    assert.equal(index.status, 200);
    assert.match(index.headers['content-security-policy'], /connect-src 'none'/);
    assert.match(index.headers['permissions-policy'], /microphone=\(\)/);
    assert.equal((await get(port, '/../package.json')).status, 404);
    assert.equal((await get(port, '/%2e%2e/server.mjs')).status, 404);
    assert.equal((await get(port, '/js/core/model.js')).status, 200);
  } finally {
    server.close();
  }
  assert.equal(resolveRequestPath('/%E0%A4%A'), null);
});
