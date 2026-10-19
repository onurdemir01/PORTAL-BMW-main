// server/audit/__tests__/intranet-kapsam.test.cjs - Kapsam & Tasima intranet kurulum hucresi =
// Nginx ARK SPA > Intranet SPA ile AYNI hesap (2026-10-19).
//
// Kullanici: "Kapsamin eslesmesini duzeltelim lutfen, farkli sayfada farkli veri gozukmesi bizim
// yanlis raporlama yapmamiza sebep oluyor."
//   IK1 saf donusum: hucre sayilari Intranet SPA raporunun ortam ozetine ESIT (tamam / kismi / yok,
//       payda = uygulama); tikla-listesi kurulmamis + yarim satirlar, sunucu basina eksik parca
//   IK2 olculebilirlik raporla ayni: ortamin taranan sunucusu; dizin okunamadi; olculemedi /
//       sunucu-yok ayri kova ("kurulmamis" SAYILMAZ); sunucuda fazla (bilgi)
//   IK3 rapor hazir degil: olculemedi hucresi + neden (ad kalibi hesabina DONULMEZ)
//   IK4 UCTAN UCA (gercek initDenetim, sahte DB): /nginx-spa-coverage?platform=ark ortak raporu
//       kullanir - sayilar raporun envs'ine esit, ad kalibi SPA'si listeye girmez, ad kalibina
//       uymayan gercek SPA girer; SPA sutununun "ic agda" sayisi ad kalibinda kalir
//   IK5 uctan uca: rapor dustu / kesif tablosu yok -> intranet OLCULEMEDI + neden; baska platform
//       eski ad kalibi hesabi (kaynak yazili), rapor cagrilmaz
//   IK6 platform: Intranet SPA raporu ARK disi cluster'lardaki uygulamayi saymaz, platformDisi'nda
//       gosterir (Kapsam'in OpenShift sorgusuyla ayni cluster listesi)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

const { buildIntranetRapor } = require('../../spa-report/intranet.cjs');
const ik = require('../intranet-kapsam.cjs');

const A = (application, o = {}) => ({
  application, namespace: 'kart-prod', env: 'prod', spa: 'evet', ag: 'intranet', istek: 'var', reqShown: 1,
  usage: null, hosts: [], clusters: ['gbocpprod1', 'gbocpprod2'], staleClusters: [], weakEvidence: false, pattern: 'uymuyor', ...o,
});
const DZ = (host, ns, app, o = {}) => ({
  host, namespace: ns, application: app, hys_deployed: 1, app_deployed: 1, conf_exists: 1, status: 'OK', scan_date: '2026-10-18', ...o,
});
// GBNGXAP50 (PROD, Ankara) son taramada yok: olculemedi, 'eksik' degil.
const HOSTS = ['GBNGXAP50', 'GBNGXP50', 'GBNGXP51', 'GBNGXT50'];
const APPS = [
  A('tam-ui'), A('yarim-ui'), A('tek-ui'), A('yok-ui'), A('ad-uymaz'),
  A('wy-ui', { clusters: ['giocp3rdwyprod1'] }),
  A('t-ui', { namespace: 'kart-test', env: 'test' }),
];
const DIRS = [
  DZ('GBNGXP50', 'kart-prod', 'tam-ui'), DZ('GBNGXP51', 'kart-prod', 'tam-ui'),
  DZ('GBNGXP50', 'kart-prod', 'yarim-ui'), DZ('GBNGXP51', 'kart-prod', 'yarim-ui', { app_deployed: 0, status: 'MISSING_APP' }),
  DZ('GBNGXP51', 'kart-prod', 'tek-ui'),
  DZ('GBNGXT50', 'kart-test', 't-ui'),
  DZ('GBNGXP50', 'emekli-prod', 'eski-ui'),
];
const rapor = (o = {}) => ({
  ok: true, notScanned: false, kesifTarihi: '2026-10-18',
  ...buildIntranetRapor({ apps: APPS, ownersByNs: new Map(), beyanlar: new Map(), dirRows: DIRS, hosts: HOSTS, ...o }),
});
const sahip = (nss) => ({ groups: ['GT-Kart'], emails: ['kart@banka.com'], unknownNs: [], namespaces: nss });

