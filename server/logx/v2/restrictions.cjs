// server/logx/v2/restrictions.cjs — Varsayilan-acik yetkilendirme modeli. Bir kaynagin
// (Legacy app adi veya OCP namespace anahtari) logx_v2_restrictions'ta satiri YOKSA tum
// authenticated kullanicilara aciktir; satiri VARSA yalnizca logx_v2_restriction_grants'te
// kullanici adi bulunanlar (+ her zaman Admin) erisebilir. Mevcut logx_permissions'in
// (fail-closed, her host icin acik izin ZORUNLU) kasitli tersi — kullanici onayli karar.
'use strict';

const db = require('../../db/index.cjs');

// resourceType: 'legacy_app' | 'ocp_namespace' | 'ocp_app' | 'env'
// `env` (2026-10-01): ORTAM birimi — anahtar ortam etiketi, BUYUK harf ("PROD").
//   OCP'de istegin `env` alani, Legacy'de dosyanin EAR son-ekinden turetilen etiket
//   (logx_env_suffix_map). Kaynak kuraliyla BIRLIKTE (AND) uygulanir; o da
//   varsayilan-acik. Anahtar burada normalize edilir — cagiran "prod" de
//   "PROD" de gecse ayni satira eslesir.
// resourceKey: Legacy icin app adi (orn. "GBCEPPOSDASHBOARD"), OCP namespace icin
//   "<tenant>/<env>/<cluster>/<namespace>", OCP uygulamasi icin
//   "<tenant>/<env>/<cluster>/<namespace>/<app>" birlesik anahtari.
//
// GRANT IKI TURLU OLABILIR (2026-08-29): kullanici adi VEYA AD grubu (group_dn).
// Grup grant'lari AYRI bir tabloda (`logx_v2_restriction_group_grants`). Mevcut
// `logx_v2_restriction_grants` tablosunda `username NOT NULL` ve
// `UNIQUE(restriction_id, username)` var; grup icin o kolonu NULL'a acmak, MSSQL'in
// UNIQUE indeksi TEK bir NULL'a izin verdigi icin ayni kisitlamaya IKINCI bir grup
// eklenmesini engellerdi. Paylasilan bir URETIM tablosunun kisitini degistirmek yerine
// ayri tablo: LogX/OpsX/Telnet tarafinda sifir regresyon riski.
// Grup uyeligi oturumdaki `user.groups` listesinden okunur (bkz. server/auth/ldap.cjs —
// `memberOf` normalize edilip oturuma yazilir). Ekip degisiklikleri AD'de yonetilir,
// portalda ikinci bir uyelik kopyasi tutulmaz; kisi ekipten cikinca erisimi kendiliginden
// biter. LDAP kapaliysa (yerel kullanici) `groups` bos gelir ve YALNIZCA kullanici adi
// grant'lari calisir — mevcut davranis birebir korunur.
//
// GENISLETICIDIR, DARALTICI DEGIL: grup grant'i eklenmesi bugun izin verilen hicbir
// durumu kapatmaz. Varsayilan-acik semantigi de aynen durur.

// Oturumdaki AD gruplarini karsilastirmaya hazir hale getirir. DN'ler kaynaga gore
// buyuk/kucuk harf ve bosluk acisindan degisebiliyor.
function normalizedGroups(user) {
  const raw = Array.isArray(user?.groups) ? user.groups : [];
  return new Set(raw.map((g) => String(g || '').trim().toLowerCase()).filter(Boolean));
}

// Bir grant satiri bu kullaniciyi kapsiyor mu?
function grantMatches(row, username, groups) {
  if (row.username && String(row.username).toLowerCase() === String(username).toLowerCase()) return true;
  const dn = row.group_dn ? String(row.group_dn).trim().toLowerCase() : '';
  return !!dn && groups.has(dn);
}
// ── GRUP GRANT TABLOSU: DAYANIKLILIK KATMANI ────────────────────────────────
//
// Bu modul LogX, OpsX, Telnet ve ScaleX tarafindan PAYLASILIYOR. `logx_v2_restriction_
// group_grants` yeni bir tablo ve `mssql-setup.cjs` tablo olusturma hatalarini
// `console.warn` ile YUTUYOR. Sorguya kosulsuz konsaydi, tablo herhangi bir sebeple
// olusmadiginda (izin, bayat sema, elle mudahale) dort modulun de yetki sorgusu
// "Invalid object name" ile patlar ve LogX/OpsX/Telnet 500 verirdi — ScaleX'in
// getirdigi bir degisiklik, ONUNLA ILGISI OLMAYAN uc uretim modulunu dusururdu.
//
// Cozum: tabloyu ilk hatada bir kez isaretle ve grup grant'i OLMADAN devam et.
// YON ONEMLI — bu fail-CLOSED bir gerileme: grup uzerinden yetkilenmis kullanici
// erisimini KAYBEDER, kimse fazladan erisim KAZANMAZ. Kullanici adi grant'lari ve
// varsayilan-acik semantigi aynen calismaya devam eder.
let _groupGrantsAvailable = true;

