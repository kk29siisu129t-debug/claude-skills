# -*- coding: utf-8 -*-
"""
PASSCAL 架空導線（架空イベント → 計測レイヤー → 経営画面 S0〜S5）のテスト。標準ライブラリの unittest だけで動く。

  python -m unittest discover -s tests -v

使うのは data/marketing-lab/events の架空イベントと data/marketing-lab/fixtures の架空施策票だけ。
"""
import copy
import datetime
import decimal
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import measurement as M  # noqa: E402
import marketing_lab as ml  # noqa: E402
import passcal_flow as P  # noqa: E402

EVD = os.path.join(ROOT, 'data', 'marketing-lab', 'events')
EVF = os.path.join(EVD, 'passcal-demo.json')
FIX = os.path.join(ROOT, 'data', 'marketing-lab', 'fixtures')
MFIX = os.path.join(ROOT, 'data', 'marketing-lab', 'measurement')
NOW_S = '2026-10-06T14:00:00+09:00'
NOW = datetime.datetime.fromisoformat(NOW_S)
TODAY = NOW.date()
AUG, SEP = 'C-2026-08', 'C-2026-09'


def doc():
    return P.load(EVF)


def plans():
    return {b['business_id']: b for n, b, ck in ml.validate_all(ml.load_dir(FIX), NOW) if not ck.errors}


def view(d=None, now=NOW):
    return P.View(P.adapt(d if d is not None else doc(), now), now, plans().get('passlabo'))


def mut(f):
    d = doc()
    f(d)
    return view(d)


def ev(d, eid):
    return next(x for x in d['events'] if x['event_id'] == eid)


def trace(v, eid):
    return [t for t in v.res.trace if t['event_id'] == eid]


def counts(v, c=AUG):
    return tuple(int(v.value('O-%s-%s' % (k, c))) for k in ('APP', 'INT', 'ENR'))


def build_doc(events_dir=EVD):
    return ml.build(FIX, NOW, TODAY, measurement_dir=MFIX, events_dir=events_dir)[0]


def section(html, sid):
    return html.split('id="%s"' % sid)[1].split('</section>')[0]


class Baseline(unittest.TestCase):
    def test_40_12_3_and_rates(self):
        v = view()
        self.assertEqual(v.errors, [])
        self.assertEqual(counts(v), (40, 12, 3))
        r1, r2 = v.ratio('R-INT-' + AUG), v.ratio('R-ENR-' + AUG)
        self.assertEqual((r1['kind'], M.fmt_ratio(r1['value'])), ('cvr', '30.00%'))
        self.assertEqual((r2['kind'], M.fmt_ratio(r2['value'])), ('cvr', '7.50%'))
        # 入塾到達の分母はフォーム回答（面談到達ではない）
        self.assertEqual(r2['den']['id'], 'O-APP-' + AUG)

    def test_reached_sets_identified(self):
        # 定義は「面談到達 ⊆ フォーム回答」「入塾到達 ⊆ フォーム回答」。入塾が面談到達に含まれることは定義していない
        v = view()
        apps = set(v.res.cohort_apps[AUG])
        self.assertEqual(apps, {'APP-%04d' % i for i in range(1, 41)})
        self.assertEqual(set(v.res.reached[('interview', AUG)]), {'APP-%04d' % i for i in range(1, 13)})
        self.assertEqual(sorted(v.res.reached[('enrollment', AUG)]), ['APP-0001', 'APP-0003', 'APP-0004'])
        self.assertTrue(set(v.res.reached[('enrollment', AUG)]) <= apps)

    def test_open_cohort_is_provisional(self):
        v = view()
        self.assertEqual(counts(v, SEP), (5, 1, 0))
        for rid in ('R-INT-' + SEP, 'R-ENR-' + SEP):
            r = v.ratio(rid)
            self.assertEqual(r['kind'], 'provisional')
            self.assertFalse(any(n.startswith('観測期間:') for n in r['notes']))  # 予定の窓を「観測済み」と書かない
        self.assertEqual(v.ds.norm['O-ENR-' + SEP]['state'], M.ZERO)  # 0 は 0（実測）。空欄にしない
        # 再監査#8: 9月は面談到達 1 があっても「追加観測 0日分」。全観測日数ではないと明記されていること
        r = v.ratio('R-INT-' + SEP)
        txt = next(x for x in r['reasons'] if '追加観測' in x)
        self.assertIn('データ cutoff までに経過したのは 0日分です', txt)
        self.assertIn('各応募日からの全観測日数ではありません', txt)

    def test_cohort_closes_when_window_passes(self):
        d = doc()
        d['source'].update(data_cutoff='2026-11-01T00:00:00+09:00', fetched_at='2026-11-01T09:00:00+09:00')
        later = datetime.datetime.fromisoformat('2026-11-02T09:00:00+09:00')
        v = P.View(P.adapt(d, later), later, None)
        self.assertEqual(v.errors, [])
        self.assertEqual(v.ratio('R-INT-' + SEP)['kind'], 'cvr')
        # cutoff を延ばすと、cutoff 以降として除外していた 10/1 0:00 の面談が入る
        self.assertEqual(counts(v, SEP)[1], 2)

    def test_cpa_2400_same_period_scope_basis(self):
        v = view()
        r = v.ratio('R-CPA-SP-2026-08')
        self.assertEqual((r['kind'], M.fmt_cost_per(r['value'], v.ds.d(r['num']))), ('cost_per', 'JPY 2,400'))
        self.assertEqual(r['num']['period'], r['den']['period'])
        self.assertEqual(int(v.value('O-APP-OCC-SP-2026-08')), 40)
        self.assertEqual(v.ds.d(r['num'])['cost_basis'], '媒体費・税抜（架空）')

    def test_partition_37_plus_3(self):
        v = view()
        part = v.res.partition[AUG]
        matched = sum(len(x) for (k, _), x in part.items() if k == 'matched')
        un = sum(len(x) for (k, _), x in part.items() if k != 'matched')
        self.assertEqual((matched, un), (37, 3))
        self.assertEqual({k: len(x) for k, x in part.items() if k[0] != 'matched'},
                         {('missing_id', ''): 1, ('missing_id', None): 1, ('unknown_id', 'PL-CR-99'): 1})
        self.assertEqual(v.ds.match(v.ds.obs['O-APP-CR-%s-missing_id' % AUG])[0], 'missing_id')
        self.assertEqual(v.ds.match(v.ds.obs['O-APP-CR-%s-absent_id' % AUG])[0], 'missing_id')
        self.assertEqual(v.ds.match(v.ds.obs['O-APP-CR-%s-PL-CR-99' % AUG])[0], 'unknown_id')
        # 親子は足さない（応募ID数は子を足さない単位）
        ru = next(x for x in M.rollups(v.ds) if x['parent']['id'] == 'O-APP-AD-' + AUG)
        self.assertIsNone(ru['sum'])
        self.assertTrue(any('応募ID数' in n for n in ru['notes']))


