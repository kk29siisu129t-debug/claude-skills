// 入力プロバイダの共通契約。
// どのプロバイダも「構造化イベント（model.js の applyEvent が受け付ける形）」だけを session に渡す。
// 生の音声・文字起こし・API キーは UI / モデル層に一切持ち込まない。
//
// interface InputProvider {
//   id: string;                 // 'demo' | 'manual' | 'meet-tab-audio' など
//   label: string;              // 画面表示名
//   kind: 'fixture' | 'rule' | 'audio';
//   honestyNote: string;        // 何をしていて何をしていないか（常時表示用）
//   status(): { state: 'ready' | 'running' | 'paused' | 'stopped' | 'not_configured', detail: string };
//   sendsNetwork: boolean;      // 外部へ送信するか（デモ・手入力は false）
// }

export const REQUIRED_KEYS = ['id', 'label', 'kind', 'honestyNote', 'status', 'sendsNetwork'];

export function assertProvider(p) {
  for (const k of REQUIRED_KEYS) {
    if (!(k in p)) throw new Error(`provider に ${k} がありません`);
  }
  return p;
}
