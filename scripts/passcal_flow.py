# -*- coding: utf-8 -*-
"""
claude-hub/scripts/passcal_flow.py

PASSCAL の架空1導線（フォーム回答 → 面談到達 → 入塾到達）。
架空イベントを、既存の計測レイヤー（marketing-lab/measurement/v1）の集計形式へ変換する薄い1層と、
その同じ集計だけを読む経営画面 S0〜S5。

- 入力は data/marketing-lab/events/*.json の架空イベントだけ。実データ・シート・API にはつながない
- 画面は adapter の出力（measurement データセット＋採否の記録）だけを読む。画面ごとに数字を持たない
- 推測で数字に入れない。曖昧・矛盾したイベントは、除外・保留の理由とイベントIDを残す
- 定義は架空データ仕様。実事業の確定定義ではない
"""
import datetime
import decimal
import io
import json
import os
import re

import measurement as M

SCHEMA = 'marketing-lab/events/v1'
APP_ID = re.compile(r'^APP-\d{4}$')
TYPES = ('form_submitted', 'interview_booked', 'interview_cancelled', 'interview_held', 'enrollment_completed')

# 採否の理由。status: excluded（数字に入れない・理由が明確）／held（矛盾・曖昧で保留）／
# dropped（重複として捨てた）／context（数えないが文脈として採用）
REASONS = {
    'RESENT': ('dropped', '同じイベントの再送（event_id と中身が同じ）。1回だけ数える'),
    'CONFLICT_DUP_ID': ('held', '同じ event_id で中身が違う。どちらが正しいか決められないので両方保留'),
    'NO_EVENT_ID': ('excluded', 'event_id がない'),
    'UNKNOWN_TYPE': ('excluded', 'この導線の集計対象ではないイベント種別'),
    'PAYMENT_OUT_OF_SCOPE': ('excluded', '入金は会計側の事実。この導線では取り込まない（未接続）'),
    'BAD_APP_ID': ('excluded', '応募ID が無い、または形式（APP-4桁）が違う'),
    'NO_DATE': ('excluded', '日時がない（日付欠損）'),
    'BAD_DATE': ('excluded', '日時として読めない（不正日付）'),
    'NO_TZ': ('excluded', '日時に時差がない（timezone 欠損）。推測で timezone を補わない'),
    'AFTER_CUTOFF': ('excluded', 'データ cutoff 以降の出来事。この取得の範囲外'),
    'REANSWER': ('dropped', '同じ応募IDの再回答。初回の回答を採用し、再回答は数えない'),
    'OUT_OF_COHORT': ('excluded', '応募日がどのコホートにも入らない'),
    'ORPHAN': ('held', '採用された応募（フォーム回答）がない応募IDのイベント'),
    'BEFORE_APPLICATION': ('held', '応募より前の日時（矛盾）'),
    'CANCELLED_BOOKING': ('held', '取消済みの予約での面談実施（矛盾）'),
    'OUTSIDE_WINDOW': ('excluded', '応募コホートの観察窓の外'),
    'BOOKING_ONLY': ('context', '予約確定・取消は面談実施ではないので数えない'),
    'REPEAT_INTERVIEW': ('context', '同じ応募IDの2回目以降の面談。到達は1回として数える'),
    'COUNTED': ('adopted', '集計に採用'),
}
STATUS_JA = {'adopted': '採用', 'context': '数えない（文脈）', 'dropped': '重複として除く',
             'excluded': '除外', 'held': '保留'}


class FlowError(Exception):
    pass


def load(path):
    try:
        with io.open(path, encoding='utf-8') as f:
            return json.load(f, parse_float=M._parse_float, parse_constant=M._reject_constant)
    except (OSError, ValueError, M.MeasurementError) as ex:
        raise FlowError('架空イベントを読めません: %s' % ex)


def _parse_at(v):
    """(datetime | None, 理由コード | None)"""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None, 'NO_DATE'
    if not isinstance(v, str):
        return None, 'BAD_DATE'
    try:
        d = datetime.datetime.fromisoformat(v)
    except ValueError:
        return None, 'BAD_DATE'
    if d.tzinfo is None:
        return None, 'NO_TZ'
    return d, None


def _canon(e):
    return json.dumps(e, sort_keys=True, ensure_ascii=False, default=str)


class Result:
    def __init__(self):
        self.errors = []          # 検証停止の理由（あれば画面は数字を出さない）
        self.doc = None
        self.dataset = None       # measurement/v1 の形
        self.trace = []           # イベントごとの採否
        self.apps = {}            # 応募ID → 採用した応募
        self.cohort_apps = {}     # コホートID → 応募IDのリスト
        self.reached = {}         # (指標, コホートID) → {応募ID: [採用イベントID]}
        self.partition = {}       # コホートID → {帰属のキー: [応募ID]}
        self.zi = None

    def err(self, where, msg):
        self.errors.append({'code': 'FLOW', 'where': where, 'msg': msg})


