// server/ansible/__tests__/ear-envanter-tarayici.test.cjs — Server Hub > Uygulama Envanteri tarayicisi.
//
// files/ear_tara.py GERCEK python3 ile gecici agaclarda kosar (hedefteki gibi `python3 -B -`,
// betik STDIN'den). Olculenler:
//   ET1  pilot ornegi: Spring Boot / Framework surumu, JSP / TLD / JAR sayilari, bos tld dizini,
//        web.<ortam>.xml varyantlari; surum metni OZGUN harflerle (3.1.5.RELEASE)
//   ET2  acilmis EAR icindeki PAKETLI .war: merkez dizinden listelenir, WAR sayilir
//   ET3  .ear ARSIVI: OZET'te ic WAR acilmaz -> ARSIV_ACILMADI, host KISMI; TAM'da acilir -> TAM
//   ET4  giris siniri: uygulama + WAR KISMI_SINIR, host KISMI (kesik tarama ASLA TAM degil);
//        paketli WAR ve dis EAR merkez dizini sinirda kesilirse de KISMI_SINIR
//   ET5  kok yok -> KOK_YOK; tek kok yoksa ve gerisi temizse TAM
//   ET6  izin reddi -> uygulama + WAR KISMI_IZIN, host KISMI
//   ET7  kokteki bag tek adim izlenir (BAG); uygulama icindeki bag/dongu izlenmez; kokun kendisini
//        gosteren bag reddedilir
//   ET8  SALT OKUNUR: tarama oncesi/sonrasi mod, boyut, mtime, inode, ctime, icerik ayni; yeni dosya yok
//   ET9  kaynak: Python 3.6 sozdizimi, Jinja isareti / heredoc sonu / ters tirnak / $( yok,
//        yazan / silen cagri yok
//   ET10 TAM satirlari ve izler: satir sayisi = giris; log degisimi yapi izini bozmaz, sinif ekleme
//        bozar; jar surumu kutuphane izini degistirir
//   ET11 insan kipi Turkce dosya adini kirmadan basar
//   ET12 kaynak AST: modul nitelikleri IZIN listesinde (yasak listesi yeni cagriyi kacirir),
//        zipfile.ZipFile yalniz 'r' kipinde, os.open yalniz os.O_RDONLY, os.fdopen yalniz 'rb',
//        yazma yalniz stdout'a
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { adaylar } = require('./fixtures/python-bul.cjs');

const BETIK = path.join(__dirname, '..', 'bmw_portal', 'ear_envanter', 'files', 'ear_tara.py');
const KAYNAK = fs.readFileSync(BETIK, 'utf8');

function pythonuBul() {
  for (const [komut, on] of adaylar()) {
    if (spawnSync(komut, [...on, '-c', 'import zipfile, zlib'], { stdio: 'ignore' }).status === 0)
      return { komut, on };
  }
  return null;
}
const PY = pythonuBul();
const SKIP = PY ? false : 'python3 bulunamadi - EAR tarayici bekcileri KOSMADI';
const ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

const T = new Date('2026-10-21T17:54:00Z');
function dosya(p, boyut = 64) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const fd = fs.openSync(p, 'w');
  fs.ftruncateSync(fd, boyut); // seyrek
  fs.closeSync(fd);
  fs.utimesSync(p, T, T);
}

/** Python zipfile ile zip yazar (Node'da zip yazici yok; yalniz test fiksturu). */
function zipYaz(hedef, girisler) {
  const kod =
    'import json, os, sys, zipfile\n' +
    'g = json.loads(sys.stdin.read())\n' +
    'with zipfile.ZipFile(g["hedef"], "w") as z:\n' +
    '    for ad, veri in g["girisler"]:\n' +
    '        # veri var olan bir dosya yoluysa icerigi (ic arsiv), degilse metnin kendisi\n' +
    '        z.writestr(ad, open(veri, "rb").read() if os.path.isfile(veri) else veri)\n';
  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  const r = spawnSync(PY.komut, [...PY.on, '-c', kod], {
    input: JSON.stringify({ hedef, girisler }),
  });
  assert.equal(r.status, 0, String(r.stderr));
}

const JARLAR = [
  ['spring-boot-4.0.8.jar', 1372569],
  ['spring-boot-starter-webmvc-4.0.8.jar', 4749],
  ['spring-core-7.0.9.jar', 2035755],
  ['spring-security-core-7.0.7.jar', 617920],
  ['thymeleaf-3.1.5.RELEASE.jar', 945388],
  ['jakarta.servlet-api-6.1.0.jar', 398424],
  ['logback-classic-1.5.18.jar', 306760],
  ['javassist-3.29.0-GA.jar', 794034],
];

function secpanel(kok, { springCore = 'spring-core-7.0.9.jar' } = {}) {
  const w = path.join(kok, 'ORNEKPANEL.ear', 'ORNEKPANEL.war');
  for (const [ad, b] of [
    ['web.xml', 1772],
    ['web.prd.xml', 1500],
    ['web.tst.xml', 1500],
    ['jboss-web.xml', 96],
    ['jboss-deployment-structure.xml', 780],
  ]) {
    dosya(path.join(w, 'WEB-INF', ad), b);
  }
  fs.mkdirSync(path.join(w, 'WEB-INF', 'tld'), { recursive: true }); // ornekteki gibi BOS
  dosya(path.join(w, 'WEB-INF', 'logs', 'uygulama.log'), 5000);
  for (const [ad, b] of JARLAR)
    dosya(path.join(w, 'WEB-INF', 'lib', ad === 'spring-core-7.0.9.jar' ? springCore : ad), b);
  for (const ad of ['toolsIndex.jsp', 'ng2index.jsp', 'error.jsp'])
    dosya(path.join(w, 'WEB-INF', 'jsp', ad), 285);
  dosya(path.join(w, 'WEB-INF', 'jsp', 'error', '404.jsp'), 300);
  dosya(path.join(w, 'WEB-INF', 'classes', 'com', 'ornek', 'AnaKontrol.class'), 4096);
  dosya(path.join(kok, 'ORNEKPANEL.ear', 'META-INF', 'application.xml'), 600);
  return w;
}

