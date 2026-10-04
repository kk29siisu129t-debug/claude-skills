// ライブ経路の設定と開始ゲート。既定は厳密に無効。
//
// 開始できるのは次の4条件がすべて揃ったときだけ：
//   1. サーバー環境変数で明示的に有効化（MC_LIVE_ENABLED=1）
//   2. 登録済みプロバイダが選ばれ、その資格情報がサーバー環境変数に「存在する」
//      （値は読まない・返さない・ログに出さない。存在の有無だけを見る）
//   3. 利用者が会議参加者への告知と外部処理への同意を確認した
//   4. 利用者が明示的に開始操作をした
// 加えて、待ち受けがループバック（127.0.0.1 / ::1 / localhost）以外なら無効にする。

import { PROVIDER_REGISTRY } from './provider-contract.mjs';

export const CONSENT_VERSION = 1;

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export const DEFAULT_LIMITS = Object.freeze({
  maxSessionMs: 60 * 60 * 1000,
  maxAudioMs: 60 * 60 * 1000,
  maxStructuringRequests: 120,
  maxInputTokensPerRequest: 4000,
  maxOutputTokensPerRequest: 800,
  maxTotalTokens: 120 * (4000 + 800),
  requestTimeoutMs: 20_000,
  batchMaxMs: 30_000,
  batchMaxChars: 1200,
});

/**
 * @param {Record<string, string|undefined>} env
 * @param {{ host?: string, registry?: Record<string, { credentialEnv: string }> }} [opts]
 */
export function loadLiveConfig(env, { host = '127.0.0.1', registry = PROVIDER_REGISTRY } = {}) {
  const reasons = [];
  const enabledByEnv = env.MC_LIVE_ENABLED === '1';
  if (!enabledByEnv) reasons.push('サーバー設定で無効（MC_LIVE_ENABLED=1 ではない）');
  const loopback = LOOPBACK.has(host);
  if (!loopback) reasons.push('ループバック以外で待ち受けているため無効');
  const providerName = env.MC_LIVE_PROVIDER || '';
  const entry = Object.prototype.hasOwnProperty.call(registry, providerName) ? registry[providerName] : null;
  if (!entry) reasons.push(providerName ? `未登録のプロバイダです: ${providerName}` : 'プロバイダ未選択（登録済みプロバイダは0件）');
  // 資格情報は「存在するか」だけ。値はどこにも保持・返却しない
  const credentialPresent = !!entry && Object.prototype.hasOwnProperty.call(env, entry.credentialEnv) && env[entry.credentialEnv] !== '';
  if (entry && !credentialPresent) reasons.push('サーバー側の資格情報が未設定');
  return Object.freeze({
    enabled: enabledByEnv && loopback,
    providerName: entry ? providerName : null,
    providerConfigured: !!entry && credentialPresent,
    reasons: Object.freeze(reasons),
    limits: DEFAULT_LIMITS,
  });
}

/** ブラウザに返してよい公開状態（真偽値と理由だけ）。 */
export function publicStatus(config) {
  return {
    enabled: config.enabled,
    providerConfigured: config.providerConfigured,
    ready: config.enabled && config.providerConfigured,
    reasons: [...config.reasons],
  };
}

export function validateConsent(consent) {
  return !!consent
    && consent.version === CONSENT_VERSION
    && consent.participantsNotified === true
    && consent.externalProcessingAccepted === true;
}

/**
 * @returns {{ allowed: boolean, reasons: string[] }}
 */
export function evaluateGate({ config, consent, startRequested }) {
  const reasons = [...config.reasons];
  if (!validateConsent(consent)) reasons.push('会議参加者への告知・外部処理への同意が確認されていません');
  if (startRequested !== true) reasons.push('開始操作がありません');
  const allowed = config.enabled && config.providerConfigured && validateConsent(consent) && startRequested === true;
  return { allowed, reasons: allowed ? [] : reasons };
}
