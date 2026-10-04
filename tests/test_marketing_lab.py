# -*- coding: utf-8 -*-
"""
3事業マーケ施策レビュー試作品のテスト（標準ライブラリの unittest だけで動く）。

  python -m unittest discover -s tests -v

外部接続・private hub データの読み込みは一切しない。fixture は data/marketing-lab/fixtures の架空値のみ。
"""
import copy
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import marketing_lab as ml  # noqa: E402

FIX = os.path.join(ROOT, 'data', 'marketing-lab', 'fixtures')
NOW_S, TODAY_S = '2026-10-04T09:00:00+09:00', '2026-10-04'
NOW, TODAY = ml.resolve_clock(NOW_S, TODAY_S)


def read(path):
    with io.open(path, encoding='utf-8') as f:
        return f.read()


def write_all(d, bm):
    for n, b in bm.items():
        with io.open(os.path.join(d, n), 'w', encoding='utf-8') as f:
            json.dump(b, f, ensure_ascii=False)


def base():
    return {n: b for n, b in ml.load_dir(FIX)}


def run(bizmap):
    """dict のまま検証する。{ファイル名: dict}"""
    return {n: (b, ck) for n, b, ck in ml.validate_all(sorted(bizmap.items()), NOW)}


def codes(res, name):
    return [x['code'] for x in res[name][1].errors]


def camp(bm, name):
    return bm[name]['campaigns'][0]


def status(bm, name):
    b = bm[name]
    res = run(bm)
    assert not res[name][1].errors, res[name][1].errors
    return ml.review_status(b, b['campaigns'][0], TODAY)