class Edges(unittest.TestCase):
    def setUp(self):
        self.v = view()

    def code(self, eid):
        return [(t['status'], t['code']) for t in trace(self.v, eid)]

    def test_resend_counted_once(self):
        self.assertIn(('dropped', 'RESENT'), self.code('EV-0001'))
        self.assertIn(('adopted', 'COUNTED'), self.code('EV-0001'))

    def test_resend_with_changed_payload_is_held_not_guessed(self):
        def f(d):
            dup = [x for x in d['events'] if x['event_id'] == 'EV-0001']
            dup[1]['at'] = '2026-08-02T10:00:00+09:00'
        v = mut(f)
        self.assertEqual({t['code'] for t in trace(v, 'EV-0001')}, {'CONFLICT_DUP_ID'})
        self.assertNotIn('APP-0001', v.res.cohort_apps[AUG])  # 推測でどちらかを採らない
        self.assertEqual(counts(v)[0], 39)

    def test_reanswer_first_adopted(self):
        v = self.v
        re_ = [t for t in v.res.trace if t['application_id'] == 'APP-0002' and t['code'] == 'REANSWER']
        self.assertEqual(len(re_), 1)
        self.assertEqual(v.res.apps['APP-0002']['creative_raw'], 'PL-CR-21')

    def test_cancel_and_rebook_counts_held_only(self):
        self.assertIn('APP-0003', self.v.res.reached[('interview', AUG)])
        bk = [t for t in self.v.res.trace if t['application_id'] == 'APP-0003' and t['type'].startswith('interview_')]
        self.assertEqual([t['code'] for t in bk if t['type'] != 'interview_held'], ['BOOKING_ONLY'] * 3)

    def test_booking_is_not_interview(self):
        self.assertNotIn('APP-0013', self.v.res.reached[('interview', AUG)])

    def test_held_on_cancelled_booking_is_held(self):
        t = [x for x in self.v.res.trace if x['application_id'] == 'APP-0015' and x['type'] == 'interview_held']
        self.assertEqual(t[0]['code'], 'CANCELLED_BOOKING')
        self.assertNotIn('APP-0015', self.v.res.reached[('interview', AUG)])

    def test_multiple_interviews_counted_once(self):
        self.assertEqual(len(self.v.res.reached[('interview', AUG)]['APP-0004']), 2)
        self.assertEqual(counts(self.v)[1], 12)

    def test_date_problems_excluded_with_event_ids(self):
        got = {t['code']: t['application_id'] for t in self.v.res.trace if t['code'] in ('NO_DATE', 'BAD_DATE', 'NO_TZ')}
        self.assertEqual(got, {'NO_DATE': 'APP-0016', 'BAD_DATE': 'APP-0017', 'NO_TZ': 'APP-0018'})
        for a in got.values():
            self.assertNotIn(a, self.v.res.reached[('interview', AUG)])

    def test_bad_and_orphan_ids(self):
        codes = {(t['application_id'], t['code']) for t in self.v.res.trace}
        self.assertIn(('APP-12A', 'BAD_APP_ID'), codes)
        self.assertIn((None, 'BAD_APP_ID'), codes)
        self.assertIn(('APP-9999', 'ORPHAN'), codes)

    def test_before_application_held(self):
        t = [x for x in self.v.res.trace if x['application_id'] == 'APP-0019' and x['type'] == 'interview_held']
        self.assertEqual(t[0]['code'], 'BEFORE_APPLICATION')

    def test_payment_is_not_enrollment(self):
        t = [x for x in self.v.res.trace if x['type'] == 'payment_recorded']
        self.assertEqual(t[0]['code'], 'PAYMENT_OUT_OF_SCOPE')

    def test_month_boundary_and_cutoff(self):
        v = self.v
        self.assertEqual(v.res.apps['APP-0041']['cohort']['id'], SEP)          # 08-31T15:00Z = 9/1 00:00 JST
        self.assertEqual(v.res.apps['APP-0040']['cohort']['id'], AUG)          # 8/31 23:59:59 JST
        self.assertIn('APP-0005', v.res.reached[('interview', AUG)])          # 観察窓の終わり 9/30 23:59:59
        self.assertEqual([t['code'] for t in v.res.trace if t['application_id'] == 'APP-0014'
                          and t['type'] == 'interview_held'], ['AFTER_CUTOFF'])  # 10/1 0:00 ちょうど
        self.assertNotIn('APP-0046', v.res.apps)                               # cutoff 後の応募

    def test_outside_window_before_cutoff(self):
        # cutoff を延ばしても、8月コホートの観察窓（9/30）の外の面談は数えない
        d = doc()
        d['source'].update(data_cutoff='2026-10-05T00:00:00+09:00', fetched_at='2026-10-05T09:00:00+09:00')
        v = view(d)
        self.assertEqual([t['code'] for t in v.res.trace if t['application_id'] == 'APP-0014'
                          and t['type'] == 'interview_held'], ['OUTSIDE_WINDOW'])
        self.assertEqual(counts(v), (40, 12, 3))


