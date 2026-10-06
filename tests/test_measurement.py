# -*- coding: utf-8 -*-
"""
計測の正規化・検証レイヤー（合成データ）のテスト。標準ライブラリの unittest だけで動く。

  python -m unittest discover -s tests -v

使うのは data/marketing-lab/measurement の合成 fixture（架空の事業・架空の数値）だけ。
"""
import copy
import datetime
import decimal
import io
import json
import os
import re
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import measurement as M  # noqa: E402
import marketing_lab as ml  # noqa: E402

MFIX = os.path.join(ROOT, 'data', 'marketing-lab', 'measurement')
FIX = os.path.join(ROOT, 'data', 'marketing-lab', 'fixtures')
NOW = datetime.datetime.fromisoformat('2026-10-05T09:00:00+09:00')
TODAY = NOW.date()
D = decimal.Decimal


def base():
    return {n: d for n, d in M.load_dir(MFIX)}


def ds(name='ms-alpha.json', mut=None):
    bm = base()
    if mut:
        mut(bm[name])
    ck = M.validate(bm[name], NOW)
    return bm[name], ck


def ready(name='ms-alpha.json', mut=None):
    raw, ck = ds(name, mut)
    assert not ck.errors, ck.errors
    return M.Dataset(raw)


def codes(ck):
    return [x['code'] for x in ck.errors]


def obs(raw, oid):
    return next(o for o in raw['observations'] if o['id'] == oid)


def ratio(dset, rid):
    return M.evaluate_ratio(dset, next(r for r in dset.ds['ratios'] if r['id'] == rid))


class Normalize(unittest.TestCase):
    def st(self, raw, declared=None, unit='rows'):
        return M.normalize(raw, declared, unit)

    def test_genuine_zero_is_kept(self):
        for raw in (0, '0', ' 0 ', D('0'), 0.0, '¥0'):
            n = self.st(raw)
            self.assertEqual((n['state'], n['value']), (M.ZERO, 0), raw)

    def test_blank_is_not_zero(self):
        for raw in (None, '', '   '):
            n = self.st(raw)
            self.assertEqual((n['state'], n['value']), (M.BLANK, None), repr(raw))

    def test_formula_errors(self):
        for raw in ('#REF!', '#DIV/0!', '#N/A', '#VALUE!', '#name?', '#ERROR!'):
            n = self.st(raw)
            self.assertEqual(n['state'], M.ERROR, raw)
            self.assertIn('数式エラー', n['detail'])

    def test_declared_states(self):
        self.assertEqual(self.st(None, 'unavailable')['state'], M.UNAVAILABLE)
        self.assertEqual(self.st('', 'not_applicable')['state'], M.NA)
        # 値があるのに「取得不可」と宣言したら矛盾。黙って捨てない
        self.assertEqual(self.st(5, 'unavailable')['state'], M.ERROR)
        self.assertEqual(self.st(0, 'not_applicable')['state'], M.ERROR)
        self.assertEqual(self.st(None, 'zero')['state'], M.ERROR)

    def test_values_and_invalid(self):
        self.assertEqual(self.st('1,234')['value'], 1234)
        self.assertEqual(self.st('¥180,000', unit='currency')['value'], 180000)
        self.assertEqual(self.st(D('12.5'), unit='currency')['value'], D('12.5'))
        for raw in ('-', 'abc', '1,23', '12a', -1, '-5', True, False, [1], {'a': 1},
                    float('inf'), float('nan'), D('Infinity'), 10 ** 16, 10 ** 400):
            self.assertEqual(self.st(raw)['state'], M.ERROR, repr(raw)[:30])
        self.assertEqual(self.st(D('1.5'))['state'], M.ERROR)  # 件数・人数は整数
        self.assertEqual(self.st(D('1.5'), unit='currency')['state'], M.VALUE)

    def test_raw_text_distinguishes_null_blank_zero(self):
        self.assertEqual([M.raw_text(x) for x in (None, '', 0, '0')], ['null', '""', '0', '"0"'])
        self.assertEqual(M.raw_text(float('inf')), '（有限でない数値）')
        self.assertEqual(M.raw_text(10 ** 5000), '（30桁を超える整数）')


