// server/ansible/long-job-cancel-token.cjs - otomatik iptal icin AWX sunucusu basina
// "iptal token'i" deposu.
//
// NEDEN (kullanici, 2026-10-03): "Portal'in AWX servis kullanicisina yetki verme hakkim yok.
// Simdilik kendi onurdemir3 kullanicimin token'ini Portal admin panelinden vereyim; uzun
// suren isleri onunla iptal et." Uretimde otomatik iptal 403 aliyordu (servis kullanicisi
// template Admin degil). Bu token GECICI bir cozumdur: servis kullanicisina Admin rolu
// verilince silinmelidir (ekran bunu soyler).
//
// KAPSAM: token YALNIZ iki yerde kullanilir - long-job-cancel otomatik iptal cagrisi ve
// yetki on kontrolu (user_capabilities, token SAHIBINE gore). ScaleX/LogX/Telnet ve diger
// tum Portal AWX cagrilari servis kullanicisiyla DEGISMEDEN calisir (bu modul onlara
// hic dokunmaz). Token tanimli degilse eski davranis.
//
// SAKLAMA: env-overrides.cjs'teki AYNI sifreleme (ENV_OVERRIDES_ENCRYPTION_KEY,
// AES-256-GCM, 'enc:v1:' onek). Anahtar tanimli degilse kayit REDDEDILIR - encryptSecretValue'nun
// dev/test duz-metin yedegine dusulmez. DB'de (portal_config_blobs 'longjob-cancel-tokens')
// yalniz sifreli deger durur; okurken 'enc:v1:' onekli olmayan kayit YOK sayilir.
//
// OLCULEMEDI != YOK: kayit (DB) okunamazsa ve bellekte son gecerli kayit da yoksa
// getCancelAuth servis kullanicisina DUSMEZ; 'store_unreadable' firlatir (kalici DEGIL):
// iptal o turda DENENMEZ, kayit okununca yeniden denenir. (Eskiden { via: 'service' }
// donup servis kullanicisiyla 403 aliyor ve isi kalici "iptal edilemedi" sayiyordu.)
//
// ADRES BAGLAMA: token kaydedildigi AWX adresine (origin + API tabani; sir DEGIL) baglidir.
// Sunucu numarasinin adresi sonradan degisirse (DB/env) token yeni adrese GONDERILMEZ:
// 'server_mismatch' (kalici) -> Teams + denetim + ekran "token bu AWX adresi icin
// kaydedilmedi"; Admin token'i yeniden girer. Baglamasi olmayan kayit da kullanilmaz.
//
// SIZINTI YOK: deger hicbir HTTP yanitina, loga, denetime, Teams'e GITMEZ. publicView()
// yalniz "tanimli / degil", sahip kullanici adi, kim/ne zaman girdi ve son dogrulama
// sonucunu doner. knownSecrets() yalniz redaksiyon icindir (runner.redactSecrets).
'use strict';

const BLOB_NAME = 'longjob-cancel-tokens';
const CACHE_TTL_MS = 60 * 1000;
const TOKEN_MIN_LEN = 8;
const TOKEN_MAX_LEN = 512;
const RETIRED_MAX = 20;

let _entries = null; // Map<serverId, entry> - son GECERLI okuma (null = hic okunamadi)
let _cacheAt = 0;
let _readError = null; // { at, message } | null
const _plain = new Map(); // serverId -> { enc, token } (cozulmus deger; yalniz bellek)
const _retired = []; // silinen/degistirilen degerler: gec gelen log satirlari da maskelensin
const _runtime = new Map(); // serverId -> { at, httpStatus, message, tokenEnc } (iptal yolunda 401)
let _writeChain = Promise.resolve();

const iso = () => new Date().toISOString();
const str = (v, max = 200) => (v == null ? '' : String(v)).slice(0, max);
const cryptoMod = () => require('../db/env-overrides.cjs');

