// server/server-hub/__tests__/hayalet-jvm.test.js - envanter uygulamasi <-> tarama JVM'i (2026-11-14).
//
// Uretim (ORJIST02): tarama ORFACELIFTSUBE-T1 / -T2 (JBoss 7) getirdi, dbo.MWAppsInventory uygulamayi
// ORFACELIFTSUBE-T diye tutuyor. Birebir ad eslemesi tutmayinca assess gen 0 bir hayalet JVM satiri
// uretiyordu; ekran "JBoss 0" yaziyor, satir bulgulara (gen 0 eylemli REBOOT_RISK), sayaclara, Kopya
// Durumu'na ve Uygulama 360'a siziyordu.
//
//   HJ1 -T vs -T1/-T2: numarali JVM'ler uygulamaya eslenir, hayalet satir YOK, sayaclar 2 JVM
//   HJ2 APP vs APPX: harf son eki ESLESMEZ; satir "yalniz envanterde", tek bilgi bulgusu, eylem / aday yok
//   HJ3 server-group eslemesi (APP, APP_Group, APP-Group) ve domain eslemesi (yalniz tekil domain)
//   HJ4 calma yok: baska uygulamaya BIREBIR eslenen JVM verilmez; cakismada daha ozgul (uzun) ad alir
//   HJ5 eslesmeyen uygulamanin ikinci envanter satiri (baska domain) ikinci satir uretmez
//   HJ6 tuketiciler: Kopya Durumu / KOPYA_TUTARSIZ, Uygulama 360, retire etiketi, iliski grafigi,
//       /jvm-autostart kapisi yalniz envanterdeki satiri atlar / reddeder
//   HJ7 sayi notu: numarali eslesmede envanter jvm_count != eslesen sayi -> TEK bilgi (INV_JVM_COUNT),
//       celiski sayacina (mismatched) girmez
//   HJ10 (inceleme B1/B4) ORJIST02 + prod kopyasi: -T1/-T2 ORTAM_KALINTISI / R10 olmaz; Uygulama 360 tek
//       uygulama; Retirement kaydi (envanter adi) numarali JVM'e baglanir, celiski kurulur
//   HJ11 (B2) numarali / grup eslesmesinde envanter auto-start'i JVM'e yazilmaz -> eylem yok
//   HJ12 (B5) rakamla biten ad: APP1 -> APP12 eslesmez (ayirac zorunlu); APP -> APP2024 eslesmez
//   HJ13 (B7) taramadan JVM satiri gelmeyen sunucuda INV_ONLY_APP "olculemedi" der
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { assess: assessHam, envanterEslestir } = require('../assess.cjs');
const { kopyaGruplari, yalnizEnvanter } = require('../capraz.cjs');
const { kopyaDurumu } = require('../kopya-durumu.cjs');
const { uygulamalar360 } = require('../uygulama-360.cjs');
const { etiketle } = require('../retire-etiket.cjs');
const { grafikKur } = require('../iliski-grafigi.cjs');
const { jvmAutoStartKapisi } = require('../autostart-dogrulama.cjs');

const D = '2026-11-14';
const NOW = Date.parse(`${D}T12:00:00Z`);
const assess = (d) => assessHam(d, { now: NOW });

const HOST = (host) => ({ host, scan_date: D, products: 'JBOSS7' });
const JB = (host) => ({
  host,
  gen: 7,
  host_name: 'master',
  host_state: 'running',
  cli: 'OK',
  note: '',
});
const JV = (host, jvm, ek = {}) => ({
  host,
  gen: 7,
  jvm,
  grp: 'g',
  running: 1,
  auto_start: 'true',
  server_state: 'running',
  ports: '',
  running_src: 'PS',
  cfg_src: 'CLI_WILDCARD',
  ...ek,
});
const INV = (host, app, ek = {}) => ({
  host,
  app,
  env: 'Test',
  status: 'running',
  jvm_count: 1,
  autostarts: 'true',
  domain: '',
  ...ek,
});
const kur = (hosts, jvms, mwApps) => ({
  hosts: hosts.map(HOST),
  jboss: hosts.map(JB),
  jvms,
  mwApps,
  invEnv: hosts.map((host) => ({ host, env: 'Test' })),
});
const sunucu = (r, host) => r.hosts.find((h) => h.host === host);

