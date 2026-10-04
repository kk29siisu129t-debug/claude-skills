// `node --import` で全ユニットテストの前に読み込む。テスト中の外部通信を遮断し、試みを記録する。
// - globalThis.fetch / WebSocket は記録して例外を投げるモックに置き換える
// - net/tls の接続はループバック（127.0.0.1 / ::1 / localhost）以外を拒否
// - DNS 解決は localhost 以外を拒否
// 各テストファイルは最後に attempts が 0 であることを確認する。

import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);
const attempts = [];

function record(kind, target) {
  attempts.push({ kind, target: String(target) });
  return new Error(`network blocked in tests: ${kind} ${String(target)}`);
}

globalThis.fetch = async (url) => { throw record('fetch', url); };
globalThis.WebSocket = class BlockedWebSocket {
  constructor(url) { throw record('websocket', url); }
};

function hostOf(args) {
  const a = args[0];
  if (Array.isArray(a)) return hostOf(a);
  if (a && typeof a === 'object') return a.host ?? a.hostname ?? (a.path ? 'unix-socket' : 'localhost');
  if (typeof a === 'number') return typeof args[1] === 'string' ? args[1] : 'localhost';
  if (typeof a === 'string') return 'unix-socket';
  return 'unknown';
}

const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function patchedConnect(...args) {
  const host = hostOf(args);
  if (!LOOPBACK.has(host) && host !== 'unix-socket') throw record('socket', host);
  return origConnect.apply(this, args);
};

const origTls = tls.connect;
tls.connect = function patchedTls(...args) {
  const host = hostOf(args);
  if (!LOOPBACK.has(host)) throw record('tls', host);
  return origTls.apply(this, args);
};

const origLookup = dns.lookup;
dns.lookup = function patchedLookup(hostname, ...rest) {
  if (!LOOPBACK.has(hostname)) throw record('dns', hostname);
  return origLookup.call(this, hostname, ...rest);
};
dns.promises.lookup = async (hostname) => { throw record('dns', hostname); };

globalThis.__mcNetGuard = Object.freeze({
  attempts: () => attempts.slice(),
  /** 自己診断用：記録を消す（guard の動作確認テストだけが使う） */
  clear: () => { attempts.length = 0; },
});