test('IK1 hucre sayilari Intranet SPA ortam ozetine esit; tikla-listesi kurulmamis + yarim', () => {
  const r = rapor();
  for (const env of ['PROD', 'TEST']) {
    const o = r.envs.find((e) => e.env === env);
    const { alanlar: h } = ik.intranetHucresi(r, env, sahip);
    assert.deepEqual(
      [h.intranetKurulumToplam, h.intranetFull, h.intranetPartialCount, h.intranetMissingCount],
      [o.uygulama, o.kurulumTamam, o.kurulumKismi, o.kurulumYok],
      `${env}: Kapsam hucresi Intranet SPA ozetini tutmuyor`,
    );
  }
  const { alanlar: p, detay } = ik.intranetHucresi(r, 'PROD', sahip);
  assert.deepEqual([p.intranetKurulumToplam, p.intranetFull, p.intranetPartialCount, p.intranetMissingCount], [5, 1, 2, 2]);
  assert.deepEqual(p.intranetMissing, ['ad-uymaz', 'yok-ui']);
  assert.equal(p.intranetCoverage, 20);
  assert.deepEqual(detay.map((d) => [d.kind, d.app, d.namespace]), [
    ['missing', 'ad-uymaz', 'kart-prod'], ['missing', 'yok-ui', 'kart-prod'],
    ['partial', 'tek-ui', 'kart-prod'], ['partial', 'yarim-ui', 'kart-prod'],
  ]);
  const tek = detay.find((d) => d.app === 'tek-ui');
  assert.deepEqual(tek.hosts, [{ host: 'GBNGXP50', missing: ['hysdeploy', 'applications', 'conf'] }], 'hic izi olmayan sunucuda uc parca da eksik');
  assert.deepEqual(detay.find((d) => d.app === 'yarim-ui').hosts, [{ host: 'GBNGXP51', missing: ['applications'] }]);
  assert.deepEqual(p.intranetPartial.find((x) => x.app === 'yarim-ui').hosts, [{ host: 'GBNGXP51', missing: ['applications'] }]);
  assert.deepEqual(tek.owner, { groups: ['GT-Kart'], emails: ['kart@banka.com'], unknownNs: [], namespaces: ['kart-prod'] });
  assert.deepEqual(tek.namespaces, ['kart-prod']);
  assert.equal(p.intranetKaynak, 'intranet-spa');
  assert.equal(p.intranetKaynakHata, '');
});

test('IK2 olculebilirlik, ayri kovalar, sunucuda fazla', () => {
  const r = rapor();
  const { alanlar: p } = ik.intranetHucresi(r, 'PROD', sahip);
  assert.equal(p.measuredIntranet, true);
  assert.deepEqual(p.intranetHosts, ['GBNGXP50', 'GBNGXP51']);
  assert.deepEqual([p.intranetOnlyOnServerCount, p.intranetOnlyOnServer], [1, ['emekli-prod/eski-ui']]);
  assert.equal(ik.intranetHucresi(r, 'TEST', sahip).alanlar.intranetOnlyOnServerCount, 0);
  // '-prod' eksiz dizin ns'i satirla eslesir (fazla DEGIL); listede olmayan sunucu sayilmaz
  const ek = buildIntranetRapor({ apps: [A('ek-ui')], ownersByNs: new Map(), beyanlar: new Map(), hosts: HOSTS,
    dirRows: [DZ('GBNGXP50', 'kart', 'ek-ui'), DZ('GBNGXP40', 'disari-prod', 'net-ui')] });
  assert.deepEqual(ek.sunucudaFazla, []);
  // dizin okunamadi: her satir olculemedi, kurulmamis SAYILMAZ, neden yazilir; elde satir olsa da
  // (eski / kismi okuma) ne kuruluma ne "sunucuda fazla"ya girer
  const d = { ok: true, ...buildIntranetRapor({ apps: APPS, ownersByNs: new Map(), beyanlar: new Map(), dirRows: DIRS, dizinDurum: 'okunamadi', hosts: HOSTS }) };
  const { alanlar: o, detay } = ik.intranetHucresi(d, 'PROD', sahip);
  assert.deepEqual([o.measuredIntranet, o.intranetMissingCount, o.intranetOlculemediCount, o.intranetKurulumToplam, detay.length], [false, 0, 5, 5, 0]);
  assert.deepEqual([d.sunucudaFazla, o.intranetOnlyOnServerCount], [[], 0]);
  assert.match(o.intranetKaynakHata, /Nginx_Intranet_Audit/);
  assert.equal(o.intranetCoverage, null);
  // ortamin intranet sunucusu yok (QA): sunucu-yok kovasi
  const q = { ok: true, ...buildIntranetRapor({ apps: [A('q-ui', { namespace: 'kart-qa', env: 'qa' })], ownersByNs: new Map(), beyanlar: new Map(), dirRows: DIRS, hosts: HOSTS }) };
  const qa = ik.intranetHucresi(q, 'QA', sahip).alanlar;
  assert.deepEqual([qa.measuredIntranet, qa.intranetSunucuYokCount, qa.intranetMissingCount, qa.intranetKurulumToplam], [false, 1, 0, 1]);
});

