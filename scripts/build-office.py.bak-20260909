# -*- coding: utf-8 -*-
"""
claude-hub/scripts/build-office.py

会社ごとのバーチャルオフィス。上部のタブで8社を切り替え、
その会社に関わっている人格・課題・成果物を1画面で見せる。

  python scripts/build-office.py [出力パス]
"""
import io, os, sys, json, re, base64, datetime

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
    crew[slug] = dict(slug=slug, nick=nick, role=role, hair=hair, col=col, hairc=hairc,
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

STATE = dict(now=NOW, crew=crew, rooms=rooms, arts=ARTS, quotes=QUOTES,
             myt=dict(asOf=MYT.get('asOf',''), window=MYT.get('window',''),
                      older=MYT.get('olderPending',''), total=len(MYTASKS)),
             mtDone=MTDONE, mtNot=MTNOT,
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
 background:linear-gradient(180deg,#0A1330,#0C1A3E 60%,#081026);
 border-bottom:3px solid rgba(255,255,255,.75);box-shadow:0 3px 14px rgba(0,0,0,.55)}
.bar1{display:flex;align-items:center;gap:14px;padding:9px 16px;flex-wrap:wrap}
.brand{font-family:"Reggae One",sans-serif;font-size:20px;letter-spacing:.06em;
 background:linear-gradient(180deg,#FFF3C4 0%,#FFD980 45%,#E39A20 55%,#FFE9A8 100%);
 -webkit-background-clip:text;background-clip:text;color:transparent;
 filter:drop-shadow(0 2px 0 rgba(0,0,0,.55))}
.who{font-family:"DotGothic16",monospace;font-size:12px;color:var(--dim);
 border:2px solid var(--line);border-radius:7px;padding:3px 9px;background:rgba(8,16,40,.7)}
.pipe{display:flex;margin-left:auto;border:2px solid var(--line);border-radius:8px;overflow:hidden}
.pipe div{font-family:"DotGothic16",monospace;font-size:12px;padding:4px 11px;color:var(--dim);
 border-right:1px solid rgba(255,255,255,.16);background:rgba(8,16,40,.6)}
.pipe div:last-child{border-right:none}
.pipe b{color:var(--gold);margin-right:5px}
.live{font-family:"DotGothic16",monospace;font-size:12px;color:#FF9C7A;white-space:nowrap}
.live i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#FF7A5C;
 margin-right:5px;box-shadow:0 0 8px #FF7A5C;animation:bl 1.4s ease-in-out infinite}
@keyframes bl{0%,100%{opacity:1}50%{opacity:.2}}
.tabrow{display:flex;align-items:center;gap:10px;padding-right:14px}
.tabhint{font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--dim);
 border:1px solid var(--line);border-radius:4px;padding:2px 7px;white-space:nowrap;flex:none}
@media(max-width:760px){.tabhint{display:none}}
.tabs{display:flex;overflow-x:auto;padding:0 10px 4px;flex:1;min-width:0;scroll-behavior:smooth;gap:4px}
.tabs button{font-family:"Zen Maru Gothic",sans-serif;font-size:14px;background:rgba(9,18,44,.55);
 border:2px solid transparent;border-radius:9px 9px 0 0;
 color:var(--dim);padding:7px 13px;cursor:pointer;white-space:nowrap;transition:.12s}
.tabs button:hover{color:#fff;background:rgba(30,60,130,.6)}
.tabs button.on{color:#fff;font-weight:700;border-color:#fff;border-bottom-color:transparent;
 background:linear-gradient(180deg,#20408C,#0E1A44);box-shadow:0 0 12px rgba(120,180,255,.35)}
.tabs button i,.tabs button u{font-style:normal;text-decoration:none;
 font-family:"IBM Plex Mono",monospace;font-size:11px;margin-left:5px;
 padding:1px 5px;border-radius:8px;background:rgba(255,255,255,.14);color:var(--dim)}
.tabs button u{background:rgba(255,122,92,.22);color:#FFB9A6}
.tabs button.on i{background:#fff;color:#0E1A44}
.tabs button.on u{background:#FF7A5C;color:#2A0A04;font-weight:700}

/* ── 空とステージ ───────────────────────────────────── */
.wrap{position:relative;height:calc(100vh - 92px);min-height:600px;overflow:hidden;
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
.wrap[data-wx="partly"] .cl{opacity:.9;transform:scale(.72)}
.wrap[data-wx="cloud"] .cl span{background:#DFE4EA}
.wrap[data-wx="rain"]  .cl span{background:#9AA5B4}
.wrap[data-wx="storm"] .cl span{background:#6C7789}
.wrap[data-wx="cloud"] .cl{opacity:.85;transform:scale(.8)}
.wrap[data-wx="rain"]  .cl{opacity:.95;transform:scale(1)}
.wrap[data-wx="storm"] .cl{opacity:1;transform:scale(1.15)}
.wrap[data-wx="partly"] .grd{filter:saturate(.85) brightness(.95)}
.wrap[data-wx="cloud"] .grd{filter:saturate(.55) brightness(.82)}
.wrap[data-wx="rain"]  .grd{filter:saturate(.4) brightness(.6)}
.wrap[data-wx="storm"] .grd{filter:saturate(.3) brightness(.42)}
.wrap[data-wx="fog"]   .grd{filter:saturate(.25) brightness(.85)}
.wrap[data-wx="rain"]  .stage,.wrap[data-wx="storm"] .stage{filter:brightness(.86) saturate(.9)}
.wrap[data-wx="fog"]   .stage{filter:brightness(.95) saturate(.55)}
.rn{position:absolute;inset:-10% -10% 0;pointer-events:none;opacity:0;z-index:1;
 background:repeating-linear-gradient(102deg,rgba(255,255,255,.42) 0 1px,rgba(255,255,255,0) 1px 9px);
 background-size:auto 120px;animation:pour .5s linear infinite}
@keyframes pour{from{background-position:0 0}to{background-position:-26px 120px}}
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
.cl{position:absolute;pointer-events:none;opacity:.55;z-index:0;transform:scale(.5);
 transform-origin:0 0;filter:drop-shadow(0 6px 10px rgba(20,60,120,.14))}
.cl span{position:absolute;background:#fff;border-radius:50%}
.c1{top:5%;animation:drift 92s linear infinite}
.c2{top:15%;transform:scale(.36);animation:drift 124s linear infinite;animation-delay:-46s;opacity:.45}
.c3{top:24%;transform:scale(.62);animation:drift 158s linear infinite;animation-delay:-104s;opacity:.34}
@keyframes drift{from{left:-24%}to{left:118%}}
.hill{position:absolute;left:-6%;right:-6%;bottom:0;height:34%;pointer-events:none}
.hill i{position:absolute;bottom:0;border-radius:50% 50% 0 0}
.grd{position:absolute;left:0;right:0;bottom:0;height:16%;pointer-events:none;
 background:linear-gradient(180deg,#8FD16A,#5FA843 40%,#3E7B34)}
.stage{position:absolute;inset:0;perspective:1750px;perspective-origin:50% 32%;cursor:grab;touch-action:none;z-index:2}
.stage.drag{cursor:grabbing}
.world{position:absolute;inset:0;transform-style:preserve-3d;
 transform:translateZ(var(--z,-150px)) rotateX(var(--rx,57deg)) rotateZ(var(--rz,36deg));transition:transform .12s linear}
.room{position:absolute;left:50%;top:50%;width:900px;height:520px;margin:-260px 0 0 -450px;transform-style:preserve-3d}

/* 石の土台。部屋を空に浮かべるので、床の下に厚みを作る */
.base{position:absolute;left:-18px;top:-18px;width:936px;height:556px;transform-style:preserve-3d}
.base .bt{position:absolute;inset:0;background:linear-gradient(150deg,#D9CBAA,#B7A582);
 transform:translateZ(-2px);border-radius:4px}
.base .bs{position:absolute;background:linear-gradient(180deg,#9C8B6C,#5E5240 70%,#42392C)}
.floor{position:absolute;inset:0;
 background:
  linear-gradient(120deg,rgba(255,255,255,.34),rgba(255,255,255,0) 46%,rgba(20,30,60,.14)),
  repeating-linear-gradient(0deg,rgba(0,0,0,.09) 0 1px,rgba(0,0,0,0) 1px 68px),
  repeating-linear-gradient(90deg,rgba(0,0,0,.09) 0 1px,rgba(0,0,0,0) 1px 68px),
  repeating-conic-gradient(var(--flrA) 0% 25%, var(--flrB) 0% 50%) 0 0/68px 68px;
 box-shadow:inset 0 0 90px rgba(30,40,80,.22)}
.rug{position:absolute;transform:translateZ(1px);border-radius:10px;
 background:
  repeating-linear-gradient(45deg,rgba(255,255,255,.10) 0 9px,rgba(0,0,0,0) 9px 18px),
  rgba(var(--rug,232,112,63),.30);
 border:3px solid rgba(var(--rug,232,112,63),.62);
 box-shadow:inset 0 0 0 4px rgba(255,255,255,.20)}
.wallN{position:absolute;left:0;top:0;width:900px;height:186px;transform-origin:top;transform:rotateX(90deg);
 background:linear-gradient(180deg,#FFF 0,rgba(255,255,255,0) 6%),
  linear-gradient(180deg,var(--wall),var(--wall2));
 border-bottom:3px solid rgba(0,0,0,.22);box-shadow:inset 0 -22px 34px rgba(40,30,70,.16)}
.wallW{position:absolute;left:0;top:0;width:520px;height:186px;transform-origin:left top;
 /* 幅(520px)を部屋の +Y へ、高さを北の壁と同じ「上」へ向ける。
    元は rotateY(-90) rotateX(90) translateX(-520) で、幅がZ方向を向いていたため
    北の壁と平行に立ってしまい、部屋の角ができていなかった（2026-09-09 修正） */
 transform:rotateZ(90deg) rotateX(90deg);
 background:linear-gradient(180deg,var(--wall2),var(--wall));
 box-shadow:inset 0 -22px 34px rgba(40,30,70,.22), inset -40px 0 60px rgba(0,0,0,.10)}
.win{position:absolute;border:4px solid #F4F1E4;border-radius:6px 6px 2px 2px;
 background:linear-gradient(175deg,#63B8F0 0%,#9FD9F7 55%,#DFF3FF 100%);
 box-shadow:inset 0 0 0 2px rgba(120,90,60,.35), 0 3px 8px rgba(0,0,0,.22)}
.win:before,.win:after{content:"";position:absolute;background:#F4F1E4}
.win:before{left:50%;top:0;bottom:0;width:3px;margin-left:-1.5px}
.win:after{top:50%;left:0;right:0;height:3px;margin-top:-1.5px}
.torch{position:absolute;width:14px;height:20px;border-radius:3px;
 background:linear-gradient(180deg,#7A5230,#4A3220);
 box-shadow:0 0 26px 10px rgba(255,170,60,.36)}
.torch b{position:absolute;left:1px;top:-15px;width:12px;height:18px;border-radius:50% 50% 40% 40%;
 background:radial-gradient(circle at 50% 70%,#FFF3B0,#FFB33C 45%,#F0682A 78%,rgba(240,104,42,0));
 animation:fl .5s ease-in-out infinite alternate}
@keyframes fl{from{transform:scaleY(1) translateY(0);opacity:.92}to{transform:scaleY(1.18) translateY(-2px);opacity:1}}
.flag{position:absolute;width:56px;height:96px;
 background:linear-gradient(180deg,rgba(255,255,255,.22),rgba(0,0,0,.10)),var(--fc,#B44A58);
 clip-path:polygon(0 0,100% 0,100% 78%,50% 100%,0 78%);
 box-shadow:0 4px 10px rgba(0,0,0,.28)}
.flag i{position:absolute;left:50%;top:16px;width:22px;height:22px;margin-left:-11px;border-radius:50%;
 background:rgba(255,255,255,.85)}

/* 依頼の立て札。代表に残っているものを部屋の中に貼る */
.quest{position:absolute;transform-style:preserve-3d;pointer-events:none}
.quest .pole{position:absolute;left:-5px;top:0;width:10px;height:72px;
 background:linear-gradient(90deg,#6B4726,#A8763F 45%,#5E3E20);
 transform-origin:top;transform:rotateX(-90deg)}
.quest .qb{position:absolute;left:-126px;top:-146px;width:252px;padding:9px 12px 11px;
 background:linear-gradient(180deg,#F8F0D6,#E2CE9E);
 border:5px solid #8A5F32;border-radius:7px;
 box-shadow:0 6px 16px rgba(0,0,0,.45),inset 0 0 0 2px rgba(255,255,255,.6);
 transform:translateZ(96px) rotateZ(calc(-1 * var(--rz,36deg))) rotateX(calc(-1 * var(--rx,57deg)))}
.quest .qt{text-align:center;font-family:"Reggae One",sans-serif;font-size:15px;color:#6B3F16;
 letter-spacing:.1em;border-bottom:2px solid rgba(138,95,50,.45);padding-bottom:5px;margin-bottom:6px}
.quest .qi{font-size:12px;color:#3E2C12;line-height:1.45;text-align:left;margin-top:5px;
 font-family:"Zen Maru Gothic",sans-serif}
.quest .qi b{color:#A02A1E;font-family:"IBM Plex Mono",monospace;font-size:11px;margin-right:5px}
.board{position:absolute;background:#F7F4E8;border:4px solid #7C6448;border-radius:3px;
 box-shadow:0 3px 9px rgba(0,0,0,.28)}
.board .ln{position:absolute;height:3px;background:#BAB5C9;border-radius:2px}
.board .ln.a{background:#E8703F;opacity:.8}
.sign{position:absolute;transform-style:preserve-3d;pointer-events:none}

.sign b{position:absolute;width:420px;left:-210px;top:-22px;text-align:center;font-weight:400;
 padding:6px 0;border:3px solid #fff;border-radius:12px;
 background:linear-gradient(165deg,#1B2E66,#0A1231);
 box-shadow:0 0 0 2px #04091C,0 6px 18px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.25);
 transform:translateZ(126px) rotateZ(calc(-1 * var(--rz,36deg))) rotateX(calc(-1 * var(--rx,57deg)))}
.sign b span{font-family:"Reggae One",sans-serif;font-size:30px;letter-spacing:.11em;
 background:linear-gradient(180deg,#FFF6D2 0%,#FFD980 44%,#D98F1C 56%,#FFE9A8 100%);
 -webkit-background-clip:text;background-clip:text;color:transparent;
 filter:drop-shadow(0 1px 0 rgba(0,0,0,.65))}
.obj{position:absolute;transform-style:preserve-3d}
.tp,.sd{position:absolute;border:1px solid rgba(48,40,66,.5)}
.tp{box-shadow:inset 0 0 0 1px rgba(255,255,255,.4)}
.sd{border-top:none}
.mon{position:absolute;border-radius:3px;
 background:linear-gradient(160deg,#3E4E66,#141A26);border:2px solid #5A6A86;
 box-shadow:0 0 10px rgba(120,190,255,.35)}
.plant{position:absolute;transform-style:preserve-3d}
.plant .pot{position:absolute;width:24px;height:24px;border-radius:4px;transform:translateZ(9px);
 background:linear-gradient(160deg,#C98A5C,#8A5330);border:1px solid #5E3A22}
.plant .lf{position:absolute;width:36px;height:36px;left:-6px;top:-6px;border-radius:50% 50% 45% 55%;
 background:radial-gradient(circle at 34% 28%,#A5DFA8,#8ACC7E 40%,#357A46);transform:translateZ(32px);
 filter:drop-shadow(0 2px 3px rgba(0,0,0,.3))}

/* ── 人物 ────────────────────────────────────────── */
.unit{position:absolute;transform-style:preserve-3d;cursor:pointer}
.bill{position:absolute;width:226px;left:-67px;top:12px;text-align:center;
 transform:translateZ(94px) rotateZ(calc(-1 * var(--rz,36deg))) rotateX(calc(-1 * var(--rx,57deg)))}
.av{width:72px;height:60px;display:block;margin:0 auto;
 filter:drop-shadow(0 5px 6px rgba(0,0,0,.42));shape-rendering:geometricPrecision}
.plate{display:inline-block;padding:3px 9px;border-radius:8px;border:2px solid #fff;
 background:linear-gradient(165deg,#1B2E66,#0A1231);box-shadow:0 2px 8px rgba(0,0,0,.5)}
.nm{font-size:13.5px;font-weight:700;color:#fff;line-height:1.3}
.nm i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:1px;
 box-shadow:0 0 6px currentColor}
.rl{font-family:"DotGothic16",monospace;font-size:10.5px;color:#AFC2E4}
.bub{display:inline-block;max-width:216px;margin-top:6px;padding:6px 10px;border-radius:11px;
 border:2px solid rgba(255,255,255,.85);
 background:linear-gradient(165deg,rgba(27,46,102,.95),rgba(10,18,49,.95));
 color:#E8EEFB;font-size:11.5px;line-height:1.55;text-align:left;box-shadow:0 3px 10px rgba(0,0,0,.45)}
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
.hero .av{width:90px;height:75px;animation:hero 2.4s ease-in-out infinite;transform-origin:50% 100%}
@keyframes hero{0%,100%{transform:scale(1,1)}50%{transform:scale(1.04,.95)}}
.hero .plate{border-color:var(--gold);background:linear-gradient(165deg,#4A2E10,#1A0E04)}
.cnt{display:inline-block;margin-bottom:5px;padding:3px 11px;border-radius:9px;
 border:2px solid #fff;background:linear-gradient(180deg,#FF9B5C,#D93B24);
 font-family:"DotGothic16",monospace;font-size:13px;color:#fff;font-weight:700;
 box-shadow:0 2px 9px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.4)}
.cnt.zero{background:linear-gradient(180deg,#7DE39B,#2E9455)}
.spark{position:absolute;width:6px;height:6px;border-radius:50%;background:#FFF3B0;
 box-shadow:0 0 10px 3px rgba(255,230,150,.8);pointer-events:none;animation:sp 4.6s ease-in-out infinite}
@keyframes sp{0%,100%{opacity:0;transform:translateZ(30px) translateY(0)}
 40%{opacity:1}70%{opacity:0;transform:translateZ(30px) translateY(-30px)}}

/* 巡回する人 */
.walk{position:absolute;transform-style:preserve-3d;offset-rotate:0deg;pointer-events:none}
.walk .bill2{position:absolute;width:130px;left:-65px;top:-47px;text-align:center;
 transform:translateZ(78px) rotateZ(calc(-1 * var(--rz,36deg))) rotateX(calc(-1 * var(--rx,57deg)))}
.walk .av{width:53px;height:44px;display:block;margin:0 auto;transform-origin:50% 100%;
 filter:drop-shadow(0 3px 4px rgba(0,0,0,.42));animation:step .7s ease-in-out infinite}
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
.pn{position:absolute;z-index:6;display:flex;flex-direction:column}
.pn h3{margin:0;padding:9px 12px;font-family:"DotGothic16",monospace;font-size:12px;letter-spacing:.1em;
 color:var(--gold);border-bottom:2px solid rgba(255,255,255,.35);display:flex;justify-content:space-between;gap:8px}
.pn h3 span{color:var(--dim)}
.pn .bd{overflow:auto}
.pn .bd::-webkit-scrollbar{width:9px}
.pn .bd::-webkit-scrollbar-thumb{background:rgba(255,255,255,.28);border-radius:5px}
#iss{right:10px;top:10px;width:min(360px,46vw);max-height:60vh}
.sw{display:flex;gap:0;padding:6px 8px 0;border-bottom:2px solid rgba(255,255,255,.22)}
.sw button{flex:1;font-family:"Zen Maru Gothic",sans-serif;font-size:12.5px;cursor:pointer;
 border:2px solid transparent;border-bottom:none;border-radius:8px 8px 0 0;padding:5px 6px;
 background:rgba(255,255,255,.06);color:var(--dim)}
.sw button.on{background:linear-gradient(180deg,#2A4A9E,#12235A);color:#fff;border-color:#fff;font-weight:700}
.sw button b{font-family:"IBM Plex Mono",monospace;font-size:11px;margin-left:5px;color:var(--acc)}
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
.mt .k{flex:none;width:56px;text-align:center;font-family:"IBM Plex Mono",monospace;font-size:10.5px;
 border:1px solid var(--line);border-radius:5px;padding:2px 0;color:var(--dim)}
.mt.late .k{border-color:#FF7A5C;color:#FFB9A6;background:rgba(255,90,60,.16)}
.mt.soon .k{border-color:var(--acc);color:#FFDD9B;background:rgba(255,194,74,.14)}
.mt .x{font-size:12.5px;line-height:1.5;color:#F2F6FF}
.mt .s{font-family:"DotGothic16",monospace;font-size:10px;color:var(--dim);margin-top:2px}
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
#chat{left:10px;bottom:10px;width:min(340px,44vw);max-height:26vh}
.cl{padding:5px 12px;font-size:12px;display:grid;grid-template-columns:56px 1fr;gap:8px;
 border-bottom:1px solid rgba(255,255,255,.08)}
.cl .t{font-family:"IBM Plex Mono",monospace;font-size:10.5px;color:var(--never)}
.cl b{color:var(--gold);font-weight:400}
#seat{right:10px;bottom:10px;width:min(360px,46vw)}
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
.ctl{position:absolute;left:10px;top:10px;display:flex;gap:6px;z-index:6;flex-wrap:wrap;align-items:center}
.ctl button{font-family:"DotGothic16",monospace;font-size:12px;border-radius:8px;
 background:linear-gradient(165deg,#1B2E66,#0A1231);color:#fff;
 border:2px solid rgba(255,255,255,.8);padding:4px 11px;cursor:pointer}
.ctl button.on{border-color:var(--acc);color:var(--acc)}
.leftcol{position:absolute;left:10px;top:48px;z-index:6;display:flex;flex-direction:column;
 gap:8px;width:min(390px,46vw);max-height:calc(100% - 100px);overflow:auto}
.leftcol::-webkit-scrollbar{width:0}
.ordbar{padding:7px 12px;font-size:12.5px;border-radius:10px;border:2px solid rgba(255,255,255,.8);
 background:linear-gradient(165deg,rgba(27,46,102,.92),rgba(10,18,49,.92));box-shadow:0 3px 12px rgba(0,0,0,.45)}
.ordbar b{color:var(--acc)}
.ordbar .wx{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:8px;
 border:1px solid var(--line);background:rgba(255,255,255,.12);font-size:11px;color:#fff}
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
@media (prefers-reduced-motion:reduce){.unit .av,.live i,.walk,.walk .av,.cl2,.torch b,.spark{animation:none}
 .walk{offset-distance:30%}.world{transition:none}.c1,.c2,.c3{animation:none;left:20%}}
@media(max-width:760px){#iss,#seat,#chat{width:calc(100vw - 20px);max-height:28vh}
 #iss{top:auto;bottom:calc(28vh + 84px)}}
</style>

<div class="bar">
  <div class="bar1">
    <span class="brand">バーチャルオフィス</span>
    <span class="who" id="hd"></span>
    <div class="pipe"><div><b>1</b>指示</div><div><b>2</b>着手</div><div><b>3</b>制作</div>
      <div><b>4</b>審査</div><div><b>5</b>納品</div></div>
    <span class="live"><i></i>LIVE</span>
  </div>
  <div class="tabrow">
    <div class="tabs" id="tabs" title="Alt + ↑ / ↓ で切り替え"></div>
    <span class="tabhint">Alt + ↑ ↓</span>
  </div>
</div>

<div class="wrap">
  <div class="sun"></div>
  <div class="cl c1"></div><div class="cl c2"></div><div class="cl c3"></div>
  <div class="hill" id="hill"></div>
  <div class="grd"></div>
  <div class="rn"></div><div class="fg"></div><div class="fl"></div>
  <div class="stage" id="stage"><div class="world" id="world"><div class="room" id="room"></div></div></div>
  <div class="ctl"><button id="cam">自動カメラ</button><button id="rs">正面</button>
    <button id="zi">＋</button><button id="zo">−</button></div>
  <div class="leftcol">
  <div class="ordbar" id="ord"></div>
  <div class="lg"><div><i style="background:#3BAE63"></i>緑＝MTGログの実発言</div>
    <div><i style="background:#12235A"></i>紺＝AIの生成</div>
    <div><i style="background:#D93B24"></i>赤＝代表の残タスク</div>
    <div style="margin-top:4px;color:#FFE9A8">天気＝業績が伸びているか</div>
    <div>☀伸びている／未始動 ／ ⛅兆しはあるが未達</div>
    <div>☁足踏み ／ ☂落ちている</div>
    <div>░測れていない（動いているのに数字が無い）</div></div>
  </div>
  <div class="pn dqw" id="iss">
    <div class="sw"><button id="sw0" class="on">この会社の課題<b id="ic">0</b></button>
      <button id="sw1">代表の残タスク<b id="mc">0</b></button></div>
    <div class="bd" id="issb"></div></div>
  <div class="pn dqw" id="chat"><h3>稼働ログ</h3><div class="bd" id="logs"></div></div>
  <div class="pn dqw" id="seat"><h3>代表の席<span id="qc"></span></h3>
    <div class="bd"><div id="queue"></div>
      <textarea id="ta" placeholder="指示を入力（Enterで送信 / Shift+Enterで改行）"></textarea>
      <div class="row"><button id="send">送信</button><span id="msg"></span></div></div></div>
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

// 8体それぞれ別の姿にする。全部スライムにしない（2026-09-08 本人指示）
const MON={
 // 秘書＝けもの。しっぽと耳で、丸い体でもスライムに見えないようにする
 'chief-of-staff':c=>`<path fill="${c.col}" d="M26,-6 C46,-10 52,-32 43,-46 C55,-32 50,-2 30,0 Z"/>`
   +`<ellipse cx="0" cy="-24" rx="25" ry="23" fill="${c.col}"/>`
   +`<ellipse cx="10" cy="-22" rx="15" ry="19" fill="rgba(0,0,0,.15)" stroke="none"/>`
   +`<ellipse cx="-15" cy="-5" rx="9" ry="5.4" fill="${c.col}"/>`
   +`<ellipse cx="15" cy="-5" rx="9" ry="5.4" fill="${c.col}"/>`
   +`<path fill="${c.col}" d="M-20,-62 L-24,-80 L-7,-69 Z M20,-62 L24,-80 L7,-69 Z"/>`
   +`<path fill="rgba(0,0,0,.22)" stroke="none" d="M-18,-64 L-20,-74 L-10,-67 Z M18,-64 L20,-74 L10,-67 Z"/>`
   +`<circle cx="0" cy="-52" r="19" fill="${c.col}"/>`
   +`<ellipse cx="8" cy="-50" rx="11" ry="16" fill="rgba(0,0,0,.14)" stroke="none"/>`
   +`<ellipse cx="-8" cy="-60" rx="7" ry="4.6" fill="rgba(255,255,255,.42)" stroke="none" transform="rotate(-22 -8 -60)"/>`
   +`<path fill="#F4EEE0" stroke="none" d="M-11,-46 Q0,-52 11,-46 Q7,-38 0,-38 Q-7,-38 -11,-46 Z"/>`
   +`${eyes(8.5,-56,4,6)}`
   +`<path fill="${OUT}" stroke="none" d="M-3.4,-47 L3.4,-47 L0,-43.5 Z"/>`
   +`<path fill="none" stroke="${OUT}" stroke-width="1.9" stroke-linecap="round" d="M0,-43.5 L0,-41.5 M-6,-40 Q-3,-42.5 0,-41.5 M6,-40 Q3,-42.5 0,-41.5"/>`
   +`<path fill="none" stroke="${OUT}" stroke-width="1.7" stroke-linecap="round" d="M-14,-49 L-24,-51 M-14,-45 L-25,-45 M14,-49 L24,-51 M14,-45 L25,-45"/>`
   +`<path fill="#D9483F" d="M-19,-36 Q0,-29 19,-36 L21,-30 Q0,-23 -21,-30 Z"/>`,
 // 営業＝小鬼。旗を持って立っている
 sales:c=>`<path fill="${c.col}" d="M-19,-16 L-8,-16 L-8,0 L-21,0 Z M8,-16 L19,-16 L21,0 L6,0 Z"/>`
   +`<ellipse cx="0" cy="-32" rx="21" ry="23" fill="${c.col}"/>`
   +`<path fill="${c.col}" d="M-20,-38 L-40,-45 L-22,-25 Z M20,-38 L40,-45 L22,-25 Z"/>`
   +`<path fill="${c.col}" d="M-13,-50 L-17,-63 L-6,-54 Z M13,-50 L17,-63 L6,-54 Z"/>`
   +`<ellipse cx="8" cy="-30" rx="13" ry="20" fill="rgba(0,0,0,.16)" stroke="none"/>`
   +`<ellipse cx="-8" cy="-40" rx="7" ry="5" fill="rgba(255,255,255,.42)" stroke="none" transform="rotate(-22 -8 -40)"/>`
   +`${eyes(8.5,-34,4,6)}`
   +`<path stroke="none" fill="#2A1A18" d="M-9,-24 Q0,-21 9,-24 Q6,-13 0,-13 Q-6,-13 -9,-24 Z"/>`
   +`<path stroke="#8A6A38" stroke-width="2.6" d="M26,-4 L33,-58"/>`
   +`<path fill="#F0C24A" stroke-width="2" d="M33,-58 L50,-51 L33,-43 Z"/>`,
 // マーケ＝コウモリ
 marketing:c=>`<path fill="${c.col}" d="M-22,-42 C-40,-58 -52,-52 -51,-30 C-43,-38 -32,-38 -24,-33 Z"/>`
   +`<path fill="${c.col}" d="M22,-42 C40,-58 52,-52 51,-30 C43,-38 32,-38 24,-33 Z"/>`
   +`<path fill="${c.col}" d="M-14,-52 L-18,-64 L-7,-56 Z M14,-52 L18,-64 L7,-56 Z"/>`
   +`<ellipse cx="0" cy="-32" rx="27" ry="25" fill="${c.col}"/>`
   +`<ellipse cx="11" cy="-29" rx="16" ry="21" fill="rgba(0,0,0,.16)" stroke="none"/>`
   +`<ellipse cx="-11" cy="-41" rx="8" ry="5.6" fill="rgba(255,255,255,.46)" stroke="none" transform="rotate(-22 -11 -41)"/>`
   +`<path fill="${c.col}" d="M-14,-9 L-5,-9 L-5,0 L-14,0 Z M5,-9 L14,-9 L14,0 L5,0 Z"/>`
   +`${eyes(10,-34,4.6,7)}${SMILE}`,
 // 経営企画＝ゴーレム。四角い岩の体
 planning:c=>`<path fill="${c.col}" d="M-22,-15 L-7,-15 L-7,0 L-24,0 Z M7,-15 L22,-15 L24,0 L5,0 Z"/>`
   +`<rect x="-42" y="-53" width="13" height="32" rx="5" fill="${c.col}"/>`
   +`<rect x="29" y="-53" width="13" height="32" rx="5" fill="${c.col}"/>`
   +`<rect x="-29" y="-58" width="58" height="46" rx="11" fill="${c.col}"/>`
   +`<g stroke="none"><path fill="rgba(255,255,255,.30)" d="M-29,-47 C-29,-56 -22,-58 -14,-58 L-14,-12 L-24,-12 C-28,-16 -29,-30 -29,-47 Z"/>`
   +`<path fill="rgba(0,0,0,.20)" d="M14,-58 L29,-58 L29,-12 L14,-12 Z"/></g>`
   +`<path fill="none" stroke="rgba(0,0,0,.35)" stroke-width="2" d="M-6,-58 L-2,-46 L-9,-38 M9,-13 L13,-24 L6,-30"/>`
   +`<g stroke="none"><ellipse cx="-11" cy="-40" rx="5" ry="5.6" fill="${OUT}"/>`
   +`<ellipse cx="11" cy="-40" rx="5" ry="5.6" fill="${OUT}"/>`
   +`<circle cx="-11" cy="-40" r="2.4" fill="#FFE9A8"/><circle cx="11" cy="-40" r="2.4" fill="#FFE9A8"/></g>`
   +`<path fill="none" stroke="${OUT}" stroke-width="2.4" stroke-linecap="round" d="M-9,-25 L9,-25"/>`,
 // プロダクト＝きのこ
 product:c=>`<path fill="#F2E4C8" d="M-15,-2 C-17,-22 -15,-34 0,-34 C15,-34 17,-22 15,-2 Z"/>`
   +`<path fill="${c.col}" d="M-38,-32 C-38,-59 -19,-70 0,-70 C19,-70 38,-59 38,-32 C25,-38 -25,-38 -38,-32 Z"/>`
   +`<g stroke="none" fill="rgba(255,255,255,.55)"><ellipse cx="-19" cy="-51" rx="7.5" ry="5.4"/>`
   +`<ellipse cx="8" cy="-58" rx="6" ry="4.4"/><ellipse cx="23" cy="-45" rx="5.4" ry="3.8"/></g>`
   +`<path fill="rgba(0,0,0,.16)" stroke="none" d="M17,-60 C32,-53 38,-43 38,-32 C31,-35 25,-36 21,-36 C23,-47 21,-55 17,-60 Z"/>`
   +`${eyes(8,-22,4,5.8)}${SMILE}`,
 // 人事＝天使の鳥。人を連れてくる係
 hr:c=>`<path fill="${c.col}" d="M-19,-38 C-40,-44 -48,-30 -40,-18 C-34,-26 -26,-29 -20,-28 Z"/>`
   +`<path fill="${c.col}" d="M19,-38 C40,-44 48,-30 40,-18 C34,-26 26,-29 20,-28 Z"/>`
   +`<ellipse cx="0" cy="-30" rx="22" ry="24" fill="${c.col}"/>`
   +`<ellipse cx="9" cy="-27" rx="13" ry="20" fill="rgba(0,0,0,.16)" stroke="none"/>`
   +`<ellipse cx="-9" cy="-39" rx="7.5" ry="5.2" fill="rgba(255,255,255,.48)" stroke="none" transform="rotate(-22 -9 -39)"/>`
   +`<path fill="#F0C24A" d="M-6,-28 L-16,-23 L-6,-19 Z"/>`
   +`<path fill="#F0C24A" d="M-14,-8 L-6,-8 L-6,0 L-16,0 Z M6,-8 L14,-8 L14,0 L4,0 Z"/>`
   +`<ellipse cx="0" cy="-60" rx="12" ry="4.5" fill="none" stroke="#F0C24A" stroke-width="3"/>`
   +`<path stroke="none" fill="#F4EEE0" d="M-3,-34 L3,-34 L3,-28 L9,-28 L9,-22 L3,-22 L3,-16 L-3,-16 L-3,-22 L-9,-22 L-9,-28 L-3,-28 Z"/>`
   +`${eyes(9,-36,4,6)}`,
 // 監査＝がいこつ剣士
 kansayaku:c=>`<path fill="${c.col}" d="M-24,-34 L24,-34 L30,0 L-30,0 Z"/>`
   +`<path fill="rgba(0,0,0,.22)" stroke="none" d="M8,-34 L24,-34 L30,0 L14,0 Z"/>`
   +`<path fill="#F0EDE0" d="M-8,-42 L8,-42 L8,-30 L-8,-30 Z"/>`
   +`<ellipse cx="0" cy="-56" rx="17" ry="16" fill="#F0EDE0"/>`
   +`<path fill="#F0EDE0" d="M-11,-46 L11,-46 L9,-34 L-9,-34 Z"/>`
   +`<ellipse cx="9" cy="-54" rx="9" ry="14" fill="rgba(90,80,70,.16)" stroke="none"/>`
   +`<g stroke="none"><ellipse cx="-6.5" cy="-58" rx="4.6" ry="5.6" fill="${OUT}"/>`
   +`<ellipse cx="6.5" cy="-58" rx="4.6" ry="5.6" fill="${OUT}"/>`
   +`<circle cx="-6.5" cy="-58" r="2" fill="#FF7A5C"/><circle cx="6.5" cy="-58" r="2" fill="#FF7A5C"/></g>`
   +`<path fill="none" stroke="${OUT}" stroke-width="2" d="M-7,-38 L-7,-34 M0,-38 L0,-34 M7,-38 L7,-34 M-9,-38 L9,-38"/>`
   +`<path stroke="#B9C2D4" stroke-width="3.6" d="M28,-14 L44,-54"/>`
   +`<path stroke="#8A6A38" stroke-width="4.4" d="M24,-8 L34,-13"/>`,
 // 検品＝目玉
 reviewer:c=>`<ellipse cx="0" cy="-33" rx="30" ry="29" fill="#F2F2EC"/>`
   +`<ellipse cx="10" cy="-30" rx="19" ry="24" fill="rgba(60,70,90,.14)" stroke="none"/>`
   +`<circle cx="0" cy="-33" r="14" fill="#3E7FB8" stroke="none"/>`
   +`<circle cx="0" cy="-33" r="6.8" fill="${OUT}" stroke="none"/>`
   +`<circle cx="-5" cy="-38" r="3.8" fill="#fff" stroke="none"/>`
   +`<path fill="${c.col}" d="M-16,-8 L-6,-8 L-6,0 L-17,0 Z M6,-8 L16,-8 L16,0 L5,0 Z"/>`
   +`<path stroke="#8A6A38" stroke-width="2.6" d="M29,-11 L40,-32"/>`
   +`<circle cx="42" cy="-36" r="8" fill="rgba(190,225,255,.5)" stroke="#C9CFDC" stroke-width="2.6"/>`,
 // 代表＝よろいのきし。人の顔は出さない
 hero:c=>`<path fill="#B23A2E" d="M-23,-60 L23,-60 L34,-4 L-34,-4 Z"/>`
   +`<path fill="rgba(0,0,0,.22)" stroke="none" d="M6,-60 L23,-60 L34,-4 L14,-4 Z"/>`
   +`<path fill="#4A4F5E" d="M-18,-20 L-5,-20 L-5,0 L-20,0 Z M5,-20 L18,-20 L20,0 L5,0 Z"/>`
   +`<path fill="${c.col}" d="M-23,-56 C-25,-34 -21,-16 -18,-14 L18,-14 C21,-16 25,-34 23,-56 Z"/>`
   +`<path fill="rgba(255,255,255,.26)" stroke="none" d="M-23,-56 C-25,-36 -21,-18 -18,-15 L-8,-15 L-10,-56 Z"/>`
   +`<path fill="rgba(0,0,0,.20)" stroke="none" d="M11,-56 L13,-15 L18,-15 C21,-18 25,-36 23,-56 Z"/>`
   +`<path fill="#E0C05A" stroke="none" d="M-22,-46 L22,-46 L22,-40 L-22,-40 Z"/>`
   +`<ellipse cx="-27" cy="-52" rx="12" ry="9" fill="${c.col}"/>`
   +`<ellipse cx="27" cy="-52" rx="12" ry="9" fill="${c.col}"/>`
   +`<path fill="#E0C05A" d="M-2,-76 C-8,-92 10,-98 14,-86 C9,-89 2,-84 2,-76 Z"/>`
   +`<path fill="${c.col}" d="M-18,-60 C-18,-84 18,-84 18,-60 Z"/>`
   +`<path fill="rgba(255,255,255,.22)" stroke="none" d="M-18,-60 C-18,-80 -8,-83 -4,-83 L-6,-60 Z"/>`
   +`<path fill="#1A2233" stroke="none" d="M-14,-71 L14,-71 L14,-65 L2,-65 L2,-60 L-2,-60 L-2,-65 L-14,-65 Z"/>`
   +`<circle cx="-7" cy="-68" r="2.6" fill="#7DE39B"/><circle cx="7" cy="-68" r="2.6" fill="#7DE39B"/>
   <path stroke="#B9C2D4" stroke-width="4" d="M32,-24 L50,-64"/>`
   +`<path stroke="#E0C05A" stroke-width="5" d="M27,-18 L39,-24"/>`
   +`<path fill="#C9A03A" d="M-32,-54 L-52,-47 L-52,-12 L-32,-5 Z"/>`
   +`<path fill="#8A6A38" stroke="none" d="M-37,-48 L-46,-44 L-46,-18 L-37,-14 Z"/>`};

let AVN=0;
function avatar(c,hero){
 const f=MON[hero?'hero':c.slug]||MON['chief-of-staff'];
 return `<svg class="av" viewBox="0 0 116 96">
  <ellipse cx="58" cy="88" rx="31" ry="6" fill="rgba(0,0,0,.26)"/>
  <g transform="translate(58,88)" stroke="${OUT}" stroke-width="2.6"
     stroke-linejoin="round" stroke-linecap="round">${f(c)}</g></svg>`;}

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

function render(){
 const R=S.rooms[cur], MINE=(R.mine||[]).filter(mtLive);
 const _w=document.querySelector('.wrap'); if(_w) _w.dataset.wx=R.wx||'fine';
 const P=R.pal||{}, st0=document.getElementById('stage');
 for(const [k,v] of Object.entries({wall:P.wall,wall2:P.wall2,flrA:P.flrA,flrB:P.flrB,rug:P.rug}))
  if(v) st0.style.setProperty('--'+k, v);
 let h=`<div class="base"><div class="bt"></div>
   <div class="bs" style="width:936px;height:26px;transform-origin:top;transform:rotateX(-90deg);top:556px"></div>
   <div class="bs" style="width:556px;height:26px;transform-origin:left top;transform:translateX(936px) rotateY(90deg) rotateX(-90deg) translateY(-26px)"></div></div>`;
 h+='<div class="floor"></div><div class="wallN">';
 [300,440,580].forEach(x=>{h+=`<div class="win" style="left:${x}px;top:40px;width:110px;height:88px"></div>`;});
 // 依頼の立て札。代表に残っている上位3件を貼る

 [176,660].forEach(x=>{h+=`<div class="torch" style="left:${x}px;top:66px"><b></b></div>`;});
 h+=`<div class="flag" style="left:34px;top:26px;--fc:rgba(${P.rug||'232,112,63'},.85)"><i></i></div>
   <div class="flag" style="left:112px;top:26px;--fc:rgba(${P.rug||'232,112,63'},.6)"><i></i></div>`;
 h+='</div><div class="wallW">';
 [70,210,350].forEach(x=>{h+=`<div class="win" style="left:${x}px;top:46px;width:100px;height:86px"></div>`;});
 h+=`<div class="torch" style="left:158px;top:70px"><b></b></div>
   <div class="torch" style="left:300px;top:70px"><b></b></div>`;
 h+='</div><div class="rug" style="left:296px;top:332px;width:308px;height:166px"></div>';
 h+=`<div class="sign" style="left:450px;top:2px"><b><span>${esc(R.biz)}</span></b></div>`;
 // 依頼の立て札。壁に貼らず、常にカメラを向く板にする（壁貼りだと裏から見て鏡文字になる）
 const top3=MINE.slice(0,3);
 h+=`<div class="quest" style="left:646px;top:492px"><div class="pole"></div><div class="qb">
   <div class="qt">依頼の立て札</div>`;
 top3.forEach(t=>{h+=`<div class="qi"><b>${esc(dueTxt(t))}</b>${esc(t.t.slice(0,30))}</div>`;});
 if(!top3.length) h+='<div class="qi" style="text-align:center">依頼はありません</div>';
 h+='</div></div>';

 const POS=[[110,70],[330,70],[550,70],[110,268],[330,268],[550,268]];
 const PREF={sales:'pl',marketing:'csat',planning:'pl',product:'csat',hr:'hiring'};
 const claimed=new Set();
 (R.staff||[]).forEach((slug,i)=>{
  const c=S.crew[slug]; if(!c||!POS[i])return;
  const [x,y]=POS[i];
  h+=box(x-16,y+12,100,58,28,'linear-gradient(150deg,#F3EFFA,#D9D3E8)','linear-gradient(180deg,#BDB7CE,#918BA6)',
    `<div class="mon" style="left:34px;top:8px;width:38px;height:26px;transform:translateZ(28px)"></div>`);
  h+=box(x+6,y+80,42,28,16,'linear-gradient(150deg,#A8A3C0,#807BA0)','linear-gradient(180deg,#7A7592,#565272)');
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
  h+=`<div class="unit ${c.state}" data-s="${slug}" style="left:${x}px;top:${y}px">
   <div class="bill">${avatar(c)}
    <div class="plate"><div class="nm"><i style="background:${COL[c.state]};color:${COL[c.state]}"></i>${esc(c.nick)}</div>
    <div class="rl">${esc(c.role)} ／ ${esc(c.label)}</div></div>
    <div class="bub ${real?'real':''}">${esc(say)}${real?`<span class="w">${esc(q.who)}｜${esc(q.src)}</span>`:''}</div>
   </div></div>`;});

 // 代表（勇者）。この事業に残っている自分のタスク数を頭の上に出す
 const late=MINE.filter(t=>t.due&&t.due<TODAY).length;
 const HERO={col:'#2F63C4',hairc:'#3A2A1E',hair:'hero',prop:'hero',
   nick:'代表',role:'あなた',state:'running',label:''};
 h+=`<div class="unit hero running" style="left:770px;top:400px">
   <div class="bill">
    <div class="cnt ${MINE.length?'':'zero'}">残 ${MINE.length}${late?'　期限切れ '+late:''}</div>
    ${avatar(HERO,true)}
    <div class="plate"><div class="nm">代表</div><div class="rl">あなた ／ ${esc(R.biz)}</div></div>
    ${MINE.length?`<div class="bub">${esc(MINE[0].t.slice(0,40))}<span class="w" style="color:#FFC24A">${esc(dueTxt(MINE[0]))}</span></div>`
      :'<div class="bub">この事業にあなたの残タスクはありません</div>'}
   </div></div>`;
 [[300,200],[560,340],[190,420]].forEach(([x,y],i)=>{
  h+=`<div class="spark" style="left:${x}px;top:${y}px;animation-delay:-${i*1.6}s"></div>`;});

 [[812,442],[38,452],[822,58]].forEach(([x,y])=>{
  h+=`<div class="plant" style="left:${x}px;top:${y}px"><div class="pot"></div><div class="lf"></div></div>`;});
 h+=box(322,362,186,62,22,'linear-gradient(150deg,#DED9EE,#BEB8D4)','linear-gradient(180deg,#ACA6C4,#837DA0)');

 const PATH_A="M60,180 L820,180 L820,420 L60,420 Z";
 const PATH_B="M60,150 L500,150 L500,470 L840,470 L840,120 L60,120 Z";
 const ROAM=[['w1',PATH_A,'chief-of-staff','資料を回しています'],
             ['w2',PATH_A,'reviewer','検品に向かっています'],
             ['w3',PATH_B,'kansayaku','数字を突き合わせています'],
             ['w4',PATH_B,'sales','商談メモを届けています']];
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
 document.querySelectorAll('#tabs button').forEach((b,i)=>b.classList.toggle('on',i===cur));
}

function renderPane(){
 const R=S.rooms[cur], el=document.getElementById('issb');
 document.getElementById('sw0').classList.toggle('on',pane===0);
 document.getElementById('sw1').classList.toggle('on',pane===1);
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

function tabsHTML(){return S.rooms.map((r,i)=>{
 const n=(r.mine||[]).filter(mtLive).length;
 return `<button data-i="${i}" title="${(WX[r.wx]||WX.fine).n}">`
 +`<b class="wxi ${r.wx}">${(WX[r.wx]||WX.fine).i}</b>${esc(r.biz)}<i>${(r.issues||[]).length}</i>`
 +(n?`<u>残${n}</u>`:'')+`</button>`;}).join('');}
document.getElementById('tabs').innerHTML=tabsHTML();
document.getElementById('tabs').addEventListener('click',e=>{
 const b=e.target.closest('button'); if(!b)return; cur=+b.dataset.i; render();});
function gotoTab(i){
 const n=S.rooms.length; if(!n)return;
 cur=(i%n+n)%n; render();
 const b=document.querySelector('#tabs button[data-i="'+cur+'"]');
 if(b) b.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});
}
document.addEventListener('keydown',e=>{
 if(!e.altKey||e.ctrlKey||e.metaKey) return;
 if(e.key!=='ArrowDown'&&e.key!=='ArrowUp') return;
 const t=e.target;
 if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)) return;
 e.preventDefault();
 gotoTab(cur+(e.key==='ArrowDown'?1:-1));
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
let rx=57,rz=36,z=-150,down=false,mx=0,my=0,auto=false;
function apply(){rx=Math.min(80,Math.max(24,rx));
 // rz を回しすぎると北壁・西壁が手前に来て、部屋を裏から見た絵になる（2026-09-08 指摘）
 rz=Math.min(96,Math.max(-32,rz));
 world.style.setProperty('--rx',rx+'deg');world.style.setProperty('--rz',rz+'deg');world.style.setProperty('--z',z+'px');}
stage.addEventListener('pointerdown',e=>{down=true;auto=false;
 document.getElementById('cam').classList.remove('on');
 mx=e.clientX;my=e.clientY;stage.classList.add('drag');stage.setPointerCapture(e.pointerId);});
stage.addEventListener('pointermove',e=>{if(!down)return;
 rz+=(e.clientX-mx)*.34;rx-=(e.clientY-my)*.26;mx=e.clientX;my=e.clientY;apply();});
stage.addEventListener('pointerup',()=>{down=false;stage.classList.remove('drag');});
stage.addEventListener('pointercancel',()=>{down=false;stage.classList.remove('drag');});
document.getElementById('rs').onclick=()=>{rx=57;rz=36;z=-150;apply();};
document.getElementById('zi').onclick=()=>{z=Math.min(240,z+70);apply();};
document.getElementById('zo').onclick=()=>{z=Math.max(-760,z-70);apply();};
document.getElementById('cam').onclick=function(){auto=!auto;this.classList.toggle('on',auto);};
let camDir=1;
setInterval(()=>{if(auto&&!down){
 if(rz>=96) camDir=-1; else if(rz<=-32) camDir=1;   // 端で折り返す。1周させると裏側に回る
 rz+=0.15*camDir; apply();}},40);
room.addEventListener('click',e=>{const u=e.target.closest('.unit');if(!u)return;
 document.querySelectorAll('.unit').forEach(x=>x.classList.remove('sel'));u.classList.add('sel');});
window.addEventListener('keydown',e=>{
 const t=e.target, tag=t&&t.tagName;
 if(tag==='TEXTAREA'||tag==='INPUT'||(t&&t.isContentEditable))return;
 if(!e.altKey&&!e.shiftKey)return;
 let hit=true;
 switch(e.key){
  case 'ArrowUp':    rx-=4; break;
  case 'ArrowDown':  rx+=4; break;
  case 'ArrowLeft':  rz-=6; break;
  case 'ArrowRight': rz+=6; break;
  case '+': case ';': case '=': z=Math.min(240,z+70); break;
  case '-': z=Math.max(-760,z-70); break;
  case '0': rx=57; rz=36; z=-150; break;
  default: hit=false;
 }
 if(!hit)return;
 e.preventDefault();
 auto=false; document.getElementById('cam').classList.remove('on');
 apply();
});
apply();
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

HEAD = ('<meta charset="utf-8"><title>バーチャルオフィス</title>'
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
