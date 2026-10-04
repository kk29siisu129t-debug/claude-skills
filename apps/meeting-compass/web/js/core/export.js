// 明示操作時にだけ使う書き出し。生成した文字列を返すだけで、送信・保存はしない。

import { KIND_LABELS, STATUS_LABELS, ORIGIN_LABELS } from './model.js';

export const EXPORT_NOTICE = 'Meeting Compass プロトタイプの書き出し。デモ台本・キーワード規則・ユーザー入力に由来し、AIによる会議理解の結果ではありません。';

export function toJSON(state, exportedAt) {
  return JSON.stringify({
    app: 'meeting-compass',
    format: 1,
    exportedAt,
    notice: EXPORT_NOTICE,
    currentTopicId: state.currentTopicId,
    topics: state.topics,
    items: state.items,
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

export function toMarkdown(state, exportedAt) {
  const e = escapeMarkdownText;
  const lines = [`# 会議の構造メモ`, '', `> ${EXPORT_NOTICE}`, `> 書き出し: ${exportedAt}`, ''];
  for (const topic of state.topics) {
    const cur = topic.id === state.currentTopicId ? '（最後の論点）' : '';
    lines.push(`## ${e(topic.title)}${topic.digression ? '（脱線）' : ''}${cur}`, '');
    const items = state.items.filter((i) => i.topicId === topic.id);
    if (!items.length) lines.push('- （項目なし）');
    for (const i of items) {
      const meta = [STATUS_LABELS[i.status], ORIGIN_LABELS[i.origin]];
      if (i.kind === 'action') meta.push(`担当: ${e(i.owner || '不明')}`, `期限: ${e(i.due || '不明')}`);
      if (i.consensus?.kind === 'unverified') meta.push('合意未確認');
      lines.push(`- **${KIND_LABELS[i.kind]}** ${e(i.text)}（${meta.join(' / ')}）`);
      for (const h of i.history.slice(1)) {
        lines.push(`  - 履歴#${h.seq} ${h.change}${h.reason ? `: ${e(h.reason)}` : ''}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
