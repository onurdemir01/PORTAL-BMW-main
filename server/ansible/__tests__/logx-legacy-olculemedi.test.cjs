// server/ansible/__tests__/logx-legacy-olculemedi.test.cjs - LogX Legacy: "OLCULEMEDI" ile "YOK" KARISMAZ.
//
// KULLANICI KURALI 6: "Olculemedi" ile "yok" ASLA karismaz.
//
// 3900c96 transferin `stat` tarafini duzeltti ("Dosya was ile denetlenemedi"). Acik kalanlar
// (sozlesme v3, logx LX2 / LX2b / LX3 / LX7):
//
//   LX2  Kesif: find gorevleri `ignore_errors: true` + bos varsayilanlarla kosuyordu; was'a
//        gecis reddedilince ya da find bir dizini okuyamayinca (skipped_paths) sonuc
//        "ok + 0 dosya" = "dosya yok" cikiyordu. Rescue'ya dusen host ise artifact'tan
//        SESSIZCE dusuyordu (toplayici `select('defined')`).
//   LX2b Transfer cok-host: rescue host_logx_result yazmiyordu; toplayici eksik hostu
//        dusurup kalanlar "ok" ise "success" diyordu; toplayici hic kosmazsa (tum kaynaklar
//        erisilemez) logx_result HIC yayinlanmiyordu.
//   LX3  Playbook icinde '#' satiri YOK (kural 4); aciklamalar dizin README.md'sinde.
//   LX7  Gecici ZIP adi dizin adindan turetilebiliyordu; artik set_fact ile BIR KEZ uretilen
//        rastgele ad.
//
// NASIL OLCULUR (X09): karar mantigi METINLE DEGIL, Jinja ile RENDER EDILEREK sinanir.
// Asagidaki Python betigi playbook'u yaml.safe_load ile okur, gorevleri Ansible sirasiyla
// kosturur (when, set_fact, loop, block/rescue/always, register, failed_when: false,
// ignore_errors, ignore_unreachable, group_by, set_stats, fail, assert) ve uzak modullerin
// sonucunu senaryodan enjekte eder. Ansible'in filtre/test semantigi (failed, unreachable,
// skipped, match, search, bool, regex_replace, dict2items, flatten, extract, password
// lookup) betikte birebir yeniden yazildi; AnsibleUndefined gibi zincirlenen ama
// kullanildiginda patlayan bir Undefined kullanilir.
//
// KORLUK (bilerek): gercek Ansible kosmaz (Windows'ta ansible-playbook calismaz). run_once
// fact yayilimi, ignore_unreachable sonrasi devam, dzdo/was gecisi ve dumpdir modu
// burada OLCULMEZ -> kanarya (sozlesme Y3). python3 + jinja2 + PyYAML yoksa testler
// "KOR" diye ACIK HATAYLA duser, YESIL DONMEZ.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pythonBul, shebangYorumlayici, adaylar } = require('./fixtures/python-bul.cjs');
const { normalize } = require('../../util/guard-text.cjs');

const DIR = path.join(__dirname, '..', 'bmw_portal', 'logx', 'legacy');
const KESIF = path.join(DIR, 'logx_legacy_discovery.yml');
const AKTARIM = path.join(DIR, 'logx_legacy_transfer.yml');
const README = path.join(DIR, 'README.md');
const DOSYALAR = [KESIF, AKTARIM];
const metin = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

const KESIF_EAR_GOREVI = "Önce app'a ait EAR klasörlerini bul (daraltılmış keşif)";