function isMissingTableError(err) {
  // MSSQL 208 = "Invalid object name". Surucuye gore `number` ya da metin gelebiliyor.
  return err?.number === 208 || /invalid object name/i.test(String(err?.message || ''));
}

// Grant kaynagini uretir. `_groupGrantsAvailable` false ise grup tablosu SQL'e HIC
// girmez — boylece her istekte tekrar patlayip loglari doldurmaz.
function grantsSource() {
  const userPart = `SELECT restriction_id, username, CAST(NULL AS NVARCHAR(500)) AS group_dn
         FROM logx_v2_restriction_grants`;
  if (!_groupGrantsAvailable) return userPart;
  return `${userPart}
       UNION ALL
       SELECT restriction_id, CAST(NULL AS NVARCHAR(255)) AS username, group_dn
         FROM logx_v2_restriction_group_grants`;
}

// Sorguyu calistirir; grup tablosu yoksa bir kez uyarir, bayragi indirir ve grup
// tablosu OLMADAN yeniden dener.
async function queryWithGrants(buildSql, params) {
  try {
    return await db.query(buildSql(grantsSource()), params);
  } catch (err) {
    if (!_groupGrantsAvailable || !isMissingTableError(err)) throw err;
    console.warn('[restrictions] logx_v2_restriction_group_grants bulunamadi — '
      + 'grup grant\'lari DEVRE DISI, kullanici adi grant\'lari calismaya devam ediyor. '
      + 'Tabloyu olusturmak icin sunucuyu yeniden baslatin veya deploy/sql betigini calistirin.');
    _groupGrantsAvailable = false;
    return db.query(buildSql(grantsSource()), params);
  }
}

// Iki sirali sorgu yerine tek LEFT JOIN — kisitlama satiri yoksa r.id NULL doner (yani
// hic satir donmez, varsayilan-acik); satir varsa grant eslesmesi ayni sorguda gelir
// (kurumsal AI kod incelemesi, review.md #11).
async function isAllowed(resourceType, resourceKey, user) {
  return (await evaluate(resourceType, resourceKey, user)).allowed;
}

// Karar + karari ureten satirlar (ret ayrintisi bunlardan kurulur). Tek sorgu;
// `isAllowed` ile AYNI mantik — ikisi ayri yazilsa ret mesaji ile karar kayabilirdi.
// Ortam anahtari: bas/son bosluk yok, BUYUK harf (dil-bagimsiz; "prod" -> "PROD").
function envKey(label) {
  return String(label || '').trim().toUpperCase();
}
function normKey(resourceType, resourceKey) {
  return resourceType === 'env' ? envKey(resourceKey) : resourceKey;
}

async function evaluate(resourceType, resourceKey, user) {
  resourceKey = normKey(resourceType, resourceKey);
  if (user.role === 'Admin') return { allowed: true, rows: [] };

  // Eslesme artik SQL'de degil JS'te yapiliyor: grup listesi degisken uzunlukta ve
  // MSSQL'de degisken uzunlukta IN listesini parametrelemek STRING_SPLIT'e (uyumluluk
  // seviyesi 130+) bagimlilik yaratirdi. Bir kisitlamaya bagli grant sayisi kucuk.
  const { rows } = await queryWithGrants((grants) =>
    `SELECT r.id, x.username, x.group_dn
     FROM logx_v2_restrictions r
     LEFT JOIN (
       ${grants}
     ) x ON x.restriction_id = r.id
     WHERE r.resource_type = $1 AND r.resource_key = $2`,
  [resourceType, resourceKey]);
  if (rows.length === 0) return { allowed: true, rows }; // kisitlama satiri yok → varsayilan acik
  const groups = normalizedGroups(user);
  return { allowed: rows.some((r) => grantMatches(r, user.username, groups)), rows };
}

