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

  /** @typedef {'home'|'about'|'question'|'review'|'results'|'needs'|'routes'|'action'|'summary'} Screen */

  /**
   * @typedef {{
   *   screen: Screen,
   *   qIndex: number,
   *   answers: Array<number|null>,
   *   editingFromReview: boolean,
   *   needs: Needs,
   *   needsFrom: Screen,
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
      needs: L.emptyNeeds(),
      needsFrom: 'home',
      routeId: null,
      routeDecided: false,
      actionId: null,
      confirmReset: false,
      message: '',
    };
  }

  /** @type {State} */
  let state = initialState();

  /** 画面切り替え直後の誤タップ（連打）を無視する時間。 */
  const TAP_GUARD_MS = 350;
  let lastTransitionAt = 0;

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
    if (opts.transition) lastTransitionAt = Date.now();
    pendingFocusId = opts.focus === undefined ? null : opts.focus;
    render();
  }

  /** @param {Screen} screen @param {Partial<State>} [extra] */
  function go(screen, extra = {}) {
    update({ screen, message: '', ...extra }, { focus: 'screen-title', transition: true });
  }

  function guardTap() {
    return Date.now() - lastTransitionAt < TAP_GUARD_MS;
  }

  function hasAnyData() {
    return (
      state.answers.some((a) => a !== null) ||
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
    lastTransitionAt = Date.now();
    pendingFocusId = 'screen-title';
    render();
  }

  // ---------------------------------------------------------------------------
  // 画面

  function screenHome() {
    return [
      h('p', { class: 'eyebrow' }, 'POTEX'),
      heading('screen-title', '自己理解チェック'),
      h(
        'p',
        { class: 'lead' },
        '自分の傾向を振り返り、目標・困りごと・使える時間・支援の好みを整理して、POTEXの支援の使い方を自分で選ぶためのツールです。',
      ),
      h(
        'ol',
        { class: 'steps', 'aria-label': '進め方' },
        h('li', null, h('strong', null, '20問のチェック'), h('span', null, '普段の自分について、5段階で答えます（約3分）')),
        h('li', null, h('strong', null, '振り返り'), h('span', null, '5つの観点の数値と、考えてみたい問いを見ます')),
        h('li', null, h('strong', null, '目標と希望の整理'), h('span', null, '選択式で、テーマや使える時間を選びます')),
        h('li', null, h('strong', null, '支援の使い方を選ぶ'), h('span', null, '3つの案を見比べ、自分で選びます')),
        h('li', null, h('strong', null, '最初の小さな行動'), h('span', null, '自分で行う次の一歩を1つ決めます')),
      ),
      h(
        'div',
        { class: 'actions' },
        button('チェックを始める', () => go('about'), { variant: 'primary', id: 'start' }),
        button('チェックを飛ばして、支援の使い方を考える', () => go('needs', { needsFrom: 'home' }), {
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
        h('li', null, '20問それぞれについて、普段の自分にどのくらい当てはまるかを5段階で答えます。正解や不正解はありません。'),
        h('li', null, '結果は5つの観点ごとに、1〜5の数値で表示します。タイプ分けや、優劣・順位づけはしません。'),
        h('li', null, '前の質問に戻って、答えを変えられます。途中でやめて、支援の使い方の画面に進むこともできます。'),
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
    const errorId = 'answer-error';

    const errorEl = h('p', { id: errorId, class: 'field-error', role: 'alert' }, state.message);
    if (!state.message) errorEl.hidden = true;

    const options = C.SCALE.map((opt) => {
      const id = `q${item.no}-a${opt.value}`;
      const input = /** @type {HTMLInputElement} */ (
        h('input', {
          type: 'radio',
          name: `q${item.no}`,
          id,
          value: String(opt.value),
          checked: current === opt.value,
          'aria-describedby': state.message ? errorId : undefined,
        })
      );
      input.addEventListener('change', () => {
        const value = Number(input.value);
        if (!S.isValidAnswer(value)) return;
        const answers = state.answers.slice();
        answers[i] = value;
        // 選び直しで画面全体を描き直さず、状態とエラー表示だけを更新する
        state = { ...state, answers, message: '' };
        errorEl.hidden = true;
        errorEl.textContent = '';
        updateProgress();
      });
      return h(
        'li',
        null,
        h(
          'label',
          { class: 'option', for: id },
          input,
          h('span', { class: 'option-num', 'aria-hidden': 'true' }, String(opt.value)),
          h('span', { class: 'option-label' }, opt.label),
          h('span', { class: 'option-check', 'aria-hidden': 'true' }),
        ),
      );
    });

    const progress = h('progress', { id: 'q-progress', max: String(total), value: String(answeredCount()) });
    const answeredText = h('span', { id: 'answered-text' }, `回答済み ${answeredCount()}問`);
    function updateProgress() {
      progress.setAttribute('value', String(answeredCount()));
      answeredText.textContent = `回答済み ${answeredCount()}問`;
    }

    const isLast = i === total - 1;
    const nextLabel = state.editingFromReview ? '回答一覧に戻る' : isLast ? '回答を確認する' : '次へ';

    const onNext = () => {
      if (guardTap()) return;
      if (!S.isValidAnswer(state.answers[i])) {
        update({ message: '5つの中から1つ選ぶと、先に進めます。' }, { focus: 'next' });
        return;
      }
      if (state.editingFromReview || isLast) {
        go('review', { editingFromReview: false });
      } else {
        go('question', { qIndex: i + 1 });
      }
    };

    const onBack = () => {
      if (guardTap()) return;
      if (state.editingFromReview) go('review', { editingFromReview: false });
      else if (i === 0) go('about');
      else go('question', { qIndex: i - 1 });
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
          answeredText,
        ),
        h('label', { class: 'sr-only', for: 'q-progress' }, '回答の進み具合'),
        progress,
      ),
      h(
        'fieldset',
        { class: 'question', 'aria-labelledby': 'screen-title', 'aria-describedby': 'q-prompt' },
        h('p', { class: 'eyebrow', id: 'q-prompt' }, '普段の自分に、どのくらい当てはまりますか'),
        h('h1', { id: 'screen-title', tabindex: '-1', class: 'screen-title question-text' }, item.text),
        h('ul', { class: 'options' }, ...options),
      ),
      errorEl,
      h(
        'div',
        { class: 'actions' },
        button(nextLabel, onNext, { variant: 'primary', id: 'next' }),
        answeredCount() > 0 && !state.editingFromReview
          ? button('回答一覧を見る', () => go('review'), { variant: 'quiet', id: 'to-review' })
          : null,
        button('チェックを中断して、支援の使い方を考える', () => go('needs', { needsFrom: 'question', editingFromReview: false }), {
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
      if (guardTap()) return;
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
            h('span', { class: 'score-range' }, '（1〜5）'),
          ),
        ),
        h(
          'div',
          { class: 'scale', 'aria-hidden': 'true' },
          h('span', { class: 'scale-track' }, ...[1, 2, 3, 4, 5].map(() => h('span', { class: 'scale-tick' })), marker),
          h('span', { class: 'scale-labels' }, ...[1, 2, 3, 4, 5].map((n) => h('span', null, String(n)))),
        ),
        h(
          'dl',
          { class: 'poles' },
          h('div', null, h('dt', null, '1に近いほど'), h('dd', null, f.low)),
          h('div', null, h('dt', null, '5に近いほど'), h('dd', null, f.high)),
        ),
        f.note ? h('p', { class: 'factor-note' }, f.note) : null,
        list('振り返りの問い', f.reflections, 'reflect-list'),
      );
    });

    return [
      backBar('回答の確認へ', () => go('review')),
      heading('screen-title', 'チェックの結果'),
      callout(C.DISCLAIMER, 'important'),
      h('p', { class: 'lead' }, '5つの観点ごとに、4問の答えから計算した値（1〜5）を示します。どちらの端にも良い・悪いはありません。数値に答えを出すより、問いを手がかりに振り返ってみてください。'),
      ...factorBlocks,
      callout(C.UNCERTAINTY_NOTE),
      sourcesBlock(),
      h(
        'div',
        { class: 'actions' },
        button('支援の使い方を考える', () => go('needs', { needsFrom: 'results' }), { variant: 'primary', id: 'to-needs' }),
        button('回答を見直す', () => go('review'), { id: 'results-review' }),
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
      backTarget === 'results' ? '結果へ戻る' : backTarget === 'question' ? '質問へ戻る' : 'トップへ戻る';

    return [
      backBar(backLabel, () => go(backTarget)),
      heading('screen-title', '目標と希望の整理'),
      h('p', { class: 'lead' }, 'すべて選択式で、答えたくない項目は飛ばせます。ここで選んだ内容だけを、次の画面で支援の使い方の案に添える「理由」に使います。性格チェックの結果は使いません。'),
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
          ? button('自己理解チェックを受ける', () => go(answeredCount() > 0 ? 'question' : 'about'), { variant: 'quiet', id: 'routes-take-check' })
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
        button('次のアクションをまとめる', () => go('summary'), { variant: 'primary', id: 'to-summary' }),
      ),
    ];
  }

  function screenSummary() {
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
      backBar('行動を選び直す', () => go('action')),
      heading('screen-title', 'あなたの次のアクション'),
      h('p', { class: 'next-action' }, summary.headline),
      h('ul', { class: 'plain-list' }, ...summary.lines.map((t) => h('li', null, t))),
      list('始める前に確認したいこと', confirm, 'confirm-list'),
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
        button('支援の使い方を選び直す', () => go('routes'), { id: 'summary-routes' }),
        answeredCount() === S.ITEM_COUNT
          ? button('チェックの結果を見る', () => go('results'), { variant: 'quiet', id: 'summary-results' })
          : button('自己理解チェックを受ける', () => go(answeredCount() > 0 ? 'question' : 'about'), { variant: 'quiet', id: 'summary-take-check' }),
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
        h('p', { id: 'reset-desc' }, 'チェックの回答、結果、目標と希望の選択、選んだ支援の使い方と行動を、すべて消します。元に戻すことはできません。'),
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
      h('p', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'POTEX'), h('span', { class: 'brand-sub' }, '自己理解チェック')),
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