def _validate_doc(r, doc, now):
    if not isinstance(doc, dict):
        r.err('/', 'オブジェクトが必要です')
        return
    if doc.get('schema') != SCHEMA:
        r.err('schema', '%s ではありません' % SCHEMA)
    if doc.get('demo') is not True or doc.get('synthetic') is not True:
        r.err('demo', '架空イベントは demo: true と synthetic: true が必須です')
    src = doc.get('source')
    if not isinstance(src, dict):
        r.err('source', 'source がありません')
        return
    if not (isinstance(src.get('ref'), str) and src['ref'].startswith('synthetic://')):
        r.err('source/ref', '出典は synthetic:// の架空 placeholder に限ります')
    st, zi, msg = M.tz_status(src.get('timezone'))
    if st != M.TZ_VALID:
        # 応募日・観察窓は報告 timezone の暦日で決まる。検証できないなら推測せず止める（UTC にもしない）
        r.err('source/timezone', 'timezone %r は%s。応募日と観察窓を決められないため変換を止めます'
              % (src.get('timezone'), M.TZ_JA[st]))
        return
    r.zi = zi
    cut, got = M._dt(src.get('data_cutoff')), M._dt(src.get('fetched_at'))
    if cut is None or got is None:
        r.err('source', 'data_cutoff / fetched_at は時差付きの日時が必要です')
        return
    if not (M.offset_ok(cut, zi) and M.offset_ok(got, zi)):
        r.err('source', '日時の時差が timezone と一致しません')
    if cut > got or got > now:
        r.err('source', 'cutoff ≤ 取得時刻 ≤ 現在 の順になっていません')
    if not (isinstance(doc.get('definition_version'), str) and doc['definition_version']):
        r.err('definition_version', '定義版がありません')
    cos = doc.get('cohorts')
    if not isinstance(cos, list) or not cos:
        r.err('cohorts', 'コホートがありません')
        return
    seen = set()
    for c in cos:
        d = [M._date((c or {}).get(k)) for k in ('start', 'end', 'observation_end')] if isinstance(c, dict) else [None]
        if not isinstance(c, dict) or None in d or not (d[0] <= d[1] <= d[2]) or not isinstance(c.get('id'), str):
            r.err('cohorts', 'コホートの id / start ≤ end ≤ observation_end が不正です')
            return
        if c['id'] in seen:
            r.err('cohorts', 'コホートIDが重複しています: %s' % c['id'])
        seen.add(c['id'])
    days = sorted((M._date(c['start']), M._date(c['end'])) for c in cos)
    for (s1, e1), (s2, e2) in zip(days, days[1:]):
        if s2 <= e1:
            r.err('cohorts', 'コホートの期間が重なっています（1つの応募が2つのコホートに入る）')
    if not isinstance(doc.get('events'), list):
        r.err('events', 'events は配列が必要です')
    for k in ('spend', 'decisions', 'unconnected', 'creatives_in_flight'):
        if not isinstance(doc.get(k), list):
            r.err(k, '%s は配列が必要です' % k)
    if not isinstance(doc.get('plan_ref'), dict):
        r.err('plan_ref', '施策票への参照がありません')
    ids = set()
    for sp in doc.get('spend') if isinstance(doc.get('spend'), list) else []:
        per = sp.get('period') if isinstance(sp, dict) else None
        ps = M._date((per or {}).get('start')) if isinstance(per, dict) else None
        pe = M._date((per or {}).get('end')) if isinstance(per, dict) else None
        if not isinstance(sp, dict) or not isinstance(sp.get('id'), str) or ps is None or pe is None or ps > pe:
            r.err('spend', '費用の id と期間（start ≤ end）が必要です')
        elif sp['id'] in ids:
            r.err('spend', '費用の id が重複しています: %s' % sp['id'])
        else:
            ids.add(sp['id'])


def adapt(doc, now):
    """架空イベント → measurement/v1 データセット＋採否の記録"""
    r = Result()
    r.doc = doc
    try:
        _validate_doc(r, doc, now)
        if r.errors:
            return r
        _process(r, doc)
        if not r.errors:
            r.dataset = _to_measurement(r, doc)
    except Exception as ex:  # 想定外の形でも画面全体は落とさない
        r.errors.append({'code': 'INTERNAL', 'where': '/', 'msg': '変換中に想定外の値で止まりました: %s' % type(ex).__name__})
    return r


def _mark(r, e, code, cohort=None, note=''):
    st, txt = REASONS[code]
    r.trace.append({'event_id': e.get('event_id') if isinstance(e, dict) else None,
                    'type': e.get('type') if isinstance(e, dict) else None,
                    'application_id': e.get('application_id') if isinstance(e, dict) else None,
                    'at': e.get('at') if isinstance(e, dict) else None,
                    'status': st, 'code': code, 'reason': txt + (('（%s）' % note) if note else ''),
                    'cohort': cohort})


