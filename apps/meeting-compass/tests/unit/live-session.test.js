import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveSession, GateError, sanitizeError } from '../../server/live/live-session.mjs';
import { loadLiveConfig } from '../../server/live/config.mjs';
import {
  assertNoNetworkAfterAll, readyConfig, GOOD_CONSENT, FAKE_CREDENTIAL_VALUE,
  fakeClock, fakeScheduler, flush, mockTranscription, mockStructuring, op,
} from './live-helpers.mjs';

assertNoNetworkAfterAll();

function setup(limitOverrides = {}) {
  const clock = fakeClock();
  const scheduler = fakeScheduler();
  const tr = mockTranscription();
  const st = mockStructuring();
  const logs = [];
  const session = createLiveSession({
    config: readyConfig(limitOverrides), transcription: tr.provider, structuring: st.provider,
    clock, scheduler, log: (m) => logs.push(m),
  });
  return { clock, scheduler, tr, st, session, logs };
}

async function startAndBatch(ctx, segs = [['s1', 'オンライン化を提案します']]) {
  await ctx.session.start({ consent: GOOD_CONSENT, startRequested: true });
  for (const [id, text] of segs) ctx.tr.emitFinal(id, text);
  ctx.clock.advance(30_000);
  await ctx.session.tick();
  await flush();
  await flush();
}

test('無許可・未設定ではプロバイダを一切呼ばない', async () => {
  for (const [config, consent, startRequested] of [
    [loadLiveConfig({}), GOOD_CONSENT, true],
    [readyConfig(), null, true],
    [readyConfig(), GOOD_CONSENT, false],
  ]) {
    const tr = mockTranscription();
    const st = mockStructuring();
    const s = createLiveSession({ config, transcription: tr.provider, structuring: st.provider, scheduler: fakeScheduler() });
    await assert.rejects(s.start({ consent, startRequested }), GateError);
    assert.equal(tr.calls.open, 0);
    assert.equal(st.requests.length, 0);
    assert.throws(() => s.appendAudio(new Uint8Array(2)), /実行中ではありません/);
  }
});

test('二重開始は拒否', async () => {
  const ctx = setup();
  await ctx.session.start({ consent: GOOD_CONSENT, startRequested: true });
  await assert.rejects(ctx.session.start({ consent: GOOD_CONSENT, startRequested: true }), /既に開始/);
  assert.equal(ctx.tr.calls.open, 1);
  await ctx.session.stop();
  await assert.rejects(ctx.session.start({ consent: GOOD_CONSENT, startRequested: true }), /終了しています/);
});

test('final だけを30秒でまとめて1回だけ構造化し、差分を適用する', async () => {
  const ctx = setup();
  await ctx.session.start({ consent: GOOD_CONSENT, startRequested: true });
  ctx.tr.emitFinal('s1', '議題は定例の形式です');
  ctx.tr.emitFinal('s2', '全面オンラインを提案します');
  await ctx.session.tick();
  await flush();
  assert.equal(ctx.st.requests.length, 0, '30秒未満では送らない');
  ctx.clock.advance(30_000);
  await ctx.session.tick();
  await flush();
  assert.equal(ctx.st.requests.length, 1);
  const req = ctx.st.last().req;
  assert.deepEqual(req.input.new_utterances, ['議題は定例の形式です', '全面オンラインを提案します']);
  assert.equal(req.maxOutputTokens, 800);
  assert.equal(req.schema.additionalProperties, false);
  ctx.st.last().resolve({
    json: { base_revision: 0, operations: [op({ op: 'open_topic', title: '定例の形式' }), op({ op: 'add_item', kind: 'proposal', text: '全面オンライン' })] },
    usage: { inputTokens: 300, outputTokens: 60 },
  });
  await flush();
  const events = ctx.session.eventsAfter(0);
  assert.deepEqual(events.map((e) => e.event.type), ['topic.open', 'item.add']);
  assert.ok(events.every((e) => e.event.id.startsWith('lv-')));
  assert.equal(ctx.session.status().budget.requests, 1);
  assert.equal(ctx.session.status().budget.inputTokens, 300);
  // 次のまとめは前回分を new_utterances に含めない（全文を毎回送らない）
  ctx.tr.emitFinal('s3', '費用が心配です');
  ctx.clock.advance(30_000);
  await ctx.session.tick();
  await flush();
  assert.deepEqual(ctx.st.last().req.input.new_utterances, ['費用が心配です']);
  assert.ok(ctx.st.last().req.input.recent_context.length <= 3);
  await ctx.session.stop();
});

