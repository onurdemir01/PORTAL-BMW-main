// server/server-hub/capraz-veri.cjs - Server Hub capraz kontrolleri icin Portal geneli veri (2026-11-06).
//
// Kullanici: "bir uygulamanin auto-start degeri false uygulama ayakta ise ya da tam tersi ise bunlar da
// risktir, retirement icin suphedir. bu ve bunun gibi seyleri portal genelindeki butun verilerden al
// incele carp karsilastir". Server Hub taramasinin bilmedigi uc kaynak:
//   dbo.Openshift_Inventory     (dis envanter DB)  uygulama OpenShift'te hangi namespace / cluster'da
//   dbo.BMW_Application_Usage   (dis envanter DB)  OpenShift uygulamasi istek aliyor mu (Dynatrace)
//   retirement_targets/_records (Portal DB)        uygulama Retirement surecinde mi, STOP / silme yapildi mi
//
// YALNIZ SELECT: dis envanter DB'de DDL ya da yazma YOK (Openshift_Inventory baska bir isin tablosu).
// HER KAYNAK AYRI OKUNUR: biri okunamazsa yalniz ona dayanan bulgu / etiket uretilmez ve ekran
// "okunamadi" der; degerlendirme dusmez. OpenShift ve Dynatrace gecelik yuklenir: 10 dk onbellek.
// Retirement kayitlari kullanici isleminde degisir: her degerlendirmede okunur (kucuk tablo).
'use strict';

const { olcumIndeksi } = require('../nginx-console/spa-discovery.cjs');
const { envOfNamespace } = require('../audit/ocp-platforms.cjs');
const { normAd } = require('./capraz.cjs');

const ONBELLEK_MS = 10 * 60 * 1000;
const inv = () => require('../inventory/mssql.cjs');
const db = () => require('../db/index.cjs');

const L = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase();

let _dis = { at: 0, deger: null };

/** OpenShift envanteri: normAd(uygulama) -> [{ cluster, namespace, uygulama, ortam }]; ortami olmayan namespace atlanir. */
function ocpIndeksi(satirlar) {
  const m = new Map();
  for (const r of satirlar || []) {
    const ortam = envOfNamespace(r.namespace);
    const ad = normAd(r.application);
    if (!ortam || !ad) continue;
    if (!m.has(ad)) m.set(ad, []);
    m.get(ad).push({
      cluster: String(r.cluster || '').trim(),
      namespace: String(r.namespace || '').trim(),
      uygulama: String(r.application || '').trim(),
      ortam,
    });
  }
  return m;
}

async function disKaynaklar() {
  if (_dis.deger && Date.now() - _dis.at < ONBELLEK_MS) return _dis.deger;
  const [ocp, kullanim] = await Promise.all([
    inv()
      .query(
        `SELECT DISTINCT cluster, namespace, application FROM dbo.Openshift_Inventory
          WHERE application IS NOT NULL AND namespace IS NOT NULL`,
      )
      .then((r) => {
        const indeks = ocpIndeksi(r.recordset || []);
        return { okunamadi: false, indeks, uygulama: indeks.size };
      })
      .catch((e) => ({
        okunamadi: true,
        hata: (e && e.message) || 'okunamadı',
        indeks: new Map(),
        uygulama: 0,
      })),
    // Nginx Hub SPA Kesfi'nin sorgusu: cluster basina EN YENI satir veritabaninda secilir, cluster'lar
    // olcumIndeksi'nde toplanir (pasif cluster'in 0'i "istek yok" sayilmaz).
    inv()
      .query(
        `SELECT cluster, namespace, app, scan_date, window_days, req_total, services_total, measured, note
           FROM (
             SELECT cluster, namespace, app, scan_date, window_days, req_total, services_total, measured, note,
                    ROW_NUMBER() OVER (PARTITION BY cluster, namespace, app ORDER BY scan_date DESC) AS rn
               FROM dbo.BMW_Application_Usage
              WHERE scan_date >= DATEADD(day, -7, CAST(GETDATE() AS DATE))
           ) t
          WHERE rn = 1`,
      )
      .then((r) => ({ okunamadi: false, indeks: olcumIndeksi(r.recordset || []) }))
      .catch((e) => ({
        okunamadi: true,
        hata: (e && e.message) || 'okunamadı',
        indeks: new Map(),
      })),
  ]);
  const deger = { ocp, kullanim };
  // Okunamayan kaynak onbellege alinmaz: bir sonraki degerlendirme yeniden dener.
  if (!ocp.okunamadi && !kullanim.okunamadi) _dis = { at: Date.now(), deger };
  return deger;
}

/** Retirement hedefleri (iptal edilmis kayitlar haric). */
async function retirementHedefleri() {
  try {
    const r = await db().query(
      `SELECT t.id, t.record_id, t.host, t.app_name, t.jboss_gen, t.app_path, t.status, t.stopped_at,
              r.status AS kayit_durum
         FROM retirement_targets t JOIN retirement_records r ON r.id = t.record_id
        WHERE r.status <> 'cancelled'`,
    );
    return {
      okunamadi: false,
      hedefler: (r.rows || []).map((x) => ({
        hedef: Number(x.id),
        kayit: Number(x.record_id),
        host: String(x.host || '').trim(),
        uygulama: String(x.app_name || '').trim(),
        gen: x.jboss_gen == null ? null : Number(x.jboss_gen),
        yol: x.app_path == null ? null : String(x.app_path),
        durum: L(x.status),
        kayitDurum: L(x.kayit_durum),
        durduruldu: x.stopped_at ? new Date(x.stopped_at).toISOString().slice(0, 10) : null,
      })),
    };
  } catch (e) {
    return { okunamadi: true, hata: (e && e.message) || 'okunamadı', hedefler: [] };
  }
}

/** @returns {Promise<{ ocp: object, kullanim: object, retirement: object }>} hicbir zaman reddetmez */
async function caprazVeri() {
  const [dis, retirement] = await Promise.all([disKaynaklar(), retirementHedefleri()]);
  return { ...dis, retirement };
}

/** /overview ve etiket uclari icin JSON ozeti (indeksler disari cikmaz). */
function caprazDurumu(c) {
  if (!c) return null;
  const k = (x, ek) => ({ okunamadi: !!(x && x.okunamadi), hata: (x && x.hata) || '', ...ek });
  return {
    ocp: k(c.ocp, { uygulama: (c.ocp && c.ocp.uygulama) || 0 }),
    kullanim: k(c.kullanim, {
      olcum: c.kullanim && c.kullanim.indeks ? c.kullanim.indeks.size : 0,
    }),
    retirement: k(c.retirement, { hedef: c.retirement ? c.retirement.hedefler.length : 0 }),
  };
}

/** Yalniz testler: onbellegi bosaltir. */
function _sifirla() {
  _dis = { at: 0, deger: null };
}

module.exports = { caprazVeri, caprazDurumu, ocpIndeksi, _sifirla };
