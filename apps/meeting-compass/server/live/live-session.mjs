// ライブセッション本体（ベンダー非依存）。プロバイダ・時計・タイマーはすべて注入。
// - start: ゲート（有効化・資格情報の存在・同意・開始操作）を満たさない限りプロバイダを一切呼ばない
// - 二重開始は拒否
// - 音声は時間上限、構造化はリクエスト数・トークン上限・タイムアウトで制限
// - 構造化は同時に1件だけ。応答は検証し、古い revision なら1回だけ再投入
// - stop: 進行中リクエストの abort、文字起こしの close、未送信バッチの破棄、タイマー解除

import { createState, applyEvent } from '../../web/js/core/model.js';
import { evaluateGate } from './config.mjs';
import { createBudget, BudgetExceededError } from './budget.mjs';
import { createBatcher } from './batcher.mjs';
import { STRUCTURING_SCHEMA, applyStructuring, buildStructuringInput } from './structuring.mjs';
import { assertTranscriptionProvider, assertStructuringProvider } from './provider-contract.mjs';

export class GateError extends Error {
  constructor(reasons) {
    super(`開始できません: ${reasons.join(' / ')}`);
    this.name = 'GateError';
    this.reasons = reasons;
  }
}

/** ブラウザ・ログへ出す前にエラー文を無害化（長い英数字列は秘密値の可能性があるので伏せる）。 */
export function sanitizeError(err) {
  const msg = String(err && err.message ? err.message : err);
  return msg.replace(/[A-Za-z0-9_\-.]{24,}/g, '[redacted]').slice(0, 200);
}

const USER_EVENT_TYPES = new Set([
  'item.correct', 'item.reclassify', 'decision.confirm', 'decision.tentative', 'decision.withdraw',
  'decision.revisit', 'item.resolve', 'item.reopen', 'action.update', 'topic.switch', 'topic.rename',
]);

const MAX_AUDIO_CHUNK_BYTES = 64 * 1024;

const defaultScheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h),
};

/**
 * @param {{ config: any, transcription: any, structuring: any, idPrefix?: string,
 *   clock?: { now: () => number }, scheduler?: typeof defaultScheduler, sampleRate?: number,
 *   log?: (msg: string) => void }} opts
 */