def _process(r, doc):
    zi = r.zi
    src = doc['source']
    cut = M._dt(src['data_cutoff'])
    cohorts = doc['cohorts']

    def cohort_of(day):
        for c in cohorts:
            if M._date(c['start']) <= day <= M._date(c['end']):
                return c
        return None

    def window_end(c):
        # 観察窓は observation_end の暦日の終わりまで（翌日 0:00 より前）
        return datetime.datetime.combine(M._date(c['observation_end']) + datetime.timedelta(days=1),
                                         datetime.time(0), tzinfo=zi)

    # 1. event_id の重複（再送か矛盾か）
    groups = {}
    order = []
    for e in doc['events']:
        if not isinstance(e, dict) or not isinstance(e.get('event_id'), str) or not e['event_id'].strip():
            _mark(r, e if isinstance(e, dict) else {}, 'NO_EVENT_ID')
            continue
        if e['event_id'] not in groups:
            order.append(e['event_id'])
        groups.setdefault(e['event_id'], []).append(e)
    live = []
    for eid in order:
        g = groups[eid]
        if len({_canon(x) for x in g}) > 1:
            for x in g:
                _mark(r, x, 'CONFLICT_DUP_ID')
            continue
        live.append(g[0])
        for x in g[1:]:
            _mark(r, x, 'RESENT')

    # 2. 種別・応募ID・日時・cutoff
    ok = []
    for e in live:
        t = e.get('type')
        if t == 'payment_recorded':
            _mark(r, e, 'PAYMENT_OUT_OF_SCOPE')
            continue
        if t not in TYPES:
            _mark(r, e, 'UNKNOWN_TYPE')
            continue
        a = e.get('application_id')
        if not (isinstance(a, str) and APP_ID.match(a)):
            _mark(r, e, 'BAD_APP_ID')
            continue
        at, why = _parse_at(e.get('at'))
        if why:
            _mark(r, e, why)
            continue
        if at >= cut:
            _mark(r, e, 'AFTER_CUTOFF')
            continue
        ok.append((e, at))

    # 3. 応募（初回のフォーム回答）
    forms = {}
    for e, at in ok:
        if e['type'] == 'form_submitted':
            forms.setdefault(e['application_id'], []).append((at, e))
    for a in sorted(forms):
        lst = sorted(forms[a], key=lambda x: (x[0], x[1]['event_id']))
        at, e = lst[0]
        for _, x in lst[1:]:
            _mark(r, x, 'REANSWER')
        day = at.astimezone(zi).date()
        c = cohort_of(day)
        if c is None:
            _mark(r, e, 'OUT_OF_COHORT', note='応募日 %s' % day.isoformat())
            continue
        _mark(r, e, 'COUNTED', cohort=c['id'], note='応募日 %s（%s）' % (day.isoformat(), src['timezone']))
        r.apps[a] = {'at': at, 'day': day, 'cohort': c, 'event': e,
                     'creative_raw': e.get('creative_id'), 'creative_present': 'creative_id' in e,
                     'lp': (e.get('lp_id'), e.get('lp_version'))}
        r.cohort_apps.setdefault(c['id'], []).append(a)

    # 4. 予約・面談・入塾
    cancels = {}
    for e, at in ok:
        if e['type'] == 'interview_cancelled' and isinstance(e.get('booking_id'), str):
            cancels.setdefault(e['booking_id'], []).append(at)
    for c in cohorts:
        for m in ('interview', 'enrollment'):
            r.reached[(m, c['id'])] = {}
    for e, at in sorted(ok, key=lambda x: (x[1], x[0]['event_id'])):
        t = e['type']
        if t == 'form_submitted':
            continue
        app = r.apps.get(e['application_id'])
        if app is None:
            _mark(r, e, 'ORPHAN')
            continue
        c = app['cohort']
        if t in ('interview_booked', 'interview_cancelled'):
            _mark(r, e, 'BOOKING_ONLY', cohort=c['id'])
            continue
        if at < app['at']:
            _mark(r, e, 'BEFORE_APPLICATION', cohort=c['id'])
            continue
        if at >= window_end(c):
            _mark(r, e, 'OUTSIDE_WINDOW', cohort=c['id'], note='観察窓は %s まで' % c['observation_end'])
            continue
        if t == 'interview_held':
            bk = e.get('booking_id')
            if isinstance(bk, str) and any(x <= at for x in cancels.get(bk, [])):
                _mark(r, e, 'CANCELLED_BOOKING', cohort=c['id'])
                continue
            got = r.reached[('interview', c['id'])]
            if e['application_id'] in got:
                got[e['application_id']].append(e['event_id'])
                _mark(r, e, 'REPEAT_INTERVIEW', cohort=c['id'])
                continue
            got[e['application_id']] = [e['event_id']]
            _mark(r, e, 'COUNTED', cohort=c['id'])
        elif t == 'enrollment_completed':
            got = r.reached[('enrollment', c['id'])]
            if e['application_id'] in got:
                got[e['application_id']].append(e['event_id'])
                _mark(r, e, 'REPEAT_INTERVIEW', cohort=c['id'], note='入塾手続きの重複')
                continue
            got[e['application_id']] = [e['event_id']]
            _mark(r, e, 'COUNTED', cohort=c['id'])

    # 5. creative の帰属（各応募IDはちょうど1つの帰属に入る）
    known = set(doc['creatives_in_flight'])
    for c in cohorts:
        part = {}
        for a in r.cohort_apps.get(c['id'], []):
            raw = r.apps[a]['creative_raw']
            if isinstance(raw, str) and raw.strip() in known:
                key = ('matched', raw.strip())
            elif raw is None or (isinstance(raw, str) and not raw.strip()):
                key = ('missing_id', '')
            else:
                key = ('unknown_id', str(raw))
            part.setdefault(key, []).append(a)
        total = sum(len(v) for v in part.values())
        if total != len(r.cohort_apps.get(c['id'], [])) or len({a for v in part.values() for a in v}) != total:
            r.err('partition', '%s の帰属が応募IDの分割になっていません' % c['id'])
        r.partition[c['id']] = part