test('IK3 rapor hazir degil: olculemedi hucresi + neden', () => {
  assert.equal(ik.raporHazir(rapor()), true);
  assert.equal(ik.raporHazir({ ok: true, notScanned: true, rows: [] }), false);
  assert.equal(ik.raporHazir(null), false);
  assert.equal(ik.raporHatasi({ ok: true, notScanned: true, message: 'dbo.BMW_Spa_Discovery tablosu henüz yok' }), 'dbo.BMW_Spa_Discovery tablosu henüz yok');
  assert.match(ik.raporHatasi(null, 'baglanti koptu'), /baglanti koptu/);
  const { alanlar, detay } = ik.olculemediHucre('neden');
  assert.deepEqual([alanlar.measuredIntranet, alanlar.intranetKaynakHata, alanlar.intranetFull, detay.length], [false, 'neden', 0, 0]);
});

test('IK6 platform: ARK disi cluster sayilmaz, platformDisi gorunur', () => {
  const r = rapor();
  assert.ok(!r.rows.some((x) => x.application === 'wy-ui'), 'wyden uygulamasi ARK raporuna girdi');
  assert.deepEqual(r.platformDisi, [{ platform: 'wyden', uygulama: 1, clusters: ['giocp3rdwyprod1'] }]);
  const kar = buildIntranetRapor({ apps: [A('iki-ui', { clusters: ['giocp3rdwyprod1', 'gbocpprod4'] }), A('bil-ui', { clusters: ['yenicluster9'] }), A('bos-ui', { clusters: [] })], ownersByNs: new Map(), beyanlar: new Map(), dirRows: [], hosts: HOSTS });
  assert.deepEqual(kar.rows.map((x) => x.application), ['iki-ui'], 'en az bir ARK cluster yetmeli');
  assert.deepEqual(kar.platformDisi.map((d) => [d.platform, d.uygulama]), [['bilinmiyor', 1], ['cluster-yok', 1]]);
  assert.equal(r.platform, 'ark');
});

// ── UCTAN UCA: gercek initDenetim, sahte veritabani ve sahte ortak rapor ────────────────────────
const KOK = path.join(__dirname, '..', '..');
const sahte = (rel, exports) => {
  const yol = path.join(KOK, rel);
  require.cache[Module._resolveFilename(yol, module)] = { id: yol, filename: yol, loaded: true, exports };
};
const OCP = [
  { namespace: 'kart-prod', application: 'eski-app-v1' },
  { namespace: 'kart-prod', application: 'tam-ui' },
];
const ROUTES = [{ namespace_name: 'kart-prod', route_name: 'eski-app-v1', route_address: 'eski-app-v1-kart-prod.apps.fw.garanti.com.tr', termination_type: 'reencrypt' }];
let raporFn = async () => rapor();
let raporCagri = 0;
function db() {
  const query = async (q) => {
    const s = String(q);
    if (s.includes('MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit')) return { recordset: [{ d: '2026-10-18' }] };
    if (s.includes('sys.columns')) return { recordset: [{ n: 0 }] };
    if (s.includes('FROM dbo.Openshift_Inventory')) return { recordset: OCP };
    if (s.includes('FROM dbo.Nginx_Config_Audit')) return { recordset: [] };
    if (s.includes('FROM dbo.BMW_Openshift_Route_Inventory')) return { recordset: ROUTES };
    // ad kalibi hesabi: eski-app-v1 PROD intranet sunucusunda uc dizinle TAM
    if (s.includes('FROM dbo.Nginx_Intranet_Audit')) return { recordset: [DZ('GBNGXP50', 'kart-prod', 'eski-app-v1')] };
    if (s.includes('Openshift_Namespace_Owners')) return { recordset: [{ namespace: 'kart-prod', owner_group_name: 'GT-Kart', owner_email: 'kart@banka.com', lookup_status: 'OK' }] };
    return { recordset: [] };
  };
  return { query, queryLong: query, sql: new Proxy({}, { get: () => () => 'tip' }) };
}
async function sunucu() {
  sahte('auth/index.cjs', { requireAuth: (_q, _s, n) => n() });
  sahte('auth/visibility.cjs', {});
  sahte('inventory/mssql.cjs', db());
  sahte('spa-report/index.cjs', { intranetOzeti: async () => { raporCagri += 1; return raporFn(); } });
  require('../ns-owners.cjs')._resetCache();
  const { initDenetim } = require('../denetim.cjs');
  const app = express();
  initDenetim(app);
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  return { s, base: `http://127.0.0.1:${s.address().port}/api/denetim` };
}
let _srv = null;
const al = async (q) => {
  if (!_srv) _srv = await sunucu();
  return fetch(`${_srv.base}/nginx-spa-coverage?${q}&fresh=1`).then((x) => x.json());
};
test.after(() => _srv && _srv.s.close());

