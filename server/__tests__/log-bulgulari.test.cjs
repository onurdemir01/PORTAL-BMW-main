// server/__tests__/log-bulgulari.test.cjs
//
// URETIM LOG ANALIZINDEN CIKAN BULGULAR (20 Eylul, 13,5 gun, 34.162 satir).
//
// Hepsinin ortak ozelligi: SESSIZ ya da YANILTICI davranis. Hicbiri "hata"
// vermiyor; kullanici yanlis bir sey goruyor ya da hicbir sey gormuyor.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const oku = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const kodOnly = (s) =>
  s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const SERVICE = oku('service.cjs');
const RUNNER = oku('ansible/runner.cjs');
const LJC = oku('ansible/long-job-cancel.cjs');

// ── LB1/LB2: 401 FIRTINASI (10.211 WARN) ───────────────────────────────────

test('LB1 401 tek tek YAZILMIYOR ama SUSTURULMUYOR da — ozetleniyor', () => {
  const kod = kodOnly(SERVICE);
  // Eski hal: her 401 ayri bir WARN satiri. Logun ucte biri "oturum yok"du.
  assert.match(kod, /res\.statusCode === 401/, '401 ayri ele alinmiyor');
  assert.match(kod, /API 401 ozet/, 'ozet satiri yok — gorunurluk TAMAMEN kayboldu');
  // 401 DISINDAKI hatalar eskisi gibi tek tek yazilmali.
  assert.match(kod, /else if \(res\.statusCode >= 400\)/, 'diger hatalar da susturulmus');
});

test('LB2 401 sayaci SINIRSIZ buyumuyor (kullanici anahtarli Map bir OOM sinifiydi)', () => {
  const kod = kodOnly(SERVICE);
  assert.match(kod, /_401Sayac\.size < 50/, 'sayac boyut kapisi yok');
  // Sorgu dizesi ARINDIRILMALI: `?id=123` her istekte yeni anahtar uretirdi.
  assert.match(kod, /\.split\('\?'\)\[0\]/, 'sorgu dizesi arindirilmiyor — sayac sinirsiz buyur');
  assert.match(kod, /_401Ozet\.unref\(\)/, 'zamanlayici unref edilmemis — kapanmayi geciktirir');
});

// ── LB3: TEAMS YANLIS ATIF (33 kez) ────────────────────────────────────────

test('LB3 tetikleyici bilinmiyorken GERCEK BIR KISIYE atfedilmiyor', () => {
  const kod = kodOnly(RUNNER);
  const i = kod.indexOf('function withRequesterVars');
  const govde = kod.slice(i, kod.indexOf('\n}', kod.indexOf('requester_is_fallback', i)));
  // Ad icin varsayilan kisi adina DUSULMEMELI.
  assert.ok(
    !/const name = rawName \|\| DEFAULT_REQUESTER\.name/.test(govde),
    'ad hala gercek bir calisanin adina dusuyor — denetim izi YANLISLANIR',
  );
  assert.match(govde, /FALLBACK_REQUESTER_LABEL/, 'notr etiket kullanilmiyor');
  // ADRES yine varsayilana dusmeli: Teams cozemedigi adreste bildirimi DUSURUR.
  assert.match(govde, /rawEmail \|\| DEFAULT_REQUESTER\.email/, 'adres varsayilani kalkmis — bildirim hic gitmez');
  // Kim tetikledigi HER ZAMAN gonderilmeli.
  assert.match(govde, /requester_username/, 'gercek tetikleyici gonderilmiyor');
  assert.match(govde, /requester_is_fallback/, 'varsayilana dusuldugu bildirilmiyor');
});

test('LB3b notr etiket GERCEK BIR ISIM DEGIL', () => {
  const kod = kodOnly(RUNNER);
  const m = /const FALLBACK_REQUESTER_LABEL = '([^']+)'/.exec(kod);
  assert.ok(m, 'notr etiket tanimli degil');
  // "Ad Soyad" bicimi olmamali — iki kelimeden olusan ozel isim gorunumu.
  assert.match(m[1], /Bilinmeyen|bilinmiyor|Portal/i, `etiket bir kisi adina benziyor: ${m[1]}`);
});

// ── LB4: BOS LOG GOSTERIMI (50 kez) ────────────────────────────────────────

test('LB4 filtre eslesmediginde ekran BOS kalmiyor, SEBEBI yaziyor', () => {
  const kod = kodOnly(RUNNER);
  const i = kod.indexOf('filtered.totalLines > 0 && filtered.matchedLines === 0');
  assert.ok(i > 0, 'bos filtre dali bulunamadi');
  const govde = kod.slice(i, i + 1200);
  assert.match(govde, /filtreUyarisi =/, 'sebep ekrana tasinmiyor — kullanici isi basarisiz sanar');
  // Yanitta da yer almali.
  assert.match(kod, /output: filtreUyarisi \?/, 'yanit hala bos ciktiyi gonderiyor');
  assert.match(kod, /filterNoMatch:/, 'ayri alan yok — ekran rozet gosteremez');
});

// ── LB5: AWX IPTAL 403 (8 kez) ─────────────────────────────────────────────

test('LB5 iptal yetkisi yoksa ISIN HALA KOSTUGU soyleniyor', () => {
  const kod = kodOnly(RUNNER);
  const i = kod.indexOf('async function cancelJobOnServer');
  const govde = kod.slice(i, kod.indexOf('\n}', kod.indexOf('status === 403', i)));
  assert.match(govde, /status === 403/, '403 ayri ele alinmiyor');
  assert.match(govde, /ÇALIŞMAYA DEVAM/, 'isin hala kostugu SOYLENMIYOR — kesintide tehlikeli');
  assert.match(govde, /permanent: true/, 'red kalici isaretlenmiyor');
});

test('LB6 KALICI red TEKRAR DENENMIYOR', () => {
  const kod = kodOnly(LJC);
  assert.match(kod, /e\.permanent/, 'kalici red ayirt edilmiyor');
  assert.match(
    kod,
    /_attempts\.set\(key, MAX_ATTEMPTS\)/,
    'kalici red sonrasi tekrar deneme engellenmiyor — logda "belki olur" gorunumu',
  );
});

// ── LB7: GORUNURLUK YOKLAMASI 401'DE DURUYOR ───────────────────────────────

test('LB7 401 yoklama dongusunu DURDURUYOR (cift istek tuzagi kapali)', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'api', 'adminApi.ts'), 'utf8');
  const ctx = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'contexts', 'AuthContext.tsx'),
    'utf8',
  );
  // `safeJson` HTTP durumunu kontrol etmez: 401'de `version` undefined -> `?? 0`
  // -> `0 !== mevcut` -> haritayi yeniden cek. Yani her turda IKI istek.
  assert.match(api, /if \(res\.status === 401\) return \{ version: 0, unauthorized: true \}/,
    '401 hala sessizce 0`a dusuyor — her turda ikinci bir istek tetiklenir');
  assert.match(ctx, /if \(unauthorized\) \{\s*setUser\(null\)/,
    '401`de oturum sonlandirilmiyor — dongu sonsuza dek doner');
});
