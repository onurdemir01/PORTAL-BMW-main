// server/spa-report/__tests__/spa-report.test.cjs — Nginx ARK SPA Raporu.
//
// Kullanici (2026-09-28): "SPA Tasimalari sayfasinin birebir aynisini Glomo / Webforms /
// Saklama / Geintdigital vb. TUM servislerimiz icin, sol menuye yeni bir bolum ekleyerek
// 'Nginx ARK SPA Raporu' adiyla istiyorum. Buraya ekiplerin giris yapabilmesini istiyorum.
// Kolonlar: Ekip Beyani, Uygulama, Namespace, Ekip, Yuk Durumu, Location, Aciklama."
// Beyan alani icin: "senin eski yazimin olarak kullaniyor/kullanmiyor/bilmiyor olarak
// devam ettirelim" - yani SPA Tasimalari'ndaki ALANIN AYNISI.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildSpaReport } = require('../build.cjs');
const { flatten } = require('../../util/guard-text.cjs');

const satir = (o) => ({
  service: 'GLOMO',
  env: 'PROD',
  application: 'x-app-v1',
  namespace: 'ns1-prod',
  location_path: '/x/',
  host: 'GBNGXP40',
  vhost: 'GLOMO-PROD.conf',
  ...o,
});

test('AR1: ayni tanim mirror sunucularda TEKRAR ETMEZ, sunucular toplanir', () => {
  // Prod'da ayni vhost 4-8 nginx'te durur. Tekillestirmezsek ekip ayni uygulamayi
  // sekiz kez gorur ve listeyi okuyamaz.
  const r = buildSpaReport({
    rows: [satir({ host: 'GBNGXP40' }), satir({ host: 'GBNGXP41' }), satir({ host: 'GBNGXP48' })],
  });
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0].hosts, ['GBNGXP40', 'GBNGXP41', 'GBNGXP48']);
});

test('AR2: yalniz PROD; baska ortamlar rapora GIRMEZ', () => {
  const r = buildSpaReport({
    rows: [satir({}), satir({ env: 'TEST', application: 'y-app-v1' })],
  });
  assert.deepEqual(
    r.rows.map((x) => x.application),
    ['x-app-v1'],
  );
});

test('AR3: uygulama/namespace bilgisi olmayan satir listeye girmez ama SAYILIR', () => {
  // Uzerinde beyan verilemeyecek bir satir listeyi uzatmaktan baska ise yaramaz; ama
  // sessizce dusurmek de "envanterin tamami bu" izlenimi verirdi.
  const r = buildSpaReport({ rows: [satir({}), satir({ application: '', namespace: '' })] });
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped, 1, 'atlanan satir sayisi soylenmiyor');
});

test('AR4: OLCUM ile BEYAN ayri tasinir ve biri digerini EZMEZ', () => {
  // Kullanicinin kurali: yilda bir kosan bir is olcumde "yuk almiyor" gorunur ama ekip
  // kullaniyordur. Celiski BILGIDIR.
  const r = buildSpaReport({
    rows: [satir({})],
    trafficOf: () => ({
      state: 'idle',
      req7: 0,
      req24: 0,
      sampled: false,
      lastSeen: null,
      hosts: 4,
      unknownHosts: 0,
    }),
    beyanlar: new Map([
      ['ns1-prod/x-app-v1', { inUse: 'yes', inUseBy: 'onur', note: 'yilda bir kosar' }],
    ]),
  });
  const row = r.rows[0];
  assert.equal(row.traffic.state, 'idle', 'olcum beyanla degistirilmis');
  assert.equal(row.inUse, 'yes', 'beyan olcumle degistirilmis');
  assert.equal(row.inUseBy, 'onur', 'kimin beyan ettigi tasinmiyor');
  assert.equal(row.note, 'yilda bir kosar');
});

test('AR5: beyan YOKSA bos kalir - "kullanmiyor" UYDURULMAZ', () => {
  const r = buildSpaReport({ rows: [satir({})], beyanlar: new Map() });
  assert.equal(r.rows[0].inUse, null, 'beyan verilmemisken bir deger uydurulmus');
});

