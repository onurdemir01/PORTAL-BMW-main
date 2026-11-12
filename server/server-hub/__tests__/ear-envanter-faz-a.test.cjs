// server/server-hub/__tests__/ear-envanter-faz-a.test.cjs — Uygulama Envanteri FAZ A: Portal tarafi (2026-11-07).
//
//   FA1 xml_ozeti: profil (mod_cluster), soket gruplari, grup / sunucu ofseti, deployment yol_durumu; eski
//       tarayicinin paketinde alan YOK -> ozette de yok (olculmedi), null degil
//   FA2 was_ozeti / baglanti_ozeti: pakette yoksa null; KAPALI yazilir; beyaz liste + kirpma; durum listeden
//   FA3 kolonlar: hostKaydi / bosHostKaydi, HOST_YAZ_SQL, CREATE TABLE + gec kolon
//   FA4 extraVars: baglanti yalniz ACIK iken; was kokleri playbook assert'ini gecer; baslikta belgeli
//   FA5 UCTAN UCA: GERCEK ear_tara.py (JBoss 8 domain / host + WAS serverindex + sahte /proc) -> paketCoz ->
//       hostKaydi -> kolonlar
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const F = require('./fixtures/ear-envanter.cjs');
const { adaylar } = require('../../ansible/__tests__/fixtures/python-bul.cjs');

const KOK = path.join(__dirname, '..', '..', '..');
const PLAYBOOK = path.join(
  KOK,
  'server',
  'ansible',
  'bmw_portal',
  'ear_envanter',
  'ear_envanter.yml',
);
const BETIK = path.join(
  KOK,
  'server',
  'ansible',
  'bmw_portal',
  'ear_envanter',
  'files',
  'ear_tara.py',
);

let poller;
let alim;
beforeEach(() => {
  for (const k of Object.keys(require.cache))
    if (/ear-envanter-(poller|ayar|alim|saklama)\.cjs$/.test(k)) delete require.cache[k];
  poller = require('../ear-envanter-poller.cjs');
  alim = require('../ear-envanter-alim.cjs');
});
afterEach(() => {
  poller._durdurForTest();
  F.dbKaldir();
});

const yapilandirma = (ek = {}) => ({
  kurulum: '/usr/jboss8/AppServer',
  nesil: '8',
  dizin: '/usr/jboss8/AppServer/domain/configuration',
  domain: 'OKUNDU',
  host: 'OKUNDU',
  host_adi: 'primary',
  sunucular: [{ ad: 'JVM1', grup: 'g1', auto_start: true, soket_grubu: '', port_ofseti: 100 }],
  gruplar: [
    {
      ad: 'g1',
      deploymentlar: [],
      profil: 'full-ha',
      soket_grubu: 'full-ha-sockets',
      port_ofseti: null,
    },
  ],
  deploymentlar: [{ ad: 'A.ear', tur: 'ACIK', yol: '/vhosting8/A.ear', yol_durumu: 'YOK' }],
  profiller: [
    {
      ad: 'full-ha',
      modcluster: {
        tur: 'proxy',
        proxies: ['web1'],
        proxy_list: [],
        balancer: 'b',
        advertise: false,
        advertise_soketi: '',
        dinleyici: 'ajp',
        fazla: 1,
      },
      ajp: ['ajp'],
      http: ['http'],
    },
  ],
  soket_gruplari: [
    {
      ad: 'full-ha-sockets',
      soketler: { ajp: 8009, http: '8080', bozuk: 'x' },
      outbound: [{ ad: 'web1', host: 'websrv01', port: 6666 }],
    },
  ],
  kesildi: false,
  ...ek,
});