// ── RET AYRINTISI (2026-10-01) ──────────────────────────────────────────────
//
// Eski mesaj "ekibiniz bu kaynagi kisitlamis olabilir" idi: kullanici HANGI
// kuralin, KIMIN icin acik oldugunu ve KIME basvuracagini bilmiyordu; admin de
// hangi satirin calistigini goremiyordu (prod'da grup izni hatasi bu yuzden
// haftalarca "yetkisel bir sey" olarak kaldi). Kullanici karari: kural + izinli
// gruplar/kisiler + basvuru yolu gosterilir.
//
// DN'ler ekranda CN'ye kisaltilir ("CN=odeme-ekibi,OU=..." -> "odeme-ekibi").
// Liste uzunsa ilk RET_LISTE_MAX gosterilir, kalani sayiyla.
const RET_LISTE_MAX = 10;
const BASVURU = 'LogX yöneticisi (Admin)';

function kisaGrup(dn) {
  const m = /^\s*cn=([^,]+)/i.exec(String(dn || ''));
  return (m ? m[1] : String(dn || '')).trim();
}

function kaynakEtiketi(resourceType, resourceKey) {
  const k = String(resourceKey || '');
  if (resourceType === 'ocp_namespace') {
    const [tenant, env, cluster, ns] = k.split('/');
    if (ns) return `"${ns}" namespace'i (${cluster}, ${env}/${tenant})`;
  }
  if (resourceType === 'ocp_app') {
    const p = k.split('/');
    if (p.length >= 5) return `"${p[4]}" uygulaması ("${p[3]}" namespace'i, ${p[2]})`;
  }
  if (resourceType === 'legacy_app') return `"${k}" uygulaması`;
  if (resourceType === 'env') return `${envKey(k)} ortamı`;
  return `"${k}"`;
}

function denyDetails(resourceType, resourceKey, rows, owners = []) {
  const users = [...new Set(rows.map((r) => r.username).filter(Boolean).map(String))];
  const groups = [...new Set(rows.map((r) => r.group_dn).filter(Boolean).map(kisaGrup))];
  return {
    resourceType,
    resourceKey: String(resourceKey || ''),
    label: kaynakEtiketi(resourceType, resourceKey),
    allowedUsers: users,
    allowedGroups: groups,
    owners,
    // KAYNAK SAHIBI VARSA basvuru yolu onlar (L4); yoksa LogX yoneticisi.
    contact: owners.length ? `kaynak sahipleri (${liste(owners)}) ya da ${BASVURU}` : BASVURU,
  };
}

// Kaynagin SAHIPLERI (logx_v2_restriction_owners) — ret mesajinin basvuru yolu.
// `owners.cjs` BURAYI kullandigi icin dongu olmasin diye tablo dogrudan okunur.
// Tablo yoksa / okunamazsa bos: ret mesaji yine LogX yoneticisini gosterir.
async function sahipler(resourceType, resourceKey) {
  try {
    const { rows } = await db.query(
      `SELECT principal_type, principal FROM logx_v2_restriction_owners
        WHERE resource_type = $1 AND resource_key = $2
        ORDER BY principal_type, principal`,
      [resourceType, resourceKey],
    );
    return (rows || [])
      .filter((r) => (r.principal_type === 'user' || r.principal_type === 'group') && r.principal)
      .map((r) => (r.principal_type === 'group' ? `grup ${kisaGrup(r.principal)}` : String(r.principal)));
  } catch {
    return [];
  }
}

// Sahiplerle birlikte ret ayrintisi (rota katmani bunu kullanir).
async function redAyrintisi(resourceType, resourceKey, rows) {
  const k = normKey(resourceType, resourceKey);
  return denyDetails(resourceType, k, rows, await sahipler(resourceType, k));
}

function liste(xs) {
  if (xs.length <= RET_LISTE_MAX) return xs.join(', ');
  return `${xs.slice(0, RET_LISTE_MAX).join(', ')} ve ${xs.length - RET_LISTE_MAX} diğer`;
}

