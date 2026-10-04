// デモ台本プロバイダ：あらかじめ書かれた fixture を順に流すだけ。理解・推論はしない。

import { createPlayer } from '../core/player.js';
import { DEMO_STEPS } from '../core/demo-script.js';
import { assertProvider } from './contract.js';

/**
 * @param {{ session: ReturnType<typeof import('../core/session.js').createSession>,
 *   onStep?: (step: any, index: number, results: any[]) => void,
 *   onStatus?: (s: string) => void, scheduler?: any, intervalMs?: number, steps?: any[] }} opts
 */
export function createDemoProvider({ session, onStep = () => {}, onStatus = () => {}, scheduler, intervalMs, steps = DEMO_STEPS }) {
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
    label: 'デモ台本（架空の会議）',
    kind: 'fixture',
    sendsNetwork: false,
    honestyNote: 'あらかじめ用意した架空会議の台本を順に表示しています。AIによる理解・音声認識ではありません。',
    status: () => ({ state: player.status, detail: `${player.cursor} / ${player.total}` }),
    player,
    steps,
  });
}