test('IK4 uctan uca: Kapsam intranet hucresi ortak rapordan, sayilar esit', async () => {
  raporFn = async () => rapor();
  const out = await al('platform=ark');
  assert.equal(out.ok, true, out.message);
  const r = rapor();
  for (const env of ['PROD', 'TEST']) {
    const o = r.envs.find((e) => e.env === env);
    const c = out.rows.find((x) => x.env === env);
    assert.ok(c, `${env} satiri yok (yalniz ortak raporda olan ortam da listelenmeli)`);
    assert.deepEqual(
      [c.intranetKurulumToplam, c.intranetFull, c.intranetPartialCount, c.intranetMissingCount],
      [o.uygulama, o.kurulumTamam, o.kurulumKismi, o.kurulumYok],
      `${env}: Kapsam ile Intranet SPA ayrisiyor`,
    );
  }
  const p = out.rows.find((x) => x.env === 'PROD');
  assert.equal(p.intranetKaynak, 'intranet-spa');
  assert.equal(p.measuredIntranet, true);
  const liste = p.missingDetail.intranet.map((d) => `${d.kind}:${d.app}`).sort();
  assert.deepEqual(liste, ['missing:ad-uymaz', 'missing:yok-ui', 'partial:tek-ui', 'partial:yarim-ui']);
  assert.ok(!liste.some((x) => x.includes('eski-app-v1')), 'ad kalibi hesabinin uygulamasi listeye sizdi');
  assert.deepEqual(p.missingDetail.intranet[0].owner.groups, ['GT-Kart'], 'sahip Kapsam sahiplik tablosundan gelmeli');
  // SPA sutunu ("ic agda") ad kalibinda kalir, etiketli
  assert.equal(p.intranetTotal, 1);
  assert.equal(out.intranetKaynak, 'intranet-spa');
  assert.deepEqual(out.intranetRapor.platformDisi.map((d) => d.platform), ['wyden']);
  assert.equal(out.intranetRapor.dizinTarihi, '2026-10-18');
  assert.equal(out.intranetScanned, true);
});

test('IK5 uctan uca: rapor dustu / kesif yok -> olculemedi; baska platform ad kalibi', async () => {
  raporFn = async () => { throw new Error('kesif sorgusu zaman asimi'); };
  let out = await al('platform=ark');
  let p = out.rows.find((x) => x.env === 'PROD');
  assert.deepEqual([p.measuredIntranet, p.intranetFull, p.missingDetail.intranet.length], [false, 0, 0], 'rapor duserken ad kalibi sayilari gosterildi');
  assert.match(p.intranetKaynakHata, /kesif sorgusu zaman asimi/);
  assert.match(out.intranetKaynakHata, /kesif sorgusu zaman asimi/);
  raporFn = async () => ({ ok: true, notScanned: true, message: 'dbo.BMW_Spa_Discovery tablosu henüz yok', rows: [] });
  out = await al('platform=ark');
  p = out.rows.find((x) => x.env === 'PROD');
  assert.deepEqual([p.measuredIntranet, p.intranetKaynakHata], [false, 'dbo.BMW_Spa_Discovery tablosu henüz yok']);
  // dizin taramasi okunamadi: ad kalibi tarafinin dizin satirlari olsa da intranet TARANMADI sayilir
  raporFn = async () => rapor({ dirRows: null, dizinDurum: 'okunamadi' });
  out = await al('platform=ark');
  p = out.rows.find((x) => x.env === 'PROD');
  assert.deepEqual([out.intranetScanned, p.measuredIntranet, p.intranetOlculemediCount], [false, false, 5]);
  assert.match(p.intranetKaynakHata, /Nginx_Intranet_Audit/);
  const once = raporCagri;
  out = await al('platform=ark_ai');
  p = out.rows.find((x) => x.env === 'PROD');
  assert.equal(raporCagri, once, 'ARK disi platformda ARK raporu cagrildi');
  assert.deepEqual([out.intranetKaynak, p.intranetKaynak, p.intranetFull, p.intranetTotal, p.measuredIntranet], ['ad-kalibi', 'ad-kalibi', 1, 1, true]);
});
