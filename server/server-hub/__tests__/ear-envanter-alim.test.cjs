// server/server-hub/__tests__/ear-envanter-alim.test.cjs - Uygulama Envanteri alimi (/sw -> DB).
//
//   EA1  SOZLESME: gercek ear_tara.py ciktisi paketCoz + hostKaydi'dan gecer; alan adlari tutar
//        (class, kutuphaneler, ear_kutuphaneleri, baslangic_utc), surum OZGUN harfle, teknoloji cikar
//   EA2  paketCoz: isaret yok -> PAKET_YOK, kesik base64 -> BOZUK, sema disi -> SEMA,
//        acilinca sinir ustu -> COK_BUYUK (bellege alinmadan)
//   EA3  teknoloji: Boot 3+ / Framework 6+ jakarta, eskisi javax, jar adi oncelikli, ikisi -> karisik;
//        ayni adda iki surum birlesir (gizlenmez); log4j 1.x ve 2.x ayni kolonda
//   EA4  kutuphane seti: sira bagimsiz iz; surum ya da boyut farki izi degistirir; bos liste -> null
//   EA5  hostKaydi: agac satirlari ALINMAZ; KOK_YOK veri sayilir; sinir ustu uygulama sayisinda host
//        TAM gorunmez; 'Z' atilmis UTC; JBoss nesli kokten; metinler kolon boyunda kirpilir
//   EA6  hostuYaz: yalniz DB'de olmayan setlerin satirlari gider; tek batch, transaction, HOLDLOCK
//   EA7  earDizin: bos / goreli / '..' / '/' / '/sw' -> varsayilan (silme koku olarak secilemez)
//   EA8  hamOku: sinir ustu dosya OKUNMADAN reddedilir; yok -> DOSYA_YOK
//   EA9  SEMA SOZLESMESI: alimin OPENJSON WITH kolonlari mssql-setup DDL'inde ayni adla var
//   EA10 AWX kosusunun alt dizini awx-<is> (parametrelerdeki is no); hamDosyaYolu disari cikamaz
//   EA11 SESSIZ KESILME YOK: 201 WAR / 2001 kutuphane -> uygulama KISMI_SINIR + uyari, host KISMI,
//        war_sayisi GERCEK sayi; set satiri surum izini (boyutsuz) tasir
//   EA12 TARAYICI SURUM 2: kok girdileri, XML ozeti ve EAR -> JVM eslemesi JSON kolonlara duzlenir;
//        alan yoksa (eski tarayici) NULL = olculmedi; bilinmeyen durum OLCULEMEDI; yalniz bilinen
//        alanlar secilir (fazladan alan DB'ye gitmez); sinirlar uygulanir, kesilme yazilir
//   EA13 FAZ 2: deployment blogu (JBoss CLI DMR ciktisi) -> deployment_ozeti; blok yoksa NULL; failed
//        outcome HATA; DMR olmayan metin AYRISTIRILAMADI; kesik blok isaretlenir; bilinmeyen durum HATA
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const alim = require('../ear-envanter-alim.cjs');
const F = require('./fixtures/ear-envanter.cjs');

const TARAYICI = path.join(
  __dirname,
  '..',
  '..',
  'ansible',
  'bmw_portal',
  'ear_envanter',
  'files',
  'ear_tara.py',
);
const PY = ['python3', '/usr/libexec/platform-python'].find(
  (p) =>
    spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 6) else 1)']).status ===
    0,
);

function dosya(p, boyut = 16) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const fd = fs.openSync(p, 'w');
  fs.ftruncateSync(fd, boyut);
  fs.closeSync(fd);
}