test('HJ1 ORJIST02: ORFACELIFTSUBE-T envanter uygulamasi -T1/-T2 tarama JVMlerine eslenir; hayalet (gen 0) satir yok', () => {
  const r = assess(
    kur(
      ['ORJIST02'],
      [
        JV('ORJIST02', 'ORFACELIFTSUBE-T1'),
        JV('ORJIST02', 'ORFACELIFTSUBE-T2', {
          running: 0,
          auto_start: 'false',
          running_src: 'PS_ABSENT',
          server_state: 'stopped',
        }),
      ],
      [INV('ORJIST02', 'ORFACELIFTSUBE-T', { jvm_count: 2, autostarts: 'true false' })],
    ),
  );
  const h = sunucu(r, 'ORJIST02');
  assert.deepEqual(
    h.jvms.map((j) => `${j.gen}|${j.name}|${j.source}`).sort(),
    ['7|ORFACELIFTSUBE-T1|cli', '7|ORFACELIFTSUBE-T2|cli'],
    'hayalet satir uretildi',
  );
  assert.ok(!h.jvms.some((j) => j.gen === 0 || yalnizEnvanter(j)));
  for (const j of h.jvms) {
    assert.equal(j.invApp, 'ORFACELIFTSUBE-T');
    assert.equal(j.invMatch, 'ad-sayi');
    assert.equal(j.invStatus, 'running');
  }
  assert.ok(!h.findings.some((f) => f.code === 'INV_ONLY_APP'));
  assert.ok(!h.findings.some((f) => /JBoss0\b/.test(f.text)), 'JBoss0 metinli bulgu');
  // uygulama duzeyinde durum: biri calisiyor -> envanter "running" ile celiski YOK
  assert.ok(!h.jvms.some((j) => (j.mismatch || []).some((m) => m.startsWith('durum:'))));
  assert.equal(r.summary.jvm.total, 2);
  assert.equal(r.summary.jvm.fromInventory, 0);
});

test('HJ2 APP vs APPX: harf son eki eslesmez; yalniz envanterde satiri bilgi verir, eylem / retire adayi / sayac uretmez', () => {
  // Envanter "calisiyor, auto-start kapali" diyor: hayalet satir eskiden gen 0 eylemli REBOOT_RISK uretiyordu.
  const r = assess(
    kur(
      ['ORAPPT01'],
      [JV('ORAPPT01', 'APPX')],
      [INV('ORAPPT01', 'APP', { status: 'running', autostarts: 'false' })],
    ),
  );
  const h = sunucu(r, 'ORAPPT01');
  const x = h.jvms.find((j) => j.name === 'APPX');
  assert.equal(x.invApp, undefined, 'APPX, APP uygulamasina eslendi');
  const e = h.jvms.filter(yalnizEnvanter);
  assert.equal(e.length, 1);
  assert.equal(e[0].name, 'APP');
  assert.equal(e[0].gen, 0, 'uyumluluk: gen 0 kalir');
  assert.equal(e[0].source, 'envanter');
  assert.equal(e[0].yalnizEnvanter, true);
  const app = h.findings.filter((f) => /\bAPP\b/.test(f.text) && !/APPX/.test(f.text));
  assert.deepEqual(
    app.map((f) => f.code),
    ['INV_ONLY_APP'],
  );
  assert.equal(app[0].severity, 'info');
  assert.ok(/yalnız envanterde/.test(app[0].text), app[0].text);
  assert.ok(
    !h.findings.some((f) => f.fix && f.fix.jvm === 'APP'),
    'yalniz envanterdeki satira eylem',
  );
  assert.ok(!h.findings.some((f) => f.fix && Number(f.fix.gen) === 0), 'gen 0 eylem');
  assert.ok(!(h.retireAdaylari || []).some((a) => a.ad === 'APP'), 'retire adayi');
  assert.equal(r.summary.jvm.total, 1, 'yalniz envanterdeki satir JVM sayisina girdi');
  assert.equal(r.summary.jvm.running, 1);
  assert.equal(r.summary.jvm.autoOff, 0);
  assert.equal(r.summary.jvm.fromInventory, 1);
  // saf esleme: numarali olmayan son ekler ve harf ekleri
  const es = (app, ad) => envanterEslestir([{ app }], [{ name: ad, group: 'g' }])[0].tur;
  for (const ad of ['APP1', 'APP-1', 'APP_01', 'APP.2', 'app3'])
    assert.equal(es('APP', ad), 'ad-sayi', ad);
  for (const ad of ['APPX', 'APP-X', 'APP1X', 'APP--1', 'XAPP1', 'APP-T1'])
    assert.equal(es('APP', ad), null, ad);
});

