# -*- coding: utf-8 -*-
"""
claude-hub/scripts/build-dashboard.py

乗組員（Claude の人格）が動いているか・何をしているかを見るダッシュボード。

  python scripts/build-dashboard.py [出力パス]

読むもの:
  data/crew/runs.jsonl    稼働記録（1行1件）
  data/crew/*.md          各人格の蓄積
  data/metrics.json       売上利益・顧客満足度・採用数（表で併記）
"""
import io, os, sys, json, re, datetime

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREWD = os.path.join(HUB, 'data', 'crew')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HUB, 'dashboard.html')
# 既定はビルドした瞬間の時刻。固定値にしていたため、ページの日付が何日も止まって見えていた（2026-09-04）
NOW = os.environ.get('DASH_NOW') or datetime.datetime.now().astimezone().replace(microsecond=0).isoformat()

SLUGS = ['chief-of-staff', 'sales', 'marketing', 'planning', 'product', 'hr',
         'kansayaku', 'reviewer']
# 旧 slug -> 現 slug。部署再編前の稼働記録を取りこぼさないため
ALIAS = {'auditor': 'kansayaku', 'finance': 'planning'}


def fm(t):
    m = re.match(r'^---\n(.*?)\n---\n', t, re.S)
    d = {}
    if m:
        for l in m.group(1).split('\n'):
            if ':' in l:
                k, v = l.split(':', 1); d[k.strip()] = v.strip()
    return d


def sect(t, title):
    m = re.search(r'^##\s+' + re.escape(title) + r'.*?$(.*?)(?=^##\s|\Z)', t, re.S | re.M)
    return m.group(1) if m else ''


def rows(b):
    n = 0
    for l in b.split('\n'):
        l = l.strip()
        if l.startswith('|') and '---' not in l:
            n += 1
    return max(0, n - 1)


def bullets(b):
    return len([l for l in b.split('\n') if l.strip().startswith(('-', '*'))])


# ── 稼働記録
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

now = datetime.datetime.fromisoformat(NOW)


