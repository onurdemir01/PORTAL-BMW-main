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
    const r = spawnSync(PY, ['-B', '-'], {
      input: fs.readFileSync(TARAYICI),
      env: {
        PATH: process.env.PATH,
        LC_ALL: 'C',
        PYTHONIOENCODING: 'utf-8:surrogateescape',
        EAR_KIP: 'TAM',
        EAR_KOKLER: `${kok}/vhosting:${kok}/vhosting8`,
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
