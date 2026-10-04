// @ts-check
/*
 * 画面の状態管理と描画。
 * - 状態はこのスクリプトのメモリ内（state 変数）だけに置く。保存・送信・URL への書き込みはしない。
 * - DOM は createElement と textContent だけで組み立てる（innerHTML は使わない）。
 */

(() => {
  const S = PotexScoring;
  const C = PotexContent;
  const L = PotexLogic;

  /** @typedef {'home'|'about'|'question'|'review'|'results'|'career'|'paths'|'needs'|'routes'|'action'|'summary'} Screen */

  /**
   * @typedef {{
   *   screen: Screen,
   *   qIndex: number,
   *   answers: Array<number|null>,
   *   editingFromReview: boolean,
   *   career: Career,
   *   careerFrom: Screen,
   *   primaryChoice: 'auto'|'none'|PathId,
   *   careerActionId: string|null,
   *   reviewTiming: string|null,
   *   needs: Needs,
   *   needsFrom: Screen,
   *   summaryFrom: Screen,
   *   routeId: string|null,
   *   routeDecided: boolean,
   *   actionId: string|null,
   *   confirmReset: boolean,
   *   message: string,
   * }} State
   */

  /** @returns {State} */
  function initialState() {
    return {
      screen: 'home',
      qIndex: 0,
      answers: new Array(S.ITEM_COUNT).fill(null),
      editingFromReview: false,
      career: PotexCareer.emptyCareer(),
      careerFrom: 'home',
      primaryChoice: 'auto',
      careerActionId: null,
      reviewTiming: null,
      needs: L.emptyNeeds(),
      needsFrom: 'home',
      summaryFrom: 'paths',
      routeId: null,
      routeDecided: false,
      actionId: null,
      confirmReset: false,
      message: '',
    };
  }

  /** @type {State} */
  let state = initialState();

  /**
   * 画面切り替え直後の操作を無視する時間（ミリ秒）。
   * 二重クリック・二重タップの2回目が、切り替わった後の画面（次の質問など）に届いて
   * 回答や移動として扱われるのを防ぐ。
   */
  const LOCK_MS = 450;
  let lockUntil = 0;

  /** 次の描画後にフォーカスを当てる要素の id。 */
  /** @type {string|null} */
  let pendingFocusId = null;

  const root = /** @type {HTMLElement} */ (document.getElementById('app'));

  // ---------------------------------------------------------------------------
  // DOM ヘルパー（文字列はすべて textContent として入る）

  /**
   * @param {string} tag
   * @param {Record<string, string|boolean|number|null|undefined|((ev: Event) => void)>|null} [attrs]
   * @param {Array<Node|string|null|undefined|false>} children
   * @returns {HTMLElement}
   */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (typeof value === 'function') {
          el.addEventListener(key.replace(/^on/, '').toLowerCase(), value);
        } else if (key === 'class') {
          el.className = String(value);
        } else if (value === true) {
          el.setAttribute(key, '');
        } else {
          el.setAttribute(key, String(value));
        }
      }
    }
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      el.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return el;
  }

  /**
   * @param {string} label
   * @param {() => void} onClick
   * @param {{ variant?: 'primary'|'secondary'|'quiet', id?: string, ariaLabel?: string, pressed?: boolean }} [opts]
   */
  function button(label, onClick, opts = {}) {
    return h(
      'button',
      {
        type: 'button',
        class: `btn btn-${opts.variant || 'secondary'}`,
        id: opts.id,
        'aria-label': opts.ariaLabel,
        'aria-pressed': opts.pressed === undefined ? undefined : String(opts.pressed),
        onclick: () => onClick(),
      },
      label,
    );
  }

  /** @param {string} id @param {string} text @param {string} [level] */
  function heading(id, text, level = 'h1') {
    return h(level, { id, tabindex: '-1', class: 'screen-title' }, text);
  }

  /** @param {string} text */
  function callout(text, kind = 'note') {
    return h('p', { class: `callout callout-${kind}` }, text);
  }

  /** @param {string} title @param {Array<string>} items */
  function list(title, items, cls = 'plain-list') {
    if (items.length === 0) return null;
    return h(
      'div',
      { class: 'list-block' },
      h('h3', { class: 'mini-title' }, title),
      h('ul', { class: cls }, ...items.map((t) => h('li', null, t))),
    );
  }

  function sourcesBlock() {
    return h(
      'details',
      { class: 'sources' },
      h('summary', null, '質問の出典と日本語訳について'),
      ...C.SOURCE_NOTES.map((t) => h('p', null, t)),
      h('p', { class: 'citation', lang: 'en' }, C.CITATION),
      h(
        'ul',
        { class: 'link-list' },
        ...C.REFERENCES.map((r) =>
          h(
            'li',
            null,
            h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.label),
            h('span', { class: 'url', lang: 'en' }, r.url),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // 状態遷移

  /**
   * @param {Partial<State>} patch
   * @param {{ focus?: string|null, transition?: boolean }} [opts]
   */
  function update(patch, opts = {}) {
    state = { ...state, ...patch };
    if (opts.transition) lockUntil = performance.now() + LOCK_MS;
    pendingFocusId = opts.focus === undefined ? null : opts.focus;
    render();
  }

  /** @param {Screen} screen @param {Partial<State>} [extra] */
  function go(screen, extra = {}) {
    update({ screen, message: '', ...extra }, { focus: 'screen-title', transition: true });
  }

  function isLocked() {
    return performance.now() < lockUntil;
  }

  // 画面切り替え直後のクリックを、どのボタンやラベルに届く前にも止める
  root.addEventListener(
    'click',
    (ev) => {
      if (isLocked()) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    },
    true,
  );
  // Enter / Space の押し続け（キーリピート）でボタンが繰り返し押されないようにする
  root.addEventListener(
    'keydown',
    (ev) => {
      if (ev.repeat && (ev.key === 'Enter' || ev.key === ' ')) ev.preventDefault();
    },
    true,
  );

  /** スクリーンリーダー向けのお知らせ。#app の外に置き、描き直しで消えないようにする。 */
  const liveRegion = document.createElement('p');
  liveRegion.className = 'sr-only';
  liveRegion.setAttribute('aria-live', 'polite');
  document.body.append(liveRegion);
  /** @param {string} text */
  function announce(text) {
    liveRegion.textContent = text;
  }

  function hasAnyData() {
    return (
      state.answers.some((a) => a !== null) ||
      state.career.style !== null ||
      state.career.functions.length > 0 ||
      state.primaryChoice !== 'auto' ||
      state.careerActionId !== null ||
      state.reviewTiming !== null ||
      state.needs.goals.length > 0 ||
      state.needs.barriers.length > 0 ||
      state.needs.prefs.length > 0 ||
      state.needs.time !== null ||
      state.needs.frequency !== null ||
      state.routeDecided ||
      state.actionId !== null
    );
  }

  function answeredCount() {
    return state.answers.filter((a) => S.isValidAnswer(a)).length;
  }

  function resetAll() {
    state = initialState();
    lockUntil = performance.now() + LOCK_MS;
    announce('すべての回答と選択を消しました。');
    pendingFocusId = 'screen-title';
    render();
  }

  // ---------------------------------------------------------------------------
  // 画面

  function screenHome() {
    return [
      h('p', { class: 'eyebrow' }, 'POTEX'),
      heading('screen-title', 'キャリアを考えるための自己理解'),
      h(
        'p',
        { class: 'lead' },
        'いまの自分の骨格（考え方や動き方の傾向）を簡易分析で振り返り、希望する働き方・関心のある仕事・これまでの経験を整理して、キャリアの解像度を上げるためのツールです。',
      ),
      h(
        'p',
        { class: 'muted' },
        'ここでいう骨格は、変わらない本質を決めつけるものではなく、いま時点の自己理解です。職種の向き不向きや採用の可否を判定するものでもありません。',
      ),
      h(
        'ol',
        { class: 'steps', 'aria-label': '進め方' },
        h('li', null, h('strong', null, '20問の簡易分析'), h('span', null, '普段の自分について、4択で答えます（約3分）')),
        h('li', null, h('strong', null, '働き方と学び方の振り返り'), h('span', null, '5つの観点の数値と、考えてみたい問いを見ます')),
        h('li', null, h('strong', null, 'キャリアの整理'), h('span', null, '希望する働き方、関心のある職能、経験を選びます')),
        h('li', null, h('strong', null, 'キャリアの道すじの例'), h('span', null, '3つの例を比べ、今週の小さな検証行動を選びます')),
        h('li', null, h('strong', null, 'POTEXの支援の使い方（任意）'), h('span', null, '必要なら、支援の使い方を自分で選びます')),
      ),
      h(
        'div',
        { class: 'actions' },
        button('簡易分析を始める', () => go('about'), { variant: 'primary', id: 'start' }),
        button('分析を飛ばして、キャリアを整理する', () => go('career', { careerFrom: 'home' }), {
          id: 'skip-to-career',
        }),
        button('POTEXの支援の使い方を見る', () => go('needs', { needsFrom: 'home' }), {
          variant: 'quiet',
          id: 'skip-to-needs',
        }),
      ),
      h(
        'div',
        { class: 'fine-print' },
        h('p', null, C.DEMO_NOTE),
        h('p', null, C.PRIVACY_NOTE),
      ),
    ];
  }

  function screenAbout() {
    return [
      backBar('トップへ戻る', () => go('home')),
      heading('screen-title', 'はじめる前に'),
      callout(C.DISCLAIMER, 'important'),
      h(
        'ul',
        { class: 'plain-list' },
        h('li', null, '20問それぞれについて、普段の自分にどのくらい当てはまるかを「当てはまる」から「当てはまらない」までの4択で答えます。選ぶとすぐ次の質問に進みます。正解や不正解はありません。'),
        h('li', null, '結果は5つの観点ごとに、1〜4の数値で表示します。タイプ分けや、優劣・順位づけはしません。'),
        h('li', null, '結果は、働き方や学び方を考える問いのために使います。職種の向き不向きや、キャリアの候補を決めるためには使いません。'),
        h('li', null, '前の質問に戻って、答えを変えられます。途中でやめて、キャリアの整理に進むこともできます。'),
        h('li', null, C.PRIVACY_NOTE),
      ),
      sourcesBlock(),
      h(
        'div',
        { class: 'actions' },
        button(answeredCount() > 0 ? '続きから答える' : '質問に進む', () => go('question', { editingFromReview: false }), {
          variant: 'primary',
          id: 'begin-questions',
        }),
      ),
    ];
  }

  /**
   * @param {string} label
   * @param {() => void} onClick
   */
  function backBar(label, onClick) {
    return h(
      'div',
      { class: 'back-bar' },
      h('button', { type: 'button', class: 'btn-back', id: 'back', onclick: onClick }, h('span', { 'aria-hidden': 'true' }, '‹ '), label),
    );
  }

  function screenQuestion() {
    const i = state.qIndex;
    const item = S.ITEMS[i];
    const current = state.answers[i];
    const total = S.ITEM_COUNT;
    const isLast = i === total - 1;
    const returnsToReview = state.editingFromReview || isLast;

    /** 回答を記録して、すぐ次の質問（最後と一覧からの編集時は回答の確認）へ進む。 @param {number} value */
    const choose = (value) => {
      if (isLocked() || !S.isValidAnswer(value)) return;
      const answers = state.answers.slice();
      answers[i] = value;
      const label = C.SCALE.find((s) => s.value === value)?.label || '';
      announce(`質問${item.no}に「${label}」と回答しました。`);
      if (returnsToReview) go('review', { answers, editingFromReview: false });
      else go('question', { answers, qIndex: i + 1 });
    };

    const options = C.SCALE.map((opt) =>
      h(
        'li',
        null,
        h(
          'button',
          {
            type: 'button',
            class: 'option answer',
            id: `q${item.no}-a${opt.value}`,
            'aria-pressed': String(current === opt.value),
            'aria-describedby': 'q-hint',
            onclick: () => choose(opt.value),
          },
          h('span', { class: 'option-label' }, opt.label),
          h('span', { class: 'option-check', 'aria-hidden': 'true' }),
        ),
      ),
    );

    const onBack = () => {
      if (state.editingFromReview) go('review', { editingFromReview: false });
      else if (i === 0) go('about');
      else go('question', { qIndex: i - 1 });
    };

    const keepLabel = returnsToReview ? '回答を変えずに、回答の確認へ' : '回答を変えずに、次の質問へ';
    const onKeep = () => {
      if (!S.isValidAnswer(state.answers[i])) return;
      if (returnsToReview) go('review', { editingFromReview: false });
      else go('question', { qIndex: i + 1 });
    };

    return [
      backBar(state.editingFromReview ? '回答一覧へ' : i === 0 ? '説明へ戻る' : '前の質問へ', onBack),
      h(
        'div',
        { class: 'progress-wrap' },
        h(
          'p',
          { class: 'progress-text' },
          h('span', { class: 'q-count' }, `質問 ${i + 1} / ${total}`),
          h('span', { id: 'answered-text' }, `回答済み ${answeredCount()}問`),
        ),
        h('label', { class: 'sr-only', for: 'q-progress' }, '回答の進み具合'),
        h('progress', { id: 'q-progress', max: String(total), value: String(answeredCount()) }),
      ),
      h(
        'section',
        { class: 'question', 'aria-labelledby': 'screen-title' },
        h('p', { class: 'eyebrow', id: 'q-prompt' }, '普段の自分に、どのくらい当てはまりますか'),
        h('h1', { id: 'screen-title', tabindex: '-1', class: 'screen-title question-text', 'aria-describedby': 'q-prompt' }, item.text),
        h(
          'ul',
          { class: 'options', role: 'group', 'aria-labelledby': 'screen-title' },
          ...options,
        ),
        h(
          'p',
          { class: 'q-hint', id: 'q-hint' },
          returnsToReview
            ? '選ぶと、回答の確認画面に進みます。'
            : '選ぶと、すぐ次の質問に進みます。前の質問へ戻って選び直すこともできます。',
        ),
      ),
      h(
        'div',
        { class: 'actions' },
        S.isValidAnswer(current) ? button(keepLabel, onKeep, { variant: 'quiet', id: 'keep-next' }) : null,
        answeredCount() > 0 && !state.editingFromReview
          ? button('回答一覧を見る', () => go('review'), { variant: 'quiet', id: 'to-review' })
          : null,
        button('分析を中断して、キャリアを整理する', () => go('career', { careerFrom: 'question', editingFromReview: false }), {
          variant: 'quiet',
          id: 'question-skip',
        }),
      ),
    ];
  }

  function screenReview() {
    const check = S.validateResponses(state.answers);
    const rows = S.ITEMS.map((item, idx) => {
      const a = state.answers[idx];
      const scale = C.SCALE.find((s) => s.value === a);
      return h(
        'li',
        { class: 'review-row' },
        h('span', { class: 'review-no', 'aria-hidden': 'true' }, String(item.no)),
        h(
          'div',
          { class: 'review-body' },
          h('p', { class: 'review-q' }, h('span', { class: 'sr-only' }, `質問${item.no}：`), item.text),
          h(
            'p',
            { class: scale ? 'review-a' : 'review-a review-missing' },
            scale ? `${scale.label}（${scale.value}）` : '未回答',
          ),
        ),
        button('変更', () => go('question', { qIndex: idx, editingFromReview: true }), {
          variant: 'quiet',
          id: `edit-${item.no}`,
          ariaLabel: `質問${item.no}の回答を変更`,
        }),
      );
    });

    const onResults = () => {
      const v = S.validateResponses(state.answers);
      if (!v.ok) {
        update({ message: `${v.message}すべての質問に答えると、結果を表示できます。` }, { focus: 'review-error' });
        return;
      }
      go('results');
    };

    const firstMissing = check.missing.length > 0 ? check.missing[0] - 1 : -1;

    return [
      backBar('最後の質問へ', () => go('question', { qIndex: S.ITEM_COUNT - 1, editingFromReview: false })),
      heading('screen-title', '回答の確認'),
      h('p', { class: 'lead' }, `${S.ITEM_COUNT}問中 ${answeredCount()}問に回答済みです。変更したい質問は「変更」から選び直せます。`),
      h('ol', { class: 'review-list' }, ...rows),
      state.message ? h('p', { class: 'field-error', id: 'review-error', role: 'alert', tabindex: '-1' }, state.message) : null,
      h(
        'div',
        { class: 'actions' },
        button('結果を見る', onResults, { variant: 'primary', id: 'show-results' }),
        firstMissing >= 0
          ? button('未回答の質問へ', () => go('question', { qIndex: firstMissing, editingFromReview: false }), { id: 'to-missing' })
          : null,
      ),
    ];
  }

  function screenResults() {
    const check = S.validateResponses(state.answers);
    if (!check.ok) {
      // 通常は到達しない。検証前の結果は表示しない。
      return [
        heading('screen-title', '結果を表示できません'),
        callout(check.message, 'important'),
        h('div', { class: 'actions' }, button('回答の確認へ', () => go('review'), { variant: 'primary' })),
      ];
    }
    const scores = S.scoreResponses(state.answers);

    const factorBlocks = S.FACTOR_ORDER.map((key) => {
      const f = C.FACTORS[key];
      const score = scores[key];
      const pct = ((score - S.SCALE_MIN) / (S.SCALE_MAX - S.SCALE_MIN)) * 100;
      const marker = h('span', { class: 'scale-marker' });
      marker.style.left = `${pct}%`;
      return h(
        'section',
        { class: 'factor', 'aria-labelledby': `f-${key}` },
        h(
          'div',
          { class: 'factor-head' },
          h('h2', { id: `f-${key}`, class: 'factor-name' }, f.name),
          h(
            'p',
            { class: 'factor-score' },
            h('span', { class: 'score-num' }, S.formatScore(score)),
            h('span', { class: 'score-range' }, '（1〜4）'),
          ),
        ),
        h(
          'div',
          { class: 'scale', 'aria-hidden': 'true' },
          h('span', { class: 'scale-track' }, ...[1, 2, 3, 4].map(() => h('span', { class: 'scale-tick' })), marker),
          h('span', { class: 'scale-labels' }, ...[1, 2, 3, 4].map((n) => h('span', null, String(n)))),
        ),
        h(
          'dl',
          { class: 'poles' },
          h('div', null, h('dt', null, '1に近いほど'), h('dd', null, f.low)),
          h('div', null, h('dt', null, '4に近いほど'), h('dd', null, f.high)),
        ),
        f.note ? h('p', { class: 'factor-note' }, f.note) : null,
        list('働き方と学び方を考える問い', f.reflections, 'reflect-list'),
      );
    });

    return [
      backBar('回答の確認へ', () => go('review')),
      heading('screen-title', '簡易分析の結果'),
      callout(C.DISCLAIMER, 'important'),
      h('p', { class: 'lead' }, '5つの観点ごとに、4問の答えから計算した値（1〜4）を示します。どちらの端にも良い・悪いはありません。数値に答えを出すより、問いを手がかりに、自分に合う働き方や学び方を振り返ってみてください。'),
      callout(PotexCareer.NOTES.personality),
      ...factorBlocks,
      callout(C.UNCERTAINTY_NOTE),
      sourcesBlock(),
      h(
        'div',
        { class: 'actions' },
        button('キャリアを整理する', () => go('career', { careerFrom: 'results' }), { variant: 'primary', id: 'to-career' }),
        button('回答を見直す', () => go('review'), { id: 'results-review' }),
      ),
    ];
  }

  /**
   * 選択式のチップ（チェックボックスまたはラジオ）。変更時は状態だけを更新する。
   * @param {{ type: 'checkbox'|'radio', name: string, id: string, label: string, checked: boolean, onChange: (checked: boolean) => void }} o
   */
  function chip(o) {
    const input = /** @type {HTMLInputElement} */ (
      h('input', { type: o.type, name: o.name, id: o.id, value: o.id, checked: o.checked })
    );
    input.addEventListener('change', () => o.onChange(input.checked));
    return h(
      'li',
      null,
      h('label', { class: 'chip', for: o.id }, input, h('span', { class: 'chip-mark', 'aria-hidden': 'true' }), h('span', null, o.label)),
    );
  }

  /** @param {Partial<Career>} patch @param {string|null} [focus] */
  function setCareer(patch, focus) {
    const career = { ...state.career, ...patch };
    if (focus === undefined) {
      state = { ...state, career };
      syncHeaderReset();
    } else {
      update({ career }, { focus });
    }
  }

  function screenCareer() {
    const K = PotexCareer;
    const career = state.career;

    const styleGroup = h(
      'fieldset',
      { class: 'need-group' },
      h('legend', null, h('span', { class: 'need-title' }, '希望する働き方'), h('span', { class: 'need-hint' }, '1つ選べます。あとから変えられます。')),
      h(
        'ul',
        { class: 'chips' },
        ...K.WORK_STYLES.map((w) =>
          chip({
            type: 'radio',
            name: 'career-style',
            id: `career-style-${w.id}`,
            label: w.label,
            checked: career.style === w.id,
            onChange: (on) => {
              if (on) setCareer({ style: w.id });
            },
          }),
        ),
      ),
      h('p', { class: 'field-note' }, K.NOTES.style),
    );

    const fnGroup = h(
      'fieldset',
      { class: 'need-group' },
      h('legend', null, h('span', { class: 'need-title' }, '関心のある職能'), h('span', { class: 'need-hint' }, '当てはまるものをいくつでも選べます。')),
      h(
        'ul',
        { class: 'chips' },
        ...K.FUNCTIONS.map((f) =>
          chip({
            type: 'checkbox',
            name: 'career-fn',
            id: `career-fn-${f.id}`,
            label: f.label,
            checked: career.functions.includes(f.id),
            onChange: (on) => {
              // 描画時の値ではなく、最新の状態から組み立てる（他の職能の自己申告を消さないため）
              const cur = state.career;
              const set = new Set(cur.functions);
              if (on) set.add(f.id);
              else set.delete(f.id);
              const experience = { ...cur.experience };
              const evidence = { ...cur.evidence };
              if (!on) {
                delete experience[f.id];
                delete evidence[f.id];
              }
              // 職能ごとの自己申告欄が増減するので描き直す
              setCareer({ functions: K.FUNCTIONS.map((x) => x.id).filter((id) => set.has(id)), experience, evidence }, `career-fn-${f.id}`);
            },
          }),
        ),
      ),
      h('p', { class: 'field-note' }, K.NOTES.functions),
    );

    const selfReports = career.functions.map((fn) => {
      const name = K.labelOf(K.FUNCTIONS, fn);
      const radioGroup = (/** @type {'experience'|'evidence'} */ key, /** @type {string} */ title, /** @type {ReadonlyArray<CareerChoice>} */ choices) =>
        h(
          'fieldset',
          { class: 'sub-group' },
          h('legend', null, `${title}（${name}）`),
          h(
            'ul',
            { class: 'chips' },
            ...choices.map((c) =>
              chip({
                type: 'radio',
                name: `career-${key}-${fn}`,
                id: `career-${key}-${fn}-${c.id}`,
                label: c.label,
                checked: career[key][fn] === c.id,
                onChange: (on) => {
                  if (on) setCareer({ [key]: { ...state.career[key], [fn]: c.id } });
                },
              }),
            ),
          ),
        );
      return h(
        'section',
        { class: 'self-report', 'aria-labelledby': `report-${fn}` },
        h('h2', { class: 'self-report-title', id: `report-${fn}` }, `「${name}」の自己申告`),
        radioGroup('experience', '経験', K.EXPERIENCE),
        radioGroup('evidence', '根拠の種類', K.EVIDENCE),
      );
    });

    const back = state.careerFrom;
    const backLabel = back === 'results' ? '結果へ戻る' : back === 'question' ? '質問へ戻る' : back === 'paths' ? '道すじの例へ戻る' : 'トップへ戻る';

    return [
      backBar(backLabel, () => go(back)),
      heading('screen-title', 'キャリアの整理'),
      h(
        'p',
        { class: 'lead' },
        'すべて選択式で、答えたくない項目は飛ばせます。ここで選んだ希望・関心・経験だけを、次の画面の「キャリアの道すじの例」の根拠に使います。性格の分析結果は使いません。',
      ),
      styleGroup,
      fnGroup,
      selfReports.length > 0
        ? h('div', { class: 'self-reports' }, h('p', { class: 'field-note' }, K.NOTES.selfReport), ...selfReports)
        : null,
      h(
        'div',
        { class: 'actions' },
        button('キャリアの道すじの例を見る', () => go('paths'), { variant: 'primary', id: 'to-paths' }),
      ),
    ];
  }

  function screenPaths() {
    const K = PotexCareer;
    const career = state.career;
    const primary = K.primaryPath(career, state.primaryChoice);
    const auto = state.primaryChoice === 'auto';

    const cards = K.PATHS.map((p) => {
      const view = K.pathView(p.id, career);
      const isPrimary = primary === p.id;
      const roleLabel = primary === null ? null : isPrimary ? '主候補' : '比較候補';
      return h(
        'article',
        { class: isPrimary ? 'route path is-selected' : 'route path', 'aria-labelledby': `path-${p.id}` },
        h(
          'div',
          { class: 'route-head' },
          h('p', { class: 'route-index' }, `道すじ ${p.id}`),
          roleLabel ? h('p', { class: isPrimary ? 'route-chosen' : 'route-compare' }, isPrimary ? h('span', { 'aria-hidden': 'true' }, '★ ') : null, roleLabel) : null,
        ),
        h('h2', { id: `path-${p.id}`, class: 'route-title' }, p.title),
        h('p', null, p.summary),
        h(
          'ol',
          { class: 'stages', 'aria-label': `${p.title}の段階` },
          ...p.stages.map((st) =>
            h('li', null, h('span', { class: 'stage-name' }, st.stage), h('span', { class: 'stage-roles' }, st.roles.join(' → '))),
          ),
        ),
        h(
          'div',
          { class: 'list-block' },
          h('h3', { class: 'mini-title' }, 'この道すじを表示している理由'),
          h('p', { class: 'role-reason' }, K.roleReason(p.id, career, state.primaryChoice)),
          view.reasons.length > 0
            ? h('ul', { class: 'reason-list' }, ...view.reasons.map((t) => h('li', null, t)))
            : h('p', { class: 'muted' }, 'キャリアの整理で選んだ内容に、この道すじと直接つながる項目はありません。'),
        ),
        h(
          'details',
          { class: 'path-details', id: `details-${p.id}`, open: isPrimary },
          h('summary', null, 'まだ確かめたい点と、今週試せること'),
          list('まだ確かめたい点', view.unknowns, 'confirm-list'),
          list('今週試せることの例', view.actionIds.slice(0, 2).map((id) => K.actionLabel(id)), 'reflect-list action-list'),
        ),
        button(
          isPrimary ? '暫定の主候補にしています' : 'この道すじを暫定の主候補にする',
          () => update({ primaryChoice: p.id }, { focus: `primary-${p.id}` }),
          { variant: isPrimary ? 'primary' : 'secondary', id: `primary-${p.id}`, pressed: isPrimary },
        ),
      );
    });

    const actionOptions = K.actionChoices(primary).map((a) =>
      h(
        'li',
        null,
        h(
          'label',
          { class: 'option option-text', for: `cact-${a.id}` },
          (() => {
            const input = /** @type {HTMLInputElement} */ (
              h('input', { type: 'radio', name: 'career-action', id: `cact-${a.id}`, value: a.id, checked: state.careerActionId === a.id })
            );
            input.addEventListener('change', () => {
              if (input.checked) {
                state = { ...state, careerActionId: a.id };
                syncHeaderReset();
              }
            });
            return input;
          })(),
          h('span', { class: 'option-label' }, a.label),
          h('span', { class: 'option-check', 'aria-hidden': 'true' }),
        ),
      ),
    );

    const style = K.WORK_STYLES.find((w) => w.id === career.style);
    let status;
    if (primary) {
      const title = K.PATHS.find((p) => p.id === primary)?.title;
      status = auto
        ? `希望する働き方「${style ? style.label : ''}」から、「${title}」を主候補として表示しています。ほかの2つは比較候補です。主候補はいつでも変えられます。`
        : `「${title}」を主候補に選んでいます。ほかの2つは比較候補です。`;
    } else {
      status =
        '主候補を決めずに、3つの道すじを優劣なく並べています。決めていなくても、気になる道すじを1つ仮の主候補にしたり、まず1つ試して確かめたりできます。';
    }

    return [
      backBar('キャリアの整理へ', () => go('career')),
      heading('screen-title', 'キャリアの道すじの例'),
      h('div', { class: 'notice' }, h('p', null, K.NOTES.paths), h('p', null, K.NOTES.noBigMoves)),
      h('p', { class: 'lead', id: 'path-status' }, status),
      h('div', { class: 'route-list' }, ...cards),
      h(
        'div',
        { class: 'undecided' },
        button(
          primary === null ? '主候補を決めずに比べる（選択中）' : '主候補を決めずに比べる',
          () => update({ primaryChoice: 'none' }, { focus: 'primary-none' }),
          { id: 'primary-none', pressed: primary === null },
        ),
        h('p', { class: 'muted' }, K.NOTES.move),
      ),
      h(
        'fieldset',
        { class: 'question' },
        h('legend', { class: 'need-title' }, '今週まず試すことを1つ選ぶ'),
        h('p', { class: 'need-hint' }, '道すじが未定でも選べます。あとから変えられ、選ばずに進むこともできます。'),
        h('ul', { class: 'options' }, ...actionOptions),
      ),
      h(
        'fieldset',
        { class: 'need-group' },
        h('legend', null, h('span', { class: 'need-title' }, 'いつ振り返るか'), h('span', { class: 'need-hint' }, '1つ選べます。')),
        h(
          'ul',
          { class: 'chips' },
          ...K.REVIEW_TIMINGS.map((t) =>
            chip({
              type: 'radio',
              name: 'review-timing',
              id: `timing-${t.id}`,
              label: t.label,
              checked: state.reviewTiming === t.id,
              onChange: (on) => {
                if (on) {
                  state = { ...state, reviewTiming: t.id };
                  syncHeaderReset();
                }
              },
            }),
          ),
        ),
      ),
      h(
        'div',
        { class: 'actions' },
        button('ここまでをまとめる', () => go('summary', { summaryFrom: 'paths' }), { variant: 'primary', id: 'paths-summary' }),
        button('POTEXの支援の使い方も考える', () => go('needs', { needsFrom: 'paths' }), { id: 'paths-to-needs' }),
      ),
    ];
  }

  function screenNeeds() {
    const groups = C.NEEDS.map((q) => {
      const isMulti = q.multiple;
      const items = q.choices.map((c) => {
        const id = `need-${q.id}-${c.id}`;
        const current = state.needs[q.id];
        const checked = Array.isArray(current) ? current.includes(c.id) : current === c.id;
        const input = /** @type {HTMLInputElement} */ (
          h('input', { type: isMulti ? 'checkbox' : 'radio', name: `need-${q.id}`, id, value: c.id, checked })
        );
        input.addEventListener('change', () => {
          const needs = { ...state.needs };
          if (isMulti) {
            const arr = /** @type {string[]} */ (needs[q.id]).filter((x) => x !== c.id);
            if (input.checked) arr.push(c.id);
            // 選択肢の並び順に揃える
            /** @type {any} */ (needs)[q.id] = q.choices.map((x) => x.id).filter((x) => arr.includes(x));
          } else {
            /** @type {any} */ (needs)[q.id] = input.checked ? c.id : null;
          }
          state = { ...state, needs };
          const clear = document.getElementById(`clear-${q.id}`);
          if (clear) clear.hidden = !needs[q.id];
          syncHeaderReset();
        });
        return h(
          'li',
          null,
          h(
            'label',
            { class: 'chip', for: id },
            input,
            h('span', { class: 'chip-mark', 'aria-hidden': 'true' }),
            h('span', null, c.label),
          ),
        );
      });
      const clearBtn = isMulti
        ? null
        : h(
            'button',
            {
              type: 'button',
              class: 'btn-text',
              id: `clear-${q.id}`,
              onclick: () => {
                update({ needs: { ...state.needs, [q.id]: null } }, { focus: `need-${q.id}-${q.choices[0].id}` });
              },
            },
            `「${q.title}」の選択を外す`,
          );
      if (clearBtn && !state.needs[q.id]) clearBtn.hidden = true;
      return h(
        'fieldset',
        { class: 'need-group' },
        h('legend', null, h('span', { class: 'need-title' }, q.title), h('span', { class: 'need-hint' }, q.hint)),
        h('ul', { class: 'chips' }, ...items),
        clearBtn,
      );
    });

    const backTarget = state.needsFrom;
    const backLabel =
      backTarget === 'paths' ? '道すじの例へ戻る' : backTarget === 'results' ? '結果へ戻る' : backTarget === 'question' ? '質問へ戻る' : 'トップへ戻る';

    return [
      backBar(backLabel, () => go(backTarget)),
      heading('screen-title', '目標と希望の整理'),
      h('p', { class: 'lead' }, 'POTEXの支援をどう使うかを考えるための、任意の質問です。すべて選択式で、答えたくない項目は飛ばせます。ここで選んだ内容だけを、次の画面で支援の使い方の案に添える「理由」に使います。性格の分析結果は使いません。'),
      ...groups,
      h(
        'div',
        { class: 'actions' },
        button('支援の使い方の案を見る', () => go('routes'), { variant: 'primary', id: 'to-routes' }),
      ),
    ];
  }

  function screenRoutes() {
    const cards = C.ROUTES.map((r, idx) => {
      const selected = state.routeDecided && state.routeId === r.id;
      const reasons = L.reasonsFor(r.id, state.needs);
      return h(
        'article',
        { class: selected ? 'route is-selected' : 'route', 'aria-labelledby': `route-${r.id}` },
        h(
          'div',
          { class: 'route-head' },
          h('p', { class: 'route-index' }, `案 ${['A', 'B', 'C'][idx]}`),
          selected ? h('p', { class: 'route-chosen' }, h('span', { 'aria-hidden': 'true' }, '✓ '), '選択中') : null,
        ),
        h('h2', { id: `route-${r.id}`, class: 'route-title' }, r.title),
        h('p', null, r.summary),
        list('組み合わせる支援', [...r.includes], 'tag-list'),
        h(
          'div',
          { class: 'list-block' },
          h('h3', { class: 'mini-title' }, 'あなたの選択とのつながり'),
          reasons.length > 0
            ? h('ul', { class: 'reason-list' }, ...reasons.map((t) => h('li', null, t)))
            : h('p', { class: 'muted' }, '目標と希望の整理で選んだ内容に、この案と直接つながる項目はありません。気になる場合は選べます。'),
        ),
        list('確認が必要なこと', [...r.confirm], 'confirm-list'),
        list('考えてみたい問い', [...r.questions], 'reflect-list'),
        button(
          selected ? 'この使い方を選択中' : 'この使い方を選ぶ',
          () => update({ routeId: r.id, routeDecided: true, actionId: keepAction(r.id) }, { focus: `pick-${r.id}` }),
          { variant: selected ? 'primary' : 'secondary', id: `pick-${r.id}`, pressed: selected },
        ),
      );
    });

    const undecided = state.routeDecided && state.routeId === null;

    return [
      backBar('目標と希望の整理へ', () => go('needs')),
      heading('screen-title', '支援の使い方の案'),
      h('div', { class: 'notice' }, ...C.ROUTE_NOTICE.map((t) => h('p', null, t))),
      h('div', { class: 'route-list' }, ...cards),
      h(
        'div',
        { class: 'undecided' },
        button(
          undecided ? 'まだ決めない（選択中）' : 'まだ決めない',
          () => update({ routeId: null, routeDecided: true, actionId: keepAction(null) }, { focus: 'pick-none' }),
          { id: 'pick-none', pressed: undecided },
        ),
        h('p', { class: 'muted' }, '選んだ案は、いつでも変えられます。'),
      ),
      h(
        'div',
        { class: 'actions' },
        button('最初の小さな行動を選ぶ', () => go('action'), { variant: 'primary', id: 'to-action' }),
        answeredCount() < S.ITEM_COUNT
          ? button('簡易分析を受ける', () => go(answeredCount() > 0 ? 'question' : 'about'), { variant: 'quiet', id: 'routes-take-check' })
          : null,
      ),
    ];
  }

  /** 案を変えたとき、選んでいた行動が新しい候補に含まれなければ外す。 @param {string|null} routeId */
  function keepAction(routeId) {
    return L.actionsFor(routeId).some((a) => a.id === state.actionId) ? state.actionId : null;
  }

  function screenAction() {
    const route = C.ROUTES.find((r) => r.id === state.routeId) || null;
    const options = L.actionsFor(state.routeId).map((a) => {
      const id = `act-${a.id}`;
      const input = /** @type {HTMLInputElement} */ (
        h('input', { type: 'radio', name: 'first-action', id, value: a.id, checked: state.actionId === a.id })
      );
      input.addEventListener('change', () => {
        if (input.checked) {
          state = { ...state, actionId: a.id };
          syncHeaderReset();
        }
      });
      return h(
        'li',
        null,
        h(
          'label',
          { class: 'option option-text', for: id },
          input,
          h('span', { class: 'option-label' }, a.label),
          h('span', { class: 'option-check', 'aria-hidden': 'true' }),
        ),
      );
    });
    return [
      backBar('支援の使い方の案へ', () => go('routes')),
      heading('screen-title', '最初の小さな行動'),
      h(
        'p',
        { class: 'lead' },
        route
          ? `「${route.title}」を選んでいます。始めやすそうな行動を1つ選んでください。`
          : '支援の使い方は、まだ決めていません。決めなくても始められる行動から1つ選べます。',
      ),
      h(
        'fieldset',
        { class: 'question' },
        h('legend', { class: 'sr-only' }, '最初の小さな行動'),
        h('ul', { class: 'options' }, ...options),
      ),
      h(
        'div',
        { class: 'actions' },
        button('次のアクションをまとめる', () => go('summary', { summaryFrom: 'action' }), { variant: 'primary', id: 'to-summary' }),
      ),
    ];
  }

  function screenSummary() {
    const careerSummary = PotexCareer.summary({
      career: state.career,
      primary: PotexCareer.primaryPath(state.career, state.primaryChoice),
      actionId: state.careerActionId,
      timingId: state.reviewTiming,
    });
    const potexTouched = state.routeDecided || state.actionId !== null;
    const summary = L.buildSummary({
      routeId: state.routeDecided ? state.routeId : null,
      actionId: state.actionId,
      needs: state.needs,
    });
    const confirm = [
      ...summary.confirm,
      '価格、提供の条件、利用規約は、POTEXの担当者に直接ご確認ください。',
    ];
    return [
      backBar(state.summaryFrom === 'action' ? '行動を選び直す' : '道すじの例へ戻る', () => go(state.summaryFrom)),
      heading('screen-title', 'あなたの次のアクション'),
      h(
        'div',
        { class: 'next-action' },
        careerSummary.action ? h('p', { id: 'next-career' }, careerSummary.action) : null,
        potexTouched && state.actionId ? h('p', { id: 'next-potex' }, summary.headline.replace('次にあなたがすること：', 'POTEXの支援で最初にすること：')) : null,
        !careerSummary.action && !(potexTouched && state.actionId) ? h('p', null, '次にすることは、まだ選んでいません。道すじの例の画面で、今週まず試すことと振り返る時期を選べます。') : null,
      ),
      h(
        'section',
        { class: 'summary-block', 'aria-labelledby': 'sum-career' },
        h('h2', { id: 'sum-career', class: 'mini-title' }, 'キャリアの整理'),
        h('ul', { class: 'plain-list' }, ...careerSummary.lines.map((t) => h('li', null, t))),
        h('p', { class: 'muted' }, PotexCareer.NOTES.noBigMoves),
      ),
      h(
        'section',
        { class: 'summary-block', 'aria-labelledby': 'sum-potex' },
        h('h2', { id: 'sum-potex', class: 'mini-title' }, 'POTEXの支援の使い方（任意）'),
        potexTouched
          ? h('ul', { class: 'plain-list' }, ...summary.lines.map((t) => h('li', null, t)))
          : h('p', { class: 'muted' }, 'まだ考えていません。必要なときに、支援の使い方の案を見て自分で選べます。'),
      ),
      list('始める前に確認したいこと', potexTouched ? confirm : [], 'confirm-list'),
      h(
        'div',
        { class: 'consult', role: 'status' },
        h('p', { class: 'consult-title' }, C.CONSULT_STATUS),
        h('p', null, C.CONSULT_DETAIL),
      ),
      h('p', { class: 'muted' }, 'この内容は保存されません。ページを閉じたり再読み込みしたりすると消えます。残したい場合は、ご自身で書き留めてください。'),
      h(
        'div',
        { class: 'actions' },
        button('試すことや道すじを選び直す', () => go('paths'), { id: 'summary-paths' }),
        button(potexTouched ? '支援の使い方を選び直す' : 'POTEXの支援の使い方を考える', () => go(potexTouched ? 'routes' : 'needs', potexTouched ? {} : { needsFrom: 'paths' }), {
          variant: 'quiet',
          id: 'summary-routes',
        }),
        answeredCount() === S.ITEM_COUNT
          ? button('簡易分析の結果を見る', () => go('results'), { variant: 'quiet', id: 'summary-results' })
          : button('簡易分析を受ける', () => go(answeredCount() > 0 ? 'question' : 'about'), { variant: 'quiet', id: 'summary-take-check' }),
      ),
    ];
  }

  // ---------------------------------------------------------------------------
  // やり直しの確認（ブラウザの confirm() は使わない）

  function resetDialog() {
    const cancel = () => update({ confirmReset: false }, { focus: 'reset' });
    const dialog = h(
      'div',
      { class: 'dialog-backdrop' },
      h(
        'div',
        {
          class: 'dialog',
          role: 'alertdialog',
          'aria-modal': 'true',
          'aria-labelledby': 'reset-title',
          'aria-describedby': 'reset-desc',
          onkeydown: (/** @type {Event} */ ev) => {
            const e = /** @type {KeyboardEvent} */ (ev);
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            } else if (e.key === 'Tab') {
              // ダイアログ内でフォーカスを循環させる
              const items = /** @type {HTMLElement[]} */ (Array.from(dialog.querySelectorAll('button')));
              const first = items[0];
              const last = items[items.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
          },
        },
        h('h2', { id: 'reset-title' }, '最初からやり直しますか'),
        h('p', { id: 'reset-desc' }, '簡易分析の回答と結果、キャリアの整理の選択、選んだ道すじと検証行動、POTEXの支援についての選択を、すべて消します。元に戻すことはできません。'),
        h(
          'div',
          { class: 'dialog-actions' },
          button('キャンセル', cancel, { id: 'reset-cancel' }),
          button('すべて消して最初に戻る', resetAll, { variant: 'primary', id: 'reset-confirm' }),
        ),
      ),
    );
    return dialog;
  }

  // ---------------------------------------------------------------------------
  // 描画

  function syncHeaderReset() {
    const btn = document.getElementById('reset');
    if (btn) btn.hidden = !hasAnyData();
  }

  function render() {
    const activeId = document.activeElement && document.activeElement.id ? document.activeElement.id : null;

    /** @type {Record<Screen, () => Array<Node|null>>} */
    const screens = {
      home: screenHome,
      about: screenAbout,
      question: screenQuestion,
      review: screenReview,
      results: screenResults,
      career: screenCareer,
      paths: screenPaths,
      needs: screenNeeds,
      routes: screenRoutes,
      action: screenAction,
      summary: screenSummary,
    };

    const resetBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn-text header-reset',
        id: 'reset',
        onclick: () => update({ confirmReset: true }, { focus: 'reset-cancel' }),
      },
      'やり直す',
    );
    if (!hasAnyData()) resetBtn.hidden = true;

    const header = h(
      'header',
      { class: 'app-header' },
      h('p', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'POTEX'), h('span', { class: 'brand-sub' }, 'キャリアの自己理解')),
      h('p', { class: 'demo-pill' }, '公開デモ'),
      resetBtn,
    );

    const main = h('main', { class: `screen screen-${state.screen}`, id: 'main' }, ...screens[state.screen]());
    if (state.confirmReset) main.setAttribute('inert', '');

    const footer = h(
      'footer',
      { class: 'app-footer' },
      h('p', null, '公開デモ（本番運用ではありません）。回答は送信・保存されず、再読み込みで消えます。'),
    );
    if (state.confirmReset) {
      header.setAttribute('inert', '');
      footer.setAttribute('inert', '');
    }

    root.replaceChildren(header, main, footer, state.confirmReset ? resetDialog() : '');

    const focusId = pendingFocusId || activeId;
    pendingFocusId = null;
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus({ preventScroll: focusId !== 'screen-title' });
        if (focusId === 'screen-title') window.scrollTo(0, 0);
      }
    }
  }

  render();
})();
