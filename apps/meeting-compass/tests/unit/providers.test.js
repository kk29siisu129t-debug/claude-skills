import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../../web/js/core/session.js';
import { createPlayer } from '../../web/js/core/player.js';
import { createDemoProvider } from '../../web/js/providers/demo-provider.js';
import { createAudioProvider, AudioNotConfiguredError } from '../../web/js/providers/audio-provider.js';
import { OUTLINE_DEMO_STEPS } from '../../web/js/core/outline-demo.js';
import { toMarkdown, toJSON } from '../../web/js/core/export.js';

function fakeScheduler() {
  const q = [];
  return {
    set(fn) { q.push(fn); return q.length; },
    clear(h) { q[h - 1] = null; },
    runNext() {
      const i = q.findIndex(Boolean);
      if (i < 0) return false;
      const fn = q[i]; q[i] = null; fn(); return true;
    },
    pending: () => q.filter(Boolean).length,
  };
}

test('player: 再生・一時停止・一歩進める・再開・リセット', () => {
  const sched = fakeScheduler();
  const seen = [];
  const statuses = [];
  const p = createPlayer({ steps: [{ id: 'a', events: [] }, { id: 'b', events: [] }, { id: 'c', events: [] }, { id: 'd', events: [] }], scheduler: sched, onStep: (s) => seen.push(s.id), onStatus: (s) => statuses.push(s) });
  p.play();
  assert.deepEqual(seen, ['a']);
  p.pause();
  assert.equal(sched.pending(), 0, '一時停止中はタイマーが残らない');
  p.step();
  assert.equal(p.status, 'paused');
  p.play();
  sched.runNext();
  assert.deepEqual(seen, ['a', 'b', 'c', 'd']);
  assert.equal(p.status, 'ended');
  assert.equal(p.step(), false);
  p.reset();
  assert.equal(p.cursor, 0);
  assert.equal(sched.pending(), 0);
  assert.deepEqual(statuses, ['playing', 'paused', 'playing', 'ended', 'idle']);
});

test('台本デモ：最後まで流してもエラー無し、リセット＋消去で空に戻り、同じIDで再生し直せる', () => {
  const session = createSession();
  const sched = fakeScheduler();
  const failures = [];
  const demo = createDemoProvider({ session, scheduler: sched, onStep: (_s, _i, results) => failures.push(...results.filter((r) => !r.ok)) });
  assert.equal(demo.kind, 'fixture');
  assert.match(demo.honestyNote, /事前に用意した/);
  demo.player.play();
  while (sched.runNext());
  assert.equal(demo.player.cursor, OUTLINE_DEMO_STEPS.length);
  assert.deepEqual(failures, []);
  const ids = Object.keys(session.getState().nodes);
  demo.player.reset();
  session.clear();
  assert.deepEqual(session.getState().rootIds, []);
  assert.equal(session.getState().log.length, 0);
  for (let i = 0; i < OUTLINE_DEMO_STEPS.length; i++) demo.player.step();
  assert.deepEqual(Object.keys(session.getState().nodes), ids);
});

test('session.clear は内容と ID カウンタを破棄する', () => {
  const session = createSession();
  const first = session.nextId('h');
  session.dispatch({ id: session.nextId('u'), type: 'node.add', node: { id: first, text: 'A' } });
  session.clear();
  assert.equal(session.nextId('h'), first);
  assert.equal(Object.keys(session.getState().nodes).length, 0);
});

test('音声プロバイダは未接続：start は失敗し、mediaDevices に触れない', async () => {
  let touched = false;
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, get() { touched = true; return {}; } });
  try {
    const audio = createAudioProvider();
    assert.equal(audio.status().state, 'not_configured');
    assert.equal(audio.sendsNetwork, false);
    await assert.rejects(audio.start(), AudioNotConfiguredError);
    assert.equal(touched, false);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
    else delete globalThis.navigator;
  }
});

test('export: 入れ子の Markdown（HTML は無害化）と、由来の注意書き付き JSON', () => {
  const session = createSession();
  session.dispatch({ id: 'u1', type: 'node.add', node: { id: 'a', text: '<b>見出し</b>' } });
  session.dispatch({ id: 'u2', type: 'node.add', node: { id: 'a1', parentId: 'a', text: '<img src=x onerror=alert(1)>', label: '補足' } });
  session.dispatch({ id: 'u3', type: 'node.edit', nodeId: 'a1', text: '枝（訂正）' });
  const md = toMarkdown(session.getState(), '2026-01-01T00:00:00Z');
  assert.ok(!md.includes('<b>'));
  assert.match(md, /^- &lt;b&gt;見出し&lt;\/b&gt;$/m);
  assert.match(md, /^ {2}- ［補足］枝（訂正）（訂正 1件）$/m);
  const json = JSON.parse(toJSON(session.getState(), 'now'));
  assert.match(json.notice, /AIによる会議理解の結果ではありません/);
  assert.equal(json.nodes.a.text, '<b>見出し</b>');
});
