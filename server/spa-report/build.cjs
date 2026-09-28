// server/spa-report/build.cjs — "Nginx ARK SPA Raporu" satirlarini kurar (saf, test edilebilir).
//
// Kullanici (2026-09-28): "SPA Tasimalari sayfasinin birebir aynisini Glomo / Webforms /
// Saklama / Geintdigital vb. TUM servislerimiz icin, sol menuye yeni bir bolum ekleyerek
// 'Nginx ARK SPA Raporu' adiyla istiyorum. Buraya ekiplerin giris yapabilmesini istiyorum.
// Kolonlar: Ekip Beyani, Uygulama, Namespace, Ekip, Yuk Durumu, Location, Aciklama."
//
// TASIMA EKRANINDAN FARKI: orasi iki SABIT sunucu grubunu (GBRVP* -> GBNGXP*) izler ve
// "yeni sunucuda dizin var mi" sorusunu sorar. Burasi TASIMA SORMAZ; envanterin tamamini
// SERVIS bazinda listeler. Bu yuzden ayri bir modul - tasima ekranina "tum servisler"
// kipi eklemek, iki farkli soruyu tek ekranda birbirine karistirirdi.
//
// KAYNAK: dbo.Nginx_Config_Audit'in SPA satirlari. Bu satirlarda application/namespace
// ZATEN COZULMUS haldedir (job yaziyor), dolayisiyla burada ad kalibindan cozum YAPILMAZ.
//
// AYNI TANIM BIRDEN COK SUNUCUDA durur (prod'da 4-8 mirror nginx): satirlar
// (servis, ortam, uygulama, namespace, location) ile TEKILLESTIRILIR, sunucular listelenir.
// Tekillestirmezsek ayni uygulama sekiz kez gorunur ve ekip listeyi okuyamaz.
'use strict';

const U = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toUpperCase();
const T = (s) => String(s == null ? '' : s).trim();

/**
 * @param {object[]} rows      Nginx_Config_Audit SPA satirlari
 * @param {(service,env,location)=>object|null} trafficOf  yuk olcumu (denetim.cjs ile AYNI)
 * @param {Map<string,object>} beyanlar  "ns/app" -> { inUse, inUseBy, note }
 * @param {(ns:string)=>string[]} ekipOf namespace -> sahip gruplar
 * @param {string} env         yalniz bu ortam (varsayilan PROD)
 */
function buildSpaReport({ rows, trafficOf, beyanlar, ekipOf, env = 'PROD' } = {}) {
  const istenen = U(env);
  const bykey = new Map();
  for (const r of rows || []) {
    const ortam = U(r.env);
    if (istenen && ortam !== istenen) continue;
    const app = T(r.application);
    const ns = T(r.namespace);
    // Uygulamasi ya da namespace'i olmayan satir EKIBE GOSTERILMEZ: uzerinde beyan
    // verilemeyecek bir satir, listeyi uzatmaktan baska ise yaramaz. Sayisi ayrica doner.
    if (!app || !ns) continue;
    const servis = U(r.service);
    const loc = T(r.location_path);
    const k = [servis, ortam, ns, app, loc].join('|');
    if (!bykey.has(k)) {
      bykey.set(k, {
        service: servis,
        env: ortam,
        namespace: ns,
        application: app,
        location: loc,
        hosts: new Set(),
        vhosts: new Set(),
      });
    }
    const row = bykey.get(k);
    if (r.host) row.hosts.add(U(r.host));
    if (r.vhost) row.vhosts.add(T(r.vhost));
  }

  const atlanan = (rows || []).filter((r) => {
    const ortam = U(r.env);
    return (!istenen || ortam === istenen) && (!T(r.application) || !T(r.namespace));
  }).length;

  const satirlar = [...bykey.values()].map((row) => {
    const anahtar = `${row.namespace}/${row.application}`;
    const b = beyanlar instanceof Map ? beyanlar.get(anahtar) : (beyanlar || {})[anahtar];
    return {
      service: row.service,
      env: row.env,
      namespace: row.namespace,
      application: row.application,
      location: row.location,
      hosts: [...row.hosts].sort(),
      vhosts: [...row.vhosts].sort(),
      team: (typeof ekipOf === 'function' ? ekipOf(row.namespace) : []) || [],
      // YUK: OLCUM. Ekip beyanindan AYRI tutulur ve biri digerini EZMEZ - yilda bir kosan
      // bir is olcumde "yuk almiyor" gorunur ama ekip kullaniyordur. Celiski BILGIDIR.
      traffic:
        typeof trafficOf === 'function' ? trafficOf(row.service, row.env, row.location) : null,
      // BEYAN: ekibin dedigi. Yoksa BOS - "kullanmiyor" yazmak uydurma olurdu.
      inUse: b ? b.inUse || null : null,
      inUseBy: b ? b.inUseBy || null : null,
      note: b ? b.note || '' : '',
    };
  });

  satirlar.sort(
    (a, b) =>
      a.service.localeCompare(b.service) ||
      a.application.localeCompare(b.application) ||
      a.namespace.localeCompare(b.namespace) ||
      a.location.localeCompare(b.location),
  );

  const servisler = [...new Set(satirlar.map((r) => r.service))].sort().map((s) => {
    const rs = satirlar.filter((r) => r.service === s);
    return {
      service: s,
      rows: rs.length,
      apps: new Set(rs.map((r) => `${r.namespace}/${r.application}`)).size,
      // BEYAN VEREN / VERMEYEN: ekibe "ne kadari bekliyor" demek icin.
      declared: rs.filter((r) => r.inUse).length,
    };
  });

  return { rows: satirlar, services: servisler, skipped: atlanan };
}

module.exports = { buildSpaReport };
