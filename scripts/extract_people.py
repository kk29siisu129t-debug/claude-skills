# -*- coding: utf-8 -*-
import io, re, json

BS = chr(92)
L = io.open('eval_raw.md', encoding='utf-8').read().split('\n')


def cells(ln):
    c = [x.strip() for x in ln.split('|')]
    if c and c[0] == '':
        c = c[1:]
    if c and c[-1] == '':
        c = c[:-1]
    out, prev = [], None
    for x in c:
        if x != prev:
            out.append(x)
            prev = x
    return out


def rawcells(ln):
    c = [x.strip() for x in ln.split('|')]
    if c and c[0] == '':
        c = c[1:]
    if c and c[-1] == '':
        c = c[:-1]
    return c


def clean(x):
    return x.replace(BS + '-', '-').replace(BS + '+', '+').replace(BS, '').strip()


# ---- 社員マスタ ----
master = {}
for l in L:
    c = cells(l)
    if len(c) >= 8 and re.match(r'^E' + r'\d{3}$', c[0]):
        master[c[1]] = dict(grade=c[2], role=c[3], team=c[4], boss=c[5],
                            status=c[6], joined=c[7])

# ---- ランキング（順位・判定・昇格基準） ----
rank = {}
for l in L:
    c = rawcells(l)
    if len(c) >= 9 and re.match(r'^' + r'\d{1,2}$', c[0]) and re.match(r'^G' + r'\d+$', c[2]):
        rank[c[1]] = dict(rank=int(c[0]), team=c[3], total=c[4], judge=c[5],
                          raters=c[6], bar=c[7], gapTxt=clean(c[8]))

# ---- 16項目スコア表 ----
CODES = ['1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4',
         '3-1', '3-2', '3-3', '3-4', '4-1', '4-2', '4-3', '4-4']
scores = {}
for l in L:
    c = rawcells(l)
    if len(c) >= 19 and re.match(r'^G' + r'\d+$', c[1]) and re.match(r'^' + r'\d\.\d\d$', c[2]):
        nm = c[0]
        vals = [float(x) for x in c[2:18]]
        scores[nm] = dict(zip(CODES, vals))
AVG = None
for l in L:
    c = rawcells(l)
    if c and c[0] == '全社平均' and len(c) >= 18 and re.match(r'^' + r'\d\.\d\d$', c[2]):
        AVG = dict(zip(CODES, [float(x) for x in c[2:18]]))

# ---- 客観力（自己評価との乖離） ----
obj = {}
for l in L:
    c = rawcells(l)
    if len(c) >= 8 and re.match(r'^G' + r'\d+$', c[1]) and c[5] in ('適正', '⚠過大評価', '⚠過小評価'):
        obj[c[0]] = dict(other=c[2], self=c[3], gap=clean(c[4]), verdict=c[5],
                         worst=c[6], worstGap=clean(c[7]))

# ---- 成長シート（④⑦の自由記述） ----
starts = []
for i, l in enumerate(L):
    m = re.search(r'\|\s*([^|]+?)　　(G' + r'\d+' + r')　\s*\|', l)
    if m:
        starts.append((i, m.group(1).strip(), m.group(2)))


def grab(sec, label):
    for l in sec:
        c = [x for x in cells(l) if x != '']
        if c and c[0] == label and len(c) > 1:
            return c[1]
    return ''


people = {}
for k, (i, nm, gr) in enumerate(starts):
    j = starts[k + 1][0] if k + 1 < len(starts) else len(L)
    sec = L[i:j]
    p = dict(name=nm, grade=gr)
    p['half'] = grab(sec, '半年後、どうなっていたいか')
    p['years'] = grab(sec, '何年後に、どんな役割か')
    p['support'] = grab(sec, '上司に支援してほしいこと')
    for l in sec:
        m = re.search(r'(G' + r'\d+' + r') → (G' + r'\d+' + r')　まで あと ([' + r'\d.' + r']+) 点', l)
        if m:
            p['next'] = m.group(2)
            p['gap'] = m.group(3)
            break
    st, gw, mode = [], [], None
    own = {}
    for l in sec:
        c = [x for x in cells(l) if x != '']
        if not c:
            continue
        if c[0].startswith('いま強みになっているところ'):
            mode = 's'
            continue
        if c[0].startswith('これから伸ばすところ'):
            mode = 'g'
            continue
        if c[0].startswith('⑤') or c[0].startswith('次に伸ばす強み'):
            mode = None
        if mode and re.match(r'^[123]位$', c[0]) and len(c) >= 3:
            item = c[1]
            val = c[2].replace('周囲の評価', '').strip()
            (st if mode == 's' else gw).append(dict(item=item, v=val))
            own['_last'] = (mode, item)
        if mode and c[0] == '本人の記入' and len(c) > 1 and own.get('_last'):
            md, it = own['_last']
            tgt = st if md == 's' else gw
            for e in tgt:
                if e['item'] == it and 'note' not in e:
                    e['note'] = c[1]
                    break
    p['strong'] = st
    p['grow'] = gw
    people[nm] = p

# ---- merge ----
out = []
for nm, p in people.items():
    m = master.get(nm, {})
    r = rank.get(nm, {})
    o = obj.get(nm, {})
    sc = scores.get(nm, {})
    deltas = sorted(((c, round(sc[c] - AVG[c], 2)) for c in sc), key=lambda x: x[1])
    out.append(dict(
        name=nm, grade=p['grade'], role=m.get('role', ''), team=m.get('team', ''),
        boss=m.get('boss', ''), joined=m.get('joined', ''), status=m.get('status', ''),
        rank=r.get('rank'), total=r.get('total'), judge=r.get('judge'),
        raters=r.get('raters'), bar=r.get('bar'), gapTxt=r.get('gapTxt'),
        nextGrade=p.get('next'), gap=p.get('gap'),
        self=o.get('self'), selfGap=o.get('gap'), objVerdict=o.get('verdict'),
        worst=o.get('worst'), worstGap=o.get('worstGap'),
        scores=sc, deltas=deltas,
        strong=p['strong'], grow=p['grow'],
        half=p['half'], years=p['years'], support=p['support']))
out.sort(key=lambda x: x['rank'] or 99)
io.open('people_raw.json', 'w', encoding='utf-8').write(
    json.dumps(dict(avg=AVG, people=out), ensure_ascii=False, indent=1))
print('people:', len(out))
print('missing rank:', [p['name'] for p in out if not p['rank']])
print('missing scores:', [p['name'] for p in out if not p['scores']])
print('missing obj:', [p['name'] for p in out if not p['self']])
print('no strong:', [p['name'] for p in out if not p['strong']])
print('no half:', [p['name'] for p in out if not p['half']])
