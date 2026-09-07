// server/ansible/__tests__/requester-attribution.test.cjs — ISI KIM TETIKLEDI.
//
// URETIM (2026-09-07): kullanici KENDI actigi LogX isinde, AWX extra_vars'inda
// baska bir calisanin adini gordu:
//
//   "requester_email": "onurdemir3@garantibbva.com.tr",
//   "requester_name":  "Onur Demir"
//
// SEBEP LDAP DEGILDI. `runner.launchJobOnServer(serverId, templateId, extraVars,
// limit, requester = null)` — LogX v2 bu fonksiyonu DORT argumanla cagiriyordu,
// yani `requester` HER ZAMAN null'di ve her is kod deposundaki sabit kisiye
// (DEFAULT_REQUESTER) atfediliyordu. Yanlis atif, bildirimin GORUNTUSUNDEN
// ayirt edilemiyordu: varsayilan gercek bir calisanin kimligi oldugu icin o kisi
// kendi adini gorup "calisiyor" sanabilirdi.
//
// Bu bekci iki seyi birden kilitler: (1) kullanici GECIRILIYOR, (2) gecirilemedigi
// durumda bu VERIDE gorunur oluyor.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

test('RA1 LogX v2 isi tetikleyen kullaniciyi GECIRIYOR', () => {
  const src = codeOnly(read('logx/v2/jobs.cjs'));

  // Kullanici istek satirindan okunuyor mu?
  assert.match(
    src,
    /getRequestRow\(requestId\)/,
    'launchJob istegin sahibini hic okumuyor — atif varsayilana duser',
  );

  // VE her launch cagrisina GECIRILIYOR mu. "Dosyada requester geciyor mu" demek
  // YETMEZ: degiskeni tanimlayip cagriya koymamak tam da uretimdeki hataydi.
  const calls = [...src.matchAll(/launchJobOnServer\(([\s\S]*?)\)\s*;/g)];
  assert.ok(
    calls.length >= 2,
    `launchJobOnServer ${calls.length} yerde cagriliyor (>=2 bekleniyor)`,
  );
  for (const c of calls) {
    assert.match(
      c[1],
      /requester/,
      'launchJobOnServer cagrisi requester GECIRMIYOR — is sabit kisiye atfedilir:\n' +
        c[0].slice(0, 160),
    );
  }
});

test('RA2 atif varsayilana dustugunde bu VERIDE gorunur', () => {
  const src = codeOnly(read('ansible/runner.cjs'));

  // Gercek tetikleyici, e-posta cozulemese bile gonderilir.
  assert.match(
    src,
    /requester_username:/,
    'gercek tetikleyicinin kullanici adi gonderilmiyor — yanlis atif izlenemez',
  );
  // Varsayilana dusuldugu ACIKCA isaretlenir.
  assert.match(
    src,
    /requester_is_fallback:/,
    'varsayilana dusuldugu isaretlenmiyor — bildirimin gorunusunden ayirt edilemez',
  );
  // Bayrak SABIT olamaz; gercekten hesaplanmali.
  const flag = (src.match(/requester_is_fallback:\s*([^,\n]+)/) || [])[1] || '';
  assert.doesNotMatch(flag, /^(true|false)\s*$/, 'requester_is_fallback sabit yazilmis');
  assert.match(flag, /rawEmail|rawName/, 'bayrak gercek cozumden turetilmiyor');
});

test('RA3 varsayilan kimlik `.env` ile degistirilebilir', () => {
  const src = codeOnly(read('ansible/runner.cjs'));
  // Kod deposuna gomulu bir calisan kimligi, degistirilemez olmamali.
  assert.match(
    src,
    /process\.env\.PORTAL_DEFAULT_REQUESTER_EMAIL/,
    'varsayilan e-posta kod deposuna sabitlenmis — baska bir kurulumda yanlis kisiyi etiketler',
  );
  assert.match(src, /process\.env\.PORTAL_DEFAULT_REQUESTER_NAME/, 'varsayilan ad sabitlenmis');
});

