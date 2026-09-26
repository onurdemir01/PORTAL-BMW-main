// server/nginx-console/__tests__/orphan-cleanup.test.cjs — "Kullanilmayan" temizligi.
//
// Bu akis URETIMDE DOSYA TASIR. Portal tarafindaki kapilari kilitliyoruz; sunucudaki taze
// nginx -T kontrolu playbook'ta ve bmw_nginx/tests/check_orphan_cleanup.py'de.
//
// OC1 yol dogrulama: yalniz /usr/nginx agaci, '..' yok, satir sonu yok (liste BOLUNUR)
// OC2 sozlesme: istek base64 SATIR LISTESI gonderir, varsayilan mod plan
// OC3 ekran: secim sunucu bazinda, "apply" ayri bir dugme (plan'in yan etkisi degil)
// OC4 katalog: playbook kaydi var, aksi halde Admin template ID giremez
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

function kodSatirlari(s) {
  return s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

test('OC1: yol dogrulama - yalniz /usr/nginx agaci, .. ve satir sonu yok', () => {
  const m = SRC.match(/const CLEAN_PATH_RE = (\/.*\/);/);
  assert.ok(m, 'CLEAN_PATH_RE bulunamadi');
  // eslint-disable-next-line no-eval
  const re = eval(m[1]);

  for (const iyi of [
    '/usr/nginx/conf.d/ESKI-PROD.conf',
    '/usr/nginx/conf/rate_limits.conf',
    '/usr/nginx/ssl/eski.crt',
    '/usr/nginx/ssl/alt/eski.key',
    '/usr/nginx/nginx.conf',
  ]) {
    assert.ok(re.test(iyi), `kabul edilmeliydi: ${iyi}`);
  }

  // Agac disi: bu is nginx'in kendi dizinleri disinda HICBIR SEYE dokunmamali.
  for (const kotu of [
    '/etc/passwd',
    '/usr/nginx',
    '/usr/nginxx/conf.d/a.conf',
    '/hysdeploy/ns/app/x.zip',
    'conf.d/a.conf',
    '/usr/nginx/logs/access.log',
  ]) {
    assert.ok(!re.test(kotu), `reddedilmeliydi: ${kotu}`);
  }

  const kod = kodSatirlari(SRC);
  // Satir sonu yolu IKIYE bolerdi: playbook'a satir basina bir yol gidiyor. Bir saldirgan
  // (ya da bozuk bir kayit) tek alanda iki yol gecirebilirdi.
  assert.match(kod, /\[\\r\\n\\0\]/, 'satir sonu / NUL kontrolu yok');
  assert.match(kod, /includes\('\.\.'\)/, "'..' kontrolu yok");
  assert.match(kod, /MAX_CLEAN_PATHS/, 'liste boyutu sinirsiz');
});

test('OC2: sozlesme - base64 satir listesi, mod plan|apply, admin kapisi', () => {
  const kod = kodSatirlari(SRC);
  const rota = kod.slice(kod.indexOf("router.post('/orphans/cleanup'"), kod.indexOf("router.post('/push'"));
  assert.ok(rota.length > 200, 'temizlik rotasi bulunamadi');

  assert.match(rota, /isAdmin\(req\)/, 'dosya tasiyan uc admin kapisi olmadan aciliyor');
  assert.match(rota, /\['plan', 'apply'\]\.includes\(mode\)/, 'mod dogrulanmiyor');
  assert.match(rota, /mode = String\(req\.body\?\.mode \|\| 'plan'\)/, "varsayilan mod 'plan' degil");
  assert.match(rota, /paths_b64:/, 'playbook sozlesmesi paths_b64 bekliyor');
  assert.match(rota, /join\('\\n'\)/, 'yollar satir basina bir tane gonderilmiyor');
  assert.match(rota, /toString\('base64'\)/, 'base64 kodlama yok');

  // EKRANIN LISTESIYLE KARSILASTIRMA: istek elle uydurulduysa ya da dokum bayatsa durmali.
  assert.match(rota, /orphansOf/, 'gelen yollar sunucunun orphan listesiyle karsilastirilmiyor');
  assert.match(rota, /409/, 'liste disi yol icin catisma yaniti yok');
  assert.match(rota, /orp\.known/, 'yuklenen dosya listesi bilinmiyorken bile temizlik yapiliyor');
});

test('OC3: ekran - secim sunucu bazinda, "karantinaya al" ayri dugme', () => {
  const ui = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'OrphansTab.tsx'), 'utf8');

  assert.match(ui, /temizle\(h\.host, 'plan'\)/, 'plan dugmesi yok');
  assert.match(ui, /temizle\(h\.host, 'apply'\)/, 'karantina dugmesi yok');
  // Plan ile apply AYRI dugme olmali: tek dugme "plan sonra otomatik uygula" yapsaydi,
  // kullanici RED edilen dosyalari gormeden tasima baslamis olurdu.
  assert.ok(!/temizle\([^)]*'plan'[^)]*\)\s*;\s*temizle\([^)]*'apply'/.test(ui),
    'plan, apply\'i otomatik tetikliyor');
  assert.match(ui, /isAdmin &&/, 'secim kutulari admin disina da aciliyor');

  // Sunucu bazinda secim: tek dugmeyle tum filoyu temizlemek, bir sunucudaki yanlisi
  // on sunucuya birden yayardi.
  assert.match(ui, /Record<string, string\[\]>/, 'secim sunucu bazinda tutulmuyor');
  assert.ok(!/paths: rows\.flatMap/.test(ui), 'filo geneli toplu temizlik var');
});

test('OC4: playbook kaydi katalogda - yoksa Admin template ID giremez', () => {
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(setup, /key_name: 'nginx_orphan_cleanup'/, 'katalogda kayit yok');
  assert.match(setup, /NGINX_ORPHAN_CLEANUP_TEMPLATE_ID/, 'env degisken adi yok');
  // Sunucu bu anahtarla arar; katalogdaki ad ile bire bir ayni olmali.
  assert.match(kodSatirlari(SRC), /'nginx_orphan_cleanup'/, 'rota farkli bir anahtar kullaniyor');
});
