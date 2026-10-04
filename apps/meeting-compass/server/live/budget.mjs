// 予算の上限。金額の概算ではなく、リクエスト数・時間・トークン数で強制する（hard cap）。
// - 構造化リクエストは送る前に reserve()：入力の推定トークン＋出力上限を先に確保し、超えるなら送らない
// - 応答後に commit()：実績（usage）があればそれを、無ければ確保した最大値をそのまま使う（少なく見積もらない）
// - 金額は estimateCostUsd() の参考値のみ。単価は呼び出し側が渡す（既定の単価は持たない）

export class BudgetExceededError extends Error {
  constructor(what) {
    super(`上限に達しました: ${what}`);
    this.name = 'BudgetExceededError';
    this.what = what;
  }
}

/** 日本語を多く含む文字列の控えめ（多め）なトークン推定。1文字=1トークン＋固定オーバーヘッド。 */
export function estimateTokens(text) {
  return String(text).length + 16;
}

/**
 * @param {{ maxSessionMs: number, maxAudioMs: number, maxStructuringRequests: number,
 *   maxInputTokensPerRequest: number, maxOutputTokensPerRequest: number, maxTotalTokens: number }} limits
 * @param {{ now: () => number }} [clock]
 */
export function createBudget(limits, clock = { now: () => Date.now() }) {
  const startedAt = clock.now();
  let audioMs = 0;
  let requests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  /** @type {Map<number, number>} reservationId → 確保量 */
  const reservations = new Map();
  let nextReservation = 1;
  let exhausted = null;

  const reserved = () => [...reservations.values()].reduce((a, b) => a + b, 0);
  const elapsedMs = () => clock.now() - startedAt;

  return {
    /** 時間上限の確認。超えていれば exhausted を設定して例外。 */
    checkTime() {
      if (elapsedMs() > limits.maxSessionMs) {
        exhausted = exhausted || 'セッション時間';
        throw new BudgetExceededError('セッション時間');
      }
    },
    /** 受け取った音声の長さを加算（PCM のバイト数などから呼び出し側が算出）。 */
    addAudioMs(ms) {
      this.checkTime();
      if (!(ms >= 0)) throw new RangeError('音声長が不正です');
      if (audioMs + ms > limits.maxAudioMs) {
        exhausted = exhausted || '音声時間';
        throw new BudgetExceededError('音声時間');
      }
      audioMs += ms;
    },
    /** 構造化リクエスト1回分を確保する。超えるなら送らない。 */
    reserve(estimatedInputTokens) {
      this.checkTime();
      if (estimatedInputTokens > limits.maxInputTokensPerRequest) throw new BudgetExceededError('1回あたりの入力トークン');
      if (requests + reservations.size >= limits.maxStructuringRequests) {
        exhausted = exhausted || '構造化リクエスト回数';
        throw new BudgetExceededError('構造化リクエスト回数');
      }
      const need = estimatedInputTokens + limits.maxOutputTokensPerRequest;
      if (inputTokens + outputTokens + reserved() + need > limits.maxTotalTokens) {
        exhausted = exhausted || '合計トークン';
        throw new BudgetExceededError('合計トークン');
      }
      const id = nextReservation++;
      reservations.set(id, need);
      return { id, maxOutputTokens: limits.maxOutputTokensPerRequest, estimatedInputTokens };
    },
    /** 送信した確保を確定する。usage が無い／不正なら確保した最大値で計上。 */
    commit(reservation, usage) {
      const held = reservations.get(reservation.id);
      if (held === undefined) return;
      reservations.delete(reservation.id);
      requests += 1;
      const ok = usage && Number.isInteger(usage.inputTokens) && Number.isInteger(usage.outputTokens)
        && usage.inputTokens >= 0 && usage.outputTokens >= 0;
      if (ok) {
        inputTokens += usage.inputTokens;
        // 出力上限を超えた申告があっても上限側で頭打ちにはせず、実績として多い方を数える
        outputTokens += usage.outputTokens;
      } else {
        inputTokens += reservation.estimatedInputTokens;
        outputTokens += reservation.maxOutputTokens;
      }
    },
    /** 送らずに終わった確保（中止・タイムアウト前の失敗）を戻す。送信済みなら commit すること。 */
    release(reservation) {
      reservations.delete(reservation.id);
    },
    snapshot() {
      return {
        elapsedMs: elapsedMs(),
        audioMs,
        requests,
        inputTokens,
        outputTokens,
        reservedTokens: reserved(),
        exhausted,
        limits: { ...limits },
      };
    },
  };
}

/**
 * 参考の概算（実績ではない）。単価は呼び出し側が明示する。
 * @param {{ audioMinutes: number, inputTokens: number, outputTokens: number }} usage
 * @param {{ audioPerMinute: number, inputPer1M: number, outputPer1M: number }} rates
 */
export function estimateCostUsd(usage, rates) {
  return usage.audioMinutes * rates.audioPerMinute
    + (usage.inputTokens / 1e6) * rates.inputPer1M
    + (usage.outputTokens / 1e6) * rates.outputPer1M;
}
