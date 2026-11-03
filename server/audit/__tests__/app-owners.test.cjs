// server/audit/__tests__/app-owners.test.cjs - UYGULAMA basina sahip (dbo.Openshift_App_Owners)
// ve namespace sahibi yedegi (2026-11-02).
//
// Kullanici: namespace sahibini uygulamanin sahibi gibi yazmak geri donus almada sorun
// cikariyor; uygulama bazli sahip, "bulunamazsa namespace sahibi gosterilsin".
//   AO1  uygulama tablosu YOK (dagitim sirasi): ownersForApp birebir ownersFor, kaynak yok
//   AO2  uygulama satiri kendi sahibini tasiyor: grup + kaynak uygulamadan, namespace ezilmez
//   AO3  uygulama satiri YOK: namespace sahibi, kaynak NAMESPACE, nsSahibi dolu
//   AO4  satir kaynak NAMESPACE: namespace tablosu oncelikli, o yoksa satirin kendi grubu
//   AO5  ortamlar arasi karisik kaynak: dev ARK997_AGILE, prod SI51_YAZILIM, test yedek, bilinmeyen
//   AO6  kaynak YOK / grup bos: yedek yoksa unknownNs
//   AO7  ayni ns/app birden cok cluster: kendi sahibini tasiyan satir kazanir
//   AO8  yukleyici: iki tablo bagimsiz okunur (biri yokken digeri kullanilir), ready anlami
//   AO9  buyuk/kucuk harf duyarsiz anahtar; uygulama adi bossa eski davranis
//   AO10 Intranet SPA: owners verilince ekipKaynak, verilmezse eski (ownersByNs)
//   AO11 SPA Raporu: ekipOf (ns, app) alir; nesne donusu teamKaynak, dizi donusu eskisi gibi
//   AO12 Kapsam intranet hucresi: ownerOf'a uygulama adi gider
//   AO13 Glomo gecis canli raporu: teamKaynak grup basina tasinir, NAMESPACE uygulama kaynagina yenilir
//   AO14 bekci: tum cagiranlar ownersForApp'i UYGULAMA adiyla cagirir (namespace-only kalmadi);
//        yorumlar SILINEREK aranir (yorumda kalan dogru cagri bekciyi kandiramaz). Asil guvence
//        davranis testleri: app-owners-uctan.test.cjs, spa-report/__tests__/app-owners-yol.test.cjs,
//        nginx-migration-traffic MT14, gecis GG4b/GG4c.
//   AO15 namespace tablosu GECICI okunamaz, uygulama tablosu okunur: kendi sahibi olmayan uygulama
//        "veri yok" (veriYokNs), "bilinmiyor" (unknownNs) degil; sonuc onbellege girmez. Tablo YOK
//        (Invalid object name) kalici: onbellege girer.
//   AO16 lookup_status ARK_DISI (2026-11-03, Ansible kural 2: ARK disi cluster CMDB'ye hic gitmez):
//        durum suzulmez, yalniz kaynak belirleyicidir; ARK satiri ARK disi kopyasini yener.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  indexOwners,
  indexAppOwners,
  ownersFor,
  ownersForApp,
  loadNamespaceOwners,
  _resetCache,
} = require('../ns-owners.cjs');

const NS_SATIR = [
  { namespace: 'muh-dev', owner_group_name: 'GT-NS-DEV', owner_email: 'nsdev@x', lookup_status: 'OK' },
  { namespace: 'muh-test', owner_group_name: 'GT-NS-TEST', owner_email: 'nstest@x', lookup_status: 'OK' },
  { namespace: 'muh-prod', owner_group_name: 'GT-NS-PROD', owner_email: 'nsprod@x', lookup_status: 'OK' },
  { namespace: 'bos-prod', owner_group_name: null, owner_email: null, lookup_status: 'SORUMLU_YOK' },
];
const A = (namespace, application, o = {}) => ({
  cluster: 'gbocpprod1',
  namespace,
  application,
  owner_group_name: null,
  owner_email: null,
  responsible_id: null,
  kaynak: 'YOK',
  configuration_id: null,
  lookup_status: 'OK',
  lookup_message: '',
  ...o,
});
const sahipler = (appRows, nsRows = NS_SATIR) => ({
  ready: true,
  nsReady: true,
  byNs: indexOwners(nsRows),
  appReady: appRows !== null,
  byApp: appRows === null ? new Map() : indexAppOwners(appRows),
});

