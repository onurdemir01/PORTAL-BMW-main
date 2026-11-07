# -*- coding: utf-8 -*-
# web_tara.py - BMW Portal > Server Hub > Uygulama Envanteri FAZ W: SALT OKUNUR web katmani tarayicisi.
#
# Kullanici (2026-11-07): "web serverda config var mi, hatali mi, eksik mi; conf var ama running degil;
# running ama eksik conf; conf var yuk gelmiyor; yuk geliyor ama hc.html / hc.jsp disinda gelmiyor;
# web serverin kullandigi / kullanmadigi IP'ler ... read only, production safe".
#
# Hedefte Ansible 'raw' ile 'python3 -B -' olarak STDIN'den calisir; ear_tara.py ile ayni kurallar:
# hedefe dosya yazilmaz, bytecode birakilmaz, yalniz stdout'a tek blok basilir. Yalniz stdlib; 3.6+.
#
# YAPMADIKLARI: httpd / apachectl ikilisini CALISTIRMAZ (config kendi ayristiricimizla okunur),
# calisan web sunucusuna istek ATMAZ (mod_cluster manager dahil), ag baglantisi acmaz, anahtar dosyasi
# okumaz (SSL dosyalari yalniz stat). TEK ALT SUREC: `ip -o addr show` (sunucunun IP'leri). Soketler
# /proc/net/tcp{,6}'dan okunur.
#
# OKUDUKLARI (hepsi salt okunur, boyut / sure / bayt butceli):
#   - /proc/<pid>/cmdline: calisan httpd surecleri (ServerRoot -d, conf -f, tanimlar -D)
#   - Apache / IHS config agaci: Include, IfModule / IfDefine, Listen, VirtualHost, ServerName / Alias,
#     ProxyPass(Match), <Proxy balancer://> BalancerMember, RewriteRule [P], JkMount / JkMountFile /
#     JkWorkersFile (workers.properties), mod_cluster yonergeleri, WebSpherePluginConfig (plugin-cfg.xml),
#     CustomLog / ErrorLog / JkLogFile, SSLCertificateFile (var mi), DocumentRoot
#   - access log: vhost basina pencerede GERCEK / HC / STATIK istek sayilari, durum siniflari, son
#     gercek istek, kapsama baslangici, istemci sayisi, HC istemcileri (LB yokluyor mu)
#   - error log / mod_jk log / WAS eklenti logu: arka uca baglanamama sayilari
#
# OLCULEMEDI != YOK: okunamayan dosya, gorunmeyen surec (hidepid), kesik log, ayristirilamayan satir
# ayri durumla yazilir; hicbiri "yok" ya da "0 istek" sayilmaz.
#
# Ayarlar ortam degiskeniyle (playbook verir): EAR_WEB_KOKLER (aday kurulum kokleri, ':' ayrili),
# EAR_WEB_HC (saglik kontrolu dosya adlari, ',' ayrili), EAR_WEB_GUN (pencere, gun), EAR_WEB_LOG_MB
# (host basina log okuma butcesi), EAR_WEB_SURE (sn). Yalniz testte: EAR_WEB_PROC (proc koku),
# EAR_WEB_IP_DOSYA (`ip -o addr show` ciktisi dosyasi), EAR_WEB_SIMDI (epoch).
import base64
import calendar
import fnmatch
import gzip
import json
import os
import re
import socket
import stat
import subprocess
import sys
import time
import zlib
from xml.etree import ElementTree

SURUM = 1
BASLA = '@@EAR_WEB_BASLA@@'
BITTI = '@@EAR_WEB_BITTI@@'


def ortam_sayi(ad, varsayilan, en_az, en_cok):
    try:
        v = int(os.environ.get(ad, varsayilan))
    except ValueError:
        v = varsayilan
    return max(en_az, min(en_cok, v))


VARSAYILAN_KOKLER = ('/usr/IBMIHS:/opt/IBM/HTTPServer:/usr/IBM/HTTPServer:/etc/httpd:'
                     '/opt/rh/httpd24/root/etc/httpd:/opt/jbcs-httpd24-2.4/httpd')
KOKLER = [k for k in os.environ.get('EAR_WEB_KOKLER', VARSAYILAN_KOKLER).split(':') if k.startswith('/')]
HC_ADLARI = set(x.strip().lower() for x in os.environ.get('EAR_WEB_HC', 'hc.html,hc.jsp').split(',') if x.strip())
GUN = ortam_sayi('EAR_WEB_GUN', 7, 1, 31)
LOG_BUTCE = ortam_sayi('EAR_WEB_LOG_MB', 256, 1, 4096) * 1024 * 1024
SURE = ortam_sayi('EAR_WEB_SURE', 240, 10, 3600)
PROC = os.environ.get('EAR_WEB_PROC', '/proc')
IP_DOSYA = os.environ.get('EAR_WEB_IP_DOSYA', '')
try:
    SIMDI = int(os.environ.get('EAR_WEB_SIMDI', '')) or int(time.time())
except ValueError:
    SIMDI = int(time.time())

CONF_SINIR = 2 * 1024 * 1024
XML_SINIR = 5 * 1024 * 1024
DOSYA_SINIRI = 500
DERINLIK_SINIRI = 16
VHOST_SINIRI = 2000
HEDEF_SINIRI = 200
LISTE_SINIRI = 500
ERROR_LOG_BAYT = 32 * 1024 * 1024
IP_ADAYLARI = ('/usr/sbin/ip', '/sbin/ip', '/usr/bin/ip', '/bin/ip')
STATIK_UZANTI = set(['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2',
                     '.ttf', '.eot', '.map', '.webp', '.bmp'])
# Derlenmis (LoadModule gerektirmeyen) cekirdek moduller: IfModule bunlarda dogru sayilir.
YERLESIK = set(['core.c', 'mod_so.c', 'http_core.c', 'prefork.c', 'worker.c', 'event.c', 'mod_unixd.c',
                'mpm_prefork_module', 'mpm_worker_module', 'mpm_event_module', 'core_module', 'so_module',
                'http_module', 'unixd_module'])
MC_YONERGELERI = set(['managerbalancername', 'createbalancers', 'enablemcpmreceive', 'serveradvertise',
                      'advertisegroup', 'advertisefrequency', 'advertisesecurity', 'maxsessionid',
                      'persistslots', 'usealias'])
VARSAYILAN_PORT = {'ajp': 8009, 'http': 80, 'https': 443, 'ws': 80, 'wss': 443, 'h2c': 80, 'h2': 443}
AYLAR = dict((a, i + 1) for i, a in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug',
                                                 'sep', 'oct', 'nov', 'dec']))

