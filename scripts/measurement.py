# -*- coding: utf-8 -*-
"""
claude-hub/scripts/measurement.py

合成データだけで動く「計測の正規化・検証レイヤー」。
元の値（raw）を、明示的な値状態と比較可能性の状態に置き換える。

- 0 と欠測を混ぜない。値状態は 値あり／0（実測）／空欄／取得不可／元データエラー／対象外 の6つ
- 母集団と期間がそろわない比は conversion rate と呼ばない
- 定義・期間・基準・単位・timezone・費用基準が違う数字は別系列のまま見せ、上書きも合算もしない
- 親の合計と子の行を足さない。creative ID が無い行は「未紐付け」で、名前付き creative の 0 にはしない
- 手数料請求の対象判定に使う定義は、マーケの conversion に使わない

標準ライブラリだけで動く。外部 API・シート・実データには一切つながない。
"""
import datetime
import decimal
import glob
import html
import io
import json
import os
import re

try:
    import zoneinfo
except ImportError:  # 古い Python や一部の配布物
    zoneinfo = None

SCHEMA = 'marketing-lab/measurement/v1'
MAX_VALUE = decimal.Decimal(10) ** 15

# 値状態
VALUE, ZERO, BLANK, UNAVAILABLE, ERROR, NA = (
    'value', 'genuine_zero', 'blank', 'unavailable', 'source_error', 'not_applicable')
STATE_JA = {VALUE: '値あり', ZERO: '0（実測）', BLANK: '空欄', UNAVAILABLE: '取得不可',
            ERROR: '元データエラー', NA: '対象外'}
MEASURED = (VALUE, ZERO)
DECLARABLE = (UNAVAILABLE, NA)

UNITS = {'rows': '行数', 'unique_people': '人数（ユニーク）', 'currency': '金額'}
BASES = {'occurrence': '発生日基準', 'registration_cohort': '登録cohort基準'}
PURPOSES = {'marketing': 'マーケ計測', 'billing': '手数料請求の対象判定'}
LEVELS = ('campaign', 'ad', 'creative')
LEVEL_JA = {'campaign': 'キャンペーン', 'ad': '広告', 'creative': 'creative'}
MATCH_JA = {'matched': '一致', 'missing_id': 'ID欠落（未紐付け）', 'unknown_id': 'ID不一致（未紐付け）',
            'not_creative': '—'}

# timezone は IANA 名のまま持つ。固定時差や東京への置き換えはしない（夏時間・日付境界を誤るため）。
# 標準の zoneinfo で引けたものだけを「検証済み」とし、引けない環境（Windows で tzdata が無い等）では
# 「未検証」として、日付の変換・成熟判定・比較・比を止める。未知の名前は検証停止
TZ_VALID, TZ_UNVALIDATED, TZ_UNKNOWN = 'valid', 'unvalidated', 'unknown'
TZ_JA = {TZ_VALID: '検証済み', TZ_UNVALIDATED: '未検証（この環境に timezone データベースが無い）',
         TZ_UNKNOWN: '未知の timezone'}


_IANA = []


_IANA_AREA = re.compile(r'^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)/[A-Za-z0-9_+\-/]+$')


def _iana_names():
    """検証済みにしてよい名前。available_timezones() はファイルを数えるだけなので 'localtime' や 'Factory'、
    旧名（'Japan' など）も含む。地域/都市の正式名と UTC だけに絞る"""
    if not _IANA:
        _IANA.append(frozenset(n for n in zoneinfo.available_timezones() if n == 'UTC' or _IANA_AREA.match(n)))
    return _IANA[0]


def offset_ok(d, zi):
    """記録された時差が正しいか。UTC 表記（+00:00 / Z）は同じ瞬間を一意に表すので受け付け、報告 timezone に変換して使う。
    それ以外の時差は、報告 timezone のその瞬間の時差（夏時間を含む）と一致しなければならない"""
    return d.utcoffset() == datetime.timedelta(0) or d.utcoffset() == d.astimezone(zi).utcoffset()


def day_closed(cutoff, day, zi):
    """cutoff（「この瞬間より前を含む」）までに、報告 timezone の暦日 day が丸ごと入っているか。
    翌日 0:00 ちょうどの cutoff で締まる。1秒前ならまだ締まっていない"""
    nxt = datetime.datetime.combine(day + datetime.timedelta(days=1), datetime.time(0), tzinfo=zi)
    return cutoff >= nxt


def day_started_after(cutoff, day, zi):
    """報告 timezone の暦日 day の 0:00 が cutoff 以降か（その日の出来事は1件も入っていないはず）"""
    return datetime.datetime.combine(day, datetime.time(0), tzinfo=zi) >= cutoff


def tz_status(name):
    """(状態, ZoneInfo | None, 説明)"""
    if not isinstance(name, str) or not name.strip() or name != name.strip():
        return TZ_UNKNOWN, None, 'timezone の名前が不正です'
    if zoneinfo is None:
        return TZ_UNVALIDATED, None, 'zoneinfo が使えない環境です'
    try:
        zi = zoneinfo.ZoneInfo(name)
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        zi = None
    if zi is not None:
        # 'localtime' のようにファイルとしては引けても、機械ごとに中身が変わる名前は IANA 名として扱わない
        if name in _iana_names():
            return TZ_VALID, zi, ''
        return TZ_UNKNOWN, None, 'IANA の timezone 名ではありません: %s' % name[:40]
    try:
        zoneinfo.ZoneInfo('UTC')  # データベース自体があるか
    except zoneinfo.ZoneInfoNotFoundError:
        return TZ_UNVALIDATED, None, 'timezone データベースが無い環境です'
    return TZ_UNKNOWN, None, '未知の timezone です: %s' % name[:40]

FORMULA_ERRORS = ('#REF!', '#DIV/0!', '#VALUE!', '#N/A', '#NAME?', '#NUM!', '#NULL!', '#ERROR!',
                  '#SPILL!', '#CALC!')
_NUM_RE = re.compile(r'^[¥￥]?\s*\d{1,3}(,\d{3})+(\.\d+)?$|^[¥￥]?\s*\d+(\.\d+)?$')


class MeasurementError(Exception):
    pass


# ---------------------------------------------------------------- 正規化

