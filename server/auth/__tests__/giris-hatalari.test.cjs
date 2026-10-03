// server/auth/__tests__/giris-hatalari.test.cjs
//
// GIRIS HATALARI VE GERI CEKILME (Faz C, 2026-10-02).
//
//   GH1 AD bind kodlari ayri mesajlara cevrilir; "kullanici yok" ile "sifre yanlis" AYRILMAZ
//   GH2 LDAP'a ulasilamiyor + yerel eslesme yok -> 503 (eskiden "sifre hatali" 401)
//   GH3 dizin tarafinda beklenmeyen hata -> 503, "sifre hatali" DEGIL
//   GH4 kullanici bind'inde baglanti kopmasi kimlik hatasi SAYILMAZ
//   GH5 yerel hesap harf duyarsiz
//   GT1 esik: 5. hatada 30 sn; sonra ustel (2 dk, 8 dk), en fazla 15 dk; basari sifirlar
//   GT2 pencere: son hatadan 15 dk sonra sayac unutulur
//   GT3 bellek sinirli (10.000)
//   GT4 esik Admin'den (env) dinamik; sinir disi deger varsayilana duser
//   GH6 HTTP: esik asilinca 429 + Retry-After ve AD'ye HIC GIDILMEZ (AD kilidi korunur)
//   GH7 HTTP: farkli kullanicilar ayni IP'den birbirini kilitlemez; KURUM\ad ve ad ayni sayac
//   GH8 HTTP: 503 / kilitli hesap deneme hakkini yemez; 400 girdi hatasi AD'ye gitmez
//   GT5 ayni hatali sifre 90 sn icinde taninir; sifrenin kendisi SAKLANMAZ
//   GH10 HTTP: AYNI hatali sifre AD'ye yalnizca BIR kez gider (AD kilit esigi bilinmeden
//        hesaplari korur), sayaca yazilmaz; dogru sifre hemen calisir
'use strict';

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_STORE = 'memory';
process.env.LDAP_URL = 'ldaps://sahte';
process.env.LDAP_BASE_DN = 'dc=kurum';
process.env.LDAP_BIND_DN = 'cn=svc';
process.env.LOCAL_ADMIN_USER = 'yereladmin';
process.env.LOCAL_ADMIN_PASS = 'Guclu-Admin-456!';
process.env.LOCAL_USER = 'yereluser';
process.env.LOCAL_USER_PASS = 'Guclu-Sifre-123!';

const db = require('../../db/index.cjs');
db.query = async () => ({ rows: [], rowCount: 0 });

const ldap = require('../ldap.cjs');
const throttle = require('../login-throttle.cjs');
const express = require('express');
const { initAuth } = require('../index.cjs');

const DK = 60 * 1000;
let simdi = Date.UTC(2026, 9, 2, 8, 0, 0);
throttle._saatAyarla(() => simdi);

// AD davranisi sahte: { kullanici: sifre }; ozel durumlar ayrica.
let adDavranisi;
let adCagrisi;
const gercekLdap = ldap.authenticateLdap;
ldap.authenticateLdap = async (username, password, lookup) => {
  adCagrisi.push({ username, lookup });
  return adDavranisi(username, password, lookup);
};
function adKullanicilari(tablo) {
  return async (username, password) => {
    if (!(username in tablo)) throw new Error('ldap_user_not_found');
    if (tablo[username] !== password) throw ldap.adHatasi(new Error('80090308: LdapErr: DSID-0C09044E, comment: AcceptSecurityContext error, data 52e, v4563'));
    return { username, role: 'User', displayName: username, mail: '', authSource: 'ldap', groups: [] };
  };
}

const app = express();
initAuth(app);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  ldap.authenticateLdap = gercekLdap;
});

beforeEach(() => {
  throttle._sifirla();
  delete process.env.LOGIN_USER_MAX_FAILS;
  simdi = Date.UTC(2026, 9, 2, 8, 0, 0);
  adCagrisi = [];
  adDavranisi = adKullanicilari({ ayse: 'dogru', mehmet: 'dogru2' });
});

async function giris(username, password) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: r.status, retryAfterBaslik: r.headers.get('retry-after'), body: await r.json() };
}

