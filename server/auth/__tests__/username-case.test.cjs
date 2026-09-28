// server/auth/__tests__/username-case.test.cjs — kullanici adi TEK BICIMDE dolasir.
//
// Kullanici (2026-09-28): "Portalda ekranlara yetki verirken tum LDAP kullanicilarini cekip
// oradan secerek yetkileri versem olur mu? Kucuk harf buyuk harf sorunu yasiyoruz."
//
// SORUN NEREDEYDI: giris yolu `normalizeUsername` ile kucuk harfe ceviriyordu ama
// `findLdapUserByUsername` / `findLdapUserByEmail` AD'deki yazimi ("Osman.Koz") aynen
// donuyor, `getUserIdentity` de kendisine VERILEN yazimi geri veriyordu. Ayni kisi iki
// farkli yazimla dolasinca, kullanici adiyla anahtarlanan kayitlar (is gecmisi, tercihler,
// AI sohbetleri, OCO) ikiye boluniyordu.
//
// UC1 normalizeUsername sozlesmesi (kucuk harf + domain eki atilir)
// UC2 LDAP arama/bulma fonksiyonlari NORMALIZE kullanici adi doner
// UC3 getUserIdentity verilen yazimi DEGIL, normalize edilmis adi doner
// UC4 yetki kurallari zaten harf duyarsiz (yazarken de okurken de) - bu KORUNMALI
// UC5 LDAP arama ucu: en az 3 karakter, admin'e kapali degil ama admin'e ozel, tavanli
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeUsername } = require('../utils.cjs');

const oku = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const duz = (s) => s.replace(/\s+/g, ' ');

test('UC1: normalizeUsername kucuk harfe cevirir ve domain ekini atar', () => {
  assert.equal(normalizeUsername('Osman.Koz'), 'osman.koz');
  assert.equal(normalizeUsername('  ADEMIR  '), 'ademir');
  assert.equal(normalizeUsername('osman.koz@fw.garanti.com.tr'), 'osman.koz');
  assert.equal(normalizeUsername(''), '');
  assert.equal(normalizeUsername(null), '');
});

