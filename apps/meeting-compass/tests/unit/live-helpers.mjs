// ライブ基盤テスト用のモック群。実ネットワーク・実メディアは一切使わない。

import assert from 'node:assert/strict';
import { after } from 'node:test';
import { loadLiveConfig, CONSENT_VERSION, DEFAULT_LIMITS } from '../../server/live/config.mjs';

/** 各テストファイルの最後に、外部通信の試みが 0 件であることを確認する。 */
export function assertNoNetworkAfterAll() {
  after(() => {
    const guard = globalThis.__mcNetGuard;
    assert.ok(guard, 'no-network ガードが読み込まれていません（--import tests/unit/no-network.mjs）');
    assert.deepEqual(guard.attempts(), [], '外部通信が試みられました');
  });
}

export const FAKE_CREDENTIAL_ENV = 'MC_TEST_FAKE_CREDENTIAL';
/** 秘密値ではない、テスト専用のダミー文字列（実在のキー形式ではない） */
export const FAKE_CREDENTIAL_VALUE = 'dummy-not-a-real-credential-0123456789abcdef';
export const TEST_REGISTRY = Object.freeze({ mock: { credentialEnv: FAKE_CREDENTIAL_ENV, create: () => null } });

export function readyConfig(limitOverrides = {}) {
  const base = loadLiveConfig(
    { MC_LIVE_ENABLED: '1', MC_LIVE_PROVIDER: 'mock', [FAKE_CREDENTIAL_ENV]: FAKE_CREDENTIAL_VALUE },
    { registry: TEST_REGISTRY },
  );
  return { ...base, limits: { ...DEFAULT_LIMITS, ...limitOverrides } };
}

export const GOOD_CONSENT = Object.freeze({ version: CONSENT_VERSION, participantsNotified: true, externalProcessingAccepted: true });

export function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

export function fakeScheduler() {
  let id = 0;
  const timeouts = new Map();
  const intervals = new Map();
  return {
    setTimeout(fn, ms) { timeouts.set(++id, { fn, ms }); return id; },
    clearTimeout(h) { timeouts.delete(h); },
    setInterval(fn, ms) { intervals.set(++id, { fn, ms }); return id; },
    clearInterval(h) { intervals.delete(h); },
    fireTimeouts() { for (const [k, v] of [...timeouts]) { timeouts.delete(k); v.fn(); } },
    get pendingTimeouts() { return timeouts.size; },
    get activeIntervals() { return intervals.size; },
  };
}

export const flush = () => new Promise((r) => setImmediate(r));

export function mockTranscription() {
  const calls = { open: 0, append: [], close: 0 };
  let handlers = null;
  let signal = null;
  return {
    calls,
    provider: {
      id: 'mock-transcription',
      async open(h) {
        calls.open += 1;
        handlers = h;
        signal = h.signal;
        return {
          appendAudio: (b) => calls.append.push(b.byteLength),
          close: async () => { calls.close += 1; },
        };
      },
    },
    emitFinal: (segmentId, text) => handlers.onFinal({ segmentId, text }),
    emitError: (err) => handlers.onError(err),
    get signal() { return signal; },
  };
}

/** structure() の呼び出しごとに、テストが応答を決められるモック。 */
export function mockStructuring() {
  const requests = [];
  return {
    requests,
    provider: {
      id: 'mock-structuring',
      structure(req) {
        return new Promise((resolve, reject) => {
          const entry = { req, resolve, reject };
          req.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          requests.push(entry);
        });
      },
    },
    last: () => requests[requests.length - 1],
  };
}

export function op(fields) {
  return { op: null, topic_id: null, title: null, kind: null, text: null, item_id: null, parent_id: null, status: null, evidence_quote: null, reason: null, ...fields };
}

/** mediaDevices のモック（呼び出し回数を記録）。 */
export function mockMediaDevices({ tabAudio = true, micFails = false } = {}) {
  const calls = { getDisplayMedia: 0, getUserMedia: 0 };
  const tracks = [];
  const makeTrack = (kind, label) => {
    const listeners = new Set();
    const t = {
      kind, label, readyState: 'live', stopCalls: 0,
      stop() { t.stopCalls += 1; t.readyState = 'ended'; },
      addEventListener(type, fn) { if (type === 'ended') listeners.add(fn); },
      removeEventListener(type, fn) { listeners.delete(fn); },
      get listenerCount() { return listeners.size; },
      endExternally() { t.readyState = 'ended'; for (const fn of [...listeners]) fn(); },
    };
    tracks.push(t);
    return t;
  };
  const makeStream = (list) => ({
    getTracks: () => list.slice(),
    getAudioTracks: () => list.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => list.filter((t) => t.kind === 'video'),
  });
  const mediaDevices = {
    async getDisplayMedia() {
      calls.getDisplayMedia += 1;
      const list = [makeTrack('video', 'tab-video')];
      if (tabAudio) list.push(makeTrack('audio', 'tab-audio'));
      return makeStream(list);
    },
    async getUserMedia() {
      calls.getUserMedia += 1;
      if (micFails) throw new Error('NotAllowedError (mock)');
      return makeStream([makeTrack('audio', 'mic')]);
    },
  };
  return {
    calls,
    tracks,
    mediaDevices,
    acquire: {
      display: () => mediaDevices.getDisplayMedia({ video: true, audio: true }),
      microphone: () => mediaDevices.getUserMedia({ audio: true }),
    },
  };
}
