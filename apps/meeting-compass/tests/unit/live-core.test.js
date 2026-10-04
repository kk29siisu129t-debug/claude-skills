import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLiveConfig, publicStatus, evaluateGate, CONSENT_VERSION } from '../../server/live/config.mjs';
import { PROVIDER_REGISTRY, disabledStructuringProvider, disabledTranscriptionProvider, ProviderNotConfiguredError } from '../../server/live/provider-contract.mjs';
import { createBudget, BudgetExceededError, estimateCostUsd, estimateTokens } from '../../server/live/budget.mjs';
import { createBatcher } from '../../server/live/batcher.mjs';
import { checkRequest, createRateLimiter, createCsrfToken } from '../../server/live/http-guard.mjs';
import { assertNoNetworkAfterAll, readyConfig, GOOD_CONSENT, TEST_REGISTRY, FAKE_CREDENTIAL_ENV, FAKE_CREDENTIAL_VALUE, fakeClock } from './live-helpers.mjs';

assertNoNetworkAfterAll();

test('no-network ガード自体が fetch / WebSocket / 外部ソケットを遮断する', async () => {
  const guard = globalThis.__mcNetGuard;
  assert.deepEqual(guard.attempts(), []);
  await assert.rejects(() => globalThis.fetch('https://example.invalid/'));
  assert.throws(() => new globalThis.WebSocket('wss://example.invalid/'));
  const net = await import('node:net');
  assert.throws(() => new net.Socket().connect(443, 'example.invalid'));
  assert.equal(guard.attempts().length, 3);
  guard.clear();
});

test('既定（環境変数なし）は厳密に無効で、登録済みプロバイダは0件', () => {
  assert.deepEqual(Object.keys(PROVIDER_REGISTRY), []);
  const c = loadLiveConfig({});
  assert.equal(c.enabled, false);
  assert.equal(c.providerConfigured, false);
  assert.equal(publicStatus(c).ready, false);
  const g = evaluateGate({ config: c, consent: GOOD_CONSENT, startRequested: true });
  assert.equal(g.allowed, false);
  assert.ok(g.reasons.some((r) => r.includes('MC_LIVE_ENABLED')));
});

test('有効化だけ・プロバイダ名だけでは開始できない（実プロバイダ未登録）', () => {
  const c = loadLiveConfig({ MC_LIVE_ENABLED: '1', MC_LIVE_PROVIDER: 'anything' });
  assert.equal(c.enabled, true);
  assert.equal(c.providerConfigured, false);
  assert.equal(evaluateGate({ config: c, consent: GOOD_CONSENT, startRequested: true }).allowed, false);
});

test('ゲート：有効化・資格情報の存在・同意・開始操作が全部揃ったときだけ許可', () => {
  const env = { MC_LIVE_ENABLED: '1', MC_LIVE_PROVIDER: 'mock', [FAKE_CREDENTIAL_ENV]: FAKE_CREDENTIAL_VALUE };
  const ok = loadLiveConfig(env, { registry: TEST_REGISTRY });
  assert.equal(evaluateGate({ config: ok, consent: GOOD_CONSENT, startRequested: true }).allowed, true);
  // 1つでも欠けたら不可
  assert.equal(evaluateGate({ config: ok, consent: GOOD_CONSENT, startRequested: false }).allowed, false);
  assert.equal(evaluateGate({ config: ok, consent: null, startRequested: true }).allowed, false);
  assert.equal(evaluateGate({ config: ok, consent: { ...GOOD_CONSENT, participantsNotified: false }, startRequested: true }).allowed, false);
  assert.equal(evaluateGate({ config: ok, consent: { ...GOOD_CONSENT, version: CONSENT_VERSION + 1 }, startRequested: true }).allowed, false);
  const noKey = loadLiveConfig({ ...env, [FAKE_CREDENTIAL_ENV]: '' }, { registry: TEST_REGISTRY });
  assert.equal(evaluateGate({ config: noKey, consent: GOOD_CONSENT, startRequested: true }).allowed, false);
  const notEnabled = loadLiveConfig({ ...env, MC_LIVE_ENABLED: 'true' }, { registry: TEST_REGISTRY });
  assert.equal(evaluateGate({ config: notEnabled, consent: GOOD_CONSENT, startRequested: true }).allowed, false);
  const publicHost = loadLiveConfig(env, { registry: TEST_REGISTRY, host: '0.0.0.0' });
  assert.equal(evaluateGate({ config: publicHost, consent: GOOD_CONSENT, startRequested: true }).allowed, false);
});

