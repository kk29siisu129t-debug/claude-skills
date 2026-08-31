# -*- coding: utf-8 -*-
"""
claude-hub/scripts/build-office.py

バーチャルオフィス。アイソメトリックの3D офисに8人の人格を配置し、
稼働状況・成果物・実発言・指示キューを1枚で見せる。

  python scripts/build-office.py [出力パス]

読むもの:
  data/crew/runs.jsonl   稼働記録
  data/crew/*.md         各人格の蓄積
  data/quotes.json       会議の実発言（緑の吹き出し）
  content/drafts/ reports/ content/reviews/   成果物
"""
import io, os, sys, json, re, base64, datetime

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREWD = os.path.join(HUB, 'data', 'crew')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HUB, 'office.html')
NOW = os.environ.get('OFFICE_NOW', '2026-08-29T13:08:00+09:00')

MEMBERS = [
    ('chief-of-staff', '秘書くん',   'No.2',       (150,  90)),
    ('sales',          '営業くん',   '営業',       (330,  90)),
    ('marketing',      'マーケくん', 'マーケ',     (510,  90)),
    ('planning',       '財務くん',   '経営企画',   (150, 250)),
    ('product',        'プロダクトくん','プロダクト',(330, 250)),
    ('hr',             '人事くん',   '人事',       (510, 250)),
    ('kansayaku',      '鬼監査くん', '監査役',     (700, 130)),
    ('reviewer',       '検品くん',   '品質審査',   (700, 290)),
]


