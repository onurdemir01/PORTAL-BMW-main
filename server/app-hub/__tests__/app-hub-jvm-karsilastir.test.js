// server/app-hub/__tests__/app-hub-jvm-karsilastir.test.js - JK1..JK17 (2026-11-16).
//
// Application Hub: toplu JBoss JVM argumani karsilastirmasi (salt okunur).
// Kilitler:
//   JK1  sira onemsiz (kume karsilastirmasi)
//   JK2  ayni anahtarin farkli degeri 'deger farki'; cogunluk ve sapan sunucu
//   JK3  yalniz bazi sunucularda olan arguman 'eksik/fazla'
//   JK4  host adi / JVM adi / IP iceren deger normallesir: 'sunucuya ozgu', esitsizlik degil
//   JK5  kimlik anahtari (node adi) farkli degerle esitsizlik degil; port ofseti yalniz ayni sunucu
//        icinde dogal, sunucular arasi FARKLI; bind adresi kosulsuz yutulmaz
//   JK6  maskeli (***) kisim esit cikar, acik kalan kisim (host / sema) farki FARKLI; 'maskeli' notu
//   JK7  TEK_SUNUCU / OLCULEMEDI / BULUNAMADI
//   JK8  JBoss 7 ile 8 ayri gruplarda karsilastirilir; nesil suzgeci
//   JK9  ortam suzgeci: PROD varsayilan, 'Production' PROD sayilir; TUMU ortam basina gruplar
//   JK10 calismayan JVM yapilandirilan argumanla; grup kaynagi tutarli secilir
//   JK11 anahtar=deger ayristirma (-Xmx, -XX:+/-, -XX:k=v, -cp <yol>); tekrar eden anahtarda son deger etkin
//   JK12 uc: Admin disi 403 (nginx-red ceviricisiyle 409 + upstreamStatus 403)
//   JK13 uc: 21 uygulama 400, gecersiz ad 400, gecersiz ortam / nesil 400
//   JK14 uc: sonuc ozeti, okunamayan uygulama OLCULEMEDI (digerleri devam), denetim katmani govdeyi alir;
//        ayni tabana inen adlar (MUSTERI-T) tek okuma
//   JK15 kesik arguman ('...+N'): belirtec arguman degil; kesik JVM'de olmayan anahtar eksik sayilmaz
//   JK16 normallestirme belirtec sinirinda; JVM adi harf duyarli; ham/normal cogunluk catisirsa sapan belirsiz
//   JK17 ortam: taninmayan etiket ve kesif hatasi uyarida; Server Hub hatasi neden metninde
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');

