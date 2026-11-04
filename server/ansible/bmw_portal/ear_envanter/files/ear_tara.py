# -*- coding: utf-8 -*-
# ear_tara.py - BMW Portal > Server Hub > Uygulama Envanteri: SALT OKUNUR EAR/WAR tarayicisi.
#
# Hedefte Ansible 'raw' ile 'python3 -B -' olarak STDIN'den calisir: hedefe dosya yazilmaz,
# bytecode birakilmaz, yalniz stdout'a tek blok basilir. Yalniz stdlib; Python 3.6+
# (RHEL 8 platform-python 3.6, RHEL 9 3.9).
#
# YAPMADIKLARI: dosya icerigi okumaz (yalniz zip arsivlerinin MERKEZ DIZINI, salt okunur), dosya
# yazmaz / silmez / izin degistirmez, uygulama ICINDE sembolik bag izlemez (yalniz kokteki
# 'APP.ear -> surum dizini' bagi tek adim izlenir ve kayda yazilir), NSS sorgusu yapmaz
# (uid/gid sayisal).
#
# KIPLER: OZET - dosya basina stat YOK (scandir ad + tip), yalniz kutuphane jar'larinin boyutu;
#         TAM  - her giris icin lstat (ls -lrtiR alanlari) ve agac satirlari.
#
# DURUMLAR (eksik olan asla TAM sayilmaz):
#   uygulama: TAM | KISMI_SINIR | KISMI_ZAMAN | KISMI_IZIN | ARSIV_ACILMADI | ATLANDI_ZAMAN | HATA
#   host:     TAM | KISMI | KOK_YOK | ZAMAN_ASIMI
# Ayarlar ortam degiskenleriyle (playbook verir): EAR_KIP, EAR_KOKLER, EAR_SINIR_UYGULAMA,
# EAR_SINIR_HOST, EAR_SURE, EAR_ARSIV_MB, EAR_CIKTI (paket | insan).
import base64
import hashlib
import io
import json
import os
import re
import socket
import stat
import struct
import sys
import time
import zipfile
import zlib
from collections import deque

SURUM = 1
BASLA = '@@EAR_ENVANTER_BASLA@@'
BITTI = '@@EAR_ENVANTER_BITTI@@'


def ortam_sayi(ad, varsayilan, en_az, en_cok):
    try:
        v = int(os.environ.get(ad, varsayilan))
    except ValueError:
        v = varsayilan
    return max(en_az, min(en_cok, v))


KIP = 'TAM' if os.environ.get('EAR_KIP', 'OZET').upper() == 'TAM' else 'OZET'
KOKLER = [k for k in os.environ.get('EAR_KOKLER', '/vhosting:/vhosting8').split(':') if k.startswith('/')]
SINIR_UYGULAMA = ortam_sayi('EAR_SINIR_UYGULAMA', 25000, 100, 500000)
SINIR_HOST = ortam_sayi('EAR_SINIR_HOST', 200000, 1000, 5000000)
SURE = ortam_sayi('EAR_SURE', 300, 10, 3600)
ARSIV_BAYT = ortam_sayi('EAR_ARSIV_MB', 64, 1, 512) * 1024 * 1024
CIKTI = 'insan' if os.environ.get('EAR_CIKTI') == 'insan' else 'paket'
UYARI_SINIRI = 20
DERINLIK_SINIRI = 60

JAR_RE = re.compile(r'^(.+?)-(\d[^/]*)\.jar$', re.I)
UCUCU_SEGMENT = set(['logs', 'log', 'tmp', 'temp', 'work'])
UCUCU_AD = re.compile(r'(\.(log|tmp|swp|out)(\.\d+)?$)|(^\.nfs)', re.I)
WEB_VARYANT = re.compile(r'^web\.([a-z0-9_-]+)\.xml$', re.I)

BASLANGIC = time.monotonic()
HOST = {'giris': 0, 'zaman_doldu': False}


def sure_doldu():
    if time.monotonic() - BASLANGIC > SURE:
        HOST['zaman_doldu'] = True
    return HOST['zaman_doldu']


def jar_ayir(ad):
    m = JAR_RE.match(ad)
    if m:
        return m.group(1), m.group(2)
    return ad[:-4] if ad.lower().endswith('.jar') else ad, ''


def ucucu(rel):
    parcalar = rel.lower().split('/')
    return any(p in UCUCU_SEGMENT for p in parcalar[:-1]) or parcalar[-1] in UCUCU_SEGMENT or bool(UCUCU_AD.search(parcalar[-1]))