def _local_period(c):
    return {'start': c['start'], 'end': c['end']}


def _to_measurement(r, doc):
    src = doc['source']
    dv = doc['definition_version']
    cohorts = doc['cohorts']
    defs = [
        {'id': 'PC-APP', 'version': dv, 'label': 'フォーム回答（応募ID）', 'unit': 'application_ids',
         'basis': 'application_cohort', 'purpose': 'marketing'},
        {'id': 'PC-INT', 'version': dv, 'label': '面談到達', 'unit': 'application_ids',
         'basis': 'application_cohort', 'purpose': 'marketing', 'population_of': {'id': 'PC-APP', 'version': dv}},
        {'id': 'PC-ENR', 'version': dv, 'label': '入塾到達（入金ではない）', 'unit': 'application_ids',
         'basis': 'application_cohort', 'purpose': 'marketing', 'population_of': {'id': 'PC-APP', 'version': dv}},
        {'id': 'PC-APP-OCC', 'version': dv, 'label': 'フォーム回答（応募ID・応募日の発生日基準）', 'unit': 'application_ids',
         'basis': 'occurrence', 'purpose': 'marketing'},
    ]
    nodes = [{'id': 'PC-CMP-1', 'level': 'campaign', 'parent': None, 'label': 'PASSCAL 架空導線'},
             {'id': 'PC-AD-1', 'level': 'ad', 'parent': 'PC-CMP-1', 'label': '架空広告'}]
    nodes += [{'id': cid, 'level': 'creative', 'parent': 'PC-AD-1'} for cid in doc['creatives_in_flight']]
    obs, ratios, comps = [], [], []

    def ob(oid, mid, raw, level, period, cohort=None, **kw):
        o = {'id': oid, 'metric': {'id': mid, 'version': dv}, 'source': src['id'],
             'cell': 'adapter:%s#%s' % (dv, oid), 'level': level, 'period': period, 'raw': raw}
        if cohort:
            o['cohort'] = cohort
        o.update(kw)
        obs.append(o)

    for c in cohorts:
        cid = c['id']
        per = _local_period(c)
        co = {'start': c['start'], 'end': c['end'], 'observation_end': c['observation_end']}
        apps = r.cohort_apps.get(cid, [])
        ob('O-APP-%s' % cid, 'PC-APP', len(apps), 'campaign', per, co, node='PC-CMP-1')
        ob('O-APP-AD-%s' % cid, 'PC-APP', len(apps), 'ad', per, co, node='PC-AD-1')
        ob('O-INT-%s' % cid, 'PC-INT', len(r.reached[('interview', cid)]), 'campaign', per, co, node='PC-CMP-1')
        ob('O-ENR-%s' % cid, 'PC-ENR', len(r.reached[('enrollment', cid)]), 'campaign', per, co, node='PC-CMP-1')
        for (kind, key), lst in sorted(r.partition.get(cid, {}).items()):
            oid = 'O-APP-CR-%s-%s' % (cid, key or kind)
            ob(oid, 'PC-APP', len(lst), 'creative', per, co, under='PC-AD-1', creative_id_raw=key)
        ratios.append({'id': 'R-INT-%s' % cid, 'label': '面談到達 ÷ フォーム回答（%s）' % c['label'],
                       'intent': 'conversion', 'numerator': 'O-INT-%s' % cid, 'denominator': 'O-APP-%s' % cid})
        ratios.append({'id': 'R-ENR-%s' % cid, 'label': '入塾到達 ÷ フォーム回答（%s）' % c['label'],
                       'intent': 'conversion', 'numerator': 'O-ENR-%s' % cid, 'denominator': 'O-APP-%s' % cid})
    if len(cohorts) >= 2:
        a, b = cohorts[0]['id'], cohorts[1]['id']
        comps.append({'id': 'C-INT-%s-%s' % (a, b), 'label': '面談到達 %s と %s' % (a, b),
                      'a': 'O-INT-%s' % a, 'b': 'O-INT-%s' % b})
    for sp in doc['spend']:
        mid = 'PC-COST-%s' % sp['id']
        defs.append({'id': mid, 'version': dv, 'label': sp.get('label') or '費用', 'unit': 'currency', 'basis': 'occurrence',
                     'purpose': 'marketing', 'currency': sp.get('currency'), 'cost_basis': sp.get('cost_basis')})
        per = sp['period']
        s, e = M._date(per.get('start')), M._date(per.get('end'))
        n_occ = len([a for a, v in r.apps.items() if s is not None and e is not None and s <= v['day'] <= e])
        ob('O-COST-%s' % sp['id'], mid, sp.get('raw'), 'campaign', per, node='PC-CMP-1')
        ob('O-APP-OCC-%s' % sp['id'], 'PC-APP-OCC', n_occ, 'campaign', per, node='PC-CMP-1')
        ratios.append({'id': 'R-CPA-%s' % per.get('start', '')[:7], 'label': '回答CPA（費用 ÷ フォーム回答）',
                       'intent': 'cost_per', 'numerator': 'O-COST-%s' % sp['id'], 'denominator': 'O-APP-OCC-%s' % sp['id']})
    return {'schema': M.SCHEMA, 'dataset_id': doc.get('dataset_id') or 'passcal-demo', 'demo': True, 'synthetic': True,
            'business': doc['business'],
            'note': '架空イベントから adapter が作った集計。実事業の数値ではない',
            'sources': [{'id': src['id'], 'ref': src['ref'], 'timezone': src['timezone'],
                         'data_cutoff': src['data_cutoff'], 'fetched_at': src['fetched_at']}],
            'metric_definitions': defs, 'nodes': nodes, 'observations': obs, 'ratios': ratios, 'comparisons': comps}


