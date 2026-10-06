# -*- coding: utf-8 -*-
"""
claude-hub/scripts/marketing_lab.py

3事業マーケティング試作品（読取り中心）の共通モジュール。
依頼 → CR比較 → LP差分 → 計測QA → 承認レビュー → 実験結果・次の仮説 を
business_id ごとに分けた架空fixtureから組み立てる。

- 標準ライブラリだけで動く。外部API・広告API・Sheets には一切つながない
- 実在の people / 顧客 / 生徒 / 患者 / カレンダーのデータは読まない
- 公開・配信・承認を実行するボタンは作らない（表示だけ）
"""
import datetime
import decimal
import glob
import html
import io
import json
import math
import os
import re

import measurement as ms
import passcal_flow as pcf

SCHEMA = 'marketing-lab/v1'

QA_KEYS = [
    ('mobile', 'スマホ表示'),
    ('links', 'リンク'),
    ('form_thanks', 'フォーム / Thanks'),
    ('utm_id', 'UTM / ID の連続性'),
    ('duplicate', '重複（二重登録・二重計上）'),
    ('event_once', 'イベントが1回だけ発火'),
]
QA_STATUS = ('未検証', '合格', '失敗')
APPROVAL_STATUS = ('未了', 'OK', 'NG')
UNKNOWN = '未確認'
NOT_FETCHED = '未取得'
UNDECIDABLE = '判定不可'
# 件数・金額の上限（1000兆）。これを超える値は入力ミスとして止める。
# 上限が無いと Decimal の丸めが桁あふれで例外になり、画面ごと落ちる
MAX_VALUE = 10 ** 15


# ---------------------------------------------------------------- 読み込み

class FixtureError(Exception):
    pass


def _reject_constant(name):
    # json は既定で NaN / Infinity を通してしまう。数値の欄に入ると誤った率になる
    raise FixtureError('不正な数値 %s は使えません' % name)


def _parse_float(s):
    # 1e999 は json では NaN/Infinity ではなく float inf になる。読込時点で止める
    v = float(s)
    if not math.isfinite(v):
        raise FixtureError('有限でない数値 %s は使えません' % s[:40])
    return v


def load_dir(path):
    """fixture ディレクトリの *.json を名前順に読む。戻り値は [(ファイル名, dict | FixtureError)]"""
    out = []
    for fp in sorted(glob.glob(os.path.join(path, '*.json'))):
        name = os.path.basename(fp)
        try:
            with io.open(fp, encoding='utf-8') as f:
                out.append((name, json.load(f, parse_constant=_reject_constant, parse_float=_parse_float)))
        except (ValueError, FixtureError) as ex:
            out.append((name, FixtureError(str(ex))))
    return out


# ---------------------------------------------------------------- 型の確認

def _parse_date(s):
    if not isinstance(s, str):
        return None
    try:
        return datetime.date.fromisoformat(s)
    except ValueError:
        return None


def _parse_dt(s):
    if not isinstance(s, str):
        return None
    try:
        d = datetime.datetime.fromisoformat(s)
    except ValueError:
        return None
    # 時差の無い日時は比較できないので受け付けない
    return d if d.tzinfo else None