class Stops(unittest.TestCase):
    def assertStopped(self, v):
        self.assertFalse(v.ok)
        self.assertTrue(v.errors)

    def test_timezone_missing_unknown_unvalidated(self):
        for tz in (None, '', 'Asia/Tokio', 'localtime'):
            self.assertStopped(mut(lambda d: d['source'].update(timezone=tz)))
        self.assertStopped(mut(lambda d: d['source'].pop('timezone')))
        with mock.patch.object(M, 'zoneinfo', None):
            v = view()
            self.assertStopped(v)
            self.assertIn('未検証', v.errors[0]['msg'])

    def test_unknown_inputs_stop(self):
        for f in (lambda d: d.update(schema='x'), lambda d: d.update(synthetic=False), lambda d: d.update(events='x'),
                  lambda d: d['source'].update(ref='https://docs.google.com/x'), lambda d: d.update(cohorts=[]),
                  lambda d: d['cohorts'].append(dict(d['cohorts'][0], id='C-X')),
                  lambda d: d['spend'][0].update(currency=None), lambda d: d['spend'][0].update(period={'start': 'x'}),
                  lambda d: d['spend'].append(dict(d['spend'][0])),
                  lambda d: d.update(spend='x'), lambda d: d.pop('definition_version')):
            self.assertStopped(mut(f))
        self.assertStopped(P.View(P.adapt([1, 2], NOW), NOW))
        with tempfile.TemporaryDirectory() as t:
            with io.open(os.path.join(t, 'x.json'), 'w', encoding='utf-8') as fh:
                fh.write('{"x": 1e999}')
            (fn, v), = P.build_view(t, NOW)
            self.assertStopped(v)

    def test_bad_spend_value_is_source_error_not_zero(self):
        v = mut(lambda d: d['spend'][0].update(raw=-1))
        self.assertTrue(v.ok)
        self.assertEqual(v.ds.norm['O-COST-SP-2026-08']['state'], M.ERROR)
        r = v.ratio('R-CPA-SP-2026-08')
        self.assertEqual((r['kind'], r['value']), ('undecidable', None))
        v = mut(lambda d: d['spend'][0].update(raw=None))
        self.assertEqual(v.ds.norm['O-COST-SP-2026-08']['state'], M.BLANK)

    def test_events_that_are_not_objects(self):
        v = mut(lambda d: d['events'].extend([1, None, 'x']))
        self.assertTrue(v.ok)
        self.assertEqual(len([t for t in v.res.trace if t['code'] == 'NO_EVENT_ID']), 3)
        self.assertEqual(counts(v), (40, 12, 3))

    def test_mismatches_stop_calculation(self):
        v = view()
        ds = copy.deepcopy(v.res.dataset)
        ds['ratios'] += [
            {'id': 'X-DEN', 'intent': 'conversion', 'numerator': 'O-INT-' + AUG, 'denominator': 'O-APP-' + SEP},
            {'id': 'X-DEF', 'intent': 'conversion', 'numerator': 'O-INT-' + AUG, 'denominator': 'O-APP-OCC-SP-2026-08'}]
        d2 = M.Dataset(ds)
        self.assertEqual(M.validate(ds, NOW).errors, [])
        for rid, frag in (('X-DEN', '期間が違います'), ('X-DEF', '基準が違います')):
            r = M.evaluate_ratio(d2, next(x for x in ds['ratios'] if x['id'] == rid))
            self.assertEqual((r['kind'], r['value']), ('blocked', None), rid)
            self.assertTrue(any(frag in x for x in r['reasons']), (rid, r['reasons']))
        # 定義の不一致は算出停止（件数比も出さない）。監査6
        # 存在しない定義版を母集団にした場合は、計測レイヤーの検証そのものが止まる
        ds_bad = copy.deepcopy(view().res.dataset)
        ds_bad['metric_definitions'][1]['population_of'] = {'id': 'PC-APP', 'version': 'other'}
        self.assertIn('UNKNOWN_REF', [x['code'] for x in M.validate(ds_bad, NOW).errors])
        # 存在するが違う定義版（v2）を母集団・分母にした場合は、検証は通るが比は算出しない
        for f in (lambda x: x['metric_definitions'][1].update(population_of={'id': 'PC-APP', 'version': 'v2'}),
                  lambda x: next(o for o in x['observations'] if o['id'] == 'O-APP-' + AUG).update(
                      metric={'id': 'PC-APP', 'version': 'v2'})):
            v2 = view()
            ds2 = v2.res.dataset
            m2 = copy.deepcopy(ds2['metric_definitions'][0])
            m2['version'] = 'v2'
            ds2['metric_definitions'].append(m2)
            f(ds2)
            self.assertEqual(M.validate(ds2, NOW).errors, [])
            v2.ds = M.Dataset(ds2)
            r = v2.ratio('R-INT-' + AUG)
            self.assertEqual((r['kind'], r['value']), ('blocked', None))

    def test_unit_mismatch_stops(self):
        v = view()
        ds = copy.deepcopy(v.res.dataset)
        ds['metric_definitions'].append({'id': 'X-PPL', 'version': 'v1', 'label': '人数', 'unit': 'unique_people',
                                         'basis': 'application_cohort', 'purpose': 'marketing'})
        o = copy.deepcopy(next(x for x in ds['observations'] if x['id'] == 'O-APP-' + AUG))
        o.update(id='X-O', metric={'id': 'X-PPL', 'version': 'v1'}, raw=38)
        ds['observations'].append(o)
        ds['ratios'].append({'id': 'X-U', 'intent': 'conversion', 'numerator': 'O-INT-' + AUG, 'denominator': 'X-O'})
        self.assertEqual(M.validate(ds, NOW).errors, [])
        d2 = M.Dataset(ds)
        r = M.evaluate_ratio(d2, ds['ratios'][-1])
        self.assertEqual(r['kind'], 'blocked')
        ok, why = M.comparability(d2, d2.obs['O-APP-' + AUG], d2.obs['X-O'])
        self.assertTrue(any('単位' in x for x in why))

    def test_cpa_period_mismatch_blocked(self):
        v = view()
        ds = copy.deepcopy(v.res.dataset)
        o = next(x for x in ds['observations'] if x['id'] == 'O-APP-OCC-SP-2026-08')
        o['period'] = {'start': '2026-08-01', 'end': '2026-08-30'}
        r = M.evaluate_ratio(M.Dataset(ds), next(x for x in ds['ratios'] if x['id'] == 'R-CPA-SP-2026-08'))
        self.assertEqual((r['kind'], r['value']), ('blocked', None))