BASLANGIC = time.monotonic()
DURUM = {'zaman_doldu': False, 'log_bayt': 0, 'uyarilar': []}


def sure_doldu():
    if time.monotonic() - BASLANGIC > SURE:
        DURUM['zaman_doldu'] = True
    return DURUM['zaman_doldu']


def uyar(metin):
    if len(DURUM['uyarilar']) < 50:
        DURUM['uyarilar'].append(metin[:300])


def M(v, n):
    return ('' if v is None else str(v))[:n]


# ── SALT OKUNUR DOSYA ERISIMI ───────────────────────────────────────────────────────────────────

def duzenli_mi(yol):
    """(True, None) duzenli dosya ya da duzenli dosyaya bag; degilse (False, durum)."""
    try:
        st = os.lstat(yol)
    except FileNotFoundError:
        return False, 'YOK'
    except PermissionError:
        return False, 'IZIN'
    except OSError:
        return False, 'HATA'
    if stat.S_ISREG(st.st_mode):
        return True, None
    if stat.S_ISLNK(st.st_mode):
        try:
            return (True, None) if stat.S_ISREG(os.stat(yol).st_mode) else (False, 'DOSYA_DEGIL')
        except FileNotFoundError:
            return False, 'YOK'
        except OSError:
            return False, 'HATA'
    return False, 'DOSYA_DEGIL'


def oku(yol, sinir):
    """(bayt, 'OKUNDU') ya da (None, YOK | IZIN | DOSYA_DEGIL | BUYUK | HATA). FIFO / aygit acilmaz."""
    ok, durum = duzenli_mi(yol)
    if not ok:
        return None, durum
    try:
        fd = os.open(yol, os.O_RDONLY)
        with os.fdopen(fd, 'rb') as akis:
            veri = akis.read(sinir + 1)
    except PermissionError:
        return None, 'IZIN'
    except OSError:
        return None, 'HATA'
    if len(veri) > sinir:
        return None, 'BUYUK'
    return veri, 'OKUNDU'


def metin(veri):
    return veri.decode('utf-8', 'replace')


def xml_oku(yol):
    veri, durum = oku(yol, XML_SINIR)
    if veri is None:
        return None, durum
    buyuk = veri.upper()
    if b'<!DOCTYPE' in buyuk or b'<!ENTITY' in buyuk:
        return None, 'REDDEDILDI'
    try:
        return ElementTree.fromstring(veri), 'OKUNDU'
    except (ElementTree.ParseError, ValueError):
        return None, 'BOZUK'


def var_mi(yol):
    """Dosya var mi (yalniz stat): True / False / None (olculemedi)."""
    try:
        os.stat(yol)
        return True
    except FileNotFoundError:
        return False
    except OSError:
        return None


def esle(desen):
    """Joker desen -> eslesen yollar (salt okunur listdir). Joker yoksa [desen] (var olmasa da)."""
    if not any(c in desen for c in '*?['):
        return [desen]
    dizin, ad = os.path.split(desen)
    if any(c in dizin for c in '*?['):
        out = []
        for d in esle(dizin):
            out.extend(esle(os.path.join(d, ad)))
        return sorted(set(out))
    try:
        return sorted(os.path.join(dizin, x) for x in os.listdir(dizin) if fnmatch.fnmatch(x, ad))
    except OSError:
        return []


# ── SURECLER (/proc) ─────────────────────────────────────────────────────────────────────────────

def surecler():
    """Calisan httpd surecleri: [{argv0, kok, conf, tanimlar}], ps_gorunur. hidepid'de surec 'yok' DEGIL."""
    gorunur = os.path.isdir(os.path.join(PROC, '1'))
    out = []
    try:
        pidler = [x for x in os.listdir(PROC) if x.isdigit()]
    except OSError:
        return [], False
    for pid in pidler:
        veri, durum = oku(os.path.join(PROC, pid, 'cmdline'), 65536)
        if not veri:
            continue
        argv = [metin(x) for x in veri.split(b'\0') if x]
        if not argv:
            continue
        ad = os.path.basename(argv[0])
        if ad not in ('httpd', 'httpd.worker', 'httpd.event', 'apache2'):
            continue
        kayit = {'argv0': argv[0][:400], 'kok': '', 'conf': '', 'tanimlar': []}
        i = 1
        while i < len(argv):
            a = argv[i]
            sonraki = argv[i + 1] if i + 1 < len(argv) else ''
            if a in ('-d', '-f', '-D') and sonraki:
                if a == '-d':
                    kayit['kok'] = sonraki[:400]
                elif a == '-f':
                    kayit['conf'] = sonraki[:400]
                else:
                    kayit['tanimlar'].append(sonraki[:64])
                i += 2
                continue
            if a.startswith('-D') and len(a) > 2:
                kayit['tanimlar'].append(a[2:66])
            i += 1
        out.append(kayit)
    return out, gorunur


def kok_tahmini(argv0):
    """ServerRoot -d verilmemisse ikili yolundan: /usr/IBMIHS/bin/httpd -> /usr/IBMIHS; /usr/sbin/httpd -> /etc/httpd."""
    d = os.path.dirname(os.path.dirname(argv0))
    if d.endswith('/root/usr'):
        return d[:-4] + '/etc/httpd'
    if d in ('/usr', '/', ''):
        return '/etc/httpd'
    return d


def urun_of(*yollar):
    s = ' '.join(yollar).lower()
    return 'IHS' if ('ibmihs' in s or 'httpserver' in s or '/ibm/' in s) else 'RHA'


# ── APACHE CONFIG AYRISTIRICI ────────────────────────────────────────────────────────────────────

def bol(satir):
    """Yonerge satirini argumanlara boler (cift / tek tirnak, kacis)."""
    out, cur, tirnak, i, var = [], [], None, 0, False
    while i < len(satir):
        c = satir[i]
        if tirnak:
            if c == '\\' and i + 1 < len(satir) and satir[i + 1] == tirnak:
                cur.append(tirnak)
                i += 2
                continue
            if c == tirnak:
                tirnak = None
            else:
                cur.append(c)
        elif c in '"\'':
            tirnak = c
            var = True
        elif c.isspace():
            if cur or var:
                out.append(''.join(cur))
                cur, var = [], False
        else:
            cur.append(c)
        i += 1
    if cur or var:
        out.append(''.join(cur))
    return out


def url_coz(url):
    """'ajp://host:8009/x' -> (sema, host, port|None). Balancer -> ('balancer', ad, None)."""
    # Kullanici bilgisi (user:parola@) atlanir: host sanilmaz, pakete de girmez.
    m = re.match(r'^([a-z0-9+]+)://(?:[^@/?#]*@)?(\[[^\]]+\]|[^/:?#]*)(?::(\d+))?', url.strip(), re.I)
    if not m:
        return None, None, None
    sema = m.group(1).lower()
    host = m.group(2).strip('[]')
    if sema == 'balancer':
        return 'balancer', host.lower(), None
    port = int(m.group(3)) if m.group(3) else VARSAYILAN_PORT.get(sema)
    return sema, host, port