test('AO1 uygulama tablosu yokken birebir eski davranis (kaynak bilgisi yok)', () => {
  const o = sahipler(null);
  const nss = ['muh-dev', 'muh-prod', 'bos-prod', 'hic-yok'];
  const yeni = ownersForApp(o, 'accnting-process-app', nss);
  const eski = ownersFor(o.byNs, nss);
  assert.deepEqual(
    { groups: yeni.groups, emails: yeni.emails, unknownNs: yeni.unknownNs },
    eski,
  );
  assert.deepEqual([yeni.kaynaklar, yeni.nsSahibi, yeni.appReady], [[], [], false]);
  // loadNamespaceOwners dusmus/eski sekil ({ready, byNs}) de ayni sonucu verir.
  const eskiSekil = ownersForApp({ ready: true, byNs: o.byNs }, 'accnting-process-app', nss);
  assert.deepEqual(eskiSekil.groups, eski.groups);
  assert.deepEqual(eskiSekil.kaynaklar, []);
  assert.deepEqual(ownersForApp(undefined, 'x', ['muh-dev']).unknownNs, ['muh-dev']);
});

test('AO2 uygulamanin kendi CMDB sahibi namespace sahibinin onune gecer', () => {
  const o = sahipler([
    A('muh-prod', 'accnting-process-app', {
      owner_group_name: 'SI51_AGILE_12891',
      owner_email: 'agile@x',
      responsible_id: '12891',
      kaynak: 'SI51_AGILE',
      configuration_id: 4177193,
    }),
  ]);
  const r = ownersForApp(o, 'accnting-process-app', ['muh-prod']);
  assert.deepEqual(r.groups, ['SI51_AGILE_12891']);
  assert.deepEqual(r.emails, ['agile@x']);
  assert.deepEqual(r.kaynaklar, ['SI51_AGILE']);
  assert.deepEqual(r.nsSahibi, []);
  assert.ok(!r.groups.includes('GT-NS-PROD'), 'namespace sahibi uygulama sahibi gibi eklendi');
  assert.equal(o.byApp.get('muh-prod/accnting-process-app').configurationId, '4177193');
});

test('AO3 uygulama satiri yoksa namespace sahibi, kaynak NAMESPACE olarak isaretli', () => {
  const o = sahipler([A('muh-prod', 'baska-app', { owner_group_name: 'X', kaynak: 'SI51_AGILE' })]);
  const r = ownersForApp(o, 'accnting-process-app', ['muh-prod']);
  assert.deepEqual(r.groups, ['GT-NS-PROD']);
  assert.deepEqual(r.emails, ['nsprod@x']);
  assert.deepEqual(r.kaynaklar, ['NAMESPACE']);
  assert.deepEqual(r.nsSahibi, ['muh-prod']);
  assert.equal(r.appReady, true);
});

test('AO4 satir kaynak NAMESPACE: namespace tablosu oncelikli, yoksa satirin kendi grubu', () => {
  const o = sahipler([
    A('muh-prod', 'app-a', { owner_group_name: 'ESKI-NS-KOPYA', kaynak: 'NAMESPACE' }),
    A('yeni-prod', 'app-b', { owner_group_name: 'SATIR-NS', owner_email: 'satir@x', kaynak: 'namespace' }),
  ]);
  const a = ownersForApp(o, 'app-a', ['muh-prod']);
  assert.deepEqual([a.groups, a.kaynaklar, a.nsSahibi], [['GT-NS-PROD'], ['NAMESPACE'], ['muh-prod']]);
  const b = ownersForApp(o, 'app-b', ['yeni-prod']);
  assert.deepEqual([b.groups, b.emails, b.kaynaklar], [['SATIR-NS'], ['satir@x'], ['NAMESPACE']]);
});

