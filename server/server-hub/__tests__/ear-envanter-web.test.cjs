// server/server-hub/__tests__/ear-envanter-web.test.cjs — Uygulama Envanteri FAZ W: Portal tarafi (2026-11-07).
//
//   EW1 webCoz: blok yok -> null (olculmedi); PYTHON_YOK / KESIK / BOZUK / SEMA ayri durum, "web yok" DEGIL
//   EW2 beyaz liste: bilinmeyen alan pakete girmez, metinler kirpilir, sayilar dogrulanir, durumlar listeden
//   EW3 DB siniri: sigmayan ozette vhost'lar kirpilir, kesildi + KISMI (eksik liste "tam" gorunmez)
//   EW4 hostKaydi web_ozeti yazar; bosHostKaydi null; kolon HOST_KOLONLAR + CREATE TABLE + gec kolon listesinde
//   EW5 extraVars: Faz W yalniz kosu parametresi ACIK iken; degerler playbook assert'lerini gecer, baslikta belgeli
//   EW6 ayarlar: varsayilan KAPALI; okuma kimligi / hc / kok dogrulamasi; kapsam WEB / FILO_WEB ve kapsama iliskisi
//   EW7 kapsam WEB: Server Hub son taramasinda IHS / RHA olan sunucular; FILO_WEB birlesim; okunamazsa 424
//   EW8 UCTAN UCA: GERCEK web_tara.py ciktisi (ham dosyada onceki bloklardan sonra) -> webCoz -> alanlar
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const F = require('./fixtures/ear-envanter.cjs');
const { adaylar } = require('../../ansible/__tests__/fixtures/python-bul.cjs');

const INV_YOLU = path.join(__dirname, '..', '..', 'inventory', 'mssql.cjs');
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
  'web_tara.py',
);

const sahteModul = (yol, exports) => {
  require.cache[yol] = { id: yol, filename: yol, loaded: true, exports };
};
let poller;
let alim;
let ayar;
beforeEach(() => {
  for (const k of Object.keys(require.cache))
    if (/ear-envanter-(poller|ayar|alim|saklama)\.cjs$/.test(k)) delete require.cache[k];
  poller = require('../ear-envanter-poller.cjs');
  alim = require('../ear-envanter-alim.cjs');
  ayar = require('../ear-envanter-ayar.cjs');
});
afterEach(() => {
  poller._durdurForTest();
  F.dbKaldir();
  delete require.cache[INV_YOLU];
});

