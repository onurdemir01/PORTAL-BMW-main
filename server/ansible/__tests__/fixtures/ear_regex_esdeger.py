# server/ansible/__tests__/fixtures/ear_regex_esdeger.py - Sonar S8786 esdegerlik kaniti (Python).
#
# ear_tara.py / web_tara.py hedefte Python 3.6+ ile kosar; dogrusal yazilan uc desen (JVM_KULLANICI_RE,
# JAR_RE, ACCESS_ISTEK) eskisiyle AYNI sonucu vermeli. Bu betik modulleri DOSYADAN yukler (yeni desen
# kaynaktaki desendir), eski deseni yalniz referans olarak tutar ve:
#   - jvm_maskele / jar_ayir islevlerini yeni modul ile eski desenli kopya arasinda karsilastirir;
#   - ACCESS_ISTEK.search sonucunu (gruplar + aralik) eski desenle karsilastirir;
#   - yeni desenleri kotu girdide (50k+ karakter) olcer.
# Kullanim: python3 -I -B ear_regex_esdeger.py <ear_tara.py> <web_tara.py>  -> stdout'a tek satir JSON.
import importlib.util
import json
import random
import re
import sys
import time


def yukle(ad, yol):
    spec = importlib.util.spec_from_file_location(ad, yol)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


EAR = yukle('ear_tara_yeni', sys.argv[1])
EAR_ESKI = yukle('ear_tara_eski', sys.argv[1])
WEB = yukle('web_tara_yeni', sys.argv[2])

# Referans: eski desenler (yalniz burada yasar).
EAR_ESKI.JVM_KULLANICI_RE = re.compile(r'([A-Za-z0-9_$#.-]+/)[^@/ "]+@')
EAR_ESKI.JAR_RE = re.compile(r'^(.+?)-(\d[^/]*)\.jar$', re.I)
ESKI_ACCESS = re.compile(r'"([A-Z]{3,10}) (\S+)[^"]*" (\d{3}) ')

R = random.Random(20261115)
ORTAK = ['', ' ', '\t \n', '\r\n', '\xa0\u2028\u3000', 'çğıİöşüÇĞÖŞÜ', 'İstanbul/şube@x']


def uret(tokenlar, adet, maks=24):
    out = list(ORTAK)
    for _ in range(adet):
        out.append(''.join(R.choice(tokenlar) for _ in range(R.randint(0, maks))))
    for t in tokenlar[:4]:
        out.append(t * 1000)
    return out


def karsilastir(ad, girdiler, eski, yeni, anlamli):
    eslesen = 0
    for s in girdiler:
        o, y = eski(s), yeni(s)
        if o != y:
            return {'ad': ad, 'fark': [s, repr(o), repr(y)]}
        if anlamli(s, o):
            eslesen += 1
    return {'ad': ad, 'adet': len(girdiler), 'eslesen': eslesen}


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
    'J1 jvm_maskele', uret(JVM_TOK, 5000), EAR_ESKI.jvm_maskele, EAR.jvm_maskele,
    lambda s, o: '***@' in o))

# J2 jar adi -> (ad, surum): jar_ayir eski desenle ayni.
JAR_TOK = ['a', 'b', '-', '-', '1', '2', '.', '.jar', '.JAR', '.Jar', '/', '\n', 'x', '\u0663', 'ş', 'İ', ' ']


def jar_adi():
    def parca(n):
        return ''.join(R.choice(JAR_TOK) for _ in range(R.randint(0, n)))
    return parca(6) + '-' + R.choice(['1', '2', '\u0663', 'x']) + parca(6) + R.choice(['.jar', '.JAR', '.jar\n', '', '.zip'])


JAR_GIRDI = uret(JAR_TOK, 2500) + [jar_adi() for _ in range(2500)]
sonuc['karsilastirma'].append(karsilastir(
    'J2 jar_ayir', JAR_GIRDI, EAR_ESKI.jar_ayir, EAR.jar_ayir, lambda s, o: o[1] != ''))


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
    'J3 ACCESS_ISTEK', ACCESS_GIRDI, lambda s: mac(ESKI_ACCESS.search(s)), lambda s: mac(WEB.ACCESS_ISTEK.search(s)),
    lambda s, o: o is not None))

# Kotu girdiler: eski desenler bunlarda karesel (her baslangictan sona tarama).
sonuc['sure_ms']['jvm_harf'] = sure(lambda s: EAR.JVM_KULLANICI_RE.sub(r'\1***@', s), 'a' * 100000)
sonuc['sure_ms']['jvm_egik'] = sure(lambda s: EAR.JVM_KULLANICI_RE.sub(r'\1***@', s), 'a/' * 50000)
sonuc['sure_ms']['jar_tire'] = sure(EAR.JAR_RE.match, 'a' + '-1' * 50000)
sonuc['sure_ms']['jar_egik'] = sure(EAR.JAR_RE.match, ('x-1' * 20000) + '/y.jar')
sonuc['sure_ms']['access_acik'] = sure(WEB.ACCESS_ISTEK.search, '"GET ' + 'a' * 100000)
sonuc['sure_ms']['access_tirnak'] = sure(WEB.ACCESS_ISTEK.search, '"GET /' + '"' * 100000)
print(json.dumps(sonuc))
