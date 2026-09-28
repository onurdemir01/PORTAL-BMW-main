// server/oco/__tests__/oco-calendar.test.cjs — OCO Takvimi (2026-09-28, kullanici istegi).
//
// Kullanici: "Ekibime ait production operational change order'lari listeleyen bir endpoint
// gondereceğim. Portal'da solda 'OCO Takvimi' diye bir sekme olustur ve buradaki OCO'lari
// tarihlere ve basligi isleyerek kronolojik listele."
//
// OC1 WCF tarihi DOGRU cozulur: "/Date(1791309600000+0300)/" -> mutlak an. Saat dilimi
//     EKI BILGI AMACLIDIR; iki kez uygulanirsa tarih 3 saat kayar.
// OC2 Kronolojik sira + TARIHSIZ kayit ATILMAZ (en sona gider).
// OC3 Sayfalama: TotalCount'a ulasana kadar devam eder; bos sayfada durur; ust sinira
//     takilirsa SESSIZ KIRPMA YOK - `truncated` bayragi doner.
// OC4 Donusum: ekranin kullandigi alanlar tasinir, servisin ~150 alani TASINMAZ.
// OC5 Uc sozlesmesi: yapilandirilmamis servis BOS LISTE degil, 503 + notConfigured doner.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.OCO_API_URL = process.env.OCO_API_URL || 'https://ornek-servis';
const {
  normalizeOrder,
  sortChronological,
  searchChangeOrders,
  MAX_PAGES,
} = require('../search.cjs');

const ORNEK = {
  OcoWfInstanceId: 23191882,
  Subject: 'Provenir Sunucularında IBMIHS Bulgu Upgrade Set 2',
  Explanation: 'GBPRVAP16\r\nGBPRVP07',
  OcoStatus: 5,
  OcoStatusText: 'Değişiklik Yönetimi Kontrol Onayı',
  ChangeImpactText: 'Minör',
  ProcessTypeText: 'Normal',
  PcabRequired: false,
  PlannedStartDate: '/Date(1791309600000+0300)/',
  PlannedEndDate: '/Date(1791316800000+0300)/',
  OcoOpeningDate: '/Date(1790584065013+0300)/',
  ActualStartDate: null,
  // Servisin tasidigi ve EKRANIN KULLANMADIGI alanlardan bir demet:
  CreateUserId: 274397,
  SelectedServiceSrmId: 276625,
  IsServiceTopologyUpdatesCompletedText: null,
};

test('OC1: WCF tarihi mutlak an olarak cozulur (saat dilimi eki IKI KEZ uygulanmaz)', () => {
  const n = normalizeOrder(ORNEK);
  // 1791309600000 ms = 2026-10-06T18:00:00Z. "+0300" yalnizca bilgi; epoch zaten mutlak.
  assert.equal(n.plannedStart, new Date(1791309600000).toISOString());
  assert.equal(n.plannedEnd, new Date(1791316800000).toISOString());
  assert.equal(n.openedAt, new Date(1790584065013).toISOString());
  // Saat dilimi ikinci kez uygulansaydi 3 saat kayardi - bunu acikca disliyoruz.
  assert.notEqual(n.plannedStart, new Date(1791309600000 + 3 * 3600 * 1000).toISOString());
  // DOLMAMIS tarih null kalir: "gerceklesmedi" DEMEK DEGIL, OCO kapanmadan bu alan bos.
  assert.equal(n.actualStart, null);
});

test('OC2: kronolojik sira; TARIHSIZ kayit atilmaz, sona gider', () => {
  const rows = [
    normalizeOrder({
      ...ORNEK,
      OcoWfInstanceId: 3,
      PlannedStartDate: '/Date(1791396000000+0300)/',
    }),
    normalizeOrder({
      ...ORNEK,
      OcoWfInstanceId: 1,
      PlannedStartDate: '/Date(1791309600000+0300)/',
    }),
    // Planlanan tarihi YOK: listeden dusurmek, var olan bir degisikligi yok gibi gosterirdi.
    normalizeOrder({ ...ORNEK, OcoWfInstanceId: 2, PlannedStartDate: null }),
  ];
  const s = sortChronological(rows);
  assert.deepEqual(
    s.map((r) => r.oco),
    [1, 3, 2],
  );
  assert.equal(s.length, 3, 'tarihsiz kayit listeden dusuruldu');
});

function sahifa(sayfalar) {
  let cagri = 0;
  const fn = async () => {
    const s = sayfalar[Math.min(cagri, sayfalar.length - 1)];
    cagri += 1;
    return s;
  };
  fn.cagriSayisi = () => cagri;
  return fn;
}

