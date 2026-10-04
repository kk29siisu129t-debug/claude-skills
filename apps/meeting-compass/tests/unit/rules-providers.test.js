import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../../web/js/core/rules.js';
import { createSession } from '../../web/js/core/session.js';
import { createPlayer } from '../../web/js/core/player.js';
import { createManualProvider } from '../../web/js/providers/manual-provider.js';
import { createDemoProvider } from '../../web/js/providers/demo-provider.js';
import { createAudioProvider, AudioNotConfiguredError } from '../../web/js/providers/audio-provider.js';
import { DEMO_STEPS } from '../../web/js/core/demo-script.js';
import { toMarkdown, toJSON } from '../../web/js/core/export.js';
import { findItem } from '../../web/js/core/model.js';

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

test('classify: キーワード規則による分類', () => {
  assert.equal(classify('移行コストが心配です').kind, 'concern');
  assert.equal(classify('全部オンラインにしてはどうでしょう').kind, 'proposal');
  assert.equal(classify('一方で手間は増える').kind, 'tradeoff');
  assert.equal(classify('対面は第何週？').kind, 'open_question');
  assert.equal(classify('予算は次回決めましょう').kind, 'next');
  const t = classify('議題: 来期の採用計画');
  assert.equal(t.type, 'topic');
  assert.equal(t.title, '来期の採用計画');
});

test('classify: どの規則にも当てはまらなければ未分類', () => {
  const c = classify('今日はいい天気');
  assert.equal(c.kind, 'unclassified');
  assert.equal(c.matched, null);
});

test('classify: 空入力・空白のみは失敗', () => {
  assert.equal(classify('').ok, false);
  assert.equal(classify('   \n').ok, false);
  assert.equal(classify('議題:   ').ok, false);
});

test('classify: アクションの担当・期限は明記されたときだけ取り出す', () => {
  const a = classify('一覧作成やります');
  assert.equal(a.kind, 'action');
  assert.equal(a.owner, null);
  assert.equal(a.due, null);
  const b = classify('一覧作成 担当: Bさん 期限: 10/20');
  assert.equal(b.owner, 'Bさん');
  assert.equal(b.due, '10/20');
});

test('手入力：「決定しました」でも仮案。確定にはならない', () => {
  const session = createSession();
  const manual = createManualProvider({ session });
  const r = manual.submit('この方針で決定しました');
  assert.ok(r.ok);
  const item = findItem(session.getState(), r.itemId);
  assert.equal(item.kind, 'decision');
  assert.equal(item.status, 'tentative');
  assert.equal(item.origin, 'rule');
  assert.match(r.message, /仮案/);
});

test('手入力：論点が無ければ「論点未設定」を自動で開き、ID は決定的', () => {
  const s1 = createSession();
  const m1 = createManualProvider({ session: s1 });
  m1.submit('提案: 週報を廃止');
  m1.submit('あの件の続き');
  const s2 = createSession();
  const m2 = createManualProvider({ session: s2 });
  m2.submit('提案: 週報を廃止');
  m2.submit('あの件の続き');
  assert.deepEqual(s1.getState().items.map((i) => i.id), s2.getState().items.map((i) => i.id));
  assert.equal(s1.getState().topics[0].title, '論点未設定（手入力）');
  const unc = s1.getState().items[1];
  assert.equal(unc.kind, 'unclassified');
  assert.equal(unc.needsReview, true);
});

test('手入力：空入力は拒否され、何も追加されない', () => {
  const session = createSession();
  const manual = createManualProvider({ session });
  for (const t of ['', '  ', '\n']) assert.equal(manual.submit(t).ok, false);
  assert.equal(session.getState().items.length, 0);
  assert.equal(session.getState().topics.length, 0);
});

test('手入力：種類を指定するとユーザー入力として追加', () => {
  const session = createSession();
  const manual = createManualProvider({ session });
  manual.submit('採用計画', 'topic');
  const r = manual.submit('今日はいい天気', 'concern');
  const item = findItem(session.getState(), r.itemId);
  assert.equal(item.kind, 'concern');
  assert.equal(item.origin, 'user');
  assert.equal(manual.submit('x', 'bogus').ok, false);
});

