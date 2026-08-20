// server/auth/ldap.cjs — ldapts tabanli LDAP/LDAPS kimlik dogrulama
'use strict';

const fs = require('fs');
const { Client } = require('ldapts');
const { normalizeUsername } = require('./utils.cjs');

const _cache    = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function isConfigured() {
  return !!(process.env.LDAP_URL && process.env.LDAP_BASE_DN && process.env.LDAP_BIND_DN);
}

// RFC 4515 filtre kacis
function escapeFilter(str) {
  return String(str)
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00');
}

// Guvenli varsayilan: sertifika dogrulamasi ACIK. Sadece bilincli bir opt-out
// (LDAP_REJECT_UNAUTHORIZED=false, dev/self-signed ortamlar icin) bunu kapatir.
// CA yolu tanimliysa ama okunamiyorsa BAGLANMAYI REDDET — sessizce dogrulamasiz
// baglanti kurmak MITM'e acik kapi birakir (kurumsal AI kod incelemesi, review.md #1).
function buildTlsOpts() {
  const opts = { rejectUnauthorized: process.env.LDAP_REJECT_UNAUTHORIZED !== 'false' };
  const certPath = process.env.LDAP_CA_CERT_PATH;
  if (certPath) {
    opts.ca = [fs.readFileSync(certPath)]; // okunamazsa yukari firlar, baglanti kurulmaz
  }
  return opts;
}

function createClient() {
  const url    = process.env.LDAP_URL || '';
  const isLdaps = url.startsWith('ldaps://');
  return new Client({
    url,
    tlsOptions:     isLdaps ? buildTlsOpts() : undefined,
    connectTimeout: 8000,
    timeout:        8000,
  });
}

// Thumbnail fotografini data URL'e cevir (ldapts binary'yi Buffer dondurur)
function normalizePhotoToDataUrl(photo) {
  if (!photo) return null;
  try {
    let buf;
    if (Buffer.isBuffer(photo))         buf = photo;
    else if (typeof photo === 'string') buf = Buffer.from(photo, 'base64');
    else if (Array.isArray(photo))      buf = Buffer.isBuffer(photo[0]) ? photo[0] : Buffer.from(photo[0], 'base64');
    else                                buf = Buffer.from(photo);
    if (buf && buf.length > 0) {
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    }
  } catch { /* fotograf cozulemezse null */ }
  return null;
}

function determineRole(memberOf) {
  const adminGroup = (process.env.LDAP_ADMIN_GROUP || process.env.LDAP_GROUP_ADMIN_DN || '').toLowerCase().trim();
  const userGroup  = (process.env.LDAP_USER_GROUP  || '').toLowerCase().trim();
  const groups     = (Array.isArray(memberOf) ? memberOf : memberOf ? [memberOf] : []).map((g) => String(g).toLowerCase());

  // Tam esitlik veya DN-sonu eslesme — eski iki-yonlu .includes() kisa/genel bir grup DN'i
  // (or. "cn=admin") baska bir grubun DN'inin ALT DIZISI oldugunda yanlislikla Admin veriyordu
  // (ayricalik yukseltme riski). g.endsWith(',' + adminGroup) DN hiyerarsisinde "ayni RDN zinciri"
  // anlamina gelir, rastgele substring eslesmesi degil.
  if (adminGroup && groups.some((g) => g === adminGroup || g.endsWith(',' + adminGroup))) return 'Admin';
  // LDAP_USER_GROUP TANIMLIYSA bu bir beyaz liste gibi davranir: yalniz o gruba
  // uye olanlar 'User' alir, digerleri reddedilir (kurumun ozellikle kisitlamak
  // istedigi durum icin). TANIMLI DEGILSE (varsayilan/mevcut uretim durumu),
  // Admin grubunda olmayan ama gecerli AD kimlik bilgileriyle dogrulanan HERKES
  // 'User' rolu alir - LDAP_ADMIN_GROUP'un TEK BASINA tanimlanmasi (LDAP_USER_GROUP
  // olmadan) yanlislikla Admin disi TUM kullanicilari login'de reddediyordu
  // (adminGroup dolu oldugu icin eski "ikisi de bossa User ver" kacis yolu hic
  // tetiklenmiyordu) - bu portaldaki gercek bir uretim kilitlenmesiydi.
  if (userGroup) {
    return groups.some((g) => g === userGroup || g.endsWith(',' + userGroup)) ? 'User' : null;
  }
  return 'User';
}

// Ortak search attr'lari
const USER_ATTRS = [
  'dn', 'cn', 'sAMAccountName', 'mail', 'displayName',
  'memberOf', 'department', 'title', 'telephoneNumber', 'mobile',
  'thumbnailPhoto', 'jpegPhoto',
  'physicalDeliveryOfficeName', 'ou',  // G-05: additional department sources
  // 'mail' alani bos olan AD hesaplari icin: userPrincipalName cogu kurumsal AD
  // ortaminda ayni gercek e-posta ile ayni format (sAMAccountName@sirket-domaini).
  // Bos oldugunda Teams @mention lookup'i (runner.cjs withRequesterVars) sabit bir
  // varsayilan kullaniciya duser - bu SESSIZCE yanlis kisiyi etiketletir.
  'userPrincipalName',
];

