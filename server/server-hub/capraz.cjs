// server/server-hub/capraz.cjs - Server Hub capraz kontrolleri (2026-11-06; saf, birim testli).
//
// Tek sunucunun taramasi "bu JVM kapali" der; capraz kontrol "ayni uygulamanin oteki kopyalari,
// oteki ortamlari, OpenShift'teki karsiligi ve Retirement kaydi ne diyor" diye sorar. Kullanici
// anketinde secilenler (2026-11-06): auto-start uyumsuzlugu (assess zaten REBOOT_RISK /
// STOPPED_AUTOSTART_ON uretir; burada yalniz etiket adayi olur), kopyalar / ortamlar tutarsiz,
// OpenShift'e tasinmis + Retirement kaydi celiskisi. "Kaynaklar celisiyor" (MWAppsInventory <->
// tarama) SECILMEDI: INV_MISMATCH bulgusu olarak kalir.
//
// DORT KONTROL (sonuc JVM basina; bulguyu ve adayi assess.cjs yazar, bekciler kod adini orada arar):
//   kopya     ayni ortam + ayni JBoss nesli + ayni JVM adi, farkli sunucular: biri calisiyor biri
//             kapali ya da auto-start farkli. Sapan kopya isaretlenir (calisma: kapali olan;
//             auto-start: azinlik, esitlikte 'false' olan).
//   kalinti   taban ad (parseApp: <APP>-D/-T/-Q) prod'da calismiyor (hic yok / hepsi kapali /
//             Retirement'la durdurulmus) ama DEV / TEST / QA kopyasi calisiyor. Envanter
//             (MWAppsInventory) taranmamis bir prod kopyasi biliyorsa iddia KURULMAZ.
//   ocp       ayni taban ad OpenShift envanterinde ayni ortam grubunda (namespace son eki; DEV ve
//             TEST tek grup: JBoss ortami hostname'den, ikisini ayiramaz). Dynatrace istegi yazilir.
//   celiski   Retirement hedefi stopped / deleted ama JVM calisiyor, auto-start acik ya da paket
//             ozgun adiyla diskte (STOP paketi .<smart>.old yapar).
//
// KANIT KAPILARI: taramadan dusen ve bayat sunucu karar vermez (bayat kopya "bilinmiyor" sayilir);
// calismasi olculemeyen JVM ne calisiyor ne kapali sayilir. Ad eslemesi yalniz normAd ile birebir
// (kucuk harf, harf / rakam disi atilir); eslesen adlar kanitta yazilir.
'use strict';

const { parseApp } = require('../audit/app-envs.cjs');

const L = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase();
/** Ad eslemesinin TEK kurali: kucuk harf, harf / rakam disi her sey atilir. Tahmin yok. */
const normAd = (s) => L(s).replace(/[^a-z0-9]/g, '');
const U = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toUpperCase();
// assess.cjs shortHost ile ayni kural (IP kisaltilmaz).
const kisaHost = (s) =>
  /^\d+\.\d+\.\d+\.\d+$/.test(String(s || '').trim()) ? String(s).trim() : U(s).split('.')[0];

/** JBoss ortami -> karsilastirma grubu (DEV ve TEST hostname'den ayrilamaz). */
const ORTAM_GRUBU = { PROD: 'prod', QA: 'qa', TEST: 'devtest', DEV: 'devtest', EDU: 'edu' };
/** OpenShift namespace son eki -> ayni grup. */
const NS_GRUBU = { prod: 'prod', qa: 'qa', test: 'devtest', dev: 'devtest', edu: 'edu' };
const NONPROD = new Set(['DEV', 'TEST', 'QA']);
/** STOP / silme yapilmis hedef: JVM kapali, auto-start kapali, paket yeniden adlandirilmis olmali. */
const KAPATILMIS = new Set(['stopped', 'deleted']);

/** Taban uygulama adi: standart son ek (-D/-T/-Q, kucuk harf dahil) atilir; tanimsiz ekte ad aynen kalir. */
function tabanAd(ad) {
  const p = parseApp(String(ad || '').trim());
  return p.env ? p.base : String(ad || '').trim();
}

const taze = (h) => !h.taramadanDustu && h.fresh !== false;
const bilinen = (j) => j.runningKnown !== false;
const yolAdi = (y) =>
  String(y || '')
    .replace(/\/+$/, '')
    .split('/')
    .pop();