test('プロバイダ失敗：記録してセッションは継続、予算は確保分で計上', async () => {
  const ctx = setup();
  await startAndBatch(ctx);
  ctx.st.last().reject(new Error(`upstream 500 with key ${FAKE_CREDENTIAL_VALUE}`));
  await flush();
  const st = ctx.session.status();
  assert.equal(st.status, 'running');
  assert.equal(st.rejections, 1);
  assert.equal(st.budget.requests, 1);
  assert.equal(st.budget.outputTokens, 800, 'usage 不明なので出力上限で計上');
  assert.ok(!JSON.stringify(st).includes(FAKE_CREDENTIAL_VALUE), '秘密値らしき文字列は伏せる');
  assert.ok(!ctx.logs.join('\n').includes(FAKE_CREDENTIAL_VALUE));
  await ctx.session.stop();
});

test('不正な JSON・schema 違反の応答は適用しない', async () => {
  for (const json of ['{not json', { base_revision: 0, operations: [{ op: 'add_item' }] }, { base_revision: 0, operations: [op({ op: 'correct_item', item_id: 'ghost', text: 'x' })] }]) {
    const ctx = setup();
    await startAndBatch(ctx);
    ctx.st.last().resolve({ json, usage: { inputTokens: 10, outputTokens: 10 } });
    await flush();
    assert.equal(ctx.session.eventsAfter(0).length, 0);
    assert.equal(ctx.session.rejections()[0].kind, 'invalid');
    await ctx.session.stop();
  }
});

test('古い応答（送信中にユーザー操作で revision が進んだ）は破棄し、1回だけ再投入', async () => {
  const ctx = setup();
  await startAndBatch(ctx);
  // 先に1件適用しておく
  ctx.st.last().resolve({ json: { base_revision: 0, operations: [op({ op: 'open_topic', title: 'A' }), op({ op: 'add_item', kind: 'decision', text: '試行する' })] }, usage: null });
  await flush();
  const decisionId = ctx.session.eventsAfter(0)[1].event.item.id;
  ctx.tr.emitFinal('s2', '次の発言');
  ctx.clock.advance(30_000);
  await ctx.session.tick();
  await flush();
  const revAtSend = ctx.st.last().req.input.current_state.revision;
  // 応答待ちの間にユーザーが撤回
  assert.equal(ctx.session.applyUserEvent({ id: 'u-1', type: 'decision.withdraw', itemId: decisionId, reason: 'ユーザー操作' }).ok, true);
  ctx.st.last().resolve({ json: { base_revision: revAtSend, operations: [op({ op: 'add_item', kind: 'concern', text: '心配' })] }, usage: null });
  await flush();
  const rej = ctx.session.rejections().at(-1);
  assert.equal(rej.kind, 'obsolete');
  assert.equal(rej.requeued, true);
  ctx.clock.advance(30_000);
  await ctx.session.tick();
  await flush();
  assert.equal(ctx.st.requests.length, 3, '再投入して再送');
  assert.equal(ctx.st.last().req.input.current_state.revision, revAtSend + 1);
  assert.deepEqual(ctx.st.last().req.input.new_utterances, ['次の発言']);
  // 許可していないユーザー操作は拒否
  assert.equal(ctx.session.applyUserEvent({ id: 'u-2', type: 'item.add', item: {} }).ok, false);
  await ctx.session.stop();
});

test('予算上限：構造化リクエスト回数に達したら停止', async () => {
  const ctx = setup({ maxStructuringRequests: 1 });
  await startAndBatch(ctx);
  ctx.st.last().resolve({ json: { base_revision: 0, operations: [] }, usage: { inputTokens: 1, outputTokens: 1 } });
  await flush();
  ctx.tr.emitFinal('s2', 'もう一つ');
  ctx.clock.advance(30_000);
  await ctx.session.tick();
  await flush();
  await flush();
  assert.equal(ctx.st.requests.length, 1, '上限を超えて送らない');
  assert.equal(ctx.session.status().status, 'stopped');
  assert.equal(ctx.session.status().stopReason, 'budget:構造化リクエスト回数');
  assert.equal(ctx.tr.calls.close, 1);
});