test('AO5 ortamlar arasi karisik kaynak: her grup kendi kaynagiyla, bilinmeyen gorunur', () => {
  const o = sahipler([
    A('muh-dev', 'app', { owner_group_name: 'ARK997_AGILE_12891', kaynak: 'ARK997_AGILE' }),
    A('muh-prod', 'app', { owner_group_name: 'YAZ-13306', kaynak: 'SI51_YAZILIM' }),
    A('muh-test', 'app', { kaynak: 'YOK', lookup_status: 'CMDB_KAYIT_YOK' }),
  ]);
  const r = ownersForApp(o, 'app', ['muh-dev', 'muh-test', 'muh-prod', 'muh-qa']);
  assert.deepEqual(r.groups, ['ARK997_AGILE_12891', 'GT-NS-TEST', 'YAZ-13306']);
  assert.deepEqual(r.kaynaklar, ['ARK997_AGILE', 'NAMESPACE', 'SI51_YAZILIM']);
  assert.deepEqual(r.nsSahibi, ['muh-test']);
  assert.deepEqual(r.unknownNs, ['muh-qa']);
  // Ayni grup bir ortamda yedekten, digerinde uygulamadan geldiyse kaynak uygulamanindir.
  const ayni = sahipler(
    [A('muh-prod', 'app', { owner_group_name: 'GT-NS-DEV', kaynak: 'ARK997_YAZILIM' })],
  );
  const s = ownersForApp(ayni, 'app', ['muh-dev', 'muh-prod']);
  assert.deepEqual([s.groups, s.kaynaklar], [['GT-NS-DEV'], ['ARK997_YAZILIM']]);
  assert.equal(s.groups.length, s.kaynaklar.length);
});

test('AO6 kaynak YOK ve yedek de yoksa namespace bilinmeyenler listesinde', () => {
  const o = sahipler([A('bos-prod', 'app', { kaynak: 'YOK' }), A('kayip-prod', 'app', { kaynak: '' })]);
  const r = ownersForApp(o, 'app', ['bos-prod', 'kayip-prod']);
  assert.deepEqual([r.groups, r.kaynaklar, r.unknownNs], [[], [], ['bos-prod', 'kayip-prod']]);
  // Grubu olmayan bir "uygulama kaynagi" (bozuk satir) sahip sayilmaz -> yedek.
  const bozuk = sahipler([A('muh-prod', 'app', { owner_group_name: '  ', kaynak: 'SI51_AGILE' })]);
  assert.deepEqual(ownersForApp(bozuk, 'app', ['muh-prod']).kaynaklar, ['NAMESPACE']);
});

test('AO7 ayni ns/app birden cok cluster: kendi sahibini tasiyan satir kazanir (sira fark etmez)', () => {
  const ns = A('muh-prod', 'app', { cluster: 'c1', owner_group_name: 'NSK', kaynak: 'NAMESPACE' });
  const yok = A('muh-prod', 'app', { cluster: 'c3', kaynak: 'YOK' });
  const gercek = A('muh-prod', 'app', { cluster: 'c2', owner_group_name: 'GERCEK', kaynak: 'ARK997_AGILE' });
  for (const sira of [[ns, yok, gercek], [gercek, ns, yok], [yok, gercek, ns]]) {
    const m = indexAppOwners(sira);
    assert.equal(m.get('muh-prod/app').group, 'GERCEK', JSON.stringify(sira.map((x) => x.cluster)));
    assert.equal(m.get('muh-prod/app').cluster, 'c2');
  }
  // Iki yedek arasinda grubu olan, grubu olmayana tercih edilir.
  assert.equal(indexAppOwners([yok, ns]).get('muh-prod/app').group, 'NSK');
});