function webBlogu(yuk, { bitti = true } = {}) {
  const b64 = zlib.deflateSync(Buffer.from(JSON.stringify(yuk))).toString('base64');
  const satirlar = [];
  for (let i = 0; i < b64.length; i += 4000) satirlar.push(b64.slice(i, i + 4000));
  return Buffer.from(
    `@@EAR_WEB_BASLA@@\n${satirlar.join('\n')}\n${bitti ? '@@EAR_WEB_BITTI@@\n' : ''}`,
  );
}
const ornekWeb = (ek = {}) => ({
  sema: 1,
  surum: 1,
  durum: 'TAM',
  baslangic_utc: '2026-11-07T12:00:00Z',
  python: '3.6.8',
  uid: 1000,
  ps_gorunur: true,
  pencere_gun: 7,
  hc_adlari: ['hc.html', 'hc.jsp'],
  sure_sn: 1.5,
  log_bayt: 1234,
  kurulumlar: [
    {
      kok: '/usr/IBMIHS',
      conf: '/usr/IBMIHS/conf/httpd.conf',
      urun: 'IHS',
      kaynak: 'ps',
      calisiyor: true,
      surec_sayisi: 3,
      tanimlar: ['SSL'],
      moduller: ['jk_module'],
      dosyalar: [
        { yol: '/usr/IBMIHS/conf/httpd.conf', durum: 'OKUNDU' },
        { yol: '/x.conf', durum: 'IZIN' },
      ],
      hatalar: [
        {
          tur: 'EKSIK_INCLUDE',
          dosya: '/usr/IBMIHS/conf/httpd.conf',
          satir: 9,
          deger: 'conf/yok.conf',
        },
      ],
      if_kararlari: [{ tur: 'IfDefine', belirsiz: true }, { tur: 'IfModule' }],
      dinle: [{ adres: '*', port: 80, dosya: '/usr/IBMIHS/conf/httpd.conf', satir: 2 }],
      vhostlar: [
        {
          adres: ['10.0.0.5:443'],
          server_name: 'app1.ornek.local',
          aliases: ['app1'],
          dosya: '/usr/IBMIHS/conf.d/app1.conf',
          satir: 1,
          belirsiz: false,
          document_root: '',
          error_log: '',
          hedefler: [
            {
              tur: 'proxy',
              yol: '/',
              url: 'ajp://appsrv01:8009/',
              sema: 'ajp',
              host: 'appsrv01',
              port: 8009,
              dosya: '/a',
              satir: 3,
              gizli: 'x',
            },
          ],
          ssl: { sertifika: '/usr/IBMIHS/conf/ssl/app1.crt', var: true },
          jk_mount: [{ yol: '/app1/*', worker: 'app1lb', dosya: '/a', satir: 4 }],
          mcmp: false,
          loglar: [
            {
              desen: '/usr/IBMIHS/logs/app1_access_log',
              durum: 'OLCULDU',
              neden: '',
              paylasilan: false,
              miras: false,
              pencere_gun: 7,
              kapsama_bas: 1761900000,
              son_satir: 1762516800,
              son_gercek: 1762510000,
              gercek_24s: 3,
              gercek_7g: 40,
              hc_24s: 1440,
              hc_7g: 10080,
              statik_7g: 5,
              durum_sinif: { '2xx': 30, '3xx': 5, '4xx': 4, '5xx': 1, '9xx': 99 },
              istemci_sayisi: 7,
              hc_istemcileri: [{ ip: '10.9.9.1', n: 10080 }],
              ilk_istemciler: [{ ip: '10.1.1.1', n: 20 }],
              ilk_yollar: [{ yol: '/app1', n: 40 }],
              ornek: false,
              ayristirilamayan: 0,
              satir: 10125,
              dosyalar: [{ yol: '/usr/IBMIHS/logs/app1_access_log', durum: 'OKUNDU', bayt: 1000 }],
            },
          ],
        },
      ],
      ana: {
        server_name: '',
        hedefler: [],
        access_log: ['/usr/IBMIHS/logs/access_log'],
        error_log: '/usr/IBMIHS/logs/error_log',
      },
      balancerlar: [],
      jk: {
        workers: {
          yol: '/usr/IBMIHS/conf/workers.properties',
          durum: 'OKUNDU',
          workerlar: [
            { ad: 'app1lb', tur: 'lb', host: '', port: null, uyeler: ['a'], listede: true },
          ],
        },
        mount_global: [],
        log: '/usr/IBMIHS/logs/mod_jk.log',
      },
      mod_cluster: { yuklu: false, yonergeler: {}, mcmp_vhostlari: [] },
      was: null,
      error_loglari: [
        {
          yol: '/usr/IBMIHS/logs/error_log',
          durum: 'OKUNDU',
          hatalar: [{ tur: 'proxy', hedef: 'appsrv01:8009', n: 2, son: 1762500000 }],
        },
      ],
      kesildi: false,
    },
  ],
  soketler: { durum: 'OLCULDU', dinlenen: [{ adres: '0.0.0.0', port: 80, aile: 4 }] },
  ipler: { durum: 'OLCULDU', liste: [{ ip: '10.0.0.5', onek: 24, iface: 'eth0', aile: 4 }] },
  uyarilar: [],
  bilinmeyen_alan: 'atilmali',
  ...ek,
});

test('EW1 webCoz: blok yok null; PYTHON_YOK / KESIK / BOZUK / SEMA ayri durum', () => {
  assert.equal(alim.webCoz(Buffer.from('@@EAR_ENVANTER_BITTI@@\n')), null);
  assert.deepEqual(alim.webCoz(Buffer.from('x\n@@EAR_WEB_PYTHON_YOK@@\n')), {
    durum: 'PYTHON_YOK',
    surum: null,
  });
  assert.equal(alim.webCoz(webBlogu(ornekWeb(), { bitti: false })).durum, 'KESIK');
  assert.equal(
    alim.webCoz(Buffer.from('@@EAR_WEB_BASLA@@\nbm90LXpsaWI=\n@@EAR_WEB_BITTI@@\n')).durum,
    'BOZUK',
  );
  assert.equal(alim.webCoz(webBlogu({ ...ornekWeb(), sema: 2 })).durum, 'SEMA');
});

