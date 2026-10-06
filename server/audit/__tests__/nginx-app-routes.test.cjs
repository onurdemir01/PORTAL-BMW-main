// server/audit/__tests__/nginx-app-routes.test.cjs — NR1..NR9 (2026-10-06).
//
// (namespace, uygulama) -> ROUTE ADRESI. Kullanici: "Reverse Proxy Production isteklerini
// namespace'e uygulama ismi alarak yaptirtmak istiyorum... eski sunuculara da sanki input
// URL gelmis gibi davranilmasi lazim; ilgili namespace'e uygulamaya tanimli root'u bulup
// ona gore tanim yapilmasi gerekiyor."
//
// EN PAHALI YANLIS: yanlis route'a tanim yazmak. Uygulama 404 olur ya da (termination tipi
// farkliysa) YANLIS AGA acilir. Bu yuzden coklu adayda ve kayit yoklugunda REDDEDILIR;
// bekciler bu iki reddi ve ileri yonle TUTARLILIGI kilitler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { routesForApp, resolveRouteForApp, hostOf } = require('../nginx-app-routes.cjs');

const r = (ns, routeName, addr, tt = 'reencrypt', cluster = 'gbocpprod1') => ({
  namespace_name: ns,
  route_name: routeName,
  route_address: addr,
  termination_type: tt,
  cluster_name: cluster,
});

test('NR1 kurumsal kalip: adresten eslesir ve URL doner', () => {
  const rows = [
    r('accounts-prod', 'digital-accounts-app-v0', 'digital-accounts-app-v0-accounts-prod.apps.fw.garanti.com.tr'),
    r('accounts-prod', 'baska-app-v0', 'baska-app-v0-accounts-prod.apps.fw.garanti.com.tr'),
  ];
  const out = resolveRouteForApp(rows, 'accounts-prod', 'digital-accounts-app-v0');
  assert.equal(out.ok, true);
  assert.equal(out.url, 'digital-accounts-app-v0-accounts-prod.apps.fw.garanti.com.tr');
  assert.equal(out.how, 'address');
  assert.equal(out.suffixAdded, false);
});

test('NR2 COKLU ROUTE: otomatik secim YOK, aday listesiyle reddedilir', () => {
  // Kullanici karari 2026-10-06: "Reddet, isteyen secsin". Termination tipi uygulamanin
  // agini belirliyor; birini secmek proxy_pass'i yanlis uca yazabilir.
  // GERCEKCI kurgu: ikinci route'un adresi kurumsal kaliba uymaz (ozel internet
  // hostname'i) ama route ADI uygulamayla ayni - yani o da bu uygulamanin route'u.
  const rows = [
    r('x-prod', 'app-v0', 'app-v0-x-prod.apps.fw.garanti.com.tr', 'reencrypt'),
    r('x-prod', 'app-v0', 'internet-app.garanti.com.tr', 'passthrough'),
  ];
  const out = resolveRouteForApp(rows, 'x-prod', 'app-v0');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'ambiguous');
  assert.equal(out.adaylar.length, 2);
  // Mesaj NE YAPILACAGINI soylemeli
  assert.match(out.message, /Listeden seçin/);
  // Termination tipleri mesajda GORUNMELI: secimi yapan sey o
  assert.match(out.message, /reencrypt/);
  assert.match(out.message, /passthrough/);
});

test('NR3 ROUTE YOK: URL UYDURULMAZ, sebep yazilir', () => {
  const out = resolveRouteForApp([r('baska-prod', 'app-v0', 'app-v0-baska-prod.apps.fw.garanti.com.tr')], 'x-prod', 'app-v0');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'no_route');
  // "no_route" ile "ambiguous" AYRI kodlar: biri "envanteri tazele", oteki "listeden sec"
  assert.match(out.message, /route envanterinde/);
  assert.match(out.message, /openshift_route_export/);
});

