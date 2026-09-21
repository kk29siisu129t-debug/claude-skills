# -*- coding: utf-8 -*-
"""公開中のページに溜まった操作を、リポジトリ側に取り込む。

ページの中で代表がやること（残タスクのチェック、「自分のじゃない」の指定、代表の席への指示）は
公開ページの state に入るだけで、リポジトリには入らない。
そのまま作り直して公開すると、消したはずの残タスクが全部戻る（2026-09-21 指摘）。

使い方:
    Artifact ツールで公開中の版を読んで保存し、そのHTMLを渡す
    python scripts/sync-live.py <保存したHTML>
"""
import io, os, re, sys, json

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(rel, default):
    p = os.path.join(HUB, rel)
    return json.load(io.open(p, encoding='utf-8')) if os.path.exists(p) else default


def save(rel, obj):
    p = os.path.join(HUB, rel)
    io.open(p, 'w', encoding='utf-8').write(json.dumps(obj, ensure_ascii=False, indent=1) + '\n')


def main(path):
    html = io.open(path, encoding='utf-8', errors='replace').read()
    m = re.search(r'<script id="state" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        print('state が見つかりません:', path)
        return 1
    st = json.loads(m.group(1))

    done = load('data/mytasks-done.json', [])
    add_d = [k for k in (st.get('mtDone') or []) if k not in done]
    done += add_d

    notmine = load('data/mytasks-notmine.json', {})
    add_n = {k: v for k, v in (st.get('mtNot') or {}).items() if k not in notmine}
    notmine.update(add_n)

    qd = load('data/crew/queue-done.json', [])
    q = load('data/crew/queue.json', [])
    keys = {(x.get('at', '') + '|' + x.get('text', '')) for x in q}
    add_q = [x for x in (st.get('queue') or [])
             if (x.get('at', '') + '|' + x.get('text', '')) not in keys
             and (x.get('at', '') + '|' + x.get('text', '')) not in qd]
    q += add_q

    if add_d:
        save('data/mytasks-done.json', done)
    if add_n:
        save('data/mytasks-notmine.json', notmine)
    if add_q:
        save('data/crew/queue.json', q)
    print('取り込み  済みにした残タスク %d件 / 自分のじゃない %d件 / 未処理の指示 %d件'
          % (len(add_d), len(add_n), len(add_q)))
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