class Kurulum(object):
    """Tek bir httpd kurulumunun (ServerRoot + ana conf) ayrisma sonucu."""

    def __init__(self, kok, conf, urun, kaynak, tanimlar, ps_gorunur):
        self.kok = kok
        self.conf = conf
        self.urun = urun
        self.kaynak = kaynak
        self.ps_gorunur = ps_gorunur
        self.tanimlar = set(tanimlar)
        self.degiskenler = {}
        self.moduller = set()
        self.dosyalar = []
        self.okunan = set()
        self.hatalar = []
        self.if_kararlari = []
        self.dinle = []
        self.vhostlar = []
        self.balancerlar = {}
        self.jk_workers = None
        self.jk_mount_global = []
        self.jk_log = ''
        self.mc = {}
        self.mc_dinleyen = []
        self.was_config = ''
        self.ana = {'access_log': [], 'error_log': '', 'server_name': '', 'hedefler': []}
        self.kesildi = False

    def hata(self, tur, dosya, satir, deger=''):
        if len(self.hatalar) < LISTE_SINIRI:
            self.hatalar.append({'tur': tur, 'dosya': M(dosya, 400), 'satir': satir, 'deger': M(deger, 300)})
        else:
            self.kesildi = True

    def yol(self, p):
        p = self.genislet(p)
        return p if p.startswith('/') else os.path.normpath(os.path.join(self.kok, p))

    def genislet(self, s):
        def degis(m):
            ad = m.group(1)
            if ad in self.degiskenler:
                return self.degiskenler[ad]
            return m.group(0)
        return re.sub(r'\$\{([A-Za-z0-9_]+)\}', degis, s)

    def modul_var(self, ad):
        a = ad.strip()
        if a in YERLESIK or a in self.moduller:
            return True
        # mod_proxy.c <-> proxy_module esdegerligi
        if a.endswith('.c'):
            return (a[4:-2] + '_module' if a.startswith('mod_') else a) in self.moduller
        return False

    # Bir dosyayi okuyup yonergeleri sirayla isler (Include ozyinelemeli).
    def dosya_isle(self, yol, derinlik, baglam):
        if sure_doldu():
            return
        if derinlik > DERINLIK_SINIRI:
            self.hata('DERINLIK', yol, 0)
            return
        gercek = os.path.realpath(yol)
        if gercek in baglam['yigin']:
            self.hata('DONGU', yol, 0)
            return
        if len(self.dosyalar) >= DOSYA_SINIRI:
            self.kesildi = True
            return
        veri, durum = oku(yol, CONF_SINIR)
        self.dosyalar.append({'yol': M(yol, 400), 'durum': durum})
        if veri is None:
            return
        self.okunan.add(gercek)
        baglam['yigin'].append(gercek)
        try:
            self.satirlar_isle(yol, metin(veri).split('\n'), derinlik, baglam)
        finally:
            baglam['yigin'].pop()

    def satirlar_isle(self, yol, satirlar, derinlik, baglam):
        birikim, bas = '', 0
        for no, ham in enumerate(satirlar, 1):
            s = ham.rstrip('\r')
            if s.endswith('\\'):
                if not birikim:
                    bas = no
                birikim += s[:-1] + ' '
                continue
            if birikim:
                s, no2 = birikim + s, bas
                birikim = ''
            else:
                no2 = no
            t = s.strip()
            if not t or t.startswith('#'):
                continue
            self.yonerge(yol, no2, t, derinlik, baglam)

    def yonerge(self, yol, no, t, derinlik, baglam):
        y = baglam['yigin_bolum']
        etkin = all(b['etkin'] for b in y)
        belirsiz = any(b.get('belirsiz') for b in y)
        if t.startswith('</'):
            ad = t[2:].rstrip('>').strip().lower()
            if y and y[-1]['ad'] == ad:
                b = y.pop()
                if ad == 'virtualhost' and b.get('vhost') is not None:
                    baglam['vhost'] = None
            return
        if t.startswith('<'):
            govde = self.genislet(t[1:].rstrip('>').strip())
            p = bol(govde)
            ad = p[0].lower() if p else ''
            arg = ' '.join(p[1:]) if len(p) > 1 else ''
            b = {'ad': ad, 'etkin': True}
            if ad == 'ifmodule':
                olumsuz = arg.startswith('!')
                mod = arg.lstrip('!').strip()
                var = self.modul_var(mod)
                b['etkin'] = (not var) if olumsuz else var
                if len(self.if_kararlari) < LISTE_SINIRI:
                    self.if_kararlari.append({'tur': 'IfModule', 'deger': M(arg, 128), 'sonuc': b['etkin'],
                                              'dosya': M(yol, 400), 'satir': no})
            elif ad == 'ifdefine':
                olumsuz = arg.startswith('!')
                tanim = arg.lstrip('!').strip()
                if tanim in self.tanimlar or tanim in self.degiskenler:
                    var = True
                elif not self.ps_gorunur:
                    # Komut satiri tanimlari (-D) gorulemedi: blok ISLENIR ama belirsiz isaretlenir.
                    var = not olumsuz
                    b['belirsiz'] = True
                else:
                    var = False
                b['etkin'] = (not var) if olumsuz else var
                if len(self.if_kararlari) < LISTE_SINIRI:
                    self.if_kararlari.append({'tur': 'IfDefine', 'deger': M(arg, 128), 'sonuc': b['etkin'],
                                              'belirsiz': bool(b.get('belirsiz')), 'dosya': M(yol, 400), 'satir': no})
            elif ad == 'virtualhost' and etkin:
                if len(self.vhostlar) >= VHOST_SINIRI:
                    self.kesildi = True
                    b['etkin'] = False
                else:
                    v = {'adres': [M(x, 128) for x in p[1:9]], 'server_name': '', 'aliases': [], 'dosya': M(yol, 400),
                         'satir': no, 'belirsiz': belirsiz, 'access_log': [], 'error_log': '', 'document_root': '',
                         'hedefler': [], 'ssl': None, 'jk_mount': [], 'mcmp': False}
                    self.vhostlar.append(v)
                    b['vhost'] = v
                    baglam['vhost'] = v
            elif ad in ('location', 'locationmatch'):
                b['konum'] = self.genislet(arg)
            elif ad == 'proxy' and arg.lower().startswith('balancer://'):
                b['balancer'] = arg[len('balancer://'):].strip('/').lower()
                self.balancer(b['balancer'], yol, no)
            y.append(b)
            return
        if not etkin:
            return
        p = bol(t)
        if not p:
            return
        ad = p[0].lower()
        a = [self.genislet(x) for x in p[1:]]
        v = baglam['vhost']
        hedef_kap = v if v is not None else self.ana
        konum = next((b.get('konum') for b in reversed(y) if b.get('konum')), None)
        bal = next((b.get('balancer') for b in reversed(y) if b.get('balancer')), None)
        if ad == 'define' and a:
            self.degiskenler[a[0]] = a[1] if len(a) > 1 else ''
        elif ad == 'serverroot' and a:
            self.kok = a[0]
        elif ad == 'loadmodule' and len(a) >= 2:
            self.moduller.add(a[0])
            self.moduller.add(os.path.basename(a[1]).replace('.so', '.c'))
        elif ad in ('include', 'includeoptional') and a:
            # httpd: Include'un hedefi yoksa (joker eslesmese de) sunucu BASLAMAZ; IncludeOptional sessiz.
            # Okunamayan hedef (izin) iki turde de OLCULEMEDI'dir: eksik sanilmaz.
            desen = self.yol(a[0])
            if any(c in desen for c in '*?['):
                bulunan = [x for x in esle(desen) if duzenli_mi(x)[0]]
                if not bulunan and ad == 'include':
                    self.hata('EKSIK_INCLUDE', yol, no, a[0])
            elif os.path.isdir(desen):
                bulunan = [x for x in esle(os.path.join(desen, '*')) if duzenli_mi(x)[0]]
            else:
                ok, durum = duzenli_mi(desen)
                bulunan = [desen] if ok else []
                if not ok and durum == 'YOK' and ad == 'include':
                    self.hata('EKSIK_INCLUDE', yol, no, a[0])
                elif not ok and durum != 'YOK':
                    self.hata('INCLUDE_' + (durum or 'HATA'), yol, no, desen)
            for x in bulunan:
                self.dosya_isle(x, derinlik + 1, baglam)
        elif ad == 'listen' and a:
            adres, port = self.adres_port(a[0])
            if len(self.dinle) < LISTE_SINIRI:
                self.dinle.append({'adres': adres, 'port': port, 'dosya': M(yol, 400), 'satir': no})
        elif ad == 'servername' and a:
            hedef_kap['server_name'] = M(a[0], 256)
        elif ad == 'serveralias' and v is not None:
            for x in a:
                if len(v['aliases']) < 100:
                    v['aliases'].append(M(x, 256))
        elif ad in ('customlog', 'transferlog') and a:
            hedef_kap['access_log'].append(M(self.log_yolu(a[0]), 400))
        elif ad == 'errorlog' and a:
            hedef_kap['error_log'] = M(self.log_yolu(a[0]), 400)
        elif ad == 'documentroot' and a and v is not None:
            v['document_root'] = M(a[0], 400)
        elif ad in ('sslcertificatefile',) and a and v is not None:
            y2 = self.yol(a[0])
            v['ssl'] = {'sertifika': M(y2, 400), 'var': var_mi(y2)}
        elif ad == 'proxypass' or ad == 'proxypassmatch':
            if konum is not None and len(a) >= 1 and not a[0].startswith('/'):
                yolu, url = konum, a[0]
            elif len(a) >= 2:
                yolu, url = a[0], a[1]
            else:
                return
            if url == '!':
                return
            self.hedef_ekle(hedef_kap, 'proxy' if ad == 'proxypass' else 'proxymatch', url, yolu, yol, no)
        elif ad == 'balancermember' and a:
            ad_b = bal
            url = a[0]
            if not ad_b and len(a) >= 2 and a[0].lower().startswith('balancer://'):
                ad_b, url = a[0][len('balancer://'):].strip('/').lower(), a[1]
            if ad_b:
                sema, host, port = url_coz(url)
                b2 = self.balancer(ad_b, yol, no)
                if len(b2['uyeler']) < HEDEF_SINIRI:
                    b2['uyeler'].append({'url': M(url, 300), 'sema': sema, 'host': M(host, 256), 'port': port})
        elif ad == 'rewriterule' and len(a) >= 3:
            bayrak = a[2].strip('[]').lower().split(',')
            if 'p' in bayrak or 'proxy' in bayrak:
                self.hedef_ekle(hedef_kap, 'rewrite', a[1], a[0], yol, no)
        elif ad == 'jkworkersfile' and a:
            self.jk_workers = self.yol(a[0])
        elif ad == 'jklogfile' and a:
            self.jk_log = self.log_yolu(a[0])
        elif ad == 'jkmount' and a:
            yolu = a[0] if len(a) >= 2 else (konum or '')
            worker = a[1] if len(a) >= 2 else a[0]
            kayit = {'yol': M(yolu, 300), 'worker': M(worker, 128), 'dosya': M(yol, 400), 'satir': no}
            hedef = v['jk_mount'] if v is not None else self.jk_mount_global
            if len(hedef) < HEDEF_SINIRI:
                hedef.append(kayit)
        elif ad == 'jkmountfile' and a:
            self.jk_mount_dosyasi(self.yol(a[0]), v, yol, no)
        elif ad == 'webspherepluginconfig' and a:
            self.was_config = self.yol(a[0])
        elif ad in MC_YONERGELERI and (a or ad == 'enablemcpmreceive'):
            # EnableMCPMReceive argumansiz yazilir (2.4); eski surumlerde 'On'.
            self.mc[ad] = M(' '.join(a) or 'On', 200)
            if ad == 'enablemcpmreceive' and v is not None:
                v['mcmp'] = True
                self.mc_dinleyen.append({'adres': v['adres'], 'dosya': M(yol, 400), 'satir': no})

    def log_yolu(self, d):
        """Log hedefi -> mutlak yol. Boru (|rotatelogs <yol> ...) ise '|<mutlak yol>'; syslog oldugu gibi."""
        d = d.strip()
        if d.startswith('syslog'):
            return d
        if d.startswith('|'):
            parca = [x for x in bol(d.lstrip('|').strip())[1:] if not x.startswith('-') and not x.isdigit()
                     and ('/' in x or 'log' in x.lower())]
            return '|' + self.yol(parca[0]) if parca else d
        return self.yol(d)

    def adres_port(self, s):
        s = s.strip()
        m = re.match(r'^\[([^\]]+)\]:(\d+)$', s) or re.match(r'^([^:]+):(\d+)$', s)
        if m:
            return M(m.group(1), 128), int(m.group(2))
        if s.isdigit():
            return '*', int(s)
        return M(s, 128), None

    def balancer(self, ad, dosya, satir):
        if ad not in self.balancerlar:
            self.balancerlar[ad] = {'ad': M(ad, 128), 'uyeler': [], 'dosya': M(dosya, 400), 'satir': satir}
        return self.balancerlar[ad]

    def hedef_ekle(self, kap, tur, url, yolu, dosya, satir):
        if len(kap['hedefler']) >= HEDEF_SINIRI:
            self.kesildi = True
            return
        sema, host, port = url_coz(url)
        kap['hedefler'].append({'tur': tur, 'yol': M(yolu, 300), 'url': M(re.sub(r'//[^/@]*@', '//', url), 300),
                                'sema': sema, 'host': M(host, 256), 'port': port,
                                'dosya': M(dosya, 400), 'satir': satir})

    def jk_mount_dosyasi(self, yol, v, kaynak, satir):
        veri, durum = oku(yol, CONF_SINIR)
        if veri is None:
            self.hata('JK_MOUNT_DOSYASI_' + durum, kaynak, satir, yol)
            return
        hedef = v['jk_mount'] if v is not None else self.jk_mount_global
        for no, s in enumerate(metin(veri).split('\n'), 1):
            t = s.strip()
            if not t or t.startswith('#') or '=' not in t:
                continue
            yolu, worker = t.split('=', 1)
            yolu = yolu.strip().lstrip('-').lstrip('|')
            if yolu.startswith('!'):
                continue
            if len(hedef) < HEDEF_SINIRI:
                hedef.append({'yol': M(yolu, 300), 'worker': M(worker.strip(), 128), 'dosya': M(yol, 400), 'satir': no})

    def cozumle(self):
        baglam = {'yigin': [], 'yigin_bolum': [], 'vhost': None}
        self.dosya_isle(self.conf, 0, baglam)