def ago(ts):
    try: d = now - datetime.datetime.fromisoformat(ts)
    except Exception: return '—'
    s = int(d.total_seconds())
    if s < 0: return 'たった今'
    if s < 3600: return '%d分前' % (s // 60)
    if s < 86400: return '%d時間前' % (s // 3600)
    return '%d日前' % (s // 86400)


crew = []
for slug in SLUGS:
    fp = os.path.join(CREWD, slug + '.md')
    t = io.open(fp, encoding='utf-8').read() if os.path.isfile(fp) else ''
    f = fm(t)
    mine = [r for r in runs
            if ALIAS.get(r.get('crew'), r.get('crew')) == slug]
    last = mine[0] if mine else None
    # 未完了の running を探す
    open_task, stale = None, False
    seen_done = set()
    for r in mine:
        k = r.get('task', '')
        if r.get('status') == 'done': seen_done.add(k)
        elif r.get('status') == 'running' and k not in seen_done:
            open_task = r
            try: stale = (now - datetime.datetime.fromisoformat(r['ts'])).total_seconds() > 86400
            except Exception: stale = False
            break
    if not mine:
        state, label = 'never', '未起動'
    elif open_task and stale:
        state, label = 'stale', '停滞'
    elif open_task:
        state, label = 'running', '稼働中'
    elif last and last.get('status') == 'blocked':
        state, label = 'blocked', '詰まり'
    else:
        state, label = 'idle', '待機'
    crew.append(dict(
        slug=slug, role=f.get('crew', slug), ship=f.get('ship', ''),
        state=state, label=label,
        task=(open_task or last or {}).get('task', '—'),
        detail=(open_task or last or {}).get('detail', ''),
        last=(last or {}).get('ts', ''), lastAgo=ago(last['ts']) if last else '—',
        total=len(mine),
        found=sum(int(r.get('found', 0) or 0) for r in mine),
        axis=f.get('axis', ''),
        rules=bullets(sect(t, '判定基準（増やしていく）')),
        notes=rows(sect(t, '事業ごとの注意点')),
        hits=rows(sect(t, '指摘の履歴')),
        miss=rows(sect(t, '外した事例（最重要）'))))

# ── 指標（表で併記）
MP = os.path.join(HUB, 'data', 'metrics.json')
M = json.load(io.open(MP, encoding='utf-8')) if os.path.isfile(MP) else {'businesses': [], 'asOf': ''}

LOG = [dict(r, ago=ago(r.get('ts', ''))) for r in runs[:40]]
DATA = json.dumps(dict(crew=crew, log=LOG, metrics=M, now=NOW), ensure_ascii=False)

ROLECH = {
 'chief-of-staff': ('bob',   '#3A2A1E', '#B8451F', 'bag'),
 'sales':          ('band',  '#5A2A18', '#1F4A6B', 'flag'),
 'marketing':      ('tail',  '#7A4A22', '#2C6076', 'map'),
 'planning':       ('long',  '#4A2E1C', '#7A5A2A', 'ledger'),
 'product':        ('cap',   '#2F2A26', '#3F6B45', 'kit'),
 'hr':             ('curl',  '#4A2E1C', '#7A3D6B', 'scroll'),
 'kansayaku':      ('spike', '#2F2A26', '#A32117', 'sword'),
 'reviewer':       ('short', '#3A2A1E', '#4A5560', 'glass'),
}


def hair(k, c):
    H = {
     'short': '<path fill="%s" d="M-14,-43 Q-14,-58 0,-58 Q14,-58 14,-43 L11,-46 Q0,-52 -11,-46 Z"/>' % c,
     'spike': '<path fill="%s" d="M-14,-44 L-11,-58 L-6,-49 L-1,-60 L4,-49 L9,-58 L13,-45 Q0,-56 -14,-44 Z"/>' % c,
     'long':  '<path fill="%s" d="M-14,-42 Q-15,-57 0,-57 Q15,-57 14,-42 L14,-24 L9,-26 L10,-44 Q0,-50 -10,-44 L-9,-26 L-14,-24 Z"/>' % c,
     'bob':   '<path fill="%s" d="M-14,-41 Q-15,-58 0,-58 Q15,-58 14,-41 L14,-35 L10,-45 Q0,-51 -10,-45 L-14,-35 Z"/>' % c,
     'tail':  '<path fill="%s" d="M-14,-42 Q-15,-58 0,-58 Q15,-58 14,-42 L10,-45 Q0,-51 -10,-45 Z"/><path fill="%s" d="M12,-48 Q22,-44 20,-30 Q17,-36 11,-40 Z"/>' % (c, c),
     'cap':   '<path fill="%s" d="M-14,-45 Q-14,-58 0,-58 Q14,-58 14,-45 Z"/><path fill="%s" d="M-15,-45 L20,-45 L20,-41 L-15,-41 Z"/>' % (c, c),
     'curl':  '<path fill="%s" d="M-14,-42 Q-16,-59 0,-58 Q16,-59 14,-42 Q9,-49 4,-45 Q0,-51 -4,-45 Q-9,-49 -14,-42 Z"/>' % c,
     'band':  '<path fill="%s" d="M-14,-44 Q-14,-57 0,-57 Q14,-57 14,-44 L10,-46 Q0,-51 -10,-46 Z"/>'
              '<path fill="%s" d="M-15,-46 L15,-46 L15,-40 L-15,-40 Z"/>'
              '<path fill="%s" d="M-15,-45 L-25,-40 L-22,-30 L-15,-39 Z"/>' % (c, c, c),
    }
    return H.get(k, H['bob'])


def prop(k, c):
    P = {
     'sword':  '<path stroke="%s" stroke-width="2.4" d="M13,-22 L27,-46"/><path stroke="%s" stroke-width="3" d="M10,-26 L18,-22"/>' % (c, c),
     'bag':    '<rect x="11" y="-27" width="14" height="11" rx="2" fill="%s"/><path stroke="%s" stroke-width="1.6" fill="none" d="M15,-27 Q18,-32 21,-27"/>' % (c, c),
     'scroll': '<rect x="10" y="-29" width="16" height="11" rx="5.5" fill="#F7EEDA" stroke="%s" stroke-width="1.6"/><path stroke="%s" stroke-width="1.1" d="M14,-25 h9 M14,-22 h6"/>' % (c, c),
     'ledger': '<rect x="10" y="-29" width="14" height="12" rx="1.4" fill="%s"/><path stroke="#F7EEDA" stroke-width="1.2" d="M13,-25 h8 M13,-22 h8"/>' % c,
     'flag':   '<path stroke="%s" stroke-width="2" d="M13,-20 L13,-48"/><path fill="%s" d="M13,-48 L28,-43 L13,-38 Z"/>' % (c, c),
     'scroll': '<rect x="10" y="-29" width="16" height="11" rx="5.5" fill="#F7EEDA" stroke="%s" stroke-width="1.6"/>'
               '<path stroke="%s" stroke-width="1.1" d="M14,-25 h9 M14,-22 h6"/>' % (c, c),
     'map':    '<rect x="10" y="-30" width="15" height="11" rx="1.6" fill="#F7EEDA" stroke="%s" stroke-width="1.6"/>'
               '<path stroke="%s" stroke-width="1" d="M12,-26 h11 M12,-23 h7"/>' % (c, c),
     'glass':  '<path stroke="%s" stroke-width="2.6" d="M12,-27 L27,-33"/>'
               '<circle cx="28" cy="-34" r="3.4" fill="none" stroke="%s" stroke-width="1.8"/>' % (c, c),
     'kit':    '<rect x="11" y="-27" width="14" height="11" rx="2" fill="%s"/>'
               '<path stroke="#F7EEDA" stroke-width="1.9" d="M18,-24 v5 M15.5,-21.5 h5"/>' % c,
    }
    return P.get(k, '')


def chara(hk, hc, cl, pk):
    INK = '#2A1C12'
    return ('<g class="ch" transform="translate(37,72) scale(.8)">'
            '<g stroke="%s" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">'
            '<rect class="lgA" x="-7.5" y="-15" width="6.5" height="15" rx="3" fill="%s"/>'
            '<rect class="lgB" x="1" y="-15" width="6.5" height="15" rx="3" fill="%s"/>'
            '<rect class="lgB" x="-14.5" y="-32" width="5.5" height="17" rx="2.7" fill="%s"/>'
            '<path fill="%s" d="M-10.5,-33 Q-12,-16 -8.5,-14 L8.5,-14 Q12,-16 10.5,-33 Z"/>'
            '<rect class="lgA" x="9" y="-32" width="5.5" height="17" rx="2.7" fill="%s"/>'
            '<g class="lgA">%s</g>'
            '<ellipse cx="0" cy="-42" rx="13" ry="12.2" fill="#F2C9A0"/>%s</g>'
            '<g stroke="none"><ellipse cx="-5" cy="-41.5" rx="2.1" ry="3" fill="%s"/>'
            '<ellipse cx="5" cy="-41.5" rx="2.1" ry="3" fill="%s"/>'
            '<circle cx="-4.3" cy="-42.6" r=".9" fill="#fff"/><circle cx="5.7" cy="-42.6" r=".9" fill="#fff"/></g>'
            '<path d="M-2.5,-35.5 Q0,-33 2.5,-35.5" fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>'
            '</g>' % (INK, cl, cl, cl, cl, cl, prop(pk, cl), hair(hk, hc), INK, INK, INK))


POS = [(30, 36), (190, 36), (350, 36),
       (30, 226), (190, 226), (350, 226),
       (596, 36), (596, 226)]   # 右2つは独立・別枠


def desk(w, d, h):
    o = ['<div class="f dk-t" style="width:%dpx;height:%dpx;transform:translateZ(%dpx)"></div>' % (w, d, h)]
    o.append('<div class="f dk-s" style="width:%dpx;height:%dpx;transform-origin:top;transform:rotateX(-90deg);top:%dpx"></div>' % (w, h, d))
    o.append('<div class="f dk-s" style="width:%dpx;height:%dpx;transform-origin:top;transform:translateZ(%dpx) rotateX(-90deg)"></div>' % (w, h, h))
    o.append('<div class="f dk-s" style="width:%dpx;height:%dpx;transform-origin:left top;transform:rotateY(90deg) rotateX(-90deg) translateY(-%dpx)"></div>' % (d, h, h))
    o.append('<div class="f dk-s" style="width:%dpx;height:%dpx;transform-origin:left top;transform:translateX(%dpx) rotateY(90deg) rotateX(-90deg) translateY(-%dpx)"></div>' % (d, h, w, h))
    return "".join(o)


CARDS = "".join(
 '<div class="post %s" data-i="%d" style="left:%dpx;top:%dpx">%s<div class="ring"></div>'
 '<div class="bill"><svg viewBox="0 0 74 80" class="fig">%s</svg>'
 '<div class="pn">%s</div><div class="ps">%s ／ %s</div>'
'<div><span class="pb">%s</span></div></div></div>'
 % (c['state'], i, POS[i][0], POS[i][1], desk(90, 60, 26),
    chara(*ROLECH[c['slug']]), c['role'], c['axis'], c['ship'], c['label'])
 for i, c in enumerate(crew))

HTML = r"""<title>乗組員の状況</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Reggae+One&family=Zen+Maru+Gothic:wght@400;500;700&family=DotGothic16&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root{--ground:#EFE2C6;--surface:#F7EEDA;--ink:#2A1C12;--ink-soft:#6B563F;--ink-faint:#9A876D;
 --rule:#D3BE96;--rule-strong:#A98F63;--accent:#B8451F;--band:#E5D3AE;
 --run:#3F6B45;--idle:#96660F;--never:#8C7A62;--stale:#A32117;--blocked:#A32117;
 --logbg:#241A12;--logink:#E8D5AC;--gold:#B5821F;--deck1:#9DBEC0;--deck2:#7E93A6;}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
 --ground:#101820;--surface:#18222B;--ink:#EFE0C4;--ink-soft:#B29B78;--ink-faint:#7E6C53;
 --rule:#2C3A46;--rule-strong:#485B69;--accent:#E8703F;--band:#1F2E38;
 --run:#7FB98A;--idle:#DFA945;--never:#6B7783;--stale:#E8705C;--blocked:#E8705C;
 --logbg:#0A1016;--logink:#CDE3EE;--gold:#E0B054;--deck1:#1E3A46;--deck2:#152833;}}
:root[data-theme="dark"]{--ground:#101820;--surface:#18222B;--ink:#EFE0C4;--ink-soft:#B29B78;
 --ink-faint:#7E6C53;--rule:#2C3A46;--rule-strong:#485B69;--accent:#E8703F;--band:#1F2E38;
 --run:#7FB98A;--idle:#DFA945;--never:#6B7783;--stale:#E8705C;--blocked:#E8705C;
 --logbg:#0A1016;--logink:#CDE3EE;--gold:#E0B054;--deck1:#1E3A46;--deck2:#152833;}

*{box-sizing:border-box}
body{background:var(--ground);color:var(--ink);margin:0;padding:0 18px 64px;
 font-family:"Zen Maru Gothic","Hiragino Maru Gothic ProN",system-ui,sans-serif;
 font-size:15px;line-height:1.8;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto}
header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;
 padding:36px 0 15px;border-bottom:4px double var(--ink)}
h1{font-family:"Reggae One",sans-serif;font-weight:400;font-size:clamp(25px,4.2vw,38px);margin:0;
 letter-spacing:.04em;line-height:1.2;text-shadow:2px 2px 0 var(--band)}
h1 .sm{display:block;font-size:.36em;letter-spacing:.3em;color:var(--accent);margin-bottom:5px;text-shadow:none}
.hm{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--ink-soft);text-align:right;line-height:1.95}
h2{font-family:"Reggae One",sans-serif;font-weight:400;font-size:19px;margin:34px 0 10px;
 letter-spacing:.05em;display:flex;align-items:baseline;gap:12px}
h2 .n{font-family:"DotGothic16",monospace;font-size:12px;color:var(--accent);border:2px solid var(--accent);padding:1px 7px}
.lede{color:var(--ink-soft);font-size:13px;margin:0 0 16px;max-width:70ch}

/* 持ち場（3D） */
.stagewrap{border:3px solid var(--ink);position:relative;overflow:hidden;
 background:radial-gradient(120% 90% at 50% 16%,var(--deck1) 0%,var(--deck2) 100%);
 box-shadow:6px 6px 0 var(--band)}
.stage{height:min(58vh,470px);perspective:1500px;perspective-origin:50% 38%;
 touch-action:none;cursor:grab;position:relative}
.stage.drag{cursor:grabbing}
.world{position:absolute;inset:0;transform-style:preserve-3d;
 transform:translateZ(-90px) rotateX(var(--rx,56deg)) rotateZ(var(--rz,-26deg));
 transition:transform .1s linear}
.floor{position:absolute;left:50%;top:50%;width:760px;height:420px;margin:-210px 0 0 -380px;
 transform-style:preserve-3d;border:2px solid rgba(255,255,255,.22);
 background:repeating-linear-gradient(0deg,rgba(255,255,255,.055) 0 1px,transparent 1px 42px),
            repeating-linear-gradient(90deg,rgba(255,255,255,.055) 0 1px,transparent 1px 42px)}
.divider{position:absolute;left:548px;top:10px;width:0;height:400px;
 border-left:2px dashed rgba(255,255,255,.42);transform:translateZ(1px)}
.post{position:absolute;transform-style:preserve-3d;cursor:pointer}
.f{position:absolute;backface-visibility:hidden;border:2px solid var(--ink)}
.dk-t{background:var(--band)} .dk-s{background:var(--rule-strong);border-top:none}
.post.never .dk-t{background:transparent;border-style:dashed}
.post.never .dk-s{background:rgba(140,122,98,.16);border-style:dashed;border-top:none}
.post.sel .f{border-color:var(--accent);border-width:3px}
.ring{position:absolute;width:118px;height:118px;left:-14px;top:-29px;border-radius:50%;
 border:3px solid #8FD79A;opacity:0;transform:translateZ(1px)}
.post.running .ring{animation:ping 1.9s ease-out infinite}
@keyframes ping{0%{opacity:.85;transform:translateZ(1px) scale(.55)}
 70%{opacity:0;transform:translateZ(1px) scale(1)}100%{opacity:0;transform:translateZ(1px) scale(1)}}
.bill{position:absolute;width:150px;left:-30px;top:-8px;text-align:center;pointer-events:none;
 transform:translateZ(84px) rotateZ(calc(-1 * var(--rz,-26deg))) rotateX(calc(-1 * var(--rx,56deg)))}
.fig{width:74px;height:80px;display:block;margin:0 auto;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}
.pn{font-weight:700;font-size:13.5px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8)}
.ps{font-family:"DotGothic16",monospace;font-size:10px;color:#DCCDAE;text-shadow:0 1px 3px rgba(0,0,0,.85)}
.pb{font-family:"DotGothic16",monospace;font-size:11.5px;margin-top:4px;padding:1px 8px;
 display:inline-block;border:2px solid currentColor;background:rgba(0,0,0,.45)}
.post.running .pb{color:#8FD79A} .post.idle .pb{color:#F2C572}
.post.never .pb{color:#BCB09D}
.post.stale .pb,.post.blocked .pb{color:#FF9E88}
.post.running .ch{animation:step 700ms ease-in-out infinite}
.post.running .lgA{animation:swA 700ms ease-in-out infinite;transform-origin:50% 0}
.post.running .lgB{animation:swB 700ms ease-in-out infinite;transform-origin:50% 0}
@keyframes step{0%,100%{transform:translate(37px,72px) scale(.8)}50%{transform:translate(37px,69px) scale(.8)}}
@keyframes swA{0%,100%{transform:rotate(19deg)}50%{transform:rotate(-19deg)}}
@keyframes swB{0%,100%{transform:rotate(-19deg)}50%{transform:rotate(19deg)}}
.post.never .ch{opacity:.42}
.post.stale .fig,.post.blocked .fig{animation:alarm 1.5s ease-in-out infinite}
@keyframes alarm{0%,100%{opacity:1}50%{opacity:.35}}
.ctrl{position:absolute;left:12px;bottom:12px;display:flex;gap:7px;align-items:center;
 background:rgba(0,0,0,.42);padding:7px 10px;border:2px solid var(--ink);flex-wrap:wrap}
.ctrl button{font-family:"DotGothic16",monospace;font-size:12px;background:var(--surface);
 color:var(--ink);border:2px solid var(--ink);padding:3px 9px;cursor:pointer}
.ctrl button:hover{background:var(--band)}
.ctrl button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.ctrl span{font-family:"DotGothic16",monospace;font-size:11px;color:#fff}
.legend{position:absolute;right:12px;top:12px;background:rgba(0,0,0,.42);border:2px solid var(--ink);
 padding:8px 11px;font-family:"DotGothic16",monospace;font-size:11px;color:#fff;line-height:1.95}
.legend i{display:inline-block;width:11px;height:11px;margin-right:6px;border:1.5px solid var(--ink);vertical-align:-1px}
@media (prefers-reduced-motion:reduce){
 .post .ch,.post .lgA,.post .lgB,.post .fig,.ring{animation:none}.world{transition:none}}

/* 詳細 */
#det{border:3px solid var(--ink);background:var(--surface);padding:17px 19px;
 box-shadow:5px 5px 0 var(--band);margin-top:14px}
#det h3{font-family:"Reggae One",sans-serif;font-weight:400;font-size:19px;margin:0 0 3px}
#det .sub{font-family:"DotGothic16",monospace;font-size:11px;color:var(--ink-faint);margin:0 0 13px}
#det .now{border-left:4px solid var(--accent);padding:2px 0 2px 13px;margin:0 0 14px}
#det .now b{display:block;font-size:15px}
#det .now span{font-size:12.5px;color:var(--ink-soft)}
.kv{display:grid;grid-template-columns:1fr auto;gap:0 14px;font-family:"IBM Plex Mono",monospace;
 font-size:12.5px;font-variant-numeric:tabular-nums}
.kv div{padding:6px 0;border-bottom:1px dotted var(--rule-strong)}
.kv .v{text-align:right;font-weight:600}
.kv .v.z{color:var(--ink-faint)}

/* ログ */
.logpanel{background:var(--logbg);border:3px solid var(--ink);padding:15px 17px;
 box-shadow:5px 5px 0 var(--band)}
.logpanel h3{font-family:"DotGothic16",monospace;font-size:12.5px;letter-spacing:.14em;
 color:var(--gold);margin:0 0 11px;font-weight:400}
.ll{font-family:"DotGothic16",monospace;font-size:12.5px;line-height:1.95;color:var(--logink);
 display:grid;grid-template-columns:78px 104px 62px 1fr;gap:10px;padding:3px 0;
 border-bottom:1px dotted rgba(232,213,172,.16)}
.ll:last-child{border-bottom:none}
.ll .t{color:var(--gold)} .ll .w{color:#8FB8CC}
.ll .s{font-weight:600}
.ll .s.done{color:#86C08A} .ll .s.running{color:#F0C868}
.ll .s.blocked,.ll .s.stale{color:#F08A72} .ll .s.system{color:#9AA6B2}
.empty{font-family:"DotGothic16",monospace;font-size:12.5px;color:#7E8B96;padding:8px 0}
@media(max-width:680px){.ll{grid-template-columns:64px 1fr;gap:6px}.ll .w,.ll .s{display:none}}

/* 指標表 */
.mtwrap{overflow-x:auto}
table.mt{min-width:420px;width:100%;border-collapse:collapse;font-size:13px}
table.mt th{font-family:"DotGothic16",monospace;font-size:10.5px;text-align:left;color:var(--ink-soft);
 padding:8px 10px 8px 0;border-bottom:2px solid var(--ink);font-weight:400;white-space:nowrap}
table.mt td{padding:11px 10px 11px 0;border-bottom:1px solid var(--rule);white-space:nowrap}
table.mt .b{font-weight:700}
.mk{font-family:"IBM Plex Mono",monospace;text-align:center;font-weight:600}
.mk.no{color:var(--stale)} .mk.ok{color:var(--run)}
.note{font-size:12.5px;color:var(--ink-soft);margin-top:13px;line-height:1.75}
footer{margin-top:42px;padding-top:18px;border-top:4px double var(--ink);
 font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--ink-faint);line-height:1.95}
</style>

<div class="wrap">
<header>
  <h1><span class="sm">CREW STATUS</span>乗組員の状況</h1>
  <div class="hm" id="hm"></div>
</header>

<h2><span class="n">01</span>いま誰が動いているか</h2>
<p class="lede">甲板を上から見ています。ドラッグで回せます。歩いている人格が稼働中、薄い人格はまだ一度も起動していません。点滅は、着手したまま24時間戻っていない印です。持ち場をクリックすると下に詳細が出ます。</p>
<div class="stagewrap">
  <div class="stage" id="stage"><div class="world" id="world"><div class="floor" id="floor"><div class="divider"></div>__CARDS__</div></div></div>
  <div class="legend">
    <div><i style="background:#8FD79A"></i>稼働中</div>
    <div><i style="background:#F2C572"></i>待機</div>
    <div><i style="border-style:dashed;background:transparent"></i>未起動</div>
    <div><i style="background:#FF9E88"></i>停滞・詰まり</div>
    <div style="margin-top:5px;border-top:1px dashed #999;padding-top:5px">点線の右＝独立・別枠</div>
  </div>
  <div class="ctrl"><button id="rl">&#8592;</button><button id="rr">&#8594;</button>
   <button id="tu">起こす</button><button id="td">寝かす</button>
   <button id="rs">正面</button><span id="ang"></span></div>
</div>
<div id="det"></div>

<h2><span class="n">02</span>稼働ログ</h2>
<p class="lede">人格が着手・完了・停止したときの記録です。新しい順。</p>
<div class="logpanel"><h3>&gt;&gt; CREW EVENT LOG</h3><div id="log"></div></div>

<h2><span class="n">03</span>指標の測定状況</h2>
<p class="lede">売上利益・顧客満足度・採用数。✕は成績ではなく<b>測る仕組みが無い</b>という意味です。</p>
<div class="mtwrap"><table class="mt"><thead><tr><th>事業</th><th class="mk">売上利益</th><th class="mk">顧客満足</th><th class="mk">採用</th></tr></thead>
<tbody id="mt"></tbody></table></div>
<p class="note" id="mtn"></p>

<footer id="ft"></footer>
</div>

<script>
const D = __DATA__;
const floor = document.getElementById('floor'), det = document.getElementById('det');

function show(i){
  const c = D.crew[i];
  document.querySelectorAll('.post').forEach(p => p.classList.toggle('sel', +p.dataset.i === i));
  const nothing = c.state === 'never';
  det.innerHTML =
    `<h3>${c.role}</h3><p class="sub">${c.axis} ／ ${c.ship}　/　agents/${c.slug}.md</p>
     <div class="now"><b>${nothing ? 'まだ一度も起動していません' : c.task}</b>
     <span>${nothing ? 'このダッシュボードに何か出すには、まず1回起こす必要があります。'
                      : (c.detail || '') + (c.lastAgo !== '—' ? '　（' + c.lastAgo + '）' : '')}</span></div>
     <div class="kv">
       <div>稼働回数</div><div class="v ${c.total ? '' : 'z'}">${c.total}</div>
       <div>出した指摘・成果物</div><div class="v ${c.found ? '' : 'z'}">${c.found}</div>
       <div>判定基準</div><div class="v ${c.rules ? '' : 'z'}">${c.rules}</div>
       <div>事業ごとの注意点</div><div class="v ${c.notes ? '' : 'z'}">${c.notes}</div>
       <div>指摘の履歴</div><div class="v ${c.hits ? '' : 'z'}">${c.hits}</div>
       <div>外した事例</div><div class="v ${c.miss ? '' : 'z'}">${c.miss}</div>
     </div>`;
}
floor.addEventListener('click', e => { const p = e.target.closest('.post'); if (p) show(+p.dataset.i); });

const world = document.getElementById('world'), stage = document.getElementById('stage');
let rx = 56, rz = -26, down = false, mx = 0, my = 0;
function apply(){
  rx = Math.min(80, Math.max(22, rx));
  world.style.setProperty('--rx', rx + 'deg');
  world.style.setProperty('--rz', rz + 'deg');
  document.getElementById('ang').textContent = 'X' + Math.round(rx) + '\u00b0 Z' + Math.round(rz) + '\u00b0';
}
stage.addEventListener('pointerdown', e => { down = true; mx = e.clientX; my = e.clientY;
  stage.classList.add('drag'); stage.setPointerCapture(e.pointerId); });
stage.addEventListener('pointermove', e => { if (!down) return;
  rz += (e.clientX - mx) * 0.38; rx -= (e.clientY - my) * 0.30;
  mx = e.clientX; my = e.clientY; apply(); });
stage.addEventListener('pointerup', () => { down = false; stage.classList.remove('drag'); });
stage.addEventListener('pointercancel', () => { down = false; stage.classList.remove('drag'); });
const BT = (id, fn) => document.getElementById(id).addEventListener('click', () => { fn(); apply(); });
BT('rl', () => rz -= 15); BT('rr', () => rz += 15);
BT('tu', () => rx -= 8);  BT('td', () => rx += 8);
BT('rs', () => { rx = 56; rz = -26; });
apply();
show(0);

const SL = {done:'完了', running:'着手', blocked:'詰まり', skipped:'見送り'};
const NM = {}; D.crew.forEach(c => NM[c.slug] = c.role); NM.system = 'システム';
document.getElementById('log').innerHTML = D.log.length ? D.log.map(r =>
  `<div class="ll"><span class="t">${r.ago}</span><span class="w">${NM[r.crew] || r.crew}</span>
   <span class="s ${r.crew === 'system' ? 'system' : r.status}">${r.crew === 'system' ? '設置' : (SL[r.status] || r.status)}</span>
   <span class="e">${r.task}${r.found ? ' <b>' + r.found + '件</b>' : ''}</span></div>`).join('')
  : '<div class="empty">記録なし</div>';

const run = D.crew.filter(c => c.state === 'running').length;
const never = D.crew.filter(c => c.state === 'never').length;
document.getElementById('hm').innerHTML =
  `基準 ${D.now.slice(0,16).replace('T',' ')}<br>稼働中 ${run} / 未起動 ${never} / 全 ${D.crew.length}人格`;

const mk = v => v === null ? '<span class="mk no">✕</span>' : '<span class="mk ok">' + v + '</span>';
const MB = D.metrics.businesses || [];
document.getElementById('mt').innerHTML = MB.map(b =>
  `<tr><td class="b">${b.name}</td><td class="mk">${mk(b.pl.score)}</td>
   <td class="mk">${mk(b.csat.score)}</td><td class="mk">${mk(b.hiring.score)}</td></tr>`).join('');
const f = k => MB.filter(b => b[k].score !== null).length;
document.getElementById('mtn').innerHTML =
  `24マス中 <b>${f('pl')+f('csat')+f('hiring')}</b> マスのみ測定できています。
   売上利益 ${f('pl')}/8・顧客満足度 ${f('csat')}/8・<b>採用数 ${f('hiring')}/8</b>。
   採用は進んでいますが必要人数が定義されていないため、達成度が出せません。`;

document.getElementById('ft').innerHTML =
  '稼働記録 — claude-hub/data/crew/runs.jsonl。人格は呼ばれたときだけ動きます（常駐していません）。<br>'
  + '着手時に running、完了時に done を書く規約です。書き方は data/crew/RUNLOG.md。<br>'
  + '更新 — <code>python scripts/build-dashboard.py</code>。乗組員は Claude の人格で、実在の担当者ではありません。';
</script>
"""

HTML = HTML.replace('__DATA__', DATA).replace('__CARDS__', CARDS)
io.open(OUT, 'w', encoding='utf-8').write(HTML)
print('wrote', OUT)
print('crew:', len(crew), ' runs:', len(runs),
      ' running:', sum(1 for c in crew if c['state'] == 'running'),
      ' never:', sum(1 for c in crew if c['state'] == 'never'))