function codeErr(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

// -- Adres baglama (sir DEGIL) -----------------------------------------------------
const DEFAULT_API_BASE = '/api/v2';

function normApiBase(value) {
  const v = String(value || '').trim();
  if (!v) return DEFAULT_API_BASE;
  const withSlash = v.startsWith('/') ? v : '/' + v;
  return withSlash.replace(/[/]+$/, '') || DEFAULT_API_BASE;
}

/**
 * Sunucunun AWX adresi: origin (kullanici:sifre@ ICERMEZ) + API tabani. runner istegi
 * `new URL(mutlakYol, server.url)` ile kurar: url'deki yol zaten atilir, yani istegin
 * gittigi yer tam olarak budur. Okunamazsa null.
 */
function serverFingerprint(server) {
  if (!server || !server.url) return null;
  let origin;
  try {
    origin = new URL(String(server.url).trim()).origin;
  } catch {
    return null;
  }
  if (!origin || origin === 'null') return null;
  return `${origin.toLowerCase()}${normApiBase(server.apiBase)}`;
}

/** Kayit bu sunucu adresine bagli mi? Degilse neden (metin) doner; bagliysa null. */
function bindingProblem(entry, server) {
  const have = serverFingerprint(server);
  if (!server) return "bu AWX sunucusu Portal'da artık tanımlı değil";
  if (!have) return 'AWX sunucusunun adresi okunamadı';
  if (!entry.bind) return "kayıtta token'ın hangi AWX adresi için girildiği yok";
  if (entry.bind !== have) return `token ${entry.bind} adresi için girildi, sunucu şimdi ${have} adresini gösteriyor`;
  return null;
}

function mismatchMessage(entry, why) {
  return (
    `İPTAL TOKEN'I BU AWX ADRESİ İÇİN KAYDEDİLMEDİ (${entry.owner || 'sahibi bilinmiyor'}): ${why} — kişisel token bu adrese ` +
    "GÖNDERİLMEDİ. Admin ekranından token'ı bu sunucu için yeniden girin ya da silin."
  );
}

// -- Redaksiyon -----------------------------------------------------------------
function knownSecrets() {
  const out = [];
  for (const v of _plain.values()) if (v && v.token) out.push(v.token);
  for (const t of _retired) out.push(t);
  return out;
}

function retire(token) {
  if (!token) return;
  if (!_retired.includes(token)) _retired.push(token);
  if (_retired.length > RETIRED_MAX) _retired.splice(0, _retired.length - RETIRED_MAX);
}

/** Bilinen iptal token'larini (ve verilen ek degerleri) metinden maskeler. */
function redact(text, extra = []) {
  let s = String(text == null ? '' : text);
  for (const v of [...knownSecrets(), ...extra]) {
    const x = v == null ? '' : String(v);
    if (x.length >= 6) s = s.split(x).join('***');
  }
  return s.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1***');
}

// -- Okuma ------------------------------------------------------------------------
function normVerify(v) {
  if (!v || typeof v !== 'object') return null;
  return {
    at: str(v.at, 40) || null,
    ok: v.ok === true,
    httpStatus: Number(v.httpStatus) || null,
    result: str(v.result, 40) || (v.ok === true ? 'gecerli' : 'gecersiz'),
    message: str(v.message, 500) || null,
    by: str(v.by, 100) || null,
  };
}

function parseBlob(raw) {
  const { ENC_PREFIX } = cryptoMod();
  const map = new Map();
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const servers = obj && typeof obj === 'object' && obj.servers && typeof obj.servers === 'object' ? obj.servers : {};
  for (const [k, v] of Object.entries(servers)) {
    const id = Number(k);
    if (!Number.isInteger(id) || id < 0) continue;
    // Yalniz SIFRELI deger kabul edilir: onek yoksa kayit yok sayilir (duz metin asla kullanilmaz).
    if (!v || typeof v.tokenEnc !== 'string' || !v.tokenEnc.startsWith(ENC_PREFIX)) continue;
    map.set(id, {
      tokenEnc: v.tokenEnc,
      owner: str(v.owner, 150) || null,
      ownerId: Number(v.ownerId) || null,
      ownerIsSuperuser: v.ownerIsSuperuser === true,
      bind: str(v.bind, 300) || null,
      setBy: str(v.setBy, 150) || null,
      setAt: str(v.setAt, 40) || null,
      lastVerify: normVerify(v.lastVerify),
    });
  }
  return map;
}

function serialize(map) {
  const servers = {};
  for (const [id, e] of map) servers[String(id)] = e;
  return JSON.stringify({ servers });
}

function setEntries(map) {
  _entries = map;
  _cacheAt = Date.now();
  // Silinen sunucularin cozulmus degerleri bellekten atilir (redaksiyon icin emekliye).
  for (const [id, p] of [..._plain]) {
    const e = map.get(id);
    if (!e || e.tokenEnc !== p.enc) {
      retire(p.token);
      _plain.delete(id);
    }
  }
  for (const [id, r] of [..._runtime]) {
    const e = map.get(id);
    if (!e || e.tokenEnc !== r.tokenEnc) _runtime.delete(id);
  }
}

async function readFresh(db) {
  const { rows } = await db.query(`SELECT data FROM portal_config_blobs WHERE name = $1`, [BLOB_NAME]);
  return parseBlob(rows && rows[0] ? rows[0].data : null);
}

/**
 * Kayitlari okur (60 sn onbellek). DB hatasinda SESSIZ DEGIL: son gecerli kayit doner,
 * hata console.error + readError; hic gecerli kayit yoksa entries null (= OLCULEMEDI).
 */
async function load(db, { fresh = false } = {}) {
  if (!fresh && _entries && Date.now() - _cacheAt < CACHE_TTL_MS) return { entries: _entries, error: null };
  try {
    const m = await readFresh(db);
    setEntries(m);
    _readError = null;
    return { entries: m, error: null };
  } catch (e) {
    _readError = { at: iso(), message: redact((e && e.message) || String(e)).slice(0, 500) };
    console.error(
      `[LongJobCancelToken] iptal token kaydi okunamadi (portal_config_blobs '${BLOB_NAME}'); ` +
        (_entries ? 'son gecerli kayitla devam ediliyor' : 'hic gecerli kayit yok (olculemedi)') +
        ':',
      _readError.message,
    );
    return { entries: _entries, error: _readError };
  }
}

function decryptFor(serverId, entry) {
  const cached = _plain.get(serverId);
  if (cached && cached.enc === entry.tokenEnc) return cached.token;
  const token = cryptoMod().decryptSecretValue(entry.tokenEnc);
  if (!token) throw new Error('bos deger');
  _plain.set(serverId, { enc: entry.tokenEnc, token });
  return token;
}

function unreadableErr(error) {
  return codeErr(
    'store_unreadable',
    "İPTAL TOKEN KAYDI OKUNAMADI (DB) — bu sunucuda iptal token'ı tanımlı mı ÖLÇÜLEMEDİ; iptal DENENMEDİ " +
      `(servis kullanıcısına düşülmez; kayıt okununca yeniden denenir): ${error ? error.message : 'okunamadı'}`,
    { tokenStoreUnreadable: true, permanent: false },
  );
}

/**
 * Otomatik iptal / yetki on kontrolu icin kimlik:
 *   { via: 'service' }                                  token tanimli degil (eski davranis)
 *   { via: 'cancel_token', token, owner }               token tanimli ve bu sunucu adresine bagli
 * FIRLATIR (servis kullanicisina SESSIZCE dusulmez - Admin token'in kullanilmasini istedi):
 *   tokenStoreUnreadable (kalici DEGIL)  kayit OKUNAMADI ve bellekte son gecerli kayit yok
 *   tokenServerMismatch  (kalici)        sunucunun adresi kayittakinden farkli (token gonderilmez)
 *   tokenUndecryptable   (kalici)        anahtar eksik/degismis
 * `opts.server`: runner.getServers() satiri (url, apiBase) - adres baglamasi icin ZORUNLU.
 */
async function getCancelAuth(db, serverId, { server = null } = {}) {
  const id = Number(serverId);
  const { entries, error } = await load(db);
  if (!entries) throw unreadableErr(error);
  const e = entries.get(id);
  if (!e) return { via: 'service' };
  const why = bindingProblem(e, server);
  if (why) {
    const message = mismatchMessage(e, why);
    _runtime.set(id, { at: iso(), httpStatus: null, message, tokenEnc: e.tokenEnc, reason: 'adres_degisti' });
    throw codeErr('server_mismatch', message, { tokenServerMismatch: true, permanent: true, owner: e.owner || null });
  }
  let token;
  try {
    token = decryptFor(id, e);
  } catch (err) {
    const message =
      `İPTAL TOKEN'I ÇÖZÜLEMEDİ (${e.owner || 'sahibi bilinmiyor'}): ENV_OVERRIDES_ENCRYPTION_KEY eksik ya da değişmiş ` +
      `olabilir (${redact((err && err.message) || String(err)).slice(0, 200)}). Admin ekranından token'ı yeniden girin ya da silin.`;
    // Durum/ekran: token tanimli ama KULLANILAMIYOR (sessiz degil).
    _runtime.set(id, { at: iso(), httpStatus: null, message, tokenEnc: e.tokenEnc, reason: 'cozulemedi' });
    throw codeErr('undecryptable', message, { tokenUndecryptable: true, permanent: true, owner: e.owner || null });
  }
  const rt = _runtime.get(id);
  if (rt && (rt.reason === 'cozulemedi' || rt.reason === 'adres_degisti')) _runtime.delete(id);
  return { via: 'cancel_token', token, owner: e.owner, entry: { tokenEnc: e.tokenEnc } };
}

/**
 * Kuru calistirma: token COZULMEDEN gercek taramada iptalin hangi kimlikle yapilacagi.
 * @returns {Promise<{ state: 'service'|'token'|'mismatch'|'unreadable', owner?: string|null, message?: string }>}
 */
async function describeCancelAuth(db, serverId, { server = null } = {}) {
  const { entries, error } = await load(db);
  if (!entries) return { state: 'unreadable', message: unreadableErr(error).message };
  const e = entries.get(Number(serverId));
  if (!e) return { state: 'service' };
  const why = bindingProblem(e, server);
  if (why) return { state: 'mismatch', owner: e.owner || null, message: mismatchMessage(e, why) };
  return { state: 'token', owner: e.owner || '?' };
}

/** Sunucu basina kayit imzasi (sifreli deger; COZULMEZ, disari verilmez): degisim tespiti icin. */
async function signatures(db) {
  const { entries } = await load(db);
  if (!entries) return null;
  return new Map([...entries].map(([id, e]) => [id, e.tokenEnc]));
}

// -- Yazma ------------------------------------------------------------------------
/** Ayni ornekte yazmalar sirali; her yazma DB'den TAZE okur (baska ornegin kaydi ezilmesin). */
function mutate(db, fn) {
  const run = _writeChain.then(async () => {
    const map = await readFresh(db);
    const changed = fn(map);
    if (changed === false) {
      setEntries(map);
      return map;
    }
    const data = serialize(map);
    const ex = await db.query(`SELECT 1 FROM portal_config_blobs WHERE name = $1`, [BLOB_NAME]);
    if (ex.rows && ex.rows.length) {
      await db.query(`UPDATE portal_config_blobs SET data = $2, updated_at = GETUTCDATE() WHERE name = $1`, [BLOB_NAME, data]);
    } else {
      await db.query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [BLOB_NAME, data]);
    }
    setEntries(map);
    _readError = null;
    return map;
  });
  _writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function encryptionReady() {
  try {
    return !!cryptoMod().getEncryptionKey();
  } catch {
    return false;
  }
}

/** Bicim kontrolu. Hata mesaji DEGERI ICERMEZ. */
function validateTokenShape(token) {
  if (typeof token !== 'string') throw codeErr(400, "Token metin olmalı.");
  const t = token.trim();
  if (!t) throw codeErr(400, "Token boş olamaz.");
  if (t.length < TOKEN_MIN_LEN || t.length > TOKEN_MAX_LEN) {
    throw codeErr(400, `Token uzunluğu ${TOKEN_MIN_LEN}-${TOKEN_MAX_LEN} karakter olmalı.`);
  }
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || /\s/.test(t[i])) {
      throw codeErr(400, 'Token boşluk ya da kontrol karakteri içeremez.');
    }
  }
  return t;
}