def fm(t):
    m = re.match(r'^---\n(.*?)\n---\n', t, re.S)
    d = {}
    if m:
        for l in m.group(1).split('\n'):
            if ':' in l:
                k, v = l.split(':', 1); d[k.strip()] = v.strip()
    return d


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
    except Exception: return '—'
    s = int(d.total_seconds())
    if s < 0: return 'たった今'
    if s < 3600: return '%d分前' % (s // 60)
    if s < 86400: return '%d時間前' % (s // 3600)
    return '%d日前' % (s // 86400)


QP = os.path.join(HUB, 'data', 'quotes.json')
QUOTES = json.load(io.open(QP, encoding='utf-8'))['quotes'] if os.path.isfile(QP) else []
QBY = {}
for q in QUOTES:
    QBY.setdefault(q['dept'], []).append(q)

crew = []
for slug, nick, role, pos in MEMBERS:
    fp = os.path.join(CREWD, slug + '.md')
    t = io.open(fp, encoding='utf-8').read() if os.path.isfile(fp) else ''
    f = fm(t)
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
    if not mine:        state, label = 'never', '未起動'
    elif open_task and stale: state, label = 'stale', '停滞'
    elif open_task:     state, label = 'running', '作業中'
    elif last and last.get('status') == 'blocked': state, label = 'blocked', '詰まり'
    else:               state, label = 'idle', '待機中'

    q = QBY.get(slug, [])
    crew.append(dict(slug=slug, nick=nick, role=role, x=pos[0], y=pos[1],
                     state=state, label=label,
                     task=(open_task or last or {}).get('task', ''),
                     ago=ago(last['ts']) if last else '',
                     runs=len(mine),
                     quote=(q[0]['text'] if q else ''),
                     quoteWho=(q[0]['who'] if q else ''),
                     quoteSrc=(q[0]['src'] if q else '')))

# ── 成果物
def scan(rel, kind):
    d = os.path.join(HUB, *rel.split('/'))
    out = []
    if os.path.isdir(d):
        for f in sorted(os.listdir(d), reverse=True):
            if f.startswith('.'):
                continue
            p = os.path.join(d, f)
            out.append(dict(kind=kind, name=f, size=os.path.getsize(p), path=rel + '/' + f))
    return out

artifacts = scan('content/drafts', '下書き') + scan('reports', 'レポート') + scan('content/reviews', '審査')

STATE = dict(now=NOW, crew=crew, artifacts=artifacts,
             log=[dict(r, ago=ago(r.get('ts', ''))) for r in runs[:24]],
             queue=[])

HEAD = ('<meta charset="utf-8"><title>バーチャルオフィス</title>'
        '<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
        'family=Reggae+One&family=Zen+Maru+Gothic:wght@400;500;700&'
        'family=DotGothic16&family=IBM+Plex+Mono:wght@400;500;600&display=swap">')

BODY = r"""<title>バーチャルオフィス</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Reggae+One&family=Zen+Maru+Gothic:wght@400;500;700&family=DotGothic16&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root{--bg:#0E1420;--room:#8E93B8;--room2:#6E7398;--floor:#B8B3C8;--floor2:#9A96AE;
 --ink:#EDE6D6;--dim:#9AA2B4;--line:#2A3448;--panel:rgba(12,18,30,.86);
 --go:#6FD08C;--idle:#E7C063;--never:#7A8496;--stop:#F0836B;--acc:#E8703F;--gold:#E0B054;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
 font-family:"Zen Maru Gothic","Hiragino Maru Gothic ProN",system-ui,sans-serif;
 font-size:14px;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.top{display:flex;align-items:center;gap:14px;padding:9px 16px;border-bottom:1px solid var(--line);
 background:rgba(8,12,20,.9);flex-wrap:wrap;position:sticky;top:0;z-index:9}
.brand{font-family:"Reggae One",sans-serif;font-size:19px;letter-spacing:.05em}
.pill{font-family:"DotGothic16",monospace;font-size:11px;border:1px solid var(--line);
 padding:3px 9px;color:var(--dim)}
.pipe{display:flex;gap:0;margin-left:auto;flex-wrap:wrap}
.pipe div{font-family:"DotGothic16",monospace;font-size:11.5px;padding:4px 12px;color:var(--dim);
 border-right:1px solid var(--line)}
.pipe div:last-child{border-right:none}
.pipe div b{color:var(--gold);margin-right:5px}
.pipe div.on{color:var(--ink);background:rgba(232,112,63,.16)}
.live{font-family:"DotGothic16",monospace;font-size:11px;color:#FF6B6B}
.live i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#FF6B6B;
 margin-right:5px;animation:bl 1.4s ease-in-out infinite}
@keyframes bl{0%,100%{opacity:1}50%{opacity:.25}}

.wrap{position:relative;height:calc(100vh - 44px);min-height:560px;overflow:hidden}
.stage{position:absolute;inset:0;perspective:1700px;perspective-origin:50% 34%;cursor:grab;touch-action:none}
.stage.drag{cursor:grabbing}
.world{position:absolute;inset:0;transform-style:preserve-3d;
 transform:translateZ(var(--z,-180px)) rotateX(var(--rx,58deg)) rotateZ(var(--rz,-38deg));
 transition:transform .12s linear}
.room{position:absolute;left:50%;top:50%;width:880px;height:460px;margin:-230px 0 0 -440px;
 transform-style:preserve-3d}
.fl{position:absolute;inset:0;background:
 repeating-linear-gradient(0deg,rgba(0,0,0,.06) 0 1px,transparent 1px 44px),
 repeating-linear-gradient(90deg,rgba(0,0,0,.06) 0 1px,transparent 1px 44px),
 linear-gradient(160deg,var(--floor),var(--floor2));border:1px solid rgba(255,255,255,.18)}
.wallN{position:absolute;left:0;top:0;width:880px;height:150px;transform-origin:top;
 transform:rotateX(90deg);background:linear-gradient(180deg,var(--room),var(--room2))}
.wallW{position:absolute;left:0;top:0;width:460px;height:150px;transform-origin:left top;
 transform:rotateY(-90deg) rotateX(90deg) translateX(-460px);
 background:linear-gradient(180deg,var(--room2),var(--room))}
.win{position:absolute;background:rgba(190,220,235,.5);border:2px solid rgba(255,255,255,.35)}
.desk{position:absolute;transform-style:preserve-3d}
.dt{position:absolute;width:96px;height:56px;background:#DED9E6;border:1px solid #6D6980;
 transform:translateZ(26px)}
.ds{position:absolute;width:96px;height:26px;background:#A8A3B6;border:1px solid #6D6980;
 transform-origin:top;transform:rotateX(-90deg);top:56px}
.mon{position:absolute;width:34px;height:22px;background:#2C3446;border:1px solid #566;
 left:31px;top:6px;transform:translateZ(26px)}
.plant{position:absolute;width:26px;height:26px;border-radius:50%;
 background:radial-gradient(circle at 35% 30%,#7FBF8A,#3E7A4C);transform:translateZ(8px)}

.unit{position:absolute;transform-style:preserve-3d;cursor:pointer}
.bill{position:absolute;width:190px;left:-47px;top:-14px;text-align:center;
 transform:translateZ(78px) rotateZ(calc(-1 * var(--rz,-38deg))) rotateX(calc(-1 * var(--rx,58deg)))}
.av{width:62px;height:72px;display:block;margin:0 auto;filter:drop-shadow(0 3px 4px rgba(0,0,0,.5))}
.nm{font-size:12.5px;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.9)}
.nm i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:1px}
.rl{font-family:"DotGothic16",monospace;font-size:9.5px;color:#C9CEDA;text-shadow:0 1px 4px rgba(0,0,0,.9)}
.bub{display:inline-block;max-width:186px;margin-top:5px;padding:4px 9px;border-radius:12px;
 font-size:10.5px;line-height:1.5;background:rgba(14,20,32,.9);border:1px solid var(--line);
 color:#D6DCE8;text-align:left}
.bub.real{border-color:var(--go);color:#CFF0D8}
.bub .w{display:block;font-family:"DotGothic16",monospace;font-size:8.5px;color:#8FB89B;margin-top:2px}
.unit.running .av{animation:bob .8s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.unit.never .av{opacity:.42}
.unit.stale .av,.unit.blocked .av{animation:al 1.4s ease-in-out infinite}
@keyframes al{0%,100%{opacity:1}50%{opacity:.35}}
.unit.sel .bub{border-color:var(--acc)}

.panel{position:absolute;background:var(--panel);border:1px solid var(--line);
 backdrop-filter:blur(6px);z-index:5}
.panel h3{margin:0;padding:9px 12px;font-family:"DotGothic16",monospace;font-size:11.5px;
 letter-spacing:.1em;color:var(--gold);border-bottom:1px solid var(--line);
 display:flex;justify-content:space-between}
.panel h3 span{color:var(--dim)}
#mon{right:10px;top:10px;width:min(330px,42vw);max-height:52vh;display:flex;flex-direction:column}
#mon .body{overflow:auto}
.art{display:grid;grid-template-columns:52px 1fr;gap:9px;padding:7px 12px;
 border-bottom:1px solid rgba(255,255,255,.05);font-size:11px}
.art .k{font-family:"DotGothic16",monospace;font-size:9px;color:var(--gold);
 border:1px solid var(--line);padding:1px 3px;height:fit-content;text-align:center}
.art .n{color:#D6DCE8;word-break:break-all;line-height:1.45}
.art .s{font-family:"IBM Plex Mono",monospace;font-size:9px;color:var(--never)}
.empty{padding:14px 12px;font-family:"DotGothic16",monospace;font-size:11px;color:var(--never)}
#chat{left:10px;bottom:10px;width:min(360px,46vw);max-height:34vh;display:flex;flex-direction:column}
#chat .body{overflow:auto}
.cl{padding:5px 12px;font-size:11px;display:grid;grid-template-columns:58px 1fr;gap:8px;
 border-bottom:1px solid rgba(255,255,255,.05)}
.cl .t{font-family:"IBM Plex Mono",monospace;font-size:9.5px;color:var(--never)}
.cl b{color:var(--gold);font-weight:400}
#seat{right:10px;bottom:10px;width:min(330px,42vw)}
#seat .body{padding:10px 12px}
.q{font-size:11px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06);color:#D6DCE8}
.q em{font-style:normal;font-family:"DotGothic16",monospace;font-size:9px;color:var(--acc);
 border:1px solid var(--acc);padding:0 4px;margin-right:6px}
#ta{width:100%;background:rgba(255,255,255,.05);border:1px solid var(--line);color:var(--ink);
 font-family:inherit;font-size:12px;padding:8px;resize:vertical;min-height:52px;margin-top:8px}
#ta:focus{outline:2px solid var(--acc);outline-offset:1px}
.row{display:flex;gap:8px;margin-top:8px;align-items:center}
#send{font-family:"DotGothic16",monospace;font-size:12px;background:var(--acc);color:#12161F;
 border:none;padding:7px 16px;cursor:pointer;font-weight:700}
#send:disabled{opacity:.45;cursor:default}
#msg{font-family:"DotGothic16",monospace;font-size:10px;color:var(--dim);flex:1}
.ctl{position:absolute;left:10px;top:10px;display:flex;gap:6px;z-index:5;flex-wrap:wrap}
.ctl button{font-family:"DotGothic16",monospace;font-size:11px;background:var(--panel);
 color:var(--ink);border:1px solid var(--line);padding:4px 10px;cursor:pointer}
.ctl button.on{border-color:var(--acc);color:var(--acc)}
.legend{position:absolute;left:10px;top:46px;font-family:"DotGothic16",monospace;font-size:10px;
 color:var(--dim);z-index:5;line-height:1.8}
.legend i{display:inline-block;width:9px;height:9px;margin-right:5px}
@media (prefers-reduced-motion:reduce){.unit .av,.live i{animation:none}.world{transition:none}}
@media(max-width:700px){#mon,#seat{width:calc(100vw - 20px);max-height:30vh}#chat{width:calc(100vw - 20px)}}
</style></head><body>

<div class="top">
  <span class="brand">バーチャルオフィス</span>
  <span class="pill" id="hd"></span>
  <div class="pipe">
    <div><b>1</b>指示</div><div><b>2</b>着手</div><div><b>3</b>制作</div>
    <div><b>4</b>審査</div><div><b>5</b>納品</div>
  </div>
  <span class="live"><i></i>LIVE</span>
</div>

<div class="wrap">
  <div class="stage" id="stage"><div class="world" id="world"><div class="room" id="room"></div></div></div>
  <div class="ctl">
    <button id="cam">自動カメラ</button><button id="rs">正面</button>
    <button id="zi">＋</button><button id="zo">−</button>
  </div>
  <div class="legend">
    <div><i style="background:var(--go)"></i>緑＝MTGログの実発言</div>
    <div><i style="background:#3A4358"></i>灰＝AIの生成</div>
  </div>

  <div class="panel" id="mon"><h3>成果物モニター<span id="ac"></span></h3><div class="body" id="arts"></div></div>
  <div class="panel" id="chat"><h3>稼働ログ</h3><div class="body" id="logs"></div></div>
  <div class="panel" id="seat"><h3>代表の席<span id="qc"></span></h3>
    <div class="body">
      <div id="queue"></div>
      <textarea id="ta" placeholder="指示を入力（例: 今週のリール3本を企画から台本まで）"></textarea>
      <div class="row"><button id="send">送信</button><span id="msg"></span></div>
    </div>
  </div>
</div>

<script id="state" type="application/json">__STATE__</script>
<script id="tpl" type="text/plain">__TPL__</script>
<script>
const S = JSON.parse(document.getElementById('state').textContent);
const room = document.getElementById('room');
const COL = {running:'var(--go)', idle:'var(--idle)', never:'var(--never)',
             stale:'var(--stop)', blocked:'var(--stop)'};

function avatar(c){
  const body = {running:'#6FD08C', idle:'#C9A24A', never:'#5A6478',
                stale:'#D9614A', blocked:'#D9614A'}[c.state] || '#7A8496';
  return `<svg class="av" viewBox="0 0 62 72" aria-hidden="true">
   <ellipse cx="31" cy="66" rx="15" ry="4" fill="rgba(0,0,0,.28)"/>
   <path d="M20,66 Q18,44 31,44 Q44,44 42,66 Z" fill="${body}" stroke="#141A26" stroke-width="2"/>
   <circle cx="31" cy="28" r="16" fill="#F2D9BE" stroke="#141A26" stroke-width="2"/>
   <path d="M15,26 Q15,10 31,10 Q47,10 47,26 L43,22 Q31,15 19,22 Z" fill="#2E3242"/>
   <ellipse cx="25" cy="30" rx="2.4" ry="3.4" fill="#141A26"/>
   <ellipse cx="37" cy="30" rx="2.4" ry="3.4" fill="#141A26"/>
   <circle cx="26" cy="28.6" r="1" fill="#fff"/><circle cx="38" cy="28.6" r="1" fill="#fff"/>
   <path d="M28,37 Q31,39.5 34,37" fill="none" stroke="#141A26" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
}

let html = '<div class="fl"></div><div class="wallN"></div><div class="wallW"></div>';
[[90,26],[300,26],[510,26],[700,26]].forEach(([x,y])=>{
  html += `<div class="win" style="left:${x}px;top:${y}px;width:130px;height:70px;
   transform-origin:top;transform:rotateX(90deg) translateZ(1px)"></div>`;});
[[60,400],[820,60],[820,400]].forEach(([x,y])=>{
  html += `<div class="plant" style="left:${x}px;top:${y}px"></div>`;});

S.crew.forEach((c,i)=>{
  html += `<div class="desk" style="left:${c.x-14}px;top:${c.y+8}px">
    <div class="dt"></div><div class="ds"></div><div class="mon"></div></div>`;
  const real = !!c.quote;
  const say = real ? c.quote : (c.task ? c.task.slice(0,42) : c.label);
  html += `<div class="unit ${c.state}" data-i="${i}" style="left:${c.x}px;top:${c.y}px">
    <div class="bill">${avatar(c)}
      <div class="nm"><i style="background:${COL[c.state]}"></i>${c.nick}</div>
      <div class="rl">${c.role} ／ ${c.label}</div>
      <div class="bub ${real?'real':''}">${say}${real?`<span class="w">${c.quoteWho}｜${c.quoteSrc}</span>`:''}</div>
    </div></div>`;
});
room.innerHTML = html;

const KIND = {'下書き':'下書','レポート':'報告','審査':'審査'};
document.getElementById('arts').innerHTML = S.artifacts.length ? S.artifacts.map(a=>
  `<div class="art"><span class="k">${KIND[a.kind]||a.kind}</span>
   <span><span class="n">${a.name}</span><br><span class="s">${a.path} ・ ${(a.size/1024).toFixed(1)}KB</span></span></div>`).join('')
  : '<div class="empty">まだ成果物がありません</div>';
document.getElementById('ac').textContent = S.artifacts.length;

const NM = {}; S.crew.forEach(c=>NM[c.slug]=c.nick); NM.system='システム';
const SL = {done:'完了',running:'着手',blocked:'詰まり',skipped:'見送り'};
document.getElementById('logs').innerHTML = S.log.map(r=>
  `<div class="cl"><span class="t">${r.ago}</span>
   <span><b>${NM[r.crew]||r.crew}</b> ${SL[r.status]||r.status}　${(r.task||'').slice(0,34)}</span></div>`).join('');

const run = S.crew.filter(c=>c.state==='running').length;
document.getElementById('hd').textContent =
  S.now.slice(0,16).replace('T',' ') + '　作業中 ' + run + ' / 全 ' + S.crew.length;

function renderQueue(){
  const q = S.queue || [];
  document.getElementById('queue').innerHTML = q.length
    ? q.map(x=>`<div class="q"><em>未処理</em>${x.text}</div>`).join('')
    : '<div class="q" style="color:#7A8496">未処理の指示はありません</div>';
  document.getElementById('qc').textContent = q.length;
}
renderQueue();

// ── 3D
const world=document.getElementById('world'), stage=document.getElementById('stage');
let rx=58, rz=-38, z=-180, down=false, mx=0, my=0, auto=false;
function apply(){ rx=Math.min(80,Math.max(24,rx));
  world.style.setProperty('--rx',rx+'deg'); world.style.setProperty('--rz',rz+'deg');
  world.style.setProperty('--z',z+'px'); }
stage.addEventListener('pointerdown',e=>{down=true;auto=false;
  document.getElementById('cam').classList.remove('on');
  mx=e.clientX;my=e.clientY;stage.classList.add('drag');stage.setPointerCapture(e.pointerId);});
stage.addEventListener('pointermove',e=>{if(!down)return;
  rz+=(e.clientX-mx)*.34; rx-=(e.clientY-my)*.26; mx=e.clientX; my=e.clientY; apply();});
stage.addEventListener('pointerup',()=>{down=false;stage.classList.remove('drag');});
stage.addEventListener('pointercancel',()=>{down=false;stage.classList.remove('drag');});
document.getElementById('rs').onclick=()=>{rx=58;rz=-38;z=-180;apply();};
document.getElementById('zi').onclick=()=>{z=Math.min(200,z+70);apply();};
document.getElementById('zo').onclick=()=>{z=Math.max(-700,z-70);apply();};
document.getElementById('cam').onclick=function(){auto=!auto;this.classList.toggle('on',auto);};
setInterval(()=>{if(auto&&!down){rz+=0.16;apply();}},40);
room.addEventListener('click',e=>{const u=e.target.closest('.unit'); if(!u)return;
  document.querySelectorAll('.unit').forEach(x=>x.classList.remove('sel'));
  u.classList.add('sel');});
apply();

// ── 代表の席（指示キュー）
const ta=document.getElementById('ta'), send=document.getElementById('send'), msg=document.getElementById('msg');
let artifactNS=null;
const useArtifact = (window.claude && claude.use) ? claude.use('artifact') : Promise.resolve(null);
useArtifact.then(a=>{ artifactNS=a;
  msg.textContent = a ? '次の稼働で担当に振り分けます' : 'このビューでは保存できません';
  if(!a){ send.disabled=true; ta.disabled=true; }
}).catch(()=>{ send.disabled=true; msg.textContent='保存機能を読み込めませんでした'; });

send.onclick = async () => {
  const text = ta.value.trim();
  if(!text || !artifactNS) return;
  send.disabled = true; msg.textContent = '保存中…';
  S.queue = (S.queue||[]).concat([{text, at:new Date().toISOString()}]);
  try{
    const tpl = decodeURIComponent(escape(atob(document.getElementById('tpl').textContent)));
    const doc = tpl.replace('__STATE__', JSON.stringify(S))
                   .replace('__TPL__', document.getElementById('tpl').textContent);
    await artifactNS.publish(doc);
    ta.value=''; renderQueue(); msg.textContent='保存しました';
  }catch(err){
    S.queue.pop();
    msg.textContent = (err && err.code==='conflict') ? '他の更新が入りました。開き直してください' : '保存できませんでした';
  }
  send.disabled = false;
};
</script>"""

# ページ内からの再公開用は「完全な文書」でなければならない
FULL = '<!doctype html><html><head>' + HEAD + '</head><body>' + BODY + '</body></html>'

# Artifact ツールへ渡す初回ファイルは「本文だけ」
b64 = base64.b64encode(FULL.encode('utf-8')).decode('ascii')
doc = BODY.replace('__STATE__', json.dumps(STATE, ensure_ascii=False)).replace('__TPL__', b64)
io.open(OUT, 'w', encoding='utf-8').write(doc)
print('wrote', OUT)
print('crew:%d  artifacts:%d  logs:%d  body:%.0fKB  tpl:%.0fKB'
      % (len(crew), len(artifacts), len(STATE['log']), len(doc)/1024, len(b64)/1024))
