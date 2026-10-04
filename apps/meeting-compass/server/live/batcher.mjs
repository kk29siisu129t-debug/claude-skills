// 文字起こしの「確定（final）」区間だけを集め、最大 30 秒（または文字数上限）ごとにまとめて構造化へ渡す。
// 全文を毎回送らないため、直近の文脈は数区間だけ別に保持する。

import { normalizeText } from '../../web/js/core/model.js';

/**
 * @param {{ maxMs: number, maxChars: number, contextSegments?: number, contextChars?: number,
 *   clock?: { now: () => number } }} opts
 */
export function createBatcher({ maxMs, maxChars, contextSegments = 3, contextChars = 400, clock = { now: () => Date.now() } }) {
  /** @type {{ segmentId: string, text: string }[]} */
  let pending = [];
  let firstAt = null;
  const seen = new Set();
  /** @type {string[]} */
  let recent = [];

  const pendingChars = () => pending.reduce((n, s) => n + s.text.length, 0);

  return {
    /**
     * final 区間を追加。空文字・重複 segmentId は無視。
     * @returns {boolean} 追加したか
     */
    addFinal({ segmentId, text }) {
      if (typeof segmentId !== 'string' || !segmentId || seen.has(segmentId)) return false;
      const t = normalizeText(text);
      if (!t) return false;
      seen.add(segmentId);
      if (firstAt === null) firstAt = clock.now();
      pending.push({ segmentId, text: t.slice(0, maxChars) });
      return true;
    },
    /** 送るべきか（時間・文字数のどちらかの上限に達した）。 */
    shouldFlush() {
      if (!pending.length) return false;
      return clock.now() - firstAt >= maxMs || pendingChars() >= maxChars;
    },
    /** まとめを取り出す。文脈は直前までの final 区間のうち数件だけ。 */
    take() {
      if (!pending.length) return null;
      let chars = 0;
      const batch = [];
      while (pending.length && chars + pending[0].text.length <= maxChars) {
        const s = pending.shift();
        chars += s.text.length;
        batch.push(s);
      }
      if (!batch.length) batch.push(pending.shift()); // 1区間が長すぎる場合も必ず前進する
      const context = recent.slice(-contextSegments);
      let ctxChars = 0;
      const clipped = [];
      for (let i = context.length - 1; i >= 0; i--) {
        if (ctxChars + context[i].length > contextChars) break;
        ctxChars += context[i].length;
        clipped.unshift(context[i]);
      }
      recent = [...recent, ...batch.map((s) => s.text)].slice(-contextSegments);
      firstAt = pending.length ? clock.now() : null;
      return { segments: batch, recentContext: clipped };
    },
    /** 取り出したまとめを（古い応答として破棄した場合などに）先頭へ戻す。 */
    requeue(batch) {
      pending = [...batch.segments, ...pending];
      recent = recent.slice(0, Math.max(0, recent.length - batch.segments.length));
      if (firstAt === null) firstAt = clock.now();
    },
    /** 停止時：未送信の区間と文脈を破棄する。 */
    discard() {
      const dropped = pending.length;
      pending = [];
      recent = [];
      firstAt = null;
      return dropped;
    },
    get pendingCount() { return pending.length; },
  };
}
