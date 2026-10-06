# -*- coding: utf-8 -*-
"""
claude-hub/scripts/build-marketing-lab.py

3事業マーケ施策レビューの試作品（架空データ専用 preview）を作る。
hub の private データ（issues / people / mytasks / カレンダー等）は読まない。
外部への接続もしない。

  python scripts/build-marketing-lab.py [出力パス] [--fixtures ディレクトリ] [--measurement ディレクトリ] [--events ディレクトリ]

時刻は build-office.py と同じ環境変数で固定できる。
  OFFICE_NOW=2026-10-04T09:00:00+09:00 OFFICE_TODAY=2026-10-04
"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import marketing_lab  # noqa: E402

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(argv):
    args = list(argv)
    fixtures = os.path.join(HUB, 'data', 'marketing-lab', 'fixtures')
    measure = os.path.join(HUB, 'data', 'marketing-lab', 'measurement')
    events = os.path.join(HUB, 'data', 'marketing-lab', 'events')
    if '--fixtures' in args:
        i = args.index('--fixtures')
        fixtures = args[i + 1]
        del args[i:i + 2]
    if '--measurement' in args:
        i = args.index('--measurement')
        measure = args[i + 1]
        del args[i:i + 2]
    if '--events' in args:
        i = args.index('--events')
        events = args[i + 1]
        del args[i:i + 2]
    out = args[0] if args else os.path.join(HUB, 'marketing-lab.html')
    now, today = marketing_lab.resolve_clock(os.environ.get('OFFICE_NOW'), os.environ.get('OFFICE_TODAY'))
    doc, results = marketing_lab.build(fixtures, now, today, measurement_dir=measure, events_dir=events)
    with io.open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(doc)
    print('wrote', out)
    if not results:
        print('  fixture が1件もありません: 検証停止')
        return 2
    stopped = 0
    for name, biz, ck in results:
        bid = (biz or {}).get('business_id') or name
        if ck.errors:
            stopped += 1
            print('  %s: 検証停止 %d件' % (bid, len(ck.errors)))
            for x in ck.errors:
                print('    [%s] %s (%s)' % (x['code'], x['msg'], x['where']))
        else:
            for c in biz['campaigns']:
                st, rs = marketing_lab.review_status(biz, c, today)
                print('  %s / %s: %s（理由 %d件）' % (bid, c['campaign_id'], st, len(rs)))
    mres = marketing_lab.ms.validate_all(marketing_lab.ms.load_dir(measure), now)
    if not mres:
        stopped += 1
        print('  計測の合成 fixture が1件もありません: 検証停止')
    for name, ds, ck in mres:
        if ck.errors:
            stopped += 1
            print('  計測 %s: 検証停止 %d件' % (name, len(ck.errors)))
            for x in ck.errors[:20]:
                print('    [%s] %s (%s)' % (x['code'], x['msg'], x['where']))
        else:
            print('  計測 %s: 観測 %d行・比 %d・比較 %d' % (
                ds['dataset_id'], len(ds['observations']), len(ds['ratios']), len(ds['comparisons'])))
    plans = {b['business_id']: b for n, b, ck in results if b is not None and not ck.errors}
    views = marketing_lab.pcf.build_view(events, now, plans)
    if not views:
        stopped += 1
        print('  PASSCAL 架空イベントが1件もありません: 検証停止')
    for name, v in views:
        if not v.ok:
            stopped += 1
            print('  PASSCAL %s: 検証停止 %d件' % (name, len(v.errors)))
            for x in v.errors[:20]:
                print('    [%s] %s (%s)' % (x['code'], x['msg'], x['where']))
        else:
            for c in v.cohorts():
                print('  PASSCAL %s %s: フォーム回答 %s ／ 面談到達 %s ／ 入塾到達 %s' % (
                    name, c['id'], v.value('O-APP-%s' % c['id']), v.value('O-INT-%s' % c['id']),
                    v.value('O-ENR-%s' % c['id'])))
    # 検証停止があっても画面は作る（止まった理由を見せるため）。終了コードで知らせる
    return 2 if stopped else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
