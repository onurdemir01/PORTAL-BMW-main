// server/selfservice/nginx-tanim-okuma.cjs - Self Servis > Nginx - RVP Operations "read" (2026-10-20).
//
// Kullanici: "Read job'ini silme islemini yaparken okudugun ise cevirelim, Ansible job'ini
// tetiklememize gerek yok. Read isteyen kisiye mevcut tanimlar / tanimlardan hangi location'a
// hangi uygulama cevap veriyor bunu gosterelim."
//
// KAYNAK silme akisinin okudugu veriyle AYNI: dbo.Nginx_Config_Audit'in son taramasi, ortam +
// servis (choice-sources 'nginx-locations'). Gunluk taramadir - canli okuma degil; ekran tarama
// tarihini yazar. Tarama hic yoksa "olculemedi", taramada bu ortam / servis icin satir yoksa
// "tanim yok": ikisi ayri.
//
// PROD'da sunucu hangi filoda (nginx-migration MIGRATION_GROUPS) yazilir. GLOMO production'da eski
// filoya hicbir iste gidilmez (2026-10-20): GLOMO prod okumasi yalniz YENI filo satirlarini
// gosterir, eski filo satiri sayilir ama listelenmez.
//
// SABLON TANIMA: AWX sablonunun playbook'u bmw_nginx/nginx_ops/nginx_ops.yml ise read yereldir
// (baslik / ad eslemesi DEGIL). launch-ss read'i AWX'e gondermez (yerelOkumaMi).
'use strict';

const T = (s) => String(s == null ? '' : s).trim();
const U = (s) => T(s).toUpperCase();
const PLAYBOOK_RE = /(^|\/)nginx_ops\/nginx_ops\.ya?ml$/i;
const EYLEM_ALANLARI = ['action', 'op_selection'];

/** Sablon yerel okuma destekliyor mu: { tur, eylemAlanlari, deger } ya da null. */
function yerelOkumaOf(detail) {
  return PLAYBOOK_RE.test(T(detail && detail.playbook))
    ? { tur: 'nginx-tanimlar', eylemAlanlari: EYLEM_ALANLARI, deger: 'read' }
    : null;
}

/** Gonderilen degiskenlerde eylem read mi (alan adi ve deger harf duyarsiz). */
function eylemReadMi(vars) {
  for (const [k, v] of Object.entries(vars || {}))
    if (EYLEM_ALANLARI.includes(T(k).toLowerCase()) && T(v).toLowerCase() === 'read') return true;
  return false;
}

/** launch-ss kapisi: bu sablonda read istendiyse AWX'e GIDILMEZ. */
function yerelOkumaMi(detail, vars) {
  return !!yerelOkumaOf(detail) && eylemReadMi(vars);
}

function filoHaritasi(groups) {
  const m = new Map();
  for (const g of groups || []) {
    for (const h of g.oldHosts || []) m.set(U(h), { filo: 'eski', grup: g.id });
    for (const h of g.newHosts || []) m.set(U(h), { filo: 'yeni', grup: g.id });
  }
  return m;
}

const OPSIYONEL_AUDIT_KOLONLARI = new Set(['kind', 'target_url']);

/** Yalniz eski Nginx_Config_Audit semasindaki opsiyonel kolon eksikligini tanir. */
function opsiyonelKolonEksikMi(err) {
  const bekleyen = [err];
  const gorulen = new Set();
  const kayitlar = [];
  while (bekleyen.length) {
    const hata = bekleyen.pop();
    if (!hata || (typeof hata !== 'object' && typeof hata !== 'function') || gorulen.has(hata)) continue;
    gorulen.add(hata);
    kayitlar.push(hata);
    if (hata.originalError) bekleyen.push(hata.originalError);
    if (hata.info) bekleyen.push(hata.info);
    if (hata.cause) bekleyen.push(hata.cause);
    if (Array.isArray(hata.precedingErrors)) bekleyen.push(...hata.precedingErrors);
  }
  // Bir hata zincirindeki baglanti / yetki / baska SQL hatasi, 207 kaydiyla maskelenemez.
  if (kayitlar.some((hata) => U(hata.code) && U(hata.code) !== 'EREQUEST')) return false;
  if (kayitlar.some((hata) => Number.isFinite(Number(hata.number)) && Number(hata.number) !== 207)) return false;
  return kayitlar.some((hata) => {
    const kolonlar = [...T(hata.message).matchAll(/Invalid column name ['"]([^'"]+)['"]/gi)]
      .map((m) => T(m[1]).toLowerCase());
    return Number(hata.number) === 207
      && kolonlar.length > 0
      && kolonlar.every((kolon) => OPSIYONEL_AUDIT_KOLONLARI.has(kolon));
  });
}

/**
 * SAF tablo kurucu: satirlar -> location basina uygulama(lar) ve sunuculari.
 * @param {object[]} rows  {host, location_path, application, namespace, kind?, target_url?}
 * @param {object}   o     {env, service, namespace?, application?, groups}
 */
