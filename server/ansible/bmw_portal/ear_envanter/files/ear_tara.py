# -*- coding: utf-8 -*-
# ear_tara.py - BMW Portal > Server Hub > Uygulama Envanteri: SALT OKUNUR EAR/WAR tarayicisi.
#
# Hedefte Ansible 'raw' ile 'python3 -B -' olarak STDIN'den calisir: hedefe dosya yazilmaz,
# bytecode birakilmaz, yalniz stdout'a tek blok basilir. Yalniz stdlib; Python 3.6+
# (RHEL 8 platform-python 3.6, RHEL 9 3.9).
#
# YAPMADIKLARI: uygulama dosyalarinin icerigini okumaz (yalniz zip arsivlerinin MERKEZ DIZINI, salt
# okunur), dosya yazmaz / silmez / izin degistirmez, uygulama ICINDE sembolik bag izlemez (yalniz
# kokteki 'APP.ear -> surum dizini' bagi tek adim izlenir ve kayda yazilir), NSS sorgusu yapmaz
# (uid/gid sayisal).
# TEK ICERIK ISTISNASI (2026-11-06): JBoss domain.xml / host.xml (salt okunur, 5 MB sinir, DOCTYPE /
# ENTITY iceren dosya reddedilir). Yalniz deployment / server-group / server adlari, yollari ve
# auto-start alinir; baska hicbir deger (parola, datasource, sistem ozelligi) pakete girmez.
# Kokteki .ear ile bitmeyen girdiler (ad, tip, boyut, mtime) ayrica listelenir: retire supheleri.
# FAZ A (2026-11-07, surum 3): ayni dosyalardan ek olarak profil (mod_cluster proxies / proxy-list /
# balancer / advertise, AJP / HTTP dinleyici soket adlari), socket-binding-group (ajp / http / https
# portlari, outbound remote-destination host:port), server-group profil / port grubu / ofset, server
# port-offset ve deployment yolunun diskte olup olmadigi (yalniz lstat). WebSphere serverindex.xml
# (sunucu, uc nokta portlari, kurulu uygulamalar). Istege bagli (EAR_BAGLANTI=1) yapilandirilmis portlara
# ESTABLISHED baglantilarin anlik goruntusu /proc/net/tcp{,6}'dan (surec eslemesi yok, uzak IP sayilir).
#
# KIPLER: OZET - dosya basina stat YOK (scandir ad + tip), yalniz kutuphane jar'larinin boyutu;
#         TAM  - her giris icin lstat (ls -lrtiR alanlari) ve agac satirlari.
#
# DURUMLAR (eksik olan asla TAM sayilmaz):
#   uygulama: TAM | KISMI_SINIR | KISMI_ZAMAN | KISMI_IZIN | ARSIV_ACILMADI | ATLANDI_ZAMAN | HATA
#   host:     TAM | KISMI | KOK_YOK | ZAMAN_ASIMI
# Ayarlar ortam degiskenleriyle (playbook verir): EAR_KIP, EAR_KOKLER, EAR_SINIR_UYGULAMA,
# EAR_SINIR_HOST, EAR_SURE, EAR_ARSIV_MB, EAR_CIKTI (paket | insan), EAR_JBOSS (JBoss kurulum
# kokleri, ':' ayrili; varsayilan /usr/jboss/AppServer:/usr/jboss8/AppServer), EAR_WAS (WebSphere
# kokleri), EAR_BAGLANTI (1: baglanti goruntusu), EAR_BAGLANTI_ORNEK, EAR_BAGLANTI_ARA (sn); testte EAR_PROC.
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
from xml.etree import ElementTree

SURUM = 3
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
JBOSS_KOKLERI = [k for k in os.environ.get('EAR_JBOSS', '/usr/jboss/AppServer:/usr/jboss8/AppServer').split(':') if k.startswith('/')]
YAPILANDIRMA_ALTLARI = ('domain/configuration', 'jboss/domain/configuration')
XML_SINIR = 5 * 1024 * 1024
XML_KAYIT_SINIRI = 1000
KOK_GIRDI_SINIRI = 500
WAS_KOKLERI = [k for k in os.environ.get('EAR_WAS', '/opt/IBM/WebSphere/AppServer:/usr/IBM/WebSphere/AppServer').split(':')
               if k.startswith('/')]
BAGLANTI = os.environ.get('EAR_BAGLANTI', '') == '1'
BAGLANTI_ORNEK = ortam_sayi('EAR_BAGLANTI_ORNEK', 3, 1, 10)
BAGLANTI_ARA = ortam_sayi('EAR_BAGLANTI_ARA', 10, 0, 60)
PROC = os.environ.get('EAR_PROC', '/proc')
SOKET_ADLARI = ('ajp', 'http', 'https')
IFADE_RE = re.compile(r'^(?:\$\{[^:}]+:(-?\d+)\}|(-?\d+))$')
WAS_UYGULAMA_RE = re.compile(r'applications/([^/]+?)(?:\.ear)?/')

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


