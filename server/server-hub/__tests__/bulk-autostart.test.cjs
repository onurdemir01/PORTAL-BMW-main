// server/server-hub/__tests__/bulk-autostart.test.cjs — toplu auto-start duzeltmesi.
//
// Kullanici (2026-09-28):
//   "auto-start'i kapali olup JVM process'i acik olan tum bulgulari tek tusla JVM
//    start'ini aktif edecek bir buton istiyorum" ve tersi.
//   Calisma bicimi olarak "Once plan, sonra onay" secildi.
//
// BU BEKCININ KORUDUGU SEY: toplu islem URETIMDE yuzlerce JVM'i degistirebilir.
//   BA1 planin ONAYSIZ calismadigi (confirm sarti) ve planin HICBIR IS BASLATMADIGI,
//   BA2 yalnizca IKI kodun toplu calisabildigi (rastgele bir kod ile toplu is acilamaz),
//   BA3 her sunucunun AYRI is aldigi - playbook tek hedef kabul eder, virgul reddedilir,
//   BA4 ust sinirin UYGULANDIGI ve kirpmanin SOYLENDIGI (sessiz yarim is yok),
//   BA5 bir sunucu duserse otekilerin devam ettigi ama DUSENIN raporlandigi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const { flatten } = require('../../util/guard-text.cjs');
const KOD = flatten(
  SRC.split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n'),
);

test('BA1: toplu uygulama ACIK ONAY ister; plan hicbir is baslatmaz', () => {
  assert.match(KOD, /router\.post\('\/bulk-plan'/, 'plan ucu yok');
  assert.match(KOD, /router\.post\('\/bulk-fix'/, 'uygulama ucu yok');
  // Onay kapisi: confirm !== true ise 400.
  assert.match(
    KOD,
    /req\.body\?\.confirm !== true/,
    'toplu duzeltme onaysiz calisabiliyor - tek tikla uretim degisir',
  );
  // PLAN SADECE OKUR: bulkPlan icinde launch cagrisi OLMAMALI.
  const plan = KOD.slice(
    KOD.indexOf('async function bulkPlan'),
    KOD.indexOf("router.post('/bulk-plan'"),
  );
  assert.ok(plan.length > 50, 'bulkPlan bulunamadi');
  assert.ok(!/launch\(/.test(plan), 'PLAN is baslatiyor - "once plan" sozu tutulmuyor');
});

test('BA2: yalnizca iki bulgu kodu toplu calisabilir', () => {
  const harita = KOD.slice(KOD.indexOf('const BULK_CODES'), KOD.indexOf('const BULK_MAX'));
  assert.match(
    harita,
    /REBOOT_RISK: 'jboss_autostart_on'/,
    'calisan+auto-start kapali -> AC eslemesi yok',
  );
  assert.match(
    harita,
    /STOPPED_AUTOSTART_ON: 'jboss_autostart_off'/,
    'kapali+auto-start acik -> KAPAT eslemesi yok',
  );
  // Bilinmeyen kod reddedilmeli: aksi halde herhangi bir fix eylemi toplu kosardi.
  assert.match(KOD, /Bu kod için toplu düzeltme tanımlı değil/, 'bilinmeyen kod reddedilmiyor');
  // "bilinmiyor" TOPLU ISLEME GIRMEZ: yalnizca bu iki kod var, AUTOSTART_UNKNOWN yok.
  assert.ok(!/AUTOSTART_UNKNOWN: /.test(harita), 'olculemeyen JVM toplu islemde degistiriliyor');
});

test('BA3: her sunucu AYRI is alir (playbook tek hedef kabul eder)', () => {
  const uygula = KOD.slice(KOD.indexOf("router.post('/bulk-fix'"));
  assert.match(uygula, /for \(const it of sirada\)/, 'sunucular tek tek gezilmiyor');
  assert.match(uygula, /target_host: it\.host/, 'hedef sunucu tek tek verilmiyor');
  // Virgulle birlestirip tek is acmak playbook'un korumasini delerdi.
  assert.ok(!/target_host:[^,]*join\(','\)/.test(uygula), 'hedefler virgulle birlestirilmis');
  assert.match(uygula, /plan_only: false/, 'uygulama adiminda plan_only kapatilmamis');
});

test('BA4: ust sinir var ve kirpma SOYLENIR', () => {
  assert.match(KOD, /const BULK_MAX = \d+;/, 'ust sinir yok - tek tikla sinirsiz is acilir');
  assert.match(KOD, /items\.slice\(0, BULK_MAX\)/, 'sinir uygulanmiyor');
  assert.match(KOD, /truncated/, 'kirpma bayragi tasinmiyor - yarim is "hepsi bitti" gibi okunur');
});

test('BA5: bir sunucu duserse otekiler devam eder, DUSEN raporlanir', () => {
  const uygula = KOD.slice(KOD.indexOf("router.post('/bulk-fix'"));
  assert.match(
    uygula,
    /catch \(err\) \{ failed\.push\(/,
    'tek sunucu hatasi tum toplu isi dusuruyor ya da yutuluyor',
  );
  assert.match(uygula, /failed,/, 'dusen sunucular cevapta yok');
});

test('BA6: ekran ONCE plani gosterir, uygulama ayri dugmedir', () => {
  const ui = flatten(
    fs.readFileSync(
      path.join(
        __dirname,
        '..',
        '..',
        '..',
        'src',
        'components',
        'server_hub',
        'ServerHubPage.tsx',
      ),
      'utf8',
    ),
  );
  assert.match(ui, /Toplu: auto-start AÇ/, 'AC dugmesi yok');
  assert.match(ui, /Toplu: auto-start KAPAT/, 'KAPAT dugmesi yok');
  assert.match(
    ui,
    /bulkPlaniAl\('REBOOT_RISK'\)/,
    'dugme dogrudan uyguluyor olabilir - once plan alinmali',
  );
  assert.match(ui, /serverHubApi \. bulkFix|serverHubApi\.bulkFix/, 'uygulama cagrisi yok');
  // Plan penceresi kac JVM/kac sunucu degisecegini SOYLEMELI.
  assert.match(ui, /JVM, .*sunucu değişecek/, 'plan penceresi etkiyi sayiyla soylemiyor');
});