// Python betigi stdin'den verilir: gecici dosya yazilmaz, yol ayraci sorunu yok.
// ICERIK KURALI: ters tirnak ve dolar-suslu-parantez YOK (JS sablonu), '//' YOK (lint:ascii).
const HARNESS = String.raw`
import io
import json
import random
import re
import string
import sys
import traceback

import jinja2
import yaml
from jinja2.nativetypes import NativeEnvironment

KESIF_YOL = sys.argv[1]
AKTARIM_YOL = sys.argv[2]


def yukle(yol):
    with io.open(yol, encoding='utf-8') as f:
        return yaml.safe_load(f)


class Tanimsiz(jinja2.StrictUndefined):
    """AnsibleUndefined gibi: zincirleme erisim tanimsiz kalir, KULLANIM patlar."""

    def __getattr__(self, ad):
        if ad[:2] == '__':
            raise AttributeError(ad)
        return self

    def __getitem__(self, anahtar):
        return self


def _sozluk(v, ad):
    if not isinstance(v, dict):
        raise TypeError("'%s' testi sozluk bekler (gelen: %s)" % (ad, type(v).__name__))


def t_failed(v):
    _sozluk(v, 'failed')
    return bool(v.get('failed'))


def t_unreachable(v):
    _sozluk(v, 'unreachable')
    return bool(v.get('unreachable'))


def t_skipped(v):
    _sozluk(v, 'skipped')
    return bool(v.get('skipped'))


def _bayrak(ignorecase, multiline):
    b = 0
    if ignorecase:
        b |= re.I
    if multiline:
        b |= re.M
    return b


def t_match(v, desen='', ignorecase=False, multiline=False):
    return re.match(desen, str(v), _bayrak(ignorecase, multiline)) is not None


def t_search(v, desen='', ignorecase=False, multiline=False):
    return re.search(desen, str(v), _bayrak(ignorecase, multiline)) is not None


def f_bool(v):
    if isinstance(v, jinja2.Undefined):
        raise ValueError('bool filtresine TANIMSIZ deger geldi')
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        v = v.lower()
    return v in ('yes', 'on', '1', 'true', 1)


def f_regex_replace(v='', desen='', yerine='', ignorecase=False, multiline=False):
    return re.sub(desen, yerine, str(v), flags=_bayrak(ignorecase, multiline))


def f_dict2items(v, key_name='key', value_name='value'):
    if not isinstance(v, dict):
        raise TypeError('dict2items sozluk bekler (gelen: %s)' % type(v).__name__)
    return [{key_name: k, value_name: d} for k, d in v.items()]


def f_flatten(v, levels=None, skip_nulls=True):
    out = []
    for e in v:
        if skip_nulls and (e is None or (isinstance(e, str) and e in ('None', 'null'))):
            continue
        if isinstance(e, (list, tuple)):
            if levels is None:
                out.extend(f_flatten(e, None, skip_nulls))
            elif int(levels) >= 1:
                out.extend(f_flatten(e, int(levels) - 1, skip_nulls))
            else:
                out.append(e)
        else:
            out.append(e)
    return out


ORTAM_GECIR = getattr(jinja2, 'pass_environment', None) or getattr(jinja2, 'environmentfilter')


@ORTAM_GECIR
def f_extract(env, item, container, morekeys=None):
    if morekeys is None:
        anahtarlar = [item]
    elif isinstance(morekeys, list):
        anahtarlar = [item] + morekeys
    else:
        anahtarlar = [item, morekeys]
    deger = container
    for a in anahtarlar:
        deger = env.getitem(deger, a)
    return deger


LOOKUP_TERIMLERI = []


def lookup(ad, *terimler, **kw):
    if ad not in ('password', 'ansible.builtin.password'):
        raise ValueError('harness bu lookup u tanimiyor: %s' % ad)
    terim = str(terimler[0])
    LOOKUP_TERIMLERI.append(terim)
    parcalar = terim.split(' ')
    if parcalar[0] != '/dev/null':
        raise ValueError('password lookup /dev/null disina YAZAR: %s' % parcalar[0])
    secenek = {}
    for p in parcalar[1:]:
        if p:
            k, _, d = p.partition('=')
            secenek[k] = d
    for k, d in kw.items():
        secenek[k] = ','.join(d) if isinstance(d, list) else d
    ham = secenek.get('chars', 'ascii_letters,digits,.,:-_')
    kume = ''.join(getattr(string, c, c) for c in ham.split(',') if c)
    uzunluk = int(secenek.get('length', 20))
    r = random.SystemRandom()
    return ''.join(r.choice(kume) for _ in range(uzunluk))


ENV = NativeEnvironment(undefined=Tanimsiz)
ENV.filters.update({
    'bool': f_bool,
    'regex_replace': f_regex_replace,
    'dict2items': f_dict2items,
    'flatten': f_flatten,
    'extract': f_extract,
})
ENV.tests.update({
    'failed': t_failed,
    'unreachable': t_unreachable,
    'skipped': t_skipped,
    'match': t_match,
    'search': t_search,
})
ENV.globals['lookup'] = lookup


def tanimsiz_ara(v, yol='deger'):
    if isinstance(v, jinja2.Undefined):
        raise ValueError('%s TANIMSIZ (Ansible burada patlardi)' % yol)
    if isinstance(v, dict):
        for k, d in v.items():
            tanimsiz_ara(d, '%s.%s' % (yol, k))
    elif isinstance(v, list):
        for i, d in enumerate(v):
            tanimsiz_ara(d, '%s[%d]' % (yol, i))


def sablon_mu(s):
    return isinstance(s, str) and ('{{' in s or '{%' in s)


def isle(v, ctx):
    if sablon_mu(v):
        return ENV.from_string(v).render(ctx)
    if isinstance(v, dict):
        return dict((k, isle(d, ctx)) for k, d in v.items())
    if isinstance(v, list):
        return [isle(d, ctx) for d in v]
    return v


def kosul(c, ctx):
    if isinstance(c, bool):
        return c
    r = ENV.from_string('{% if ' + str(c) + ' %}1{% else %}0{% endif %}').render(ctx)
    return r in (1, '1')


def kosullar(w, ctx):
    ws = w if isinstance(w, list) else [w]
    return all(kosul(c, ctx) for c in ws)


def _tembel(ham, taban):
    """Ansible play/gorev vars'i TEMBEL degerlendirir: her basvuruda o anki olgularla."""
    out = {}
    for _ in range(4):
        c = dict(taban)
        c.update(out)
        for k, v in (ham or {}).items():
            try:
                out[k] = isle(v, c)
            except Exception:
                pass
    return out


class GorevHatasi(Exception):
    def __init__(self, sonuc, gorev):
        Exception.__init__(self, str(sonuc.get('msg')))
        self.sonuc = sonuc
        self.gorev = gorev


class HostErisilemez(Exception):
    pass


YEREL_MODULLER = (
    'ansible.builtin.set_fact', 'ansible.builtin.group_by', 'ansible.builtin.set_stats',
    'ansible.builtin.fail', 'ansible.builtin.assert', 'ansible.builtin.debug',
)


def modul(t):
    for k in t:
        if k.startswith('ansible.builtin.') or k.startswith('community.general.'):
            return k
    return None


class Host(object):
    def __init__(self, ad, ekstra, sihir, oyun_vars, enjekte=None, hata_gorev=None):
        self.ad = ad
        self.ekstra = ekstra
        self.sihir = dict(sihir)
        self.oyun_vars = oyun_vars or {}
        self.olgular = {}
        self.gruplar = set()
        self.yayinlar = []
        self.kayit = []
        self.arguman = []
        self.enjekte = enjekte or {}
        self.hata_gorev = hata_gorev
        self.ignore_unreachable = False

    def ctx(self, ek=None, gorev_vars=None):
        taban = {'inventory_hostname': self.ad}
        taban.update(self.sihir)
        ust = dict(self.olgular)
        ust.update(self.ekstra)
        if ek:
            ust.update(ek)
        c = dict(taban)
        c.update(ust)
        pv = _tembel(self.oyun_vars, c)
        c = dict(taban)
        c.update(pv)
        c.update(ust)
        if gorev_vars:
            tv = _tembel(gorev_vars, c)
            c = dict(taban)
            c.update(pv)
            c.update(tv)
            c.update(ust)
        return c


def gorevleri_kos(gorevler, h):
    for t in gorevler:
        if 'block' in t:
            blok_kos(t, h)
        else:
            gorev_kos(t, h)


def blok_kos(t, h):
    try:
        try:
            gorevleri_kos(t['block'], h)
        except GorevHatasi as e:
            if 'rescue' not in t:
                raise
            h.sihir['ansible_failed_result'] = e.sonuc
            h.sihir['ansible_failed_task'] = {'name': e.gorev}
            h.kayit.append(['RESCUE', e.gorev])
            gorevleri_kos(t['rescue'], h)
    finally:
        if 'always' in t:
            gorevleri_kos(t['always'], h)


def atla(t, h, ad):
    if t.get('register'):
        h.olgular[t['register']] = {'changed': False, 'skipped': True,
                                    'skip_reason': 'Conditional result was False'}
    h.kayit.append([ad, 'skipped'])


def yerel_kos(t, m, h, ctx, ad):
    govde = t[m]
    if m == 'ansible.builtin.set_fact':
        degerler = isle(govde, ctx)
        tanimsiz_ara(degerler, ad)
        h.olgular.update(degerler)
    elif m == 'ansible.builtin.group_by':
        h.gruplar.add(isle(govde['key'], ctx))
    elif m == 'ansible.builtin.set_stats':
        veri = isle(govde['data'], ctx)
        tanimsiz_ara(veri, ad)
        h.yayinlar.append({'gorev': ad, 'data': veri,
                           'aggregate': govde.get('aggregate', True)})
    elif m == 'ansible.builtin.fail':
        h.kayit.append([ad, 'FAIL'])
        raise GorevHatasi({'failed': True, 'msg': str(isle(govde.get('msg', ''), ctx))}, ad)
    elif m == 'ansible.builtin.assert':
        for c in govde.get('that', []):
            if not kosul(c, ctx):
                h.kayit.append([ad, 'ASSERT'])
                raise GorevHatasi({'failed': True, 'assertion': c,
                                   'msg': str(isle(govde.get('fail_msg', ''), ctx))}, ad)
    h.kayit.append([ad, 'ok'])


def gorev_kos(t, h):
    ad = t.get('name', '')
    m = modul(t)
    tv = t.get('vars')
    if h.hata_gorev and ad == h.hata_gorev:
        h.kayit.append([ad, 'SIMULE_HATA'])
        raise GorevHatasi({'failed': True, 'msg': 'SIMULE HATA: ' + ad}, ad)
    if m in YEREL_MODULLER:
        if 'loop' in t:
            ogeler = isle(t['loop'], h.ctx(gorev_vars=tv))
            tanimsiz_ara(ogeler, ad + ' loop')
            for oge in ogeler:
                c = h.ctx({'item': oge}, tv)
                if 'when' in t and not kosullar(t['when'], c):
                    continue
                yerel_kos(t, m, h, c, ad)
            return
        c = h.ctx(gorev_vars=tv)
        if 'when' in t and not kosullar(t['when'], c):
            atla(t, h, ad)
            return
        yerel_kos(t, m, h, c, ad)
        return
    c = h.ctx(gorev_vars=tv)
    if 'when' in t and not kosullar(t['when'], c):
        atla(t, h, ad)
        return
    if 'loop' not in t:
        try:
            h.arguman.append({'gorev': ad, 'modul': m, 'arg': isle(t[m], c)})
        except Exception as e:
            h.arguman.append({'gorev': ad, 'modul': m, 'arg': {'_hata': str(e)}})
    sonuc = h.enjekte.get(t.get('register')) if t.get('register') else None
    if sonuc is None:
        sonuc = h.enjekte.get(ad)
    if sonuc is None:
        sonuc = {'changed': False}
    sonuc = dict(sonuc)
    if t.get('failed_when') is False:
        sonuc['failed'] = False
    if t.get('register'):
        h.olgular[t['register']] = sonuc
    if sonuc.get('unreachable'):
        h.kayit.append([ad, 'UNREACHABLE'])
        if not h.ignore_unreachable:
            raise HostErisilemez(ad)
        return
    if sonuc.get('failed') and not t.get('ignore_errors'):
        h.kayit.append([ad, 'FAILED'])
        raise GorevHatasi(sonuc, ad)
    h.kayit.append([ad, 'ran'])


def yerel_mi(p):
    return str(p.get('hosts', '')).strip() == 'localhost' or p.get('connection') == 'local'


def birlestir(a, b):
    out = dict(a)
    for k, v in b.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = birlestir(out[k], v)
        else:
            out[k] = v
    return out


def son_artifact(yayinlar):
    son = {}
    for y in yayinlar:
        for k, v in y['data'].items():
            if y.get('aggregate', True) and k in son and isinstance(son[k], dict) and isinstance(v, dict):
                son[k] = birlestir(son[k], v)
            else:
                son[k] = v
    return son.get('logx_result')


KESIF_P = yukle(KESIF_YOL)
AKTARIM_P = yukle(AKTARIM_YOL)


def kesif_host_oyunu():
    return [p for p in KESIF_P if not yerel_mi(p)][0]


def kesif_yerel_oyunu():
    return [p for p in KESIF_P if yerel_mi(p)][0]


EAR_OK = {
    'changed': False, 'matched': 1, 'examined': 9,
    'msg': 'Not all paths examined, check warnings for details',
    'files': [{'path': '/vhosting8/APPX-T.ear'}],
    'skipped_paths': {'/vhosting': "'/vhosting' is not a directory"},
}
LOGDIR_OK = {'changed': False, 'msg': 'All paths examined', 'skipped_paths': {},
             'files': [{'path': '/vhosting8/APPX-T.ear/logs'}]}
DOSYA_OK = {'changed': False, 'msg': 'All paths examined', 'skipped_paths': {},
            'files': [{'path': '/vhosting8/APPX-T.ear/logs/SystemOut.log',
                       'size': 120, 'mtime': 1759300000.0}]}
EACCES_LF = "[Errno 13] Permission denied: '/vhosting/lost+found'"


def kesif_host(enjekte, hata_gorev=None, ekstra=None):
    oyun = kesif_host_oyunu()
    e = {'app_name': 'APPX', 'target_hosts': 'GBJBOT22'}
    e.update(ekstra or {})
    h = Host('GBJBOT22', e, {'groups': {'all': ['GBJBOT22']}}, oyun.get('vars'), enjekte, hata_gorev)
    h.ignore_unreachable = bool(oyun.get('ignore_unreachable'))
    try:
        gorevleri_kos(oyun['tasks'], h)
    except (GorevHatasi, HostErisilemez) as x:
        h.kayit.append(['HOST_DUSTU', str(x)])
    return {'host_result': h.olgular.get('host_result'), 'gruplar': sorted(h.gruplar),
            'kayit': h.kayit}


def kesif_topla(hedef, bildiren, envanter, ek_gruplar=None):
    oyun = kesif_yerel_oyunu()
    hostvars = dict((ad, {'host_result': r}) for ad, r in bildiren.items())
    groups = {'all': list(envanter), 'ungrouped': list(envanter),
              'logx_discovered': list(bildiren.keys())}
    groups.update(ek_gruplar or {})
    e = {'app_name': 'APPX'}
    if hedef is not None:
        e['target_hosts'] = hedef
    h = Host('localhost', e, {'groups': groups, 'hostvars': hostvars}, oyun.get('vars'))
    kirmizi = None
    try:
        gorevleri_kos(oyun['tasks'], h)
    except GorevHatasi as x:
        kirmizi = x.sonuc.get('msg')
    return {'yayinlar': h.yayinlar, 'son': son_artifact(h.yayinlar), 'kirmizi': kirmizi,
            'kayit': h.kayit}


def hr(host, status='ok', files=None, error=''):
    return {'host': host, 'status': status, 'error': error, 'files': files or []}


STAGING = '/sw/BMW_PORTAL/logs/legacy'
FALLBACK = '/tmp/logx-v2-fallback'
ARSIV = 'fa52e9adfd9fc71572ea8c7b15b65ed4.zip'


def aktarim_host_oyunu_indeksi():
    for i, p in enumerate(AKTARIM_P):
        if not yerel_mi(p) and any('block' in t for t in p.get('tasks', [])):
            return i
    raise ValueError('transferin kaynak host play i bulunamadi')


def stat_sonucu(yollar, durum):
    sonuclar = []
    for host, yol in yollar:
        oge = {'host': host, 'path': yol}
        if durum == 'ok':
            sonuclar.append({'item': oge, 'changed': False, 'failed': False,
                             'stat': {'exists': True, 'isreg': True, 'readable': True}})
        elif durum == 'yok':
            sonuclar.append({'item': oge, 'changed': False, 'failed': False,
                             'stat': {'exists': False}})
        elif durum == 'erisilemez':
            sonuclar.append({'item': oge, 'unreachable': True, 'changed': False,
                             'msg': 'Timeout (12s) waiting for privilege escalation prompt: '})
        elif durum == 'red':
            sonuclar.append({'item': oge, 'failed': True, 'changed': False,
                             'msg': 'MODULE FAILURE',
                             'module_stderr': 'dzdo: Sorry, user uxmid is not allowed to execute as was'})
    s = {'changed': False, 'results': sonuclar}
    if any(r.get('unreachable') for r in sonuclar):
        s['unreachable'] = True
    return s


def aktarim_kos(secili, host_enjekte, hata_gorev=None, toplayici_enjekte=None,
                toplayici_kosmaz=False, kosmayan_hostlar=()):
    i_host = aktarim_host_oyunu_indeksi()
    ekstra = {'selected_files': secili, 'staging_dir': STAGING, 'fallback_dir': FALLBACK,
              'archive_name': ARSIV}
    kaynaklar = []
    for s in secili:
        if s['host'] not in kaynaklar:
            kaynaklar.append(s['host'])
    groups = {'all': list(kaynaklar), 'ungrouped': list(kaynaklar)}
    hostlar = {}
    for ad in kaynaklar:
        if ad in kosmayan_hostlar:
            continue
        oyun = AKTARIM_P[i_host]
        h = Host(ad, ekstra, {'groups': groups}, oyun.get('vars'), host_enjekte.get(ad, {}),
                 (hata_gorev or {}).get(ad))
        h.ignore_unreachable = bool(oyun.get('ignore_unreachable'))
        try:
            gorevleri_kos(oyun['tasks'], h)
        except (GorevHatasi, HostErisilemez) as x:
            h.kayit.append(['HOST_DUSTU', str(x)])
        hostlar[ad] = h
    hostvars = dict((ad, hostlar[ad].olgular) for ad in hostlar)
    yayinlar = []
    kirmizi = None
    oyun_kaydi = []
    for p in AKTARIM_P[i_host + 1:]:
        if yerel_mi(p):
            h = Host('localhost', ekstra, {'groups': groups, 'hostvars': hostvars}, p.get('vars'))
            try:
                gorevleri_kos(p['tasks'], h)
            except GorevHatasi as x:
                kirmizi = {'oyun': p.get('name'), 'msg': x.sonuc.get('msg')}
            for y in h.yayinlar:
                y['oyun'] = p.get('name')
            yayinlar.extend(h.yayinlar)
            oyun_kaydi.append({'oyun': p.get('name'), 'kayit': h.kayit})
            if kirmizi:
                break
        else:
            if toplayici_kosmaz:
                oyun_kaydi.append({'oyun': p.get('name'), 'kayit': 'KOSMADI'})
                continue
            calisan = [ad for ad in kaynaklar if ad in hostlar]
            if not calisan:
                continue
            sira = list(calisan)
            h = Host(sira[0], ekstra, {'groups': groups, 'hostvars': hostvars}, p.get('vars'),
                     toplayici_enjekte or {})
            h.olgular = dict(hostlar[sira[0]].olgular)
            onceki = dict(h.olgular)
            hepsi_dustu = False
            for t in p.get('tasks', []):
                try:
                    gorev_kos(t, h)
                except HostErisilemez:
                    h.kayit.append(['TOPLAYICI_HOST_ERISILEMEZ', h.ad])
                    sira.pop(0)
                    if not sira:
                        hepsi_dustu = True
                        break
                    yeni_h = Host(sira[0], ekstra, {'groups': groups, 'hostvars': hostvars},
                                  p.get('vars'), toplayici_enjekte or {})
                    yeni_h.olgular = dict(hostlar[sira[0]].olgular)
                    yeni_h.olgular.update(dict((k, v) for k, v in h.olgular.items()
                                               if k not in onceki or onceki[k] is not v))
                    yeni_h.kayit, yeni_h.arguman, yeni_h.yayinlar = h.kayit, h.arguman, h.yayinlar
                    h = yeni_h
                except GorevHatasi as x:
                    h.kayit.append(['TOPLAYICI_DUSTU', str(x)])
                    hepsi_dustu = True
                    break
            yeni = dict((k, v) for k, v in h.olgular.items() if k not in onceki or onceki[k] is not v)
            for ad in calisan:
                hostlar[ad].olgular.update(yeni)
            for y in h.yayinlar:
                y['oyun'] = p.get('name')
            yayinlar.extend(h.yayinlar)
            oyun_kaydi.append({'oyun': p.get('name'), 'kayit': h.kayit})
            if hepsi_dustu:
                oyun_kaydi.append({'oyun': 'PLAYBOOK', 'kayit': 'run_once gorevi dustu: sonraki playler KOSMAZ'})
                break
    return {
        'yayinlar': yayinlar,
        'son': son_artifact(yayinlar),
        'kirmizi': kirmizi,
        'oyunlar': oyun_kaydi,
        'hostlar': dict((ad, {
            'host_logx_result': hostlar[ad].olgular.get('host_logx_result'),
            'host_blocked_reason': hostlar[ad].olgular.get('host_blocked_reason'),
            'was_tmp_zip': hostlar[ad].olgular.get('was_tmp_zip'),
            'arguman': hostlar[ad].arguman,
            'kayit': hostlar[ad].kayit,
        }) for ad in hostlar),
    }


TEK = [{'host': 'ESJBOT02', 'path': '/vhosting8/ESOUTBOUNDWS-T.ear/logs/SystemOut.log'}]
TEK_Y = [(TEK[0]['host'], TEK[0]['path'])]
COK = [{'host': 'GBJBOT21', 'path': '/vhosting8/APPX-T.ear/logs/SystemOut.log'},
       {'host': 'GBJBOT22', 'path': '/vhosting8/APPX-T.ear/logs/SystemOut.log'}]


def tek_enjekte(**kw):
    e = {
        'source_file_stats': stat_sonucu(TEK_Y, 'ok'),
        'staging_dir_stat': {'changed': False, 'stat': {'exists': True, 'isdir': True}},
        'was_tmp_dir_result': {'changed': True},
        'was_archive_result': {'changed': True},
        'staging_archive_result': {'changed': True},
        'fallback_dir_result': {'changed': True},
        'fallback_archive_result': {'changed': True},
        'final_archive_stat': {'changed': False, 'stat': {'exists': True, 'size': 4321}},
    }
    e.update(kw)
    return {'ESJBOT02': e}


def cok_host_enjekte(host, durum='ok'):
    yol = [(host, '/vhosting8/APPX-T.ear/logs/SystemOut.log')]
    return {
        'source_file_stats': stat_sonucu(yol, durum),
        'was_tmp_dir_result': {'changed': True},
        'was_archive_result': {'changed': True},
        'parts_dir_result': {'changed': True},
        'host_part_result': {'changed': True},
        'host_part_stat': {'changed': False, 'stat': {'exists': True, 'size': 100}},
    }


TOPLAYICI_OK = {
    'part_files': {'changed': False, 'files': [{'path': STAGING + '/x__parts/GBJBOT21.zip'},
                                               {'path': STAGING + '/x__parts/GBJBOT22.zip'}]},
    'combined_archive_result': {'changed': True},
    'combined_archive_stat': {'changed': False, 'stat': {'exists': True, 'size': 999}},
}
TOPLAYICI_PARCA_YOK = {'part_files': {'changed': False, 'files': []}}
TOPLAYICI_HOSTU_ERISILEMEZ = {
    'part_files': {'unreachable': True, 'changed': False,
                   'msg': 'Failed to connect to the host via ssh: GBJBOT21 timed out'},
}


def yapi():
    i = aktarim_host_oyunu_indeksi()
    host_oyun = AKTARIM_P[i]
    vars_lookup = []
    for dosya, oyunlar in (('discovery', KESIF_P), ('transfer', AKTARIM_P)):
        for p in oyunlar:
            for k, v in (p.get('vars') or {}).items():
                if isinstance(v, str) and ('lookup(' in v or 'query(' in v):
                    vars_lookup.append('%s: %s.%s' % (dosya, p.get('name'), k))
    blok = [t for t in host_oyun['tasks'] if 'block' in t][0]
    ilk = blok['block'][0]
    ilk_sf = ilk.get('ansible.builtin.set_fact') or {}
    kesif_blok = [t for t in kesif_host_oyunu()['tasks'] if 'block' in t][0]
    find_adlari = [t.get('name') for t in kesif_blok['block'] if 'ansible.builtin.find' in t]
    log_dizin_find = [t for t in kesif_blok['block']
                      if 'ansible.builtin.find' in t and t.get('register') == 'found_log_dirs'][0]
    return {
        'kesif_log_dizin_find': log_dizin_find['ansible.builtin.find'],
        'kesif_log_dir_regex': (kesif_host_oyunu().get('vars') or {}).get('legacy_log_dir_regex'),
        'vars_lookup': vars_lookup,
        'ilk_gorev_set_fact': 'ansible.builtin.set_fact' in ilk,
        'ilk_gorev_zip': ilk_sf.get('was_tmp_zip'),
        'was_tmp_archive_var': (host_oyun.get('vars') or {}).get('was_tmp_archive'),
        'kesif_find_adlari': find_adlari,
    }


SENARYOLAR = {
    'K1_kok_yok_dosya_var': lambda: kesif_host({
        'found_ear_dirs': EAR_OK, 'found_log_dirs': LOGDIR_OK, 'found_files': DOSYA_OK}),
    'K2_ear_find_dustu': lambda: kesif_host({
        'found_ear_dirs': {'failed': True, 'changed': False, 'msg': 'MODULE FAILURE',
                           'module_stderr': 'dzdo: Sorry, user uxmid is not allowed to execute as was'}}),
    'K3_erisilemez': lambda: kesif_host({
        'found_ear_dirs': {'unreachable': True, 'changed': False,
                           'msg': 'Failed to connect to the host via ssh: Connection timed out'}}),
    'K4_ear_okunamayan_yol': lambda: kesif_host({
        'found_ear_dirs': {'changed': False, 'files': [], 'msg': 'Not all paths examined, check warnings for details',
                           'skipped_paths': {'/vhosting/lost+found': EACCES_LF,
                                             '/vhosting8': "'/vhosting8' is not a directory"}}}),
    'K5_log_alt_dizini_okunamaz': lambda: kesif_host({
        'found_ear_dirs': EAR_OK, 'found_log_dirs': LOGDIR_OK,
        'found_files': dict(DOSYA_OK, msg='Not all paths examined, check warnings for details',
                            skipped_paths={'/vhosting8/APPX-T.ear/logs/arsiv':
                                           "[Errno 13] Permission denied: '/vhosting8/APPX-T.ear/logs/arsiv'"})}),
    'K6_iki_kok_de_yok': lambda: kesif_host({
        'found_ear_dirs': {'changed': False, 'files': [], 'msg': 'Not all paths examined, check warnings for details',
                           'skipped_paths': {'/vhosting': "'/vhosting' is not a directory",
                                             '/vhosting8': "'/vhosting8' is not a directory"}}}),
    'K7_kok_baska_hata': lambda: kesif_host({
        'found_ear_dirs': {'changed': False, 'files': [], 'msg': 'Not all paths examined, check warnings for details',
                           'skipped_paths': {'/vhosting': '[Errno 5] Input/output error: /vhosting/x'}}}),
    'K8_log_dizin_find_dustu': lambda: kesif_host({
        'found_ear_dirs': EAR_OK,
        'found_log_dirs': {'failed': True, 'changed': False, 'msg': 'find patladi'}}),
    'K9_rescue': lambda: kesif_host({
        'found_ear_dirs': EAR_OK, 'found_log_dirs': LOGDIR_OK, 'found_files': DOSYA_OK},
        hata_gorev='Var olan log dizinlerini listele'),
    'K10_kullanici': lambda: kesif_host({
        'found_ear_dirs': {'failed': True, 'changed': False, 'msg': 'MODULE FAILURE'}},
        ekstra={'logx_legacy_user': 'jbossx'}),
    'K11_dosya_find_dustu': lambda: kesif_host({
        'found_ear_dirs': EAR_OK, 'found_log_dirs': LOGDIR_OK,
        'found_files': {'failed': True, 'changed': False, 'msg': 'find dosya taramasi dustu'}}),
    'K12_numarali_dizinler': lambda: kesif_host({
        'found_ear_dirs': EAR_OK,
        'found_log_dirs': dict(LOGDIR_OK, files=[
            {'path': '/vhosting8/APPX-T.ear/logs'}, {'path': '/vhosting8/APPX-T.ear/log1'},
            {'path': '/vhosting8/APPX-T.ear/logs2'}, {'path': '/vhosting8/APPX-T.ear/log10'}]),
        'found_files': dict(DOSYA_OK, files=[
            {'path': '/vhosting8/APPX-T.ear/logs/SystemOut.log', 'size': 1},
            {'path': '/vhosting8/APPX-T.ear/log1/a.log', 'size': 1},
            {'path': '/vhosting8/APPX-T.ear/logs2/alt/b.log', 'size': 1},
            {'path': '/vhosting8/APPX-T.ear/log10/c.log', 'size': 1},
            {'path': '/vhosting8/APPX-T.ear/log4j/log4j.xml', 'size': 1},
            {'path': '/vhosting8/APPX-T.ear/logs_old/eski.log', 'size': 1},
            {'path': '/vhosting8/APPX-T.ear/config/APPX.properties', 'size': 1},
            {'path': '/vhosting8/APPX-T.ear/mylogs1/m.log', 'size': 1},
            {'path': '/vhosting8/BASKA.ear/logs2/o.log', 'size': 1}])}),
    'A8_dizin_deseni_yayinlanir': lambda: kesif_topla(
        'GBJBOT21,GBJBOT22',
        {'GBJBOT21': hr('GBJBOT21', 'error', error='x'),
         'GBJBOT22': dict(hr('GBJBOT22'), log_dir_regex='logs?[0-9]*')},
        ['GBJBOT21', 'GBJBOT22']),
    'A9_eski_host_sonucu_desen_yok': lambda: kesif_topla(
        'GBJBOT21', {'GBJBOT21': hr('GBJBOT21')}, ['GBJBOT21']),
    'A1_bir_host_bildirmedi': lambda: kesif_topla(
        'GBJBOT21,GBJBOT22,GBJBOT23',
        {'GBJBOT21': hr('GBJBOT21', files=[{'path': '/vhosting8/APPX-T.ear/logs/a.log'}]),
         'GBJBOT22': hr('GBJBOT22', 'error', error='x')},
        ['GBJBOT21', 'GBJBOT22', 'GBJBOT23']),
    'A2_hicbiri_ok_degil': lambda: kesif_topla(
        'GBJBOT21,GBJBOT22',
        {'GBJBOT21': hr('GBJBOT21', 'error', error='x'),
         'GBJBOT22': hr('GBJBOT22', 'unreachable', error='y')},
        ['GBJBOT21', 'GBJBOT22']),
    'A3_hepsi_ok': lambda: kesif_topla(
        'GBJBOT21,GBJBOT22',
        {'GBJBOT21': hr('GBJBOT21'), 'GBJBOT22': hr('GBJBOT22')},
        ['GBJBOT21', 'GBJBOT22']),
    'A4_hedef_tanimsiz': lambda: kesif_topla(
        None, {'GBJBOT21': hr('GBJBOT21')}, ['GBJBOT21', 'GBJBOT22']),
    'A5_envanterde_yok': lambda: kesif_topla(
        'GBJBOT21,GBELLE99', {'GBJBOT21': hr('GBJBOT21')}, ['GBJBOT21']),
    'A6_grup_hedefi': lambda: kesif_topla(
        'jboss_ekip', {'GBJBOT21': hr('GBJBOT21')}, ['GBJBOT21', 'GBJBOT22'],
        {'jboss_ekip': ['GBJBOT21', 'GBJBOT22']}),
    'A7_hic_sonuc_yok': lambda: kesif_topla('GBJBOT21', {}, ['GBJBOT21']),
    'S1_staging': lambda: aktarim_kos(TEK, tek_enjekte()),
    'S1b_staging_ikinci_kosu': lambda: aktarim_kos(TEK, tek_enjekte()),
    'S2_staging_yazilamaz': lambda: aktarim_kos(TEK, tek_enjekte(
        staging_archive_result={'failed': True, 'changed': False,
                                'msg': 'Destination /sw/BMW_PORTAL/logs/legacy not writable'})),
    'S3_staging_yok': lambda: aktarim_kos(TEK, tek_enjekte(
        staging_dir_stat={'changed': False, 'stat': {'exists': False}})),
    'S4_was_ziplenemedi': lambda: aktarim_kos(TEK, tek_enjekte(
        was_archive_result={'failed': True, 'changed': False,
                            'msg': 'Permission denied: /vhosting8/ESOUTBOUNDWS-T.ear/logs/SystemOut.log'})),
    'S5_was_gecisi_erisilemez': lambda: aktarim_kos(TEK, tek_enjekte(
        source_file_stats=stat_sonucu(TEK_Y, 'erisilemez'))),
    'S6_dosya_gercekten_yok': lambda: aktarim_kos(TEK, tek_enjekte(
        source_file_stats=stat_sonucu(TEK_Y, 'yok'))),
    'C1_iki_host_ok': lambda: aktarim_kos(
        COK, {'GBJBOT21': cok_host_enjekte('GBJBOT21'), 'GBJBOT22': cok_host_enjekte('GBJBOT22')},
        toplayici_enjekte=TOPLAYICI_OK),
    'C2_host_rescue': lambda: aktarim_kos(
        COK, {'GBJBOT21': cok_host_enjekte('GBJBOT21'), 'GBJBOT22': cok_host_enjekte('GBJBOT22')},
        hata_gorev={'GBJBOT22': 'Dosya durumlarini ve gecerli kaynak listesini olustur'},
        toplayici_enjekte=TOPLAYICI_OK),
    'C3_host_bildirmedi': lambda: aktarim_kos(
        COK, {'GBJBOT21': cok_host_enjekte('GBJBOT21')},
        kosmayan_hostlar=('GBJBOT22',), toplayici_enjekte=TOPLAYICI_OK),
    'C4_toplayici_kosmadi': lambda: aktarim_kos(
        COK, {'GBJBOT21': cok_host_enjekte('GBJBOT21'), 'GBJBOT22': cok_host_enjekte('GBJBOT22')},
        toplayici_kosmaz=True),
    'C5_parca_yok': lambda: aktarim_kos(
        COK, {'GBJBOT21': cok_host_enjekte('GBJBOT21', 'yok'),
              'GBJBOT22': cok_host_enjekte('GBJBOT22', 'yok')},
        toplayici_enjekte=TOPLAYICI_PARCA_YOK),
    'C7_toplayici_hostu_erisilemez': lambda: aktarim_kos(
        COK, {'GBJBOT21': cok_host_enjekte('GBJBOT21'), 'GBJBOT22': cok_host_enjekte('GBJBOT22')},
        toplayici_enjekte=TOPLAYICI_HOSTU_ERISILEMEZ),
    'C6_host_stat_erisilemez': lambda: aktarim_kos(
        COK, {'GBJBOT21': cok_host_enjekte('GBJBOT21'),
              'GBJBOT22': cok_host_enjekte('GBJBOT22', 'erisilemez')},
        toplayici_enjekte=TOPLAYICI_OK),
}

cikti = {'_lookup': None, '_yapi': None}
for ad, fn in SENARYOLAR.items():
    try:
        cikti[ad] = fn()
    except Exception:
        cikti[ad] = {'hata': traceback.format_exc()}
try:
    cikti['_yapi'] = yapi()
except Exception:
    cikti['_yapi'] = {'hata': traceback.format_exc()}
cikti['_lookup'] = LOOKUP_TERIMLERI
sys.stdout.write(json.dumps(cikti, default=str))
`;