test('HJ3 server-group ve domain eslemesi; paylasilan domain eslemez', () => {
  const es = (apps, jvms) =>
    envanterEslestir(apps, jvms).map((x) => `${x.tur}:${x.jvms.map((j) => j.name).join(',')}`);
  assert.deepEqual(
    es(
      [{ app: 'crm' }],
      [
        { name: 'node-a', group: 'crm_Group' },
        { name: 'node-b', group: 'CRM-group' },
        { name: 'z', group: 'crmx_Group' },
      ],
    ),
    ['grup:node-a,node-b'],
  );
  assert.deepEqual(es([{ app: 'crm' }], [{ name: 'n1', group: 'crm' }]), ['grup:n1']);
  assert.deepEqual(es([{ app: 'crm', domain: 'dmz-grp' }], [{ name: 'n1', group: 'dmz-grp' }]), [
    'domain:n1',
  ]);
  // ayni domain'i iki uygulama tasiyor: hangisinin oldugu bilinmez, eslesme kurulmaz
  assert.deepEqual(
    es(
      [
        { app: 'crm', domain: 'ortak' },
        { app: 'pay', domain: 'ortak' },
      ],
      [{ name: 'n1', group: 'ortak' }],
    ),
    ['null:', 'null:'],
  );
  // assess uzerinden: grup eslemesi hayalet uretmez
  const r = assess(
    kur(
      ['ORGRPT01'],
      [JV('ORGRPT01', 'srv-one', { grp: 'billing_Group' })],
      [INV('ORGRPT01', 'billing')],
    ),
  );
  const h = sunucu(r, 'ORGRPT01');
  assert.equal(h.jvms.length, 1);
  assert.equal(h.jvms[0].invMatch, 'grup');
  assert.equal(h.jvms[0].invApp, 'billing');
});

test('HJ4 calma yok: birebir eslenen JVM baska uygulamaya verilmez; cakismada daha uzun ad kazanir', () => {
  const es = (apps, jvms) =>
    envanterEslestir(
      apps.map((app) => ({ app })),
      jvms.map((name) => ({ name, group: 'g' })),
    );
  const a = es(['APP', 'APP1'], ['APP1', 'APP2']);
  assert.deepEqual(
    a.map((x) => `${x.tur}:${x.jvms.map((j) => j.name)}`),
    ['ad-sayi:APP2', 'ad:APP1'],
  );
  // APP12 = APP + 12; APP1 + 2 DEGIL (rakamla biten adda ayirac zorunlu, HJ12)
  const b = es(['APP', 'APP1'], ['APP12']);
  assert.deepEqual(
    b.map((x) => `${x.tur}:${x.jvms.map((j) => j.name)}`),
    ['ad-sayi:APP12', 'null:'],
  );
  const b2 = es(['APP', 'APP1'], ['APP1-2']);
  assert.deepEqual(
    b2.map((x) => `${x.tur}:${x.jvms.map((j) => j.name)}`),
    ['null:', 'ad-sayi:APP1-2'],
  );
  // birebir eslesme oncelikli: APP JVM'i varken APP1 de varsa APP yalniz kendini alir
  const c = es(['APP'], ['APP', 'APP1']);
  assert.deepEqual(
    c.map((x) => `${x.tur}:${x.jvms.map((j) => j.name)}`),
    ['ad:APP'],
  );
  // yalniz envanterdeki satir (onceki kosudan) esleme kumesine girmez
  const d = envanterEslestir([{ app: 'APP' }], [{ name: 'APP', source: 'envanter' }]);
  assert.equal(d[0].tur, null);
});