def normalize(raw, declared_state=None, unit='rows'):
    """raw（元の値）を {state, value, detail} にする。value は Decimal か None。

    - JSON の null と空文字・空白は「空欄」。0 には読み替えない
    - 数値の 0 と文字列の "0" は「0（実測）」として保持する
    - 数式エラー・読めない文字列・負数・bool・巨大値は「元データエラー」
    - 取得不可・対象外は、元が空のときだけ宣言できる（値があるのに宣言したら矛盾としてエラー）
    """
    if declared_state is not None:
        if declared_state not in DECLARABLE:
            return {'state': ERROR, 'value': None, 'detail': '宣言できない状態です: %s' % _short(declared_state)}
        if raw is not None and not (isinstance(raw, str) and not raw.strip()):
            return {'state': ERROR, 'value': None,
                    'detail': '%sと宣言されているのに値があります' % STATE_JA[declared_state]}
        return {'state': declared_state, 'value': None, 'detail': ''}
    if raw is None:
        return {'state': BLANK, 'value': None, 'detail': ''}
    if isinstance(raw, bool):
        return {'state': ERROR, 'value': None, 'detail': '真偽値は数値として扱いません'}
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return {'state': BLANK, 'value': None, 'detail': ''}
        if s.upper() in FORMULA_ERRORS:
            return {'state': ERROR, 'value': None, 'detail': '数式エラー %s' % s.upper()}
        if not _NUM_RE.match(s):
            return {'state': ERROR, 'value': None, 'detail': '数値として読めない文字列です'}
        v = decimal.Decimal(s.lstrip('¥￥').strip().replace(',', ''))
    elif isinstance(raw, (int, decimal.Decimal)):
        v = decimal.Decimal(raw) if isinstance(raw, int) and abs(raw) <= 10 ** 30 else raw
        if isinstance(v, int):
            return {'state': ERROR, 'value': None, 'detail': '上限を超える数値です'}
    elif isinstance(raw, float):
        if raw != raw or raw in (float('inf'), float('-inf')):
            return {'state': ERROR, 'value': None, 'detail': '有限でない数値です'}
        v = decimal.Decimal(repr(raw))
    else:
        return {'state': ERROR, 'value': None, 'detail': '数値ではない型です'}
    if not v.is_finite():
        return {'state': ERROR, 'value': None, 'detail': '有限でない数値です'}
    if v < 0:
        return {'state': ERROR, 'value': None, 'detail': '負の値です'}
    if v > MAX_VALUE:
        return {'state': ERROR, 'value': None, 'detail': '上限（1000兆）を超えています'}
    if unit in ('rows', 'unique_people') and v != v.to_integral_value():
        return {'state': ERROR, 'value': None, 'detail': '件数・人数が整数ではありません'}
    if v == 0:
        return {'state': ZERO, 'value': decimal.Decimal(0), 'detail': ''}
    return {'state': VALUE, 'value': v, 'detail': ''}


def _short(v):
    r = repr(v)
    return r if len(r) <= 40 else r[:37] + '...'


def raw_text(raw):
    """原値を、型が分かる形で見せる（null と "" と 0 を見分けられるように）"""
    if raw is None:
        return 'null'
    if isinstance(raw, str):
        return json.dumps(raw if len(raw) <= 40 else raw[:37] + '...', ensure_ascii=False)
    if isinstance(raw, bool):
        return 'true' if raw else 'false'
    if isinstance(raw, decimal.Decimal):
        return str(raw) if raw.is_finite() else '（有限でない数値）'
    if isinstance(raw, float) and (raw != raw or raw in (float('inf'), float('-inf'))):
        return '（有限でない数値）'
    if isinstance(raw, int) and abs(raw) > 10 ** 30:
        return '（30桁を超える整数）'
    return _short(raw)


# ---------------------------------------------------------------- 読込

def _parse_float(s):
    v = decimal.Decimal(s)
    if not v.is_finite() or abs(v) > decimal.Decimal(10) ** 30:
        raise MeasurementError('有限でない、または大きすぎる数値 %s は使えません' % s[:40])
    return v


def _reject_constant(name):
    raise MeasurementError('不正な数値 %s は使えません' % name)


def load_dir(path):
    """*.json を名前順に読む。小数は Decimal で受ける（2進小数の誤差を持ち込まない）"""
    out = []
    if not path or not os.path.isdir(path):
        return out
    for fp in sorted(glob.glob(os.path.join(path, '*.json'))):
        name = os.path.basename(fp)
        try:
            with io.open(fp, encoding='utf-8') as f:
                out.append((name, json.load(f, parse_float=_parse_float, parse_constant=_reject_constant)))
        except (ValueError, MeasurementError) as ex:
            out.append((name, MeasurementError(str(ex))))
    return out


# ---------------------------------------------------------------- 検証

def _date(v):
    try:
        return datetime.date.fromisoformat(v) if isinstance(v, str) else None
    except ValueError:
        return None


def _dt(v):
    try:
        d = datetime.datetime.fromisoformat(v) if isinstance(v, str) else None
    except ValueError:
        return None
    return d if d is not None and d.tzinfo else None


def _s(v):
    return isinstance(v, str) and bool(v)


class Check:
    def __init__(self, dataset_id):
        self.id = dataset_id
        self.errors = []

    def err(self, code, where, msg):
        self.errors.append({'code': code, 'where': where, 'msg': msg})


def _list(ck, d, key, where):
    v = d.get(key) if isinstance(d, dict) else None
    if not isinstance(v, list):
        ck.err('SCHEMA', '%s/%s' % (where, key), '配列が必要です')
        return []
    bad = [i for i, x in enumerate(v) if not isinstance(x, dict)]
    for i in bad:
        ck.err('SCHEMA', '%s/%s[%d]' % (where, key, i), 'オブジェクトが必要です')
    return [x for x in v if isinstance(x, dict)]


def _dups(ck, items, key, kind):
    seen = set()
    for x in items:
        k = key(x)
        if k in seen:
            ck.err('DUP_ID', kind, '%s が重複しています: %s' % (kind, _short(k)))
        seen.add(k)