// python3 + jinja2 + PyYAML arayisi fixtures/python-bul.cjs icinde: PATH'teki python3 /
// python'dan sonra ANSIBLE'IN KENDI yorumlayicisina da bakar (Homebrew / pipx kurulumunda
// paketler oradadir).
let onbellek = null;
/** Tum senaryolari TEK python surecinde render eder (sonuc onbellekte). */
function render() {
  if (onbellek) return onbellek;
  const py = pythonBul();
  if (!py)
    throw new Error(
      'X09 KOR: python3 + jinja2 + PyYAML bulunamadi - LogX karar mantigi render edilemedi. ' +
        'Bu bekci YESIL DONMEZ. Denenen yorumlayicilar: ' +
        adaylar()
          .map(([k]) => k)
          .join(', ') +
        '. Cozum: Ansible kurun (paketler onunla gelir) ya da PORTAL_TEST_PYTHON ile jinja2 + ' +
        'PyYAML tasiyan bir python gosterin.',
    );
  const r = spawnSync(py.komut, [...py.on, '-', KESIF, AKTARIM], {
    input: HARNESS,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' },
  });
  if (r.status !== 0)
    throw new Error(`render betigi dustu (rc=${r.status}):\n${r.stderr}\n${r.stdout}`);
  onbellek = JSON.parse(r.stdout);
  return onbellek;
}