test('HJ5 ayni uygulamanin iki envanter satiri (iki domain): eslesmezse TEK yalniz-envanter satiri, eslesirse ikisi de ayni JVMleri gorur', () => {
  const r = assess(
    kur(
      ['ORDUPT01'],
      [JV('ORDUPT01', 'other')],
      [INV('ORDUPT01', 'APP', { domain: 'd1' }), INV('ORDUPT01', 'APP', { domain: 'd2' })],
    ),
  );
  assert.equal(sunucu(r, 'ORDUPT01').jvms.filter(yalnizEnvanter).length, 1);
  const es = envanterEslestir(
    [
      { app: 'APP', domain: 'd1' },
      { app: 'APP', domain: 'd2' },
    ],
    [{ name: 'APP1' }, { name: 'APP2' }],
  );
  assert.deepEqual(
    es.map((x) => x.jvms.map((j) => j.name).join(',')),
    ['APP1,APP2', 'APP1,APP2'],
  );
});

test('HJ6 tuketiciler yalniz envanterdeki satiri tarama JVMi saymaz (kopya / 360 / etiket / grafik / auto-start kapisi)', () => {
  // ORKOPT01'de PAY gercekten taraniyor (calisiyor), ORKOPT02'de yalniz envanterde ve "stopped".
  // BATCH iki sunucuda da yalniz envanterde (biri running, biri stopped): eskiden gen 0 kopya grubu
  // kurulup KOPYA_TUTARSIZ + Kopya Durumu satiri uretiyordu.
  const r = assess(
    kur(
      ['ORKOPT01', 'ORKOPT02', 'ORKOPT03'],
      [
        JV('ORKOPT01', 'PAY', { auto_start: 'false' }),
        JV('ORKOPT02', 'other'),
        JV('ORKOPT03', 'other2'),
      ],
      [
        INV('ORKOPT01', 'PAY'),
        INV('ORKOPT02', 'PAY', { status: 'stopped', autostarts: 'true' }),
        INV('ORKOPT02', 'BATCH', { status: 'running', autostarts: 'true' }),
        INV('ORKOPT03', 'BATCH', { status: 'stopped', autostarts: 'false' }),
      ],
    ),
  );
  const h2 = sunucu(r, 'ORKOPT02');
  const hayalet = h2.jvms.find((j) => yalnizEnvanter(j) && j.name === 'PAY');
  assert.ok(hayalet && hayalet.name === 'PAY');
  // Kopya: tek tarama kopyasi var, grup kurulmaz; KOPYA_TUTARSIZ yok
  for (const [, grup] of kopyaGruplari(r.hosts))
    assert.ok(!grup.some((c) => yalnizEnvanter(c.j)), 'kopya grubunda');
  assert.ok(!r.hosts.some((h) => h.findings.some((f) => f.code === 'KOPYA_TUTARSIZ')));
  assert.equal(kopyaDurumu(r.hosts).gruplar.length, 0);
  // STOPPED_AUTOSTART_ON (envanter: stopped + auto-start true) eskiden gen 0 eylemle uretiliyordu
  assert.ok(!h2.findings.some((f) => f.code === 'STOPPED_AUTOSTART_ON'));
  // Uygulama 360: PAY tek kopya (ORKOPT01), nesil listesinde 0 yok
  const u = uygulamalar360(r.hosts).uygulamalar.find((x) => x.anahtar === 'PAY');
  assert.equal(u.kopyaSayisi, 1);
  assert.deepEqual(u.nesiller, [7]);
  // retire etiketi ve iliski grafigi
  assert.ok(
    !uygulamalar360(r.hosts).uygulamalar.some((x) => x.anahtar === 'BATCH'),
    '360 yalniz envanterdeki uygulamayi kopya saydi',
  );
  // ORKOPT01/PAY calisiyor + auto-start kapali (R7 adayi): etiket kurulur, kopya zinciri ayni ortamdaki
  // kopyalari toplar; ORKOPT02'deki yalniz envanter satiri zincire GIRMEZ.
  const et = etiketle({ hosts: r.hosts });
  const pay = et.etiketler.filter((e) => /PAY/.test(e.ad || ''));
  assert.ok(pay.length > 0, 'kontrol: PAY etiketi kurulmadi');
  assert.ok(
    pay.every((e) => !(e.hostlar || []).includes('ORKOPT02')),
    'retire etiketi zincirinde yalniz envanterdeki kopya',
  );
  assert.ok(
    !et.etiketler.some((e) =>
      (e.kopyalar || []).some(
        (k) => Number(k.gen) === 0 || (k.host !== 'ORKOPT01' && /PAY|BATCH/.test(k.ad || '')),
      ),
    ),
    'retire etiketinde yalniz envanterdeki kopya',
  );
  const g = grafikKur({ hosts: r.hosts });
  assert.ok(g.dugumler.has('jvm:ORKOPT01|7|PAY'), 'kontrol: tarama JVMi grafikte');
  assert.ok(!g.dugumler.has('jvm:ORKOPT02|0|PAY'), 'grafikte gen 0 dugum');
  // /jvm-autostart ve Toplu Auto-Start ortak kapisi
  const k = jvmAutoStartKapisi(hayalet, { host: 'ORKOPT02', jvm: 'PAY', gen: 0, enable: false });
  assert.equal(k && k.status, 400);
  assert.ok(/yalnız envanterde/.test(k.message), k.message);
  // host listesi sayaclari
  const s = require('../index.cjs').hostRow(h2);
  assert.equal(s.jvms, 1, 'host listesi yalniz envanterdeki satiri JVM saydi');
  assert.equal(s.jvmsInventoryOnly, 2);
});