function denyMessage(d) {
  const parca = [];
  if (d.allowedGroups.length) parca.push(`grup ${liste(d.allowedGroups)}`);
  if (d.allowedUsers.length) parca.push(`kullanıcı ${liste(d.allowedUsers)}`);
  const izinli = parca.length ? `İzinli: ${parca.join('; ')}.` : 'Bu kaynakta henüz izinli kimse yok.';
  return `${d.label} LogX'te kısıtlı. ${izinli} Erişim için: ${d.contact}.`;
}

// Liste filtreleme icin toplu surum. `isAllowed`'i dongude cagirmak 1000 namespace'lik bir
// cluster'da 1000 sorgu demekti; burada TEK sorgu ile o tipin TUM kisitlama satirlari
// okunur ve karar bellekte verilir (varsayilan-acik semantigi birebir korunur).
async function filterAllowed(resourceType, resourceKeys, user) {
  const keys = Array.isArray(resourceKeys) ? resourceKeys : [];
  if (user.role === 'Admin' || keys.length === 0) return keys;

  const { rows } = await queryWithGrants((grants) =>
    `SELECT r.resource_key, x.username, x.group_dn
     FROM logx_v2_restrictions r
     LEFT JOIN (
       ${grants}
     ) x ON x.restriction_id = r.id
     WHERE r.resource_type = $1`,
  [resourceType]);
  // key → bu kullaniciya acik mi. Satiri OLMAYAN key hic haritada gorunmez → acik.
  const groups = normalizedGroups(user);
  const grantedByKey = new Map();
  for (const row of rows) {
    const prev = grantedByKey.get(row.resource_key) || false;
    grantedByKey.set(row.resource_key, prev || grantMatches(row, user.username, groups));
  }
  return keys.filter((k) => !grantedByKey.has(k) || grantedByKey.get(k));
}

// 403 + `restriction` (yapilandirilmis ayrinti). `code` BILEREK konmaz: LogX'in
// `asyncRoute`u `err.code`u yanitin `error` alanina yaziyor ve istemci once onu
// gosteriyor — ekranda aciklama yerine "logx_restricted" yazardi.
async function assertAllowed(resourceType, resourceKey, user) {
  const { allowed, rows } = await evaluate(resourceType, resourceKey, user);
  if (!allowed) {
    const d = await redAyrintisi(resourceType, resourceKey, rows);
    throw Object.assign(new Error(denyMessage(d)), { status: 403, restriction: d });
  }
}

// ── Admin CRUD ─────────────────────────────────────────────────────────────────

async function listRestrictions() {
  // `queryWithGrants` UZERINDEN: grup tablosu yoksa admin listesi 500 vermesin,
  // kullanici adi grant'lariyla gelsin (isAllowed/filterAllowed ile ayni dusus).
  const { rows } = await queryWithGrants((grants) =>
    `SELECT r.id, r.resource_type, r.resource_key, r.description, r.created_by, r.created_at,
            x.username AS grant_username, x.group_dn AS grant_group
     FROM logx_v2_restrictions r
     LEFT JOIN (
       ${grants}
     ) x ON x.restriction_id = r.id
     ORDER BY r.resource_type, r.resource_key`
  );
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.id)) {
      byId.set(row.id, {
        id: row.id, resourceType: row.resource_type, resourceKey: row.resource_key,
        description: row.description, createdBy: row.created_by, createdAt: row.created_at,
        // `grants` ESKI SOZLESME: yalnizca kullanici adlari. Mevcut admin ekrani bunu
        // okuyor, bicimi degistirmek onu sessizce bozardi. Gruplar AYRI alanda.
        grants: [], groupGrants: [],
      });
    }
    if (row.grant_username) byId.get(row.id).grants.push(row.grant_username);
    if (row.grant_group) byId.get(row.id).groupGrants.push(row.grant_group);
  }
  return [...byId.values()];
}

// Tanimli kaynak tipleri TEK YERDE. `ocp_app` uzun sure bu listede DEGILDI: okuma yolu
// (`isAllowed`) tipi taniyordu ama YAZMA yolu reddediyordu — yani uygulama bazli kisit
// hicbir zaman OLUSTURULAMIYORDU ve `catalog.assertAppsAllowed` her cagrisinda
// varsayilan-acik donuyordu. Kapi kodda vardi, yurulukte yoktu.
const RESOURCE_TYPES = ['legacy_app', 'ocp_namespace', 'ocp_app', 'env'];

