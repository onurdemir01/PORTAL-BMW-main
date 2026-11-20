// server/server-hub/kopya-durumu.cjs - Server Hub > Kopya Durumu (2026-11-14; saf birlestirici + uc).
//
// Kullanici: "Bazi JBoss uygulamalari production'da toplam 5 makinede sadece birinde acik." KOPYA_TUTARSIZ
// bulgusu (assess.cjs) bunu kopya basina ve dagitik soyler; bu ekran UYGULAMA (kopya grubu) basina tek
// satir verir: "calisan 1 / 5".
//
// GRUPLAMA TEK KAYNAK: capraz.cjs kopyaGruplari + kopyaKarari (bulgu ile ayni kural; burada kopya
// eslemesi YENIDEN yazilmaz). Grup = ayni ortam + ayni JBoss nesli + ayni JVM adi (buyuk / kucuk harf
// duyarsiz). Farkli JVM adiyla kurulmus kopyalar (or. PAY1 / PAY2) ayni grup sayilmaz: ekran bunu yazar.
//
// SAYIM: bayat sunucudaki ya da calismasi olculemeyen kopya "bilinmiyor" sayilir, ASLA kapali sayilmaz.
// Tutarsizlik karari yalniz TAZE kopyalardan (KOPYA_TUTARSIZ ile birebir); bayat kopya satirda gorunur
// ama karar vermez. Yalniz iki ya da daha cok sunucuya yayilan gruplar listelenir.
// TARAMADAN DUSEN sunucu (assess: son tam taramada hic gorulmedi; silinmis de olabilir) sayima GIRMEZ
// (assess ana sayilari ve bulgulari gibi) ama sessiz de degil: grupta `dusen` olarak ayrica yazilir.
// Bulgular'daki "x/y kopya calisiyor" ayni paydayi kullanir (capraz.cjs toplamSayisi).
//
// GET /kopya-durumu   ?fresh=1 tazeler. Router zaten yalniz Admin ve ServerHub gorunurluk kapisinin
// arkasinda (index.cjs). Salt okunur: hicbir sey calistirmaz.
'use strict';

const { kopyaGruplari, kopyaKarari } = require('./capraz.cjs');

const taze = (h) => !h.taramadanDustu && h.fresh !== false;
const ORTAM_SIRA = ['PROD', 'QA', 'TEST', 'DEV', 'EDU'];
const ortamNo = (o) => (ORTAM_SIRA.indexOf(o) < 0 ? ORTAM_SIRA.length : ORTAM_SIRA.indexOf(o));

/** Ekrana ve yanita yazilan esleme aciklamasi (UI ayni metni gosterir). */
const ESLESME = {
  kural:
    'Aynı ortam + aynı JBoss nesli (7 / 8) + aynı JVM adı (büyük / küçük harf duyarsız), farklı sunucular.',
  kacirabilir:
    'Farklı JVM adıyla kurulmuş kopyalar (ör. PAY1 / PAY2 ya da PAY_A / PAY_B) aynı grup sayılmaz; bu ekran onları ayrı uygulama olarak görür ya da hiç göstermez.',
  aktifPasif:
    'Aktif / pasif (DR) kurgusunda bir kopyanın kapalı durması beklenen olabilir; karar vermeden önce uygulama sahibine sorun.',
  bayat:
    'Bayat sunucudaki ya da çalışması ölçülemeyen kopya “bilinmiyor” sayılır, kapalı sayılmaz ve tutarsızlık kararına girmez.',
  dusen:
    'Son tam taramada hiç görülmeyen (taramadan düşen) sunucudaki kopya toplama girmez; satırda ayrıca “taramadan düştü” diye yazılır (sunucu silinmiş de olabilir).',
  digerSinirlar:
    'JBoss nesli okunamayıp yalnız envanterden (MWAppsInventory) gelen JVM ayrı grup sayılır; ortamı belirlenemeyen (BİLİNMİYOR) ya da ODM sunucuları hiçbir gruba girmez.',
};

function kopyaOf(c, karar) {
  const { h, j } = c;
  const fresh = taze(h);
  const olculdu = j.runningKnown !== false;
  let durum = 'bilinmiyor';
  if (fresh && olculdu) durum = j.running ? 'calisiyor' : 'kapali';
  const ocp = j.capraz?.ocp ? j.capraz.ocp.eslesme || [] : [];
  return {
    host: h.host,
    // Son bilinen calisma (bayat sunucuda da yazilir); sayim `durum`dan yapilir.
    running: olculdu ? !!j.running : null,
    durum,
    autoStart: j.autoStart || 'unknown',
    serverState: j.serverState || 'unknown',
    fresh,
    scanDate: h.scanDate || null,
    sapma: fresh && karar ? karar.nedenler(c) : [],
    retirement: (j.retirement || []).map((r) => ({
      kayit: r.kayit,
      hedef: r.hedef,
      durum: r.durum,
    })),
    ocp: ocp.slice(0, 5).map((x) => ({ namespace: x.namespace, cluster: x.cluster })),
  };
}

/**
 * @param {object[]} hosts assess sunuculari (jvms[].retirement / jvms[].capraz assess'ten gelir)
 * @returns {{ gruplar: object[], ozet: object }}
 */