def validate(ds, now):
    """1データセットを検証する。エラーがあれば、そのデータセットは検証停止"""
    did = ds.get('dataset_id') if isinstance(ds, dict) else None
    ck = Check(did if _s(did) else '(不明)')
    if not isinstance(ds, dict):
        ck.err('SCHEMA', '/', 'オブジェクトが必要です')
        return ck
    if ds.get('schema') != SCHEMA:
        ck.err('SCHEMA', 'schema', '%s ではありません' % SCHEMA)
    if ds.get('demo') is not True or ds.get('synthetic') is not True:
        ck.err('SCHEMA', 'demo', '合成データは demo: true と synthetic: true が必須です')
    if not _s(did):
        ck.err('MISSING', 'dataset_id', 'dataset_id がありません')
    biz = ds.get('business')
    if not (isinstance(biz, dict) and _s(biz.get('id')) and _s(biz.get('name')) and _s(biz.get('brand'))):
        ck.err('MISSING', 'business', 'business の id / name / brand が必要です')

    srcs = _list(ck, ds, 'sources', '')
    defs = _list(ck, ds, 'metric_definitions', '')
    nodes = _list(ck, ds, 'nodes', '')
    obs = _list(ck, ds, 'observations', '')
    ratios = _list(ck, ds, 'ratios', '')
    comps = _list(ck, ds, 'comparisons', '')
    if ck.errors:
        return ck

    _dups(ck, srcs, lambda x: x.get('id'), 'source ID')
    _dups(ck, defs, lambda x: (x.get('id'), x.get('version')), '指標定義 ID/版')
    _dups(ck, nodes, lambda x: x.get('id'), 'node ID')
    _dups(ck, obs, lambda x: x.get('id'), '観測行 ID')
    _dups(ck, ratios + comps, lambda x: x.get('id'), '比・比較 ID')

    for s in srcs:
        w = 'sources/%s' % s.get('id')
        ref = s.get('ref')
        if not (_s(ref) and ref.startswith('synthetic://')):
            ck.err('BAD_SOURCE', w, '出典は synthetic:// の架空 placeholder に限ります')
        tz = s.get('timezone')
        tst, zi, tmsg = tz_status(tz)
        if tst == TZ_UNKNOWN:
            ck.err('BAD_TZ', w, tmsg)
        cut, got = _dt(s.get('data_cutoff')), _dt(s.get('fetched_at'))
        if cut is None or got is None:
            ck.err('BAD_DATE', w, 'data_cutoff / fetched_at は時差付きの日時が必要です')
            continue
        if tst == TZ_VALID:
            # その瞬間の時差（夏時間を含む）と、記録された時差が一致するか（UTC 表記は可）
            for k, d in (('data_cutoff', cut), ('fetched_at', got)):
                if not offset_ok(d, zi):
                    ck.err('BAD_TZ', w + '/' + k, '日時の時差が %s のその時点の時差（%s）と一致しません' % (
                        tz, d.astimezone(zi).utcoffset()))
        if cut > got:
            ck.err('DATE_ORDER', w, 'データの cutoff が取得時刻より後です')
        if got > now:
            ck.err('DATE_ORDER', w, '取得時刻が現在より未来です')

    dmap = {}
    for d in defs:
        w = 'metric_definitions/%s' % d.get('id')
        if not (_s(d.get('id')) and _s(d.get('version')) and _s(d.get('label'))):
            ck.err('MISSING', w, 'id / version / label が必要です')
        if d.get('unit') not in UNITS:
            ck.err('BAD_VALUE', w, 'unit は rows / unique_people / currency のどれかです')
        if d.get('basis') not in BASES:
            ck.err('BAD_VALUE', w, 'basis は occurrence / registration_cohort のどちらかです')
        if d.get('purpose') not in PURPOSES:
            ck.err('BAD_VALUE', w, 'purpose は marketing / billing のどちらかです')
        if d.get('unit') == 'currency':
            if not (_s(d.get('currency')) and re.match(r'^[A-Z]{3}$', d['currency']) and _s(d.get('cost_basis'))):
                ck.err('MISSING', w, '金額の定義には通貨（ISO 3文字）と費用基準が必要です')
        elif d.get('currency') is not None or d.get('cost_basis') is not None:
            ck.err('BAD_VALUE', w, '件数・人数の定義に通貨・費用基準は付けません')
        dmap[(d.get('id'), d.get('version'))] = d
    for d in defs:
        p = d.get('population_of')
        if p is None:
            continue
        w = 'metric_definitions/%s' % d.get('id')
        tgt = dmap.get((p.get('id'), p.get('version'))) if isinstance(p, dict) else None
        if tgt is None:
            ck.err('UNKNOWN_REF', w, 'population_of の定義がありません')
        elif d.get('purpose') == 'marketing' and tgt.get('purpose') == 'billing':
            ck.err('BILLING_RULE', w, 'マーケの定義が手数料請求の対象判定を母集団にしています')
        elif d.get('basis') != tgt.get('basis'):
            ck.err('BAD_VALUE', w, '母集団の定義と基準（発生日／cohort）が違います')
    for d in defs:
        rr = d.get('rule_ref')
        if rr is None:
            continue
        w = 'metric_definitions/%s' % d.get('id')
        if not isinstance(rr, dict):
            ck.err('BAD_VALUE', w, 'rule_ref は {id, version} か {purpose} です')
            continue
        tgt = dmap.get((rr.get('id'), rr.get('version'))) if 'id' in rr else None
        if 'id' in rr and tgt is None:
            ck.err('UNKNOWN_REF', w, 'rule_ref の定義がありません')
        billing = rr.get('purpose') == 'billing' or (tgt is not None and tgt.get('purpose') == 'billing')
        if d.get('purpose') == 'marketing' and billing:
            ck.err('BILLING_RULE', w, '手数料請求の対象判定ルールをマーケの conversion に適用しています')

    nmap = {n.get('id'): n for n in nodes}
    for n in nodes:
        w = 'nodes/%s' % n.get('id')
        if n.get('level') not in LEVELS:
            ck.err('BAD_VALUE', w, 'level は campaign / ad / creative のどれかです')
            continue
        par = n.get('parent')
        if n['level'] == 'campaign':
            if par is not None:
                ck.err('BAD_VALUE', w, 'campaign は親を持ちません')
        else:
            want = LEVELS[LEVELS.index(n['level']) - 1]
            if par not in nmap or nmap[par].get('level') != want:
                ck.err('UNKNOWN_REF', w, '親（%s）がありません、または階層が違います' % want)

    smap = {s.get('id'): s for s in srcs}
    keys = set()
    for o in obs:
        w = 'observations/%s' % o.get('id')
        m = o.get('metric')
        d = dmap.get((m.get('id'), m.get('version'))) if isinstance(m, dict) else None
        if d is None:
            ck.err('UNKNOWN_REF', w, '指標定義（id/版）がありません')
        if o.get('source') not in smap:
            ck.err('UNKNOWN_REF', w, 'source がありません')
        if not _s(o.get('cell')):
            ck.err('MISSING', w, '元の位置（架空 placeholder）がありません')
        p = o.get('period') or {}
        ps, pe = _date(p.get('start')), _date(p.get('end'))
        if ps is None or pe is None:
            ck.err('BAD_DATE', w, '報告期間の日付が読めません')
        elif ps > pe:
            ck.err('DATE_ORDER', w, '報告期間の開始が終了より後です')
        src = smap.get(o.get('source'))
        if d is not None and src is not None and ps is not None:
            tst, zi, _ = tz_status(src.get('timezone'))
            cut = _dt(src.get('data_cutoff'))
            if tst == TZ_VALID and cut is not None and day_started_after(cut, ps, zi):
                if normalize(o.get('raw'), o.get('declared_state'), d.get('unit'))['state'] == VALUE:
                    ck.err('DATE_ORDER', w, '期間の開始がデータ cutoff 以降なのに値があります（cutoff か期間のどちらかが誤り）')
        co = o.get('cohort')
        if d is not None and d.get('basis') == 'registration_cohort':
            cs, ce, cx = (_date((co or {}).get(k)) for k in ('start', 'end', 'observation_end'))
            if cs is None or ce is None or cx is None:
                ck.err('MISSING', w, '登録cohort基準には cohort の start / end / observation_end が必要です')
            elif not (cs <= ce <= cx):
                ck.err('DATE_ORDER', w, 'cohort は 開始 ≤ 終了 ≤ 観測終了 の順が必要です')
            elif (ps, pe) != (cs, ce):
                ck.err('DATE_ORDER', w, '登録cohortの期間と報告期間が一致しません')
        elif co is not None:
            ck.err('BAD_VALUE', w, '発生日基準の行に cohort は付けません')
        lv = o.get('level')
        if lv not in LEVELS:
            ck.err('BAD_VALUE', w, 'level が不正です')
        elif lv == 'creative':
            under = o.get('under')
            if under not in nmap or nmap[under].get('level') != 'ad':
                ck.err('UNKNOWN_REF', w, 'creative 行には所属する広告（under）が必要です')
            if 'node' in o:
                ck.err('BAD_VALUE', w, 'creative 行は node ではなく creative_id_raw で紐付けます')
            cid = o.get('creative_id_raw')
            if cid is not None and not isinstance(cid, str):
                ck.err('BAD_VALUE', w, 'creative_id_raw は文字列か null です')
        else:
            nd = nmap.get(o.get('node'))
            if nd is None or nd.get('level') != lv:
                ck.err('UNKNOWN_REF', w, '%s の node がありません' % lv)
            if 'creative_id_raw' in o or 'under' in o:
                ck.err('BAD_VALUE', w, 'creative_id_raw / under は creative 行だけに付けます')
        ds_ = o.get('declared_state')
        if ds_ is not None and ds_ not in DECLARABLE:
            ck.err('BAD_VALUE', w, 'declared_state は unavailable / not_applicable のどちらかです')
        cid = (o.get('creative_id_raw') or '').strip() if lv == 'creative' else None
        if lv == 'creative' and not cid:
            cid = ('__unattributed__', o.get('id'))  # ID の無い行どうしは別の行として残す（まとめない）
        k = ((m or {}).get('id'), (m or {}).get('version'), lv, o.get('node'), o.get('under'), cid,
             o.get('source'), p.get('start'), p.get('end'))
        if k in keys:
            ck.err('DUP_SERIES', w, '同じ定義・同じ対象・同じ期間の行が2つあります。上書きも合算もしません')
        keys.add(k)

    omap = {o.get('id'): o for o in obs}
    for r in ratios:
        w = 'ratios/%s' % r.get('id')
        if r.get('intent') not in ('conversion', 'cost_per'):
            ck.err('BAD_VALUE', w, 'intent は conversion / cost_per のどちらかです')
        for side in ('numerator', 'denominator'):
            if r.get(side) not in omap:
                ck.err('UNKNOWN_REF', w, '%s の観測行がありません' % side)
    for c in comps:
        for side in ('a', 'b'):
            if c.get(side) not in omap:
                ck.err('UNKNOWN_REF', 'comparisons/%s' % c.get('id'), '%s の観測行がありません' % side)
    return ck