def _is_count(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _is_number(v):
    """有限の数値だけ。Python から直接渡された inf / nan もここで落とす"""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    return not (isinstance(v, float) and not math.isfinite(v))


def _show(v):
    """エラー文に出す値。巨大な整数は str() 自体が例外になるので桁数だけ出す"""
    if _is_count(v) and abs(v) > 10 ** 30:
        return '（%d桁を超える整数）' % 30
    if isinstance(v, float) and not math.isfinite(v):
        return '（有限でない数値）'
    r = repr(v)
    return r if len(r) <= 60 else r[:57] + '...'


class Checker:
    """1事業ぶんの検証結果を集める。errors があればその事業は「検証停止」"""

    def __init__(self, biz_id):
        self.biz = biz_id
        self.errors = []

    def err(self, code, where, msg):
        self.errors.append({'code': code, 'where': where, 'msg': msg})

    def need(self, obj, key, where):
        if not isinstance(obj, dict) or key not in obj:
            self.err('MISSING', where, '%s がありません' % key)
            return None
        return obj[key]

    def count(self, v, where, allow_null=True):
        if v is None:
            if not allow_null:
                self.err('BAD_VALUE', where, '値がありません')
            return
        if isinstance(v, dict):
            # 元の値と状態を持つ形 {raw, declared_state}。元の値の誤りは止めずに「元データエラー」として見せる
            extra = sorted(set(v) - {'raw', 'declared_state'})
            if 'raw' not in v or extra:
                self.err('BAD_VALUE', where, '{raw, declared_state} の形が必要です')
            elif v.get('declared_state') not in (None,) + ms.DECLARABLE:
                self.err('BAD_VALUE', where, 'declared_state は unavailable / not_applicable のどちらかです')
            return
        if not _is_count(v):
            self.err('BAD_VALUE', where, '整数ではありません: %s' % _show(v))
        elif v < 0:
            self.err('NEGATIVE', where, '負の値です: %s' % _show(v))
        elif v > MAX_VALUE:
            self.err('BAD_VALUE', where, '上限（%d）を超えています: %s' % (MAX_VALUE, _show(v)))

    def money(self, v, where):
        if v is None:
            return
        if not _is_number(v):
            self.err('BAD_VALUE', where, '有限の数値ではありません: %s' % _show(v))
        elif v < 0:
            self.err('NEGATIVE', where, '負の値です: %s' % _show(v))
        elif v > MAX_VALUE:
            self.err('BAD_VALUE', where, '上限（%d）を超えています: %s' % (MAX_VALUE, _show(v)))

    def date(self, v, where, allow_null=False):
        if v is None and allow_null:
            return None
        d = _parse_date(v)
        if d is None:
            self.err('BAD_DATE', where, '日付として読めません: %r' % (v,))
        return d

    def dt(self, v, where, allow_null=False):
        if v is None and allow_null:
            return None
        d = _parse_dt(v)
        if d is None:
            self.err('BAD_DATE', where, '時差付きの日時として読めません: %r' % (v,))
        return d


# ---------------------------------------------------------------- 形の確認
# 意味の検証より先に、型と必須キーだけを見る。ここで落ちた事業は意味の検証も描画もしない。
# 壊れた配列や欠けた必須キーで AttributeError などが出て、画面全体が落ちるのを防ぐ。

class _Opt:
    def __init__(self, spec):
        self.spec = spec


def OPT(spec):
    """省略・null を許す"""
    return _Opt(spec)


ANY = object()     # 型は意味の検証（Checker.count / money 等）で見る
MAP = object()     # 中身を問わない dict（件数の表など）
STR, BOOL = str, bool

_REF = {'id': STR, 'version': STR}
_STAGE = {'key': STR, 'label': STR, 'definition': OPT(STR)}
_SHAPE_CAMP = {
    'campaign_id': STR, 'title': OPT(STR),
    'request': {'product': OPT(STR), 'persona': OPT(STR), 'objective': OPT(STR),
                'primary_cv': OPT({'stage': OPT(STR), 'label': OPT(STR), 'definition': OPT(STR)}),
                'period': OPT({'start': OPT(STR), 'end': OPT(STR)}), 'hypothesis': OPT(STR),
                'budget_cap': OPT({'media_yen': ANY, 'production_yen': ANY})},
    'creatives': {'appeal_axes': [{'key': STR, 'label': STR}], 'tone_axes': [{'key': STR, 'label': STR}],
                  'items': [{'id': STR, 'version': STR, 'appeal': STR, 'tone': STR, 'hypothesis': OPT(STR),
                             'copy': OPT(STR), 'cta': OPT(STR),
                             'asset': OPT({'source': OPT(STR), 'rights': OPT(STR), 'rights_checked': OPT(BOOL),
                                           'expires': OPT(STR)})}]},
    'selected_creative': _REF, 'metric_def_ref': _REF, 'flow_ref': _REF,
    'lp_change': {'id': OPT(STR), 'lp_id': STR, 'url': STR, 'current_version': OPT(STR), 'proposed_version': STR,
                  'creative_ref': _REF, 'changes': OPT([{'where': STR, 'before': OPT(STR), 'after': OPT(STR)}]),
                  'expected_action': OPT(STR),
                  'alignment': OPT({'appeal': OPT(STR), 'price': OPT(STR), 'cta': OPT(STR)}),
                  'measurement_impact': OPT(STR), 'reviewer': OPT(STR), 'rollback_version': OPT(STR)},
    'qa': {'target': {'creative': _REF, 'lp': _REF, 'flow': _REF, 'form_id': OPT(STR)},
           'items': [{'key': STR, 'plan': OPT(STR), 'status': STR, 'evidence': OPT(STR), 'checked_at': OPT(STR),
                      'checker': OPT(STR)}]},
    'approvals': {'required': [{'role': STR, 'label': OPT(STR)}],
                  'records': [{'id': STR, 'role': STR, 'status': STR,
                               'target': {'business_id': STR, 'campaign_id': STR, 'creative': _REF, 'lp': _REF},
                               'at': OPT(STR), 'scope': OPT(STR), 'evidence': OPT(STR), 'note': OPT(STR)}]},
    'results': {'periods': [{'id': STR, 'label': OPT(STR), 'start': STR, 'end': STR, 'population': STR,
                             'metric_def': _REF, 'occurred': {'from': STR, 'to': STR},
                             'source_updated_at': STR, 'fetched_at': STR, 'counts': MAP, 'spend_yen': ANY,
                             'basis': STR, 'timezone': STR, 'currency': STR, 'cost_basis': STR}],
                'comparisons': OPT([{'a': STR, 'b': STR}]), 'data_quality': OPT([STR]),
                'next_hypotheses': OPT([STR])},
}
SHAPE = {
    'schema': STR, 'business_id': STR, 'business_name': OPT(STR), 'demo': ANY, 'note': OPT(STR),
    'metric_definitions': [{'id': STR, 'version': STR, 'status': OPT(STR), 'stages': [_STAGE],
                            'primary_cv_stage': STR}],
    'lps': [{'id': STR, 'current_version': STR, 'url': OPT(STR)}],
    'flows': [{'id': STR, 'version': STR, 'lp_id': STR, 'form_id': OPT(STR), 'thanks_path': OPT(STR),
               'utm_rule': OPT(STR), 'id_carry': OPT(STR),
               'events': [{'name': STR, 'stage': OPT(STR), 'rule': OPT(STR)}]}],
    'checklist': OPT([{'item': STR, 'state': STR, 'note': OPT(STR)}]),
    'campaigns': [_SHAPE_CAMP],
}
_TYPE_JA = {str: '文字列', bool: '真偽値', list: '配列', dict: 'オブジェクト'}


def check_shape(v, spec=SHAPE, where='', out=None, limit=30):
    """型と必須キーの違反を [(where, msg)] で返す。多すぎる場合は limit 件で打ち切る"""
    out = [] if out is None else out
    if len(out) >= limit:
        return out
    if isinstance(spec, _Opt):
        return out if v is None else check_shape(v, spec.spec, where, out, limit)
    if spec is ANY:
        return out
    if spec is MAP:
        if not isinstance(v, dict):
            out.append((where or '/', 'オブジェクトが必要です'))
        return out
    if isinstance(spec, dict):
        if not isinstance(v, dict):
            out.append((where or '/', 'オブジェクトが必要です'))
            return out
        for k, sub in spec.items():
            if k not in v:
                if not isinstance(sub, _Opt):
                    out.append(('%s/%s' % (where, k), '必須キーがありません'))
            else:
                check_shape(v[k], sub, '%s/%s' % (where, k), out, limit)
        return out
    if isinstance(spec, list):
        if not isinstance(v, list):
            out.append((where, '配列が必要です'))
            return out
        for i, x in enumerate(v):
            check_shape(x, spec[0], '%s[%d]' % (where, i), out, limit)
        return out
    if spec is bool:
        ok = isinstance(v, bool)
    else:
        ok = isinstance(v, spec) and not isinstance(v, bool)
    if not ok:
        out.append((where, '%sが必要です' % _TYPE_JA.get(spec, spec.__name__)))
    return out


# ---------------------------------------------------------------- ID 台帳

def _ids(biz):
    """事業が持つ ID を種類ごとに返す。{種類: {id: 現行版}}"""
    reg = {'metric_def': {}, 'flow': {}, 'lp': {}, 'creative': {}, 'campaign': {}}
    for m in biz.get('metric_definitions') or []:
        if isinstance(m, dict):
            reg['metric_def'].setdefault(m.get('id'), m.get('version'))
    for f in biz.get('flows') or []:
        if isinstance(f, dict):
            reg['flow'].setdefault(f.get('id'), f.get('version'))
    for lp in biz.get('lps') or []:
        if isinstance(lp, dict):
            reg['lp'].setdefault(lp.get('id'), lp.get('current_version'))
    for c in biz.get('campaigns') or []:
        if not isinstance(c, dict):
            continue
        reg['campaign'].setdefault(c.get('campaign_id'), None)
        for cr in ((c.get('creatives') or {}).get('items') or []):
            if isinstance(cr, dict):
                reg['creative'].setdefault(cr.get('id'), cr.get('version'))
    return reg


def _dups(seq):
    seen, dup = set(), []
    for x in seq:
        if x in seen and x not in dup:
            dup.append(x)
        seen.add(x)
    return dup


def _owner_map(all_biz):
    """全事業の ID → 持ち主の business_id。他事業参照の判定に使う"""
    own = {}
    for b in all_biz:
        bid = b.get('business_id')
        for kind, ids in _ids(b).items():
            for i in ids:
                own.setdefault((kind, i), set()).add(bid)
    return own


# ---------------------------------------------------------------- 検証

def _ref(ck, reg, owners, kind, ref, where):
    """{id, version} 参照を同じ事業内で引く。戻り値は現行版（見つからなければ None）"""
    if not isinstance(ref, dict) or 'id' not in ref:
        ck.err('MISSING', where, '参照 {id, version} がありません')
        return None
    rid = ref.get('id')
    if rid in reg[kind]:
        return reg[kind][rid]
    others = sorted(b for b in owners.get((kind, rid), set()) if b != ck.biz)
    if others:
        ck.err('CROSS_BIZ', where, '他事業（%s）の %s を参照しています: %s' % ('・'.join(others), kind, rid))
    else:
        ck.err('UNKNOWN_REF', where, '不明な %s ID です: %s' % (kind, rid))
    return None


def validate_business(biz, owners, now, seen_biz):
    bid = biz.get('business_id') if isinstance(biz, dict) else None
    ck = Checker(bid or '(不明)')
    if not isinstance(biz, dict):
        ck.err('SCHEMA', '/', 'オブジェクトではありません')
        return ck
    if biz.get('schema') != SCHEMA:
        ck.err('SCHEMA', 'schema', '%s ではありません: %r' % (SCHEMA, biz.get('schema')))
    if not isinstance(bid, str) or not bid:
        ck.err('MISSING', 'business_id', 'business_id がありません')
    elif bid in seen_biz:
        ck.err('DUP_ID', 'business_id', 'business_id が重複しています: %s' % bid)
    if biz.get('demo') is not True:
        ck.err('SCHEMA', 'demo', '試作品の fixture は demo: true が必須です')
    if not biz.get('campaigns'):
        ck.err('MISSING', 'campaigns', '施策が1件もありません')

    # 重複 ID（種類ごと）
    lists = [
        ('metric_def', [m.get('id') for m in biz.get('metric_definitions') or [] if isinstance(m, dict)]),
        ('flow', [f.get('id') for f in biz.get('flows') or [] if isinstance(f, dict)]),
        ('lp', [x.get('id') for x in biz.get('lps') or [] if isinstance(x, dict)]),
        ('campaign', [c.get('campaign_id') for c in biz.get('campaigns') or [] if isinstance(c, dict)]),
    ]
    crs = []
    for c in biz.get('campaigns') or []:
        if isinstance(c, dict):
            crs += [x.get('id') for x in ((c.get('creatives') or {}).get('items') or []) if isinstance(x, dict)]
    lists.append(('creative', crs))
    for kind, ids in lists:
        for i in ids:
            if not isinstance(i, str) or not i:
                ck.err('MISSING', kind, 'ID が空です')
        for d in _dups(ids):
            ck.err('DUP_ID', kind, '%s ID が重複しています: %s' % (kind, d))

    reg = _ids(biz)

    stage_keys = {}
    for m in biz.get('metric_definitions') or []:
        keys = [s.get('key') for s in m.get('stages') or [] if isinstance(s, dict)]
        if len(keys) < 2:
            ck.err('BAD_VALUE', 'metric_definitions/%s' % m.get('id'), '段階は2つ以上必要です')
        for d in _dups(keys):
            ck.err('DUP_ID', 'metric_definitions/%s' % m.get('id'), '段階キーが重複しています: %s' % d)
        if m.get('primary_cv_stage') not in keys:
            ck.err('UNKNOWN_REF', 'metric_definitions/%s' % m.get('id'), '主要CVの段階が定義にありません')
        stage_keys[m.get('id')] = keys

    for f in biz.get('flows') or []:
        w = 'flows/%s' % f.get('id')
        _ref(ck, reg, owners, 'lp', {'id': f.get('lp_id')}, w + '/lp_id')
        ev = [e.get('name') for e in f.get('events') or [] if isinstance(e, dict)]
        for d in _dups(ev):
            ck.err('DUP_ID', w, 'イベント名が重複しています: %s' % d)

    for ci, c in enumerate(biz.get('campaigns') or []):
        _validate_campaign(ck, c, 'campaigns/%s' % (c.get('campaign_id') or ci), reg, owners, stage_keys, now)
    return ck


def _validate_campaign(ck, c, w, reg, owners, stage_keys, now):
    req = ck.need(c, 'request', w) or {}
    p = req.get('period') or {}
    s = ck.date(p.get('start'), w + '/request/period/start', allow_null=True)
    e = ck.date(p.get('end'), w + '/request/period/end', allow_null=True)
    if s and e and s > e:
        ck.err('DATE_ORDER', w + '/request/period', '開始日が終了日より後です')
    cap = req.get('budget_cap') or {}
    ck.money(cap.get('media_yen'), w + '/request/budget_cap/media_yen')
    ck.money(cap.get('production_yen'), w + '/request/budget_cap/production_yen')

    mref = ck.need(c, 'metric_def_ref', w)
    _ref(ck, reg, owners, 'metric_def', mref, w + '/metric_def_ref')
    keys = stage_keys.get((mref or {}).get('id'), [])
    cv = (req.get('primary_cv') or {}).get('stage')
    if cv is not None and keys and cv not in keys:
        ck.err('UNKNOWN_REF', w + '/request/primary_cv', '主要CVの段階が指標定義にありません: %s' % cv)
    _ref(ck, reg, owners, 'flow', ck.need(c, 'flow_ref', w), w + '/flow_ref')

    # CR: 訴求3軸 × トンマナ3軸 = 9提案
    crs = c.get('creatives') or {}
    ap = [a.get('key') for a in crs.get('appeal_axes') or []]
    tn = [t.get('key') for t in crs.get('tone_axes') or []]
    if len(set(ap)) != 3 or len(set(tn)) != 3:
        ck.err('BAD_VALUE', w + '/creatives', '訴求とトンマナはそれぞれ3軸必要です')
    combos = [(x.get('appeal'), x.get('tone')) for x in crs.get('items') or []]
    want = {(a, t) for a in ap for t in tn}
    if len(combos) != 9 or set(combos) != want:
        ck.err('BAD_VALUE', w + '/creatives', '訴求×トンマナの9提案がそろっていません（%d件）' % len(combos))
    for x in crs.get('items') or []:
        xw = w + '/creatives/%s' % x.get('id')
        if not x.get('version'):
            ck.err('MISSING', xw, '版がありません')
        a = x.get('asset') or {}
        ck.date(a.get('expires'), xw + '/asset/expires', allow_null=True)
    _ref(ck, reg, owners, 'creative', ck.need(c, 'selected_creative', w), w + '/selected_creative')

    lc = ck.need(c, 'lp_change', w) or {}
    _ref(ck, reg, owners, 'lp', {'id': lc.get('lp_id')}, w + '/lp_change/lp_id')
    _ref(ck, reg, owners, 'creative', lc.get('creative_ref'), w + '/lp_change/creative_ref')
    url = lc.get('url') or ''
    if not _is_demo_url(url):
        ck.err('BAD_VALUE', w + '/lp_change/url', 'デモURLは example.invalid 等の予約ドメインに限ります: %s' % url)

    qa = ck.need(c, 'qa', w) or {}
    t = qa.get('target') or {}
    _ref(ck, reg, owners, 'creative', t.get('creative'), w + '/qa/target/creative')
    _ref(ck, reg, owners, 'lp', t.get('lp'), w + '/qa/target/lp')
    _ref(ck, reg, owners, 'flow', t.get('flow'), w + '/qa/target/flow')
    qk = [i.get('key') for i in qa.get('items') or []]
    for d in _dups(qk):
        ck.err('DUP_ID', w + '/qa', 'QA項目が重複しています: %s' % d)
    for k, _ in QA_KEYS:
        if k not in qk:
            ck.err('MISSING', w + '/qa', 'QA項目がありません: %s' % k)
    for i in qa.get('items') or []:
        if i.get('status') not in QA_STATUS:
            ck.err('BAD_VALUE', w + '/qa/%s' % i.get('key'), 'QA状態が不正です: %r' % (i.get('status'),))
        if i.get('checked_at') is not None:
            d = ck.dt(i.get('checked_at'), w + '/qa/%s/checked_at' % i.get('key'))
            if d and d > now:
                ck.err('DATE_ORDER', w + '/qa/%s' % i.get('key'), '確認日時が現在より未来です')

    ap_ = ck.need(c, 'approvals', w) or {}
    rids = [r.get('id') for r in ap_.get('records') or []]
    for d in _dups(rids):
        ck.err('DUP_ID', w + '/approvals', '承認記録IDが重複しています: %s' % d)
    roles = [r.get('role') for r in ap_.get('required') or []]
    for d in _dups(roles):
        ck.err('DUP_ID', w + '/approvals/required', '役割が重複しています: %s' % d)
    for r in ap_.get('records') or []:
        rw = w + '/approvals/%s' % r.get('id')
        if r.get('status') not in APPROVAL_STATUS:
            ck.err('BAD_VALUE', rw, '承認状態が不正です: %r' % (r.get('status'),))
        if r.get('role') not in roles:
            ck.err('UNKNOWN_REF', rw, '必要な役割にない承認です: %r' % (r.get('role'),))
        tg = r.get('target') or {}
        if tg.get('business_id') != ck.biz:
            ck.err('CROSS_BIZ', rw, '他事業（%s）向けの承認が混ざっています' % tg.get('business_id'))
        if tg.get('campaign_id') != c.get('campaign_id'):
            ck.err('UNKNOWN_REF', rw, '別の施策への承認です: %r' % (tg.get('campaign_id'),))
        _ref(ck, reg, owners, 'creative', tg.get('creative'), rw + '/creative')
        _ref(ck, reg, owners, 'lp', tg.get('lp'), rw + '/lp')
        if r.get('at') is not None:
            d = ck.dt(r.get('at'), rw + '/at')
            if d and d > now:
                ck.err('DATE_ORDER', rw, '承認日時が現在より未来です')

    res = ck.need(c, 'results', w) or {}
    pids = [p.get('id') for p in res.get('periods') or []]
    for d in _dups(pids):
        ck.err('DUP_ID', w + '/results', '集計期間IDが重複しています: %s' % d)
    for p in res.get('periods') or []:
        pw = w + '/results/%s' % p.get('id')
        mk = stage_keys.get((p.get('metric_def') or {}).get('id'), [])
        _ref(ck, reg, owners, 'metric_def', p.get('metric_def'), pw + '/metric_def')
        if not p.get('population'):
            ck.err('MISSING', pw, '母集団（分母の範囲）がありません')
        ps = ck.date(p.get('start'), pw + '/start')
        pe = ck.date(p.get('end'), pw + '/end')
        if ps and pe and ps > pe:
            ck.err('DATE_ORDER', pw, '期間の開始日が終了日より後です')
        occ = p.get('occurred') or {}
        of = ck.date(occ.get('from'), pw + '/occurred/from')
        ot = ck.date(occ.get('to'), pw + '/occurred/to')
        if of and ot and of > ot:
            ck.err('DATE_ORDER', pw + '/occurred', '発生期間の開始が終了より後です')
        if ps and pe and of and ot and (of < ps or ot > pe):
            ck.err('DATE_ORDER', pw + '/occurred', '発生期間が集計期間の外にはみ出しています')
        su = ck.dt(p.get('source_updated_at'), pw + '/source_updated_at')
        fa = ck.dt(p.get('fetched_at'), pw + '/fetched_at')
        if su and fa and su > fa:
            ck.err('DATE_ORDER', pw, '元データの更新日時が取得日時より後です（取得後に元が変わっています）')
        if fa and fa > now:
            ck.err('DATE_ORDER', pw, '取得日時が現在より未来です')
        cnt = p.get('counts') or {}
        for k in ['impressions', 'clicks'] + mk:
            if k not in cnt:
                ck.err('MISSING', pw + '/counts', '%s の欄がありません（未取得なら null）' % k)
        for k, v in cnt.items():
            if k not in ['impressions', 'clicks'] + mk:
                ck.err('UNKNOWN_REF', pw + '/counts/%s' % k, '指標定義にない段階です')
            ck.count(v, pw + '/counts/%s' % k)
        ck.money(p.get('spend_yen'), pw + '/spend_yen')
        if p.get('basis') != 'occurrence':
            # この画面の期間集計は発生日基準だけ。登録cohort基準は計測の正規化レイヤー側で扱う
            ck.err('BAD_VALUE', pw + '/basis', '期間集計の基準は occurrence（発生日）だけに対応しています')
        tst, zi, tmsg = ms.tz_status(p.get('timezone'))
        if tst == ms.TZ_UNKNOWN:
            ck.err('BAD_TZ', pw + '/timezone', tmsg)
        elif tst == ms.TZ_VALID:
            for k, d in (('source_updated_at', su), ('fetched_at', fa)):
                if d is not None and not ms.offset_ok(d, zi):
                    ck.err('BAD_TZ', pw + '/' + k, '日時の時差が %s のその時点の時差と一致しません' % p['timezone'])
            # 期間が締まったかは、取得時刻ではなく元データの更新時刻（cutoff）で、報告 timezone の暦日として見る。
            # 最終日の当日に更新・取得した値は、最終日の残りが入っていない
            if pe and su and not ms.day_closed(su, pe, zi):
                ck.err('DATE_ORDER', pw, '元データの更新が期間最終日の終わり（%s の翌日 0:00）より前です（期間が締まっていません）'
                       % p['timezone'])
        if not re.match(r'^[A-Z]{3}$', p.get('currency') or ''):
            ck.err('BAD_VALUE', pw + '/currency', '通貨は ISO 3文字です')
        if not (p.get('cost_basis') or '').strip():
            ck.err('MISSING', pw + '/cost_basis', '費用基準がありません')
    for cmp_ in res.get('comparisons') or []:
        for side in ('a', 'b'):
            if cmp_.get(side) not in pids:
                ck.err('UNKNOWN_REF', w + '/results/comparisons', '不明な集計期間です: %r' % (cmp_.get(side),))


RESERVED_HOSTS = ('example.invalid', 'example.com', 'example.org', 'example.net')


def _is_demo_url(url):
    if not isinstance(url, str):
        return False
    for scheme in ('https://', 'http://'):
        if url.startswith(scheme):
            host = url[len(scheme):].split('/', 1)[0].split('?', 1)[0].lower()
            return host in RESERVED_HOSTS or host.endswith('.invalid') or host.endswith('.test')
    return False


def validate_all(loaded, now):
    """loaded: load_dir の戻り値。[(ファイル名, 事業 | None, Checker)] を返す。
    形が壊れた事業は意味の検証・描画をせず、検証停止として返す（他の事業は続ける）"""
    shape = {}
    for name, b in loaded:
        if not isinstance(b, FixtureError):
            shape[name] = check_shape(b)
    owners = _owner_map([b for n, b in loaded if n in shape and not shape[n]])
    seen, out = set(), []
    for name, b in loaded:
        if isinstance(b, FixtureError):
            ck = Checker(os.path.splitext(name)[0])
            ck.err('SCHEMA', name, 'JSONとして読めません: %s' % b)
            out.append((name, None, ck))
            continue
        bid = b.get('business_id') if isinstance(b, dict) else None
        if shape[name]:
            ck = Checker(bid if isinstance(bid, str) and bid else os.path.splitext(name)[0])
            for w, msg in shape[name]:
                ck.err('SCHEMA', w or '/', msg)
            out.append((name, None, ck))
        else:
            try:
                ck = validate_business(b, owners, now, seen)
            except Exception as ex:  # 想定外の形でも画面全体は落とさない
                ck = Checker(bid)
                ck.err('INTERNAL', name, '検証中に想定外の値で止まりました: %s' % type(ex).__name__)
            out.append((name, b, ck))
        if isinstance(bid, str):
            seen.add(bid)
    return out


# ---------------------------------------------------------------- 評価

def _latest(recs):
    """同じ役割に複数の記録があれば、日時の新しいものを採る（日時なしは最も古い扱い）"""
    if not recs:
        return None
    floor = datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)
    return sorted(recs, key=lambda r: _parse_dt(r.get('at')) or floor)[-1]