def zip_zaman(dt):
    try:
        return int(time.mktime(dt + (0, 0, -1)))
    except (OverflowError, ValueError):
        return 0


def zip_merkez_giris_sayisi(kaynak, tavan):
    """ZIP'i acmadan merkez dizin basliklarini sayar; ZIP64/multi-disk/tutarsizlik fail-closed."""
    kaynak.seek(0, os.SEEK_END)
    boyut = kaynak.tell()
    if boyut < 22:
        return None
    kuyruk = min(boyut, 65557)  # EOCD 22 bayt + en cok 65535 bayt yorum.
    kaynak.seek(boyut - kuyruk, os.SEEK_SET)
    veri = kaynak.read(kuyruk)
    if len(veri) != kuyruk:
        return -1
    yer = len(veri)
    while True:
        yer = veri.rfind(b'PK\x05\x06', 0, yer)
        if yer < 0:
            return None
        if yer + 22 <= len(veri):
            alanlar = struct.unpack_from('<4s4H2LH', veri, yer)
            if yer + 22 + alanlar[7] == len(veri):
                break
    _, disk, merkez_disk, disk_giris, toplam, merkez_boyut, merkez_ofset, _ = alanlar
    mutlak_eocd = boyut - kuyruk + yer
    if (disk or merkez_disk or disk_giris != toplam or toplam == 0xffff or
            merkez_boyut == 0xffffffff or merkez_ofset == 0xffffffff or
            merkez_ofset + merkez_boyut != mutlak_eocd):
        return -1
    if toplam > tavan:
        return toplam

    # EOCD sayaci dusuk yazilmis olsa bile ZipFile'a gecmeden gercek merkez
    # basliklarini tavan+1'e kadar say. ZIP64 extra alani fail-closed reddedilir.
    kaynak.seek(merkez_ofset, os.SEEK_SET)
    kalan = merkez_boyut
    gercek = 0
    while kalan:
        if sure_doldu():
            return -2
        if kalan < 46:
            return -1
        baslik = kaynak.read(46)
        if len(baslik) != 46 or baslik[:4] != b'PK\x01\x02':
            return -1
        if struct.unpack_from('<H', baslik, 6)[0] == 45:  # ZIP64 icin gereken surum.
            return -1
        ad_boyut, ek_boyut, yorum_boyut = struct.unpack_from('<HHH', baslik, 28)
        atla = ad_boyut + ek_boyut + yorum_boyut
        if 46 + atla > kalan:
            return -1
        degisken = kaynak.read(atla)
        if len(degisken) != atla:
            return -1
        ek = degisken[ad_boyut:ad_boyut + ek_boyut]
        ek_yer = 0
        while ek_yer < len(ek):
            if ek_yer + 4 > len(ek):
                return -1
            ek_kimlik, ek_uzunluk = struct.unpack_from('<HH', ek, ek_yer)
            ek_yer += 4
            if ek_yer + ek_uzunluk > len(ek) or ek_kimlik == 0x0001:
                return -1
            ek_yer += ek_uzunluk
        kalan -= 46 + atla
        gercek += 1
        if gercek > tavan:
            return gercek
    return gercek if gercek == toplam else -1


