// server/scalex/__tests__/discovery-scope.test.cjs
//
// KESIF KAPSAMI VE KATALOG BESLEME — kaynak metni okuyan bekciler.
//
// Bu dosyadaki kurallar davranis testiyle degil kaynak denetimiyle kilitlenir,
// cunku ihlalleri KOD YAPISINDA yasar (yanlis kosul, eksik bayrak) ve uretimde
// SESSIZ zarar verir: yanlis yazilan bir katalog 49 uygulamayi silinmis
// isaretler ve kimse fark etmez. Yine de her bekci KARAR NOKTASINA bakar,
// yalnizca bir tanimlayicinin VARLIGINA degil.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const norm = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"');

/** Bir fonksiyon/blok govdesini kaba ama kararli sekilde cikarir. */
function blok(bas, son) {
  const i = SRC.indexOf(bas);
  assert.ok(i > 0, `blok bulunamadi: ${bas}`);
  const j = SRC.indexOf(son, i);
  assert.ok(j > i, `blok sonu bulunamadi: ${son}`);
  return SRC.slice(i, j);
}

test('DS1 daraltilmis kesif katalogu BESLEMEZ (49 uygulamayi silmez)', () => {
  // `putApps` o namespace'te gorulmeyen uygulamalari `is_deleted=1` yapar.
  // Kullanici 1 uygulama sectiyse kesif yalnizca onu dondurur; bunu katalog
  // yazimi saymak kalan 49'u SILERDI. Kosul bu yuzden `kapsam.full`.
  const g = norm(blok('const kapsam = DISCOVERY_SCOPE_CACHE.get', 'CIKTI KIRPILIR'));
  assert.match(g, /kapsam && kapsam\.full/, 'katalog yazimi `full` kosuluna bagli DEGIL');
  assert.match(g, /ocpCache\.putApps/, 'katalog hic beslenmiyor');
  // Kosul `putApps` cagrisindan ONCE olmali; sonra olsaydi hic ates almazdi.
  assert.ok(
    g.indexOf('kapsam.full') < g.indexOf('ocpCache.putApps'),
    '`full` kontrolu `putApps` cagrisindan SONRA — kapi hic ates almaz',
  );
});

test('DS2 kapsam, uygulama listesi BOSKEN `full` sayilir', () => {
  const g = norm(blok('rememberDiscoveryScope(job.serverId', '// IZ: kesif salt-okunur'));
  assert.match(g, /full: apps\.length === 0/, '`full` yanlis turetiliyor');
});

test('DS3 katalog yazimi CANLI alan SAKLAMAZ (bayat replica yanlis islem demek)', () => {
  const g = norm(blok('const kapsam = DISCOVERY_SCOPE_CACHE.get', 'CIKTI KIRPILIR'));
  // Yazilan nesne yalnizca kimlik tasimali; `replicas`/`image` BILEREK null.
  assert.match(g, /replicas: null/, 'katalog CANLI replica sayisi sakliyor');
  assert.match(g, /image: null/, 'katalog image sakliyor');
  for (const alan of ['specReplicas', 'readyReplicas', 'hasHpa', 'restorable', 'previousReplicas']) {
    assert.ok(!g.includes(alan), `katalog yazimina CANLI alan sizmis: ${alan}`);
  }
});

test('DS4 TARANAMAYAN cluster katalogu BESLEMEZ', () => {
  // Basarisiz bir cluster icin bos liste yazmak, o cluster'daki TUM uygulamalari
  // silinmis isaretlerdi — "okunamadi" ile "yok" ayni sey degildir.
  const g = norm(blok('const kapsam = DISCOVERY_SCOPE_CACHE.get', 'CIKTI KIRPILIR'));
  assert.match(g, /failedClusters/, 'basarisiz cluster ayiklanmiyor');
  assert.match(g, /basarisiz\.has\(c\)/, 'basarisiz cluster suzgeci karar noktasinda degil');
});

test('DS5 kesif kapsam onbellegi SINIRLI (sinirsiz Map bellek sizintisidir)', () => {
  const g = norm(blok('function rememberDiscoveryScope', 'FAIL-CLOSED'));
  assert.match(g, /DISCOVERY_SCOPE_CACHE\.size >= DISCOVERY_SCOPE_MAX/, 'boyut kapisi yok');
  assert.match(g, /DISCOVERY_SCOPE_CACHE\.delete/, 'en eski giris atilmiyor');
});

test('DS6 AWX ciktisi istemciye KIRPILARAK gidiyor ve kirpma SESSIZ degil', () => {
  const g = norm(blok('// CIKTI KIRPILIR', '      res.json({'));
  assert.match(g, /DISCOVERY_OUTPUT_MAX/, 'cikti tavani yok');
  assert.match(g, /KIRPILDI/, 'kirpma SESSIZ — kullaniciya soylenmiyor');
  // Yanitta ham `output.output` DEGIL, kirpilmis metin gitmeli.
  const yanit = norm(blok('// CIKTI KIRPILIR', 'result: parsed'));
  assert.match(yanit, /output: ciktiMetni/, 'yanit HAM ciktiyi gonderiyor');
});

test('DS7 `scanUnknown` ScaleX katalogundan GECIYOR (ucuncu durum kaybolmuyor)', () => {
  // Gecmezse ekran "okunamadi"yi "hic taranmadi" sayar ve HER SAYFA GIRISINDE
  // yeni bir AWX isi acar (LogX tarafinda uretimde yasandi).
  const cat = fs.readFileSync(path.join(__dirname, '..', 'catalog.cjs'), 'utf8');
  const listApps = cat.slice(cat.indexOf('async function listApps'), cat.indexOf('// Calistirma kapisi'));
  const kez = (listApps.match(/scanUnknown: cat\.scanUnknown/g) || []).length;
  // Iki donus yolu var: erken (bos liste) ve normal. IKISINDE de olmali.
  assert.equal(kez, 2, `\`scanUnknown\` ${kez} donus yolunda gecirilmis, 2 olmali`);
});