class Iz(object):
    """Sirasi belirli girislerin ozeti: ayni agac her yerde ayni izi verir."""

    def __init__(self):
        self.h = hashlib.sha256()
        self.n = 0

    def ekle(self, *alanlar):
        self.h.update(json.dumps(alanlar, ensure_ascii=False, separators=(',', ':')).encode('utf-8', 'surrogateescape'))
        self.h.update(b'\n')
        self.n += 1

    def deger(self):
        return self.h.hexdigest()[:16] if self.n else ''


def yeni_war(yol, bicim):
    return {
        'yol': yol, 'ad': yol.rsplit('/', 1)[-1], 'bicim': bicim, 'durum': 'TAM',
        'jsp': 0, 'tld': 0, 'jar': 0, 'class': 0, 'tld_dizini': False,
        'web_xml': False, 'web_varyantlari': [], 'jboss_web_xml': False,
        'jboss_deployment_structure': False, 'kutuphaneler': [],
    }


def yeni_uygulama(kok, ad, bicim):
    return {
        'kok': kok, 'ad': ad, 'bicim': bicim, 'durum': 'TAM', 'bag_hedefi': '',
        'giris': 0, 'jsp': 0, 'tld': 0, 'jar': 0, 'class': 0,
        'application_xml': False, 'ear_kutuphaneleri': [], 'warlar': [],
        'yapi_izi': '', 'kutuphane_izi': '', 'uyari_sayisi': 0, 'uyarilar': [], 'satirlar': [],
    }


def uyar(u, metin, durum=None):
    u['uyari_sayisi'] += 1
    if len(u['uyarilar']) < UYARI_SINIRI:
        u['uyarilar'].append(metin[:300])
    if durum and u['durum'] == 'TAM':
        u['durum'] = durum


def say(u, war, ad, war_rel, tip, boyut):
    """Dosya adina gore sayim ve teknoloji tespiti. 'ad' OZGUN harflerle (surum metni korunur),
    war_rel WAR kokune goreli yol (kucuk harf, yalniz yol karsilastirmasi icin)."""
    ad_kucuk = ad.lower()
    if tip == 'D':
        if war is not None and war_rel == 'web-inf/tld':
            war['tld_dizini'] = True
        return
    if tip not in ('F', 'Z'):
        return
    for hedef in (u, war):
        if hedef is None:
            continue
        if ad_kucuk.endswith('.jar'):
            hedef['jar'] += 1
        elif ad_kucuk.endswith(('.jsp', '.jspx')):
            hedef['jsp'] += 1
        elif ad_kucuk.endswith('.tld'):
            hedef['tld'] += 1
        elif ad_kucuk.endswith('.class'):
            hedef['class'] += 1
    if war is None:
        return
    if war_rel == 'web-inf/web.xml':
        war['web_xml'] = True
    elif war_rel == 'web-inf/jboss-web.xml':
        war['jboss_web_xml'] = True
    elif war_rel == 'web-inf/jboss-deployment-structure.xml':
        war['jboss_deployment_structure'] = True
    elif war_rel.startswith('web-inf/') and war_rel.count('/') == 1:
        m = WEB_VARYANT.match(ad_kucuk)
        if m and m.group(1) not in war['web_varyantlari']:
            war['web_varyantlari'].append(m.group(1))
    if war_rel.startswith('web-inf/lib/') and war_rel.count('/') == 2 and ad_kucuk.endswith('.jar'):
        kad, ksurum = jar_ayir(ad)
        war['kutuphaneler'].append([kad, ksurum, boyut])


def satir_stat(tam_yol, rel, tip):
    st = os.lstat(tam_yol)
    hedef = ''
    if tip == 'L':
        try:
            hedef = os.readlink(tam_yol)[:300]
        except OSError:
            pass
    return [rel, tip, stat.filemode(st.st_mode), st.st_uid, st.st_gid, st.st_size, int(st.st_mtime), st.st_ino, hedef]


def zip_girisleri(kaynak):
    """Yalniz merkez dizin: (ad, boyut, zaman) listesi. Icerik acilmaz."""
    with zipfile.ZipFile(kaynak, 'r') as z:
        return [(i.filename, i.file_size, i.date_time) for i in z.infolist()]


def zip_zaman(dt):
    try:
        return int(time.mktime(dt + (0, 0, -1)))
    except (OverflowError, ValueError):
        return 0