class AuditFindings(unittest.TestCase):
    """独立監査の指摘（架空fixtureで再現したもの）の回帰テスト"""

    def test_1_cpa_denominator_includes_out_of_cohort_applications(self):
        def f(d):
            d['spend'][0]['period'] = {'start': '2026-07-15', 'end': '2026-08-31'}
            d['events'].append({'event_id': 'EV-X3', 'type': 'form_submitted', 'application_id': 'APP-0051',
                                'at': '2026-07-31T10:00:00+09:00', 'creative_id': 'PL-CR-21'})
        v = mut(f)
        self.assertEqual(int(v.value('O-APP-OCC-SP-2026-08')), 41)
        r = v.ratio('R-CPA-SP-2026-08')
        self.assertEqual(M.fmt_cost_per(r['value'], v.ds.d(r['num'])), 'JPY 2,341')
        self.assertIn('APP-0051', v.res.occ['SP-2026-08'])
        self.assertEqual(counts(v), (40, 12, 3))   # コホートの数字は変わらない

    def test_1_spend_scope_must_match(self):
        self.assertFalse(mut(lambda d: d['spend'][0].update(scope='OTHER')).ok)
        self.assertFalse(mut(lambda d: d['spend'][0].pop('scope')).ok)

    def test_2a_cancel_with_unknown_time_holds_interview(self):
        def f(d):
            next(x for x in d['events'] if x.get('application_id') == 'APP-0015'
                 and x['type'] == 'interview_cancelled')['at'] = '2026-08-21T10:00:00'
        v = mut(f)
        self.assertEqual(counts(v)[1], 12)
        t = [x for x in v.res.trace if x['application_id'] == 'APP-0015' and x['type'] == 'interview_held']
        self.assertEqual(t[0]['code'], 'CANCEL_UNCERTAIN')
        self.assertIn('EV-', t[0]['reason'])

    def test_2b_other_applications_cancel_does_not_apply(self):
        v = mut(lambda d: d['events'].append({'event_id': 'EV-XC', 'type': 'interview_cancelled', 'application_id': 'APP-0030',
                                              'at': '2026-08-02T10:00:00+09:00', 'booking_id': 'BK-0001-A'}))
        self.assertEqual(counts(v)[1], 12)
        self.assertIn('APP-0001', v.res.reached[('interview', AUG)])

    def test_2c_rebook_after_cancel_is_valid(self):
        v = mut(lambda d: d['events'].append({'event_id': 'EV-Y1', 'type': 'interview_booked', 'application_id': 'APP-0015',
                                              'at': '2026-08-21T12:00:00+09:00', 'booking_id': 'BK-0015-A'}))
        self.assertIn('APP-0015', v.res.reached[('interview', AUG)])
        self.assertEqual(counts(v)[1], 13)
        t = [x for x in view().res.trace if x['application_id'] == 'APP-0015' and x['type'] == 'interview_held']
        self.assertIn('取消 EV-', t[0]['reason'])   # どの取消で保留したか追える

    def test_3_ambiguous_first_answer_is_held(self):
        v = mut(lambda d: d['events'].extend([
            {'event_id': 'EV-Z1', 'type': 'form_submitted', 'application_id': 'APP-0050', 'at': '2026-08-31T10:00:00'},
            {'event_id': 'EV-Z2', 'type': 'form_submitted', 'application_id': 'APP-0050', 'at': '2026-09-02T10:00:00+09:00'}]))
        self.assertEqual(counts(v, SEP)[0], 5)
        self.assertNotIn('APP-0050', v.res.apps)
        self.assertEqual({t['code'] for t in v.res.trace if t['event_id'] == 'EV-Z2'}, {'AMBIGUOUS_APPLICATION'})

    def test_3_same_time_different_answers_held(self):
        def f(d):
            first = next(x for x in d['events'] if x.get('application_id') == 'APP-0020' and x['type'] == 'form_submitted')
            d['events'].append(dict(first, event_id='EV-0000', creative_id='PL-CR-11'))
        v = mut(f)
        self.assertNotIn('APP-0020', v.res.apps)
        self.assertEqual(counts(v)[0], 39)
        self.assertTrue(all(t['code'] in ('AMBIGUOUS_APPLICATION', 'APP_HELD', 'CONFLICT_DUP_ID') for t in v.res.trace
                            if t['application_id'] == 'APP-0020'))
        # 再監査: 同じ時刻の回答が3件以上（同じ中身2件＋違う中身1件）でも保留にする
        def f3(d):
            first = next(x for x in d['events'] if x.get('application_id') == 'APP-0019' and x['type'] == 'form_submitted')
            d['events'] += [dict(first, event_id='EV-0019a'), dict(first, event_id='EV-0020z', creative_id='PL-CR-11')]
        v3 = mut(f3)
        self.assertNotIn('APP-0019', v3.res.apps)
        self.assertEqual({t['code'] for t in v3.res.trace if t['application_id'] == 'APP-0019'
                          and t['type'] == 'form_submitted'}, {'AMBIGUOUS_APPLICATION'})
        # 同じ時刻でも中身が同じ回答だけなら、初回を決められる（推測ではない）
        def f4(d):
            first = next(x for x in d['events'] if x.get('application_id') == 'APP-0021' and x['type'] == 'form_submitted')
            d['events'].append(dict(first, event_id='EV-0021a'))
        self.assertIn('APP-0021', mut(f4).res.apps)

    def test_5_ids_unique_with_two_event_files(self):
        with tempfile.TemporaryDirectory() as t:
            for n in ('a.json', 'b.json'):
                with io.open(os.path.join(t, n), 'w', encoding='utf-8') as fh:
                    json.dump(doc(), fh, ensure_ascii=False, default=str)
            html = build_doc(t)
        ids = re.findall(r' id="([^"]+)"', html)
        self.assertEqual(len(ids), len(set(ids)), sorted(x for x in set(ids) if ids.count(x) > 1))
        s0b = section(html, 'pc1-s0')
        self.assertTrue(all(h.startswith('pc1-') for h in re.findall(r'href="#([^"]+)"', s0b)))

    def test_7_repeat_enrollment_reason(self):
        v = mut(lambda d: d['events'].append({'event_id': 'EV-X4', 'type': 'enrollment_completed', 'application_id': 'APP-0001',
                                              'at': '2026-08-22T10:00:00+09:00'}))
        self.assertEqual([t['code'] for t in v.res.trace if t['event_id'] == 'EV-X4'], ['REPEAT_ENROLLMENT'])
        self.assertEqual(counts(v)[2], 3)

    def test_8_out_of_cohort_is_not_orphan(self):
        v = mut(lambda d: d['events'].extend([
            {'event_id': 'EV-O1', 'type': 'form_submitted', 'application_id': 'APP-0052', 'at': '2026-07-30T10:00:00+09:00'},
            {'event_id': 'EV-O2', 'type': 'interview_held', 'application_id': 'APP-0052', 'at': '2026-08-05T10:00:00+09:00'}]))
        self.assertEqual([t['code'] for t in v.res.trace if t['event_id'] == 'EV-O2'], ['APP_OUT_OF_COHORT'])

    def test_8_s5_version_mismatch_shown(self):
        d = doc()
        d['decisions'][0]['versions']['creative']['version'] = 'v9'
        v = view(d)
        self.assertTrue(any('v9' in x for x in P._version_checks(v, d['decisions'][0])))
        self.assertEqual(P._version_checks(v, doc()['decisions'][1]), [])

    def test_9_unconnected_items_required(self):
        self.assertFalse(mut(lambda d: d.update(unconnected=[])).ok)
        self.assertFalse(mut(lambda d: d['unconnected'].remove('利益')).ok)


