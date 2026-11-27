// server/auth/__tests__/ldap-giris-akisi.test.js — LDAP GIRIS AKISI ve ROL KARARI (2026-11-27, kapsam PR-2).
//
// Rolu (Admin / User / red) veren `determineRole` ve giris akisi `authenticateLdap` hicbir testte
// kosmuyordu; ayricalik yukseltme kurali ("DN sonu eslesmesi, alt dizi degil") ve LDAPS sertifika
// dogrulamasi yalnizca yorumdaydi. ldapts sahte istemcisi (require.cache) uzerinden GERCEK modul kosar.
//   LD1 rol: Admin grubu tam / DN sonu; alt dizi Admin vermez; beyaz liste (LDAP_USER_GROUP); eski ad
//   LD2 akis: servis hesabi, arama, kullanici yok, AD hata kodlari, ag hatasi, her istemci kapatilir
//   LD3 profil: ad normallestirme, UPN ile giris, gruplar (tekil, 200 siniri), ad / posta / birim yedekleri,
//       fotograf bicimleri, filtre kacisi
//   LD4 TLS: ldaps'ta dogrulama acik (bilincli kapatma), CA dosyasi okunamazsa baglanilmaz, ldap'ta TLS yok
//   LD5 kullanici adiyla arama (yetki simulasyonu): bicim, gruplar, bulunamadi / hata null, istemci kapanir
//   LD6 e-postayla arama (nobetci zenginlestirme): bicim, yedek alanlar, fotograf, filtre kacisi, null yollari
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ldaptsYol = require.resolve('ldapts');
const LDAP_YOL = path.join(__dirname, '..', 'ldap.cjs');

let durum;
class SahteClient {
  constructor(opts) {
    this.opts = opts;
    this.no = durum.istemciler.length;
    durum.istemciler.push(this);
    this.kapandi = false;
  }
  async bind(dn, parola) {
    durum.bindler.push([dn, parola]);
    const h = durum.bindHatasi[dn];
    if (h) throw h;
  }
  async unbind() {
    this.kapandi = true;
    if (durum.unbindHatasi) throw new Error('unbind dustu');
  }
  async search(base, opts) {
    durum.aramalar.push([base, opts]);
    if (durum.aramaHatasi) throw durum.aramaHatasi;
    return { searchEntries: durum.kayitlar };
  }
}

function yukle() {
  require.cache[ldaptsYol] = {
    id: ldaptsYol,
    filename: ldaptsYol,
    loaded: true,
    exports: { Client: SahteClient },
  };
  delete require.cache[LDAP_YOL];
  return require(LDAP_YOL);
}

const ENV = [
  'LDAP_URL',
  'LDAP_BASE_DN',
  'LDAP_BIND_DN',
  'LDAP_BIND_PASSWORD',
  'LDAP_ADMIN_GROUP',
  'LDAP_GROUP_ADMIN_DN',
  'LDAP_USER_GROUP',
  'AUTH_LDAP_SEARCH_ATTR',
  'LDAP_REJECT_UNAUTHORIZED',
  'LDAP_CA_CERT_PATH',
];
let eskiEnv;
const ADMIN_G = 'CN=Portal-Admins,OU=Groups,DC=ornek,DC=invalid';
const USER_G = 'CN=Portal-Users,OU=Groups,DC=ornek,DC=invalid';
const kisi = (o = {}) => ({
  dn: 'CN=Ali Veli,OU=Users,DC=ornek,DC=invalid',
  cn: 'Ali Veli',
  sAMAccountName: 'Ali.Veli',
  mail: 'ali.veli@ornek.invalid',
  displayName: 'Ali Veli',
  memberOf: [USER_G],
  department: 'Middleware',
  title: 'Uzman',
  ...o,
});