test('NR4 AYNI ADRES BIRDEN FAZLA CLUSTER: coklu aday DEGIL (prod ns/app 1-2-4"te durur)', () => {
  const rows = [
    r('x-prod', 'app-v0', 'app-v0-x-prod.apps.fw.garanti.com.tr', 'reencrypt', 'gbocpprod1'),
    r('x-prod', 'app-v0', 'app-v0-x-prod.apps.fw.garanti.com.tr', 'reencrypt', 'gbocpprod2'),
    r('x-prod', 'app-v0', 'app-v0-x-prod.apps.fw.garanti.com.tr', 'reencrypt', 'gbocpprod4'),
  ];
  const out = resolveRouteForApp(rows, 'x-prod', 'app-v0');
  assert.equal(out.ok, true, 'ayni adres farkli cluster"larda coklu aday sayildi');
  assert.deepEqual(out.aday.clusters, ['gbocpprod1', 'gbocpprod2', 'gbocpprod4']);
});

test('NR5 ADRES KALIBA UYMAZSA route ADI yedek olcut, ve bu GORUNUR kalir', () => {
  const rows = [r('x-prod', 'app-v0', 'serbest-ad.apps.fw.garanti.com.tr')];
  const out = resolveRouteForApp(rows, 'x-prod', 'app-v0');
  assert.equal(out.ok, true);
  assert.equal(out.url, 'serbest-ad.apps.fw.garanti.com.tr');
  assert.equal(out.how, 'name', 'zayif eslesme "address" gibi gosterilmis');
});

test('NR6 ADRESTEN ve ADDAN eslesmeler BIRLIKTE toplanir (gorunmez route olmasin)', () => {
  // Once "adres tuttuysa ada bakma" deniyordu. O kural, adresi kaliba uymayan GERCEK bir
  // ikinci route'u (ozel internet hostname'i, passthrough) sessizce gorunmez yapiyor ve
  // tek aday varmis gibi "cozuldu" donuyordu - tam olarak kacinilmak istenen sessiz
  // yanlis secim. Mutasyonla degil, NR2'nin kurgusunu duzeltirken ortaya cikti.
  const rows = [
    r('x-prod', 'app-v0', 'app-v0-x-prod.apps.fw.garanti.com.tr', 'reencrypt'),
    r('x-prod', 'app-v0', 'eski-ad.apps.fw.garanti.com.tr', 'edge'),
  ];
  const { adaylar } = routesForApp(rows, 'x-prod', 'app-v0');
  assert.equal(adaylar.length, 2, 'route adindan eslesen ikinci route gorunmez olmus');
  // AYNI URL ikisinden de tutarsa GUCLU kanit (adres) yazilir
  assert.equal(adaylar.find((a) => a.url.startsWith('app-v0-x-prod')).how, 'address');
  assert.equal(adaylar.find((a) => a.url.startsWith('eski-ad')).how, 'name');
  assert.equal(resolveRouteForApp(rows, 'x-prod', 'app-v0').code, 'ambiguous');
});

test('NR6b ATFEDILEMEYEN route sayisi GORUNUR: "tek route" ile "atfedebildigimiz tek route" ayri', () => {
  // Envanterde route -> service bagi YOK. Adresi kaliba uymayan ve adi uygulamadan
  // farkli bir route hangi uygulamaya ait, OLCULEMEZ. Sessiz gecmek "bu uygulamanin
  // tek route'u var" izlenimi verirdi.
  const rows = [
    r('x-prod', 'app-v0', 'app-v0-x-prod.apps.fw.garanti.com.tr', 'reencrypt'),
    r('x-prod', 'bambaska-route', 'ozel-ad.garanti.com.tr', 'passthrough'),
  ];
  const out = resolveRouteForApp(rows, 'x-prod', 'app-v0');
  assert.equal(out.ok, true);
  assert.equal(out.atfedilmeyen, 1, 'atfedilemeyen route sessizce yutuldu');
  // Cluster yinelemesi atfedilemeyen SAYILMAZ (ayni route uc prod cluster'inda durur)
  const yinelemeli = [
    r('x-prod', 'app-v0', 'app-v0-x-prod.apps.fw.garanti.com.tr', 'reencrypt', 'gbocpprod1'),
    r('x-prod', 'app-v0', 'app-v0-x-prod.apps.fw.garanti.com.tr', 'reencrypt', 'gbocpprod2'),
  ];
  assert.equal(resolveRouteForApp(yinelemeli, 'x-prod', 'app-v0').atfedilmeyen, 0);
});