# ---------------------------------------------------------------- 画面が読む値（ここ以外で数字を作らない）

class View:
    """adapter の結果と measurement の評価をまとめた、画面共通の読み口"""

    def __init__(self, res, now, plan=None):
        self.res = res
        self.now = now
        self.plan = plan            # 既存施策票（passlabo fixture）。S2/S5 で版の対応だけに使う
        self.errors = list(res.errors)
        self.ds = None
        if not self.errors:
            ck = M.validate(res.dataset, now)
            self.errors += ck.errors
            if not ck.errors:
                self.ds = M.Dataset(res.dataset)

    @property
    def ok(self):
        return self.ds is not None

    def obs(self, oid):
        o = self.ds.obs[oid]
        n = self.ds.norm[oid]
        return o, n

    def value(self, oid):
        return self.ds.norm[oid]['value']

    def ratio(self, rid):
        r = next(x for x in self.res.dataset['ratios'] if x['id'] == rid)
        return M.evaluate_ratio(self.ds, r)

    def cohorts(self):
        return self.res.doc['cohorts']

    def by_status(self, status=None, code=None):
        return [t for t in self.res.trace if (status is None or t['status'] == status) and (code is None or t['code'] == code)]


def build_view(events_dir, now, plans=None):
    """events_dir の架空イベントを読み、View のリストを返す。plans: business_id → 検証済み施策票"""
    out = []
    if not events_dir or not os.path.isdir(events_dir):
        return out
    for fn in sorted(os.listdir(events_dir)):
        if not fn.endswith('.json'):
            continue
        try:
            doc = load(os.path.join(events_dir, fn))
            res = adapt(doc, now)
        except FlowError as ex:
            res = Result()
            res.errors.append({'code': 'SCHEMA', 'where': fn, 'msg': str(ex)})
        plan = None
        if isinstance(res.doc, dict) and isinstance(res.doc.get('plan_ref'), dict) and plans:
            plan = plans.get(res.doc['plan_ref'].get('business_id'))
        out.append((fn, View(res, now, plan)))
    return out


# ---------------------------------------------------------------- 描画

e = M.e
TABS = [('s0', 'S0 全体'), ('s1', 'S1 導線'), ('s2', 'S2 CR・LP'), ('s3', 'S3 お金'), ('s4', 'S4 品質と粒度'),
        ('s5', 'S5 判断履歴')]


def _banner(v):
    src = v.res.doc['source'] if isinstance(v.res.doc, dict) and isinstance(v.res.doc.get('source'), dict) else {}
    return ('<p class="warn">架空データの試作です。PASSCAL の実データ・実在の応募者・会計・広告・LINE・API には接続していません。'
            '定義は架空データ仕様で、実事業の確定定義ではありません。出典 <code>%s</code>（synthetic）。</p>' % e(src.get('ref')))


def _ratio_text(ev, ds):
    if ev['value'] is None:
        return '値を出しません'
    if ev['kind'] == 'cost_per':
        return M.fmt_cost_per(ev['value'], ds.d(ev['num']))
    return M.fmt_ratio(ev['value'])


def _ratio_html(v, rid, anchor=None):
    ev = v.ratio(rid)
    lab, cls = M.KIND_JA[ev['kind']]
    lab = ev.get('kind_label', lab)
    reasons = ev['reasons'] + ev['notes']
    return ('<span class="badge %s">%s</span> <b class="val" data-ratio="%s">%s</b>%s%s' % (
        cls, e(lab), e(rid), e(_ratio_text(ev, v.ds)),
        ' <a class="small" href="#%s">根拠</a>' % e(anchor) if anchor else '',
        '<ul class="dq">%s</ul>' % ''.join('<li>%s</li>' % e(x) for x in reasons) if reasons else ''))


def _num(v, oid, anchor=None):
    o, n = v.obs(oid)
    if n['state'] in M.MEASURED:
        txt = '{:,}'.format(int(n['value'])) if v.ds.d(o)['unit'] != 'currency' else M.fmt_value(n['value'], v.ds.d(o))
    else:
        txt = M.STATE_JA[n['state']]
    return '<b class="val" data-obs="%s">%s</b>%s' % (
        e(oid), e(txt), ' <a class="small" href="#%s">根拠</a>' % e(anchor) if anchor else '')


def _cond(v, c):
    src = v.res.doc['source']
    o, _ = v.obs('O-APP-%s' % c['id'])
    im, why = v.ds.maturity(o)
    return ('<p class="small">応募日コホート %s〜%s（%s）／ 観察窓 %s まで ／ データ cutoff %s ／ 取得 %s ／ '
            '定義版 %s ／ 単位 %s ／ 出典 %s</p>%s' % (
                e(c['start']), e(c['end']), e(src['timezone']), e(c['observation_end']), e(src['data_cutoff']),
                e(src['fetched_at']), e(v.res.doc['definition_version']), e(M.UNITS['application_ids']), e(src['ref']),
                '<p class="warn">%s。暫定値で、確定した転換率として扱いません。</p>' % e(why) if im else
                '<p class="small">観察窓は cutoff までに閉じています。</p>'))


