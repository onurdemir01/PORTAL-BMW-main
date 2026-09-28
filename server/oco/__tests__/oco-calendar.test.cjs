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
  sayfaUrl,
  normalizeOrder,
  sortChronological,
  searchChangeOrders,
  aramaHatasi,
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
  // ...ama HTTP KODU 503 OLAMAZ: Portal nginx arkasinda `proxy_intercept_errors on` ile
  // calisiyor ve 403/404/500/502/503/504 cevaplarinin GOVDESINI kendi HTML sayfasiyla
  // degistiriyor - yani yukaridaki mesaj kullaniciya hic ulasmaz (bkz. client.cjs httpStatus).
  assert.ok(kod.includes('httpStatus('), 'hata kodlari nginx-guvenli koda cevrilmiyor');
  assert.ok(
    !/res\.status\((503|502|404)\)/.test(kod),
    'nginx tarafindan yutulacak bir kod dondurulmus',
  );
  // Sayfa siniri asildiysa ekran bunu gormeli.
  assert.ok(kod.includes('truncated: r.truncated'), 'eksik liste bayragi ekrana tasinmiyor');
  // Uc SALT OKUNUR olmali: bu modul OCO acmaz/kapatmaz.
  assert.ok(!/router\.(post|put|delete)\(/.test(kod), 'OCO takvimi ucu YAZAN bir yol acmis');
  // Gorunurluk kapisi: sol menude gorunen her sayfa gibi bu da motordan gecer.
  assert.ok(kod.includes("requireVisible('OcoTakvimi')"), 'gorunurluk kapisi yok');
});

// OC6/OC7 (2026-09-28): kullanici ekranda "OCO servisi 6203 numarasini kabul etmedi
// (HTTP 400). Numarayi kontrol edin." gordu. Iki ayri kusur:
//   * mesaj TEK OCO cekmek icin yazilmis metindi; 6203 bir OCO numarasi degil GRUP
//     kimligi ve kullanicinin "kontrol etmesi" hicbir seyi degistirmiyordu,
//   * mesaj hangi adresin cagrildigini SOYLEMIYORDU; yanlis OCO_API_URL ile "servis
//     reddetti" durumu ayni cumleye cikiyordu.
test('OC6: sayfa ofseti HAM kayit sayisidir, ekrana cikan satir sayisi degil', async () => {
  const ofsetler = [];
  // Ilk sayfadaki iki kaydin BIRI numarasiz: normalizeOrder onu duser.
  const sayfalar = [
    {
      SearchChangeOrderWithOffsetResult: {
        TotalCount: 3,
        Result: [{ ...ORNEK, OcoWfInstanceId: 1 }, { Subject: 'numarasiz' }],
      },
    },
    {
      SearchChangeOrderWithOffsetResult: {
        TotalCount: 3,
        Result: [{ ...ORNEK, OcoWfInstanceId: 2 }],
      },
    },
    { SearchChangeOrderWithOffsetResult: { TotalCount: 3, Result: [] } },
  ];
  let i = 0;
  const cek = async (skip) => {
    ofsetler.push(skip);
    const s = sayfalar[Math.min(i, sayfalar.length - 1)];
    i += 1;
    return s;
  };
  const r = await searchChangeOrders({ groupId: '6203', fetchPage: cek });
  // Ofset `rows.length` olsaydi ikinci istek 1'den baslar, 2 numarali kayit ATLANIRDI.
  assert.deepEqual(ofsetler.slice(0, 2), [0, 2], 'ofset dusurulen kayitlari saymamis');
  assert.deepEqual(
    r.rows.map((x) => x.oco),
    [1, 2],
  );
});

test('OC7: 400 mesaji OCO NUMARASINI degil, cagrilan ADRESI gosterir', () => {
  const url =
    'https://servicerepository/ChangeManagement/x.svc/Change/SearchChangeOrderWithOffset/0/';
  const govde =
    '<?xml version="1.0"?><html><head><title>Request Error</title>' +
    '<style>BODY { color: #000000; background-color: white; font-family: Verdana; }</style>' +
    '</head><body>hata</body></html>';
  const err = aramaHatasi(400, govde, url, '6203');
  assert.match(err.message, /HTTP 400/);
  assert.ok(
    err.message.includes(url),
    'cagrilan adres mesajda yok - yanlis OCO_API_URL ayirt edilemez',
  );
  // "Numarayi kontrol edin" YANLIS YERE BAKTIRIYORDU: 6203 kullanicinin girdigi bir sey degil.
  assert.doesNotMatch(
    err.message,
    /[Nn]umaray[ıi] kontrol/,
    'kullanici duzeltemeyecegi bir sey icin yonlendiriliyor',
  );
  // WCF hata sayfasinin CSS'i EKRANA DOKULMEZ; yalniz baslik tasinir.
  assert.doesNotMatch(err.message, /background-color/, 'HTML/CSS ekrana sizmis');
  assert.match(err.message, /Request Error/, 'servisin kendi basligi tasinmamis');
});

// OC8 (2026-09-28, URETIMDE OLCULDU): arama ucu HTTP 400 donuyordu. Sebep: `OCO_API_URL`
// bir KOK ADRES DEGIL, detay ucunun TAM URL'i (sorgu parametresi dahil):
//   https://servicerepository/ChangeManagement/....svc/Change/getChangeOrderByWfInstanceId/?wfInstanceId=
// Arama yolunu bu dizginin sonuna eklemek yolu wfInstanceId DEGERININ ICINE gomuyordu.
test('OC8: arama adresi ayarin YOL/SORGU kismindan bagimsiz kurulur', () => {
  const BEKLENEN =
    'https://servicerepository/ChangeManagement/ChangeManagementServiceRepository.svc' +
    '/Change/SearchChangeOrderWithOffset/0/?count=100&pcabRequired=-1&isAgentPatch=-1' +
    '&changeEnvironment=-1&parameterChange=-1&openningGroupId=6203';
  const ayarlar = [
    // URETIMDEKI GERCEK DEGER.
    'https://servicerepository/ChangeManagement/ChangeManagementServiceRepository.svc/Change/getChangeOrderByWfInstanceId/?wfInstanceId=',
    // Kok adres olarak girilmis hali de AYNI sonucu vermeli.
    'https://servicerepository',
  ];
  for (const baseUrl of ayarlar) {
    assert.equal(sayfaUrl({ baseUrl }, 0, '6203'), BEKLENEN, `ayar: ${baseUrl}`);
  }
  // Ofset yola girer, sorguya DEGIL.
  assert.match(
    sayfaUrl({ baseUrl: 'https://servicerepository' }, 100, '6203'),
    /SearchChangeOrderWithOffset\/100\/\?/,
  );
});
