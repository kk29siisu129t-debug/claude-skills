// Claude Artifact 版の差し替え：閲覧画面はページからのダウンロードを止めるため、保存処理そのものを含めない。

export const DOWNLOAD_AVAILABLE = false;

export function download() {
  throw new Error('Artifact 版では書き出しは使えません');
}