function sahte(yol, exp) {
  const m = new Module(yol, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[yol] = m;
}

const J = require('../jvm-karsilastir.cjs');
const { grupKarsilastir, uygulamaKarsilastir, argHaritasi, girdiDogrula, normallestir } = J._ic;

const uye = (host, args, ek = {}) => ({
  etiket: `${host}/MUSTERI`,
  host,
  jvm: 'MUSTERI',
  ip: null,
  args,
  kaynak: 'CALISAN',
  calisiyor: true,
  taze: true,
  ...ek,
});

test('JK1 sira onemsiz: ayni argumanlar farkli sirada ESIT', () => {
  const r = grupKarsilastir([
    uye('OPJBAP01', '-Xmx2g -Xms1g -XX:+UseG1GC -Da=1'),
    uye('OPJBAP02', '-Da=1 -XX:+UseG1GC -Xms1g -Xmx2g'),
  ]);
  assert.equal(r.durum, 'ESIT');
  assert.equal(r.farkSayisi, 0);
  assert.equal(r.esitSayisi, 4);
});

test('JK2 deger farki: cogunluk degeri ve sapan sunucu', () => {
  const r = grupKarsilastir([
    uye('OPJBAP01', '-Xmx2g -Da=1'),
    uye('OPJBAP02', '-Xmx2g -Da=1'),
    uye('OPJBAP03', '-Xmx4g -Da=1'),
  ]);
  assert.equal(r.durum, 'FARKLI');
  assert.equal(r.degerFarklari.length, 1);
  const f = r.degerFarklari[0];
  assert.equal(f.anahtar, '-Xmx');
  assert.equal(f.cogunluk, '2g');
  assert.deepEqual(f.cogunlukUyeler, ['OPJBAP01/MUSTERI', 'OPJBAP02/MUSTERI']);
  assert.deepEqual(
    f.sapanlar.map((s) => [s.uye, s.deger]),
    [['OPJBAP03/MUSTERI', '4g']],
  );
  // esit bolunme: cogunluk yok, tum degerler sapan
  const e = grupKarsilastir([uye('OPJBAP01', '-Da=1'), uye('OPJBAP02', '-Da=2')]);
  assert.equal(e.degerFarklari[0].cogunluk, null);
  assert.equal(e.degerFarklari[0].sapanlar.length, 2);
});

test('JK3 eksik/fazla: yalniz bazi sunucularda olan arguman', () => {
  const r = grupKarsilastir([
    uye('OPJBAP01', '-Da=1 -Db=2'),
    uye('OPJBAP02', '-Da=1 -Db=2'),
    uye('OPJBAP03', '-Da=1 -Dc=3'),
  ]);
  assert.equal(r.durum, 'FARKLI');
  assert.equal(r.farkSayisi, 2);
  const b = r.eksikFazla.find((x) => x.anahtar === '-Db');
  assert.deepEqual(b.olmayan, ['OPJBAP03/MUSTERI']);
  assert.equal(b.cogunlukta, true);
  const c = r.eksikFazla.find((x) => x.anahtar === '-Dc');
  assert.deepEqual(c.olan, ['OPJBAP03/MUSTERI']);
  assert.equal(c.cogunlukta, false);
});

test('JK4 sunucuya ozgu: host / IP / JVM adi gecen deger esitsizlik sayilmaz', () => {
  const a = uye(
    'OPJBAP01',
    '-Djboss.server.log.dir=/log/opjbap01/MUSTERI -Dx.url=http://10.0.0.1:8080 -Xmx2g',
    { ip: '10.0.0.1' },
  );
  const b = uye(
    'OPJBAP02',
    '-Djboss.server.log.dir=/log/OPJBAP02/MUSTERI -Dx.url=http://10.0.0.2:8080 -Xmx2g',
    { ip: '10.0.0.2' },
  );
  const r = grupKarsilastir([a, b]);
  assert.equal(r.durum, 'ESIT', JSON.stringify(r.degerFarklari));
  assert.deepEqual(r.sunucuyaOzgu.map((x) => x.anahtar).sort(), [
    '-Djboss.server.log.dir',
    '-Dx.url',
  ]);
  assert.equal(normallestir('/log/opjbap01/MUSTERI', a), '/log/<HOST>/<JVM>');
  // normallestirme gercek farki ortmez: yol ayni sunucu yer tutucusuyla ama farkli kokte
  const c = uye(
    'OPJBAP03',
    '-Djboss.server.log.dir=/baska/OPJBAP03/MUSTERI -Dx.url=http://10.0.0.3:8080 -Xmx2g',
    { ip: '10.0.0.3' },
  );
  const r2 = grupKarsilastir([a, b, c]);
  assert.equal(r2.durum, 'FARKLI');
  assert.deepEqual(
    r2.degerFarklari.map((x) => x.anahtar),
    ['-Djboss.server.log.dir'],
  );
  assert.equal(r2.degerFarklari[0].cogunluk, '/log/<HOST>/<JVM>');
});

test('JK5 kimlik anahtari esitsizlik degil; port ofseti sunucular arasi FARKLI, sunucu ici dogal; bind adresi yutulmaz', () => {
  const r = grupKarsilastir([
    uye('OPJBAP01', '-Djboss.node.name=n1 -Djboss.tx.node.id=t1'),
    uye('OPJBAP02', '-Djboss.node.name=n2 -Djboss.tx.node.id=t2'),
  ]);
  assert.equal(r.durum, 'ESIT');
  assert.equal(r.sunucuyaOzgu.length, 2);
  // farkli sunucularda farkli port ofseti: web worker'i bu portu bekler
  const o = grupKarsilastir([
    uye('OPJBAP01', '-Djboss.socket.binding.port-offset=0'),
    uye('OPJBAP02', '-Djboss.socket.binding.port-offset=100'),
    uye('OPJBAP03', '-Djboss.socket.binding.port-offset=0'),
  ]);
  assert.equal(o.durum, 'FARKLI');
  assert.deepEqual(
    o.degerFarklari[0].sapanlar.map((s) => s.uye),
    ['OPJBAP02/MUSTERI'],
  );
  // ayni sunucudaki iki JVM 0 / 100, her sunucuda ayni dizilim: dogal fark
  const ic = grupKarsilastir([
    uye('OPJBAP01', '-Djboss.socket.binding.port-offset=0', { etiket: 'OPJBAP01/A', jvm: 'A' }),
    uye('OPJBAP01', '-Djboss.socket.binding.port-offset=100', { etiket: 'OPJBAP01/B', jvm: 'B' }),
    uye('OPJBAP02', '-Djboss.socket.binding.port-offset=0', { etiket: 'OPJBAP02/A', jvm: 'A' }),
    uye('OPJBAP02', '-Djboss.socket.binding.port-offset=100', { etiket: 'OPJBAP02/B', jvm: 'B' }),
  ]);
  assert.equal(ic.durum, 'ESIT');
  assert.deepEqual(
    ic.sunucuyaOzgu.map((x) => x.anahtar),
    ['-Djboss.socket.binding.port-offset'],
  );
  // bind adresi: 0.0.0.0 ile sunucunun kendi IP'si gercek fark; kendi IP'leri ise normallesir
  const b = grupKarsilastir([
    uye('OPJBAP01', '-Djboss.bind.address=0.0.0.0', { ip: '10.0.0.1' }),
    uye('OPJBAP02', '-Djboss.bind.address=10.0.0.2', { ip: '10.0.0.2' }),
  ]);
  assert.equal(b.durum, 'FARKLI');
  const b2 = grupKarsilastir([
    uye('OPJBAP01', '-Djboss.bind.address=10.0.0.1', { ip: '10.0.0.1' }),
    uye('OPJBAP02', '-Djboss.bind.address=10.0.0.2', { ip: '10.0.0.2' }),
  ]);
  assert.equal(b2.durum, 'ESIT');
  assert.equal(b2.sunucuyaOzgu[0].normal, '<IP>');
});

test('JK6 maskeli deger esit sayilir ve notlanir; varlik farki yine fark', () => {
  const r = grupKarsilastir([
    uye('OPJBAP01', '-Ddb.password=*** -Xmx2g'),
    uye('OPJBAP02', '-Ddb.password=*** -Xmx2g'),
  ]);
  assert.equal(r.durum, 'ESIT');
  assert.deepEqual(r.maskeli, ['-Ddb.password']);
  // maske yalniz parolayi gizler: acik kalan veritabani host farki gorunmeli
  const r1 = grupKarsilastir([
    uye('OPJBAP01', '-Ddb.url=jdbc:oracle:thin:usr/***@PRODDB'),
    uye('OPJBAP02', '-Ddb.url=jdbc:oracle:thin:usr/***@TESTDB'),
  ]);
  assert.equal(r1.durum, 'FARKLI');
  assert.deepEqual(r1.maskeli, ['-Ddb.url']);
  const r1b = grupKarsilastir([
    uye('OPJBAP01', '-Ddb.url=jdbc:oracle:thin:usr/***@PRODDB'),
    uye('OPJBAP02', '-Ddb.url=jdbc:oracle:thin:@TESTDB'),
  ]);
  assert.equal(r1b.durum, 'FARKLI');
  const r1c = grupKarsilastir([
    uye('OPJBAP01', '-Ddb.url=jdbc:oracle:thin:usr/***@PRODDB'),
    uye('OPJBAP02', '-Ddb.url=jdbc:oracle:thin:usr/***@PRODDB'),
  ]);
  assert.equal(r1c.durum, 'ESIT');
  const r2 = grupKarsilastir([
    uye('OPJBAP01', '-Ddb.password=*** -Xmx2g'),
    uye('OPJBAP02', '-Xmx2g'),
  ]);
  assert.equal(r2.durum, 'FARKLI');
  assert.equal(r2.eksikFazla[0].anahtar, '-Ddb.password');
});

test('JK7 TEK_SUNUCU / OLCULEMEDI / BULUNAMADI', () => {
  assert.equal(grupKarsilastir([uye('OPJBAP01', '-Xmx2g')]).durum, 'TEK_SUNUCU');
  assert.equal(grupKarsilastir([uye('OPJBAP01', null), uye('OPJBAP02', '')]).durum, 'OLCULEMEDI');
  const tekOlculen = grupKarsilastir([uye('OPJBAP01', '-Xmx2g'), uye('OPJBAP02', null)]);
  assert.equal(tekOlculen.durum, 'OLCULEMEDI');
  assert.match(tekOlculen.uyarilar[0], /OPJBAP02\/MUSTERI/);
  const bayat = grupKarsilastir([
    uye('OPJBAP01', '-Xmx2g', { taze: false }),
    uye('OPJBAP02', '-Xmx2g', { taze: false }),
  ]);
  assert.equal(bayat.durum, 'OLCULEMEDI');
  const yariBayat = grupKarsilastir([
    uye('OPJBAP01', '-Xmx2g', { taze: false }),
    uye('OPJBAP02', '-Xmx2g'),
  ]);
  assert.equal(yariBayat.durum, 'ESIT');
  assert.ok(yariBayat.uyarilar.some((u) => /bayat/.test(u)));
  assert.equal(grupKarsilastir([]).durum, 'BULUNAMADI');
  assert.equal(
    uygulamaKarsilastir('YOK', null, { ortam: 'PROD', nesil: 'hepsi' }).durum,
    'BULUNAMADI',
  );
});

const jvm = (ad, nesil, args, ek = {}) => ({
  ad,
  nesil,
  calisiyor: true,
  jvmArgs: args,
  yapilandirilanJvmArgs: null,
  taze: true,
  taramaTarihi: '2026-11-16',
  ...ek,
});
const sunucu = (host, ortam, nesil, jvmler, ek = {}) => ({
  host,
  uygulama: 'MUSTERI',
  ortam,
  nesil,
  jvmler,
  kapasite: null,
  ...ek,
});
const detay = (sunucular, ek = {}) => ({
  tip: 'jboss',
  ad: 'MUSTERI',
  sunucular,
  kaynaklar: { serverHub: { hata: null } },
  ...ek,
});

test('JK8 JBoss 7 ile 8 ayri gruplarda; nesil suzgeci', () => {
  const d = detay([
    sunucu('OPJBAP01', 'PROD', 7, [jvm('MUSTERI', 7, '-Xmx1g')]),
    sunucu('OPJBAP02', 'PROD', 7, [jvm('MUSTERI', 7, '-Xmx1g')]),
    sunucu('OPJBAP03', 'PROD', 8, [jvm('MUSTERI', 8, '-Xmx4g -XX:+UseG1GC')]),
    sunucu('OPJBAP04', 'PROD', 8, [jvm('MUSTERI', 8, '-Xmx4g -XX:+UseG1GC')]),
  ]);
  const r = uygulamaKarsilastir('MUSTERI', d, { ortam: 'PROD', nesil: 'hepsi' });
  assert.equal(r.durum, 'ESIT', 'JBoss 7 ile 8 birbiriyle karsilastirildi');
  assert.deepEqual(
    r.gruplar.map((g) => [g.nesil, g.durum, g.jvmSayisi]),
    [
      [7, 'ESIT', 2],
      [8, 'ESIT', 2],
    ],
  );
  const r8 = uygulamaKarsilastir('MUSTERI', d, { ortam: 'PROD', nesil: 8 });
  assert.deepEqual(
    r8.gruplar.map((g) => g.nesil),
    [8],
  );
  assert.equal(r8.sunucuSayisi, 2);
  // JVM nesli yoksa sunucu nesli kullanilir
  const d2 = detay([
    sunucu('OPJBAP01', 'PROD', 8, [jvm('MUSTERI', null, '-Xmx1g')]),
    sunucu('OPJBAP02', 'PROD', 8, [jvm('MUSTERI', 0, '-Xmx2g')]),
  ]);
  assert.equal(uygulamaKarsilastir('MUSTERI', d2, { ortam: 'PROD', nesil: 8 }).durum, 'FARKLI');
});

test('JK9 ortam suzgeci: PROD varsayilan; Production PROD sayilir; TUMU ortam basina gruplar', () => {
  const d = detay([
    sunucu('OPJBAP01', 'Production', 8, [jvm('MUSTERI', 8, '-Xmx4g')]),
    sunucu('OPJBAP02', 'PROD', 8, [jvm('MUSTERI', 8, '-Xmx4g')]),
    sunucu('OPJBAT01', 'TEST', 8, [jvm('MUSTERI-T', 8, '-Xmx1g')], { uygulama: 'MUSTERI-T' }),
    sunucu('OPJBAX01', null, 8, [jvm('MUSTERI', 8, '-Xmx9g')]),
  ]);
  const r = uygulamaKarsilastir('MUSTERI', d, { nesil: 'hepsi' });
  assert.equal(r.durum, 'ESIT', 'TEST ya da ortami bilinmeyen sunucu prod karsilastirmasina girdi');
  assert.equal(r.sunucuSayisi, 2);
  assert.ok(r.uyarilar.some((u) => /ortamı bilinmiyor/.test(u)));
  const t = uygulamaKarsilastir('MUSTERI', d, { ortam: 'TEST', nesil: 'hepsi' });
  assert.equal(t.durum, 'TEK_SUNUCU');
  const tumu = uygulamaKarsilastir('MUSTERI', d, { ortam: 'TUMU', nesil: 'hepsi' });
  assert.deepEqual(
    tumu.gruplar.map((g) => `${g.ortam}|${g.durum}`),
    ['BILINMIYOR|TEK_SUNUCU', 'PROD|ESIT', 'TEST|TEK_SUNUCU'],
  );
  const yok = uygulamaKarsilastir('MUSTERI', d, { ortam: 'QA', nesil: 'hepsi' });
  assert.equal(yok.durum, 'BULUNAMADI');
  assert.match(yok.neden, /QA/);
  // Server Hub okunamadiysa JVM'siz sonuc BULUNAMADI degil OLCULEMEDI
  const shYok = uygulamaKarsilastir(
    'MUSTERI',
    detay([sunucu('OPJBAP01', 'PROD', 8, [])], {
      kaynaklar: { serverHub: { hata: 'baglanti yok' } },
    }),
    { ortam: 'PROD', nesil: 'hepsi' },
  );
  assert.equal(shYok.durum, 'OLCULEMEDI');
});

test('JK10 calismayan JVM yapilandirilan argumanla; grup kaynagi tutarli', () => {
  const d = detay([
    sunucu('OPJBAP01', 'PROD', 8, [
      jvm('MUSTERI', 8, '-Xmx4g -Djboss.home.dir=/opt/jboss', { yapilandirilanJvmArgs: '-Xmx4g' }),
    ]),
    sunucu('OPJBAP02', 'PROD', 8, [
      jvm('MUSTERI', 8, null, { calisiyor: false, yapilandirilanJvmArgs: '-Xmx4g' }),
    ]),
  ]);
  const r = uygulamaKarsilastir('MUSTERI', d, { ortam: 'PROD', nesil: 'hepsi' });
  assert.equal(r.durum, 'ESIT', 'calisan + yapilandirilan karisimi sahte fark uretti');
  assert.deepEqual(
    r.gruplar[0].jvmler.map((j) => j.kaynak),
    ['YAPILANDIRILAN', 'YAPILANDIRILAN'],
  );
  // birinde yapilandirilan da yoksa: her biri kendi kaynagindan, karisik kaynak uyarisi
  d.sunucular[0].jvmler[0].yapilandirilanJvmArgs = null;
  const r2 = uygulamaKarsilastir('MUSTERI', d, { ortam: 'PROD', nesil: 'hepsi' });
  assert.deepEqual(
    r2.gruplar[0].jvmler.map((j) => j.kaynak),
    ['CALISAN', 'YAPILANDIRILAN'],
  );
  assert.ok(r2.gruplar[0].uyarilar.some((u) => /yapılandırmadan/.test(u)));
});

test('JK11 anahtar=deger ayristirma', () => {
  const h = argHaritasi(
    '--add-opens=b/y=ALL -Xmx2g -XX:+UseG1GC -XX:-Foo -XX:MaxMetaspaceSize=512m -cp /a/b.jar -Dk -Dk2=v -Dm=1 -Dm=2 --add-opens=java.base/java.lang=ALL -Xlog:gc*:file=x -server',
  );
  assert.equal(h.get('-Xmx'), '2g');
  assert.equal(h.get('-XX:UseG1GC'), '+');
  assert.equal(h.get('-XX:Foo'), '-');
  assert.equal(h.get('-XX:MaxMetaspaceSize'), '512m');
  assert.equal(h.get('-cp'), '/a/b.jar');
  assert.equal(h.get('-Dk'), '');
  assert.equal(h.get('-Dk2'), 'v');
  assert.equal(h.get('-Dm'), '2', 'tekrar eden -D: son yazilan etkin');
  assert.equal(
    h.get('--add-opens'),
    'b/y=ALL | java.base/java.lang=ALL',
    'cok degerli bayrak sirasiz birlesir',
  );
  assert.equal(h.get('-Xlog'), 'gc*:file=x');
  assert.equal(h.get('-server'), '');
  assert.ok(!h.has('/a/b.jar'));
  // -XX:+Foo ile -XX:-Foo ayni anahtarin deger farkidir
  const r = grupKarsilastir([uye('OPJBAP01', '-XX:+Foo'), uye('OPJBAP02', '-XX:-Foo')]);
  assert.equal(r.degerFarklari[0].anahtar, '-XX:Foo');
  // etkin deger son yazilan: -Xmx2g -Xmx4g (4g) ile -Xmx4g -Xmx2g (2g) esit DEGIL
  const t = grupKarsilastir([
    uye('OPJBAP01', '-Xmx2g -Xmx4g -XX:+UseG1GC -XX:-UseG1GC'),
    uye('OPJBAP02', '-Xmx4g -Xmx2g -XX:-UseG1GC -XX:+UseG1GC'),
  ]);
  assert.equal(t.durum, 'FARKLI');
  assert.deepEqual(
    t.degerFarklari.map((f) => f.anahtar),
    ['-XX:UseG1GC', '-Xmx'],
  );
  assert.ok(t.uyarilar.some((u) => /OPJBAP01\/MUSTERI: .*-Xmx.*son yazılan/.test(u)));
  // tekrar edip ayni etkin degere inen: esit
  assert.equal(
    grupKarsilastir([uye('OPJBAP01', '-Xmx2g -Xmx4g'), uye('OPJBAP02', '-Xmx4g')]).durum,
    'ESIT',
  );
});

test('JK13a girdi dogrulama (saf)', () => {
  const AD = /^[A-Za-z0-9._-]{1,128}$/;
  const g = girdiDogrula({ uygulamalar: ['musteri', 'MUSTERI', ' kredi ', ''] }, AD);
  assert.deepEqual(g, {
    ok: true,
    uygulamalar: ['musteri', 'kredi'],
    tabanlar: ['musteri', 'kredi'],
    ortam: 'PROD',
    nesil: 'hepsi',
  });
  // ayni tabana inen adlar (MUSTERI-T -> MUSTERI) tek kez
  const taban = (x) => x.replace(/-[DTQ]$/i, '');
  const t = girdiDogrula({ uygulamalar: ['MUSTERI-T', 'musteri', 'KREDI'] }, AD, taban);
  assert.deepEqual(
    [t.uygulamalar, t.tabanlar],
    [
      ['MUSTERI-T', 'KREDI'],
      ['MUSTERI', 'KREDI'],
    ],
  );
  // ortam yalniz kesifin urettigi kume (PRP / UAT uretilmez)
  for (const o of ['QA', 'TEST', 'DEV', 'ALPHA', 'ODM', 'TUMU', 'prd'])
    assert.equal(girdiDogrula({ uygulamalar: ['a'], ortam: o }, AD).ok, true, o);
  for (const o of ['PRP', 'UAT', 'BILINMIYOR'])
    assert.equal(girdiDogrula({ uygulamalar: ['a'], ortam: o }, AD).ok, false, o);
  assert.equal(
    girdiDogrula({ uygulamalar: ['a'], ortam: 'production', nesil: '7' }, AD).ortam,
    'PROD',
  );
  assert.equal(girdiDogrula({ uygulamalar: ['a'], nesil: '7' }, AD).nesil, 7);
  assert.equal(
    girdiDogrula({ uygulamalar: Array.from({ length: 20 }, (_, i) => `A${i}`) }, AD).ok,
    true,
  );
  assert.equal(girdiDogrula({ uygulamalar: [] }, AD).ok, false);
});

// ── Uc: sahte veri katmani ───────────────────────────────────────────────────
sahte(require.resolve('../../inventory/mssql.cjs'), {
  sql: { NVarChar: () => 'nvarchar' },
  query: async () => ({ recordset: [] }),
});
sahte(require.resolve('../../db/index.cjs'), { query: async () => ({ rows: [] }) });
sahte(require.resolve('../../auth/index.cjs'), {
  requireAdmin: (req, res, next) => {
    const u = req.session && req.session.user;
    if (!u) return res.status(401).json({ ok: false });
    if (u.role !== 'Admin') return res.status(403).json({ ok: false, error: 'admin gerekli' });
    next();
  },
});
sahte(require.resolve('../../auth/visibility.cjs'), {
  requireVisiblePrefix: () => (_q, _s, n) => n(),
});
const denetim = [];
sahte(require.resolve('../../audit/index.cjs'), {
  auditMutations: (onek) => (req, _s, n) => {
    if (req.method === 'POST') denetim.push({ onek, yol: req.path, govde: req.body });
    n();
  },
});
const gercekV = require('../veri.cjs');
const okunan = [];
const detaylar = new Map();
sahte(require.resolve('../veri.cjs'), {
  ...gercekV,
  jbossDetay: async (ad) => {
    okunan.push(ad);
    const d = detaylar.get(ad.toUpperCase());
    if (d instanceof Error) throw d;
    return d || null;
  },
});
const { createRouter, _ic: indexIc } = require('../index.cjs');

let kimlik = { username: 'onur', role: 'Admin' };
async function istek(govde) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, _r, n) => {
    req.session = kimlik ? { user: kimlik } : {};
    n();
  });
  app.use('/api/app-hub', createRouter());
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/app-hub/jvm-karsilastir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(govde),
    });
    return { status: r.status, body: await r.json() };
  } finally {
    srv.close();
  }
}

