// 架空の短い会議の台本。各ステップは「事前に用意した構造イベント」で、AI が発言を理解した結果ではない。
// 見せたいこと：話題の誕生 → 枝分かれ → 脱線 → 同じ話題への戻り → 訂正 → 新しい話題
// 実在の会議・人物・組織とは無関係。合意・担当・期限は作らない。

const F = 'fixture';
const add = (id, eid, text, parentId = null, label = null) => ({ id: eid, type: 'node.add', by: F, node: { id, parentId, text, label } });

/** @type {{ id: string, caption: string, utterance: string, events: any[] }[]} */
export const OUTLINE_DEMO_STEPS = [
  {
    id: 'o01', caption: '話題が生まれる',
    utterance: 'Aさん「社内勉強会、月1回でやってみませんか」',
    events: [add('n-study', 'oe01', '社内勉強会を月1回はじめる')],
  },
  {
    id: 'o02', caption: '枝が増える',
    utterance: 'Aさん「最初は昼休みの30分でどうでしょう」',
    events: [add('n-lunch', 'oe02', '昼休みの30分で試す', 'n-study')],
  },
  {
    id: 'o03', caption: '補足が付く',
    utterance: 'Bさん「それなら業務時間を圧迫しないので出やすいですね」',
    events: [add('n-lunch-why', 'oe03', '業務時間を圧迫しないので参加しやすい', 'n-lunch')],
  },
  {
    id: 'o04', caption: '枝分かれ（別の案）',
    utterance: 'Cさん「でも30分だと浅くなりませんか。夕方に1時間という手も」',
    events: [
      add('n-evening', 'oe04', '夕方に1時間とる', 'n-study', '対比'),
      add('n-evening-depth', 'oe05', '準備は増えるが、内容を深くできる', 'n-evening'),
    ],
  },
  {
    id: 'o05', caption: '脱線',
    utterance: 'Bさん「そういえば休憩室のコーヒー、豆が変わりましたね」',
    events: [
      add('n-coffee', 'oe06', '休憩室のコーヒーの豆が変わった', null, '脱線'),
    ],
  },
  {
    id: 'o06', caption: '同じ話題へ戻る（新しく作らず既存の枝に追記）',
    utterance: '議長「勉強会の話に戻ると、昼の回は録画もあると助かりますね」',
    events: [
      { id: 'oe07', type: 'node.focus', by: F, nodeId: 'n-lunch' },
      add('n-lunch-rec', 'oe08', '録画して後から見られるようにする', 'n-lunch'),
    ],
  },
  {
    id: 'o07', caption: '訂正（同じ項目を直し、変更履歴を残す）',
    utterance: 'Aさん「すみません、昼休みは45分でした。30分ではなく45分です」',
    events: [{ id: 'oe09', type: 'node.edit', by: F, nodeId: 'n-lunch', text: '昼休みの45分で試す', reason: '発言者が「30分ではなく45分」と訂正' }],
  },
  {
    id: 'o08', caption: '新しい話題が生まれる',
    utterance: 'Cさん「初回のテーマも考えたいです。新人向けにツールの使い方とか」',
    events: [
      add('n-first', 'oe10', '初回のテーマ'),
      add('n-first-tools', 'oe11', '新人向けに社内ツールの使い方', 'n-first'),
    ],
  },
  {
    id: 'o09', caption: '枝が増える（決まっていないことは決まっていないまま）',
    utterance: 'Bさん「候補はもう1つありますが、まだ決めなくていいと思います」',
    events: [add('n-first-other', 'oe12', 'もう1つ候補があるが、まだ決めていない', 'n-first')],
  },
];

export function allOutlineDemoEvents() {
  return OUTLINE_DEMO_STEPS.flatMap((s) => s.events);
}
