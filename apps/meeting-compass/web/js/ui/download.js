// 明示操作時だけ、この端末にファイルを保存させる（外部送信はしない）。
// Claude Artifact 版では scripts/artifact-stubs/download.js に差し替わり、このコードはバンドルに入らない。

import { h } from './dom.js';

export const DOWNLOAD_AVAILABLE = true;

export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = /** @type {HTMLAnchorElement} */ (h('a', { 'data-download': filename }));
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