# ---------------------------------------------------------------- 評価

class Dataset:
    """検証済みデータセットの読み取り用の索引"""

    def __init__(self, ds):
        self.ds = ds
        self.src = {s['id']: s for s in ds['sources']}
        self.defs = {(d['id'], d['version']): d for d in ds['metric_definitions']}
        self.nodes = {n['id']: n for n in ds['nodes']}
        self.obs = {o['id']: o for o in ds['observations']}
        self.norm = {o['id']: normalize(o.get('raw'), o.get('declared_state'), self.d(o)['unit'])
                     for o in ds['observations']}

    def d(self, o):
        return self.defs[(o['metric']['id'], o['metric']['version'])]

    def tz(self, o):
        return self.src[o['source']]['timezone']

    def tz_state(self, o):
        return tz_status(self.tz(o))[0]

    def cutoff(self, o):
        return _dt(self.src[o['source']]['data_cutoff'])

    def match(self, o):
        """creative 行の紐付け状態。ID欠落・ID不一致は未紐付けで、名前付き creative の 0 ではない"""
        if o['level'] != 'creative':
            return 'not_creative', o.get('node')
        cid = (o.get('creative_id_raw') or '').strip()
        if not cid:
            return 'missing_id', None
        n = self.nodes.get(cid)
        if n is None or n.get('level') != 'creative' or n.get('parent') != o['under']:
            return 'unknown_id', None
        return 'matched', cid

    def scope(self, o):
        """行の対象。creative 行は紐付けた creative、未紐付けは所属広告＋行ID"""
        st, nid = self.match(o)
        if o['level'] != 'creative':
            return o['node']
        return nid if st == 'matched' else 'unattributed:%s:%s' % (o['under'], o['id'])

    def maturity(self, o):
        """(未成熟か, 説明)。cohort は観測終了日が cutoff を過ぎるまで確定しない。
        発生日基準でも、報告期間の終わりが cutoff より後なら期間が締まっていない"""
        d = self.d(o)
        cut = self.cutoff(o)
        st, zi, _ = tz_status(self.tz(o))
        if st != TZ_VALID:
            return True, 'timezone %s が%sのため、報告期間の日付境界と cutoff を突き合わせられません' % (
                self.tz(o), TZ_JA[st])
        # cutoff は「この時刻より前を含む」。最終日が丸ごと入るのは、cutoff が
        # 報告 timezone での翌日 0:00 以降のときだけ（9/30 23:59 で切れば 9/30 は締まっていない）
        def complete(day):
            return day_closed(cut, day, zi)
        if d['basis'] == 'registration_cohort':
            xe = _date(o['cohort']['observation_end'])
            if not complete(xe):
                return True, 'open cohort（観測終了 %s ／ データ cutoff %s）' % (xe.isoformat(), cut.isoformat())
            return False, ''
        pe = _date(o['period']['end'])
        if not complete(pe):
            return True, '期間が締まっていない（期間終了 %s ／ データ cutoff %s）' % (pe.isoformat(), cut.isoformat())
        return False, ''