/**
 * @param {object[]} hostlar  assess sunuculari (env, fresh, taramadanDustu, jvms)
 * @param {{ capraz?: object|null, envanter?: Array<{ app: string, env: string|null }>,
 *   earOf?: (host: string) => { uygulamalar: Array<{ ad: string, kok: string }> }|null }} g
 *   earOf: sunucunun TAZE Uygulama Envanteri verisi (yoksa / eskiyse null: paket iddiasi kurulmaz)
 * @returns {{ jvm: (host: string, j: object) => object|null, host: (host: string) => object[] }}
 */
function caprazAnaliz(hostlar, { capraz = null, envanter = [], earOf = () => null } = {}) {
  const ocp = capraz && capraz.ocp && !capraz.ocp.okunamadi ? capraz.ocp.indeks : null;
  const kullanim =
    capraz && capraz.kullanim && !capraz.kullanim.okunamadi ? capraz.kullanim.indeks : null;
  const ret =
    capraz && capraz.retirement && !capraz.retirement.okunamadi ? capraz.retirement.hedefler : null;
  const sonuc = new Map();
  const hostSonuc = new Map();
  const anahtar = (h, j) => `${h.host}|${Number(j.gen) || 0}|${L(j.name)}`;
  const al = (h, j) => {
    const k = anahtar(h, j);
    if (!sonuc.has(k))
      sonuc.set(k, { kopya: null, kalinti: null, ocp: null, celiski: [], retirement: [] });
    return sonuc.get(k);
  };
  const ekle = (m, k, v) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  };

  const canli = hostlar.filter((h) => !h.taramadanDustu);
  // ── Retirement indeksi: host|uygulama -> hedefler ─────────────────────────────
  const retIx = new Map();
  for (const t of ret || []) ekle(retIx, `${kisaHost(t.host)}|${L(t.uygulama)}`, t);
  const retOf = (h, j) =>
    (retIx.get(`${h.host}|${L(j.name)}`) || []).filter(
      (t) => t.gen == null || t.gen === (Number(j.gen) || 0),
    );

  // ── Tek gecis: kopya gruplari, taban ad gruplari ────────────────────────────────
  const kopyaIx = new Map();
  const tabanIx = new Map();
  for (const h of canli)
    for (const j of h.jvms || []) {
      if (!j.name) continue;
      if (taze(h) && ORTAM_GRUBU[h.env])
        ekle(kopyaIx, `${h.env}|${Number(j.gen) || 0}|${L(j.name)}`, { h, j });
      ekle(tabanIx, U(tabanAd(j.name)), { h, j });
      const r = retOf(h, j);
      if (r.length)
        al(h, j).retirement = r.map((t) => ({ kayit: t.kayit, hedef: t.hedef, durum: t.durum }));
    }

  // ── kopya: ayni ortamda sapan kopya ─────────────────────────────────────────
  for (const grup of kopyaIx.values()) {
    if (new Set(grup.map((c) => c.h.host)).size < 2) continue;
    const olculen = grup.filter((c) => bilinen(c.j));
    const acik = olculen.filter((c) => c.j.running);
    const kapali = olculen.filter((c) => !c.j.running);
    const as = grup.filter((c) => c.j.autoStart === 'true' || c.j.autoStart === 'false');
    const t = as.filter((c) => c.j.autoStart === 'true').length;
    const f = as.length - t;
    const cogunluk = t >= f ? 'true' : 'false';
    for (const c of grup) {
      const nedenler = [];
      if (acik.length && kapali.includes(c)) nedenler.push('calisma');
      if (t && f && as.includes(c) && c.j.autoStart !== cogunluk) nedenler.push('autostart');
      if (!nedenler.length) continue;
      al(c.h, c.j).kopya = {
        nedenler,
        digerleri: grup
          .filter((x) => x !== c)
          .slice(0, 10)
          .map((x) => ({
            host: x.h.host,
            calisiyor: bilinen(x.j) ? !!x.j.running : null,
            autoStart: x.j.autoStart || 'unknown',
          })),
        kopyaSayisi: grup.length,
      };
    }
  }

  // ── kalinti: prod'da calismayan uygulamanin non-prod kopyasi calisiyor ─────────
  const envanterProd = new Set();
  for (const a of envanter || [])
    if (a && a.env === 'PROD' && a.app) envanterProd.add(U(tabanAd(a.app)));
  for (const [taban, liste] of tabanIx) {
    const calisanNonprod = liste.filter(
      (c) => NONPROD.has(c.h.env) && taze(c.h) && bilinen(c.j) && c.j.running,
    );
    if (!calisanNonprod.length) continue;
    const prod = liste.filter((c) => c.h.env === 'PROD');
    // Bayat ya da olculemeyen prod kopyasi: prod'un bugunku durumu bilinmiyor, iddia kurulmaz.
    if (prod.some((c) => !taze(c.h) || !bilinen(c.j))) continue;
    if (prod.some((c) => c.j.running)) continue;
    if (!prod.length && envanterProd.has(taban)) continue;
    const prodRet = prod.flatMap((c) => retOf(c.h, c.j)).filter((x) => KAPATILMIS.has(x.durum));
    const neden = (() => { if (prodRet.length) return 'PROD_RETIRE'; if (prod.length) return 'PROD_KAPALI'; return 'PROD_YOK'; })();
    const ocpProd = ocp
      ? (ocp.get(normAd(taban)) || []).filter((x) => NS_GRUBU[x.ortam] === 'prod')
      : null;
    for (const c of calisanNonprod)
      al(c.h, c.j).kalinti = {
        neden,
        // Metinde bu kopyanin kendi yazimi (indeks anahtari buyuk harf).
        taban: tabanAd(c.j.name),
        prodKopyalar: prod
          .slice(0, 10)
          .map((p) => ({ host: p.h.host, autoStart: p.j.autoStart || 'unknown' })),
        retirement: [...new Set(prodRet.map((x) => x.kayit))],
        ocpProd: ocpProd
          ? ocpProd.slice(0, 5).map((x) => ({ namespace: x.namespace, cluster: x.cluster }))
          : null,
      };
  }

  // ── ocp: ayni taban ad OpenShift'te ayni ortam grubunda ─────────────────────────
  if (ocp)
    for (const h of canli) {
      const grup = ORTAM_GRUBU[h.env];
      if (!grup || !taze(h)) continue;
      for (const j of h.jvms || []) {
        if (!j.name) continue;
        const taban = tabanAd(j.name);
        const hits = (ocp.get(normAd(taban)) || []).filter((x) => NS_GRUBU[x.ortam] === grup);
        if (!hits.length) continue;
        // Dynatrace: (namespace, uygulama) basina bir olcum; ayni cift iki cluster'da olsa da bir kez.
        let istek = null;
        let olculdu = !!kullanim;
        let pencere = 0;
        if (kullanim) {
          istek = 0;
          for (const k of new Set(hits.map((x) => `${L(x.namespace)}|${L(x.uygulama)}`))) {
            const o = kullanim.get(k);
            if (!o || o.reqShown == null) olculdu = false;
            else {
              istek += o.reqShown;
              if (o.windowDays && (!pencere || o.windowDays < pencere)) pencere = o.windowDays;
            }
          }
          // Olculen bir yerde istek varsa "var" kesin; hepsi olculmediyse 0 "yok" degildir.
          if (!olculdu && istek === 0) istek = null;
        }
        const jbossBos = (bilinen(j) && !j.running) || j.trafficState === 'NO_RECENT_TRAFFIC';
        al(h, j).ocp = {
          eslesme: hits
            .slice(0, 10)
            .map((x) => ({ namespace: x.namespace, cluster: x.cluster, uygulama: x.uygulama })),
          eslesmeSayisi: hits.length,
          ad: { jboss: j.name, taban, ocp: hits[0].uygulama },
          istek,
          istekOlculdu: olculdu,
          pencereGun: pencere || null,
          kullanimOkunamadi: !kullanim,
          tasinmisOlabilir: jbossBos && istek != null && istek > 0,
          aday: jbossBos || (istek != null && istek > 0),
        };
      }
    }

  // ── celiski: Retirement STOP / silme yapildi ama sunucu baska soyluyor ─────────
  if (ret) {
    const hostIx = new Map(canli.filter(taze).map((h) => [h.host, h]));
    for (const t of ret) {
      if (!KAPATILMIS.has(t.durum)) continue;
      const h = hostIx.get(kisaHost(t.host));
      if (!h) continue;
      const paket = yolAdi(t.yol);
      const ear = paket ? earOf(h.host) : null;
      const earDiskte = (ear && (ear.uygulamalar || []).find((u) => U(u.ad) === U(paket))) || null;
      const jvmler = (h.jvms || []).filter(
        (j) => L(j.name) === L(t.uygulama) && (t.gen == null || t.gen === (Number(j.gen) || 0)),
      );
      const ozet = { kayit: t.kayit, hedef: t.hedef, durum: t.durum, durduruldu: t.durduruldu };
      for (const j of jvmler) {
        const nedenler = [];
        if (bilinen(j) && j.running) nedenler.push('calisiyor');
        if (j.autoStart === 'true') nedenler.push('autostart');
        if (earDiskte) nedenler.push('paket');
        if (nedenler.length)
          al(h, j).celiski.push({ ...ozet, nedenler, paket: earDiskte ? earDiskte.ad : null });
      }
      // JVM taramada yok ama paket ozgun adiyla diskte: sunucu duzeyinde (EAR konusu).
      if (!jvmler.length && earDiskte)
        ekle(hostSonuc, h.host, {
          ...ozet,
          uygulama: t.uygulama,
          paket: earDiskte.ad,
          kok: earDiskte.kok,
        });
    }
  }

  return {
    jvm: (host, j) => sonuc.get(`${host}|${Number(j.gen) || 0}|${L(j.name)}`) || null,
    host: (host) => hostSonuc.get(host) || [],
  };
}