test('HJ7 numarali eslesme: envanter jvm_count eslesen sayidan farkliysa TEK bilgi notu (INV_JVM_COUNT), celiski sayilmaz', () => {
  const r = assess(
    kur(
      ['ORCNTT01'],
      [JV('ORCNTT01', 'SHOP1'), JV('ORCNTT01', 'SHOP2')],
      [INV('ORCNTT01', 'SHOP', { jvm_count: 3, autostarts: 'true true true' })],
    ),
  );
  const h = sunucu(r, 'ORCNTT01');
  for (const j of h.jvms) assert.deepEqual(j.mismatch, [], 'sayi notu celiski listesine yazildi');
  const f = h.findings.filter((x) => x.code === 'INV_JVM_COUNT');
  assert.equal(f.length, 1, 'uygulama basina tek not');
  assert.ok(
    /JVM sayısı: envanter 3 \(SHOP\), taramada eşleşen 2 \(SHOP1, SHOP2\)/.test(f[0].text),
    f[0].text,
  );
  assert.ok(f.every((x) => x.severity === 'info' && !x.fix));
  assert.ok(!h.findings.some((x) => x.code === 'INV_MISMATCH'));
  assert.equal(r.summary.jvm.mismatched, 0, 'sayi notu "envanterle celisen" sayacina girdi');
  assert.ok(require('../kural-katalogu.cjs').KODLAR.has('INV_JVM_COUNT'), 'katalogda yok');
  // birebir eslesmede sayi notu yazilmaz (bugunku davranis)
  const b = assess(
    kur(['ORCNTT02'], [JV('ORCNTT02', 'SHOP')], [INV('ORCNTT02', 'SHOP', { jvm_count: 3 })]),
  );
  assert.deepEqual(sunucu(b, 'ORCNTT02').jvms[0].mismatch, []);
});