def _stop(v, sid):
    return ('<div class="panel stopbox"><span class="badge stop">検証停止</span><p>架空イベントの変換・検証で止まりました。'
            '数字は出しません。</p><ul>%s</ul></div>' % ''.join(
                '<li><code>%s</code> %s <span class="where">%s</span></li>' % (e(x['code']), e(x['msg']), e(x['where']))
                for x in v.errors[:30]))


def render_s0(v):
    h = [_banner(v)]
    for c in v.cohorts():
        cid = c['id']
        h.append('<div class="panel"><h3>%s</h3>%s<div class="kpis">' % (e(c['label']), _cond(v, c)))
        for oid, lab, anc in (('O-APP-%s' % cid, 'フォーム回答（応募ID）', 'pc-tr-app-%s' % cid),
                              ('O-INT-%s' % cid, '面談到達', 'pc-tr-int-%s' % cid),
                              ('O-ENR-%s' % cid, '入塾到達（入金ではない）', 'pc-tr-enr-%s' % cid)):
            h.append('<div class="kpi"><div class="small">%s</div>%s</div>' % (e(lab), _num(v, oid, anc)))
        h.append('</div><p>面談到達率 %s</p><p>入塾到達率 %s</p></div>' % (
            _ratio_html(v, 'R-INT-%s' % cid), _ratio_html(v, 'R-ENR-%s' % cid)))
    h.append('<p class="small">3つの数字は同じ応募日コホート・同じ観察窓・同じ分母（フォーム回答の応募ID）です。'
             '応募ID数は人数ではありません（同じ人の別応募は別の応募IDとして数えます）。</p>')
    return ''.join(h)


def render_s1(v):
    d = v.res.doc['definitions']
    h = [_banner(v), '<div class="panel"><h3>定義（架空データ仕様 %s）</h3><dl class="kv">' % e(v.res.doc['definition_version'])]
    for k, lab in (('application', 'フォーム回答'), ('interview', '面談到達'), ('enrollment', '入塾到達'),
                   ('cohort', '対象集団'), ('window', '観察窓・締切')):
        h.append('<dt>%s</dt><dd>%s</dd>' % (e(lab), e(d.get(k))))
    h.append('</dl></div>')
    for c in v.cohorts():
        cid = c['id']
        h.append('<div class="panel"><h3>%s の導線</h3>%s<ol class="funnel">' % (e(c['label']), _cond(v, c)))
        h.append('<li>フォーム回答 %s</li>' % _num(v, 'O-APP-%s' % cid, 'pc-tr-app-%s' % cid))
        h.append('<li>面談到達 %s <span class="small">分母: 同じコホートのフォーム回答</span><br>%s</li>' % (
            _num(v, 'O-INT-%s' % cid, 'pc-tr-int-%s' % cid), _ratio_html(v, 'R-INT-%s' % cid)))
        h.append('<li>入塾到達 %s <span class="small">分母: 同じコホートのフォーム回答（面談到達ではない）</span><br>%s</li>' % (
            _num(v, 'O-ENR-%s' % cid, 'pc-tr-enr-%s' % cid), _ratio_html(v, 'R-ENR-%s' % cid)))
        h.append('</ol>')
        # 根拠: 採用イベント
        for key, lab, ids in (('app', 'フォーム回答', {a: [v.res.apps[a]['event']['event_id']]
                                                        for a in v.res.cohort_apps.get(cid, [])}),
                              ('int', '面談到達', v.res.reached[('interview', cid)]),
                              ('enr', '入塾到達', v.res.reached[('enrollment', cid)])):
            h.append('<details class="trace" id="pc-tr-%s-%s"><summary>根拠: %s の採用イベント（%d 応募ID）</summary>'
                     '<div class="tblwrap"><table><thead><tr><th>応募ID</th><th>採用イベントID</th></tr></thead><tbody>%s'
                     '</tbody></table></div></details>' % (
                         e(key), e(cid), e(lab), len(ids),
                         ''.join('<tr><td>%s</td><td><code>%s</code></td></tr>' % (e(a), e('・'.join(x)))
                                 for a, x in sorted(ids.items()))))
        h.append('</div>')
    h.append('<p class="small">除外・保留したイベントと理由は <a href="#pc-s4-excl">S4 品質と粒度</a> にあります。'
             '件数比と転換率は混ぜません。</p>')
    return ''.join(h)