def zip_girisleri(kaynak, tavan):
    """Ayni salt-okunur akista sinirli preflight sonrasi merkez dizini listeler."""
    merkez_giris = zip_merkez_giris_sayisi(kaynak, max(0, tavan))
    if merkez_giris == -2:
        return None, 'KISMI_ZAMAN'
    if merkez_giris is None or merkez_giris < 0:
        return None, 'ARSIV_ACILMADI'
    if merkez_giris > max(0, tavan):
        return None, 'KISMI_SINIR'
    if sure_doldu():
        return None, 'KISMI_ZAMAN'
    kaynak.seek(0, os.SEEK_SET)
    with zipfile.ZipFile(kaynak, 'r') as z:
        return [(i.filename, i.file_size, i.date_time) for i in z.infolist()], None


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
        fd = os.open(tam_yol, os.O_RDONLY)
        with os.fdopen(fd, 'rb') as akis:
            kalan = min(SINIR_UYGULAMA - u['giris'], SINIR_HOST - HOST['giris'])
            girisler, durum = zip_girisleri(akis, kalan)
        if durum:
            war['durum'] = durum
            uyar(u, 'arsiv on kapisi: ' + rel, durum)
            return
        arsiv_war_isle(u, war, girisler, rel, yapi)
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
        kalan = min(SINIR_UYGULAMA - u['giris'], SINIR_HOST - HOST['giris'])
        fd = os.open(tam, os.O_RDONLY)
        with os.fdopen(fd, 'rb') as akis:
            merkez_giris = zip_merkez_giris_sayisi(akis, max(0, kalan))
            if merkez_giris == -2 or sure_doldu():
                uyar(u, 'sure butcesi doldu', 'KISMI_ZAMAN')
                return yapi, kutuphane
            if merkez_giris is None or merkez_giris < 0:
                uyar(u, 'arsiv merkez dizini gecersiz', 'ARSIV_ACILMADI')
                return yapi, kutuphane
            if merkez_giris > max(0, kalan):
                uyar(u, 'arsiv merkez dizini giris siniri', 'KISMI_SINIR')
                return yapi, kutuphane
            akis.seek(0, os.SEEK_SET)
            with zipfile.ZipFile(akis, 'r') as z:
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
                            kalan = min(SINIR_UYGULAMA - u['giris'], SINIR_HOST - HOST['giris'])
                            ic, durum = zip_girisleri(io.BytesIO(z.read(i)), kalan)
                            if durum:
                                war['durum'] = durum
                                uyar(u, 'ic arsiv on kapisi: ' + rel, durum)
                                continue
                            arsiv_war_isle(u, war, ic, rel, yapi)
                        except (zipfile.BadZipFile, OSError, RuntimeError, MemoryError) as e:
                            war['durum'] = 'ARSIV_ACILMADI'
                            uyar(u, 'ic arsiv okunamadi ' + rel + ': ' + e.__class__.__name__, 'ARSIV_ACILMADI')
    except (zipfile.BadZipFile, OSError, RuntimeError) as e:
        uyar(u, 'arsiv okunamadi: ' + e.__class__.__name__, 'ARSIV_ACILMADI')
    return yapi, kutuphane


def kok_nesli(kok):
    """'/vhosting8' -> '8', '/vhosting' -> '7', digeri '?' (alim.jbossOf ile ayni kural)."""
    s = kok.rstrip('/')
    if s.endswith('/vhosting8'):
        return '8'
    if s.endswith('/vhosting'):
        return '7'
    return '?'


def kurulum_nesli(kurulum):
    s = '/' + kurulum.strip('/') + '/'
    if '/jboss8/' in s:
        return '8'
    if '/jboss/' in s:
        return '7'
    return '?'


def yerel(etiket):
    """'{urn:jboss:domain:1.7}server' -> 'server'; yorum / islem talimati -> ''."""
    return etiket.rsplit('}', 1)[-1] if isinstance(etiket, str) else ''


def xml_oku(yol):
    """(kok eleman, 'OKUNDU') ya da (None, YOK | IZIN | DOSYA_DEGIL | BUYUK | REDDEDILDI | BOZUK | HATA)."""
    try:
        st = os.lstat(yol)
    except FileNotFoundError:
        return None, 'YOK'
    except PermissionError:
        return None, 'IZIN'
    except OSError:
        return None, 'HATA'
    # FIFO / aygit acilirsa okuma bekler: yalniz duzenli dosya (ya da duzenli dosyaya bag).
    if not (stat.S_ISREG(st.st_mode) or (stat.S_ISLNK(st.st_mode) and os.path.isfile(yol))):
        return None, 'DOSYA_DEGIL'
    try:
        fd = os.open(yol, os.O_RDONLY)
        with os.fdopen(fd, 'rb') as akis:
            veri = akis.read(XML_SINIR + 1)
    except PermissionError:
        return None, 'IZIN'
    except OSError:
        return None, 'HATA'
    if len(veri) > XML_SINIR:
        return None, 'BUYUK'
    # Varlik genisletme / dis varlik saldirisi: DOCTYPE ya da ENTITY tasiyan yapilandirma ayristirilmaz.
    buyuk = veri.upper()
    if b'<!DOCTYPE' in buyuk or b'<!ENTITY' in buyuk:
        return None, 'REDDEDILDI'
    try:
        return ElementTree.fromstring(veri), 'OKUNDU'
    except (ElementTree.ParseError, ValueError):
        return None, 'BOZUK'


def cocuklar_of(eleman, ad):
    return [c for c in eleman if yerel(c.tag) == ad]


def yol_durumu(yol):
    """VAR | YOK | OLCULEMEDI (izin / hata: 'yok' sayilmaz)."""
    try:
        os.lstat(yol)
        return 'VAR'
    except FileNotFoundError:
        return 'YOK'
    except OSError:
        return 'OLCULEMEDI'