function geciciKok(ad) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ear-${ad}-`)));
}

function tara(kokler, ortam = {}) {
  const r = spawnSync(PY.komut, [...PY.on, '-B', '-'], {
    input: KAYNAK,
    env: {
      PATH: process.env.PATH,
      LC_ALL: 'C',
      PYTHONIOENCODING: 'utf-8:surrogateescape',
      EAR_KOKLER: kokler.join(':'),
      ...ortam,
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `tarayici kod ${r.status}: ${String(r.stderr).slice(0, 500)}`);
  const s = String(r.stdout);
  if (ortam.EAR_CIKTI === 'insan') return s;
  const a = s.indexOf('@@EAR_ENVANTER_BASLA@@');
  const b = s.indexOf('@@EAR_ENVANTER_BITTI@@');
  assert.ok(a >= 0 && b > a, `paket isaretleri yok: ${s.slice(0, 200)}`);
  const kod = s.slice(a + '@@EAR_ENVANTER_BASLA@@'.length, b).replace(/\s+/g, '');
  return JSON.parse(zlib.inflateSync(Buffer.from(kod, 'base64')).toString('utf8'));
}

const uyg = (yuk, ad) => yuk.uygulamalar.find((u) => u.ad === ad);
const surumler = (w, ad) => [
  ...new Set(w.kutuphaneler.filter((k) => k[0] === ad).map((k) => k[1])),
];

function goruntu(kok) {
  const out = {};
  const gez = (d) => {
    let liste;
    try {
      liste = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of liste) {
      const p = path.join(d, e.name);
      const st = fs.lstatSync(p, { bigint: true });
      let ozet = '';
      if (e.isFile()) ozet = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      out[path.relative(kok, p)] = [st.mode, st.size, st.mtimeNs, st.ino, st.ctimeNs, ozet]
        .map(String)
        .join('|');
      if (e.isDirectory() && !e.isSymbolicLink()) gez(p);
    }
  };
  gez(kok);
  return out;
}

test(
  'ET1 pilot ornegi: teknoloji, surum (ozgun harf), sayilar, bos tld dizini, web varyantlari',
  { skip: SKIP },
  () => {
    const kok = geciciKok('et1');
    secpanel(path.join(kok, 'vhosting8'));
    const yuk = tara([path.join(kok, 'vhosting'), path.join(kok, 'vhosting8')], {
      EAR_KIP: 'OZET',
    });
    assert.equal(yuk.durum, 'TAM');
    assert.deepEqual(
      yuk.kokler.map((k) => k.durum),
      ['YOK', 'VAR'],
    );
    const u = uyg(yuk, 'ORNEKPANEL.ear');
    assert.equal(u.durum, 'TAM');
    assert.equal(u.bicim, 'ACIK');
    assert.equal(u.application_xml, true);
    assert.equal(u.warlar.length, 1);
    const w = u.warlar[0];
    assert.equal(w.ad, 'ORNEKPANEL.war');
    assert.deepEqual(surumler(w, 'spring-boot'), ['4.0.8']);
    assert.deepEqual(surumler(w, 'spring-core'), ['7.0.9']);
    assert.deepEqual(
      surumler(w, 'thymeleaf'),
      ['3.1.5.RELEASE'],
      'surum metni kucuk harfe cevrilmemeli',
    );
    assert.deepEqual(surumler(w, 'javassist'), ['3.29.0-GA']);
    assert.equal(w.jsp, 4);
    assert.equal(w.tld, 0);
    assert.equal(w.tld_dizini, true, 'bos tld dizini "var" sayilmali');
    assert.equal(w.jar, JARLAR.length);
    assert.equal(w.web_xml, true);
    assert.deepEqual([...w.web_varyantlari].sort(), ['prd', 'tst']);
    assert.equal(w.jboss_web_xml, true);
    assert.equal(w.jboss_deployment_structure, true);
    assert.equal(u.satirlar.length, 0, 'OZET kipte agac satiri olmaz');
    assert.ok(
      w.kutuphaneler.every((k) => typeof k[2] === 'number' && k[2] > 0),
      'kutuphane boyutu OZET kipte de okunur',
    );
  },
);

test(
  'ET2 acilmis EAR icindeki paketli .war merkez dizinden listelenir ve sayilir',
  { skip: SKIP },
  () => {
    const kok = geciciKok('et2');
    zipYaz(path.join(kok, 'vhosting8', 'PAKETLI.ear', 'PAKETLI.war'), [
      ['WEB-INF/web.xml', '<web-app/>'],
      ['WEB-INF/lib/spring-core-5.3.39.jar', 'x'],
      ['WEB-INF/lib/log4j-1.2.17.jar', 'x'],
      ['index.jsp', '<html/>'],
      ['WEB-INF/a.tld', '<t/>'],
    ]);
    const yuk = tara([path.join(kok, 'vhosting8')], { EAR_KIP: 'OZET' });
    const u = uyg(yuk, 'PAKETLI.ear');
    assert.equal(u.durum, 'TAM');
    assert.equal(u.warlar.length, 1, 'paketli WAR sayilmadi (eski paketin hatasi)');
    const w = u.warlar[0];
    assert.equal(w.bicim, 'ARSIV');
    assert.deepEqual(surumler(w, 'spring-core'), ['5.3.39']);
    assert.deepEqual(surumler(w, 'log4j'), ['1.2.17']);
    assert.equal(w.jsp, 1);
    assert.equal(w.tld, 1);
    assert.equal(w.web_xml, true);
  },
);

test('ET3 .ear arsivi: OZET ic WAR acmaz (KISMI), TAM acar (TAM)', { skip: SKIP }, () => {
  const kok = geciciKok('et3');
  const icWar = path.join(kok, 'ic.war');
  zipYaz(icWar, [
    ['WEB-INF/lib/spring-boot-3.3.4.jar', 'x'],
    ['WEB-INF/web.xml', '<w/>'],
  ]);
  zipYaz(path.join(kok, 'vhosting', 'ARSIV.ear'), [
    ['META-INF/application.xml', '<a/>'],
    ['ARSIVWEB.war', icWar],
    ['lib/ortak-2.0.jar', 'x'],
  ]);
  fs.rmSync(icWar);
  const ozet = tara([path.join(kok, 'vhosting')], { EAR_KIP: 'OZET' });
  const uo = uyg(ozet, 'ARSIV.ear');
  assert.equal(uo.bicim, 'ARSIV');
  assert.equal(uo.durum, 'ARSIV_ACILMADI');
  assert.equal(uo.warlar[0].durum, 'ARSIV_ACILMADI');
  assert.equal(ozet.durum, 'KISMI', 'acilmayan arsiv varken host TAM gorunmemeli');
  assert.deepEqual(
    uo.ear_kutuphaneleri.map((k) => k[0]),
    ['ortak'],
  );
  const tam = tara([path.join(kok, 'vhosting')], { EAR_KIP: 'TAM' });
  const ut = uyg(tam, 'ARSIV.ear');
  assert.equal(ut.durum, 'TAM');
  assert.equal(ut.warlar[0].bicim, 'ARSIV_ICINDE');
  assert.deepEqual(surumler(ut.warlar[0], 'spring-boot'), ['3.3.4']);
  assert.equal(tam.durum, 'TAM');
});

test(
  'ET4 giris siniri: uygulama ve WAR KISMI_SINIR, host KISMI (kesik tarama TAM degil)',
  { skip: SKIP },
  () => {
    const kok = geciciKok('et4');
    for (let i = 0; i < 300; i++)
      dosya(
        path.join(
          kok,
          'vhosting',
          'BUYUK.ear',
          'BUYUK.war',
          'WEB-INF',
          'classes',
          `p${i % 10}`,
          `C${i}.class`,
        ),
        10,
      );
    secpanel(path.join(kok, 'vhosting'));
    const yuk = tara([path.join(kok, 'vhosting')], { EAR_KIP: 'OZET', EAR_SINIR_UYGULAMA: '100' });
    const u = uyg(yuk, 'BUYUK.ear');
    assert.equal(u.durum, 'KISMI_SINIR');
    assert.equal(u.warlar[0].durum, 'KISMI_SINIR', 'sinira takilan WAR TAM gorunmemeli');
    assert.ok(u.giris <= 100);
    assert.equal(
      uyg(yuk, 'ORNEKPANEL.ear').durum,
      'TAM',
      'sinir uygulama basina; komsu uygulama etkilenmez',
    );
    assert.equal(yuk.durum, 'KISMI', 'eksik uygulama varken host TAM gorunmemeli');

    // Paketli WAR ayni kurala uyar: merkez dizin sinirda kesilirse WAR TAM kalmaz.
    zipYaz(
      path.join(kok, 'vhosting8', 'PAKETBUYUK.ear', 'PAKETBUYUK.war'),
      Array.from({ length: 150 }, (_, i) => [`WEB-INF/classes/C${i}.class`, 'x']),
    );
    const yuk8 = tara([path.join(kok, 'vhosting8')], {
      EAR_KIP: 'OZET',
      EAR_SINIR_UYGULAMA: '100',
    });
    const p = uyg(yuk8, 'PAKETBUYUK.ear');
    assert.equal(p.warlar[0].bicim, 'ARSIV');
    assert.equal(p.warlar[0].durum, 'KISMI_SINIR', 'kesik paketli WAR TAM gorunmemeli');
    assert.equal(p.durum, 'KISMI_SINIR');

    // Dis .ear merkez dizini de ayni uygulama sinirina uyar; onceki kod tum infolist'i gezip TAM diyordu.
    zipYaz(
      path.join(kok, 'arsiv', 'ARSIVBUYUK.ear'),
      Array.from({ length: 150 }, (_, i) => [`classes/C${i}.class`, 'x']),
    );
    const arsiv = tara([path.join(kok, 'arsiv')], {
      EAR_KIP: 'TAM',
      EAR_SINIR_UYGULAMA: '100',
    });
    const au = uyg(arsiv, 'ARSIVBUYUK.ear');
    assert.equal(au.durum, 'KISMI_SINIR');
    assert.equal(au.giris, 0, 'limit ustu merkez dizini ZipFile ile materialize edildi');
    assert.equal(au.satirlar.length, 0, 'limit ustu merkez dizini TAM cikti uretti');
    assert.equal(arsiv.durum, 'KISMI');

    // Host toplam siniri da dis arsiv dongusunde her giristen once uygulanir.
    zipYaz(
      path.join(kok, 'host', 'HOSTBUYUK.ear'),
      Array.from({ length: 1100 }, (_, i) => [`classes/H${i}.class`, 'x']),
    );
    const host = tara([path.join(kok, 'host')], {
      EAR_KIP: 'OZET',
      EAR_SINIR_UYGULAMA: '500000',
      EAR_SINIR_HOST: '1000',
    });
    const hu = uyg(host, 'HOSTBUYUK.ear');
    assert.equal(hu.durum, 'KISMI_SINIR');
    assert.equal(hu.giris, 0, 'host limitini asan merkez dizini on kapida durmadi');
    assert.equal(host.giris, 0);
    assert.equal(host.durum, 'KISMI');

    // Sure butcesini 10 saniye bekletmeden kaynak kapisini da koru: dis EAR dongusunun
    // icinde sure ve iki giris siniri birlikte bulunmali.
    const arsivFonksiyonu = /def arsiv_uygulama\(u, tam\):([\s\S]*?)\ndef bitir\(/.exec(KAYNAK)?.[1] || '';
    assert.match(arsivFonksiyonu, /for i in sorted\([\s\S]*?if sure_doldu\(\):[\s\S]*?u\['giris'\] >= SINIR_UYGULAMA or HOST\['giris'\] >= SINIR_HOST/);

    const sureProbe = (ear, kip) => {
      const kod = [
        'import importlib.util, json, sys',
        'g=json.loads(sys.stdin.read())',
        's=importlib.util.spec_from_file_location("ear_tara_probe", g["betik"])',
        'm=importlib.util.module_from_spec(s); s.loader.exec_module(m)',
        'm.KIP="TAM"; m.HOST={"giris":0,"zaman_doldu":False}',
        'n=[0]',
        'def doldu():',
        ' n[0]+=1',
        ' return True if g["kip"]=="kok" else n[0]>1',
        'm.sure_doldu=doldu',
        'def yasak(*a, **kw): raise AssertionError("sure dolduktan sonra ZipFile acildi")',
        'm.zipfile.ZipFile=yasak',
        'u=m.yeni_uygulama("/probe", "A.ear", "ARSIV")',
        'm.bitir(u, *m.arsiv_uygulama(u, g["ear"]))',
        'print(json.dumps({"durum":u["durum"],"giris":u["giris"],"uyarilar":u["uyarilar"],"war":u["warlar"][0]["durum"] if u["warlar"] else None,"cagri":n[0]}))',
      ].join('\n');
      // -B: betigi import eden sonda AWX'e aynen kopyalanan agaca __pycache__ birakmasin.
      const r = spawnSync(PY.komut, [...PY.on, '-B', '-c', kod], {
        input: JSON.stringify({ betik: BETIK, ear, kip }),
      });
      assert.equal(r.status, 0, String(r.stderr));
      return JSON.parse(String(r.stdout));
    };
    const kokEar = path.join(kok, 'sure', 'KOK.ear');
    zipYaz(kokEar, [['/', 'x']]);
    assert.deepEqual(sureProbe(kokEar, 'kok'), {
      durum: 'KISMI_ZAMAN', giris: 0, uyarilar: ['sure butcesi doldu'], war: null, cagri: 1,
    });
    const icWar = path.join(kok, 'sure', 'IC.war');
    zipYaz(icWar, [['WEB-INF/a.class', 'x'], ['WEB-INF/b.class', 'x'], ['WEB-INF/c.class', 'x']]);
    const icEar = path.join(kok, 'sure', 'IC.ear');
    zipYaz(icEar, [['IC.war', icWar]]);
    const ic = sureProbe(icEar, 'ic');
    assert.equal(ic.durum, 'KISMI_ZAMAN');
    assert.equal(ic.war, null);
    assert.equal(ic.giris, 0, 'preflight sonrasi dolan surede ZipFile acildi');
    assert.equal(ic.cagri, 2, 'preflight sonrasi sure yeniden olculmedi');

    // ZIP yorumu icindeki sahte bos EOCD son imza olarak gorunebilir. Merkez offset/boyut
    // gercek EOCD konumuyla uyusmuyorsa dolu arsiv bos/TAM sayilmaz.
    const sahte = path.join(kok, 'arsiv', 'SAHTE-EOCD.ear');
    zipYaz(sahte, Array.from({ length: 150 }, (_, i) => [`classes/S${i}.class`, 'x']));
    const yorum = spawnSync(PY.komut, [...PY.on, '-c', [
      'import sys, zipfile',
      'with zipfile.ZipFile(sys.argv[1], "a") as z:',
      ' z.comment = b"PK\\x05\\x06" + b"\\x00" * 18',
    ].join('\n'), sahte]);
    assert.equal(yorum.status, 0, String(yorum.stderr));
    const sahteSonuc = tara([path.dirname(sahte)], { EAR_KIP: 'TAM', EAR_SINIR_UYGULAMA: '100' });
    const su = uyg(sahteSonuc, 'SAHTE-EOCD.ear');
    assert.equal(su.durum, 'ARSIV_ACILMADI');
    assert.equal(su.giris, 0);
    assert.equal(sahteSonuc.durum, 'KISMI');

    // EOCD'deki ilan edilen sayi dusurulurse de gercek merkez basliklari tavan+1'e
    // kadar sayilmali; aksi halde ZipFile 150 kaydi sinirdan once materialize eder.
    const sayacSahte = path.join(kok, 'arsiv', 'SAYAC-SAHTE.ear');
    zipYaz(sayacSahte, Array.from({ length: 150 }, (_, i) => [`classes/F${i}.class`, 'x']));
    const sayacYama = spawnSync(PY.komut, [...PY.on, '-c', [
      'import struct, sys',
      'p=sys.argv[1]',
      'with open(p, "r+b") as f:',
      ' data=f.read()',
      ' yer=data.rfind(b"PK\\x05\\x06")',
      ' assert yer >= 0',
      ' y=bytearray(data)',
      ' struct.pack_into("<HH", y, yer + 8, 1, 1)',
      ' f.seek(0); f.write(y); f.truncate()',
    ].join('\n'), sayacSahte]);
    assert.equal(sayacYama.status, 0, String(sayacYama.stderr));
    const sayacSonuc = tara([path.dirname(sayacSahte)], {
      EAR_KIP: 'TAM', EAR_SINIR_UYGULAMA: '100',
    });
    const ssu = uyg(sayacSonuc, 'SAYAC-SAHTE.ear');
    assert.equal(ssu.durum, 'KISMI_SINIR');
    assert.equal(ssu.giris, 0, 'sahte EOCD sayaci ZipFile materializasyonunu atlatti');
    assert.equal(sayacSonuc.durum, 'KISMI');

    const probe = (kod, girdi) => {
      const r = spawnSync(PY.komut, [...PY.on, '-B', '-c', kod], { input: JSON.stringify(girdi) });
      assert.equal(r.status, 0, String(r.stderr));
      return JSON.parse(String(r.stdout));
    };

    // Preflight ve ZipFile ayni acik inode'u kullanmali. Preflight sonrasi path atomik
    // degisse bile yeni/sinirsiz arsiv materialize edilmemeli.
    const eski = path.join(kok, 'race', 'DEGISEN.ear');
    const yeni = path.join(kok, 'race', 'YENI.ear');
    zipYaz(eski, [['classes/Eski.class', 'x']]);
    zipYaz(yeni, Array.from({ length: 150 }, (_, i) => [`classes/Y${i}.class`, 'x']));
    const race = probe([
      'import importlib.util, json, os, sys',
      'g=json.loads(sys.stdin.read())',
      's=importlib.util.spec_from_file_location("ear_tara_probe", g["betik"])',
      'm=importlib.util.module_from_spec(s); s.loader.exec_module(m)',
      'm.KIP="TAM"; m.SINIR_UYGULAMA=100; m.HOST={"giris":0,"zaman_doldu":False}',
      'asil=m.zip_merkez_giris_sayisi',
      'def degistir(kaynak, tavan):',
      ' sonuc=asil(kaynak, tavan)',
      ' os.replace(g["yeni"], g["eski"])',
      ' return sonuc',
      'm.zip_merkez_giris_sayisi=degistir',
      'u=m.yeni_uygulama("/probe", "DEGISEN.ear", "ARSIV")',
      'm.bitir(u, *m.arsiv_uygulama(u, g["eski"]))',
      'print(json.dumps({"durum":u["durum"],"giris":u["giris"]}))',
    ].join('\n'), { betik: BETIK, eski, yeni });
    assert.deepEqual(race, { durum: 'TAM', giris: 1 });

    // Direct ve nested WAR limit ustundeyse ZipFile ikinci kez acilmadan on kapida durur.
    const nestedWar = path.join(kok, 'sure', 'NESTED-BIG.war');
    zipYaz(nestedWar, Array.from({ length: 150 }, (_, i) => [`WEB-INF/classes/N${i}.class`, 'x']));
    const nestedEar = path.join(kok, 'sure', 'NESTED-BIG.ear');
    zipYaz(nestedEar, [['NESTED-BIG.war', nestedWar]]);
    const warProbe = probe([
      'import importlib.util, io, json, sys',
      'g=json.loads(sys.stdin.read())',
      's=importlib.util.spec_from_file_location("ear_tara_probe", g["betik"])',
      'm=importlib.util.module_from_spec(s); s.loader.exec_module(m)',
      'm.KIP="TAM"; m.SINIR_UYGULAMA=100; m.HOST={"giris":0,"zaman_doldu":False}',
      'asil=m.zipfile.ZipFile',
      'def bekci(kaynak, *a, **kw):',
      ' if isinstance(kaynak, io.BytesIO): raise AssertionError("nested WAR materialized")',
      ' return asil(kaynak, *a, **kw)',
      'm.zipfile.ZipFile=bekci',
      'u=m.yeni_uygulama("/probe", "IC.ear", "ARSIV")',
      'm.bitir(u, *m.arsiv_uygulama(u, g["ear"]))',
      'print(json.dumps({"durum":u["durum"],"giris":u["giris"],"war":u["warlar"][0]["durum"]}))',
    ].join('\n'), { betik: BETIK, ear: nestedEar });
    assert.deepEqual(warProbe, { durum: 'KISMI_SINIR', giris: 1, war: 'KISMI_SINIR' });

    const directWar = path.join(kok, 'sure', 'DIRECT-BIG.war');
    zipYaz(directWar, Array.from({ length: 150 }, (_, i) => [`WEB-INF/classes/D${i}.class`, 'x']));
    const directProbe = probe([
      'import importlib.util, json, sys',
      'g=json.loads(sys.stdin.read())',
      's=importlib.util.spec_from_file_location("ear_tara_probe", g["betik"])',
      'm=importlib.util.module_from_spec(s); s.loader.exec_module(m)',
      'm.KIP="TAM"; m.SINIR_UYGULAMA=100; m.HOST={"giris":0,"zaman_doldu":False}',
      'def bekci(*a, **kw): raise AssertionError("direct WAR materialized")',
      'm.zipfile.ZipFile=bekci',
      'u=m.yeni_uygulama("/probe", "A.ear", "ACIK")',
      'm.paketli_war(u, g["war"], "DIRECT-BIG.war", m.Iz())',
      'print(json.dumps({"durum":u["durum"],"giris":u["giris"],"war":u["warlar"][0]["durum"]}))',
    ].join('\n'), { betik: BETIK, war: directWar });
    assert.deepEqual(directProbe, { durum: 'KISMI_SINIR', giris: 0, war: 'KISMI_SINIR' });

    const timeWar = path.join(kok, 'sure', 'DIRECT-TIME.war');
    zipYaz(timeWar, [['WEB-INF/a.class', 'x'], ['WEB-INF/b.class', 'x']]);
    const timeProbe = probe([
      'import importlib.util, json, sys',
      'g=json.loads(sys.stdin.read())',
      's=importlib.util.spec_from_file_location("ear_tara_probe", g["betik"])',
      'm=importlib.util.module_from_spec(s); s.loader.exec_module(m)',
      'm.KIP="TAM"; m.HOST={"giris":0,"zaman_doldu":False}',
      'm.sure_doldu=lambda: True',
      'def bekci(*a, **kw): raise AssertionError("time-expired WAR materialized")',
      'm.zipfile.ZipFile=bekci',
      'u=m.yeni_uygulama("/probe", "A.ear", "ACIK")',
      'm.paketli_war(u, g["war"], "DIRECT-TIME.war", m.Iz())',
      'print(json.dumps({"durum":u["durum"],"giris":u["giris"],"war":u["warlar"][0]["durum"]}))',
    ].join('\n'), { betik: BETIK, war: timeWar });
    assert.deepEqual(timeProbe, { durum: 'KISMI_ZAMAN', giris: 0, war: 'KISMI_ZAMAN' });

    // Per-entry ZIP64 extra da klasik EOCD sayaclari normal gorunse bile reddedilir.
    const zip64 = path.join(kok, 'arsiv', 'ZIP64.ear');
    const zip64Yaz = spawnSync(PY.komut, [...PY.on, '-c', [
      'import sys, zipfile',
      'with zipfile.ZipFile(sys.argv[1], "w") as z:',
      ' with z.open("classes/Z.class", "w", force_zip64=True) as f: f.write(b"x")',
    ].join('\n'), zip64]);
    assert.equal(zip64Yaz.status, 0, String(zip64Yaz.stderr));
    const zip64Sonuc = tara([path.dirname(zip64)], { EAR_KIP: 'TAM', EAR_SINIR_UYGULAMA: '100' });
    const zu = uyg(zip64Sonuc, 'ZIP64.ear');
    assert.equal(zu.durum, 'ARSIV_ACILMADI');
    assert.equal(zu.giris, 0);

    // Bozuk outer/direct/nested arsiv, kaynak siniri gibi degil ARSIV_ACILMADI raporlanir.
    const bozukKok = path.join(kok, 'bozuk');
    fs.mkdirSync(path.join(bozukKok, 'DIRECT.ear'), { recursive: true });
    fs.writeFileSync(path.join(bozukKok, 'BAD.ear'), 'not-a-zip');
    fs.writeFileSync(path.join(bozukKok, 'DIRECT.ear', 'BAD.war'), 'not-a-zip');
    const nestedBad = path.join(kok, 'bozuk', 'NESTED.ear');
    zipYaz(nestedBad, [['BAD.war', 'not-a-zip']]);
    const bozuk = tara([bozukKok], { EAR_KIP: 'TAM' });
    assert.equal(uyg(bozuk, 'BAD.ear').durum, 'ARSIV_ACILMADI');
    const directBad = uyg(bozuk, 'DIRECT.ear');
    assert.equal(directBad.durum, 'ARSIV_ACILMADI');
    assert.equal(directBad.warlar[0].durum, 'ARSIV_ACILMADI');
    const nestedBadU = uyg(bozuk, 'NESTED.ear');
    assert.equal(nestedBadU.durum, 'ARSIV_ACILMADI');
    assert.equal(nestedBadU.warlar[0].durum, 'ARSIV_ACILMADI');
  },
);

test('ET5 kok yok -> KOK_YOK; tek kok yoksa ve gerisi temizse TAM', { skip: SKIP }, () => {
  const kok = geciciKok('et5');
  const yok = tara([path.join(kok, 'vhosting'), path.join(kok, 'vhosting8')]);
  assert.equal(yok.durum, 'KOK_YOK');
  assert.equal(yok.uygulamalar.length, 0);
  fs.mkdirSync(path.join(kok, 'vhosting8'));
  const bos = tara([path.join(kok, 'vhosting'), path.join(kok, 'vhosting8')]);
  assert.equal(bos.durum, 'TAM', 'var olan ama EAR icermeyen kok gecerli bir sonuctur');
});

test(
  'ET6 izin reddi: uygulama ve WAR KISMI_IZIN, host KISMI',
  { skip: SKIP || (ROOT && 'root izin reddini gormez') },
  () => {
    const kok = geciciKok('et6');
    const gizli = path.join(kok, 'vhosting', 'IZINSIZ.ear', 'IZINSIZ.war', 'WEB-INF', 'gizli');
    fs.mkdirSync(gizli, { recursive: true });
    dosya(path.join(kok, 'vhosting', 'IZINSIZ.ear', 'IZINSIZ.war', 'WEB-INF', 'web.xml'), 100);
    fs.chmodSync(gizli, 0);
    try {
      const yuk = tara([path.join(kok, 'vhosting')]);
      const u = uyg(yuk, 'IZINSIZ.ear');
      assert.equal(u.durum, 'KISMI_IZIN');
      assert.equal(u.warlar[0].durum, 'KISMI_IZIN');
      assert.match(u.uyarilar.join('\n'), /listelenemedi .*gizli/);
      assert.equal(yuk.durum, 'KISMI');
    } finally {
      fs.chmodSync(gizli, 0o755);
    }
  },
);

test(
  'ET7 kokteki bag tek adim izlenir; ic bag / dongu izlenmez; koku gosteren bag reddedilir',
  { skip: SKIP },
  () => {
    const kok = geciciKok('et7');
    const surum = path.join(kok, 'releases', 'BAGLI-1.0.ear');
    dosya(path.join(surum, 'BAGLI.war', 'WEB-INF', 'lib', 'spring-boot-3.3.4.jar'), 1000);
    fs.symlinkSync('..', path.join(surum, 'BAGLI.war', 'dongu'));
    fs.mkdirSync(path.join(kok, 'vhosting'));
    fs.symlinkSync(surum, path.join(kok, 'vhosting', 'BAGLI.ear'));
    fs.symlinkSync(path.join(kok, 'vhosting'), path.join(kok, 'vhosting', 'KENDI.ear'));
    const yuk = tara([path.join(kok, 'vhosting')], { EAR_KIP: 'TAM' });
    const u = uyg(yuk, 'BAGLI.ear');
    assert.equal(u.bicim, 'BAG');
    assert.equal(u.bag_hedefi, surum);
    assert.equal(u.durum, 'TAM');
    assert.deepEqual(surumler(u.warlar[0], 'spring-boot'), ['3.3.4']);
    const dongu = u.satirlar.find((s) => s[0] === 'BAGLI.war/dongu');
    assert.ok(
      dongu && dongu[1] === 'L' && dongu[8] === '..',
      'ic bag L olarak kaydedilmeli, izlenmemeli',
    );
    assert.ok(!u.satirlar.some((s) => s[0].startsWith('BAGLI.war/dongu/')), 'ic bag izlendi');
    const k = uyg(yuk, 'KENDI.ear');
    assert.equal(k.durum, 'HATA');
    assert.match(k.uyarilar.join(' '), /kokun kendisini/);
  },
);

test(
  'ET8 SALT OKUNUR: tarama agacta hicbir sey degistirmez, dosya birakmaz',
  { skip: SKIP },
  () => {
    const kok = geciciKok('et8');
    secpanel(path.join(kok, 'vhosting8'));
    zipYaz(path.join(kok, 'vhosting8', 'PAKETLI.ear', 'PAKETLI.war'), [
      ['WEB-INF/web.xml', '<w/>'],
    ]);
    const once = goruntu(kok);
    tara([path.join(kok, 'vhosting'), path.join(kok, 'vhosting8')], { EAR_KIP: 'TAM' });
    tara([path.join(kok, 'vhosting'), path.join(kok, 'vhosting8')], { EAR_KIP: 'OZET' });
    const sonra = goruntu(kok);
    assert.deepEqual(
      Object.keys(sonra).sort(),
      Object.keys(once).sort(),
      'giris eklendi ya da silindi',
    );
    for (const [k, v] of Object.entries(once)) assert.equal(sonra[k], v, `degisti: ${k}`);
  },
);

test(
  'ET9 kaynak: Python 3.6 sozdizimi; Jinja isareti / heredoc sonu yok; yazan, silen, calistiran cagri yok',
  { skip: SKIP },
  () => {
    const r = spawnSync(
      PY.komut,
      [...PY.on, '-c', 'import ast, sys; ast.parse(sys.stdin.read(), feature_version=(3, 6))'],
      { input: KAYNAK },
    );
    assert.equal(r.status, 0, `Python 3.6 sozdizimi disi: ${String(r.stderr).slice(-300)}`);
    for (const kotu of ['{{', '{%', '{#', 'EAR_TARA_SON'])
      assert.ok(!KAYNAK.includes(kotu), `betikte '${kotu}' var (playbook heredoc / Jinja bozulur)`);
    const kod = KAYNAK.split('\n')
      .filter((s) => !/^\s*#/.test(s))
      .join('\n');
    for (const kotu of [
      'os.remove',
      'os.unlink',
      'os.rename',
      'os.replace',
      'os.chmod',
      'os.chown',
      'os.mkdir',
      'os.makedirs',
      'os.utime',
      'os.system',
      'shutil',
      'subprocess',
      'tempfile',
      'os.popen',
    ]) {
      assert.ok(!kod.includes(kotu), `salt okunur betikte yasak cagri: ${kotu}`);
    }
    assert.ok(!/(^|[^\w.])open\(/m.test(kod), 'salt okunur betikte builtin open var');
    const yazanlar = kod.split('\n').filter((s) => s.includes('.write('));
    assert.ok(
      yazanlar.length > 0 && yazanlar.every((s) => /sys\.stdout\.(buffer\.)?write\(/.test(s)),
      `stdout disinda yazma: ${yazanlar.join(' | ')}`,
    );
    // Tirnaksiz heredoc'a donulse bile hedef kabukta komut calismasin (mutasyonda ters tirnakli
    // yorum gercekten bir dosya yaratti).
    for (const kotu of ['`', '$('])
      assert.ok(!KAYNAK.includes(kotu), `betikte '${kotu}' var (kabuk yerine koyma)`);
  },
);