test('資格情報の値は設定オブジェクト・公開状態のどこにも含まれない', () => {
  const c = readyConfig();
  assert.ok(!JSON.stringify(c).includes(FAKE_CREDENTIAL_VALUE));
  assert.ok(!JSON.stringify(publicStatus(c)).includes(FAKE_CREDENTIAL_VALUE));
});

test('未設定プロバイダは何も送らずに失敗する', async () => {
  await assert.rejects(disabledTranscriptionProvider.open(), ProviderNotConfiguredError);
  await assert.rejects(disabledStructuringProvider.structure(), ProviderNotConfiguredError);
});

const LIMITS = {
  maxSessionMs: 60_000, maxAudioMs: 10_000, maxStructuringRequests: 2,
  maxInputTokensPerRequest: 1000, maxOutputTokensPerRequest: 100, maxTotalTokens: 2000,
};

test('budget：リクエスト数・1回の入力・合計トークン・時間・音声の上限を強制', () => {
  const clock = fakeClock();
  const b = createBudget(LIMITS, clock);
  assert.throws(() => b.reserve(1001), BudgetExceededError);
  const r1 = b.reserve(500);
  b.commit(r1, { inputTokens: 480, outputTokens: 90 });
  const r2 = b.reserve(500);
  b.commit(r2, null); // usage 不明 → 確保した最大値（500+100）で計上
  assert.equal(b.snapshot().inputTokens, 980);
  assert.equal(b.snapshot().outputTokens, 190);
  assert.throws(() => b.reserve(10), /構造化リクエスト回数/);
  assert.equal(b.snapshot().exhausted, '構造化リクエスト回数');

  const b2 = createBudget({ ...LIMITS, maxStructuringRequests: 99 }, clock);
  b2.commit(b2.reserve(900), { inputTokens: 900, outputTokens: 100 });
  assert.throws(() => b2.reserve(950), /合計トークン/); // 1000 + 950 + 100 > 2000

  b2.addAudioMs(9000);
  assert.throws(() => b2.addAudioMs(2000), /音声時間/);
  clock.advance(60_001);
  assert.throws(() => b2.checkTime(), /セッション時間/);
});

test('budget：確保中の分も合計に含め、release で戻せる', () => {
  const b = createBudget({ ...LIMITS, maxStructuringRequests: 9 }, fakeClock());
  const r = b.reserve(900); // 1000 確保
  assert.throws(() => b.reserve(950), /合計トークン/);
  b.release(r);
  assert.doesNotThrow(() => b.reserve(950));
});

test('README の1時間仮試算を概算関数で再現（約 $1.12、参考値）', () => {
  const usd = estimateCostUsd(
    { audioMinutes: 60, inputTokens: 120 * 4000, outputTokens: 120 * 800 },
    { audioPerMinute: 0.017, inputPer1M: 0.10, outputPer1M: 0.50 },
  );
  assert.ok(Math.abs(usd - 1.116) < 1e-9, String(usd));
  assert.ok(estimateTokens('あいう') >= 3);
});