class Normal(unittest.TestCase):
    def test_three_businesses_validate(self):
        res = run(base())
        self.assertEqual(sorted(res), ['passlabo.json', 'potex.json', 't-clinic.json'])
        for n, (b, ck) in res.items():
            self.assertEqual(ck.errors, [], n)
            self.assertIs(b['demo'], True)
            self.assertEqual(len(b['campaigns']), 1)

    def test_stages_per_business(self):
        bm = base()
        st = {n: [s['label'] for s in b['metric_definitions'][0]['stages']] for n, b in bm.items()}
        self.assertEqual(st['passlabo.json'], ['LINE登録', '相談/面談', '入塾'])
        self.assertEqual(st['potex.json'], ['登録', '体験', '契約', '着金'])
        self.assertEqual(st['t-clinic.json'], ['予約', '来院', '契約'])
        for b in bm.values():
            self.assertIn('本番未確定', b['metric_definitions'][0]['status'])

    def test_nine_creatives(self):
        for b in base().values():
            items = b['campaigns'][0]['creatives']['items']
            self.assertEqual(len(items), 9)
            self.assertEqual(len({(i['appeal'], i['tone']) for i in items}), 9)
            for i in items:
                self.assertIn('デモ', i['copy'])
                self.assertIn('asset', i)

    def test_initial_qa_unverified(self):
        for b in base().values():
            for i in b['campaigns'][0]['qa']['items']:
                self.assertEqual(i['status'], '未検証')
                self.assertIsNone(i['evidence'])
                self.assertIsNone(i['checked_at'])

    def test_fixture_reviews_are_incomplete(self):
        bm = base()
        for n in bm:
            st, rs = status(bm, n)
            self.assertEqual(st, 'レビュー未完了', n)
            self.assertTrue(any('QAが未実施' in r for r in rs))

    def test_fixtures_have_no_pii_like_values(self):
        import re
        blob = ''.join(read(os.path.join(FIX, f)) for f in sorted(os.listdir(FIX)))
        self.assertIsNone(re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', blob), 'メールアドレス風の値')
        self.assertIsNone(re.search(r'0\d{1,4}-\d{1,4}-\d{3,4}', blob), '電話番号風の値')
        for url in re.findall(r'https?://[^"\s]+', blob):
            self.assertTrue(ml._is_demo_url(url), url)

    def test_unknown_request_fields_show_mikakunin(self):
        doc, _ = ml.build(FIX, NOW, TODAY)
        self.assertIn('<span class="unk">未確認</span>', doc)  # Tクリの仮説・予算上限は未確認
        self.assertIn('支出の許可にはなりません', doc)


class Ids(unittest.TestCase):
    def test_unknown_creative_ref(self):
        bm = base()
        camp(bm, 'potex.json')['selected_creative'] = {'id': 'PX-CR-99', 'version': 'v1'}
        self.assertIn('UNKNOWN_REF', codes(run(bm), 'potex.json'))

    def test_duplicate_creative_id(self):
        bm = base()
        items = camp(bm, 'passlabo.json')['creatives']['items']
        items[1]['id'] = items[0]['id']
        self.assertIn('DUP_ID', codes(run(bm), 'passlabo.json'))

    def test_duplicate_campaign_and_business_id(self):
        bm = base()
        bm['passlabo.json']['campaigns'].append(copy.deepcopy(camp(bm, 'passlabo.json')))
        self.assertIn('DUP_ID', codes(run(bm), 'passlabo.json'))
        bm = base()
        bm['z-dup.json'] = copy.deepcopy(bm['potex.json'])
        self.assertIn('DUP_ID', codes(run(bm), 'z-dup.json'))

    def test_cross_business_creative_ref(self):
        bm = base()
        camp(bm, 't-clinic.json')['lp_change']['creative_ref'] = {'id': 'PL-CR-21', 'version': 'v1'}
        res = run(bm)
        self.assertIn('CROSS_BIZ', codes(res, 't-clinic.json'))
        self.assertEqual(res['passlabo.json'][1].errors, [])  # 他事業は巻き込まない

    def test_cross_business_flow_and_metric(self):
        bm = base()
        camp(bm, 'potex.json')['flow_ref'] = {'id': 'FL-TC-01', 'version': 'v1'}
        camp(bm, 'potex.json')['results']['periods'][0]['metric_def'] = {'id': 'MD-PL', 'version': 'v0-demo'}
        self.assertEqual(codes(run(bm), 'potex.json').count('CROSS_BIZ'), 2)

    def test_approval_for_other_business(self):
        bm = base()
        camp(bm, 'passlabo.json')['approvals']['records'][0]['target']['business_id'] = 'potex'
        self.assertIn('CROSS_BIZ', codes(run(bm), 'passlabo.json'))

    def test_stopped_business_renders_stop_not_review(self):
        bm = base()
        camp(bm, 'potex.json')['selected_creative'] = {'id': 'PX-CR-99', 'version': 'v1'}
        with tempfile.TemporaryDirectory() as d:
            write_all(d, bm)
            doc, res = ml.build(d, NOW, TODAY)
        sec = doc.split('id="biz-potex"')[1].split('</section>')[0]
        self.assertIn('検証停止', sec)
        self.assertNotIn('CR比較', sec)
        self.assertIn('id="biz-passlabo"', doc)


class Values(unittest.TestCase):
    def period(self, bm, name='passlabo.json', i=0):
        return camp(bm, name)['results']['periods'][i]

    def test_negative_count_and_spend(self):
        bm = base()
        self.period(bm)['counts']['clicks'] = -1
        self.period(bm)['spend_yen'] = -5
        self.assertEqual(codes(run(bm), 'passlabo.json').count('NEGATIVE'), 2)

    def test_non_integer_and_bool(self):
        for v in ('12', 1.5, True):
            bm = base()
            self.period(bm)['counts']['register'] = v
            self.assertIn('BAD_VALUE', codes(run(bm), 'passlabo.json'), v)

    def test_nan_infinity_rejected_on_load(self):
        with tempfile.TemporaryDirectory() as d:
            txt = read(os.path.join(FIX, 'potex.json'))
            txt = txt.replace('"spend_yen": 240000', '"spend_yen": NaN', 1)
            self.assertIn('NaN', txt)
            with io.open(os.path.join(d, 'potex.json'), 'w', encoding='utf-8') as f:
                f.write(txt)
            res = ml.validate_all(ml.load_dir(d), NOW)
            self.assertEqual(res[0][2].errors[0]['code'], 'SCHEMA')

    def test_missing_count_key_is_error_but_null_is_ok(self):
        bm = base()
        del self.period(bm)['counts']['enroll']
        self.assertIn('MISSING', codes(run(bm), 'passlabo.json'))

    def test_non_demo_url_rejected(self):
        bm = base()
        camp(bm, 'passlabo.json')['lp_change']['url'] = 'https://www.example-real-site.jp/lp'
        self.assertIn('BAD_VALUE', codes(run(bm), 'passlabo.json'))

    def test_incomplete_nine(self):
        bm = base()
        camp(bm, 'passlabo.json')['creatives']['items'].pop()
        self.assertIn('BAD_VALUE', codes(run(bm), 'passlabo.json'))


class Dates(unittest.TestCase):
    def p(self, bm):
        return camp(bm, 'potex.json')['results']['periods'][0]

    def test_period_start_after_end(self):
        bm = base()
        self.p(bm)['start'] = '2026-09-20'
        self.assertIn('DATE_ORDER', codes(run(bm), 'potex.json'))

    def test_request_period_reversed(self):
        bm = base()
        camp(bm, 'potex.json')['request']['period'] = {'start': '2026-10-01', 'end': '2026-09-01'}
        self.assertIn('DATE_ORDER', codes(run(bm), 'potex.json'))

    def test_occurred_outside_period(self):
        bm = base()
        self.p(bm)['occurred']['to'] = '2026-09-20'
        self.assertIn('DATE_ORDER', codes(run(bm), 'potex.json'))

    def test_source_updated_after_fetch(self):
        bm = base()
        self.p(bm)['source_updated_at'] = '2026-09-29T10:00:00+09:00'
        self.assertIn('DATE_ORDER', codes(run(bm), 'potex.json'))

    def test_fetched_in_future_or_before_period_end(self):
        bm = base()
        self.p(bm)['fetched_at'] = '2026-10-05T09:00:00+09:00'
        self.assertIn('DATE_ORDER', codes(run(bm), 'potex.json'))
        bm = base()
        self.p(bm)['source_updated_at'] = '2026-09-10T07:00:00+09:00'
        self.p(bm)['fetched_at'] = '2026-09-10T09:00:00+09:00'
        self.assertIn('DATE_ORDER', codes(run(bm), 'potex.json'))

    def test_bad_date_and_naive_datetime(self):
        bm = base()
        self.p(bm)['end'] = '2026-02-30'
        self.p(bm)['fetched_at'] = '2026-09-29T09:00:00'
        self.assertEqual(codes(run(bm), 'potex.json').count('BAD_DATE'), 2)

    def test_approval_in_future(self):
        bm = base()
        camp(bm, 'passlabo.json')['approvals']['records'][0]['at'] = '2026-10-10T09:00:00+09:00'
        self.assertIn('DATE_ORDER', codes(run(bm), 'passlabo.json'))


class Review(unittest.TestCase):
    def ok_all(self, bm, name):
        """QA合格（証跡あり）・両者OK にして、条件充足の基準状態を作る"""
        c = camp(bm, name)
        for i in c['qa']['items']:
            i.update(status='合格', evidence='テスト用の架空証跡', checked_at='2026-10-01T10:00:00+09:00', checker='QA役')
        sel = c['selected_creative']
        lp = {'id': c['lp_change']['lp_id'], 'version': c['lp_change']['proposed_version']}
        c['approvals']['records'] = [
            {'id': 'T-%s' % r['role'], 'role': r['role'], 'status': 'OK',
             'target': {'business_id': bm[name]['business_id'], 'campaign_id': c['campaign_id'],
                        'creative': dict(sel), 'lp': dict(lp)},
             'at': '2026-10-02T10:00:00+09:00', 'scope': 'CR・LP', 'evidence': 'テスト用'}
            for r in c['approvals']['required']]
        return c

    def test_all_conditions_met(self):
        bm = base()
        self.ok_all(bm, 'passlabo.json')
        st, rs = status(bm, 'passlabo.json')
        self.assertEqual((st, rs), ('条件充足（デモ）', []))

    def test_agency_ok_client_ng(self):
        bm = base()
        c = self.ok_all(bm, 'passlabo.json')
        c['approvals']['records'][1]['status'] = 'NG'
        st, rs = status(bm, 'passlabo.json')
        self.assertEqual(st, 'レビュー未完了')
        self.assertEqual(rs, ['クライアントがNGです'])

    def test_newer_record_wins_regardless_of_timezone_text(self):
        bm = base()
        c = self.ok_all(bm, 'passlabo.json')
        ng = copy.deepcopy(c['approvals']['records'][1])
        ng.update(id='T-client-ng', status='NG', at='2026-10-02T02:00:00+00:00')  # = 11:00 JST、OKより後
        c['approvals']['records'].append(ng)
        st, rs = status(bm, 'passlabo.json')
        self.assertIn('クライアントがNGです', rs)

    def test_approval_on_old_creative_after_revision(self):
        bm = base()
        c = self.ok_all(bm, 'passlabo.json')
        cr = next(i for i in c['creatives']['items'] if i['id'] == c['selected_creative']['id'])
        cr['version'] = 'v2'
        c['selected_creative']['version'] = 'v2'
        c['lp_change']['creative_ref']['version'] = 'v2'
        c['qa']['target']['creative']['version'] = 'v2'
        st, rs = status(bm, 'passlabo.json')
        self.assertEqual(st, 'レビュー未完了')
        self.assertEqual(sum('古いCR版' in r for r in rs), 2)

    def test_approval_on_old_lp_after_revision(self):
        bm = base()
        c = self.ok_all(bm, 'passlabo.json')
        c['lp_change']['proposed_version'] = 'v5'
        c['qa']['target']['lp']['version'] = 'v5'
        st, rs = status(bm, 'passlabo.json')
        self.assertEqual(sum('古いLP版' in r for r in rs), 2)

    def test_qa_target_stale(self):
        bm = base()
        c = self.ok_all(bm, 'passlabo.json')
        c['qa']['target']['flow']['version'] = 'v0'
        _, rs = status(bm, 'passlabo.json')
        self.assertTrue(any('QAの対象版' in r and '導線' in r for r in rs))

    def test_ok_without_evidence(self):
        bm = base()
        c = self.ok_all(bm, 'passlabo.json')
        c['approvals']['records'][0]['evidence'] = None
        _, rs = status(bm, 'passlabo.json')
        self.assertTrue(any('証跡' in r for r in rs))

    def test_qa_failed(self):
        bm = base()
        c = self.ok_all(bm, 'passlabo.json')
        c['qa']['items'][3]['status'] = '失敗'
        _, rs = status(bm, 'passlabo.json')
        self.assertIn('QAに失敗した項目があります（1件）', rs)

    def test_qa_not_run(self):
        bm = base()
        c = self.ok_all(bm, 'passlabo.json')
        c['qa']['items'][0].update(status='未検証', evidence=None, checked_at=None)
        _, rs = status(bm, 'passlabo.json')
        self.assertIn('QAが未実施です（未検証 1 / 6件）', rs)

    def test_qa_pass_without_evidence(self):
        bm = base()
        c = self.ok_all(bm, 'passlabo.json')
        c['qa']['items'][2]['evidence'] = None
        _, rs = status(bm, 'passlabo.json')
        self.assertTrue(any('QAの証跡が不足' in r for r in rs))

    def test_qa_missing_item_or_bad_status_stops(self):
        bm = base()
        camp(bm, 'passlabo.json')['qa']['items'].pop()
        self.assertIn('MISSING', codes(run(bm), 'passlabo.json'))
        bm = base()
        camp(bm, 'passlabo.json')['qa']['items'][0]['status'] = 'OK'
        self.assertIn('BAD_VALUE', codes(run(bm), 'passlabo.json'))

    def test_asset_expired(self):
        bm = base()
        c = self.ok_all(bm, 'passlabo.json')
        cr = next(i for i in c['creatives']['items'] if i['id'] == c['selected_creative']['id'])
        cr['asset']['expires'] = '2026-10-03'
        _, rs = status(bm, 'passlabo.json')
        self.assertTrue(any('使用期限が切れています' in r for r in rs))
        cr['asset']['expires'] = '2026-10-04'  # 当日までは有効
        self.assertEqual(status(bm, 'passlabo.json')[0], '条件充足（デモ）')

    def test_asset_rights_unchecked(self):
        bm = base()
        c = self.ok_all(bm, 'passlabo.json')
        next(i for i in c['creatives']['items'] if i['id'] == c['selected_creative']['id'])['asset']['rights_checked'] = False
        _, rs = status(bm, 'passlabo.json')
        self.assertTrue(any('権利確認' in r for r in rs))


class Metrics(unittest.TestCase):
    def m(self, counts, spend=100000, name='t-clinic.json'):
        bm = base()
        p = copy.deepcopy(camp(bm, name)['results']['periods'][0])
        p['counts'].update(counts)
        p['spend_yen'] = spend
        return {r['name']: r for r in ml.metrics(bm[name], p)}

    def test_normal(self):
        r = self.m({'impressions': 1000, 'clicks': 30, 'reserve': 3})
        self.assertEqual(r['CTR']['text'], '3.00%')
        self.assertEqual(r['CVR']['text'], '10.00%')
        self.assertEqual(r['CPA']['text'], '¥33,333')
        self.assertEqual(r['CTR']['formula'], 'クリック ÷ 表示')
        self.assertEqual((r['CTR']['num'], r['CTR']['den']), (30, 1000))

    def test_zero_denominator(self):
        r = self.m({'impressions': 0, 'clicks': 0, 'reserve': 0})
        for k in ('CTR', 'CVR', 'CPA'):
            self.assertEqual(r[k]['text'], '判定不可')
            self.assertEqual(r[k]['why'], '分母がゼロ')

    def test_missing_vs_zero(self):
        r = self.m({'impressions': 1000, 'clicks': 40, 'reserve': None}, spend=None)
        self.assertEqual(r['CVR']['why'], '分子が未取得')
        self.assertEqual(r['CPA']['why'], '費用が未取得')
        r = self.m({'impressions': 1000, 'clicks': 40, 'reserve': 0})
        self.assertEqual(r['CVR']['text'], '0.00%')  # 0件は0%として正しく出す
        self.assertEqual(r['CPA']['text'], '判定不可')

    def test_missing_denominator(self):
        r = self.m({'impressions': None, 'clicks': 40})
        self.assertEqual((r['CTR']['text'], r['CTR']['why']), ('判定不可', '分母が未取得'))

    def test_no_inf_nan_in_html(self):
        bm = base()
        p = camp(bm, 'potex.json')['results']['periods'][0]
        p['counts'].update(impressions=0, clicks=0, register=0, trial=0, contract=0, paid=None)
        with tempfile.TemporaryDirectory() as d:
            write_all(d, bm)
            doc, _ = ml.build(d, NOW, TODAY)
        for bad in ('Infinity', 'NaN', 'inf%', 'None'):
            self.assertNotIn(bad, doc)

    def test_quality_flags(self):
        bm = base()
        p = copy.deepcopy(camp(bm, 't-clinic.json')['results']['periods'][0])
        p['counts'].update(reserve=5, visit=9, contract=None)
        fl = ml.quality_flags(bm['t-clinic.json'], p)
        self.assertTrue(any('来院（9）が手前の予約（5）より多い' in x for x in fl))
        self.assertTrue(any('契約 が未取得（ゼロではありません）' in x for x in fl))


class Compare(unittest.TestCase):
    def test_different_population_blocked(self):
        bm = base()
        r = ml.compare(bm['potex.json'], camp(bm, 'potex.json')['results'], {'a': 'PX-P1', 'b': 'PX-P2'})
        self.assertTrue(r['blocked'])
        self.assertEqual(r['rows'], [])

    def test_different_definition_version_blocked(self):
        bm = base()
        res = camp(bm, 'passlabo.json')['results']
        res['periods'][1]['metric_def'] = {'id': 'MD-PL', 'version': 'v0-demo-2'}
        r = ml.compare(bm['passlabo.json'], res, {'a': 'PL-P1', 'b': 'PL-P2'})
        self.assertTrue(any('定義の版' in x for x in r['blocked']))

    def test_different_length_notes_and_no_causal_claim(self):
        bm = base()
        r = ml.compare(bm['t-clinic.json'], camp(bm, 't-clinic.json')['results'], {'a': 'TC-P1', 'b': 'TC-P2'})
        self.assertEqual(r['blocked'], [])
        self.assertTrue(any('期間の長さが違います' in x for x in r['notes']))
        self.assertTrue(any('因果' not in x or '検証していません' in x for x in r['notes']))
        ctr = next(x for x in r['rows'] if x['name'] == 'CTR')
        self.assertEqual(ctr['diff'], '判定不可')

    def test_unknown_period_in_comparison(self):
        bm = base()
        camp(bm, 'passlabo.json')['results']['comparisons'] = [{'a': 'PL-P1', 'b': 'PL-P9'}]
        self.assertIn('UNKNOWN_REF', codes(run(bm), 'passlabo.json'))


class Render(unittest.TestCase):
    def test_escape(self):
        bm = base()
        evil = '<script>alert("x")</script>&\'"'
        c = camp(bm, 'passlabo.json')
        c['title'] = evil
        c['creatives']['items'][0]['copy'] = evil
        c['results']['next_hypotheses'] = [evil]
        bm['passlabo.json']['business_name'] = evil
        with tempfile.TemporaryDirectory() as d:
            write_all(d, bm)
            doc, _ = ml.build(d, NOW, TODAY)
        self.assertNotIn('<script>alert', doc)
        self.assertIn('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#x27;&quot;', doc)
        self.assertEqual(doc.count('<script>'), 1)  # タブ切替の1本だけ

    def test_demo_banner_and_no_action_buttons(self):
        doc, _ = ml.build(FIX, NOW, TODAY)
        self.assertIn('試作品・架空データです', doc)
        for biz in ('passlabo', 'potex', 't-clinic'):
            self.assertIn('id="biz-%s"' % biz, doc)
        low = doc.lower()
        for bad in ('<button', '<form', '<input', 'fetch(', 'xmlhttprequest', 'websocket', 'publish', 'navigator.sendbeacon'):
            self.assertNotIn(bad, low)
        import re
        for href in re.findall(r'href="([^"]+)"', doc):
            self.assertTrue(href.startswith('#'), href)  # 外部へのリンクは置かない（URLは文字として表示）
        self.assertNotIn('src="http', doc)

    def test_every_step_present_for_each_business(self):
        doc, _ = ml.build(FIX, NOW, TODAY)
        for biz in ('passlabo', 'potex', 't-clinic'):
            sec = doc.split('id="biz-%s"' % biz)[1].split('</section>')[0]
            for step in ('依頼', 'CR比較', 'LP変更票', '計測QA', '承認レビュー', '実験結果・次の仮説', '本番に進む前に足りないもの'):
                self.assertIn(step, sec, (biz, step))


class Build(unittest.TestCase):
    def build_once(self, out):
        env = dict(os.environ, OFFICE_NOW=NOW_S, OFFICE_TODAY=TODAY_S)
        p = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'build-marketing-lab.py'), out],
                           env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        with io.open(out, 'rb') as f:
            return hashlib.sha256(f.read()).hexdigest()

    def test_reproducible(self):
        with tempfile.TemporaryDirectory() as d:
            a = self.build_once(os.path.join(d, 'a.html'))
            b = self.build_once(os.path.join(d, 'b.html'))
        self.assertEqual(a, b)

    def test_exit_code_on_stop(self):
        with tempfile.TemporaryDirectory() as d:
            bm = base()
            camp(bm, 'potex.json')['flow_ref'] = {'id': 'FL-XX-01', 'version': 'v1'}
            fx = os.path.join(d, 'fx')
            os.mkdir(fx)
            write_all(fx, bm)
            env = dict(os.environ, OFFICE_NOW=NOW_S, OFFICE_TODAY=TODAY_S)
            p = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'build-marketing-lab.py'),
                                os.path.join(d, 'o.html'), '--fixtures', fx], env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)
        self.assertIn('検証停止', p.stdout)

    def test_office_today_mmdd_compatible(self):
        now, today = ml.resolve_clock(NOW_S, '10-04')
        self.assertEqual(today.isoformat(), '2026-10-04')
        with self.assertRaises(ValueError):
            ml.resolve_clock('2026-10-04T09:00:00', None)

    def test_builder_reads_no_private_hub_data(self):
        import ast
        for f in ('build-marketing-lab.py', 'marketing_lab.py'):
            tree = ast.parse(read(os.path.join(ROOT, 'scripts', f)))
            mods = {a.name.split('.')[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
            mods |= {n.module.split('.')[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
            self.assertFalse(mods & {'urllib', 'requests', 'socket', 'http', 'subprocess', 'smtplib'}, (f, mods))
            doc = tree.body[0].value.value  # モジュールの説明文は除く
            consts = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)
                      and n.value != doc]
            for c in consts:
                for name in ('people', 'issues', 'mytasks', '_cal_raw', 'workload', 'proposals', 'crew'):
                    self.assertNotIn(name, c, (f, c))

    def test_office_entry_link(self):
        src = read(os.path.join(ROOT, 'scripts', 'build-office.py'))
        self.assertIn('href="marketing-lab.html"', src)



class Robustness(unittest.TestCase):
    """不正値・壊れた構造で画面全体が落ちず、その事業だけ検証停止になること"""

    def check(self, mut, name='potex.json', code=None):
        bm = base()
        mut(bm)
        res = ml.validate_all(sorted(bm.items()), NOW)
        doc = ml.render(res, TODAY, NOW, 'test')  # 例外が出ないこと
        stopped = {n for n, b, ck in res if ck.errors}
        self.assertEqual(stopped, {name})
        if code:
            self.assertIn(code, [x['code'] for n, b, ck in res if n == name for x in ck.errors])
        sec = doc.split('id="biz-%s"' % name.replace('.json', ''))[1].split('</section>')[0]
        self.assertIn('検証停止', sec)
        for bad in ('Infinity', 'NaN', 'inf', 'nan'):
            self.assertNotIn(bad, doc)
        for other in ({'passlabo.json', 'potex.json', 't-clinic.json'} - {name}):
            self.assertIn('id="biz-%s"' % other.replace('.json', ''), doc)
        return res

    def P(self, bm):
        return camp(bm, 'potex.json')['results']['periods'][0]

    def test_python_inf_nan_in_spend_budget_counts(self):
        for v in (float('inf'), float('-inf'), float('nan')):
            self.check(lambda bm: self.P(bm).__setitem__('spend_yen', v), code='BAD_VALUE')
            self.check(lambda bm: camp(bm, 'potex.json')['request']['budget_cap'].__setitem__('media_yen', v),
                       code='BAD_VALUE')
            self.check(lambda bm: self.P(bm)['counts'].__setitem__('clicks', v), code='BAD_VALUE')

    def test_huge_integers(self):
        for v in (10 ** 15 + 1, 10 ** 400, 10 ** 5000):
            self.check(lambda bm: self.P(bm)['counts'].__setitem__('impressions', v), code='BAD_VALUE')
            self.check(lambda bm: self.P(bm).__setitem__('spend_yen', v), code='BAD_VALUE')

    def test_upper_bound_is_computable(self):
        bm = base()
        p = self.P(bm)
        p['spend_yen'] = 10 ** 15
        p['counts'].update(impressions=10 ** 15, clicks=10 ** 15, register=1, trial=1)
        res = run(bm)
        self.assertEqual(res['potex.json'][1].errors, [])
        r = {x['name']: x['text'] for x in ml.metrics(bm['potex.json'], p)}
        self.assertEqual(r['CTR'], '100.00%')
        self.assertEqual(r['CPA'], '¥1,000,000,000,000,000')
        p['counts'].update(impressions=1, clicks=10 ** 15)  # 表示1に対してクリック1000兆（並びは品質警告で出す）
        r = {x['name']: x['text'] for x in ml.metrics(bm['potex.json'], p)}
        self.assertEqual(r['CTR'], '100000000000000000.00%')

    def test_overflow_and_huge_literals_rejected_on_load(self):
        with tempfile.TemporaryDirectory() as d:
            for lit in ('1e999', '-1e400', '9' * 5000):
                with io.open(os.path.join(d, 'x.json'), 'w', encoding='utf-8') as f:
                    f.write('{"spend_yen": %s}' % lit)
                (name, got), = ml.load_dir(d)
                self.assertIsInstance(got, ml.FixtureError, lit[:10])
            doc, res = ml.build(d, NOW, TODAY)
            self.assertEqual(res[0][2].errors[0]['code'], 'SCHEMA')
            self.assertIn('検証停止', doc)

    def test_broken_structures(self):
        cases = [
            lambda bm: bm['potex.json'].__setitem__('campaigns', {'a': 1}),
            lambda bm: bm['potex.json'].__setitem__('campaigns', ['x']),
            lambda bm: bm['potex.json'].pop('campaigns'),
            lambda bm: bm['potex.json'].pop('metric_definitions'),
            lambda bm: bm['potex.json'].__setitem__('lps', None),
            lambda bm: bm['potex.json']['flows'][0].__setitem__('events', 'x'),
            lambda bm: camp(bm, 'potex.json').__setitem__('request', [1]),
            lambda bm: camp(bm, 'potex.json').pop('qa'),
            lambda bm: camp(bm, 'potex.json')['qa'].__setitem__('items', 'x'),
            lambda bm: camp(bm, 'potex.json')['results'].__setitem__('periods', 'x'),
            lambda bm: self.P(bm).__setitem__('counts', [1]),
            lambda bm: self.P(bm).pop('fetched_at'),
            lambda bm: camp(bm, 'potex.json')['creatives']['items'][0].__setitem__('id', ['a']),
            lambda bm: camp(bm, 'potex.json')['creatives']['items'][0].__setitem__('asset', 'x'),
            lambda bm: camp(bm, 'potex.json')['lp_change'].__setitem__('changes', 'xy'),
            lambda bm: camp(bm, 'potex.json')['results'].__setitem__('next_hypotheses', 'xy'),
            lambda bm: camp(bm, 'potex.json').__setitem__('title', 5),
            lambda bm: camp(bm, 'potex.json').__setitem__('selected_creative', None),
            lambda bm: bm.__setitem__('potex.json', [1, 2]),
        ]
        for i, mut in enumerate(cases):
            with self.subTest(case=i):
                self.check(mut, code='SCHEMA')

    def test_broken_approval_target_other_business_unaffected(self):
        self.check(lambda bm: camp(bm, 'passlabo.json')['approvals']['records'][0].__setitem__('target', 'x'),
                   name='passlabo.json', code='SCHEMA')

    def test_empty_campaigns(self):
        self.check(lambda bm: bm['potex.json'].__setitem__('campaigns', []), code='MISSING')

    def test_broken_json_file(self):
        with tempfile.TemporaryDirectory() as d:
            write_all(d, {k: v for k, v in base().items() if k != 'potex.json'})
            with io.open(os.path.join(d, 'potex.json'), 'w', encoding='utf-8') as f:
                f.write('[1, 2')
            doc, res = ml.build(d, NOW, TODAY)
        self.assertEqual([n for n, b, ck in res if ck.errors], ['potex.json'])
        self.assertIn('JSONとして読めません', doc)

    def test_empty_fixture_directory(self):
        with tempfile.TemporaryDirectory() as d:
            doc, res = ml.build(d, NOW, TODAY)
            self.assertEqual(res, [])
            self.assertIn('fixture が1件もありません', doc)
            self.assertIn('検証停止', doc)
            env = dict(os.environ, OFFICE_NOW=NOW_S, OFFICE_TODAY=TODAY_S)
            p = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'build-marketing-lab.py'),
                                os.path.join(d, 'o.html'), '--fixtures', d], env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertIn('検証停止', p.stdout)


