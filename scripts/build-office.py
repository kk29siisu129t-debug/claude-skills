# -*- coding: utf-8 -*-
"""
claude-hub/scripts/build-office.py

会社ごとのバーチャルオフィス。上部のタブで8社を切り替え、
その会社に関わっている人格・課題・成果物を1画面で見せる。

  python scripts/build-office.py [出力パス]
"""
import io
import re, os, sys, json, re, base64, datetime

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREWD = os.path.join(HUB, 'data', 'crew')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HUB, 'office.html')
# 既定はビルドした瞬間の時刻。固定値にしていたため、ページの日付が何日も止まって見えていた（2026-09-04）
NOW = os.environ.get('OFFICE_NOW') or datetime.datetime.now().astimezone().replace(microsecond=0).isoformat()

MEMBERS = [
    ('chief-of-staff', '秘書くん',      'No.2',       'bob',   '#E86A3F', '#3A2A22', 'bag'),
    ('sales',          '営業くん',      '営業',       'band',  '#D8434A', '#4A2018', 'flag'),
    ('marketing',      'マーケくん',    'マーケ',     'tail',  '#3E8FBF', '#7A4A22', 'map'),
    ('planning',       '財務くん',      '経営企画',   'long',  '#C79A2E', '#3A2A1E', 'ledger'),
    ('product',        'プロダクトくん', 'プロダクト', 'cap',   '#43A06B', '#2A2620', 'kit'),
    ('hr',             '人事くん',      '人事',       'curl',  '#8E5FB5', '#4A2E1C', 'scroll'),
    ('kansayaku',      '鬼監査くん',    '監査役',     'spike', '#B03A2E', '#2A262E', 'sword'),
    ('reviewer',       '検品くん',      '品質審査',   'short', '#5B6B7C', '#33302C', 'glass'),
]
AXIS_OWNER = {'csat': 'product', 'hiring': 'hr', 'pl': 'planning'}
# バーチャルオフィスは全事業を出す。2026-09-09 の絞り込みは「代表のタスク」だけに適用する
BIZ_ORDER = ['POTEX', 'EXTAGE', 'Tクリニック', 'origin', 'passlabo',
             'エクソソーム', '失業保険', '補助金コンサル', 'MUSE', 'AI company']

ISS = json.load(io.open(os.path.join(HUB, 'data', 'issues.json'), encoding='utf-8'))

# 代表本人に残っている未完了アクション（Circleback の PENDING）。
# 事業ごとに「自分の手が止めているもの」を1画面で見せるために持つ
# 天気の根拠。課題の量ではなく業績が伸びているかで決める
_TP = os.path.join(HUB, 'data', 'trend.json')
TREND = json.load(io.open(_TP, encoding='utf-8')) if os.path.exists(_TP) else {'biz': {}}

# チェックして消した残タスク。queue と同じで、空で作り直すと消し込みが飛ぶ
_MDP = os.path.join(HUB, 'data', 'mytasks-done.json')
MTDONE = json.load(io.open(_MDP, encoding='utf-8')) if os.path.exists(_MDP) else []
# 本人のタスクではなかったもの。Circleback は発言者ではなく主催者に振るので大量に混ざる
_MNP = os.path.join(HUB, 'data', 'mytasks-notmine.json')
MTNOT = json.load(io.open(_MNP, encoding='utf-8')) if os.path.exists(_MNP) else {}

# 会議後タスク処理（meeting-task-sweep）が積む実行候補。代表が画面で選ぶまで実行しない
_PRP = os.path.join(HUB, 'data', 'proposals.json')
PROP = json.load(io.open(_PRP, encoding='utf-8')) if os.path.exists(_PRP) else {'items': []}
PROPS = PROP.get('items', [])
# 画面でついた「実行する／やらない」。queue と同じで、空で作り直すと選択が飛ぶ
_PDP = os.path.join(HUB, 'data', 'proposals-decided.json')
PRDEC = json.load(io.open(_PDP, encoding='utf-8')) if os.path.exists(_PDP) else {}

_MP = os.path.join(HUB, 'data', 'mytasks.json')
MYT = json.load(io.open(_MP, encoding='utf-8')) if os.path.exists(_MP) else {'tasks': []}
MYTASKS = MYT.get('tasks', [])
# 期限の近い順。期限なしは後ろ。同点なら発生日が古い順（放置が長い方を上に）
_TODAY = (os.environ.get('OFFICE_TODAY') or NOW[5:10])
def _tkey(t):
    return (0 if t.get('due') else 1, t.get('due') or '99-99', t.get('d') or '')
for t in MYTASKS:
    t['late'] = bool(t.get('due') and t['due'] < _TODAY)
# 宿題（判断が要らず、聞けば/作れば終わるもの）は順位に入れない。
# 2026-09-02、Tクリの1位に「代理店の一覧が無い」が出て「絶対些末」と指摘された
TODOS = [i for i in ISS['issues'] if i.get('kind') == 'todo']
ISS['issues'] = [i for i in ISS['issues'] if i.get('kind') != 'todo']


# 代表の席に届いた未処理の指示。ビルドし直しても消えないよう、ここから読む。
# 以前は queue=[] で作り直していたため、公開のたびに未処理分が消えていた（2026-09-01）
_QP = os.path.join(HUB, 'data', 'crew', 'queue.json')
QUEUE = json.load(io.open(_QP, encoding='utf-8')) if os.path.exists(_QP) else []
# 処理し終えた指示の目印。端末の控えから復活させないために持たせる
_QD = os.path.join(HUB, 'data', 'crew', 'queue-done.json')
QDONE = json.load(io.open(_QD, encoding='utf-8')) if os.path.exists(_QD) else []
WB = ISS['priority']['weights']
for it in ISS['issues']:
    w = WB.get(it['biz'], {})
    it['score'] = round(w.get(it['axis'], 1.0) * it['sev'] * it['urg'], 3)

runs = []
rp = os.path.join(CREWD, 'runs.jsonl')
if os.path.isfile(rp):
    for line in io.open(rp, encoding='utf-8'):
        line = line.strip()
        if line:
            try: runs.append(json.loads(line))
            except Exception: pass
# 稼働ログには2つの書き方が混ざっている。
#   旧: ts / status / detail   新: at / state / note
# ビルダーが旧しか読んでおらず、新しく書いた13件が丸ごと見えていなかった（2026-09-04 に発覚）。
# 消さずに、読むときに揃える。
def _norm(r):
    r.setdefault('ts', r.get('at', ''))
    r.setdefault('status', r.get('state', ''))
    r.setdefault('detail', r.get('note', ''))
    return r
runs = [_norm(r) for r in runs]
runs.sort(key=lambda r: r.get('ts', ''), reverse=True)
ALIAS = {'auditor': 'kansayaku', 'finance': 'planning'}
now = datetime.datetime.fromisoformat(NOW)