async function authenticateLdap(username, password) {
  if (!isConfigured()) throw new Error('LDAP yapılandırılmamış');

  const baseDn      = process.env.LDAP_BASE_DN;
  const bindDn      = process.env.LDAP_BIND_DN;
  const bindPass    = process.env.LDAP_BIND_PASSWORD || '';
  const searchAttr  = process.env.AUTH_LDAP_SEARCH_ATTR || 'sAMAccountName';

  // ── Adim 1: Servis hesabiyla bind ───────────────────────────────────────────
  const svcClient = createClient();
  try {
    await svcClient.bind(bindDn, bindPass);
  } catch (err) {
    await svcClient.unbind().catch(() => {});
    throw new Error(`Servis hesabı bağlanamadı: ${err.message}`);
  }

  // ── Adim 2: Kullaniciyi bul ─────────────────────────────────────────────────
  let userEntry;
  try {
    const { searchEntries } = await svcClient.search(baseDn, {
      filter:     `(${searchAttr}=${escapeFilter(username)})`,
      scope:      'sub',
      attributes: USER_ATTRS,
    });
    userEntry = searchEntries[0];
  } catch (err) {
    await svcClient.unbind().catch(() => {});
    throw err;
  }
  await svcClient.unbind().catch(() => {});

  if (!userEntry || !userEntry.dn) throw new Error('ldap_user_not_found');

  // ── Adim 3: Kullanici bind (sifre dogrulama) ────────────────────────────────
  const userClient = createClient();
  try {
    await userClient.bind(userEntry.dn, password);
  } catch {
    await userClient.unbind().catch(() => {});
    throw new Error('Kullanıcı adı veya şifre hatalı');
  }
  await userClient.unbind().catch(() => {});

  // ── Adim 4: Rol ve fotograf ─────────────────────────────────────────────────
  const role = determineRole(userEntry.memberOf);
  if (!role) throw new Error('Portal erişim grubunuzda bulunamadı.');

  const rawPhoto  = userEntry.thumbnailPhoto || userEntry.jpegPhoto || null;
  const avatarUrl = normalizePhotoToDataUrl(rawPhoto);

  if (!rawPhoto) {
    console.log(`[LDAP] ${username} icin fotograf alani bulunamadi. Mevcut alanlar: ${Object.keys(userEntry).join(', ')}`);
  } else {
    const len = Buffer.isBuffer(rawPhoto) ? rawPhoto.length : String(rawPhoto).length;
    console.log(`[LDAP] ${username} fotograf: boyut=${len}b, avatarUrl=${avatarUrl ? 'ok' : 'null'}`);
  }

  const mail = String(userEntry.mail || userEntry.userPrincipalName || '');
  if (!mail) {
    // Bu, requester_email'in DEFAULT_REQUESTER'a (bkz. runner.cjs withRequesterVars)
    // dusecegi anlamina gelir - Teams @mention YANLIS bir kisiyi etiketler. Loglanir
    // ki gercekten fetch edilip edilmedigi (fallback tetiklenmis mi) DOGRULANABILSIN.
    console.warn(`[LDAP] ${username} icin ne "mail" ne "userPrincipalName" dolu - `
      + `requester_email varsayilana (DEFAULT_REQUESTER) dusecek.`);
  }

  return {
    username:    normalizeUsername(username),
    dn:          userEntry.dn,
    displayName: String(userEntry.displayName || userEntry.cn || username),
    mail,
    // G-05: fallback to physicalDeliveryOfficeName or ou if department is a raw code
    department:  String(userEntry.department || userEntry.physicalDeliveryOfficeName || userEntry.ou || ''),
    title:       String(userEntry.title || ''),
    role,
    authSource:  'ldap',
    avatarUrl,
    photoUrl:    avatarUrl, // backward compat
  };
}

// Email adresinden LDAP kullanici profili cek (nobet enrichment icin)
async function findLdapUserByEmail(email) {
  if (!email || !isConfigured()) return null;

  const baseDn   = process.env.LDAP_BASE_DN;
  const bindDn   = process.env.LDAP_BIND_DN;
  const bindPass = process.env.LDAP_BIND_PASSWORD || '';

  const client = createClient();
  try {
    await client.bind(bindDn, bindPass);
    const { searchEntries } = await client.search(baseDn, {
      filter:     `(mail=${escapeFilter(email)})`,
      scope:      'sub',
      attributes: USER_ATTRS,
    });
    const user = searchEntries[0];
    if (!user) return null;

    const rawPhoto  = user.thumbnailPhoto || user.jpegPhoto || null;
    const avatarUrl = normalizePhotoToDataUrl(rawPhoto);

    return {
      username:    String(user.sAMAccountName || ''),
      displayName: String(user.displayName || user.cn || ''),
      email:       String(user.mail || email),
      // G-05: physicalDeliveryOfficeName or ou as fallback if department is empty/numeric
      department:  String(user.department || user.physicalDeliveryOfficeName || user.ou || '') || null,
      title:       String(user.title || '') || null,
      phone:       String(user.telephoneNumber || user.mobile || '') || null,
      avatarUrl,
    };
  } catch (err) {
    console.warn('[LDAP] findLdapUserByEmail hatasi:', err.message);
    return null;
  } finally {
    await client.unbind().catch(() => {});
  }
}