test('FA1 xml_ozeti: Faz A alanlari; eski pakette alan yok', () => {
  const x = JSON.parse(alim.xmlOzeti({ yapilandirma: [yapilandirma()] }))[0];
  assert.deepEqual(x.sunucular[0], {
    ad: 'JVM1',
    grup: 'g1',
    auto_start: true,
    soket_grubu: '',
    port_ofseti: 100,
  });
  assert.deepEqual(x.gruplar[0], {
    ad: 'g1',
    deploymentlar: [],
    profil: 'full-ha',
    soket_grubu: 'full-ha-sockets',
    port_ofseti: null,
  });
  assert.equal(x.deploymentlar[0].yol_durumu, 'YOK');
  assert.deepEqual(x.profiller[0].modcluster, {
    tur: 'proxy',
    proxies: ['web1'],
    proxy_list: [],
    balancer: 'b',
    advertise: false,
    advertise_soketi: '',
    dinleyici: 'ajp',
  });
  assert.deepEqual(x.soket_gruplari[0].soketler, { ajp: 8009, http: 8080, bozuk: null });
  assert.deepEqual(x.soket_gruplari[0].outbound, [{ ad: 'web1', host: 'websrv01', port: 6666 }]);
  // Eski tarayici (surum 2): Faz A alanlari YOK -> ozette de YOK (null "olculdu ve bos" sanilmasin)
  const eski = yapilandirma({
    sunucular: [{ ad: 'JVM1', grup: 'g1', auto_start: true }],
    gruplar: [{ ad: 'g1', deploymentlar: [] }],
    deploymentlar: [{ ad: 'A.ear', tur: 'ACIK', yol: '/x' }],
  });
  delete eski.profiller;
  delete eski.soket_gruplari;
  const e = JSON.parse(alim.xmlOzeti({ yapilandirma: [eski] }))[0];
  assert.ok(
    !('port_ofseti' in e.sunucular[0]) &&
      !('profil' in e.gruplar[0]) &&
      !('yol_durumu' in e.deploymentlar[0]),
  );
  assert.ok(!('profiller' in e) && !('soket_gruplari' in e));
  // bilinmeyen yol durumu olculemedi
  const b = JSON.parse(
    alim.xmlOzeti({
      yapilandirma: [
        yapilandirma({
          deploymentlar: [{ ad: 'A', tur: 'ACIK', yol: '/x', yol_durumu: 'UYDURMA' }],
        }),
      ],
    }),
  )[0];
  assert.equal(b.deploymentlar[0].yol_durumu, 'OLCULEMEDI');
});

test('FA2 was_ozeti / baglanti_ozeti: yoksa null; KAPALI yazilir; beyaz liste', () => {
  assert.equal(alim.wasOzeti({}), null);
  assert.equal(alim.baglantiOzeti({}), null);
  assert.deepEqual(JSON.parse(alim.baglantiOzeti({ baglanti: { durum: 'KAPALI' } })), {
    durum: 'KAPALI',
    ornek: null,
    ara_sn: null,
    portlar: [],
  });
  const b = JSON.parse(
    alim.baglantiOzeti({
      baglanti: {
        durum: 'UYDURMA',
        ornek: 3,
        ara_sn: 10,
        portlar: [
          {
            port: 8109,
            sahipler: [{ jvm: 'JVM1', kurulum: '/k', tur: 'ajp', gizli: 1 }],
            dinleniyor: true,
            en_cok: 2,
            uzaklar: [{ ip: '10.0.0.21', gozlem: 6 }],
            fazla: 'x',
          },
        ],
      },
    }),
  );
  assert.equal(b.durum, 'OLCULEMEDI', 'listede olmayan durum olculemedi');
  assert.deepEqual(b.portlar[0], {
    port: 8109,
    sahipler: [{ jvm: 'JVM1', kurulum: '/k', tur: 'ajp' }],
    dinleniyor: true,
    en_cok: 2,
    uzaklar: [{ ip: '10.0.0.21', gozlem: 6 }],
  });
  const w = JSON.parse(
    alim.wasOzeti({
      was: {
        kokler: [
          { yol: '/opt/IBM/WebSphere/AppServer', durum: 'VAR' },
          { yol: '/x', durum: 'UYDURMA' },
        ],
        dosyalar: [{ yol: '/a/serverindex.xml', durum: 'OKUNDU' }],
        sunucular: [
          {
            profil: 'AppSrv01',
            hucre: 'c',
            dugum: 'n',
            ad: 'srv1',
            tur: 'APPLICATION_SERVER',
            uclar: [{ ad: 'WC_defaulthost', host: '*', port: 9080 }],
            uygulamalar: ['APP4'],
            gizli: 1,
          },
        ],
      },
    }),
  );
  assert.deepEqual(
    w.kokler.map((k) => k.durum),
    ['VAR', 'HATA'],
  );
  assert.deepEqual(w.sunucular[0], {
    profil: 'AppSrv01',
    hucre: 'c',
    dugum: 'n',
    ad: 'srv1',
    tur: 'APPLICATION_SERVER',
    uclar: [{ ad: 'WC_defaulthost', host: '*', port: 9080 }],
    uygulamalar: ['APP4'],
  });
  assert.equal(w.kesildi, false);
});