test('UC2: LDAP fonksiyonlari NORMALIZE kullanici adi doner', () => {
  const ldap = duz(oku('ldap.cjs'));
  // Giris yolu zaten normalize ediyordu; arama/bulma yollari da AYNI olmali - yoksa ayni
  // kisi iki farkli yazimla dolasir.
  assert.ok(
    !/username: String\(user\.sAMAccountName/.test(ldap),
    'bir LDAP yolu AD yazimini aynen donduruyor - kullanici adi iki bicimde dolasir',
  );
  const sayi = (ldap.match(/username: normalizeUsername\(/g) || []).length;
  assert.ok(
    sayi >= 3,
    `normalize edilen donus sayisi az: ${sayi} (login + arama + e-posta bekleniyor)`,
  );
});

test('UC3: getUserIdentity verilen yazimi degil, normalize adi doner', () => {
  const users = duz(oku('users.cjs'));
  assert.ok(
    users.includes('const uname = normalizeUsername(username);'),
    'getUserIdentity gelen yazimi aynen kullaniyor - AWX is atfina karisik yazim gider',
  );
  // Donen nesne de ayni degeri tasimali.
  assert.ok(
    users.includes('return { username: uname, displayName, mail };'),
    'donen kullanici adi normalize edilmis degerden gelmiyor',
  );
});

test('UC4: yetki kurallari harf duyarsiz - yazarken ve okurken', () => {
  const elements = duz(oku('elements.cjs'));
  const visibility = duz(oku('visibility.cjs'));
  // YAZARKEN: user/group/email kucuk harf (role haric - rol adlari sabit yazimli).
  assert.ok(
    elements.includes("pt === 'role' ? pid : pid.toLowerCase()"),
    'kural yazilirken kullanici/grup adi kucuk harfe cevrilmiyor',
  );
  // OKURKEN: kural indeksi ve kullanicinin adi ayni bicime getiriliyor.
  assert.ok(
    visibility.includes('String(r.principal_id).trim().toLowerCase()'),
    'kural indeksi harf duyarsiz degil',
  );
  assert.ok(
    visibility.includes("const usernameLower = ((user && user.username) || '').toLowerCase();"),
    'kullanici adi karsilastirma icin kucultulmuyor',
  );
});

test('UC5: LDAP arama ucu - admin, en az 3 karakter, tavanli, hatayi YUTMAZ', () => {
  const rotalar = duz(oku('visibility-routes.cjs'));
  assert.ok(
    rotalar.includes('router.get("/ldap-users", requireAdmin'),
    'LDAP arama ucu yok ya da admin kapisi yok',
  );
  assert.ok(
    rotalar.includes('q.length < 3'),
    'en az 3 karakter kurali yok - tum dizin taranabilir',
  );
  // ARAMA DUSERSE BOS LISTE DONMEZ: ekran "boyle kullanici yok" derse, kullanici olmayan
  // bir sorunu arar.
  assert.ok(rotalar.includes('res.status(502)'), 'arama hatasi bos liste gibi donuyor');

  const ldap = duz(oku('ldap.cjs'));
  assert.ok(ldap.includes('async function searchLdapUsers('), 'searchLdapUsers yok');
  assert.ok(ldap.includes('sizeLimit: tavan'), 'arama sonucu tavanlanmiyor');
  assert.ok(
    ldap.includes('if (q.length < 3 || !isConfigured()) return [];'),
    'kisa sorgu / LDAP kapali durumu erken donmuyor',
  );
  // KACIS SADECE "bir yerde cagrilmis" olmamali: HAM SORGU hicbir filtrede gecmemeli.
  // Ilk halinde bekci `const e = escapeFilter(q)` satirini gorup yesil kaliyor, filtre ham
  // `${q}` kullanmaya cevrilince KACIRIYORDU (mutasyon testi gosterdi). Filtre birden cok
  // sablon parcasina bolunebildigi icin dosyanin TAMAMINDA ham degisken enterpolasyonu
  // araniyor - `q` yalnizca ham sorguyu tasir, kacirilmis hali `e`dir.
  const hamLdap = oku('ldap.cjs');
  assert.ok(!/\$\{q\}/.test(hamLdap), 'LDAP filtresinde HAM sorgu kullanilmis (enjeksiyon)');
  assert.ok(hamLdap.includes('const e = escapeFilter(q);'), 'sorgu kacisa sokulmuyor');
  assert.ok(ldap.includes('searchLdapUsers,'), 'searchLdapUsers disa aktarilmamis - olu kod');
});

test('UC6: ekran elle yazimi da kucuk harfe cevirir (secim yapilmadiginda)', () => {
  const kok = path.join(__dirname, '..', '..', '..', 'src', 'components', 'admin');
  const secici = duz(fs.readFileSync(path.join(kok, 'LdapUserPicker.tsx'), 'utf8'));
  assert.ok(
    secici.includes('onChange(v.trim().toLowerCase());'),
    'elle yazilan kullanici adi kucuk harfe cevrilmiyor',
  );
  // ELLE YAZIM KAPATILMADI: LDAP kapaliysa yetki verilemez hale gelmemeli.
  assert.ok(
    secici.includes('Elle yazmaya devam edebilirsiniz'),
    'arama duserse elle yazim yolu kullaniciya soylenmiyor',
  );

  const sayfa = duz(fs.readFileSync(path.join(kok, 'tabs', 'PageVisibilityTab.tsx'), 'utf8'));
  // HER IKI KAYIT YOLU DA (gorsun / gizli): biri cevirip oteki cevirmezse, ayni kisi
  // icin iki farkli yazimla kural olusur. Ilk halinde bekci tek gecisi gorup yesil
  // kaliyordu (mutasyon testi gosterdi).
  const kucuk = (sayfa.match(/principalId: username\.trim\(\)\.toLowerCase\(\)/g) || []).length;
  assert.equal(
    kucuk,
    2,
    `kisi kurali kaydi her iki yolda da kucuk harfe cevrilmeli (bulunan: ${kucuk})`,
  );
  assert.ok(
    !/principalId: username\.trim\(\),/.test(sayfa),
    'bir kayit yolu kullanici adini oldugu gibi yaziyor',
  );
});
