// セッション：メモリ内だけで state を保持する。永続化（localStorage 等）は一切しない。

import { applyOutlineEvent, createOutline } from './outline.js';

/**
 * @param {{ apply?: (state: any, event: any) => any, init?: () => any }} [opts]
 *   既定は会話アウトライン。apply/init を渡せば別のモデルでも使える。
 */
export function createSession({ apply = applyOutlineEvent, init = createOutline } = {}) {
  let state = init();
  let counter = 0;
  /** @type {Set<(state: any, result: any) => void>} */
  const listeners = new Set();

  const notify = (result) => {
    for (const fn of listeners) fn(state, result);
  };

  return {
    getState: () => state,
    /** 呼び出し側が付けたイベントIDのまま適用する（重複は無視される）。 */
    dispatch(event) {
      const result = apply(state, event);
      state = result.state;
      notify(result);
      return result;
    },
    /** 手入力・ユーザー操作用の、セッション内で決定的に増える ID。 */
    nextId(prefix) {
      counter += 1;
      return `${prefix}-${String(counter).padStart(3, '0')}`;
    },
    /** 内容をすべて破棄して初期状態に戻す。 */
    clear() {
      state = init();
      counter = 0;
      notify({ ok: true, cleared: true, changedIds: [] });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