function kopyaDurumu(hosts) {
  const gruplar = [];
  const tum = kopyaGruplari(hosts || [], { bayatDahil: true, dusenDahil: true });
  for (const [anahtar, hepsi] of tum) {
    const grup = hepsi.filter((c) => !c.h.taramadanDustu);
    const dusenler = hepsi.filter((c) => c.h.taramadanDustu);
    const canliHost = new Set(grup.map((c) => c.h.host));
    // En az bir canli kopya ve (canli + dusen) iki ya da daha cok sunucu: "1/1 + 1 taramadan dustu" da gorunur.
    if (!canliHost.size || new Set([...canliHost, ...dusenler.map((c) => c.h.host)]).size < 2)
      continue;
    // Karar yalniz taze kopyalardan (KOPYA_TUTARSIZ ile ayni kume).
    const karar = kopyaKarari(grup.filter((c) => taze(c.h)));
    const copies = grup.map((c) => kopyaOf(c, karar)).sort((a, b) => a.host.localeCompare(b.host));
    const running = copies.filter((k) => k.durum === 'calisiyor').length;
    const stopped = copies.filter((k) => k.durum === 'kapali').length;
    const unknown = copies.length - running - stopped;
    const ret = new Map();
    for (const k of copies)
      for (const r of k.retirement) if (!ret.has(r.kayit)) ret.set(r.kayit, r);
    const ocp = new Map();
    for (const k of copies) for (const o of k.ocp) ocp.set(`${o.namespace}@${o.cluster}`, o);
    const ilk = grup[0];
    const olculen = running + stopped;
    gruplar.push({
      anahtar,
      app: ilk.j.name,
      env: ilk.h.env,
      gen: Number(ilk.j.gen) || 0,
      total: copies.length,
      running,
      stopped,
      unknown,
      // Siralama orani: bilinmiyor paydaya girmez; hic olculmeyen grup null (en sona).
      oran: olculen ? running / olculen : null,
      calismaTutarsiz: !!karar?.calismaTutarsiz,
      autoStartTutarsiz: !!karar?.autoStartTutarsiz,
      tutarsiz: !!(karar && (karar.calismaTutarsiz || karar.autoStartTutarsiz)),
      autoStartUyumsuz: copies.filter((k) => k.sapma.includes('autostart')).length,
      autoStartAcik: karar ? karar.autoStartAcik : 0,
      autoStartKapali: karar ? karar.autoStartKapali : 0,
      // Ayni sunucuda ayni JVM iki satir (cift-satir.cjs ayiklar) olsa bile sunucu bir kez yazilir.
      stoppedHosts: [...new Set(copies.filter((k) => k.durum === 'kapali').map((k) => k.host))],
      dusen: dusenler
        .map((c) => ({ host: c.h.host, scanDate: c.h.scanDate || null }))
        .sort((a, b) => a.host.localeCompare(b.host)),
      retirement: [...ret.values()].sort((a, b) => a.kayit - b.kayit),
      ocp: [...ocp.values()].slice(0, 5),
      copies,
    });
  }
  // Prod once; sonra calisma tutarsizligi (kullanicinin "5'te 1 acik" sorunu, yalniz auto-start farkinin
  // onunde); sonra en kotu oran calisan / (calisan + kapali) (bilinmiyor paydaya girmez, hic olculmeyen
  // en sona); sonra kopya sayisi (cok olan once), ortam, ad.
  const oranNo = (g) => (g.oran == null ? 2 : g.oran);
  gruplar.sort(
    (a, b) =>
      (a.env === 'PROD' ? 0 : 1) - (b.env === 'PROD' ? 0 : 1) ||
      (a.calismaTutarsiz ? 0 : 1) - (b.calismaTutarsiz ? 0 : 1) ||
      oranNo(a) - oranNo(b) ||
      b.total - a.total ||
      ortamNo(a.env) - ortamNo(b.env) ||
      String(a.app).localeCompare(String(b.app)) ||
      a.gen - b.gen,
  );
  const tut = gruplar.filter((g) => g.tutarsiz);
  return {
    gruplar,
    ozet: {
      grup: gruplar.length,
      tutarsiz: tut.length,
      prodTutarsiz: tut.filter((g) => g.env === 'PROD').length,
      calismaTutarsiz: gruplar.filter((g) => g.calismaTutarsiz).length,
      autoStartTutarsiz: gruplar.filter((g) => g.autoStartTutarsiz).length,
    },
  };
}

// Degerlendirme nesnesi basina tek hesap (getAssessment onbellekli nesneyi dondurur; yeni degerlendirme
// yeni nesne -> yeni hesap).
const _onbellek = new WeakMap();
function kopyaDurumuOnbellekli(a) {
  if (!a || typeof a !== 'object') return kopyaDurumu([]);
  if (!_onbellek.has(a)) _onbellek.set(a, kopyaDurumu(a.hosts));
  return _onbellek.get(a);
}

function mount(router, { getAssessment }) {
  router.get('/kopya-durumu', async (req, res) => {
    try {
      const a = await getAssessment(req.query.fresh === '1');
      const r = a.tableMissing
        ? {
            gruplar: [],
            ozet: {
              grup: 0,
              tutarsiz: 0,
              prodTutarsiz: 0,
              calismaTutarsiz: 0,
              autoStartTutarsiz: 0,
            },
          }
        : kopyaDurumuOnbellekli(a);
      res.json({
        ok: true,
        tableMissing: a.tableMissing === true,
        latestScan: a.latestScan || null,
        staleFleet: a.staleFleet || null,
        // Kucuk kaynak ozeti (OpenShift / Retirement okunamadi mi): ekran "karsilik bilinmiyor" notu yazar.
        capraz: a.capraz || null,
        eslesme: ESLESME,
        ...r,
      });
    } catch (err) {
      res.status(424).json({ ok: false, message: err?.message || 'Kopya durumu hesaplanamadı.' });
    }
  });
}

module.exports = { kopyaDurumu, ESLESME, mount };
