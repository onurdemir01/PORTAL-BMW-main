// server/scalex/__tests__/is-gecmisi-ekrani.test.cjs
//
// YAZILMIS AMA HIC CAGRILMAYAN UC: `GET /api/scalex/history`.
//
// Uc PR #115'ten beri vardi, `scalexApi.history()` sarmalayicisi da yazilmisti,
// ama HICBIR BILESEN cagirmiyordu. Sonuclari:
//   * uzlastiricinin `UNKNOWN` yazdigi isler kullaniciya HIC gorunmuyordu,
//   * SMART onay zinciri (approval_state/approved_by/approved_at) yalniz DB'deydi,
//   * tarayici sekmesi kapandiktan sonra bir isin sonucuna ulasmanin yolu yoktu.
//
// Bu tur SUNUCUYA DOKUNMUYOR — yalnizca ekran. Bekciler de bunu kilitliyor.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const kodOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function dilim(src, bas, son) {
  const i = src.indexOf(bas);
  assert.ok(i >= 0, `dilim baslangici yok: ${bas}`);
  const j = src.indexOf(son, i + bas.length);
  assert.ok(j > i, `dilim sonu yok: ${son}`);
  return src.slice(i, j);
}

const TAB = () => kodOnly(oku('src/components/admin/tabs/ScaleXAdminTab.tsx'));

test('IG1 uc ARTIK bir ekrandan cagriliyor', () => {
  const t = TAB();
  assert.match(t, /scalexApi\.history\(\)/, 'is gecmisi ucu hala hicbir ekrandan cagrilmiyor');
  assert.match(t, /<IsGecmisiPanel\s*\/>/, 'panel hicbir yerde render edilmiyor');
});

test('IG2 `UNKNOWN` "basarisiz" gibi GOSTERILMEZ', () => {
  // Uzlastirici 24 saat okuyamadigi isi UNKNOWN yapiyor; bunu kirmiziya boyamak
  // kullaniciya "is basarisiz" dedirtirdi — oysa is basarili da olmus olabilir.
  const ham = oku('src/components/admin/tabs/ScaleXAdminTab.tsx');
  const d = dilim(ham, 'const DURUM_TONU', '};');
  const m = d.match(/UNKNOWN:\s*'([^']+)'/);
  assert.ok(m, 'UNKNOWN icin ayri bir ton tanimlanmamis');
  assert.doesNotMatch(m[1], /red-/, 'UNKNOWN kirmizi gosteriliyor — "basarisiz" sanilir');
  assert.match(d, /failed:\s*'[^']*red-/, 'gercek basarisizlik kirmizi degil');
});

test('IG3 SMART/OCO onay zinciri TABLODA gosteriliyor', () => {
  // ── DILIM PANEL DEGIL, SATIR OLMALI ─────────────────────────────────────────
  // Ilk yazimda tum panel taraniyordu ve bekci KORDU: satirdaki render blogu
  // silindiginde ayni alan adlari CSV SUTUN LISTESINDE gecmeye devam ediyor ve
  // bekci geciyordu. Bu oturumda dorduncu kez ayni desen — tanimlayicinin
  // VARLIGI degil, DOGRU YERDE olmasi sorulmali.
  const d = dilim(
    TAB(),
    "{r.smart_ticket_id",
    '</td>',
  );
  for (const alan of ['smart_ticket_id', 'oco_number', 'approval_state']) {
    assert.ok(d.includes(alan), `${alan} tablo satirinda gosterilmiyor — yalniz DB'de kalir`);
  }
  // Uc alan da bossa "—" yazilmali; bos hucre "veri yok mu, ozellik yok mu" sorusunu dogurur.
  assert.match(d, /'—'/, 'bos onay hucresi hicbir sey soylemiyor');
});

test('IG4 CSV EKRANDA GORULENI disa aktarir (ham listeyi degil)', () => {
  const d = dilim(TAB(), 'function IsGecmisiPanel', 'function ClusterCapsPanel');
  const i = d.indexOf('downloadCsv(');
  assert.ok(i > 0, 'CSV disa aktarma yok');
  const csv = d.slice(i, d.indexOf('return (', i));
  assert.match(csv, /suzulmus\.map/, 'CSV suzulmemis listeyi veriyor — ekranla tutarsiz');
  assert.doesNotMatch(csv, /\brows\.map\(/, 'CSV ham listeyi veriyor');
});

test('IG5 200 satir KIRPMASI kullaniciya soylenir', () => {
  // Sunucu `TOP 200` uyguluyor; bunu sessizce gostermek "hepsi bu" sanmaya yol acar.
  const ham = oku('src/components/admin/tabs/ScaleXAdminTab.tsx');
  const d = dilim(ham, 'function IsGecmisiPanel', 'function ClusterCapsPanel');
  assert.match(d, /rows\.length >= 200/, 'kirpma esigi ekranda kontrol edilmiyor');
  assert.match(d, /kırpıl/i, 'kirpma kullaniciya soylenmiyor');
});

test('IG6 SUNUCUYA DOKUNULMADI — uc ve sorgu aynen duruyor', () => {
  const s = kodOnly(oku('server/scalex/index.cjs'));
  const d = dilim(s, "'/history'", 'app.use(');
  assert.match(d, /SELECT TOP 200/, 'sunucu sorgusu degismis');
  assert.match(d, /WHERE username = \$1/, 'kullanici suzgeci kaybolmus — herkes hepsini gorur');
  assert.doesNotMatch(d, /result_json/, 'result_json listeye geri eklenmis — yanit onlarca MB olur');
});

test('IG7 bos ve suzulmus-bos durumlari AYRI anlatilir', () => {
  const ham = oku('src/components/admin/tabs/ScaleXAdminTab.tsx');
  const d = dilim(ham, 'function IsGecmisiPanel', 'function ClusterCapsPanel');
  assert.match(d, /TableEmptyRow/, 'ortak bos-satir bileseni kullanilmiyor');
  assert.match(d, /Süzgece uyan kayıt yok/, '"suzgec bos" durumu ayrilmamis');
  assert.match(d, /Henüz ScaleX işlemi yok/, '"hic kayit yok" durumu ayrilmamis');
});