test('AO8 yukleyici: iki tablo bagimsiz; uygulama tablosu yokken eski anlam, sorgu sutunlari', async () => {
  const sorgu = (yokTablolar, kayit = []) => async (q) => {
    const s = String(q);
    kayit.push(s);
    for (const t of yokTablolar) if (s.includes(t)) throw new Error(`Invalid object name 'dbo.${t}'.`);
    if (s.includes('dbo.Openshift_Namespace_Owners')) return { recordset: NS_SATIR };
    if (s.includes('dbo.Openshift_App_Owners'))
      return { recordset: [A('muh-prod', 'app', { owner_group_name: 'G', kaynak: 'SI51_AGILE' })] };
    throw new Error('beklenmeyen sorgu');
  };
  _resetCache();
  const kayit = [];
  const r1 = await loadNamespaceOwners(sorgu(['Openshift_App_Owners'], kayit));
  assert.deepEqual([r1.ready, r1.nsReady, r1.appReady, r1.byApp.size, r1.byNs.size], [true, true, false, 0, 4]);
  const app = kayit.find((s) => s.includes('Openshift_App_Owners'));
  for (const c of ['namespace', 'application', 'owner_group_name', 'owner_email', 'kaynak', 'lookup_status']) {
    assert.ok(new RegExp(`\\b${c}\\b`).test(app), `uygulama sorgusunda ${c} yok`);
  }
  _resetCache();
  const r2 = await loadNamespaceOwners(sorgu(['Openshift_Namespace_Owners']));
  assert.deepEqual([r2.ready, r2.nsReady, r2.appReady, r2.byNs.size, r2.byApp.size], [true, false, true, 0, 1]);
  assert.deepEqual(ownersForApp(r2, 'app', ['muh-prod']).kaynaklar, ['SI51_AGILE']);
  _resetCache();
  const r3 = await loadNamespaceOwners(sorgu(['Openshift_Namespace_Owners', 'Openshift_App_Owners']));
  assert.deepEqual([r3.ready, r3.appReady], [false, false]);
  _resetCache();
});

test('AO9 buyuk/kucuk harf ve bosluk duyarsiz; uygulama adi bossa eski davranis', () => {
  const o = sahipler([A(' MUH-PROD ', 'Accnting-Process-App', { owner_group_name: 'G', kaynak: 'si51_agile' })]);
  const r = ownersForApp(o, 'ACCNTING-PROCESS-APP ', ['Muh-Prod']);
  assert.deepEqual([r.groups, r.kaynaklar], [['G'], ['SI51_AGILE']]);
  const bos = ownersForApp(o, '', ['muh-prod']);
  assert.deepEqual([bos.groups, bos.kaynaklar], [['GT-NS-PROD'], []]);
});

test('AO10 Intranet SPA: owners verilince uygulama sahibi + ekipKaynak, verilmezse eskisi', () => {
  const { buildIntranetRapor } = require('../../spa-report/intranet.cjs');
  const uyg = (application) => ({
    env: 'PROD', namespace: 'muh-prod', application, spa: 'evet', ag: 'intranet',
    clusters: ['gbocpprod1'], hosts: [], staleClusters: [],
  });
  const o = sahipler([A('muh-prod', 'kendi', { owner_group_name: 'APP-G', owner_email: 'app@x', kaynak: 'ARK997_AGILE' })]);
  const base = { apps: [uyg('kendi'), uyg('yedekli')], beyanlar: new Map(), dirRows: [], hosts: [] };
  const yeni = buildIntranetRapor({ ...base, ownersByNs: o.byNs, owners: o });
  const by = Object.fromEntries(yeni.rows.map((r) => [r.application, r]));
  assert.ok(by.kendi && by.yedekli, 'satirlar rapora girmedi: ' + JSON.stringify(yeni.rows.map((r) => r.application)));
  assert.deepEqual([by.kendi.ekip, by.kendi.ekipEposta, by.kendi.ekipKaynak], [['APP-G'], ['app@x'], ['ARK997_AGILE']]);
  assert.deepEqual([by.yedekli.ekip, by.yedekli.ekipKaynak], [['GT-NS-PROD'], ['NAMESPACE']]);
  const eski = buildIntranetRapor({ ...base, ownersByNs: o.byNs });
  for (const r of eski.rows) assert.deepEqual([r.ekip, r.ekipKaynak], [['GT-NS-PROD'], []]);
});