test('GH1 AD bind kodlari ayri mesajlara cevrilir', () => {
  const e = (kod) => ldap.adHatasi(new Error(`AcceptSecurityContext error, data ${kod}, v4563`));
  assert.equal(e('52e').code, 'kimlik');
  assert.equal(e('52e').status, 401);
  assert.equal(e('525').code, 'kimlik', 'kullanici yok ayri soylenmemeli (numaralandirma)');
  assert.equal(e('525').message, e('52e').message);
  assert.equal(e('775').code, 'kilitli');
  assert.match(e('775').message, /kilitli/);
  assert.equal(e('533').code, 'devre_disi');
  assert.equal(e('701').code, 'hesap_suresi');
  assert.equal(e('532').code, 'sifre_suresi');
  assert.equal(e('773').code, 'sifre_degismeli');
  assert.equal(e('775').status, 403);
  // Kod yoksa / tanimsizsa guvenli varsayilan: kimlik.
  assert.equal(ldap.adHatasi(new Error('Invalid Credentials')).code, 'kimlik');
  assert.equal(e('999').code, 'kimlik');
});

test('GH2 LDAP erisilemez + yerel eslesme yok -> 503', async () => {
  adDavranisi = async () => {
    const err = new Error('connect ECONNREFUSED 10.0.0.1:636');
    err.code = 'ECONNREFUSED';
    throw err;
  };
  const r = await giris('ayse', 'dogru');
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'ldap_erisilemez');
  assert.doesNotMatch(r.body.error, /şifre hatalı/);
  // Yerel hesap yine calisir (mevcut davranis).
  const y = await giris('yereladmin', 'Guclu-Admin-456!');
  assert.equal(y.status, 200);
});

test('GH3 dizin tarafinda beklenmeyen hata -> 503, sifre hatali DEGIL', async () => {
  adDavranisi = async () => {
    throw new Error('Size Limit Exceeded');
  };
  const r = await giris('ayse', 'dogru');
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'dizin_hatasi');
});

test('GH4 kullanici bind`inde baglanti kopmasi kimlik hatasi sayilmaz', async () => {
  adDavranisi = async () => {
    const err = new Error('read ECONNRESET');
    err.code = 'ECONNRESET';
    throw err;
  };
  for (let i = 0; i < 8; i++) assert.equal((await giris('ayse', 'dogru')).status, 503);
  assert.equal(throttle.kontrol('ayse').ok, true, 'ag hatasi deneme hakkini yedi');
});

test('GH5 yerel hesap harf duyarsiz', async () => {
  const r = await giris('YerelAdmin', 'Guclu-Admin-456!');
  assert.equal(r.status, 200);
  assert.equal(r.body.username, 'yereladmin');
  assert.equal(adCagrisi.length, 0, 'yerel hesap LDAP`a gitti');
});

test('GT1 esik ve ustel bekleme; basari sifirlar', () => {
  for (let i = 1; i <= 4; i++) assert.equal(throttle.hataKaydet('u').retryAfter, 0, `${i}. hatada kilit`);
  assert.equal(throttle.kontrol('u').ok, true);
  assert.equal(throttle.hataKaydet('u').retryAfter, 30);
  assert.deepEqual(throttle.kontrol('u'), { ok: false, retryAfter: 30 });
  simdi += 29 * 1000;
  assert.equal(throttle.kontrol('u').ok, false, 'bekleme 1 sn erken bitti');
  simdi += 1000;
  assert.equal(throttle.kontrol('u').ok, true);
  assert.equal(throttle.hataKaydet('u').retryAfter, 120);
  simdi += 120 * 1000;
  assert.equal(throttle.hataKaydet('u').retryAfter, 480);
  simdi += 480 * 1000;
  assert.equal(throttle.hataKaydet('u').retryAfter, 900, '15 dk ust siniri asildi');
  simdi += 900 * 1000;
  throttle.basariKaydet('u');
  assert.equal(throttle.hataKaydet('u').retryAfter, 0, 'basari sayaci sifirlamadi');
});

