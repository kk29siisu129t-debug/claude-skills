// デモ台本の再生器。タイマーは注入可能（テストでは手動で進める）。

/** @typedef {'idle'|'playing'|'paused'|'ended'} PlayerStatus */

export const PLAYER_STATUS_LABELS = /** @type {const} */ ({
  idle: '停止中（未開始）',
  playing: '再生中',
  paused: '一時停止中',
  ended: '再生終了（停止中）',
});

const defaultScheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle),
};

/**
 * @param {{ steps: { id: string, events: any[] }[], onStep: (step: any, index: number) => void,
 *   onStatus?: (status: PlayerStatus) => void, intervalMs?: number,
 *   scheduler?: { set: (fn: () => void, ms: number) => any, clear: (h: any) => void } }} opts
 */
export function createPlayer({ steps, onStep, onStatus = () => {}, intervalMs = 2200, scheduler = defaultScheduler }) {
  let cursor = 0;
  /** @type {PlayerStatus} */
  let status = 'idle';
  let handle = null;
  let interval = intervalMs;

  /** 状態はクロージャ越しに変わるため、型の絞り込みを避けて関数で読む */
  const is = (s) => status === s;
  const setStatus = (s) => {
    if (s !== status) {
      status = s;
      onStatus(status);
    }
  };
  const cancel = () => {
    if (handle !== null) scheduler.clear(handle);
    handle = null;
  };
  const advance = () => {
    if (cursor >= steps.length) {
      cancel();
      setStatus('ended');
      return false;
    }
    const index = cursor;
    cursor += 1;
    onStep(steps[index], index);
    if (cursor >= steps.length) {
      cancel();
      setStatus('ended');
    }
    return true;
  };
  const tick = () => {
    handle = null;
    if (status !== 'playing') return;
    advance();
    if (is('playing')) handle = scheduler.set(tick, interval);
  };

  return {
    play() {
      if (status === 'playing' || status === 'ended') return;
      setStatus('playing');
      // 最初の1歩はすぐ進める
      advance();
      if (is('playing')) handle = scheduler.set(tick, interval);
    },
    pause() {
      if (status !== 'playing') return;
      cancel();
      setStatus('paused');
    },
    step() {
      if (status === 'ended') return false;
      cancel();
      const moved = advance();
      if (!is('ended')) setStatus('paused');
      return moved;
    },
    reset() {
      cancel();
      cursor = 0;
      setStatus('idle');
    },
    setInterval(ms) {
      interval = ms;
    },
    get status() { return status; },
    get cursor() { return cursor; },
    get total() { return steps.length; },
  };
}