test('FA2b was_ozeti sunucu jvm: beyaz liste, IKINCI maske katmani, olculemedi ayrimi, eski pakette yok', () => {
  const sunucu = (jvm) => {
    const s = { profil: 'P', hucre: 'c', dugum: 'n', ad: 'srv1', tur: 'APPLICATION_SERVER', uclar: [], uygulamalar: [] };
    if (jvm !== undefined) s.jvm = jvm;
    return JSON.parse(alim.wasOzeti({ was: { kokler: [], dosyalar: [], sunucular: [s] } })).sunucular[0];
  };
  // Eski tarayici: alan yok -> ozette de yok (olculmedi; 'parametre yok' DEGIL)
  assert.equal('jvm' in sunucu(undefined), false);
  // Tarayici maskelemeyi atlasa bile (ilk katman bozuk) Portal maskeler; fazla alan dusar; once maske sonra kirpma
  const j = sunucu({
    yol: '/x/server.xml',
    durum: 'OKUNDU',
    jvm_girisi: 1,
    ilk_heap_mb: '512',
    en_cok_heap_mb: 2048,
    jvm_argumanlari: '-Xmx2g\t-Dapp.secret=SIR_1 -Djava.awt.headless=true --password=SIR_2 -Ddb.url=jdbc://u:SIR_3@h',
    sistem_ozellikleri: [
      { ad: 'java.security.policy', deger: '/p', gizli: 1 },
      { ad: 'com.ibm.ozel', deger: 'jdbc://u:SIR_4@h' },
      { ad: 'javax.net.ssl.keyStorePassword', deger: 'SIR_5' },
      { ad: 'degersiz', deger: null },
    ],
    debug_args: 'SIR_6',
  }).jvm;
  assert.deepEqual(j, {
    yol: '/x/server.xml',
    durum: 'OKUNDU',
    jvm_girisi: 1,
    ilk_heap_mb: 512,
    en_cok_heap_mb: 2048,
    jvm_argumanlari: '-Xmx2g -Dapp.secret=*** -Djava.awt.headless=true --password=*** -Ddb.url=jdbc://u:***@h',
    sistem_ozellikleri: [
      { ad: 'java.security.policy', deger: '/p' },
      { ad: 'com.ibm.ozel', deger: 'jdbc://u:***@h' },
      { ad: 'javax.net.ssl.keyStorePassword', deger: '***' },
      { ad: 'degersiz', deger: null },
    ],
    ozellik_kesildi: false,
  });
  assert.ok(!JSON.stringify(j).includes('SIR_'), 'sir was_ozeti JSON\'una girdi');
  // Olculemedi: yalniz yol + durum; listede olmayan durum HATA
  assert.deepEqual(sunucu({ yol: '/y', durum: 'IZIN', jvm_argumanlari: '-Dx=SIR_7' }).jvm, { yol: '/y', durum: 'IZIN' });
  assert.deepEqual(sunucu({ durum: 'JVM_YOK' }).jvm, { yol: '', durum: 'JVM_YOK' });
  assert.deepEqual(sunucu({ durum: 'UYDURMA' }).jvm, { yol: '', durum: 'HATA' });
  assert.deepEqual(sunucu(null).jvm, { yol: '', durum: 'HATA' });
  // Sinirlar: 100 ozellik, fazlasi ozellik_kesildi; arguman 2100 karakter
  const cok = sunucu({
    durum: 'OKUNDU',
    jvm_argumanlari: '-Xa '.repeat(1000),
    sistem_ozellikleri: Array.from({ length: 130 }, (_, i) => ({ ad: `java.p${i}`, deger: String(i) })),
  }).jvm;
  assert.equal(cok.sistem_ozellikleri.length, 100);
  assert.equal(cok.ozellik_kesildi, true);
  assert.ok(cok.jvm_argumanlari.length <= 2100);
  assert.deepEqual([cok.ilk_heap_mb, cok.en_cok_heap_mb], [null, null], 'heap yoksa null (0 DEGIL)');
});

