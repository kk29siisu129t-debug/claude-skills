// デモ台本プロバイダ：事前に用意した構造イベント（fixture）を順に流すだけ。発言の理解・推論はしない。

import { createPlayer } from '../core/player.js';
import { OUTLINE_DEMO_STEPS } from '../core/outline-demo.js';
import { assertProvider } from './contract.js';

/**
 * @param {{ session: ReturnType<typeof import('../core/session.js').createSession>,
 *   onStep?: (step: any, index: number, results: any[]) => void,
 *   onStatus?: (s: string) => void, scheduler?: any, intervalMs?: number, steps?: any[] }} opts
 */
export function createDemoProvider({ session, onStep = () => {}, onStatus = () => {}, scheduler, intervalMs, steps = OUTLINE_DEMO_STEPS }) {
  const player = createPlayer({
    steps,
    scheduler,
    intervalMs,
    onStatus,
    onStep(step, index) {
      const results = step.events.map((ev) => session.dispatch(ev));
      onStep(step, index, results);
    },
  });
  return assertProvider({
    id: 'demo',
    label: '台本デモ（架空の会議）',
    kind: 'fixture',
    sendsNetwork: false,
    honestyNote: '事前に用意した架空会議の構造イベント（台本）を順に流しています。AIによる理解・音声認識ではありません。',
    status: () => ({ state: player.status, detail: `${player.cursor} / ${player.total}` }),
    player,
    steps,
  });
}