test('AR6: servis ozetinde beyan BEKLEYEN sayisi gorunur', () => {
  const r = buildSpaReport({
    rows: [
      satir({ application: 'a-app-v1' }),
      satir({ application: 'b-app-v1' }),
      satir({ service: 'WEBFORMS', application: 'c-app-v1' }),
    ],
    beyanlar: new Map([['ns1-prod/a-app-v1', { inUse: 'yes' }]]),
  });
  const glomo = r.services.find((s) => s.service === 'GLOMO');
  assert.equal(glomo.apps, 2);
  assert.equal(glomo.declared, 1, 'beyan sayisi yanlis - ekip "ne kadari bekliyor" goremiyor');
  assert.ok(
    r.services.some((s) => s.service === 'WEBFORMS'),
    'servisler ayri ayri listelenmiyor',
  );
});

test('AR7: uc sozlesmesi - beyan TEK ALANDIR ve kim yazdigi kaydedilir', () => {
  const src = flatten(
    fs
      .readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n'),
  );
  // AYNI ALAN: SPA Tasimalari'nin tablosuna yazilir, ikinci bir tablo acilmaz.
  assert.match(
    src,
    /nginx_migration_tracking/,
    'beyan ayri bir yere yaziliyor - iki ekranda iki cevap olur',
  );
  // Okuma group_id'ye BAKMAZ: ayni uygulamanin tasima satiri varsa o beyan gorunmeli.
  assert.match(src, /ORDER BY updated_at ASC/, 'en yeni beyanin kazandigi garanti degil');
  // Yazarken MEVCUT satir guncellenir (yeni satir acmak ikinci bir cevap uretirdi).
  assert.match(
    src,
    /SELECT TOP 1 group_id FROM nginx_migration_tracking/,
    'mevcut satir aranmiyor',
  );
  // KIM yazdi: beyan bir olcum degil, ifadedir - kimin soyledigi bilinmeden degeri olmaz.
  assert.match(src, /in_use_by = \$4/, 'beyani kimin yazdigi kaydedilmiyor');
  // Gecersiz beyan reddedilir.
  assert.match(src, /new Set\(\['yes', 'no', 'unknown'\]\)/, 'beyan degerleri dogrulanmiyor');
  // SALT OKUNUR DEGIL ama YETKI KAPISI VAR: gorunurluk motorundan gecer.
  assert.match(src, /requireVisible\('ArkSpaRaporu'\)/, 'gorunurluk kapisi yok');
  // Tarama yoksa BOS LISTE degil, "taranmadi" doner.
  assert.match(src, /notScanned: true/, '"hic SPA yok" ile "henuz taranmadi" ayrilmamis');
});

test('AR8: sayfa UC YERDE de kayitli (menu sessizce dusmesin)', () => {
  const KOK = path.join(__dirname, '..', '..', '..');
  const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8').replace(/"/g, "'");
  assert.match(oku('server/db/mssql-setup.cjs'), /element_key: 'ArkSpaRaporu'/, 'DB seed');
  assert.match(oku('src/config/elements.ts'), /id: 'ArkSpaRaporu'/, 'elements.ts PAGES');
  assert.match(oku('src/config/elements.ts'), /itemIds: \['ArkSpaRaporu'\]/, 'NAV_GROUPS');
  assert.match(oku('src/App.tsx'), /path='\/ark-spa-raporu'/, 'App.tsx route');
  assert.match(oku('server/index.cjs'), /spa-report/, 'sunucu modulu baglanmamis');
});