/**
 * Token'i dogrular (verify: GET /api/v2/me/ -> sahip) ve SIFRELI kaydeder.
 * SIRA: anahtar yoksa AWX'e bile gidilmez (token gereksiz yere dolasmasin).
 * Ikinci arguman: { serverId, server, token, by, verify: async (token) => { username, id, isSuperuser } }.
 * `server` (runner.getServers() satiri): kayit bu adrese BAGLANIR (getCancelAuth karsilastirir).
 * @returns {Promise<{ owner, ownerIsSuperuser, replacedOwner }>}
 */
async function saveToken(db, { serverId, server, token, by, verify }) {
  const id = Number(serverId);
  const bind = serverFingerprint(server);
  if (!bind) throw codeErr(404, 'AWX sunucusunun adresi okunamadı — token kaydedilmedi.', { reason: 'no_server' });
  if (!encryptionReady()) {
    throw codeErr(
      400,
      "ENV_OVERRIDES_ENCRYPTION_KEY tanımlı değil: iptal token'ı şifrelenmeden saklanamaz — kayıt REDDEDİLDİ " +
        '(düz metin saklanmaz). Operatör anahtarı tanımlayıp Portal\'ı yeniden başlattıktan sonra tekrar deneyin.',
      { reason: 'no_key' },
    );
  }
  const t = validateTokenShape(token);
  let who;
  try {
    who = await verify(t);
  } catch (e) {
    const status = e && e.status;
    const msg = redact((e && e.message) || String(e), [t]).slice(0, 300);
    if (status === 401 || status === 403) {
      throw codeErr(400, `Token geçersiz (AWX ${status}) — kaydedilmedi. AWX yanıtı: ${msg}`, { reason: 'invalid', httpStatus: status });
    }
    throw codeErr(
      502,
      `Token doğrulanamadı (ölçülemedi; geçersiz DEMEK DEĞİL) — kaydedilmedi: ${msg}`,
      { reason: 'unverified', httpStatus: status || null },
    );
  }
  if (!who || !who.username) {
    throw codeErr(502, "Token doğrulanamadı: AWX /me yanıtında kullanıcı adı yok — kaydedilmedi.", { reason: 'unverified' });
  }
  const tokenEnc = cryptoMod().encryptSecretValue(t);
  if (typeof tokenEnc !== 'string' || !tokenEnc.startsWith(cryptoMod().ENC_PREFIX) || tokenEnc.includes(t)) {
    // Savunma: env-overrides'in duz-metin yedegi ya da beklenmedik bicim -> YAZMA.
    throw codeErr(500, "Token şifrelenemedi — kayıt REDDEDİLDİ (düz metin saklanmaz).", { reason: 'no_key' });
  }
  const now = iso();
  let replacedOwner = null;
  await mutate(db, (map) => {
    const prev = map.get(id);
    replacedOwner = prev ? prev.owner : null;
    map.set(id, {
      tokenEnc,
      owner: str(who.username, 150),
      ownerId: Number(who.id) || null,
      ownerIsSuperuser: who.isSuperuser === true,
      bind,
      setBy: str(by, 150) || null,
      setAt: now,
      lastVerify: { at: now, ok: true, httpStatus: 200, result: 'gecerli', message: null, by: str(by, 150) || null },
    });
  });
  _plain.set(id, { enc: tokenEnc, token: t });
  _runtime.delete(id);
  return { owner: str(who.username, 150), ownerIsSuperuser: who.isSuperuser === true, replacedOwner };
}