// ORTAM KAPISI. Etiket bos ya da turetilemiyorsa kural UYGULANMAZ (varsayilan-acik
// semantigi) ama SESSIZ DEGIL: uyari loglanir — "ortam kisiti neden calismadi"
// sorusunun cevabi sunucu logunda durur.
async function assertEnvAllowed(envLabel, user) {
  const k = envKey(envLabel);
  if (!k) {
    console.warn('[restrictions] ortam etiketi bos — ortam kisiti uygulanamadi.');
    return;
  }
  await assertAllowed('env', k, user);
}

async function createRestriction({ resourceType, resourceKey, description }, createdBy) {
  if (!RESOURCE_TYPES.includes(resourceType)) {
    throw Object.assign(new Error(`Geçersiz resourceType: ${resourceType}`), { status: 400 });
  }
  if (!resourceKey || !String(resourceKey).trim()) {
    throw Object.assign(new Error('resourceKey zorunlu.'), { status: 400 });
  }
  const { rows } = await db.query(
    `INSERT INTO logx_v2_restrictions (resource_type, resource_key, description, created_by)
     OUTPUT INSERTED.*
     VALUES ($1,$2,$3,$4)`,
    [resourceType, String(normKey(resourceType, String(resourceKey).trim())), description || null, createdBy]
  );
  return rows[0];
}

async function updateRestriction(id, { description }) {
  const { rows } = await db.query(
    `UPDATE logx_v2_restrictions SET description = $1 OUTPUT INSERTED.* WHERE id = $2`,
    [description || null, id]
  );
  return rows[0] || null;
}

async function getRestrictionById(id) {
  const { rows } = await db.query(
    `SELECT id, resource_type, resource_key, description FROM logx_v2_restrictions WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  return r ? { id: r.id, resourceType: r.resource_type, resourceKey: r.resource_key, description: r.description } : null;
}

async function deleteRestriction(id) {
  const { rowCount } = await db.query(`DELETE FROM logx_v2_restrictions WHERE id = $1`, [id]);
  return rowCount > 0;
}

async function addGrant(restrictionId, username, createdBy) {
  if (!username || !String(username).trim()) {
    throw Object.assign(new Error('username zorunlu.'), { status: 400 });
  }
  const { rows } = await db.query(
    `INSERT INTO logx_v2_restriction_grants (restriction_id, username, created_by)
     OUTPUT INSERTED.*
     VALUES ($1,$2,$3)`,
    [restrictionId, String(username).trim(), createdBy]
  );
  return rows[0];
}

// AD grubu grant'i. Deger bir DN ('CN=ocp-operators,OU=...') ya da kurumun kullandigi
// baska bir grup tanimlayicisi olabilir; karsilastirma kucuk harfe indirgenerek yapilir.
async function addGroupGrant(restrictionId, groupDn, createdBy) {
  const dn = String(groupDn || '').trim();
  if (!dn) throw Object.assign(new Error('groupDn zorunlu.'), { status: 400 });
  if (dn.length > 500) throw Object.assign(new Error('groupDn cok uzun (en fazla 500).'), { status: 400 });
  const { rows } = await db.query(
    `INSERT INTO logx_v2_restriction_group_grants (restriction_id, group_dn, created_by)
     OUTPUT INSERTED.*
     VALUES ($1,$2,$3)`,
    [restrictionId, dn, createdBy]
  );
  return rows[0];
}

async function removeGroupGrant(restrictionId, groupDn) {
  const { rowCount } = await db.query(
    `DELETE FROM logx_v2_restriction_group_grants WHERE restriction_id = $1 AND group_dn = $2`,
    [restrictionId, String(groupDn || '').trim()]
  );
  return rowCount > 0;
}

async function removeGrant(restrictionId, username) {
  const { rowCount } = await db.query(
    `DELETE FROM logx_v2_restriction_grants WHERE restriction_id = $1 AND username = $2`,
    [restrictionId, username]
  );
  return rowCount > 0;
}

module.exports = {
  RESOURCE_TYPES,
  isAllowed, assertAllowed, filterAllowed, evaluate, denyDetails, denyMessage,
  assertEnvAllowed, envKey, redAyrintisi, getRestrictionById,
  listRestrictions, createRestriction, updateRestriction, deleteRestriction,
  addGrant, removeGrant, addGroupGrant, removeGroupGrant,
};