test(
  'EA1 SOZLESME: gercek tarayici ciktisi alimdan gecer',
  { skip: PY ? false : 'python3 yok' },
  () => {
    const kok = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ear-alim-')));
    const war = path.join(kok, 'vhosting8', 'ORNEKPANEL.ear', 'ORNEKPANEL.war');
    dosya(path.join(war, 'WEB-INF', 'web.xml'));
    dosya(path.join(war, 'WEB-INF', 'web.prod.xml'));
    dosya(path.join(war, 'WEB-INF', 'lib', 'spring-boot-4.0.8.jar'), 1000);
    dosya(path.join(war, 'WEB-INF', 'lib', 'spring-core-7.0.9.jar'), 900);
    dosya(path.join(war, 'WEB-INF', 'lib', 'thymeleaf-3.1.5.RELEASE.jar'), 800);
    dosya(path.join(war, 'index.jsp'));
    dosya(path.join(kok, 'vhosting8', 'ORNEKPANEL.ear', 'META-INF', 'application.xml'));
    dosya(path.join(kok, 'vhosting8', 'ORNEKPANEL.ear.old'), 77);
    const yap = path.join(kok, 'usr', 'jboss8', 'AppServer', 'domain', 'configuration');
    fs.mkdirSync(yap, { recursive: true });
    fs.writeFileSync(
      path.join(yap, 'domain.xml'),
      `<domain xmlns="urn:jboss:domain:20.0"><deployments><deployment name="ORNEKPANEL.ear" runtime-name="ORNEKPANEL.ear"><fs-exploded path="${kok}/vhosting8/ORNEKPANEL.ear"/></deployment></deployments>` +
        '<server-groups><server-group name="g1" profile="full"><deployments><deployment name="ORNEKPANEL.ear" runtime-name="ORNEKPANEL.ear"/></deployments></server-group></server-groups></domain>',
    );
    fs.writeFileSync(
      path.join(yap, 'host.xml'),
      '<host name="primary" xmlns="urn:jboss:domain:20.0"><servers><server name="ORNEKPANEL_JVM" group="g1" auto-start="false"/></servers></host>',
    );
    const r = spawnSync(PY, ['-B', '-'], {
      input: fs.readFileSync(TARAYICI),
      env: {
        PATH: process.env.PATH,
        LC_ALL: 'C',
        PYTHONIOENCODING: 'utf-8:surrogateescape',
        EAR_KIP: 'TAM',
        EAR_KOKLER: `${kok}/vhosting:${kok}/vhosting8`,
        EAR_JBOSS: `${kok}/usr/jboss/AppServer:${kok}/usr/jboss8/AppServer`,
      },
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(r.status, 0, String(r.stderr));
    const yuk = alim.paketCoz(r.stdout);
    const k = alim.hostKaydi(yuk, {
      host: 'APPSRV01',
      kip: 'TAM',
      partiNo: 1,
      ortam: 'PROD',
      playbookDurum: 'SONUC',
      hamBayt: r.stdout.length,
    });
    assert.equal(k.host.veri_var, 1);
    assert.equal(k.host.durum, 'TAM');
    assert.equal(k.uygulamalar.length, 1);
    const u = k.uygulamalar[0];
    assert.equal(u.jboss, '8');
    assert.equal(u.application_xml, 1);
    assert.equal(u.spring_boot, '4.0.8');
    assert.equal(u.servlet, 'jakarta');
    const w = k.warlar[0];
    assert.equal(w.jsp, 1, 'jsp sayisi gelmedi (alan adi kaydi?)');
    assert.equal(w.jar, 3);
    assert.ok(w.class_sayisi >= 0);
    assert.equal(w.web_xml, 1);
    assert.equal(w.web_varyantlari, 'prod');
    assert.equal(w.thymeleaf, '3.1.5.RELEASE', 'surum ozgun harfle gelmeli');
    assert.ok(w.kutuphane_seti && w.kutuphane_seti.length === 32);
    assert.equal(k.setler.get(w.kutuphane_seti).length, 3);
    assert.match(String(k.host.taranma_utc), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
    assert.ok(!('satirlar' in u), 'agac satirlari DB kaydina girmemeli');
    // Surum 2 alanlari (alan adi kaymasi burada yakalanir).
    const x = JSON.parse(u.xml_eslesme);
    assert.equal(x.durum, 'VAR');
    assert.deepEqual(
      x.jvmler.map((j) => [j.ad, j.grup, j.auto_start]),
      [['ORNEKPANEL_JVM', 'g1', false]],
    );
    assert.equal(x.deploymentlar[0].yontem, 'YOL');
    const kg = JSON.parse(k.host.kok_girdileri);
    assert.deepEqual(
      kg.girdiler.map((g) => [g.ad, g.tip, g.boyut]),
      [['ORNEKPANEL.ear.old', 'F', 77]],
    );
    assert.equal(kg.kesilen, 0);
    const xo = JSON.parse(k.host.xml_ozeti);
    assert.deepEqual(
      xo.map((z) => [z.nesil, z.domain, z.host]),
      [
        ['7', 'YOK', 'YOK'],
        ['8', 'OKUNDU', 'OKUNDU'],
      ],
    );
    assert.equal(xo[1].sunucular[0].ad, 'ORNEKPANEL_JVM');
    assert.equal(xo[1].host_adi, 'primary');
  },
);

test('EA2 paketCoz hata siniflari', () => {
  assert.throws(
    () => alim.paketCoz(Buffer.from('hicbir sey yok')),
    (e) => e.kod === 'PAKET_YOK',
  );
  assert.throws(
    () => alim.paketCoz(F.paketYap(F.ornekYuk(), { bozukBase64: true })),
    (e) => e.kod === 'BOZUK',
  );
  assert.throws(
    () => alim.paketCoz(F.paketYap({ sema: 2, uygulamalar: [] })),
    (e) => e.kod === 'SEMA',
  );
  assert.equal(alim.paketCoz(F.paketYap(F.ornekYuk())).host, 'appsrv01.ornek.local');
  // 70 MB'lik metin sikistirilinca kucuk; acilinca 64 MB sinirini asar -> bellege alinmaz.
  const zlib = require('node:zlib');
  const dev = zlib.deflateSync(Buffer.alloc(70 * 1024 * 1024, 0x20)).toString('base64');
  assert.throws(
    () => alim.paketCoz(Buffer.from(`@@EAR_ENVANTER_BASLA@@\n${dev}\n@@EAR_ENVANTER_BITTI@@\n`)),
    (e) => e.kod === 'COK_BUYUK',
  );
});

test('EA3 teknoloji kolonlari', () => {
  const t = alim.teknoloji;
  assert.equal(t([['spring-boot', '3.2.1', 1]]).servlet, 'jakarta');
  assert.equal(t([['spring-core', '5.3.39', 1]]).servlet, 'javax');
  assert.equal(t([['spring-core', '6.1.0', 1]]).servlet, 'jakarta');
  assert.equal(
    t([
      ['javax.servlet-api', '4.0.1', 1],
      ['spring-core', '6.1.0', 1],
    ]).servlet,
    'javax',
    'jar adi cikarimdan once gelir',
  );
  assert.equal(
    t([
      ['javax.servlet-api', '4.0.1', 1],
      ['jakarta.annotation-api', '2.1.1', 1],
    ]).servlet,
    'karisik',
  );
  assert.equal(t([]).servlet, null);
  assert.equal(
    t([
      ['spring-core', '5.3.39', 1],
      ['spring-core', '5.3.20', 1],
    ]).spring_framework,
    '5.3.20, 5.3.39',
  );
  assert.equal(
    t([
      ['log4j', '1.2.17', 1],
      ['log4j-core', '2.17.1', 1],
    ]).log4j,
    '1.2.17, 2.17.1',
  );
  assert.equal(t([['logback-classic', '1.5.18', 1]]).logback, '1.5.18');
  assert.equal(t([['struts2-core', '2.5.33', 1]]).struts, '2.5.33');
});

test('EA4 kutuphane seti izi', () => {
  const a = alim.kutuphaneSeti([
    ['b', '1', 10],
    ['a', '2', 20],
  ]);
  const b = alim.kutuphaneSeti([
    ['a', '2', 20],
    ['b', '1', 10],
  ]);
  assert.equal(a.iz, b.iz, 'sira izi degistirmemeli');
  assert.equal(a.iz.length, 32);
  assert.notEqual(
    alim.kutuphaneSeti([
      ['a', '3', 20],
      ['b', '1', 10],
    ]).iz,
    a.iz,
  );
  assert.notEqual(
    alim.kutuphaneSeti([
      ['a', '2', 21],
      ['b', '1', 10],
    ]).iz,
    a.iz,
  );
  assert.equal(alim.kutuphaneSeti([]), null);
  assert.deepEqual(a.satirlar[0], ['a', '2', 20]);
});

test('EA5 hostKaydi duzleme kurallari', () => {
  const k = alim.hostKaydi(F.ornekYuk(), {
    host: 'APPSRV01',
    kip: 'TAM',
    partiNo: 2,
    ortam: 'PROD',
    playbookDurum: 'SONUC',
    hamBayt: 99,
  });
  assert.equal(k.host.taranma_utc, '2026-11-04T10:00:00');
  assert.equal(k.host.parti_no, 2);
  assert.equal(k.uygulamalar[0].jboss, '8');
  assert.equal(k.warlar[0].log4j, '2.24.3');
  assert.equal(k.warlar[0].web_varyantlari, 'prod,test');
  assert.ok(!JSON.stringify(k.uygulamalar).includes('index.jsp'), 'agac satiri sizdi');

  const kokYok = alim.hostKaydi(F.ornekYuk({ durum: 'KOK_YOK', uygulamalar: [] }), {
    host: 'H',
    kip: 'OZET',
    partiNo: 1,
  });
  assert.equal(kokYok.host.veri_var, 1, 'KOK_YOK bir cevaptir');
  assert.equal(kokYok.host.durum, 'KOK_YOK');

  const cok = F.ornekYuk({
    uygulamalar: Array.from({ length: 2001 }, (_, i) =>
      F.ornekUygulama({ ad: `A${i}.ear`, warlar: [] }),
    ),
  });
  const kc = alim.hostKaydi(cok, { host: 'H', kip: 'OZET', partiNo: 1 });
  assert.equal(kc.uygulamalar.length, 2000);
  assert.equal(kc.host.durum, 'KISMI', 'kesilen host TAM gorunmemeli');
  assert.match(kc.host.uyarilar, /2001/);

  const uzun = alim.hostKaydi(
    F.ornekYuk({ uygulamalar: [F.ornekUygulama({ ad: 'x'.repeat(1000) })] }),
    { host: 'H', kip: 'TAM', partiNo: 1 },
  );
  assert.equal(uzun.uygulamalar[0].ad.length, 256);
  assert.equal(alim.jbossOf('/vhosting'), '7');
  assert.equal(alim.jbossOf('/vhosting8/'), '8');
  assert.equal(alim.jbossOf('/opt/x'), '?');
});

test('EA6 hostuYaz: yalniz eksik setlerin satirlari, tek transaction', async () => {
  const k = alim.hostKaydi(
    F.ornekYuk({
      uygulamalar: [
        F.ornekUygulama({
          warlar: [F.ornekWar(), F.ornekWar({ ad: 'B.war', kutuphaneler: [['x', '1', 1]] })],
        }),
      ],
    }),
    { host: 'APPSRV01', kip: 'TAM', partiNo: 1 },
  );
  const izler = [...k.setler.keys()];
  assert.equal(izler.length, 2);
  const db = F.sahteDb([
    [/FROM ear_envanter_kutuphane_setleri WHERE iz IN/, () => ({ rows: [{ iz: `${izler[0]}` }] })],
  ]);
  const r = await alim.hostuYaz(db.mod, 7, 'APPSRV01', k);
  assert.equal(r.yeniSet, 1);
  const yaz = db.cagrilar.find((c) => c.sql === alim.HOST_YAZ_SQL);
  assert.ok(yaz);
  const setSatirlari = JSON.parse(yaz.params[6]);
  assert.ok(
    setSatirlari.every((s) => s.iz === izler[1]),
    "DB'de olan set yeniden yazildi",
  );
  assert.equal(JSON.parse(yaz.params[5]).length, 1);
  assert.match(alim.HOST_YAZ_SQL, /SET XACT_ABORT ON;\s*BEGIN TRAN;/);
  assert.match(alim.HOST_YAZ_SQL, /COMMIT;\s*$/);
  assert.match(alim.HOST_YAZ_SQL, /WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.match(alim.HOST_YAZ_SQL, /JOIN @yeni y ON y\.iz = k\.iz/);
  assert.match(
    alim.HOST_YAZ_SQL,
    /DELETE FROM ear_envanter_warlari WHERE kosu_id = \$1 AND host = \$2;/,
  );
});

test('EA7 earDizin silme koku olamaz', () => {
  const v = alim.VARSAYILAN_DIZIN;
  assert.equal(alim.earDizin({}), v);
  for (const kotu of ['/', '/sw', 'sw/x', '/sw/../etc', '/sw/x y', '/ sw/x'])
    assert.equal(alim.earDizin({ EAR_ENVANTER_DIR: kotu }), v, kotu);
  assert.equal(alim.earDizin({ EAR_ENVANTER_DIR: '/sw/ORNEK/ear/' }), '/sw/ORNEK/ear');
  assert.throws(
    () => alim.hamDosyaYolu(v, 1, '../x'),
    (e) => e.kod === 'GECERSIZ',
  );
  assert.equal(alim.hamDosyaYolu('/sw/a/b', 12, 'appsrv01'), '/sw/a/b/kosu-12/raw/APPSRV01.out');
});

test('EA10 AWX kosusunun alt dizini awx-<is>; yol disari cikamaz', () => {
  assert.equal(alim.kosuAltDizini({ id: 12, kaynak: 'ELLE' }), 'kosu-12');
  assert.equal(alim.kosuAltDizini({ id: 12, kaynak: 'ZAMANLAYICI' }), 'kosu-12');
  const awx = { id: 12, kaynak: 'AWX', parametreler: JSON.stringify({ awx_job_id: 777 }) };
  assert.equal(alim.kosuAltDizini(awx), 'awx-777');
  assert.equal(
    alim.hamDosyaYolu('/sw/a/b', alim.kosuAltDizini(awx), 'appsrv01'),
    '/sw/a/b/awx-777/raw/APPSRV01.out',
  );
  for (const p of ['{}', '{"awx_job_id":"1/../x"}', 'bozuk', '{"awx_job_id":0}'])
    assert.throws(
      () => alim.kosuAltDizini({ id: 12, kaynak: 'AWX', parametreler: p }),
      (e) => e.kod === 'GECERSIZ',
      p,
    );
  for (const kotu of ['awx-', 'awx-1/../x', '../kosu-1', 'kosu-1x', 'baska-1'])
    assert.throws(
      () => alim.hamDosyaYolu('/sw/a/b', kotu, 'APPSRV01'),
      (e) => e.kod === 'GECERSIZ',
      kotu,
    );
});

test('EA8 hamOku boyut kapisi', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ear-ham-'));
  const buyuk = path.join(d, 'B.out');
  const fd = fs.openSync(buyuk, 'w');
  fs.ftruncateSync(fd, alim.HAM_SINIR + 1);
  fs.closeSync(fd);
  await assert.rejects(alim.hamOku(buyuk), (e) => e.kod === 'COK_BUYUK');
  await assert.rejects(alim.hamOku(path.join(d, 'yok.out')), (e) => e.kod === 'DOSYA_YOK');
  fs.writeFileSync(path.join(d, 'K.out'), 'x');
  assert.equal((await alim.hamOku(path.join(d, 'K.out'))).length, 1);
});

test('EA9 SEMA SOZLESMESI: OPENJSON WITH kolonlari DDL ile ayni', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  const ddl = (tablo) => {
    const m = new RegExp(`CREATE TABLE ${tablo} \\(([\\s\\S]*?)\\n\\s*\\)\``).exec(kaynak);
    assert.ok(m, `${tablo} DDL yok`);
    return new Map(
      m[1]
        .split('\n')
        .map((s) => s.trim().replace(/,$/, ''))
        .filter((s) => /^[a-z_][a-z0-9_]*\s+[A-Z]/.test(s))
        .map((s) => [s.split(/\s+/)[0], s.split(/\s+/)[1]]),
    );
  };
  const insertKolonlari = (tablo) => {
    const m = new RegExp(`INSERT INTO ${tablo} \\(([^)]*)\\)`).exec(alim.HOST_YAZ_SQL);
    assert.ok(m, `${tablo} INSERT yok`);
    return m[1].split(',').map((s) => s.trim());
  };
  const kontrol = {
    ear_envanter_hostlari: 'ear_envanter_hostlari',
    ear_envanter_uygulamalari: 'ear_envanter_uygulamalari',
    ear_envanter_warlari: 'ear_envanter_warlari',
    ear_envanter_kutuphane_setleri: 'ear_envanter_kutuphane_setleri',
    ear_envanter_set_kutuphaneleri: 'ear_envanter_set_kutuphaneleri',
  };
  let toplam = 0;
  for (const t of Object.values(kontrol)) {
    const d = ddl(t);
    for (const k of insertKolonlari(t)) {
      assert.ok(d.has(k), `${t}.${k} DDL'de yok`);
      toplam += 1;
    }
  }
  assert.ok(toplam >= 60, `kontrol edilen kolon az (${toplam}); ayristirma kor`);
  // WITH tipleri DDL tipleriyle ayni (NVARCHAR(24) -> NVARCHAR(24)): sessiz kirpma olmasin.
  const withler = [
    ...alim.HOST_YAZ_SQL.matchAll(
      /INSERT INTO (\w+) \(([^)]*)\)\s*SELECT \$1, \$2, j\.\* FROM OPENJSON\(\$\d\) WITH \(([^;]*)\) j;/g,
    ),
  ];
  assert.equal(withler.length, 3);
  for (const [, t, , w] of withler) {
    const d = ddl(t);
    for (const parca of w.split(/,\s*(?![^(]*\))/)) {
      const [ad, tip] = parca.trim().split(/\s+/);
      assert.equal(tip, d.get(ad), `${t}.${ad}: WITH ${tip}, DDL ${d.get(ad)}`);
    }
  }
});

test('EA11 kesilme isaretlenir; surum izi yazilir', async () => {
  const cok = Array.from({ length: alim.SINIR_WAR + 1 }, (_, i) => F.ornekWar({ yol: `W${i}.war`, ad: `W${i}.war` }));
  const k = alim.hostKaydi(
    F.ornekYuk({ uygulamalar: [F.ornekUygulama({ warlar: cok })] }),
    { host: 'APPSRV01', kip: 'TAM', partiNo: 1 },
  );
  const u = k.uygulamalar[0];
  assert.equal(u.durum, 'KISMI_SINIR');
  assert.equal(u.war_sayisi, alim.SINIR_WAR + 1, 'gercek WAR sayisi');
  assert.equal(k.warlar.length, alim.SINIR_WAR);
  assert.match(JSON.parse(u.uyarilar)[0], /WAR sayısı 201; ilk 200 alındı/);
  assert.equal(k.host.durum, 'KISMI', 'eksik uygulamali host TAM gorunmez');

  const libler = Array.from({ length: alim.SINIR_KUTUPHANE + 1 }, (_, i) => [`lib${i}`, '1.0', 10]);
  const k2 = alim.hostKaydi(
    F.ornekYuk({ uygulamalar: [F.ornekUygulama({ warlar: [F.ornekWar({ kutuphaneler: libler })] })] }),
    { host: 'APPSRV01', kip: 'TAM', partiNo: 1 },
  );
  assert.equal(k2.warlar[0].durum, 'KISMI_SINIR');
  assert.equal(k2.warlar[0].kutuphane_sayisi, alim.SINIR_KUTUPHANE + 1, 'gercek kutuphane sayisi');
  assert.equal(k2.uygulamalar[0].durum, 'KISMI_SINIR');
  assert.match(JSON.parse(k2.uygulamalar[0].uyarilar)[0], /kütüphane sayısı 2001; ilk 2000 alındı/);
  const tamK = alim.hostKaydi(F.ornekYuk(), { host: 'APPSRV01', kip: 'TAM', partiNo: 1 });
  assert.equal(tamK.uygulamalar[0].durum, 'TAM', 'sinir altinda durum degismez');

  const a = alim.kutuphaneSeti([['x', '1', 5], ['y', '2', 7]]);
  const b = alim.kutuphaneSeti([['y', '2', 8], ['x', '1', 5]]);
  assert.notEqual(a.iz, b.iz, 'boyut izi degistirir');
  assert.equal(a.surumIzi, b.surumIzi, 'surum izi boyuttan bagimsiz');
  assert.notEqual(a.surumIzi, alim.kutuphaneSeti([['x', '1', 5], ['y', '3', 7]]).surumIzi);
  const db = F.sahteDb([]);
  await alim.hostuYaz(db.mod, 7, 'APPSRV01', tamK);
  const yaz = db.cagrilar.find((c) => c.sql === alim.HOST_YAZ_SQL);
  const setler = JSON.parse(yaz.params[5]);
  assert.ok(setler.length && setler.every((x) => /^[0-9a-f]{32}$/.test(x.surum_izi)));
  assert.match(alim.HOST_YAZ_SQL, /INSERT INTO ear_envanter_kutuphane_setleri \(iz, sayi, surum_izi\)/);
});

test('EA12 surum 2 alanlari: kok girdileri, XML ozeti, EAR -> JVM eslemesi', () => {
  const p = { sema: 1, durum: 'TAM', kokler: [], uyarilar: [], uygulamalar: [] };
  const kayit = (ek, uygEk = {}) =>
    alim.hostKaydi(
      {
        ...p,
        ...ek,
        uygulamalar: [{ kok: '/vhosting', ad: 'A.ear', bicim: 'ACIK', durum: 'TAM', warlar: [], ...uygEk }],
      },
      { host: 'APPSRV01', kip: 'OZET', partiNo: 1, ortam: 'PROD', playbookDurum: 'SONUC', hamBayt: 10 },
    );

  // Eski tarayici: alanlar yok -> NULL (olculmedi), bos liste DEGIL.
  const eski = kayit({});
  assert.equal(eski.host.kok_girdileri, null);
  assert.equal(eski.host.xml_ozeti, null);
  assert.equal(eski.uygulamalar[0].xml_eslesme, null);
  assert.equal(alim.bosHostKaydi({ partiNo: 1, durum: 'HATA' }).host.xml_ozeti, null);

  // Bos ama olculmus: [] -> JSON (yok demek), null degil.
  const bos = kayit({ kok_girdileri: [], kok_girdisi_kesilen: 0, yapilandirma: [] });
  assert.deepEqual(JSON.parse(bos.host.kok_girdileri), { girdiler: [], kesilen: 0 });
  assert.deepEqual(JSON.parse(bos.host.xml_ozeti), []);

  // Yalniz bilinen alanlar; bilinmeyen durum / tip guvenli degere duser.
  const k = kayit(
    {
      kok_girdileri: [
        { kok: '/vhosting', ad: 'X.ear.bak', tip: 'F', boyut: 12, mtime: 1700000000, hedef: '', fazla: 'SIZMA' },
        { kok: '/vhosting', ad: 'Y', tip: 'Q', boyut: 'abc', mtime: -5 },
      ],
      kok_girdisi_kesilen: 3,
      yapilandirma: [
        {
          kurulum: '/usr/jboss/AppServer',
          nesil: '7',
          domain: 'OKUNDU',
          host: 'TUHAF',
          sunucular: [{ ad: 'J1', grup: 'g', auto_start: false, parola: 'SIZMA' }, { ad: 'J2', grup: 'g' }],
          gruplar: [{ ad: 'g', deploymentlar: [{ ad: 'A.ear', acik: false }] }],
          deploymentlar: [{ ad: 'A.ear', tur: 'ACIK', yol: '/vhosting/A.ear', sha1: 'SIZMA' }],
          ozellikler: { sifre: 'SIZMA' },
        },
      ],
    },
    {
      xml_eslesme: {
        durum: 'VAR',
        deploymentlar: [{ kurulum: '/usr/jboss/AppServer', ad: 'A.ear', tur: 'ACIK', yol: '/vhosting/A.ear', yontem: 'YOL', gruplar: [{ ad: 'g', acik: false }] }],
        jvmler: [{ ad: 'J1', grup: 'g', auto_start: false, deployment_acik: false, kurulum: '/usr/jboss/AppServer', gizli: 'SIZMA' }],
      },
    },
  );
  for (const v of [k.host.kok_girdileri, k.host.xml_ozeti, k.uygulamalar[0].xml_eslesme])
    assert.ok(!v.includes('SIZMA'), `bilinmeyen alan DB'ye gitti: ${v.slice(0, 200)}`);
  const kg = JSON.parse(k.host.kok_girdileri);
  assert.deepEqual(kg.girdiler[1], { kok: '/vhosting', ad: 'Y', tip: '?', boyut: null, mtime: 0, hedef: null });
  assert.equal(kg.kesilen, 3);
  const xo = JSON.parse(k.host.xml_ozeti)[0];
  assert.equal(xo.host, 'HATA', 'bilinmeyen XML durumu HATA');
  assert.deepEqual(xo.sunucular.map((x) => x.auto_start), [false, true], 'auto_start yalniz false ise kapali');
  assert.equal(xo.gruplar[0].deploymentlar[0].acik, false);
  const x = JSON.parse(k.uygulamalar[0].xml_eslesme);
  assert.deepEqual([x.jvmler[0].auto_start, x.jvmler[0].deployment_acik], [false, false]);

  const tuhaf = kayit({}, { xml_eslesme: { durum: 'BELKI', jvmler: [{ ad: 'J' }] } });
  assert.equal(JSON.parse(tuhaf.uygulamalar[0].xml_eslesme).durum, 'OLCULEMEDI', 'bilinmeyen eslesme durumu VAR sayilmaz');

  // Sinirlar: 600 kok girdisi -> 500 alinir, kesilen = tarayicinin + fazlasi.
  const cok = kayit({
    kok_girdileri: Array.from({ length: 600 }, (_, i) => ({ kok: '/vhosting', ad: `d${i}`, tip: 'F' })),
    kok_girdisi_kesilen: 7,
  });
  const c = JSON.parse(cok.host.kok_girdileri);
  assert.equal(c.girdiler.length, alim.SINIR_KOK_GIRDI);
  assert.equal(c.kesilen, 107);
  const xcok = kayit({
    yapilandirma: [{ kurulum: '/k', nesil: '8', domain: 'OKUNDU', host: 'OKUNDU', sunucular: Array.from({ length: 301 }, (_, i) => ({ ad: `J${i}`, grup: 'g' })) }],
  });
  const xc = JSON.parse(xcok.host.xml_ozeti)[0];
  assert.equal(xc.sunucular.length, 300);
  assert.equal(xc.kesildi, true, 'sinir ustu sunucu listesi kesildi olarak isaretlenmeli');

  // SESSIZ KAYIP YOK: hostKaydi'nin urettigi her alan OPENJSON WITH listesinde (yoksa SQL onu
  // sessizce atar) ve WITH'teki her alan kayitta (yoksa NULL yazilir).
  const withAdlari = (tablo) => {
    const m = new RegExp(`INSERT INTO ${tablo} \\(kosu_id, host, ([^)]*)\\)`).exec(alim.HOST_YAZ_SQL);
    assert.ok(m, `${tablo} INSERT yok`);
    return m[1].split(',').map((x) => x.trim()).sort();
  };
  assert.deepEqual(Object.keys(k.host).sort(), withAdlari('ear_envanter_hostlari'));
  assert.deepEqual(Object.keys(k.uygulamalar[0]).sort(), withAdlari('ear_envanter_uygulamalari'));
  assert.deepEqual(Object.keys(alim.bosHostKaydi({ partiNo: 1, durum: 'HATA' }).host).sort(), withAdlari('ear_envanter_hostlari'));

  // KURULU ORTAM: yeni kolonlarin ALTER adimi var (CREATE TABLE yalniz yeni kurulumda calisir).
  const kurulum = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  for (const [t, c] of [
    ['ear_envanter_hostlari', 'kok_girdileri'],
    ['ear_envanter_hostlari', 'xml_ozeti'],
    ['ear_envanter_uygulamalari', 'xml_eslesme'],
    ['ear_envanter_hostlari', 'deployment_ozeti'],
  ])
    assert.ok(
      kurulum.includes(`ALTER TABLE ${t} ADD ${c} NVARCHAR(MAX) NULL`) &&
        new RegExp(`table: '${t}',\\s*col: '${c}'`).test(kurulum),
      `${t}.${c} icin ALTER adimi yok: kurulu ortamda alim INSERT'i duser`,
    );
});

test('EA13 Faz 2 deployment blogu: DMR, olculemeyen durumlar, kesik blok, hostKaydi', () => {
  const D = (ic) => Buffer.from(`ONCEKI\n@@EAR_DEPLOYMENT_BASLA@@\nsurum=1\n${ic}`);
  assert.equal(alim.deploymentCoz(Buffer.from('@@EAR_ENVANTER_BITTI@@\n')), null, 'blok yok = olculmedi');
  const ok = alim.deploymentCoz(
    D(`@@JVM@@ 7 A OK 0
{
    "outcome" => "success",
    "result" => {"X.ear" => {
        "enabled" => false,
        "name" => "X.ear",
        "runtime-name" => "X-rt.ear",
        "status" => "FAILED",
        "persistent" => true,
        "properties" => [("k" => "v")],
        "expr" => expression "\${a:b}",
        "big" => big decimal 1.50
    }}
}
@@JVM_SON@@
@@JVM@@ 7 B OK 0
{"outcome" => "failed", "failure-description" => "WFLYCTL0216: Management resource not found"}
@@JVM_SON@@
@@JVM@@ 8 C OK 0
bu DMR degil
@@JVM_SON@@
@@JVM@@ 8 D TUHAF_DURUM
@@JVM@@ - - BASH_YOK
@@EAR_DEPLOYMENT_BITTI@@
`),
  );
  const j = Object.fromEntries(ok.jvmler.map((x) => [x.ad, x]));
  assert.deepEqual(j.A.deploymentlar, [{ ad: 'X.ear', calisma_adi: 'X-rt.ear', etkin: false, durum: 'FAILED' }]);
  assert.deepEqual([j.B.durum, j.B.deploymentlar], ['HATA', null]);
  assert.match(j.B.hata, /WFLYCTL0216/);
  assert.deepEqual([j.C.durum, j.C.deploymentlar], ['AYRISTIRILAMADI', null]);
  assert.equal(j.D.durum, 'HATA', 'bilinmeyen durum OK sayilmaz');
  assert.equal(j['-'].durum, 'BASH_YOK');
  assert.equal(ok.kesik, false);
  const kesik = alim.deploymentCoz(D('@@JVM@@ 7 A CLI_YOK\n'));
  assert.deepEqual([kesik.kesik, kesik.jvmler[0].durum], [true, 'CLI_YOK']);
  // DMR: tirnak icinde kacis, L sayi, undefined, bytes.
  assert.deepEqual(alim.dmrAyristir('{"a" => "x\\"y", "n" => 12L, "u" => undefined, "b" => bytes { 0x01 }, "t" => true}'), {
    a: 'x"y',
    n: 12,
    u: null,
    b: null,
    t: true,
  });
  assert.throws(() => alim.dmrAyristir('{"a" => '), /DMR/);
  assert.throws(() => alim.dmrAyristir('{'.repeat(80) + '}'.repeat(80)), /derin/);
  // hostKaydi: verilirse JSON, verilmezse NULL (olculmedi).
  const p = { sema: 1, durum: 'TAM', kokler: [], uyarilar: [], uygulamalar: [] };
  const o = { host: 'H', kip: 'OZET', partiNo: 1, ortam: 'PROD', playbookDurum: 'SONUC', hamBayt: 1 };
  assert.equal(alim.hostKaydi(p, o).host.deployment_ozeti, null);
  assert.deepEqual(JSON.parse(alim.hostKaydi(p, { ...o, deployment: ok }).host.deployment_ozeti).jvmler.length, 5);
});