const EKRAN = path.join(__dirname, '..', '..', '..', 'src', 'components', 'ArkSpaRaporuPage.tsx');
// YORUMLAR CIKARILIR: bekci, hatayi ANLATAN yorumun kendisini bulgu sayarsa dogru kodda
// kirmiziya doner (bu depoda ayni tuzaga birkac kez dusuldu).
const ekran = () =>
  flatten(
    fs
      .readFileSync(EKRAN, 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
      .split(chr10)
      .filter((l) => !l.trim().startsWith('//'))
      .join(chr10),
  );
const chr10 = String.fromCharCode(10);

test('AR9: kolon sirasi - Location, Ekip Beyanindan HEMEN SONRA', () => {
  // Kullanici (2026-09-29): "Location kolonunu en basa ama Ekip Beyani'ndan sonraya
  // alalim". Satiri okurken once "hangi adres" sorusu cevaplaniyor.
  const src = ekran();
  const sira = [
    'Ekip Beyanı',
    'Location',
    'Uygulama',
    'Namespace',
    'Ekip',
    'Yük Durumu',
    'Açıklama',
  ];
  const yerler = sira.map((b) => src.indexOf(`>${b}</th>`));
  for (let i = 0; i < sira.length; i += 1) {
    assert.ok(yerler[i] >= 0, `"${sira[i]}" basligi yok`);
    if (i)
      assert.ok(
        yerler[i] > yerler[i - 1],
        `kolon sirasi bozuk: "${sira[i]}" "${sira[i - 1]}"nden once geliyor`,
      );
  }
  // BASLIK ile HUCRE sirasi ayni olmali: yalniz basligi tasimak veriyi yanlis sutuna yazar.
  const govde = src.slice(src.indexOf('satirlar.map'));
  // HUCRE isaretleri (sablon dizgisindeki ${r.application} DEGIL): <td>...</td> icerigi.
  const locIdx = govde.indexOf("{r.location || '—'}");
  const appIdx = govde.indexOf('>{r.application}</td>');
  assert.ok(locIdx >= 0 && appIdx >= 0, 'hucreler bulunamadi');
  assert.ok(locIdx < appIdx, 'baslik tasindi ama HUCRE tasinmadi - veri yanlis sutunda gorunur');
});

test('AR10: "olculemedi" ipucu jargonla degil OLAN BITENLE anlatilir', () => {
  // Kullanici (2026-09-29): "'Log kuyrugu 7 gunu kapsamiyor: sayi ALT SINIRDIR' diye bir
  // ibare var, bu ne demek anlamadim? bozuk bir Turkce'yle yazilmis."
  const src = ekran();
  assert.ok(!/ALT SINIRDIR/.test(src), 'anlasilmayan jargon geri gelmis');
  assert.ok(!/[Ll]og kuyruğu/.test(src), '"log kuyrugu" ifadesi kullaniciya hicbir sey soylemiyor');
  // Iki sebep de ACIKCA anlatilmali ve ikisi de "yuk yok" DEGIL.
  assert.match(src, /yalnızca son bölümü okunabildi/, 'kismi okuma sade dille anlatilmiyor');
  assert.match(src, /Access log okunamadı/, 'okunamama durumu anlatilmiyor');
  const kez = (src.match(/yük almıyor” demek değil|“yük almıyor” denemez/g) || []).length;
  assert.ok(kez >= 2, '"olculemedi" ile "yuk almiyor" farki her iki sebepte de yazilmamis');
});

// ── LOCATION BAZLI BEYAN (LB1..LB5, 2026-10-01) ──────────────────────────────────────
//
// Kullanici: "ayni uygulamaya tanimli 3 tane location bulunuyor. Birine kullanilmiyor
// dedigim zaman hepsine kullanilmiyor olarak isaretleniyor."
//
// IKI AYRI HATA VARDI ve ikisi de duzeltildi:
//   1. istek `location` TASIMIYORDU -> sunucu uygulama satirina yaziyordu
//   2. yanit gelince EKRAN ayni uygulamanin TUM satirlarini guncelliyordu
const SPA_UI = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'components', 'ArkSpaRaporuPage.tsx'),
  'utf8',
);
const SPA_API = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'api', 'arkSpaApi.ts'),
  'utf8',
);
const SPA_IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

const satirlar3 = [
  { service: 'GLOMO', env: 'PROD', application: 'app-v1', namespace: 'ns-prod', location_path: '/a/', host: 'H1' },
  { service: 'GLOMO', env: 'PROD', application: 'app-v1', namespace: 'ns-prod', location_path: '/b/', host: 'H1' },
  { service: 'GLOMO', env: 'PROD', application: 'app-v1', namespace: 'ns-prod', location_path: '/c/', host: 'H1' },
];

test('LB1 location beyani YALNIZ o satiri etkiler; otekiler uygulamadan devralir', () => {
  const beyanlar = new Map([
    ['ns-prod/app-v1', { inUse: 'yes', inUseBy: 'uyg', note: 'uygulama geneli' }],
    ['ns-prod/app-v1\u0000/b/', { inUse: 'no', inUseBy: 'loc', note: 'bu location' }],
  ]);
  const r = buildSpaReport({
    rows: satirlar3,
    beyanlar,
    trafficOf: () => null,
    ekipOf: () => ['EKIP-A'],
    env: 'PROD',
  });
  const by = Object.fromEntries(r.rows.map((x) => [x.location, x]));
  assert.equal(by['/b/'].inUse, 'no', 'location beyani gecmiyor');
  assert.equal(by['/b/'].inUseScope, 'location');
  assert.equal(by['/b/'].note, 'bu location');
  for (const l of ['/a/', '/c/']) {
    assert.equal(by[l].inUse, 'yes', `${l}: location beyani sizmis - hata geri gelmis`);
    assert.equal(by[l].inUseScope, 'application', `${l}: devralinma isareti yok`);
  }
});

