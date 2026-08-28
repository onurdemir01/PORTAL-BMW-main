// src/__tests__/telnet-result-ui.test.cjs — E3-E8: sonuc ekrani.
//
// ONCE: ekranda kosulsuz bir YESIL TIK ve "Telnet testi baslatildi." vardi. Is HENUZ
// BITMEMISKEN de, TUM portlar KAPALI ciktiginda da ayni yesil tik goruluyordu — cunku
// tik AWX job'inin `successful` donusunu yansitiyordu, testin SONUCUNU degil. Kullanici
// icin bu "sonuc yok"tan kotudur: aktif olarak YANLIS bilgi verir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'components', 'telnet', 'TelnetWizardPage.tsx'), 'utf8');
const PANEL = fs.readFileSync(path.join(ROOT, 'components', 'telnet', 'steps', 'TelnetResultPanel.tsx'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'api', 'telnetApi.ts'), 'utf8');
const TRACKER = fs.readFileSync(path.join(ROOT, 'contexts', 'JobTrackerContext.tsx'), 'utf8');

// Yorumlari soyar: bu dosyalardaki aciklamalar KALDIRILAN metni ANLATMAK icin ondan
// alinti yapiyor; "hala duruyor mu" taramasi gercek KODA bakmali.
function stripComments(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')   // JSX yorumlari
    .replace(/\/\*[\s\S]*?\*\//g, '')         // blok yorumlar
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}
const PAGE_CODE = stripComments(PAGE);

test('E4: kosulsuz yesil tik KALDIRILDI', () => {
  assert.ok(!/CheckCircleIcon className="w-10 h-10 text-green-600"/.test(PAGE_CODE),
    'yaniltici yesil tik duruyor');
  assert.ok(!/Telnet testi başlatıldı\./.test(PAGE_CODE),
    '"baslatildi" metni sonuc ekraninda — is bitmeden sonuc gibi okunuyor');
});

test('E3: hedef basina satir gosteriliyor', () => {
  assert.match(PANEL, /result\.targets\.map/);
  assert.match(PANEL, /\{t\.cluster\}/);
  assert.match(PANEL, /\{t\.namespace\}/);
  assert.match(PANEL, /\{t\.ip\}:\{t\.port\}/);
});

test('E3: KISMI basari gorunur ("3 hedeften 1’i acik")', () => {
  assert.match(PANEL, /\{counts\.open\}<\/strong> \/ \{counts\.total\} hedefte açık/);
});

test('E3: "test yapilamadi" ile "kapali" AYRI gosteriliyor', () => {
  // Ikisini ayni renge boyamak kullaniciyi bir ag kurali sanip saatlerce yanlis yerde
  // aratabilirdi.
  assert.match(PANEL, /error:\s*\{ label: "TEST YAPILAMADI"/);
  assert.match(PANEL, /closed: \{ label: "KAPALI"/);
  assert.ok(!/error:.*status-danger/.test(PANEL), 'hata durumu "kapali" ile ayni renge boyanmis');
});

test('E5: AWX govdesi yalnizca YONETICIDE', () => {
  assert.match(PAGE, /\{isAdmin && \(/);
  assert.match(PAGE, /AWX'e gönderilen gövde \(yönetici\)/);
  assert.match(PAGE, /const isAdmin = user\?\.role === "Admin";/);
});

test('E6: girdi ozeti SONUC ekraninda da var', () => {
  const done = PAGE.slice(PAGE.indexOf('{step === "done"'));
  assert.match(done, /\{inputSummary\}/, 'sonuca bakan kullanici hangi namespace’lerdi sorusunu cevaplayamaz');
});

test('E7: "ayni hedeflerle tekrar" var (alti adim bastan yapilmasin)', () => {
  assert.match(PAGE, /function rerunSameTargets\(\)/);
  assert.match(PAGE, /Aynı hedeflerle tekrar/);
  assert.match(PAGE, /setStep\("telnet_input"\)/);
});

test('E8: IPTAL — is bitmeden durdurulabiliyor', () => {
  assert.match(PAGE, /async function cancelJob\(\)/);
  assert.match(PAGE, /Testi durdur/);
  assert.match(PAGE, /\{!jobDone && result\.jobId != null && \(/, 'iptal butonu bitmis iste de gorunuyor');
  assert.match(API, /cancel: \(serverId: number, jobId: number\)/);
});

test('E8: gecen sure gosteriliyor ve is bitince DURUYOR', () => {
  assert.match(PAGE, /function fmtElapsed/);
  assert.match(PAGE, /if \(jobFinished\) return;/,
    'bitmis isin suresi artmaya devam ederse ekran yalan soyler');
});

test('H1: cift tiklama korumasi busyRef ile (busy state’i yeterli DEGIL)', () => {
  // `busy` React state'i render'da yakalanir; ayni tick'teki iki tik ikisi de
  // `busy === false` gorup IKI AWX JOB'I acabilir. Telnet her job'da OCP cluster'inda
  // gecici pod actigi icin maliyeti gercek.
  assert.match(PAGE, /const busyRef = useRef\(false\);/);
  assert.match(PAGE, /if \(busyRef\.current\) return;\s*\n\s*busyRef\.current = true;/);
  assert.ok(!/async function runTelnet\(ip: string, port: string\) \{\s*\n\s*if \(busy\) return;/.test(PAGE),
    'eski state tabanli guard duruyor');
});

test('JobTracker sonucu TASIR ama YORUMLAMAZ', () => {
  // Aksi halde her yeni modul icin paylasilan context'e ozel alan eklemek gerekirdi.
  assert.match(TRACKER, /result\?: unknown;/);
  assert.match(TRACKER, /result: r\.result \?\? j\.result,/,
    'is bitmeden null donen yoklama, daha once alinmis sonucu SILMEMELI');
  assert.ok(!/TelnetResult/.test(TRACKER), 'paylasilan context modul-ozel tipe baglanmis');
});

test('playbook eski surumdeyken ekran COKMEZ', () => {
  // AWX'e kopyalama ayri bir adim; sonuc gelmeyen durum acikca ele alinmali.
  assert.match(PAGE, /İş bitti ama yapılandırılmış sonuç gelmedi\./);
  assert.match(PAGE, /AWX'e kopyalanmamış olabilir/);
});
