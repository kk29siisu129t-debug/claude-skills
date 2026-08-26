# -*- coding: utf-8 -*-
"""
claude-hub/scripts/build-dashboard.py

data/metrics.json（売上利益・顧客満足度・採用数）を読み、3D の経営ダッシュボードを書き出す。

  python scripts/build-dashboard.py [出力パス]

数字が入るたびに metrics.json を更新して再実行する。
実線の柱＝根拠のある数字。点線の柱＝指標そのものが無い。
"""
import io, os, sys, json

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M = json.load(io.open(os.path.join(HUB, 'data', 'metrics.json'), encoding='utf-8'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HUB, 'dashboard.html')

B = M['businesses']
AX = ['pl', 'csat', 'hiring']
have = {k: sum(1 for b in B if b[k]['score'] is not None) for k in AX}
DATA = json.dumps(M, ensure_ascii=False)

HTML = r"""<title>経営ダッシュボード</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Reggae+One&family=Zen+Maru+Gothic:wght@400;500;700&family=DotGothic16&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root{
  --ground:#EFE2C6;--surface:#F7EEDA;--ink:#2A1C12;--ink-soft:#6B563F;--ink-faint:#9A876D;
  --rule:#D3BE96;--rule-strong:#A98F63;--accent:#B8451F;--band:#E5D3AE;
  --sea:#9DBEC0;--sea2:#84A8AC;
  --ax1:#2E6E8E;--ax2:#3F6B45;--ax3:#B5821F;--miss:#A32117;}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --ground:#101820;--surface:#18222B;--ink:#EFE0C4;--ink-soft:#B29B78;--ink-faint:#7E6C53;
  --rule:#2C3A46;--rule-strong:#485B69;--accent:#E8703F;--band:#1F2E38;
  --sea:#1E3A46;--sea2:#162C36;
  --ax1:#5AA0BE;--ax2:#7FB98A;--ax3:#E0B054;--miss:#E8705C;}}
:root[data-theme="dark"]{
  --ground:#101820;--surface:#18222B;--ink:#EFE0C4;--ink-soft:#B29B78;--ink-faint:#7E6C53;
  --rule:#2C3A46;--rule-strong:#485B69;--accent:#E8703F;--band:#1F2E38;
  --sea:#1E3A46;--sea2:#162C36;
  --ax1:#5AA0BE;--ax2:#7FB98A;--ax3:#E0B054;--miss:#E8705C;}

*{box-sizing:border-box}
body{background:var(--ground);color:var(--ink);margin:0;padding:0 18px 64px;
  font-family:"Zen Maru Gothic","Hiragino Maru Gothic ProN",system-ui,sans-serif;
  font-size:15px;line-height:1.8;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto}
header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;
  gap:16px;padding:38px 0 16px;border-bottom:4px double var(--ink)}
h1{font-family:"Reggae One",sans-serif;font-weight:400;font-size:clamp(26px,4.4vw,40px);
  margin:0;letter-spacing:.04em;line-height:1.2;text-shadow:2px 2px 0 var(--band)}
h1 .sm{display:block;font-size:.36em;letter-spacing:.3em;color:var(--accent);
  margin-bottom:5px;text-shadow:none}
.cov{display:flex;gap:20px;font-family:"IBM Plex Mono",monospace;font-size:11px;
  color:var(--ink-soft);text-align:right;flex-wrap:wrap}
.cov b{display:block;font-size:23px;line-height:1.2;font-variant-numeric:tabular-nums;color:var(--ink)}
.cov b.bad{color:var(--miss)}

.stagewrap{margin-top:22px;border:3px solid var(--ink);position:relative;overflow:hidden;
  background:radial-gradient(120% 90% at 50% 18%,var(--sea) 0%,var(--sea2) 100%);
  box-shadow:6px 6px 0 var(--band)}
.stage{height:min(62vh,500px);perspective:1600px;perspective-origin:50% 40%;
  touch-action:none;cursor:grab;position:relative}
.stage.drag{cursor:grabbing}
.world{position:absolute;inset:0;transform-style:preserve-3d;
  transform:translateZ(-140px) rotateX(var(--rx,60deg)) rotateZ(var(--rz,-30deg));
  transition:transform .1s linear}
.plate{position:absolute;left:50%;top:50%;width:800px;height:470px;margin:-235px 0 0 -400px;
  transform-style:preserve-3d;border:2px solid rgba(255,255,255,.2);
  background:repeating-linear-gradient(0deg,rgba(255,255,255,.06) 0 1px,transparent 1px 47px),
             repeating-linear-gradient(90deg,rgba(255,255,255,.06) 0 1px,transparent 1px 50px)}
.plot{position:absolute;transform-style:preserve-3d;cursor:pointer}
.pad{position:absolute;width:150px;height:96px;border:2px solid rgba(255,255,255,.30);
  background:rgba(255,255,255,.07)}
.plot.sel .pad{border-color:var(--accent);background:rgba(184,69,31,.16)}
.pil{position:absolute;transform-style:preserve-3d}
.f{position:absolute;backface-visibility:hidden}
.tp{border:1.6px solid var(--ink)}
.sd{border:1.6px solid var(--ink);border-top:none}
.pil.na .tp{background:transparent!important;border:1.6px dashed var(--miss)}
.pil.na .sd{background:rgba(163,33,23,.07)!important;border:1.6px dashed var(--miss);border-top:none}
.cap{position:absolute;width:70px;left:-19px;text-align:center;pointer-events:none;
  font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:600;color:#fff;
  text-shadow:0 1px 2px rgba(0,0,0,.6)}
.cap.na{color:var(--miss);text-shadow:0 1px 2px rgba(0,0,0,.8)}
.nm{position:absolute;width:170px;left:-10px;top:100px;text-align:center;pointer-events:none;
  font-size:12.5px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7)}
.ctrl{position:absolute;left:12px;bottom:12px;display:flex;gap:7px;align-items:center;
  background:rgba(0,0,0,.36);padding:7px 10px;border:2px solid var(--ink);flex-wrap:wrap}
.ctrl button{font-family:"DotGothic16",monospace;font-size:12px;background:var(--surface);
  color:var(--ink);border:2px solid var(--ink);padding:3px 9px;cursor:pointer}
.ctrl button:hover{background:var(--band)}
.ctrl button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.ctrl span{font-family:"DotGothic16",monospace;font-size:11px;color:#fff}
.legend{position:absolute;right:12px;top:12px;background:rgba(0,0,0,.36);border:2px solid var(--ink);
  padding:8px 11px;font-family:"DotGothic16",monospace;font-size:11px;color:#fff;line-height:1.95}
.legend i{display:inline-block;width:11px;height:11px;margin-right:6px;
  border:1.5px solid var(--ink);vertical-align:-1px}

.cols{display:grid;grid-template-columns:1fr;gap:22px;margin-top:26px}
@media(min-width:920px){.cols{grid-template-columns:1fr 1fr}}
h2{font-family:"Reggae One",sans-serif;font-weight:400;font-size:19px;margin:0 0 12px;
  letter-spacing:.05em;display:flex;align-items:baseline;gap:12px}
h2 .n{font-family:"DotGothic16",monospace;font-size:12px;color:var(--accent);
  border:2px solid var(--accent);padding:1px 7px}
#detail{border:3px solid var(--ink);background:var(--surface);padding:18px 20px;
  box-shadow:5px 5px 0 var(--band)}
#detail h3{font-family:"Reggae One",sans-serif;font-weight:400;font-size:21px;margin:0 0 14px}
.ax{border-top:1px solid var(--rule);padding:13px 0}
.ax:first-of-type{border-top:2px solid var(--ink)}
.ax .hd{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.ax .an{font-weight:700;font-size:14px}
.ax .av{font-family:"IBM Plex Mono",monospace;font-size:19px;font-weight:600;
  font-variant-numeric:tabular-nums}
.ax .av.na{font-size:13px;color:var(--miss)}
.ax .raw{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--ink-soft);margin:5px 0 0}
.ax .gp{font-size:12.5px;color:var(--ink-soft);margin:7px 0 0;line-height:1.7;
  border-left:3px solid var(--miss);padding-left:11px}
.ax .src{font-family:"DotGothic16",monospace;font-size:10.5px;color:var(--ink-faint);margin-top:5px}
.cover{border:3px solid var(--ink);background:var(--surface);padding:18px 20px;
  box-shadow:5px 5px 0 var(--band)}
table.cv{width:100%;border-collapse:collapse;font-size:13px}
table.cv th{font-family:"DotGothic16",monospace;font-size:10.5px;text-align:left;color:var(--ink-soft);
  padding:8px 8px 8px 0;border-bottom:2px solid var(--ink);font-weight:400;white-space:nowrap}
table.cv td{padding:10px 8px 10px 0;border-bottom:1px solid var(--rule);white-space:nowrap}
table.cv .b{font-weight:700}
.mk{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;text-align:center}
.mk.no{color:var(--miss)}
.mk.ok{color:var(--ax2)}
.note{font-size:12.5px;color:var(--ink-soft);margin-top:14px;line-height:1.75}
footer{margin-top:44px;padding-top:18px;border-top:4px double var(--ink);
  font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--ink-faint);line-height:1.95}
@media (prefers-reduced-motion:reduce){.world{transition:none}}
</style>

<div class="wrap">
<header>
  <h1><span class="sm">FLEET STATUS</span>経営ダッシュボード</h1>
  <div class="cov">
    <div>売上・利益<b class="__C1__">__H1__/8</b>事業で測定可</div>
    <div>顧客満足度<b class="__C2__">__H2__/8</b>事業で測定可</div>
    <div>採用数<b class="__C3__">__H3__/8</b>事業で測定可</div>
  </div>
</header>

<div class="stagewrap">
  <div class="stage" id="stage"><div class="world" id="world"><div class="plate" id="plate"></div></div></div>
  <div class="legend">
    <div><i style="background:var(--ax1)"></i>売上・利益</div>
    <div><i style="background:var(--ax2)"></i>顧客満足度</div>
    <div><i style="background:var(--ax3)"></i>採用数</div>
    <div><i style="border-style:dashed;background:transparent"></i>指標が無い</div>
  </div>
  <div class="ctrl">
    <button id="rl">←</button><button id="rr">→</button>
    <button id="tu">起こす</button><button id="td">寝かす</button>
    <button id="rs">正面</button><span id="ang"></span>
  </div>
</div>

<div class="cols">
  <div><h2><span class="n">01</span>事業の詳細</h2><div id="detail"></div></div>
  <div><h2><span class="n">02</span>測定できているか</h2>
    <div class="cover">
      <table class="cv"><thead><tr><th>事業</th><th class="mk">売上利益</th>
      <th class="mk">顧客満足</th><th class="mk">採用</th></tr></thead>
      <tbody id="cvBody"></tbody></table>
      <p class="note" id="cvNote"></p>
    </div>
  </div>
</div>
<footer id="ft"></footer>
</div>

<script>
const M = __DATA__;
const AX = [['pl','売上・利益','--ax1'],['csat','顧客満足度','--ax2'],['hiring','採用数','--ax3']];
const plate = document.getElementById('plate');

function pillar(x, y, w, d, h, colorVar, na){
  const g=document.createElement('div'); g.className='pil'+(na?' na':'');
  g.style.cssText=`left:${x}px;top:${y}px`;
  const c=`var(${colorVar})`, cd=`color-mix(in srgb, var(${colorVar}) 68%, #000)`;
  const mk=(cl,s,bg)=>{const e=document.createElement('div');e.className='f '+cl;
    e.style.cssText=s+';background:'+bg;g.appendChild(e);};
  mk('tp',`width:${w}px;height:${d}px;transform:translateZ(${h}px)`,c);
  mk('sd',`width:${w}px;height:${h}px;transform-origin:top;transform:rotateX(-90deg);top:${d}px`,cd);
  mk('sd',`width:${w}px;height:${h}px;transform-origin:top;transform:translateZ(${h}px) rotateX(-90deg)`,cd);
  mk('sd',`width:${d}px;height:${h}px;transform-origin:left top;transform:rotateY(90deg) rotateX(-90deg) translateY(-${h}px)`,cd);
  mk('sd',`width:${d}px;height:${h}px;transform-origin:left top;transform:translateX(${w}px) rotateY(90deg) rotateX(-90deg) translateY(-${h}px)`,cd);
  return g;
}

M.businesses.forEach((b,i)=>{
  const px=30+(i%4)*195, py=40+Math.floor(i/4)*225;
  const p=document.createElement('div'); p.className='plot'; p.dataset.i=i;
  p.style.cssText=`left:${px}px;top:${py}px`;
  const pad=document.createElement('div'); pad.className='pad'; p.appendChild(pad);
  AX.forEach((a,k)=>{
    const s=b[a[0]].score, na=(s===null);
    const h=na?14:Math.max(6,s*1.5);
    const pil=pillar(16+k*44,26,32,32,h,a[2],na);
    p.appendChild(pil);
    const cap=document.createElement('div');
    cap.className='cap'+(na?' na':'');
    cap.style.cssText=`left:${16+k*44-19}px;top:${8}px;transform:translateZ(${h+4}px)`;
    cap.textContent=na?'?':s;
    p.appendChild(cap);
  });
  const nm=document.createElement('div'); nm.className='nm'; nm.textContent=b.name;
  nm.style.transform='translateZ(2px)'; p.appendChild(nm);
  plate.appendChild(p);
});

const det=document.getElementById('detail');
function show(i){
  const b=M.businesses[i];
  document.querySelectorAll('.plot').forEach(p=>p.classList.toggle('sel',+p.dataset.i===i));
  det.innerHTML='<h3>'+b.name+'</h3>'+AX.map(a=>{
    const m=b[a[0]], na=(m.score===null);
    return `<div class="ax"><div class="hd"><span class="an" style="color:var(${a[2]})">${a[1]}</span>
      <span class="av ${na?'na':''}">${na?'測定できていない':m.score}</span></div>
      <p class="raw">${m.raw}</p>
      <p class="gp">${m.gap}</p>
      <p class="src">出典 ${m.basis}</p></div>`;}).join('');
}
plate.addEventListener('click',e=>{const p=e.target.closest('.plot'); if(p) show(+p.dataset.i);});
show(1);

const mark=v=>v===null?'<span class="mk no">✕</span>':'<span class="mk ok">'+v+'</span>';
document.getElementById('cvBody').innerHTML=M.businesses.map(b=>
  `<tr><td class="b">${b.name}</td><td class="mk">${mark(b.pl.score)}</td>
   <td class="mk">${mark(b.csat.score)}</td><td class="mk">${mark(b.hiring.score)}</td></tr>`).join('');
const h1=M.businesses.filter(b=>b.pl.score!==null).length;
const h2=M.businesses.filter(b=>b.csat.score!==null).length;
const h3=M.businesses.filter(b=>b.hiring.score!==null).length;
document.getElementById('cvNote').innerHTML=
 `24マスのうち埋まっているのは <b>${h1+h2+h3}</b> マス。<br>
  <b>採用数はどの事業でも測定できていません。</b>採用の進行はあるものの、必要人数が一度も定義されていないためです。
  顧客満足度は${h2}事業のみで、うちPOTEXは返金率の裏返しという代理指標です。
  ✕は「成績が悪い」ではなく<b>「測る仕組みが無い」</b>を意味します。`;

const world=document.getElementById('world'), stage=document.getElementById('stage');
let rx=60, rz=-30, down=false, px2=0, py2=0;
function apply(){rx=Math.min(84,Math.max(20,rx));
  world.style.setProperty('--rx',rx+'deg'); world.style.setProperty('--rz',rz+'deg');
  document.getElementById('ang').textContent=`X${Math.round(rx)}° Z${Math.round(rz)}°`;}
stage.addEventListener('pointerdown',e=>{down=true;px2=e.clientX;py2=e.clientY;
  stage.classList.add('drag');stage.setPointerCapture(e.pointerId);});
stage.addEventListener('pointermove',e=>{if(!down)return;
  rz+=(e.clientX-px2)*.38; rx-=(e.clientY-py2)*.30; px2=e.clientX; py2=e.clientY; apply();});
stage.addEventListener('pointerup',()=>{down=false;stage.classList.remove('drag');});
stage.addEventListener('pointercancel',()=>{down=false;stage.classList.remove('drag');});
const BT=(id,fn)=>document.getElementById(id).addEventListener('click',()=>{fn();apply();});
BT('rl',()=>rz-=15); BT('rr',()=>rz+=15); BT('tu',()=>rx-=8); BT('td',()=>rx+=8);
BT('rs',()=>{rx=60;rz=-30;});
apply();

document.getElementById('ft').innerHTML =
 '基準日 '+M.asOf+' — 数字は claude-hub/data/metrics.json。会議記録で確認できた値のみを入れ、'
 +'根拠が無い軸は空欄（✕）にしています。推測でスコアを埋めていません。<br>'
 +'スコアは0〜100の達成度です。売上利益＝目標達成率、顧客満足度＝各事業の代表指標、採用数＝必要数に対する充足率。<br>'
 +'更新 — data/metrics.json に数字を足して <code>python scripts/build-dashboard.py</code>。';
</script>
"""

HTML = (HTML.replace('__DATA__', DATA)
            .replace('__H1__', str(have['pl'])).replace('__H2__', str(have['csat']))
            .replace('__H3__', str(have['hiring']))
            .replace('__C1__', 'bad' if have['pl'] < 5 else '')
            .replace('__C2__', 'bad' if have['csat'] < 5 else '')
            .replace('__C3__', 'bad' if have['hiring'] < 5 else ''))

io.open(OUT, 'w', encoding='utf-8').write(HTML)
print('wrote', OUT)
print('measurable  pl:%d/8  csat:%d/8  hiring:%d/8'
      % (have['pl'], have['csat'], have['hiring']))