/** Senaryo sonucunu al; betik o senaryoda patladiysa izini goster. */
function senaryo(ad) {
  const s = render()[ad];
  assert.ok(s, `senaryo yok: ${ad}`);
  assert.ok(!s.hata, `${ad} render edilemedi:\n${s.hata}`);
  return s;
}

const tekYayin = (s, ad) => {
  assert.equal(
    s.yayinlar.length,
    1,
    `${ad}: logx_result ${s.yayinlar.length} kez yayinlandi (tam 1 bekleniyor; ikinci yayin ` +
      `aggregate ile ilkini EZER): ${JSON.stringify(s.yayinlar.map((y) => y.oyun))}`,
  );
  return s.son;
};

// ── X02 KESIF: find hatasi / erisilemeyen host / okunamayan yol "ok + 0 dosya" URETMEZ ──────

test('X02 kesif: var olmayan KOK (/vhosting8 yok) hata SAYILMAZ; dosyalar listelenir', () => {
  // find modulu verilen kok dizin yoksa onu da skipped_paths'e yazar ("is not a
  // directory"). Bir JBoss7 hostunda /vhosting8 yoktur: bunu hata saymak TUM hostlari
  // 'error' yapardi (uretim kirilirdi). Kok yoksa olculmustur: o kokte log YOK.
  const r = senaryo('K1_kok_yok_dosya_var').host_result;
  assert.equal(r.status, 'ok', JSON.stringify(r));
  assert.equal(r.error, '');
  assert.deepEqual(
    r.files.map((f) => f.path),
    ['/vhosting8/APPX-T.ear/logs/SystemOut.log'],
  );
});