/** @returns {Promise<{ deleted: boolean, owner: string|null }>} */
async function deleteToken(db, serverId) {
  const id = Number(serverId);
  let owner = null;
  let deleted = false;
  await mutate(db, (map) => {
    const prev = map.get(id);
    if (!prev) return false;
    owner = prev.owner;
    deleted = true;
    map.delete(id);
    return true;
  });
  const p = _plain.get(id);
  if (p) retire(p.token);
  _plain.delete(id);
  _runtime.delete(id);
  return { deleted, owner };
}

/** Son dogrulama sonucunu yazar - yalniz kayit hala AYNI token'sa (arada degistiyse dokunmaz). */
async function recordVerify(db, serverId, tokenEnc, verifyResult) {
  const id = Number(serverId);
  await mutate(db, (map) => {
    const e = map.get(id);
    if (!e || e.tokenEnc !== tokenEnc) return false;
    e.lastVerify = normVerify(verifyResult);
    return true;
  });
}

/**
 * Kayitli token'i yeniden dogrular (GET /api/v2/me/). Sonuc kalici yazilir.
 * Sunucunun adresi kayittakinden farkliysa AWX'e GIDILMEZ: { ok: false, addressChanged: true }.
 * @returns {Promise<{ ok, owner, httpStatus, message, measured, addressChanged?: boolean }>}
 */
