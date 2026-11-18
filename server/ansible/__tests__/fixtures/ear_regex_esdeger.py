# server/ansible/__tests__/fixtures/ear_regex_esdeger.py - Sonar S8786 esdegerlik kaniti (Python).
#
# ear_tara.py / web_tara.py hedefte Python 3.6+ ile kosar; dogrusal yazilan uc desen (JVM_KULLANICI_RE,
# JAR_RE, ACCESS_ISTEK) eskisiyle AYNI sonucu vermeli. Bu betik modulleri DOSYADAN yukler (desen
# kaynaktaki desendir) ve:
#   - jvm_maskele / jar_ayir / ACCESS_ISTEK.search ciktilarini deterministik ~15 bin girdide uretir;
#   - ciktilarin ozetini (sha256) + adet / eslesen sayisini BEKLENEN ile karsilastirir;
#   - desenleri kotu girdide (50k+ karakter) olcer.
# BEKLENEN 2026-11-18'de ESKI (geri izlemeli) desenlerle ayni girdilerden uretildi; o gun yeni
# desenler ayni ozeti verdi. Eski desenler artik burada YOK: bu dosya kurumsal Sonar'da kaynak kod
# sayilir ve geri izlemeli desen orada bulgu olurdu (kurumsal is #49). Uretec Python'un random
# modulu DEGIL: kendi splitmix64'u, girdiler her Python surumunde ayni.
# Kullanim: python3 -I -B ear_regex_esdeger.py <ear_tara.py> <web_tara.py>  -> stdout'a tek satir JSON.
import hashlib
import importlib.util
import json
import sys
import time


def yukle(ad, yol):
    spec = importlib.util.spec_from_file_location(ad, yol)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


EAR = yukle('ear_tara', sys.argv[1])
WEB = yukle('web_tara', sys.argv[2])

M64 = 0xFFFFFFFFFFFFFFFF


class Uretec(object):
    """splitmix64: her Python surumunde ayni dizi (random modulunun choice/randint'i garanti degil)."""

    def __init__(self, tohum):
        self.d = tohum & M64

    def _sonraki(self):
        self.d = (self.d + 0x9E3779B97F4A7C15) & M64
        z = self.d
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & M64
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & M64
        return z ^ (z >> 31)

    def randint(self, a, b):
        return a + self._sonraki() % (b - a + 1)

    def choice(self, dizi):
        return dizi[self._sonraki() % len(dizi)]


R = Uretec(20261115)
ORTAK = ['', ' ', '\t \n', '\r\n', '\xa0\u2028\u3000', 'çğıİöşüÇĞÖŞÜ', 'İstanbul/şube@x']


def uret(tokenlar, adet, maks=24):
    out = list(ORTAK)
    for _ in range(adet):
        out.append(''.join(R.choice(tokenlar) for _ in range(R.randint(0, maks))))
    for t in tokenlar[:4]:
        out.append(t * 1000)
    return out


def ozet(ciktilar):
    metin = '\n'.join(json.dumps(o, ensure_ascii=True, separators=(',', ':')) for o in ciktilar)
    return hashlib.sha256(metin.encode('ascii')).hexdigest()


# Eski desenlerin bu girdilerdeki ciktilari (2026-11-18, yeni desenler de ayni ozeti verdi).
BEKLENEN = {
    'J1 jvm_maskele': {'adet': 5011, 'eslesen': 2917,
        'ozet': 'cc204fd68c0d8eaf693543b106c111ae4c916a4fcaa4e8979c1014c6609f2574'},
    'J2 jar_ayir': {'adet': 5011, 'eslesen': 790,
        'ozet': 'd7f74b93987999afda1736ea941c8f9dab6f8e67d26ca4bfe23e01ee89d15c85'},
    'J3 ACCESS_ISTEK': {'adet': 5008, 'eslesen': 1282,
        'ozet': 'd4161b0d6ac2a1ea0d725b4d9b62babf84d797c78b5e332265be5024ebe3e298'},
}


def karsilastir(ad, girdiler, yeni, anlamli):
    ciktilar = [yeni(s) for s in girdiler]
    eslesen = sum(1 for s, o in zip(girdiler, ciktilar) if anlamli(s, o))
    gercek = {'adet': len(girdiler), 'eslesen': eslesen, 'ozet': ozet(ciktilar)}
    sonuc = {'ad': ad, 'adet': gercek['adet'], 'eslesen': eslesen}
    if gercek != BEKLENEN[ad]:
        sonuc['fark'] = {'beklenen': BEKLENEN[ad], 'gercek': gercek}
    return sonuc