def _same(ref, cur_version):
    return isinstance(ref, dict) and cur_version is not None and ref.get('version') == cur_version


def review_status(biz, c, today):
    """施策1件のレビュー状態。戻り値 (state, [理由])。state は レビュー未完了 / 条件充足（デモ）"""
    reasons = []
    reg = _ids(biz)
    sel = c['selected_creative']
    cr_ver = reg['creative'].get(sel['id'])
    if sel.get('version') != cr_ver:
        reasons.append('選んだCR %s の版 %s は現行版 %s ではありません' % (sel['id'], sel.get('version'), cr_ver))
    lc = c['lp_change']
    lp_target = lc.get('proposed_version')
    cr = next(x for x in c['creatives']['items'] if x['id'] == sel['id'])
    a = cr.get('asset') or {}
    exp = _parse_date(a.get('expires'))
    if not a.get('rights_checked'):
        reasons.append('選んだCRの素材の権利確認が未了です')
    if exp is None:
        reasons.append('選んだCRの素材の使用期限が未確認です')
    elif exp < today:
        reasons.append('選んだCRの素材の使用期限が切れています（%s）' % exp.isoformat())
    if not _same(lc.get('creative_ref'), cr_ver):
        reasons.append('LP変更票が古いCR版を前提にしています')

    # QA
    qa = c['qa']
    t = qa['target']
    flow_ver = reg['flow'].get(c['flow_ref']['id'])
    stale = []
    if not _same(t.get('creative'), cr_ver):
        stale.append('CR')
    if (t.get('lp') or {}).get('version') != lp_target:
        stale.append('LP')
    if not _same(t.get('flow'), flow_ver):
        stale.append('導線')
    if stale:
        reasons.append('QAの対象版が現行と違います（%s）' % '・'.join(stale))
    st = [i['status'] for i in qa['items']]
    if '失敗' in st:
        reasons.append('QAに失敗した項目があります（%d件）' % st.count('失敗'))
    if '未検証' in st:
        reasons.append('QAが未実施です（未検証 %d / %d件）' % (st.count('未検証'), len(st)))
    noev = [i['key'] for i in qa['items'] if i['status'] != '未検証' and not (i.get('evidence') and i.get('checked_at'))]
    if noev:
        reasons.append('QAの証跡が不足しています（%s）' % '・'.join(noev))

    # 承認：役割ごとに別判定
    for role in c['approvals']['required']:
        recs = [r for r in c['approvals']['records'] if r['role'] == role['role']]
        reasons += approval_problems(role, _latest(recs), cr_ver, lp_target, sel['id'])
    return ('レビュー未完了' if reasons else '条件充足（デモ）'), reasons