test('EW2 beyaz liste: bilinmeyen alan yok, kirpma, sayi ve durum dogrulama', () => {
  const w = alim.webCoz(webBlogu(ornekWeb({ durum: 'UYDURMA' })));
  assert.equal(w.durum, 'OLCULEMEDI', 'listede olmayan durum olculemedi sayilir');
  assert.ok(!('bilinmeyen_alan' in w));
  const k = w.kurulumlar[0];
  assert.equal(k.urun, 'IHS');
  assert.equal(k.calisiyor, true);
  assert.equal(k.dosya_sayisi, 2);
  assert.deepEqual(k.okunamayan_dosyalar, [{ yol: '/x.conf', durum: 'IZIN' }]);
  assert.equal(k.belirsiz_kararlar, 1);
  assert.deepEqual(k.hatalar[0], {
    tur: 'EKSIK_INCLUDE',
    dosya: '/usr/IBMIHS/conf/httpd.conf',
    satir: 9,
    deger: 'conf/yok.conf',
  });
  const v = k.vhostlar[0];
  assert.ok(!('gizli' in v.hedefler[0]));
  assert.deepEqual([v.hedefler[0].host, v.hedefler[0].port], ['appsrv01', 8009]);
  const l = v.loglar[0];
  assert.deepEqual(l.durum_sinif, { '2xx': 30, '3xx': 5, '4xx': 4, '5xx': 1 });
  assert.deepEqual([l.gercek_7g, l.hc_7g, l.hc_istemcileri[0].ip], [40, 10080, '10.9.9.1']);
  assert.equal(k.jk.workers.workerlar[0].ad, 'app1lb');
  assert.equal(k.error_loglari[0].hatalar[0].hedef, 'appsrv01:8009');
  assert.equal(w.ipler.liste[0].ip, '10.0.0.5');
  // Kirpma ve dogrulama
  const uzun = alim.webCoz(
    webBlogu(
      ornekWeb({
        kurulumlar: [
          { ...ornekWeb().kurulumlar[0], kok: 'x'.repeat(2000), surec_sayisi: -5, urun: 'NGINX' },
        ],
        soketler: { durum: 'BASKA', dinlenen: [{ adres: '1.2.3.4', port: 99999, aile: 9 }] },
      }),
    ),
  );
  assert.equal(uzun.kurulumlar[0].kok.length, 400);
  assert.equal(uzun.kurulumlar[0].surec_sayisi, 0);
  assert.equal(uzun.kurulumlar[0].urun, 'RHA', 'bilinmeyen urun');
  assert.equal(uzun.soketler.durum, 'OLCULEMEDI');
  assert.deepEqual(uzun.soketler.dinlenen[0], { adres: '1.2.3.4', port: 65535, aile: 4 });
});

test('EW3 DB siniri: vhostlar kirpilir, kesildi + KISMI', () => {
  const vh = ornekWeb().kurulumlar[0].vhostlar[0];
  const cok = Array.from({ length: 2000 }, (_, i) => ({
    ...vh,
    server_name: `v${i}.ornek.local`,
    aliases: Array.from({ length: 100 }, (_, j) => `a${j}-${'y'.repeat(40)}`),
  }));
  const w = alim.webCoz(
    webBlogu(ornekWeb({ kurulumlar: [{ ...ornekWeb().kurulumlar[0], vhostlar: cok }] })),
  );
  assert.equal(w.kesildi, true);
  assert.equal(w.durum, 'KISMI');
  assert.ok(JSON.stringify(w).length <= alim.WEB_OZET_SINIR);
  assert.ok(w.kurulumlar[0].vhostlar.length > 0 && w.kurulumlar[0].vhostlar.length < 2000);
});

