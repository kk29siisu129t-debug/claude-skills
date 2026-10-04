// 将来のライブ用 HTTP エンドポイントで使う入口チェック（純粋関数）。
// まだどのエンドポイントにも配線していない（server.mjs は静的配信のみ）。
// - Host はループバックの許可リストのみ（DNS rebinding 対策）
// - 状態を変えるリクエストは Origin の一致と CSRF ヘッダ（定数時間比較）を必須
// - Sec-Fetch-Site があれば same-origin のみ
// - 本文サイズ上限、Content-Type の固定
// - トークンバケットによるレート制限

import { timingSafeEqual, randomBytes } from 'node:crypto';

export function createCsrfToken() {
  return randomBytes(24).toString('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * @param {{ method: string, headers: Record<string, string|undefined>, bodyLength: number }} req
 * @param {{ port: number, csrfToken: string, maxBodyBytes: number, contentType?: string }} opts
 * @returns {{ ok: true } | { ok: false, status: number, reason: string }}
 */
export function checkRequest(req, { port, csrfToken, maxBodyBytes, contentType = 'application/json' }) {
  const h = req.headers;
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  if (!allowedHosts.includes(String(h.host || ''))) return { ok: false, status: 421, reason: 'host' };
  if (req.method === 'GET' || req.method === 'HEAD') return { ok: true };
  if (req.method !== 'POST') return { ok: false, status: 405, reason: 'method' };
  const allowedOrigins = allowedHosts.map((x) => `http://${x}`);
  if (!allowedOrigins.includes(String(h.origin || ''))) return { ok: false, status: 403, reason: 'origin' };
  if (h['sec-fetch-site'] !== undefined && h['sec-fetch-site'] !== 'same-origin') return { ok: false, status: 403, reason: 'fetch-site' };
  if (!h['x-mc-csrf'] || !safeEqual(h['x-mc-csrf'], csrfToken)) return { ok: false, status: 403, reason: 'csrf' };
  if (!String(h['content-type'] || '').startsWith(contentType)) return { ok: false, status: 415, reason: 'content-type' };
  if (!Number.isInteger(req.bodyLength) || req.bodyLength < 0 || req.bodyLength > maxBodyBytes) return { ok: false, status: 413, reason: 'body-size' };
  return { ok: true };
}

/**
 * @param {{ capacity: number, refillPerSec: number, clock?: { now: () => number } }} opts
 */
export function createRateLimiter({ capacity, refillPerSec, clock = { now: () => Date.now() } }) {
  /** @type {Map<string, { tokens: number, at: number }>} */
  const buckets = new Map();
  return {
    take(key, cost = 1) {
      const now = clock.now();
      const b = buckets.get(key) || { tokens: capacity, at: now };
      b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSec);
      b.at = now;
      const ok = b.tokens >= cost;
      if (ok) b.tokens -= cost;
      buckets.set(key, b);
      return ok;
    },
  };
}