def approval_verdict(role, rec, cr_ver, lp_ver, cr_id):
    """1役割の判定。戻り値 (表示ラベル, 問題文のリスト)"""
    lab = role.get('label') or role['role']
    if rec is None or rec.get('status') == '未了':
        return '未了', ['%sの承認が未了です' % lab]
    if rec.get('status') == 'NG':
        return 'NG', ['%sがNGです' % lab]
    probs = []
    tg = rec.get('target') or {}
    if (tg.get('creative') or {}).get('id') != cr_id or (tg.get('creative') or {}).get('version') != cr_ver:
        probs.append('%sのOKは古いCR版（%s %s）に対するものです' % (
            lab, (tg.get('creative') or {}).get('id'), (tg.get('creative') or {}).get('version')))
    if (tg.get('lp') or {}).get('version') != lp_ver:
        probs.append('%sのOKは古いLP版（%s）に対するものです' % (lab, (tg.get('lp') or {}).get('version')))
    if not (rec.get('evidence') and rec.get('at') and rec.get('scope')):
        probs.append('%sのOKに証跡・日時・範囲のいずれかがありません' % lab)
    if probs:
        return 'OK（無効）', probs
    return 'OK', []


def approval_problems(role, rec, cr_ver, lp_ver, cr_id):
    return approval_verdict(role, rec, cr_ver, lp_ver, cr_id)[1]


# ---------------------------------------------------------------- 指標

def _cval(v):
    """件数欄の値。戻り値 (値 | None, 状態の説明)。
    null は「未取得」、{raw, declared_state} は計測の正規化レイヤーで状態に直す。0 は 0 のまま"""
    if v is None:
        return None, NOT_FETCHED
    if isinstance(v, dict):
        n = ms.normalize(v.get('raw'), v.get('declared_state'), 'rows')
        if n['state'] in ms.MEASURED:
            return n['value'], ''
        return None, ms.STATE_JA[n['state']] + ('（%s）' % n['detail'] if n['detail'] else '')
    return v, ''


def _rate(num, den):
    """率。戻り値 (値 | None, 理由)。None は判定不可。0 と未取得・空欄・エラーを混ぜない"""
    (nv, ns), (dv, ds_) = _cval(num), _cval(den)
    if nv is None or dv is None:
        return None, '%sが%s' % (('分子', ns) if nv is None else ('分母', ds_))
    if dv == 0:
        return None, '分母がゼロ'
    return decimal.Decimal(nv) / decimal.Decimal(dv), ''


def _fmt_pct(v):
    q = (v * 100).quantize(decimal.Decimal('0.01'), rounding=decimal.ROUND_HALF_UP)
    return '%s%%' % q


def _fmt_yen(v):
    q = decimal.Decimal(v).quantize(decimal.Decimal('1'), rounding=decimal.ROUND_HALF_UP)
    return '¥{:,}'.format(int(q))


def _fmt_count(v):
    """件数の表示。状態付きの値は、状態と原値の両方を出す"""
    if isinstance(v, dict):
        n = ms.normalize(v.get('raw'), v.get('declared_state'), 'rows')
        if n['state'] in ms.MEASURED:
            return '{:,}（原値 {}）'.format(int(n['value']), ms.raw_text(v.get('raw')))
        return '%s（原値 %s）' % (ms.STATE_JA[n['state']], ms.raw_text(v.get('raw')))
    return NOT_FETCHED if v is None else '{:,}'.format(v)


