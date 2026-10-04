// 架空の日本語会議の台本（fixture）。実在の会議・人物・顧客とは無関係。
// 各ステップは「その時点で人が話した内容の要約（参考表示）」と、適用するイベント列。
// AI が理解した結果ではなく、あらかじめ書かれた構造化データを順に流しているだけ。

export const DEMO_TITLE = '架空の会議：業務改善チーム定例（デモ用台本）';

const F = 'fixture';

/** @type {{ id: string, utterance: string, events: any[] }[]} */
export const DEMO_STEPS = [
  {
    id: 's01',
    utterance: '議長「今日はまず、週次定例のやり方から話しましょう」',
    events: [{ id: 'd-e01', type: 'topic.open', topicId: 't-format', title: '週次定例の開催形式', by: F }],
  },
  {
    id: 's02',
    utterance: 'Aさん「定例を全部オンラインにしてはどうでしょう」',
    events: [{ id: 'd-e02', type: 'item.add', by: F, item: { id: 'p-online', kind: 'proposal', text: '週次定例を全面オンラインに切り替える' } }],
  },
  {
    id: 's03',
    utterance: 'Aさん「移動だけで、チーム全体で週3時間くらい使っているので」',
    events: [{ id: 'd-e03', type: 'item.add', by: F, item: { id: 'r-travel', kind: 'reason', parentId: 'p-online', text: '会議室への移動にチーム全体で週あたり約3時間かかっている（参加者の自己申告）' } }],
  },
  {
    id: 's04',
    utterance: 'Bさん「ただ、オンラインだと新しい人が雑談で相談しにくくなりそうで心配です」',
    events: [{ id: 'd-e04', type: 'item.add', by: F, item: { id: 'c-newcomer', kind: 'concern', parentId: 'p-online', text: 'オンラインだと雑談が減り、新メンバーが相談しにくくなる' } }],
  },
  {
    id: 's05',
    utterance: 'Cさん「じゃあ月1回だけ対面にして、残りはオンラインは？」',
    events: [
      { id: 'd-e05', type: 'item.add', by: F, item: { id: 'p-hybrid', kind: 'proposal', text: '月1回だけ対面、残りはオンラインのハイブリッドにする' } },
      { id: 'd-e06', type: 'item.add', by: F, item: { id: 'x-room', kind: 'tradeoff', parentId: 'p-hybrid', text: '対面回は会議室予約の手間が残るが、関係づくりの機会は確保できる' } },
    ],
  },
  {
    id: 's06',
    utterance: 'Aさん「いいですね、じゃあハイブリッドでいきましょうか」（他の参加者の明確な同意はまだ無い）',
    events: [{ id: 'd-e07', type: 'item.add', by: F, item: { id: 'd-hybrid', kind: 'decision', text: 'ハイブリッド（月1回対面）で来月から試行する', note: '1名の発言のみ。全員の合意確認はまだ' } }],
  },
  {
    id: 's07',
    utterance: 'Bさん「対面の回を第何週にするかは決めないとですね」',
    events: [{ id: 'd-e08', type: 'item.add', by: F, item: { id: 'q-week', kind: 'open_question', text: '対面の回を毎月第何週にするか' } }],
  },
  {
    id: 's08',
    utterance: '議長「次、共有ドライブの整理について」',
    events: [{ id: 'd-e09', type: 'topic.open', topicId: 't-drive', title: '共有ドライブのフォルダ整理', by: F }],
  },
  {
    id: 's09',
    utterance: 'Cさん「プロジェクトごとのフォルダ構成に揃えたいです」',
    events: [{ id: 'd-e10', type: 'item.add', by: F, item: { id: 'p-folders', kind: 'proposal', text: 'プロジェクト単位のフォルダ構成に統一する' } }],
  },
  {
    id: 's10',
    utterance: 'Bさん「移すと過去資料のリンクが切れるリスクがありますね」',
    events: [{ id: 'd-e11', type: 'item.add', by: F, item: { id: 'c-links', kind: 'concern', parentId: 'p-folders', text: '移行で過去資料への共有リンクが切れる可能性がある' } }],
  },
  {
    id: 's11',
    utterance: '議長「まず今のフォルダ一覧を誰かが作る必要がありますね」（担当・期限は決まっていない）',
    events: [{ id: 'd-e12', type: 'item.add', by: F, item: { id: 'a-inventory', kind: 'action', text: '現行フォルダの一覧を作る', owner: null, due: null } }],
  },
  {
    id: 's12',
    utterance: 'Bさん「そういえば休憩室のコーヒー、豆を変えてから評判いいですよね」',
    events: [{ id: 'd-e13', type: 'topic.open', topicId: 't-coffee', title: '休憩室のコーヒーの話（脱線）', digression: true, by: F }],
  },
  {
    id: 's13',
    utterance: 'Cさん「あれ、どこで買ってるんでしたっけ」',
    events: [{ id: 'd-e14', type: 'item.add', by: F, item: { id: 'u-beans', kind: 'unclassified', text: 'コーヒー豆の購入先についての雑談（会議の論点か判別できないため要確認）' } }],
  },
  {
    id: 's14',
    utterance: '議長「話を戻して、定例の件でもう一点」',
    events: [{ id: 'd-e15', type: 'topic.switch', topicId: 't-format', by: F }],
  },
  {
    id: 's15',
    utterance: 'Bさん「月1対面だと、在宅の人の交通費精算が毎月発生しますよね」',
    events: [
      { id: 'd-e16', type: 'item.add', by: F, item: { id: 'c-cost', kind: 'concern', parentId: 'p-hybrid', text: '月1回の対面だと在宅勤務者の交通費精算が毎月発生する' } },
      { id: 'd-e17', type: 'decision.revisit', itemId: 'd-hybrid', by: F, reason: '交通費の懸念が出たため' },
    ],
  },
  {
    id: 's16',
    utterance: 'Aさん「すみません、さっきの週3時間は2週分の数字でした。週1.5時間です」',
    events: [{ id: 'd-e18', type: 'item.correct', itemId: 'r-travel', by: F, text: '会議室への移動にチーム全体で週あたり約1.5時間かかっている（参加者の自己申告）', reason: '発言者が「3時間は2週分だった」と訂正' }],
  },
  {
    id: 's17',
    utterance: '議長「交通費の扱いが決まっていないので、ハイブリッド試行案はいったん取り下げましょう」',
    events: [{ id: 'd-e19', type: 'decision.withdraw', itemId: 'd-hybrid', by: F, reason: '交通費の扱いが未決のため議長が取り下げ' }],
  },
  {
    id: 's18',
    utterance: 'Cさん「当面は全面オンラインにして、対面は四半期に1回を別に考えるのは？」',
    events: [{ id: 'd-e20', type: 'item.add', by: F, item: { id: 'd-online', kind: 'decision', text: '当面は全面オンライン。対面は四半期に1回を別途検討する' } }],
  },
  {
    id: 's19',
    utterance: '議長「この案で決定してよいですか」— 全員「異議なしです」',
    events: [{ id: 'd-e21', type: 'decision.confirm', itemId: 'd-online', by: F, evidence: { kind: 'explicit_agreement', note: '議長の確認に対し、出席者全員が「異議なし」と発言（台本上の設定）' } }],
  },
  {
    id: 's20',
    utterance: '議長「四半期の対面会の予算は次回決めましょう。交通費のルールは総務に確認が要りますね」',
    events: [
      { id: 'd-e22', type: 'item.add', by: F, item: { id: 'n-budget', kind: 'next', text: '四半期ごとの対面会の予算上限を決める' } },
      { id: 'd-e23', type: 'item.add', by: F, item: { id: 'q-expense', kind: 'open_question', text: '在宅勤務者の交通費精算ルール（総務への確認が必要）' } },
      { id: 'd-e24', type: 'item.resolve', itemId: 'q-week', by: F, reason: '全面オンライン案の確定により不要になった' },
    ],
  },
  {
    id: 's21',
    utterance: '議長「ドライブの件に戻ると、来月から新構成に移す方向で…」（誰も反対はしないが、確認もしていない）',
    events: [
      { id: 'd-e25', type: 'topic.switch', topicId: 't-drive', by: F },
      { id: 'd-e26', type: 'item.add', by: F, item: { id: 'd-folders', kind: 'decision', text: '来月からプロジェクト単位のフォルダ構成に移行する' } },
    ],
  },
  {
    id: 's22',
    utterance: '（沈黙。反対意見は出なかった）',
    events: [{ id: 'd-e27', type: 'decision.confirm', itemId: 'd-folders', by: F, evidence: { kind: 'silence', note: '反対意見が出なかった' } }],
  },
  {
    id: 's23',
    utterance: 'Bさん「リンク切れ対策は次回までに決めたいです。一覧は私がやります。期限は未定で」',
    events: [
      { id: 'd-e28', type: 'item.add', by: F, item: { id: 'n-links', kind: 'next', text: 'リンク切れ対策（リダイレクト用の案内ファイル等）をどうするか決める' } },
      { id: 'd-e29', type: 'action.update', itemId: 'a-inventory', by: F, owner: 'Bさん', due: null },
    ],
  },
];

export function allDemoEvents() {
  return DEMO_STEPS.flatMap((s) => s.events);
}