async function verifyStored(db, serverId, { by, verify, server = null }) {
  const id = Number(serverId);
  const { entries, error } = await load(db, { fresh: true });
  if (!entries) throw codeErr(503, `İptal token kaydı okunamadı (DB): ${error ? error.message : ''}`);
  const e = entries.get(id);
  if (!e) throw codeErr(404, 'Bu sunucu için iptal token\'ı tanımlı değil.');
  // Adres degistiyse token YENI adrese gonderilmez (dogrulama da bir gonderimdir).
  const why = bindingProblem(e, server);
  if (why) {
    const message = mismatchMessage(e, why);
    _runtime.set(id, { at: iso(), httpStatus: null, message, tokenEnc: e.tokenEnc, reason: 'adres_degisti' });
    return { ok: false, measured: true, owner: e.owner, httpStatus: null, message, addressChanged: true };
  }
  let token;
  try {
    token = decryptFor(id, e);
  } catch (err) {
    const message = `Token çözülemedi (ENV_OVERRIDES_ENCRYPTION_KEY eksik ya da değişmiş olabilir): ${redact(err && err.message).slice(0, 200)}`;
    await recordVerify(db, id, e.tokenEnc, { at: iso(), ok: false, result: 'cozulemedi', message, by }).catch(() => {});
    return { ok: false, measured: true, owner: e.owner, httpStatus: null, message };
  }
  try {
    const who = await verify(token);
    if (!who || !who.username) throw new Error("AWX /me yanıtında kullanıcı adı yok");
    const ownerChanged = e.owner && who.username !== e.owner;
    const message = ownerChanged ? `Token sahibi değişmiş görünüyor: kayıtta ${e.owner}, AWX ${who.username} diyor.` : null;
    await recordVerify(db, id, e.tokenEnc, { at: iso(), ok: true, httpStatus: 200, result: 'gecerli', message, by });
    _runtime.delete(id);
    return { ok: true, measured: true, owner: who.username, httpStatus: 200, message };
  } catch (err) {
    const status = err && err.status;
    const msg = redact((err && err.message) || String(err), [token]).slice(0, 300);
    if (status === 401 || status === 403) {
      const message = `İPTAL TOKEN'I GEÇERSİZ (AWX ${status}): ${msg}`;
      await recordVerify(db, id, e.tokenEnc, { at: iso(), ok: false, httpStatus: status, result: 'gecersiz', message, by }).catch(() => {});
      _runtime.set(id, { at: iso(), httpStatus: status, message, tokenEnc: e.tokenEnc });
      return { ok: false, measured: true, owner: e.owner, httpStatus: status, message };
    }
    // Ag/AWX hatasi: OLCULEMEDI. "gecersiz" DENMEZ, kalici kayit da degismez.
    return { ok: false, measured: false, owner: e.owner, httpStatus: status || null, message: `Ölçülemedi (geçersiz DEMEK DEĞİL): ${msg}` };
  }
}