test('FA3 kolonlar: hostKaydi / bosHostKaydi, SQL, CREATE TABLE ve gec kolon', () => {
  const k = alim.hostKaydi(
    F.ornekYuk({ baglanti: { durum: 'KAPALI' }, was: { kokler: [], dosyalar: [], sunucular: [] } }),
    {
      host: 'APPSRV01',
      kip: 'OZET',
      partiNo: 1,
      ortam: 'PROD',
      playbookDurum: 'SONUC',
      hamBayt: 10,
    },
  );
  assert.equal(JSON.parse(k.host.baglanti_ozeti).durum, 'KAPALI');
  assert.deepEqual(JSON.parse(k.host.was_ozeti).sunucular, []);
  const eski = alim.hostKaydi(F.ornekYuk(), {
    host: 'APPSRV01',
    kip: 'OZET',
    partiNo: 1,
    ortam: 'PROD',
    playbookDurum: 'SONUC',
    hamBayt: 10,
  });
  assert.deepEqual(
    [eski.host.baglanti_ozeti, eski.host.was_ozeti],
    [null, null],
    'eski tarayici: olculmedi',
  );
  const bos = alim.bosHostKaydi({ partiNo: 1, durum: 'HATA' }).host;
  assert.deepEqual([bos.baglanti_ozeti, bos.was_ozeti], [null, null]);
  assert.match(alim.HOST_YAZ_SQL, /baglanti_ozeti NVARCHAR\(MAX\)/);
  assert.match(alim.HOST_YAZ_SQL, /was_ozeti NVARCHAR\(MAX\)/);
  const setup = fs.readFileSync(path.join(KOK, 'server', 'db', 'mssql-setup.cjs'), 'utf8');
  for (const kol of ['baglanti_ozeti', 'was_ozeti']) {
    assert.match(setup, new RegExp(`${kol}\\s+NVARCHAR\\(MAX\\)\\s+NULL,`), `${kol} CREATE TABLE`);
    assert.match(
      setup,
      new RegExp(`ALTER TABLE ear_envanter_hostlari ADD ${kol} NVARCHAR\\(MAX\\) NULL`),
      `${kol} gec kolon`,
    );
  }
});

const kosu = (p = {}) => ({
  id: 41,
  kip: 'OZET',
  kaynak: 'ELLE',
  kapsam: 'FILO',
  durum: 'CALISIYOR',
  baslatan: 'ayse',
  parametreler: JSON.stringify({
    kokler: '/vhosting:/vhosting8',
    okuma_kullanicisi: 'was',
    dizin: '/sw/ORNEK/ear',
    ...p,
  }),
});
const parti = () => ({
  id: 7,
  kosu_id: 41,
  parti_no: 1,
  hostlar: JSON.stringify([{ host: 'APPSRV01', ortam: 'PROD' }]),
  host_sayisi: 1,
});