export function createLiveSession({
  config, transcription, structuring, idPrefix = 'lv', clock = { now: () => Date.now() },
  scheduler = defaultScheduler, sampleRate = 24000, log = () => {},
}) {
  assertTranscriptionProvider(transcription);
  assertStructuringProvider(structuring);
  const limits = config.limits;
  /** @type {'idle'|'starting'|'running'|'stopping'|'stopped'} */
  let status = 'idle';
  let state = createState();
  /** @type {any[]} */
  const eventLog = [];
  const rejections = [];
  let counter = 0;
  let budget = null;
  let batcher = null;
  let sessionAbort = null;
  let transcriptionHandle = null;
  let ticker = null;
  let inFlight = null; // { abort: AbortController, timer }
  let stopReason = null;
  let lastError = null;
  const requeued = new Set();

  const nextId = (kind) => `${idPrefix}-${kind}${String(++counter).padStart(4, '0')}`;

  function pushEvents(events) {
    for (const ev of events) {
      const r = applyEvent(state, ev);
      if (r.ok) {
        state = r.state;
        eventLog.push({ seq: state.seq, event: ev });
      }
    }
  }

  function reject(reason, extra = {}) {
    const entry = { at: clock.now(), reason: sanitizeError(reason), ...extra };
    rejections.push(entry);
    log(`live: 構造化応答を破棄 ${entry.reason}`);
  }

  async function runStructuring() {
    if (status !== 'running' || inFlight || !batcher.shouldFlush()) return;
    const batch = batcher.take();
    if (!batch) return;
    const built = buildStructuringInput(state, batch, limits);
    let reservation;
    try {
      reservation = budget.reserve(built.estimatedTokens);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        await stop(`budget:${err.what}`);
        return;
      }
      throw err;
    }
    const abort = new AbortController();
    const onSessionAbort = () => abort.abort();
    sessionAbort.signal.addEventListener('abort', onSessionAbort, { once: true });
    const timer = scheduler.setTimeout(() => abort.abort(new Error('timeout')), limits.requestTimeoutMs);
    inFlight = { abort, timer };
    const revisionAtSend = state.seq;
    let result = null;
    let failure = null;
    try {
      result = await structuring.structure({
        input: built.input,
        schema: STRUCTURING_SCHEMA,
        maxOutputTokens: reservation.maxOutputTokens,
        signal: abort.signal,
      });
    } catch (err) {
      failure = err;
    } finally {
      scheduler.clearTimeout(timer);
      sessionAbort.signal.removeEventListener('abort', onSessionAbort);
      inFlight = null;
      // 送信した可能性があるので、失敗・中止でも確保分を計上する（少なく見積もらない）
      budget.commit(reservation, result ? result.usage : null);
    }
    if (status !== 'running') return; // 停止後に返ってきた応答は捨てる
    if (failure) {
      lastError = sanitizeError(failure);
      reject(`provider: ${lastError}`, { kind: abort.signal.aborted ? 'timeout' : 'provider' });
      return;
    }
    const applied = applyStructuring(state, result.json, { batchText: built.batchText, nextId });
    if (!applied.ok) {
      const key = batch.segments.map((s) => s.segmentId).join(',');
      if (applied.obsolete && !requeued.has(key) && state.seq !== revisionAtSend) {
        requeued.add(key);
        batcher.requeue(batch);
        reject(applied.reason, { kind: 'obsolete', requeued: true });
      } else {
        reject(applied.reason, { kind: applied.obsolete ? 'obsolete' : 'invalid' });
      }
      return;
    }
    pushEvents(applied.events);
  }

  async function tick() {
    if (status !== 'running') return;
    try {
      budget.checkTime();
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        await stop(`budget:${err.what}`);
        return;
      }
      throw err;
    }
    kick();
  }

  /** 構造化を裏で開始する（応答を待たない。同時実行は runStructuring 側で1件に制限） */
  function kick() {
    void runStructuring().catch((e) => { lastError = sanitizeError(e); });
  }

  async function stop(reason = 'user') {
    if (status === 'idle' || status === 'stopped' || status === 'stopping') return { stopped: false };
    status = 'stopping';
    stopReason = reason;
    if (ticker !== null) scheduler.clearInterval(ticker);
    ticker = null;
    sessionAbort?.abort(new Error('stopped'));
    inFlight?.abort.abort(new Error('stopped'));
    const handle = transcriptionHandle;
    transcriptionHandle = null;
    const discarded = batcher ? batcher.discard() : 0;
    try {
      await handle?.close();
    } catch (err) {
      lastError = sanitizeError(err);
    }
    status = 'stopped';
    log(`live: 停止 (${reason})`);
    return { stopped: true, discardedSegments: discarded };
  }

  return {
    /**
     * @param {{ consent: any, startRequested: boolean }} req
     */
    async start({ consent, startRequested }) {
      if (status !== 'idle') throw new Error(status === 'stopped' ? 'このセッションは終了しています' : '既に開始しています');
      const gate = evaluateGate({ config, consent, startRequested });
      if (!gate.allowed) throw new GateError(gate.reasons);
      status = 'starting';
      budget = createBudget(limits, clock);
      batcher = createBatcher({ maxMs: limits.batchMaxMs, maxChars: limits.batchMaxChars, clock });
      sessionAbort = new AbortController();
      try {
        const handle = await transcription.open({
          signal: sessionAbort.signal,
          onFinal: (seg) => {
            if (status !== 'running') return;
            if (batcher.addFinal(seg)) kick();
          },
          onError: (err) => {
            lastError = sanitizeError(err);
            void stop('provider-error');
          },
        });
        if (status !== 'starting') {
          // 開始中に停止された
          await handle?.close();
          throw new Error('開始中に停止されました');
        }
        transcriptionHandle = handle;
      } catch (err) {
        if (status === 'starting') {
          status = 'stopped';
          stopReason = 'start-failed';
        }
        lastError = sanitizeError(err);
        throw err;
      }
      status = 'running';
      ticker = scheduler.setInterval(() => { void tick(); }, 1000);
      return { started: true };
    },

    /** PCM16 mono の音声片を渡す。 */
    appendAudio(bytes) {
      if (status !== 'running') throw new Error('実行中ではありません');
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) throw new TypeError('音声データが不正です');
      if (bytes.byteLength > MAX_AUDIO_CHUNK_BYTES) throw new RangeError('音声片が大きすぎます');
      try {
        budget.addAudioMs((bytes.byteLength / 2 / sampleRate) * 1000);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          void stop(`budget:${err.what}`);
          return false;
        }
        throw err;
      }
      transcriptionHandle.appendAudio(bytes);
      return true;
    },

    /** ブラウザ側のユーザー操作をサーバー側の文脈にも反映する（許可した種類のみ）。 */
    applyUserEvent(ev) {
      if (!ev || !USER_EVENT_TYPES.has(ev.type)) return { ok: false, message: '許可していない操作です' };
      const r = applyEvent(state, { ...ev, by: 'user' });
      if (r.ok) {
        state = r.state;
        eventLog.push({ seq: state.seq, event: { ...ev, by: 'user' } });
      }
      return { ok: r.ok, message: r.message };
    },

    /** タイマーと同じ処理（時間上限の確認と、まとめが溜まっていれば構造化の開始）。応答は待たない。 */
    tick,
    stop,
    eventsAfter(seq) {
      return eventLog.filter((e) => e.seq > seq).slice(0, 200);
    },
    getState: () => state,
    status() {
      return {
        status,
        stopReason,
        lastError,
        pendingSegments: batcher ? batcher.pendingCount : 0,
        inFlight: !!inFlight,
        rejections: rejections.length,
        budget: budget ? budget.snapshot() : null,
      };
    },
    rejections: () => rejections.slice(),
  };
}
