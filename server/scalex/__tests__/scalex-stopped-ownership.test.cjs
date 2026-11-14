// server/scalex/__tests__/scalex-stopped-ownership.test.cjs — "kendi actigini kendi ekibi gorsun".
//
// Kullanici istegi (2026-09-07): durdurulmus uygulama listesinde A'nin actigini A ve
// A'nin EKIBI gorsun, digerleri gormesin.
//
// BU BIR OPERASYON PORTALI — GORUNURLUGU DARALTMAK RISKLIDIR. Prod'da durdurulmus bir
// uygulamayi kimsenin goremedigi bir durum, portalin isini yapamamasi demektir. Bu
// yuzden uc BILINCLI istisna var ve bu bekci onlari da kilitler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { filterStoppedByOwnership } = require('../catalog.cjs');

const row = (o) => ({ stoppedBy: 'ayse', stoppedByGroups: ['CN=ekipA,OU=x'], ...o });

test('OW1 kendi kaydini GORUR', () => {
  const out = filterStoppedByOwnership([row({ stoppedBy: 'ayse' })], {
    user: { username: 'AYSE', role: 'User', groups: [] },
  });
  assert.equal(out.length, 1, 'kullanici kendi kaydini goremiyor (buyuk/kucuk harf?)');
});

test('OW2 EKIP arkadasinin kaydini GORUR', () => {
  const out = filterStoppedByOwnership(
    [row({ stoppedBy: 'ayse', stoppedByGroups: ['CN=ekipA,OU=x'] })],
    {
      // DN buyuk/kucuk harf ve bosluk acisindan kaynaga gore degisebiliyor.
      user: { username: 'mehmet', role: 'User', groups: ['  cn=ekipa,ou=x  '] },
    },
  );
  assert.equal(out.length, 1, 'ayni ekipten biri kaydi goremiyor');
});

test('OW3 BASKA ekipten biri GOREMEZ', () => {
  const out = filterStoppedByOwnership(
    [row({ stoppedBy: 'ayse', stoppedByGroups: ['CN=ekipA,OU=x'] })],
    {
      user: { username: 'veli', role: 'User', groups: ['CN=ekipB,OU=x'] },
    },
  );
  assert.equal(out.length, 0, 'baska ekipten biri kaydi goruyor — kural hic uygulanmiyor');
});

test('OW4 ADMIN her seyi gorur', () => {
  // Prod'da durdurulmus bir uygulamayi kimsenin goremedigi durum, portalin isini
  // yapamamasi demektir.
  const out = filterStoppedByOwnership(
    [row({ stoppedBy: 'ayse', stoppedByGroups: ['CN=ekipA,OU=x'] })],
    {
      user: { username: 'veli', role: 'Admin', groups: [] },
    },
  );
  assert.equal(out.length, 1, 'admin baskasinin kaydini goremiyor');
});

test('OW5 grup bilgisi YAZILMAMIS kayit GIZLENMEZ (null != bos dizi)', () => {
  // `null` = bu ozellikten ONCEKI kayit. Bilgisizligi "sana ait degil" diye
  // yorumlamak, eski kayitlarin TAMAMINI bir anda gorunmez yapardi.
  const out = filterStoppedByOwnership([row({ stoppedBy: 'ayse', stoppedByGroups: null })], {
    user: { username: 'veli', role: 'User', groups: ['CN=ekipB,OU=x'] },
  });
  assert.equal(out.length, 1, 'eski kayitlar (grup bilgisi yok) gizleniyor — veri kaybolur');

  // Bos dizi FARKLI: sahibin grubu YOK demektir, o zaman yalnizca sahibi gorur.
  const out2 = filterStoppedByOwnership([row({ stoppedBy: 'ayse', stoppedByGroups: [] })], {
    user: { username: 'veli', role: 'User', groups: ['CN=ekipB,OU=x'] },
  });
  assert.equal(out2.length, 0, 'bos dizi ile null ayni sayiliyor — ikisi AYRI seyler');
});

test('OW6 sahibi BILINMEYEN kayit GIZLENMEZ', () => {
  for (const owner of ['', null, 'bilinmiyor']) {
    const out = filterStoppedByOwnership([row({ stoppedBy: owner, stoppedByGroups: [] })], {
      user: { username: 'veli', role: 'User', groups: [] },
    });
    assert.equal(out.length, 1, `sahibi "${owner}" olan kayit gizleniyor`);
  }
});