test('batcher：final 区間だけを最大30秒でまとめ、重複・空は無視、全文は送らない', () => {
  const clock = fakeClock();
  const b = createBatcher({ maxMs: 30_000, maxChars: 1200, contextSegments: 2, contextChars: 400, clock });
  assert.equal(b.addFinal({ segmentId: 's1', text: '最初の発言' }), true);
  assert.equal(b.addFinal({ segmentId: 's1', text: '最初の発言' }), false);
  assert.equal(b.addFinal({ segmentId: 's2', text: '   ' }), false);
  clock.advance(29_999);
  assert.equal(b.shouldFlush(), false);
  clock.advance(1);
  assert.equal(b.shouldFlush(), true);
  const first = b.take();
  assert.deepEqual(first.segments.map((s) => s.text), ['最初の発言']);
  assert.deepEqual(first.recentContext, []);
  for (const [i, t] of ['二', '三', '四'].entries()) {
    b.addFinal({ segmentId: `n${i}`, text: `${t}番目` });
    clock.advance(30_000);
    b.take();
  }
  b.addFinal({ segmentId: 'last', text: '最後' });
  clock.advance(30_000);
  const last = b.take();
  assert.deepEqual(last.segments.map((s) => s.text), ['最後']);
  assert.deepEqual(last.recentContext, ['三番目', '四番目'], '直近2区間だけ（全文ではない）');
});

test('batcher：文字数上限で早めに送る・requeue・停止時に破棄', () => {
  const clock = fakeClock();
  const b = createBatcher({ maxMs: 30_000, maxChars: 10, clock });
  b.addFinal({ segmentId: 'a', text: '12345' });
  assert.equal(b.shouldFlush(), false);
  b.addFinal({ segmentId: 'b', text: '678901' });
  assert.equal(b.shouldFlush(), true);
  const batch = b.take();
  assert.deepEqual(batch.segments.map((s) => s.segmentId), ['a']);
  b.requeue(batch);
  assert.equal(b.pendingCount, 2);
  assert.equal(b.discard(), 2);
  assert.equal(b.take(), null);
});

test('http-guard：Host・Origin・CSRF・Sec-Fetch-Site・Content-Type・本文サイズ', () => {
  const token = createCsrfToken();
  const opts = { port: 5178, csrfToken: token, maxBodyBytes: 4096 };
  const good = {
    method: 'POST', bodyLength: 100,
    headers: { host: '127.0.0.1:5178', origin: 'http://127.0.0.1:5178', 'x-mc-csrf': token, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
  };
  assert.deepEqual(checkRequest(good, opts), { ok: true });
  const withH = (h) => ({ ...good, headers: { ...good.headers, ...h } });
  assert.equal(checkRequest(withH({ host: 'evil.example:5178' }), opts).reason, 'host');
  assert.equal(checkRequest(withH({ origin: 'http://evil.example' }), opts).reason, 'origin');
  assert.equal(checkRequest(withH({ origin: undefined }), opts).reason, 'origin');
  assert.equal(checkRequest(withH({ 'x-mc-csrf': 'wrong' }), opts).reason, 'csrf');
  assert.equal(checkRequest(withH({ 'sec-fetch-site': 'cross-site' }), opts).reason, 'fetch-site');
  assert.equal(checkRequest(withH({ 'content-type': 'text/plain' }), opts).reason, 'content-type');
  assert.equal(checkRequest({ ...good, bodyLength: 4097 }, opts).reason, 'body-size');
  assert.equal(checkRequest({ ...good, method: 'PUT' }, opts).reason, 'method');
  assert.deepEqual(checkRequest({ method: 'GET', headers: { host: 'localhost:5178' }, bodyLength: 0 }, opts), { ok: true });
});

test('レート制限：トークンバケット', () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ capacity: 2, refillPerSec: 1, clock });
  assert.equal(rl.take('a'), true);
  assert.equal(rl.take('a'), true);
  assert.equal(rl.take('a'), false);
  assert.equal(rl.take('b'), true);
  clock.advance(1000);
  assert.equal(rl.take('a'), true);
});