test("HJ8 retire etiketi EAR zinciri: EAR'in bagli JVM'i yalniz envanterdeyse 'calisiyor' envanterden okunmaz (bilinmiyor)", () => {
  const h = {
    host: 'OREART01',
    env: 'TEST',
    fresh: true,
    scanDate: D,
    jvms: [
      {
        gen: 0,
        name: 'PAY',
        source: 'envanter',
        yalnizEnvanter: true,
        running: true,
        runningKnown: true,
        autoStart: 'true',
        vhosts: [],
      },
    ],
    ear: {
      durum: 'VAR',
      taranma: D,
      uygulamalar: [
        {
          kok: '/vhosting/jboss7',
          ad: 'PAY.ear',
          durum: 'OK',
          warSayisi: 0,
          xml: { durum: 'VAR', jvmler: [{ ad: 'PAY' }] },
        },
      ],
    },
    retireAdaylari: [
      { kural: 'R3', tur: 'EAR', ad: 'PAY.ear', host: 'OREART01', kok: '/vhosting/jboss7' },
    ],
  };
  const et = etiketle({ hosts: [h] }).etiketler;
  assert.equal(et.length, 1);
  const j = et[0].kopyalar[0].jvmler[0];
  assert.equal(j.ad, 'PAY');
  assert.equal(
    j.calisiyor,
    null,
    'yalniz envanterdeki satirin envanter durumu calisma kaniti sayildi',
  );
});

test('HJ9 capraz: yalniz envanterdeki satir ortam kalintisi ve Retirement celiskisi uretmez', () => {
  const { caprazAnaliz } = require('../capraz.cjs');
  const HH = (host, env, jvms) => ({
    host,
    env,
    fresh: true,
    taramadanDustu: false,
    scanDate: D,
    jvms,
  });
  const hay = (name, ek = {}) => ({
    gen: 0,
    name,
    source: 'envanter',
    yalnizEnvanter: true,
    running: true,
    runningKnown: true,
    autoStart: 'true',
    ...ek,
  });
  const tj = (name, ek = {}) => ({
    gen: 7,
    name,
    source: 'cli',
    running: true,
    runningKnown: true,
    autoStart: 'true',
    ...ek,
  });
  // kalinti: TEST'te yalniz envanterde "calisiyor" PAY-T, prod kopyasi kapali -> iddia KURULMAZ
  const hosts = [
    HH('ORPAYT01', 'TEST', [hay('PAY-T')]),
    HH('ORPAYP01', 'PROD', [tj('PAY', { running: false })]),
  ];
  const c = caprazAnaliz(hosts, {});
  assert.equal(
    c.jvm('ORPAYT01', hosts[0].jvms[0]),
    null,
    'yalniz envanterdeki satira capraz sonuc',
  );
  // kontrol: ayni durum tarama JVM'iyle kalinti uretir
  const k = [
    HH('ORPAYT01', 'TEST', [tj('PAY-T')]),
    HH('ORPAYP01', 'PROD', [tj('PAY', { running: false })]),
  ];
  assert.ok(
    caprazAnaliz(k, {}).jvm('ORPAYT01', k[0].jvms[0]).kalinti,
    'kontrol: kalinti kurulmadi',
  );
  // celiski: Retirement hedefi stopped, JVM yalniz envanterde "calisiyor" -> celiski YOK
  const ret = {
    retirement: {
      hedefler: [
        {
          host: 'ORRETT01',
          uygulama: 'OLD',
          gen: null,
          durum: 'stopped',
          kayit: 5,
          hedef: 9,
          yol: '',
          durdurulduMs: Date.parse('2026-11-10T08:00:00Z'),
        },
      ],
    },
  };
  const rh = [HH('ORRETT01', 'TEST', [hay('OLD')])];
  const cx = caprazAnaliz(rh, { capraz: ret }).jvm('ORRETT01', rh[0].jvms[0]);
  assert.ok(!cx || cx.celiski.length === 0, 'yalniz envanterdeki satirda Retirement celiskisi');
  // Retirement kaydi bilgi olarak satira baglanir
  assert.ok(cx && cx.retirement.length === 1, 'Retirement bilgisi kayboldu');
  const kr = [HH('ORRETT01', 'TEST', [tj('OLD')])];
  assert.equal(
    caprazAnaliz(kr, { capraz: ret }).jvm('ORRETT01', kr[0].jvms[0]).celiski.length,
    1,
    'kontrol: celiski kurulmadi',
  );
});

