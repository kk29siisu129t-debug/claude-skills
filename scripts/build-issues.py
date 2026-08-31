# -*- coding: utf-8 -*-
"""
claude-hub/scripts/build-issues.py

会社ごとの経営課題を重要度順に並べた一覧を書き出す。

  python scripts/build-issues.py [出力パス]

重要度 = 軸の重み × 深刻度 × 緊急度
軸の重みは代表本人の優先順位（顧客満足度 > 採用数 > 売上利益）に従う。
"""
import io, os, sys, json, html

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = json.load(io.open(os.path.join(HUB, 'data', 'issues.json'), encoding='utf-8'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HUB, 'issues.html')

W = D['priority']['weight']
AXN = {'csat': '顧客満足度', 'hiring': '採用数', 'pl': '売上・利益'}
ORDER = ['POTEX', 'EXTAGE', 'Tクリニック', 'origin', 'passlabo',
         'エクソソーム', '失業保険', '補助金コンサル']

for it in D['issues']:
    it['score'] = round(W.get(it['axis'], 1.0) * it['sev'] * it['urg'], 3)

bybiz = {}
for it in D['issues']:
    bybiz.setdefault(it['biz'], []).append(it)
for b in bybiz:
    bybiz[b].sort(key=lambda x: -x['score'])

biz_sorted = sorted(bybiz.items(),
                    key=lambda kv: (-max(i['score'] for i in kv[1]),
                                    ORDER.index(kv[0]) if kv[0] in ORDER else 99))

allsorted = sorted(D['issues'], key=lambda x: -x['score'])
E = html.escape


def band(s):
    return 'hi' if s >= 2.0 else ('mid' if s >= 1.0 else 'lo')


rows = []
for i, it in enumerate(allsorted[:8], 1):
    rows.append(
        '<tr><td class="rk">%d</td><td class="bz">%s</td>'
        '<td><span class="ax %s">%s</span></td>'
        '<td class="ti">%s</td><td class="sc %s">%.2f</td></tr>'
        % (i, E(it['biz']), it['axis'], AXN[it['axis']], E(it['title']),
           band(it['score']), it['score']))
TOP = ''.join(rows)

blocks = []
for biz, items in biz_sorted:
    cards = []
    for it in items:
        dec = it.get('decide', '').strip()
        cards.append(
            '<div class="iss %s">'
            '<div class="hd"><span class="ax %s">%s</span>'
            '<span class="sc %s">重要度 %.2f</span></div>'
            '<h4>%s</h4>'
            '<p class="fact">%s</p>'
            '<p class="meta">出典 %s</p>'
            '<div class="kv"><span>原因</span><div>%s</div></div>'
            '<div class="kv"><span>打ち手</span><div>%s</div></div>'
            '<div class="kv"><span>任せる</span><div>%s</div></div>'
            '<div class="kv dec"><span>あなたが決める</span><div>%s</div></div>'
            '</div>'
            % (band(it['score']), it['axis'], AXN[it['axis']],
               band(it['score']), it['score'], E(it['title']), E(it['fact']),
               E(it['basis']), E(it.get('cause', '—')), E(it.get('move', '—')),
               E(it.get('owner', '—')),
               ('<b>' + E(dec) + '</b>') if dec and dec != 'なし' else '<i>なし</i>'))
    top = max(i['score'] for i in items)
    blocks.append('<section class="biz"><h3>%s<span class="n">%d件 ／ 最高 %.2f</span></h3>%s</section>'
                  % (E(biz), len(items), top, ''.join(cards)))
BLOCKS = ''.join(blocks)

DEC = [it for it in allsorted if it.get('decide') and it['decide'] != 'なし']
DECROWS = ''.join('<li><b>%s</b>　%s<span>%s ／ 重要度 %.2f</span></li>'
                  % (E(it['biz']), E(it['decide']), E(it['title']), it['score'])
                  for it in DEC)

HTML = """<title>経営課題 重要度順</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Reggae+One&family=Zen+Maru+Gothic:wght@400;500;700&family=DotGothic16&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root{--bg:#EFE2C6;--sf:#F7EEDA;--ink:#2A1C12;--soft:#6B563F;--faint:#9A876D;
 --rule:#D3BE96;--rs:#A98F63;--acc:#B8451F;--band:#E5D3AE;
 --hi:#A32117;--mid:#96660F;--lo:#3F6B45;--csat:#7A2E6B;--hiring:#96660F;--pl:#2C6076;}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
 --bg:#121A20;--sf:#1A242C;--ink:#EFE0C4;--soft:#B29B78;--faint:#7E6C53;
 --rule:#2E3D48;--rs:#4A5D6B;--acc:#E8703F;--band:#20303A;
 --hi:#E8705C;--mid:#DFA945;--lo:#7FB98A;--csat:#C98FBE;--hiring:#DFA945;--pl:#5AA0BE;}}
:root[data-theme="dark"]{--bg:#121A20;--sf:#1A242C;--ink:#EFE0C4;--soft:#B29B78;--faint:#7E6C53;
 --rule:#2E3D48;--rs:#4A5D6B;--acc:#E8703F;--band:#20303A;
 --hi:#E8705C;--mid:#DFA945;--lo:#7FB98A;--csat:#C98FBE;--hiring:#DFA945;--pl:#5AA0BE;}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);margin:0;padding:0 18px 72px;line-height:1.8;
 font-family:"Zen Maru Gothic","Hiragino Maru Gothic ProN",system-ui,sans-serif;font-size:15px}
.w{max-width:1000px;margin:0 auto}
header{padding:44px 0 16px;border-bottom:4px double var(--ink)}
h1{font-family:"Reggae One",sans-serif;font-weight:400;font-size:clamp(26px,4.6vw,40px);
 margin:0;letter-spacing:.04em;text-shadow:2px 2px 0 var(--band)}
h1 .sm{display:block;font-size:.35em;letter-spacing:.3em;color:var(--acc);margin-bottom:5px;text-shadow:none}
.prio{margin-top:14px;padding:13px 16px;background:var(--band);border-left:5px solid var(--acc)}
.prio b{font-size:16px}
.prio .src{font-family:"DotGothic16",monospace;font-size:10.5px;color:var(--soft);display:block;margin-top:4px}
h2{font-family:"Reggae One",sans-serif;font-weight:400;font-size:20px;margin:38px 0 8px;
 letter-spacing:.05em;display:flex;align-items:baseline;gap:12px}
h2 .n{font-family:"DotGothic16",monospace;font-size:12px;color:var(--acc);
 border:2px solid var(--acc);padding:1px 7px}
.lede{color:var(--soft);font-size:13px;margin:0 0 16px;max-width:68ch}
table{width:100%;border-collapse:collapse;font-size:14px}
th{font-family:"DotGothic16",monospace;font-size:10.5px;text-align:left;color:var(--soft);
 padding:9px 10px 9px 0;border-bottom:2px solid var(--ink);font-weight:400}
td{padding:11px 10px 11px 0;border-bottom:1px solid var(--rule);vertical-align:top}
.rk{font-family:"IBM Plex Mono",monospace;font-size:17px;color:var(--acc);width:34px}
.bz{font-weight:700;white-space:nowrap}
.ti{width:52%}
.sc{font-family:"IBM Plex Mono",monospace;text-align:right;font-weight:600;white-space:nowrap}
.sc.hi{color:var(--hi)} .sc.mid{color:var(--mid)} .sc.lo{color:var(--lo)}
.ax{font-family:"DotGothic16",monospace;font-size:10px;padding:1px 7px;border:1.5px solid;white-space:nowrap}
.ax.csat{color:var(--csat);border-color:var(--csat)}
.ax.hiring{color:var(--hiring);border-color:var(--hiring)}
.ax.pl{color:var(--pl);border-color:var(--pl)}
section.biz{margin-top:34px}
section.biz h3{font-family:"Reggae One",sans-serif;font-weight:400;font-size:20px;margin:0 0 10px;
 border-bottom:2px solid var(--ink);padding-bottom:7px;display:flex;justify-content:space-between;align-items:baseline}
section.biz h3 .n{font-family:"DotGothic16",monospace;font-size:11px;color:var(--faint)}
.iss{border:2px solid var(--rule);background:var(--sf);padding:15px 17px;margin-bottom:11px;
 box-shadow:4px 4px 0 var(--band)}
.iss.hi{border-color:var(--hi)} .iss.mid{border-color:var(--mid)}
.iss .hd{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
.iss h4{margin:7px 0 6px;font-size:16.5px;font-weight:700;line-height:1.55}
.fact{font-family:"IBM Plex Mono",monospace;font-size:12.5px;color:var(--soft);margin:0 0 3px;line-height:1.75}
.meta{font-family:"DotGothic16",monospace;font-size:10px;color:var(--faint);margin:0 0 11px}
.kv{display:grid;grid-template-columns:1fr;gap:2px;padding:7px 0;border-top:1px solid var(--rule);font-size:13.5px}
.kv>span{font-family:"DotGothic16",monospace;font-size:10px;color:var(--faint)}
.kv.dec{border-top:2px solid var(--acc)}
.kv.dec b{color:var(--acc)}
.kv.dec i{font-style:normal;color:var(--faint)}
@media(min-width:640px){.kv{grid-template-columns:96px 1fr;gap:14px;align-items:baseline}}
ul.dec{list-style:none;padding:0;margin:0;border-top:2px solid var(--ink)}
ul.dec li{padding:13px 0;border-bottom:1px solid var(--rule);font-size:14.5px}
ul.dec li b{color:var(--acc);margin-right:10px}
ul.dec li span{display:block;font-family:"DotGothic16",monospace;font-size:10.5px;color:var(--faint);margin-top:3px}
footer{margin-top:52px;padding-top:20px;border-top:4px double var(--ink);
 font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--faint);line-height:1.95}
</style>

<div class="w">
<header>
  <h1><span class="sm">PRIORITISED ISSUES</span>経営課題 重要度順</h1>
  <div class="prio">
    <b>優先順位 — 顧客満足度 ＞ 採用数 ＞ 売上・利益</b>
    <span class="src">__PSRC__</span>
  </div>
</header>

<h2><span class="n">01</span>全社トップ8</h2>
<p class="lede">8社を横断して重要度の高い順。重要度 ＝ 軸の重み × 深刻度 × 緊急度。</p>
<table><thead><tr><th></th><th>会社</th><th>軸</th><th>課題</th><th style="text-align:right">重要度</th></tr></thead>
<tbody>__TOP__</tbody></table>

<h2><span class="n">02</span>あなたが決めるもの</h2>
<p class="lede">他の人では決められないものだけ。重要度順。</p>
<ul class="dec">__DEC__</ul>

<h2><span class="n">03</span>会社ごと</h2>
<p class="lede">最高重要度の高い会社から並べています。各社の中も重要度順です。</p>
__BLOCKS__

<footer>
基準日 __AS__ ／ 課題 __N__件。元データは claude-hub/data/issues.json。<br>
重要度の式 — __F__<br>
深刻度 — __SEV__<br>
緊急度 — __URG__<br>
根拠のある課題だけを載せています。推測で作った行はありません。<br>
更新 — data/issues.json を編集して <code>python scripts/build-issues.py</code>。
</footer>
</div>"""

HTML = (HTML.replace('__PSRC__', E(D['priority']['statement'] + '　（出典: ' + D['priority']['source'] + '）'))
            .replace('__TOP__', TOP).replace('__DEC__', DECROWS).replace('__BLOCKS__', BLOCKS)
            .replace('__AS__', D['asOf']).replace('__N__', str(len(D['issues'])))
            .replace('__F__', E(D['scoring']['formula']))
            .replace('__SEV__', E(D['scoring']['severity']))
            .replace('__URG__', E(D['scoring']['urgency'])))

io.open(OUT, 'w', encoding='utf-8').write(HTML)
print('wrote', OUT)
print('issues:%d  companies:%d  decisions:%d' % (len(D['issues']), len(bybiz), len(DEC)))
print('top3: ' + ' / '.join('%s %s %.2f' % (i['biz'], i['title'][:16], i['score']) for i in allsorted[:3]))
