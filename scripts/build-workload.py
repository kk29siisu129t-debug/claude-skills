# -*- coding: utf-8 -*-
"""カレンダーの会議時間を事業ごとに集計して data/workload.json を作る。

入力  data/_cal_raw.json      … カレンダーから取った予定（t=件名 / m=分 / at=参加者）
      data/workload-map.json  … 予定名 → 事業 の対応表（人が直すファイル）
出力  data/workload.json      … 事業ごとの分数と割合。build-office.py が読む

対応表に無い予定名は「未分類」に入れる。**推測で事業に振らない。**
未分類は画面にそのまま出して、対応表を直せば減る形にする。

使い方:
    python scripts/build-workload.py
カレンダーの取り直しは MCP 経由でしかできないため、_cal_raw.json の作成は
呼び出し側（Claude）が行う。ここはその集計だけを担当する。
"""
import io, json, os, sys
from collections import defaultdict

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(HUB, 'data')

rows = json.load(io.open(os.path.join(D, '_cal_raw.json'), encoding='utf-8'))
M = json.load(io.open(os.path.join(D, 'workload-map.json'), encoding='utf-8'))
MAP, EXC = M.get('map', {}), set(M.get('exclude', []))

agg = defaultdict(float)
unknown = defaultdict(lambda: {'n': 0, 'min': 0.0})
excluded = 0.0
for r in rows:
    t, m = r['t'], float(r['m'])
    if t in EXC:
        excluded += m
        continue
    b = MAP.get(t)
    if b is None:
        u = unknown[t]
        u['n'] += 1
        u['min'] += m
        agg['未分類'] += m
    else:
        agg[b] += m

total = sum(agg.values())
biz = {}
for b, m in agg.items():
    # 分母は「全事業の会議時間の合計」。足すと100%になる（代表指定 2026-09-22）
    biz[b] = {'min': round(m), 'h': round(m / 60, 1),
              'pct': round(m / total * 100, 1) if total else 0.0}

out = {
    'note': ('カレンダーの会議時間を事業ごとに集計したもの。分母は全事業の会議時間の合計なので、'
             '足すと100%になる。会議だけが対象で、資料作成・移動・考えていた時間は入っていない。'),
    'window': M.get('window', ''),
    'asOf': M.get('asOf', ''),
    'totalMin': round(total),
    'totalH': round(total / 60, 1),
    'excludedMin': round(excluded),
    'excludedNote': M.get('excludeNote', ''),
    'biz': biz,
    'unknown': sorted(
        [{'t': t, 'n': v['n'], 'h': round(v['min'] / 60, 1)} for t, v in unknown.items()],
        key=lambda x: -x['h']),
}
p = os.path.join(D, 'workload.json')
io.open(p, 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1))

print('wrote', p)
print('合計 %.1fh（除外 %.1fh）' % (total / 60, excluded / 60))
for b, v in sorted(biz.items(), key=lambda x: -x[1]['min']):
    print('  %-10s %5.1fh  %4.1f%%' % (b, v['h'], v['pct']))
if out['unknown']:
    print('未分類 %d種類 %.1fh — data/workload-map.json に足すと消える'
          % (len(out['unknown']), sum(u['h'] for u in out['unknown'])))