def zip_merkez_giris_sayisi(tam):
    """ZIP'i acmadan EOCD'den merkez dizini giris sayisini okur; ZIP64/multi-disk fail-closed."""
    fd = os.open(tam, os.O_RDONLY)
    try:
        boyut = os.fstat(fd).st_size
        if boyut < 22:
            return None
        kuyruk = min(boyut, 65557)  # EOCD 22 bayt + en cok 65535 bayt yorum.
        os.lseek(fd, boyut - kuyruk, os.SEEK_SET)
        veri = os.read(fd, kuyruk)
    finally:
        os.close(fd)
    yer = veri.rfind(b'PK\x05\x06')
    if yer < 0 or yer + 22 > len(veri):
        return None
    _, disk, merkez_disk, disk_giris, toplam, merkez_boyut, _, yorum = struct.unpack_from('<4s4H2LH', veri, yer)
    if yer + 22 + yorum > len(veri):
        return None
    if disk or merkez_disk or disk_giris != toplam or toplam == 0xffff or merkez_boyut == 0xffffffff:
        return -1
    return toplam


def arsiv_war_isle(u, war, girisler, on_ek, yapi):
    """Paketli WAR'in merkez dizinini WAR kaydina ve (TAM) agac satirlarina isler."""
    for ad, boyut, dt in sorted(girisler):
        if sure_doldu():
            war['durum'] = 'KISMI_ZAMAN'
            uyar(u, 'sure butcesi doldu: ' + war['yol'], 'KISMI_ZAMAN')
            return
        if u['giris'] >= SINIR_UYGULAMA or HOST['giris'] >= SINIR_HOST:
            war['durum'] = 'KISMI_SINIR'
            uyar(u, 'giris siniri: ' + war['yol'], 'KISMI_SINIR')
            return
        rel = ad.rstrip('/')
        if not rel:
            continue
        tip = 'D' if ad.endswith('/') else 'Z'
        u['giris'] += 1
        HOST['giris'] += 1
        tam_rel = on_ek + '!/' + rel
        if not ucucu(rel):
            yapi.ekle(tam_rel, tip)
        if KIP == 'TAM':
            u['satirlar'].append([tam_rel, tip, '', '', '', boyut, zip_zaman(dt), '', ''])
        say(u, war, rel.rsplit('/', 1)[-1], rel.lower(), tip, boyut)


def paketli_war(u, tam_yol, rel, yapi):
    war = yeni_war(rel, 'ARSIV')
    u['warlar'].append(war)
    try:
        arsiv_war_isle(u, war, zip_girisleri(tam_yol), rel, yapi)
    except (zipfile.BadZipFile, OSError, RuntimeError) as e:
        war['durum'] = 'ARSIV_ACILMADI'
        uyar(u, 'arsiv okunamadi ' + rel + ': ' + str(e), 'ARSIV_ACILMADI')


def war_isaretle(warlar, war_k, durum):
    w = warlar.get(war_k)
    if w is not None and w['durum'] == 'TAM':
        w['durum'] = durum


