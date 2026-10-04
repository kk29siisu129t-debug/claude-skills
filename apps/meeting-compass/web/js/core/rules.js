// 手入力テキストのキーワードによる簡易分類。AI による理解ではない。
// 当てはまらなければ unclassified（人による確認待ち）にする。
// 「決定」らしい語があっても常に仮案扱い。確定はユーザー操作でのみ行う。

import { normalizeText, MAX_TEXT_LENGTH } from './model.js';

const RULES = [
  { kind: 'action', re: /(担当[:：]|やります|対応します|お願いします|引き受け|期限[:：])/ },
  { kind: 'next', re: /(次回|次に決め|あとで決め|後で決め|持ち越し)/ },
  { kind: 'decision', re: /(決定|決めました|確定|にしましょう|でいきましょう|で行きましょう|合意)/ },
  { kind: 'concern', re: /(懸念|心配|リスク|不安|問題(?:は|が)|難しい|反対)/ },
  { kind: 'tradeoff', re: /(トレードオフ|一方で|その代わり|代わりに|引き換え)/ },
  { kind: 'reason', re: /(なぜなら|理由|ためです|ので|だから)/ },
  { kind: 'proposal', re: /(提案|案として|してはどう|しませんか|どうでしょう|はどうか|したい)/ },
  { kind: 'open_question', re: /(\?|？|未定|分からない|わからない|要確認|確認が必要)/ },
];

const TOPIC_RE = /^(?:議題|話題|論点)\s*[:：]\s*(.*)$/s;
const OWNER_RE = /担当[:：]\s*([^\s、,，。]+)/;
const DUE_RE = /期限[:：]\s*([^\s、,，。]+)/;

/**
 * @param {string} raw
 * @returns {{ ok: false, message: string } | { ok: true, type: 'topic', title: string } |
 *   { ok: true, type: 'item', kind: string, text: string, matched: string|null, owner: string|null, due: string|null }}
 */
export function classify(raw) {
  const text = normalizeText(raw);
  if (!text) return { ok: false, message: '入力が空です' };
  if (text.length > MAX_TEXT_LENGTH) return { ok: false, message: `${MAX_TEXT_LENGTH}文字以内で入力してください` };

  const topic = text.match(TOPIC_RE);
  if (topic) {
    const title = normalizeText(topic[1]);
    if (!title) return { ok: false, message: '論点名が空です' };
    return { ok: true, type: 'topic', title };
  }

  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m) {
      const { owner, due } = rule.kind === 'action' ? extractActionMeta(text) : { owner: null, due: null };
      return { ok: true, type: 'item', kind: rule.kind, text, matched: m[1], owner, due };
    }
  }
  return { ok: true, type: 'item', kind: 'unclassified', text, matched: null, owner: null, due: null };
}

/** 「担当: X」「期限: Y」が明記されている場合だけ取り出す。推測はしない。 */
export function extractActionMeta(text) {
  return {
    owner: text.match(OWNER_RE)?.[1] ?? null,
    due: text.match(DUE_RE)?.[1] ?? null,
  };
}