test('player: 再生・一時停止・一歩進める・再開・リセット', () => {
  const sched = fakeScheduler();
  const seen = [];
  const statuses = [];
  const p = createPlayer({ steps: [{ id: 'a', events: [] }, { id: 'b', events: [] }, { id: 'c', events: [] }, { id: 'd', events: [] }], scheduler: sched, onStep: (s) => seen.push(s.id), onStatus: (s) => statuses.push(s) });
  assert.equal(p.status, 'idle');
  p.play();
  assert.equal(p.status, 'playing');
  assert.deepEqual(seen, ['a']);
  p.pause();
  assert.equal(p.status, 'paused');
  assert.equal(sched.pending(), 0, '一時停止中はタイマーが残らない');
  p.step();
  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(p.status, 'paused');
  p.play(); // 再開
  assert.deepEqual(seen, ['a', 'b', 'c']);
  sched.runNext();
  assert.deepEqual(seen, ['a', 'b', 'c', 'd']);
  assert.equal(p.status, 'ended');
  assert.equal(p.step(), false);
  p.play();
  assert.equal(seen.length, 4, '終了後は再生しない');
  p.reset();
  assert.equal(p.status, 'idle');
  assert.equal(p.cursor, 0);
  assert.equal(sched.pending(), 0);
  assert.deepEqual(statuses, ['playing', 'paused', 'playing', 'ended', 'idle']);
});

test('デモプロバイダ：最後まで再生してもエラー無し、リセット＋消去で空に戻り再生し直せる', () => {
  const session = createSession();
  const sched = fakeScheduler();
  const failures = [];
  const demo = createDemoProvider({ session, scheduler: sched, onStep: (_s, _i, results) => failures.push(...results.filter((r) => !r.ok)) });
  demo.player.play();
  while (sched.runNext());
  assert.equal(demo.player.status, 'ended');
  assert.equal(demo.player.cursor, DEMO_STEPS.length);
  assert.deepEqual(failures, []);
  const ids1 = session.getState().items.map((i) => i.id);
  demo.player.reset();
  session.clear();
  assert.equal(session.getState().items.length, 0);
  assert.equal(session.getState().log.length, 0);
  assert.equal(session.getState().currentTopicId, null);
  for (let i = 0; i < DEMO_STEPS.length; i++) demo.player.step();
  assert.deepEqual(session.getState().items.map((i) => i.id), ids1);
});

test('session.clear は内容と ID カウンタを破棄する', () => {
  const session = createSession();
  const manual = createManualProvider({ session });
  manual.submit('議題: A');
  manual.submit('提案: B');
  const before = session.getState().items[0].id;
  session.clear();
  assert.equal(session.getState().topics.length, 0);
  manual.submit('議題: A');
  manual.submit('提案: B');
  assert.equal(session.getState().items[0].id, before);
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
    assert.deepEqual(audio.stop(), { stoppedTracks: 0 });
    assert.equal(touched, false);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
    else delete globalThis.navigator;
  }
});

test('どのプロバイダも外部送信しない宣言', () => {
  const session = createSession();
  for (const p of [createDemoProvider({ session }), createManualProvider({ session }), createAudioProvider()]) {
    assert.equal(p.sendsNetwork, false, p.id);
    assert.ok(p.honestyNote.length > 10);
  }
});

test('export: Markdown は HTML を無害化し、JSON は由来の注意書きを含む', () => {
  const session = createSession();
  const manual = createManualProvider({ session });
  manual.submit('議題: <b>太字</b>');
  manual.submit('<img src=x onerror=alert(1)>', 'concern');
  const md = toMarkdown(session.getState(), '2026-01-01T00:00:00Z');
  assert.ok(!md.includes('<img'));
  assert.ok(md.includes('&lt;img'));
  const json = JSON.parse(toJSON(session.getState(), 'now'));
  assert.match(json.notice, /AIによる会議理解の結果ではありません/);
  assert.equal(json.items[0].text, '<img src=x onerror=alert(1)>');
});