// ── Bulgu metinleri (assess.cjs yazar; ekran ve CSV ayni metni gosterir) ──────────
const AS_TR = (v) => { if (v === 'true') return 'açık'; if (v === 'false') return 'kapalı'; return 'bilinmiyor'; };
const fazlasi = (toplam, gosterilen) => (toplam > gosterilen ? ` +${toplam - gosterilen}` : '');

function kopyaMetni(j, k) {
  const parca = [];
  if (k.nedenler.includes('calisma')) parca.push('bu kopya kapalı, aynı ortamda çalışan kopya var');
  if (k.nedenler.includes('autostart'))
    parca.push(
      `auto-start ${AS_TR(j.autoStart).toLocaleUpperCase('tr')}, öteki kopyalardan farklı`,
    );
  const d = k.digerleri
    .map(
      (x) =>
        `${x.host} (${(() => { if (x.calisiyor == null) return 'ölçülemedi'; if (x.calisiyor) return 'çalışıyor'; return 'kapalı'; })()}, auto-start ${AS_TR(x.autoStart)})`,
    )
    .join(', ');
  return `${parca.join('; ')} — öteki kopyalar: ${d}${fazlasi(k.kopyaSayisi - 1, k.digerleri.length)}`;
}

function kalintiMetni(k) {
  const neden =
    (() => { if (k.neden === 'PROD_YOK') return "prod'da kopyası yok (tarama ve envanter)"; if (k.neden === 'PROD_RETIRE') return `prod kopyası Retirement ile durduruldu (#${k.retirement.join(', #')})`; return `prod kopyaları kapalı: ${k.prodKopyalar.map((p) => p.host).join(', ')}`; })();
  const o = k.ocpProd && k.ocpProd[0];
  const ocp = o
    ? ` — OpenShift prod'da var (${o.namespace} @ ${o.cluster}${fazlasi(k.ocpProd.length, 1)}): uygulama taşınmış olabilir`
    : '';
  return `${neden}${ocp}`;
}