class Units(unittest.TestCase):
    """応募ID数・応募日コホートの追加が、既存の3単位・2基準を変えないこと"""

    def test_existing_units_unchanged(self):
        self.assertEqual(M.UNITS['rows'], '行数')
        self.assertEqual(M.UNITS['unique_people'], '人数（ユニーク）')
        self.assertEqual(M.UNITS['currency'], '金額')
        self.assertEqual(M.normalize('1.5', unit='rows')['state'], M.ERROR)
        self.assertEqual(M.normalize('1.5', unit='application_ids')['state'], M.ERROR)
        self.assertEqual(M.normalize('1.5', unit='currency')['state'], M.VALUE)
        b = M.Dataset({n: x for n, x in M.load_dir(MFIX)}['ms-beta.json'])
        rus = {r['parent']['id']: r for r in M.rollups(b)}
        self.assertEqual(rus['B-O1']['sum'], 50)          # 行数は足す
        self.assertIsNone(rus['B-O11']['sum'])            # 人数は足さない
        self.assertEqual(rus['B-O8']['sum'], 310000)      # 金額は足す

    def test_application_cohort_requires_cohort(self):
        v = view()
        ds = copy.deepcopy(v.res.dataset)
        next(x for x in ds['observations'] if x['id'] == 'O-APP-' + AUG).pop('cohort')
        self.assertIn('MISSING', [x['code'] for x in M.validate(ds, NOW).errors])

    def test_application_ids_label_not_people(self):
        html = build_doc()
        for sid in ('pc-s0', 'pc-s1', 'pc-s2'):
            sec = section(html, sid)
            self.assertNotIn('人数', sec.replace('人数ではありません', ''), sid)