def metrics(biz, period):
    """CTR / CVR / CPA と段階間の率。各行 {name, formula, num, den, value, text, why}"""
    md = next(m for m in biz['metric_definitions'] if m['id'] == period['metric_def']['id'])
    labels = {s['key']: s['label'] for s in md['stages']}
    cnt = period['counts']
    cv = md['primary_cv_stage']
    rows = []

    def add(name, label, formula, nk, dk, num, den, money=False):
        if money:
            dv, ds_ = _cval(den)
            if num is None or dv is None:
                v, why = None, ('費用が未取得' if num is None else '分母が%s' % ds_)
            elif dv == 0:
                v, why = None, '分母がゼロ'
            else:
                v, why = decimal.Decimal(str(num)) / decimal.Decimal(dv), ''
        else:
            v, why = _rate(num, den)
        text = UNDECIDABLE if v is None else (_fmt_yen(v) if money else _fmt_pct(v))
        rows.append({'name': name, 'label': label, 'formula': formula, 'num_label': nk, 'den_label': dk,
                     'num': num, 'den': den, 'value': v, 'text': text, 'why': why, 'money': money})

    # 期間集計は発生日基準。分子の人が分母に含まれる保証が無いので、CTR 以外は「件数比」と呼び、CVR とは呼ばない
    add('CTR', 'CTR（同期間・同じ広告）', 'クリック ÷ 表示', 'クリック', '表示', cnt.get('clicks'), cnt.get('impressions'))
    add('CVR', '件数比 %s÷クリック（同期間・CVRではない）' % labels[cv], '%s ÷ クリック' % labels[cv],
        labels[cv], 'クリック', cnt.get(cv), cnt.get('clicks'))
    add('CPA', 'CPA（%s %s・同期間）' % (period.get('currency'), period.get('cost_basis')),
        '費用 ÷ %s' % labels[cv], '費用', labels[cv], period.get('spend_yen'), cnt.get(cv), money=True)
    st = [s['key'] for s in md['stages']]
    for a, b in zip(st, st[1:]):
        add('%s→%s' % (labels[a], labels[b]), '件数比 %s÷%s（同期間・同じ人とは限らない）' % (labels[b], labels[a]),
            '%s ÷ %s' % (labels[b], labels[a]), labels[b], labels[a], cnt.get(b), cnt.get(a))
    return rows


def quality_flags(biz, period):
    """値の並びのおかしさ。止めはしないが、画面で必ず見せる"""
    md = next(m for m in biz['metric_definitions'] if m['id'] == period['metric_def']['id'])
    cnt = period['counts']
    out = []
    seq = [('impressions', '表示'), ('clicks', 'クリック')] + [(s['key'], s['label']) for s in md['stages']]
    for (a, al), (b, bl) in zip(seq, seq[1:]):
        if a == 'clicks' and b == md['stages'][0]['key']:
            continue  # クリック以外の流入（自然流入など）が混ざりうるので比べない
        va, vb = _cval(cnt.get(a))[0], _cval(cnt.get(b))[0]
        if va is not None and vb is not None and vb > va:
            out.append('%s（%d）が手前の%s（%d）より多い。計測の重複か定義の違いを確認' % (bl, vb, al, va))
    for k, lab in seq:
        v, why = _cval(cnt.get(k))
        if v is None:
            out.append('%s が%s（ゼロではありません）' % (lab, why))
    if period.get('spend_yen') is None:
        out.append('費用が未取得（ゼロではありません）')
    return out


def compare(biz, res, cmp_):
    pa = next(p for p in res['periods'] if p['id'] == cmp_['a'])
    pb = next(p for p in res['periods'] if p['id'] == cmp_['b'])
    out = {'a': pa, 'b': pb, 'blocked': [], 'notes': [], 'rows': []}
    if pa['population'] != pb['population']:
        out['blocked'].append('母集団が違うため比較しません（%s ／ %s）' % (pa['population'], pb['population']))
    if pa['metric_def'] != pb['metric_def']:
        out['blocked'].append('指標定義の版が違うため比較しません（%s %s ／ %s %s）' % (
            pa['metric_def']['id'], pa['metric_def']['version'], pb['metric_def']['id'], pb['metric_def']['version']))
    for k, lab in (('basis', '基準'), ('timezone', 'timezone'), ('currency', '通貨'), ('cost_basis', '費用基準')):
        if pa.get(k) != pb.get(k):
            out['blocked'].append('%sが違うため比較しません（%s ／ %s）' % (lab, pa.get(k), pb.get(k)))
    for p_ in (pa, pb):
        tst = ms.tz_status(p_.get('timezone'))[0]
        if tst != ms.TZ_VALID:
            out['blocked'].append('%s の timezone %s は%sのため比較しません' % (p_['id'], p_.get('timezone'), ms.TZ_JA[tst]))
    if out['blocked']:
        return out
    la = (_parse_date(pa['end']) - _parse_date(pa['start'])).days + 1
    lb = (_parse_date(pb['end']) - _parse_date(pb['start'])).days + 1
    if la != lb:
        out['notes'].append('期間の長さが違います（%d日 ／ %d日）。件数は比べず、率だけ並べます' % (la, lb))
    ma, mb = metrics(biz, pa), metrics(biz, pb)
    for ra, rb in zip(ma, mb):
        if ra['value'] is None or rb['value'] is None:
            d = UNDECIDABLE
        elif ra['money']:
            d = ('+' if rb['value'] >= ra['value'] else '-') + _fmt_yen(abs(rb['value'] - ra['value']))
        else:
            pt = ((rb['value'] - ra['value']) * 100).quantize(decimal.Decimal('0.01'), rounding=decimal.ROUND_HALF_UP)
            d = ('%+.2fpt' % pt)
        out['rows'].append({'name': ra['name'], 'label': ra['label'], 'a': ra['text'], 'b': rb['text'], 'diff': d})
    out['notes'].append('差は観測値です。施策が原因かどうかは検証していません')
    return out


# ---------------------------------------------------------------- 描画

def e(v):
    return html.escape('' if v is None else str(v), quote=True)


def u(v):
    """未確認を明示する表示。空文字・null は「未確認」"""
    return '<span class="unk">%s</span>' % UNKNOWN if v in (None, '') else e(v)


def _yen_or_unknown(v):
    return '<span class="unk">%s</span>' % UNKNOWN if v is None else e(_fmt_yen(v))


def _badge(state):
    cls = {'検証停止': 'stop', 'レビュー未完了': 'wait', '条件充足（デモ）': 'ok'}.get(state, 'wait')
    return '<span class="badge %s">%s</span>' % (cls, e(state))


def _ver(ref):
    return '%s %s' % (e((ref or {}).get('id')), e((ref or {}).get('version')))


def render_business(name, biz, ck, today, now):
    bid = (biz or {}).get('business_id') or ck.biz or name
    h = []
    title = (biz or {}).get('business_name') or bid
    h.append('<section class="biz" id="biz-%s" data-biz="%s">' % (e(bid), e(bid)))
    h.append('<h2>%s <small>business_id: %s</small></h2>' % (e(title), e(bid)))
    if ck.errors:
        h.append('<div class="panel stopbox">%s<p>この事業のデータに矛盾があるため、'
                 'レビュー・集計を表示せず検証を止めています。fixture を直して作り直してください。</p><ul>'
                 % _badge('検証停止'))
        for x in ck.errors:
            h.append('<li><code>%s</code> %s <span class="where">%s</span></li>' % (e(x['code']), e(x['msg']), e(x['where'])))
        h.append('</ul></div></section>')
        return ''.join(h)

    for c in biz['campaigns']:
        h.append(_render_campaign(biz, c, today))
    h.append(_render_checklist(biz))
    h.append('</section>')
    return ''.join(h)


def _step(n, title, body, open_=False):
    return ('<details class="step"%s><summary><span class="sn">%d</span>%s</summary>'
            '<div class="sb">%s</div></details>') % (' open' if open_ else '', n, e(title), body)


