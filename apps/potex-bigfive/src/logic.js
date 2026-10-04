// @ts-check
/*
 * 支援の使い方の案に添える「理由」と、最後のまとめ文を作る純粋関数。
 * 根拠にするのは本人が明示した選択（テーマ・困りごと・好み・頻度）だけ。
 * 性格スコアは引数として受け取らない。
 */

/** @typedef {{ goals: string[], barriers: string[], time: string|null, prefs: string[], frequency: string|null }} Needs */

const PotexLogic = (() => {
  /** @returns {Needs} */
  function emptyNeeds() {
    return { goals: [], barriers: [], time: null, prefs: [], frequency: null };
  }

  /**
   * @param {'goals'|'barriers'|'time'|'prefs'|'frequency'} questionId
   * @param {string} choiceId
   */
  function choiceLabel(questionId, choiceId) {
    const q = PotexContent.NEEDS.find((n) => n.id === questionId);
    const c = q ? q.choices.find((x) => x.id === choiceId) : undefined;
    return c ? c.label : '';
  }

  /**
   * 各案につながる明示的な選択。[質問ID, 選択肢ID, 補足] の組。
   * @type {Record<string, ReadonlyArray<[ 'goals'|'barriers'|'prefs'|'frequency', string, string ]>>}
   */
  const LINKS = {
    coach: [
      ['prefs', 'review', ''],
      ['barriers', 'procrastinate', ''],
      ['barriers', 'start', '目標設計から一緒に整理できます。'],
      ['goals', 'habit', ''],
      ['frequency', 'daily', '頻度は契約内容によります。'],
      ['frequency', 'weekly', '頻度は契約内容によります。'],
    ],
    expert: [
      ['prefs', 'expert', ''],
      ['barriers', 'expertise', ''],
      ['goals', 'career', '対応できる担当者がいるかは確認が必要です。'],
      ['goals', 'business', '対応できる担当者がいるかは確認が必要です。'],
      ['goals', 'sns', '対応できる担当者がいるかは確認が必要です。'],
      ['goals', 'english', '対応できる担当者がいるかは確認が必要です。'],
    ],
    community: [
      ['prefs', 'materials', ''],
      ['prefs', 'peers', ''],
      ['prefs', 'solo', 'DeepWork など、一人で集中する使い方もできます。'],
      ['barriers', 'alone', '交流への参加は任意です。'],
      ['frequency', 'asneeded', ''],
    ],
  };

  const QUESTION_NAMES = {
    goals: '取り組みたいテーマ',
    barriers: '進めにくいこと',
    prefs: '支援の受け方の好み',
    frequency: '振り返りの間隔',
  };

  /**
   * 指定した案について、本人の選択とのつながりを文章で返す。
   * @param {string} routeId
   * @param {Needs} needs
   * @returns {string[]}
   */
  function reasonsFor(routeId, needs) {
    const links = LINKS[routeId] || [];
    /** @type {string[]} */
    const reasons = [];
    for (const [qid, cid, extra] of links) {
      const value = needs[qid];
      const selected = Array.isArray(value) ? value.includes(cid) : value === cid;
      if (!selected) continue;
      const base = `${QUESTION_NAMES[qid]}で「${choiceLabel(qid, cid)}」を選んでいます。`;
      reasons.push(extra ? `${base}${extra}` : base);
    }
    return reasons;
  }

  /**
   * 選べる「最初の小さな行動」。案を選んでいればその案の行動を先に出す。
   * @param {string|null} routeId
   */
  function actionsFor(routeId) {
    const route = PotexContent.ROUTES.find((r) => r.id === routeId);
    return route
      ? [...route.actions, ...PotexContent.GENERAL_ACTIONS]
      : [...PotexContent.GENERAL_ACTIONS];
  }

  /** @param {string|null} actionId */
  function actionLabel(actionId) {
    if (!actionId) return '';
    for (const route of PotexContent.ROUTES) {
      const a = route.actions.find((x) => x.id === actionId);
      if (a) return a.label;
    }
    const g = PotexContent.GENERAL_ACTIONS.find((x) => x.id === actionId);
    return g ? g.label : '';
  }

  /**
   * まとめ画面の文章。すべて本人の選択から組み立てる。
   * @param {{ routeId: string|null, actionId: string|null, needs: Needs }} input
   * @returns {{ headline: string, lines: string[], confirm: string[] }}
   */
  function buildSummary({ routeId, actionId, needs }) {
    const route = PotexContent.ROUTES.find((r) => r.id === routeId) || null;
    const action = actionLabel(actionId);
    const headline = action
      ? `次にあなたがすること：${action}。`
      : '次にすることは、まだ選んでいません。行動の画面で、いつでも選べます。';
    /** @type {string[]} */
    const lines = [];
    lines.push(
      route
        ? `選んだ支援の使い方は「${route.title}」です。あとから変えられます。`
        : '支援の使い方は、まだ決めていません。決めなくてもかまいません。',
    );
    if (needs.goals.length > 0) {
      const labels = needs.goals.map((g) => choiceLabel('goals', g)).filter(Boolean);
      lines.push(`取り組みたいテーマ：${labels.join('、')}。`);
    }
    if (needs.time) {
      lines.push(`1週間に使えそうな時間：${choiceLabel('time', needs.time)}。この時間で無理がないかを、始める前に確かめましょう。`);
    }
    if (needs.frequency) {
      lines.push(`続けやすそうな振り返りの間隔：${choiceLabel('frequency', needs.frequency)}。`);
    }
    lines.push('この行動は、あなた自身のペースで行うものです。相談や申し込みは必要ありません。');
    const confirm = route ? [...route.confirm] : [];
    return { headline, lines, confirm };
  }

  return Object.freeze({ emptyNeeds, reasonsFor, actionsFor, actionLabel, buildSummary, choiceLabel });
})();