async function authenticate(username, password) {
  // Local users bypass LDAP entirely — prevents collisions when a real LDAP user
  // has the same name as a configured local fallback account.
  const localAdmin = process.env.LOCAL_ADMIN_USER ?? 'admin';
  const localUser  = process.env.LOCAL_USER       ?? 'user';
  if (username === localAdmin || username === localUser) {
    return authenticateLocal(username, password);
  }

  if (isConfigured()) {
    try {
      // module.exports uzerinden cagrilir (dogrudan yerel referans degil) — testlerin
      // gercek bir LDAP baglantisi kurmadan authenticateLdap'i mock'layabilmesi icin.
      const result = await module.exports.authenticateLdap(username, password);
      _cache.set(username.toLowerCase(), { ...result, ts: Date.now() });
      return result;
    } catch (ldapErr) {
      const msg  = ldapErr.message || '';
      console.warn('[LDAP] Auth hatasi:', msg);

      const isNetworkErr =
        ldapErr.code === 'ECONNREFUSED' ||
        ldapErr.code === 'ETIMEDOUT'    ||
        ldapErr.code === 'ENOTFOUND'    ||
        ldapErr.code === 'ECONNRESET'   ||
        msg.toLowerCase().includes('connect') ||
        msg.toLowerCase().includes('timeout') ||
        msg.includes('Servis hesabı bağlanamadı');

      const isNotFound = msg === 'ldap_user_not_found';

      // isNotFound: LDAP'a basariyla ulasildi VE arama sonucu bos dondu — bu kod-sahipli,
      // kesin bir sentinel (ldapts'in belirsiz bir hatasi degil), gercek bir ag hatasindan
      // FARKLI bir anlam tasir. Eskiden bu durumda da yerel hesaplara dusuluyordu; "kullanici
      // LDAP'ta yok" ile "LDAP'a ulasilamiyor" ayni fallback davranisini paylasiyordu — bu,
      // yukaridaki bypass kontrolu (satir 204-208) ile authenticateLocal'in kendi ic kontrolu
      // arasindaki degisken-okuma farkina (?? vs ||) bagli olarak istenmeyen bir yerel-hesap
      // deneme yolu acabiliyordu (kurumsal AI kod incelemesi, review.md #14). Artik SADECE
      // gercek ag erisilemezligi (isNetworkErr) yerel hesaba dusuyor; kullanici-yok sinyali
      // KESIN kabul edilip dogrudan reddedilir.
      if (!isNetworkErr) throw new Error('Kullanıcı adı veya şifre hatalı');

      console.warn('[LDAP] Aga erisilemiyor, yerel hesaplara fallback...');
    }
  }
  return authenticateLocal(username, password);
}

function authenticateLocal(username, password) {
  const localAdmin     = process.env.LOCAL_ADMIN_USER || 'admin';
  const localUser      = process.env.LOCAL_USER       || 'user';
  // GUVENLIK: sifre env degiskeni BOSSA (set edilmemisse) hesap ASLA eslesmez — eskiden
  // `|| 'admin'` / `|| 'user'` fallback'i vardi, yani sifre alanlari doldurulmadigi surece
  // production'da bile herkesce bilinen admin/admin, user/user ile Admin girisi calisiyordu
  // (LDAP tamamen calisir durumdayken bile, bu fonksiyon LDAP'tan ONCE kontrol edildigi icin).
  const localAdminPass = process.env.LOCAL_ADMIN_PASS || '';
  const localUserPass  = process.env.LOCAL_USER_PASS  || '';

  if (username === localAdmin && localAdminPass && password === localAdminPass) {
    return { username, dn: null, displayName: username, mail: '', role: 'Admin', authSource: 'local', avatarUrl: null, photoUrl: null };
  }
  if (username === localUser && localUserPass && password === localUserPass) {
    return { username, dn: null, displayName: username, mail: '', role: 'User',  authSource: 'local', avatarUrl: null, photoUrl: null };
  }
  throw new Error('Kullanıcı adı veya şifre hatalı');
}

function clearCache(username) {
  if (username) _cache.delete(username.toLowerCase());
  else _cache.clear();
}

module.exports = {
  authenticate, authenticateLocal, isConfigured, clearCache, findLdapUserByEmail,
  // test-only (ayrica authenticate() ic-cagrisi da bunun uzerinden gecer — bkz. yukarida):
  // gercek LDAP baglantisi kurmadan authenticate()'in fallback mantigini dogrulamak icin.
  authenticateLdap,
};