def workers_oku(yol):
    """workers.properties -> {durum, workerlar: [{ad, tur, host, port, uyeler}]}."""
    veri, durum = oku(yol, CONF_SINIR)
    if veri is None:
        return {'yol': M(yol, 400), 'durum': durum, 'workerlar': []}
    ozellik = {}
    for s in metin(veri).split('\n'):
        t = s.strip()
        if not t or t.startswith('#') or '=' not in t:
            continue
        k, deger = t.split('=', 1)
        ozellik[k.strip()] = deger.strip()
    liste = [x.strip() for x in ozellik.get('worker.list', '').split(',') if x.strip()]
    adlar = set(liste)
    for k in ozellik:
        m = re.match(r'^worker\.([^.]+)\.', k)
        if m:
            adlar.add(m.group(1))
    out = []
    for ad in sorted(adlar)[:LISTE_SINIRI]:
        g = lambda alan: ozellik.get('worker.%s.%s' % (ad, alan), '')
        ref = g('reference')
        if ref.startswith('worker.'):
            r = ref[len('worker.'):]
            g2 = g
            g = lambda alan, r=r, g2=g2: g2(alan) or ozellik.get('worker.%s.%s' % (r, alan), '')
        uyeler = [x.strip() for x in (g('balance_workers') or g('balanced_workers')).split(',') if x.strip()]
        try:
            port = int(g('port')) if g('port') else None
        except ValueError:
            port = None
        out.append({'ad': M(ad, 128), 'tur': M(g('type') or ('lb' if uyeler else ''), 16), 'host': M(g('host'), 256),
                    'port': port, 'uyeler': [M(x, 128) for x in uyeler[:HEDEF_SINIRI]], 'listede': ad in liste})
    return {'yol': M(yol, 400), 'durum': 'OKUNDU', 'workerlar': out}