function ocpMetni(o) {
  const e = o.eslesme[0];
  const yer = `${e.namespace} @ ${e.cluster}${fazlasi(o.eslesmeSayisi, 1)}`;
  const istek = (() => { if (o.kullanimOkunamadi) return 'Dynatrace okunamadı'; if (o.istek == null) return 'Dynatrace isteği ölçülemedi'; return `Dynatrace ${o.pencereGun || 7} gün: ${o.istek} istek`; })();
  const ad = o.ad.jboss === o.ad.ocp ? '' : ` (ad eşleşmesi: ${o.ad.jboss} ↔ ${o.ad.ocp})`;
  const tasinma = o.tasinmisOlabilir
    ? " — JBoss kopyası boşta, uygulama OpenShift'e taşınmış olabilir"
    : '';
  return `OpenShift'te de var: ${yer}${ad} — ${istek}${tasinma}`;
}

function celiskiMetni(c) {
  const p = [];
  if (c.nedenler.includes('calisiyor')) p.push('JVM çalışıyor');
  if (c.nedenler.includes('autostart')) p.push("auto-start AÇIK (reboot'ta geri gelir)");
  if (c.nedenler.includes('paket')) p.push(`paket özgün adıyla diskte (${c.paket})`);
  const ne = c.durum === 'deleted' ? 'silindi' : 'STOP edildi';
  return `Retirement #${c.kayit} hedefi ${ne}${c.durduruldu ? (" (" + c.durduruldu + ")") : ''} ama ${p.join(', ')}`;
}

module.exports = {
  caprazAnaliz,
  tabanAd,
  normAd,
  kopyaMetni,
  kalintiMetni,
  ocpMetni,
  celiskiMetni,
  ORTAM_GRUBU,
  NS_GRUBU,
};
