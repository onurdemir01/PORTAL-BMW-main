// server/server-hub/uygulama-360.cjs - Server Hub > Uygulama 360 (2026-11-07; saf birlestirici + uclar).
//
// Kullanici: "portal genelindeki butun verilerden al incele carp karsilastir ... basitlestirilmis
// gorunumden istedikce acilan, ozellesen bilgi veren filtrelenen ekranlar". Sunucu sunucu degil
// UYGULAMA uygulama bakis: taban ad (capraz.cjs tabanAd: <APP>-D/-T/-Q ayni uygulama) basina tek satir.
//
// KAYNAKLAR (hepsi degerlendirmede zaten var; yeni sorgu YOK):
//   Server Hub JVM'leri   sunucu, ortam, nesil, calisma, auto-start, trafik, tier, tazelik
//   Uygulama Envanteri    EAR -> JVM eslemesi (domain.xml / host.xml), WAR sayisi, Faz 2 deployment
//   capraz.cjs            kopya tutarsizligi, ortam kalintisi, OpenShift + Dynatrace, Retirement celiskisi
//   Retirement            kopyanin hedefleri (j.retirement)
//   Etiket motoru         taban ada dusen JVM etiketleri (seviye, kurallar, manuel kontrol)
// Taramadan dusen sunucu satira girmez; bayat sunucudaki kopya girer ama bayat diye sayilir.
// OLCULEMEDI ile YOK ayridir: EAR verisi olmayan kopyada ear null ("bilinmiyor"), [] degil.
//
// GET /uygulamalar-360          ozet satirlar (kopyalar yok, sayilari var); ?fresh=1 tazeler
// GET /uygulama-360/:ad         tek uygulama: kopyalarin tamami (ortam x sunucu matrisi) + etiketleri
// Router zaten yalniz Admin ve gorunurluk kapisinin arkasinda (index.cjs). Kodlar proxy-guvenli:
// 400 gecersiz ad, 409 uygulama artik listede yok, 424 degerlendirme okunamadi.
'use strict';

const { tabanAd } = require('./capraz.cjs');
const { ozetle } = require('./retire-etiket.cjs');

const L = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase();
const U = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toUpperCase();
const ORTAM_SIRA = ['PROD', 'QA', 'TEST', 'DEV', 'EDU', 'ALPHA', 'ODM', 'BILINMIYOR'];
const ortamNo = (o) => (ORTAM_SIRA.indexOf(o) < 0 ? ORTAM_SIRA.length : ORTAM_SIRA.indexOf(o));
const SEVIYE = { KESIN: 2, SUPHELI: 1 };
// En kotu deployment durumu satira yazilir.
const DEP_SIRA = { FAILED: 5, YOK: 4, KAPALI: 3, OLCULEMEDI: 2, OK: 1 };
const kuralSirasi = (a, b) => Number(String(a).slice(1)) - Number(String(b).slice(1));

/** Faz 2 deployment: null = olculmedi (kontrol kapali, JVM kapali ya da veri yok). */
function deploymentOf(h, j) {
  const dep = h.ear && h.ear.durum === 'VAR' ? h.ear.deployment : null;
  if (!dep || !Array.isArray(dep.jvmler)) return null;
  const dj = dep.jvmler.find(
    (x) => L(x.ad) === L(j.name) && Number(x.nesil) === (Number(j.gen) || 0),
  );
  if (!dj) return null;
  if (dj.durum !== 'OK') return 'OLCULEMEDI';
  const dl = Array.isArray(dj.deploymentlar) ? dj.deploymentlar : [];
  if (!dl.length) return 'YOK';
  if (dl.some((d) => d.durum === 'FAILED')) return 'FAILED';
  if (dl.some((d) => d.etkin === false)) return 'KAPALI';
  return 'OK';
}