test('EW4 hostKaydi web_ozeti; bosHostKaydi null; kolon tanimlari', () => {
  const w = alim.webCoz(webBlogu(ornekWeb()));
  const kayit = alim.hostKaydi(F.ornekYuk(), {
    host: 'APPSRV01',
    kip: 'OZET',
    partiNo: 1,
    ortam: 'PROD',
    playbookDurum: 'SONUC',
    hamBayt: 10,
    web: w,
  });
  assert.deepEqual(
    JSON.parse(kayit.host.web_ozeti).kurulumlar[0].vhostlar[0].server_name,
    'app1.ornek.local',
  );
  const yok = alim.hostKaydi(F.ornekYuk(), {
    host: 'APPSRV01',
    kip: 'OZET',
    partiNo: 1,
    ortam: 'PROD',
    playbookDurum: 'SONUC',
    hamBayt: 10,
  });
  assert.equal(yok.host.web_ozeti, null, 'blok yoksa NULL = olculmedi');
  assert.equal(alim.bosHostKaydi({ partiNo: 1, durum: 'HATA' }).host.web_ozeti, null);
  assert.match(alim.HOST_YAZ_SQL, /web_ozeti NVARCHAR\(MAX\)/);
  const setup = fs.readFileSync(path.join(KOK, 'server', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(setup, /web_ozeti\s+NVARCHAR\(MAX\)\s+NULL,/, 'CREATE TABLE');
  assert.match(
    setup,
    /ALTER TABLE ear_envanter_hostlari ADD web_ozeti NVARCHAR\(MAX\) NULL/,
    'eski kurulum icin gec kolon',
  );
});

const kosu = (p = {}) => ({
  id: 41,
  kip: 'OZET',
  kaynak: 'ELLE',
  kapsam: 'WEB',
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
  hostlar: JSON.stringify([{ host: 'WEBSRV01', ortam: '' }]),
  host_sayisi: 1,
});

test('EW5 extraVars: Faz W yalniz ACIK iken; playbook assertlerini gecer ve belgeli', () => {
  const yml = fs.readFileSync(PLAYBOOK, 'utf8');
  const belgeli = new Set([...yml.matchAll(/^#\s{1,4}([a-z_]+):\s/gm)].map((m) => m[1]));
  const kapali = poller.extraVarsOf(kosu({ web_kontrolu: 'KAPALI', web_hc: 'hc.html' }), parti());
  assert.deepEqual(
    Object.keys(kapali).filter((k) => k.startsWith('ear_web')),
    [],
    'kapaliyken Faz W degiskeni gitti',
  );
  const acik = poller.extraVarsOf(
    kosu({
      web_kontrolu: 'ACIK',
      web_hc: 'hc.html,hc.jsp,ping.html',
      web_kokler: '/usr/IBMIHS:/etc/httpd',
      web_okuma_kullanicisi: 'ihsokur',
    }),
    parti(),
  );
  assert.deepEqual(
    [acik.ear_web_kontrol, acik.ear_web_hc, acik.ear_web_kokler, acik.ear_web_okuma_kullanicisi],
    [true, 'hc.html,hc.jsp,ping.html', '/usr/IBMIHS:/etc/httpd', 'ihsokur'],
  );
  // bos okuma kimligi gonderilmez (playbook ear_okuma_kullanicisi'na duser)
  assert.ok(
    !(
      'ear_web_okuma_kullanicisi' in
      poller.extraVarsOf(kosu({ web_kontrolu: 'ACIK', web_okuma_kullanicisi: '' }), parti())
    ),
  );
  for (const k of Object.keys(acik).filter((x) => x.startsWith('ear_web')))
    assert.ok(belgeli.has(k), `${k} playbook basliginda belgeli degil`);
  const regexler = [
    ...yml.matchAll(/\((ear_web_\w+) \| default\([^)]*\)(?: \| string)?\) is match\('([^']+)'\)/g),
  ];
  assert.equal(regexler.length, 6, 'Faz W assert regexleri: iki play, ucer tane');
  for (const [, ad, re] of regexler)
    assert.match(String(acik[ad]), new RegExp(re), `${ad} playbook assert'ini gecmez`);
});

test('EW6 ayarlar ve kapsam dogrulama', async () => {
  F.dbKur(F.sahteDb([]));
  ayar.onbellekSil();
  const d = (await ayar.oku()).deger;
  assert.equal(d.web_kontrolu, 'KAPALI', 'varsayilan KAPALI (pilot once)');
  assert.equal(d.web_hc, 'hc.html,hc.jsp');
  assert.equal(d.web_okuma_kullanicisi, '');
  assert.match(d.web_kokler, /^\/usr\/IBMIHS:/);
  const A = ayar.AYARLAR;
  assert.equal(A.web_hc.dogrula('hc.html,ping.jsp'), 'hc.html,ping.jsp');
  assert.equal(A.web_hc.dogrula('hc.html;rm -rf'), null);
  assert.equal(A.web_kokler.dogrula('/a:/b:/c:/d:/e:/f'), '/a:/b:/c:/d:/e:/f');
  assert.equal(
    A.web_kokler.dogrula(Array.from({ length: 11 }, (_, i) => `/k${i}`).join(':')),
    null,
    'en cok 10 aday kok',
  );
  assert.equal(A.web_kokler.dogrula('/a/../etc'), null);
  assert.equal(A.web_kokler.dogrula('goreli/yol'), null);
  assert.equal(A.web_okuma_kullanicisi.dogrula('Root!'), null);
  assert.equal(ayar.kapsamDogrula('WEB'), 'WEB');
  assert.equal(ayar.kapsamDogrula('FILO_WEB'), 'FILO_WEB');
  assert.equal(ayar.kapsamKapsar('FILO_WEB', 'WEB'), true);
  assert.equal(ayar.kapsamKapsar('FILO_WEB', 'ORTAM:PROD'), true);
  assert.equal(ayar.kapsamKapsar('FILO', 'WEB'), false, 'FILO 3-tier web sunucularini kapsamaz');
  assert.equal(ayar.kapsamKapsar('FILO', 'FILO_WEB'), false);
  assert.equal(ayar.kapsamKapsar('WEB', 'FILO'), false);
  assert.equal(ayar.kapsamKapsar('FILO', 'SORUNLU'), true, 'eski davranis korunur');
});

test('EW7 kapsam WEB: IHS / RHA urunlu sunucular; FILO_WEB birlesim; okunamazsa 424', async () => {
  let sql = [];
  sahteModul(INV_YOLU, {
    query: async (q) => {
      sql.push(q);
      if (/Server_Hub_Hosts/.test(q))
        return {
          recordset: [
            { host: 'websrv01.ornek.local', products: 'IHS,JBOSS7' },
            { host: 'websrv02', products: 'RHA' },
            { host: 'appsrv09', products: 'JBOSS8' },
            { host: 'ngxsrv01', products: 'NGINX' },
            { host: 'bos', products: null },
          ],
        };
      return {
        recordset: [
          { host: 'appsrv01', env: 'PROD' },
          { host: 'websrv02', env: 'PROD' },
        ],
      };
    },
  });
  const adlar = async (k) => (await poller.kapsamHedefleri(k)).hedefler.map((x) => x.host);
  assert.deepEqual(await adlar('WEB'), ['WEBSRV01', 'WEBSRV02']);
  assert.ok(
    sql.some((q) => /MAX\(scan_date\)/.test(q)),
    'yalniz son tarama',
  );
  assert.deepEqual(await adlar('FILO_WEB'), ['APPSRV01', 'WEBSRV01', 'WEBSRV02']);
  sahteModul(INV_YOLU, {
    query: async () => {
      throw new Error('baglanti yok');
    },
  });
  await assert.rejects(
    poller.kapsamHedefleri('WEB'),
    (e) => e.status === 424 && /okunamadı/.test(e.message),
  );
});

function pythonuBul() {
  for (const [komut, on] of adaylar()) {
    if (spawnSync(komut, [...on, '-c', 'import gzip, zlib'], { stdio: 'ignore' }).status === 0)
      return { komut, on };
  }
  return null;
}
const PY = pythonuBul();

test(
  'EW8 uctan uca: gercek web_tara.py ciktisi ham dosyada onceki bloklardan sonra -> webCoz',
  { skip: !PY && 'python3 yok' },
  () => {
    const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'ew8-'));
    const ihs = path.join(kok, 'IBMIHS');
    fs.mkdirSync(path.join(ihs, 'conf'), { recursive: true });
    fs.writeFileSync(
      path.join(ihs, 'conf', 'httpd.conf'),
      'Listen 80\n<VirtualHost *:80>\n  ServerName e2e.ornek.local\n  ProxyPass / ajp://appsrv07:8009/\n</VirtualHost>\n',
    );
    fs.mkdirSync(path.join(kok, 'proc', '1'), { recursive: true });
    fs.writeFileSync(path.join(kok, 'proc', '1', 'cmdline'), 'init\0');
    const r = spawnSync(PY.komut, [...PY.on, '-B', '-'], {
      input: fs.readFileSync(BETIK, 'utf8'),
      env: {
        PATH: process.env.PATH,
        LC_ALL: 'C',
        EAR_WEB_KOKLER: ihs,
        EAR_WEB_PROC: path.join(kok, 'proc'),
        EAR_WEB_IP_DOSYA: path.join(kok, 'yok'),
      },
    });
    assert.equal(r.status, 0, String(r.stderr));
    const ham = Buffer.concat([
      F.paketYap(F.ornekYuk()),
      Buffer.from('@@EAR_DEPLOYMENT_BASLA@@\nsurum=1\n@@EAR_DEPLOYMENT_BITTI@@\n'),
      r.stdout,
    ]);
    assert.equal(alim.paketCoz(ham).sema, 1, 'tarama paketi etkilenmez');
    const w = alim.webCoz(ham);
    assert.equal(w.durum, 'TAM');
    assert.equal(w.kurulumlar[0].kaynak, 'aday');
    assert.equal(w.kurulumlar[0].calisiyor, false, 'ps gorunur ve surec yok: calismiyor');
    const v = w.kurulumlar[0].vhostlar[0];
    assert.equal(v.server_name, 'e2e.ornek.local');
    assert.deepEqual(
      [v.hedefler[0].host, v.hedefler[0].port, v.hedefler[0].sema],
      ['appsrv07', 8009, 'ajp'],
    );
    assert.equal(v.loglar.length, 0);
    assert.equal(w.ipler.durum, 'OLCULEMEDI');
  },
);