def ifade_sayi(deger):
    """'8009' -> 8009; '${jboss.ajp.port:8009}' -> 8009 (ozelligin varsayilani); cozulemezse None."""
    if deger is None:
        return None
    m = IFADE_RE.match(str(deger).strip())
    return int(m.group(1) or m.group(2)) if m else None


def profil_ozeti(p):
    """Profil: mod_cluster ayari (proxies / proxy-list / balancer / advertise) ve AJP / HTTP dinleyici soketleri."""
    out = {'ad': (p.get('name') or '')[:128], 'modcluster': None, 'ajp': [], 'http': []}
    for alt in p:
        ns = alt.tag.rsplit('}', 1)[0] if isinstance(alt.tag, str) else ''
        if yerel(alt.tag) != 'subsystem':
            continue
        if ':modcluster:' in ns:
            for c in alt.iter():
                t = yerel(c.tag)
                if t in ('mod-cluster-config', 'proxy'):
                    out['modcluster'] = {
                        'tur': t,
                        'proxies': [x for x in (c.get('proxies') or '').split() if x][:50],
                        'proxy_list': [x for x in (c.get('proxy-list') or '').split(',') if x.strip()][:50],
                        'balancer': (c.get('balancer') or '')[:128],
                        'advertise': (c.get('advertise') or 'true').lower() != 'false',
                        'advertise_soketi': (c.get('advertise-socket') or '')[:128],
                        'dinleyici': (c.get('listener') or c.get('connector') or '')[:128],
                    }
                    break
        elif ':undertow:' in ns or ':web:' in ns:
            for c in alt.iter():
                t = yerel(c.tag)
                proto = (c.get('protocol') or '').upper()
                if t == 'ajp-listener' or (t == 'connector' and proto.startswith('AJP')):
                    out['ajp'].append((c.get('socket-binding') or '')[:128])
                elif t in ('http-listener', 'https-listener') or (t == 'connector' and proto.startswith('HTTP')):
                    out['http'].append((c.get('socket-binding') or '')[:128])
    out['ajp'], out['http'] = out['ajp'][:20], out['http'][:20]
    return out


def soket_grubu_ozeti(sg):
    """socket-binding-group: bilinen soketlerin portlari ve outbound remote-destination hedefleri."""
    out = {'ad': (sg.get('name') or '')[:128], 'soketler': {}, 'outbound': []}
    for c in sg:
        t = yerel(c.tag)
        if t == 'socket-binding' and len(out['soketler']) < 100:
            out['soketler'][(c.get('name') or '')[:64]] = ifade_sayi(c.get('port'))
        elif t == 'outbound-socket-binding' and len(out['outbound']) < 50:
            for r in c:
                if yerel(r.tag) == 'remote-destination':
                    out['outbound'].append({'ad': (c.get('name') or '')[:128], 'host': (r.get('host') or '')[:256],
                                            'port': ifade_sayi(r.get('port'))})
    return out


def domain_ozeti(kok, k):
    """domain.xml -> deployment'lar (ad, calisma adi, yol) ve server-group -> deployment listesi."""
    for kap in cocuklar_of(kok, 'deployments'):
        for d in cocuklar_of(kap, 'deployment'):
            if len(k['deploymentlar']) >= XML_KAYIT_SINIRI:
                k['kesildi'] = True
                break
            kayit = {'ad': (d.get('name') or '')[:256], 'calisma_adi': (d.get('runtime-name') or '')[:256],
                     'tur': 'YONETILEN', 'yol': '', 'goreli': ''}
            for c in d:
                t = yerel(c.tag)
                if t in ('fs-exploded', 'fs-archive'):
                    kayit['tur'] = 'ACIK' if t == 'fs-exploded' else 'ARSIV'
                    kayit['yol'] = (c.get('path') or '')[:400]
                    kayit['goreli'] = (c.get('relative-to') or '')[:128]
            # Tanim var dosya yok mu: yalniz mutlak ve relative-to'suz yol lstat ile (icerik okunmaz).
            kayit['yol_durumu'] = yol_durumu(kayit['yol']) if kayit['yol'].startswith('/') and not kayit['goreli'] else None
            k['deploymentlar'].append(kayit)
    for kap in cocuklar_of(kok, 'profiles'):
        for p in cocuklar_of(kap, 'profile'):
            if len(k['profiller']) < XML_KAYIT_SINIRI:
                k['profiller'].append(profil_ozeti(p))
    for kap in cocuklar_of(kok, 'socket-binding-groups'):
        for sg in cocuklar_of(kap, 'socket-binding-group'):
            if len(k['soket_gruplari']) < XML_KAYIT_SINIRI:
                k['soket_gruplari'].append(soket_grubu_ozeti(sg))
    for kap in cocuklar_of(kok, 'server-groups'):
        for g in cocuklar_of(kap, 'server-group'):
            if len(k['gruplar']) >= XML_KAYIT_SINIRI:
                k['kesildi'] = True
                break
            sbg = cocuklar_of(g, 'socket-binding-group')
            sbg = sbg[0] if sbg else None
            dlar = []
            for dkap in cocuklar_of(g, 'deployments'):
                for d in cocuklar_of(dkap, 'deployment'):
                    if len(dlar) < XML_KAYIT_SINIRI:
                        dlar.append({'ad': (d.get('name') or '')[:256],
                                     'acik': (d.get('enabled') or 'true').lower() != 'false'})
                    else:
                        k['kesildi'] = True
            k['gruplar'].append({'ad': (g.get('name') or '')[:128], 'deploymentlar': dlar,
                                 'profil': (g.get('profile') or '')[:128],
                                 'soket_grubu': ((sbg.get('ref') or '') if sbg is not None else '')[:128],
                                 'port_ofseti': ifade_sayi(sbg.get('port-offset')) if sbg is not None else None})


