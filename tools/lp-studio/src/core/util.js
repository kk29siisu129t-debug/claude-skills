// 共通ユーティリティ。ブラウザと Node の両方で動く（依存なし）。

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"'`]/g, (c) => HTML_ESCAPES[c]);
}

// 制御文字（改行・タブ以外）を除去
export function stripControl(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, '');
}

const ALLOWED_SCHEMES = new Set(['https:', 'mailto:', 'tel:']);

/**
 * URL を正規化して allowlist で判定する。許可しないものは null。
 * 許可: https: / mailto: / tel: / ページ内アンカー #id
 */
export function safeUrl(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > 2048) return null;
  // 制御文字・空白を含むものは正規化前に拒否（"java\tscript:" 等）
  if (/[\u0000-\u0020\u007F-\u009F\u2028\u2029]/.test(raw)) return null;
  if (raw.startsWith('#')) return /^#[A-Za-z][\w-]{0,63}$/.test(raw) ? raw : null;
  if (raw.startsWith('//') || raw.startsWith('\\')) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null; // 相対パスは許可しない
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) return null;
  if (url.protocol === 'https:' && (!url.hostname || url.username || url.password)) return null;
  return url.href;
}

export function safeColor(input) {
  return typeof input === 'string' && /^#[0-9a-fA-F]{6}$/.test(input) ? input.toLowerCase() : null;
}

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const h = safeColor(hex);
  if (!h) return null;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return 0;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

// 背景色に対して読める文字色（白 or 黒系）
export function readableOn(bg) {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111111') ? '#ffffff' : '#111111';
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

let idCounter = 0;
export function makeId(prefix = 'id') {
  idCounter = (idCounter + 1) % 1e6;
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}-${rand}${idCounter.toString(36)}`.slice(0, 40);
}

// ---- sha256（CSP の script hash 用。同期で使うため自前実装） ----
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Bytes(bytes) {
  const len = bytes.length;
  const bitLenHi = Math.floor((len * 8) / 0x100000000);
  const bitLenLo = (len * 8) >>> 0;
  const padded = new Uint8Array((((len + 9 + 63) >> 6) << 6));
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLenHi);
  dv.setUint32(padded.length - 4, bitLenLo);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

export function sha256Base64(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = sha256Bytes(bytes);
  let bin = '';
  for (const b of digest) bin += String.fromCharCode(b);
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

// fg を bg に対して minRatio 以上になるまで黒方向へ寄せる（ブランド色の文字用）
export function inkFor(fg, bg, minRatio = 4.5) {
  let c = safeColor(fg);
  if (!c) return '#111111';
  const rgb = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  for (let step = 0; step <= 20; step++) {
    const k = 1 - step * 0.05;
    const hex = '#' + rgb.map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('');
    if (contrastRatio(hex, bg) >= minRatio) return hex;
  }
  return '#111111';
}

export function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 承認と内容を対応づける hash（v2: 役割・見出し・本文・項目・図解・CTA・参照） */
export function sectionHash(s) {
  if (s.role) {
    return sha256Base64(JSON.stringify([s.role, s.heading || '', s.headingPhrases || [], s.body || '', s.note || '', s.items || [], s.visual || null, s.cta || null, s.commercialPreview || null, s.sourceRefs || [], s.media ? { ...s.media, dataUri: s.media.dataUri ? sha256Base64(s.media.dataUri) : '' } : null, ...(s.sub ? [s.sub] : [])]));
  }
  const f = s.fields || {};
  return sha256Base64(JSON.stringify([s.type, f.heading || '', f.lead || '', f.body || '', f.note || '', f.items || [], f.itemsAlt || [], s.claimRefs || []]));
}

/** 根拠の検証と内容を対応づける hash（主張・出典・数値） */
export function evidenceHash(e) {
  return sha256Base64(JSON.stringify([e.claim || '', e.source || '', e.sourceType || e.kind || '', e.reality || '', e.metricValue ?? null, e.metricUnit || '']));
}