test('FA4 extraVars: baglanti yalniz ACIK iken; was kokleri assert ve baslikta belgeli', () => {
  const yml = fs.readFileSync(PLAYBOOK, 'utf8');
  const belgeli = new Set([...yml.matchAll(/^#\s{1,4}([a-z_]+):\s/gm)].map((m) => m[1]));
  assert.ok(
    !('ear_baglanti_kontrol' in poller.extraVarsOf(kosu({ baglanti_kontrolu: 'KAPALI' }), parti())),
  );
  const acik = poller.extraVarsOf(
    kosu({ baglanti_kontrolu: 'ACIK', was_kokler: '/opt/IBM/WebSphere/AppServer' }),
    parti(),
  );
  assert.equal(acik.ear_baglanti_kontrol, true);
  assert.equal(acik.ear_was_kokler, '/opt/IBM/WebSphere/AppServer');
  for (const k of ['ear_baglanti_kontrol', 'ear_was_kokler'])
    assert.ok(belgeli.has(k), `${k} belgeli degil`);
  const re = [
    ...yml.matchAll(/\(ear_was_kokler \| default\([^)]*\)(?: \| string)?\) is match\('([^']+)'\)/g),
  ];
  assert.equal(re.length, 2, 'iki play de dogrular');
  for (const [, r] of re) assert.match(acik.ear_was_kokler, new RegExp(r));
  // Eski kosu (parametrede yok): was kokleri gonderilmez, playbook varsayilani gecer
  assert.ok(!('ear_was_kokler' in poller.extraVarsOf(kosu(), parti())));
});

function pythonuBul() {
  for (const [komut, on] of adaylar()) {
    if (spawnSync(komut, [...on, '-c', 'import zipfile, zlib'], { stdio: 'ignore' }).status === 0)
      return { komut, on };
  }
  return null;
}
const PY = pythonuBul();

test(
  'FA5 uctan uca: gercek ear_tara.py -> paketCoz -> hostKaydi -> Faz A kolonlari',
  { skip: !PY && 'python3 yok' },
  () => {
    const kok = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fa5-')));
    const conf = path.join(kok, 'usr', 'jboss8', 'AppServer', 'domain', 'configuration');
    fs.mkdirSync(conf, { recursive: true });
    fs.writeFileSync(
      path.join(conf, 'domain.xml'),
      `<?xml version="1.0"?><domain xmlns="urn:jboss:domain:20.0">
<profiles><profile name="p"><subsystem xmlns="urn:jboss:domain:modcluster:6.0"><proxy name="default" proxies="w1"/></subsystem></profile></profiles>
<socket-binding-groups><socket-binding-group name="s"><socket-binding name="ajp" port="8009"/>
<outbound-socket-binding name="w1"><remote-destination host="websrv01" port="6666"/></outbound-socket-binding></socket-binding-group></socket-binding-groups>
<server-groups><server-group name="g" profile="p"><socket-binding-group ref="s"/></server-group></server-groups></domain>`,
    );
    fs.writeFileSync(
      path.join(conf, 'host.xml'),
      `<?xml version="1.0"?><host name="primary" xmlns="urn:jboss:domain:20.0"><servers><server name="J1" group="g"><socket-bindings port-offset="100"/></server></servers></host>`,
    );
    fs.mkdirSync(path.join(kok, 'proc', 'net'), { recursive: true });
    fs.writeFileSync(
      path.join(kok, 'proc', 'net', 'tcp'),
      '  sl  local_address rem_address   st\n  0: 0500000A:1FAD 1500000A:D431 01 0 0 0 0 0\n',
    );
    const r = spawnSync(PY.komut, [...PY.on, '-B', '-'], {
      input: fs.readFileSync(BETIK, 'utf8'),
      env: {
        PATH: process.env.PATH,
        LC_ALL: 'C',
        EAR_KOKLER: path.join(kok, 'vhosting8'),
        EAR_JBOSS: path.join(kok, 'usr', 'jboss8', 'AppServer'),
        EAR_WAS: path.join(kok, 'yok'),
        EAR_BAGLANTI: '1',
        EAR_BAGLANTI_ORNEK: '1',
        EAR_PROC: path.join(kok, 'proc'),
      },
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(r.status, 0, String(r.stderr));
    const p = alim.paketCoz(r.stdout);
    assert.equal(p.tarayici_surum, 3);
    const k = alim.hostKaydi(p, {
      host: 'APPSRV01',
      kip: 'OZET',
      partiNo: 1,
      ortam: 'PROD',
      playbookDurum: 'SONUC',
      hamBayt: r.stdout.length,
    });
    const x = JSON.parse(k.host.xml_ozeti)[0];
    assert.deepEqual(x.profiller[0].modcluster.proxies, ['w1']);
    assert.deepEqual(x.soket_gruplari[0].outbound[0], { ad: 'w1', host: 'websrv01', port: 6666 });
    assert.equal(x.sunucular[0].port_ofseti, 100);
    const b = JSON.parse(k.host.baglanti_ozeti);
    assert.equal(b.durum, 'OLCULDU');
    // 0x1FAD = 8109 = ajp 8009 + ofset 100; uzak 0x1500000A = 10.0.0.21
    const p8109 = b.portlar.find((x2) => x2.port === 8109);
    assert.deepEqual([p8109.sahipler[0].jvm, p8109.uzaklar[0].ip], ['J1', '10.0.0.21']);
    assert.deepEqual(
      JSON.parse(k.host.was_ozeti).kokler.map((y) => y.durum),
      ['YOK'],
    );
  },
);