def _render_campaign(biz, c, today):
    state, reasons = review_status(biz, c, today)
    reg = _ids(biz)
    h = ['<article class="camp">']
    h.append('<h3>%s <small>campaign_id: %s</small></h3>' % (e(c.get('title')), e(c['campaign_id'])))
    h.append('<div class="statusline">%s<span class="note">公開・配信・承認を実行する操作はこの画面にありません</span></div>'
             % _badge(state))
    if reasons:
        h.append('<ul class="reasons">%s</ul>' % ''.join('<li>%s</li>' % e(r) for r in reasons))
    links = '依頼 → CR比較 → LP差分 → 計測QA → 承認レビュー → 結果・次の仮説'
    h.append('<p class="flowline">%s</p>' % e(links))

    # 1 依頼
    r = c['request']
    cv = r.get('primary_cv') or {}
    md = next(m for m in biz['metric_definitions'] if m['id'] == c['metric_def_ref']['id'])
    cap = r.get('budget_cap') or {}
    per = r.get('period') or {}
    b = ['<dl class="kv">']
    for k, v in [('商品', u(r.get('product'))), ('顧客像（個人情報なし）', u(r.get('persona'))),
                 ('目的', u(r.get('objective'))),
                 ('主要CV', '%s<br><small>定義: %s</small>' % (u(cv.get('label')), u(cv.get('definition')))),
                 ('期間', '%s 〜 %s' % (u(per.get('start')), u(per.get('end')))),
                 ('仮説', u(r.get('hypothesis'))),
                 ('媒体費の見積上限', _yen_or_unknown(cap.get('media_yen'))),
                 ('制作費の見積上限', _yen_or_unknown(cap.get('production_yen')))]:
        b.append('<dt>%s</dt><dd>%s</dd>' % (e(k), v))
    b.append('</dl><p class="warn">見積上限は検討用のメモです。保存しても支出の許可にはなりません。</p>')
    b.append('<p class="small">指標定義 %s %s（%s）: %s</p>' % (
        e(md['id']), e(md['version']), e(md.get('status')),
        ' → '.join('%s<small>（%s）</small>' % (e(s['label']), e(s.get('definition'))) for s in md['stages'])))
    h.append(_step(1, '依頼', ''.join(b), open_=True))

    # 2 CR 比較
    crs = c['creatives']
    sel = c['selected_creative']
    b = ['<p class="warn">コピーと素材はすべてデモ用の仮案です。有料の画像生成・実顧客の素材は使っていません。</p>',
         '<div class="tblwrap"><table class="grid"><thead><tr><th>訴求＼トンマナ</th>']
    b += ['<th>%s</th>' % e(t['label']) for t in crs['tone_axes']]
    b.append('</tr></thead><tbody>')
    for a in crs['appeal_axes']:
        b.append('<tr><th>%s</th>' % e(a['label']))
        for t in crs['tone_axes']:
            x = next(i for i in crs['items'] if i['appeal'] == a['key'] and i['tone'] == t['key'])
            asset = x.get('asset') or {}
            exp = _parse_date(asset.get('expires'))
            tags = []
            if x['id'] == sel['id']:
                tags.append('<span class="tag sel">選定</span>')
            if exp is not None and exp < today:
                tags.append('<span class="tag bad">素材期限切れ</span>')
            if not asset.get('rights_checked'):
                tags.append('<span class="tag">権利未確認</span>')
            b.append('<td><div class="cr"><div class="crid">%s %s %s</div><div class="copy">「%s」</div>'
                     '<div class="small">仮説: %s</div><div class="small">CTA: %s</div>'
                     '<div class="small">素材: %s／権利: %s／期限: %s</div></div></td>' % (
                         e(x['id']), e(x['version']), ''.join(tags), e(x.get('copy')), u(x.get('hypothesis')),
                         u(x.get('cta')), u(asset.get('source')), u(asset.get('rights')), u(asset.get('expires'))))
        b.append('</tr>')
    b.append('</tbody></table></div>')
    h.append(_step(2, 'CR比較（訴求3軸 × トンマナ3軸 = 9提案）', ''.join(b)))

    # 3 LP 差分
    lc = c['lp_change']
    b = ['<dl class="kv">']
    for k, v in [('LP', '%s（%s）' % (e(lc['lp_id']), e(lc.get('url')))),
                 ('現行版 → 提案版', '%s → %s' % (u(lc.get('current_version')), u(lc.get('proposed_version')))),
                 ('前提のCR', _ver(lc.get('creative_ref'))),
                 ('期待する行動', u(lc.get('expected_action'))),
                 ('CRとの整合（訴求）', u((lc.get('alignment') or {}).get('appeal'))),
                 ('CRとの整合（価格）', u((lc.get('alignment') or {}).get('price'))),
                 ('CRとの整合（CTA）', u((lc.get('alignment') or {}).get('cta'))),
                 ('計測への影響', u(lc.get('measurement_impact'))),
                 ('確認者（役割）', u(lc.get('reviewer'))),
                 ('戻す版', u(lc.get('rollback_version')))]:
        b.append('<dt>%s</dt><dd>%s</dd>' % (e(k), v))
    b.append('</dl><div class="tblwrap"><table><thead><tr><th>変更箇所</th><th>現行</th><th>提案</th></tr></thead><tbody>')
    for ch in lc.get('changes') or []:
        b.append('<tr><td>%s</td><td>%s</td><td>%s</td></tr>' % (e(ch.get('where')), u(ch.get('before')), u(ch.get('after'))))
    b.append('</tbody></table></div><p class="small">URLは予約ドメインのデモです。実際のページはありません。</p>')
    h.append(_step(3, 'LP変更票', ''.join(b)))

    # 4 計測 QA
    qa = c['qa']
    t = qa['target']
    flow = next(f for f in biz['flows'] if f['id'] == c['flow_ref']['id'])
    b = ['<p>対象: CR %s ／ LP %s ／ 導線 %s ／ フォーム %s</p>' % (
        _ver(t.get('creative')), _ver(t.get('lp')), _ver(t.get('flow')), u(t.get('form_id'))),
        '<p class="small">イベント定義（導線 %s %s）: %s</p>' % (e(flow['id']), e(flow['version']), '、'.join(
            '%s（%s・%s）' % (e(ev['name']), e(ev.get('stage')), e(ev.get('rule'))) for ev in flow.get('events') or [])),
        '<p class="warn">「計画」は確認のやり方、「実施証跡」は実際に確認した記録です。'
        'この試作品ではフォーム送信もイベント確認も行っていないため、初期状態はすべて未検証です。</p>',
        '<div class="tblwrap"><table><thead><tr><th>項目</th><th>状態</th><th>計画</th><th>実施証跡</th></tr></thead><tbody>']
    labels = dict(QA_KEYS)
    for i in qa['items']:
        cls = {'未検証': 'wait', '合格': 'ok', '失敗': 'stop'}[i['status']]
        ev = i.get('evidence')
        evs = ('%s（%s・%s）' % (e(ev), e(i.get('checked_at')), u(i.get('checker')))) if ev else '<span class="unk">なし</span>'
        b.append('<tr><td>%s</td><td><span class="badge %s">%s</span></td><td>%s</td><td>%s</td></tr>' % (
            e(labels.get(i['key'], i['key'])), cls, e(i['status']), u(i.get('plan')), evs))
    b.append('</tbody></table></div>')
    h.append(_step(4, '計測QA', ''.join(b)))

    # 5 承認レビュー
    cr_ver = reg['creative'].get(sel['id'])
    lp_ver = lc.get('proposed_version')
    b = ['<p>現行の対象版: CR %s %s ／ LP %s %s</p>' % (e(sel['id']), e(cr_ver), e(lc['lp_id']), e(lp_ver)),
         '<p class="small">代理店とクライアントは別々に判定します。片方のOKで全体OKにはしません。</p>',
         '<div class="tblwrap"><table><thead><tr><th>役割</th><th>判定</th><th>対象（事業/施策/CR/LP）</th>'
         '<th>日時</th><th>範囲</th><th>証跡</th></tr></thead><tbody>']
    for role in c['approvals']['required']:
        recs = [x for x in c['approvals']['records'] if x['role'] == role['role']]
        rec = _latest(recs)
        lab, probs = approval_verdict(role, rec, cr_ver, lp_ver, sel['id'])
        cls = 'ok' if lab == 'OK' else ('stop' if lab == 'NG' else 'wait')
        if rec:
            tg = rec.get('target') or {}
            tgt = '%s / %s / %s / %s' % (e(tg.get('business_id')), e(tg.get('campaign_id')),
                                         _ver(tg.get('creative')), _ver(tg.get('lp')))
            b.append('<tr><td>%s</td><td><span class="badge %s">%s</span>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>' % (
                e(role.get('label')), cls, e(lab), ''.join('<div class="small">%s</div>' % e(p) for p in probs),
                tgt, u(rec.get('at')), u(rec.get('scope')), u(rec.get('evidence'))))
        else:
            b.append('<tr><td>%s</td><td><span class="badge wait">未了</span></td><td colspan="4">記録なし</td></tr>'
                     % e(role.get('label')))
    b.append('</tbody></table></div><p class="small">ここに出ている承認はすべてデモの記録です。</p>')
    h.append(_step(5, '承認レビュー', ''.join(b)))

    # 6 結果
    res = c['results']
    b = ['<p class="warn">以下はすべて架空の集計値です。実績のライブ取得はしていません。</p>']
    for p in res['periods']:
        b.append('<div class="period"><h4>%s <small>%s</small></h4>' % (e(p.get('label')), e(p['id'])))
        b.append('<p class="small">期間 %s〜%s（%s・timezone %s）／ 母集団 %s ／ 定義 %s ／ 発生 %s〜%s ／ 元更新 %s ／ 取得 %s</p>' % (
            e(p['start']), e(p['end']), e(ms.BASES.get(p['basis'], p['basis'])), e(p['timezone']),
            e(p['population']), _ver(p['metric_def']),
            e(p['occurred']['from']), e(p['occurred']['to']), e(p['source_updated_at']), e(p['fetched_at'])))
        md_ = next(m for m in biz['metric_definitions'] if m['id'] == p['metric_def']['id'])
        cnt = p['counts']
        b.append('<p class="small">件数: 表示 %s ／ クリック %s ／ %s ／ 費用 %s</p>' % (
            e(_fmt_count(cnt.get('impressions'))), e(_fmt_count(cnt.get('clicks'))),
            ' ／ '.join('%s %s' % (e(s['label']), e(_fmt_count(cnt.get(s['key'])))) for s in md_['stages']),
            e((NOT_FETCHED if p.get('spend_yen') is None else _fmt_yen(p['spend_yen'])) + '（%s・%s）' % (
                p['currency'], p['cost_basis']))))
        b.append('<div class="tblwrap"><table><thead><tr><th>指標</th><th>値</th><th>算式</th><th>分子 / 分母</th></tr></thead><tbody>')
        for m in metrics(biz, p):
            nd = '%s %s / %s %s' % (e(m['num_label']), e(_fmt_count(m['num']) if not m['money'] or m['num'] is None
                                                        else _fmt_yen(m['num'])),
                                    e(m['den_label']), e(_fmt_count(m['den'])))
            val = e(m['text']) + ('<div class="small">%s</div>' % e(m['why']) if m['why'] else '')
            b.append('<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>' % (e(m['label']), val, e(m['formula']), nd))
        b.append('</tbody></table></div>')
        fl = quality_flags(biz, p)
        if fl:
            b.append('<ul class="dq">%s</ul>' % ''.join('<li>%s</li>' % e(x) for x in fl))
        b.append('</div>')
    for cm in res.get('comparisons') or []:
        r_ = compare(biz, res, cm)
        b.append('<div class="period"><h4>比較 %s → %s</h4>' % (e(cm['a']), e(cm['b'])))
        if r_['blocked']:
            b.append('<ul class="dq">%s</ul>' % ''.join('<li>%s</li>' % e(x) for x in r_['blocked']))
        else:
            b.append('<div class="tblwrap"><table><thead><tr><th>指標</th><th>%s</th><th>%s</th><th>差</th></tr></thead><tbody>'
                     % (e(cm['a']), e(cm['b'])))
            for rw in r_['rows']:
                b.append('<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>' % (
                    e(rw['label']), e(rw['a']), e(rw['b']), e(rw['diff'])))
            b.append('</tbody></table></div>')
        b.append('<p class="small">%s</p></div>' % '<br>'.join(e(x) for x in r_['notes']))
    if res.get('data_quality'):
        b.append('<h4>データ品質の問題</h4><ul class="dq">%s</ul>' % ''.join('<li>%s</li>' % e(x) for x in res['data_quality']))
    if res.get('next_hypotheses'):
        b.append('<h4>次の仮説（検証前）</h4><ul>%s</ul>' % ''.join('<li>%s</li>' % e(x) for x in res['next_hypotheses']))
    h.append(_step(6, '実験結果・次の仮説', ''.join(b)))
    h.append('</article>')
    return ''.join(h)