test('GT2 son hatadan 15 dk sonra sayac unutulur', () => {
  for (let i = 0; i < 4; i++) throttle.hataKaydet('u');
  simdi += 15 * DK;
  assert.equal(throttle.hataKaydet('u').fails, 1);
  for (let i = 0; i < 3; i++) throttle.hataKaydet('u');
  simdi += 15 * DK - 1000;
  assert.equal(throttle.hataKaydet('u').fails, 5, 'pencere erken kapandi');
});

test('GT3 bellek sinirli', () => {
  for (let i = 0; i < throttle.KAYIT_UST + 50; i++) throttle.hataKaydet(`k${i}`);
  assert.ok(throttle._kayitlar.size <= throttle.KAYIT_UST, `kayit sayisi ${throttle._kayitlar.size}`);
  simdi += 16 * DK;
  throttle.hataKaydet('yeni');
  assert.equal(throttle._kayitlar.size, 1, 'bayat kayitlar budanmadi');
});

test('GT4 esik dinamik; sinir disi varsayilana duser', () => {
  process.env.LOGIN_USER_MAX_FAILS = '3';
  throttle.hataKaydet('u');
  throttle.hataKaydet('u');
  assert.equal(throttle.hataKaydet('u').retryAfter, 30);
  process.env.LOGIN_USER_MAX_FAILS = '1';
  assert.equal(throttle.esik(), 5);
  process.env.LOGIN_USER_MAX_FAILS = 'abc';
  assert.equal(throttle.esik(), 5);
  process.env.LOGIN_USER_MAX_FAILS = '20';
  assert.equal(throttle.esik(), 20);
});

test('GH6 HTTP: esik asilinca 429 + Retry-After ve AD`ye hic gidilmez', async () => {
  for (let i = 1; i <= 3; i++) {
    const r = await giris('ayse', `yanlis-${i}`);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'kimlik');
  }
  const d4 = await giris('ayse', 'yanlis-4');
  assert.match(d4.body.error, /1 deneme hakkınız kaldı/);
  const d5 = await giris('ayse', 'yanlis-5');
  assert.equal(d5.body.retryAfter, 30);
  assert.equal(d5.retryAfterBaslik, '30');
  const adOnce = adCagrisi.length;
  const kilitli = await giris('ayse', 'dogru');
  assert.equal(kilitli.status, 429);
  assert.equal(kilitli.body.retryAfter, 30);
  assert.equal(kilitli.retryAfterBaslik, '30');
  assert.equal(adCagrisi.length, adOnce, 'kilitliyken AD`ye gidildi — AD kilidine dogru ilerler');
  simdi += 30 * 1000;
  assert.equal((await giris('ayse', 'dogru')).status, 200);
});

test('GH7 HTTP: ayni IP`deki farkli kullanicilar birbirini kilitlemez; KURUM\\ad ve ad ayni sayac', async () => {
  for (let i = 0; i < 5; i++) await giris('ayse', `yanlis-${i}`);
  assert.equal((await giris('ayse', 'dogru')).status, 429);
  assert.equal((await giris('mehmet', 'dogru2')).status, 200, 'baska kullanici kilitlendi');
  assert.equal((await giris('KURUM\\Ayse', 'dogru')).status, 429, 'alan adli yazim sayaci atlatti');
  assert.equal((await giris('AYSE', 'dogru')).status, 429, 'buyuk harf sayaci atlatti');
});

test('GH8 HTTP: 503 / kilitli hesap hak yemez; girdi hatasi AD`ye gitmez', async () => {
  adDavranisi = async () => {
    throw ldap.adHatasi(new Error('data 775'));
  };
  for (let i = 0; i < 7; i++) {
    const r = await giris('ayse', 'x');
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'kilitli');
  }
  assert.equal(throttle.kontrol('ayse').ok, true);
  const once = adCagrisi.length;
  const r = await giris('ayse yilmaz', 'x');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'gecersiz');
  assert.equal((await giris('ayse', '')).status, 400);
  assert.equal(adCagrisi.length, once);
});