/** Bu JVM'e bagli EAR'lar (Uygulama Envanteri XML eslemesi); null = EAR verisi yok / eski. */
function earlerOf(h, j) {
  if (!h.ear || h.ear.durum !== 'VAR') return null;
  const gen = String(Number(j.gen) || 0);
  return (h.ear.uygulamalar || [])
    .filter(
      (u) =>
        (u.jboss === '?' || String(u.jboss) === gen) &&
        u.xml &&
        (u.xml.jvmler || []).some((x) => L(x.ad) === L(j.name)),
    )
    .map((u) => ({ ad: u.ad, kok: u.kok, warSayisi: u.warSayisi == null ? null : u.warSayisi }));
}

function kopyaOf(h, j) {
  const calisiyor = j.runningKnown === false ? null : !!j.running;
  const autoStart = j.autoStart || 'unknown';
  const olculen = (j.vhosts || []).filter((m) => m.v && m.v.req7d != null && m.v.req7d >= 0);
  return {
    host: h.host,
    ortam: h.env || 'BILINMIYOR',
    gen: Number(j.gen) || 0,
    ad: j.name,
    calisiyor,
    autoStart,
    // assess'teki REBOOT_RISK / STOPPED_AUTOSTART_ON ile ayni kosul (olculemeyen calisma karar vermez).
    autostartUyumsuz:
      (() => { if (calisiyor === true && autoStart === 'false') return 'REBOOT_RISK'; if (calisiyor === false && autoStart === 'true') return 'STOPPED_AUTOSTART_ON'; return null; })(),
    trafik: j.trafficState || null,
    istek7g: olculen.length ? olculen.reduce((t, m) => t + m.v.req7d, 0) : null,
    tier: j.tier == null ? null : String(j.tier),
    taze: !h.taramadanDustu && h.fresh !== false,
    taramaTarihi: h.scanDate || null,
    hostClass: h.hostClass || 'genel',
    retirement: j.retirement || [],
    capraz: j.capraz || null,
    ear: earlerOf(h, j),
    deployment: deploymentOf(h, j),
  };
}

const riskli = (k) =>
  !!(
    k.autostartUyumsuz ||
    (k.capraz && (k.capraz.kopya || k.capraz.kalinti || k.capraz.celiski.length))
  );

