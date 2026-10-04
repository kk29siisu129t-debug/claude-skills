# -*- coding: utf-8 -*-
"""
claude-hub/scripts/build-marketing-lab.py

3事業マーケ施策レビューの試作品（架空データ専用 preview）を作る。
hub の private データ（issues / people / mytasks / カレンダー等）は読まない。
外部への接続もしない。

  python scripts/build-marketing-lab.py [出力パス] [--fixtures ディレクトリ]

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
    if '--fixtures' in args:
        i = args.index('--fixtures')
        fixtures = args[i + 1]
        del args[i:i + 2]
    out = args[0] if args else os.path.join(HUB, 'marketing-lab.html')
    now, today = marketing_lab.resolve_clock(os.environ.get('OFFICE_NOW'), os.environ.get('OFFICE_TODAY'))
    doc, results = marketing_lab.build(fixtures, now, today)
    with io.open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(doc)
    print('wrote', out)
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
    # 検証停止があっても画面は作る（止まった理由を見せるため）。終了コードで知らせる
    return 2 if stopped else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