def render_s2(v):
    h = [_banner(v), '<p class="warn">既存の施策票（架空）の CR・LP の対応と版を表示するだけです。'
         '新しい LP の訴求・コピー・デザイン・画像は作りません。</p>']
    plan = v.plan
    camp = None
    if plan:
        camp = next((c for c in plan.get('campaigns', []) if c.get('campaign_id') == v.res.doc['plan_ref'].get('campaign_id')), None)
    if camp is None:
        h.append('<div class="panel stopbox"><span class="badge stop">参照なし</span><p>施策票 %s / %s が見つからないため、'
                 'CR・LP の版を表示できません。</p></div>' % (
                     e(v.res.doc['plan_ref'].get('business_id')), e(v.res.doc['plan_ref'].get('campaign_id'))))
    crs = {x['id']: x for x in (camp or {}).get('creatives', {}).get('items', [])}
    for c in v.cohorts():
        cid = c['id']
        h.append('<div class="panel"><h3>%s: CR 別のフォーム回答</h3>%s<div class="tblwrap"><table><thead><tr>'
                 '<th>帰属</th><th>CR の版（施策票）</th><th>訴求 × トンマナ</th><th>応募ID数</th></tr></thead><tbody>' % (
                     e(c['label']), _cond(v, c)))
        for (kind, key), lst in sorted(v.res.partition.get(cid, {}).items()):
            oid = 'O-APP-CR-%s-%s' % (cid, key or kind)
            cr = crs.get(key) if kind == 'matched' else None
            lab = key if kind == 'matched' else '%s（元の値 %s）' % (M.MATCH_JA[kind], M.raw_text(key if key else None))
            h.append('<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>' % (
                e(lab), e('%s %s' % (cr['id'], cr['version'])) if cr else '<span class="unk">—</span>',
                e('%s × %s' % (cr['appeal'], cr['tone'])) if cr else '—', _num(v, oid)))
        h.append('</tbody></table></div><p class="small">未帰属の応募IDは、どの CR の 0 にも置き換えません。'
                 '行の無い CR は 0 ではなく「行なし」です。</p></div>')
    lps = {}
    for a in v.res.apps.values():
        lps.setdefault(a['lp'], 0)
        lps[a['lp']] += 1
    lc = (camp or {}).get('lp_change') or {}
    h.append('<div class="panel"><h3>LP の版</h3><p>応募イベントに記録された LP: %s</p>'
             '<p>施策票の LP 変更票: %s 現行 %s → 提案 %s（提案版は未公開・この試作では扱わない）</p>'
             '<p class="small">導線: %s %s</p></div>' % (
                 e('、'.join('%s %s' % k for k in sorted(lps, key=str))), e(lc.get('lp_id')), e(lc.get('current_version')),
                 e(lc.get('proposed_version')), e(v.res.doc['plan_ref'].get('flow', {}).get('id')),
                 e(v.res.doc['plan_ref'].get('flow', {}).get('version'))))
    for sp in v.res.doc['spend']:
        rid = 'R-CPA-%s' % sp['period']['start'][:7]
        h.append('<div class="panel"><h3>回答CPA（%s）</h3><p>費用 %s ÷ フォーム回答 %s（応募日 %s〜%s・同じ対象）= %s</p></div>' % (
            e(sp['label']), _num(v, 'O-COST-%s' % sp['id']), _num(v, 'O-APP-OCC-%s' % sp['id']),
            e(sp['period']['start']), e(sp['period']['end']), _ratio_html(v, rid)))
    return ''.join(h)


def render_s3(v):
    h = [_banner(v), '<div class="panel"><h3>お金（接続状況）</h3><div class="tblwrap"><table><thead><tr><th>項目</th>'
         '<th>状態</th><th>説明</th></tr></thead><tbody>']
    for sp in v.res.doc['spend']:
        o, n = v.obs('O-COST-%s' % sp['id'])
        h.append('<tr><td>広告費（%s）</td><td>%s</td><td>%s・%s。回答CPA は <a href="#pc-s2">S2</a></td></tr>' % (
            e(sp['label']), _num(v, 'O-COST-%s' % sp['id']), e(sp['currency']), e(sp['cost_basis'])))
    for item in v.res.doc['unconnected']:
        h.append('<tr><td>%s</td><td><span class="st na">未接続</span></td><td>会計・請求には接続していません。'
                 '0円ではありません。</td></tr>' % e(item))
    h.append('</tbody></table></div><p class="small">入塾到達（入塾手続き完了）から売上・着金は作りません。'
             '入金イベントは取り込んでいません（S4 の除外に記録）。</p></div>')
    return ''.join(h)