def host_ozeti(kok, k):
    """host.xml -> sunucular (JVM adi, server-group, auto-start; yoksa JBoss varsayilani true)."""
    k['host_adi'] = (kok.get('name') or '')[:128]
    for kap in cocuklar_of(kok, 'servers'):
        for s in cocuklar_of(kap, 'server'):
            if len(k['sunucular']) >= XML_KAYIT_SINIRI:
                k['kesildi'] = True
                break
            sb = cocuklar_of(s, 'socket-bindings')
            sb = sb[0] if sb else None
            k['sunucular'].append({'ad': (s.get('name') or '')[:128], 'grup': (s.get('group') or '')[:128],
                                   'auto_start': (s.get('auto-start') or 'true').lower() != 'false',
                                   'soket_grubu': ((sb.get('socket-binding-group') or '') if sb is not None else '')[:128],
                                   'port_ofseti': ifade_sayi(sb.get('port-offset')) if sb is not None else None})


def yapilandirma_tara():
    """Her JBoss kurulumu icin ilk bulunan yapilandirma dizini (domain.xml + host.xml)."""
    sonuc = []
    for kurulum in JBOSS_KOKLERI:
        secilen = None
        for alt in YAPILANDIRMA_ALTLARI:
            dizin = kurulum.rstrip('/') + '/' + alt
            d_kok, d_durum = xml_oku(dizin + '/domain.xml')
            h_kok, h_durum = xml_oku(dizin + '/host.xml')
            if d_durum == 'YOK' and h_durum == 'YOK':
                continue
            aday = (dizin, d_kok, d_durum, h_kok, h_durum)
            if secilen is None or (d_durum == 'OKUNDU' and h_durum == 'OKUNDU'):
                secilen = aday
            if d_durum == 'OKUNDU' and h_durum == 'OKUNDU':
                break
        k = {'kurulum': kurulum, 'nesil': kurulum_nesli(kurulum), 'dizin': '', 'domain': 'YOK', 'host': 'YOK',
             'host_adi': '', 'deploymentlar': [], 'gruplar': [], 'sunucular': [], 'kesildi': False,
             'profiller': [], 'soket_gruplari': []}
        if secilen is not None:
            dizin, d_kok, d_durum, h_kok, h_durum = secilen
            k['dizin'], k['domain'], k['host'] = dizin, d_durum, h_durum
            if d_kok is not None:
                domain_ozeti(d_kok, k)
            if h_kok is not None:
                host_ozeti(h_kok, k)
        sonuc.append(k)
    return sonuc


