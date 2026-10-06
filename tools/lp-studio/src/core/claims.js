// 主張の検出器（数値・最上級・保証・煽り・権威・推薦・オファー・薬機法・参考LP固有値）と照合の道具。
// 判定は canon()（NFKC・書式文字・結合文字・空白を除去）した文字列に対して行う。
// どの主張が裏づけられているかの判断は editorial.js が参照IDつきで行う。


// 参考LP固有のオファー・実績値。別ブランドへの転用を止める。
export const REFERENCE_DENYLIST = [
  '3日間', '三日間', '月100人', '100人限定', '先着100', '受講生1140', '1140人', '1,140人', '1140名', '1,140名',
];

// 判定は canon()（NFKC・ゼロ幅/書式文字と空白を除去）した文字列に対して行う。
// 「3​日間」「保 証」「Ｎｏ．１」のような言い換え・混入ですり抜けないため。
const KANJI_NUM = '〇零一二三四五六七八九十百千万億壱弐参';
const UNITS = '(?:万|億)?(?:人|名|社|件|%|％|割|倍|円|年|ヶ月|か月|カ月|日間|日|時間|分|位|回|点|校|店舗|都道府県|キロ|kg|cm)';
const PATTERNS = [
  { category: 'number', label: '数値の主張', re: new RegExp(`[0-9][0-9.]*${UNITS}`, 'g') },
  { category: 'number', label: '数値の主張（漢数字）', re: new RegExp(`[${KANJI_NUM}]+${UNITS}`, 'g') },
  { category: 'superlative', label: '最上級・比較', re: /((?<![A-Za-z])No\.?1|ナンバーワン|ナンバー1|日本一|世界一|業界初|業界最|世界初|国内初|最高|最強|最安|最大級|唯一|圧倒的|他社より|どこよりも|トップクラス|1位)/gi },
  { category: 'guarantee', label: '保証・断定', re: /(保証|絶対|必ず|確実に|確実な|100%|誰でも|リスクなし|ノーリスク|失敗しない|返金|間違いなく|約束します)/g },
  { category: 'urgency', label: '煽り・限定', re: /(今だけ|いまだけ|残りわずか|期間限定|限定|先着|締切間近|締め切り|〆切|本日[0-9:時]*まで|今日中|今日まで|今週まで|[0-9]+:[0-9]+まで|急いで|最後のチャンス|今すぐ|お見逃しなく)/g },
  { category: 'authority', label: '権威', re: /(医師|専門家|教授|博士|弁護士|税理士|会計士|監修|推奨|認定|受賞|公式|メディア掲載|特許|著名|有名人|芸能人|インフルエンサー|大学(?:の研究|と共同|発|教員|講師)|(?:テレビ|TV|雑誌|新聞|番組|ラジオ|メディア)(?:で|に)?(?:出演|紹介|掲載|特集|放送|話題))/g },
  { category: 'testimonial', label: '推薦・お客様の声', re: /(お客様の声|受講生の声|利用者の声|体験談|口コミ|クチコミ|満足度|推薦|喜びの声|[0-9]0代|[0-9]+歳|[A-Za-z一-龥ぁ-んァ-ヶー]{1,8}(?:さん|様|氏)[(（「]|人生が変わ)/g },
  { category: 'offer', label: 'オファー・価格', re: /(無料|無償|タダ|0円|ゼロ円|(?:費|料|代)(?:は)?ゼロ|割引|半額|特典|通常価格|定価|キャンペーン|プレゼント|(?<![A-Za-z{])OFF(?![A-Za-z]))/g },
];

const PHARMA = { category: 'pharma', label: '薬機法（効能効果）', re: /(治る|治す|治療|改善する|改善します|痩せる|やせる|効く|効きます|効果がある|若返|シミが消え|アンチエイジング|デトックス|免疫|副作用なし)/g };

// 書式文字（ゼロ幅・ソフトハイフン等）
const FORMAT_CHARS = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;

/** 判定用の正規形: NFKC → 書式文字・空白・桁区切りを除去 */
export function canon(text) {
  return String(text ?? '').normalize('NFKC').replace(FORMAT_CHARS, '').replace(/\p{M}/gu, '').replace(/[\s,]/g, '');
}
export const normalize = canon;

// 参考LP固有値。canon 後に照合する
const REFERENCE_PATTERNS = [
  /3日間|三日間|3日で|三日で/, /月100人|100人限定|先着100|100名限定/, /1140(?:人|名)|千百四十(?:人|名)|受講(?:生|者)1140/,
];

// 数の主張ではない漢数字の熟語（過検出を防ぐ）
const KANJI_IDIOMS = /(?<!たった|わずか|約|およそ|最短|最低|毎日|毎晩)十分(?=な|に|だ|です|では|すぎ|過ぎ|とは|か)|充分|一人で|一人ひとり|一人一人|一人前|二人三脚|三日坊主|一度|一緒|一番|一日中|一年中|一回り|一方|一部|一人ずつ|百人力|千差万別|一石二鳥|三々五々|四六時中|十人十色|一生懸命|一歩|一言|一目|一気|一通り|一時|一旦|一応|一切/g;

export function detectClaims(text, category = 'general') {
  const s = canon(text).replace(KANJI_IDIOMS, (m) => '・'.repeat(m.length));
  const found = [];
  const pats = ['health', 'beauty'].includes(category) ? [...PATTERNS, PHARMA] : PATTERNS;
  for (const p of pats) {
    for (const m of s.matchAll(p.re)) {
      found.push({ category: p.category, label: p.label, match: m[0], severity: p.category === 'pharma' ? 'block' : 'needs-evidence' });
    }
  }
  for (const re of REFERENCE_PATTERNS) {
    const m = s.match(re);
    if (m) found.push({ category: 'reference', label: '参考LP固有の値', match: m[0], severity: 'block' });
  }
  for (const d of REFERENCE_DENYLIST) {
    if (s.includes(canon(d)) && !found.some((f) => f.category === 'reference')) {
      found.push({ category: 'reference', label: '参考LP固有の値', match: d, severity: 'block' });
    }
  }
  return found;
}

/**
 * 根拠の数値（と単位）が主張文に組で含まれるか。単位 'X/Y' は先頭 X で照合（例: 日/週 → 「4.2日」）。
 */
export function metricMatches(claim, value, unit = '') {
  if (value == null) return true;
  const [x, per] = String(unit || '').split('/');
  if (!per) return containsToken(claim, `${value}${x}`);
  // 「/Y」付きの単位は、同じ数値の直前に「Y」「毎Y」「1Yあたり」「Yに」等があること（例: 週4.2日、1日あたり30分）
  const P = per === '週' ? ['週', '毎週', '1週あたり', '1週間あたり', '週に', '1週間に', '週平均', '週あたり'] : ['日', '毎日', '1日あたり', '1日に', '日に', '日平均', '日あたり'];
  return P.some((p) => containsToken(claim, `${p}${value}${x}`)) || containsToken(claim, `${value}${x}/${per}`);
}

/**
 * hay の中に needle がトークンとして含まれるか。数値で始まる needle は、直前が数字・小数点なら不一致
 * （「91%」が「1%」を裏付けない）。
 */
export function containsToken(hay, needle) {
  const h = canon(hay);
  const n = canon(needle);
  if (!n) return false;
  let i = h.indexOf(n);
  while (i >= 0) {
    const prev = h[i - 1];
    const next = h[i + n.length];
    const NUM = /[0-9.〇零一二三四五六七八九十百千万億]/;
    const startsNumeric = NUM.test(n[0]);
    const endsNumeric = NUM.test(n[n.length - 1]);
    const prevOk = !startsNumeric || !prev || !NUM.test(prev);
    const nextOk = !endsNumeric || !next || !NUM.test(next);
    if (prevOk && nextOk) return true;
    i = h.indexOf(n, i + 1);
  }
  return false;
}

export const PLACEHOLDER_RE = /【(?:要記入|未入力|不明な差込)[^】]*】/;
