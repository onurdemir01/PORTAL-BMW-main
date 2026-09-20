// server/oco/__tests__/oco-schedule-visibility.test.cjs
//
// ZAMANLANMIS OCO TETIKLEMELERI: gorunurluk, iptal, guncelleme.
//
// Kullanicinin istegi: "self service gibi zamanlama da sunsun ama istedigi
// zamanda iptal edebilsin user ve admin — user sadece kendininkileri gorsun ve
// iptal edebilsin ve onun grubu, ve bu her noktada iptal edilsin ya da
// guncellemek isterse guncellesin."
//
// EN TEHLIKELI HATA SINIFI BURADA GORUNURLUK: fazla gosteren bir suzgec,
// baskasinin KESINTI kaydini sizdirir. Bu yuzden kesisim SQL'de LIKE ile degil
// uygulamada TAM ESLESME ile yapiliyor — "GT-MW" aramasi "GT-MW-ADMIN"i de
// yakalardi ve kimse fark etmezdi.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const store = require('../store.cjs');
const IX = fs.readFileSync(path.join(__dirname, '..', '..', 'scalex', 'index.cjs'), 'utf8');
const CG = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'change-gates.cjs'), 'utf8');
const SETUP = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');

test('OS1 grup kesisimi TAM ESLESME (alt-dize tuzagi yok)', () => {
  const k = store.gruplarKesisiyor;
  assert.equal(k(['GT-MW'], ['GT-MW']), true);
  assert.equal(k(['gt-mw'], ['GT-MW']), true, 'harf duyarli kalmis');
  // ALT-DIZE TUZAGI: LIKE ile yapilsaydi bu true donerdi ve kullanici
  // BASKASININ kesinti kaydini gorurdu.
  assert.equal(k(['GT-MW'], ['GT-MW-ADMIN']), false, 'alt-dize eslesmesi SIZDIRIYOR');
  assert.equal(k(['GT-MW-ADMIN'], ['GT-MW']), false);
  // Bos / bilinmeyen
  assert.equal(k([], ['GT-MW']), false);
  assert.equal(k(null, ['GT-MW']), false);
  assert.equal(k(['GT-MW'], null), false);
});

test('OS2 `canManage`: sahip / grup / admin — baskasi HAYIR', () => {
  const rec = { username: 'ahmet', ownerGroups: ['GT-MW'] };
  assert.equal(store.canManage(rec, { username: 'ahmet', groups: [], role: 'User' }), true, 'sahip yonetemiyor');
  assert.equal(store.canManage(rec, { username: 'AHMET', groups: [], role: 'User' }), true, 'kullanici adi harf duyarli');
  assert.equal(store.canManage(rec, { username: 'mehmet', groups: ['GT-MW'], role: 'User' }), true, 'grup uyesi yonetemiyor');
  assert.equal(store.canManage(rec, { username: 'mehmet', groups: ['BASKA'], role: 'User' }), false, 'YABANCI yonetebiliyor — SIZINTI');
  assert.equal(store.canManage(rec, { username: 'mehmet', groups: [], role: 'Admin' }), true, 'admin yonetemiyor');
});

test('OS3 ESKI KAYIT (ownerGroups null) grup uzerinden GORUNMEZ', () => {
  // "Bilmiyoruz"u "senin grubun" saymak, baskasinin kesinti kaydini gostermek
  // olurdu. `scalex_state_mirror.stopped_by_groups` ile ayni ayrim.
  const eski = { username: 'ahmet', ownerGroups: null };
  assert.equal(store.canManage(eski, { username: 'mehmet', groups: ['GT-MW'], role: 'User' }), false);
  // Sahibi yine gorur.
  assert.equal(store.canManage(eski, { username: 'ahmet', groups: [], role: 'User' }), true);
});

test('OS4 `owner_groups` HEM CREATE HEM ALTER listesinde', () => {
  // Yalniz `CREATE TABLE`a yazmak mevcut kurulumlarda kolonu HIC olusturmaz ve
  // sorgular sessizce patlar — bu depoda defalarca yasanmis bir sinif.
  assert.match(SETUP, /owner_groups\s+NVARCHAR\(MAX\) NULL/, 'CREATE TABLE`da yok');
  assert.match(
    SETUP,
    /col: 'owner_groups'[\s\S]{0,200}ALTER TABLE oco_scheduled_launches ADD owner_groups/,
    'ALTER listesinde YOK — mevcut kurulumlarda kolon olusmaz',
  );
});

