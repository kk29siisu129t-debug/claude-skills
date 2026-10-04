// 音声経路（将来）のプレースホルダ。このプロトタイプでは接続しない。
//
// - 本モジュールは navigator.mediaDevices（getDisplayMedia / getUserMedia）を一切呼ばない
// - 外部モデル・文字起こしサービスにも接続しない
// - 将来の設計は docs/audio-path.md を参照
//
// 将来この adapter が満たすべき条件（未実装・要件として明記）:
//   1. 開始前に参加者への告知・同意を確認する UI
//   2. 取得中は常時「録音中」表示
//   3. 停止で getTracks() すべてを stop()、バッファを破棄
//   4. 送信先はアプリ自身のサーバーのみ。provider の API キーはサーバー側で管理し、
//      ブラウザ・localStorage・Git に置かない
//   5. 送信範囲（音声 or 文字起こし）と保持期間を画面と設定に明記

import { assertProvider } from './contract.js';

export class AudioNotConfiguredError extends Error {
  constructor() {
    super('音声入力は未接続です（このプロトタイプでは実装していません）');
    this.name = 'AudioNotConfiguredError';
  }
}

export const AUDIO_ROUTES = Object.freeze([
  {
    id: 'meet-tab-audio',
    label: 'Google Meet タブの音声（デスクトップ Chrome）',
    priority: 1,
    status: 'not_configured',
    detail: 'getDisplayMedia でMeetタブの音声共有を受け取り、自分の声は別途 getUserMedia で取得する将来案。スマホ版Meetの音声取得は対象外。',
  },
  {
    id: 'meet-media-api',
    label: 'Google Meet Media API',
    priority: 2,
    status: 'not_available',
    detail: '公式情報では Developer Preview の制約があり、新規サインアップ停止と記載されているため現時点では採用しない。',
  },
  {
    id: 'room-mic',
    label: '対面会議のマイク（任意）',
    priority: 3,
    status: 'not_configured',
    detail: '対面会議で端末マイクを使う任意の経路。',
  },
]);

export function createAudioProvider() {
  return assertProvider({
    id: 'audio',
    label: '音声（未接続）',
    kind: 'audio',
    sendsNetwork: false,
    honestyNote: '音声入力は未接続です。マイク・画面共有の許可は要求しません。',
    status: () => ({ state: 'not_configured', detail: '接続未設定' }),
    routes: AUDIO_ROUTES,
    async start() {
      throw new AudioNotConfiguredError();
    },
    stop() {
      // 取得していないので停止すべき track は無い
      return { stoppedTracks: 0 };
    },
  });
}
