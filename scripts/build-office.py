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
NOW = os.environ.get('OFFICE_NOW', '2026-08-31T18:30:00+09:00')

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
BIZ_ORDER = ['POTEX', 'EXTAGE', 'Tクリニック', 'origin', 'passlabo',
             'エクソソーム', '失業保険', '補助金コンサル']

ISS = json.load(io.open(os.path.join(HUB, 'data', 'issues.json'), encoding='utf-8'))
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

rooms = []
for biz in BIZ_ORDER:
    items = sorted([i for i in ISS['issues'] if i['biz'] == biz], key=lambda x: -x['score'])
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
    rooms.append(dict(biz=biz, order=WB.get(biz, {}).get('order', ''),
                      issues=items, staff=staff[:6]))

STATE = dict(now=NOW, crew=crew, rooms=rooms, arts=ARTS, quotes=QUOTES,
             log=[dict(r, ago=ago(r.get('ts', ''))) for r in runs[:26]], queue=[])

BODY = r"""<title>バーチャルオフィス</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Reggae+One&family=Zen+Maru+Gothic:wght@400;500;700&family=DotGothic16&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root{--bg:#0B111C;--chrome:rgba(9,14,24,.94);--line:#233149;--ink:#EFE8DA;--dim:#93A0B4;
 --acc:#E8703F;--gold:#E3B75C;--wall:#C8C4DE;--wall2:#A8A4C8;--flrA:#DAD6E6;--flrB:#CBC6DC;
 --go:#63D08A;--idle:#E7C063;--never:#66748A;--stop:#F0836B;
 --hi:#F0836B;--mid:#E7C063;--lo:#63D08A;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);overflow-x:hidden;
 font-family:"Zen Maru Gothic","Hiragino Maru Gothic ProN",system-ui,sans-serif;font-size:14px;
 -webkit-font-smoothing:antialiased}
.bar{position:sticky;top:0;z-index:20;background:var(--chrome);border-bottom:1px solid var(--line);backdrop-filter:blur(8px)}
.bar1{display:flex;align-items:center;gap:14px;padding:8px 16px;flex-wrap:wrap}
.brand{font-family:"Reggae One",sans-serif;font-size:18px;letter-spacing:.05em}
.who{font-family:"DotGothic16",monospace;font-size:11px;color:var(--dim);border:1px solid var(--line);padding:3px 9px}
.pipe{display:flex;margin-left:auto}
.pipe div{font-family:"DotGothic16",monospace;font-size:11px;padding:4px 11px;color:var(--dim);border-right:1px solid var(--line)}
.pipe div:last-child{border-right:none}
.pipe b{color:var(--gold);margin-right:5px}
.live{font-family:"DotGothic16",monospace;font-size:11px;color:#FF6B6B;white-space:nowrap}
.live i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#FF6B6B;margin-right:5px;animation:bl 1.4s ease-in-out infinite}
@keyframes bl{0%,100%{opacity:1}50%{opacity:.2}}
.tabs{display:flex;overflow-x:auto;padding:0 10px}
.tabs button{font-family:"Zen Maru Gothic",sans-serif;font-size:13px;background:none;border:none;
 border-bottom:3px solid transparent;color:var(--dim);padding:9px 14px;cursor:pointer;white-space:nowrap}
.tabs button:hover{color:var(--ink)}
.tabs button.on{color:var(--ink);border-bottom-color:var(--acc);font-weight:700}
.tabs button i{font-style:normal;font-family:"IBM Plex Mono",monospace;font-size:10px;margin-left:6px;
 padding:1px 5px;border-radius:8px;background:var(--line);color:var(--dim)}
.tabs button.on i{background:var(--acc);color:#12161F}
.wrap{position:relative;height:calc(100vh - 86px);min-height:600px;overflow:hidden}
.stage{position:absolute;inset:0;perspective:1750px;perspective-origin:50% 32%;cursor:grab;touch-action:none}
.stage.drag{cursor:grabbing}
.world{position:absolute;inset:0;transform-style:preserve-3d;
 transform:translateZ(var(--z,-150px)) rotateX(var(--rx,57deg)) rotateZ(var(--rz,-36deg));transition:transform .12s linear}
.room{position:absolute;left:50%;top:50%;width:900px;height:520px;margin:-260px 0 0 -450px;transform-style:preserve-3d}
.floor{position:absolute;inset:0;border:1px solid rgba(255,255,255,.25);
 background:repeating-conic-gradient(var(--flrA) 0% 25%, var(--flrB) 0% 50%) 0 0/68px 68px}
.rug{position:absolute;background:rgba(232,112,63,.18);border:2px solid rgba(232,112,63,.4);transform:translateZ(1px);border-radius:6px}
.wallN{position:absolute;left:0;top:0;width:900px;height:168px;transform-origin:top;transform:rotateX(90deg);
 background:linear-gradient(180deg,var(--wall),var(--wall2));border-bottom:2px solid rgba(0,0,0,.16)}
.wallW{position:absolute;left:0;top:0;width:520px;height:168px;transform-origin:left top;
 transform:rotateY(-90deg) rotateX(90deg) translateX(-520px);background:linear-gradient(180deg,var(--wall2),var(--wall))}
.win{position:absolute;background:linear-gradient(160deg,#DEEBF3,#B5D1E2);border:3px solid #EFEFF6}
.board{position:absolute;background:#F5F3EB;border:4px solid #7C7898}
.board .ln{position:absolute;height:3px;background:#BAB5C9;border-radius:2px}
.board .ln.a{background:var(--acc);opacity:.75}
.logo{position:absolute;font-family:"Reggae One",sans-serif;font-size:26px;color:rgba(58,54,82,.32);letter-spacing:.1em}
.obj{position:absolute;transform-style:preserve-3d}
.tp,.sd{position:absolute;border:1px solid rgba(58,54,82,.45)}
.sd{border-top:none}
.mon{position:absolute;border-radius:2px;background:#28303F;border:1px solid #4A5568}
.plant{position:absolute;transform-style:preserve-3d}
.plant .pot{position:absolute;width:22px;height:22px;background:#AB744E;border:1px solid #6B4630;transform:translateZ(9px);border-radius:3px}
.plant .lf{position:absolute;width:32px;height:32px;left:-5px;top:-5px;border-radius:50% 50% 45% 55%;
 background:radial-gradient(circle at 34% 30%,#83C791,#3B7A50);transform:translateZ(30px)}
.unit{position:absolute;transform-style:preserve-3d;cursor:pointer}
.bill{position:absolute;width:210px;left:-58px;top:-16px;text-align:center;
 transform:translateZ(86px) rotateZ(calc(-1 * var(--rz,-36deg))) rotateX(calc(-1 * var(--rx,57deg)))}
.av{width:66px;height:78px;display:block;margin:0 auto;filter:drop-shadow(0 4px 5px rgba(0,0,0,.45))}
.nm{font-size:12.5px;font-weight:700;text-shadow:0 1px 5px rgba(0,0,0,.95)}
.nm i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:1px}
.rl{font-family:"DotGothic16",monospace;font-size:9.5px;color:#CBD3E0;text-shadow:0 1px 5px rgba(0,0,0,.95)}
.bub{display:inline-block;max-width:206px;margin-top:6px;padding:5px 10px;border-radius:13px;
 background:rgba(10,16,26,.93);border:1px solid var(--line);color:#DDE4EF;font-size:10.5px;line-height:1.55;text-align:left}
.bub.real{border-color:var(--go);color:#CDEFD8}
.bub .w{display:block;font-family:"DotGothic16",monospace;font-size:8.5px;color:#8DBE9C;margin-top:2px}
.unit.running .av{animation:bob .85s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3.5px)}}
.unit.never .av{opacity:.4}
.unit.stale .av,.unit.blocked .av{animation:al 1.4s ease-in-out infinite}
@keyframes al{0%,100%{opacity:1}50%{opacity:.3}}
.unit.sel .bub{border-color:var(--acc)}
.pn{position:absolute;background:rgba(9,14,24,.9);border:1px solid var(--line);backdrop-filter:blur(7px);
 z-index:6;display:flex;flex-direction:column}
.pn h3{margin:0;padding:9px 12px;font-family:"DotGothic16",monospace;font-size:11px;letter-spacing:.1em;
 color:var(--gold);border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px}
.pn h3 span{color:var(--dim)}
.pn .bd{overflow:auto}
#iss{right:10px;top:10px;width:min(340px,44vw);max-height:56vh}
.ic{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.05)}
.ic .r{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.ic .ax{font-family:"DotGothic16",monospace;font-size:8.5px;padding:1px 5px;border:1px solid}
.ic .ax.csat{color:#D79BD2;border-color:#D79BD2}
.ic .ax.hiring{color:#E7C063;border-color:#E7C063}
.ic .ax.pl{color:#6FB6DA;border-color:#6FB6DA}
.ic .sc{font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:600}
.ic .sc.hi{color:var(--hi)} .ic .sc.mid{color:var(--mid)} .ic .sc.lo{color:var(--lo)}
.ic .t{font-size:12px;margin-top:4px;line-height:1.5}
.ic .o{font-family:"DotGothic16",monospace;font-size:9px;color:var(--dim);margin-top:3px}
#chat{left:10px;bottom:10px;width:min(340px,44vw);max-height:28vh}
.cl{padding:5px 12px;font-size:11px;display:grid;grid-template-columns:56px 1fr;gap:8px;border-bottom:1px solid rgba(255,255,255,.05)}
.cl .t{font-family:"IBM Plex Mono",monospace;font-size:9.5px;color:var(--never)}
.cl b{color:var(--gold);font-weight:400}
#seat{right:10px;bottom:10px;width:min(340px,44vw)}
#seat .bd{padding:10px 12px}
.q{font-size:11px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.q em{font-style:normal;font-family:"DotGothic16",monospace;font-size:9px;color:var(--acc);border:1px solid var(--acc);padding:0 4px;margin-right:6px}
#ta{width:100%;background:rgba(255,255,255,.06);border:1px solid var(--line);color:var(--ink);
 font-family:inherit;font-size:12px;padding:8px;resize:vertical;min-height:50px;margin-top:8px}
#ta:focus{outline:2px solid var(--acc);outline-offset:1px}
.row{display:flex;gap:8px;margin-top:8px;align-items:center}
#send{font-family:"DotGothic16",monospace;font-size:12px;background:var(--acc);color:#12161F;border:none;padding:7px 16px;cursor:pointer;font-weight:700}
#send:disabled{opacity:.4;cursor:default}
#msg{font-family:"DotGothic16",monospace;font-size:10px;color:var(--dim);flex:1}
.ctl{position:absolute;left:10px;top:10px;display:flex;gap:6px;z-index:6;flex-wrap:wrap}
.ctl button{font-family:"DotGothic16",monospace;font-size:11px;background:rgba(9,14,24,.9);color:var(--ink);
 border:1px solid var(--line);padding:4px 10px;cursor:pointer}
.ctl button.on{border-color:var(--acc);color:var(--acc)}
.ordbar{position:absolute;left:10px;top:44px;z-index:6;background:rgba(9,14,24,.9);border:1px solid var(--line);
 padding:6px 11px;font-size:11.5px;max-width:min(340px,44vw)}
.ordbar b{color:var(--acc)}
.ordbar span{display:block;font-family:"DotGothic16",monospace;font-size:9.5px;color:var(--dim);margin-top:2px}
.lg{position:absolute;left:10px;top:98px;z-index:6;font-family:"DotGothic16",monospace;font-size:9.5px;color:var(--dim);line-height:1.85}
.lg i{display:inline-block;width:9px;height:9px;margin-right:5px}
@media (prefers-reduced-motion:reduce){.unit .av,.live i{animation:none}.world{transition:none}}
@media(max-width:760px){#iss,#seat,#chat{width:calc(100vw - 20px);max-height:26vh}
 #iss{top:auto;bottom:calc(26vh + 78px)}}
</style>

<div class="bar">
  <div class="bar1">
    <span class="brand">バーチャルオフィス</span>
    <span class="who" id="hd"></span>
    <div class="pipe"><div><b>1</b>指示</div><div><b>2</b>着手</div><div><b>3</b>制作</div>
      <div><b>4</b>審査</div><div><b>5</b>納品</div></div>
    <span class="live"><i></i>LIVE</span>
  </div>
  <div class="tabs" id="tabs"></div>
</div>

<div class="wrap">
  <div class="stage" id="stage"><div class="world" id="world"><div class="room" id="room"></div></div></div>
  <div class="ctl"><button id="cam">自動カメラ</button><button id="rs">正面</button>
    <button id="zi">＋</button><button id="zo">−</button></div>
  <div class="ordbar" id="ord"></div>
  <div class="lg"><div><i style="background:var(--go)"></i>緑＝MTGログの実発言</div>
    <div><i style="background:#233149"></i>灰＝AIの生成</div></div>
  <div class="pn" id="iss"><h3>この会社の課題<span id="ic"></span></h3><div class="bd" id="issb"></div></div>
  <div class="pn" id="chat"><h3>稼働ログ</h3><div class="bd" id="logs"></div></div>
  <div class="pn" id="seat"><h3>代表の席<span id="qc"></span></h3>
    <div class="bd"><div id="queue"></div>
      <textarea id="ta" placeholder="指示を入力（例: 継続率、今週の打ち手を出して）"></textarea>
      <div class="row"><button id="send">送信</button><span id="msg"></span></div></div></div>
</div>

<script id="state" type="application/json">__STATE__</script>
<script id="tpl" type="text/plain">__TPL__</script>
<script>
const S=JSON.parse(document.getElementById('state').textContent);
const room=document.getElementById('room');
const COL={running:'#63D08A',idle:'#E7C063',never:'#66748A',stale:'#F0836B',blocked:'#F0836B'};
let cur=0;
const HAIR={
 spike:'M-15,-45 L-11,-60 L-6,-50 L-1,-62 L4,-50 L9,-60 L14,-46 Q0,-57 -15,-45 Z',
 long:'M-15,-43 Q-16,-59 0,-59 Q16,-59 15,-43 L15,-22 L9,-25 L11,-45 Q0,-52 -11,-45 L-9,-25 L-15,-22 Z',
 bob:'M-15,-42 Q-16,-60 0,-60 Q16,-60 15,-42 L15,-34 L11,-46 Q0,-53 -11,-46 L-15,-34 Z',
 tail:'M-15,-43 Q-16,-60 0,-60 Q16,-60 15,-43 L11,-46 Q0,-52 -11,-46 Z',
 cap:'M-15,-46 Q-15,-60 0,-60 Q15,-60 15,-46 Z',
 curl:'M-15,-43 Q-17,-61 0,-60 Q17,-61 15,-43 Q9,-50 4,-46 Q0,-52 -4,-46 Q-9,-50 -15,-43 Z',
 short:'M-15,-44 Q-15,-60 0,-60 Q15,-60 15,-44 L11,-47 Q0,-53 -11,-47 Z',
 band:'M-15,-45 Q-15,-59 0,-59 Q15,-59 15,-45 L11,-47 Q0,-52 -11,-47 Z'};
const EXTRA={tail:'<path d="M13,-49 Q24,-45 22,-30 Q18,-37 12,-41 Z"/>',
 cap:'<path d="M-16,-46 L22,-46 L22,-42 L-16,-42 Z"/>',
 band:'<path d="M-16,-47 L16,-47 L16,-40 L-16,-40 Z"/><path d="M-16,-46 L-27,-41 L-24,-30 L-16,-40 Z"/>'};
const PROP={
 sword:'<path stroke="CC" stroke-width="2.6" d="M14,-23 L29,-48"/><path stroke="CC" stroke-width="3.2" d="M11,-27 L19,-23"/>',
 bag:'<rect x="12" y="-28" width="15" height="12" rx="2" fill="CC"/><path stroke="CC" stroke-width="1.7" fill="none" d="M16,-28 Q19.5,-33 23,-28"/>',
 scroll:'<rect x="11" y="-30" width="17" height="12" rx="6" fill="#F4EEE0" stroke="CC" stroke-width="1.7"/>',
 ledger:'<rect x="11" y="-30" width="15" height="13" rx="1.5" fill="CC"/><path stroke="#F4EEE0" stroke-width="1.3" d="M14,-26 h9 M14,-23 h9"/>',
 flag:'<path stroke="CC" stroke-width="2.2" d="M14,-21 L14,-50"/><path fill="CC" d="M14,-50 L30,-45 L14,-39 Z"/>',
 map:'<rect x="11" y="-31" width="16" height="12" rx="1.7" fill="#F4EEE0" stroke="CC" stroke-width="1.7"/><path stroke="CC" stroke-width="1.1" d="M13,-27 h12 M13,-24 h8"/>',
 glass:'<path stroke="CC" stroke-width="2.8" d="M13,-28 L29,-34"/><circle cx="30" cy="-35" r="3.6" fill="none" stroke="CC" stroke-width="2"/>',
 kit:'<rect x="12" y="-28" width="15" height="12" rx="2" fill="CC"/><path stroke="#F4EEE0" stroke-width="2" d="M19.5,-25 v6 M16.5,-22 h6"/>'};

function avatar(c){const I='#151B26';
 return `<svg class="av" viewBox="0 0 66 78">
  <ellipse cx="33" cy="72" rx="16" ry="4" fill="rgba(0,0,0,.25)"/>
  <g transform="translate(33,60)" stroke="${I}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">
   <rect x="-9" y="-16" width="7" height="16" rx="3.5" fill="${c.col}"/>
   <rect x="2" y="-16" width="7" height="16" rx="3.5" fill="${c.col}"/>
   <rect x="-16" y="-34" width="6" height="18" rx="3" fill="${c.col}"/>
   <path fill="${c.col}" d="M-11,-35 Q-13,-17 -9,-15 L9,-15 Q13,-17 11,-35 Z"/>
   <rect x="10" y="-34" width="6" height="18" rx="3" fill="${c.col}"/>
   ${(PROP[c.prop]||'').replace(/CC/g,c.col)}
   <ellipse cx="0" cy="-45" rx="14" ry="13" fill="#F4D4B4"/>
   <g fill="${c.hairc}" stroke="none"><path d="${HAIR[c.hair]||HAIR.short}"/>${EXTRA[c.hair]||''}</g></g>
  <g stroke="none" transform="translate(33,60)">
   <ellipse cx="-5.5" cy="-44" rx="2.3" ry="3.4" fill="${I}"/>
   <ellipse cx="5.5" cy="-44" rx="2.3" ry="3.4" fill="${I}"/>
   <circle cx="-4.6" cy="-45.3" r="1" fill="#fff"/><circle cx="6.4" cy="-45.3" r="1" fill="#fff"/>
   <path d="M-3,-38 Q0,-35.3 3,-38" fill="none" stroke="${I}" stroke-width="1.7" stroke-linecap="round"/></g></svg>`;}

function box(x,y,w,d,h,top,side,extra){
 return `<div class="obj" style="left:${x}px;top:${y}px">
  <div class="tp" style="width:${w}px;height:${d}px;background:${top};transform:translateZ(${h}px)"></div>
  <div class="sd" style="width:${w}px;height:${h}px;background:${side};transform-origin:top;transform:rotateX(-90deg);top:${d}px"></div>
  <div class="sd" style="width:${d}px;height:${h}px;background:${side};transform-origin:left top;transform:translateX(${w}px) rotateY(90deg) rotateX(-90deg) translateY(-${h}px)"></div>
  ${extra||''}</div>`;}

function render(){
 const R=S.rooms[cur];
 let h='<div class="floor"></div><div class="wallN">';
 h+=`<div class="logo" style="left:40px;top:22px">${R.biz}</div>`;
 [300,440,580].forEach(x=>{h+=`<div class="win" style="left:${x}px;top:34px;width:110px;height:84px"></div>`;});
 h+=`<div class="board" style="left:700px;top:30px;width:160px;height:96px">
   <div class="ln a" style="left:14px;top:18px;width:110px"></div>
   <div class="ln" style="left:14px;top:36px;width:82px"></div>
   <div class="ln" style="left:14px;top:52px;width:118px"></div>
   <div class="ln" style="left:14px;top:68px;width:62px"></div></div></div><div class="wallW">`;
 [70,210,350].forEach(x=>{h+=`<div class="win" style="left:${x}px;top:40px;width:100px;height:82px"></div>`;});
 h+='</div><div class="rug" style="left:300px;top:336px;width:300px;height:158px"></div>';
 const POS=[[110,70],[330,70],[550,70],[110,268],[330,268],[550,268]];
 R.staff.forEach((slug,i)=>{
  const c=S.crew[slug]; if(!c||!POS[i])return;
  const [x,y]=POS[i];
  h+=box(x-16,y+12,100,58,28,'#E8E4F0','#B6B1C8',
    `<div class="mon" style="left:34px;top:8px;width:36px;height:24px;transform:translateZ(28px)"></div>`);
  h+=box(x+6,y+80,42,28,16,'#8E8AA6','#6D6986');
  const q=S.quotes.find(q=>q.dept===slug), real=!!q;
  const say=real?q.text:(c.task?c.task.slice(0,40):c.label);
  h+=`<div class="unit ${c.state}" data-s="${slug}" style="left:${x}px;top:${y}px">
   <div class="bill">${avatar(c)}
    <div class="nm"><i style="background:${COL[c.state]}"></i>${c.nick}</div>
    <div class="rl">${c.role} ／ ${c.label}</div>
    <div class="bub ${real?'real':''}">${say}${real?`<span class="w">${q.who}｜${q.src}</span>`:''}</div>
   </div></div>`;});
 [[812,442],[38,452],[822,58]].forEach(([x,y])=>{
  h+=`<div class="plant" style="left:${x}px;top:${y}px"><div class="pot"></div><div class="lf"></div></div>`;});
 h+=box(322,362,186,62,22,'#CBC6DC','#A29DB8');
 room.innerHTML=h;
 const AX={csat:'顧客満足',hiring:'採用',pl:'売上'}, bn=s=>s>=2?'hi':(s>=1?'mid':'lo');
 document.getElementById('issb').innerHTML=R.issues.length?R.issues.map(i=>
  `<div class="ic"><div class="r"><span class="ax ${i.axis}">${AX[i.axis]}</span>
   <span class="sc ${bn(i.score)}">${i.score.toFixed(2)}</span></div>
   <div class="t">${i.title}</div><div class="o">任せる ${i.owner}</div></div>`).join('')
  :'<div class="ic"><div class="t">課題は登録されていません</div></div>';
 document.getElementById('ic').textContent=R.issues.length;
 document.getElementById('ord').innerHTML=`<b>${R.biz}</b> の優先順位<span>${R.order||'未設定'}</span>`;
 document.querySelectorAll('#tabs button').forEach((b,i)=>b.classList.toggle('on',i===cur));
}
document.getElementById('tabs').innerHTML=S.rooms.map((r,i)=>
 `<button data-i="${i}">${r.biz}<i>${r.issues.length}</i></button>`).join('');
document.getElementById('tabs').addEventListener('click',e=>{
 const b=e.target.closest('button'); if(!b)return; cur=+b.dataset.i; render();});
const NM={}; Object.values(S.crew).forEach(c=>NM[c.slug]=c.nick); NM.system='システム';
const SL={done:'完了',running:'着手',blocked:'詰まり',skipped:'見送り'};
document.getElementById('logs').innerHTML=S.log.map(r=>
 `<div class="cl"><span class="t">${r.ago}</span>
  <span><b>${NM[r.crew]||r.crew}</b> ${SL[r.status]||r.status}　${(r.task||'').slice(0,30)}</span></div>`).join('');
const run=Object.values(S.crew).filter(c=>c.state==='running').length;
document.getElementById('hd').textContent=S.now.slice(0,16).replace('T',' ')+'　作業中 '+run+' / 全 '+Object.keys(S.crew).length;
function renderQueue(){const q=S.queue||[];
 document.getElementById('queue').innerHTML=q.length
  ?q.map(x=>`<div class="q"><em>未処理</em>${x.biz?'['+x.biz+'] ':''}${x.text}</div>`).join('')
  :'<div class="q" style="color:#66748A">未処理の指示はありません</div>';
 document.getElementById('qc').textContent=q.length;}
renderQueue(); render();
const world=document.getElementById('world'), stage=document.getElementById('stage');
let rx=57,rz=-36,z=-150,down=false,mx=0,my=0,auto=false;
function apply(){rx=Math.min(80,Math.max(24,rx));
 world.style.setProperty('--rx',rx+'deg');world.style.setProperty('--rz',rz+'deg');world.style.setProperty('--z',z+'px');}
stage.addEventListener('pointerdown',e=>{down=true;auto=false;
 document.getElementById('cam').classList.remove('on');
 mx=e.clientX;my=e.clientY;stage.classList.add('drag');stage.setPointerCapture(e.pointerId);});
stage.addEventListener('pointermove',e=>{if(!down)return;
 rz+=(e.clientX-mx)*.34;rx-=(e.clientY-my)*.26;mx=e.clientX;my=e.clientY;apply();});
stage.addEventListener('pointerup',()=>{down=false;stage.classList.remove('drag');});
stage.addEventListener('pointercancel',()=>{down=false;stage.classList.remove('drag');});
document.getElementById('rs').onclick=()=>{rx=57;rz=-36;z=-150;apply();};
document.getElementById('zi').onclick=()=>{z=Math.min(240,z+70);apply();};
document.getElementById('zo').onclick=()=>{z=Math.max(-760,z-70);apply();};
document.getElementById('cam').onclick=function(){auto=!auto;this.classList.toggle('on',auto);};
setInterval(()=>{if(auto&&!down){rz+=0.15;apply();}},40);
room.addEventListener('click',e=>{const u=e.target.closest('.unit');if(!u)return;
 document.querySelectorAll('.unit').forEach(x=>x.classList.remove('sel'));u.classList.add('sel');});
apply();
const ta=document.getElementById('ta'),send=document.getElementById('send'),msg=document.getElementById('msg');
let ns=null;
const useA=(window.claude&&claude.use)?claude.use('artifact'):Promise.resolve(null);
useA.then(a=>{ns=a;msg.textContent=a?'次の稼働で担当に振り分けます':'このビューでは保存できません';
 if(!a){send.disabled=true;ta.disabled=true;}}).catch(()=>{send.disabled=true;msg.textContent='読み込めませんでした';});
send.onclick=async()=>{const text=ta.value.trim(); if(!text||!ns)return;
 send.disabled=true;msg.textContent='保存中…';
 S.queue=(S.queue||[]).concat([{text,biz:S.rooms[cur].biz,at:new Date().toISOString()}]);
 try{const tpl=decodeURIComponent(escape(atob(document.getElementById('tpl').textContent)));
  await ns.publish(tpl.replace('__STATE__',JSON.stringify(S)).replace('__TPL__',document.getElementById('tpl').textContent));
  ta.value='';renderQueue();msg.textContent='保存しました';
 }catch(err){S.queue.pop();
  msg.textContent=(err&&err.code==='conflict')?'他の更新が入りました。開き直してください':'保存できませんでした';}
 send.disabled=false;};
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