class Screens(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = build_doc()
        cls.v = view()

    def vals(self, sid, attr):
        return dict(re.findall(r'data-%s="([^"]+)">([^<]+)<' % attr, section(self.html, sid)))

    def test_same_numbers_across_screens(self):
        want = {'O-APP-' + AUG: '40', 'O-INT-' + AUG: '12', 'O-ENR-' + AUG: '3'}
        for sid in ('pc-s0', 'pc-s1'):
            got = self.vals(sid, 'obs')
            for k, x in want.items():
                self.assertEqual(got.get(k), x, (sid, k))
        self.assertEqual(self.vals('pc-s4', 'obs').get('O-APP-' + AUG), '40')
        for sid in ('pc-s0', 'pc-s1', 'pc-s5'):
            r = self.vals(sid, 'ratio')
            self.assertEqual(r.get('R-INT-' + AUG), '30.00%', sid)
            self.assertEqual(r.get('R-ENR-' + AUG), '7.50%', sid)
        self.assertEqual(self.vals('pc-s2', 'ratio').get('R-CPA-SP-2026-08'), 'JPY 2,400')
        self.assertEqual(self.vals('pc-s5', 'ratio').get('R-CPA-SP-2026-08'), 'JPY 2,400')
        self.assertEqual(self.vals('pc-s2', 'obs').get('O-COST-SP-2026-08'), 'JPY 96,000')

    def test_values_come_from_adapter_not_markup(self):
        # 架空イベントを1件変えると、すべての画面の数字が同じだけ変わる（画面ごとに数字を持っていない）
        d = doc()
        held = next(x for x in d['events'] if x.get('application_id') == 'APP-0012' and x['type'] == 'interview_held')
        d['events'].remove(held)
        with tempfile.TemporaryDirectory() as t:
            with io.open(os.path.join(t, 'passcal-demo.json'), 'w', encoding='utf-8') as fh:
                json.dump(d, fh, ensure_ascii=False, default=str)
            html = build_doc(t)
        for sid in ('pc-s0', 'pc-s1'):
            self.assertIn('data-obs="O-INT-%s">11<' % AUG, section(html, sid))
            self.assertIn('data-ratio="R-INT-%s">27.50%%<' % AUG, section(html, sid))

    def test_conditions_shown(self):
        s0 = section(self.html, 'pc-s0')
        for x in ('応募日コホート 2026-08-01〜2026-08-31（Asia/Tokyo）', '観察窓 各応募日から 2026-09-30 まで',
                  'データ cutoff 2026-10-01T00:00:00+09:00', '取得 2026-10-01T09:00:00+09:00',
                  '定義版 passcal-demo-def/v1', '単位 応募ID数', 'synthetic://passcal/events-v1',
                  'conversion rate（確定）', '暫定比（未成熟・CVRではない）', '入塾到達（入金ではない）'):
            self.assertIn(x, s0, x)
        self.assertIn('実事業の確定定義ではありません', s0)
        # 架空・未接続の長文は画面上部に出さず「集計条件・根拠」の中だけ（最上部の帯で明示済み）
        for sid in ('pc-s0', 'pc-s1', 'pc-s2', 'pc-s3', 'pc-s4', 'pc-s5'):
            sec = section(self.html, sid)
            self.assertNotIn('<p class="notice">架空データ', sec, sid)
            body = re.sub(r'<details class="cond">.*?</details>', '', sec, flags=re.S)
            self.assertNotIn('実事業の確定定義ではありません', body, sid)
            self.assertIn('実事業の確定定義ではありません', sec, sid)
        # S1 のステップ図: 率の分母はどちらも応募 40
        s1 = section(self.html, 'pc-s1').split('2026年9月応募')[0]
        self.assertEqual(s1.count('応募 40 のうち'), 2)
        self.assertIn('入塾到達率は「面談到達のうち入塾した割合」ではありません', s1)
        self.assertLess(s1.index('data-obs="O-APP-C-2026-08"'), s1.index('data-obs="O-INT-C-2026-08"'))
        self.assertLess(s1.index('data-obs="O-INT-C-2026-08"'), s1.index('data-obs="O-ENR-C-2026-08"'))

    def test_traceability(self):
        hrefs = set(re.findall(r'href="#([^"]+)"', self.html))
        ids = set(re.findall(r' id="([^"]+)"', self.html))
        self.assertFalse(hrefs - ids, hrefs - ids)
        s1 = section(self.html, 'pc-s1')
        tr = s1.split('id="pc-tr-int-%s"' % AUG)[1].split('</details>')[0]
        self.assertEqual(len(re.findall(r'<tr><td>APP-\d{4}</td>', tr)), 12)
        s4 = section(self.html, 'pc-s4')
        for eid in ('EV-DUP-20', 'CANCELLED_BOOKING', 'NO_TZ', 'APP-0016', 'PAYMENT_OUT_OF_SCOPE'):
            self.assertIn(eid, s4)
        self.assertIn('CR に照合 <b>37</b> 応募ID ／ 未帰属 <b>3</b> 応募ID', s4)
        # 監査4: 表示した数字・率にはすべて根拠リンクが付く
        for sid in ('pc-s0', 'pc-s1', 'pc-s2', 'pc-s3', 'pc-s4', 'pc-s5'):
            sec = section(self.html, sid)
            for m in re.finditer(r'data-(obs|ratio)="[^"]+">[^<]+</b>', sec):
                tail = sec[m.end():m.end() + 80]
                self.assertTrue(tail.lstrip().startswith('<a class="small" href="#'), (sid, m.group(0)))
        s1 = section(self.html, 'pc-s1')
        attr = s1.split('id="pc-tr-app-%s"' % AUG)[1].split('</details>')[0]
        self.assertEqual(len(re.findall(r'<tr><td>APP-\d{4}</td>', attr)), 40)
        self.assertEqual(attr.count('PL-CR-21'), 18)
        self.assertEqual(attr.count('ID欠落（未紐付け）'), 2)

    def test_s2_shows_existing_versions_only(self):
        s2 = section(self.html, 'pc-s2')
        self.assertIn('PL-CR-21 v1', s2)
        self.assertIn('LP-PL-01 現行 v3 → 提案 v4', s2)
        self.assertIn('ID欠落（未紐付け）', s2)
        self.assertIn('ID不一致（未紐付け）', s2)
        for sid in ('pc-s0', 'pc-s1', 'pc-s2', 'pc-s3', 'pc-s4', 'pc-s5'):
            self.assertNotIn('LINE登録', section(self.html, sid), sid)  # 古い LINE 登録のサンプル値を混ぜない

    def test_s3_unconnected_not_zero(self):
        s3 = section(self.html, 'pc-s3')
        for item in ('契約額', '実入金', '未収', '会計売上', '利益'):
            self.assertRegex(s3, r'<td>%s</td><td><span class="st na">未接続</span>' % item)
        self.assertNotRegex(s3, r'(¥|JPY )0\b|0円</')

    def test_s5_fictional_no_actions(self):
        s5 = section(self.html, 'pc-s5')
        self.assertIn('本当の承認・採用・公開・配信ではありません', s5)
        for x in ('PC-D01', 'PC-D02', 'PL-C01', '次の1案', 'CR PL-CR-21 v1 ／ LP LP-PL-01 v3 ／ 導線 FL-PL-01 v1'):
            self.assertIn(x, s5)
        low = self.html.lower()
        for bad in ('<button', '<form', '<input', 'fetch(', 'xmlhttprequest', 'infinity', 'nan%'):
            self.assertNotIn(bad, low)

    def test_six_tabs_first(self):
        nav = self.html.split('<nav class="tabs main"')[1].split('</nav>')[0]
        tabs = re.findall(r'<a href="#(pc-s\d)">', nav)
        self.assertEqual(tabs, ['pc-s0', 'pc-s1', 'pc-s2', 'pc-s3', 'pc-s4', 'pc-s5'])
        self.assertLess(self.html.index('id="pc-s0"'), self.html.index('id="biz-passlabo"'))

    def test_stop_screens_show_no_numbers(self):
        d = doc()
        d['source']['timezone'] = 'Mars/Base'
        with tempfile.TemporaryDirectory() as t:
            with io.open(os.path.join(t, 'passcal-demo.json'), 'w', encoding='utf-8') as fh:
                json.dump(d, fh, ensure_ascii=False, default=str)
            html = build_doc(t)
        for sid in ('pc-s0', 'pc-s1', 'pc-s2', 'pc-s3', 'pc-s4', 'pc-s5'):
            sec = section(html, sid)
            self.assertIn('検証停止', sec)
            self.assertNotIn('data-obs=', sec)
        self.assertIn('id="biz-passlabo"', html)  # 他の画面は巻き込まない
        with tempfile.TemporaryDirectory() as t:
            self.assertIn('架空イベントの fixture が1件もありません', build_doc(t))

    def test_escape(self):
        d = doc()
        evil = '<script>alert("x")</script>'
        d['events'].append({'event_id': evil, 'type': 'page_view', 'application_id': evil, 'at': evil})
        d['decisions'][0]['hypothesis'] = evil
        d['business']['name'] = evil
        with tempfile.TemporaryDirectory() as t:
            with io.open(os.path.join(t, 'passcal-demo.json'), 'w', encoding='utf-8') as fh:
                json.dump(d, fh, ensure_ascii=False, default=str)
            html = build_doc(t)
        self.assertNotIn('<script>alert', html)
        self.assertIn('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;', html)

    def test_reproducible_build(self):
        env = dict(os.environ, OFFICE_NOW=NOW_S, OFFICE_TODAY=TODAY.isoformat(), PYTHONDONTWRITEBYTECODE='1')
        outs = []
        with tempfile.TemporaryDirectory() as t:
            for i in range(2):
                p = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'build-marketing-lab.py'),
                                    os.path.join(t, '%d.html' % i)], env=env, capture_output=True, text=True)
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                self.assertIn('C-2026-08: フォーム回答 40 ／ 面談到達 12 ／ 入塾到達 3', p.stdout)
                with io.open(os.path.join(t, '%d.html' % i), 'rb') as fh:
                    outs.append(fh.read())
        self.assertEqual(outs[0], outs[1])

    def test_fixture_is_synthetic(self):
        with io.open(EVF, encoding='utf-8') as fh:
            blob = fh.read()
        self.assertIsNone(re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', blob))
        self.assertIsNone(re.search(r'0\d{1,4}-\d{1,4}-\d{3,4}', blob))
        self.assertNotIn('docs.google.com', blob)
        self.assertIsNone(re.search(r'https?://', blob))
        d = json.loads(blob)
        self.assertIs(d['synthetic'], True)
        self.assertTrue(d['source']['ref'].startswith('synthetic://'))


if __name__ == '__main__':
    unittest.main()
