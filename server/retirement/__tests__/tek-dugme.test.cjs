// server/retirement/__tests__/tek-dugme.test.cjs — TD1..TD8 (2026-10-08).
//
// Kullanici istekleri (ayni gun):
//   - "plan ve akis butonlari bir garip" -> tek dugmeli akis (on kontrol -> onay); sunucu
//     kapilari burada, ekran mantigi src/components/server_hub/__tests__/retirement-adim.test.ts
//   - "admin olarak bekleme asamasinin duzgun calistigini anlayabilmek icin direkt tetikleme
//     asamasina gecmek istiyorum" -> /delete-now: tarihi BUGUNE ceker, DELETE'i zamanlayici baslatir
//   - "GBSVCVOICEORDER'in Apache konfigurasyonu olmasina ragmen kesfedememis" -> Server Hub
//     ikinci web kaynagi, SIKI eslesme
//   - "uygulama ismi soneksiz listelendigi icin hangi ortamin silindigini anlayamayacak" ->
//     listede ortam kirilimi
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const { buildTargets } = require('../discover.cjs');

const ucDilimi = (bas, son) => {
  const i = IDX.indexOf(bas);
  assert.ok(i > 0, `uc bulunamadi: ${bas}`);
  const j = IDX.indexOf(son, i + bas.length);
  return IDX.slice(i, j > i ? j : undefined);
};

test('TD1 onayli STOP YALNIZ on kontrolu basariyla donmus hedefte (kapi ekranda degil SUNUCUDA)', () => {
  const ep = ucDilimi("router.post('/:id/targets/:tid/stop'", "router.post('/:id/targets/:tid/rollback'");
  const kapi = ep.indexOf("if (confirmed && t.status !== 'planned')");
  assert.ok(kapi > 0, "onayli STOP 'planned' sartina bagli degil - dogrudan istek on kontrolu atlar");
  assert.ok(kapi < ep.indexOf('await launch('), 'kapi is baslatildiktan SONRA - ise yaramaz');
  assert.ok(kapi < ep.indexOf('ocoClient.getChangeOrder'), 'kapi OCO zamanlamasindan sonra - zamanlama kapisiz yazilabilir');
});

test('TD2 ZAMANLANMIS hedefte on kontrol REDDEDILIR (zamanlanmis STOP sessizce duserdi)', () => {
  const ep = ucDilimi("router.post('/:id/targets/:tid/stop'", "router.post('/:id/targets/:tid/rollback'");
  const kapi = ep.indexOf("if (!confirmed && t.status === 'stop_scheduled')");
  assert.ok(kapi > 0, "stop_scheduled hedefte on kontrol reddedilmiyor");
  assert.ok(kapi < ep.indexOf("status = $1, last_job_id"), "red, hedefi 'planning'e ceken yazimdan SONRA");
  // gecis durumunda ikinci is de yok
  assert.match(ep, /\['planning', 'stopping', 'deleting', 'rolling_back'\]\.includes\(t\.status\)/);
});

