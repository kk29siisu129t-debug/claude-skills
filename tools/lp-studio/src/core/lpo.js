// LPO 分析。架空の集計データのみを扱う（dataset.fictional === true が前提）。
// 観測（数値そのもの）と推測（仮説）を分け、欠損・不足・定義違いでは判定しない。
// ヒートマップ・メール・外部分析サービスは未接続。

export const LPO_RULES = Object.freeze({
  alpha: 0.05, // 両側
  power: 0.8,
  mdeRelative: 0.2, // 相対20%の差を検出できるサンプル
  minVisitorsPerArm: 1000,
  minConversionsPerArm: 30,
  srmP: 0.001,
  maxDurationDays: 28,
});

export const CONNECTIONS = Object.freeze({
  heatmap: { connected: false, label: 'ヒートマップ' },
  email: { connected: false, label: 'メール配信' },
  analytics: { connected: false, label: '外部アクセス解析サービス' },
  adPlatform: { connected: false, label: '広告配信' },
});

// ---- 統計関数 ----
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
export function normInv(p) {
  // Acklam の近似
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function gammaln(x) {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const c of cof) ser += c / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 200; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}
export const chiSquareP = (stat, df) => gammaQ(df / 2, stat / 2);

export function wilson(conv, n, z = 1.959964) {
  if (!n) return [0, 0];
  const p = conv / n;
  const den = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function twoProportionP(c1, n1, c2, n2) {
  const p = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return 1;
  const z = (c2 / n2 - c1 / n1) / se;
  return 2 * (1 - normCdf(Math.abs(z)));
}

export function requiredSamplePerArm(baseRate, { alpha = LPO_RULES.alpha, power = LPO_RULES.power, mdeRelative = LPO_RULES.mdeRelative } = {}) {
  if (!(baseRate > 0 && baseRate < 1)) return null;
  const p1 = baseRate;
  const p2 = Math.min(0.999, baseRate * (1 + mdeRelative));
  const za = normInv(1 - alpha / 2);
  const zb = normInv(power);
  return Math.ceil(((za + zb) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))) / (p2 - p1) ** 2);
}

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(2)}%`);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

// ---- 実験単位の分析 ----
export function analyzeExperiment(exp) {
  const notes = []; // 判定不可の理由
  const observations = [];
  const control = exp.variants[0];

  // 定義の一致
  const defs = ['unit', 'conversionDefinition', 'measurement'];
  for (const k of defs) {
    const vals = new Set(exp.variants.map((v) => v[k]));
    if (vals.size > 1) notes.push(`バリアント間で ${k} が異なるため比較しません（${[...vals].join(' / ')}）`);
  }
  // 欠損
  const missingVars = exp.variants.filter((v) => v.visitors == null || v.conversions == null);
  if (missingVars.length) notes.push(`集計の欠損: ${missingVars.map((v) => v.name).join(', ')}`);
  if (exp.missingDays > 0) notes.push(`計測欠損日が ${exp.missingDays} 日あります`);
  // データ矛盾
  for (const v of exp.variants) {
    if (v.visitors != null && v.conversions != null && v.conversions > v.visitors) notes.push(`${v.name}: CV数が分母を超えています（定義の不一致の疑い）`);
  }
  // 期間
  const days = daysBetween(exp.start, exp.end);
  if (!(days >= 1)) notes.push(`期間が不正です（開始 ${exp.start} > 終了 ${exp.end}）`);
  if (Date.parse(exp.plannedEnd) < Date.parse(exp.start)) notes.push(`予定終了日（${exp.plannedEnd}）が開始日より前です`);
  if (days > LPO_RULES.maxDurationDays) notes.push(`期間が ${days} 日で、上限 ${LPO_RULES.maxDurationDays} 日を超えています（季節性・外部要因が混ざるため判定しない）`);
  const plannedDone = Date.parse(exp.end) >= Date.parse(exp.plannedEnd);
  if (!plannedDone) notes.push(`予定期間（〜${exp.plannedEnd}）が未了です。途中で判定しません`);
  // 割付比の指定: 全案に指定するか、全く指定しないか。指定するなら合計 1
  const shareSpecified = exp.variants.filter((v) => v.expectedShare != null).length;
  if (shareSpecified && shareSpecified !== exp.variants.length) notes.push('予定割付比（expectedShare）が一部の案にしかありません');
  else if (shareSpecified && Math.abs(exp.variants.reduce((a, v) => a + v.expectedShare, 0) - 1) > 0.001) notes.push('予定割付比（expectedShare）の合計が 1 ではありません（入力ミスの可能性。SRM を正しく検査できない）');
  // 集計の矛盾
  for (const v of exp.variants) {
    if (v.ctaClicks != null && v.visitors != null && v.ctaClicks > v.visitors) notes.push(`${v.name}: CTAクリック数が分母を超えています（定義・集計単位の不一致の疑い）`);
  }

  // 観測値（欠損以外）
  const rows = exp.variants.map((v) => {
    const ok = v.visitors != null && v.conversions != null && v.visitors > 0;
    const rate = ok ? v.conversions / v.visitors : null;
    const ci = ok ? wilson(v.conversions, v.visitors) : null;
    const clickOk = ok && v.ctaClicks != null && v.ctaClicks <= v.visitors;
    const clickRate = clickOk ? v.ctaClicks / v.visitors : null;
    const afterClickOk = clickOk && v.ctaClicks > 0 && v.conversions <= v.ctaClicks; // CV>クリックなら CV がクリック以外の経路も含む定義
    return { id: v.id, name: v.name, visitors: v.visitors, conversions: v.conversions, ctaClicks: v.ctaClicks ?? null, rate, ci, clickRate, afterClickOk };
  });
  for (const r of rows) {
    if (r.rate == null) observations.push({ id: `${exp.id}-${r.id}-na`, text: `${r.name}: 集計が欠損しているため率を出しません` });
    else if (r.clickRate != null && !r.afterClickOk && r.ctaClicks > 0) observations.push({ id: `${exp.id}-${r.id}-note`, text: `注記: ${r.name} は CV（${r.conversions}）が CTAクリック（${r.ctaClicks}）を上回るため、クリック後CV率は出さない（CV がクリック以外の経路を含む定義の疑い）` });
    if (r.rate != null) observations.push({ id: `${exp.id}-${r.id}`, text: `${r.name}: CV ${r.conversions} / ${control.unit} ${r.visitors} = ${pct(r.rate)}（95%CI ${pct(r.ci[0])}〜${pct(r.ci[1])}）${r.clickRate != null ? `、CTAクリック率 ${pct(r.clickRate)}` : ''}` });
  }

  // SRM
  let srm = null;
  if (!missingVars.length && !(shareSpecified && shareSpecified !== exp.variants.length)) {
    const total = exp.variants.reduce((a, v) => a + v.visitors, 0);
    const shares = exp.variants.map((v) => v.expectedShare ?? 1 / exp.variants.length);
    const sumShares = shares.reduce((a, b) => a + b, 0);
    const stat = exp.variants.reduce((a, v, i) => {
      const expected = (total * shares[i]) / sumShares;
      return a + (expected ? (v.visitors - expected) ** 2 / expected : 0);
    }, 0);
    const p = chiSquareP(stat, exp.variants.length - 1);
    srm = { stat: Math.round(stat * 100) / 100, p, detected: p < LPO_RULES.srmP };
    if (srm.detected) notes.push(`割付比のずれ（SRM）を検出しました（p=${p.toExponential(2)}）。割付か計測に問題がある可能性があり、比較しません`);
  }

  // 比較（対照 vs 各案）。Bonferroni
  const k = Math.max(1, exp.variants.length - 1);
  const alphaAdj = LPO_RULES.alpha / k;
  const base = rows[0];
  const required = base.rate ? requiredSamplePerArm(base.rate) : null;
  const comparisons = rows.slice(1).map((r) => {
    const reasons = [...notes];
    if (base.rate == null || r.rate == null) reasons.push('率が計算できません');
    const small = [base, r].filter((x) => x.visitors != null && x.conversions != null && (x.visitors < LPO_RULES.minVisitorsPerArm || x.conversions < LPO_RULES.minConversionsPerArm));
    if (small.length) reasons.push(`サンプル不足: ${small.map((x) => `${x.name}（${x.visitors}${control.unit === 'users' ? '人' : '件'} / CV ${x.conversions}）`).join(', ')}。各群 ${LPO_RULES.minVisitorsPerArm} 以上かつ CV ${LPO_RULES.minConversionsPerArm} 以上が必要`);
    if (required && [base, r].some((x) => x.visitors != null && x.visitors < required)) reasons.push(`相対${LPO_RULES.mdeRelative * 100}%の差を検出力${LPO_RULES.power * 100}%で見るには各群 約${required} が必要`);
    if (reasons.length) {
      return { variant: r.name, verdict: 'not-evaluable', label: '判定しない', reasons, diff: base.rate != null && r.rate != null ? r.rate - base.rate : null, p: null };
    }
    const p = twoProportionP(base.conversions, base.visitors, r.conversions, r.visitors);
    const diff = r.rate - base.rate;
    const sig = p < alphaAdj;
    return {
      variant: r.name,
      verdict: sig ? 'difference-observed' : 'no-detectable-difference',
      label: sig ? '差が観測された（この期間・この定義の範囲で）' : '検出できる差は観測されなかった',
      reasons: sig ? ['統計的に有意でも、因果の経路と他期間への汎化は未確認'] : ['差が無いことの証明ではない'],
      diff, relativeLift: diff / base.rate, p, alphaAdjusted: alphaAdj,
    };
  });

  return {
    id: exp.id, name: exp.name, page: exp.page || '', timezone: exp.timezone, period: `${exp.start}〜${exp.end}（${days}日, ${exp.timezone}）`,
    plannedEnd: exp.plannedEnd, unit: control.unit, conversionDefinition: control.conversionDefinition, measurement: control.measurement,
    rows, srm, comparisons, notes, observations, requiredPerArm: required, days,
  };
}

/**
 * 実験をまたいだ比較の前提。TZ・分母・CV定義・計測条件・ページが全案で一致し、期間が重ならないときだけ comparable。
 * comparable でも、期間の長さ・曜日構成・季節性は調整していない（cautions に出す）。
 */
export function comparability(a, b) {
  const reasons = [];
  const cautions = [];
  const uniq = (x, k) => [...new Set(x.variants.map((v) => v[k]))];
  if (a.timezone !== b.timezone) reasons.push(`タイムゾーンが異なる（${a.timezone} / ${b.timezone}）`);
  const labels = { unit: '分母', conversionDefinition: 'コンバージョン定義', measurement: '計測条件' };
  for (const k of Object.keys(labels)) {
    const ua = uniq(a, k);
    const ub = uniq(b, k);
    if (ua.length > 1 || ub.length > 1) reasons.push(`${labels[k]}が実験内の案ごとに異なる`);
    else if (ua[0] !== ub[0]) reasons.push(k === 'unit' ? `分母が異なる（${ua[0]} / ${ub[0]}）` : `${labels[k]}が異なる`);
  }
  if ((a.page || '') !== (b.page || '')) reasons.push('対象ページが異なる');
  const overlap = Date.parse(a.start) <= Date.parse(b.end) && Date.parse(b.start) <= Date.parse(a.end);
  if (overlap) reasons.push('期間が重複している（同じ訪問者が両方に入る）');
  const da = daysBetween(a.start, a.end);
  const db = daysBetween(b.start, b.end);
  if (da !== db) cautions.push(`期間の長さが異なる（${da}日 / ${db}日）`);
  if (da % 7 || db % 7) cautions.push('曜日構成がそろっていない（7日単位でない）');
  cautions.push('季節性・流入構成の変化は未調整');
  return { comparable: reasons.length === 0, reasons, cautions };
}

// ---- 仮説 ----
function priority(impact, confidence, effort) {
  const score = Math.round(((impact * confidence) / effort) * 10) / 10;
  return { score, impact, confidence, effort, level: score >= 4 ? '高' : score >= 2 ? '中' : '低' };
}

/**
 * 仮説と検証計画。evidenceType: observed-fictional（架空集計の観測）/ project-audit（このLPの監査結果）/ heuristic（一般論・未検証）
 */
export function buildHypotheses(project, analyses) {
  const H = [];
  const main = analyses.find((a) => a.comparisons.length) || analyses[0];
  const unit = main ? main.unit : 'users';
  const cvDef = main ? main.conversionDefinition : '（データセット未設定）';
  const required = main?.requiredPerArm;
  const dailyPerArm = main && main.rows[0].visitors ? Math.round(main.rows[0].visitors / main.days) : null;
  const estDays = required && dailyPerArm ? Math.ceil(required / dailyPerArm) : null;
  const stopBase = [
    required ? `各群 ${required}（${unit}）に到達したら停止して判定` : '基準CV率が無いため必要サンプルを計算できない。まず基準期間を計測する',
    `最長 ${LPO_RULES.maxDurationDays} 日で打ち切り（到達しなければ「判定しない」で終える）`,
    `SRM（p<${LPO_RULES.srmP}）を検出したら即停止し、割付・計測を点検`,
    'guardrail のいずれかが対照より悪化し、その95%CIが0をまたがなければ停止',
  ];
  const guardBase = [`主要CVの定義を途中で変えない（${cvDef}）`, '直帰率・ページ滞在の極端な悪化（計測できる範囲で）'];

  const proof = project.sections.find((s) => s.role === 'proof');
  const verifiedInProof = proof ? project.evidence.filter((e) => proof.sourceRefs.includes(e.id) && e.status === 'verified' && e.reality === 'real').length : 0;
  if (!proof || verifiedInProof === 0) {
    H.push({
      id: 'h-proof', title: '根拠セクションを検証済みの事実で埋める', evidenceType: 'project-audit',
      basis: ['LP監査: 実在・検証済みの根拠が 0 件（根拠セクションは出力されない）'],
      hypothesis: '申込を迷う人が判断材料を見つけられず、離脱しているかもしれない。検証済みの事実を足すと申込率が上がる可能性がある',
      metric: `主要: ${cvDef}（分母 ${unit}）`, guardrails: [...guardBase, '問い合わせ内容の質（申込後の不一致が増えていないか）'],
      stopConditions: stopBase, priority: priority(3, 2, 2),
      caution: 'テストの前に、出典を人が確認すること。未検証の数字を出して改善しても、それは改善ではない',
    });
  }
  const conf = project.inputs?.action?.confirmed || {};
  const unconfirmed = ['offer', 'price', 'duration', 'method', 'url'].filter((k) => !conf[k]);
  if (unconfirmed.length) {
    H.push({
      id: 'h-brief', title: 'オファーと行動条件の確定（テスト前の前提づくり）', evidenceType: 'project-audit',
      basis: [`行動条件の未確定: ${unconfirmed.join(', ')}`],
      hypothesis: '申込後に何が起きるかが決まっていない状態でABを回しても、何を比べたのか後から説明できない。先に確定させる',
      metric: '（テストではない。確定作業）', guardrails: [], stopConditions: ['オファー・料金・所要時間・方法・リンク先が確定したら完了'], priority: priority(2, 3, 1),
      caution: 'これは検証計画の前提。結果指標は無い',
    });
  }
  if (main && main.rows.every((r) => r.rate != null)) {
    const cr = main.rows[0];
    if (cr.afterClickOk) {
      const after = cr.conversions / cr.ctaClicks;
      H.push({
        id: 'h-after-click', title: 'CTAクリック後の遷移先を点検する', evidenceType: 'observed-fictional',
        basis: [`${main.name} の対照: CTAクリック ${cr.ctaClicks} に対しCV ${cr.conversions}（クリック後のCV ${pct(after)}）`, '遷移先（LP外）の行動は未計測'],
        hypothesis: 'クリック後に離脱している割合が大きいなら、LP本文より遷移先の摩擦が効いているかもしれない。LP側の変更より先に確認する価値がある',
        metric: `クリック後CV率 = CV / CTAクリック（同一定義・同一期間）`, guardrails: guardBase,
        stopConditions: ['遷移先の計測が無いうちは結論を出さない', ...stopBase.slice(1, 3)], priority: priority(2, after < 0.3 ? 2 : 1, 2),
        caution: '遷移先は計測範囲外。外部分析サービスとは未接続のため、ここでは仮説の提示まで',
      });
    }
  }
  if (project.cta.variants.length > 1) {
    const heroCta = project.sections.find((s) => s.role === 'hero')?.cta?.label || '';
    const vs = project.cta.variants.map((v) => `${v.id}: 「${v.label || heroCta}」/ ${v.color} / ${v.timing}`);
    H.push({
      id: 'h-cta', title: 'CTAの文言・色・表示タイミングの比較', evidenceType: 'heuristic',
      basis: ['プレビュー上のCTA案（実配信はしていない）', ...vs],
      hypothesis: '固定CTAの出し方を変えると、本文を読み終える前の誤クリックや見落としが変わるかもしれない',
      metric: `主要: ${cvDef}（分母 ${unit}）。補助: CTAクリック率`, guardrails: [...guardBase, 'クリック率だけ上がりCVが下がっていないか'],
      stopConditions: stopBase, priority: priority(2, 1, 1),
      caution: '一般論からの仮説で、このLPでの観測はまだない。実配信は別途の承認が必要（このツールは配信しない）',
    });
  }
  for (const a of analyses) {
    a.comparisons.forEach((c, idx) => {
      if (c.verdict !== 'difference-observed') return;
      const up = c.relativeLift > 0;
      const variantId = a.rows[idx + 1]?.id || String(idx + 1);
      H.push({
        id: `h-replicate-${a.id}-${variantId}`,
        title: up ? `「${a.name}」の ${c.variant}: 改善の再現確認と段階展開` : `「${a.name}」の ${c.variant}: 悪化の再現確認と配分停止`,
        evidenceType: 'observed-fictional',
        basis: [`${a.period} / 分母 ${a.unit} で対照より${up ? '高い' : '低い'}差が観測された（相対 ${(c.relativeLift * 100).toFixed(1)}%、p=${c.p.toExponential(2)}）`, '一度の観測で、因果の経路と他期間・他流入への汎化は未確認'],
        hypothesis: up
          ? `${c.variant} の変更が申込を増やしたのかもしれない。別期間で同じ定義のまま再現するかを確かめ、再現すれば段階的に配分を上げる`
          : `${c.variant} の変更が申込を減らしたのかもしれない。この案への配分は止め、悪化が再現するかは必要な場合だけ小さく確かめる`,
        metric: `主要: ${a.conversionDefinition}（分母 ${a.unit}）。前回と同じ定義・同じ計測条件で`,
        guardrails: [...guardBase, '申込後の不一致（キャンセル・問い合わせ内容）が増えていないか'],
        stopConditions: up
          ? [`再現テストも各群 ${a.requiredPerArm ?? '必要数'} に到達で判定`, `最長 ${LPO_RULES.maxDurationDays} 日`, `SRM（p<${LPO_RULES.srmP}）で停止`, '再現しなければ展開しない（元に戻す）']
          : ['この案への配分は直ちに 0 にする（再開しない）', `再確認する場合も最長 ${LPO_RULES.maxDurationDays} 日・小配分`, `SRM（p<${LPO_RULES.srmP}）で停止`],
        priority: priority(3, 2, 1),
        caution: 'このツールは配信しない。配分の変更は実配信の承認を別途取ってから',
      });
    });
  }
  if (main) {
    const notEval = main.comparisons.filter((c) => c.verdict === 'not-evaluable');
    if (notEval.length) {
      H.push({
        id: 'h-continue', title: `「${main.name}」は判定せず、条件を満たすまで継続または設計し直す`, evidenceType: 'observed-fictional',
        basis: notEval.flatMap((c) => c.reasons).slice(0, 4),
        hypothesis: '現時点のデータから案の優劣は言えない。必要サンプルに届く見込みがあれば継続、なければMDEを見直す',
        metric: `主要: ${cvDef}（分母 ${unit}）`, guardrails: guardBase,
        stopConditions: [estDays ? `現在の流入なら約 ${estDays} 日で必要サンプルに到達（最長 ${LPO_RULES.maxDurationDays} 日を超えるなら設計を見直す）` : '到達見込みは計算できない', ...stopBase],
        priority: priority(2, 3, 1),
        caution: '途中経過の差を根拠に打ち切らない',
      });
    }
  }
  return H.sort((a, b) => b.priority.score - a.priority.score);
}

export function analyzeLpo(project) {
  const ds = project.lpo?.dataset;
  if (!ds) return { ok: false, message: 'LPOデータセットが未設定です（架空データを読み込んでください）', connections: CONNECTIONS };
  if (ds.fictional !== true) return { ok: false, message: '実データは扱いません（fictional: true の架空データのみ）', connections: CONNECTIONS };
  const analyses = ds.experiments.map(analyzeExperiment);
  const pairs = [];
  for (let i = 0; i < ds.experiments.length; i++) {
    for (let j = i + 1; j < ds.experiments.length; j++) {
      const c = comparability(ds.experiments[i], ds.experiments[j]);
      pairs.push({ a: ds.experiments[i].name, b: ds.experiments[j].name, ...c });
    }
  }
  return {
    ok: true, fictional: true, banner: `架空データ「${ds.name}」による分析です。実在の実績・計測結果ではありません。`,
    rules: LPO_RULES, connections: CONNECTIONS, analyses, crossPeriod: pairs, hypotheses: buildHypotheses(project, analyses),
  };
}