def acik_uygulama(u, tam):
    """Acilmis (dizin) EAR: BFS, cocuklar ada gore sirali; uygulama icinde bag izlenmez."""
    yapi, kutuphane = Iz(), Iz()
    warlar = {}
    kuyruk = deque([('', None, 0)])
    while kuyruk:
        rel_dizin, war_k, derinlik = kuyruk.popleft()
        if sure_doldu():
            uyar(u, 'sure butcesi doldu', 'KISMI_ZAMAN')
            for _, k, _ in [(rel_dizin, war_k, 0)] + list(kuyruk):
                war_isaretle(warlar, k, 'KISMI_ZAMAN')
            break
        if derinlik > DERINLIK_SINIRI:
            uyar(u, 'derinlik siniri: ' + rel_dizin, 'KISMI_SINIR')
            war_isaretle(warlar, war_k, 'KISMI_SINIR')
            continue
        try:
            with os.scandir(os.path.join(tam, rel_dizin) if rel_dizin else tam) as it:
                uyeler = sorted(it, key=lambda e: e.name)
        except OSError as e:
            uyar(u, 'listelenemedi ' + (rel_dizin or '.') + ': ' + e.__class__.__name__, 'KISMI_IZIN')
            war_isaretle(warlar, war_k, 'KISMI_IZIN')
            continue
        for e in uyeler:
            if u['giris'] >= SINIR_UYGULAMA or HOST['giris'] >= SINIR_HOST:
                uyar(u, 'giris siniri', 'KISMI_SINIR')
                for _, k, _ in [(rel_dizin, war_k, 0)] + list(kuyruk):
                    war_isaretle(warlar, k, 'KISMI_SINIR')
                kuyruk.clear()
                break
            rel = e.name if not rel_dizin else rel_dizin + '/' + e.name
            try:
                if e.is_symlink():
                    tip = 'L'
                elif e.is_dir(follow_symlinks=False):
                    tip = 'D'
                else:
                    tip = 'F'
            except OSError as hata:
                uyar(u, 'tip okunamadi ' + rel + ': ' + hata.__class__.__name__, 'KISMI_IZIN')
                war_isaretle(warlar, war_k, 'KISMI_IZIN')
                continue
            u['giris'] += 1
            HOST['giris'] += 1
            ad_kucuk = e.name.lower()
            boyut = ''
            if KIP == 'TAM' or (tip == 'F' and ad_kucuk.endswith('.jar')):
                try:
                    s = satir_stat(e.path, rel, tip)
                    boyut = s[5]
                    if KIP == 'TAM':
                        u['satirlar'].append(s)
                except OSError as hata:
                    uyar(u, 'stat okunamadi ' + rel + ': ' + hata.__class__.__name__, 'KISMI_IZIN')
                    war_isaretle(warlar, war_k, 'KISMI_IZIN')
            if not ucucu(rel):
                yapi.ekle(rel, tip)
            yeni_k = war_k
            if tip == 'D' and ad_kucuk.endswith('.war'):
                yeni_k = rel
                warlar[rel] = yeni_war(rel, 'ACIK')
            war = warlar.get(yeni_k)
            war_rel = rel[len(yeni_k) + 1:].lower() if (war is not None and rel != yeni_k) else ''
            if tip == 'F' and ad_kucuk.endswith('.war'):
                paketli_war(u, e.path, rel, yapi)
            elif war is not None:
                say(u, war, e.name, war_rel, tip, boyut)
            else:
                say(u, None, e.name, '', tip, boyut)
                if tip == 'F' and rel.lower().startswith('lib/') and rel.count('/') == 1 and ad_kucuk.endswith('.jar'):
                    kad, ksurum = jar_ayir(e.name)
                    u['ear_kutuphaneleri'].append([kad, ksurum, boyut])
                if rel.lower() == 'meta-inf/application.xml':
                    u['application_xml'] = True
            if tip == 'D':
                kuyruk.append((rel, yeni_k, derinlik + 1))
    for k in sorted(warlar):
        u['warlar'].append(warlar[k])
    return yapi, kutuphane


def arsiv_uygulama(u, tam):
    """'.ear' arsiv dosyasi: merkez dizin; ic WAR'lar yalniz TAM kipte ve boyut sinirinin altinda acilir."""
    yapi, kutuphane = Iz(), Iz()
    try:
        merkez_giris = zip_merkez_giris_sayisi(tam)
        kalan = min(SINIR_UYGULAMA - u['giris'], SINIR_HOST - HOST['giris'])
        if merkez_giris is not None and (merkez_giris < 0 or merkez_giris > max(0, kalan)):
            uyar(u, 'arsiv merkez dizini giris siniri', 'KISMI_SINIR')
            return yapi, kutuphane
        with zipfile.ZipFile(tam, 'r') as z:
            girisler = z.infolist()
            for i in sorted(girisler, key=lambda x: x.filename):
                if sure_doldu():
                    uyar(u, 'sure butcesi doldu', 'KISMI_ZAMAN')
                    break
                rel = i.filename.rstrip('/')
                if not rel:
                    continue
                if u['giris'] >= SINIR_UYGULAMA or HOST['giris'] >= SINIR_HOST:
                    uyar(u, 'giris siniri', 'KISMI_SINIR')
                    break
                tip = 'D' if i.filename.endswith('/') else 'Z'
                u['giris'] += 1
                HOST['giris'] += 1
                if not ucucu(rel):
                    yapi.ekle(rel, tip)
                if KIP == 'TAM':
                    u['satirlar'].append([rel, tip, '', '', '', i.file_size, zip_zaman(i.date_time), '', ''])
                ad_kucuk = rel.rsplit('/', 1)[-1].lower()
                say(u, None, rel.rsplit('/', 1)[-1], '', tip, i.file_size)
                if rel.lower() == 'meta-inf/application.xml':
                    u['application_xml'] = True
                if tip == 'Z' and rel.lower().startswith('lib/') and rel.count('/') == 1 and ad_kucuk.endswith('.jar'):
                    kad, ksurum = jar_ayir(rel.rsplit('/', 1)[-1])
                    u['ear_kutuphaneleri'].append([kad, ksurum, i.file_size])
                if tip == 'Z' and ad_kucuk.endswith('.war'):
                    war = yeni_war(rel, 'ARSIV_ICINDE')
                    u['warlar'].append(war)
                    if KIP != 'TAM' or i.file_size > ARSIV_BAYT:
                        war['durum'] = 'ARSIV_ACILMADI'
                        uyar(u, 'ic arsiv acilmadi (' + KIP + ', ' + str(i.file_size) + ' bayt): ' + rel, 'ARSIV_ACILMADI')
                        continue
                    try:
                        ic = zip_girisleri(io.BytesIO(z.read(i)))
                        arsiv_war_isle(u, war, ic, rel, yapi)
                    except (zipfile.BadZipFile, OSError, RuntimeError, MemoryError) as e:
                        war['durum'] = 'ARSIV_ACILMADI'
                        uyar(u, 'ic arsiv okunamadi ' + rel + ': ' + e.__class__.__name__, 'ARSIV_ACILMADI')
    except (zipfile.BadZipFile, OSError, RuntimeError) as e:
        uyar(u, 'arsiv okunamadi: ' + e.__class__.__name__, 'ARSIV_ACILMADI')
    return yapi, kutuphane