test('GH9 HTTP: UPN girildiyse userPrincipalName ile aranir, sifre kirpilmadan gider', async () => {
  let gelenSifre;
  adDavranisi = async (u, p, lookup) => {
    gelenSifre = p;
    assert.deepEqual(lookup, { attr: 'userPrincipalName', value: 'ayse@kurum.com' });
    return { username: 'ayse', role: 'User', displayName: 'A', mail: '', authSource: 'ldap', groups: [] };
  };
  const r = await giris('Ayse@Kurum.com', ' bosluklu ');
  assert.equal(r.status, 200);
  assert.equal(gelenSifre, ' bosluklu ');
});

test('GT5 ayni hatali sifre pencere icinde taninir; sifre saklanmaz', () => {
  throttle.hataKaydet('Ayse', 'EskiSifre!1');
  assert.equal(throttle.ayniHataliSifre('ayse', 'EskiSifre!1'), 90, 'ayni hatali sifre taninmadi');
  assert.equal(throttle.ayniHataliSifre('ayse', 'EskiSifre!2'), 0, 'FARKLI sifre "ayni" sayildi — dogru sifre de reddedilirdi');
  assert.equal(throttle.ayniHataliSifre('veli', 'EskiSifre!1'), 0, 'baska kullanicinin sifresi eslesti');
  assert.equal(throttle.ayniHataliSifre('hic-yok', 'x'), 0);
  // Bellekteki kayit sifreyi DUZ tasimaz.
  const kayit = throttle._kayitlar.get('ayse');
  assert.ok(!JSON.stringify({ ...kayit, sonOzet: kayit.sonOzet.toString('latin1') }).includes('EskiSifre'), 'sifre bellekte duz duruyor');
  assert.equal(kayit.sonOzet.length, 32);
  // Pencere: 1 sn kala hala taninir, dolunca AD'ye yeniden gidilebilir.
  simdi += 89 * 1000;
  assert.equal(throttle.ayniHataliSifre('ayse', 'EskiSifre!1'), 1);
  simdi += 1000;
  assert.equal(throttle.ayniHataliSifre('ayse', 'EskiSifre!1'), 0, 'pencere dolmasina ragmen hala engelli');
  // Basarili giris kaydi siler.
  throttle.hataKaydet('ayse', 'x');
  throttle.basariKaydet('ayse');
  assert.equal(throttle.ayniHataliSifre('ayse', 'x'), 0);
});

test('GH10 HTTP: ayni hatali sifre AD`ye bir kez gider, sayaca yazilmaz; dogru sifre hemen calisir', async () => {
  const ilk = await giris('ayse', 'eski-sifrem');
  assert.equal(ilk.status, 401);
  assert.equal(ilk.body.code, 'kimlik');
  assert.equal(adCagrisi.length, 1);
  // Kullanici ayni sifreyi 7 kez daha dener (tarayici hatirliyor, cift tiklama...).
  for (let i = 0; i < 7; i++) {
    const r = await giris('ayse', 'eski-sifrem');
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'kimlik_tekrar');
    assert.match(r.body.error, /yeniden gönderilmedi/);
  }
  assert.equal(adCagrisi.length, 1, 'ayni hatali sifre AD`ye yeniden gitti — AD kilidine dogru ilerler');
  // Sayaca yazilmadi: 8 denemeye ragmen bekleme YOK (esik 5).
  assert.equal(throttle.kontrol('ayse').ok, true, 'tekrar denemeleri kullanicinin hakkini yedi');
  // Alan adli / buyuk harfli yazim da ayni kullanicidir.
  assert.equal((await giris('KURUM\\AYSE', 'eski-sifrem')).body.code, 'kimlik_tekrar');
  assert.equal(adCagrisi.length, 1);
  // Dogru sifre HEMEN calisir (farkli sifre AD'ye gider).
  assert.equal((await giris('ayse', 'dogru')).status, 200);
  assert.equal(adCagrisi.length, 2);

  // Pencere dolunca ayni sifre AD'ye yeniden gidebilir (sifre AD'de degismis olabilir).
  await giris('mehmet', 'yanlis');
  const once = adCagrisi.length;
  simdi += 91 * 1000;
  assert.equal((await giris('mehmet', 'yanlis')).body.code, 'kimlik');
  assert.equal(adCagrisi.length, once + 1);
});