beforeEach((t) => {
  eskiEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.LDAP_URL = 'ldaps://dizin.ornek.invalid';
  process.env.LDAP_BASE_DN = 'DC=ornek,DC=invalid';
  process.env.LDAP_BIND_DN = 'CN=svc-portal,OU=Svc,DC=ornek,DC=invalid';
  process.env.LDAP_BIND_PASSWORD = 'servis-parolasi';
  durum = {
    istemciler: [],
    bindler: [],
    aramalar: [],
    bindHatasi: {},
    aramaHatasi: null,
    unbindHatasi: false,
    kayitlar: [kisi()],
    log: { warn: [], log: [] },
  };
  t.mock.method(console, 'warn', (...a) => durum.log.warn.push(a.join(' ')));
  t.mock.method(console, 'log', (...a) => durum.log.log.push(a.join(' ')));
});
afterEach(() => {
  for (const [k, v] of Object.entries(eskiEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const giris = (lookup) => yukle().authenticateLdap('ali.veli', 'kullanici-parolasi', lookup);

test('LD1 rol: Admin grubu tam / DN sonu; alt dizi Admin vermez; beyaz liste; eski değişken adı', async () => {
  process.env.LDAP_ADMIN_GROUP = ADMIN_G;
  durum.kayitlar = [kisi({ memberOf: [USER_G, ADMIN_G.toUpperCase()] })];
  assert.equal((await giris()).role, 'Admin');
  // DN sonu: grup DN'i yonetici grubunun DN zinciriyle bitiyor
  process.env.LDAP_ADMIN_GROUP = 'OU=Groups,DC=ornek,DC=invalid';
  durum.kayitlar = [kisi({ memberOf: 'CN=Herhangi,OU=Groups,DC=ornek,DC=invalid' })];
  assert.equal((await giris()).role, 'Admin');
  // ALT DIZI Admin VERMEZ (eski iki yonlu includes ayricalik yukseltiyordu)
  process.env.LDAP_ADMIN_GROUP = 'CN=Portal-Admins';
  durum.kayitlar = [
    kisi({ memberOf: ['CN=Portal-Admins-Eski,OU=Groups,DC=ornek,DC=invalid', 'CN=Portal'] }),
  ];
  assert.equal((await giris()).role, 'User');
  // eski degisken adi (LDAP_GROUP_ADMIN_DN)
  delete process.env.LDAP_ADMIN_GROUP;
  process.env.LDAP_GROUP_ADMIN_DN = ADMIN_G;
  durum.kayitlar = [kisi({ memberOf: [ADMIN_G] })];
  assert.equal((await giris()).role, 'Admin');
  // beyaz liste: yalniz LDAP_USER_GROUP uyesi User; uye olmayan dogrulanmis kisi reddedilir (403)
  process.env.LDAP_USER_GROUP = USER_G;
  durum.kayitlar = [kisi({ memberOf: [USER_G] })];
  assert.equal((await giris()).role, 'User');
  durum.kayitlar = [kisi({ memberOf: ['CN=Baska,OU=Groups,DC=ornek,DC=invalid'] })];
  await assert.rejects(
    giris(),
    (e) => e.constructor.name === 'GirisHatasi' && e.code === 'grup' && e.status === 403,
  );
  // beyaz liste ve grup yok: red; liste yoksa (varsayilan) grupsuz dogrulanmis kisi User
  durum.kayitlar = [kisi({ memberOf: undefined })];
  await assert.rejects(giris(), (/** @type {any} */ e) => e.code === 'grup');
  delete process.env.LDAP_USER_GROUP;
  delete process.env.LDAP_GROUP_ADMIN_DN;
  assert.equal((await giris()).role, 'User');
});

test('LD2 akış: servis hesabı, arama, kullanıcı yok, AD hata kodları, ağ hatası; her istemci kapatılır', async () => {
  const svc = process.env.LDAP_BIND_DN;
  const dn = kisi().dn;
  // servis hesabi baglanamazsa
  durum.bindHatasi[svc] = new Error('invalid credentials');
  await assert.rejects(giris(), { message: 'Servis hesabı bağlanamadı: invalid credentials' });
  assert.deepEqual(durum.bindler[0], [svc, 'servis-parolasi']);
  assert.equal(durum.istemciler[0].kapandi, true);
  // arama duserse hata aynen yukari, istemci kapanir
  durum.bindHatasi = {};
  durum.istemciler = [];
  durum.aramaHatasi = new Error('size limit');
  await assert.rejects(giris(), { message: 'size limit' });
  assert.equal(durum.istemciler[0].kapandi, true);
  // kullanici yok
  durum.aramaHatasi = null;
  durum.kayitlar = [];
  await assert.rejects(giris(), { message: 'ldap_user_not_found' });
  durum.kayitlar = [{ cn: 'dn-siz' }];
  await assert.rejects(giris(), { message: 'ldap_user_not_found' });
  // kullanici parolasi yanlis / hesap kilitli / devre disi: AD kodu GirisHatasi'na cevrilir
  durum.kayitlar = [kisi()];
  for (const [ad, kod, status] of [
    [
      '80090308: LdapErr: DSID-0C09044E, comment: AcceptSecurityContext error, data 52e, v4563',
      'kimlik',
      401,
    ],
    ['AcceptSecurityContext error, data 775, v4563', 'kilitli', 403],
    ['AcceptSecurityContext error, data 533, v4563', 'devre_disi', 403],
    ['bilinmeyen bind hatasi', 'kimlik', 401],
  ]) {
    durum.istemciler = [];
    durum.bindHatasi[dn] = new Error(ad);
    await assert.rejects(
      giris(),
      (e) => e.constructor.name === 'GirisHatasi' && e.code === kod && e.status === status,
      ad,
    );
    assert.deepEqual(durum.bindler.at(-1), [dn, 'kullanici-parolasi']);
    assert.ok(
      durum.istemciler.every((c) => c.kapandi),
      'istemci acik kaldi',
    );
  }
  // baglanti koptuysa kimlik hatasi DEGIL (sayaca yazilmaz): ham hata
  const ag = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  durum.bindHatasi[dn] = ag;
  await assert.rejects(giris(), (/** @type {any} */ e) => e === ag);
  // unbind duserse giris yine basarili
  durum.bindHatasi = {};
  durum.unbindHatasi = true;
  assert.equal((await giris()).authSource, 'ldap');
});

test('LD3 profil: ad, UPN ile giriş, gruplar (tekil, 200 sınırı), yedek alanlar, fotoğraf, filtre kaçışı', async () => {
  const foto = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  durum.kayitlar = [kisi({ memberOf: [USER_G, ` ${USER_G} `, '', USER_G], thumbnailPhoto: foto })];
  let p = await giris();
  assert.deepEqual(
    { ...p, avatarUrl: undefined, photoUrl: undefined },
    {
      username: 'ali.veli',
      dn: kisi().dn,
      groups: [USER_G],
      displayName: 'Ali Veli',
      mail: 'ali.veli@ornek.invalid',
      department: 'Middleware',
      title: 'Uzman',
      role: 'User',
      authSource: 'ldap',
      avatarUrl: undefined,
      photoUrl: undefined,
    },
  );
  assert.equal(p.avatarUrl, `data:image/jpeg;base64,${foto.toString('base64')}`);
  assert.equal(p.photoUrl, p.avatarUrl);
  // varsayilan arama alani sAMAccountName, deger kacisli
  const filtre = durum.aramalar.at(-1)[1].filter;
  assert.equal(filtre, '(sAMAccountName=ali.veli)');
  assert.equal(durum.aramalar.at(-1)[0], 'DC=ornek,DC=invalid');
  // UPN ile giris: arama UPN'le, oturum adi AD'deki hesap adi; kaciliyor
  p = await giris({ attr: 'userPrincipalName', value: 'ali*(veli)\\@ornek.invalid' });
  assert.equal(
    durum.aramalar.at(-1)[1].filter,
    '(userPrincipalName=ali\\2a\\28veli\\29\\5c@ornek.invalid)',
  );
  assert.equal(p.username, 'ali.veli');
  // girilen ad AD hesap adindan farkliysa: UPN / posta ile giriste oturum adi AD'deki hesap adi,
  // hesap adiyla aramada girilen ad kalir
  const m = yukle();
  p = await m.authenticateLdap('aveli', 'pw', {
    attr: 'userPrincipalName',
    value: 'aveli@ornek.invalid',
  });
  assert.equal(p.username, 'ali.veli');
  p = await m.authenticateLdap('aveli', 'pw', { attr: 'mail', value: 'aveli@ornek.invalid' });
  assert.equal(p.username, 'ali.veli');
  p = await m.authenticateLdap('aveli', 'pw', { attr: 'sAMAccountName', value: 'aveli' });
  assert.equal(p.username, 'aveli');
  durum.kayitlar = [kisi({ sAMAccountName: undefined })];
  p = await m.authenticateLdap('aveli', 'pw', {
    attr: 'userPrincipalName',
    value: 'aveli@ornek.invalid',
  });
  assert.equal(p.username, 'aveli'); // hesap adi yoksa girilen ad
  durum.kayitlar = [kisi()];
  // ozel arama alani (ortam degiskeni)
  process.env.AUTH_LDAP_SEARCH_ATTR = 'cn';
  await giris();
  assert.equal(durum.aramalar.at(-1)[1].filter, '(cn=ali.veli)');
  delete process.env.AUTH_LDAP_SEARCH_ATTR;
  // yedek alanlar: posta yoksa UPN, ad yoksa cn / girilen ad, birim yedekleri; posta da yoksa uyari
  durum.kayitlar = [
    kisi({
      mail: '',
      userPrincipalName: 'ali@ornek.invalid',
      displayName: '',
      department: '',
      physicalDeliveryOfficeName: 'Istanbul',
      jpegPhoto: foto.toString('base64'),
    }),
  ];
  p = await giris();
  assert.equal(p.mail, 'ali@ornek.invalid');
  assert.equal(p.displayName, 'Ali Veli');
  assert.equal(p.department, 'Istanbul');
  assert.match(p.avatarUrl, /^data:image\/jpeg;base64,/);
  durum.kayitlar = [
    kisi({
      mail: '',
      displayName: '',
      cn: '',
      department: '',
      ou: 'MW',
      memberOf: USER_G,
      thumbnailPhoto: [foto],
    }),
  ];
  p = await giris();
  assert.equal(p.mail, '');
  assert.equal(p.displayName, 'ali.veli');
  assert.equal(p.department, 'MW');
  assert.deepEqual(p.groups, [USER_G]);
  assert.ok(p.avatarUrl);
  assert.ok(durum.log.warn.some((w) => /ne "mail" ne "userPrincipalName" dolu/.test(w)));
  // fotograf yok ya da bos: null, alanlar loglanir
  durum.kayitlar = [kisi({ thumbnailPhoto: Buffer.alloc(0) })];
  assert.equal((await giris()).avatarUrl, null);
  durum.kayitlar = [kisi()];
  assert.equal((await giris()).avatarUrl, null);
  assert.ok(durum.log.log.some((l) => /fotograf alani bulunamadi/.test(l)));
  // 200 grup siniri: fazlasi kirpilir, uyari
  durum.kayitlar = [
    kisi({
      memberOf: Array.from({ length: 205 }, (_, i) => `CN=G${i},OU=Groups,DC=ornek,DC=invalid`),
    }),
  ];
  p = await giris();
  assert.equal(p.groups.length, 200);
  assert.ok(durum.log.warn.some((w) => /205 grup bulundu, ilk 200/.test(w)));
});

test("LD4 TLS: ldaps'ta doğrulama açık, bilinçli kapatma, CA dosyası; ldap'ta TLS yok", async () => {
  await giris();
  assert.deepEqual(durum.istemciler[0].opts, {
    url: 'ldaps://dizin.ornek.invalid',
    tlsOptions: { rejectUnauthorized: true },
    connectTimeout: 8000,
    timeout: 8000,
  });
  process.env.LDAP_REJECT_UNAUTHORIZED = 'false';
  durum.istemciler = [];
  await giris();
  assert.equal(durum.istemciler[0].opts.tlsOptions.rejectUnauthorized, false);
  delete process.env.LDAP_REJECT_UNAUTHORIZED;
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'ldap-ca-'));
  try {
    const ca = path.join(dizin, 'ca.pem');
    fs.writeFileSync(ca, 'SAHTE CA');
    process.env.LDAP_CA_CERT_PATH = ca;
    durum.istemciler = [];
    await giris();
    assert.equal(String(durum.istemciler[0].opts.tlsOptions.ca[0]), 'SAHTE CA');
    // CA okunamazsa BAGLANILMAZ (sessizce dogrulamasiz baglanti yok)
    process.env.LDAP_CA_CERT_PATH = path.join(dizin, 'yok.pem');
    durum.istemciler = [];
    await assert.rejects(giris(), { code: 'ENOENT' });
    assert.equal(durum.istemciler.length, 0);
  } finally {
    fs.rmSync(dizin, { recursive: true, force: true });
  }
  delete process.env.LDAP_CA_CERT_PATH;
  process.env.LDAP_URL = 'ldap://dizin.ornek.invalid';
  durum.istemciler = [];
  await giris();
  assert.equal(durum.istemciler[0].opts.tlsOptions, undefined);
  // yapilandirilmamis
  delete process.env.LDAP_BIND_DN;
  await assert.rejects(giris(), { message: 'LDAP yapılandırılmamış' });
});

test('LD5 kullanıcı adıyla arama: biçim, gruplar, bulunamadı / hata null, istemci kapanır', async () => {
  const { findLdapUserByUsername } = yukle();
  durum.kayitlar = [
    kisi({ mail: '', userPrincipalName: 'ali@ornek.invalid', memberOf: [` ${USER_G} `, ''] }),
  ];
  assert.deepEqual(await findLdapUserByUsername(' Ali.Veli '), {
    username: 'ali.veli',
    displayName: 'Ali Veli',
    mail: 'ali@ornek.invalid',
    groups: [USER_G],
  });
  assert.equal(durum.aramalar.at(-1)[1].filter, '(sAMAccountName=Ali.Veli)');
  assert.equal(durum.istemciler.at(-1).kapandi, true);
  durum.kayitlar = [
    kisi({
      sAMAccountName: undefined,
      displayName: undefined,
      cn: undefined,
      mail: undefined,
      memberOf: USER_G,
    }),
  ];
  assert.deepEqual(await findLdapUserByUsername('Baska.Kisi'), {
    username: 'baska.kisi',
    displayName: '',
    mail: '',
    groups: [USER_G],
  });
  durum.kayitlar = [kisi({ memberOf: undefined })];
  assert.deepEqual((await findLdapUserByUsername('x')).groups, []);
  durum.kayitlar = [];
  assert.equal(await findLdapUserByUsername('yok'), null);
  assert.equal(await findLdapUserByUsername('  '), null);
  // hata: null + uyari, istemci yine kapanir
  durum.aramaHatasi = new Error('zaman asimi');
  durum.istemciler = [];
  assert.equal(await findLdapUserByUsername('ali'), null);
  assert.equal(durum.istemciler[0].kapandi, true);
  assert.ok(durum.log.warn.some((w) => /findLdapUserByUsername hatasi: zaman asimi/.test(w)));
  delete process.env.LDAP_URL;
  assert.equal(await findLdapUserByUsername('ali'), null);
});

test('LD6 e-postayla arama: biçim, yedek alanlar, fotoğraf, filtre kaçışı, null yolları', async () => {
  const { findLdapUserByEmail } = yukle();
  const foto = Buffer.from([1, 2, 3]);
  durum.kayitlar = [kisi({ telephoneNumber: '1234', thumbnailPhoto: foto })];
  assert.deepEqual(await findLdapUserByEmail('ali.veli@ornek.invalid'), {
    username: 'ali.veli',
    displayName: 'Ali Veli',
    email: 'ali.veli@ornek.invalid',
    department: 'Middleware',
    title: 'Uzman',
    phone: '1234',
    avatarUrl: `data:image/jpeg;base64,${foto.toString('base64')}`,
  });
  assert.equal(durum.aramalar.at(-1)[1].filter, '(mail=ali.veli@ornek.invalid)');
  assert.equal(durum.istemciler.at(-1).kapandi, true);
  // yedekler: posta yoksa aranan adres, birim ofis / ou, telefon cep; bos alanlar null
  durum.kayitlar = [
    kisi({
      sAMAccountName: undefined,
      displayName: '',
      cn: '',
      mail: '',
      department: '',
      physicalDeliveryOfficeName: '',
      ou: 'MW',
      title: '',
      mobile: '555',
    }),
  ];
  assert.deepEqual(await findLdapUserByEmail('x*(y)@ornek.invalid'), {
    username: '',
    displayName: '',
    email: 'x*(y)@ornek.invalid',
    department: 'MW',
    title: null,
    phone: '555',
    avatarUrl: null,
  });
  assert.equal(durum.aramalar.at(-1)[1].filter, '(mail=x\\2a\\28y\\29@ornek.invalid)');
  durum.kayitlar = [kisi({ department: '', ou: '' })];
  const p = await findLdapUserByEmail('a@ornek.invalid');
  assert.equal(p.department, null);
  assert.equal(p.phone, null);
  durum.kayitlar = [];
  assert.equal(await findLdapUserByEmail('yok@ornek.invalid'), null);
  assert.equal(await findLdapUserByEmail(''), null);
  durum.aramaHatasi = new Error('dizin kapali');
  durum.istemciler = [];
  assert.equal(await findLdapUserByEmail('a@ornek.invalid'), null);
  assert.equal(durum.istemciler[0].kapandi, true);
  assert.ok(durum.log.warn.some((w) => /findLdapUserByEmail hatasi: dizin kapali/.test(w)));
  delete process.env.LDAP_BASE_DN;
  assert.equal(await findLdapUserByEmail('a@ornek.invalid'), null);
});