function tanimTablosu(rows, { env, service, namespace, application, groups }) {
  const E = U(env);
  const S = U(service);
  const fil = filoHaritasi(groups);
  const glomoProd = E === 'PROD' && S === 'GLOMO';
  const nsF = T(namespace).toLowerCase();
  const appF = T(application).toLowerCase();
  const byLoc = new Map();
  let eskiFiloGizli = 0;
  for (const r of rows || []) {
    const loc = T(r.location_path);
    if (!loc) continue;
    const host = U(r.host);
    const f = E === 'PROD' ? (fil.get(host) || { filo: 'bilinmiyor' }).filo : '';
    if (glomoProd && f === 'eski') {
      eskiFiloGizli += 1;
      continue;
    }
    const app = T(r.application);
    const ns = T(r.namespace);
    if (nsF && ns.toLowerCase() !== nsF) continue;
    if (appF && app.toLowerCase() !== appF) continue;
    const proxy = T(r.kind).toLowerCase() === 'proxy';
    if (!byLoc.has(loc)) byLoc.set(loc, new Map());
    const k = `${app.toLowerCase()}|${ns.toLowerCase()}|${proxy ? T(r.target_url).toLowerCase() : ''}`;
    const m = byLoc.get(loc);
    if (!m.has(k))
      m.set(k, {
        application: app || null,
        namespace: ns || null,
        // eski filo proxy satirinda uygulama adi hedef adresin ilk etiketinden TAHMINDIR
        tahmin: proxy,
        hedef: proxy ? T(r.target_url) || null : null,
        sunucular: [],
      });
    const g = m.get(k);
    if (!g.sunucular.some((x) => x.host === host)) g.sunucular.push({ host, filo: f || null });
  }
  const satirlar = [...byLoc.entries()]
    .map(([location, m]) => {
      const cevaplar = [...m.values()]
        .map((c) => ({ ...c, sunucular: c.sunucular.sort((a, b) => a.host.localeCompare(b.host)) }))
        .sort((a, b) => T(a.application).localeCompare(T(b.application)));
      // ayni location'a sunucular arasinda FARKLI uygulama cevap veriyorsa isaretlenir
      const farkli = new Set(cevaplar.map((c) => `${T(c.application).toLowerCase()}|${T(c.namespace).toLowerCase()}`));
      return { location, cevaplar, tutarsiz: farkli.size > 1 };
    })
    .sort((a, b) => a.location.localeCompare(b.location));
  return { satirlar, eskiFiloGizli, glomoProd };
}

async function satirlariOku(query, sql, E, S) {
  const params = [
    { name: 'e', type: sql.NVarChar(16), value: E },
    { name: 's', type: sql.NVarChar(64), value: S },
  ];
  const tarihR = await query(
    `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit`,
  );
  const tarih = (tarihR.recordset && tarihR.recordset[0] && tarihR.recordset[0].d) || null;
  if (!tarih) return { tarih: null, rows: [] };
  const where = `scan_date = @d AND UPPER(env) = @e AND UPPER(service) = @s`;
  const p = [...params, { name: 'd', type: sql.NVarChar(10), value: tarih }];
  // kind / target_url kolonlari DDL'e sonradan geldi; yoksa bunlarsiz okunur.
  let r;
  try {
    r = await query(
      `SELECT DISTINCT host, location_path, application, namespace, kind, target_url FROM dbo.Nginx_Config_Audit WHERE ${where}`,
      p,
    );
  } catch (err) {
    if (!opsiyonelKolonEksikMi(err)) throw err;
    r = await query(
      `SELECT DISTINCT host, location_path, application, namespace FROM dbo.Nginx_Config_Audit WHERE ${where}`,
      p,
    );
  }
  return { tarih, rows: r.recordset || [] };
}

/** Ortam + servis icin tanimlar. deps: { mssql, groups } (testte sahte). */
async function nginxTanimlari({ env, service, namespace, application }, deps = {}) {
  const E = U(env);
  const S = U(service);
  if (!E || !S) return { ok: false, status: 400, message: 'Ortam ve servis seçilmeli.' };
  if (!/^[A-Z0-9_-]{1,16}$/.test(E) || !/^[A-Z0-9_.-]{1,64}$/.test(S))
    return { ok: false, status: 400, message: 'Geçersiz ortam ya da servis.' };
  const { query, sql } = deps.mssql || require('../inventory/mssql.cjs');
  const groups = deps.groups || require('../audit/nginx-migration.cjs').MIGRATION_GROUPS;
  let okunan;
  try {
    okunan = await satirlariOku(query, sql, E, S);
  } catch (err) {
    return { ok: true, durum: 'olculemedi', sebep: `Tanım taraması okunamadı: ${err.message}`, env: E, service: S, satirlar: [] };
  }
  if (!okunan.tarih)
    return { ok: true, durum: 'olculemedi', sebep: 'Tanım taraması (Nginx_Config_Audit) henüz hiç koşmadı.', env: E, service: S, satirlar: [] };
  const t = tanimTablosu(okunan.rows, { env: E, service: S, namespace, application, groups });
  return {
    ok: true,
    durum: t.satirlar.length ? 'var' : 'yok',
    env: E,
    service: S,
    taramaTarihi: okunan.tarih,
    satirlar: t.satirlar,
    eskiFiloGizli: t.eskiFiloGizli,
    glomoProd: t.glomoProd,
    filtre: { namespace: T(namespace) || null, application: T(application) || null },
  };
}

module.exports = { yerelOkumaOf, yerelOkumaMi, eylemReadMi, tanimTablosu, nginxTanimlari, PLAYBOOK_RE };
