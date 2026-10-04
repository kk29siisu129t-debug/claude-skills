// 手入力プロバイダ：キーワード規則による簡易分類、またはユーザーが選んだ種類で項目を追加する。

import { classify, extractActionMeta } from '../core/rules.js';
import { KIND_LABELS, normalizeText, MAX_TEXT_LENGTH } from '../core/model.js';
import { assertProvider } from './contract.js';

export function createManualProvider({ session }) {
  const ensureTopic = (events) => {
    if (session.getState().currentTopicId) return;
    events.push({
      id: session.nextId('u'),
      type: 'topic.open',
      topicId: session.nextId('mt'),
      title: '論点未設定（手入力）',
      by: 'user',
    });
  };

  /**
   * @param {string} raw
   * @param {string} kind 'auto' | 'topic' | ItemKind
   * @returns {{ ok: boolean, message: string, results: any[], itemId?: string }}
   */
  function submit(raw, kind = 'auto') {
    const text = normalizeText(raw);
    if (!text) return { ok: false, message: '入力が空です。内容を入力してください。', results: [] };
    if (text.length > MAX_TEXT_LENGTH) return { ok: false, message: `${MAX_TEXT_LENGTH}文字以内で入力してください`, results: [] };

    /** @type {any[]} */
    const events = [];
    let message;
    let itemId;

    if (kind === 'auto') {
      const c = classify(text);
      if (!c.ok) return { ok: false, message: /** @type {{ message: string }} */ (c).message, results: [] };
      if (c.type === 'topic') {
        events.push({ id: session.nextId('u'), type: 'topic.open', topicId: session.nextId('mt'), title: c.title, by: 'rule' });
        message = `新しい論点「${c.title}」を開きました（「議題:」の書式による判定）`;
      } else {
        ensureTopic(events);
        itemId = session.nextId('m');
        const ruleNote = c.matched
          ? `キーワード「${c.matched}」による機械的な判定（意味は理解していません）`
          : 'どの規則にも当てはまらないため未分類。人による確認が必要です';
        events.push({
          id: session.nextId('u'),
          type: 'item.add',
          by: 'rule',
          item: { id: itemId, kind: c.kind, text: c.text, owner: c.owner, due: c.due, ruleNote },
        });
        message = c.kind === 'unclassified'
          ? '自動では分類できませんでした。「未分類（要確認）」に入れました'
          : `「${KIND_LABELS[c.kind]}」として追加（${ruleNote}）`;
        if (c.kind === 'decision') message += '。決定らしい語があっても仮案として扱います';
      }
    } else if (kind === 'topic') {
      events.push({ id: session.nextId('u'), type: 'topic.open', topicId: session.nextId('mt'), title: text, by: 'user' });
      message = `新しい論点「${text}」を開きました`;
    } else {
      if (!(kind in KIND_LABELS)) return { ok: false, message: '種類が不正です', results: [] };
      ensureTopic(events);
      itemId = session.nextId('m');
      const meta = kind === 'action' ? extractActionMeta(text) : { owner: null, due: null };
      events.push({
        id: session.nextId('u'),
        type: 'item.add',
        by: 'user',
        item: { id: itemId, kind, text, owner: meta.owner, due: meta.due },
      });
      message = `「${KIND_LABELS[kind]}」として追加しました`;
    }

    const results = events.map((ev) => session.dispatch(ev));
    const failed = results.find((r) => !r.ok);
    if (failed) return { ok: false, message: failed.message || '追加できませんでした', results };
    return { ok: true, message, results, itemId };
  }

  return assertProvider({
    id: 'manual',
    label: '手入力',
    kind: 'rule',
    sendsNetwork: false,
    honestyNote: '手入力はキーワード規則で機械的に仮分類します。意味の理解はしていません。分類できない場合は「未分類（要確認）」になります。',
    status: () => ({ state: 'ready', detail: '入力待ち' }),
    submit,
  });
}