/**
 * Iptal yolunda 401: token iptal edilmis/suresi dolmus. Bellekte isaretlenir (durum ekrani
 * "IPTAL TOKEN'I GECERSIZ") ve son dogrulama sonucu kalici yazilir (best-effort).
 */
async function markInvalid(db, serverId, { tokenEnc, httpStatus, message }) {
  const id = Number(serverId);
  const at = iso();
  const m = redact(message).slice(0, 500);
  _runtime.set(id, { at, httpStatus: httpStatus || 401, message: m, tokenEnc: tokenEnc || null });
  if (!tokenEnc || !db) return;
  try {
    await recordVerify(db, id, tokenEnc, { at, ok: false, httpStatus: httpStatus || 401, result: 'gecersiz', message: m, by: 'otomatik iptal' });
  } catch (e) {
    console.error('[LongJobCancelToken] gecersiz token sonucu kaydedilemedi:', redact((e && e.message) || String(e)));
  }
}

// -- Gorunum (DEGER ICERMEZ) ----------------------------------------------------
function entryView(id, e, server) {
  const rt = _runtime.get(id);
  const invalidRt = !!(rt && e && rt.tokenEnc && rt.tokenEnc === e.tokenEnc);
  const lv = e ? e.lastVerify : null;
  // server verilmediyse (durum ekrani) adres OLCULMEZ: null ("degismedi" DENMEZ).
  const why = e && server !== undefined ? bindingProblem(e, server) : null;
  return {
    serverId: id,
    defined: !!e,
    owner: e ? e.owner : null,
    ownerIsSuperuser: e ? !!e.ownerIsSuperuser : false,
    setBy: e ? e.setBy : null,
    setAt: e ? e.setAt : null,
    lastVerify: lv,
    boundTo: e ? e.bind || null : null,
    addressChanged: e && server !== undefined ? !!why : null,
    addressMessage: why ? mismatchMessage(e, why) : null,
    invalid: !!e && (invalidRt || !!why || !!(lv && lv.ok === false && lv.result === 'gecersiz')),
    invalidInfo: invalidRt
      ? { at: rt.at, httpStatus: rt.httpStatus, message: rt.message, reason: rt.reason || 'gecersiz' }
      : null,
  };
}

