// server/server-hub/ear-hub-verisi.cjs - Server Hub icin Uygulama Envanteri'nin son durumu (2026-11-06).
//
// Server Hub taramasi (dis AWX projesi) /vhosting altini ve JBoss domain.xml / host.xml'i okumaz;
// bu bilgi Uygulama Envanteri tarayicisinin (ear_tara.py, Portal DB ear_envanter_*) son taramasindan
// gelir. Sunucu basina veri_var=1 olan EN SON kosu alinir. Agir kolonlar (xml_ozeti, uyarilar,
// teknoloji) okunmaz; yalniz bulgu ve etiket icin gerekenler.
//
// OKUNAMAZSA (tablo yok, kolon eksik, DB hatasi) { okunamadi: true }: Server Hub degerlendirmesi
// dusmez, EAR bulgulari uretilmez ve ekran bunu "Uygulama Envanteri okunamadi" diye soyler.
'use strict';

const db = () => require('../db/index.cjs');

const SON = `son AS (SELECT host, MAX(kosu_id) AS kosu_id FROM ear_envanter_hostlari WHERE veri_var = 1 GROUP BY host)`;

const jsonOku = (s) => {
  if (s == null || s === '') return null;
  try {
    const v = JSON.parse(String(s));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};
const iso = (t) => {
  if (t == null) return null;
  const d =
    t instanceof Date
      ? t
      : new Date(String(t).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(t)) ? '' : 'Z'));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

/**
 * @returns {Promise<{ okunamadi: boolean, hata?: string, hostlar: Array<{ host: string, kosuId: number,
 *   taranma: string|null, durum: string, kokGirdileri: { girdiler: object[], kesilen: number }|null,
 *   uygulamalar: Array<{ kok: string, jboss: string, ad: string, durum: string, warSayisi: number|null,
 *   xml: object|null }> }> }>}
 */
async function earSonDurum() {
  try {
    const h = await db().query(
      `WITH ${SON}
       SELECT h.host, h.kosu_id, h.taranma_utc, h.durum, h.kok_girdileri
         FROM ear_envanter_hostlari h JOIN son ON son.host = h.host AND son.kosu_id = h.kosu_id`,
    );
    const u = await db().query(
      `WITH ${SON}
       SELECT u.host, u.kok, u.jboss, u.ad, u.durum, u.war_sayisi, u.xml_eslesme
         FROM ear_envanter_uygulamalari u JOIN son ON son.host = u.host AND son.kosu_id = u.kosu_id`,
    );
    const hostlar = new Map();
    for (const r of h.rows || []) {
      const host = String(r.host || '')
        .trim()
        .toUpperCase();
      if (!host) continue;
      const kg = jsonOku(r.kok_girdileri);
      hostlar.set(host, {
        host,
        kosuId: Number(r.kosu_id),
        taranma: iso(r.taranma_utc),
        durum: String(r.durum || ''),
        kokGirdileri:
          kg && Array.isArray(kg.girdiler)
            ? { girdiler: kg.girdiler, kesilen: Number(kg.kesilen) || 0 }
            : null,
        uygulamalar: [],
      });
    }
    for (const r of u.rows || []) {
      const x = hostlar.get(
        String(r.host || '')
          .trim()
          .toUpperCase(),
      );
      if (!x) continue;
      x.uygulamalar.push({
        kok: String(r.kok || ''),
        jboss: String(r.jboss || '?'),
        ad: String(r.ad || ''),
        durum: String(r.durum || ''),
        warSayisi: r.war_sayisi == null ? null : Number(r.war_sayisi),
        xml: jsonOku(r.xml_eslesme),
      });
    }
    return { okunamadi: false, hostlar: [...hostlar.values()] };
  } catch (err) {
    return { okunamadi: true, hata: (err && err.message) || 'okunamadı', hostlar: [] };
  }
}

module.exports = { earSonDurum, jsonOku };