test('OS5 guncelleme YALNIZCA beklemedeki kayda (tetiklenmisi ezmez)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'store.cjs'), 'utf8');
  const govde = src.slice(src.indexOf('async function update('), src.indexOf('async function cancelBy('));
  assert.match(govde, /WHERE id = \$1 AND status = 'SCHEDULED'/, 'kosulsuz UPDATE — tetiklenmis isi ezer');
  assert.match(govde, /OUTPUT INSERTED\.\*/, 'etkilenen satir dondurulmuyor — cagiran basarisizligi GOREMEZ');
});

test('OS6 iptal SESSIZCE "oldu" demiyor (kosullu UPDATE + 409)', () => {
  const govde = IX.slice(IX.indexOf("'/oco-schedules/:id/cancel'"), IX.indexOf("'/oco-schedules/:id/update'"));
  assert.match(govde, /if \(!iptal\)/, 'kosullu UPDATE sonucu kontrol edilmiyor');
  assert.match(govde, /409/, 'iptal edilemedigi halde basarili donuyor');
  assert.match(govde, /cancelledBy: u\.username/, 'iptal EDEN kaydedilmiyor');
});

test('OS7 yetkisiz erisim DENETIME yaziliyor', () => {
  const govde = IX.slice(IX.indexOf("'/oco-schedules'"), IX.indexOf("'/admin/oco-diagnose'"));
  assert.match(govde, /scalex_oco_schedule_forbidden/, '403 iz birakmiyor');
  // Iki ucta da (iptal + guncelleme).
  const kez = (govde.match(/scalex_oco_schedule_forbidden/g) || []).length;
  assert.equal(kez, 2, `yetki reddi ${kez} yerde denetime yaziliyor, 2 olmali`);
});

test('OS8 numara DEGISTIRILIRSE yeniden DOGRULANIYOR', () => {
  // Numara degistirip pencereyi eski kayittan devam ettirmek, DOGRULANMAMIS bir
  // OCO ile is baslatmak olurdu.
  const govde = IX.slice(IX.indexOf("'/oco-schedules/:id/update'"), IX.indexOf("'/admin/oco-diagnose'"));
  assert.match(govde, /getChangeOrder\(yeniNumara\)/, 'yeni numara dogrulanmiyor');
  assert.match(govde, /evaluateWindow/, 'yeni pencere hesaplanmiyor');
  assert.match(govde, /ocoExpired/, 'suresi gecmis numara kabul ediliyor');
  assert.match(govde, /runAt: w\.windowStart/, 'pencere ESKI kayittan devam ediyor');
});

test('OS9 ScaleX PORTAL zamanlayicisini kullaniyor (AWX-native DEGIL)', () => {
  const govde = IX.slice(IX.indexOf('async function runScaleXGates'), IX.indexOf('// ── GERI ALMA KILIDI'));
  assert.match(govde, /preferPortalScheduler: true/, 'AWX-native zamanlamaya dusuyor — guncelleme yapilamaz');
  assert.match(govde, /ownerGroups:/, 'grup bilgisi kayda GECMIYOR — gorunurluk calismaz');
  // `ocoAction` artik SABIT DEGIL: kullanicinin secimi geliyor.
  assert.ok(!/ocoAction: 'later',/.test(govde), '`ocoAction` hala sabit — zamanlama secenegi sunulamaz');
  assert.match(govde, /ocoAction === 'schedule' \? 'schedule' : 'later'/, 'kullanici secimi gecirilmiyor');
});

test('OS10 ortak kapi `preferPortalScheduler`i KARAR NOKTASINDA kullaniyor', () => {
  const govde = CG.slice(CG.indexOf('const smartAlsoRequired'), CG.indexOf("phase === 'inside'"));
  assert.match(
    govde,
    /if \(!smartAlsoRequired && !preferPortalScheduler\)/,
    '`preferPortalScheduler` AWX-native dalini engellemiyor',
  );
  // Portal dalinda gruplar saklanmali.
  const portalDal = CG.slice(CG.indexOf('const rec = await ocoStore.create('), CG.indexOf('selfservice_oco_scheduled'));
  assert.match(portalDal, /ownerGroups/, 'portal kaydinda grup bilgisi YOK');
});
