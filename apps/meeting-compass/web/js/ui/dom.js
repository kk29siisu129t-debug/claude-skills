// 小さな DOM ヘルパ。データは必ず textContent / 属性として入れ、HTML 文字列は組み立てない。

/**
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {(Node|string|null|undefined|false)[]} [children]
 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('data-') || k.startsWith('aria-') || ['type', 'name', 'value', 'role', 'title', 'for', 'id', 'rows', 'maxlength', 'placeholder', 'autocomplete'].includes(k)) {
      el.setAttribute(k, v === true ? '' : String(v));
    } else if (k === 'hidden' || k === 'disabled' || k === 'open' || k === 'selected') {
      el[k] = !!v;
    } else {
      throw new Error(`h(): 許可していない属性 ${k}`);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/**
 * キー付きの差分更新。既存要素は再利用し、順序だけ合わせる。
 * render(el, item, isNew) は、内容が変わったときだけ中身を作り直す責任を持つ。
 * @template T
 * @param {HTMLElement} list
 * @param {T[]} items
 * @param {(item: T) => string} key
 * @param {(el: HTMLElement, item: T, isNew: boolean) => void} render
 * @param {string} [tag]
 */
export function reconcile(list, items, key, render, tag = 'li') {
  /** @type {Map<string, HTMLElement>} */
  const existing = new Map();
  for (const child of Array.from(list.children)) {
    if (child instanceof HTMLElement && child.dataset.key) existing.set(child.dataset.key, child);
  }
  /** @type {ChildNode|null} */
  let prev = null;
  for (const item of items) {
    const k = key(item);
    let el = existing.get(k);
    const isNew = !el;
    if (!el) {
      el = document.createElement(tag);
      el.dataset.key = k;
    }
    existing.delete(k);
    render(el, item, isNew);
    const ref = prev ? prev.nextSibling : list.firstChild;
    if (ref !== el) list.insertBefore(el, ref);
    prev = el;
  }
  for (const el of existing.values()) el.remove();
}

/** 変更があった要素を少しの間ハイライトする（reduced-motion は CSS 側で無効化）。 */
export function flash(el, cls = 'flash') {
  el.classList.remove(cls);
  // reflow でアニメーションを再始動
  void el.offsetWidth;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), 2400);
}