// ET9'un metin listesi bir YASAK listesi: listede olmayan her yazan cagri (pathlib, os.symlink,
// ZipFile(..., 'a') ...) gecerdi. Bu yuzden AST ile IZIN listesi: modul nitelikleri yalniz
// asagidakiler. Yeni bir nitelik gerekiyorsa once salt okunur oldugunu dogrula, sonra ekle.
const AST_DENETIM = `
import ast, json, sys
IZIN = {
    'os': {'O_RDONLY', 'SEEK_END', 'SEEK_SET', 'environ', 'fdopen', 'getuid', 'lstat', 'open', 'path', 'readlink', 'scandir'},
    'os.path': {'isdir', 'isfile', 'join', 'realpath'},
    'sys': {'stdout', 'version'},
    'socket': {'gethostname'},
    'zipfile': {'ZipFile', 'BadZipFile'},
    'io': {'BytesIO'},
    'time': {'gmtime', 'mktime', 'monotonic', 'strftime'},
    'hashlib': {'sha256'},
    'base64': {'b64encode'},
    'zlib': {'compress'},
    'json': {'dumps'},
    're': {'I', 'compile'},
    'stat': {'filemode'},
    'struct': {'unpack_from'},
}
IZINLI_FROM = {'collections': {'deque'}}
YASAK_AD = {'open', '__import__', 'eval', 'exec', 'compile', 'getattr', 'setattr', 'globals', 'vars'}
YASAK_NITELIK = {'write_text', 'write_bytes', 'touch', 'mkdir', 'makedirs', 'unlink', 'rmdir',
                 'symlink_to', 'chmod', 'chown', 'extract', 'extractall', 'writestr', 'truncate'}

def nokta(n):
    if isinstance(n, ast.Name):
        return n.id
    if isinstance(n, ast.Attribute):
        on = nokta(n.value)
        return on + '.' + n.attr if on else None
    return None

def sabit(n):
    return getattr(n, 'value', getattr(n, 's', None))

agac = ast.parse(sys.stdin.read())
ihlal, zip_sayisi, nitelik_sayisi, ac_sayisi = [], 0, 0, 0
# os.open bayragi serbest kalirsa (O_TRUNC = 512, yazma+olustur+kesme = 577) izin listesi
# bunu gormez; os.open / os.fdopen yalniz dogrudan cagri olarak ve sabit okuma kipiyle gecer.
cagrilar = set(id(c.func) for c in ast.walk(agac) if isinstance(c, ast.Call))
for n in ast.walk(agac):
    if isinstance(n, ast.Import):
        ihlal += ['import ' + a.name for a in n.names if a.name not in IZIN]
    elif isinstance(n, ast.ImportFrom):
        ihlal += ['from %s import %s' % (n.module, a.name) for a in n.names
                  if a.name not in IZINLI_FROM.get(n.module, set())]
    elif isinstance(n, ast.Attribute):
        on = nokta(n.value)
        if on in IZIN:
            nitelik_sayisi += 1
            if n.attr not in IZIN[on]:
                ihlal.append(on + '.' + n.attr)
        if n.attr in YASAK_NITELIK:
            ihlal.append('.' + n.attr)
        if nokta(n) in ('os.open', 'os.fdopen') and id(n) not in cagrilar:
            ihlal.append(nokta(n) + ' cagri disinda')
        if n.attr == 'write' and nokta(n.value) not in ('sys.stdout', 'sys.stdout.buffer'):
            ihlal.append(str(nokta(n.value)) + '.write')
    elif isinstance(n, ast.Call):
        if isinstance(n.func, ast.Name) and n.func.id in YASAK_AD:
            ihlal.append(n.func.id + '()')
        if nokta(n.func) == 'zipfile.ZipFile':
            zip_sayisi += 1
            kip = [sabit(n.args[1])] if len(n.args) > 1 else []
            kip += [sabit(k.value) for k in n.keywords if k.arg == 'mode']
            if kip != ['r']:
                ihlal.append('zipfile.ZipFile kip=%r' % (kip,))
        if nokta(n.func) == 'os.open':
            ac_sayisi += 1
            if len(n.args) != 2 or n.keywords or nokta(n.args[1]) != 'os.O_RDONLY':
                ihlal.append('os.open yalniz (yol, os.O_RDONLY)')
        if nokta(n.func) == 'os.fdopen':
            if len(n.args) != 2 or n.keywords or sabit(n.args[1]) != 'rb':
                ihlal.append("os.fdopen yalniz (fd, 'rb')")
print(json.dumps({'ihlal': ihlal, 'zip': zip_sayisi, 'nitelik': nitelik_sayisi, 'ac': ac_sayisi}))
`;