test('RA4 kullanici adi BILINIYORSA ad varsayilana DUSMEZ', () => {
  const src = codeOnly(read('ansible/runner.cjs'));
  // `displayName` bos ama `username` doluysa ad kullanici adi olmali.
  const fn = src.slice(src.indexOf('function withRequesterVars'));
  assert.match(
    fn.slice(0, 900),
    /rawUsername\s*=\s*String\(user\?\.username/,
    'kullanici adi hic okunmuyor',
  );
  assert.match(
    fn.slice(0, 900),
    /rawName\s*=\s*String\(user\?\.displayName\s*\|\|\s*rawUsername/,
    'ad cozumu kullanici adina dusmuyor — bilinen kisi bile "varsayilan" gorunur',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// IKINCI TUR (2026-09-07): ilk duzeltme YARIM KALMISTI.
//
// RA1 "requester geciriliyor mu" diye soruyordu ve YESILDI — ama gecirilen sey
// `{ username: row.username }` idi. `withRequesterVars` e-postayi `user.mail`den
// okur; `logx_v2_requests` tablosunda MAIL KOLONU YOKTUR. Yani `requester_email`
// YINE DEFAULT_REQUESTER'a, kod deposundaki sabit calisanin adresine dusuyordu.
// Kullanicinin gordugu satir bir sonraki iste de aynen cikacakti:
//
//   "requester_email": "onurdemir3@garantibbva.com.tr"
//
// Bildirimin gittigi yer E-POSTADIR. Kullanici adini gecirmek, sorunun
// GORUNEN yarisini duzeltip ISLEYEN yarisini yerinde birakmakti.
// ─────────────────────────────────────────────────────────────────────────────

const path2 = require('node:path');

// Bir fonksiyonun TAM govdesi (suslu parantez esleyerek).
// Sabit pencere (`slice(i, i + N)`) bu repoda defalarca komsu koda tasip bekciyi
// kor birakti; olcut burada yapinin kendisi.
function bodyOf(src, signature) {
  const i = src.indexOf(signature);
  assert.ok(i >= 0, `imza bulunamadi: ${signature}`);
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`govde kapanmadi: ${signature}`);
}

test('RA5 LogX atfi KULLANICI ADINDAN FAZLASINI cozuyor (e-posta dahil)', () => {
  const src = codeOnly(read('logx/v2/jobs.cjs'));
  const fn = bodyOf(src, 'async function launchJob(');

  assert.match(
    fn,
    /getUserIdentity\(/,
    "launchJob kimligi cozmuyor — `requester_email` yine DEFAULT_REQUESTER'a duser\n" +
      've Teams bildirimi kod deposundaki sabit kisiye gider.',
  );

  // `requester`a atanan ifade kimlik cozumunu ICERMELI. "Dosyada getUserIdentity
  // geciyor mu" demek YETMEZ: degiskeni tanimlayip atamada kullanmamak, RA1'in
  // yakalayamadigi hatanin ta kendisiydi.
  const atamalar = [...fn.matchAll(/\brequester\s*=\s*([\s\S]*?);/g)]
    .map((x) => x[1].trim())
    // `let requester = null;` bir DEGER atamasi degil, ilklemedir.
    .filter((v) => v !== 'null');
  assert.ok(atamalar.length >= 1, 'requester hicbir yerde GERCEK bir degere atanmiyor');
  for (const v of atamalar) {
    assert.match(
      v,
      /getUserIdentity/,
      'requester yalnizca istek satirindan kuruluyor — o satirda e-posta YOKTUR:\n' + v,
    );
  }
});

test("RA6 kimlik cozumu LDAP'a dayaniyor ve E-POSTAYI hedefliyor", () => {
  const users = codeOnly(read('auth/users.cjs'));
  const fn = bodyOf(users, 'async function getUserIdentity(');

  assert.match(fn, /portal_users/, 'onbellek (portal_users) hic okunmuyor');
  assert.match(fn, /\bmail\b/, 'e-posta hic okunmuyor — duzeltilmek istenen alan bu');
  assert.match(
    fn,
    /findLdapUserByUsername\(/,
    "onbellekte e-posta yoksa LDAP'a gidilmiyor — yeni kullanicinin ilk isi yine " +
      'yanlis kisiye atfedilir',
  );

  // LDAP yedegi GERCEKTEN var ve dogru alanla ariyor.
  const ldap = codeOnly(read('auth/ldap.cjs'));
  const lfn = bodyOf(ldap, 'async function findLdapUserByUsername(');
  assert.match(lfn, /sAMAccountName=/, 'LDAP aramasi kullanici adi filtresi kullanmiyor');
  assert.match(
    lfn,
    /userPrincipalName/,
    "'mail' bos olan AD hesaplari icin userPrincipalName yedegi yok — " +
      'authenticateLdap ile ayni oncelik korunmali',
  );
  assert.match(ldap, /findLdapUserByUsername,/, 'fonksiyon disa aciLMAMIS — olu kod');
});

test('RA7 HER launchJobOnServer cagrisi tetikleyeni geciriyor', () => {
  const SERVER = path.join(__dirname, '..', '..');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      const full = path2.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.cjs')) files.push(full);
    }
  };
  walk(SERVER);

  const sites = [];
  for (const f of files) {
    // runner.cjs fonksiyonun KENDISINI tanimlar; cagri degildir.
    if (f.endsWith(path2.join('ansible', 'runner.cjs'))) continue;
    const src = codeOnly(fs.readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/launchJobOnServer\(/g)) {
      // Parantez esleyerek argumanlari cikar. `[^)]*` ile okumak ilk ic parantezde
      // durur ve argumanlarin cogunu HIC GORMEZ (bu repoda AZ1 tam boyle kordu).
      let depth = 0;
      let k = m.index + m[0].length - 1;
      let start = k + 1;
      for (; k < src.length; k++) {
        if (src[k] === '(') depth++;
        else if (src[k] === ')' && --depth === 0) break;
      }
      const args = src.slice(start, k);
      // Ust duzey virgullerle bol.
      let d = 0;
      let count = 1;
      for (const ch of args) {
        if ('([{'.includes(ch)) d++;
        else if (')]}'.includes(ch)) d--;
        else if (ch === ',' && d === 0) count++;
      }
      sites.push({
        file: path2.relative(SERVER, f),
        count,
        args: args.replace(/\s+/g, ' ').slice(0, 90),
      });
    }
  }

  // Toplayici yanlis dizine bakarsa bekci BOS kumeyle sessizce yesil kalmasin.
  assert.ok(
    sites.length >= 12,
    `yalnizca ${sites.length} launchJobOnServer cagrisi goruldu (>=12 bekleniyor)`,
  );

  const eksik = sites.filter((s) => s.count < 5);
  assert.deepEqual(
    eksik.map((s) => `${s.file}: ${s.count} arguman — ${s.args}`),
    [],
    'requester (5. arguman) gecirilmeyen cagri(lar) var. Varsayilani `null` oldugu icin\n' +
      'bu isler kod deposundaki SABIT kisiye atfedilir ve yanlis kisiye bildirim gider.',
  );
});