def bitir(u, yapi, kutuphane):
    for w in u['warlar']:
        for kad, ksurum, boyut in sorted(w['kutuphaneler']):
            kutuphane.ekle(w['ad'], kad, ksurum, boyut)
        if w['durum'] != 'TAM' and u['durum'] == 'TAM':
            u['durum'] = w['durum']
    for kad, ksurum, boyut in sorted(u['ear_kutuphaneleri']):
        kutuphane.ekle('', kad, ksurum, boyut)
    u['yapi_izi'] = yapi.deger()
    u['kutuphane_izi'] = kutuphane.deger()
    return u


def uygulama_tara(kok, ad, tip):
    tam = os.path.join(kok, ad)
    if tip == 'L':
        u = yeni_uygulama(kok, ad, 'BAG')
        try:
            u['bag_hedefi'] = os.readlink(tam)[:300]
            hedef = os.path.realpath(tam)
            kok_gercek = os.path.realpath(kok)
            if kok_gercek == hedef or kok_gercek.startswith(hedef.rstrip('/') + '/'):
                uyar(u, 'bag kokun kendisini ya da ustunu gosteriyor, izlenmedi: ' + u['bag_hedefi'], 'HATA')
                return bitir(u, Iz(), Iz())
            if os.path.isdir(hedef):
                return bitir(u, *acik_uygulama(u, hedef))
            if os.path.isfile(hedef):
                return bitir(u, *arsiv_uygulama(u, hedef))
            uyar(u, 'bag hedefi yok: ' + u['bag_hedefi'], 'HATA')
        except OSError as e:
            uyar(u, 'bag okunamadi: ' + e.__class__.__name__, 'HATA')
        return bitir(u, Iz(), Iz())
    if tip == 'D':
        u = yeni_uygulama(kok, ad, 'ACIK')
        return bitir(u, *acik_uygulama(u, tam))
    u = yeni_uygulama(kok, ad, 'ARSIV')
    return bitir(u, *arsiv_uygulama(u, tam))