def xml_eslestir(u, yapilandirmalar):
    """Diskteki EAR -> domain.xml deployment -> server-group -> host.xml JVM.
    durum: VAR (en az bir JVM) | JVM_YOK (neden TANIM_YOK / GRUPTA_YOK / SUNUCU_YOK) | OLCULEMEDI.
    Yol eslesmesi her kurulumda aranir; ad eslesmesi yalniz ayni nesilde (ayni EAR iki kokte olabilir).
    TANIM_YOK icin domain.xml yeter; JVM cozumu host.xml ister. Okunamayan yapilandirma asla
    'JVM yok' sayilmaz."""
    nesil = kok_nesli(u['kok'])
    yollar = set([os.path.normpath(os.path.join(u['kok'], u['ad']))])
    if u['bag_hedefi']:
        yollar.add(os.path.normpath(os.path.join(u['kok'], u['bag_hedefi'])))
    ad_k = u['ad'].lower()
    ayni_nesil = [k for k in yapilandirmalar if nesil == '?' or k['nesil'] == nesil]
    ayni = set(id(k) for k in ayni_nesil)
    bulunan = []
    for k in yapilandirmalar:
        if k['domain'] != 'OKUNDU':
            continue
        for d in k['deploymentlar']:
            yol_tutar = bool(d['yol']) and not d['goreli'] and os.path.normpath(d['yol']) in yollar
            ad_tutar = id(k) in ayni and ad_k in (d['ad'].lower(), d['calisma_adi'].lower())
            if yol_tutar or ad_tutar:
                bulunan.append((k, d, 'YOL' if yol_tutar else 'AD'))
    if not bulunan:
        eksik = [k for k in ayni_nesil if k['domain'] != 'OKUNDU']
        if not ayni_nesil or eksik:
            neden = '; '.join('{} domain.xml {}'.format(k['kurulum'], k['domain']) for k in eksik)
            return {'durum': 'OLCULEMEDI', 'neden': (neden or 'bu kok icin JBoss kurulumu tanimli degil')[:300]}
        return {'durum': 'JVM_YOK', 'neden': 'TANIM_YOK', 'deploymentlar': [], 'jvmler': []}
    deploymentlar, jvmler, gorulen, hostsuz = [], [], set(), []
    for k, d, yontem in bulunan[:10]:
        gruplar = [{'ad': g['ad'], 'acik': x['acik']} for g in k['gruplar'] for x in g['deploymentlar'] if x['ad'] == d['ad']]
        deploymentlar.append({'kurulum': k['kurulum'], 'ad': d['ad'], 'tur': d['tur'], 'yol': d['yol'],
                              'yontem': yontem, 'gruplar': gruplar[:20]})
        if gruplar and k['host'] != 'OKUNDU':
            hostsuz.append('{} host.xml {}'.format(k['kurulum'], k['host']))
        for g in gruplar:
            for s in k['sunucular']:
                if s['grup'] == g['ad'] and (k['kurulum'], s['ad']) not in gorulen and len(jvmler) < 50:
                    gorulen.add((k['kurulum'], s['ad']))
                    jvmler.append({'ad': s['ad'], 'grup': s['grup'], 'auto_start': s['auto_start'],
                                   'deployment_acik': g['acik'], 'kurulum': k['kurulum']})
    if jvmler:
        return {'durum': 'VAR', 'deploymentlar': deploymentlar, 'jvmler': jvmler}
    if hostsuz:
        return {'durum': 'OLCULEMEDI', 'neden': '; '.join(hostsuz)[:300], 'deploymentlar': deploymentlar}
    neden = 'SUNUCU_YOK' if any(d['gruplar'] for d in deploymentlar) else 'GRUPTA_YOK'
    return {'durum': 'JVM_YOK', 'neden': neden, 'deploymentlar': deploymentlar, 'jvmler': []}


def alt_dizinler(yol):
    """(sirali alt dizin adlari, durum) - durum VAR | YOK | IZIN | HATA."""
    try:
        with os.scandir(yol) as it:
            return sorted(e.name for e in it if e.is_dir(follow_symlinks=False)), 'VAR'
    except FileNotFoundError:
        return [], 'YOK'
    except PermissionError:
        return [], 'IZIN'
    except OSError:
        return [], 'HATA'


def was_tara():
    """WebSphere: <kok>/profiles/<p>/config/cells/<c>/nodes/<n>/serverindex.xml -> sunucu, uc nokta, uygulama."""
    out = {'kokler': [], 'dosyalar': [], 'sunucular': [], 'kesildi': False}
    for kok in WAS_KOKLERI:
        profiller, durum = alt_dizinler(kok.rstrip('/') + '/profiles')
        out['kokler'].append({'yol': kok, 'durum': durum})
        for prof in profiller[:20]:
            hucre_kok = '/'.join([kok.rstrip('/'), 'profiles', prof, 'config', 'cells'])
            for hucre in alt_dizinler(hucre_kok)[0][:20]:
                for dugum in alt_dizinler(hucre_kok + '/' + hucre + '/nodes')[0][:50]:
                    yol = '/'.join([hucre_kok, hucre, 'nodes', dugum, 'serverindex.xml'])
                    x, d = xml_oku(yol)
                    if d == 'YOK':
                        continue
                    if len(out['dosyalar']) < 100:
                        out['dosyalar'].append({'yol': yol[:400], 'durum': d})
                    if x is None:
                        continue
                    for se in x.iter():
                        if yerel(se.tag) != 'serverEntries':
                            continue
                        if len(out['sunucular']) >= XML_KAYIT_SINIRI:
                            out['kesildi'] = True
                            break
                        uclar, uygulamalar = [], []
                        for c in se:
                            t = yerel(c.tag)
                            if t == 'deployedApplications' and c.text and len(uygulamalar) < 200:
                                m = WAS_UYGULAMA_RE.search(c.text + '/')
                                uygulamalar.append((m.group(1) if m else c.text)[:256])
                            elif t == 'specialEndpoints' and (c.get('endPointName') or '').startswith('WC_') and len(uclar) < 20:
                                for e in c:
                                    if yerel(e.tag) == 'endPoint':
                                        uclar.append({'ad': (c.get('endPointName') or '')[:64], 'host': (e.get('host') or '')[:256],
                                                      'port': ifade_sayi(e.get('port'))})
                        out['sunucular'].append({'profil': prof[:128], 'hucre': hucre[:128], 'dugum': dugum[:128],
                                                 'ad': (se.get('serverName') or '')[:128],
                                                 'tur': (se.get('serverType') or '')[:64],
                                                 'uclar': uclar, 'uygulamalar': uygulamalar})
    return out