def sure(islev, girdi):
    t0 = time.time()
    islev(girdi)
    return round((time.time() - t0) * 1000, 2)


def mac(m):
    return None if m is None else [m.groups(), m.span()]


sonuc = {'surum': sys.version.split()[0], 'karsilastirma': [], 'sure_ms': {}}

# J1 JVM 'kullanici/parola@' maskesi: jvm_maskele (belirtec belirtec) eski desenle ayni.
JVM_TOK = ['a', 'Z', '0', '_', '$', '#', '.', '-', '/', '/', '@', '@', ' ', '"', 'x:y', '-Dk=', '-Xmx1g',
           'user/pw@', 'jdbc:oracle:thin:u/p@h', '\t', 'ş', 'İ', '\n']
sonuc['karsilastirma'].append(karsilastir(
    'J1 jvm_maskele', uret(JVM_TOK, 5000), EAR.jvm_maskele,
    lambda s, o: '***@' in o))

# J2 jar adi -> (ad, surum): jar_ayir eski desenle ayni.
JAR_TOK = ['a', 'b', '-', '-', '1', '2', '.', '.jar', '.JAR', '.Jar', '/', '\n', 'x', '\u0663', 'ş', 'İ', ' ']


def jar_adi():
    def parca(n):
        return ''.join(R.choice(JAR_TOK) for _ in range(R.randint(0, n)))
    return parca(6) + '-' + R.choice(['1', '2', '\u0663', 'x']) + parca(6) + R.choice(['.jar', '.JAR', '.jar\n', '', '.zip'])


JAR_GIRDI = uret(JAR_TOK, 2500) + [jar_adi() for _ in range(2500)]
sonuc['karsilastirma'].append(karsilastir(
    'J2 jar_ayir', JAR_GIRDI, EAR.jar_ayir, lambda s, o: o[1] != ''))


# J3 access log istek satiri: search sonucu (gruplar + aralik) ayni. Yapili uretim: rastgele token
# dizisi istek kalibini neredeyse hic tutturmaz.
def access_satiri():
    parca = [R.choice(['', '1.2.3.4 - - ', 'x"', '"', '" '])]
    parca.append('"' + R.choice(['GET', 'POST', 'PROPFIND', 'get', 'G', 'VERYLONGMETHOD']) + R.choice([' ', '  ', '\t']))
    parca.append(''.join(R.choice(['/a', '/b?x=1', '"', '\\"', 'ş', '%20', '\xa0']) for _ in range(R.randint(0, 5))))
    parca.append(R.choice(['', ' HTTP/1.1', ' HTTP/1.1 x', '\tHTTP/1.0', ' "q"', '\u3000y']))
    parca.append(R.choice(['" ', '"', '""', '" " ']))
    parca.append(R.choice(['200', '404', '20', '2000', 'abc']))
    parca.append(R.choice([' ', '', '  1234 "-"', ' "GET /c" 500 ']))
    return ''.join(parca)


ACCESS_GIRDI = list(ORTAK) + [access_satiri() for _ in range(5000)] + ['"GET ' + '/a' * 1000 + '" 200 ']
sonuc['karsilastirma'].append(karsilastir(
    'J3 ACCESS_ISTEK', ACCESS_GIRDI, lambda s: mac(WEB.ACCESS_ISTEK.search(s)),
    lambda s, o: o is not None))

# Kotu girdiler: eski (geri izlemeli) desenler bunlarda karesel olurdu.
sonuc['sure_ms']['jvm_harf'] = sure(lambda s: EAR.JVM_KULLANICI_RE.sub(r'\1***@', s), 'a' * 100000)
sonuc['sure_ms']['jvm_egik'] = sure(lambda s: EAR.JVM_KULLANICI_RE.sub(r'\1***@', s), 'a/' * 50000)
sonuc['sure_ms']['jar_tire'] = sure(EAR.JAR_RE.match, 'a' + '-1' * 50000)
sonuc['sure_ms']['jar_egik'] = sure(EAR.JAR_RE.match, ('x-1' * 20000) + '/y.jar')
sonuc['sure_ms']['access_acik'] = sure(WEB.ACCESS_ISTEK.search, '"GET ' + 'a' * 100000)
sonuc['sure_ms']['access_tirnak'] = sure(WEB.ACCESS_ISTEK.search, '"GET /' + '"' * 100000)
print(json.dumps(sonuc))
