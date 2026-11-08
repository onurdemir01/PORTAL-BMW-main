// server/server-hub/iliski-verisi.cjs - Iliski grafigi icin Uygulama Envanteri'nin agir ozetleri (2026-11-07).
//
// Server Hub degerlendirmesi (assess) ear_envanter_*'in yalniz hafif kolonlarini okur (ear-hub-verisi.cjs).
// Iliski grafigi web <-> uygulama eslemesi icin Faz A / Faz W ozetlerini de ister: xml_ozeti (port grubu,
// ofset, mod_cluster), web_ozeti (vhost, proxy / jk / balancer / WAS hedefleri, log ozeti), baglanti_ozeti
// (ESTABLISHED gozlemleri), was_ozeti (WebSphere uc noktalari). Ayrica dbo.IPInventory (LB listesi IP'leri).
//
// BELLEK (OOM sinifi): web_ozeti host basina 4 MB'a kadar olabilir. Satir satir okunur ve HEMEN kucuk
// projeksiyona indirilir (yalniz grafigin kullandigi alanlar); ham JSON tutulmaz. Okunamayan kaynak
// { okunamadi } doner: grafik kurulur ama o kaynaga dayanan kenar / dogrulama "olculmedi" kalir.
'use strict';

const { jsonOku } = require('./ear-hub-verisi.cjs');

const db = () => require('../db/index.cjs');
const U = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toUpperCase();
// Grafik anahtari kisa ad (iliski-grafigi kisa): Uygulama Envanteri hedef listesinde FQDN de olabilir.
// Kisaltilmazsa dogrulama `vh.get(kisa ad)` ile sunucuyu bulamaz, TAZELIK / LISTEN_IP sessizce yazilmaz.
const kisaAd = (h) => {
  const s = String(h == null ? '' : h).trim();
  return /^\d+\.\d+\.\d+\.\d+$/.test(s) ? s : U(s.split('.')[0]);
};
const dizi = (v) => (Array.isArray(v) ? v : []);
const sayi = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const iso = (t) => {
  if (t == null) return null;
  const d =
    t instanceof Date
      ? t
      : new Date(String(t).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(t)) ? '' : 'Z'));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

/** xml_ozeti -> JBoss kurulumlari: sunucu port ofseti / grubu, soket gruplari, profil mod_cluster. */
function xmlProjeksiyon(ham) {
  return dizi(ham).map((k) => ({
    kurulum: String(k.kurulum || ''),
    nesil: String(k.nesil || '?'),
    olculdu: k.domain === 'OKUNDU' && k.host === 'OKUNDU',
    faz: Array.isArray(k.soket_gruplari),
    sunucular: dizi(k.sunucular).map((s) => ({
      ad: String(s.ad || ''),
      grup: String(s.grup || ''),
      soket_grubu: s.soket_grubu || '',
      port_ofseti: sayi(s.port_ofseti),
    })),
    gruplar: dizi(k.gruplar).map((g) => ({
      ad: String(g.ad || ''),
      profil: g.profil || '',
      soket_grubu: g.soket_grubu || '',
      port_ofseti: sayi(g.port_ofseti),
      deployment: dizi(g.deploymentlar).length,
    })),
    soket_gruplari: dizi(k.soket_gruplari).map((sg) => ({
      ad: String(sg.ad || ''),
      soketler: sg.soketler && typeof sg.soketler === 'object' ? sg.soketler : {},
      outbound: dizi(sg.outbound).map((o) => ({
        ad: String(o.ad || ''),
        host: String(o.host || ''),
        port: sayi(o.port),
      })),
    })),
    profiller: dizi(k.profiller).map((p) => ({
      ad: String(p.ad || ''),
      modcluster: p.modcluster || null,
    })),
  }));
}