test("NR7 namespace '-prod' eki yedek olarak denenir ve ISARETLENIR", () => {
  const rows = [r('x-prod', 'app-v0', 'app-v0-x-prod.apps.fw.garanti.com.tr')];
  const out = resolveRouteForApp(rows, 'x', 'app-v0');
  assert.equal(out.ok, true);
  assert.equal(out.suffixAdded, true, "'-prod' ekiyle eslesme sessiz kaldi");
  // TAM ad tutuyorsa ek DENENMEZ (yanlis namespace'e kaymasin)
  assert.equal(resolveRouteForApp(rows, 'x-prod', 'app-v0').suffixAdded, false);
});

test('NR8 ILERI YONLE AYNI KURAL: appFromAddress paylasilir', () => {
  // Portal'in ileri cozumu (nginx-migration resolveTarget) ve playbook'un
  // nginx_url_resolve.py'si ayni kalibi kullaniyor. Ters yon AYRI bir kural yazarsa
  // Portal bir URL verir, playbook onu BASKA namespace'e cozer ve tanim yanlis yere gider.
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'nginx-app-routes.cjs'), 'utf8');
  assert.ok(
    /require\('\.\/route-stats\.cjs'\)/.test(SRC) && /appFromAddress/.test(SRC),
    'ters cozucu kendi eslesme kuralini yazmis - ileri yonle kayar',
  );
  assert.ok(
    !/slice\(0, *-/.test(SRC.replace(/\/\/.*$/gm, '')),
    'ters cozucu etiket bolmeyi KENDI yapiyor; appFromAddress kullanilmali',
  );
});

test('NR9 input_url Self Servis secenek kaynagina BAGLI: elle URL giremez', () => {
  const CS = fs.readFileSync(
    path.join(__dirname, '..', '..', 'ansible', 'choice-sources.cjs'),
    'utf8',
  );
  assert.ok(CS.includes("'ocp-app-routes'"), 'secenek kaynagi kayitli degil');
  // Kaynak namespace VE application alanlarina bagli olmali: yalniz namespace'e bagli
  // olsa butun namespace'in route'lari aday olurdu.
  const blok = CS.slice(CS.indexOf("'ocp-app-routes'"), CS.indexOf("'nginx-hosts'"));
  for (const p of ['namespace', 'application', 'env'])
    assert.ok(new RegExp(`name: '${p}'`).test(blok), `kaynak '${p}' parametresi istemiyor`);
  // Cluster katalogu bossa BOS donmeli (baska ortamin route'u aday olmasin)
  assert.ok(
    /if \(!clusters\.length\) return \[\];/.test(blok),
    'cluster katalogu bosken tum envanter taraniyor - baska ortamin route"u aday olur',
  );
  // Etiket KANIT tasimali
  assert.ok(/route adından eşleşti/.test(blok), 'zayif eslesme etiketinde gorunmuyor');
  assert.ok(/a\.termination/.test(blok), 'termination tipi etikete yazilmiyor');
  assert.ok(/atfedilmeyen/.test(blok), 'atfedilemeyen route sayisi ekrana tasinmiyor');
});

test('NR10 hostOf: sema ve yol atilir', () => {
  assert.equal(hostOf('https://app-v0-x-prod.apps.fw.garanti.com.tr/'), 'app-v0-x-prod.apps.fw.garanti.com.tr');
  assert.equal(hostOf('http://a.b.c/yol/x'), 'a.b.c');
  assert.equal(hostOf('  A.B.C  '), 'a.b.c');
  assert.equal(hostOf(null), '');
});
