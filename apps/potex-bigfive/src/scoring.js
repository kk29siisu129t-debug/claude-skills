// @ts-check
/*
 * Mini-IPIP（20項目）の項目を参考に、独自の日本語訳と4択形式に変えた簡易分析の採点ロジック。
 * 原版の5段階ではなく 1〜4 の4択で答える独自形式で、標準版 Mini-IPIP の得点とは比較できない。
 * DOM や保存領域には一切触れない純粋関数のみ。
 * 項目の符号（+ / 逆）と因子記号は内部データで、画面には表示しない。
 */

/** @typedef {'E'|'A'|'C'|'N'|'O'} FactorKey */
/** @typedef {{ no: number, factor: FactorKey, keyed: 1|-1, text: string }} Item */

const PotexScoring = (() => {
  /** @type {ReadonlyArray<Item>} */
  const ITEMS = Object.freeze(/** @type {Item[]} */ ([
    { no: 1, factor: 'E', keyed: 1, text: '人の集まりでは、場を盛り上げる。' },
    { no: 2, factor: 'A', keyed: 1, text: '他の人の気持ちに共感する。' },
    { no: 3, factor: 'C', keyed: 1, text: '日々の用事をすぐに片づける。' },
    { no: 4, factor: 'N', keyed: 1, text: '気分がよく変わる。' },
    { no: 5, factor: 'O', keyed: 1, text: '生き生きとした想像をする。' },
    { no: 6, factor: 'E', keyed: -1, text: 'あまり話さない。' },
    { no: 7, factor: 'A', keyed: -1, text: '他の人にあまり関心がない。' },
    { no: 8, factor: 'C', keyed: -1, text: '物を元の場所に戻すのをよく忘れる。' },
    { no: 9, factor: 'N', keyed: -1, text: 'たいていリラックスしている。' },
    { no: 10, factor: 'O', keyed: -1, text: '抽象的な考えを理解するのが難しい。' },
    { no: 11, factor: 'E', keyed: 1, text: '人の集まりでは、いろいろな人と話す。' },
    { no: 12, factor: 'A', keyed: 1, text: '他の人の感情を自分も感じる。' },
    { no: 13, factor: 'C', keyed: 1, text: '物事が整っているのが好きだ。' },
    { no: 14, factor: 'N', keyed: 1, text: 'すぐに動揺する。' },
    { no: 15, factor: 'O', keyed: -1, text: '抽象的な考えに関心がない。' },
    { no: 16, factor: 'E', keyed: -1, text: '目立たないようにしている。' },
    { no: 17, factor: 'A', keyed: -1, text: '他の人が抱える問題に関心がない。' },
    { no: 18, factor: 'C', keyed: -1, text: '物を散らかしてしまう。' },
    { no: 19, factor: 'N', keyed: -1, text: '気分が沈むことはめったにない。' },
    { no: 20, factor: 'O', keyed: -1, text: '想像力が豊かなほうではない。' },
  ]).map((item) => Object.freeze(item)));

  /** @type {ReadonlyArray<FactorKey>} */
  const FACTOR_ORDER = Object.freeze(['E', 'A', 'C', 'N', 'O']);

  /** 各因子に属する項目番号（1始まり）。 */
  const FACTOR_ITEMS = Object.freeze({
    E: Object.freeze([1, 6, 11, 16]),
    A: Object.freeze([2, 7, 12, 17]),
    C: Object.freeze([3, 8, 13, 18]),
    N: Object.freeze([4, 9, 14, 19]),
    O: Object.freeze([5, 10, 15, 20]),
  });

  const SCALE_MIN = 1;
  const SCALE_MAX = 4;
  const ITEM_COUNT = 20;

  /**
   * 1つの回答値が「1〜4の整数」かどうか。
   * 旧形式の 5、文字列 "3"、2.5、NaN、null、undefined はすべて不正。
   * @param {unknown} value
   * @returns {value is number}
   */
  function isValidAnswer(value) {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= SCALE_MIN &&
      value <= SCALE_MAX
    );
  }

  /**
   * 20問すべての回答を検証する。
   * @param {unknown} responses 項目1〜20の回答を順に並べた配列
   * @returns {{ ok: boolean, missing: number[], invalid: number[], message: string }}
   */
  function validateResponses(responses) {
    if (!Array.isArray(responses) || responses.length !== ITEM_COUNT) {
      return {
        ok: false,
        missing: [],
        invalid: [],
        message: `回答は${ITEM_COUNT}問分が必要です。`,
      };
    }
    /** @type {number[]} */
    const missing = [];
    /** @type {number[]} */
    const invalid = [];
    for (let i = 0; i < ITEM_COUNT; i += 1) {
      // 疎配列の穴も未回答として扱う
      const value = i in responses ? responses[i] : undefined;
      if (value === null || value === undefined) {
        missing.push(i + 1);
      } else if (!isValidAnswer(value)) {
        invalid.push(i + 1);
      }
    }
    const ok = missing.length === 0 && invalid.length === 0;
    let message = '';
    if (missing.length > 0) {
      message = `未回答の質問があります（${missing.join('、')}）。`;
    } else if (invalid.length > 0) {
      message = `1〜4の整数ではない回答があります（${invalid.join('、')}）。`;
    }
    return { ok, missing, invalid, message };
  }

  /**
   * 項目の採点値。逆転項目は 5 − 回答（1↔4、2↔3）。
   * @param {Item} item
   * @param {number} answer
   */
  function itemScore(item, answer) {
    return item.keyed === 1 ? answer : SCALE_MAX + SCALE_MIN - answer;
  }

  /**
   * 5因子の得点（各4項目の平均、1〜4の連続値）を返す。
   * 検証に通らない入力では例外を投げ、部分的な結果は返さない。
   * @param {unknown} responses
   * @returns {Readonly<Record<FactorKey, number>>}
   */
  function scoreResponses(responses) {
    const check = validateResponses(responses);
    if (!check.ok) {
      throw new RangeError(check.message);
    }
    const answers = /** @type {number[]} */ (responses);
    /** @type {Record<FactorKey, number>} */
    const result = { E: 0, A: 0, C: 0, N: 0, O: 0 };
    for (const factor of FACTOR_ORDER) {
      const nos = FACTOR_ITEMS[factor];
      let sum = 0;
      for (const no of nos) {
        sum += itemScore(ITEMS[no - 1], answers[no - 1]);
      }
      result[factor] = sum / nos.length;
    }
    return Object.freeze(result);
  }

  /**
   * 表示用の数値文字列（小数第2位まで）。4項目平均は 0.25 刻み。
   * @param {number} score
   */
  function formatScore(score) {
    return score.toFixed(2);
  }

  return Object.freeze({
    ITEMS,
    FACTOR_ORDER,
    FACTOR_ITEMS,
    SCALE_MIN,
    SCALE_MAX,
    ITEM_COUNT,
    isValidAnswer,
    validateResponses,
    scoreResponses,
    formatScore,
  });
})();
