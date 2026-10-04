// @ts-check
/*
 * 画面に表示する文言と選択肢。ここに個人データは置かない。
 * 支援の使い方の案は既存サービスの組み合わせ方の例で、料金プランではない。
 */

/** @typedef {{ id: string, label: string }} Choice */
/** @typedef {{ id: 'goals'|'barriers'|'time'|'prefs'|'frequency', title: string, hint: string, multiple: boolean, choices: ReadonlyArray<Choice> }} NeedQuestion */
/** @typedef {{ id: 'coach'|'expert'|'community', title: string, summary: string, includes: ReadonlyArray<string>, confirm: ReadonlyArray<string>, questions: ReadonlyArray<string>, actions: ReadonlyArray<Choice> }} Route */

const PotexContent = (() => {
  const APP_NAME = 'POTEX 自己理解チェック';

  const DISCLAIMER =
    'IPIPの項目を参考に、独自の日本語訳と4択形式に変更した自己理解用の簡易分析です。この形式の信頼性・妥当性は未検証です。医療上の診断ではありません。';

  const PRIVACY_NOTE =
    '回答と選択は、この画面を開いているブラウザのメモリ内だけで扱います。送信・保存はしません。ページを再読み込みしたり閉じたりすると、すべて消えます。';

  const DEMO_NOTE =
    'これは公開デモです。本番の運用ではなく、POTEXの申し込みや相談の受付にはつながっていません。';

  /** 回答の選択肢（4択）。画面では上から「当てはまる」の順に並べる。中立の選択肢はない。 */
  const SCALE = Object.freeze([
    { value: 4, label: '当てはまる' },
    { value: 3, label: 'やや当てはまる' },
    { value: 2, label: 'あまり当てはまらない' },
    { value: 1, label: '当てはまらない' },
  ]);

  /**
   * 因子の表示情報。low / high は 1 側と 4 側の言葉で、どちらにも優劣はない。
   */
  const FACTORS = Object.freeze({
    E: {
      name: '外向性',
      low: '静かな場や少人数で力を出しやすい',
      high: '人と関わる場から活力を得やすい',
      note: '',
      reflections: [
        '人と話したあとは元気が出ますか。それとも一人の時間で回復しますか。',
        '振り返りは、人と話しながらと一人で書きながらの、どちらが進みやすいですか。',
      ],
    },
    A: {
      name: '協調性',
      low: '自分の考えを率直に優先しやすい',
      high: '相手の気持ちに寄り添いやすい',
      note: '',
      reflections: [
        '人の気持ちを優先して、自分の目標が後回しになることはありますか。',
        '人から意見をもらうとき、どんな伝え方だと受け取りやすいですか。',
      ],
    },
    C: {
      name: '誠実性',
      low: 'その場に合わせて柔軟に進めやすい',
      high: '計画を立て、整えながら進めやすい',
      note: '',
      reflections: [
        '計画を立ててから動くのと、まず動いてみるのとでは、どちらが続きやすいですか。',
        '途中で止まりやすいのは、始めるときと続けるときのどちらですか。',
      ],
    },
    N: {
      name: '感情の揺れやすさ（神経症傾向）',
      low: '気分が比較的おだやかに保たれやすい',
      high: '気分や緊張の変化を感じとりやすい',
      note: '値が大きいほど、気分が揺れやすい方向です。良い・悪いを表すものではありません。つらい状態が続くときは、身近な人や医療機関などの専門家に相談することも選択肢です。',
      reflections: [
        '気持ちが揺れたとき、どんな支えがあると立て直しやすいですか。',
        '忙しい時期でも続けられそうな、小さな取り組みは何ですか。',
      ],
    },
    O: {
      name: '開放性（想像力・抽象的な関心）',
      low: '具体的で実際的なことに関心が向きやすい',
      high: '想像や抽象的なアイデアに関心が向きやすい',
      note: '想像力や抽象的なことへの関心の向きを表します。知能の高さを表すものではありません。',
      reflections: [
        '新しいやり方を試すのと、確かなやり方を続けるのとでは、今はどちらが合っていますか。',
        '学ぶときは、具体例からと全体像からの、どちらが入りやすいですか。',
      ],
    },
  });

  const UNCERTAINTY_NOTE =
    '結果は自己回答に基づく、その時点の傾向です。各観点は4問だけの短い簡易分析で、原版の5段階を4択に変えた独自の形式のため、標準版の Mini-IPIP や検証済みの日本語版の得点とは比べられません。同じ人でも、その日の気分や質問の受け取り方で数値は動きます。小さな差にはこだわらず、振り返りのきっかけとしてお使いください。';

  /** @type {ReadonlyArray<NeedQuestion>} */
  const NEEDS = Object.freeze([
    {
      id: 'goals',
      title: '取り組みたいテーマ',
      hint: '当てはまるものをいくつでも選べます。',
      multiple: true,
      choices: [
        { id: 'career', label: '仕事・キャリア' },
        { id: 'business', label: '事業・副業' },
        { id: 'sns', label: 'SNS・発信' },
        { id: 'english', label: '英語' },
        { id: 'habit', label: '学ぶ習慣・自己管理' },
        { id: 'unsure', label: 'まだはっきりしない' },
      ],
    },
    {
      id: 'barriers',
      title: 'いま、進めにくいと感じること',
      hint: '当てはまるものをいくつでも選べます。',
      multiple: true,
      choices: [
        { id: 'procrastinate', label: '一人だと後回しになりやすい' },
        { id: 'start', label: '何から始めればよいか分からない' },
        { id: 'expertise', label: '専門的な知識ややり方が分からない' },
        { id: 'time', label: '時間が足りない' },
        { id: 'alone', label: '相談相手や仲間がいない' },
        { id: 'none', label: '特にない・分からない' },
      ],
    },
    {
      id: 'time',
      title: '1週間に使えそうな時間',
      hint: '1つ選べます。',
      multiple: false,
      choices: [
        { id: 'lt1', label: '週1時間未満' },
        { id: '1to3', label: '週1〜3時間' },
        { id: '3to7', label: '週3〜7時間' },
        { id: 'gt7', label: '週7時間以上' },
        { id: 'unsure', label: 'まだ分からない' },
      ],
    },
    {
      id: 'prefs',
      title: '支援の受け方の好み',
      hint: '当てはまるものをいくつでも選べます。',
      multiple: true,
      choices: [
        { id: 'review', label: '人と定期的に振り返りたい' },
        { id: 'expert', label: '専門的なことを具体的に聞きたい' },
        { id: 'materials', label: '教材で自分のペースで学びたい' },
        { id: 'peers', label: '仲間と一緒に取り組みたい' },
        { id: 'solo', label: '一人で集中する時間がほしい' },
        { id: 'unsure', label: 'まだ分からない' },
      ],
    },
    {
      id: 'frequency',
      title: '続けやすそうな振り返りの間隔',
      hint: '1つ選べます。',
      multiple: false,
      choices: [
        { id: 'daily', label: '毎日少しずつ' },
        { id: 'weekly', label: '週1回くらい' },
        { id: 'monthly', label: '月に数回' },
        { id: 'asneeded', label: '必要なときだけ' },
        { id: 'unsure', label: 'まだ分からない' },
      ],
    },
  ]);

  /** @type {ReadonlyArray<Route>} 並び順は固定で、評価順ではない。 */
  const ROUTES = Object.freeze([
    {
      id: 'coach',
      title: '個別伴走を中心に進める',
      summary: '担当者と目標を決め、定期的に振り返りながら進める使い方です。',
      includes: ['目標設計', '個別セッション', '日常のフィードバック', '習慣の記録'],
      confirm: [
        '個別セッションの頻度、フィードバックや記録の方法、期間は契約内容によって異なります。',
      ],
      questions: [
        '人と一緒に振り返るほうが進みそうですか。',
        'どのくらいの頻度なら無理なく続けられそうですか。',
        'フィードバックは、どんな伝え方だと受け取りやすいですか。',
      ],
      actions: [
        { id: 'coach-frequency', label: '続けやすい振り返りの頻度（例：週1回）を1つ決めて、相談のときに伝える' },
        { id: 'coach-goal', label: '今週の目標を1つだけ、手元の紙やメモに書く' },
        { id: 'coach-habit', label: '続けたい習慣を1つ選び、3日間だけ記録してみる' },
      ],
    },
    {
      id: 'expert',
      title: '専門的な課題を解く支援を中心に進める',
      summary: '担当コーチと課題を整理し、必要に応じて専門的な相談や教材を使う使い方です。',
      includes: [
        '担当コーチとの課題整理',
        '必要に応じた専門スポット相談',
        '教材・テーマ別ワークショップ',
      ],
      confirm: [
        '扱える専門分野、空き枠、追加料金の有無、相談できる回数は事前の確認が必要です。',
        'SNS・事業・キャリア・英語などのテーマは、対応できる担当者がいるかを確認してください。',
        '成果や、すべての相談が無料であることを約束するものではありません。',
      ],
      questions: [
        'いちばん解きたい具体的な課題は何ですか。',
        '専門家に聞きたいことを1つ挙げるなら、何ですか。',
      ],
      actions: [
        { id: 'expert-problem', label: 'いちばん解きたい課題を、手元のメモに一文で書き出す' },
        { id: 'expert-questions', label: '専門家に聞きたい質問を3つ書き出す' },
        { id: 'expert-check', label: '相談したいテーマに対応できる担当者がいるか、確認したいことを整理する' },
      ],
    },
    {
      id: 'community',
      title: '学習と仲間の環境を活用して進める',
      summary: '教材、集中して取り組む時間、コミュニティの場を、自分のペースで使う使い方です。',
      includes: [
        '教材',
        'DeepWork（集中して取り組む時間）',
        'Discordのコミュニティ',
        'オンライン交流会・ワークショップ',
        '必要に応じた個別支援',
      ],
      confirm: [
        '開催頻度、教材の提供範囲、卒業後に使える範囲は契約ごとに確認が必要です。',
        '参加・発言・交流はすべて任意です。一人で集中する使い方もできます。',
      ],
      questions: [
        '仲間がいると続けやすいですか。それとも一人の時間が大切ですか。',
        '1週間のうち、どの時間なら集中の時間をとれそうですか。',
      ],
      actions: [
        { id: 'community-focus', label: '週に1回、25分だけ集中する時間を自分の予定に入れる' },
        { id: 'community-material', label: '最初に取り組みたい学習テーマを1つ決める' },
        { id: 'community-observe', label: 'コミュニティの場を、まずは見るだけで試してみる（発言は任意）' },
      ],
    },
  ]);

  /** ルートを決めていないときにも選べる行動。 */
  const GENERAL_ACTIONS = Object.freeze([
    { id: 'general-compare', label: '3つの使い方のうち、気になる点を1つ手元に書き出す' },
    { id: 'general-time', label: '1週間、取り組みに使えた時間をざっくり振り返る' },
  ]);

  const ROUTE_NOTICE = [
    '以下は、POTEXの既存サービスの組み合わせ方の案です。新しい料金プランではなく、提供内容や条件を約束するものでもありません。',
    '価格、提供の可否、回数や頻度は、契約内容と担当者にご確認ください。',
    '性格チェックの結果は、この案の並び順や理由づけには使っていません。並び順は固定で、どの案もいつでも選べます。',
  ];

  const CONSULT_STATUS = '相談窓口は準備中です';
  const CONSULT_DETAIL =
    'この公開デモからは、予約・送信・お問い合わせはできません。リンクや送信フォームは用意していません。';

  const REFERENCES = Object.freeze([
    {
      label: 'Mini-IPIP の採点キー（IPIP）',
      url: 'https://ipip.ori.org/MiniIPIPKey.htm',
    },
    {
      label: 'IPIP の利用許諾について',
      url: 'https://ipip.ori.org/newPermission.htm',
    },
    {
      label: 'IPIP の採点方法について',
      url: 'https://ipip.ori.org/newScoringInstructions.htm',
    },
  ]);

  const CITATION =
    'Donnellan, M. B., Oswald, F. L., Baird, B. M., & Lucas, R. E. (2006). The Mini-IPIP scales: Tiny-yet-effective measures of the Big Five factors of personality. Psychological Assessment, 18, 192–203.';

  const SOURCE_NOTES = [
    '質問は、Mini-IPIP の20項目を参考にした POTEX 向けの独自の日本語訳です。IPIP の項目はパブリックドメインで、翻訳して使うことが認められています。',
    '回答は原版の5段階ではなく、独自に変更した4択（当てはまる〜当てはまらない）です。標準版の Mini-IPIP でも、検証済みの日本語版でもありません。',
    '原著で報告された信頼性などの数値は英語版の5段階形式についてのもので、この日本語訳と4択形式の精度を示すものではありません。',
  ];

  return Object.freeze({
    APP_NAME,
    DISCLAIMER,
    PRIVACY_NOTE,
    DEMO_NOTE,
    SCALE,
    FACTORS,
    UNCERTAINTY_NOTE,
    NEEDS,
    ROUTES,
    GENERAL_ACTIONS,
    ROUTE_NOTICE,
    CONSULT_STATUS,
    CONSULT_DETAIL,
    REFERENCES,
    CITATION,
    SOURCE_NOTES,
  });
})();