def ago(ts):
    try: d = now - datetime.datetime.fromisoformat(ts)
    except Exception: return ''
    s = int(d.total_seconds())
    if s < 0: return 'たった今'
    if s < 3600: return '%d分前' % (s // 60)
    if s < 86400: return '%d時間前' % (s // 3600)
    return '%d日前' % (s // 86400)


QP = os.path.join(HUB, 'data', 'quotes.json')
QUOTES = json.load(io.open(QP, encoding='utf-8'))['quotes'] if os.path.isfile(QP) else []

# メンバー（人事評価・1on1・360度評価）。無ければタブは出るが空になる
_PPL = os.path.join(HUB, 'data', 'people.json')
PEOPLE = json.load(io.open(_PPL, encoding='utf-8')) if os.path.exists(_PPL) else None

# ── 専門知識の質。稼働した回数ではなく、蓄積の中身で測る（2026-09-10 代表指摘）──
#    「動いたかどうかじゃなくて」＝ done や成果物の数は入れない
QUAL = [('型',       '再現できるやり方を持っている',           25),
        ('外した',   '外した事例を書いている（判断が校正される）', 30),
        ('確定',     '出した指摘が確定した',                   20),
        ('事業知識', '事業ごとの違いを知っている',              10),
        ('外部の型', '社外の型を当てて結果まで書いた',          40),
        ('未確認',   '出しっぱなしの指摘',                    -5)]
LV_MAX = 100
# Lv1=0 から Lv100 まで。指数を2.15にすると、いまの最上位（監査役455）がLv19に来る。
# 上限に張り付かず、上がり続ける余地が残る形にした（2026-09-11 代表指定）
LV_TABLE = [0] + [round(0.9 * (n - 1) ** 2.15) for n in range(2, LV_MAX + 1)]
TITLE_BAND = [(9, '見習い'), (19, '駆け出し'), (34, '一人前'), (49, '玄人'),
              (64, '目利き'), (79, '練達'), (94, '師範'), (99, '達人'), (100, '名人')]


def _title(lv):
    for top, name in TITLE_BAND:
        if lv <= top: return name
    return TITLE_BAND[-1][1]


def _lv(exp):
    n = 1
    for i, t in enumerate(LV_TABLE):
        if exp >= t: n = i + 1
        else: break
    nxt = LV_TABLE[n] if n < len(LV_TABLE) else None
    base = LV_TABLE[n - 1]
    pct = 100 if nxt is None else int((exp - base) / max(1, nxt - base) * 100)
    return n, nxt, max(0, min(100, pct))


def _cells(ln):
    if not ln.strip().startswith('|'): return None
    c = [x.strip() for x in ln.strip().strip('|').split('|')]
    if all(re.fullmatch(r'[-:—\s]*', x) for x in c): return None
    return c


def skill_of(slug):
    kb = os.path.join(CREWD, slug + '.md')
    v = dict(型=0, 確定=0, 未確認=0, 外した=0, 事業知識=0, 外部の型=0)
    if os.path.isfile(kb):
        t = io.open(kb, encoding='utf-8').read()
        v['型'] = len(re.findall(r'^###\s*型\s*\d+', t, re.M))
        name = None
        for ln in t.split(chr(10)):
            h = re.match(r'^##\s+(.+?)\s*$', ln)
            if h:
                name = h.group(1); continue
            c = _cells(ln)
            if not c or not name: continue
            if c[0] in ('日付', '事業', '') or c[0].startswith('—'): continue
            if '指摘の履歴' in name and len(c) >= 4:
                if '未確認' in c[3]: v['未確認'] += 1
                elif c[3] not in ('', '—'): v['確定'] += 1
            elif '外した事例' in name and len(c) >= 4 and c[1] not in ('', '—'):
                v['外した'] += 1
            elif '事業ごとの注意点' in name and len(c) >= 2 and c[1] not in ('', '—'):
                v['事業知識'] += 1
            elif '外部から取り込んだ型' in name and len(c) >= 5 and c[4] not in ('', '—', '結果'):
                v['外部の型'] += 1
    exp = sum(v[k] * w for k, _d, w in QUAL for kk in [k] if kk == k) if False else         sum(v[k] * w for k, _d, w in QUAL)
    lv, nxt, pct = _lv(exp)
    return dict(exp=exp, lv=lv, nxt=nxt, pct=pct, title=_title(lv), **v)

crew = {}
for slug, nick, role, hair, col, hairc, prop in MEMBERS:
    mine = [r for r in runs if ALIAS.get(r.get('crew'), r.get('crew')) == slug]
    last = mine[0] if mine else None
    open_task, stale = None, False
    seen = set()
    for r in mine:
        k = r.get('task', '')
        if r.get('status') == 'done': seen.add(k)
        elif r.get('status') == 'running' and k not in seen:
            open_task = r
            try: stale = (now - datetime.datetime.fromisoformat(r['ts'])).total_seconds() > 86400
            except Exception: stale = False
            break
    if not mine:              st, lb = 'never', '未起動'
    elif open_task and stale: st, lb = 'stale', '停滞'
    elif open_task:           st, lb = 'running', '作業中'
    elif last and last.get('status') == 'blocked': st, lb = 'blocked', '詰まり'
    else:                     st, lb = 'idle', '待機中'
    crew[slug] = dict(skill=skill_of(slug),
                      slug=slug, nick=nick, role=role, hair=hair, col=col, hairc=hairc,
                      prop=prop, state=st, label=lb, runs=len(mine),
                      task=(open_task or last or {}).get('task', ''),
                      ago=ago(last['ts']) if last else '')


def scan(rel, kind):
    d = os.path.join(HUB, *rel.split('/'))
    o = []
    if os.path.isdir(d):
        for f in sorted(os.listdir(d), reverse=True):
            if not f.startswith('.'):
                o.append(dict(kind=kind, name=f, path=rel + '/' + f))
    return o


_EP = os.path.join(HUB, 'data', 'enemies.json')
ENEMIES = json.load(io.open(_EP, encoding='utf-8')) if os.path.exists(_EP) else {}

ARTS = scan('content/drafts', '下書') + scan('reports', '報告') + scan('content/reviews', '審査')

# 会社ごとの内装。壁2色・床2色・ラグ。同じ系統の彩度に揃えて、並べても散らからないようにする
PALETTE = {
 'POTEX':      dict(wall='#C8C4DE', wall2='#A8A4C8', flrA='#DAD6E6', flrB='#CBC6DC', rug='232,112,63'),
 'EXTAGE':     dict(wall='#B6D2CE', wall2='#93B8B3', flrA='#D2E4E1', flrB='#C0D8D4', rug='38,120,110'),
 'Tクリニック':  dict(wall='#E0C3C8', wall2='#C79FA7', flrA='#F0DCDF', flrB='#E4CBD0', rug='176,74,88'),
 'origin':     dict(wall='#C2D6B4', wall2='#9FBA8E', flrA='#DCE8D2', flrB='#CBDCBF', rug='74,124,56'),
 'passlabo':   dict(wall='#E2D2A8', wall2='#C9B37E', flrA='#F0E6CC', flrB='#E5D8B8', rug='166,120,30'),
 'エクソソーム':  dict(wall='#D3C0D8', wall2='#B29AB9', flrA='#E8DCEC', flrB='#DCCDE1', rug='128,66,140'),
 '失業保険':     dict(wall='#BEC8D4', wall2='#98A6B6', flrA='#D8DFE8', flrB='#C8D2DE', rug='60,90,124'),
 '補助金コンサル': dict(wall='#D8CBAE', wall2='#B8A783', flrA='#E9E0C8', flrB='#DDD2B6', rug='140,106,42'),
 'MUSE':       dict(wall='#C6BEDE', wall2='#A199C4', flrA='#DEDAEE', flrB='#CFC9E4', rug='96,74,168'),
 'AI company': dict(wall='#B8CBDE', wall2='#92AAC4', flrA='#D4E2EE', flrB='#C2D5E6', rug='40,100,158'),
}
# 参考画面に寄せて、壁は生成りのベージュへ寄せる。会社の色は「どの部屋か分かる」分だけ残す
def _mix(hexc, warm, k):
    a = [int(hexc[i:i+2], 16) for i in (1, 3, 5)]
    b = [int(warm[i:i+2], 16) for i in (1, 3, 5)]
    return '#%02X%02X%02X' % tuple(round(a[i]*k + b[i]*(1-k)) for i in range(3))

for _p in PALETTE.values():
    _p['wall']  = _mix(_p['wall'],  '#EADAB8', .38)
    _p['wall2'] = _mix(_p['wall2'], '#D3BC93', .38)

DEFAULT_PAL = PALETTE['POTEX']

def weather(biz):
    """天気＝業績が伸びているか。課題の量は入れない。
    課題が見えていること自体は良いことなので、数が多い＝悪天候にはしない（2026-09-08 本人指示）。
    数字が取れていない事業は晴れにせず fog（測れていない）に落とす"""
    return (TREND.get('biz', {}).get(biz) or {}).get('wx', 'fog')


rooms = []
for biz in BIZ_ORDER:
    # 代表が優先度高と指定したもの（pin）は重みに関わらず先頭。重み自体は変えない
    items = sorted([i for i in ISS['issues'] if i['biz'] == biz],
                   key=lambda x: (not x.get('pin'), -x['score']))
    staff, seen = ['chief-of-staff'], {'chief-of-staff'}
    for it in items:
        s = AXIS_OWNER.get(it['axis'])
        if s and s not in seen:
            staff.append(s); seen.add(s)
    if any(i['axis'] == 'pl' for i in items) and 'sales' not in seen:
        staff.append('sales'); seen.add('sales')
    if any(i['axis'] == 'csat' for i in items) and 'marketing' not in seen:
        staff.append('marketing'); seen.add('marketing')
    if 'kansayaku' not in seen:
        staff.append('kansayaku')
    mine = sorted([t for t in MYTASKS if t['b'] == biz], key=_tkey)
    heavy = len([i for i in items if i['score'] >= 3])
    wx = weather(biz)
    rooms.append(dict(biz=biz, pal=PALETTE.get(biz, DEFAULT_PAL),
                      enemies=sorted(ENEMIES.get(biz, []), key=lambda e: -e.get('power', 0)),
                      order=WB.get(biz, {}).get('order', ''),
                      issues=items, staff=staff[:6], mine=mine,
                      wx=wx, heavy=heavy, tr=TREND.get('biz', {}).get(biz)))

_placed = set(BIZ_ORDER)
for _b in ['全社', '誤アサイン']:
    _m = sorted([t for t in MYTASKS if t['b'] == _b], key=_tkey)
    if _m:
        rooms.append(dict(biz=_b, pal=PALETTE.get('MUSE', DEFAULT_PAL),
                          order='' if _b == '全社' else 'Circleback の割り当てミス',
                          issues=[], staff=['chief-of-staff', 'kansayaku'], mine=_m,
                          wx='fine', heavy=0, tr=None))

STATE = dict(now=NOW, crew=crew, rooms=rooms, arts=ARTS, quotes=QUOTES, people=PEOPLE,
             myt=dict(asOf=MYT.get('asOf',''), window=MYT.get('window',''),
                      older=MYT.get('olderPending',''), total=len(MYTASKS)),
             mtDone=MTDONE, mtNot=MTNOT, props=PROPS, prDec=PRDEC,
             log=[dict(r, ago=ago(r.get('ts', ''))) for r in runs[:26]], queue=QUEUE, qDone=QDONE)

BODY = r"""<title>バーチャルオフィス</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Reggae+One&family=Zen+Maru+Gothic:wght@400;500;700&family=DotGothic16&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
/* ── ドラクエ8の見え方に寄せる ──────────────────────────────
   ①昼の空を背景に置いて部屋を浮かべる ②UIは白フチ・紺地の「コマンドウィンドウ」
   ③人物はセル調（太い輪郭＋光と影の2トーン）で解像度を上げる            */
:root{
 --sky1:#1E62B8;--sky2:#4FA6E8;--sky3:#A9DCF7;--sky4:#E6F5FF;
 --win:#0E1A44;--win2:#1B2E66;--winA:#16255C;--winB:#0A1231;
 --ink:#FFFFFF;--dim:#B9C8E8;--acc:#FFC24A;--gold:#FFD980;--stop:#FF7A5C;
 --line:rgba(255,255,255,.30);
 --wall:#C8C4DE;--wall2:#A8A4C8;--flrA:#DAD6E6;--flrB:#CBC6DC;
 --go:#7DE39B;--idle:#FFD35C;--never:#8EA0C0;
 --hi:#FF8A6B;--mid:#FFD35C;--lo:#7DE39B;}
*{box-sizing:border-box}
/* 横には動かさない。横に滑ると縦スクロールが取られる（2026-09-21 代表指摘）。
   タブの横スクロールだけは内側で閉じ、ページ側へ伝えない */
html{overflow-x:hidden}
body{overflow-x:hidden;overscroll-behavior-x:none;max-width:100vw}
/* .sum / .pn / .leftcol は display:flex を持つので、これが無いと hidden が効かない */
[hidden]{display:none!important}
html,body{height:100%}
body{margin:0;color:var(--ink);overflow-x:hidden;font-size:15px;
 font-family:"Zen Maru Gothic","Hiragino Maru Gothic ProN",system-ui,sans-serif;
 background:#0B1730;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}

/* ── コマンドウィンドウ ───────────────────────────────── */
.dqw{border:3px solid #fff;border-radius:12px;
 background:linear-gradient(165deg,var(--winA) 0%,var(--win) 55%,var(--winB) 100%);
 box-shadow:0 0 0 2px #04091C, 0 6px 18px rgba(0,0,0,.5),
  inset 0 1px 0 rgba(255,255,255,.28), inset 0 0 26px rgba(90,150,255,.14)}

/* ── 上のバー ─────────────────────────────────────── */
.bar{position:sticky;top:0;z-index:20;
 background:linear-gradient(180deg,#FFFDF6,#F2ECDE);
 border-bottom:3px solid #DACEB6;box-shadow:0 2px 12px rgba(70,52,24,.16)}
.bar1{display:flex;align-items:center;gap:14px;padding:9px 16px;flex-wrap:wrap}
.brand{font-family:"Reggae One",sans-serif;font-size:20px;letter-spacing:.06em;color:#6B4520}
.who{font-family:"DotGothic16",monospace;font-size:12px;color:#7A6A52;
 border:2px solid #DED3BC;border-radius:7px;padding:3px 9px;background:#FFF}
.pipe{display:flex;margin-left:auto;border:2px solid #DED3BC;border-radius:8px;overflow:hidden}
.pipe div{font-family:"DotGothic16",monospace;font-size:12px;padding:4px 11px;color:#7A6A52;
 border-right:1px solid #E8DFCB;background:#FFF}
.pipe div:last-child{border-right:none}
.pipe b{color:#C07A18;margin-right:5px}
.live{font-family:"DotGothic16",monospace;font-size:12px;color:#C0392B;white-space:nowrap}
.live i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#FF7A5C;
 margin-right:5px;box-shadow:0 0 8px #FF7A5C;animation:bl 1.4s ease-in-out infinite}
@keyframes bl{0%,100%{opacity:1}50%{opacity:.2}}
.tabrow{display:flex;align-items:center;gap:10px;padding-right:14px}
.tabhint{font-family:"IBM Plex Mono",monospace;font-size:10px;color:#8A7A60;
 border:1px solid #DED3BC;border-radius:4px;padding:2px 7px;white-space:nowrap;flex:none}
@media(max-width:760px){.tabhint{display:none}}
.tabs{display:flex;overflow-x:auto;padding:0 10px 4px;flex:1;min-width:0;scroll-behavior:smooth;gap:4px;
 overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
.tabs button{font-family:"Zen Maru Gothic",sans-serif;font-size:14px;background:#FFFCF4;
 border:2px solid #E3D9C4;border-radius:9px;
 color:#6B5A42;padding:7px 13px;cursor:pointer;white-space:nowrap;transition:.12s}
.tabs button:hover{color:#3A2C16;border-color:#C9B98F;background:#FFF}
.tabs button.on{color:#fff;font-weight:700;border-color:#12235A;
 background:linear-gradient(180deg,#2A4A9E,#12235A);box-shadow:0 3px 10px rgba(18,35,90,.3)}
.tabs button i,.tabs button u{font-style:normal;text-decoration:none;
 font-family:"IBM Plex Mono",monospace;font-size:11px;margin-left:5px;
 padding:1px 5px;border-radius:8px;background:#EFE7D6;color:#7A6A52}
.tabs button u{background:#F5F0E4;color:#8A7A60}
.tabs button.on i{background:#fff;color:#0E1A44}
.tabs button.on u{background:rgba(255,255,255,.22);color:#F0F5FF;font-weight:400}

/* ── 空とステージ ───────────────────────────────────── */
.wrap{position:relative;height:calc(100vh - 92px);min-height:600px;
 display:grid;grid-template-columns:286px minmax(0,1fr) 310px;grid-template-rows:minmax(0,1fr);
 gap:10px;padding:10px;
 background:linear-gradient(180deg,var(--sky1) 0%,var(--sky2) 34%,var(--sky3) 66%,var(--sky4) 100%);
 transition:background .4s linear}
/* 経営課題が重いほど空が悪くなる。晴れ→くもり→雨→雷雨 */
.wrap[data-wx="partly"]{--sky1:#2A72C0;--sky2:#63A9DE;--sky3:#B4CFE2;--sky4:#DCE7EE}
.wrap[data-wx="cloud"]{--sky1:#4C5C74;--sky2:#74869C;--sky3:#A6B3C2;--sky4:#CBD4DD}
.wrap[data-wx="rain"] {--sky1:#2E3A4C;--sky2:#4A5A70;--sky3:#6E7E92;--sky4:#8E9BAA}
.wrap[data-wx="storm"]{--sky1:#171E2C;--sky2:#2A3446;--sky3:#414D62;--sky4:#5A6579}
.wrap[data-wx="fog"]  {--sky1:#7E8894;--sky2:#98A2AC;--sky3:#B6BEC6;--sky4:#D2D8DC}
.wrap[data-wx="partly"] .sun{opacity:.7}
.wrap[data-wx="cloud"] .sun{opacity:.28}
.wrap[data-wx="rain"]  .sun{opacity:.10}
.wrap[data-wx="storm"] .sun{opacity:0}
.wrap[data-wx="fog"]   .sun{opacity:.35}
.wrap[data-wx="partly"] .cl span{background:#F2F5F8}
.wrap[data-wx="partly"] .cl{--cs:.72;opacity:.9}
.wrap[data-wx="cloud"] .cl span{background:#DFE4EA}
.wrap[data-wx="rain"]  .cl span{background:#9AA5B4}
.wrap[data-wx="storm"] .cl span{background:#6C7789}
.wrap[data-wx="cloud"] .cl{--cs:.8;opacity:.85}
.wrap[data-wx="rain"]  .cl{--cs:1;opacity:.95}
.wrap[data-wx="storm"] .cl{--cs:1.15;opacity:1}
.wrap[data-wx="partly"] .grd{filter:saturate(.85) brightness(.95)}
.wrap[data-wx="cloud"] .grd{filter:saturate(.55) brightness(.82)}
.wrap[data-wx="rain"]  .grd{filter:saturate(.4) brightness(.6)}
.wrap[data-wx="storm"] .grd{filter:saturate(.3) brightness(.42)}
.wrap[data-wx="fog"]   .grd{filter:saturate(.25) brightness(.85)}
.rn{position:absolute;inset:-10% -10% -16%;pointer-events:none;opacity:0;z-index:1;
 background:repeating-linear-gradient(102deg,rgba(255,255,255,.42) 0 1px,rgba(255,255,255,0) 1px 9px);
 background-size:auto 120px;animation:pour .5s linear infinite}
@keyframes pour{from{transform:translate(0,0)}to{transform:translate(-26px,120px)}}
.wrap[data-wx="rain"] .rn{opacity:.5}
.wrap[data-wx="storm"] .rn{opacity:.8;animation-duration:.32s}
.fg{position:absolute;inset:0;pointer-events:none;opacity:0;z-index:1;
 background:radial-gradient(120% 70% at 50% 78%,rgba(255,255,255,.75),rgba(255,255,255,0) 70%)}
.wrap[data-wx="fog"] .fg{opacity:1}
.fl{position:absolute;inset:0;pointer-events:none;background:#fff;opacity:0;z-index:1}
.wrap[data-wx="storm"] .fl{animation:bolt 7s linear infinite}
@keyframes bolt{0%,88%,100%{opacity:0}89%{opacity:.55}90.5%{opacity:0}92%{opacity:.35}93%{opacity:0}}
@media (prefers-reduced-motion:reduce){.rn,.wrap[data-wx="storm"] .fl{animation:none}}
.sun{position:absolute;left:16%;top:6%;width:340px;height:340px;border-radius:50%;pointer-events:none;
 background:radial-gradient(circle,rgba(255,255,225,.85) 0%,rgba(255,240,180,.35) 32%,rgba(255,240,180,0) 68%)}
.cl{position:absolute;left:0;pointer-events:none;opacity:.55;z-index:0;--cs:.5;
 transform-origin:0 0;transform:translateX(-24vw) scale(var(--cs))}
.cl span{position:absolute;background:#fff;border-radius:50%}
.c1{top:5%;animation:drift 92s linear infinite}
.c2{top:15%;--cs:.36;animation:drift 124s linear infinite;animation-delay:-46s;opacity:.45}
.c3{top:24%;--cs:.62;animation:drift 158s linear infinite;animation-delay:-104s;opacity:.34}
@keyframes drift{from{transform:translateX(-24vw) scale(var(--cs))}
 to{transform:translateX(118vw) scale(var(--cs))}}
.hill{position:absolute;left:-6%;right:-6%;bottom:0;height:34%;pointer-events:none}
.hill i{position:absolute;bottom:0;border-radius:50% 50% 0 0}
.grd{position:absolute;left:0;right:0;bottom:0;height:16%;pointer-events:none;
 background:linear-gradient(180deg,#8FD16A,#5FA843 40%,#3E7B34)}
.stage{position:absolute;inset:0;perspective:2600px;perspective-origin:50% 46%;z-index:2;pointer-events:none;
 transform:translate(var(--ox,0px),var(--oy,0px)) scale(var(--s,1));transform-origin:50% 50%}
.stage .room{pointer-events:auto}
.world{position:absolute;inset:0;-webkit-transform-style:preserve-3d;transform-style:preserve-3d;
 transform:rotateX(var(--rx,58deg)) rotateZ(var(--rz,0deg))}
.room{position:absolute;left:50%;top:50%;width:900px;height:660px;margin:-330px 0 0 -450px;-webkit-transform-style:preserve-3d;transform-style:preserve-3d}

/* 石の土台。部屋を空に浮かべるので、床の下に厚みを作る */
.base{position:absolute;left:-18px;top:-18px;width:936px;height:696px;-webkit-transform-style:preserve-3d;transform-style:preserve-3d}
.base .bt{position:absolute;inset:0;background:linear-gradient(150deg,#D9CBAA,#B7A582);
 transform:translateZ(-2px);border-radius:4px}
.base .bs{position:absolute;background:linear-gradient(180deg,#9C8B6C,#5E5240 70%,#42392C)}
.floor{position:absolute;inset:0;
 background:
  /* 奥ほど暗く、窓側から光が入る */
  linear-gradient(0deg,rgba(255,252,242,.30),rgba(92,68,34,.22) 88%),
  /* タイルの目地 */
  repeating-linear-gradient(90deg,rgba(150,120,74,.30) 0 3px,rgba(0,0,0,0) 3px 150px),
  repeating-linear-gradient(0deg,rgba(150,120,74,.30) 0 3px,rgba(0,0,0,0) 3px 150px),
  /* 市松を薄く。会社色をほんの少しだけ乗せる */
  linear-gradient(0deg,rgba(var(--rug,232,112,63),.05),rgba(var(--rug,232,112,63),.05)),
  linear-gradient(0deg,#EBDFC2,#E2D3B0);
 box-shadow:inset 0 0 130px rgba(90,66,32,.22)}
/* 中央の通路。参考画面の青いカーペット */
.carpet{position:absolute;transform:translateZ(1px);
 background:
  repeating-linear-gradient(0deg,rgba(255,255,255,.07) 0 12px,rgba(0,0,0,0) 12px 24px),
  linear-gradient(180deg,#5C8FD6,#3E6FBA 60%,#35619F);
 border-left:4px solid #EDE3C8;border-right:4px solid #EDE3C8;
 box-shadow:0 0 18px rgba(20,40,90,.28)}
.rug{position:absolute;transform:translateZ(1px);border-radius:10px;
 background:
  repeating-linear-gradient(45deg,rgba(255,255,255,.10) 0 9px,rgba(0,0,0,0) 9px 18px),
  rgba(var(--rug,232,112,63),.30);
 border:3px solid rgba(var(--rug,232,112,63),.62);
 box-shadow:inset 0 0 0 4px rgba(255,255,255,.20)}
.wallN{position:absolute;left:0;top:0;width:900px;height:230px;transform-origin:top;transform:rotateX(90deg);
 background:linear-gradient(180deg,#FFF 0,rgba(255,255,255,0) 4%),
  /* 腰板 */
  linear-gradient(180deg,rgba(0,0,0,0) 0 76%,rgba(150,104,62,.30) 76%,rgba(120,80,44,.42) 100%),
  linear-gradient(180deg,var(--wall),var(--wall2));
 border-bottom:5px solid rgba(96,62,32,.45);box-shadow:inset 0 -30px 44px rgba(70,48,26,.18)}
.wallW,.wallE{position:absolute;left:0;top:0;width:660px;height:230px;transform-origin:left top;
 /* 幅(520px)を部屋の +Y へ、高さを北の壁と同じ「上」へ向ける。
    元は rotateY(-90) rotateX(90) translateX(-520) で、幅がZ方向を向いていたため
    北の壁と平行に立ってしまい、部屋の角ができていなかった（2026-09-09 修正） */
 transform:rotateZ(90deg) rotateX(90deg);
 background:linear-gradient(180deg,rgba(0,0,0,0) 0 76%,rgba(150,104,62,.28) 76%,rgba(120,80,44,.38) 100%),
  linear-gradient(180deg,var(--wall2),var(--wall));
 box-shadow:inset 0 -30px 44px rgba(70,48,26,.22), inset -44px 0 66px rgba(0,0,0,.10)}
/* 東の壁。西と向かい合わせにする */
.wallE{transform:translateX(900px) translateY(660px) rotateZ(-90deg) rotateX(90deg);
 box-shadow:inset 0 -30px 44px rgba(70,48,26,.22), inset 44px 0 66px rgba(0,0,0,.10)}
.win{position:absolute;border:5px solid #F6F2E6;border-radius:50% 50% 8px 8px / 44% 44% 8px 8px;
 background:linear-gradient(175deg,#5FB4EE 0%,#9AD6F6 52%,#DCF1FF 100%);
 box-shadow:inset 0 0 0 3px rgba(150,116,74,.40), 0 4px 10px rgba(70,48,26,.22)}
.win:before{content:"";position:absolute;left:50%;top:18%;bottom:0;width:3px;margin-left:-1.5px;
 background:rgba(246,242,230,.9)}
.win:after{content:"";position:absolute;left:50%;top:30%;width:26px;height:26px;margin-left:-13px;
 border-radius:50%;background:rgba(255,255,255,.55);box-shadow:inset 0 0 0 3px rgba(246,242,230,.9)}
.torch{position:absolute;width:14px;height:20px;border-radius:3px;
 background:linear-gradient(180deg,#7A5230,#4A3220);
 box-shadow:0 0 26px 10px rgba(255,170,60,.36)}
.torch b{position:absolute;left:1px;top:-15px;width:12px;height:18px;border-radius:50% 50% 40% 40%;
 background:radial-gradient(circle at 50% 70%,#FFF3B0,#FFB33C 45%,#F0682A 78%,rgba(240,104,42,0));
 animation:fl .5s ease-in-out infinite alternate}
@keyframes fl{from{transform:scaleY(1) translateY(0);opacity:.92}to{transform:scaleY(1.18) translateY(-2px);opacity:1}}
.flag{position:absolute;width:52px;height:104px;
 background:linear-gradient(180deg,rgba(255,255,255,.20),rgba(0,0,0,.16)),var(--fc,#24407E);
 clip-path:polygon(0 0,100% 0,100% 74%,50% 100%,0 74%);
 box-shadow:0 5px 12px rgba(50,34,14,.32);border-top:4px solid rgba(255,255,255,.55)}
.flag i{position:absolute;left:50%;top:26px;width:20px;height:20px;margin-left:-10px;
 background:rgba(255,255,255,.88);transform:rotate(45deg)}

/* 依頼の立て札。代表に残っているものを部屋の中に貼る */
.quest{position:absolute;-webkit-transform-style:preserve-3d;transform-style:preserve-3d;pointer-events:none}
.quest .pole{position:absolute;left:-4px;top:0;width:8px;height:60px;opacity:.7;
 background:linear-gradient(90deg,#6B4726,#A8763F 45%,#5E3E20);
 transform-origin:top;transform:rotateX(-90deg)}
.quest{opacity:.55;transition:opacity .15s}
.quest:hover{opacity:1}
.quest .qb{position:absolute;left:-104px;top:-118px;width:208px;padding:7px 10px 9px;
 background:linear-gradient(180deg,rgba(248,240,214,.9),rgba(226,206,158,.9));
 border:3px solid rgba(138,95,50,.75);border-radius:7px;
 box-shadow:0 4px 11px rgba(0,0,0,.3),inset 0 0 0 2px rgba(255,255,255,.4);
 transform:translateZ(96px) rotateZ(calc(-1 * var(--rz,36deg))) rotateX(calc(-1 * var(--rx,57deg)))}
.quest .qt{text-align:center;font-family:"Reggae One",sans-serif;font-size:12.5px;color:#6B3F16;
 letter-spacing:.1em;border-bottom:2px solid rgba(138,95,50,.45);padding-bottom:5px;margin-bottom:6px}
.quest .qi{font-size:10px;color:#3E2C12;line-height:1.45;text-align:left;margin-top:5px;
 font-family:"Zen Maru Gothic",sans-serif}
.quest .qi b{color:#A02A1E;font-family:"IBM Plex Mono",monospace;font-size:11px;margin-right:5px}
.board{position:absolute;background:#F7F4E8;border:4px solid #7C6448;border-radius:3px;
 box-shadow:0 3px 9px rgba(0,0,0,.28)}
.board .ln{position:absolute;height:3px;background:#BAB5C9;border-radius:2px}
.board .ln.a{background:#E8703F;opacity:.8}
.foe{position:absolute;-webkit-transform-style:preserve-3d;transform-style:preserve-3d;cursor:pointer}
.foe .fav{display:block;margin:0 auto;
 animation:foeb 2.6s ease-in-out infinite;transform-origin:50% 100%}
@keyframes foeb{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-4px) scale(.97,1.04)}}
.foe.p5 .fav{animation-duration:1.7s}
.foe.p4 .fav{animation-duration:2.1s}
.foe .fb{position:absolute;width:190px;left:-95px;top:-6px;text-align:center;
 transform:translateZ(76px) rotateZ(calc(-1 * var(--rz,36deg))) rotateX(calc(-1 * var(--rx,57deg)))}
.foe .fn{display:inline-block;padding:2px 9px;border-radius:8px;font-size:12.5px;font-weight:700;color:#FFE2DC;
 border:2px solid #E06A55;background:linear-gradient(165deg,rgba(74,16,10,.95),rgba(30,6,4,.95));
 box-shadow:0 2px 8px rgba(0,0,0,.55)}
.foe .fk{font-family:"DotGothic16",monospace;font-size:9.5px;color:#FFC24A;margin-top:2px;
 text-shadow:0 1px 4px rgba(0,0,0,.9)}
.foe .kd{display:inline-block;border:1px solid;border-radius:4px;padding:0 4px;margin-right:5px}
.foe .kd.競合{color:#FF9C8A;border-color:#FF9C8A}
.foe .kd.環境{color:#C9A8E8;border-color:#C9A8E8}
.foe .kd.規制{color:#E8C46A;border-color:#E8C46A}
.foe .fd{font-size:10.5px;color:#F2E4E0;margin-top:3px;line-height:1.45;
 text-shadow:0 1px 5px rgba(0,0,0,.95)}
.sign{position:absolute;-webkit-transform-style:preserve-3d;transform-style:preserve-3d;pointer-events:none}

.sign b{position:absolute;width:430px;left:-215px;top:-26px;text-align:center;font-weight:400;
 padding:9px 0 11px;border:4px solid #C7A468;border-radius:10px;
 background:linear-gradient(180deg,#FFFDF3,#F0E6CC);
 box-shadow:0 6px 16px rgba(50,34,14,.38),inset 0 0 0 3px rgba(255,255,255,.7);
 transform:translateZ(150px) rotateZ(calc(-1 * var(--rz,0deg))) rotateX(calc(-1 * var(--rx,58deg)))}
.sign b span{font-family:"Reggae One",sans-serif;font-size:29px;letter-spacing:.11em;color:#5A3A12}
.sign b em{display:block;font-style:normal;font-family:"DotGothic16",monospace;font-size:11px;
 letter-spacing:.24em;color:#9A7A44;margin-top:3px}
.obj{position:absolute;-webkit-transform-style:preserve-3d;transform-style:preserve-3d}
.tp,.sd{position:absolute;border:1px solid rgba(48,40,66,.5)}
.tp{box-shadow:inset 0 0 0 1px rgba(255,255,255,.4)}
.sd{border-top:none}
.mon{position:absolute;border-radius:3px;
 background:linear-gradient(160deg,#3E4E66,#141A26);border:2px solid #5A6A86;
 box-shadow:0 0 10px rgba(120,190,255,.35)}
.kb{position:absolute;border-radius:2px;background:linear-gradient(180deg,#F4F1EA,#CFC9BE);
 border:1px solid rgba(90,70,50,.35)}
.cup{position:absolute;width:11px;height:11px;border-radius:50% 50% 40% 40%;
 background:linear-gradient(180deg,#F6F3EC,#D8D2C6);border:1px solid rgba(90,70,50,.4)}
.bk{position:absolute;border-radius:5px 5px 0 0;
 background:linear-gradient(180deg,#D8CAAE,#B49B72);border:1px solid rgba(90,66,32,.4)}
.shelf{position:absolute;left:2px;right:2px;height:3px;background:rgba(60,38,18,.55);transform:translateZ(1px)}
.bk2{position:absolute;top:20px;width:8px;height:16px;border-radius:1px;background:var(--bc,#C0392B);
 box-shadow:0 1px 0 rgba(0,0,0,.3);transform:translateZ(2px)}
.plant{position:absolute;-webkit-transform-style:preserve-3d;transform-style:preserve-3d}
.plant .pot{position:absolute;width:24px;height:24px;border-radius:4px;transform:translateZ(9px);
 background:linear-gradient(160deg,#C98A5C,#8A5330);border:1px solid #5E3A22}
.plant .lf{position:absolute;width:36px;height:36px;left:-6px;top:-6px;border-radius:50% 50% 45% 55%;
 background:radial-gradient(circle at 34% 28%,#A5DFA8,#8ACC7E 40%,#357A46);transform:translateZ(32px)}

/* ── 人物 ────────────────────────────────────────── */
.unit{position:absolute;-webkit-transform-style:preserve-3d;transform-style:preserve-3d;cursor:pointer}
.bill{position:absolute;width:236px;left:-72px;top:-96px;text-align:center;
 display:flex;flex-direction:column;align-items:center;gap:3px;
 transform:translateZ(96px) rotateZ(calc(-1 * var(--rz,0deg))) rotateX(calc(-1 * var(--rx,58deg)))}
.av{width:112px;height:94px;display:block;margin:0 auto;shape-rendering:optimizeSpeed}
.plate{display:inline-block;padding:3px 10px;border-radius:9px;border:2px solid #fff;
 background:linear-gradient(165deg,#1B2E66,#0A1231);box-shadow:0 3px 9px rgba(0,0,0,.45);order:3}
.bill .av{order:2}
.bill .bub{order:1;margin-top:0;margin-bottom:2px}
.bill .cnt{order:0}
.nm{font-size:13.5px;font-weight:700;color:#fff;line-height:1.3}
.nm i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:1px;
 box-shadow:0 0 6px currentColor}
.rl{font-family:"DotGothic16",monospace;font-size:10.5px;color:#AFC2E4}
.bub{display:inline-block;max-width:152px;margin-top:6px;padding:5px 9px;border-radius:10px;
 border:2px solid rgba(255,255,255,.85);
 background:linear-gradient(165deg,rgba(27,46,102,.95),rgba(10,18,49,.95));
 color:#E8EEFB;font-size:10.5px;line-height:1.5;text-align:left;box-shadow:0 3px 10px rgba(0,0,0,.45)}
.bub.real{border-color:#8FE7A8;color:#D6F7E0}
.bub .w{display:block;font-family:"DotGothic16",monospace;font-size:8.5px;color:#93D8A8;margin-top:3px}
.unit .av{animation:idle 3.4s ease-in-out infinite;transform-origin:50% 100%}
.unit:nth-child(3n) .av{animation-duration:4.1s;animation-delay:-1.2s}
.unit:nth-child(3n+1) .av{animation-duration:3.7s;animation-delay:-2.4s}
@keyframes idle{0%,100%{transform:scale(1,1)}50%{transform:scale(1.05,.93)}}
.unit.running .av{animation:bob .85s ease-in-out infinite}
@keyframes bob{0%{transform:scale(1.08,.9)}40%{transform:translateY(-9px) scale(.94,1.08)}
 100%{transform:scale(1.08,.9)}}
.unit.never .av{opacity:.4}
.unit.stale .av,.unit.blocked .av{animation:al 1.4s ease-in-out infinite}
@keyframes al{0%,100%{opacity:1}50%{opacity:.32}}
.unit.sel .bub{border-color:var(--acc);box-shadow:0 0 14px rgba(255,194,74,.5)}

/* 代表（勇者）。残タスクの数を頭の上に出す */
.hero .bill{top:-3px}
.hero .av{width:138px;height:116px;animation:hero 2.4s ease-in-out infinite;transform-origin:50% 100%}
@keyframes hero{0%,100%{transform:scale(1,1)}50%{transform:scale(1.04,.95)}}
.hero .plate{border-color:var(--gold);background:linear-gradient(165deg,#4A2E10,#1A0E04)}
.cnt{display:inline-block;margin-bottom:4px;padding:2px 9px;border-radius:8px;
 border:1px solid rgba(255,255,255,.55);background:rgba(10,18,40,.72);
 font-family:"DotGothic16",monospace;font-size:11px;color:#E4ECFB;font-weight:400;
 box-shadow:0 1px 5px rgba(0,0,0,.4)}
.cnt.late{border-color:#FF7A5C;color:#FFB9A6}
.cnt.zero{border-color:rgba(125,227,155,.6);color:#BFEFCF}
.spark{position:absolute;width:6px;height:6px;border-radius:50%;background:#FFF3B0;
 box-shadow:0 0 10px 3px rgba(255,230,150,.8);pointer-events:none;animation:sp 4.6s ease-in-out infinite}
@keyframes sp{0%,100%{opacity:0;transform:translateZ(30px) translateY(0)}
 40%{opacity:1}70%{opacity:0;transform:translateZ(30px) translateY(-30px)}}

/* 巡回する人 */
.walk{position:absolute;-webkit-transform-style:preserve-3d;transform-style:preserve-3d;offset-rotate:0deg;pointer-events:none}
.walk .bill2{position:absolute;width:130px;left:-65px;top:-47px;text-align:center;
 transform:translateZ(78px) rotateZ(calc(-1 * var(--rz,36deg))) rotateX(calc(-1 * var(--rx,57deg)))}
.walk .av{width:82px;height:68px;display:block;margin:0 auto;transform-origin:50% 100%;
 animation:step .7s ease-in-out infinite}
@keyframes step{0%{transform:scale(1.09,.9)}45%{transform:translateY(-8px) scale(.93,1.09)}
 100%{transform:scale(1.09,.9)}}
.walk .tag{display:inline-block;margin-top:2px;padding:2px 8px;border-radius:9px;font-size:9.5px;
 border:2px solid rgba(255,255,255,.8);color:#E4ECFB;
 background:linear-gradient(165deg,rgba(27,46,102,.92),rgba(10,18,49,.92));white-space:nowrap}
.w1{animation:loopA 26s linear infinite}
.w2{animation:loopA 26s linear infinite;animation-delay:-9s}
.w3{animation:loopB 31s linear infinite}
.w4{animation:loopB 31s linear infinite;animation-delay:-16s}
@keyframes loopA{from{offset-distance:0%}to{offset-distance:100%}}
@keyframes loopB{from{offset-distance:0%}to{offset-distance:100%}}

/* ── パネル ─────────────────────────────────────── */
.pn{position:relative;z-index:6;display:flex;flex-direction:column;min-height:0}
.pn h3{margin:0;padding:9px 12px;font-family:"DotGothic16",monospace;font-size:12px;letter-spacing:.1em;
 color:var(--gold);border-bottom:2px solid rgba(255,255,255,.35);display:flex;justify-content:space-between;gap:8px}
.pn h3 span{color:var(--dim)}
.pn .bd{overflow:auto}
.pn .bd::-webkit-scrollbar{width:9px}
.pn .bd::-webkit-scrollbar-thumb{background:rgba(255,255,255,.28);border-radius:5px}
#iss{flex:1 1 auto;min-height:190px}
.sw{display:flex;gap:0;padding:6px 8px 0;border-bottom:2px solid rgba(255,255,255,.22)}
.sw button{flex:1;font-family:"Zen Maru Gothic",sans-serif;font-size:12.5px;cursor:pointer;
 border:2px solid transparent;border-bottom:none;border-radius:8px 8px 0 0;padding:5px 6px;
 background:rgba(255,255,255,.06);color:var(--dim)}
.sw button.on{background:linear-gradient(180deg,#2A4A9E,#12235A);color:#fff;border-color:#fff;font-weight:700}
.sw button b{font-family:"IBM Plex Mono",monospace;font-size:11px;margin-left:5px;color:var(--acc)}
.sw button{font-size:12px;padding:5px 4px}
.rdwrap{padding:10px 8px 6px;border-bottom:2px solid rgba(255,255,255,.18)}
.rdr{display:block;width:100%;height:auto;max-height:44vh}
.rdlg{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:4px 8px 2px;
 font-family:"DotGothic16",monospace;font-size:10px;color:var(--dim)}
.rdlg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px}
.rdlg em{font-style:normal;flex-basis:100%;color:#FFD9A6;margin-top:2px}
.ic{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.09)}
.ic .r{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.ic .ax{font-family:"DotGothic16",monospace;font-size:9.5px;padding:1px 5px;border:1px solid;border-radius:4px}
.ic .ax.csat{color:#F0AEE8;border-color:#F0AEE8}
.ic .ax.hiring{color:#FFD35C;border-color:#FFD35C}
.ic .ax.pl{color:#8ACDF0;border-color:#8ACDF0}
.ic .sc{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:600}
.ic .sc.hi{color:var(--hi)} .ic .sc.mid{color:var(--mid)} .ic .sc.lo{color:var(--lo)}
.ic .t{font-size:13px;margin-top:4px;line-height:1.5;color:#F2F6FF}
.ic .o{font-family:"DotGothic16",monospace;font-size:10px;color:var(--dim);margin-top:3px}
.ic.pin{border-left:3px solid var(--acc)}
.pinf{font-family:"DotGothic16",monospace;font-size:9px;color:var(--acc);border:1px solid var(--acc);
 border-radius:4px;padding:0 5px;margin-left:6px}
/* 残タスクの行 */
.mt{padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.09);display:flex;gap:9px;align-items:flex-start}
.mt .k{flex:none;width:64px;text-align:center;font-family:"IBM Plex Mono",monospace;font-size:12px;
 border:1px solid var(--line);border-radius:5px;padding:2px 0;color:var(--dim)}
.mt.late .k{border-color:#FF7A5C;color:#FFB9A6;background:rgba(255,90,60,.16)}
.mt.soon .k{border-color:var(--acc);color:#FFDD9B;background:rgba(255,194,74,.14)}
.mt .x{font-size:14px;line-height:1.55;color:#F2F6FF}
.mt .s{font-family:"DotGothic16",monospace;font-size:11.5px;color:var(--dim);margin-top:3px}
.mt .s em{font-style:normal;color:#FFB9A6}
.mt input{flex:none;width:17px;height:17px;margin:1px 0 0;cursor:pointer;accent-color:#7DE39B}
.mt .nm2{flex:none;margin-left:auto;font-family:"DotGothic16",monospace;font-size:10px;border-radius:5px;
 background:none;border:1px solid var(--line);color:var(--dim);padding:2px 6px;cursor:pointer;white-space:nowrap}
.mt .nm2:hover{color:#fff;border-color:var(--acc)}
.mt.no{opacity:.5}
.mt.no .x{color:#B9C8E8}
.mt.dn{opacity:.45}
.mt.dn .x{text-decoration:line-through}
.mtsave{display:flex;align-items:center;gap:8px;padding:7px 12px;
 background:rgba(255,194,74,.14);border-bottom:1px solid rgba(255,255,255,.12);
 font-family:"DotGothic16",monospace;font-size:11px;color:#FFDD9B}
.mtsave button{font-family:"DotGothic16",monospace;font-size:11px;border:2px solid #fff;
 border-radius:7px;background:linear-gradient(180deg,#FFC24A,#D98F1C);color:#2A1A02;
 padding:3px 12px;cursor:pointer;font-weight:700;margin-left:auto}
.mtsave button:disabled{opacity:.5;cursor:default}
.mth .cut{display:block;color:#B9C8E8;letter-spacing:0;margin-top:2px;line-height:1.4}
.mt .s.nt{color:#FFD9A6}
.mth{padding:5px 12px;font-family:"DotGothic16",monospace;font-size:10.5px;color:var(--gold);
 background:rgba(255,255,255,.07);letter-spacing:.06em}
#chat{flex:1 1 auto;min-height:110px}
.cl{padding:5px 12px;font-size:12px;display:grid;grid-template-columns:56px 1fr;gap:8px;
 border-bottom:1px solid rgba(255,255,255,.08)}
.cl .t{font-family:"IBM Plex Mono",monospace;font-size:10.5px;color:var(--never)}
.cl b{color:var(--gold);font-weight:400}
#seat{flex:0 0 auto}
#seat .bd{padding:10px 12px}
.q{font-size:12px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08)}
.q em{font-style:normal;font-family:"DotGothic16",monospace;font-size:9px;color:var(--acc);
 border:1px solid var(--acc);border-radius:4px;padding:0 4px;margin-right:6px}
#ta{width:100%;background:rgba(255,255,255,.10);border:2px solid var(--line);border-radius:7px;color:#fff;
 font-family:inherit;font-size:13px;padding:8px;resize:vertical;min-height:50px;margin-top:8px}
#ta::placeholder{color:#8FA2C6}
#ta:focus{outline:2px solid var(--acc);outline-offset:1px}
.row{display:flex;gap:8px;margin-top:8px;align-items:center}
#send{font-family:"DotGothic16",monospace;font-size:12px;border:2px solid #fff;border-radius:8px;
 background:linear-gradient(180deg,#FFC24A,#D98F1C);color:#2A1A02;padding:6px 16px;cursor:pointer;font-weight:700}
#send:disabled{opacity:.4;cursor:default}
.qd{float:right;margin-left:8px;font-family:"DotGothic16",monospace;font-size:10px;border-radius:5px;
 background:none;border:1px solid var(--line);color:var(--dim);padding:1px 7px;cursor:pointer}
.qd:hover{color:#fff;border-color:var(--acc)}
#msg{font-family:"DotGothic16",monospace;font-size:11px;color:var(--dim);flex:1}
.sum{position:absolute;left:10px;right:10px;top:10px;bottom:10px;z-index:7;
 display:flex;flex-direction:column;overflow:hidden}
.sumh{padding:12px 16px;font-family:"Reggae One",sans-serif;font-size:21px;letter-spacing:.08em;
 border-bottom:2px solid rgba(255,255,255,.35);
 background:linear-gradient(180deg,#FFF6D2 0%,#FFD980 44%,#D98F1C 56%,#FFE9A8 100%);
 -webkit-background-clip:text;background-clip:text;color:transparent;
 filter:drop-shadow(0 1px 0 rgba(0,0,0,.6))}
.sumb{overflow:auto;padding:0 0 10px}
.sumb::-webkit-scrollbar{width:9px}
.sumb::-webkit-scrollbar-thumb{background:rgba(255,255,255,.28);border-radius:5px}
.sgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:13px;padding:14px 16px}
/* 1行1事業。横に並べて比べられるように、数字の位置を揃える */
.stbl{padding:10px 16px 4px}
.strow{display:grid;grid-template-columns:168px 92px 62px 62px 74px minmax(0,1fr);
 gap:10px;align-items:center;padding:8px 10px;border-radius:9px;
 border-bottom:1px solid rgba(255,255,255,.10);cursor:pointer}
.strow:hover{background:rgba(255,255,255,.08)}
.sthd{cursor:default;border-bottom:2px solid rgba(255,255,255,.28);
 font-family:"DotGothic16",monospace;font-size:11px;color:var(--dim);letter-spacing:.06em}
.sthd:hover{background:none}
.strow .bn{font-size:16px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.strow .wx2{font-size:12.5px;font-weight:700;white-space:nowrap}
.strow .wx2 b{font-family:"IBM Plex Mono",monospace;font-size:15px;margin-right:4px;font-weight:400}
.strow .wx2.fine{color:#FFD35C} .strow .wx2.partly{color:#FFE9A8}
.strow .wx2.cloud{color:#C6D0DE} .strow .wx2.rain{color:#8ACDF0}
.strow .wx2.storm{color:#FF9C4A} .strow .wx2.fog{color:#93A0B4}
.strow .num{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--dim);text-align:right}
.strow .num b{font-size:16px;color:#fff;font-weight:500}
.strow .num.z b{color:#6F819E}
.strow .num.hot b{color:#FF9C8A}
.strow .tt{font-size:13.5px;line-height:1.5;color:#E8EEFB;
 display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.strow .tt em{font-style:normal;color:#93A0B4}
.strow .tt i{font-style:normal;display:block;color:#FFD9A6;font-size:11.5px;margin-top:2px}
@media(max-width:820px){
 /* 携帯は3行。①事業と天気 ②数字3つ ③いちばんの課題 */
 .stbl{padding:6px 8px 4px}
 .strow{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:3px;gap:6px;padding:9px 8px}
 .strow>:nth-child(1){grid-column:1/3;grid-row:1}
 .strow>:nth-child(2){grid-column:3;grid-row:1;justify-self:end}
 .strow>:nth-child(3){grid-column:1;grid-row:2;text-align:left}
 .strow>:nth-child(4){grid-column:2;grid-row:2;text-align:left}
 .strow>:nth-child(5){grid-column:3;grid-row:2;text-align:left}
 .strow>:nth-child(6){grid-column:1/4;grid-row:3}
 .strow .num b{font-size:14px}
 .sthd{display:none}}
.scard{border:2px solid rgba(255,255,255,.38);border-radius:12px;padding:14px 16px 12px;
 background:rgba(255,255,255,.07);cursor:pointer;display:flex;flex-direction:column;gap:10px}
.scard:hover{border-color:var(--acc);background:rgba(255,255,255,.13)}
.scard .r1{display:flex;align-items:center;gap:10px}
.scard .bn{font-size:21px;font-weight:700;color:#fff;letter-spacing:.02em}
.scard .wxb{font-family:"IBM Plex Mono",monospace;font-size:22px;line-height:1}
.scard .wxn{margin-left:auto;font-size:13px;font-weight:700;white-space:nowrap}
.scard .wxn.fine{color:#FFD35C} .scard .wxn.partly{color:#FFE9A8}
.scard .wxn.cloud{color:#C6D0DE} .scard .wxn.rain{color:#8ACDF0}
.scard .wxn.storm{color:#FF9C4A} .scard .wxn.fog{color:#93A0B4}
.scard .r2{display:flex;gap:7px;flex-wrap:wrap;margin-top:2px}
.scard .kv{font-family:"DotGothic16",monospace;font-size:12px;color:var(--dim);
 border:1px solid var(--line);border-radius:6px;padding:2px 9px}
.scard .kv b{color:#fff;font-weight:400;font-size:14px}
.scard .kv.hot{border-color:#FF7A5C;color:#FFB9A6;background:rgba(255,90,60,.14)}
.scard .kv.by2{border-color:var(--acc);color:var(--acc)}
.scard .tp2{display:flex;flex-direction:column;gap:3px}
.scard .tp2 .lb{font-family:"DotGothic16",monospace;font-size:10.5px;color:var(--gold);letter-spacing:.08em}
.scard .tp2 .tt{font-size:16px;line-height:1.5;color:#fff;font-weight:500}
.scard .tp2.none .tt{color:#93A0B4;font-size:14px;font-weight:400}
.scard .wt{font-size:13px;line-height:1.55;color:#FFD9A6;
 border-left:3px solid rgba(255,194,74,.6);padding-left:10px}
/* ---- メンバー（人事評価・1on1） ---- */
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px;padding:14px 16px}
.pcard{border:2px solid rgba(255,255,255,.34);border-radius:12px;padding:12px 14px;
 background:rgba(255,255,255,.07);cursor:pointer;display:flex;flex-direction:column;gap:8px}
.pcard:hover{border-color:var(--acc);background:rgba(255,255,255,.13)}
.pcard .p1{display:flex;align-items:baseline;gap:9px}
.pcard .rk{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--gold)}
.pcard .nm2{font-size:19px;font-weight:700;color:#fff}
.pcard .gd{font-family:"IBM Plex Mono",monospace;font-size:12px;color:#A9B8D4;
 border:1px solid var(--line);border-radius:5px;padding:1px 7px}
.pcard .ro{margin-left:auto;font-size:12px;color:#93A0B4;white-space:nowrap;
 overflow:hidden;text-overflow:ellipsis;max-width:46%}
.pcard .p2{display:flex;align-items:baseline;gap:10px}
.pcard .tot{font-family:"IBM Plex Mono",monospace;font-size:28px;color:#fff;line-height:1}
.pcard .tot em{font-style:normal;font-size:12px;color:#93A0B4;margin-left:6px}
.pcard .jd{font-size:14px;font-weight:700;color:#FFD35C}
.pcard .warn2{font-family:"DotGothic16",monospace;font-size:12px;color:#FF9C4A;margin-left:auto}
.pcard .lowline{font-size:12.5px;color:#FFD9A6;line-height:1.6;
 border-left:3px solid rgba(255,194,74,.55);padding-left:9px}
.pcard .ol{font-family:"DotGothic16",monospace;font-size:11.5px;color:#7DE39B}
.pcard .ol.no{color:#93A0B4}
.pdet{padding:14px 16px;display:flex;flex-direction:column;gap:13px}
.pback{align-self:flex-start;font-family:"Zen Maru Gothic",sans-serif;font-size:13px;
 background:rgba(9,18,44,.6);color:#D6E1F5;border:1px solid var(--line);border-radius:7px;
 padding:5px 12px;cursor:pointer}
.pback:hover{color:#fff;border-color:#fff}
.psec{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:rgba(255,255,255,.05)}
.psec h4{margin:0 0 9px;font-family:"DotGothic16",monospace;font-size:12px;letter-spacing:.1em;
 color:var(--gold);font-weight:400}
.prow{display:grid;grid-template-columns:150px 46px 1fr 52px;gap:9px;align-items:center;
 font-size:12px;margin-bottom:3px}
.prow .pi{color:#C6D0DE;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prow .pv{font-family:"IBM Plex Mono",monospace;text-align:right;color:#fff}
.prow .pd{font-family:"IBM Plex Mono",monospace;text-align:right;font-size:11px}
.pgrp{font-family:"DotGothic16",monospace;font-size:11px;color:#8EA0C0;margin:9px 0 4px}
.pgrp:first-child{margin-top:0}
.pg{position:relative;height:12px;background:rgba(0,0,0,.30);border-radius:2px}
.pg::before{content:"";position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;
 background:rgba(255,255,255,.30)}
.pg span{position:absolute;top:2px;bottom:2px;border-radius:2px}
.pg span.pp{left:50%;background:#7DE39B}
.pg span.pm{right:50%;background:#FF9C4A}
.up2{color:#7DE39B}.dn2{color:#FF9C4A}
.pkv{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.pkv span{font-family:"DotGothic16",monospace;font-size:12px;color:var(--dim);
 border:1px solid var(--line);border-radius:6px;padding:2px 9px}
.pkv span b{color:#fff;font-weight:400;font-size:14px}
.pkv span.hot2{border-color:#FF7A5C;color:#FFB9A6;background:rgba(255,90,60,.14)}
.pli{font-size:13.5px;line-height:1.75;color:#D6E1F5;padding-left:14px;position:relative;margin-bottom:8px}
.pli::before{content:"";position:absolute;left:0;top:11px;width:6px;height:1px;background:rgba(255,255,255,.4)}
.pli b{color:#fff}
.pnote{font-size:12.5px;line-height:1.75;color:#A9B8D4;border-left:2px solid rgba(255,255,255,.22);
 padding-left:10px;margin:2px 0 11px 14px}
.plink{display:inline-block;font-size:13px;color:#FFE9A8;text-decoration:none;
 border-bottom:1px solid rgba(255,233,168,.45)}
.plink:hover{color:#fff;border-color:#fff}
.pmeth{font-size:11.5px;line-height:1.75;color:#8EA0C0;padding:0 16px 16px}
@media (max-width:900px){.prow{grid-template-columns:110px 40px 1fr 46px;gap:7px;font-size:11px}}
.lv{display:inline-block;margin-left:7px;padding:0 6px;border-radius:5px;font-size:11px;
 font-family:"IBM Plex Mono",monospace;color:#2A1A02;font-weight:700;
 background:linear-gradient(180deg,#FFE9A8,#D98F1C);border:1px solid #fff}
.fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:11px;padding:12px 16px}
.fc{border:2px solid rgba(255,124,92,.5);border-radius:11px;padding:11px 13px;
 background:rgba(120,30,20,.22);display:flex;flex-direction:column;gap:6px}
.fc.k環境{border-color:rgba(180,140,230,.5);background:rgba(70,45,110,.22)}
.fc.k規制{border-color:rgba(230,190,100,.5);background:rgba(105,80,20,.22)}
.fc .f1{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.fstar{font-family:"IBM Plex Mono",monospace;font-size:13px;color:#FFC24A;letter-spacing:-1px}
.fnm{font-size:15.5px;font-weight:700;color:#fff}
.fbz{margin-left:auto;font-family:"DotGothic16",monospace;font-size:10.5px;color:var(--dim)}
.fc .f2{font-size:13px;color:#FFD9D2}
.fc .f3,.fc .f4{font-size:12px;line-height:1.6;color:#E4ECFB}
.fc .f3 b,.fc .f4 b{display:block;font-family:"DotGothic16",monospace;font-size:10px;
 color:var(--gold);letter-spacing:.06em;margin-bottom:1px}
.lvgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:11px;padding:12px 16px}
.lvc{border:2px solid rgba(255,255,255,.32);border-radius:11px;padding:11px 13px;
 background:rgba(255,255,255,.06);display:flex;flex-direction:column;gap:6px}
.lvc.nogot{border-color:rgba(255,124,92,.45)}
.lvc .l1{display:flex;align-items:baseline;gap:9px}
.lvb em{font-style:normal;font-size:11px;-webkit-text-fill-color:#8FA2C6;color:#8FA2C6;margin-left:1px}
.lvb{font-family:"IBM Plex Mono",monospace;font-size:19px;font-weight:700;
 background:linear-gradient(180deg,#FFF6D2,#FFD980 46%,#D98F1C 56%,#FFE9A8);
 -webkit-background-clip:text;background-clip:text;color:transparent;
 filter:drop-shadow(0 1px 0 rgba(0,0,0,.6))}
.lvn{font-size:16px;font-weight:700;color:#fff}
.ttl{font-family:"Reggae One",sans-serif;font-size:12px;color:var(--gold);letter-spacing:.06em}
.lvc .l3 b{color:#fff;font-size:13px}
.lvc .mi{color:#FFB9A6}
.lvr{margin-left:auto;font-family:"DotGothic16",monospace;font-size:11px;color:var(--dim)}
.lvc .bar{height:9px;border-radius:5px;background:rgba(0,0,0,.35);
 border:1px solid rgba(255,255,255,.25);overflow:hidden}
.lvc .bar i{display:block;height:100%;background:linear-gradient(90deg,#FFC24A,#FFE9A8)}
.lvc .l2{font-family:"DotGothic16",monospace;font-size:11.5px;color:#E4ECFB;display:flex;gap:8px}
.lvc .l2 b{color:var(--acc);font-size:13px}
.lvc .l2 .ex{margin-left:auto;color:var(--dim)}
.lvc .l3{font-family:"DotGothic16",monospace;font-size:11px;color:var(--dim)}
.lvc .l4{font-family:"DotGothic16",monospace;font-size:11px;color:#FFB9A6}
.lvc .l4 b{color:#FF7A5C;font-size:13px}
.lvnote{padding:0 16px 8px;font-size:12px;color:var(--dim);line-height:1.7}
.lvnote b{color:#FFB9A6}
.sech{padding:9px 16px;font-family:"DotGothic16",monospace;font-size:13px;color:var(--gold);
 background:rgba(255,255,255,.09);letter-spacing:.06em;margin-top:10px}
/* 会議後に出た実行候補。選ぶまで動かさないので、未選択が目に入る作りにする */
.sech .pw{color:var(--stop);font-style:normal}
.pnote{padding:7px 16px 2px;font-size:11.5px;color:var(--dim);line-height:1.6}
/* 1列で積む。横に滑らせない */
.pgrid{display:flex;flex-direction:column;gap:7px;padding:8px 12px}
.pp{border:1px solid rgba(255,255,255,.16);border-radius:7px;padding:9px 11px;
 background:rgba(9,18,40,.42);min-width:0}
.pp.do{border-color:rgba(125,227,155,.62);background:rgba(20,52,34,.42)}
.pp.skip{opacity:.5}
.p1{display:flex;gap:7px;align-items:flex-start;min-width:0}
.pcl{flex:0 0 auto;font-family:"DotGothic16",monospace;font-size:10px;line-height:1.5;
 padding:1px 6px;border-radius:4px;background:rgba(255,255,255,.15);color:var(--ink)}
.pcl.cA{background:rgba(125,227,155,.28)}
.pcl.cB{background:rgba(255,217,128,.26)}
.pcl.cC{background:rgba(255,122,92,.26)}
.px{font-size:13px;line-height:1.5;word-break:break-word;min-width:0}
.p2{font-size:11px;color:var(--dim);margin-top:4px;word-break:break-word}
.p3{font-size:11.5px;color:#D8E2F6;margin-top:5px;line-height:1.55;word-break:break-word;
 padding-left:9px;border-left:2px solid rgba(255,255,255,.18)}
.p4{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:8px}
.pb{font-family:"Zen Maru Gothic",sans-serif;font-size:11.5px;padding:4px 11px;border-radius:5px;
 border:1px solid rgba(255,255,255,.26);background:rgba(255,255,255,.07);color:var(--ink);cursor:pointer}
.pb.do.on{background:rgba(125,227,155,.34);border-color:rgba(125,227,155,.7)}
.pb.sk.on{background:rgba(255,122,92,.28);border-color:rgba(255,122,92,.66)}
.pst{font-size:11px;color:var(--dim)}
.psv{display:flex;gap:9px;align-items:center;padding:2px 16px 10px}
.psv button{font-family:"Zen Maru Gothic",sans-serif;font-size:12px;padding:5px 15px;border-radius:5px;
 border:1px solid rgba(255,217,128,.5);background:rgba(255,217,128,.17);color:var(--gold);cursor:pointer}
.psv button:disabled{opacity:.55;cursor:default}
.psv span{font-size:11px;color:var(--dim)}
/* 左＝優先順位・凡例・稼働ログ／中＝オフィス／右＝課題・代表の席。重ねない */
.leftcol,.rightcol{display:flex;flex-direction:column;gap:9px;min-width:0;min-height:0;z-index:6}
.sbox{position:relative;min-width:0;min-height:0;z-index:2}
/* 空・雲・雨は、この入れ物の中だけで切る。部屋（3D）の親を切り抜くと
   iOSが場面を平らに焼いてしまい、壁が床に寝てしまう（2026-09-21 指摘） */
.sky{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;border-radius:inherit}
.ordbar{flex:0 0 auto;max-height:54%;overflow:auto}
.ordbar::-webkit-scrollbar,.leftcol::-webkit-scrollbar{width:0}
.ordbar{padding:7px 12px;font-size:12.5px;border-radius:10px;border:2px solid rgba(255,255,255,.8);
 background:linear-gradient(165deg,rgba(27,46,102,.92),rgba(10,18,49,.92));box-shadow:0 3px 12px rgba(0,0,0,.45)}
.ordbar b{color:var(--acc)}
.ordbar .wx{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:8px;
 border:1px solid var(--line);background:rgba(255,255,255,.12);font-size:11px;color:#fff}
.tabs button.allt{border-color:rgba(255,255,255,.45)}
.tabs button.allt.on{background:linear-gradient(180deg,#8A6A20,#3A2A08);border-color:var(--gold)}
.tabs button .wxi{font-family:"IBM Plex Mono",monospace;font-weight:400;margin-right:6px;font-size:13px}
.tabs button .wxi.fine{color:#FFD35C}
.tabs button .wxi.partly{color:#FFE9A8}
.tabs button .wxi.cloud{color:#C6D0DE}
.tabs button .wxi.rain{color:#8ACDF0}
.tabs button .wxi.storm{color:#FF9C4A}
.tabs button .wxi.fog{color:#93A0B4}
.ordbar span{display:block;font-family:"DotGothic16",monospace;font-size:10.5px;color:var(--dim);margin-top:2px}
.ordbar .by{display:inline-block;margin-left:6px;padding:0 6px;border-radius:6px;font-size:9px;
 border:1px solid var(--acc);color:var(--acc)}
.ordbar .by.dm{border-color:#8FA2C6;color:#B9C8E8}
.ordbar .tr{font-family:"Zen Maru Gothic",sans-serif;font-size:11.5px;color:#E4ECFB;line-height:1.5;
 margin-top:4px;padding-left:20px;text-indent:-20px}
.ordbar .tr.w{color:#FFD9A6}
.ordbar .tr em{font-style:normal;display:inline-block;width:15px;margin-right:5px;text-align:center;
 border-radius:4px;background:rgba(255,255,255,.16);font-size:9px}
.ordbar .src{font-size:10px;color:#8FA2C6;margin-top:4px}
.lg{font-family:"DotGothic16",monospace;font-size:10.5px;
 color:#D8E4FA;line-height:1.9;padding:6px 11px;border-radius:10px;
 border:2px solid rgba(255,255,255,.8);
 background:linear-gradient(165deg,rgba(27,46,102,.92),rgba(10,18,49,.92));
 box-shadow:0 3px 12px rgba(0,0,0,.45)}
.lg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}
/* 「動き」OFF と、裏に回っているあいだ。動くものが無ければ3Dの面を焼き直さない */
.wrap.still *,.wrap.still .unit .av,.wrap.still .walk{animation:none!important}
.wrap.pz *{animation-play-state:paused!important}
.mo{font-family:"DotGothic16",monospace;font-size:11px;border-radius:7px;cursor:pointer;
 border:2px solid #DED3BC;background:#FFF;color:#6B5A42;padding:2px 9px;margin-left:10px}
.mo.off{border-color:#C07A18;color:#C07A18;background:#FFF6E2}
@media (prefers-reduced-motion:reduce){.unit .av,.live i,.walk,.walk .av,.cl2,.torch b,.spark{animation:none}
 .walk{offset-distance:30%}.world{transition:none}.c1,.c2,.c3{animation:none;left:20%}}
@media(max-width:1380px){.wrap{grid-template-columns:276px minmax(0,1fr) 300px}}
/* 横に3本入らない幅では縦に積む。重ねない */
@media(max-width:1080px){
 .wrap{grid-template-columns:minmax(0,1fr);grid-template-rows:none;grid-auto-rows:auto;
  height:auto;min-height:calc(100vh - 92px);padding:8px}
 @supports (height:100svh){.wrap{min-height:calc(100svh - 92px)}}
 /* 高さは vh ではなく縦横比で決める。部屋の形そのままの枠を作れば、切れも余りも出ない */
 .sbox{order:-1;height:auto;min-height:0;aspect-ratio:4/3.1}
 .ordbar{max-height:none}
 #iss{max-height:none}#chat{max-height:34vh}}
/* 携帯。部屋は小さくしか置けないので、札を減らして形が見えるようにする */
@media(max-width:720px){
 .bar1{gap:8px;padding:7px 10px}
 .brand{font-size:16px}
 .pipe,.tabhint,.who{display:none}
 .sbox{aspect-ratio:4/3.5}
 /* 敵は競合レーダーのタブで見る。横に置くと部屋の外側が切れる原因になる */
 .bill .bub,.walk .tag,.quest,.foe{display:none}
 .plate{padding:2px 7px}
 .nm{font-size:11px}.rl{font-size:9px}
 .pn h3{padding:7px 10px}
 .lg{display:none}}
</style>

<div class="bar">
  <div class="bar1">
    <span class="brand">バーチャルオフィス</span>
    <span class="who" id="hd"></span>
    <div class="pipe"><div><b>1</b>指示</div><div><b>2</b>着手</div><div><b>3</b>制作</div>
      <div><b>4</b>審査</div><div><b>5</b>納品</div></div>
    <button class="mo" id="mo" title="動きを止めると軽くなります">動き ON</button>
    <span class="live"><i></i>LIVE</span>
  </div>
  <div class="tabrow">
    <div class="tabs" id="tabs" title="Alt + ↑ / ↓ で切り替え"></div>
    <span class="tabhint">Alt + ↑ ↓</span>
  </div>
</div>

<div class="wrap">
  <div class="sky">
    <div class="sun"></div>
    <div class="cl c1"></div><div class="cl c2"></div><div class="cl c3"></div>
    <div class="hill" id="hill"></div>
    <div class="grd"></div>
    <div class="rn"></div><div class="fg"></div><div class="fl"></div>
  </div>
  <div class="sum dqw" id="sum" hidden><div class="sumh">全体</div><div class="sumb" id="sumb"></div></div>
  <div class="leftcol">
  <div class="ordbar" id="ord"></div>
  <div class="lg"><div><i style="background:#3BAE63"></i>緑＝MTGログの実発言</div>
    <div><i style="background:#12235A"></i>紺＝AIの生成</div>
    <div><i style="background:#D93B24"></i>赤＝代表の残タスク</div>
    <div style="margin-top:4px;color:#FFE9A8">天気＝業績が伸びているか</div>
    <div>☀伸びている／未始動 ／ ⛅兆しはあるが未達</div>
    <div>☁足踏み ／ ☂落ちている</div>
    <div>░測れていない（動いているのに数字が無い）</div></div>
  <div class="pn dqw" id="chat"><h3>稼働ログ</h3><div class="bd" id="logs"></div></div>
  </div>
  <div class="sbox"><div class="stage" id="stage"><div class="world" id="world">
    <div class="room" id="room"></div></div></div></div>
  <div class="rightcol">
  <div class="pn dqw" id="iss">
    <div class="sw"><button id="sw0" class="on">課題<b id="ic">0</b></button>
      <button id="sw1">残タスク<b id="mc">0</b></button>
      <button id="sw2">競合レーダー<b id="fcn">0</b></button></div>
    <div class="bd" id="issb"></div></div>
  <div class="pn dqw" id="seat"><h3>代表の席<span id="qc"></span></h3>
    <div class="bd"><div id="queue"></div>
      <textarea id="ta" placeholder="指示を入力（Enterで送信 / Shift+Enterで改行）"></textarea>
      <div class="row"><button id="send">送信</button><span id="msg"></span></div></div></div>
  </div>
</div>

<script id="state" type="application/json">__STATE__</script>
<script id="tpl" type="text/plain">__TPL__</script>
<script>
const S=JSON.parse(document.getElementById('state').textContent);
const room=document.getElementById('room');
const COL={running:'#7DE39B',idle:'#FFD35C',never:'#8EA0C0',stale:'#FF7A5C',blocked:'#FF7A5C'};
const WX={fine:{i:'\u2600',n:'晴れ'},partly:{i:'\u26C5',n:'晴れ時々くもり'},
 cloud:{i:'\u2601',n:'くもり'},rain:{i:'\u2602',n:'雨'},
 storm:{i:'\u26A1',n:'雷雨'},fog:{i:'\u2591',n:'霧'}};
// チェックで消した残タスク。端末の控えと、公開に埋め込む分の両方を持つ
const MDK='office.mtdone.v1';
function mdGet(){try{return JSON.parse(localStorage.getItem(MDK)||'[]')}catch(e){return[]}}
function mdSet(a){try{localStorage.setItem(MDK,JSON.stringify(a))}catch(e){}}
const mtKey=t=>t.b+'|'+t.t;
let MDONE=new Set([].concat(S.mtDone||[], mdGet()));
// 本人のタスクではなかったもの。キー→理由
const MNK='office.mtnot.v1';
function mnGet(){try{return JSON.parse(localStorage.getItem(MNK)||'{}')}catch(e){return{}}}
function mnSet(o){try{localStorage.setItem(MNK,JSON.stringify(o))}catch(e){}}
let MNOT=Object.assign({}, S.mtNot||{}, mnGet());
// 会議後に出た実行候補への回答。id→'do'(実行する)/'skip'(やらない)
const PRK='office.prdec.v1';
function prGet(){try{return JSON.parse(localStorage.getItem(PRK)||'{}')}catch(e){return{}}}
function prSet(o){try{localStorage.setItem(PRK,JSON.stringify(o))}catch(e){}}
let PRDEC=Object.assign({}, S.prDec||{}, prGet());
let mdDirty=false;
const mtLive=t=>!MDONE.has(mtKey(t)) && MNOT[mtKey(t)]===undefined;

const TODAY=(S.myt&&S.myt.asOf)?S.myt.asOf.slice(5):S.now.slice(5,10);
let cur=0, pane=0;

// 空の飾り。雲と丘は静的に作って背景に置く
(function(){
 const mk=(el,parts)=>{parts.forEach(p=>{const s=document.createElement('span');
  s.style.cssText=`left:${p[0]}px;top:${p[1]}px;width:${p[2]}px;height:${p[3]}px`;el.appendChild(s);});};
 const shape=[[0,26,120,58],[54,4,96,84],[122,30,104,54],[186,44,86,40]];
 document.querySelectorAll('.cl').forEach(c=>mk(c,shape));
 const hl=document.getElementById('hill');
 [[-4,58,26,'#4E86C4'],[14,74,32,'#4A7FBC'],[38,64,28,'#4376B2'],[62,80,34,'#3E6EA8'],[84,60,24,'#3A68A0']]
  .forEach(([l,w,h,c])=>{const i=document.createElement('i');
   i.style.cssText=`left:${l}%;width:${w}%;height:${h}%;background:${c};opacity:.55`;hl.appendChild(i);});
})();

// ── モンスター ───────────────────────────────────────
// 人型はやめて、役職ごとにスライム系のモンスターに割り当てる（2026-09-08 本人指示）
const OUT='#141A26';
// スライムは「幅広で低いドーム」。先端をとがらせて縦に伸ばすと巻きグソに見える（2026-09-08 差し戻し）
function eyes(dx,dy,rx,ry){
 return `<g stroke="none"><ellipse cx="${-dx}" cy="${dy}" rx="${rx}" ry="${ry}" fill="${OUT}"/>`
  +`<ellipse cx="${dx}" cy="${dy}" rx="${rx}" ry="${ry}" fill="${OUT}"/>`
  +`<circle cx="${-dx+1.6}" cy="${dy-2.6}" r="1.8" fill="#fff"/>`
  +`<circle cx="${dx+1.6}" cy="${dy-2.6}" r="1.8" fill="#fff"/></g>`;}
const GRIN='<path stroke="none" fill="#2A1A18" d="M-13,-19 Q0,-16.5 13,-19 Q10,-6 0,-6 Q-10,-6 -13,-19 Z"/>';
const SMILE='<path fill="none" stroke="'+OUT+'" stroke-width="2.4" stroke-linecap="round" d="M-8,-17 Q0,-10 8,-17"/>';

// 参考画面のマスコットに寄せる。黒フチのセル画はやめ、
// ①光の面から影の面へ流す塗り ②大きな艶 ③接地影 ④下からの照り返し の4点で立体に見せる。
// 姿は8体それぞれ別。全部スライムにはしない（2026-09-08 代表指示）
const SHAPE={
 // ドーム型。幅広で低く。とがらせて縦に伸ばすと巻きグソに見える（2026-09-08 差し戻し）
 slime:'M0,-62 C21,-62 32,-39 36,-16 C38,-6 33,0 25,0 L-25,0 C-33,0 -38,-6 -36,-16 C-32,-39 -21,-62 0,-62 Z',
 blob: 'M0,-64 C19,-64 33,-51 33,-32 C33,-13 19,0 0,0 C-19,0 -33,-13 -33,-32 C-33,-51 -19,-64 0,-64 Z',
 ghost:'M0,-64 C18,-64 31,-50 31,-31 L31,-6 C31,-1 27,1 24,-2 L17,-9 L10,-2 C8,0 5,0 3,-2 L-3,-9 L-10,-2 C-12,0 -15,0 -17,-2 L-24,-9 L-28,-3 C-30,-1 -31,-2 -31,-6 L-31,-31 C-31,-50 -18,-64 0,-64 Z',
 drop: 'M0,-68 C15,-51 34,-36 34,-20 C34,-7 20,1 0,1 C-20,1 -34,-7 -34,-20 C-34,-36 -15,-51 0,-68 Z',
 cube: 'M-31,-56 L31,-56 C35,-56 37,-54 37,-50 L37,-6 C37,-2 35,0 31,0 L-31,0 C-35,0 -37,-2 -37,-6 L-37,-50 C-37,-54 -35,-56 -31,-56 Z',
 // 空を飛ぶ玉（ドラキー）。床に着かないので下を丸く残す
 bat:  'M0,-66 C20,-66 34,-52 34,-34 C34,-16 20,-4 0,-4 C-20,-4 -34,-16 -34,-34 C-34,-52 -20,-66 0,-66 Z',
 // ローブ。裾を広げて円すいにする（まほうつかい）
 robe: 'M0,-52 C13,-52 21,-28 25,-2 C26,1 24,2 21,2 L-21,2 C-24,2 -26,1 -25,-2 C-21,-28 -13,-52 0,-52 Z',
 // キノコの柄
 stem: 'M-15,-34 C-15,-40 15,-40 15,-34 L17,-4 C18,1 14,2 10,2 L-10,2 C-14,2 -18,1 -17,-4 Z'};

// 目。黒目＋上のキャッチライト＋下の照り返しで、平面に見せない
function eyes(dx,dy,r,ry){
 const b=ry||r;
 return `<g stroke="none">`
  +[-dx,dx].map(x=>`<ellipse cx="${x}" cy="${dy}" rx="${r}" ry="${b}" fill="#2B3142"/>`
    +`<circle cx="${x+r*.46}" cy="${dy-b*.44}" r="${r*.40}" fill="#fff"/>`
    +`<ellipse cx="${x-r*.3}" cy="${dy+b*.46}" rx="${r*.26}" ry="${r*.2}" fill="rgba(255,255,255,.55)"/>`).join('')
  +`</g>`;}
// 口。小さく、下向きの弧
function mouth(y,w){
 return `<path stroke="none" fill="#2B3142" opacity=".9" d="M${-w},${y} Q0,${y+w*1.05} ${w},${y} Q0,${y+w*.5} ${-w},${y} Z"/>`;}
function smile(y,w){
 return `<path fill="none" stroke="#2B3142" stroke-width="2.2" stroke-linecap="round" opacity=".8" d="M${-w},${y} Q0,${y+w*.8} ${w},${y}"/>`;}
// ほっぺ
function blush(dx,y){
 return `<g stroke="none" fill="rgba(255,138,120,.34)"><ellipse cx="${-dx}" cy="${y}" rx="6.5" ry="4"/>`
  +`<ellipse cx="${dx}" cy="${y}" rx="6.5" ry="4"/></g>`;}
// 艶。大小2つ置くと球に見える
function gloss(x,y,rx,ry,rot){
 return `<ellipse stroke="none" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#gglo)"`
  +` transform="rotate(${rot||-24} ${x} ${y})"/>`;}
// 体。輪郭線は引かず、塗りの縁の暗さで形を出す
function body(c,shape,face){
 const d=SHAPE[shape]||shape;   // 形の名前でも、そのままのパスでも受ける
 return `<path stroke="none" fill="${c.col}" d="${d}"/>`
  +`<path stroke="none" fill="url(#gbnc)" d="${d}"/>`          // 下からの照り返し
  +`<path fill="none" stroke="rgba(255,255,255,.30)" stroke-width="2" d="${d}"/>`
  +gloss(-13,-44,11,7)+gloss(3,-52,4.4,3,-18)
  +(face||'');}

const MON={
 // 秘書＝けもの。丸い体に耳としっぽ
 'chief-of-staff':c=>`<path stroke="none" fill="${c.raw}" opacity=".9" d="M30,-8 C48,-14 52,-34 43,-46 C56,-32 50,-2 32,2 Z"/>`
   +`<ellipse stroke="none" cx="-20" cy="-58" rx="10" ry="12" fill="${c.raw}" transform="rotate(-18 -20 -58)"/>`
   +`<ellipse stroke="none" cx="20" cy="-58" rx="10" ry="12" fill="${c.raw}" transform="rotate(18 20 -58)"/>`
   +`<ellipse stroke="none" cx="-20" cy="-57" rx="5" ry="6.5" fill="rgba(255,190,160,.75)" transform="rotate(-18 -20 -57)"/>`
   +`<ellipse stroke="none" cx="20" cy="-57" rx="5" ry="6.5" fill="rgba(255,190,160,.75)" transform="rotate(18 20 -57)"/>`
   +body(c,'blob',eyes(11,-36,4.6,5.6)+mouth(-24,5)+blush(22,-27))
   +`<path stroke="none" fill="#F2EFE6" d="M-9,-14 L9,-14 L11,-2 L-11,-2 Z" opacity=".95"/>`,

 // 営業＝ドラキー。羽で飛び回る
 sales:c=>[-1,1].map(k=>`<g transform="scale(${k},1)">`
    +`<path stroke="none" fill="${c.raw}" opacity=".92"`
    +` d="M-30,-46 C-50,-60 -66,-52 -62,-32 C-56,-38 -50,-38 -46,-34 C-48,-26 -42,-22 -36,-26 C-34,-32 -32,-38 -30,-42 Z"/>`
    +`<path fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1.6"`
    +` d="M-46,-34 C-42,-38 -36,-42 -31,-44 M-36,-26 C-34,-32 -32,-38 -30,-42"/></g>`).join('')
   +body(c,'bat',eyes(12,-40,6,7)
     +`<path stroke="none" fill="#3A1418" d="M-15,-24 C-8,-14 8,-14 15,-24 C10,-30 -10,-30 -15,-24 Z"/>`
     +`<path stroke="none" fill="#F7EFE4" d="M-9,-26 L-5,-20 L-1,-26 Z M1,-26 L5,-20 L9,-26 Z"/>`
     +`<ellipse stroke="none" cx="0" cy="-17" rx="5" ry="3" fill="rgba(255,120,130,.55)"/>`)
   +`<path stroke="none" fill="${c.raw}" d="M0,-6 C6,-2 8,6 4,10 C4,4 0,0 -2,-4 Z"/>`,

 // マーケ＝いちばん基本のスライム
 marketing:c=>body(c,'slime',eyes(11,-33,5,6)+mouth(-21,5.4)+blush(24,-24))
   +`<ellipse stroke="none" cx="0" cy="-2" rx="27" ry="5" fill="rgba(255,255,255,.14)"/>`,

 // 経営企画＝まほうつかい。とんがり帽子と杖
 planning:c=>`<path stroke="#7A6248" stroke-width="3.4" stroke-linecap="round" d="M30,2 L36,-52"/>`
   +`<circle stroke="none" cx="37" cy="-58" r="7.5" fill="#8FD8F0"/>`
   +`<circle stroke="none" cx="35" cy="-60" r="3" fill="rgba(255,255,255,.85)"/>`
   +body(c,'robe','')
   +`<ellipse stroke="none" cx="0" cy="-56" rx="15" ry="14" fill="#F6E7D2"/>`
   +`<ellipse stroke="none" cx="4" cy="-54" rx="9" ry="12" fill="rgba(120,92,58,.13)"/>`
   +eyes(6,-55,3.4,4.2)+blush(11,-48)
   +`<path stroke="none" fill="${c.raw}" d="M-27,-62 C-18,-92 8,-104 18,-96 C10,-86 4,-72 2,-62 Z"/>`
   +`<path stroke="none" fill="rgba(255,255,255,.22)" d="M-27,-62 C-20,-86 -2,-98 6,-98 C-4,-88 -12,-74 -15,-62 Z"/>`
   +`<path stroke="none" fill="#F0DFA8" d="M-28,-64 C-18,-70 4,-70 4,-62 C-4,-58 -22,-58 -28,-64 Z"/>`
   +`<path stroke="none" fill="#F0DFA8" d="M15,-88 L17,-83 L22,-82 L17,-79 L18,-74 L14,-77 L9,-75 L11,-80 L8,-84 L13,-84 Z"/>`,

 // プロダクト＝おばけキノコ。傘と柄で、丸い塊に見せない
 product:c=>`<path stroke="none" fill="#F4EAD6" d="${SHAPE.stem}"/>`
   +`<path stroke="none" fill="rgba(140,110,70,.16)" d="M4,-38 C10,-38 15,-36 15,-34 L17,-4 C18,1 14,2 10,2 L2,2 Z"/>`
   +eyes(8,-22,4,4.8)+smile(-11,6)+blush(17,-16)
   +body(c,'M0,-72 C24,-72 42,-54 42,-38 C42,-32 36,-30 28,-31 C14,-33 -14,-33 -28,-31 C-36,-30 -42,-32 -42,-38 C-42,-54 -24,-72 0,-72 Z','')
   +`<g stroke="none" fill="rgba(255,255,255,.72)"><ellipse cx="-20" cy="-52" rx="7" ry="5.4"/>`
   +`<ellipse cx="6" cy="-60" rx="5.6" ry="4.4"/><ellipse cx="22" cy="-46" rx="5" ry="3.8"/></g>`,

 // 人事＝おばけ型。手を広げている
 hr:c=>`<ellipse stroke="none" cx="-34" cy="-30" rx="8" ry="10" fill="${c.raw}" transform="rotate(-22 -34 -30)"/>`
   +`<ellipse stroke="none" cx="34" cy="-30" rx="8" ry="10" fill="${c.raw}" transform="rotate(22 34 -30)"/>`
   +body(c,'ghost',eyes(11,-36,4.8,5.8)+mouth(-23,5.2)+blush(23,-27)),

 // 監査＝角が2本
 kansayaku:c=>`<path stroke="none" fill="#F4E6C6" d="M-22,-54 C-34,-78 -20,-86 -11,-66 Z"/>`
   +`<path stroke="none" fill="rgba(140,110,70,.22)" d="M-16,-60 C-24,-76 -18,-82 -13,-70 Z"/>`
   +`<path stroke="none" fill="#F4E6C6" d="M22,-54 C34,-78 20,-86 11,-66 Z"/>`
   +`<path stroke="none" fill="rgba(140,110,70,.22)" d="M16,-60 C24,-76 18,-82 13,-70 Z"/>`
   +body(c,'blob',eyes(12,-37,4.4,6.4)
     +`<path stroke="none" fill="#2B3142" opacity=".9" d="M-13,-22 L13,-22 L10,-13 Q0,-8 -10,-13 Z"/>`
     +`<path stroke="none" fill="#fff" d="M-9,-22 L-5,-17 L-1,-22 Z M1,-22 L5,-17 L9,-22 Z"/>`),

 // 品質審査＝木箱のロボット
 reviewer:c=>`<path stroke="none" stroke-width="0" fill="#C9C2B4" d="M0,-70 L0,-58"/>`
   +`<path stroke="#C9C2B4" stroke-width="3" d="M0,-70 L0,-56"/>`
   +`<circle stroke="none" cx="0" cy="-73" r="4.4" fill="#7DE39B"/>`
   +body(c,'cube',eyes(12,-34,4.4,5.2)+smile(-20,7))
   +`<path stroke="none" fill="rgba(255,255,255,.20)" d="M-31,-56 L31,-56 C35,-56 37,-54 37,-50 L-37,-50 C-37,-54 -35,-56 -31,-56 Z"/>`
   +`<rect stroke="none" x="-16" y="-16" width="32" height="9" rx="3" fill="rgba(0,0,0,.20)"/>`,

 // 代表＝王冠つき。ひとまわり大きい
 hero:c=>`<path stroke="none" fill="#E8C24A" d="M-22,-64 L-15,-78 L-7,-68 L0,-84 L7,-68 L15,-78 L22,-64 Z"/>`
   +`<path stroke="none" fill="rgba(255,255,255,.35)" d="M-22,-64 L-15,-78 L-7,-68 L-4,-74 L-6,-64 Z"/>`
   +`<circle stroke="none" cx="0" cy="-70" r="3.2" fill="#E0503C"/>`
   +body(c,'slime',eyes(12,-34,5.4,6.4)+smile(-19,8)+blush(25,-25))
   +`<path stroke="none" fill="rgba(255,255,255,.18)" d="M-36,-12 C-30,-32 30,-32 36,-12 C38,-6 33,0 25,0 L-25,0 C-33,0 -38,-6 -36,-12 Z"/>`};

let AVN=0;
// 体の色を平らな1色ではなく、光の当たる側から影の側へ流す。
// フィルタは使わない（毎フレームの焼き直しになる）。塗りを変えるだけで立体に見せる
function shade(hex,k){
 const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||'')); if(!m) return hex;
 const n=parseInt(m[1],16);
 const mix=(v)=>Math.max(0,Math.min(255, k>0 ? v+(255-v)*k : v*(1+k)));
 return '#'+[16,8,0].map(sh=>Math.round(mix((n>>sh)&255)).toString(16).padStart(2,'0')).join('');}
function avatar(c,hero){
 const f=MON[hero?'hero':c.slug]||MON['chief-of-staff'];
 const id='vol-'+(hero?'hero':(c.slug||'x'));
 const cc=Object.assign({},c,{col:'url(#'+id+')',raw:c.col});
 return `<svg class="av" viewBox="0 0 116 96">
  <defs>
   <radialGradient id="${id}" cx="33%" cy="21%" r="86%">
    <stop offset="0" stop-color="${shade(c.col,.60)}"/>
    <stop offset="34%" stop-color="${shade(c.col,.18)}"/>
    <stop offset="72%" stop-color="${c.col}"/>
    <stop offset="100%" stop-color="${shade(c.col,-.42)}"/>
   </radialGradient>
   <radialGradient id="gsh"><stop offset="0" stop-color="rgba(0,0,0,.34)"/>
    <stop offset="100%" stop-color="rgba(0,0,0,0)"/></radialGradient>
   <linearGradient id="gbnc" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="rgba(255,255,255,0)"/>
    <stop offset="62%" stop-color="rgba(255,255,255,0)"/>
    <stop offset="100%" stop-color="rgba(255,255,255,.30)"/></linearGradient>
   <linearGradient id="gglo" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="rgba(255,255,255,.62)"/>
    <stop offset="100%" stop-color="rgba(255,255,255,0)"/></linearGradient>
  </defs>
  <ellipse cx="58" cy="89" rx="33" ry="7.5" fill="url(#gsh)"/>
  <g transform="translate(58,88)" stroke="none"
     stroke-linejoin="round" stroke-linecap="round">${f(cc)}</g>
  <ellipse cx="45" cy="52" rx="8.5" ry="5" fill="url(#gglo)" stroke="none"
     transform="rotate(-24 45 52)" opacity=".85"/></svg>`;}

function box(x,y,w,d,h,top,side,extra){
 return `<div class="obj" style="left:${x}px;top:${y}px">
  <div class="tp" style="width:${w}px;height:${d}px;background:${top};transform:translateZ(${h}px)"></div>
  <div class="sd" style="width:${w}px;height:${h}px;background:${side};transform-origin:top;transform:rotateX(-90deg);top:${d}px"></div>
  <div class="sd" style="width:${d}px;height:${h}px;background:${side};transform-origin:left top;transform:translateX(${w}px) rotateY(90deg) rotateX(-90deg) translateY(-${h}px)"></div>
  ${extra||''}</div>`;}

const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
// 期限の見え方。過ぎているものは赤、3日以内は黄
function dueCls(t){ if(!t.due) return '';
 if(t.due<TODAY) return 'late';
 const d=new Date('2026-'+t.due), n=new Date('2026-'+TODAY);
 return (d-n)/86400000<=3?'soon':''; }
function dueTxt(t){ return t.due?t.due.replace('-','/'):'期限なし'; }

// 競合レーダー。自社を中心に置き、強い敵ほど内側（近い）に打つ
function renderRadar(){
 const R=S.rooms[cur], fo=(R.enemies||[]);
 const el=document.getElementById('issb');
 if(!fo.length){ el.innerHTML='<div class="ic"><div class="t">この事業で見ている外敵はありません</div>'
   +'<div class="o">根拠が書ける相手だけを立てています。想像の競合は置きません</div></div>'; return; }
 const S2=300, C=S2/2, MAXR=C-34;
 const KC={'競合':'#FF7A5C','環境':'#C9A8E8','規制':'#E8C46A'};
 let dots='', labs='';
 fo.forEach((e,i)=>{
  const ang=(-90+i*(360/fo.length))*Math.PI/180;
  const r=MAXR*(6-e.power)/5;
  const x=C+Math.cos(ang)*r, y=C+Math.sin(ang)*r;
  const rad=5+e.power*1.9, c=KC[e.kind]||'#FF7A5C';
  dots+=`<line x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"
    stroke="${c}" stroke-width="1" stroke-dasharray="3 3" opacity=".45"/>
   <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad}" fill="${c}" fill-opacity=".85"
    stroke="#1A0A08" stroke-width="1.5"><title>${esc(e.name)}｜★${e.power}</title></circle>`;
  const lx=C+Math.cos(ang)*(r+rad+9), ly=C+Math.sin(ang)*(r+rad+9);
  labs+=`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="#EDF2FF" font-size="10.5"
    text-anchor="${Math.cos(ang)<-0.25?'end':(Math.cos(ang)>0.25?'start':'middle')}"
    dominant-baseline="middle">${esc(e.name.length>11?e.name.slice(0,10)+'…':e.name)}</text>`;});
 const rings=[1,.66,.33].map(k=>`<circle cx="${C}" cy="${C}" r="${(MAXR*k).toFixed(1)}"
   fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1"/>`).join('');
 el.innerHTML=`<div class="rdwrap"><svg viewBox="0 0 ${S2} ${S2}" class="rdr" role="img"
    aria-label="競合レーダー"><defs><radialGradient id="rg">
     <stop offset="0%" stop-color="rgba(120,180,255,.22)"/><stop offset="100%" stop-color="rgba(120,180,255,0)"/>
    </radialGradient></defs>
   <circle cx="${C}" cy="${C}" r="${MAXR}" fill="url(#rg)"/>${rings}
   <line x1="${C}" y1="${C-MAXR}" x2="${C}" y2="${C+MAXR}" stroke="rgba(255,255,255,.1)"/>
   <line x1="${C-MAXR}" y1="${C}" x2="${C+MAXR}" y2="${C}" stroke="rgba(255,255,255,.1)"/>
   ${dots}
   <circle cx="${C}" cy="${C}" r="15" fill="#12235A" stroke="#FFD980" stroke-width="2.5"/>
   <text x="${C}" y="${C}" fill="#FFD980" font-size="11" font-weight="700"
     text-anchor="middle" dominant-baseline="middle">自社</text>${labs}</svg>
   <div class="rdlg"><span><i style="background:#FF7A5C"></i>競合</span>
    <span><i style="background:#C9A8E8"></i>環境</span>
    <span><i style="background:#E8C46A"></i>規制</span>
    <em>内側ほど、いまの数字に当たっている</em></div></div>`
  +fo.map(e=>`<div class="ic"><div class="r">
    <span class="ax ${e.kind==='競合'?'pl':(e.kind==='環境'?'csat':'hiring')}">${esc(e.kind)}</span>
    <span class="sc ${e.power>=4?'hi':(e.power>=3?'mid':'lo')}">★${e.power}</span></div>
   <div class="t">${esc(e.name)}</div>
   <div class="o">${esc(e.weapon)}</div>
   <div class="o" style="color:#FFB9A6;margin-top:4px">当たっている所：${esc(String(e.hits).replace(/\*\*/g,''))}</div>
   <div class="o" style="color:#BFEFCF;margin-top:3px">防ぎ方：${esc(String(e.guard).replace(/\*\*/g,''))}</div>
  </div>`).join('');
}

// 左端の「全体」タブ。部屋は描かず、全事業を1枚にまとめる
// ---- メンバー（人事評価・1on1シート・360度評価）----
let pview=null;
const PGRP=[['1系 基本姿勢',['1-1','1-2','1-3','1-4']],['2系 思考・目標',['2-1','2-2','2-3','2-4']],
            ['3系 チーム・組織',['3-1','3-2','3-3','3-4']],['4系 自律',['4-1','4-2','4-3','4-4']]];

function pGauge(v,a){
 const d=Math.round((v-a)*100)/100, w=Math.min(Math.abs(d)/1.5,1)*50;
 return `<div class="pg"><span class="${d>=0?'pp':'pm'}" style="width:${w}%"></span></div>`
  +`<div class="pd ${d>0?'up2':d<0?'dn2':''}">${d>0?'+':''}${d.toFixed(2)}</div>`;
}

function pList(P){
 const cards=P.people.map((p,i)=>{
  const low=p.low3.map(x=>x.c+' '+x.n+' '+x.v.toFixed(2)).join('　');
  const over=p.objVerdict&&p.objVerdict.indexOf('過大')>=0;
  return `<div class="pcard" data-p="${i}">
   <div class="p1"><span class="rk">${p.rank}位</span><span class="nm2">${esc(p.name)}</span>
    <span class="gd">${esc(p.grade)}</span><span class="ro">${esc(p.role||'')}</span></div>
   <div class="p2"><span class="tot">${p.total}<em>／全社平均 ${P.avgTotal}</em></span>
    <span class="jd">${esc(p.judge||'')}</span>
    ${over?`<span class="warn2">自己 ${p.selfScore}・乖離 ${p.selfGap}</span>`:''}</div>
   <div class="lowline">${esc(low)}</div>
   <div class="ol${p.one?'':' no'}">${p.one?'1on1 '+p.one.date.slice(5).replace('-','/')+'　'+esc(p.one.rec)
     :'1on1 未実施'}　／　${esc(p.nextGrade)} まで あと ${p.gap}</div>
  </div>`;}).join('');
 return `<div class="pgrid">${cards}</div>`
  +`<div class="pmeth">${esc(P.method)}<br>出典：${esc(P.source)}</div>`;
}

function pDetail(P,i){
 const p=P.people[i], A=P.avg, N=P.names;
 const bars=PGRP.map(([g,cs])=>`<div class="pgrp">${g}</div>`+cs.map(c=>
   `<div class="prow"><div class="pi">${c} ${esc(N[c])}</div>
     <div class="pv">${p.scores[c].toFixed(2)}</div>${pGauge(p.scores[c],A[c])}</div>`).join('')).join('');
 const grow=p.grow.map((g,k)=>`<div class="pli"><b>${k+1}位　${esc(g.item)}</b>　周囲の評価 ${esc(g.v)}</div>`
   +(g.note?`<div class="pnote">${esc(g.note)}</div>`:'')).join('');
 const strong=p.strong.map((g,k)=>`<div class="pli"><b>${k+1}位　${esc(g.item)}</b>　周囲の評価 ${esc(g.v)}</div>`
   +(g.note?`<div class="pnote">${esc(g.note)}</div>`:'')).join('');
 const o=p.one;
 const sol=`<div class="psec"><h4>解決策</h4>
   <div class="pkv"><span>${esc(p.grade)} → ${esc(p.nextGrade)} 基準 <b>${p.bar}</b></span>
    <span class="hot2">あと <b>${p.gap}</b></span>
    <span>下位3項目を5点にすると <b>+${p.lift3.toFixed(2)}</b></span></div>
   <div class="pli">${esc(p.liftNote)}</div>
   ${o?`<div class="pli"><b>1on1で置いた伸ばす一点：${esc(o.focus)}</b></div>
     <div class="pnote">${esc(o.why)}</div>`
     :`<div class="pli">1on1が未実施のため、伸ばす一点はまだ決まっていません。
       上の試算が、面談で最初に置く材料になります。</div>`}
   ${o&&o.actions?`<h4 style="margin-top:12px">決まった行動</h4>`
     +o.actions.map(a=>`<div class="pli">${esc(a)}</div>`).join(''):''}
   ${o&&o.carry?`<h4 style="margin-top:12px">次回に持ち越す論点</h4>`
     +o.carry.map(a=>`<div class="pli">${esc(a)}</div>`).join(''):''}</div>`;
 const vis=`<div class="psec"><h4>ビジョン（本人の記入）</h4>
   ${p.vision.half?`<div class="pli"><b>半年後</b></div><div class="pnote">${esc(p.vision.half)}</div>`:''}
   ${p.vision.years?`<div class="pli"><b>何年後に、どんな役割か</b></div><div class="pnote">${esc(p.vision.years)}</div>`:''}
   ${p.vision.support?`<div class="pli"><b>上司に支援してほしいこと</b></div><div class="pnote">${esc(p.vision.support)}</div>`:''}
   ${(!p.vision.half&&!p.vision.years&&!p.vision.support)?`<div class="pli">自己認識シートの記入がありません（役員レイヤーは未提出）。</div>`:''}
   ${o&&o.goals&&o.goals.length?`<h4 style="margin-top:12px">1on1で置いた目標（${o.date}）</h4>`
     +o.goals.map(g=>`<div class="pli">${esc(g)}</div>`).join(''):''}
   ${o&&o.hooks?`<h4 style="margin-top:12px">面談で使った読み</h4>`
     +o.hooks.map(g=>`<div class="pli">${esc(g)}</div>`).join(''):''}</div>`;
 return `<div class="pdet">
  <button class="pback" id="pback">← メンバー一覧へ</button>
  <div class="psec"><h4>いまの立ち位置</h4>
   <div class="pkv"><span>総合 <b>${p.total}</b></span><span>${p.rank}位 / 13人</span>
    <span>判定 <b>${esc(p.judge)}</b></span><span>全社平均 ${P.avgTotal}</span>
    <span${p.objVerdict&&p.objVerdict.indexOf('過大')>=0?' class="hot2"':''}>自己 <b>${p.selfScore}</b>　乖離 ${p.selfGap}　${esc(p.objVerdict||'')}</span>
    <span>評価者 ${esc(p.raters||'')}</span></div>
   <div class="pli">${esc(p.grade)}／${esc(p.role||'')}　上司：${esc(p.boss||'—')}　入社 ${esc(p.joined||'—')}</div>
   ${p.worst?`<div class="pli">自己評価と最もズレた項目：<b>${esc(p.worst)}</b>（差 ${esc(p.worstGap)}）</div>`:''}
  </div>
  <div class="psec"><h4>課題　下位3項目（実測差）</h4>
   ${p.low3.map(x=>`<div class="pli"><b>${x.c} ${esc(x.n)}　${x.v.toFixed(2)}</b>　全社平均との差 <span class="${x.d>=0?'up2':'dn2'}">${x.d>0?'+':''}${x.d.toFixed(2)}</span></div>`).join('')}
   <h4 style="margin-top:12px">本人が挙げた「これから伸ばすところ」</h4>${grow}</div>
  ${sol}
  ${vis}
  <div class="psec"><h4>強み（本人が挙げたもの）</h4>${strong}</div>
  <div class="psec"><h4>360度評価　16項目（中央線＝全社平均）</h4>${bars}</div>
  <div class="psec"><h4>1on1シート</h4>
   ${['山元慎也','加藤瞭','土屋良之'].indexOf(p.name)>=0
     ?`<a class="plink" href="${P.sheetUrl}" target="_blank" rel="noopener">${esc(p.name)}の1on1進行シートを開く</a>`
     :`<div class="pli">このメンバーの1on1進行シートはまだ作っていません。</div>`}</div>
  <div class="pmeth" style="padding-left:0">${esc(P.method)}<br>出典：${esc(P.source)}</div>
 </div>`;
}

function renderPeople(){
 const st=document.getElementById('stage'), lc=document.querySelector('.leftcol'),
       is=document.getElementById('iss'), sm=document.getElementById('sum');
 [st,lc,is].forEach(e=>{if(e) e.hidden=true;});
 sm.hidden=false;
 const hd=document.querySelector('#sum .sumh'), bd=document.getElementById('sumb');
 const P=S.people;
 if(!P||!P.people||!P.people.length){
  if(hd) hd.textContent='メンバー';
  bd.innerHTML='<div class="pmeth" style="padding-top:16px">data/people.json がありません。</div>';
 }else if(pview===null){
  if(hd) hd.textContent='メンバー　'+P.biz+'　'+P.term;
  bd.innerHTML=pList(P);
  bd.querySelectorAll('.pcard').forEach(c=>c.onclick=()=>{pview=+c.dataset.p; renderPeople();
   document.getElementById('sumb').scrollTop=0;});
 }else{
  const p=P.people[pview];
  if(hd) hd.textContent=p.name+'　'+p.grade+'　'+(p.role||'');
  bd.innerHTML=pDetail(P,pview);
  const bk=document.getElementById('pback');
  if(bk) bk.onclick=()=>{pview=null; renderPeople(); document.getElementById('sumb').scrollTop=0;};
 }
 document.getElementById('tabs').innerHTML=tabsHTML();
 document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',+b.dataset.i===cur));
}

// 会議後に出た実行候補。代表が「実行する」を選んだものだけを次の回で動かす。
// 選択は他のチェックと同じで、保存するまで端末にしか残らない
function propHTML(){
 const P=(S.props||[]).filter(p=>p.st!=='done');
 if(!P.length) return '';
 const wait=P.filter(p=>!PRDEC[p.id]).length;
 const rows=P.map(p=>{
  const d=PRDEC[p.id]||'';
  return `<div class="pp ${d}">
   <div class="p1"><span class="pcl c${esc(p.cls||'A')}">${esc(p.cls||'A')}</span>
    <span class="px">${esc(p.t)}</span></div>
   <div class="p2">${esc(p.b||'')}｜${esc(p.m||'')}｜${esc((p.d||'').replace('-','/'))}</div>`
   +(p.plan?`<div class="p3">${esc(p.plan)}</div>`:'')
   +`<div class="p4">
    <button class="pb do${d==='do'?' on':''}" data-p="${esc(p.id)}" data-v="do">実行する</button>
    <button class="pb sk${d==='skip'?' on':''}" data-p="${esc(p.id)}" data-v="skip">やらない</button>`
   +(d?`<span class="pst">${d==='do'?'次の回で実行します':'見送ります'}</span>`:'')
   +`</div></div>`;}).join('');
 return `<div class="sech">会議後に出た実行候補 ${P.length}件`
  +(wait?`　<em class="pw">未選択 ${wait}件</em>`:'　<em>すべて選択済み</em>')+`</div>`
  +`<div class="pnote">選んだものだけを次の回で動かします。何も選ばなければ何も実行しません。`
  +`<br>選び直すときは同じボタンをもう一度押すと未選択に戻ります。</div>`
  +`<div class="pgrid">${rows}</div>`
  +`<div class="psv"><button id="prsv">選択を保存</button><span id="prmsg"></span></div>`;
}

function renderSum(){
 const st=document.getElementById('stage'), lc=document.querySelector('.leftcol'),
       is=document.getElementById('iss'), sm=document.getElementById('sum');
 [st,lc,is].forEach(e=>{if(e) e.hidden=true;});
 sm.hidden=false;
 const _sh=document.querySelector('#sum .sumh'); if(_sh) _sh.textContent='全体';
 const rows=S.rooms.map((r,i)=>{
  const w=WX[r.wx]||WX.fog, mine=(r.mine||[]).filter(mtLive),
        late=mine.filter(t=>t.due&&t.due<TODAY).length, T=r.tr||{};
  // 載せるのは3つだけ。①伸びているか（天気）②いちばんの課題 ③気にしている数字
  const top=(r.issues||[])[0];
  // 「注意」は一目で読める1文だけ。長い説明は部屋の中で見る
  let watch='';
  if(T.watch){
   watch=String(T.watch).split('／')[0].split('。')[0].trim();
   if(watch.length>46) watch=watch.slice(0,45)+'…';
  }
  return `<div class="strow" data-i="${i}">
   <span class="bn">${esc(r.biz)}</span>
   <span class="wx2 ${r.wx}"><b class="wxi ${r.wx}">${w.i}</b>${esc(w.n)}</span>
   <span class="num${(r.issues||[]).length?'':' z'}">課題 <b>${(r.issues||[]).length}</b></span>
   <span class="num${r.heavy?' hot':' z'}">重い <b>${r.heavy||0}</b></span>
   <span class="num${mine.length?(late?' hot':''):' z'}">残 <b>${mine.length}</b>${late?'<br>期限切れ '+late:''}</span>
   <span class="tt">${top?esc(top.title):`<em>${esc(T.dormant||'課題は挙がっていない')}</em>`}`
   +`${watch?`<i>${esc(watch)}</i>`:''}</span></div>`;}).join('');
 const head=`<div class="strow sthd"><span>事業</span><span>伸びているか</span>`
  +`<span style="text-align:right">課題</span><span style="text-align:right">重い</span>`
  +`<span style="text-align:right">あなたの残</span><span>いちばんの課題／注意</span></div>`;
 // 自分のタスクは全事業を1本にまとめて期限順。事業ごとに探しにいかなくて済むように
 const all=[]; S.rooms.forEach(r=>(r.mine||[]).filter(mtLive).forEach(t=>all.push(t)));
 all.sort((a,b)=>((a.due?0:1)-(b.due?0:1))||String(a.due||'').localeCompare(String(b.due||''))
   ||String(a.d||'').localeCompare(String(b.d||'')));
 const FLAG={mis:'割り当てミスの疑い',dup:'重複',done:'完了済みの疑い'};
 let tl=all.map(t=>`<div class="mt ${dueCls(t)}">
   <input type="checkbox" data-k="${esc(mtKey(t))}" title="済にする">
   <span class="k">${esc(dueTxt(t))}</span>
   <span><span class="x">${esc(t.t)}</span>
    <span class="s">${esc(t.b)}｜${esc(t.m)}｜${esc((t.d||'').replace('-','/'))} 発生`
   +(t.flag&&FLAG[t.flag]?`　<em>${FLAG[t.flag]}</em>`:'')+`</span></span>
   <button class="nm2" data-n="${esc(mtKey(t))}">自分のじゃない</button></div>`).join('');
 if(!all.length) tl='<div class="ic"><div class="t">あなたの手が要る残タスクはありません</div></div>';
 // 乗組員の熟練度。根拠は稼働記録と蓄積ファイルだけ
 const QW=[['型','型'],['外した','外した'],['確定した指摘','確定'],['事業知識','事業知識']];
 const cr=Object.keys(S.crew).map(sl=>{const c=S.crew[sl],k=c.skill; if(!k)return'';
  const parts=QW.filter(w=>k[w[1]]).map(w=>`${w[0]} <b>${k[w[1]]}</b>`);
  const minus=k['未確認']?`<span class="mi">未確認のまま ${k['未確認']}</span>`:'';
  return `<div class="lvc${k['外部の型']?'':' nogot'}">
   <div class="l1"><span class="lvb">Lv.${k.lv}<em>/100</em></span><span class="lvn">${esc(c.nick)}</span>
    <span class="ttl">${esc(k.title)}</span><span class="lvr">${esc(c.role)}</span></div>
   <div class="bar"><i style="width:${k.pct}%"></i></div>
   <div class="l2">${k.nxt?`次のレベルまで <b>${k.nxt-k.exp}</b>`:'最上位'}
    <span class="ex">EXP ${k.exp}</span></div>
   <div class="l3">${parts.length?parts.join('　'):'<span class="mi">まだ何も溜まっていない</span>'}　${minus}</div>
   <div class="l4">${k['外部の型']?`外部から取り込んだ型 <b>${k['外部の型']}</b>`:'外部から取り込んだ型 <b>0</b>'}</div>
  </div>`;}).join('');
 document.getElementById('sumb').innerHTML=propHTML()+`<div class="stbl">${head}${rows}</div>`
  +(()=>{const all=[];S.rooms.forEach(r=>(r.enemies||[]).forEach(e=>all.push([r.biz,e])));
    if(!all.length)return'';
    all.sort((a,b)=>b[1].power-a[1].power);
    return `<div class="sech">外から攻めてきているもの ${all.length}体</div>`
     +`<div class="fgrid">`+all.map(([bz,e])=>`<div class="fc k${e.kind}">
       <div class="f1"><span class="fstar">${'★'.repeat(e.power)}${'・'.repeat(5-e.power)}</span>
        <span class="fnm">${esc(e.name)}</span>
        <span class="fbz">${esc(bz)}</span></div>
       <div class="f2">${esc(e.weapon)}</div>
       <div class="f3"><b>当たっている所</b>${esc(String(e.hits).replace(/\*\*/g,''))}</div>
       <div class="f4"><b>防ぎ方</b>${esc(String(e.guard).replace(/\*\*/g,''))}</div>
      </div>`).join('')+`</div>`;})()
  +`<div class="sech">乗組員の専門知識（蓄積の中身だけで算出。稼働した回数は入れない）</div>`
  +`<div class="lvgrid">${cr}</div>`
  +`<div class="lvnote">型25／外した事例30／確定した指摘20／事業知識10／<b>外部から取り込んだ型40</b>／未確認のまま −5。`
   +`<br>外した事例が確定した指摘より重いのは、<b>外した記録の方が判断を締めるから</b>。`
   +`<br>上限は <b>Lv.100</b>。Lv.20 に 505、Lv.50 に 3,874、Lv.100 に 17,573 が要る。`
   +`<br>いまの最上位は監査役の Lv.19。<b>全員まだ入口にいる。</b></div>`
  +`<div class="sech">あなたの残タスク ${all.length}件（全事業まとめ・期限順）</div>`+tl;
 document.getElementById('sumb').querySelectorAll('.strow[data-i]').forEach(c=>c.onclick=()=>{
  cur=+c.dataset.i; render();
  const b=document.querySelector('#tabs button[data-i="'+cur+'"]');
  if(b) b.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});});
 document.getElementById('sumb').querySelectorAll('.mt input').forEach(b=>b.onchange=()=>{
  if(b.checked) MDONE.add(b.dataset.k); else MDONE.delete(b.dataset.k);
  mdSet([...MDONE]); mdDirty=true; render();});
 document.getElementById('sumb').querySelectorAll('.mt .nm2').forEach(b=>b.onclick=()=>{
  const k=b.dataset.n;
  if(MNOT[k]!==undefined) delete MNOT[k]; else MNOT[k]='画面で「自分のじゃない」を指定';
  mnSet(MNOT); mdDirty=true; render();});
 // 実行候補の選択。同じボタンをもう一度押すと未選択に戻る
 document.getElementById('sumb').querySelectorAll('.pb').forEach(b=>b.onclick=()=>{
  const id=b.dataset.p, v=b.dataset.v;
  if(PRDEC[id]===v) delete PRDEC[id]; else PRDEC[id]=v;
  prSet(PRDEC); mdDirty=true; renderSum();});
 const psv=document.getElementById('prsv');
 if(psv) psv.onclick=async()=>{psv.disabled=true;psv.textContent='保存中…';
  S.prDec=PRDEC; S.mtDone=[...MDONE]; S.mtNot=MNOT;
  const ok=await saveDoc();
  const pm=document.getElementById('prmsg');
  if(pm) pm.textContent=ok?'保存しました。次の回で実行します':'保存できませんでした';
  if(ok) mdDirty=false;
  psv.disabled=false; psv.textContent='選択を保存';};
 document.getElementById('tabs').innerHTML=tabsHTML();
 document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',+b.dataset.i===cur));
}

function render(){
 const sm=document.getElementById('sum');
 if(cur===-2) return renderPeople();
 if(cur<0) return renderSum();
 const st=document.getElementById('stage'), lc=document.querySelector('.leftcol'),
       is=document.getElementById('iss');
 [st,lc,is].forEach(e=>{if(e) e.hidden=false;});
 if(window.__refit) __refit();   // 部屋が変わるたびに測り直す（人数も敵の数も違う）
 if(sm) sm.hidden=true;
 const R=S.rooms[cur], MINE=(R.mine||[]).filter(mtLive);
 const _w=document.querySelector('.wrap'); if(_w) _w.dataset.wx=R.wx||'fine';
 const P=R.pal||{}, st0=document.getElementById('stage');
 for(const [k,v] of Object.entries({wall:P.wall,wall2:P.wall2,flrA:P.flrA,flrB:P.flrB,rug:P.rug}))
  if(v) st0.style.setProperty('--'+k, v);
 let h=`<div class="base"><div class="bt"></div>
   <div class="bs" style="width:936px;height:26px;transform-origin:top;transform:rotateX(-90deg);top:696px"></div>
   <div class="bs" style="width:696px;height:26px;transform-origin:left top;transform:translateX(936px) rotateY(90deg) rotateX(-90deg) translateY(-26px)"></div></div>`;
 h+='<div class="floor"></div>';
 h+='<div class="carpet" style="left:398px;top:8px;width:104px;height:600px"></div>';
 h+='<div class="wallN">';
 [96,236,592,732].forEach(x=>{h+=`<div class="win" style="left:${x}px;top:52px;width:100px;height:110px"></div>`;});
 // 依頼の立て札。代表に残っている上位3件を貼る

 [48,850].forEach(x=>{h+=`<div class="torch" style="left:${x}px;top:96px"><b></b></div>`;});
 [[196,'.9'],[346,'.7'],[520,'.7'],[672,'.9']].forEach(([x,a])=>{
  h+=`<div class="flag" style="left:${x}px;top:22px;--fc:rgba(${P.rug||'232,112,63'},${a})"><i></i></div>`;});
 h+='</div><div class="wallW">';
 [90,300,510].forEach(x=>{h+=`<div class="win" style="left:${x}px;top:58px;width:96px;height:104px"></div>`;});
 h+=`<div class="torch" style="left:216px;top:104px"><b></b></div>`;
 h+='</div><div class="wallE">';
 [90,300,510].forEach(x=>{h+=`<div class="win" style="left:${x}px;top:58px;width:96px;height:104px"></div>`;});
 h+=`<div class="torch" style="left:216px;top:104px"><b></b></div>`;
 h+='</div>';
 h+=`<div class="sign" style="left:450px;top:2px"><b><span>${esc(R.biz)}</span>`
   +`<em>${esc((R.order||'').slice(0,26)||'VIRTUAL OFFICE')}</em></b></div>`;
 // 外から攻めてきているもの。部屋の外（床の外周）に立てる。強いものほど大きく、部屋に近い
 const EPOS=[[70,470],[70,600],[840,470],[840,600],[236,618],[672,618]];
 (R.enemies||[]).forEach((e,i)=>{const q=EPOS[i]; if(!q)return;
  const sz=26+e.power*7, kc={'競合':'#C0392B','環境':'#7D5BA6','規制':'#B7791F'}[e.kind]||'#C0392B';
  h+=`<div class="foe p${e.power}" data-e="${i}" style="left:${q[0]}px;top:${q[1]}px">
   <svg class="fav" width="${sz}" height="${sz}" viewBox="0 0 40 40" aria-hidden="true">
    <ellipse cx="20" cy="37" rx="12" ry="3" fill="rgba(0,0,0,.35)"/>
    <path d="M20 4C12 4 7 11 7 20c0 8 5 13 13 13s13-5 13-13C33 11 28 4 20 4z"
      fill="${kc}" stroke="#1A0A08" stroke-width="2.5"/>
    <path d="M20 4C12 4 7 11 7 20c0 3 .7 5.6 2 7.7C10 20 14 15 20 15s10 5 11 12.7c1.3-2.1 2-4.7 2-7.7C33 11 28 4 20 4z"
      fill="rgba(255,255,255,.18)"/>
    <circle cx="14.5" cy="19" r="2.6" fill="#FFE9A8"/><circle cx="25.5" cy="19" r="2.6" fill="#FFE9A8"/>
    <circle cx="14.5" cy="19" r="1.1" fill="#1A0A08"/><circle cx="25.5" cy="19" r="1.1" fill="#1A0A08"/>
   </svg>
   <div class="fb"><div class="fn">${esc(e.name)}</div>
    <div class="fk"><span class="kd ${e.kind}">${esc(e.kind)}</span>${'★'.repeat(e.power)}</div>
    <div class="fd">${esc(e.weapon)}</div></div></div>`;});
 // 依頼の立て札。壁に貼らず、常にカメラを向く板にする（壁貼りだと裏から見て鏡文字になる）
 const top3=MINE.slice(0,3);
 h+=`<div class="quest" style="left:812px;top:300px"><div class="pole"></div><div class="qb">
   <div class="qt">依頼の立て札</div>`;
 top3.slice(0,2).forEach(t=>{h+=`<div class="qi"><b>${esc(dueTxt(t))}</b>${esc(t.t.slice(0,26))}</div>`;});
 if(!top3.length) h+='<div class="qi" style="text-align:center">依頼はありません</div>';
 h+='</div></div>';

 const POS=[[150,92],[700,92],[150,276],[700,276],[296,452],[604,452]];
 const PREF={sales:'pl',marketing:'csat',planning:'pl',product:'csat',hr:'hiring'};
 const claimed=new Set();
 (R.staff||[]).forEach((slug,i)=>{
  const c=S.crew[slug]; if(!c||!POS[i])return;
  const [x,y]=POS[i];
  // 木の天板＋白い脚。参考画面のオフィス什器に寄せる
  h+=box(x-18,y+10,108,62,26,'linear-gradient(150deg,#D6AE7E,#B98B57)','linear-gradient(180deg,#F2EFE8,#CFC9BE)',
    `<div class="mon" style="left:36px;top:9px;width:40px;height:27px;transform:translateZ(26px)"></div>`
    +`<div class="kb" style="left:30px;top:42px;width:50px;height:12px;transform:translateZ(27px)"></div>`
    +`<div class="cup" style="left:12px;top:14px;transform:translateZ(27px)"></div>`);
  // チェア
  h+=box(x+10,y+82,40,26,14,'linear-gradient(150deg,#E4D9C4,#C9BB9F)','linear-gradient(180deg,#C2A97F,#9A825C)',
    `<div class="bk" style="left:0;top:-4px;width:40px;height:26px;transform-origin:bottom;`
    +`transform:translateZ(14px) rotateX(-84deg)"></div>`);
  const q=S.quotes.find(q=>q.dept===slug&&q.biz===R.biz), real=!!q;
  let say;
  if(real){ say=q.text; }
  else if(c.task && c.task.indexOf(R.biz)>=0){ say=c.task.slice(0,40); }
  else {
    const ax=PREF[slug];
    let pick=(R.issues||[]).find(i=>!claimed.has(i.title)&&(!ax||i.axis===ax));
    if(!pick) pick=(R.issues||[]).find(i=>!claimed.has(i.title));
    if(pick){ claimed.add(pick.title); say=pick.title; }
    else say=c.label;
  }
  if(say&&say.length>26) say=say.slice(0,25)+'…';
  h+=`<div class="unit ${c.state}" data-s="${slug}" style="left:${x}px;top:${y}px">
   <div class="bill">${avatar(c)}
    <div class="plate"><div class="nm"><i style="background:${COL[c.state]};color:${COL[c.state]}"></i>${esc(c.nick)}${c.skill?`<span class="lv">Lv.${c.skill.lv}</span>`:''}</div>
    <div class="rl">${esc(c.role)} ／ ${esc(c.label)}</div></div>
    <div class="bub ${real?'real':''}">${esc(say)}${real?`<span class="w">${esc(q.who)}｜${esc(q.src)}</span>`:''}</div>
   </div></div>`;});

 // 代表（勇者）。この事業に残っている自分のタスク数を頭の上に出す
 const late=MINE.filter(t=>t.due&&t.due<TODAY).length;
 const HERO={col:'#2F63C4',hairc:'#3A2A1E',hair:'hero',prop:'hero',
   nick:'代表',role:'あなた',state:'running',label:''};
 h+=`<div class="unit hero running" style="left:450px;top:560px">
   <div class="bill">
    <div class="cnt ${MINE.length?(late?'late':''):'zero'}">残 ${MINE.length}${late?'　期限切れ '+late:''}</div>
    ${avatar(HERO,true)}
    <div class="plate"><div class="nm">代表</div><div class="rl">あなた ／ ${esc(R.biz)}</div></div>
    ${MINE.length?`<div class="bub">${esc(MINE[0].t.slice(0,40))}<span class="w" style="color:#FFC24A">${esc(dueTxt(MINE[0]))}</span></div>`
      :'<div class="bub">この事業にあなたの残タスクはありません</div>'}
   </div></div>`;
 [[300,200],[600,340],[190,380]].forEach(([x,y],i)=>{
  h+=`<div class="spark" style="left:${x}px;top:${y}px;animation-delay:-${i*1.6}s"></div>`;});

 [[26,40],[860,40],[26,380],[860,380],[352,26],[540,26]].forEach(([x,y])=>{
  h+=`<div class="plant" style="left:${x}px;top:${y}px"><div class="pot"></div><div class="lf"></div></div>`;});
 // 打ち合わせテーブル
 h+=box(352,178,196,70,24,'linear-gradient(150deg,#DDB98C,#C09461)','linear-gradient(180deg,#F2EFE8,#CFC9BE)');
 // 壁際の書棚（本の色は会社色）
 [[36,150],[36,240],[790,150],[790,240]].forEach(([x,y])=>{
  h+=box(x,y,78,26,74,'linear-gradient(150deg,#A87B4C,#8A6038)','linear-gradient(180deg,#B98B57,#8A6038)',
   [18,38,58].map(t=>`<div class="shelf" style="top:${t}px"></div>`).join('')
   +[8,20,32,46].map((l,i)=>`<div class="bk2" style="left:${l}px;--bc:rgba(var(--rug,232,112,63),${.5+i*.12})"></div>`).join(''));});
 // 収納キャビネット
 h+=box(120,10,150,30,52,'linear-gradient(150deg,#E6E2DA,#C8C2B6)','linear-gradient(180deg,#EFECE4,#BDB6A8)');
 h+=box(630,10,150,30,52,'linear-gradient(150deg,#E6E2DA,#C8C2B6)','linear-gradient(180deg,#EFECE4,#BDB6A8)');

 const PATH_A="M424,120 L424,600 L476,600 L476,120 Z";
 const PATH_B="M110,400 L790,400 L790,180 L110,180 Z";
 // 巡回は2人まで。3Dの面で動くものが増えるほど、毎フレームの焼き直しが重くなる
 const ROAM=[['w1',PATH_A,'chief-of-staff','資料を回しています'],
             ['w3',PATH_B,'kansayaku','数字を突き合わせています']];
 ROAM.forEach(([cls,path,slug,say])=>{
  const c=S.crew[slug]; if(!c)return;
  h+=`<div class="walk ${cls}" style="offset-path:path('${path}')">
   <div class="bill2">${avatar(c)}<div class="tag">${esc(say)}</div></div></div>`;});
 room.innerHTML=h;

 renderPane();
 document.getElementById('ic').textContent=(R.issues||[]).length;
 document.getElementById('mc').textContent=MINE.length;
 const w=WX[R.wx]||WX.fog, T=R.tr;
 document.getElementById('ord').innerHTML=`<b>${esc(R.biz)}</b> の優先順位`
  +` <span class="wx">${w.i} ${w.n}</span>`
  +(T&&T.by?`<span class="by">${esc(T.by)}</span>`:'')
  +(T&&T.dormant?`<span class="by dm">${esc(T.dormant)}</span>`:'')
  +`<span>${esc(R.order||'未設定')}　／　あなたの残タスク ${MINE.length}件`
  +(late?`（期限切れ ${late}）`:'')+`</span>`
  +(T?`<span class="tr"><em>前</em>${esc(T.prev)}</span>`
     +`<span class="tr"><em>今</em>${esc(T.now)}</span>`
     +(T.watch&&T.watch!=='—'?`<span class="tr w"><em>注</em>${esc(T.watch)}</span>`:'')
     +`<span class="src">${esc(T.basis)}</span>`
    :`<span class="tr w">業績のトレンドが登録されていません</span>`)
  +`<span>課題 ${(R.issues||[]).length}件（重いもの ${R.heavy||0}件）— 課題の量は天気に入れていません</span>`;
 document.getElementById('tabs').innerHTML=tabsHTML();
 document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',+b.dataset.i===cur));
}

function renderPane(){
 const R=S.rooms[cur], el=document.getElementById('issb');
 document.getElementById('sw0').classList.toggle('on',pane===0);
 document.getElementById('sw1').classList.toggle('on',pane===1);
 document.getElementById('sw2').classList.toggle('on',pane===2);
 document.getElementById('fcn').textContent=(R.enemies||[]).length;
 if(pane===2){ renderRadar(); return; }
 if(pane===0){
  const AX={csat:'顧客満足',hiring:'採用',pl:'売上'}, bn=s=>s>=2?'hi':(s>=1?'mid':'lo');
  el.innerHTML=(R.issues||[]).length?R.issues.map(i=>
   `<div class="ic${i.pin?' pin':''}"><div class="r"><span class="ax ${i.axis}">${AX[i.axis]}</span>
    ${i.pin?'<span class="pinf">代表指定</span>':''}
    <span class="sc ${bn(i.score)}">${i.score.toFixed(2)}</span></div>
    <div class="t">${esc(i.title)}</div><div class="o">任せる ${esc(i.owner)}</div></div>`).join('')
   :'<div class="ic"><div class="t">課題は登録されていません</div></div>';
  return;}
 const M=R.mine||[];
 if(!M.length){el.innerHTML='<div class="ic"><div class="t">この事業に、あなたの手が要る残タスクはありません</div></div>';return;}
 const FLAG={mis:'割り当てミスの疑い',dup:'重複',done:'完了済みの疑い'};
 const row=t=>{const k=mtKey(t), dn=MDONE.has(k), no=MNOT[k]!==undefined;
  return `<div class="mt ${no?'no':(dn?'dn':dueCls(t))}">
   <input type="checkbox" data-k="${esc(k)}"${dn?' checked':''} title="済にする">
   <span class="k">${esc(dueTxt(t))}</span>
   <span><span class="x">${esc(t.t)}</span>
    <span class="s">${esc(t.m)}｜${esc(t.d.replace('-','/'))} 発生`
    +(t.flag&&FLAG[t.flag]?`　<em>${FLAG[t.flag]}</em>`:'')
    +(t.nt?`</span><span class="s nt">※ ${esc(t.nt)}`:'')
    +(no&&MNOT[k]?`</span><span class="s nt">※ ${esc(MNOT[k])}`:'')+`</span></span>
   <button class="nm2" data-n="${esc(k)}">${no?'自分のに戻す':'自分のじゃない'}</button></div>`;};
 const open=M.filter(t=>!MDONE.has(mtKey(t))&&MNOT[mtKey(t)]===undefined),
       done=M.filter(t=>MDONE.has(mtKey(t))&&MNOT[mtKey(t)]===undefined),
       not =M.filter(t=>MNOT[mtKey(t)]!==undefined);
 let out=mdDirty?`<div class="mtsave">この端末に残しています。全員に反映するには保存してください`
   +`<button id="mtsv">保存</button></div>`:'';
 out+=`<div class="mth">Circleback 未完了 ${open.length}件／${esc(S.myt&&S.myt.window||'')} 発生分`
  +((S.myt&&S.myt.older)?`<span class="cut">${esc(S.myt.older)}</span>`:'')+`</div>`;
 out+=open.map(row).join('') || '<div class="ic"><div class="t">この事業に残っているものはありません</div></div>';
 if(done.length) out+=`<div class="mth">済 ${done.length}件（チェックを外すと戻ります）</div>`+done.map(row).join('');
 if(not.length) out+=`<div class="mth">自分のタスクではない ${not.length}件（Circlebackが主催者に振ったもの）</div>`+not.map(row).join('');
 el.innerHTML=out;
 el.querySelectorAll('.mt input').forEach(b=>b.onchange=()=>{
  if(b.checked) MDONE.add(b.dataset.k); else MDONE.delete(b.dataset.k);
  mdSet([...MDONE]); mdDirty=true;
  render();});           // 件数バッジと勇者の頭上も一緒に直す
 el.querySelectorAll('.mt .nm2').forEach(b=>b.onclick=()=>{
  const k=b.dataset.n;
  if(MNOT[k]!==undefined) delete MNOT[k]; else MNOT[k]='画面で「自分のじゃない」を指定';
  mnSet(MNOT); mdDirty=true;
  render();});
 const sv=document.getElementById('mtsv');
 if(sv) sv.onclick=async()=>{sv.disabled=true;sv.textContent='保存中…';
  S.mtDone=[...MDONE]; S.mtNot=MNOT;
  const ok=await saveDoc();
  if(ok){mdDirty=false;renderPane();} else {sv.disabled=false;sv.textContent='保存';}};
}
document.getElementById('sw0').onclick=()=>{pane=0;renderPane();};
document.getElementById('sw1').onclick=()=>{pane=1;renderPane();};
document.getElementById('sw2').onclick=()=>{pane=2;renderPane();};

function tabsHTML(){
 const all=S.rooms.reduce((a,r)=>a+(r.mine||[]).filter(mtLive).length,0);
 const iss=S.rooms.reduce((a,r)=>a+(r.issues||[]).length,0);
 // 左端は事業ではなく「全体」。ここに全社の天気・課題・自分のタスクをまとめる
 let out=`<button data-i="-1" class="allt" title="全事業のまとめ">全体<i>${iss}</i>`
  +(all?`<u>残${all}</u>`:'')+`</button>`;
 // 事業の隣に「メンバー」。人事評価・1on1・360度評価はここに集約する
 const np=(S.people&&S.people.people)?S.people.people.length:0;
 out+=`<button data-i="-2" class="allt" title="人事評価・1on1シート・360度評価">メンバー<i>${np}</i></button>`;
 out+=S.rooms.map((r,i)=>{
  const n=(r.mine||[]).filter(mtLive).length;
  return `<button data-i="${i}" title="${(WX[r.wx]||WX.fine).n}">`
  +`<b class="wxi ${r.wx}">${(WX[r.wx]||WX.fine).i}</b>${esc(r.biz)}<i>${(r.issues||[]).length}</i>`
  +(n?`<u>残${n}</u>`:'')+`</button>`;}).join('');
 return out;}
document.getElementById('tabs').innerHTML=tabsHTML();
document.getElementById('tabs').addEventListener('click',e=>{
 const b=e.target.closest('button'); if(!b)return; cur=+b.dataset.i; render();});
// 並んでいる順に送る。数字の順（-2,-1,0…）で回すと、画面では
// 全体→メンバー の並びなのに メンバー→全体 に飛んでいた（2026-09-20 代表指摘）
function tabOrder(){ return [-1,-2].concat(S.rooms.map((r,i)=>i)); }
function gotoTab(step){
 const o=tabOrder(); if(!o.length)return;
 let at=o.indexOf(cur); if(at<0) at=0;
 cur=o[((at+step)%o.length+o.length)%o.length]; render();
 const b=document.querySelector('#tabs button[data-i="'+cur+'"]');
 if(b) b.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});
}
document.addEventListener('keydown',e=>{
 if(!e.altKey||e.ctrlKey||e.metaKey) return;
 if(e.key!=='ArrowDown'&&e.key!=='ArrowUp') return;
 const t=e.target;
 if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)) return;
 e.preventDefault();
 gotoTab(e.key==='ArrowDown'?1:-1);
});
const NM={}; Object.values(S.crew).forEach(c=>NM[c.slug]=c.nick); NM.system='システム';
const SL={done:'完了',running:'着手',blocked:'詰まり',skipped:'見送り'};
document.getElementById('logs').innerHTML=S.log.map(r=>
 `<div class="cl"><span class="t">${esc(r.ago)}</span>
  <span><b>${esc(NM[r.crew]||r.crew)}</b> ${esc(SL[r.status]||r.status)}　${esc((r.task||'').slice(0,30))}</span></div>`).join('');
const run=Object.values(S.crew).filter(c=>c.state==='running').length;
const myAll=S.rooms.reduce((a,r)=>a+(r.mine||[]).filter(mtLive).length,0);
document.getElementById('hd').textContent=S.now.slice(0,16).replace('T',' ')
 +'　作業中 '+run+' / 全 '+Object.keys(S.crew).length+'　あなたの残 '+myAll;

const QK='office.pending.v1';
const key=x=>(x.at||'')+'|'+(x.text||'');
function lsGet(){try{return JSON.parse(localStorage.getItem(QK)||'[]')}catch(e){return[]}}
function lsSet(a){try{localStorage.setItem(QK,JSON.stringify(a))}catch(e){}}
function renderQueue(){
 const done=new Set(S.qDone||[]);
 const keep=lsGet().filter(x=>!done.has(key(x)));
 if(keep.length!==lsGet().length) lsSet(keep);
 const seen=new Set(), q=[];
 for(const x of (S.queue||[]).concat(keep)){
  const k=key(x); if(seen.has(k)||done.has(k))continue; seen.add(k); q.push(x);}
 q.sort((a,b)=>(a.at||'').localeCompare(b.at||''));
 S.queue=q;
 const el=document.getElementById('queue');
 el.innerHTML=q.length
  ?q.map(x=>`<div class="q"><em>未処理</em>${x.biz?'['+esc(x.biz)+'] ':''}${esc(x.text)}`
    +`<button class="qd" data-k="${key(x).replace(/"/g,'&quot;')}">済</button></div>`).join('')
  :'<div class="q" style="color:#8FA2C6">未処理の指示はありません</div>';
 el.querySelectorAll('.qd').forEach(b=>b.onclick=()=>{
  const k=b.dataset.k;
  S.queue=(S.queue||[]).filter(x=>key(x)!==k);
  lsSet(lsGet().filter(x=>key(x)!==k));
  renderQueue();});
 document.getElementById('qc').textContent=q.length;}
renderQueue(); render();
const world=document.getElementById('world'), stage=document.getElementById('stage');
// カメラは固定（2026-09-17 代表指示：つかんで回す必要はない。その分だけ画面を広く使う）
const RX=58, RZ=0;                       // rz を負にすると北壁・西壁が手前に来て裏から見た絵になる
world.style.setProperty('--rx',RX+'deg');
world.style.setProperty('--rz',RZ+'deg');
// 等倍に戻して実際の外接を測り、中央の枠にぴったり入る倍率と寄せを出す。
// 部屋ごとに人数も敵の数も違うので、決め打ちの寸法だと右や下がはみ出す（2026-09-17）
function fit(){
 const w=stage.clientWidth, h=stage.clientHeight;
 if(!w||!h||stage.hidden) return;
 stage.style.setProperty('--s',1);
 stage.style.setProperty('--ox','0px');
 stage.style.setProperty('--oy','0px');
 const sb=stage.getBoundingClientRect();
 let l=1/0,r=-1/0,t=1/0,b=-1/0;
 room.querySelectorAll('*').forEach(e=>{
  const q=e.getBoundingClientRect();
  if(q.width<=0||q.height<=0) return;
  if(q.left<l)l=q.left; if(q.right>r)r=q.right;
  if(q.top<t)t=q.top; if(q.bottom>b)b=q.bottom;});
 if(!isFinite(l)) return;
 const W=r-l, H=b-t, cx=(l+r)/2, cy=(t+b)/2;
 // 携帯は横幅が足りない。左右の壁の外側が少し切れてもいいので、人が見える大きさまで寄せる
 const k=innerWidth>720?1:1.35;
 const s=Math.max(.3,Math.min(1.7,Math.min((w-12)/W*k,(h-12)/H)));
 stage.style.setProperty('--s',s);
 stage.style.setProperty('--ox',(s*(sb.left+sb.width/2-cx))+'px');
 stage.style.setProperty('--oy',(s*(sb.top+sb.height/2-cy))+'px');
}
let fitq=0;
function refit(){ if(fitq) return; fitq=requestAnimationFrame(()=>{fitq=0;fit();}); }
const wrapEl=document.querySelector('.wrap'), moBtn=document.getElementById('mo');
let motion=true; try{motion=localStorage.getItem('office.motion.v1')!=='0';}catch(e){}
function setMotion(on){motion=on;
 wrapEl.classList.toggle('still',!on);
 moBtn.textContent='動き '+(on?'ON':'OFF');
 moBtn.classList.toggle('off',!on);
 moBtn.title=on?'動きを止めると軽くなります':'止めています（軽い）';
 try{localStorage.setItem('office.motion.v1',on?'1':'0');}catch(e){}}
setMotion(motion);
moBtn.onclick=()=>setMotion(!motion);
document.addEventListener('visibilitychange',()=>wrapEl.classList.toggle('pz',document.hidden));
window.__refit=refit;
refit();
addEventListener('resize',refit);
room.addEventListener('click',e=>{const u=e.target.closest('.unit');if(!u)return;
 document.querySelectorAll('.unit').forEach(x=>x.classList.remove('sel'));u.classList.add('sel');});
const ta=document.getElementById('ta'),send=document.getElementById('send'),msg=document.getElementById('msg');
let ns=null;
const useA=(window.claude&&claude.use)?claude.use('artifact'):Promise.resolve(null);
useA.then(a=>{ns=a;msg.textContent=a?'次の稼働で担当に振り分けます':'このビューでは保存できません';
 if(!a){send.disabled=true;ta.disabled=true;}}).catch(()=>{send.disabled=true;msg.textContent='読み込めませんでした';});
ta.addEventListener('keydown',e=>{
 if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){
  e.preventDefault(); if(!send.disabled) send.click();}});
// 今の S をテンプレートに差し込んで公開し直す。指示の送信と済みの保存で共通
async function saveDoc(){
 if(!ns){msg.textContent='このビューでは保存できません';return false;}
 let tplRaw,tpl;
 const bad=m=>{msg.textContent=m;return false;};
 try{tplRaw=document.getElementById('tpl').textContent;
     tpl=decodeURIComponent(escape(atob(tplRaw)));}
 catch(e){return bad('テンプレートを復元できませんでした');}
 const T1='__'+'STATE'+'__', T2='__'+'TPL'+'__';
 if(tpl.split(T1).length!==2||tpl.split(T2).length!==2)
   return bad('保存を中止しました。目印の数が想定と違います('
     +(tpl.split(T1).length-1)+'/'+(tpl.split(T2).length-1)+')');
 const doc=tpl.split(T1).join(JSON.stringify(S)).split(T2).join(tplRaw);
 if(doc.indexOf(T1)>=0||doc.indexOf(T2)>=0) return bad('保存を中止しました。置換が残っています');
 if(doc.length<40000) return bad('保存を中止しました。サイズが小さすぎます('+doc.length+')');
 try{await ns.publish(doc);msg.textContent='保存しました';return true;}
 catch(err){return bad((err&&err.code==='conflict')
   ?'他の更新が入りました。開き直してください':'保存できませんでした');}
}
send.onclick=async()=>{const text=ta.value.trim(); if(!text||!ns)return;
 send.disabled=true;msg.textContent='保存中…';
 const item={text,biz:S.rooms[cur].biz,at:new Date().toISOString()};
 S.queue=(S.queue||[]).concat([item]);
 lsSet(lsGet().concat([item]));   // 公開の成否にかかわらず、まず端末に残す
 S.mtDone=[...MDONE]; S.mtNot=MNOT;
 const ok=await saveDoc();
 if(ok){ta.value='';mdDirty=false;renderPane();}
 else{S.queue=S.queue.filter(x=>key(x)!==key(item));
      msg.textContent=msg.textContent+'（入力はこの端末に残しました）';}
 renderQueue(); send.disabled=false;};
</script>"""

HEAD = ('<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<title>バーチャルオフィス</title>'
        '<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
        'family=Reggae+One&family=Zen+Maru+Gothic:wght@400;500;700&'
        'family=DotGothic16&family=IBM+Plex+Mono:wght@400;500;600&display=swap">')
FULL = '<!doctype html><html><head>' + HEAD + '</head><body>' + BODY + '</body></html>'
b64 = base64.b64encode(FULL.encode('utf-8')).decode('ascii')
doc = BODY.replace('__STATE__', json.dumps(STATE, ensure_ascii=False)).replace('__TPL__', b64)
io.open(OUT, 'w', encoding='utf-8').write(doc)
print('wrote', OUT)
print('rooms:%d  crew:%d  issues:%d  body:%.0fKB'
      % (len(rooms), len(crew), len(ISS['issues']), len(doc) / 1024))