def obs_window(o):
    """cohort の観測期間の長さ（cohort 終了日の翌日から観測終了日までの日数）。発生日基準は None"""
    co = o.get('cohort')
    if not co:
        return None
    return (_date(co['observation_end']) - _date(co['end'])).days


def series_key(ds, o):
    d = ds.d(o)
    return (d['id'], d['version'], d['unit'], d['basis'], d['purpose'], ds.tz(o),
            d.get('currency') or '', d.get('cost_basis') or '', o['level'])


def comparability(ds, a, b):
    """2行を比べてよいか。戻り値 (比べてよいか, [止める理由])"""
    why = []
    da, db = ds.d(a), ds.d(b)
    na, nb = ds.norm[a['id']], ds.norm[b['id']]
    for o, n in ((a, na), (b, nb)):
        if n['state'] not in MEASURED:
            why.append('%s が%s（0ではありません）' % (o['id'], STATE_JA[n['state']]))
    if (da['id'], da['version']) != (db['id'], db['version']):
        why.append('指標定義が違います（%s %s ／ %s %s）' % (da['id'], da['version'], db['id'], db['version']))
    if da['unit'] != db['unit']:
        why.append('数える単位が違います（%s ／ %s）' % (UNITS[da['unit']], UNITS[db['unit']]))
    if da['basis'] != db['basis']:
        why.append('基準が違います（%s ／ %s）' % (BASES[da['basis']], BASES[db['basis']]))
    if da['purpose'] != db['purpose']:
        why.append('用途が違います（%s ／ %s）' % (PURPOSES[da['purpose']], PURPOSES[db['purpose']]))
    if ds.tz(a) != ds.tz(b):
        why.append('timezone が違います（%s ／ %s）' % (ds.tz(a), ds.tz(b)))
    for o in (a, b):
        if ds.tz_state(o) != TZ_VALID:
            why.append('%s の timezone %s は%s' % (o['id'], ds.tz(o), TZ_JA[ds.tz_state(o)]))
    if (da.get('currency'), da.get('cost_basis')) != (db.get('currency'), db.get('cost_basis')):
        why.append('通貨・費用基準が違います（%s %s ／ %s %s）' % (
            da.get('currency'), da.get('cost_basis'), db.get('currency'), db.get('cost_basis')))
    wa, wb = obs_window(a), obs_window(b)
    if wa != wb:
        why.append('cohort の観測期間の長さが違います（cohort 終了後 %s日 ／ %s日）' % (wa, wb))
    la = (_date(a['period']['end']) - _date(a['period']['start'])).days
    lb = (_date(b['period']['end']) - _date(b['period']['start'])).days
    if la != lb:
        why.append('期間の長さが違います（%d日 ／ %d日）' % (la + 1, lb + 1))
    for o in (a, b):
        im, txt = ds.maturity(o)
        if im:
            why.append('%s は %s' % (o['id'], txt))
        if ds.match(o)[0] in ('missing_id', 'unknown_id'):
            why.append('%s は creative 未紐付けの行です。名前付き creative と比べません' % o['id'])
    if a['level'] != b['level']:
        why.append('集計の階層が違います（%s ／ %s）' % (LEVEL_JA[a['level']], LEVEL_JA[b['level']]))
    return (not why), why


def evaluate_ratio(ds, r):
    """比を判定する。kind:
      cvr          … 母集団・期間・cohort がそろい、cohort が締まっている conversion rate
      provisional  … 計算はできるが open cohort。暫定比で、確定CVRとして扱わない
      count_ratio  … 同じ期間の件数比。母集団がそろわないので CVR とは呼ばない
      cost_per     … 費用 ÷ 件数（同じ期間・同じ対象・同じ timezone）
      blocked      … 定義・期間・基準・対象などが違うため、値を出さない
      undecidable  … 分子・分母が測れていない、または分母が 0（実測）
    """
    num, den = ds.obs[r['numerator']], ds.obs[r['denominator']]
    dn, dd = ds.d(num), ds.d(den)
    nn, nd = ds.norm[num['id']], ds.norm[den['id']]
    out = {'ratio': r, 'num': num, 'den': den, 'value': None, 'reasons': [], 'notes': []}
    stop = []
    if ds.scope(num) != ds.scope(den):
        stop.append('分子と分母の対象（node）が違います')
    if num['period'] != den['period']:
        stop.append('分子と分母の期間が違います（%s〜%s ／ %s〜%s）' % (
            num['period']['start'], num['period']['end'], den['period']['start'], den['period']['end']))
    if dn['basis'] != dd['basis']:
        stop.append('基準が違います（分子 %s ／ 分母 %s）' % (BASES[dn['basis']], BASES[dd['basis']]))
    if ds.tz(num) != ds.tz(den):
        stop.append('timezone が違います（%s ／ %s）' % (ds.tz(num), ds.tz(den)))
    for o in (num, den):
        if ds.tz_state(o) != TZ_VALID:
            stop.append('%s の timezone %s は%s' % (o['id'], ds.tz(o), TZ_JA[ds.tz_state(o)]))
    stop = list(dict.fromkeys(stop))
    if 'billing' in (dn['purpose'], dd['purpose']):
        # 手数料請求の対象判定で数えたものは、率にも単価にも使わない
        stop.append('手数料請求の対象判定の定義を含みます（マーケの率・単価に使いません）')
    if r['intent'] == 'cost_per':
        if dn['unit'] != 'currency' or dd['unit'] == 'currency':
            stop.append('費用 ÷ 件数・人数の形になっていません')
    elif 'currency' in (dn['unit'], dd['unit']):
        stop.append('金額を含む比は conversion rate になりません')
    elif dn['unit'] != dd['unit']:
        # 行数 ÷ 人数 は率として読めない（100% を超えても異常に見えない）。値を出さない
        stop.append('数える単位が違います（%s ／ %s）' % (UNITS[dn['unit']], UNITS[dd['unit']]))
    if stop:
        out.update(kind='blocked', reasons=stop)
        return out
    for side, o, n in (('分子', num, nn), ('分母', den, nd)):
        if n['state'] not in MEASURED:
            out['reasons'].append('%sが%s（%s）' % (side, STATE_JA[n['state']], n['detail'] or '値なし'))
    if out['reasons']:
        out['kind'] = 'undecidable'
        return out
    if nd['value'] == 0:
        out.update(kind='undecidable', reasons=['分母が0（実測）'])
        return out
    out['value'] = nn['value'] / nd['value']
    if r['intent'] == 'cost_per':
        out['kind'] = 'cost_per'
        out['kind_label'] = '費用 ÷ %s' % UNITS[dd['unit']]
        out['notes'].append('%s・%s。%sの同期間の費用 ÷ %sで、施策の効率の証明ではありません' % (
            dn['currency'], dn['cost_basis'], BASES[dd['basis']], UNITS[dd['unit']]))
        im, txt = ds.maturity(num)
        im2, txt2 = ds.maturity(den)
        if im or im2:
            out['kind'] = 'blocked'
            out['value'] = None
            out['reasons'] = list(dict.fromkeys([t for t in (txt, txt2) if t]))
        return out
    not_cvr = []
    if dn['basis'] == 'occurrence':
        not_cvr.append('発生日基準の同期間の件数比です。分子の人が分母に含まれる保証がありません')
    pop = dn.get('population_of') or {}
    if (pop.get('id'), pop.get('version')) != (dd['id'], dd['version']):
        not_cvr.append('分子が分母の母集団の部分集合として定義されていません')
    im, txt = ds.maturity(num)
    im2, txt2 = ds.maturity(den)
    if not_cvr:
        if im or im2:
            # 締まっていない期間の件数比は、締まった月と並べて読まれるので値を出さない
            out.update(kind='blocked', value=None,
                       reasons=list(dict.fromkeys([t for t in (txt, txt2) if t])) + not_cvr)
            return out
        out.update(kind='count_ratio', reasons=not_cvr)
        return out
    win = obs_window(num)
    out['notes'].append('観測期間: cohort 終了後 %d日（%s まで）。観測期間の長さが違う cohort とは並べて比べません'
                        % (win, num['cohort']['observation_end']))
    if im or im2:
        zi = tz_status(ds.tz(num))[1]
        last = (ds.cutoff(num).astimezone(zi) - datetime.timedelta(microseconds=1)).date()  # 丸ごと入った最後の日
        seen = max(0, (min(last, _date(num['cohort']['observation_end'])) - _date(num['cohort']['end'])).days)
        out.update(kind='provisional', reasons=list(dict.fromkeys([t for t in (txt, txt2) if t])) +
                   ['観測が終わっていないので、ここから増えます。確定したCVRとして扱いません',
                    '予定の観測期間 cohort 終了後 %d日のうち、データ cutoff までに観測できたのは %d日分です'
                    % (obs_window(num), seen)])
        return out
    if nn['value'] > nd['value']:
        out.update(kind='blocked', value=None, reasons=['分子が分母を超えています（部分集合になっていません）'])
        return out
    out['kind'] = 'cvr'
    return out


