# -*- coding: utf-8 -*-
"""people_raw.json（評価シートから抽出）＋ 1on1の実績を merge して
   claude-hub/data/people.json を作る。"""
import io, json, os

SRC = 'people_raw.json'
DST = r'C:\Users\kk29s\claude-hub\data\people.json'
SHEET = 'https://claude.ai/artifact/URuNCNyKwtmLz5ZUJPpK8f'

NAMES = {
    '1-1': '期日と責任の徹底', '1-2': '言行一致', '1-3': 'ルールの徹底', '1-4': '真摯',
    '2-1': '誰よりも考える', '2-2': '高い目標を掲げる', '2-3': '率直', '2-4': 'ロジカル',
    '3-1': '協力', '3-2': 'カルチャー理解と発信', '3-3': '仕組み化', '3-4': 'コスト意識',
    '4-1': '柔軟性', '4-2': '自責', '4-3': '継続', '4-4': '自律',
}

ONE = {
    '山元慎也': dict(
        date='2026-09-17', rec='記録なし（代表からの口頭共有を反映）',
        goals=['役員と肩を並べる（直近の目標）',
               '3ヶ月後の評価で +0.5点（3.69 → 4.19）',
               'チームを組成して事業部のマネジメントができる状態（営業代行・SNS代行会社・広告運用チームなど）'],
        focus='1-1 期日と責任の徹底',
        why='+0.5 は16項目の合計で +8.0点。下位3項目を全社平均まで直しても +0.23 にしかならず、'
            '2点台を5点「良い」まで持ち上げて初めて +0.48。つまり目標の中身は 1-1 を 2.00→5.00 に動かすこと。',
        hooks=['現在のG8層は 4.23〜5.16。+0.5 ＝ 4.19 はその下端にほぼ並ぶ＝「役員と肩を並べる」の数字の定義',
               '3ヶ月ごとに +0.5 を2回で 4.69。G6基準 4.75 まで残り 0.06',
               'チーム組成は会社の既決方針（SNS外注化・営業デリバリー分離・専門職分岐 9/25実装）と重なる。オーナーを渡せる'],
        carry=['上司コメントの「普段の言動・行動でのネガティブマインド」に本人が一度も触れていない',
               '同僚2人が別の言い方で「リーダー業務に時間を割けていない／何でも屋」と書いている']),
    '加藤瞭': dict(
        date='2026-09-16', rec='記録なし（未取得）',
        goals=[],
        focus='3-3 仕組み化（推奨・未合意）',
        why='2-2 高い目標（2.00・最低項目）は本人が「この3ヶ月では採点不能という解釈」と反論しており、'
            '正面から入ると点数の議論になる。3-3 はガントチャート・AIエージェント壁打ちという着手済みの具体があり、'
            '上司の要求（モック持参で提案）がそのまま行動になる。',
        hooks=['自己5.00／他者3.68、乖離 +1.32。13人中3人だけの「⚠過大評価」判定',
               '4-3 継続（＝日報の提出）は上司コメントで名指し。解釈の余地がない唯一の項目',
               '2-2 は上司3人が 2.00、同僚2人が 4.50。同僚は外れ値として集計から除外済み'],
        carry=['9/16の1on1の記録が Circleback・ドライブ・vault のどこにもない。まず内容を確認する']),
    '土屋良之': dict(
        date='2026-09-17', rec='Circleback に全文（39分）',
        goals=['EXTAGEが100億を達成したあと、子会社の社長として独立',
               '報告を「売上・利益／顧客満足度／採用」の3軸から下ろす'],
        focus='2-4 ロジカル',
        why='報告の型そのものは1on1で具体化した（Notionで課題リストを3軸タグ付け → AIにFB → 田原・福田に確認）。'
            '器はもう手元にあるので、残るのは中身の論理＝2-4。本人も「売上から下ろして考える力が全然足りていない」と自認した。',
        hooks=['「100億の社長は結構多い。それよりはって言ってほしい」と代表が上に押し返した',
               '面談で順位を「3、4番ぐらい」と発言。実際は13人中8位（3.10）。現在地が伝わっていない可能性'],
        actions=['細川さんとの1on1で、本人のビジョンと業務の繋がりを毎回いちばん最初に再確認する',
                 'ロープレを録画して Google Docs に貯め、代表が確認する',
                 '報告用の課題リストを Notion で作成し、AIにFBをもらう（3軸でタグ付け）'],
        carry=['4-4 自律 2.91（全社平均▲1.16・16項目で差が最大）は9/17で未着手',
               '1-2 言行一致 2.45（13人中11位）は9/17で未着手',
               '伸ばす一点の合意が記録に残っていない']),
}

d = json.load(io.open(SRC, encoding='utf-8'))
AVG = d['avg']
out = []
for p in d['people']:
    sc = p['scores']
    low = sorted(sc.items(), key=lambda x: x[1])[:3]
    # 下位3項目を 5.00「良い」まで上げたら総合が何点動くか
    lift = round(sum(5.00 - v for _, v in low) / 16, 2)
    need = float(p['gap']) if p['gap'] else None
    if need is None:
        verdict = ''
    elif lift >= need:
        verdict = '下位3項目を5点まで上げるだけで昇格基準に届く'
    else:
        verdict = '下位3項目を5点にしても足りない。'\
                  '残り {:.2f} 点は他の項目で取る必要がある'.format(round(need - lift, 2))
    out.append(dict(
        name=p['name'], grade=p['grade'], role=p['role'], team=p['team'],
        boss=p['boss'], joined=p['joined'],
        rank=p['rank'], total=p['total'], judge=p['judge'], raters=p['raters'],
        selfScore=p['self'], selfGap=p['selfGap'], objVerdict=p['objVerdict'],
        worst=p['worst'], worstGap=p['worstGap'],
        nextGrade=p['nextGrade'], bar=p['bar'], gap=p['gap'],
        scores=sc, deltas=p['deltas'],
        low3=[dict(c=c, n=NAMES[c], v=v, d=round(v - AVG[c], 2)) for c, v in low],
        lift3=lift, liftNote=verdict,
        strong=p['strong'], grow=p['grow'],
        vision=dict(half=p['half'], years=p['years'], support=p['support']),
        one=ONE.get(p['name'])))

doc = dict(
    asOf='2026-09-18',
    term='2026年6月期（初回・6期Q1）',
    biz='EXTAGE',
    sheetUrl=SHEET,
    avg=AVG, names=NAMES,
    method='上司1.5・同僚1の加重平均。自己評価は総合に含めない。上司平均から±1.5を超える同僚評価は除外。'
           '総合は16項目の単純平均。全社平均 3.47・対象13名・回答73件（上司40／同僚20／自己13）。',
    source='Googleスプレッドシート「【EXTAGE】人事評価（2026年6月期）」（最終更新 2026-09-16、取得 2026-09-18）／'
           'Circleback「1ON1_土屋さん」（2026-09-17）',
    people=out)

os.makedirs(os.path.dirname(DST), exist_ok=True)
io.open(DST, 'w', encoding='utf-8').write(json.dumps(doc, ensure_ascii=False, indent=1))
print('wrote', DST, len(out), 'people')
for p in out[:13]:
    print(' ', p['rank'], p['name'], p['total'], '→', p['nextGrade'], 'あと', p['gap'],
          '| lift3', p['lift3'], '|', p['liftNote'][:38])
