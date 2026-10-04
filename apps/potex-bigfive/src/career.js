// @ts-check
/*
 * キャリアの整理（希望する働き方・関心のある職能・経験の自己申告）と、
 * 本人が比べながら考えるための「目標ルートの例」。
 *
 * - ここの関数は性格スコアを受け取らない。根拠は本人が選んだ希望・職能・経験だけ。
 * - 実際の昇進予測・適性判定・採用評価ではない。年齢・収入・健康情報は扱わない。
 * - 退職や契約など、大きな決断は勧めない。
 */

/** @typedef {'A'|'B'|'C'} PathId */
/** @typedef {{ style: string|null, functions: string[], experience: Record<string, string>, evidence: Record<string, string> }} Career */
/** @typedef {{ id: string, label: string }} CareerChoice */
/**
 * @typedef {{
 *   id: PathId,
 *   title: string,
 *   summary: string,
 *   stages: ReadonlyArray<{ stage: string, roles: ReadonlyArray<string> }>,
 *   linked: ReadonlyArray<string>,
 *   unknowns: ReadonlyArray<string>,
 *   action: CareerChoice,
 * }} CareerPath
 */

const PotexCareer = (() => {
  /** 希望する働き方。path は対応する道すじ（「まだ決めない」は null）。 */
  const WORK_STYLES = Object.freeze([
    { id: 'build', label: '事業づくりや独立も検討したい', path: /** @type {PathId|null} */ ('A') },
    { id: 'org', label: '組織の中で経営の責任を広げたい', path: /** @type {PathId|null} */ ('B') },
    { id: 'expert', label: '専門性を深めたい', path: /** @type {PathId|null} */ ('C') },
    { id: 'undecided', label: 'まだ決めない', path: /** @type {PathId|null} */ (null) },
  ]);

  /** @type {ReadonlyArray<CareerChoice>} */
  const FUNCTIONS = Object.freeze([
    { id: 'planning', label: '課題整理・企画' },
    { id: 'sales', label: '提案・営業' },
    { id: 'execution', label: '実行・プロジェクト推進' },
    { id: 'analysis', label: '分析・改善' },
    { id: 'technical', label: '専門技術' },
  ]);

  /** @type {ReadonlyArray<CareerChoice>} */
  const EXPERIENCE = Object.freeze([
    { id: 'none', label: '未経験' },
    { id: 'learned', label: '学んだ' },
    { id: 'assisted', label: '支援付きで実施' },
    { id: 'solo', label: '自力で実施し、成果を説明できる' },
  ]);

  /** @type {ReadonlyArray<CareerChoice>} */
  const EVIDENCE = Object.freeze([
    { id: 'work', label: '学習作品' },
    { id: 'once', label: '仕事や活動で1回試した' },
    { id: 'multiple', label: '複数回試した' },
    { id: 'feedback', label: '他者から具体的なフィードバックあり' },
    { id: 'none', label: 'まだ根拠なし' },
  ]);

  /** @type {ReadonlyArray<CareerPath>} 並び順は固定。 */
  const PATHS = Object.freeze([
    {
      id: 'A',
      title: '事業づくり・独立も検討する',
      summary: '事業を形にする役割から、事業の責任や経営に近づいていく道すじの例です。独立はこの道すじの手段のひとつで、組織の中で事業をつくる進み方もあります。',
      stages: [
        { stage: '入口', roles: ['企画・事業支援担当'] },
        { stage: '経験を広げる', roles: ['事業責任者'] },
        { stage: '責任を担う', roles: ['経営メンバー', '創業者・代表'] },
        { stage: '長期の選択', roles: ['事業オーナー', '承継後の顧問'] },
      ],
      linked: ['planning', 'sales', 'execution'],
      unknowns: [
        '独立したい気持ちと、独立の準備ができているかは別のことです。お金・お客さま・生活面の準備は、時間をかけて確かめる必要があります。',
        '事業の企画から実行までを、最後まで担った経験があるか。',
      ],
      action: { id: 'A-onepager', label: '身近な事業の課題を1つ選び、改善案を1枚にまとめる' },
    },
    {
      id: 'B',
      title: '組織の中で経営責任を広げる',
      summary: '任される仕事やチームの範囲を、組織の中で段階的に広げていく道すじの例です。',
      stages: [
        { stage: '入口', roles: ['総合職・企画担当'] },
        { stage: '経験を広げる', roles: ['課長相当'] },
        { stage: '責任を担う', roles: ['部長相当', '事業部長'] },
        { stage: '長期の選択', roles: ['本部長・執行役員', '顧問'] },
      ],
      linked: ['planning', 'execution', 'analysis'],
      unknowns: [
        '人をまとめ、チームの成果に責任を持つ役割を担いたいか。',
        '今の仕事や活動の中で、任される範囲を広げる余地があるか。',
      ],
      action: { id: 'B-scope', label: '今の仕事や活動で、任されている範囲と、次に広げたい範囲を書き出す' },
    },
    {
      id: 'C',
      title: '専門性を深める',
      summary: 'ひとつの専門領域を深め、上の段階の専門家として力を発揮していく道すじの例です。',
      stages: [
        { stage: '入口', roles: ['専門職'] },
        { stage: '経験を広げる', roles: ['シニア'] },
        { stage: '責任を担う', roles: ['リード／プリンシパル', 'チーフ・上席'] },
        { stage: '長期の選択', roles: ['フェロー級', '現役の専門家・顧問'] },
      ],
      linked: ['technical', 'analysis'],
      unknowns: [
        'どの専門領域を深めたいか。',
        '専門性を組織の中で活かすか、組織の外で活かすか。組織の中でも専門性は活かせます。',
      ],
      action: { id: 'C-research', label: '深めたい専門領域で、一つ上の段階の人の仕事内容を公開情報で調べる' },
    },
  ]);

  /** どの道すじでも使える小さな検証行動。 */
  const COMMON_ACTIONS = Object.freeze([
    { id: 'reflect', label: 'これまでの仕事や活動の事例を1つ振り返り、何をして何が起きたかを書き出す' },
    { id: 'compare', label: '公開されている求人情報などで、関心のある職務の内容を2〜3件比べる' },
    { id: 'project', label: '小さな自主課題を1つ決めて、成果物を1つ作る' },
    { id: 'feedback', label: '身近な人に、自分の仕事ぶりについて具体的な感想を1つ聞く' },
  ]);

  const NOTES = Object.freeze({
    style:
      '独立したい気持ちと、独立の準備ができているかは別のことです。ここでは気持ちだけを選んでください。副業や独立は目標を実現する手段のひとつで、全員が目指すものではありません。',
    functions: '関心は、能力や向き不向きを示すものではありません。いくつでも選べます。',
    selfReport: '資格や採用の評価ではなく、自分で整理するための自己申告です。',
    paths:
      '以下は、本人が比べながら考えるための「目標ルートの例」です。実際の昇進の予測や、向き不向きの判定ではありません。役職の名前や段階は、会社や業界によって異なります。',
    move: '道すじの間は行き来できます。組織の中で専門性を活かす、専門職から事業の責任者になる、事業をつくった後に組織で働く、といった移り方もあります。',
    noBigMoves: '退職や契約など、大きな決断を勧めるものではありません。まずは今週できる小さな検証から始めてください。',
    personality:
      '性格の傾向は、働き方や学び方を考えるための問いにだけ使います。職種の向き不向きや、キャリアの道すじの候補には使いません。',
  });

  /** 振り返る時期。 */
  const REVIEW_TIMINGS = Object.freeze([
    { id: '1w', label: '1週間後' },
    { id: '2w', label: '2週間後' },
    { id: 'self', label: '自分で決める' },
  ]);

  /**
   * 主候補・比較候補にした理由。本人が選んだ希望（または手動の選択）だけで説明する。
   * @param {PathId} pathId
   * @param {Career} career
   * @param {'auto'|'none'|PathId} choice
   */
  function roleReason(pathId, career, choice) {
    const primary = primaryPath(career, choice);
    if (primary === null) return '主候補を決めていないため、ほかの道すじと同じ扱いで並べています。';
    const style = WORK_STYLES.find((s) => s.id === career.style);
    if (primary === pathId) {
      return choice === pathId
        ? 'あなたが暫定の主候補として選びました。いつでも変えられます。'
        : `希望する働き方で「${style ? style.label : ''}」を選んだため、暫定の主候補にしています。`;
    }
    const primaryTitle = PATHS.find((p) => p.id === primary)?.title || '';
    return `主候補の「${primaryTitle}」と比べるための比較候補です。道すじの間は行き来できます。`;
  }

  /**
   * 最後に示す行動文。
   * @param {{ primary: PathId|null, actionId: string|null, timingId: string|null }} input
   */
  function actionSentence({ primary, actionId, timingId }) {
    const action = actionLabel(actionId);
    if (!action) return '';
    const path = PATHS.find((p) => p.id === primary);
    const head = path
      ? `「${path.title}」を暫定の主候補として、今週はまず「${action}」を試します。`
      : `道すじはまだ決めずに、今週はまず「${action}」を試して確かめます。`;
    const timing = labelOf(REVIEW_TIMINGS, timingId);
    let tail;
    if (timingId === 'self') tail = '振り返る日は自分で決め、続けるか、別の道すじを試すかを考えます。';
    else if (timing) tail = `${timing}に振り返り、続けるか、別の道すじを試すかを考えます。`;
    else tail = '振り返る時期は、まだ決めていません。';
    return `${head}${tail}`;
  }

  /** @returns {Career} */
  function emptyCareer() {
    return { style: null, functions: [], experience: {}, evidence: {} };
  }

  /** @param {ReadonlyArray<CareerChoice>} list @param {string|null|undefined} id */
  function labelOf(list, id) {
    const found = list.find((x) => x.id === id);
    return found ? found.label : '';
  }

  /**
   * 主候補の道すじ。手動で選んだものを優先し、自動の場合は希望する働き方だけから決める。
   * @param {Career} career
   * @param {'auto'|'none'|PathId} choice
   * @returns {PathId|null}
   */
  function primaryPath(career, choice) {
    if (choice === 'A' || choice === 'B' || choice === 'C') return choice;
    if (choice === 'none') return null;
    const style = WORK_STYLES.find((s) => s.id === career.style);
    return style ? style.path : null;
  }

  /** 経験や根拠が浅い（または未申告）か。 @param {Career} career @param {string} fn */
  function isUntested(career, fn) {
    const exp = career.experience[fn];
    const ev = career.evidence[fn];
    return !exp || exp === 'none' || exp === 'learned' || !ev || ev === 'none';
  }

  /**
   * 道すじのカードに出す根拠・まだ確かめたい点・検証行動。
   * @param {PathId} pathId
   * @param {Career} career
   */
  function pathView(pathId, career) {
    const path = /** @type {CareerPath} */ (PATHS.find((p) => p.id === pathId));
    const linkedChosen = career.functions.filter((f) => path.linked.includes(f));

    // 希望する働き方とのつながりは roleReason が説明するので、ここでは職能と自己申告だけを並べる
    /** @type {string[]} */
    const reasons = [];
    for (const fn of linkedChosen) {
      const exp = labelOf(EXPERIENCE, career.experience[fn]);
      const ev = labelOf(EVIDENCE, career.evidence[fn]);
      const report = exp || ev ? `（自己申告：経験「${exp || '未回答'}」、根拠「${ev || '未回答'}」）` : '';
      reasons.push(`関心のある職能に「${labelOf(FUNCTIONS, fn)}」を選んでいます${report}。この道すじの例とつながりがあります。`);
    }

    /** @type {string[]} */
    const unknowns = [...path.unknowns];
    for (const fn of linkedChosen) {
      if (isUntested(career, fn)) {
        unknowns.push(`「${labelOf(FUNCTIONS, fn)}」は関心として選んでいます。関心は能力を示すものではないので、小さく試して確かめましょう。`);
      }
    }
    if (linkedChosen.length === 0) {
      unknowns.push('この道すじで使う職能に、自分が関心を持てるかどうか。');
    }

    /** @type {string[]} */
    const actionIds = [path.action.id];
    const push = (/** @type {string} */ id) => {
      if (!actionIds.includes(id)) actionIds.push(id);
    };
    if (linkedChosen.length === 0) {
      push('reflect');
      push('compare');
    }
    for (const fn of linkedChosen) {
      const exp = career.experience[fn];
      if (isUntested(career, fn)) push('project');
      else if (exp === 'assisted') push('reflect');
      else {
        push('compare');
        if (career.evidence[fn] !== 'feedback') push('feedback');
      }
    }
    return { path, reasons, unknowns, actionIds: actionIds.slice(0, 3) };
  }

  /** 選べる検証行動の一覧（主候補の行動を先頭に）。 @param {PathId|null} primary */
  function actionChoices(primary) {
    const pathActions = PATHS.map((p) => p.action);
    const first = primary ? pathActions.filter((a) => a.id.startsWith(`${primary}-`)) : [];
    const rest = pathActions.filter((a) => !first.includes(a));
    return [...first, ...COMMON_ACTIONS, ...rest];
  }

  /** @param {string|null} id */
  function actionLabel(id) {
    if (!id) return '';
    return labelOf([...COMMON_ACTIONS, ...PATHS.map((p) => p.action)], id);
  }

  /**
   * まとめ画面のキャリア部分。
   * @param {{ career: Career, primary: PathId|null, actionId: string|null, timingId?: string|null }} input
   */
  function summary({ career, primary, actionId, timingId = null }) {
    const path = PATHS.find((p) => p.id === primary) || null;
    /** @type {string[]} */
    const lines = [];
    lines.push(
      path
        ? `暫定の主候補の道すじ：「${path.title}」。比較候補もいつでも見直せます。`
        : '主候補の道すじは決めていません。3つの例を優劣なく比べています。',
    );
    if (career.functions.length > 0) {
      lines.push(`関心のある職能：${career.functions.map((f) => labelOf(FUNCTIONS, f)).join('、')}。`);
    }
    return {
      action: actionSentence({ primary, actionId, timingId }),
      lines,
    };
  }

  return Object.freeze({
    WORK_STYLES,
    FUNCTIONS,
    EXPERIENCE,
    EVIDENCE,
    PATHS,
    COMMON_ACTIONS,
    REVIEW_TIMINGS,
    NOTES,
    emptyCareer,
    labelOf,
    primaryPath,
    pathView,
    actionChoices,
    actionLabel,
    roleReason,
    actionSentence,
    summary,
  });
})();