# build-office.py を、一時ディレクトリの架空 stub だけで動かす。
# 監査フックで open を記録し、一時ディレクトリと Python 本体以外のファイルを開いていないことを確かめる。
AUDIT = r"""
import os, sys, json, runpy, sysconfig
root = os.path.realpath(sys.argv[1]); script = sys.argv[2]; log = sys.argv[3]
opened = []
def hook(ev, args):
    if ev == 'open' and isinstance(args[0], str):
        opened.append(os.path.realpath(args[0]))
sys.addaudithook(hook)
sys.argv = [script] + sys.argv[4:]
try:
    runpy.run_path(script, run_name='__main__')
except SystemExit as ex:
    if ex.code not in (0, None):
        raise
finally:
    snap = list(opened)  # ログ自身を開く前の記録だけ残す
    with open(log, 'w', encoding='utf-8') as f:
        json.dump(snap, f)
"""


class OfficeIntegration(unittest.TestCase):
    """実データを使わず、build-office.py の入口 → 隣の架空 marketing-lab.html を確かめる"""

    def run_audited(self, hub, script, *args):
        log = os.path.join(hub, '..', os.path.basename(script) + '.log')
        env = {'PATH': os.environ.get('PATH', ''), 'OFFICE_NOW': NOW_S, 'OFFICE_TODAY': TODAY_S,
               'PYTHONDONTWRITEBYTECODE': '1'}
        p = subprocess.run([sys.executable, '-c', AUDIT, hub, script, log] + list(args),
                           env=env, cwd=hub, capture_output=True, text=True)
        with io.open(log, encoding='utf-8') as f:
            opened = json.load(f)
        return p, opened

    def outside(self, hub, opened):
        import sysconfig
        allowed = [os.path.realpath(hub) + os.sep] + sorted({
            os.path.realpath(x) for x in (sys.prefix, sys.base_prefix, sysconfig.get_paths()['stdlib'],
                                          sysconfig.get_paths()['platstdlib'])})
        return sorted({o for o in opened if not any(o.startswith(a) for a in allowed)})

    def test_office_entry_to_adjacent_lab(self):
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            hub = os.path.realpath(os.path.join(tmp, 'hub'))
            os.makedirs(os.path.join(hub, 'scripts'))
            os.makedirs(os.path.join(hub, 'data', 'marketing-lab'))
            for f in ('build-office.py', 'build-marketing-lab.py', 'marketing_lab.py'):
                shutil.copy(os.path.join(ROOT, 'scripts', f), os.path.join(hub, 'scripts', f))
            shutil.copytree(FIX, os.path.join(hub, 'data', 'marketing-lab', 'fixtures'))
            # build-office.py が必須で読むのは issues.json だけ。空の架空 stub を置く（実データはコピーしない）
            with io.open(os.path.join(hub, 'data', 'issues.json'), 'w', encoding='utf-8') as f:
                json.dump({'issues': [], 'priority': {'weights': {}}}, f)

            p, opened = self.run_audited(hub, os.path.join(hub, 'scripts', 'build-office.py'))
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertEqual(self.outside(hub, opened), [])
            data_read = sorted({os.path.relpath(o, hub) for o in opened
                                if o.startswith(os.path.join(hub, 'data') + os.sep)})
            self.assertEqual(data_read, ['data/issues.json'])

            p, opened = self.run_audited(hub, os.path.join(hub, 'scripts', 'build-marketing-lab.py'))
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertEqual(self.outside(hub, opened), [])
            data_read = sorted({os.path.relpath(o, hub) for o in opened
                                if o.startswith(os.path.join(hub, 'data') + os.sep)})
            self.assertTrue(data_read and all(x.startswith('data/marketing-lab/fixtures/') for x in data_read), data_read)

            office = read(os.path.join(hub, 'office.html'))
            import re
            hrefs = re.findall(r'<a class="mo" href="([^"]+)"[^>]*>([^<]+)</a>', office)
            self.assertIn(('marketing-lab.html', 'マーケ試作（架空）'), hrefs)
            target = os.path.join(hub, 'marketing-lab.html')
            self.assertTrue(os.path.isfile(target))
            lab = read(target)
            self.assertIn('試作品・架空データです', lab)
            for biz in ('passlabo', 'potex', 't-clinic'):
                self.assertIn('id="biz-%s"' % biz, lab)

if __name__ == '__main__':
    unittest.main()