def _render_checklist(biz):
    h = ['<div class="panel"><h3>本番に進む前に足りないもの</h3><ul class="check">']
    for x in biz.get('checklist') or []:
        h.append('<li><span class="cb" aria-hidden="true">□</span><b>%s</b> <span class="tag">%s</span>'
                 '<div class="small">%s</div></li>' % (e(x.get('item')), e(x.get('state')), u(x.get('note'))))
    h.append('</ul></div>')
    return ''.join(h)


CSS = """
:root{--bg:#FFFFFF;--fg:#1B2433;--mut:#5B6575;--card:#FFFFFF;--line:#DDE2E9;--acc:#1F3A5F;--soft:#F4F6F9;
--ok:#2E6B4A;--okb:#E8F2EC;--wait:#8A5A00;--waitb:#FFF4DC;--stop:#A3261E;--stopb:#FBE7E5;--demo:#1F3A5F;--demob:#EEF2F7}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#17181B;--fg:#ECE9E2;--mut:#A39E93;
--card:#212328;--line:#34373E;--acc:#9DB8DC;--soft:#1C1E22;--ok:#7FD39C;--okb:#1D3326;--wait:#F2C46B;--waitb:#3A2F17;
--stop:#FF9A90;--stopb:#3D1F1C;--demo:#C9D6EA;--demob:#1E2633}}
:root[data-theme="dark"]{--bg:#17181B;--fg:#ECE9E2;--mut:#A39E93;--card:#212328;--line:#34373E;--acc:#9DB8DC;--soft:#1C1E22;
--ok:#7FD39C;--okb:#1D3326;--wait:#F2C46B;--waitb:#3A2F17;--stop:#FF9A90;--stopb:#3D1F1C;--demo:#C9D6EA;--demob:#1E2633}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
.demo{position:sticky;top:0;z-index:5;background:var(--demob);color:var(--demo);border-bottom:1px solid var(--line);
padding:4px 16px;font-weight:700;font-size:12px;line-height:1.5}
/* 狭い画面では固定しない（本文や操作を覆わない） */
@media (max-width:560px){.demo{position:static}}
header,main{max-width:1080px;margin:0 auto;padding:0 16px}
h1{font-size:19px;margin:16px 0 4px;color:var(--acc)}h2{font-size:17px;margin:20px 0 8px;color:var(--acc)}h3{font-size:15px;margin:12px 0 6px}
h4{font-size:14px;margin:12px 0 4px}small,.small{color:var(--mut);font-size:12px}
nav.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
nav.tabs a{padding:6px 12px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);
text-decoration:none;font-size:13px}
nav.tabs a[aria-current="true"]{border-color:var(--acc);background:var(--acc);color:var(--card);font-weight:700}
@media (max-width:560px){nav.tabs{gap:6px}nav.tabs a{padding:5px 9px;font-size:12px}}
.othernav{margin:4px 0 8px;font-size:13px}.othernav>summary{cursor:pointer;color:var(--mut)}
nav.tabs.main{margin:8px 0 4px}
details.cond{margin:4px 0}details.cond>summary{cursor:pointer;font-size:12px;color:var(--acc)}
details.cond .small{margin:4px 0}
.pcf .tblwrap table{min-width:0}.pcf td,.pcf th{overflow-wrap:anywhere}
.pcf td:first-child,.pcf th:first-child{white-space:normal}
.pcf .kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
.pcf .kpi{padding:6px 8px}.pcf .rates{margin:6px 0;font-size:14px}
.pcf h2{margin:12px 0 6px}
.fsteps{display:flex;align-items:stretch;gap:6px;margin:8px 0}
.fstep{flex:1;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--card)}
.fstep .val{font-size:20px;color:var(--acc)}.frate{margin-top:6px;font-size:13px}
.farrow{align-self:center;color:var(--mut);font-size:18px}
@media (max-width:560px){.fsteps{flex-direction:column}.farrow{text-align:center;transform:rotate(90deg);align-self:center}}
@media (max-width:560px){.pcf .kpi .val{font-size:18px}h1{font-size:16px;margin:10px 0 2px}}
.notice{background:var(--soft);border-left:3px solid var(--acc);padding:6px 10px;font-size:13px;border-radius:4px}
.js .biz{display:none}.js .biz.on{display:block}
.camp,.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:12px 0}
.statusline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700}
.badge.ok{background:var(--okb);color:var(--ok)}.badge.wait{background:var(--waitb);color:var(--wait)}
.badge.stop{background:var(--stopb);color:var(--stop)}
.note{font-size:12px;color:var(--mut)}.reasons{margin:6px 0;padding-left:20px;font-size:13px}
.flowline{font-size:12px;color:var(--mut);margin:6px 0}
.step{border-top:1px solid var(--line)}.step summary{cursor:pointer;padding:10px 0;font-weight:700;list-style:none}
.step summary::-webkit-details-marker{display:none}
.sn{display:inline-block;width:22px;height:22px;border-radius:50%;background:var(--acc);color:var(--card);
text-align:center;line-height:22px;font-size:12px;margin-right:8px}
.kv{display:grid;grid-template-columns:minmax(110px,200px) 1fr;gap:4px 12px;margin:0}
.kv dt{color:var(--mut);font-size:13px}.kv dd{margin:0}
@media (max-width:560px){.kv{grid-template-columns:1fr}.kv dd{margin-bottom:6px}}
.warn{background:var(--waitb);color:var(--fg);border-left:4px solid var(--wait);padding:6px 10px;font-size:13px;border-radius:6px}
.unk{color:var(--wait);font-weight:700}
.tblwrap{overflow-x:auto;max-width:100%}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left}
.tblwrap table{min-width:600px}table.grid{min-width:720px}
td:first-child,th:first-child{white-space:nowrap}
@media (max-width:560px){.demo{font-size:12px;padding:6px 16px}}.cr .copy{margin:2px 0}.crid{font-family:ui-monospace,monospace;font-size:12px}
.tag{display:inline-block;font-size:11px;padding:0 6px;border-radius:4px;border:1px solid var(--line);margin-left:4px}
.tag.sel{border-color:var(--acc);color:var(--acc)}.tag.bad{border-color:var(--stop);color:var(--stop)}
.dq{font-size:13px;color:var(--wait)}.stopbox{border-color:var(--stop)}.where{font-size:11px;color:var(--mut)}
.check{list-style:none;padding:0}.check li{margin:6px 0}.cb{margin-right:6px}
.period{border:1px dashed var(--line);border-radius:8px;padding:8px 10px;margin:8px 0}
code{font-size:12px}
.tabsep{flex-basis:100%;font-size:12px;color:var(--mut);margin-top:4px}
.st{display:inline-block;padding:0 8px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap}
.st.ok{background:var(--okb);color:var(--ok)}.st.wait{background:var(--waitb);color:var(--wait)}
.st.stop{background:var(--stopb);color:var(--stop)}.st.na{border:1px solid var(--line);color:var(--mut)}
.series{border:1px dashed var(--line);border-radius:8px;padding:8px 10px;margin:8px 0}
.ratio{border-top:1px solid var(--line);padding:8px 0}.ratio .val{font-weight:700;margin-left:6px}
tr.parent td{font-weight:700}tr.sum td{background:var(--bg)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:8px 0}
.kpi{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--card)}.kpi .val{font-size:20px;color:var(--acc)}
.funnel li{margin:8px 0}.trace summary{cursor:pointer;font-size:13px;color:var(--acc)}
footer{max-width:1080px;margin:24px auto;padding:0 16px 32px;color:var(--mut);font-size:12px}
"""