class Fixtures(unittest.TestCase):
    def test_fixtures_validate_and_are_synthetic(self):
        for n, d in base().items():
            ck = M.validate(d, NOW)
            self.assertEqual(ck.errors, [], n)
            self.assertIs(d['synthetic'], True)
            for s in d['sources']:
                self.assertTrue(s['ref'].startswith('synthetic://'))

    def test_required_cases_present(self):
        a, b = ready('ms-alpha.json'), ready('ms-beta.json')
        st = [x['state'] for x in a.norm.values()] + [x['state'] for x in b.norm.values()]
        for s in (M.VALUE, M.ZERO, M.BLANK, M.UNAVAILABLE, M.ERROR, M.NA):
            self.assertIn(s, st)
        self.assertEqual(a.norm['A-O4']['detail'], '数式エラー #REF!')
        self.assertTrue(a.maturity(a.obs['A-O7'])[0])                     # open cohort
        self.assertEqual(b.match(b.obs['B-O5'])[0], 'missing_id')          # creative ID 欠落
        self.assertEqual(b.match(b.obs['B-O7'])[0], 'unknown_id')
        self.assertTrue(M.rollups(b))                                      # 親子

    def test_no_pii_or_real_refs(self):
        blob = ''.join(io.open(os.path.join(MFIX, f), encoding='utf-8').read() for f in sorted(os.listdir(MFIX)))
        self.assertIsNone(re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', blob))
        self.assertIsNone(re.search(r'0\d{1,4}-\d{1,4}-\d{3,4}', blob))
        self.assertNotIn('docs.google.com', blob)
        self.assertIsNone(re.search(r'[A-Za-z0-9_-]{40,}', blob), '長いID風の文字列')
        self.assertIn('架空', blob)


class Ratios(unittest.TestCase):
    def test_closed_cohort_is_cvr(self):
        r = ratio(ready(), 'A-R1')
        self.assertEqual(r['kind'], 'cvr')
        self.assertEqual(M.fmt_ratio(r['value']), '20.00%')

    def test_open_cohort_is_provisional_not_cvr(self):
        r = ratio(ready(), 'A-R2')
        self.assertEqual(r['kind'], 'provisional')
        self.assertTrue(any('open cohort' in x for x in r['reasons']))
        self.assertTrue(any('確定したCVRとして扱いません' in x for x in r['reasons']))
        self.assertEqual(len(r['reasons']), len(set(r['reasons'])))
        # 再監査#8: 日数は cohort 終了後の追加観測で、全観測日数ではないと明記する（計算は変えない）
        self.assertIn('cohort 終了後の追加観測（cohort 終了日の翌日から観測終了日まで）31日のうち、データ cutoff までに経過したのは 1日分です'
                      '（各応募日からの全観測日数ではありません。cohort 期間中の観測は含みません）', r['reasons'])
        # 再監査#9: 暫定比には「観測期間: …」の注記を付けない（意図した挙動変更）。確定した率（A-R1）には付ける
        self.assertFalse(any(n.startswith('観測期間:') for n in r['notes']))
        r1 = ratio(ready(), 'A-R1')
        self.assertEqual(r1['kind'], 'cvr')
        self.assertIn('観測期間: cohort 終了後 30日（2026-09-30 まで）。観測期間の長さが違う cohort とは並べて比べません', r1['notes'])

    def test_cohort_closes_when_cutoff_passes(self):
        def mut(d):
            d['sources'][0]['data_cutoff'] = '2026-11-01T00:00:00+09:00'
            d['sources'][0]['fetched_at'] = '2026-11-01T09:00:00+09:00'
        later = NOW.replace(month=11, day=2)
        raw = base()['ms-alpha.json']
        mut(raw)
        self.assertEqual(M.validate(raw, later).errors, [])
        self.assertEqual(M.evaluate_ratio(M.Dataset(raw), raw['ratios'][1])['kind'], 'cvr')

    def test_cutoff_boundary(self):
        # cutoff 10/01 00:00 は 9/30 までを含む。9/30 23:59 で切ると 9/30 終わりの cohort は締まらない
        def mut(x):
            x['sources'][0].update(data_cutoff='2026-09-30T23:59:00+09:00')
            obs(x, 'A-O12')['raw'] = None
        d = ready(mut=mut)
        self.assertTrue(d.maturity(d.obs['A-O5'])[0])
        self.assertTrue(d.maturity(d.obs['A-O1'])[0])

    def test_occurrence_ratio_is_not_cvr_and_zero_kept(self):
        r = ratio(ready(), 'A-R3')
        self.assertEqual(r['kind'], 'count_ratio')
        self.assertEqual(M.fmt_ratio(r['value']), '0.00%')
        self.assertTrue(any('発生日基準' in x for x in r['reasons']))

    def test_basis_and_period_mismatch_blocks(self):
        r = ratio(ready(), 'A-R4')
        self.assertEqual((r['kind'], r['value']), ('blocked', None))
        self.assertTrue(any('基準が違います' in x for x in r['reasons']))
        self.assertTrue(any('期間が違います' in x for x in r['reasons']))

    def test_billing_is_never_cvr(self):
        # 監査3: 請求の対象判定の件数は、件数比としても値を出さない
        r = ratio(ready(), 'A-R5')
        self.assertEqual((r['kind'], r['value']), ('blocked', None))
        self.assertTrue(any('手数料請求' in x for x in r['reasons']))
        # cohort・母集団がそろっていても、請求用の定義が入れば CVR にしない
        def mut(d):
            for m in d['metric_definitions']:
                if m['id'] == 'A-CONS-C':
                    m['purpose'] = 'billing'
        self.assertEqual(ratio(ready(mut=mut), 'A-R1')['kind'], 'blocked')

    def test_billing_rule_on_marketing_definition_stops(self):
        def mut(d):
            d['metric_definitions'][1]['rule_ref'] = {'id': 'FEE-RULE', 'purpose': 'billing'}
        self.assertIn('BILLING_RULE', codes(ds(mut=mut)[1]))

        def mut2(d):
            for m in d['metric_definitions']:
                if m['id'] == 'A-CONS-C':
                    m['population_of'] = {'id': 'A-FEE', 'version': 'v1'}
        self.assertIn('BILLING_RULE', codes(ds(mut=mut2)[1]))

    def test_blank_and_error_are_undecidable(self):
        r = ratio(ready(), 'A-R6')
        self.assertEqual((r['kind'], r['value']), ('undecidable', None))
        self.assertIn('分子が空欄（値なし）', r['reasons'])
        self.assertTrue(any('#REF!' in x for x in r['reasons']))

    def test_zero_denominator(self):
        d = ready(mut=lambda x: obs(x, 'A-O5').update(raw=0))
        r = ratio(d, 'A-R1')
        self.assertEqual((r['kind'], r['reasons']), ('undecidable', ['分母が0（実測）']))

    def test_rows_vs_people_not_cvr(self):
        r = ratio(ready('ms-beta.json'), 'B-R3')
        self.assertEqual((r['kind'], r['value']), ('blocked', None))
        self.assertTrue(any('単位が違います' in x for x in r['reasons']))

    def test_numerator_above_denominator_blocked(self):
        r = ratio(ready(mut=lambda x: obs(x, 'A-O6').update(raw=200)), 'A-R1')
        self.assertEqual(r['kind'], 'blocked')

    def test_cost_per_and_timezone_mismatch(self):
        b = ready('ms-beta.json')
        r1, r2 = ratio(b, 'B-R1'), ratio(b, 'B-R2')
        self.assertEqual((r1['kind'], M.fmt_cost_per(r1['value'], b.d(r1['num']))), ('cost_per', 'JPY 6,000'))
        self.assertEqual(r2['kind'], 'blocked')
        self.assertTrue(any('timezone が違います' in x for x in r2['reasons']))

    def test_currency_ratio_not_conversion(self):
        def mut(d):
            d['ratios'].append({'id': 'B-RX', 'intent': 'conversion', 'numerator': 'B-O8', 'denominator': 'B-O1'})
        self.assertEqual(ratio(ready('ms-beta.json', mut), 'B-RX')['kind'], 'blocked')


class Comparability(unittest.TestCase):
    def cmp(self, d, cid):
        c = next(x for x in d.ds['comparisons'] if x['id'] == cid)
        return M.comparability(d, d.obs[c['a']], d.obs[c['b']])

    def test_fixture_comparisons(self):
        a, b = ready(), ready('ms-beta.json')
        ok, why = self.cmp(a, 'A-C1')
        self.assertFalse(ok)
        self.assertTrue(any('元データエラー（0ではありません）' in x for x in why))
        ok, why = self.cmp(a, 'A-C2')
        self.assertTrue(any('open cohort' in x for x in why))
        ok, why = self.cmp(a, 'A-C3')
        self.assertTrue(any('単位' in x for x in why) and any('基準' in x for x in why) and any('定義' in x for x in why))
        ok, why = self.cmp(a, 'A-C4')
        self.assertTrue(any('空欄（0ではありません）' in x for x in why))
        ok, why = self.cmp(a, 'A-C5')
        self.assertTrue(any('期間が締まっていない' in x for x in why))
        ok, why = self.cmp(b, 'B-C1')
        self.assertTrue(any('費用基準' in x for x in why))
        ok, why = self.cmp(b, 'B-C2')
        self.assertTrue(any('未紐付け' in x for x in why))
        self.assertEqual(self.cmp(b, 'B-C3'), (True, []))
        ok, why = self.cmp(b, 'B-C4')
        self.assertTrue(any('timezone が違います' in x for x in why))

    def test_series_are_separate(self):
        a = ready()
        keys = {M.series_key(a, o) for o in a.ds['observations']}
        self.assertGreaterEqual(len(keys), 6)  # 定義・単位・基準・用途ごとに別
        k1 = M.series_key(a, a.obs['A-O1'])
        k7 = M.series_key(a, a.obs['A-O7'])
        self.assertNotEqual(k1, k7)

    def test_duplicate_series_row_stops_no_overwrite(self):
        def mut(d):
            x = copy.deepcopy(obs(d, 'A-O1'))
            x.update(id='A-O1b', raw=999)
            d['observations'].append(x)
        self.assertIn('DUP_SERIES', codes(ds(mut=mut)[1]))

    def test_same_id_different_version_kept_separate(self):
        def mut(d):
            m = copy.deepcopy(d['metric_definitions'][0])
            m['version'] = 'v2'
            d['metric_definitions'].append(m)
            x = copy.deepcopy(obs(d, 'A-O1'))
            x.update(id='A-O1v2', metric={'id': 'A-REG', 'version': 'v2'}, raw=118)
            d['observations'].append(x)
        a = ready(mut=mut)
        ok, why = M.comparability(a, a.obs['A-O1'], a.obs['A-O1v2'])
        self.assertFalse(ok)
        self.assertTrue(any('指標定義が違います' in x for x in why))
        self.assertEqual(a.norm['A-O1']['value'], 120)  # 上書きされない


class Rollups(unittest.TestCase):
    def ru(self, d, pid):
        return next(x for x in M.rollups(d) if x['parent']['id'] == pid)

    def test_parent_children_no_double_count(self):
        b = ready('ms-beta.json')
        r = self.ru(b, 'B-O1')
        self.assertEqual((r['sum'], r['diff']), (50, 0))
        self.assertTrue(any('足しません' in x for x in r['notes']))
        # どの出力にも 親＋子 の値（100）は出ない
        doc = M.render_dataset('ms-beta.json', b.ds, M.Check('ms-beta'))
        self.assertNotIn('>100<', doc)

    def test_mismatch_is_reported_not_resolved(self):
        r = self.ru(ready('ms-beta.json'), 'B-O8')
        self.assertEqual((r['sum'], r['diff']), (310000, -10000))
        self.assertTrue(any('JPY -10,000' in x for x in r['notes']))

    def test_unique_people_not_summed(self):
        r = self.ru(ready('ms-beta.json'), 'B-O11')
        self.assertIsNone(r['sum'])
        self.assertTrue(any('人数' in x for x in r['notes']))

    def test_missing_creative_id_is_unattributed_not_zero(self):
        b = ready('ms-beta.json')
        r = self.ru(b, 'B-O2')
        self.assertEqual(r['no_rows'], ['B-CR-2'])
        self.assertEqual(r['sum'], 30)
        self.assertTrue(any('0 として扱っていません' in x for x in r['notes']))
        self.assertTrue(any('未紐付け' in x for x in r['notes']))
        self.assertIsNone(b.match(b.obs['B-O5'])[1])
        self.assertEqual(b.norm['B-O5']['value'], 12)  # 成果は捨てずに未紐付けとして残す

    def test_child_blank_blocks_sum(self):
        r = self.ru(ready('ms-beta.json', lambda x: obs(x, 'B-O3').update(raw='')), 'B-O1')
        self.assertIsNone(r['sum'])
        self.assertTrue(any('空欄' in x for x in r['notes']))


class Timezone(unittest.TestCase):
    def test_iana_name_kept_and_dst_checked(self):
        b = ready('ms-beta.json')
        self.assertEqual(b.tz(b.obs['B-O14']), 'America/Los_Angeles')
        # 10月の太平洋時間は夏時間（-07:00）。-08:00 は誤り
        _, ck = ds('ms-beta.json', lambda x: x['sources'][1].update(data_cutoff='2026-10-01T00:00:00-08:00'))
        self.assertIn('BAD_TZ', codes(ck))
        _, ck = ds('ms-alpha.json', lambda x: x['sources'][0].update(data_cutoff='2026-10-01T00:00:00+08:00'))
        self.assertIn('BAD_TZ', codes(ck))

    def test_unknown_timezone_stops(self):
        for tz in ('Asia/Tokio', 'JST', 'Mars/Base', '', ' Asia/Tokyo', None, 9, 'localtime'):
            _, ck = ds(mut=lambda x: x['sources'][0].update(timezone=tz))
            self.assertIn('BAD_TZ', codes(ck), repr(tz))

    def test_unvalidated_when_zoneinfo_missing(self):
        with mock.patch.object(M, 'zoneinfo', None):
            self.assertEqual(M.tz_status('Asia/Tokyo')[0], M.TZ_UNVALIDATED)
            raw, ck = ds()
            self.assertEqual(ck.errors, [])  # 止めずに「未検証」として持つ
            d = M.Dataset(raw)
            self.assertTrue(d.maturity(d.obs['A-O5'])[0])
            r = ratio(d, 'A-R1')
            self.assertEqual((r['kind'], r['value']), ('blocked', None))
            ok, why = M.comparability(d, d.obs['A-O5'], d.obs['A-O7'])
            self.assertFalse(ok)
            self.assertTrue(any('未検証' in x for x in why))
            doc = M.render_dataset('ms-alpha.json', raw, ck)
            self.assertIn('未検証', doc)
            self.assertNotIn('conversion rate（確定）', doc)

    def test_unvalidated_when_tz_database_missing(self):
        import zoneinfo as real

        class Fake:
            ZoneInfoNotFoundError = real.ZoneInfoNotFoundError

            @staticmethod
            def ZoneInfo(name):
                raise real.ZoneInfoNotFoundError(name)
        with mock.patch.object(M, 'zoneinfo', Fake):
            self.assertEqual(M.tz_status('Asia/Tokyo')[0], M.TZ_UNVALIDATED)
            self.assertEqual(M.tz_status('Asia/Tokio')[0], M.TZ_UNVALIDATED)  # 未知かどうかも分からない
            self.assertEqual(M.tz_status('')[0], M.TZ_UNKNOWN)

    def test_marketing_lab_period_timezone(self):
        bm = {n: b for n, b in ml.load_dir(FIX)}
        bm['potex.json']['campaigns'][0]['results']['periods'][0]['timezone'] = 'Asia/Tokio'
        res = {n: ck for n, b, ck in ml.validate_all(sorted(bm.items()), NOW)}
        self.assertIn('BAD_TZ', [x['code'] for x in res['potex.json'].errors])
        with mock.patch.object(M, 'zoneinfo', None):
            bm = {n: b for n, b in ml.load_dir(FIX)}
            c = bm['passlabo.json']['campaigns'][0]
            r = ml.compare(bm['passlabo.json'], c['results'], {'a': 'PL-P1', 'b': 'PL-P2'})
            self.assertTrue(any('未検証' in x for x in r['blocked']))


class Validation(unittest.TestCase):
    def test_non_synthetic_source_ref(self):
        for ref in ('https://docs.google.com/spreadsheets/d/xxx', 'sheet:abc', '', None):
            _, ck = ds(mut=lambda x: x['sources'][0].update(ref=ref))
            self.assertIn('BAD_SOURCE', codes(ck), ref)

    def test_demo_and_synthetic_flags(self):
        _, ck = ds(mut=lambda x: x.update(synthetic=False))
        self.assertIn('SCHEMA', codes(ck))

    def test_cutoff_after_fetch_and_future_fetch(self):
        _, ck = ds(mut=lambda x: x['sources'][0].update(data_cutoff='2026-10-03T00:00:00+09:00'))
        self.assertIn('DATE_ORDER', codes(ck))
        _, ck = ds(mut=lambda x: x['sources'][0].update(fetched_at='2026-10-06T09:00:00+09:00'))
        self.assertIn('DATE_ORDER', codes(ck))

    def test_cohort_rules(self):
        _, ck = ds(mut=lambda x: obs(x, 'A-O5').pop('cohort'))
        self.assertIn('MISSING', codes(ck))
        _, ck = ds(mut=lambda x: obs(x, 'A-O5')['cohort'].update(observation_end='2026-08-15'))
        self.assertIn('DATE_ORDER', codes(ck))
        _, ck = ds(mut=lambda x: obs(x, 'A-O1').update(cohort={'start': S_, 'end': S_, 'observation_end': S_}))
        self.assertIn('BAD_VALUE', codes(ck))

    def test_currency_definition_rules(self):
        _, ck = ds('ms-beta.json', lambda x: x['metric_definitions'][2].pop('cost_basis'))
        self.assertIn('MISSING', codes(ck))
        _, ck = ds('ms-beta.json', lambda x: x['metric_definitions'][0].update(currency='JPY'))
        self.assertIn('BAD_VALUE', codes(ck))

    def test_hierarchy_rules(self):
        _, ck = ds('ms-beta.json', lambda x: x['nodes'][3].update(parent='B-CMP-1'))
        self.assertIn('UNKNOWN_REF', codes(ck))
        _, ck = ds('ms-beta.json', lambda x: obs(x, 'B-O4').update(node='B-CR-1'))
        self.assertIn('BAD_VALUE', codes(ck))

    def test_unknown_refs_and_dups(self):
        _, ck = ds(mut=lambda x: obs(x, 'A-O1').update(metric={'id': 'A-REG', 'version': 'v9'}))
        self.assertIn('UNKNOWN_REF', codes(ck))
        _, ck = ds(mut=lambda x: x['ratios'].append(dict(x['ratios'][0])))
        self.assertIn('DUP_ID', codes(ck))

    def test_broken_structures_do_not_crash(self):
        cases = [lambda x: x.update(observations='x'), lambda x: x.update(sources=[1]),
                 lambda x: x['observations'][0].update(period='x'), lambda x: x['observations'][0].update(metric=None),
                 lambda x: x['observations'][0].update(creative_id_raw=5), lambda x: x.pop('business'),
                 lambda x: x['metric_definitions'][3].update(population_of='A-REG-C')]
        for i, mut in enumerate(cases):
            with self.subTest(i=i):
                bm = base()
                mut(bm['ms-alpha.json'])
                res = M.validate_all(sorted(bm.items()), NOW)
                self.assertTrue(res[0][2].errors)
                self.assertEqual(res[1][2].errors, [])
                for tab, sec in M.render_all(res):
                    self.assertTrue(sec)

    def test_load_rejects_nonfinite_and_broken(self):
        with tempfile.TemporaryDirectory() as d:
            for txt in ('{"raw": 1e999}', '{"raw": NaN}', '[1,'):
                with io.open(os.path.join(d, 'x.json'), 'w', encoding='utf-8') as f:
                    f.write(txt)
                self.assertIsInstance(M.load_dir(d)[0][1], M.MeasurementError, txt)
        self.assertEqual(M.load_dir(os.path.join(ROOT, 'no-such-dir')), [])


class MonthBoundary(unittest.TestCase):
    """報告月の境界（架空の日付だけ）。
    注意: 個々の出来事の timestamp を報告月に振り分ける処理は実装していない。観測行は報告期間（日付）で集計済みの値を持つ。
    ここで確かめるのは、実装済みの「データ cutoff の瞬間で、報告 timezone の暦月が締まったか／その月に値があってよいか」の境界だけ"""

    def alpha(self, cutoff, keep_oct=False, now=NOW):
        raw = base()['ms-alpha.json']
        raw['sources'][0].update(data_cutoff=cutoff, fetched_at='2026-10-02T09:00:00+09:00')
        if not keep_oct:
            obs(raw, 'A-O12')['raw'] = None   # 10月の行は空欄にする（比較 A-C5 の参照は残す）
        return raw, M.validate(raw, now)

    def test_utc_instant_of_tokyo_month_start_closes_september(self):
        # 2026-09-30T15:00:00Z は Asia/Tokyo の 10/01 00:00 と同じ瞬間。9月は丸ごと入っている
        for cut in ('2026-09-30T15:00:00Z', '2026-09-30T15:00:00+00:00', '2026-10-01T00:00:00+09:00'):
            raw, ck = self.alpha(cut)
            self.assertEqual(ck.errors, [], cut)
            d = M.Dataset(raw)
            self.assertFalse(d.maturity(d.obs['A-O1'])[0], cut)    # 9月（発生日）は締まった
            self.assertFalse(d.maturity(d.obs['A-O5'])[0], cut)    # 観測終了 9/30 の cohort も締まった
            self.assertEqual(ratio(d, 'A-R1')['kind'], 'cvr')

    def test_one_second_before_month_start_is_still_september(self):
        for cut in ('2026-09-30T14:59:59Z', '2026-09-30T23:59:59+09:00'):
            raw, ck = self.alpha(cut)
            self.assertEqual(ck.errors, [], cut)
            d = M.Dataset(raw)
            self.assertTrue(d.maturity(d.obs['A-O1'])[0], cut)
            self.assertEqual(ratio(d, 'A-R1')['kind'], 'provisional')

    def test_exact_next_month_start_is_not_in_previous_month(self):
        # cutoff が 10/01 00:00（Tokyo）ちょうどなら、その瞬間は10月の始まりで9月には入らない。
        # だから10月の行に値があれば矛盾（10月の出来事は1件も入っていないはず）
        for cut in ('2026-09-30T15:00:00Z', '2026-10-01T00:00:00+09:00'):
            raw, ck = self.alpha(cut, keep_oct=True)
            self.assertIn('DATE_ORDER', codes(ck), cut)
            self.assertTrue(any(x['where'] == 'observations/A-O12' for x in ck.errors))
        # 1秒でも10月に入っていれば、10月の値はありうる（未成熟として持つ）
        raw, ck = self.alpha('2026-09-30T15:00:01Z', keep_oct=True)
        self.assertEqual(ck.errors, [])
        d = M.Dataset(raw)
        self.assertTrue(d.maturity(d.obs['A-O12'])[0])

    def test_zero_or_blank_after_cutoff_is_not_contradiction(self):
        for raw_v in (0, '', None):
            raw = base()['ms-alpha.json']
            raw['sources'][0]['data_cutoff'] = '2026-10-01T00:00:00+09:00'
            obs(raw, 'A-O12')['raw'] = raw_v
            self.assertEqual(M.validate(raw, NOW).errors, [], repr(raw_v))

    def test_absent_timezone_is_not_utc(self):
        raw = base()['ms-alpha.json']
        raw['sources'][0].pop('timezone')
        raw['sources'][0]['data_cutoff'] = '2026-09-30T15:00:00Z'
        self.assertIn('BAD_TZ', codes(M.validate(raw, NOW)))

    def test_unsupported_environment_does_not_fall_back_to_utc(self):
        with mock.patch.object(M, 'zoneinfo', None):
            raw, ck = self.alpha('2026-09-30T15:00:00Z')
            self.assertEqual(ck.errors, [])           # 止めずに「未検証」として持つ
            d = M.Dataset(raw)
            closed, why = d.maturity(d.obs['A-O1'])
            self.assertTrue(closed)                    # UTC とみなして「9月は締まった」とは言わない
            self.assertIn('未検証', why)
            self.assertEqual(ratio(d, 'A-R1')['kind'], 'blocked')
            raw2, ck2 = self.alpha('2026-09-30T15:00:00Z', keep_oct=True)
            self.assertEqual(ck2.errors, [])           # 境界の矛盾も、timezone が検証できない以上は判定しない（止めるのは比・比較）

    def test_marketing_lab_period_close_uses_cutoff_in_report_timezone(self):
        def run_(su, fa):
            bm = {n: b for n, b in ml.load_dir(FIX)}
            p = bm['passlabo.json']['campaigns'][0]['results']['periods'][1]   # 期間終了 2026-09-28
            p.update(source_updated_at=su, fetched_at=fa)
            res = {n: ck for n, b, ck in ml.validate_all(sorted(bm.items()), NOW)}
            return [x['code'] for x in res['passlabo.json'].errors]
        # 監査1: 最終日の当日に更新・取得した値は締まっていない
        self.assertIn('DATE_ORDER', run_('2026-09-28T07:00:00+09:00', '2026-09-28T09:00:00+09:00'))
        # 9/29 00:00 JST と同じ瞬間（UTC 表記）なら締まっている
        self.assertEqual(run_('2026-09-28T15:00:00Z', '2026-09-29T09:00:00+09:00'), [])
        self.assertIn('DATE_ORDER', run_('2026-09-28T14:59:59Z', '2026-09-29T09:00:00+09:00'))


class AuditFindings(unittest.TestCase):
    """監査役レビュー（合成fixtureで再現）で採用した修正の回帰テスト"""

    def test_2_cohort_observation_window(self):
        def mut(d):
            for i, v in (('A-O20', 100), ('A-O21', 30)):
                o = copy.deepcopy(obs(d, 'A-O5' if i == 'A-O20' else 'A-O6'))
                o.update(id=i, raw=v, period={'start': '2026-07-01', 'end': '2026-07-31'},
                         cohort={'start': '2026-07-01', 'end': '2026-07-31', 'observation_end': '2026-09-30'})
                d['observations'].append(o)
            d['ratios'].append({'id': 'A-R7', 'intent': 'conversion', 'numerator': 'A-O21', 'denominator': 'A-O20'})
        a = ready(mut=mut)
        ok, why = M.comparability(a, a.obs['A-O21'], a.obs['A-O6'])
        self.assertFalse(ok)
        self.assertTrue(any('観測期間の長さが違います' in x for x in why))
        r7, r1 = ratio(a, 'A-R7'), ratio(a, 'A-R1')
        self.assertEqual((r7['kind'], r1['kind']), ('cvr', 'cvr'))
        self.assertTrue(any('cohort 終了後 61日' in x for x in r7['notes']))
        self.assertTrue(any('cohort 終了後 30日' in x for x in r1['notes']))

    def billing_beta(self, extra_ratio):
        def mut(d):
            d['metric_definitions'].append({'id': 'B-FEE', 'version': 'v1', 'label': '請求対象', 'unit': 'rows',
                                            'basis': 'occurrence', 'purpose': 'billing'})
            d['observations'].append({'id': 'B-OF', 'metric': {'id': 'B-FEE', 'version': 'v1'}, 'source': 'SRC-B1',
                                      'cell': 'Z1', 'level': 'campaign', 'node': 'B-CMP-1',
                                      'period': {'start': '2026-09-01', 'end': '2026-09-30'}, 'raw': 10})
            d['ratios'].append(extra_ratio)
        return ready('ms-beta.json', mut)

    def test_3_billing_not_in_cost_per(self):
        b = self.billing_beta({'id': 'B-R9', 'intent': 'cost_per', 'numerator': 'B-O8', 'denominator': 'B-OF'})
        r = ratio(b, 'B-R9')
        self.assertEqual((r['kind'], r['value']), ('blocked', None))
        self.assertTrue(any('手数料請求' in x for x in r['reasons']))

    def test_4_rule_ref_by_id(self):
        _, ck = ds(mut=lambda x: x['metric_definitions'][1].update(rule_ref={'id': 'A-FEE', 'version': 'v1'}))
        self.assertIn('BILLING_RULE', codes(ck))
        _, ck = ds(mut=lambda x: x['metric_definitions'][1].update(rule_ref={'id': 'A-NONE', 'version': 'v1'}))
        self.assertIn('UNKNOWN_REF', codes(ck))
        _, ck = ds(mut=lambda x: x['metric_definitions'][1].update(rule_ref={'id': 'A-REG', 'version': 'v1'}))
        self.assertEqual(ck.errors, [])  # マーケ定義どうしの参照は可

    def test_5_immature_count_ratio_blocked(self):
        def mut(d):
            d['observations'].append({'id': 'A-OX', 'metric': {'id': 'A-CONS', 'version': 'v1'}, 'source': 'SRC-A1',
                                      'cell': 'Z', 'level': 'campaign', 'node': 'A-CMP-WEB',
                                      'period': {'start': '2026-10-01', 'end': '2026-10-31'}, 'raw': 1})
            d['ratios'].append({'id': 'A-RX', 'intent': 'conversion', 'numerator': 'A-OX', 'denominator': 'A-O12'})
        r = ratio(ready(mut=mut), 'A-RX')
        self.assertEqual((r['kind'], r['value']), ('blocked', None))
        self.assertTrue(any('期間が締まっていない' in x for x in r['reasons']))

    def test_6_cost_per_label_follows_denominator(self):
        def mut(d):
            d['ratios'].append({'id': 'B-R10', 'intent': 'cost_per', 'numerator': 'B-O8', 'denominator': 'B-O11'})
        b = ready('ms-beta.json', mut)
        r = ratio(b, 'B-R10')
        self.assertEqual(r['kind_label'], '費用 ÷ 人数（ユニーク）')
        self.assertTrue(any('費用 ÷ 人数（ユニーク）' in x for x in r['notes']))
        self.assertEqual(ratio(b, 'B-R1')['kind_label'], '費用 ÷ 行数')
        doc = M.render_dataset('ms-beta.json', b.ds, M.Check('beta'))
        self.assertIn('費用 ÷ 人数（ユニーク）', doc)

    def test_7_localtime_is_not_iana(self):
        for n in ('localtime', 'Factory', 'posixrules', 'Japan', 'right/Asia/Tokyo', 'posix/Asia/Tokyo'):
            self.assertEqual(M.tz_status(n)[0], M.TZ_UNKNOWN, n)
        self.assertEqual(M.tz_status('Asia/Tokyo')[0], M.TZ_VALID)
        self.assertEqual(M.tz_status('America/Los_Angeles')[0], M.TZ_VALID)


S_ = '2026-09-01'


class UI(unittest.TestCase):
    def doc(self, mdir=MFIX):
        return ml.build(FIX, NOW, TODAY, measurement_dir=mdir)[0]

    def test_tabs_and_sections(self):
        doc = self.doc()
        for sid in ('alpha', 'beta'):
            self.assertIn('href="#ms-%s"' % sid, doc)
            self.assertIn('id="ms-%s"' % sid, doc)
        self.assertIn('合成データです', doc)

    def test_raw_and_state_visible(self):
        doc = self.doc()
        sec = doc.split('id="ms-alpha"')[1].split('</section>')[0]
        for s in ('&quot;#REF!&quot;', '&quot;&quot;', 'null', '0（実測）', '空欄', '元データエラー', '取得不可', '対象外',
                  'open cohort', '暫定比（未成熟・CVRではない）', '件数比（CVRではない）', 'conversion rate（確定）',
                  '計算しない', '判定不可', 'synthetic://alpha/register-table', 'C10'):
            self.assertIn(s, sec, s)
        # 確定CVRのバッジは、締まった cohort の1件だけ
        self.assertEqual(sec.count('conversion rate（確定）'), 1)

    def test_marketing_lab_labels_not_cvr(self):
        doc = self.doc()
        sec = doc.split('id="biz-t-clinic"')[1].split('</section>')[0]
        self.assertIn('件数比 予約÷クリック（同期間・CVRではない）', sec)
        self.assertNotIn('<td>CVR</td>', doc)
        self.assertIn('空欄（原値 &quot;&quot;）', sec)
        self.assertIn('元データエラー（原値 &quot;#REF!&quot;）', sec)
        self.assertIn('来院 が空欄（ゼロではありません）', sec)

    def test_marketing_lab_state_objects(self):
        bm = {n: b for n, b in ml.load_dir(FIX)}
        p = bm['t-clinic.json']['campaigns'][0]['results']['periods'][1]
        r = {x['name']: x for x in ml.metrics(bm['t-clinic.json'], p)}
        self.assertEqual(r['予約→来院']['why'], '分子が空欄')
        self.assertEqual(r['来院→契約']['why'], '分子が元データエラー（数式エラー #REF!）')
        p['counts']['reserve'] = {'raw': '0'}
        r = {x['name']: x for x in ml.metrics(bm['t-clinic.json'], p)}
        self.assertEqual(r['CVR']['text'], '0.00%')   # 0（実測）は 0 のまま
        p['counts']['reserve'] = {'raw': 3, 'extra': 1}
        res = {n: ck for n, b, ck in ml.validate_all(sorted(bm.items()), NOW)}
        self.assertIn('BAD_VALUE', [x['code'] for x in res['t-clinic.json'].errors])

    def test_marketing_lab_compare_blocks_cost_basis(self):
        bm = {n: b for n, b in ml.load_dir(FIX)}
        c = bm['passlabo.json']['campaigns'][0]
        c['results']['periods'][1]['cost_basis'] = '媒体費・税込（デモ定義）'
        r = ml.compare(bm['passlabo.json'], c['results'], {'a': 'PL-P1', 'b': 'PL-P2'})
        self.assertTrue(any('費用基準' in x for x in r['blocked']))

    def test_escape(self):
        bm = base()
        evil = '<img src=x onerror=alert(1)>"\''
        bm['ms-alpha.json']['business']['name'] = evil
        obs(bm['ms-alpha.json'], 'A-O3')['raw'] = evil
        bm['ms-alpha.json']['ratios'][0]['label'] = evil
        with tempfile.TemporaryDirectory() as d:
            for n, x in bm.items():
                with io.open(os.path.join(d, n), 'w', encoding='utf-8') as f:
                    json.dump(x, f, ensure_ascii=False, default=str)
            doc = self.doc(d)
        self.assertNotIn('<img src=x', doc)
        self.assertIn('&lt;img src=x onerror=alert(1)&gt;', doc)

    def test_no_actions_no_network_no_inf(self):
        doc = self.doc().lower()
        for bad in ('<button', '<form', '<input', 'fetch(', 'xmlhttprequest', 'infinity', 'nan%', ' nan<'):
            self.assertNotIn(bad, doc)
        import ast
        with io.open(os.path.join(ROOT, 'scripts', 'measurement.py'), encoding='utf-8') as f:
            tree = ast.parse(f.read())
        mods = {a.name.split('.')[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
        self.assertFalse(mods & {'urllib', 'requests', 'socket', 'http', 'subprocess', 'smtplib'})

    def test_empty_measurement_dir_stops_visibly(self):
        with tempfile.TemporaryDirectory() as d:
            doc = self.doc(d)
        self.assertIn('計測の合成 fixture が1件もありません', doc)

    def test_reproducible(self):
        self.assertEqual(self.doc(), self.doc())


if __name__ == '__main__':
    unittest.main()