def rollups(ds):
    """親の行ごとに、子の行と突き合わせる。親と子は足さない（二重計上を防ぐ）"""
    out = []
    obs = ds.ds['observations']
    for p in obs:
        if p['level'] == 'creative':
            continue
        child_level = LEVELS[LEVELS.index(p['level']) + 1]
        same = [o for o in obs if o['metric'] == p['metric'] and o['period'] == p['period']
                and o.get('cohort') == p.get('cohort') and o['source'] == p['source'] and o['level'] == child_level]
        if child_level == 'creative':
            kids = [o for o in same if o['under'] == p['node']]
        else:
            kids = [o for o in same if ds.nodes[o['node']].get('parent') == p['node']]
        if not kids:
            continue
        d = ds.d(p)
        res = {'parent': p, 'children': kids, 'sum': None, 'diff': None, 'notes': [], 'no_rows': []}
        if child_level == 'creative':
            have = {ds.match(o)[1] for o in kids}
            res['no_rows'] = sorted(n['id'] for n in ds.nodes.values()
                                    if n.get('parent') == p['node'] and n['level'] == 'creative' and n['id'] not in have)
        else:
            have = {o['node'] for o in kids}
            res['no_rows'] = sorted(n['id'] for n in ds.nodes.values()
                                    if n.get('parent') == p['node'] and n['id'] not in have)
        bad = sorted({STATE_JA[ds.norm[o['id']]['state']] for o in kids if ds.norm[o['id']]['state'] not in MEASURED})
        if d['unit'] == 'unique_people':
            res['notes'].append('人数（ユニーク）は子を足すと重複する可能性があるため、合計を出しません')
        elif bad:
            res['notes'].append('子の行に %s があるため、合計を出しません（0として足しません）' % '・'.join(bad))
        else:
            if res['no_rows']:
                res['notes'].append('行の無い子（%s）は 0 として扱っていません（成果 0 の証拠ではありません）。'
                                    '合計は「行のある子」だけのものです' % '・'.join(res['no_rows']))
            res['sum'] = sum(ds.norm[o['id']]['value'] for o in kids)
            pn = ds.norm[p['id']]
            if pn['state'] in MEASURED:
                res['diff'] = pn['value'] - res['sum']
                if res['diff'] != 0:
                    res['notes'].append('親の値と子の合計が一致しません（差 %s）。どちらが正しいかは元データで確認が必要です'
                                        % fmt_value(res['diff'], d, signed=True))
            else:
                res['notes'].append('親の行が%sのため、突き合わせできません' % STATE_JA[pn['state']])
        if any(ds.match(o)[0] in ('missing_id', 'unknown_id') for o in kids):
            res['notes'].append('creative ID の無い・合わない行は「未紐付け」として別に数えています。'
                                '名前付き creative の成果 0 の証拠ではありません')
        res['notes'].append('親の値と子の行は足しません（二重計上になります）')
        out.append(res)
    return out


# ---------------------------------------------------------------- 書式

def fmt_value(v, d, signed=False):
    if v is None:
        return ''
    sign = ''
    if signed:
        sign = '+' if v >= 0 else '-'
        v = abs(v)
    if d['unit'] == 'currency':
        q = v.quantize(decimal.Decimal('1'), rounding=decimal.ROUND_HALF_UP)
        return '%s %s' % (d['currency'], sign + '{:,}'.format(int(q)))
    q = v.quantize(decimal.Decimal('1'), rounding=decimal.ROUND_HALF_UP)
    return sign + '{:,}'.format(int(q))


def fmt_ratio(v):
    q = (v * 100).quantize(decimal.Decimal('0.01'), rounding=decimal.ROUND_HALF_UP)
    return '%s%%' % q


def fmt_cost_per(v, d):
    q = v.quantize(decimal.Decimal('1'), rounding=decimal.ROUND_HALF_UP)
    return '%s {:,}'.format(int(q)) % d['currency']


# ---------------------------------------------------------------- 描画

def e(v):
    return html.escape('' if v is None else str(v), quote=True)


KIND_JA = {'cvr': ('conversion rate（確定）', 'ok'), 'provisional': ('暫定比（未成熟・CVRではない）', 'wait'),
           'count_ratio': ('件数比（CVRではない）', 'wait'), 'cost_per': ('費用 ÷ 件数', 'ok'),
           'blocked': ('計算しない', 'stop'), 'undecidable': ('判定不可', 'stop')}