test('OW7 uc SUZGEC AYRI: yetki kapisi ile sahiplik birlestirilmemis', () => {
  const idx = fs.readFileSync(path.join(ROOT, 'server/scalex/index.cjs'), 'utf8');
  // Ikisi de cagrilmali; birini digerinin yerine koymak, birinde yapilan bir
  // gevsemenin otekini de sessizce gevsetmesi demekti.
  assert.match(idx, /filterStoppedForUser\(/, 'yetki suzgeci kaldirilmis');
  assert.match(idx, /filterStoppedByOwnership\(/, 'sahiplik suzgeci cagrilmiyor — olu kod');
  // Sahiplik suzgeci yetki suzgecinin SONUCU uzerinde calismali.
  assert.match(
    idx.replace(/\s+/g, ' '),
    /filterStoppedByOwnership\(allowed,/,
    'sahiplik suzgeci yetki suzgecinin ciktisina uygulanmiyor',
  );
});

test('OW8 gizlenen sayisi SOYLENIYOR (gizle ama sayisini soyle)', () => {
  const idx = fs.readFileSync(path.join(ROOT, 'server/scalex/index.cjs'), 'utf8');
  assert.match(idx, /hiddenByOwnership:/, 'sahiplik yuzunden gizlenen sayisi bildirilmiyor');
});

// 2026-11-14 (uretim kaydi): `/stopped` yaniti satir basina ~60 AD grup DN'i tasiyordu; bes farkli
// kullanicinin grup uyelikleri listeyi goren herkese gidiyordu ve yanitin %97'si bu alandi.
test('OW-ISTEMCI stoppedByGroups tarayiciya gitmez; suzgec onu kullanmaya devam eder', () => {
  const { istemciSatiri } = require('../state.cjs');
  const GRUP = 'CN=ornek-ekip,OU=Gruplar,DC=ornek,DC=test';
  const satir = {
    id: 7,
    appName: 'uygulama',
    namespace: 'ns',
    stoppedBy: 'ayse',
    stoppedByGroups: [GRUP, 'CN=diger,OU=x'],
    driftStatus: 'in_sync',
    restoreAttempts: 0,
  };
  const giden = istemciSatiri(satir);
  assert.ok(!('stoppedByGroups' in giden));
  assert.ok(!JSON.stringify(giden).includes('CN='));
  // Diger alanlar AYNEN (arayuz stoppedBy, driftStatus vb. gosteriyor).
  const { stoppedByGroups: _g, ...beklenen } = satir;
  assert.deepEqual(giden, beklenen);
  // Girdi DEGISMEZ: sunucudaki suzgec ayni satiri sonra da okuyabilir.
  assert.deepEqual(satir.stoppedByGroups, [GRUP, 'CN=diger,OU=x']);
  // `null` (grup bilgisi yazilmamis eski kayit) da gitmez.
  assert.ok(!('stoppedByGroups' in istemciSatiri({ id: 1, stoppedByGroups: null })));

  // Rota: once SAHIPLIK SUZGECI (grup bilgisiyle), sonra alan cikarilir.
  const rota = fs.readFileSync(path.join(ROOT, 'server', 'scalex', 'index.cjs'), 'utf8');
  const i = rota.indexOf("'/stopped',");
  const govde = rota.slice(i, rota.indexOf("router.post(\n    '/adopt'", i));
  assert.ok(i > 0 && govde.length > 500, '/stopped rotasi bulunamadi');
  assert.match(govde, /items: rows\.map\(state\.istemciSatiri\),/);
  assert.doesNotMatch(govde, /items: rows,/);
  assert.ok(
    govde.indexOf('filterStoppedByOwnership(allowed') < govde.indexOf('rows.map(state.istemciSatiri)'),
    'alan suzgecten ONCE cikarilirsa sahiplik suzgeci kor kalir',
  );
  // Ekibin kaydini gorme kurali alan cikarildiktan sonra da gecerli (suzgec ham satirla calisir).
  const gorunen = filterStoppedByOwnership([row({ stoppedBy: 'ayse', stoppedByGroups: [GRUP] })], {
    user: { username: 'mehmet', role: 'User', groups: [GRUP] },
  }).map(istemciSatiri);
  assert.equal(gorunen.length, 1);
  assert.ok(!('stoppedByGroups' in gorunen[0]));
});