test('JK12 uc: Admin disi kullanici ulasamaz (jbossDetay okunmaz)', async () => {
  kimlik = { username: 'ayse', role: 'User' };
  okunan.length = 0;
  try {
    const r = await istek({ uygulamalar: ['MUSTERI'] });
    assert.notEqual(r.status, 200);
    assert.equal(r.body.upstreamStatus || r.status, 403);
    assert.equal(okunan.length, 0);
  } finally {
    kimlik = { username: 'onur', role: 'Admin' };
  }
});

test('JK13 uc: 21 uygulama 400, gecersiz ad 400, gecersiz ortam / nesil 400', async () => {
  okunan.length = 0;
  const cok = await istek({ uygulamalar: Array.from({ length: 21 }, (_, i) => `APP${i}`) });
  assert.equal(cok.status, 400);
  assert.match(cok.body.error, /20/);
  assert.equal((await istek({ uygulamalar: ['a;drop'] })).status, 400);
  assert.equal((await istek({ uygulamalar: 'MUSTERI' })).status, 400);
  assert.equal((await istek({ uygulamalar: ['MUSTERI'], ortam: 'P R O D' })).status, 400);
  assert.equal((await istek({ uygulamalar: ['MUSTERI'], nesil: 6 })).status, 400);
  assert.equal(okunan.length, 0, 'gecersiz istekte veri okundu');
});

