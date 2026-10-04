// 明示操作時にだけ使う書き出し。生成した文字列を返すだけで、送信・保存はしない。

export const EXPORT_NOTICE = 'Meeting Compass プロトタイプの書き出し。台本デモ（事前に用意した構造イベント）と手での整理に由来し、AIによる会議理解の結果ではありません。';

export function toJSON(state, exportedAt) {
  return JSON.stringify({
    app: 'meeting-compass',
    format: 2,
    exportedAt,
    notice: EXPORT_NOTICE,
    rootIds: state.rootIds,
    nodes: state.nodes,
    log: state.log,
  }, null, 2);
}

/** Markdown として誤って HTML 解釈されないよう、山括弧などを実体参照にする。 */
export function escapeMarkdownText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]#|])/g, '\\$1')
    .replace(/\r?\n/g, ' ');
}

/** 階層アウトラインを入れ子の箇条書きにする。訂正があったノードには履歴件数を添える。 */
export function toMarkdown(state, exportedAt) {
  const e = escapeMarkdownText;
  const lines = ['# 会議のアウトライン', '', `> ${EXPORT_NOTICE}`, `> 書き出し: ${exportedAt}`, ''];
  const walk = (ids, depth) => {
    for (const id of ids) {
      const n = state.nodes[id];
      const label = n.label ? `［${e(n.label)}］` : '';
      const fixes = n.history.length > 1 ? `（訂正 ${n.history.length - 1}件）` : '';
      lines.push(`${'  '.repeat(depth)}- ${label}${e(n.text)}${fixes}`);
      walk(n.childIds, depth + 1);
    }
  };
  if (!state.rootIds.length) lines.push('- （まだありません）');
  walk(state.rootIds, 0);
  return lines.join('\n');
}