/** web_ozeti -> kurulum basina vhost'lar (hedefler + log sayilari), jk workers, balancerlar, WAS rotalari. */
function webProjeksiyon(w) {
  if (!w || typeof w !== 'object') return null;
  return {
    durum: w.durum || null,
    ps_gorunur: w.ps_gorunur === true,
    ipler:
      w.ipler && w.ipler.durum === 'OLCULDU'
        ? dizi(w.ipler.liste).map((x) => String(x.ip || ''))
        : null,
    kurulumlar: dizi(w.kurulumlar).map((k) => ({
      urun: k.urun === 'IHS' ? 'IHS' : 'RHA',
      calisiyor: typeof k.calisiyor === 'boolean' ? k.calisiyor : null,
      hata_sayisi: dizi(k.hatalar).length,
      mod_cluster: !!(k.mod_cluster && k.mod_cluster.yuklu),
      vhostlar: dizi(k.vhostlar).map((v) => {
        const l = dizi(v.loglar)[0] || null;
        return {
          server_name: String(v.server_name || ''),
          aliases: dizi(v.aliases).map(String),
          adres: dizi(v.adres).map(String),
          belirsiz: v.belirsiz === true,
          hedefler: dizi(v.hedefler).map((h) => ({
            tur: h.tur,
            sema: h.sema,
            host: String(h.host || ''),
            port: sayi(h.port),
            yol: h.yol || '',
          })),
          jk: dizi(v.jk_mount).map((m) => String(m.worker || '')),
          log: l
            ? {
                durum: l.durum,
                gercek_7g: sayi(l.gercek_7g),
                hc_7g: sayi(l.hc_7g),
                paylasilan: l.paylasilan === true,
                son_gercek: sayi(l.son_gercek),
                hc_istemcileri: dizi(l.hc_istemcileri).map((x) => String(x.ip || '')),
              }
            : null,
        };
      }),
      ana_hedefler: dizi(k.ana && k.ana.hedefler).map((h) => ({
        tur: h.tur,
        sema: h.sema,
        host: String(h.host || ''),
        port: sayi(h.port),
        yol: h.yol || '',
      })),
      jk_global: dizi(k.jk && k.jk.mount_global).map((m) => String(m.worker || '')),
      workers: dizi(k.jk && k.jk.workers && k.jk.workers.workerlar).map((x) => ({
        ad: String(x.ad || ''),
        tur: String(x.tur || ''),
        host: String(x.host || ''),
        port: sayi(x.port),
        uyeler: dizi(x.uyeler).map(String),
      })),
      balancerlar: dizi(k.balancerlar).map((b) => ({
        ad: String(b.ad || ''),
        uyeler: dizi(b.uyeler).map((u) => ({ host: String(u.host || ''), port: sayi(u.port) })),
      })),
      was:
        k.was && k.was.durum === 'OKUNDU'
          ? {
              clusterlar: dizi(k.was.clusterlar).map((c) => ({
                ad: String(c.ad || ''),
                sunucular: dizi(c.sunucular).map((s) => ({
                  ad: String(s.ad || ''),
                  host: String(s.host || ''),
                  port: sayi(s.port),
                })),
              })),
              vhostgruplari: k.was.vhostgruplari || {},
              rotalar: dizi(k.was.rotalar),
            }
          : null,
    })),
  };
}

function baglantiProjeksiyon(b) {
  if (!b || typeof b !== 'object') return null;
  return {
    durum: b.durum || null,
    portlar: dizi(b.portlar).map((p) => ({
      port: sayi(p.port),
      sahipler: dizi(p.sahipler).map((s) => ({
        jvm: String(s.jvm || ''),
        kurulum: String(s.kurulum || ''),
        tur: String(s.tur || ''),
      })),
      dinleniyor: p.dinleniyor === true,
      uzaklar: dizi(p.uzaklar).map((u) => ({ ip: String(u.ip || ''), gozlem: sayi(u.gozlem) })),
    })),
  };
}

function wasProjeksiyon(w) {
  if (!w || typeof w !== 'object') return null;
  return {
    sunucular: dizi(w.sunucular).map((s) => ({
      ad: String(s.ad || ''),
      tur: String(s.tur || ''),
      uclar: dizi(s.uclar).map((u) => ({ ad: String(u.ad || ''), port: sayi(u.port) })),
      uygulamalar: dizi(s.uygulamalar).map(String),
    })),
  };
}

const SON = `son AS (SELECT host, MAX(kosu_id) AS kosu_id FROM ear_envanter_hostlari WHERE veri_var = 1 GROUP BY host)`;

/**
 * @returns {Promise<{ okunamadi: boolean, hata?: string, hostlar: Map<string, object>, ipEnvanteri: object }>}
 */
async function iliskiVerisi() {
  const out = {
    okunamadi: false,
    hostlar: new Map(),
    ipEnvanteri: { okunamadi: false, satirlar: [] },
  };
  try {
    const { rows } = await db().query(
      `WITH ${SON}
       SELECT h.host, h.taranma_utc, h.xml_ozeti, h.web_ozeti, h.baglanti_ozeti, h.was_ozeti
         FROM ear_envanter_hostlari h JOIN son ON son.host = h.host AND son.kosu_id = h.kosu_id`,
    );
    for (const r of rows || []) {
      const host = kisaAd(r.host);
      if (!host) continue;
      // Ayni sunucu iki adla (FQDN / kisa) taranmissa en yeni tarama kalir.
      const taranma = iso(r.taranma_utc);
      const onceki = out.hostlar.get(host);
      if (onceki && String(onceki.taranma || '') >= String(taranma || '')) continue;
      out.hostlar.set(host, {
        host,
        taranma,
        // Faz A/W kolonu NULL = olculmedi (kontrol kapali / eski kosu / eski tarayici).
        jboss: r.xml_ozeti == null ? null : xmlProjeksiyon(jsonOku(r.xml_ozeti)),
        web: webProjeksiyon(jsonOku(r.web_ozeti)),
        baglanti: baglantiProjeksiyon(jsonOku(r.baglanti_ozeti)),
        was: wasProjeksiyon(jsonOku(r.was_ozeti)),
      });
    }
  } catch (e) {
    out.okunamadi = true;
    out.hata = (e && e.message) || 'okunamadı';
  }
  try {
    const { query } = require('../inventory/mssql.cjs');
    const r = await query(`SELECT host, ip FROM dbo.IPInventory`);
    out.ipEnvanteri.satirlar = (r.recordset || [])
      .map((x) => ({ host: kisaAd(x.host), ip: String(x.ip || '').trim() }))
      .filter((x) => x.host && x.ip);
  } catch (e) {
    out.ipEnvanteri = { okunamadi: true, hata: (e && e.message) || 'okunamadı', satirlar: [] };
  }
  return out;
}

module.exports = {
  iliskiVerisi,
  kisaAd,
  xmlProjeksiyon,
  webProjeksiyon,
  baglantiProjeksiyon,
  wasProjeksiyon,
};