/**
 * Admin ekrani: sunucu basina { tanimli mi, sahip, kim/ne zaman, son dogrulama }.
 * `servers`: runner.getServers() ({ id, name, url, apiBase }; url yalniz adres karsilastirmasi
 * icin kullanilir, yanita yalniz origin+taban girer). Portal'da artik tanimli olmayan sunucunun
 * kaydi da listelenir (silinebilsin).
 */
async function publicView(db, servers = []) {
  const { entries, error } = await load(db);
  const map = entries || new Map();
  const out = [];
  const seen = new Set();
  for (const s of servers) {
    const id = Number(s.id);
    seen.add(id);
    const srv = s.url ? { url: s.url, apiBase: s.apiBase } : undefined;
    out.push({ ...entryView(id, map.get(id), srv), serverName: s.name || `sunucu ${id}`, serverKnown: true });
  }
  for (const [id, e] of map) {
    if (seen.has(id)) continue;
    out.push({ ...entryView(id, e), serverName: `sunucu ${id}`, serverKnown: false });
  }
  return {
    encryptionKeyConfigured: encryptionReady(),
    readError: error || _readError || null,
    measured: !!entries,
    servers: out,
  };
}

/** Durum ekrani (bellek): yalniz TANIMLI token'lar; deger yok. */
function statusView() {
  if (!_entries) return { measured: false, readError: _readError, tokens: [] };
  return {
    measured: true,
    readError: _readError,
    tokens: [..._entries].map(([id, e]) => entryView(id, e)),
  };
}

function _reset() {
  _entries = null;
  _cacheAt = 0;
  _readError = null;
  _plain.clear();
  _retired.length = 0;
  _runtime.clear();
  _writeChain = Promise.resolve();
}

function _expireCache() {
  _cacheAt = 0;
}

module.exports = {
  BLOB_NAME,
  TOKEN_MIN_LEN,
  TOKEN_MAX_LEN,
  encryptionReady,
  validateTokenShape,
  getCancelAuth,
  signatures,
  saveToken,
  deleteToken,
  verifyStored,
  markInvalid,
  publicView,
  statusView,
  describeCancelAuth,
  serverFingerprint,
  knownSecrets,
  redact,
  load,
  _reset,
  _expireCache,
};