/** Kopyalardan uygulama satiri. */
function ozetOf(ad, kopyalar, etiketler) {
  const say = (f) => kopyalar.filter(f).length;
  const ortamlar = [...new Set(kopyalar.map((k) => k.ortam))]
    .sort((a, b) => ortamNo(a) - ortamNo(b) || a.localeCompare(b))
    .map((o) => {
      const l = kopyalar.filter((k) => k.ortam === o);
      return {
        ortam: o,
        toplam: l.length,
        acik: l.filter((k) => k.calisiyor === true).length,
        kapali: l.filter((k) => k.calisiyor === false).length,
        olculemedi: l.filter((k) => k.calisiyor === null).length,
      };
    });
  const trafikler = kopyalar.map((k) => k.trafik).filter(Boolean);
  // Trafik: biri ACTIVE ise var; hepsi olculup bos ise yok; aksi halde (olculemeyen ya da web katmani
  // eslenmeyen kopya) "olculemedi" — "yok" denmez.
  const trafik = (() => { if (trafikler.includes('ACTIVE')) return 'ACTIVE'; if (trafikler.length === kopyalar.length && trafikler.every((t) => t === 'NO_RECENT_TRAFFIC')) return 'NO_RECENT_TRAFFIC'; return 'OLCULEMEDI'; })();
  const istekler = kopyalar.map((k) => k.istek7g).filter((x) => x != null);
  const earli = kopyalar.filter((k) => k.ear !== null);
  const earAdlari = new Set(earli.flatMap((k) => k.ear.map((e) => U(e.ad))));
  const deps = kopyalar.map((k) => k.deployment).filter(Boolean);
  // OpenShift: kopyalarin eslesmeleri (namespace @ cluster bir kez); istek ortam grubu basina bir kez.
  const ocpKop = kopyalar.filter((k) => k.capraz && k.capraz.ocp);
  const yerler = new Map();
  const grupIstek = new Map();
  for (const k of ocpKop) {
    for (const e of k.capraz.ocp.eslesme) yerler.set(`${e.namespace}@${e.cluster}`, e);
    if (!grupIstek.has(k.ortam)) grupIstek.set(k.ortam, k.capraz.ocp.istek);
  }
  const ist = [...grupIstek.values()];
  const ret = new Map();
  for (const k of kopyalar)
    for (const r of k.retirement) if (!ret.has(r.hedef)) ret.set(r.hedef, { ...r, host: k.host });
  const seviye = etiketler.reduce(
    (m, e) => ((SEVIYE[e.seviye] || 0) > (SEVIYE[m] || 0) ? e.seviye : m),
    null,
  );
  return {
    anahtar: U(ad),
    ad,
    ortamlar,
    kopyaSayisi: kopyalar.length,
    sunucuSayisi: new Set(kopyalar.map((k) => k.host)).size,
    nesiller: [...new Set(kopyalar.map((k) => k.gen))].sort(),
    tier: [...new Set(kopyalar.map((k) => k.tier).filter(Boolean))].sort(),
    calisan: say((k) => k.calisiyor === true),
    kapali: say((k) => k.calisiyor === false),
    olculemeyen: say((k) => k.calisiyor === null),
    autostartUyumsuz: say((k) => !!k.autostartUyumsuz),
    kopyaTutarsiz: say((k) => !!(k.capraz && k.capraz.kopya)),
    kalinti: say((k) => !!(k.capraz && k.capraz.kalinti)),
    celiski: say((k) => !!(k.capraz && k.capraz.celiski.length)),
    riskliKopya: say(riskli),
    trafik,
    istek7g: istekler.length ? istekler.reduce((a, b) => a + b, 0) : null,
    ear: earli.length
      ? {
          sayi: earAdlari.size,
          war: earli.reduce((t, k) => t + k.ear.reduce((s, e) => s + (e.warSayisi || 0), 0), 0),
          olculmeyenKopya: kopyalar.length - earli.length,
        }
      : null,
    deployment: deps.length ? deps.reduce((a, b) => (DEP_SIRA[b] > DEP_SIRA[a] ? b : a)) : null,
    ocp: (() => { if (ocpKop.length) return {
          yerler: [...yerler.values()].slice(0, 10),
          yerSayisi: yerler.size,
          // Bir grupta istek varsa toplam kesin; hepsi olculmediyse null ("yok" degil).
          istek: ist.some((x) => x != null) ? ist.reduce((t, x) => t + (x || 0), 0) : null,
          tasinmisOlabilir: ocpKop.some((k) => k.capraz.ocp.tasinmisOlabilir),
        }; return null; })(),
    retirement: [...ret.values()].sort((a, b) => a.kayit - b.kayit || a.hedef - b.hedef),
    etiket: etiketler.length
      ? {
          seviye,
          kurallar: [...new Set(etiketler.flatMap((e) => e.kurallar))].sort(kuralSirasi),
          sayi: etiketler.length,
          bekleyen: etiketler.filter((e) => e.durum === 'BEKLIYOR' || e.durum === 'VERI_DEGISTI')
            .length,
          hazir: etiketler.filter((e) => e.retirementHazir).length,
        }
      : null,
    sonTarama: kopyalar.reduce(
      (m, k) => (k.taramaTarihi && k.taramaTarihi > (m || '') ? k.taramaTarihi : m),
      null,
    ),
    bayatKopya: say((k) => !k.taze),
  };
}

/**
 * @param {object[]} hosts      assess sunuculari
 * @param {object[]} etiketler  etiketle().etiketler (tam ya da ozet)
 * @returns {{ uygulamalar: object[], ayrinti: (anahtar: string) => object|null }}
 */
