// src/__tests__/kaynak-notu.test.cjs — "Bu veri nereden geliyor?" notu.
//
// Desen Nginx Hub'da dogdu (kullanici: *"nginx job'lari iyice karismaya
// basladi; Nginx Hub'daki verilerin console_fetch'le baglantisi var mi?"*) ve
// oraya HAPSOLMUSTU: kaynak katalogu bilesenin ICINE gomuluydu, yani baska bir
// modul kullanmak istediginde ya o birligi buyutmesi ya da kopyalamasi
// gerekirdi.
//
// EN KRITIK BEKCI KN4'TUR: notun YANLIS bir is adi soylemesi, notu hic
// yazmamaktan KOTUDUR — kullanici olmayan bir job'i arar.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('KN1 ortak bilesen katalogu PROP olarak alir (modul sahipligi)', () => {
  const s = oku('src/components/common/SourceNote.tsx');
  assert.match(s, /source:\s*DataSource/, 'kaynak prop olarak alinmiyor');
  // Katalog bilesenin ICINE gomulmemeli — orijinal uygulamanin onu
  // `nginx_console` klasorune hapseden sey buydu.
  assert.doesNotMatch(
    s,
    /const SOURCES\s*[:=]/,
    'katalog yine bilesene gomulmus — baska modul kullanamaz',
  );
});

test('KN2 uc durum AYRI: tarih / damga yok / hic yazma', () => {
  const s = oku('src/components/common/SourceNote.tsx');
  assert.match(s, /scanDate === null/, '"tarama kaydi yok" durumu ayrilmamis');
  assert.match(s, /son tarama/, 'tarih durumu yok');
  // `null` (damga yok) ile `undefined` (yazma) ayri olmali; ikisini
  // birlestirmek "veri yok" ile "damga yok"u karistirmak olurdu.
  assert.match(s, /scanDate\?:\s*string \| null/, 'opsiyonel + nullable ayrimi tipte yok');
});

test('KN3 not GERCEKTEN cevapsiz kalan ekranlara baglandi', () => {
  const beklenen = [
    // Cluster yetenekleri: panelde duz bir paragraf vardi ama is adi / tarama
    // damgasi / nasil tazelenecegi TEK SATIRDA yoktu.
    ['src/components/admin/tabs/ScaleXAdminTab.tsx', 'SCALEX_CAPS'],
    // Uygulama listesi: kaynak YALNIZCA KOD YORUMUNDA yaziliydi.
    ['src/components/scalex/steps/WorkloadStep.tsx', 'SCALEX_APPS'],
    // Telnet cluster katalogu: kaynagi yalnizca BOS durumda soyluyordu.
    ['src/components/telnet/steps/OcpClusterPickStep.tsx', 'OCP_CLUSTER_INDEX'],
  ];
  for (const [dosya, anahtar] of beklenen) {
    const s = oku(dosya);
    assert.match(s, /<SourceNote/, `${dosya}: not render edilmiyor`);
    assert.ok(s.includes(anahtar), `${dosya}: ${anahtar} katalog girdisi kullanilmiyor`);

    // ── VARLIK DEGIL, ULASILABILIRLIK ──────────────────────────────────────
    // Ilk yazimda yalnizca "<SourceNote metni geciyor mu" soruluyordu ve bekci
    // KORDU: render `{false && <SourceNote .../>}` icine alindiginda metin
    // dosyada duruyor, not ekranda GORUNMUYOR. Bu oturumda alticinci kez ayni
    // desen. Simdi notun OLU BIR DALDA olmadigi da siniyor.
    const i = s.indexOf('<SourceNote');
    const once = s.slice(Math.max(0, i - 120), i);
    assert.doesNotMatch(
      once,
      /\{\s*(false|0|null|undefined)\s*&&/,
      `${dosya}: not olu bir dalin icinde — kaynakta var, ekranda YOK`,
    );
  }
});

test('KN4 katalogdaki her IDDIA kaynakta DOGRULANABILIR', () => {
  // Yanlis bir is/tablo adi, notu hic yazmamaktan kotudur.
  //
  // ── YORUMLAR DEGIL, ALAN DEGERLERI ────────────────────────────────────────
  // Ilk yazimda dosyanin TAMAMI taraniyordu ve bekci KORDU: `job:` degeri
  // bozulsa bile ayni sozcuk JSDoc yorumunda gecmeye devam ediyor ve eslesme
  // tutuyordu. Artik yalnizca `job:` / `what:` / `refresh:` degerleri okunur.
  const ham = oku('src/config/dataSources.ts');
  const kat = [...ham.matchAll(/^\s*(?:job|what|refresh):\s*'([^']*)',?$/gm)]
    .map((m) => m[1])
    .join('\n');
  assert.ok(kat.length > 0, 'katalog alan degerleri okunamadi — desen degismis');

  // ScaleX yetenekleri gercekten `scalex_cluster_caps` tablosunu okuyor mu?
  assert.match(kat, /scalex_cluster_caps/);
  assert.match(oku('server/scalex/cluster-caps.cjs'), /scalex_cluster_caps/,
    'katalog olmayan bir tabloyu gosteriyor');

  // `capabilities` modu GERCEKTEN var mi (PR-A'da erisilebilir yapildi)?
  assert.match(kat, /capabilities/);
  assert.match(oku('src/api/scalexApi.ts'), /'capabilities'/,
    'katalog erisilemeyen bir modu tarif ediyor');

  // LogX/ScaleX katalogu gercekten `Openshift_Inventory` okuyor mu?
  assert.match(kat, /Openshift_Inventory/);
  assert.match(oku('server/logx/v2/ocp-inventory.cjs'), /dbo\.Openshift_Inventory/,
    'katalog olmayan bir envanter tablosunu gosteriyor');

  // Cluster hiyerarsisi gercekten bir PORTAL AYARI mi (tarama degil)?
  assert.match(kat, /portal ayarı \(tarama değil\)/);
  assert.match(oku('server/logx/v2/admin.cjs'), /listClusterIndex/,
    'cluster katalogu admin tablosundan gelmiyor');
});

test('KN5 LogX namespace adimina IKINCI bir not EKLENMEDI', () => {
  // Orada zaten `CacheBadge` var: tazelik, kaynak ve tazeleme dugmesi. Ustune
  // SourceNote koymak TEKRAR olurdu — desen yaymak, her ekrana ayni kutuyu
  // basmak demek degil.
  const s = oku('src/components/logx_v2/steps/ocp/NamespacePickerStep.tsx');
  assert.match(s, /CacheBadge/, 'mevcut cevap kaybolmus');
  assert.doesNotMatch(s, /<SourceNote/, 'ayni soruya ikinci bir kutu eklenmis');
});

test('KN6 `nginx_console` kopyasi BOZULMADI (kapsam disi)', () => {
  const s = oku('src/components/nginx_console/SourceNote.tsx');
  assert.match(s, /export function SourceNote/, 'kapsam disi bilesen degismis');
  assert.match(s, /NGINX_SOURCES/, 'kapsam disi katalog degismis');
});