test('HJ10 ORJIST02 + prod kopyasi: -T1/-T2 kalinti / R10 olmaz, 360 tek uygulama, Retirement kaydi numarali JVMe baglanir', () => {
  const d = {
    hosts: [HOST('ORJIST02'), HOST('ORJISP02')],
    jboss: [JB('ORJIST02'), JB('ORJISP02')],
    jvms: [
      JV('ORJIST02', 'ORFACELIFTSUBE-T1'),
      JV('ORJIST02', 'ORFACELIFTSUBE-T2'),
      JV('ORJISP02', 'ORFACELIFTSUBE1'),
      JV('ORJISP02', 'ORFACELIFTSUBE2'),
    ],
    mwApps: [
      INV('ORJIST02', 'ORFACELIFTSUBE-T', { jvm_count: 2, autostarts: 'true true' }),
      INV('ORJISP02', 'ORFACELIFTSUBE', {
        env: 'Production',
        jvm_count: 2,
        autostarts: 'true true',
      }),
    ],
    invEnv: [
      { host: 'ORJIST02', env: 'Test' },
      { host: 'ORJISP02', env: 'Production' },
    ],
  };
  const r = assess(d);
  const t = sunucu(r, 'ORJIST02');
  assert.ok(
    !t.findings.some((f) => f.code === 'ORTAM_KALINTISI'),
    t.findings.map((f) => `${f.code}: ${f.text}`).join('\n'),
  );
  assert.ok(!(t.retireAdaylari || []).some((a) => a.kural === 'R10'), 'R10 retire adayi');
  // kontrol: prod kopyalari yokken (prod sunucusu taramada yok, envanter de yok) kalinti kurulur
  const k = assess({
    ...d,
    hosts: [HOST('ORJIST02')],
    jboss: [JB('ORJIST02')],
    jvms: d.jvms.slice(0, 2),
    mwApps: d.mwApps.slice(0, 1),
    invEnv: d.invEnv.slice(0, 1),
  });
  assert.ok(
    sunucu(k, 'ORJIST02').findings.some((f) => f.code === 'ORTAM_KALINTISI'),
    'kontrol: kalinti kurulmadi',
  );
  // Uygulama 360: T1/T2 ve prod 1/2 ayni uygulama (ORFACELIFTSUBE)
  const u = uygulamalar360(r.hosts).uygulamalar;
  assert.deepEqual(
    u.map((x) => x.anahtar),
    ['ORFACELIFTSUBE'],
  );
  assert.equal(u[0].kopyaSayisi, 4);
  // etiket JVM adiyla gelir (ORFACELIFTSUBE-T1): satira (ORFACELIFTSUBE) baglanir, kaybolmaz
  const ue = uygulamalar360(r.hosts, [{ tur: 'JVM', ad: 'ORFACELIFTSUBE-T1', seviye: 'SUPHELI' }]);
  assert.equal(
    ue.ayrinti('ORFACELIFTSUBE').etiketler.length,
    1,
    'etiket uygulama satirina baglanmadi',
  );
  // Retirement: kayit envanter adiyla (ORFACELIFTSUBE-T) STOP; T1 hala calisiyor -> celiski T1/T2'de
  const { caprazAnaliz } = require('../capraz.cjs');
  const ret = {
    retirement: {
      hedefler: [
        {
          host: 'ORJIST02',
          uygulama: 'ORFACELIFTSUBE-T',
          gen: 7,
          durum: 'stopped',
          kayit: 11,
          hedef: 3,
          yol: '',
          durdurulduMs: Date.parse('2026-11-10T08:00:00Z'),
        },
      ],
    },
  };
  const cx = caprazAnaliz(r.hosts, { capraz: ret });
  for (const j of t.jvms) {
    const c = cx.jvm('ORJIST02', j);
    assert.ok(c && c.retirement.length === 1, `${j.name}: Retirement bilgisi baglanmadi`);
    assert.ok(
      c.celiski.length === 1 && c.celiski[0].nedenler.includes('calisiyor'),
      `${j.name}: celiski kurulmadi`,
    );
  }
});