test('AO11 SPA Raporu: ekipOf (ns, app) alir; nesne donusu teamKaynak, dizi donusu eskisi gibi', () => {
  const { buildSpaReport } = require('../../spa-report/build.cjs');
  const rows = [
    { service: 'GLOMO', env: 'PROD', application: 'app-a', namespace: 'muh-prod', location_path: '/a/', host: 'H1' },
    { service: 'GLOMO', env: 'PROD', application: 'app-b', namespace: 'muh-prod', location_path: '/b/', host: 'H1' },
  ];
  const o = sahipler([A('muh-prod', 'app-a', { owner_group_name: 'APP-A', kaynak: 'SI51_AGILE' })]);
  const cagri = [];
  const r = buildSpaReport({
    rows, beyanlar: new Map(), trafficOf: () => null, env: 'PROD',
    ekipOf: (ns, app) => { cagri.push(`${ns}/${app}`); return ownersForApp(o, app, [ns]); },
  });
  const by = Object.fromEntries(r.rows.map((x) => [x.application, x]));
  assert.deepEqual([by['app-a'].team, by['app-a'].teamKaynak], [['APP-A'], ['SI51_AGILE']]);
  assert.deepEqual([by['app-b'].team, by['app-b'].teamKaynak], [['GT-NS-PROD'], ['NAMESPACE']]);
  assert.ok(cagri.includes('muh-prod/app-a'), 'ekipOf uygulama adini almadi');
  const eski = buildSpaReport({ rows, beyanlar: new Map(), trafficOf: () => null, env: 'PROD', ekipOf: () => ['E'] });
  for (const x of eski.rows) assert.deepEqual([x.team, x.teamKaynak], [['E'], []]);
  const hic = buildSpaReport({ rows, beyanlar: new Map(), trafficOf: () => null, env: 'PROD' });
  for (const x of hic.rows) assert.deepEqual([x.team, x.teamKaynak], [[], []]);
});

test('AO12 Kapsam intranet hucresi: ownerOf uygulama adini alir', () => {
  const ik = require('../intranet-kapsam.cjs');
  const rapor = {
    rows: [{ env: 'PROD', namespace: 'muh-prod', application: 'app-x', kurulum: { durum: 'yok', sunucular: [] } }],
    taranmayanSunucu: [], intranetSunuculari: [], sunucudaFazla: [], dizinDurum: 'var',
  };
  const o = sahipler([A('muh-prod', 'app-x', { owner_group_name: 'APP-X', kaynak: 'ARK997_YAZILIM' })]);
  const { detay } = ik.intranetHucresi(rapor, 'PROD', (nss, app) => ownersForApp(o, app, nss));
  assert.equal(detay.length, 1);
  assert.deepEqual([detay[0].owner.groups, detay[0].owner.kaynaklar], [['APP-X'], ['ARK997_YAZILIM']]);
});

