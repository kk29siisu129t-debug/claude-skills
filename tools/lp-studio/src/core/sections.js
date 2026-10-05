// セクションカタログと、参考構成に基づくセクション計画。
// 参考: startdash.potex.jp/intro_ut の観察済みの流れ（依頼文の記述に基づく。元の文言は持ち込まない）
// FV → 任意のコンセプト動画 → 共感 → リフレーム/比較 → 解決策の起源/差別化 → ステップ → 提供範囲
// → 再コミット → 根拠 → 価格の理由 → 適合条件 → 未来のクロージング → フッター

export const BRIEF_KEYS = [
  'product', 'audience', 'problem', 'promise', 'offer', 'price', 'ctaLabel', 'ctaUrl', 'tone', 'operator',
];

export const BRIEF_LABELS = {
  product: '商材',
  audience: '対象者',
  problem: '課題',
  promise: '約束する価値',
  offer: 'オファー（条件）',
  price: '価格',
  ctaLabel: 'CTA文言',
  ctaUrl: 'CTAリンク先',
  tone: 'トーン',
  operator: '運営者表記',
};

export const SECTION_CATALOG = {
  fv: {
    label: 'FV（ファーストビュー）',
    role: '誰の・どんな状態を・どう変えるかを3秒で伝え、最初のCTAを置く',
    rationale: '参考構成の起点。FV直下で離脱するかが全体の分母を決める',
    required: true,
    needs: ['audience', 'promise', 'ctaLabel', 'ctaUrl'],
    claimProne: true,
  },
  concept_video: {
    label: 'コンセプト動画（任意）',
    role: '世界観を短時間で伝える。素材がある場合だけ置く',
    rationale: '参考構成ではFV直後に任意で置かれている。素材が無いなら置かない',
    required: false,
    needs: [],
    claimProne: false,
  },
  empathy: {
    label: '共感',
    role: '対象者の現状の痛みを本人の言葉で言語化する',
    rationale: '「自分のことだ」と思わせる段。課題の解像度が低いと以降が他人事になる',
    required: true,
    needs: ['audience', 'problem'],
    claimProne: false,
  },
  reframe: {
    label: 'リフレーム / 比較',
    role: 'うまくいかない理由を捉え直し、従来の方法と比較する',
    rationale: '共感の直後に「原因の置き場所」を変えると、解決策を聞く理由が生まれる',
    required: true,
    needs: ['problem'],
    claimProne: true,
  },
  origin: {
    label: '解決策の起源 / 差別化',
    role: 'なぜこの解決策が生まれたか、何が違うかを示す',
    rationale: 'リフレームで生まれた問いに、この商材ならではの答えを出す段',
    required: true,
    needs: ['product', 'promise'],
    claimProne: true,
  },
  steps: {
    label: 'ステップ',
    role: '申込後に何が起きるかを手順で見せ、不安を減らす',
    rationale: '行動のハードルを下げる。参考構成でも提供範囲の前に置かれる',
    required: true,
    needs: ['product'],
    claimProne: false,
  },
  scope: {
    label: '提供範囲',
    role: '含むもの / 含まないものを明示する',
    rationale: '期待値を揃え、誤認を防ぐ（有利誤認の予防にもなる）',
    required: true,
    needs: ['product', 'offer'],
    claimProne: true,
  },
  recommit: {
    label: '再コミット（中間CTA）',
    role: 'ここまでの要点を一文で束ね、もう一度行動を促す',
    rationale: '長いLPの中間で決めた人を取りこぼさない',
    required: false,
    needs: ['promise', 'ctaLabel'],
    claimProne: true,
  },
  proof: {
    label: '根拠',
    role: '検証済みの事実・出典だけで主張を支える',
    rationale: '参考の品質目標（実績カード/図解）。ただし検証済みevidenceのみ公開する',
    required: true,
    needs: [],
    needsEvidence: true,
    claimProne: true,
  },
  price_reason: {
    label: '価格 / 条件の理由',
    role: '価格やオファー条件がなぜその設定なのかを説明する',
    rationale: '価格への疑問を先回りして解く。比較価格は根拠が無ければ出さない',
    required: false,
    needs: ['offer', 'price'],
    claimProne: true,
  },
  fit: {
    label: '適合条件',
    role: '向いている人 / 向いていない人を明示する',
    rationale: '合わない人を先に外すことで、申込後のミスマッチと不信を減らす',
    required: true,
    needs: ['audience'],
    claimProne: true,
  },
  closing: {
    label: '未来のクロージング',
    role: '行動した後の状態を描き、最後のCTAを置く',
    rationale: '参考構成の終盤。約束する価値と同じ言葉で閉じる',
    required: true,
    needs: ['promise', 'ctaLabel', 'ctaUrl'],
    claimProne: true,
  },
  footer: {
    label: 'フッター',
    role: '運営者表記・注記',
    rationale: '運営者表記が確定していないページは公開しない',
    required: true,
    needs: ['operator'],
    claimProne: false,
  },
};

export const SECTION_TYPES = Object.keys(SECTION_CATALOG);
export const DEFAULT_ORDER = SECTION_TYPES.filter((t) => t !== 'concept_video');
export const SECTION_FIELDS = ['heading', 'lead', 'body', 'items', 'itemsAlt', 'note'];

/**
 * セクション計画: 各セクションの役割・根拠・不足情報を返す。
 */
export function planSections(project) {
  const brief = project.brief || {};
  const evidence = project.evidence || [];
  const verified = evidence.filter((e) => e.status === 'verified');
  return (project.sections || []).map((s, index) => {
    const meta = SECTION_CATALOG[s.type];
    const missing = [];
    for (const key of meta.needs) {
      const f = brief[key];
      if (!f || f.status === 'missing' || !String(f.value || '').trim()) {
        missing.push({ key, label: BRIEF_LABELS[key], level: 'missing' });
      } else if (f.status !== 'confirmed') {
        missing.push({ key, label: BRIEF_LABELS[key], level: 'unconfirmed' });
      }
    }
    if (meta.needsEvidence && verified.length === 0) {
      missing.push({ key: 'evidence', label: '検証済みの根拠', level: 'missing' });
    }
    if (s.type === 'concept_video' && !s.fields?.body) {
      missing.push({ key: 'video', label: '動画素材（未設定なら外す）', level: 'missing' });
    }
    return {
      index,
      id: s.id,
      type: s.type,
      label: meta.label,
      role: meta.role,
      rationale: meta.rationale,
      required: meta.required,
      approved: !!s.approved,
      needsReview: !!s.needsReview,
      origin: s.origin,
      missing,
    };
  });
}