STATE_CLS = {VALUE: 'ok', ZERO: 'ok', BLANK: 'wait', UNAVAILABLE: 'wait', ERROR: 'stop', NA: 'na'}


def _state(n):
    return '<span class="st %s">%s</span>' % (STATE_CLS[n['state']], e(STATE_JA[n['state']]))


def _norm_text(ds, o):
    n = ds.norm[o['id']]
    if n['state'] in MEASURED:
        return e(fmt_value(n['value'], ds.d(o)))
    return '<span class="unk">値なし</span>'


def _obs_label(ds, o):
    d = ds.d(o)
    st, nid = ds.match(o)
    who = nid if o['level'] != 'creative' or st == 'matched' else '未紐付け（%s配下）' % o['under']
    return '%s %s ／ %s %s' % (o['id'], d['label'], LEVEL_JA[o['level']], who)


def render_dataset(name, ds_raw, ck):
    did = (ds_raw or {}).get('dataset_id') if isinstance(ds_raw, dict) else None
    did = did if _s(did) else os.path.splitext(name)[0]
    h = ['<section class="biz ms" id="ms-%s">' % e(did)]
    biz = (ds_raw or {}).get('business') if isinstance(ds_raw, dict) else None
    title = biz.get('name') if isinstance(biz, dict) and _s(biz.get('name')) else did
    h.append('<h2>計測の正規化（合成）: %s <small>dataset_id: %s</small></h2>' % (e(title), e(did)))
    h.append('<p class="warn">合成データです。架空の事業・架空の数値で、元データのシート・API・実集計には接続していません。'
             '出典は synthetic:// の placeholder です。</p>')
    if ck.errors:
        h.append('<div class="panel stopbox"><span class="badge stop">検証停止</span><p>このデータセットに矛盾があるため、'
                 '値・比・突き合わせを出していません。</p><ul>')
        for x in ck.errors[:40]:
            h.append('<li><code>%s</code> %s <span class="where">%s</span></li>' % (e(x['code']), e(x['msg']), e(x['where'])))
        h.append('</ul></div></section>')
        return ''.join(h)
    ds = Dataset(ds_raw)
    b = ds_raw['business']
    h.append('<p class="small">事業 %s ／ ブランド %s</p>' % (e(b['name']), e(b['brand'])))

    # 出典
    h.append('<div class="panel"><h3>出典（架空 placeholder）</h3><div class="tblwrap"><table><thead><tr>'
             '<th>source</th><th>placeholder</th><th>timezone</th><th>データ cutoff</th><th>取得時刻</th></tr></thead><tbody>')
    for s in ds_raw['sources']:
        tst = tz_status(s['timezone'])[0]
        h.append('<tr><td>%s</td><td><code>%s</code></td><td>%s<div class="small">%s</div></td><td>%s</td><td>%s</td></tr>' % (
            e(s['id']), e(s['ref']), e(s['timezone']), e(TZ_JA[tst]), e(s['data_cutoff']), e(s['fetched_at'])))
    h.append('</tbody></table></div><p class="small">cutoff は「どの時点までの出来事を含むか」、取得時刻は「いつ読んだか」。'
             '同じではありません。</p></div>')

    # 値状態の凡例
    cnt = {}
    for n in ds.norm.values():
        cnt[n['state']] = cnt.get(n['state'], 0) + 1
    h.append('<div class="panel"><h3>値の状態</h3><p class="small">%s</p>'
             '<p class="small">0（実測）だけが 0 です。空欄・取得不可・元データエラー・対象外は 0 として足しも比べもしません。</p></div>'
             % ' ／ '.join('%s %d件' % (_state({'state': k}), cnt.get(k, 0))
                          for k in (VALUE, ZERO, BLANK, UNAVAILABLE, ERROR, NA)))

    # 系列（定義・版・単位・基準・用途・timezone・通貨/費用基準・階層ごとに別）
    groups = {}
    for o in ds_raw['observations']:
        groups.setdefault(series_key(ds, o), []).append(o)
    h.append('<div class="panel"><h3>系列（意味の違う数字は別の表）</h3>')
    for k in sorted(groups, key=lambda x: tuple(str(i) for i in x)):
        rows = groups[k]
        d = ds.d(rows[0])
        extra = ' ／ %s・%s' % (d['currency'], d['cost_basis']) if d['unit'] == 'currency' else ''
        h.append('<div class="series"><h4>%s <small>%s %s</small></h4><p class="small">%s ／ %s ／ %s ／ timezone %s ／ %s%s</p>' % (
            e(d['label']), e(d['id']), e(d['version']), e(UNITS[d['unit']]), e(BASES[d['basis']]),
            e(PURPOSES[d['purpose']]), e(k[5]), e(LEVEL_JA[k[8]]), e(extra)))
        h.append('<div class="tblwrap"><table><thead><tr><th>行</th><th>対象</th><th>期間</th><th>原値</th><th>状態</th>'
                 '<th>正規化値</th><th>成熟</th><th>出典・位置</th></tr></thead><tbody>')
        for o in sorted(rows, key=lambda x: (x['period']['start'], x['id'])):
            n = ds.norm[o['id']]
            st, nid = ds.match(o)
            tgt = nid if o['level'] != 'creative' or st == 'matched' else (
                '<span class="unk">%s</span>' % e(MATCH_JA[st]))
            tgt = e(tgt) if not tgt.startswith('<span') else tgt
            if o['level'] == 'creative':
                tgt += '<div class="small">広告 %s ／ 元のID %s</div>' % (e(o['under']), e(raw_text(o.get('creative_id_raw'))))
            per = e('%s〜%s' % (o['period']['start'], o['period']['end']))
            if o.get('cohort'):
                per += '<div class="small">登録cohort・観測終了 %s</div>' % e(o['cohort']['observation_end'])
            im, txt = ds.maturity(o)
            h.append('<tr><td>%s</td><td>%s</td><td>%s</td><td><code>%s</code></td><td>%s%s</td><td>%s</td><td>%s</td>'
                     '<td><code>%s</code> %s</td></tr>' % (
                         e(o['id']), tgt, per, e(raw_text(o.get('raw'))), _state(n),
                         '<div class="small">%s</div>' % e(n['detail']) if n['detail'] else '',
                         _norm_text(ds, o), ('<span class="unk">判定不可（timezone %s）</span>' % e(TZ_JA[ds.tz_state(o)])
                                             if ds.tz_state(o) != TZ_VALID else
                                             '<span class="unk">未成熟</span>' if im else '締め済み'),
                         e(o['source']), e(o['cell'])))
        h.append('</tbody></table></div></div>')
    h.append('</div>')

    # 比
    if ds_raw['ratios']:
        h.append('<div class="panel"><h3>比（CVR と呼べるかを判定）</h3>')
        for r in ds_raw['ratios']:
            ev = evaluate_ratio(ds, r)
            lab, cls = KIND_JA[ev['kind']]
            lab = ev.get('kind_label', lab)
            if ev['value'] is None:
                val = '値を出しません'
            elif ev['kind'] == 'cost_per':
                val = fmt_cost_per(ev['value'], ds.d(ev['num']))
            else:
                val = fmt_ratio(ev['value'])
            h.append('<div class="ratio"><div><b>%s</b> <span class="badge %s">%s</span> <span class="val">%s</span></div>'
                     '<div class="small">依頼の意図: %s ／ 分子 %s（原値 <code>%s</code>・%s） ÷ 分母 %s（原値 <code>%s</code>・%s）</div>' % (
                         e(r.get('label') or r['id']), cls, e(lab), e(val),
                         e('conversion rate' if r['intent'] == 'conversion' else '費用 ÷ 件数・人数'),
                         e(_obs_label(ds, ev['num'])), e(raw_text(ev['num'].get('raw'))),
                         e(STATE_JA[ds.norm[ev['num']['id']]['state']]),
                         e(_obs_label(ds, ev['den'])), e(raw_text(ev['den'].get('raw'))),
                         e(STATE_JA[ds.norm[ev['den']['id']]['state']])))
            if ev['reasons'] or ev['notes']:
                h.append('<ul class="dq">%s</ul>' % ''.join('<li>%s</li>' % e(x) for x in ev['reasons'] + ev['notes']))
            h.append('</div>')
        h.append('</div>')

    # 親子の突き合わせ
    rus = rollups(ds)
    if rus:
        h.append('<div class="panel"><h3>親と子の突き合わせ（足さない）</h3>')
        for ru in rus:
            p = ru['parent']
            d = ds.d(p)
            h.append('<div class="series"><h4>%s <small>%s %s・%s〜%s</small></h4>' % (
                e(_obs_label(ds, p)), e(d['id']), e(d['version']), e(p['period']['start']), e(p['period']['end'])))
            h.append('<div class="tblwrap"><table><thead><tr><th>行</th><th>原値</th><th>状態</th><th>正規化値</th></tr></thead><tbody>')
            h.append('<tr class="parent"><td>親: %s</td><td><code>%s</code></td><td>%s</td><td>%s</td></tr>' % (
                e(_obs_label(ds, p)), e(raw_text(p.get('raw'))), _state(ds.norm[p['id']]), _norm_text(ds, p)))
            for o in ru['children']:
                h.append('<tr><td>子: %s</td><td><code>%s</code></td><td>%s</td><td>%s</td></tr>' % (
                    e(_obs_label(ds, o)), e(raw_text(o.get('raw'))), _state(ds.norm[o['id']]), _norm_text(ds, o)))
            for nid in ru['no_rows']:
                h.append('<tr><td>子: %s</td><td colspan="3"><span class="unk">行なし（0の証拠ではありません）</span></td></tr>' % e(nid))
            h.append('<tr class="sum"><td>行のある子の合計（親とは足さない）</td><td colspan="3">%s</td></tr>' % (
                e(fmt_value(ru['sum'], d)) if ru['sum'] is not None else '<span class="unk">出しません</span>'))
            h.append('</tbody></table></div><ul class="dq">%s</ul></div>' % ''.join('<li>%s</li>' % e(x) for x in ru['notes']))
        h.append('</div>')

    # 比較
    if ds_raw['comparisons']:
        h.append('<div class="panel"><h3>比較できるか</h3><div class="tblwrap"><table><thead><tr><th>比較</th><th>判定</th>'
                 '<th>理由・差</th></tr></thead><tbody>')
        for c in ds_raw['comparisons']:
            a, b2 = ds.obs[c['a']], ds.obs[c['b']]
            ok, why = comparability(ds, a, b2)
            if ok:
                diff = ds.norm[b2['id']]['value'] - ds.norm[a['id']]['value']
                body = '差 %s（観測値。原因は検証していません）' % fmt_value(diff, ds.d(a), signed=True)
                badge = '<span class="badge ok">比較可</span>'
            else:
                body = '<ul class="dq">%s</ul>' % ''.join('<li>%s</li>' % e(x) for x in why)
                badge = '<span class="badge stop">比較しない</span>'
            h.append('<tr><td>%s<div class="small">%s<br>%s</div></td><td>%s</td><td>%s</td></tr>' % (
                e(c.get('label') or c['id']), e(_obs_label(ds, a)), e(_obs_label(ds, b2)), badge,
                e(body) if ok else body))
        h.append('</tbody></table></div></div>')
    h.append('</section>')
    return ''.join(h)