def hex_ip(h):
    if len(h) == 8:
        return socket.inet_ntop(socket.AF_INET, bytes.fromhex(h)[::-1])
    b = bytes.fromhex(h)
    return socket.inet_ntop(socket.AF_INET6, b''.join(b[i:i + 4][::-1] for i in range(0, 16, 4)))


def tcp_satirlari():
    """/proc/net/tcp{,6}: [(durum hex, yerel port, uzak ip)]; hicbiri okunamazsa None."""
    out, okundu = [], False
    for ad in ('tcp', 'tcp6'):
        try:
            fd = os.open(PROC + '/net/' + ad, os.O_RDONLY)
            with os.fdopen(fd, 'rb') as akis:
                veri = akis.read(64 * 1024 * 1024)
        except OSError:
            continue
        okundu = True
        for s in veri.decode('ascii', 'replace').split('\n')[1:]:
            p = s.split()
            if len(p) < 4:
                continue
            try:
                yerel_port = int(p[1].split(':')[1], 16)
                uzak_ip = hex_ip(p[2].split(':')[0])
            except (ValueError, IndexError, OSError):
                continue
            out.append((p[3], yerel_port, uzak_ip))
    return out if okundu else None


def yapilandirilmis_portlar(yapilandirmalar, was):
    """JVM / WAS sunucusu basina yapilandirilmis portlar: {port: [{jvm, kurulum, tur}]}.
    JBoss domain: sunucunun socket-binding-group'u (yoksa grubun), ofset sunucunun port-offset'i (yoksa grubun)."""
    portlar = {}
    for k in yapilandirmalar:
        gruplar = dict((g['ad'], g) for g in k['gruplar'])
        soketler = dict((s['ad'], s) for s in k['soket_gruplari'])
        for s in k['sunucular']:
            g = gruplar.get(s['grup'], {})
            sg = soketler.get(s.get('soket_grubu') or g.get('soket_grubu') or '')
            if not sg:
                continue
            ofset = s['port_ofseti'] if s.get('port_ofseti') is not None else (g.get('port_ofseti') or 0)
            for ad in SOKET_ADLARI:
                taban = sg['soketler'].get(ad)
                if taban is not None:
                    portlar.setdefault(taban + ofset, []).append({'jvm': s['ad'], 'kurulum': k['kurulum'], 'tur': ad})
    for s in was['sunucular']:
        for u in s['uclar']:
            if u['port'] is not None:
                portlar.setdefault(u['port'], []).append({'jvm': s['ad'], 'kurulum': 'WAS:' + s['profil'],
                                                          'tur': 'was_https' if 'secure' in u['ad'] else 'was_http'})
    return portlar