test('X02 kesif: iki kok de yoksa sonuc "ok + 0 dosya" (gercekten YOK, olculdu)', () => {
  const r = senaryo('K6_iki_kok_de_yok').host_result;
  assert.equal(r.status, 'ok', JSON.stringify(r));
  assert.deepEqual(r.files, []);
});

test('X02 kesif: EAR find dustu (was gecisi reddi) -> error + sebep + kosan; files bos', () => {
  const r = senaryo('K2_ear_find_dustu').host_result;
  assert.equal(r.status, 'error', `find dustugu halde '${r.status}' - "dosya yok" sanilir`);
  assert.deepEqual(r.files, []);
  assert.ok(r.error.includes(KESIF_EAR_GOREVI), `hata gorev adini tasimiyor: ${r.error}`);
  assert.match(r.error, /MODULE FAILURE/);
  assert.match(r.error, /not allowed to execute as was/, 'module_stderr sebebi mesaja girmiyor');
  assert.match(r.error, /\(kosan: was\)/);
});

test('X02 kesif: find erisilemez (ignore_unreachable) -> unreachable, "ok + 0" DEGIL', () => {
  // ignore_unreachable: true iken host durmaz; set_fact/group_by baglanti istemez ve
  // eski formulde sonuc "ok + 0 dosya" cikiyordu.
  const r = senaryo('K3_erisilemez').host_result;
  assert.equal(r.status, 'unreachable', JSON.stringify(r));
  assert.deepEqual(r.files, []);
  assert.match(r.error, /Connection timed out/);
});

test('X02 kesif: okunamayan dizin (skipped_paths) -> error; kok-yok kaydi mesajda YOK', () => {
  const r = senaryo('K4_ear_okunamayan_yol').host_result;
  assert.equal(r.status, 'error', `okunamayan dizin varken '${r.status}' + 0 dosya = "yok"`);
  assert.deepEqual(r.files, []);
  assert.ok(r.error.includes('/vhosting/lost+found'), r.error);
  assert.ok(r.error.includes('Permission denied'), r.error);
  assert.ok(
    !r.error.includes("'/vhosting8' is not a directory"),
    `kok-yok hata sanildi: ${r.error}`,
  );
});

test('X02 kesif: kokun KENDISI baska sebeple okunamadi -> error (kok-yok muafiyeti dar)', () => {
  const r = senaryo('K7_kok_baska_hata').host_result;
  assert.equal(r.status, 'error', JSON.stringify(r));
  assert.match(r.error, /Input\/output error/);
});