def yerel(etiket):
    return etiket.rsplit('}', 1)[-1] if isinstance(etiket, str) else ''


def was_oku(yol):
    """plugin-cfg.xml -> ServerCluster / Server / Transport, UriGroup, VirtualHostGroup, Route, Log."""
    kok, durum = xml_oku(yol)
    out = {'yol': M(yol, 400), 'durum': durum, 'clusterlar': [], 'urigruplari': {}, 'vhostgruplari': {},
           'rotalar': [], 'log': ''}
    if kok is None:
        return out
    for e in kok.iter():
        t = yerel(e.tag)
        if t == 'Log' and e.get('Name'):
            out['log'] = M(e.get('Name'), 400)
        elif t == 'ServerCluster' and len(out['clusterlar']) < LISTE_SINIRI:
            sunucular = []
            for s in e.iter():
                if yerel(s.tag) != 'Server':
                    continue
                for tr in s.iter():
                    if yerel(tr.tag) == 'Transport' and len(sunucular) < HEDEF_SINIRI:
                        try:
                            port = int(tr.get('Port') or '')
                        except ValueError:
                            port = None
                        sunucular.append({'ad': M(s.get('Name'), 256), 'host': M(tr.get('Hostname'), 256),
                                          'port': port, 'protokol': M(tr.get('Protocol'), 16)})
            out['clusterlar'].append({'ad': M(e.get('Name'), 256), 'sunucular': sunucular})
        elif t == 'UriGroup':
            out['urigruplari'][M(e.get('Name'), 256)] = [M(u.get('Name'), 300) for u in e
                                                        if yerel(u.tag) == 'Uri'][:HEDEF_SINIRI]
        elif t == 'VirtualHostGroup':
            out['vhostgruplari'][M(e.get('Name'), 256)] = [M(u.get('Name'), 300) for u in e
                                                          if yerel(u.tag) == 'VirtualHost'][:HEDEF_SINIRI]
        elif t == 'Route' and len(out['rotalar']) < LISTE_SINIRI:
            out['rotalar'].append({'cluster': M(e.get('ServerCluster'), 256), 'urigroup': M(e.get('UriGroup'), 256),
                                   'vhostgroup': M(e.get('VirtualHostGroup'), 256)})
    return out


# ── LOG OKUMA ────────────────────────────────────────────────────────────────────────────────────

