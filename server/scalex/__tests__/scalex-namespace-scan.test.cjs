// server/scalex/__tests__/scalex-namespace-scan.test.cjs — ScaleX canli namespace taramasi.
//
// NEDEN VAR: ScaleX namespace listesini YALNIZCA katalogdan okuyordu
// (`dbo.Openshift_Inventory` ∪ `ocp_namespace_cache`). Envanter zamanlanmis bir isle
// gecikmeli yazildigi icin YENI acilmis bir namespace ScaleX'te HIC gorunmuyordu ve
// kullanicinin yapabilecegi hicbir sey yoktu — LogX'te "Bu namespace'i tara" dugmesi
// VARDI, ScaleX'te yoktu.
//
// KRITIK KURAL: iki taraf AYNI onbellege yazar. Yazma mantigi kopyalanirsa ikisi
// zamanla ayrisir ve ayni tabloya FARKLI sekiller yazilir. Bu yuzden yazma tek bir
// paylasilan fonksiyonda (`ocp.cacheNamespaceDiscovery`) durur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

const SCALEX = codeOnly(read('scalex/index.cjs'));
const OCP = codeOnly(read('logx/v2/ocp.cjs'));

test("NS1 tarama ucu VAR ve AYNI playbook'u calistiriyor", () => {
  assert.match(SCALEX, /'\/namespaces\/discover'/, 'ScaleX tarama ucu yok');
  // Ayni playbook: ayri bir sablon acmak, iki farkli sozlesme demekti.
  assert.match(
    SCALEX,
    /keyName: 'logx_ocp_namespace_discovery'/,
    "ScaleX kendi ayri namespace playbook'unu calistiriyor — sozlesme ikiye ayrilir",
  );
});

test('NS2 sonuc PAYLASILAN onbellege, PAYLASILAN fonksiyonla yazilir', () => {
  // Yazma mantigi ScaleX icinde KOPYALANMAMALI.
  assert.match(
    SCALEX,
    /cacheNamespaceDiscovery\(/,
    'ScaleX onbellege paylasilan fonksiyonla yazmiyor',
  );
  assert.doesNotMatch(
    SCALEX,
    /putNamespaces\(/,
    'ScaleX onbellege DOGRUDAN yaziyor — LogX ile ayrisir, ayni tabloya iki sekil girer',
  );
  // Ve paylasilan fonksiyon gercekten onbellege yaziyor olmali.
  const fn = OCP.slice(OCP.indexOf('async function cacheNamespaceDiscovery'));
  assert.ok(fn.length > 0, 'paylasilan fonksiyon yok');
  assert.match(fn.slice(0, 1200), /putNamespaces\(/, 'paylasilan fonksiyon onbellege yazmiyor');
});

test('NS3 yalnizca BASARILI cluster taramasi onbellege yazilir', () => {
  // Hatali bir cluster icin "namespace yok" yazmak, kullaniciyi yanlis yonlendirir:
  // bir sonraki okumada liste "bos ama taranmis" gorunur.
  const fn = OCP.slice(
    OCP.indexOf('async function cacheNamespaceDiscovery'),
    OCP.indexOf('async function finalizeNamespaceDiscovery'),
  );
  assert.match(
    fn,
    /c\.status !== 'ok'/,
    'basarisiz cluster da onbellege yaziliyor — "taranmis ama bos" yalani uretir',
  );
});

test('NS4 LogX de AYNI paylasilan fonksiyonu kullaniyor (kopya kalmadi)', () => {
  const fin = OCP.slice(OCP.indexOf('async function finalizeNamespaceDiscovery'));
  assert.match(
    fin.slice(0, 1200),
    /cacheNamespaceDiscovery\(/,
    'LogX hala kendi kopyasiyla yaziyor — iki yol zamanla ayrisir',
  );
});

test('NS5 tarama ucunda cluster duzeyinde YETKI kapisi var', () => {
  const route = SCALEX.slice(SCALEX.indexOf("'/namespaces/discover'"));
  const body = route.slice(0, route.indexOf('/namespaces/discover/:serverId'));
  // Namespace HENUZ YOK (taranacak olan o), ama cluster kapisi kurulmali.
  assert.match(
    body,
    /assertClustersExist\(/,
    'tarama ucu cluster varligini/yetkisini dogrulamiyor',
  );
  assert.match(
    body,
    /auditPortal\(req, 'scalex_namespace_discovery'/,
    'tarama denetime yazilmiyor',
  );
});

test('NS6 durum ucu "hicbiri taranamadi" ile "namespace yok"u AYIRIR', () => {
  const route = SCALEX.slice(SCALEX.indexOf("'/namespaces/discover/:serverId/:jobId/status'"));
  const body = route.slice(0, 3000);
  // Cluster basina durum VE hata metni istemciye gitmeli; yalnizca sayi gondermek
  // "0 namespace" ile "taranamadi"yi ayirt edilemez yapardi (bkz. PR #66).
  assert.match(body, /status: c\.status/, 'cluster basina durum donmuyor');
  assert.match(body, /error: c\.error/, 'cluster basina hata metni donmuyor');
});

test('NS7 onyuz taranamayan cluster\'i "namespace yok" diye SUNMAZ', () => {
  const ui = codeOnly(
    fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src/components/scalex/steps/NamespaceStep.tsx'),
      'utf8',
    ),
  );
  assert.match(ui, /discoverNamespaces\(/, 'ekranda tarama dugmesi yok');
  assert.match(
    ui,
    /Hiçbir cluster taranamadı/,
    'tum cluster\'lar dusunce ekran bunu soylemiyor — kullanici "namespace yok" saniyor',
  );
  // Basarili tarama sonrasi liste YENIDEN OKUNMALI; yoksa kullanici taradigi
  // namespace'i yine goremez ve tekrar tarar.
  assert.match(ui, /await loadList\(\)/, 'tarama sonrasi liste yenilenmiyor');
});