test('TD3 /delete-now DELETE BASLATMAZ; yalniz tarihi bugune ceker (bekleme yolu sinanir)', () => {
  const ep = ucDilimi("router.post('/:id/delete-now'", "router.post('/:id/note'");
  assert.ok(!/launch\(|_launch\(|deleteTick\(/.test(ep), 'uc DELETE isini kendisi baslatiyor - zamanlayici yolu atlanir');
  assert.match(ep, /SET planned_delete_at = GETUTCDATE\(\)/, 'silme tarihi bugune cekilmiyor');
  // 23:00 kurali (schedule.cjs madde 3) bu bayrakla atlanir; yazilmazsa admin gece
  // 23:00'e kadar bekler ama ekran "ilk turda baslar" der.
  assert.match(ep, /delete_now_at = GETUTCDATE\(\)/, "beklemeyi atla delete_now_at'i doldurmuyor - 23:00 beklenir");
  assert.match(ep, /status NOT IN \('cancelled', 'deleted'\)/, 'iptal edilmis kayitta da tarih cekilebiliyor');
});

test('TD4 /delete-now onaysiz ve hazir hedefsiz CALISMAZ; onceki tarih olaya yazilir', () => {
  const ep = ucDilimi("router.post('/:id/delete-now'", "router.post('/:id/note'");
  const ad = ep.indexOf("String(req.body?.confirmApp ?? '').trim() !== rec.app");
  const hazir = ep.indexOf("t.status === 'stopped' && !t.deletedAt");
  const yazim = ep.indexOf('UPDATE retirement_records');
  assert.ok(ad > 0, 'uygulama adi onayi yok - yanlis kayitta tek tikla silme tetiklenir');
  assert.ok(hazir > 0, 'durdurulmus hedef kontrolu yok');
  assert.ok(ad < yazim && hazir < yazim, 'kontroller yazimdan SONRA');
  assert.match(ep, /silme tarihi \$\{onceki \|\| 'belirsiz'\} -> bugun/, 'onceki tarih olaya yazilmiyor ("acan belirledi" kaybolur)');
});

test('TD9 ADMIN icin OCO SAAT kisiti yok; OCO numarasi ve kaydin gecerliligi YINE zorunlu', () => {
  // Kullanici (2026-10-08): "Application Retirement'ta Admin'lere OCO kontrolunun saat
  // kisitlamasini kaldirir misin?"
  const ep = ucDilimi("router.post('/:id/targets/:tid/stop'", "router.post('/:id/targets/:tid/rollback'");
  const oco = ep.slice(ep.indexOf("if (confirmed && t.env === 'PROD' && rec.ocoNo)"));
  assert.match(ep, /if \(t\.env === 'PROD' && !rec\.ocoNo\)/, 'PROD hedefte OCO numarasi artik zorunlu degil');
  const gecersiz = oco.indexOf('if (!w.ok) return res.status(400)');
  const admin = oco.indexOf('const adminSaatsiz = isAdmin(req)');
  assert.ok(gecersiz > 0 && admin > gecersiz, 'bozuk OCO kaydi admin icin de reddedilmeli (gecerlilik kontrolu admin dalindan ONCE)');
  // Saat kurallari yalniz Admin DISI icin
  assert.match(oco, /if \(!adminSaatsiz && plan\.mode === 'none'\)/, 'kapanmis pencere admin icin de reddediliyor ya da kural tumden kalkti');
  assert.match(oco, /if \(!adminSaatsiz && plan\.mode === 'schedule'\)/, 'admin isi pencereye zamanlaniyor ya da kural tumden kalkti');
  // Pencere disi admin kosusu iz birakir ve "kostu" degil "baslatiliyor" der (launch dusebilir)
  assert.match(oco, /'oco_saatsiz'/, 'pencere disi admin kosusu olaya yazilmiyor');
  assert.match(oco, /STOP simdi baslatiliyor/);
  assert.ok(!/is simdi kostu/.test(oco), 'olay, baslamamis isi "kostu" diye yaziyor');
});

test('TD10 on kontrol web sunucularinda Server Hub taramasi baslatir; DUSERSE on kontrol DUSMEZ', () => {
  // Kullanici (2026-10-08): "uygulama stop edilmeden once plan asamasinda Apache loglarini
  // okuyabilir miyiz?"
  assert.match(IDX, /const TRAFIK_REGISTRY_KEY = 'server_hub_scan'/);
  const ep = ucDilimi("router.post('/:id/targets/:tid/stop'", "router.post('/:id/targets/:tid/rollback'");
  const blok = ep.slice(ep.indexOf('let trafikTarama = null;'), ep.indexOf('res.json({ ok: true, ...r, planOnly'));
  assert.ok(blok.length > 100, 'trafik taramasi blogu yok');
  assert.match(blok, /if \(!confirmed\) \{/, 'tarama onayli STOP\'ta da baslatiliyor (yalniz on kontrolde olmali)');
  // Yalniz WEB sunuculari (t.web), JBoss hedefi degil
  assert.match(blok, /\(t\.web \|\| \[\]\)\.map\(\(w\) => String\(w\.host/, 'tarama web sunucularini hedeflemiyor');
  assert.match(blok, /\{ target_hosts: webHosts\.join\(','\) \}/);
  assert.match(blok, /TRAFIK_REGISTRY_KEY\)/);
  // Hata yutulmaz ama on kontrolu de dusurmez: try/catch + olay + yanitta sebep
  assert.match(blok, /\} catch \(e\) \{\s*trafikTarama = \{ ok: false/, 'tarama hatasi on kontrolu dusuruyor ya da sessiz');
  assert.match(ep, /res\.json\(\{ ok: true, \.\.\.r, planOnly: !confirmed, trafikTarama,/, 'sonuc ekrana tasinmiyor');
  // Tarama isi hedefe yazilmaz: job-status yalniz hedefin KENDI isini sonuclandirir
  assert.match(IDX, /Number\(row\.last_job_id\) === jobId/, 'job-status baska bir isi hedefe yazabilir');
});

// ── Server Hub ikinci web kaynagi ───────────────────────────────────────────────────
const INV = [
  { app: 'GBSVCVOICEORDER-D', host: 'GBJBOT07', jboss_version: '7' },
  { app: 'GBSVCVOICEORDER-T', host: 'GBJBOT07', jboss_version: '7' },
  { app: 'GBSVCVOICEORDER', host: 'GBJBOP11', jboss_version: '7' },
];
const V = (host, sn, port, conf, extra = {}) => ({ host, server_name: sn, listen: `*:${port}`, conf_file: conf, product: 'IHS', ...extra });
const HUB = [
  V('GBJBOT07', 'gbsvcvoiceorder-d.fw.garanti.com.tr', 443, '/c/d.conf'),
  V('GBJBOT07', 'gbsvcvoiceorder-d.fw.garanti.com.tr', 80, '/c/d.conf'),
  V('GBJBOT07', 'gbsvcvoiceorder-t.fw.garanti.com.tr', 443, '/c/t.conf'),
  V('GBJBOT07', 'gbsvcvoiceorder-dx.fw.garanti.com.tr', 443, '/c/dx.conf'),
  V('GBJBOP11', 'gbsvcvoiceorder.fw.garanti.com.tr', 443, '/c/p.conf'),
  V('GBJBOP11', 'gbsvcvoiceorder-d.fw.garanti.com.tr', 443, '/c/x.conf'),
];
const hedef = (out, app) => out.targets.find((t) => t.appName === app);

test('TD5 sertifika envanterinde YOK ama Server Hub goruyor -> vhost bulunur (port basina)', () => {
  const out = buildTargets('GBSVCVOICEORDER', INV, [], [], HUB);
  const d = hedef(out, 'GBSVCVOICEORDER-D');
  assert.deepEqual(d.web.map((w) => `${w.serverName}:${w.port}`).sort(),
    ['gbsvcvoiceorder-d.fw.garanti.com.tr:443', 'gbsvcvoiceorder-d.fw.garanti.com.tr:80'],
    'ayni conf\'taki :80 blogu kayboldu ya da yanlis vhost geldi');
  assert.match(d.webHow, /Server Hub .*sertifika envanterinde yok/, 'kaynak ekranda soylenmiyor');
});

test('TD6 SIKI eslesme: -d retire edilirken KARDES ortamin (-t) ve benzer adin (-dx) vhost\'u ALINMAZ', () => {
  const out = buildTargets('GBSVCVOICEORDER', INV, [], [], HUB);
  const d = hedef(out, 'GBSVCVOICEORDER-D').web.map((w) => w.serverName);
  assert.ok(!d.some((s) => s.startsWith('gbsvcvoiceorder-t')), '-t vhost\'u -d\'ye baglandi - calisan ortam kapatilirdi');
  assert.ok(!d.some((s) => s.startsWith('gbsvcvoiceorder-dx')), 'onek eslemesi -dx\'i yakaladi');
  // PROD (soneksiz) uygulama -d vhost'unu yakalamaz ("iceriyor" eslemesi yakalardi)
  const p = hedef(out, 'GBSVCVOICEORDER').web.map((w) => w.serverName);
  assert.deepEqual(p, ['gbsvcvoiceorder.fw.garanti.com.tr']);
});

test('TD7 sertifika envanteri eslerse ONCELIK onda; Server Hub yalniz yedek', () => {
  const cert = [{ host: 'GBJBOT07', ip: '', port: '8443', server_name: 'gbsvcvoiceorder-d.fw.garanti.com.tr', conf_file: '/cert/d.conf', product: 'IHS', env: '' }];
  const out = buildTargets('GBSVCVOICEORDER', INV, cert, [], HUB);
  const d = hedef(out, 'GBSVCVOICEORDER-D');
  assert.ok(!/Server Hub/.test(d.webHow), 'sertifika eslesmesine ragmen Server Hub kullanildi');
  assert.deepEqual(d.web.map((w) => w.confFile), ['/cert/d.conf']);
});

test('TD8 liste ortam kirilimi TEK sorgu (kayit basina sorgu yok) ve PROD ayrisir', () => {
  const ep = ucDilimi("router.get('/', async", "router.get('/:id'");
  assert.equal((ep.match(/FROM retirement_targets`\)/g) || []).length, 1, 'ortam sorgusu yok ya da birden cok');
  assert.ok(!/for \(const [a-z]+ of r\.rows[\s\S]{0,200}await db\(\)\.query/.test(ep), 'kayit basina sorgu (N+1)');
  assert.match(ep, /envs: envsOf\(x\.id\)/, 'liste satirina ortam kirilimi eklenmiyor');
});