test('AO13 Glomo gecis canli raporu: teamKaynak grup basina, uygulama kaynagi NAMESPACE\'i yener', () => {
  const { glomoCanli } = require('../../spa-report/gecis.cjs');
  const m = glomoCanli({
    rows: [
      { service: 'GLOMO', namespace: 'muh-prod', application: 'app', location: '/a/', team: ['G1', 'G2'], teamKaynak: ['NAMESPACE', 'SI51_AGILE'] },
      { service: 'GLOMO', namespace: 'muh-prod', application: 'app', location: '/b/', team: ['G1'], teamKaynak: ['ARK997_AGILE'] },
      { service: 'GLOMO', namespace: 'muh-prod', application: 'eski', location: '/c/', team: ['G3'] },
    ],
  });
  const x = m.get('muh-prod/app');
  assert.deepEqual([...x.ekip], ['G1', 'G2']);
  assert.deepEqual(Object.fromEntries(x.ekipKaynak), { G1: 'ARK997_AGILE', G2: 'SI51_AGILE' });
  assert.equal(m.get('muh-prod/eski').ekipKaynak.size, 0);
});

/** // ve /* *\/ yorumlarini atar (URL'deki :// korunur). */
const yorumsuz = (src) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');

test('AO14 yorum silici: yorumdaki cagri sayilmaz, koddaki kalir', () => {
  const ornek = "a = ownersForApp(owners, nss[0], nss); // ownersForApp(owners, r.application, nss)\n/* ownersFor(x) */ u = 'http://x';";
  const t = yorumsuz(ornek);
  assert.ok(!t.includes('r.application'), 'satir sonu yorumu silinmedi');
  assert.ok(!t.includes('ownersFor(x)'), 'blok yorum silinmedi');
  assert.ok(t.includes('nss[0]') && t.includes("'http://x'"), 'kod / URL silindi: ' + t);
});