ACCESS_ZAMAN = re.compile(r'\[(\d{2})/(\w{3})/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})\]')
ACCESS_ISTEK = re.compile(r'"([A-Z]{3,10}) (\S+)[^"]*" (\d{3}) ')
ERROR_ZAMAN = re.compile(r'\[\w{3} (\w{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)? (\d{4})\]')
# Arka uca baglanamama: grup 1 hedef host, grup 2 (varsa) port. Ornekler (Apache 2.4 / mod_jk / WAS eklentisi):
#   AH00957: AJP: attempt to connect to 10.1.1.1:8009 (10.1.1.1) failed
#   AH01114: HTTP: failed to make connection to backend: app01
#   AH00959: ap_proxy_connect_backend disabling worker for (app01:8080) for 60s
#   (worker1) Failed opening socket to (10.1.1.1:8009) (errno=111)
#   ws_common: websphereGetStream: Failed to connect to app server on host 'was01'
ARKA_UC = [
    ('proxy', re.compile(r'AH00957: \w+: attempt to connect to ([\w.-]+|\[[0-9a-f:]+\]):(\d+)', re.I)),
    ('proxy', re.compile(r'AH01114: \w+: failed to make connection to backend: ([\w.-]+)(?::(\d+))?', re.I)),
    ('proxy', re.compile(r'AH00959: ap_proxy_connect_backend disabling worker for \(([\w.-]+)(?::(\d+))?\)', re.I)),
    ('jk', re.compile(r'Failed opening socket to \(([\w.-]+|\[[0-9a-f:]+\]):(\d+)\)', re.I)),
    ('was', re.compile(r'Failed to connect to app server on host \'([^\']+)\'()', re.I)),
]


def log_dosyalari(desen):
    """CustomLog yolu -> pencereye giren dosyalar (yeniden eskiye). Boru (|rotatelogs) desenini cozer."""
    p = desen.strip()
    if p.startswith('|'):
        p = p[1:].strip()
        if not p.startswith('/') or ' ' in p:
            return None
    if '%' in p:
        p = re.sub(r'%[A-Za-z]', '*', p)
    adaylar = set(esle(p)) | set(esle(p + '*'))
    out = []
    sinir = SIMDI - (GUN + 1) * 86400
    for x in adaylar:
        ok, _ = duzenli_mi(x)
        if not ok:
            continue
        try:
            st = os.stat(x)
        except OSError:
            continue
        if st.st_mtime >= sinir:
            out.append((st.st_mtime, x, st.st_size))
    out.sort(reverse=True)
    return out


def satirlar_of(yol, butce):
    """Dosyanin satirlari (gz destekli); butce asilirsa yalniz SON kisim okunur. (satirlar, okunan, kesik)."""
    try:
        fd = os.open(yol, os.O_RDONLY)
    except OSError as e:
        return None, 0, str(e.__class__.__name__)
    with os.fdopen(fd, 'rb') as akis:
        if yol.endswith('.gz'):
            try:
                g = gzip.GzipFile(fileobj=akis, mode='rb')
                veri = g.read(butce + 1)
            except (OSError, EOFError, zlib.error):
                return None, 0, 'GZ_BOZUK'
            kesik = len(veri) > butce
            return metin(veri[:butce]).split('\n'), min(len(veri), butce), kesik
        try:
            boy = os.fstat(fd).st_size
        except OSError:
            boy = 0
        kesik = boy > butce
        if kesik:
            akis.seek(boy - butce)
        veri = akis.read(butce)
        satirlar = metin(veri).split('\n')
        if kesik and satirlar:
            satirlar = satirlar[1:]
        return satirlar, len(veri), kesik


def access_zamani(m):
    gun, ay, yil, sa, dk, sn, isaret, zs, zd = m.groups()
    a = AYLAR.get(ay.lower())
    if not a:
        return None
    t = calendar.timegm((int(yil), a, int(gun), int(sa), int(dk), int(sn)))
    fark = (int(zs) * 3600 + int(zd) * 60) * (1 if isaret == '+' else -1)
    return t - fark


def sinif_of(yolu):
    y = yolu.split('?', 1)[0].split('#', 1)[0]
    ad = y.rstrip('/').rsplit('/', 1)[-1].lower()
    if ad in HC_ADLARI:
        return 'hc'
    nokta = ad.rfind('.')
    if nokta > 0 and ad[nokta:] in STATIK_UZANTI:
        return 'statik'
    return 'gercek'