test('OC3: sayfalama - toplam kadar ceker, bos sayfada durur, sinirda TRUNCATED der', async () => {
  const kayit = (id) => ({ ...ORNEK, OcoWfInstanceId: id });

  // Iki sayfa, toplam 3 kayit.
  const iki = sahifa([
    { SearchChangeOrderWithOffsetResult: { TotalCount: 3, Result: [kayit(1), kayit(2)] } },
    { SearchChangeOrderWithOffsetResult: { TotalCount: 3, Result: [kayit(3)] } },
  ]);
  const r = await searchChangeOrders({ groupId: '6203', fetchPage: iki });
  assert.equal(r.fetched, 3, 'ikinci sayfa alinmamis - kayitlar SESSIZCE kayboluyor');
  assert.equal(r.total, 3);
  assert.equal(r.truncated, false);

  // TotalCount yanlis/abartili: bos sayfa gelince DURULUR (sonsuz dongu yok).
  const bos = sahifa([
    { SearchChangeOrderWithOffsetResult: { TotalCount: 999, Result: [kayit(1)] } },
    { SearchChangeOrderWithOffsetResult: { TotalCount: 999, Result: [] } },
  ]);
  const r2 = await searchChangeOrders({ groupId: '6203', fetchPage: bos });
  assert.equal(r2.fetched, 1);
  assert.equal(r2.truncated, false, 'bos sayfa "kirpildi" sayilmamali');

  // Servis hep dolu sayfa donuyor: ust sinirda DURULUR ve bu SOYLENIR.
  const sonsuz = sahifa([
    { SearchChangeOrderWithOffsetResult: { TotalCount: 100000, Result: [kayit(1)] } },
  ]);
  const r3 = await searchChangeOrders({ groupId: '6203', fetchPage: sonsuz });
  assert.equal(r3.truncated, true, 'eksik liste "tam liste" gibi donuyor');
  assert.ok(sonsuz.cagriSayisi() <= MAX_PAGES, 'sayfa ust siniri uygulanmiyor (sonsuz dongu)');
});

test('OC4: donusum - ekranin kullandigi alanlar; servisin gereksiz alanlari TASINMAZ', () => {
  const n = normalizeOrder(ORNEK);
  assert.equal(n.oco, 23191882);
  assert.equal(n.subject, 'Provenir Sunucularında IBMIHS Bulgu Upgrade Set 2');
  assert.equal(n.statusText, 'Değişiklik Yönetimi Kontrol Onayı');
  assert.equal(n.impactText, 'Minör');
  assert.equal(n.pcabRequired, false);
  // ~150 alanin tamami tarayiciya tasinmaz: hem gereksiz veri yayilimi hem de 100 kayitta
  // megabaytlarca yanit demek.
  assert.equal(n.CreateUserId, undefined, 'kullanilmayan alan tasinmis');
  assert.equal(n.SelectedServiceSrmId, undefined, 'kullanilmayan alan tasinmis');
  assert.ok(Object.keys(n).length <= 14, `donusum cok genis: ${Object.keys(n).length} alan`);
  // OCO numarasi olmayan kayit ATLANIR (listede tiklanamaz bir satir olurdu).
  assert.equal(normalizeOrder({ Subject: 'x' }), null);
  assert.equal(normalizeOrder(null), null);
});

test('OC5: uc sozlesmesi - yapilandirilmamis servis BOS LISTE donmez', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const kod = src
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('//'))
    .join(String.fromCharCode(10))
    .replace(/\s+/g, ' ');
  // "Ayar yok" ile "OCO yok" ayri: bos liste, ekipte hic degisiklik yokmus gibi okunurdu.
  assert.ok(kod.includes('notConfigured: true'), 'yapilandirilmamis durum ayirt edilmiyor');
  assert.ok(kod.includes('res.status(503)'), 'yapilandirilmamis servis 200 ile bos liste donuyor');
  // Sayfa siniri asildiysa ekran bunu gormeli.
  assert.ok(kod.includes('truncated: r.truncated'), 'eksik liste bayragi ekrana tasinmiyor');
  // Uc SALT OKUNUR olmali: bu modul OCO acmaz/kapatmaz.
  assert.ok(!/router\.(post|put|delete)\(/.test(kod), 'OCO takvimi ucu YAZAN bir yol acmis');
  // Gorunurluk kapisi: sol menude gorunen her sayfa gibi bu da motordan gecer.
  assert.ok(kod.includes("requireVisible('OcoTakvimi')"), 'gorunurluk kapisi yok');
});