def baglanti_tara(yapilandirmalar, was):
    """Yapilandirilmis portlara ESTABLISHED baglantilar: BAGLANTI_ORNEK ornek, BAGLANTI_ARA sn arayla.
    'Kullaniliyor' icin guclu kanit; 'kullanilmiyor' icin tek basina YETMEZ (anlik goruntu)."""
    portlar = yapilandirilmis_portlar(yapilandirmalar, was)
    out = {'durum': 'OLCULDU', 'ornek': 0, 'ara_sn': BAGLANTI_ARA, 'portlar': []}
    if not portlar:
        out['durum'] = 'PORT_YOK'
        return out
    dinlenen, en_cok, uzaklar = set(), {}, {}
    for i in range(BAGLANTI_ORNEK):
        if i:
            time.sleep(BAGLANTI_ARA)
        satirlar = tcp_satirlari()
        if satirlar is None:
            out['durum'] = 'OLCULEMEDI'
            break
        out['ornek'] += 1
        say = {}
        for durum, port, uzak in satirlar:
            if port not in portlar:
                continue
            if durum == '0A':
                dinlenen.add(port)
            elif durum == '01':
                say[port] = say.get(port, 0) + 1
                d = uzaklar.setdefault(port, {})
                d[uzak] = d.get(uzak, 0) + 1
        for port, n in say.items():
            en_cok[port] = max(en_cok.get(port, 0), n)
    for port in sorted(portlar)[:500]:
        u = uzaklar.get(port, {})
        out['portlar'].append({'port': port, 'sahipler': portlar[port][:10], 'dinleniyor': port in dinlenen,
                               'en_cok': en_cok.get(port, 0),
                               'uzaklar': [{'ip': ip, 'gozlem': n} for ip, n in
                                           sorted(u.items(), key=lambda x: (-x[1], x[0]))[:10]]})
    return out


def kok_girdisi(kok, e):
    """Kokteki .ear disi girdi: ad, tip, boyut, mtime (yalniz lstat), bag ise hedef."""
    g = {'kok': kok, 'ad': e.name, 'tip': '?', 'boyut': None, 'mtime': None, 'hedef': ''}
    try:
        st = os.lstat(e.path)
        g['tip'] = 'L' if stat.S_ISLNK(st.st_mode) else ('D' if stat.S_ISDIR(st.st_mode) else 'F')
        g['boyut'] = st.st_size
        g['mtime'] = int(st.st_mtime)
        if g['tip'] == 'L':
            g['hedef'] = os.readlink(e.path)[:300]
    except OSError:
        pass
    return g


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
        'kok_girdileri': [], 'kok_girdisi_kesilen': 0, 'yapilandirma': [],
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
                if len(yuk['kok_girdileri']) < KOK_GIRDI_SINIRI:
                    yuk['kok_girdileri'].append(kok_girdisi(kok, e))
                else:
                    yuk['kok_girdisi_kesilen'] += 1
                continue
            try:
                tip = 'L' if e.is_symlink() else ('D' if e.is_dir(follow_symlinks=False) else 'F')
            except OSError as hata:
                yuk['uyarilar'].append('tip okunamadi ' + e.path + ': ' + hata.__class__.__name__)
                continue
            adaylar.append((kok, e.name, tip))
    # Yapilandirma uygulamalardan ONCE: kucuk ve hizli; sure butcesi dolsa da olculmus olsun.
    yuk['yapilandirma'] = yapilandirma_tara()
    yuk['was'] = was_tara()
    yuk['baglanti'] = baglanti_tara(yuk['yapilandirma'], yuk['was']) if BAGLANTI else {'durum': 'KAPALI'}
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
    for u in yuk['uygulamalar']:
        u['xml_eslesme'] = xml_eslestir(u, yuk['yapilandirma'])
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
    for k in yuk['yapilandirma']:
        s.append('jboss {} domain.xml={} host.xml={} deployment={} jvm={}'.format(
            k['kurulum'], k['domain'], k['host'], len(k['deploymentlar']), len(k['sunucular'])))
    for g in yuk['kok_girdileri']:
        s.append('ear disi {}/{} {}{}'.format(g['kok'], g['ad'], g['tip'], (' -> ' + g['hedef']) if g['hedef'] else ''))
    for u in yuk['uygulamalar']:
        tek = lambda w, a: ','.join(sorted(set(v for kad, v, _ in w['kutuphaneler'] if kad == a))) or '-'
        s.append('{:<40} {:<6} {:<14} war={} jsp={} tld={} jar={} izi={}'.format(
            u['kok'] + '/' + u['ad'], u['bicim'], u['durum'], len(u['warlar']), u['jsp'], u['tld'], u['jar'], u['yapi_izi']))
        for w in u['warlar']:
            s.append('    {:<36} {:<12} {:<14} boot={} spring={} jsp={} tld={} tld_dizini={} web={}'.format(
                w['ad'], w['bicim'], w['durum'], tek(w, 'spring-boot'), tek(w, 'spring-core'), w['jsp'], w['tld'],
                'var' if w['tld_dizini'] else 'yok', ','.join(['web.xml'] if w['web_xml'] else []) +
                ''.join(',web.' + v + '.xml' for v in w['web_varyantlari'])))
        x = u.get('xml_eslesme') or {}
        s.append('    xml={} {} jvm={}'.format(x.get('durum', '-'), x.get('neden', ''),
                                             ','.join(j['ad'] for j in x.get('jvmler', [])) or '-'))
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
