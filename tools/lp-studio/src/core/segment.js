// 日本語の見出しを「意味のまとまり（文節に近い単位）」に分ける。
// Intl.Segmenter('ja') は「終|わら|せ|ない」のように切るため、そのままでは使わない。
// 規則: ひらがな・記号だけの断片は前の塊に付ける／開きかっこは次の塊に付ける／句読点の後で塊を区切る。
// 指定の改行候補（headingPhrases）があればそれを優先し、無い・合わない場合だけこの推定を使う。

const OPEN = /^[「『（(［【〈《"']+$/;
const PUNCT_END = /[、。，．！？!?」』）)］】〉》]$/;
const ATTACH_PREV = /^[\p{Script=Hiragana}ー〜・ぁ-ゖ゛゜」』）)］】〉》、。，．！？!?…]+$/u;

let segmenter = null;
function words(text) {
  if (segmenter === null) {
    try { segmenter = new Intl.Segmenter('ja', { granularity: 'word' }); } catch { segmenter = false; }
  }
  if (!segmenter) return Array.from(text);
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

export function autoPhrases(text) {
  const src = String(text ?? '');
  if (!src) return [];
  const out = [];
  let cur = '';
  let pendingOpen = '';
  for (const w of words(src)) {
    if (OPEN.test(w)) {
      if (cur && PUNCT_END.test(cur) && !/[」』）)］】〉》]$/.test(cur)) { out.push(cur); cur = ''; }
      pendingOpen += w;
      continue;
    }
    const piece = pendingOpen + w;
    const hadOpen = !!pendingOpen;
    pendingOpen = '';
    if (!cur) { cur = piece; continue; }
    // 閉じ記号・句読点は必ず前に付ける
    if (/^[」』）)］】〉》、。，．！？!?…]+$/.test(w)) { cur += piece; continue; }
    // 句読点の後は新しい塊
    if (/[、。，．！？!?]$/.test(cur) || hadOpen) { out.push(cur); cur = piece; continue; }
    // ひらがな（助詞・活用語尾）は前に付ける
    if (ATTACH_PREV.test(w)) { cur += piece; continue; }
    // 前がひらがなで終わり、次が漢字・カタカナ・英数で始まる → 区切る
    if (/[\p{Script=Hiragana}」』]$/u.test(cur)) { out.push(cur); cur = piece; continue; }
    cur += piece;
  }
  cur += pendingOpen;
  if (cur) out.push(cur);
  return out;
}

/** 指定の改行候補が本文と一致していれば使う。一致しなければ推定にフォールバック（警告用に理由を返す） */
export function headingPhrases(heading, preferred) {
  const text = String(heading ?? '');
  if (Array.isArray(preferred) && preferred.length && preferred.join('') === text) return { phrases: preferred, source: 'preferred' };
  return { phrases: autoPhrases(text), source: preferred && preferred.length ? 'fallback-mismatch' : 'auto' };
}