test('X02 kesif: log alt dizini okunamadi -> error, kismi liste "tam" diye sunulmaz', () => {
  const r = senaryo('K5_log_alt_dizini_okunamaz').host_result;
  assert.equal(r.status, 'error', JSON.stringify(r));
  assert.deepEqual(r.files, []);
  assert.ok(r.error.includes('/vhosting8/APPX-T.ear/logs/arsiv'), r.error);
});

test('X02 kesif: log dizini ve dosya find hatalari da error olur', () => {
  for (const ad of ['K8_log_dizin_find_dustu', 'K11_dosya_find_dustu']) {
    const r = senaryo(ad).host_result;
    assert.equal(r.status, 'error', `${ad}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.files, [], ad);
  }
});

test('X02 kesif: hata mesajindaki kullanici logx_legacy_user degiskeninden gelir', () => {
  const r = senaryo('K10_kullanici').host_result;
  assert.match(r.error, /\(kosan: jbossx\)/, r.error);
});

test('X02 yapi: sorun etiketleri find gorev adlariyla AYNI (ad degisirse bekci duser)', () => {
  const y = render()._yapi;
  assert.ok(!y.hata, y.hata);
  assert.equal(y.kesif_find_adlari.length, 3, `find gorevleri: ${y.kesif_find_adlari}`);
  const t = metin(KESIF);
  for (const ad of y.kesif_find_adlari)
    assert.ok(
      t.split(`gorev: "${ad}"`).length > 1,
      `find gorevi "${ad}" icin sorun etiketi yok - hata mesaji gorevi adlandiramaz`,
    );
});

// ── X09b PYTHON BULUCU: Ansible kuruluysa bekciler KOR kalmaz ───────────────────────────────
//
// 2026-10-07: gelistirici makinesinde Ansible (Homebrew) kuruluydu ama bu dosyadaki 28 bekci
// "python3 + jinja2 + PyYAML yok" diye kirmizi duruyordu: arama yalnizca PATH'teki duz
// python3'e bakiyordu, paketler ise Ansible'in KENDI yorumlayicisindaydi.

test('X09b shebang -> yorumlayici: dogrudan yol, env bicimi, bayraklar, bozuk satir', () => {
  assert.equal(
    shebangYorumlayici('#!/opt/homebrew/Cellar/ansible/14.0.0_1/libexec/bin/python'),
    '/opt/homebrew/Cellar/ansible/14.0.0_1/libexec/bin/python',
  );
  assert.equal(shebangYorumlayici('#!/usr/bin/python3 -I'), '/usr/bin/python3');
  assert.equal(shebangYorumlayici('#!/usr/bin/env python3'), 'python3');
  assert.equal(shebangYorumlayici('#!/usr/bin/env -S python3 -u'), 'python3');
  assert.equal(shebangYorumlayici('#! /usr/bin/python3.12  '), '/usr/bin/python3.12');
  for (const kotu of ['', 'import sys', '#!', '#!   ', '# !/usr/bin/python3', null, undefined])
    assert.equal(shebangYorumlayici(kotu), null, JSON.stringify(kotu));
});

test('X09b adaylar: acik secim once; PATH python`lari; sonra Ansible`in yorumlayicisi', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pybul-'));
  try {
    const sahte = path.join(tmp, 'ansible-playbook');
    fs.writeFileSync(sahte, '#!/ozel/ansible/libexec/bin/python\nimport sys\n', { mode: 0o755 });
    const a = adaylar({ PATH: tmp, PORTAL_TEST_PYTHON: '/secilen/python' }).map(([k]) => k);
    assert.equal(a[0], '/secilen/python', 'acik secim ilk sirada degil');
    assert.ok(
      a.indexOf('python3') > 0 &&
        a.indexOf('python3') < a.indexOf('/ozel/ansible/libexec/bin/python'),
      `PATH python3, Ansible yorumlayicisindan once denenmeli: ${a}`,
    );
    assert.ok(
      a.includes('/ozel/ansible/libexec/bin/python'),
      `Ansible yorumlayicisi aday degil: ${a}`,
    );
    // Ansible yoksa aday eklenmez (uydurma yol denenmez).
    const b = adaylar({ PATH: path.join(tmp, 'yok') }).map(([k]) => k);
    assert.ok(!b.some((k) => k.includes('ansible')), String(b));
    // Ayni yorumlayici iki kez denenmez.
    fs.writeFileSync(sahte, '#!/usr/bin/env python3\n', { mode: 0o755 });
    const c = adaylar({ PATH: tmp }).map(([k]) => k);
    assert.equal(c.filter((k) => k === 'python3').length, 1, String(c));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── X10 NUMARALI LOG DIZINLERI (2026-10-07) ────────────────────────────────────────────────
//
// Kullanici: "log|logs|log1|log2|logs1...|logs2... gibi durumlarda da log alabilmemiz cok
// onemli". Eskiden yalnizca EAR altindaki `log` ve `logs` taraniyordu; `logs2` gibi
// numarali dizinlerdeki dosyalar HIC listelenmiyordu (ve ekran "dosya yok" diyordu).
//
// TEK KAYNAK: play degiskeni `legacy_log_dir_regex`. Hem find gorevi (dizin adi) hem
// suzgec (yol segmenti) ONDAN turer; ikisi ayrisirsa find'in buldugu dizinin dosyalari
// suzgecte dusup yine "dosya yok" gorunurdu.

/** ansible.builtin.find (use_regex: true) esleme kurali: desen DIZIN ADINA re.match ile. */
function logDizinAdiEslesir(ad) {
  const y = render()._yapi;
  const f = y.kesif_log_dizin_find;
  assert.equal(
    f.use_regex,
    true,
    'find regex kipinde degil - desen glob sanilir, hicbir dizin eslesmez',
  );
  return [].concat(f.patterns).some((p) => {
    const desen = String(p).replace(/\{\{\s*legacy_log_dir_regex\s*\}\}/g, y.kesif_log_dir_regex);
    assert.ok(!/\{\{/.test(desen), `desen cozulemedi: ${desen}`);
    // Python re.match = BASTAN capali; sonu desenin kendi capasi belirler.
    return new RegExp(`^(?:${desen})`).test(ad);
  });
}

test('X10 log dizini adlari: log, logs ve NUMARALI olanlar taranir; benzer adlar TARANMAZ', () => {
  for (const ad of ['log', 'logs', 'log1', 'log2', 'log10', 'logs1', 'logs2', 'logs25', 'log007'])
    assert.equal(logDizinAdiEslesir(ad), true, `"${ad}" dizini taranmiyor`);
  // Yapilandirma / yedek / baska dizinler LOG DIZINI SAYILMAZ: icerikleri log diye
  // listelenir ve indirilebilir olurdu (or. log4j yapilandirmasi).
  for (const ad of [
    'log4j',
    'logs_old',
    'logs.bak',
    'logsX',
    'logs1a',
    'log-1',
    'log_1',
    'mylogs',
    'mylogs1',
    'catalog',
    'logfiles',
    'Logs',
    'LOG1',
    '1log',
    'logs1 ',
    'lo',
    'config',
  ])
    assert.equal(logDizinAdiEslesir(ad), false, `"${ad}" log dizini sayildi`);
  // Yalnizca EAR'in HEMEN altinda ve yalnizca DIZIN.
  const f = render()._yapi.kesif_log_dizin_find;
  assert.equal(f.recurse, false);
  assert.equal(f.file_type, 'directory');
  assert.equal(f.follow, false, 'sembolik bag izleniyor - log dizini disina cikilabilir');
});

test('X10 suzgec: numarali dizinlerdeki dosyalar listelenir; log4j / logs_old / baska uygulama listelenmez', () => {
  const r = senaryo('K12_numarali_dizinler').host_result;
  assert.equal(r.status, 'ok', JSON.stringify(r));
  assert.deepEqual(
    r.files.map((f) => f.path),
    [
      '/vhosting8/APPX-T.ear/logs/SystemOut.log',
      '/vhosting8/APPX-T.ear/log1/a.log',
      '/vhosting8/APPX-T.ear/logs2/alt/b.log',
      '/vhosting8/APPX-T.ear/log10/c.log',
    ],
  );
});

test('X10 artifact taranan dizin desenini YAYINLAR (portal eski AWX kopyasini bundan anlar)', () => {
  const y = render()._yapi;
  assert.equal(y.kesif_log_dir_regex, 'logs?[0-9]*');
  // Host sonucu deseni tasir (rescue yolu dahil); toplayici onu tek alana cikarir.
  assert.equal(senaryo('K12_numarali_dizinler').host_result.log_dir_regex, y.kesif_log_dir_regex);
  assert.equal(senaryo('K9_rescue').host_result.log_dir_regex, y.kesif_log_dir_regex);
  // Bir host hata verse de desen, bildiren hostlardan okunur.
  assert.equal(
    tekYayin(senaryo('A8_dizin_deseni_yayinlanir'), 'A8').log_dir_regex,
    y.kesif_log_dir_regex,
  );
  // Deseni tasimayan (eski bicimli) host sonucu toplayiciyi DUSURMEZ; alan bos kalir.
  const a9 = senaryo('A9_eski_host_sonucu_desen_yok');
  assert.equal(a9.kirmizi, null, a9.kirmizi);
  assert.equal(tekYayin(a9, 'A9').log_dir_regex, '');
});

// ── X03 KESIF: rescue host'u dusurmez; toplayici bildirmeyeni "unreachable" ekler ──────────

test('X03 kesif rescue: host_result error yazar ve gruba girer (artifact tan dusmez)', () => {
  const s = senaryo('K9_rescue');
  assert.ok(
    s.kayit.some((k) => k[0] === 'RESCUE'),
    `rescue calismadi: ${JSON.stringify(s.kayit)}`,
  );
  assert.ok(s.host_result, 'rescue host_result yazmiyor - toplayici hostu sessizce dusurur');
  assert.equal(s.host_result.status, 'error');
  assert.match(s.host_result.error, /SIMULE HATA/);
  assert.deepEqual(s.host_result.files, []);
  assert.deepEqual(s.gruplar, ['logx_discovered'], 'rescue edilen host sonuc grubuna girmiyor');
});

test('X03 kesif toplayici: hedeflenip bildirmeyen host unreachable eklenir, overall partial', () => {
  const s = senaryo('A1_bir_host_bildirmedi');
  const r = tekYayin(s, 'A1');
  const eksik = r.hosts.find((h) => h.host === 'GBJBOT23');
  assert.ok(eksik, `bildirmeyen GBJBOT23 artifact'ta yok: ${JSON.stringify(r.hosts)}`);
  assert.equal(eksik.status, 'unreachable');
  assert.match(eksik.error, /^sonuc bildirmedi/);
  assert.deepEqual(eksik.files, []);
  assert.equal(r.overall_status, 'partial');
  assert.equal(r.hosts.length, 3);
  assert.equal(s.kirmizi, null, 'bir host ok iken is kirmizi');
});

test('X03 kesif toplayici: hicbir host ok degilse failed + is KIRMIZI (set_stats ONCE)', () => {
  for (const ad of ['A2_hicbiri_ok_degil', 'A7_hic_sonuc_yok']) {
    const s = senaryo(ad);
    const r = tekYayin(s, ad);
    assert.equal(r.overall_status, 'failed', `${ad}: ${JSON.stringify(r)}`);
    assert.ok(s.kirmizi, `${ad}: hicbir host basarili degil ama AWX isi yesil`);
    const sira = s.kayit.map((k) => k[1]);
    assert.ok(sira.indexOf('FAIL') > sira.indexOf('ok'), `${ad}: fail set_stats'ten once`);
  }
  const r7 = senaryo('A7_hic_sonuc_yok').son;
  assert.deepEqual(
    r7.hosts.map((h) => [h.host, h.status]),
    [['GBJBOT21', 'unreachable']],
  );
});

test('X03 kesif toplayici: hepsi ok -> success; hedef yoksa envanterin tamami hedeftir', () => {
  assert.equal(tekYayin(senaryo('A3_hepsi_ok'), 'A3').overall_status, 'success');
  const r4 = tekYayin(senaryo('A4_hedef_tanimsiz'), 'A4');
  assert.deepEqual(
    r4.hosts.map((h) => [h.host, h.status]),
    [
      ['GBJBOT21', 'ok'],
      ['GBJBOT22', 'unreachable'],
    ],
  );
  assert.equal(r4.overall_status, 'partial');
});

test('X03 kesif toplayici: envanterde olmayan ad ve grup hedefi', () => {
  const r5 = tekYayin(senaryo('A5_envanterde_yok'), 'A5');
  const yok = r5.hosts.find((h) => h.host === 'GBELLE99');
  assert.ok(yok, 'AWX envanterinde olmayan elle girilmis host sessizce kayboldu');
  assert.equal(yok.status, 'unreachable');
  assert.match(yok.error, /envanter/i, 'envanterde eslesmedigi soylenmiyor');
  const r6 = tekYayin(senaryo('A6_grup_hedefi'), 'A6');
  assert.deepEqual(r6.hosts.map((h) => h.host).sort(), ['GBJBOT21', 'GBJBOT22']);
  assert.ok(!r6.hosts.some((h) => /JBOSS_EKIP/i.test(h.host)), 'grup adi host sanildi');
});

// ── X03b TRANSFER COK-HOST: rescue / bildirmeyen / toplayici kosmadi ────────────────────────

test('X03b transfer: iki host ok + arsiv var -> success, TEK yayin', () => {
  const s = senaryo('C1_iki_host_ok');
  const r = tekYayin(s, 'C1');
  assert.equal(r.overall_status, 'success', JSON.stringify(r));
  assert.equal(r.staged_path, '/sw/BMW_PORTAL/logs/legacy/fa52e9adfd9fc71572ea8c7b15b65ed4.zip');
  assert.equal(r.filename, 'fa52e9adfd9fc71572ea8c7b15b65ed4.zip');
  assert.equal(Number(r.size_bytes), 999);
  assert.equal(r.is_fallback, false);
  assert.deepEqual(r.hosts.map((h) => [h.host, h.status]).sort(), [
    ['GBJBOT21', 'ok'],
    ['GBJBOT22', 'ok'],
  ]);
  assert.equal(s.kirmizi, null);
});

test('X03b transfer: rescue edilen host error + rescue sebebiyle gorunur, overall partial', () => {
  const s = senaryo('C2_host_rescue');
  const r = tekYayin(s, 'C2');
  const h = r.hosts.find((x) => x.host === 'GBJBOT22');
  assert.ok(h, `rescue edilen host artifact'tan dustu: ${JSON.stringify(r.hosts)}`);
  assert.equal(h.status, 'error', `rescue host_logx_result yazmiyor (${h.status}: ${h.error})`);
  assert.match(h.error, /SIMULE HATA/, 'rescue sebebi tasinmiyor');
  for (const k of ['part_filename', 'size_bytes', 'per_file_status'])
    assert.ok(k in h, `rescue sonucunda '${k}' alani yok`);
  assert.equal(r.overall_status, 'partial');
});

test('X03b transfer: hic bildirmeyen kaynak host unreachable eklenir; success OLAMAZ', () => {
  const r = tekYayin(senaryo('C3_host_bildirmedi'), 'C3');
  const h = r.hosts.find((x) => x.host === 'GBJBOT22');
  assert.ok(h, `bildirmeyen host artifact'ta yok: ${JSON.stringify(r.hosts)}`);
  assert.equal(h.status, 'unreachable');
  assert.match(h.error, /^sonuc bildirmedi/);
  assert.equal(r.overall_status, 'partial', 'bir kaynak bildirmedigi halde success');
});

test('X03b transfer: toplayici kosmadiysa localhost SENTETIK failed yayinlar + is KIRMIZI', () => {
  const s = senaryo('C4_toplayici_kosmadi');
  const r = tekYayin(s, 'C4');
  assert.equal(r.overall_status, 'failed');
  assert.equal(r.staged_path, '');
  assert.ok(r.error, 'sentetik sonuc sebep tasimiyor');
  assert.deepEqual(r.hosts.map((h) => h.host).sort(), ['GBJBOT21', 'GBJBOT22']);
  assert.ok(s.kirmizi, 'toplayici kosmadigi halde AWX isi yesil');
});

test('X03b transfer: parca ZIP yoksa failed; sebep "bulunamadi" diye olculemeyeni ortmez', () => {
  const r = tekYayin(senaryo('C5_parca_yok'), 'C5');
  assert.equal(r.overall_status, 'failed');
  for (const h of r.hosts) {
    assert.equal(h.status, 'error', JSON.stringify(h));
    assert.match(h.error, /Dosya bulunamadi/, 'dosya basina sebep host mesajina girmiyor');
  }
});

test('X03b transfer: toplayici hostu erisilemez -> failed, sebep "parca gelmedi" diye ortulmez', () => {
  // run_once toplayicinin ilk hostu erisilemezse Ansible sonraki gorevleri bir sonraki hostta
  // kosar ama `part_files` erisilemez sonucu tasir. Parcalar aslinda var olabilir: sebep
  // "hicbir hosttan parca gelmedi" DEGIL, baglanti hatasi olmali.
  const s = senaryo('C7_toplayici_hostu_erisilemez');
  const r = tekYayin(s, 'C7');
  assert.equal(r.overall_status, 'failed');
  assert.match(r.error, /Parca dizini aranamadi: Failed to connect/, r.error);
  assert.ok(!/parca ZIP gelmedi/.test(r.error), `olculemeyen "yok" diye yazildi: ${r.error}`);
});

test('X03b transfer: was gecisi erisilemez host -> unreachable, sebep "denetlenemedi"', () => {
  const r = tekYayin(senaryo('C6_host_stat_erisilemez'), 'C6');
  const h = r.hosts.find((x) => x.host === 'GBJBOT22');
  assert.equal(h.status, 'unreachable', JSON.stringify(h));
  assert.match(h.error, /denetlenemedi/, `olculemeyen dosya "yok" gibi yazildi: ${h.error}`);
  assert.equal(r.overall_status, 'partial');
});

// ── X09 TEK-HOST karar mantigi (3900c96 davranisi korunur) ───────────────────────────────

test('X09 tek-host: staging / staging yazilamaz / staging yok / okunamaz / erisilemez', () => {
  const S = (ad) => tekYayin(senaryo(ad), ad);
  const s1 = S('S1_staging');
  assert.equal(s1.overall_status, 'success');
  assert.equal(s1.staged_path, `/sw/BMW_PORTAL/logs/legacy/fa52e9adfd9fc71572ea8c7b15b65ed4.zip`);
  assert.equal(s1.is_fallback, false);
  assert.equal(Number(s1.size_bytes), 4321);
  for (const ad of ['S2_staging_yazilamaz', 'S3_staging_yok']) {
    const r = S(ad);
    assert.equal(r.overall_status, 'success', `${ad}: ${JSON.stringify(r)}`);
    assert.equal(r.staged_path, '/tmp/logx-v2-fallback/fa52e9adfd9fc71572ea8c7b15b65ed4.zip', ad);
    assert.equal(r.is_fallback, true, ad);
  }
  const s4 = S('S4_was_ziplenemedi');
  assert.equal(s4.overall_status, 'failed');
  assert.match(s4.error, /was kullanicisiyla ziplenemedi: Permission denied/);
  const s5 = senaryo('S5_was_gecisi_erisilemez');
  const r5 = tekYayin(s5, 'S5');
  assert.equal(r5.overall_status, 'failed');
  assert.match(r5.hosts[0].error, /denetlenemedi/, 'erisilemeyen dosya "yok" diye yazildi');
  assert.ok(!/Dosya bulunamadi/.test(r5.hosts[0].error), r5.hosts[0].error);
  assert.ok(s5.kirmizi, 'tek-host basarisizken is yesil');
  const r6 = tekYayin(senaryo('S6_dosya_gercekten_yok'), 'S6');
  assert.match(r6.hosts[0].error, /Dosya bulunamadi/);
});

// ── X08 gecici ZIP adi: set_fact ile BIR KEZ uretilen rastgele ad ─────────────────────────

test('X08 yapi: ZIP adi block un ilk set_fact inde, play vars altinda lookup YOK', () => {
  const y = render()._yapi;
  assert.ok(!y.hata, y.hata);
  assert.deepEqual(
    y.vars_lookup,
    [],
    'vars: altinda lookup TEMBEL degerlendirilir - archive, copy ve always FARKLI adlar gorur',
  );
  assert.ok(y.ilk_gorev_set_fact, 'arsiv blogunun ilk gorevi set_fact degil');
  assert.ok(y.ilk_gorev_zip, 'was_tmp_zip ilk set_fact te uretilmiyor');
  assert.match(y.ilk_gorev_zip, /lookup\('ansible\.builtin\.password', '\/dev\/null/);
  assert.match(String(y.was_tmp_archive_var), /was_tmp_dir.*was_tmp_zip/);
});

test('X08 render: ad 24 karakter [a-z0-9]; archive, copy ve always AYNI yolu gorur', () => {
  const s = senaryo('S1_staging');
  const h = s.hostlar.ESJBOT02;
  assert.match(String(h.was_tmp_zip), /^[a-z0-9]{24}\.zip$/, `ZIP adi: ${h.was_tmp_zip}`);
  const arsiv = h.arguman.find((a) => a.modul === 'community.general.archive');
  assert.ok(arsiv, 'gecici ZIP i yazan archive gorevi kosmadi');
  const hedef = arsiv.arg.dest;
  assert.equal(
    hedef,
    `/vhosting8/dumpdir/logx-fa52e9adfd9fc71572ea8c7b15b65ed4/${h.was_tmp_zip}`,
    'ZIP yolu dizinden turetilebiliyor ya da yanlis dumpdir',
  );
  const kopyalar = h.arguman.filter((a) => a.modul === 'ansible.builtin.copy');
  assert.ok(kopyalar.length > 0, 'kopya gorevi kosmadi');
  for (const k of kopyalar) assert.equal(k.arg.src, hedef, `${k.gorev} farkli yol okuyor`);
  const temizlik = h.arguman.filter(
    (a) => a.modul === 'ansible.builtin.file' && a.arg.state === 'absent',
  );
  assert.ok(temizlik.length > 0, 'always temizligi kosmadi');
  for (const t of temizlik) assert.equal(`${t.arg.path}/${h.was_tmp_zip}`, hedef);
  const ikinci = senaryo('S1b_staging_ikinci_kosu').hostlar.ESJBOT02.was_tmp_zip;
  assert.notEqual(ikinci, h.was_tmp_zip, 'iki kosu ayni ZIP adini uretti - rastgele degil');
});

// ── X06 / LX3: playbook'ta '#' satiri yok; aciklama README'de ─────────────────────────────

// README'nin anlatmasi gereken konular. Ham `includes` KULLANILMAZ (kural 8): README
// prettier/elle yeniden sarilinca iki sozcuklu 'sonuc bildirmedi' satir sonuna denk gelir,
// icerik ayni kaldigi halde bekci kirmiziya doner. Iki taraf da guard-text normalize()'dan
// gecer: bosluk/satir sonu/tirnak stili sonucu DEGISTIRMEZ, anahtarin silinmesi DEGISTIRIR.
const README_ANAHTARLARI = [
  'logx_result',
  'skipped_paths',
  'sonuc bildirmedi',
  'was_tmp_zip',
  'ignore_unreachable',
  'pipelining',
];

/** README metninde ANLATILMAYAN anahtarlar (bos dizi = hepsi var). */
const readmeEksikleri = (readmeMetni) => {
  const r = normalize(readmeMetni);
  return README_ANAHTARLARI.filter((a) => !r.includes(normalize(a)));
};

test("X06 iki playbook'ta '#' karakteri YOK (kural 4); README var", () => {
  for (const f of DOSYALAR) {
    const satirlar = metin(f)
      .split('\n')
      .map((s, i) => [i + 1, s])
      .filter(([, s]) => s.includes('#'));
    assert.deepEqual(
      satirlar.map(([n, s]) => `${path.basename(f)}:${n}: ${s.trim()}`),
      [],
      "playbook icinde '#' yasak - aciklama bmw_portal/logx/legacy/README.md'ye",
    );
  }
  assert.ok(fs.existsSync(README), 'README.md yok - aciklamalar kayboldu');
  assert.deepEqual(readmeEksikleri(metin(README)), [], 'README su konulari anlatmiyor');
});

test('X06 bekci oz-sinamasi: README anahtar kontrolu satir sarmasina dayanikli, eksigi yakalar', () => {
  const gercek = metin(README);
  // Sarma: HER bosluk satir sonu + girintiye doner (prettier proseWrap'in en kotu hali).
  // Icerik ayni -> hicbir anahtar eksik DEGIL. Ham includes burada 'sonuc bildirmedi'yi kaybeder.
  const sarili = gercek.replace(/ /g, '\n  ');
  assert.ok(!sarili.includes('sonuc bildirmedi'), 'sarma vakasi anahtari bolmuyor - sinama bos');
  assert.deepEqual(readmeEksikleri(sarili), [], 'satir sarmasi anahtari "yok" gosterdi');
  assert.deepEqual(
    readmeEksikleri(gercek.replace(/"/g, "'")),
    [],
    'tirnak stili sonucu degistirdi',
  );
  // Korluk sinamasi: her anahtar (sarili hali dahil) silinince TAM O anahtar eksik cikar.
  for (const a of README_ANAHTARLARI) {
    assert.match(a, /^[a-z_ ]+$/, `anahtar regex ozel karakter iceriyor: ${a}`);
    const desen = new RegExp(a.split(' ').join('\\s+'), 'g');
    assert.ok(desen.test(gercek), `README'de '${a}' zaten yok`);
    desen.lastIndex = 0;
    assert.deepEqual(readmeEksikleri(gercek.replace(desen, 'SILINDI')), [a], `'${a}' silindi`);
    desen.lastIndex = 0;
    assert.deepEqual(readmeEksikleri(sarili.replace(desen, 'SILINDI')), [a], `sarili '${a}'`);
  }
  assert.deepEqual(readmeEksikleri(''), README_ANAHTARLARI, 'bos README eksiksiz sayildi');
});

// ── X05 iki depo byte-ayni (yayin kontrol listesi; Ansible deposu yolu verilirse) ──────────

const ANSIBLE_DEPO = process.env.LOGX_ANSIBLE_DEPO || '';
test(
  'X05 Portal ve Ansible deposundaki uc dosya BYTE-AYNI',
  {
    skip: ANSIBLE_DEPO
      ? false
      : 'LOGX_ANSIBLE_DEPO tanimli degil - yayinda iki depo icin diff -q elle (sozlesme X05)',
  },
  () => {
    for (const ad of ['logx_legacy_discovery.yml', 'logx_legacy_transfer.yml', 'README.md']) {
      const a = fs.readFileSync(path.join(DIR, ad));
      const b = fs.readFileSync(path.join(ANSIBLE_DEPO, 'bmw_portal', 'logx', 'legacy', ad));
      assert.ok(a.equals(b), `${ad} iki depoda farkli`);
    }
  },
);