test('LB2 hic beyan yoksa inUseScope null (uydurma beyan yok)', () => {
  const r = buildSpaReport({
    rows: satirlar3,
    beyanlar: new Map(),
    trafficOf: () => null,
    ekipOf: () => [],
    env: 'PROD',
  });
  for (const x of r.rows) {
    assert.equal(x.inUse, null);
    assert.equal(x.inUseScope, null);
  }
});

test('LB3 ekran istegi LOCATION gonderiyor', () => {
  const i = SPA_UI.indexOf('arkSpaApi.declare({');
  assert.ok(i > 0, 'declare cagrisi bulunamadi');
  assert.match(
    SPA_UI.slice(i, i + 300),
    /location: r\.location,/,
    "istek location TASIMIYOR - sunucu uygulama satirina yazar ve hata geri gelir",
  );
  assert.match(SPA_API, /location: string;/, 'API tipi location almiyor');
});

test('LB4 ekran YALNIZ o satiri guncelliyor (uygulama geneli DEGIL)', () => {
  assert.ok(
    !/x\.namespace === r\.namespace && x\.application === r\.application/.test(SPA_UI),
    'yanit gelince ayni uygulamanin TUM satirlari guncelleniyor - hatanin ikinci yarisi',
  );
  assert.match(
    SPA_UI,
    /satirAnahtari\(x\) === k/,
    'satir anahtari location icermiyor olabilir',
  );
  assert.match(
    SPA_UI,
    /const satirAnahtari = \(r: ArkSatir\) =>[^\n]*r\.location/,
    'satir anahtari location TASIMIYOR',
  );
});

test('LB5 sunucu location verildiginde AYRI tabloya yaziyor', () => {
  const i = SPA_IDX.indexOf("router.put('/declare'");
  const blok = SPA_IDX.slice(i, i + 5000);
  assert.match(blok, /nginx_spa_location_in_use/, 'location beyani ayri tabloya yazilmiyor');
  assert.match(blok, /scope: 'location'/, 'yanit hangi seviyeye yazildigini soylemiyor');
  // LOCATION YOKSA ESKI DAVRANIS KORUNUR: SPA Tasimalari ekrani bu ucu location'siz cagirir.
  assert.match(blok, /scope: 'application'/, 'uygulama seviyesi yol kaybolmus');
});

// ── EKIP VE YUK SUZGECLERI (SF1..SF2, kullanici 2026-10-01) ─────────────────────────
test('SF1 ekip suzgeci var ve "bilinmiyor" AYRI secenek', () => {
  assert.match(SPA_UI, /setEkip\(/, 'ekip suzgeci yok');
  assert.match(SPA_UI, /ekip: bilinmiyor/, 'ekibi cozulemeyen satirlar suzulemez');
  // Ekip listesi TUM satirlardan turetilmeli; suzulmus listeden turetmek tek yon olurdu.
  const i = SPA_UI.indexOf('const ekipler = useMemo');
  assert.ok(i > 0, 'ekip listesi yok');
  assert.match(SPA_UI.slice(i, i + 260), /data\?\.rows \|\| \[\]/, 'ekip listesi suzulmus satirlardan');
});

test('SF2 yuk suzgeci UC durumu AYRI tutuyor ("olcum yok" != "yuk almiyor")', () => {
  for (const d of ['active', 'idle', 'unknown', 'none']) {
    assert.ok(SPA_UI.includes(`value="${d}"`), `yuk suzgecinde secenek yok: ${d}`);
  }
  const i = SPA_UI.indexOf("if (yuk !== 'all')");
  assert.ok(i > 0, 'yuk suzgec mantigi yok');
  assert.match(
    SPA_UI.slice(i, i + 200),
    /r\.traffic \? r\.traffic\.state : 'none'/,
    'olcumu olmayan satir "yuk almiyor" ile ayni kefeye konmus',
  );
});
