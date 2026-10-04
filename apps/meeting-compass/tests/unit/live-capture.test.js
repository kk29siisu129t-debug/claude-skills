import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureSession, CaptureError, floatTo16BitPcm, downsample } from '../../web/js/live/capture-session.js';
import { assertNoNetworkAfterAll, mockMediaDevices } from './live-helpers.mjs';

assertNoNetworkAfterAll();

const ALLOWED = { allowed: true };

test('ゲートが許可していなければ mediaDevices を一切呼ばない', async () => {
  const md = mockMediaDevices();
  const c = createCaptureSession({ acquire: md.acquire });
  for (const gate of [undefined, null, { allowed: false }, { allowed: 'yes' }]) {
    await assert.rejects(c.start({ mode: 'meet-tab-and-mic', gate }), (e) => e instanceof CaptureError && e.code === 'gate');
  }
  assert.deepEqual(md.calls, { getDisplayMedia: 0, getUserMedia: 0 });
  assert.equal(c.status, 'idle');
});

test('取得手段が未設定（注入なし）なら開始できない', async () => {
  const c = createCaptureSession({ acquire: {} });
  await assert.rejects(c.start({ mode: 'room-mic', gate: ALLOWED }), (e) => e.code === 'not-configured');
});

test('Meet タブ＋マイク：映像 track は即停止、停止で全 track を止めリスナーも外す', async () => {
  const md = mockMediaDevices();
  const stopped = [];
  const c = createCaptureSession({ acquire: md.acquire, onStopped: (i) => stopped.push(i) });
  const { audioTracks, signal } = await c.start({ mode: 'meet-tab-and-mic', gate: ALLOWED });
  assert.deepEqual(audioTracks.map((t) => t.label), ['tab-audio', 'mic']);
  assert.equal(md.tracks.find((t) => t.kind === 'video').readyState, 'ended');
  assert.equal(c.liveTrackCount, 2);
  await assert.rejects(c.start({ mode: 'room-mic', gate: ALLOWED }), (e) => e.code === 'state');
  const r = c.stop();
  assert.equal(r.stoppedTracks, 2);
  assert.ok(md.tracks.every((t) => t.readyState === 'ended' && t.stopCalls >= 1));
  assert.ok(md.tracks.every((t) => t.listenerCount === 0));
  assert.equal(signal.aborted, true);
  assert.equal(c.liveTrackCount, 0);
  assert.deepEqual(stopped, [{ reason: 'user', stoppedTracks: 2 }]);
  assert.deepEqual(c.stop(), { stoppedTracks: 0 }, '冪等');
});

test('タブ音声が共有されていなければ失敗し、取れた track を全部止める', async () => {
  const md = mockMediaDevices({ tabAudio: false });
  const c = createCaptureSession({ acquire: md.acquire });
  await assert.rejects(c.start({ mode: 'meet-tab-and-mic', gate: ALLOWED }), (e) => e.code === 'no-tab-audio');
  assert.equal(md.calls.getUserMedia, 0, 'マイクは要求しない');
  assert.ok(md.tracks.every((t) => t.readyState === 'ended'));
  assert.equal(c.status, 'stopped');
});

test('マイク取得が拒否されたら、先に取ったタブ音声も止める', async () => {
  const md = mockMediaDevices({ micFails: true });
  const c = createCaptureSession({ acquire: md.acquire });
  await assert.rejects(c.start({ mode: 'meet-tab-and-mic', gate: ALLOWED }), /NotAllowedError/);
  assert.ok(md.tracks.length >= 2);
  assert.ok(md.tracks.every((t) => t.readyState === 'ended'));
});

test('共有の終了（track ended）で全体を停止', async () => {
  const md = mockMediaDevices();
  const stopped = [];
  const c = createCaptureSession({ acquire: md.acquire, onStopped: (i) => stopped.push(i) });
  await c.start({ mode: 'meet-tab-and-mic', gate: ALLOWED });
  md.tracks.find((t) => t.label === 'tab-audio').endExternally();
  assert.equal(c.status, 'stopped');
  assert.equal(md.tracks.find((t) => t.label === 'mic').readyState, 'ended');
  assert.equal(stopped[0].reason, 'track-ended');
});

test('対面マイク：画面共有は要求しない', async () => {
  const md = mockMediaDevices();
  const c = createCaptureSession({ acquire: md.acquire });
  await c.start({ mode: 'room-mic', gate: ALLOWED });
  assert.deepEqual(md.calls, { getDisplayMedia: 0, getUserMedia: 1 });
  c.stop();
});

test('取得待ちの間に停止されたら、後から届いた stream も止める', async () => {
  let release;
  const lateTrack = { kind: 'audio', readyState: 'live', stop() { this.readyState = 'ended'; }, addEventListener() {}, removeEventListener() {} };
  const c = createCaptureSession({
    acquire: { microphone: () => new Promise((r) => { release = r; }) },
  });
  const p = c.start({ mode: 'room-mic', gate: ALLOWED });
  c.stop();
  release({ getTracks: () => [lateTrack], getAudioTracks: () => [lateTrack], getVideoTracks: () => [] });
  await assert.rejects(p, (e) => e.code === 'aborted');
  assert.equal(lateTrack.readyState, 'ended');
});

test('PCM 変換と間引き', () => {
  const pcm = floatTo16BitPcm(new Float32Array([0, 1, -1, 2]));
  const v = new DataView(pcm.buffer);
  assert.deepEqual([v.getInt16(0, true), v.getInt16(2, true), v.getInt16(4, true), v.getInt16(6, true)], [0, 32767, -32768, 32767]);
  const d = downsample(new Float32Array([1, 1, 0, 0, 1, 1]), 48000, 24000);
  assert.deepEqual([...d], [1, 0, 1]);
  assert.throws(() => downsample(new Float32Array(4), 16000, 24000), RangeError);
});