def tara():
    yuk = {
        'sema': 1, 'tarayici_surum': SURUM, 'host': socket.gethostname(), 'kip': KIP,
        'python': sys.version.split()[0], 'uid': os.getuid(),
        'kullanici': os.environ.get('USER') or os.environ.get('LOGNAME') or '',
        'baslangic_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'sinirlar': {'uygulama': SINIR_UYGULAMA, 'host': SINIR_HOST, 'sure_sn': SURE, 'arsiv_bayt': ARSIV_BAYT},
        'kokler': [], 'uygulamalar': [], 'durum': 'TAM', 'uyarilar': [],
    }
    adaylar = []
    for kok in KOKLER:
        try:
            with os.scandir(kok) as it:
                cocuklar = sorted(it, key=lambda e: e.name)
        except FileNotFoundError:
            yuk['kokler'].append({'yol': kok, 'durum': 'YOK'})
            continue
        except OSError as e:
            yuk['kokler'].append({'yol': kok, 'durum': 'HATA', 'hata': e.__class__.__name__})
            continue
        yuk['kokler'].append({'yol': kok, 'durum': 'VAR'})
        for e in cocuklar:
            if not e.name.lower().endswith('.ear'):
                continue
            try:
                tip = 'L' if e.is_symlink() else ('D' if e.is_dir(follow_symlinks=False) else 'F')
            except OSError as hata:
                yuk['uyarilar'].append('tip okunamadi ' + e.path + ': ' + hata.__class__.__name__)
                continue
            adaylar.append((kok, e.name, tip))
    for kok, ad, tip in adaylar:
        if sure_doldu():
            u = yeni_uygulama(kok, ad, {'D': 'ACIK', 'F': 'ARSIV', 'L': 'BAG'}[tip])
            u['durum'] = 'ATLANDI_ZAMAN'
            yuk['uygulamalar'].append(u)
            continue
        try:
            yuk['uygulamalar'].append(uygulama_tara(kok, ad, tip))
        except Exception as e:  # tek uygulama hatasi host taramasini bitirmesin
            u = yeni_uygulama(kok, ad, 'BILINMIYOR')
            uyar(u, 'tarayici hatasi: ' + e.__class__.__name__ + ': ' + str(e)[:200], 'HATA')
            yuk['uygulamalar'].append(u)
    var = [k for k in yuk['kokler'] if k['durum'] == 'VAR']
    if not var:
        yuk['durum'] = 'KOK_YOK' if all(k['durum'] == 'YOK' for k in yuk['kokler']) else 'KISMI'
    elif HOST['zaman_doldu']:
        yuk['durum'] = 'ZAMAN_ASIMI'
    elif len(var) < len(yuk['kokler']) and any(k['durum'] == 'HATA' for k in yuk['kokler']):
        yuk['durum'] = 'KISMI'
    elif any(u['durum'] != 'TAM' for u in yuk['uygulamalar']) or yuk['uyarilar']:
        yuk['durum'] = 'KISMI'
    yuk['sure_sn'] = round(time.monotonic() - BASLANGIC, 2)
    yuk['giris'] = HOST['giris']
    return yuk


def insan_metni(yuk):
    s = ['host={} kip={} durum={} python={} uid={} sure={}sn giris={}'.format(
        yuk['host'], yuk['kip'], yuk['durum'], yuk['python'], yuk['uid'], yuk['sure_sn'], yuk['giris'])]
    for k in yuk['kokler']:
        s.append('kok {} {}'.format(k['yol'], k['durum']))
    for u in yuk['uygulamalar']:
        tek = lambda w, a: ','.join(sorted(set(v for kad, v, _ in w['kutuphaneler'] if kad == a))) or '-'
        s.append('{:<40} {:<6} {:<14} war={} jsp={} tld={} jar={} izi={}'.format(
            u['kok'] + '/' + u['ad'], u['bicim'], u['durum'], len(u['warlar']), u['jsp'], u['tld'], u['jar'], u['yapi_izi']))
        for w in u['warlar']:
            s.append('    {:<36} {:<12} {:<14} boot={} spring={} jsp={} tld={} tld_dizini={} web={}'.format(
                w['ad'], w['bicim'], w['durum'], tek(w, 'spring-boot'), tek(w, 'spring-core'), w['jsp'], w['tld'],
                'var' if w['tld_dizini'] else 'yok', ','.join(['web.xml'] if w['web_xml'] else []) +
                ''.join(',web.' + v + '.xml' for v in w['web_varyantlari'])))
        for m in u['uyarilar'][:3]:
            s.append('    ! ' + m)
    return '\n'.join(s) + '\n'


def main():
    yuk = tara()
    if CIKTI == 'insan':
        # Python 3.6 + LC_ALL=C: sys.stdout ASCII'dir; Turkce / bozuk dosya adi yazimi kirmasin.
        sys.stdout.flush()
        sys.stdout.buffer.write(insan_metni(yuk).encode('utf-8', 'surrogateescape'))
        return
    ham = json.dumps(yuk, ensure_ascii=False, separators=(',', ':')).encode('utf-8', 'surrogateescape')
    kod = base64.b64encode(zlib.compress(ham, 6)).decode('ascii')
    satirlar = [kod[i:i + 4000] for i in range(0, len(kod), 4000)]
    sys.stdout.write(BASLA + '\n' + '\n'.join(satirlar) + '\n' + BITTI + '\n')


if __name__ == '__main__':
    main()
