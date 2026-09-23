// server/telnet/__tests__/legacy-yetki-kapisi.test.cjs
//
// TELNET LEGACY DALI DA KISITLAMALARA TABI OLSUN.
//
// Telnet ve LogX v2 AYNI `logx_v2_restrictions` tablosunu kullaniyor. OCP dalina
// 2026-08-28'de namespace kapisi eklenmisti ve gerekcesi kodda yaziliydi:
// *"LogX/OpsX'te kisitlanmis bir namespace'e Telnet modulunden erisilebiliyor,
// kullanici listede gormedigi bir adi govdeye ELLE yazabiliyordu."*
//
// Ayni cumle LEGACY dali icin de dogruydu ama orasi atlanmisti: LogX v2
// `/legacy/hosts` ve `discover` uclarini koruyor, Telnet hicbirini korumuyordu.
// Ayni kisit, ayni tablo, iki farkli sonuc.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const kodOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Fail-closed dilim. */
function dilim(src, bas, son) {
  const i = src.indexOf(bas);
  assert.ok(i >= 0, `dilim baslangici yok: ${bas}`);
  const j = src.indexOf(son, i + bas.length);
  assert.ok(j > i, `dilim sonu yok: ${son}`);
  return src.slice(i, j);
}

const TELNET = () => kodOnly(oku('server/telnet/index.cjs'));

test('TY1 `/hosts` kisitli uygulamanin SUNUCU LISTESINI vermez', () => {
  const d = dilim(TELNET(), "app.get('/api/telnet/hosts'", "app.get('/api/telnet/clusters'");
  assert.match(
    d,
    /assertAllowed\(\s*'legacy_app'/,
    'sunucu listesi kisitlamasiz donuyor — LogX gizlerken Telnet siziyor',
  );
  // Kapi `hostsForApp`tan ONCE gelmeli; sonra gelirse liste zaten okunmus olur.
  const kapi = d.indexOf('assertAllowed');
  const okuma = d.indexOf('hostsForApp(');
  assert.ok(kapi >= 0 && okuma > kapi, 'kapi listeyi OKUDUKTAN sonra calisiyor');
  assert.doesNotMatch(d, /if\s*\(\s*(true|false|0|null|undefined)\s*\)/, 'sabit kosullu dal');
});

test('TY2 legacy `run` ISLEMIN KENDISINI de kapidan gecirir', () => {
  // Istemci `/hosts`u hic cagirmadan govdeye uygulama adini ELLE yazabilir;
  // liste kapisi tek basina yetmez.
  // CIPA KOD OLMALI, YORUM DEGIL: `kodOnly` yorumlari siliyor, yani yorum
  // sinirina dayanan bir dilim HER ZAMAN "bulunamadi" der (bu tuzaga bir kez
  // dusuldu — fail-closed `dilim` sayesinde sessiz gecmedi).
  const d = dilim(TELNET(), "'Uygulama adı gerekli.'", 'const DB_OPS_HOST');
  assert.match(d, /assertAllowed\(\s*\n?\s*'legacy_app'/, 'legacy run kisitlamasiz calisiyor');
  const kapi = d.indexOf('assertAllowed');
  const calistirma = d.indexOf('limitHosts');
  assert.ok(kapi >= 0 && (calistirma < 0 || calistirma > kapi), 'kapi calistirmadan SONRA');
});

test('TY3 kapi LogX ile AYNI kaynak tipini kullanir (kisit tek yerde tanimlansin)', () => {
  const telnet = TELNET();
  const logx = kodOnly(oku('server/logx/v2/index.cjs'));
  const tip = /assertAllowed\(\s*\n?\s*'legacy_app'/;
  assert.match(logx, tip, 'LogX emsali kaybolmus — karsilastirma anlamsiz');
  assert.match(telnet, tip, 'Telnet farkli bir kaynak tipi kullaniyor');
  // Ayni modulden gelmeli; Telnet kendi kopyasini kurmamali.
  assert.match(
    telnet,
    /require\('\.\.\/logx\/v2\/restrictions\.cjs'\)/,
    'Telnet kisitlama mantigini kendi icinde yeniden kuruyor',
  );
});

test('TY4 OCP dalindaki mevcut namespace kapisi DURUYOR (gerileme yok)', () => {
  const t = TELNET();
  assert.match(t, /isAllowed\(\s*'ocp_namespace'/, 'OCP namespace kapisi kaybolmus');
});

test('TY5 `assertAllowed` gercekten 403 sinifi bir hata firlatir', async () => {
  // Kapinin kendisi dogru davranmazsa yukaridaki yapisal bekciler bos guvence olur.
  const restrictions = require('../../logx/v2/restrictions.cjs');
  assert.equal(typeof restrictions.assertAllowed, 'function');
  const src = oku('server/logx/v2/restrictions.cjs');
  const d = dilim(kodOnly(src), 'async function assertAllowed', 'async function listRestrictions');
  assert.match(d, /status:\s*403/, 'assertAllowed 403 disinda bir durumla reddediyor');
});