test(
  'ET12 kaynak AST: modul nitelikleri izin listesinde; arsivler yalniz r kipinde',
  { skip: SKIP },
  () => {
    const r = spawnSync(PY.komut, [...PY.on, '-c', AST_DENETIM], { input: KAYNAK });
    assert.equal(r.status, 0, String(r.stderr).slice(-400));
    const s = JSON.parse(String(r.stdout));
    // Korluk: denetci hicbir sey gormezse (ornegin ayristirma degisirse) yesil kalmasin.
    assert.ok(s.zip >= 2, `ZipFile cagrisi bulunamadi (${s.zip}); denetim kor`);
    assert.ok(s.nitelik >= 20, `modul niteligi bulunamadi (${s.nitelik}); denetim kor`);
    assert.ok(s.ac >= 2, `os.open cagrisi bulunamadi (${s.ac}); bayrak denetimi kor`);
    assert.deepEqual(s.ihlal, [], `salt okunur betikte izin disi kullanim: ${s.ihlal.join(', ')}`);
  },
);

test(
  'ET10 TAM satirlari = giris; log degisimi yapi izini bozmaz, sinif ekleme bozar; jar surumu kutuphane izini degistirir',
  { skip: SKIP },
  () => {
    const kokA = geciciKok('et10a');
    const kokB = geciciKok('et10b');
    const wA = secpanel(path.join(kokA, 'vhosting8'));
    secpanel(path.join(kokB, 'vhosting8'));
    const a1 = uyg(tara([path.join(kokA, 'vhosting8')], { EAR_KIP: 'TAM' }), 'ORNEKPANEL.ear');
    const b1 = uyg(tara([path.join(kokB, 'vhosting8')], { EAR_KIP: 'TAM' }), 'ORNEKPANEL.ear');
    assert.equal(a1.satirlar.length, a1.giris);
    assert.equal(a1.yapi_izi, b1.yapi_izi, 'ayni agac iki yerde ayni izi vermeli');
    assert.equal(a1.kutuphane_izi, b1.kutuphane_izi);
    const s = a1.satirlar.find((x) => x[0].endsWith('WEB-INF/web.xml'));
    assert.equal(s[1], 'F');
    assert.match(s[2], /^-[rwx-]{9}$/);
    assert.equal(s[5], 1772);
    assert.ok(Number.isInteger(s[7]) && s[7] > 0, 'inode sayisal');
    dosya(path.join(wA, 'WEB-INF', 'logs', 'yeni.log'), 10);
    const a2 = uyg(tara([path.join(kokA, 'vhosting8')], { EAR_KIP: 'OZET' }), 'ORNEKPANEL.ear');
    assert.equal(a2.yapi_izi, a1.yapi_izi, 'WEB-INF/logs altindaki degisim yapi izini bozmamali');
    dosya(path.join(wA, 'WEB-INF', 'classes', 'com', 'ornek', 'Yeni.class'), 10);
    const a3 = uyg(tara([path.join(kokA, 'vhosting8')], { EAR_KIP: 'OZET' }), 'ORNEKPANEL.ear');
    assert.notEqual(a3.yapi_izi, a1.yapi_izi, 'yeni sinif dosyasi yapi izini degistirmeli');
    const kokC = geciciKok('et10c');
    secpanel(path.join(kokC, 'vhosting8'), { springCore: 'spring-core-7.0.8.jar' });
    const c1 = uyg(tara([path.join(kokC, 'vhosting8')], { EAR_KIP: 'OZET' }), 'ORNEKPANEL.ear');
    assert.notEqual(
      c1.kutuphane_izi,
      a1.kutuphane_izi,
      'jar surumu farki kutuphane izine yansimali',
    );
  },
);

test('ET11 insan kipi Turkce dosya adini kirmadan basar', { skip: SKIP }, () => {
  const kok = geciciKok('et11');
  dosya(path.join(kok, 'vhosting', 'ÖDEME.ear', 'ÖDEME.war', 'WEB-INF', 'web.xml'), 10);
  const metin = tara([path.join(kok, 'vhosting')], { EAR_CIKTI: 'insan' });
  assert.match(metin, /durum=TAM/);
  assert.ok(metin.includes('ÖDEME.ear'), metin.slice(0, 300));
});