test('予算上限：音声時間・セッション時間で停止', async () => {
  const ctx = setup({ maxAudioMs: 1000 });
  await ctx.session.start({ consent: GOOD_CONSENT, startRequested: true });
  assert.equal(ctx.session.appendAudio(new Uint8Array(24000 * 2 * 0.5)), true); // 0.5秒
  assert.equal(ctx.session.appendAudio(new Uint8Array(24000 * 2 * 0.6)), false); // 合計1.1秒 > 1秒
  await flush();
  assert.equal(ctx.session.status().stopReason, 'budget:音声時間');
  assert.equal(ctx.tr.calls.append.length, 1);

  const ctx2 = setup({ maxSessionMs: 5000 });
  await ctx2.session.start({ consent: GOOD_CONSENT, startRequested: true });
  ctx2.clock.advance(5001);
  await ctx2.session.tick();
  await flush();
  assert.equal(ctx2.session.status().stopReason, 'budget:セッション時間');
});

test('音声片の検証：空・奇数バイト・大きすぎる片を拒否', async () => {
  const ctx = setup();
  await ctx.session.start({ consent: GOOD_CONSENT, startRequested: true });
  assert.throws(() => ctx.session.appendAudio(new Uint8Array(0)), TypeError);
  assert.throws(() => ctx.session.appendAudio(new Uint8Array(3)), TypeError);
  assert.throws(() => ctx.session.appendAudio(new Uint8Array(64 * 1024 + 2)), RangeError);
  assert.throws(() => ctx.session.appendAudio('音声'), TypeError);
  await ctx.session.stop();
});

test('タイムアウト：応答が返らなければ abort し、記録して継続', async () => {
  const ctx = setup();
  await startAndBatch(ctx);
  const { req } = ctx.st.last();
  assert.equal(ctx.scheduler.pendingTimeouts, 1);
  ctx.scheduler.fireTimeouts();
  await flush();
  assert.equal(req.signal.aborted, true);
  assert.equal(ctx.session.rejections()[0].kind, 'timeout');
  assert.equal(ctx.session.status().inFlight, false);
  await ctx.session.stop();
});

test('停止：進行中リクエストの中止・文字起こしの close・未送信の破棄・遅れた応答の無視', async () => {
  const ctx = setup();
  await startAndBatch(ctx);
  const pending = ctx.st.last();
  ctx.tr.emitFinal('s9', '未送信の発言');
  const res = await ctx.session.stop();
  assert.deepEqual(res, { stopped: true, discardedSegments: 1 });
  assert.equal(pending.req.signal.aborted, true);
  assert.equal(ctx.tr.signal.aborted, true);
  assert.equal(ctx.tr.calls.close, 1);
  assert.equal(ctx.scheduler.activeIntervals, 0);
  pending.resolve({ json: { base_revision: 0, operations: [op({ op: 'open_topic', title: '遅れた応答' })] }, usage: null });
  await flush();
  assert.equal(ctx.session.eventsAfter(0).length, 0, '停止後の応答は適用しない');
  assert.deepEqual(await ctx.session.stop(), { stopped: false }, '停止は冪等');
  assert.throws(() => ctx.session.appendAudio(new Uint8Array(2)));
});

test('プロバイダの onError で停止する', async () => {
  const ctx = setup();
  await ctx.session.start({ consent: GOOD_CONSENT, startRequested: true });
  ctx.tr.emitError(new Error('connection lost'));
  await flush();
  assert.equal(ctx.session.status().status, 'stopped');
  assert.equal(ctx.session.status().stopReason, 'provider-error');
});

test('開始中（open 待ち）に停止されたら、開いた接続も閉じる', async () => {
  let release;
  let closed = 0;
  const tr = { id: 't', open: () => new Promise((r) => { release = r; }) };
  const s = createLiveSession({ config: readyConfig(), transcription: tr, structuring: mockStructuring().provider, scheduler: fakeScheduler() });
  const p = s.start({ consent: GOOD_CONSENT, startRequested: true });
  await flush();
  await s.stop();
  release({ appendAudio() {}, close: async () => { closed += 1; } });
  await assert.rejects(p, /開始中に停止/);
  assert.equal(closed, 1);
  assert.equal(s.status().status, 'stopped');
});

test('sanitizeError は長いトークン状の文字列を伏せる', () => {
  assert.equal(sanitizeError(new Error(`bad key ${FAKE_CREDENTIAL_VALUE}`)), 'bad key [redacted]');
});
