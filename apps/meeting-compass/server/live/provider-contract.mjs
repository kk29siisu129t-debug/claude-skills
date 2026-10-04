// ライブ経路のプロバイダ非依存インターフェース。
//
// ここには特定ベンダーの実装・イベント名・エンドポイントを一切書かない。
// 実接続アダプタは、公式仕様を確認でき、接続・秘密値・課金が承認された後に別ファイルで追加する。
// 現在このリポジトリに登録済みの実プロバイダは 0 件（PROVIDER_REGISTRY は空）。
//
// TranscriptionProvider（音声 → 確定した文字起こし）
//   id: string
//   open({ onFinal, onError, signal }) => Promise<{ appendAudio(pcm16: Uint8Array): void, close(): Promise<void> }>
//     onFinal({ segmentId: string, text: string })  … 確定（final）した区間だけを通知する。途中結果は渡さない
//     onError(err)                                   … 回復不能なエラー。セッション側で停止する
//     signal: AbortSignal                            … 停止時に abort される
//
// StructuringProvider（短い現在状態＋新しい発話 → 構造化 JSON）
//   id: string
//   structure({ input, schema, maxOutputTokens, signal }) =>
//     Promise<{ json: unknown, usage: { inputTokens: number, outputTokens: number } | null }>
//     json はモデル出力そのもので「信用しない」。必ず validateStructuring と applyStructuring を通す

export class ProviderNotConfiguredError extends Error {
  constructor(kind) {
    super(`${kind} プロバイダは未設定です（実接続アダプタは未実装）`);
    this.name = 'ProviderNotConfiguredError';
  }
}

/**
 * 登録済みプロバイダ。キーはプロバイダ名、値は { credentialEnv: string, create(): {...} }。
 * 方針により現時点では空。ここに追加するまでライブ経路は「未設定」のまま。
 * @type {Readonly<Record<string, { credentialEnv: string, create: () => any }>>}
 */
export const PROVIDER_REGISTRY = Object.freeze({});

export function assertTranscriptionProvider(p) {
  if (!p || typeof p.id !== 'string' || typeof p.open !== 'function') {
    throw new TypeError('TranscriptionProvider の形が不正です');
  }
  return p;
}

export function assertStructuringProvider(p) {
  if (!p || typeof p.id !== 'string' || typeof p.structure !== 'function') {
    throw new TypeError('StructuringProvider の形が不正です');
  }
  return p;
}

/** 未設定時の既定。呼ばれても何も送らず、必ず失敗する。 */
export const disabledTranscriptionProvider = Object.freeze({
  id: 'disabled',
  async open() { throw new ProviderNotConfiguredError('文字起こし'); },
});

export const disabledStructuringProvider = Object.freeze({
  id: 'disabled',
  async structure() { throw new ProviderNotConfiguredError('構造化'); },
});