test('HJ11 numarali / grup eslesmesinde envanter auto-start degeri JVMe yazilmaz: REBOOT_RISK / eylem yok', () => {
  const r = assess(
    kur(
      ['ORASFT01'],
      [
        JV('ORASFT01', 'SHOP-1', { auto_start: 'unknown' }),
        JV('ORASFT01', 'node-a', { auto_start: 'unknown', grp: 'crm_Group' }),
      ],
      [
        INV('ORASFT01', 'SHOP', { autostarts: 'false' }),
        INV('ORASFT01', 'crm', { autostarts: 'false' }),
      ],
    ),
  );
  const h = sunucu(r, 'ORASFT01');
  for (const j of h.jvms) {
    assert.equal(j.autoStart, 'unknown', `${j.name}: envanter degeri JVMe yazildi`);
    assert.equal(j.invAutoStart, 'false', 'envanter degeri bilgi olarak kalmali');
    assert.notEqual(j.autoStartSource, 'envanter');
  }
  assert.ok(
    !h.findings.some((f) => f.code === 'REBOOT_RISK' || f.fix),
    h.findings.map((f) => f.code).join(','),
  );
  // kontrol: birebir ad eslemesinde envanter kazanir (bugunku davranis)
  const b = assess(
    kur(
      ['ORASFT02'],
      [JV('ORASFT02', 'SHOP', { auto_start: 'unknown' })],
      [INV('ORASFT02', 'SHOP', { autostarts: 'false' })],
    ),
  );
  const j = sunucu(b, 'ORASFT02').jvms[0];
  assert.equal(j.autoStart, 'false');
  assert.equal(j.autoStartSource, 'envanter');
});

test('HJ12 rakamla biten uygulama adi: ayirac zorunlu (APP1 -> APP12 eslesmez); en cok 3 haneli son ek', () => {
  const es = (app, ad) => envanterEslestir([{ app }], [{ name: ad, group: 'g' }])[0].tur;
  for (const ad of ['APP12', 'APP13', 'APP100']) assert.equal(es('APP1', ad), null, ad);
  for (const ad of ['APP1-2', 'APP1_02', 'APP1.3']) assert.equal(es('APP1', ad), 'ad-sayi', ad);
  assert.equal(es('APP', 'APP2024'), null, 'yil / 4 hane numara sayildi');
  assert.equal(es('APP', 'APP001'), 'ad-sayi');
  // assess: APP1 envanterde, taramada yalniz APP12 -> APP12 APP1'e baglanmaz
  const r = assess(kur(['ORNUMT01'], [JV('ORNUMT01', 'APP12')], [INV('ORNUMT01', 'APP1')]));
  const h = sunucu(r, 'ORNUMT01');
  assert.equal(h.jvms.find((j) => j.name === 'APP12').invApp, undefined);
  assert.equal(h.jvms.filter(yalnizEnvanter).length, 1);
});

test('HJ13 taramadan JVM satiri gelmeyen sunucuda INV_ONLY_APP "olculemedi" der, "eslesmedi" demez', () => {
  const r = assess({
    hosts: [HOST('ORNOJT01')],
    jboss: [JB('ORNOJT01')],
    jvms: [],
    mwApps: [INV('ORNOJT01', 'APP')],
    invEnv: [{ host: 'ORNOJT01', env: 'Test' }],
  });
  const h = sunucu(r, 'ORNOJT01');
  assert.ok(
    h.findings.some((f) => f.code === 'JVM_DATA_MISSING'),
    'kontrol',
  );
  const f = h.findings.find((x) => x.code === 'INV_ONLY_APP');
  assert.ok(/JVM satırı gelmedi, eşleşme ölçülemedi/.test(f.text), f.text);
  assert.ok(!/eşleşmedi\)/.test(f.text));
  // kontrol: tarama JVM'i varken "bulunamadi" metni
  const r2 = assess(kur(['ORNOJT02'], [JV('ORNOJT02', 'other')], [INV('ORNOJT02', 'APP')]));
  assert.ok(
    /JVM'i bulunamadı/.test(
      sunucu(r2, 'ORNOJT02').findings.find((x) => x.code === 'INV_ONLY_APP').text,
    ),
  );
});