test('AO14 bekci: cagiranlar ownersForApp kullanir ve uygulama adini verir', () => {
  const oku = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  const beklenen = {
    'audit/denetim.cjs': [
      'ownersForApp(owners, r.application, nss)',
      'ownersForApp(owners, name, nss)',
      '(nss, app) => ownersForApp(owners, app, nss)',
    ],
    'audit/nginx-migration.cjs': ['ownersForApp(owners, a.application, [a.namespace])'],
    'audit/intranet-kapsam.cjs': ['ownerOf([r.namespace], r.application)'],
    'spa-report/index.cjs': ['ekipOf: (ns, app) => ownersForApp(owners, app, [ns])'],
    'spa-report/build.cjs': ['ekipOf(row.namespace, row.application)'],
    'spa-report/gecis.cjs': ['ownersForApp(sahipler, r.application, [r.namespace])'],
    'spa-report/intranet.cjs': ['ownersForApp(sahip, app, [ns])', '      owners,\n'],
  };
  for (const [f, parcalar] of Object.entries(beklenen)) {
    const src = yorumsuz(oku(f));
    for (const p of parcalar) assert.ok(src.includes(p), `${f}: "${p.trim()}" yok (yorum disinda)`);
    // Namespace-only cagri kalmadi (ownersFor( ... yalniz ns-owners.cjs icinde).
    assert.ok(!/\bownersFor\(/.test(src), `${f}: namespace-only ownersFor( cagrisi kaldi`);
  }
});

test('AO15 namespace tablosu gecici okunamaz: veri yok (bilinmiyor degil), onbellege girmez', async () => {
  const APP_ROW = A('a-prod', 'kendi', { owner_group_name: 'GT-Uyg', kaynak: 'SI51_AGILE' });
  let nsHata = new Error('Login timeout expired');
  let n = 0;
  const q = async (t) => {
    const s = String(t);
    n += 1;
    if (s.includes('dbo.Openshift_Namespace_Owners')) {
      if (nsHata) throw nsHata;
      return { recordset: [{ namespace: 'b-prod', owner_group_name: 'GT-NS', owner_email: 'ns@x', lookup_status: 'OK' }] };
    }
    if (s.includes('dbo.Openshift_App_Owners')) return { recordset: [APP_ROW] };
    throw new Error('beklenmeyen sorgu');
  };
  _resetCache();
  try {
    const o = await loadNamespaceOwners(q);
    assert.deepEqual([o.ready, o.nsReady, o.appReady], [true, false, true]);
    const y = ownersForApp(o, 'yabanci', ['b-prod']);
    assert.deepEqual([y.groups, y.unknownNs, y.veriYokNs], [[], [], ['b-prod']]);
    const k = ownersForApp(o, 'kendi', ['a-prod', 'b-prod']);
    assert.deepEqual([k.groups, k.kaynaklar, k.unknownNs, k.veriYokNs], [['GT-Uyg'], ['SI51_AGILE'], [], ['b-prod']]);
    // Gecici dusus onbellege girmedi: tablo geri gelince hemen dogru sahip.
    nsHata = null;
    const o2 = await loadNamespaceOwners(q);
    assert.equal(o2.nsReady, true, 'gecici dusus TTL boyunca onbellekte kaldi');
    const y2 = ownersForApp(o2, 'yabanci', ['b-prod']);
    assert.deepEqual([y2.groups, y2.kaynaklar, y2.veriYokNs], [['GT-NS'], ['NAMESPACE'], []]);
    // Tam okuma onbellege girer.
    const once = n;
    await loadNamespaceOwners(q);
    assert.equal(n, once, 'tam sonuc onbellege girmedi');
    // Tablo YOK (kalici): onbellege girer; ve namespace verisi yok -> veriYokNs.
    _resetCache();
    nsHata = Object.assign(new Error("Invalid object name 'dbo.Openshift_Namespace_Owners'."), { number: 208 });
    const o3 = await loadNamespaceOwners(q);
    const n3 = n;
    await loadNamespaceOwners(q);
    assert.equal(n, n3, 'tablo yok durumu onbellege girmedi');
    assert.deepEqual(ownersForApp(o3, 'yabanci', ['b-prod']).veriYokNs, ['b-prod']);
    // Uygulama tablosu yokken (eski yol) veriYokNs hep bos: ready=false zaten "veri yok" der.
    assert.deepEqual(ownersForApp({ ready: false, byNs: new Map() }, 'x', ['b-prod']).veriYokNs, []);
  } finally {
    _resetCache();
  }
});

test('AO16 ARK_DISI satiri namespace yedegi gibi okunur; ayni ns/app ARK satiri kazanir', () => {
  const disi = A('muh-prod', 'app', {
    cluster: 'gbocpdev9',
    owner_group_name: 'GT-NS-PROD',
    kaynak: 'NAMESPACE',
    lookup_status: 'ARK_DISI',
    lookup_message: 'ARK disi cluster: uygulama duzeyi sahip aranmaz',
  });
  const ark = A('muh-prod', 'app', { cluster: 'gbocpprod1', owner_group_name: 'GERCEK', kaynak: 'SI51_AGILE' });
  for (const sira of [[disi, ark], [ark, disi]]) {
    const r = ownersForApp(sahipler(sira), 'app', ['muh-prod']);
    assert.deepEqual([r.groups, r.kaynaklar, r.nsSahibi], [['GERCEK'], ['SI51_AGILE'], []]);
  }
  const yalniz = ownersForApp(sahipler([disi]), 'app', ['muh-prod']);
  assert.deepEqual([yalniz.groups, yalniz.kaynaklar, yalniz.nsSahibi], [['GT-NS-PROD'], ['NAMESPACE'], ['muh-prod']]);
  const yok = A('sahipsiz-prod', 'app', { cluster: 'gbocpdev9', kaynak: 'YOK', lookup_status: 'ARK_DISI' });
  const y = ownersForApp(sahipler([yok]), 'app', ['sahipsiz-prod']);
  assert.deepEqual([y.groups, y.unknownNs], [[], ['sahipsiz-prod']]);
});
