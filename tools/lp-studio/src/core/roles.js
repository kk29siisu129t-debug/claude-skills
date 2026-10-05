// v2 のセクション役割カタログ。参考構成の流れは「候補」であり、全商材に強制しない。
// 生成側（Claude Code）が、入力の事実と読者の疑問に合わせて役割を選ぶ。

export const ROLES = {
  hero: {
    label: 'FV',
    purpose: '誰の・どの場面の詰まりを・どう手伝うかと、次の行動を短く伝える',
    required: true,
    angleDependent: true,
  },
  empathy: {
    label: '共感（場面）',
    purpose: '読者が止まる場面を具体的に描く。顧客の原文が無ければ引用・吹き出しにしない',
    required: false,
    angleDependent: true,
  },
  mechanism: {
    label: '仕組み',
    purpose: '何を受け取り、誰と何を、どの順序・頻度で進めるかを示す',
    required: false,
    angleDependent: true,
  },
  illustration: {
    label: '図解（説明用の例）',
    purpose: '仕組みが分かる具体的な例を示す。例であって成果の証拠ではない',
    required: false,
    angleDependent: true,
  },
  process: {
    label: '流れ',
    purpose: '申込後・利用時に何がどの順で起きるかを示す',
    required: false,
    angleDependent: false,
  },
  scope: {
    label: '提供範囲',
    purpose: 'できること・しないことを明示し、誤解を防ぐ',
    required: false,
    angleDependent: false,
  },
  faq: {
    label: 'よくある質問',
    purpose: 'この商材で起きやすい誤解を解く（任意。全商材に強制しない）',
    required: false,
    angleDependent: false,
  },
  proof: {
    label: '根拠',
    purpose: '実在・検証済み・公開同意のある根拠だけを示す。合成データ・説明用の例は出さない',
    required: false,
    angleDependent: true,
  },
  fit: {
    label: '適合条件',
    purpose: '読者が自分で判定できる条件文で、向く・向かないを示す',
    required: false,
    angleDependent: true,
  },
  closing: {
    label: '締め',
    purpose: '最初の行動と、その後に何が起きるかを示す',
    required: true,
    angleDependent: true,
  },
};

export const ROLE_IDS = Object.keys(ROLES);
export const ANGLE_DEPENDENT = ROLE_IDS.filter((r) => ROLES[r].angleDependent);