JS = """
document.documentElement.classList.add('js');
(function(){
 var secs=[].slice.call(document.querySelectorAll('section.biz'));
 var tabs=[].slice.call(document.querySelectorAll('nav.tabs a'));
 function show(id){
  // 画面の中の要素（根拠の表など）へのリンクなら、その要素を含む画面を開いてそこへ移る
  var el=id?document.getElementById(id):null, inner=null;
  if(el&&!el.matches('section.biz')){var sec=el.closest('section.biz'); if(sec){inner=el; id=sec.id;}}
  if(!secs.some(function(s){return s.id===id;})) id=secs.length?secs[0].id:'';
  secs.forEach(function(s){s.classList.toggle('on',s.id===id);});
  tabs.forEach(function(a){a.setAttribute('aria-current',a.getAttribute('href')==='#'+id?'true':'false');});
  tabs.forEach(function(a){if(a.getAttribute('aria-current')==='true'){var d=a.closest('details'); if(d)d.open=true;}});
  if(inner){if(inner.tagName==='DETAILS')inner.open=true; inner.scrollIntoView();}
 }
 tabs.forEach(function(a){a.addEventListener('click',function(ev){ev.preventDefault();
  var id=a.getAttribute('href').slice(1);
  try{history.replaceState(null,'','#'+id);}catch(e){}
  show(id);});});
 addEventListener('hashchange',function(){show(location.hash.slice(1));});
 show(location.hash.slice(1));
})();
"""


def render(results, today, now, source_label, measurement=None, flows=None):
    """measurement: measurement.validate_all の戻り値（無ければ計測タブを出さない）
    flows: passcal_flow.build_view の戻り値（無ければ PASSCAL 架空導線の6画面を出さない）"""
    secs, tabs = [], []
    main_tabs = None
    if flows is not None:
        # PASSCAL 架空導線の経営画面を先頭に置く（最初に開くのは S0）。ほかの試作のナビは折りたたむ
        main_tabs = []
        frs = pcf.render_all(flows)
        main_tabs += [t for t, _ in frs]
        secs += [x for _, x in frs]
        if not frs:
            main_tabs.append('<a href="#pc-none">PASSCAL: なし ⚠</a>')
            secs.append('<section class="biz pcf" id="pc-none"><div class="panel stopbox">%s<p>架空イベントの fixture が'
                        '1件もありません。検証を止めています。</p></div></section>' % _badge('検証停止'))
        tabs.append('<span class="tabsep">3事業の施策レビュー（架空）</span>')
    for name, biz, ck in results:
        bid = (biz or {}).get('business_id') or ck.biz or name
        label = (biz or {}).get('business_name') or bid
        mark = ' ⚠' if ck.errors else ''
        tabs.append('<a href="#biz-%s">%s%s</a>' % (e(bid), e(label), e(mark)))
        try:
            secs.append(render_business(name, biz, ck, today, now))
        except Exception as ex:  # 検証を通っても描画で落ちた事業だけ止める
            stop = Checker(bid)
            stop.err('INTERNAL', name, '描画中に想定外の値で止まりました: %s' % type(ex).__name__)
            secs.append(render_business(name, None, stop, today, now))
    if measurement is not None:
        tabs.append('<span class="tabsep">計測の正規化（合成データ）</span>')
        mrs = ms.render_all(measurement)
        tabs += [t for t, _ in mrs]
        secs += [x for _, x in mrs]
        if not mrs:
            tabs.append('<a href="#ms-none">計測: なし ⚠</a>')
            secs.append('<section class="biz ms" id="ms-none"><div class="panel stopbox">%s<p>計測の合成 fixture が'
                        '1件もありません。検証を止めています。</p></div></section>' % _badge('検証停止'))
    return ''.join([
        '<!doctype html><html lang="ja"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>マーケ施策レビュー試作</title><style>', CSS, '</style></head><body>',
        '<div class="demo" role="note">試作品・架空データです。実データ・広告・LP・フォーム・計測・Sheets には接続していません。</div>',
        '<header><h1>マーケ試作（架空データ・読取り専用）</h1>',
        ''.join(['<nav class="tabs main" aria-label="PASSCAL 架空導線">', ''.join(main_tabs), '</nav>',
                 '<details class="othernav"><summary>ほかの試作（3事業の施策レビュー・計測の正規化デモ）と生成情報</summary>',
                 '<p class="small">基準時刻 %s ／ 判定日 %s ／ データ: %s ／ 表示される承認・数値は本物ではありません</p>' % (
                     e(now.isoformat()), e(today.isoformat()), e(source_label)),
                 '<nav class="tabs" aria-label="ほかの試作">', ''.join(tabs), '</nav></details>'])
        if main_tabs is not None else
        ''.join(['<p class="small">基準時刻 %s ／ 判定日 %s ／ データ: %s ／ 読取り専用 ／ 表示される承認・数値は本物ではありません</p>' % (
            e(now.isoformat()), e(today.isoformat()), e(source_label)),
            '<nav class="tabs" aria-label="事業">', ''.join(tabs), '</nav>']),
        '</header><main>',
        ''.join(secs) or ('<div class="panel stopbox">%s<p>fixture が1件もありません。'
                          '表示できる事業が無いため検証を止めています。</p></div>' % _badge('検証停止')),
        '</main><footer>この画面は試作品です。公開・配信・停止・増額・承認の実行はできません。'
        '数値の差は観測値であり、因果は検証していません。</footer>',
        '<script>', JS, '</script></body></html>'])


def resolve_clock(now_s=None, today_s=None):
    """OFFICE_NOW（ISO・時差付き）と OFFICE_TODAY（YYYY-MM-DD か build-office.py と同じ MM-DD）を解く"""
    if now_s:
        now = datetime.datetime.fromisoformat(now_s)
        if now.tzinfo is None:
            raise ValueError('OFFICE_NOW には時差を付けてください: %s' % now_s)
    else:
        now = datetime.datetime.now().astimezone().replace(microsecond=0)
    if today_s:
        today = (datetime.date.fromisoformat(today_s) if len(today_s) == 10
                 else datetime.date.fromisoformat('%04d-%s' % (now.year, today_s)))
    else:
        today = now.date()
    return now, today


def build(fixture_dir, now, today, source_label=None, measurement_dir=None, events_dir=None):
    """measurement_dir を渡すと計測の正規化（合成データ）のタブ、events_dir を渡すと PASSCAL 架空導線の6画面を足す"""
    results = validate_all(load_dir(fixture_dir), now)
    mres = ms.validate_all(ms.load_dir(measurement_dir), now) if measurement_dir is not None else None
    flows = None
    if events_dir is not None:
        plans = {b['business_id']: b for n, b, ck in results if b is not None and not ck.errors}
        flows = pcf.build_view(events_dir, now, plans)
    doc = render(results, today, now, source_label or os.path.basename(os.path.normpath(fixture_dir)), mres, flows)
    return doc, results