def access_ozeti(desen, onbellek):
    """Bir access log deseni icin pencere ozeti; ayni desen birden cok vhost'ta ise bir kez okunur."""
    if desen in onbellek:
        return onbellek[desen]
    dosyalar = log_dosyalari(desen)
    oz = {'desen': M(desen, 400), 'durum': 'OLCULDU', 'neden': '', 'dosyalar': [], 'pencere_gun': GUN,
          'kapsama_bas': None, 'son_satir': None, 'gercek_24s': 0, 'gercek_7g': 0, 'hc_24s': 0, 'hc_7g': 0,
          'statik_7g': 0, 'durum_sinif': {'2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0}, 'istemci_sayisi': 0,
          'hc_istemcileri': [], 'ilk_istemciler': [], 'son_gercek': None, 'ornek': False,
          'ayristirilamayan': 0, 'satir': 0, 'ilk_yollar': []}
    onbellek[desen] = oz
    if dosyalar is None:
        oz['durum'], oz['neden'] = 'OLCULEMEDI', 'boru hedefinde log yolu bulunamadi'
        return oz
    if not dosyalar:
        oz['durum'], oz['neden'] = 'OLCULEMEDI', 'pencerede log dosyasi yok ya da okunamadi'
        return oz
    istemci, hc_ist, yollar = {}, {}, {}
    pencere_bas = SIMDI - GUN * 86400
    gun_bas = SIMDI - 86400
    for mtime, yol, boy in dosyalar:
        if sure_doldu():
            oz['ornek'] = True
            break
        kalan = LOG_BUTCE - DURUM['log_bayt']
        if kalan <= 0:
            oz['ornek'] = True
            break
        satirlar, okunan, kesik = satirlar_of(yol, kalan)
        DURUM['log_bayt'] += okunan
        if satirlar is None:
            oz['dosyalar'].append({'yol': M(yol, 400), 'durum': M(kesik, 32)})
            oz['ornek'] = True
            continue
        if kesik:
            oz['ornek'] = True
        oz['dosyalar'].append({'yol': M(yol, 400), 'durum': 'KESIK' if kesik else 'OKUNDU', 'bayt': okunan})
        en_eski = None
        for i, s in enumerate(satirlar):
            if not s:
                continue
            if i % 20000 == 0 and sure_doldu():
                oz['ornek'] = True
                break
            oz['satir'] += 1
            mz = ACCESS_ZAMAN.search(s)
            mi = ACCESS_ISTEK.search(s)
            t = access_zamani(mz) if mz else None
            if t is None or not mi:
                oz['ayristirilamayan'] += 1
                continue
            if en_eski is None or t < en_eski:
                en_eski = t
            if oz['son_satir'] is None or t > oz['son_satir']:
                oz['son_satir'] = t
            if t < pencere_bas or t > SIMDI + 3600:
                continue
            sinif = sinif_of(mi.group(2))
            ip = s.split(' ', 1)[0][:64]
            if sinif == 'hc':
                oz['hc_7g'] += 1
                if t >= gun_bas:
                    oz['hc_24s'] += 1
                hc_ist[ip] = hc_ist.get(ip, 0) + 1
            elif sinif == 'statik':
                oz['statik_7g'] += 1
            else:
                oz['gercek_7g'] += 1
                if t >= gun_bas:
                    oz['gercek_24s'] += 1
                if oz['son_gercek'] is None or t > oz['son_gercek']:
                    oz['son_gercek'] = t
                d = mi.group(3)[0] + 'xx'
                if d in oz['durum_sinif']:
                    oz['durum_sinif'][d] += 1
                if len(istemci) < 100000:
                    istemci[ip] = istemci.get(ip, 0) + 1
                seg = '/' + mi.group(2).split('?', 1)[0].lstrip('/').split('/', 1)[0][:80]
                if len(yollar) < 5000:
                    yollar[seg] = yollar.get(seg, 0) + 1
        if en_eski is not None and (oz['kapsama_bas'] is None or en_eski < oz['kapsama_bas']):
            oz['kapsama_bas'] = en_eski
        if oz['kapsama_bas'] is not None and oz['kapsama_bas'] <= pencere_bas and not kesik:
            break
    sirala = lambda d: [{'ip': k, 'n': n} for k, n in sorted(d.items(), key=lambda x: (-x[1], x[0]))[:5]]
    oz['istemci_sayisi'] = len(istemci)
    oz['ilk_istemciler'] = sirala(istemci)
    oz['hc_istemcileri'] = sirala(hc_ist)
    oz['ilk_yollar'] = [{'yol': k, 'n': n} for k, n in sorted(yollar.items(), key=lambda x: (-x[1], x[0]))[:5]]
    if oz['satir'] and oz['ayristirilamayan'] > oz['satir'] // 2:
        oz['durum'], oz['neden'] = 'OLCULEMEDI', 'satirlarin yarisindan fazlasi ayristirilamadi (LogFormat farkli)'
    elif oz['kapsama_bas'] is None:
        oz['durum'], oz['neden'] = ('BOS', 'log dosyasi bos') if not oz['satir'] else ('OLCULEMEDI', 'zaman damgasi yok')
    elif oz['ornek'] or oz['kapsama_bas'] > pencere_bas:
        oz['durum'] = 'KISMI'
        oz['neden'] = 'butce / sure siniri' if oz['ornek'] else 'log penceresi %d gunden kisa' % GUN
    return oz


def error_ozeti(yollar):
    """error_log / JkLogFile / WAS eklenti logu: pencere icindeki arka uca baglanamama sayilari."""
    out = []
    for kaynak_yol in yollar:
        if kaynak_yol and kaynak_yol.startswith('|'):
            kaynak_yol = kaynak_yol[1:].strip() if kaynak_yol[1:].strip().startswith('/') else ''
        if not kaynak_yol or kaynak_yol.startswith('syslog') or ' ' in kaynak_yol:
            continue
        kayit = {'yol': M(kaynak_yol, 400), 'durum': 'OKUNDU', 'hatalar': []}
        out.append(kayit)
        satirlar, okunan, kesik = satirlar_of(kaynak_yol, ERROR_LOG_BAYT)
        if satirlar is None:
            kayit['durum'] = M(kesik or 'OKUNAMADI', 32)
            continue
        if kesik:
            kayit['durum'] = 'KESIK'
        sayac = {}
        for s in satirlar:
            mz = ERROR_ZAMAN.search(s)
            if mz:
                a = AYLAR.get(mz.group(1).lower())
                if not a:
                    continue
                t = calendar.timegm((int(mz.group(6)), a, int(mz.group(2)), int(mz.group(3)),
                                     int(mz.group(4)), int(mz.group(5))))
                if t < SIMDI - GUN * 86400:
                    continue
            else:
                continue
            for tur, desen in ARKA_UC:
                m = desen.search(s)
                if m:
                    hedef = m.group(1).strip('[]') + (':' + m.group(2) if m.group(2) else '')
                    k = (tur, hedef[:300])
                    e = sayac.get(k)
                    sayac[k] = (e[0] + 1, max(e[1], t)) if e else (1, t)
                    break
        kayit['hatalar'] = [{'tur': k[0], 'hedef': k[1], 'n': n, 'son': son}
                            for k, (n, son) in sorted(sayac.items(), key=lambda x: -x[1][0])[:LISTE_SINIRI]]
    return out


# ── SOKETLER VE IP'LER ───────────────────────────────────────────────────────────────────────────

def hex_ip(h):
    if len(h) == 8:
        return socket.inet_ntop(socket.AF_INET, bytes.fromhex(h)[::-1])
    b = bytes.fromhex(h)
    return socket.inet_ntop(socket.AF_INET6, b''.join(b[i:i + 4][::-1] for i in range(0, 16, 4)))


def soketler():
    """LISTEN soketleri /proc/net/tcp{,6}'dan: [{adres, port, aile}]. Surec eslemesi YOK (yetki ister)."""
    out, okundu, durum = [], False, 'OLCULDU'
    for ad, aile in (('tcp', 4), ('tcp6', 6)):
        veri, d = oku(os.path.join(PROC, 'net', ad), 64 * 1024 * 1024)
        if veri is None:
            continue
        okundu = True
        for s in metin(veri).split('\n')[1:]:
            p = s.split()
            if len(p) < 4 or p[3] != '0A':
                continue
            try:
                h, port = p[1].split(':')
                adres = hex_ip(h)
            except (ValueError, OSError):
                continue
            k = {'adres': adres, 'port': int(port, 16), 'aile': aile}
            if k not in out and len(out) < LISTE_SINIRI:
                out.append(k)
    if not okundu:
        durum = 'OLCULEMEDI'
    return {'durum': durum, 'dinlenen': out}


def ipler():
    """Sunucunun IP'leri 'ip -o addr show' ile: [{ip, onek, iface, aile}]."""
    ham = None
    if IP_DOSYA:
        veri, d = oku(IP_DOSYA, 4 * 1024 * 1024)
        ham = metin(veri) if veri is not None else None
    else:
        ikili = next((x for x in IP_ADAYLARI if duzenli_mi(x)[0]), None)
        if ikili:
            try:
                ham = subprocess.check_output([ikili, '-o', 'addr', 'show'], stderr=subprocess.DEVNULL,
                                              timeout=10).decode('utf-8', 'replace')
            except (OSError, subprocess.SubprocessError):
                ham = None
    if ham is None:
        return {'durum': 'OLCULEMEDI', 'liste': []}
    out = []
    for s in ham.split('\n'):
        m = re.match(r'^\d+:\s+(\S+)\s+(inet6?)\s+([0-9a-fA-F.:]+)/(\d+)', s)
        if m and len(out) < LISTE_SINIRI:
            out.append({'ip': m.group(3), 'onek': int(m.group(4)), 'iface': M(m.group(1), 32),
                        'aile': 6 if m.group(2) == 'inet6' else 4})
    return {'durum': 'OLCULDU', 'liste': out}


# ── ANA AKIS ─────────────────────────────────────────────────────────────────────────────────────

def kurulumlari_bul():
    procs, gorunur = surecler()
    adaylar = {}
    for p in procs:
        kok = p['kok'] or kok_tahmini(p['argv0'])
        conf = p['conf'] or 'conf/httpd.conf'
        conf = conf if conf.startswith('/') else os.path.normpath(os.path.join(kok, conf))
        k = (kok, conf)
        if k not in adaylar:
            adaylar[k] = {'kok': kok, 'conf': conf, 'urun': urun_of(p['argv0'], kok, conf), 'kaynak': 'ps',
                          'surec': 0, 'tanimlar': set()}
        adaylar[k]['surec'] += 1
        adaylar[k]['tanimlar'].update(p['tanimlar'])
    for kok in KOKLER:
        conf = os.path.join(kok, 'conf', 'httpd.conf')
        if any(a['conf'] == conf or a['kok'] == kok for a in adaylar.values()):
            continue
        if duzenli_mi(conf)[0] or var_mi(conf) is None:
            adaylar[(kok, conf)] = {'kok': kok, 'conf': conf, 'urun': urun_of(kok, conf), 'kaynak': 'aday',
                                    'surec': 0, 'tanimlar': set()}
    return list(adaylar.values()), gorunur


def kurulum_tara(a, gorunur, log_onbellek):
    k = Kurulum(a['kok'], a['conf'], a['urun'], a['kaynak'], a['tanimlar'], gorunur)
    k.cozumle()
    jk = workers_oku(k.jk_workers) if k.jk_workers else None
    was = was_oku(k.was_config) if k.was_config else None
    mc_yuklu = any(x in k.moduller for x in ('manager_module', 'proxy_cluster_module', 'mod_manager.c',
                                              'mod_proxy_cluster.c', 'cluster_slotmem_module'))
    # Hedef turunu netlestir: tanimsiz balancer + mod_cluster yuklu -> dinamik (mc); jk worker -> host:port.
    for v in k.vhostlar + [k.ana]:
        for h in v['hedefler']:
            if h['sema'] == 'balancer':
                b = k.balancerlar.get(h['host'])
                h['balancer_tanimli'] = b is not None
                if b is None and mc_yuklu:
                    h['tur'] = 'mc'
    ana_log = k.ana['access_log']
    paylasim = {}
    for v in k.vhostlar:
        for d in (v['access_log'] or ana_log):
            paylasim[d] = paylasim.get(d, 0) + 1
    vhostlar = []
    for v in k.vhostlar:
        miras = not v['access_log']
        loglar = []
        for d in (v['access_log'] or ana_log):
            oz = access_ozeti(d, log_onbellek)
            loglar.append(dict(oz, paylasilan=paylasim.get(d, 0) > 1 or miras, miras=miras))
        v2 = dict(v)
        v2['loglar'] = loglar
        del v2['access_log']
        vhostlar.append(v2)
    error_yollari = [v['error_log'] for v in k.vhostlar if v['error_log']] + [k.ana['error_log']]
    error_yollari = [x for x in error_yollari if x]
    if k.jk_log:
        error_yollari.append(k.jk_log)
    if was and was.get('log'):
        error_yollari.append(was['log'])
    calisiyor = (a['surec'] > 0) if gorunur else (True if a['surec'] > 0 else None)
    return {
        'kok': M(k.kok, 400), 'conf': M(k.conf, 400), 'urun': k.urun, 'kaynak': k.kaynak,
        'calisiyor': calisiyor, 'surec_sayisi': a['surec'], 'tanimlar': sorted(k.tanimlar)[:50],
        'moduller': sorted(k.moduller)[:300], 'dosyalar': k.dosyalar, 'hatalar': k.hatalar,
        'if_kararlari': k.if_kararlari, 'dinle': k.dinle, 'vhostlar': vhostlar,
        'ana': {'server_name': k.ana['server_name'], 'hedefler': k.ana['hedefler'],
                'access_log': ana_log, 'error_log': k.ana['error_log']},
        'balancerlar': sorted(k.balancerlar.values(), key=lambda b: b['ad']),
        'jk': {'workers': jk, 'mount_global': k.jk_mount_global, 'log': M(k.jk_log, 400)},
        'mod_cluster': {'yuklu': mc_yuklu, 'yonergeler': k.mc, 'mcmp_vhostlari': k.mc_dinleyen},
        'was': was, 'error_loglari': error_ozeti(sorted(set(error_yollari))),
        'kesildi': k.kesildi,
    }


def tara():
    kurulumlar, gorunur = kurulumlari_bul()
    yuk = {'sema': 1, 'surum': SURUM, 'host': socket.gethostname().split('.')[0].upper()[:64],
           'baslangic_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(SIMDI)),
           'python': '%d.%d.%d' % sys.version_info[:3], 'uid': os.getuid(), 'ps_gorunur': gorunur,
           'hc_adlari': sorted(HC_ADLARI), 'pencere_gun': GUN, 'kurulumlar': [], 'durum': 'TAM'}
    log_onbellek = {}
    for a in kurulumlar[:8]:
        if sure_doldu():
            break
        yuk['kurulumlar'].append(kurulum_tara(a, gorunur, log_onbellek))
    yuk['soketler'] = soketler()
    yuk['ipler'] = ipler()
    yuk['log_bayt'] = DURUM['log_bayt']
    yuk['sure_sn'] = round(time.monotonic() - BASLANGIC, 2)
    if not kurulumlar:
        yuk['durum'] = 'WEB_YOK' if gorunur else 'OLCULEMEDI'
    elif DURUM['zaman_doldu']:
        yuk['durum'] = 'ZAMAN_ASIMI'
    elif len(kurulumlar) > 8 or any(k['kesildi'] for k in yuk['kurulumlar']):
        yuk['durum'] = 'KISMI'
    yuk['uyarilar'] = DURUM['uyarilar']
    return yuk


def main():
    yuk = tara()
    ham = json.dumps(yuk, ensure_ascii=False, separators=(',', ':')).encode('utf-8', 'surrogateescape')
    kod = base64.b64encode(zlib.compress(ham, 6)).decode('ascii')
    satirlar = [kod[i:i + 4000] for i in range(0, len(kod), 4000)]
    sys.stdout.write(BASLA + '\n' + '\n'.join(satirlar) + '\n' + BITTI + '\n')


if __name__ == '__main__':
    main()