def render_s4(v):
    h = [_banner(v)]
    cnt = {}
    for n in v.ds.norm.values():
        cnt[n['state']] = cnt.get(n['state'], 0) + 1
    h.append('<div class="panel"><h3>値の状態（集計行）</h3><p class="small">%s</p></div>' % ' ／ '.join(
        '%s %d' % (M.STATE_JA[k], cnt.get(k, 0)) for k in (M.VALUE, M.ZERO, M.BLANK, M.UNAVAILABLE, M.ERROR, M.NA)))
    for c in v.cohorts():
        part = v.res.partition.get(c['id'], {})
        matched = sum(len(x) for (k, _), x in part.items() if k == 'matched')
        un = sum(len(x) for (k, _), x in part.items() if k != 'matched')
        h.append('<div class="panel"><h3>帰属の検査（%s）</h3><p>CR に照合 <b>%d</b> 応募ID ／ 未帰属 <b>%d</b> 応募ID ／ '
                 'フォーム回答 %s</p><p class="small">品質件数（照合・未帰属）は、各応募IDがちょうど1つの帰属に入ることを '
                 'adapter で検査した内訳です。成果件数（面談到達・入塾到達）とは別の数で、足し合わせません。</p></div>' % (
                     e(c['label']), matched, un, _num(v, 'O-APP-%s' % c['id'])))
    # 除外・保留
    groups = {}
    for t in v.res.trace:
        if t['status'] in ('excluded', 'held', 'dropped', 'context'):
            groups.setdefault((t['status'], t['code']), []).append(t)
    h.append('<div class="panel" id="pc-s4-excl"><h3>除外・保留・重複・数えない（架空イベントID付き）</h3>'
             '<div class="tblwrap"><table><thead><tr><th>扱い</th><th>理由</th><th>件数</th><th>架空イベントID（応募ID）</th>'
             '</tr></thead><tbody>')
    for (st, code), lst in sorted(groups.items()):
        h.append('<tr><td><span class="st %s">%s</span></td><td>%s<div class="small"><code>%s</code></div></td><td>%d</td><td>%s</td></tr>' % (
            {'held': 'stop', 'excluded': 'wait', 'dropped': 'na', 'context': 'na'}[st], e(STATUS_JA[st]),
            e(REASONS[code][1]), e(code), len(lst),
            e('、'.join('%s（%s）' % (t['event_id'], t['application_id']) for t in lst))))
    h.append('</tbody></table></div></div>')
    # 粒度
    h.append('<div class="panel"><h3>粒度（親と子を足さない）</h3><ul class="dq">')
    for ru in M.rollups(v.ds):
        h.append('<li>%s: %s</li>' % (e(ru['parent']['id']), e(' '.join(ru['notes']))))
    h.append('</ul></div>')
    # 日付・期間・鮮度
    src = v.res.doc['source']
    h.append('<div class="panel"><h3>日付・期間・鮮度</h3><div class="tblwrap"><table><thead><tr><th>集計行</th><th>期間</th>'
             '<th>成熟</th></tr></thead><tbody>')
    for o in v.res.dataset['observations']:
        if o['level'] != 'campaign':
            continue
        im, why = v.ds.maturity(o)
        h.append('<tr><td>%s</td><td>%s〜%s</td><td>%s</td></tr>' % (
            e(o['id']), e(o['period']['start']), e(o['period']['end']), e(why) if im else '締め済み'))
    h.append('</tbody></table></div><p class="small">timezone %s（%s）／ cutoff %s ／ 取得 %s</p></div>' % (
        e(src['timezone']), e(M.TZ_JA[M.tz_status(src['timezone'])[0]]), e(src['data_cutoff']), e(src['fetched_at'])))
    return ''.join(h)


def render_s5(v):
    h = [_banner(v), '<p class="warn">架空の判断履歴です。本当の承認・採用・公開・配信ではありません。'
         'この画面から承認や配信を実行することはできません。</p>']
    plan = v.plan or {}
    for d in v.res.doc['decisions']:
        vs = d.get('versions') or {}
        h.append('<div class="panel"><h3>%s <small>%s</small></h3><dl class="kv">' % (e(d.get('id')), e(d.get('at'))))
        for k, lab in (('campaign_id', '架空施策ID'), ('hypothesis', '仮説')):
            h.append('<dt>%s</dt><dd>%s</dd>' % (e(lab), e(d.get(k))))
        h.append('<dt>版</dt><dd>CR %s %s ／ LP %s %s ／ 導線 %s %s</dd>' % tuple(
            e((vs.get(k) or {}).get(f)) for k in ('creative', 'lp', 'flow') for f in ('id', 'version')))
        h.append('<dt>判断（架空）</dt><dd>%s</dd><dt>理由</dt><dd>%s</dd>' % (e(d.get('decision')), e(d.get('reason'))))
        ev = [x for x in d.get('evidence') or []]
        if ev:
            h.append('<dt>根拠（同じ集計から表示）</dt><dd><ul>%s</ul></dd>' % ''.join(
                '<li>%s: %s</li>' % (e(rid), _ratio_html(v, rid)) if any(r['id'] == rid for r in v.res.dataset['ratios'])
                else '<li>%s: <span class="unk">参照先がありません</span></li>' % e(rid) for rid in ev))
        h.append('<dt>次の1案</dt><dd>%s</dd></dl></div>' % e(d.get('next')))
    if not plan:
        h.append('<p class="small">施策票が見つからないため、版の現行性は確認していません。</p>')
    return ''.join(h)


RENDER = {'s0': render_s0, 's1': render_s1, 's2': render_s2, 's3': render_s3, 's4': render_s4, 's5': render_s5}


def render_all(views):
    """[(tab_html, section_html)]。最初の View の6画面（複数あれば View ごと）"""
    out = []
    for i, (fn, v) in enumerate(views):
        pre = 'pc' if i == 0 else 'pc%d' % i
        for sid, lab in TABS:
            secid = '%s-%s' % (pre, sid)
            try:
                body = RENDER[sid](v) if v.ok else _stop(v, sid)
            except Exception as ex:
                body = _stop(type('X', (), {'errors': [{'code': 'INTERNAL', 'where': sid,
                                                         'msg': '描画中に想定外の値で止まりました: %s' % type(ex).__name__}]})(), sid)
            name = v.res.doc.get('business', {}).get('name') if isinstance(v.res.doc, dict) and isinstance(
                v.res.doc.get('business'), dict) else fn
            out.append(('<a href="#%s">%s%s</a>' % (e(secid), e(lab), ' ⚠' if not v.ok else ''),
                        '<section class="biz pcf" id="%s"><h2>%s <small>%s</small></h2>%s</section>' % (
                            e(secid), e(lab), e(name), body)))
    return out