function uygulamalar360(hosts, etiketler = []) {
  const gruplar = new Map();
  for (const h of hosts || []) {
    if (h.taramadanDustu) continue;
    for (const j of h.jvms || []) {
      if (!j.name) continue;
      const t = tabanAd(j.name);
      const k = U(t);
      if (!gruplar.has(k)) gruplar.set(k, { ad: t, kopyalar: [] });
      gruplar.get(k).kopyalar.push(kopyaOf(h, j));
    }
  }
  const etiketIx = new Map();
  for (const e of etiketler || []) {
    if (e.tur !== 'JVM') continue;
    const k = U(tabanAd(e.ad));
    if (!etiketIx.has(k)) etiketIx.set(k, []);
    etiketIx.get(k).push(e);
  }
  const uygulamalar = [...gruplar.entries()].map(([k, g]) =>
    ozetOf(g.ad, g.kopyalar, etiketIx.get(k) || []),
  );
  uygulamalar.sort(
    (a, b) =>
      (SEVIYE[b.etiket && b.etiket.seviye] || 0) - (SEVIYE[a.etiket && a.etiket.seviye] || 0) ||
      b.riskliKopya - a.riskliKopya ||
      a.ad.localeCompare(b.ad, 'tr'),
  );
  return {
    uygulamalar,
    ayrinti: (anahtar) => {
      const k = U(anahtar);
      const g = gruplar.get(k);
      if (!g) return null;
      const ets = etiketIx.get(k) || [];
      return {
        ...ozetOf(g.ad, g.kopyalar, ets),
        kopyalar: [...g.kopyalar].sort(
          (a, b) =>
            ortamNo(a.ortam) - ortamNo(b.ortam) ||
            a.host.localeCompare(b.host) ||
            a.gen - b.gen ||
            a.ad.localeCompare(b.ad),
        ),
        etiketler: ets.map((e) => (e.kopyalar ? ozetle(e) : e)),
      };
    },
  };
}

const AD_RE = /^[A-Za-z0-9._-]{1,128}$/;

function mount(router, { etiketHesabi }) {
  router.get('/uygulamalar-360', async (req, res) => {
    try {
      const { a, sonuc } = await etiketHesabi(req.query.fresh === '1');
      const r = a.tableMissing ? { uygulamalar: [] } : uygulamalar360(a.hosts, sonuc.etiketler);
      res.json({
        ok: true,
        tableMissing: a.tableMissing === true,
        latestScan: a.latestScan || null,
        ear: a.ear || null,
        capraz: a.capraz || null,
        uygulamalar: r.uygulamalar,
      });
    } catch (err) {
      res
        .status(424)
        .json({ ok: false, message: (err && err.message) || 'Uygulama 360 hesaplanamadı.' });
    }
  });

  router.get('/uygulama-360/:ad', async (req, res) => {
    const ad = String(req.params.ad || '');
    if (!AD_RE.test(ad))
      return res.status(400).json({ ok: false, message: 'Geçersiz uygulama adı.' });
    try {
      const { a, sonuc } = await etiketHesabi(false);
      const u = a.tableMissing ? null : uygulamalar360(a.hosts, sonuc.etiketler).ayrinti(ad);
      if (!u)
        return res
          .status(409)
          .json({
            ok: false,
            message: `${ad} artık listede yok (tarama değişmiş olabilir); liste yenilendi.`,
          });
      res.json({
        ok: true,
        latestScan: a.latestScan || null,
        capraz: a.capraz || null,
        uygulama: u,
      });
    } catch (err) {
      res
        .status(424)
        .json({ ok: false, message: (err && err.message) || 'Uygulama 360 hesaplanamadı.' });
    }
  });
}

module.exports = { uygulamalar360, kopyaOf, deploymentOf, earlerOf, mount };