def validate_all(loaded, now):
    out, seen = [], set()
    for name, ds in loaded:
        if isinstance(ds, MeasurementError):
            ck = Check(os.path.splitext(name)[0])
            ck.err('SCHEMA', name, 'JSONとして読めません: %s' % ds)
            out.append((name, None, ck))
            continue
        try:
            ck = validate(ds, now)
        except Exception as ex:  # 想定外の形でも画面全体は落とさない
            ck = Check(os.path.splitext(name)[0])
            ck.err('INTERNAL', name, '検証中に想定外の値で止まりました: %s' % type(ex).__name__)
        did = ds.get('dataset_id') if isinstance(ds, dict) else None
        if _s(did):
            if did in seen:
                ck.err('DUP_ID', 'dataset_id', 'dataset_id が重複しています: %s' % did)
            seen.add(did)
        if not ck.errors:
            try:
                Dataset(ds)
            except Exception as ex:
                ck.err('INTERNAL', name, '索引の作成で止まりました: %s' % type(ex).__name__)
        out.append((name, ds, ck))
    return out


def render_all(results):
    """[(tab_html, section_html)]"""
    out = []
    for name, ds, ck in results:
        did = ds.get('dataset_id') if isinstance(ds, dict) and _s(ds.get('dataset_id')) else os.path.splitext(name)[0]
        biz = ds.get('business') if isinstance(ds, dict) else None
        label = biz.get('name') if isinstance(biz, dict) and _s(biz.get('name')) else did
        try:
            sec = render_dataset(name, ds, ck)
        except Exception as ex:
            stop = Check(did)
            stop.err('INTERNAL', name, '描画中に想定外の値で止まりました: %s' % type(ex).__name__)
            sec = render_dataset(name, None, stop)
        tab = '<a href="#ms-%s">計測: %s%s</a>' % (e(did), e(label), ' ⚠' if ck.errors else '')
        out.append((tab, sec))
    return out