test('JK14 uc: ozet, okunamayan uygulama OLCULEMEDI, denetim kaydi', async () => {
  indexIc._onbellek.clear();
  okunan.length = 0;
  denetim.length = 0;
  detaylar.set(
    'MUSTERI',
    detay([
      sunucu('OPJBAP01', 'PROD', 8, [jvm('MUSTERI', 8, '-Xmx4g -Da=1')]),
      sunucu('OPJBAP02', 'PROD', 8, [jvm('MUSTERI', 8, '-Xmx4g -Da=2')]),
    ]),
  );
  detaylar.set(
    'KREDI',
    detay(
      [
        sunucu('OPJBAP05', 'PROD', 8, [jvm('KREDI', 8, '-Xmx4g')]),
        sunucu('OPJBAP06', 'PROD', 8, [jvm('KREDI', 8, '-Xmx4g')]),
      ],
      { ad: 'KREDI' },
    ),
  );
  detaylar.set('BOZUK', new Error('TBMWANS zaman asimi'));
  const r = await istek({ uygulamalar: ['MUSTERI', 'KREDI', 'BOZUK', 'YOKAPP'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.ozet, {
    toplam: 4,
    ESIT: 1,
    FARKLI: 1,
    TEK_SUNUCU: 0,
    OLCULEMEDI: 1,
    BULUNAMADI: 1,
  });
  assert.deepEqual(
    r.body.uygulamalar.map((u) => `${u.ad}:${u.durum}`),
    ['MUSTERI:FARKLI', 'KREDI:ESIT', 'BOZUK:OLCULEMEDI', 'YOKAPP:BULUNAMADI'],
  );
  assert.match(r.body.uygulamalar[2].neden, /zaman asimi/);
  assert.equal(r.body.ortam, 'PROD');
  // salt okunur yanit: JVM argumani metni sonuca tasinmaz (yalniz fark ayrintisi)
  assert.ok(!('args' in r.body.uygulamalar[0].gruplar[0].jvmler[0]));
  assert.deepEqual(
    denetim.map((d) => [d.onek, d.yol]),
    [['app_hub', '/jvm-karsilastir']],
  );
  assert.deepEqual(denetim[0].govde.uygulamalar, ['MUSTERI', 'KREDI', 'BOZUK', 'YOKAPP']);
  // ayni uygulama 60 sn icinde yeniden istenirse tek uygulama ekraniyla ayni onbellekten okunur
  okunan.length = 0;
  await istek({ uygulamalar: ['MUSTERI'] });
  assert.equal(okunan.length, 0);
  await istek({ uygulamalar: ['MUSTERI'], fresh: true });
  assert.deepEqual(okunan, ['MUSTERI']);
  // MUSTERI-T ve MUSTERI ayni taban: tek okuma (taban adla), son ek kullaniciya not
  okunan.length = 0;
  const t = await istek({ uygulamalar: ['MUSTERI-T', 'MUSTERI'], fresh: true });
  assert.deepEqual(okunan, ['MUSTERI']);
  assert.deepEqual(
    t.body.uygulamalar.map((u) => u.ad),
    ['MUSTERI-T'],
  );
  assert.match(t.body.uygulamalar[0].uyarilar[0], /taban adla \(MUSTERI\)/);
});

test("JK15 kesik arguman: ...+N belirtec degil; kesik JVM'de olmayan anahtar eksik sayilmaz", () => {
  const r = grupKarsilastir([
    uye('OPJBAP01', '-Xmx4g -Dx=1 -Dy=2 ...+3'),
    uye('OPJBAP02', '-Xmx4g -Dx=1 ...+4'),
    uye('OPJBAP03', '-Xmx4g -Dx=1 -Dy=2 -Dz=1'),
  ]);
  assert.equal(r.durum, 'ESIT', JSON.stringify(r.eksikFazla));
  assert.ok(!r.eksikFazla.some((x) => /^\.\.\./.test(x.anahtar)));
  assert.deepEqual(
    r.karsilastirilamadi.map((x) => [x.anahtar, x.kesik.join(',')]),
    [
      ['-Dy', 'OPJBAP02/MUSTERI'],
      ['-Dz', 'OPJBAP01/MUSTERI,OPJBAP02/MUSTERI'],
    ],
  );
  assert.ok(r.uyarilar.some((u) => /kesilmiş/.test(u)));
  // tam metinli JVM'de olmayan anahtar yine eksik/fazla (kesik olan da sahip olsa)
  const f = grupKarsilastir([uye('OPJBAP01', '-Xmx4g -Dfazla=1 ...+2'), uye('OPJBAP02', '-Xmx4g')]);
  assert.equal(f.durum, 'FARKLI');
  assert.deepEqual(
    f.eksikFazla.map((x) => [x.anahtar, x.olmayan.join(',')]),
    [['-Dfazla', 'OPJBAP02/MUSTERI']],
  );
  // kesik iki JVM'de ortak anahtarin deger farki yine fark
  assert.equal(
    grupKarsilastir([uye('OPJBAP01', '-Xmx4g ...+2'), uye('OPJBAP02', '-Xmx8g ...+2')]).durum,
    'FARKLI',
  );
  // yalniz belirtec kalan metin olculemedi sayilir
  assert.equal(
    grupKarsilastir([uye('OPJBAP01', '...+40'), uye('OPJBAP02', '-Xmx4g')]).durum,
    'OLCULEMEDI',
  );
});

test('JK16 normallestirme belirtec sinirinda, JVM adi harf duyarli; ham/normal cogunluk catisirsa belirsiz', () => {
  const a = uye('OPJBAP01', '');
  assert.equal(
    normallestir('/x/GOJBAP011/y', a),
    '/x/GOJBAP011/y',
    'host adi daha uzun adin icinde degistirildi',
  );
  assert.equal(normallestir('opjbap01.corp', a), '<HOST>.corp');
  assert.equal(normallestir('musteri', a), 'musteri');
  assert.equal(normallestir('MUSTERI2', a), 'MUSTERI2');
  assert.equal(normallestir('10.0.0.10', { ...a, ip: '10.0.0.1' }), '10.0.0.10');
  const m = grupKarsilastir([uye('OPJBAP01', '-Dmode=musteri'), uye('OPJBAP02', '-Dmode=MUSTERI')]);
  assert.equal(m.durum, 'FARKLI');
  // -Dmaster=OPJBAP01 uc sunucuda; OPJBAP03 kendini gosteriyor: OPJBAP02 sapan diye suclanmamali
  const r = grupKarsilastir([
    uye('OPJBAP01', '-Dmaster=OPJBAP01'),
    uye('OPJBAP02', '-Dmaster=OPJBAP01'),
    uye('OPJBAP03', '-Dmaster=OPJBAP03'),
  ]);
  assert.equal(r.durum, 'FARKLI');
  assert.equal(r.degerFarklari[0].cogunluk, null);
  assert.equal(r.degerFarklari[0].belirsiz, true);
  assert.equal(r.degerFarklari[0].sapanlar.length, 3);
  // catisma yoksa cogunluk korunur (JK4 ile ayni yol)
  const n = grupKarsilastir([
    uye('OPJBAP01', '-Dlog=/l/OPJBAP01'),
    uye('OPJBAP02', '-Dlog=/l/OPJBAP02'),
    uye('OPJBAP03', '-Dlog=/k/OPJBAP03'),
  ]);
  assert.equal(n.degerFarklari[0].cogunluk, '/l/<HOST>');
  assert.equal(n.degerFarklari[0].belirsiz, false);
});

test('JK17 ortam: taninmayan etiket ve kesif hatasi uyarida; Server Hub hatasi neden metninde', () => {
  const d = detay(
    [
      sunucu('OPJBAP01', 'PROD', 8, [jvm('MUSTERI', 8, '-Xmx4g')]),
      sunucu('OPJBAP02', 'PROD', 8, [jvm('MUSTERI', 8, '-Xmx4g')]),
      sunucu('OPJBAP03', 'P', 8, [jvm('MUSTERI', 8, '-Xmx8g')]),
    ],
    { kaynaklar: { serverHub: { hata: null }, kesif: { hata: 'zaman asimi' } } },
  );
  const r = uygulamaKarsilastir('MUSTERI', d, { ortam: 'PROD', nesil: 'hepsi' });
  assert.equal(r.durum, 'ESIT');
  assert.ok(
    r.uyarilar.some((u) => /tanınmadı \(P\)/.test(u)),
    JSON.stringify(r.uyarilar),
  );
  assert.ok(r.uyarilar.some((u) => /Keşif okunamadı/.test(u)));
  const tumu = uygulamaKarsilastir('MUSTERI', d, { ortam: 'TUMU', nesil: 'hepsi' });
  assert.deepEqual(
    tumu.gruplar.map((g) => g.ortam),
    ['BILINMIYOR', 'PROD'],
  );
  const sh = uygulamaKarsilastir(
    'MUSTERI',
    detay(
      [
        sunucu('OPJBAP01', 'PROD', 8, [jvm('MUSTERI', 8, null)]),
        sunucu('OPJBAP02', 'PROD', 8, [jvm('MUSTERI', 8, null)]),
      ],
      { kaynaklar: { serverHub: { hata: 'TBMWANS baglanti yok' } } },
    ),
    { ortam: 'PROD', nesil: 'hepsi' },
  );
  assert.equal(sh.durum, 'OLCULEMEDI');
  assert.match(sh.gruplar[0].neden, /Server Hub okunamadı: TBMWANS/);
});
