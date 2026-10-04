// 音声取得のインターフェース（ベンダー非依存・未配線）。
//
// このモジュールはブラウザのメディア API を直接呼ばない。取得関数は外から注入する：
//   acquire.display()    … 将来: デスクトップ Chrome の Meet タブ音声（画面共有ダイアログ）
//   acquire.microphone() … 将来: 自分のマイク／対面会議のマイク
// 実際に getDisplayMedia / getUserMedia を呼ぶ取得関数は、接続が承認されるまで実装しない（lint でも禁止）。
//
// 守ること：
//   - ゲート判定（allowed=true）が無ければ取得関数を呼ばない
//   - 二重開始を拒否
//   - 途中で失敗したら、それまでに取れた track をすべて止める
//   - 画面共有の映像 track は使わないので直ちに止める。音声 track が無ければ失敗（タブ音声の共有忘れ）
//   - どれかの track が終了（共有停止など）したら全体を停止
//   - stop() で全 stream の全 track を stop()、リスナー解除、AbortSignal で後続処理を中止

export const CAPTURE_MODES = Object.freeze({
  'meet-tab-and-mic': { label: 'Meet タブの音声＋自分のマイク（デスクトップ Chrome）', needs: ['display', 'microphone'] },
  'room-mic': { label: '対面会議のマイク', needs: ['microphone'] },
});

export class CaptureError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
  }
}

/**
 * @param {{ acquire: { display?: () => Promise<any>, microphone?: () => Promise<any> },
 *   onStopped?: (info: { reason: string, stoppedTracks: number }) => void }} opts
 */
export function createCaptureSession({ acquire, onStopped = () => {} }) {
  /** @type {'idle'|'starting'|'capturing'|'stopped'} */
  let status = 'idle';
  /** @type {any[]} */
  let streams = [];
  /** @type {{ track: any, fn: () => void }[]} */
  let listeners = [];
  let abort = null;

  function allTracks() {
    return streams.flatMap((s) => s.getTracks());
  }

  function stop(reason = 'user') {
    if (status === 'idle' || status === 'stopped') return { stoppedTracks: 0 };
    let stoppedTracks = 0;
    for (const { track, fn } of listeners) track.removeEventListener('ended', fn);
    listeners = [];
    for (const t of allTracks()) {
      if (t.readyState !== 'ended') stoppedTracks += 1;
      t.stop();
    }
    streams = [];
    abort?.abort(new Error(`capture stopped: ${reason}`));
    status = 'stopped';
    onStopped({ reason, stoppedTracks });
    return { stoppedTracks };
  }

  return {
    /**
     * @param {{ mode: keyof typeof CAPTURE_MODES, gate: { allowed: boolean } }} req
     * @returns {Promise<{ audioTracks: any[], signal: AbortSignal }>}
     */
    async start({ mode, gate }) {
      if (!gate || gate.allowed !== true) throw new CaptureError('開始条件（有効化・設定・同意・開始操作）が揃っていません', 'gate');
      if (status !== 'idle') throw new CaptureError(status === 'stopped' ? 'この取得セッションは終了しています' : '既に開始しています', 'state');
      const spec = CAPTURE_MODES[mode];
      if (!spec) throw new CaptureError('未知のモードです', 'mode');
      for (const need of spec.needs) {
        if (typeof acquire?.[need] !== 'function') throw new CaptureError(`取得手段（${need}）が未設定です`, 'not-configured');
      }
      status = 'starting';
      abort = new AbortController();
      try {
        for (const need of spec.needs) {
          const stream = await acquire[need]();
          if (status !== 'starting') {
            // 取得待ちの間に停止された：今取れたものも止める
            for (const t of stream.getTracks()) t.stop();
            throw new CaptureError('開始中に停止されました', 'aborted');
          }
          streams.push(stream);
          if (need === 'display') {
            for (const v of stream.getVideoTracks()) v.stop();
            if (!stream.getAudioTracks().length) throw new CaptureError('タブの音声が共有されていません（「タブの音声も共有」を有効に）', 'no-tab-audio');
          } else if (!stream.getAudioTracks().length) {
            throw new CaptureError('マイクの音声トラックがありません', 'no-mic-audio');
          }
        }
      } catch (err) {
        if (status === 'starting') {
          status = 'capturing'; // stop() を有効にするため一時的に
          stop('start-failed');
        }
        throw err;
      }
      status = 'capturing';
      const audioTracks = streams.flatMap((s) => s.getAudioTracks());
      for (const track of allTracks()) {
        const fn = () => stop('track-ended');
        track.addEventListener('ended', fn);
        listeners.push({ track, fn });
      }
      return { audioTracks, signal: abort.signal };
    },
    stop,
    get status() { return status; },
    /** 取得中の track 数（テスト・表示用） */
    get liveTrackCount() { return allTracks().filter((t) => t.readyState !== 'ended').length; },
  };
}

/** Float32 [-1,1] を PCM16 little-endian に変換。 */
export function floatTo16BitPcm(samples) {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** 単純な平均による間引き（fromRate >= toRate）。 */
export function downsample(samples, fromRate, toRate) {
  if (toRate > fromRate) throw new RangeError('アップサンプリングは未対応です');
  if (toRate === fromRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}
