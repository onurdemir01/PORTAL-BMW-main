// server/nginx-loadtest/coklu.cjs -- Yuk Testi "Coklu karsilastirma" (2026-11-04): bir referansa karsi en cok 15 aday.
//
// Kullanici: "ardi ardina 12-16 test kosacagim, hepsini tek sayfada karsilastirmak istiyorum". Iki kosulu /karsilastir
// AYNEN kalir; bu modul GET /karsilastir-coklu'nun SAF hesabidir (DB yok, saat yok):
//   * Her aday icin ref'e karsi analiz.kararVer (ayni esikler; ayni motor / protokol / hedef turu / is parcacigi / tavan
//     secenekleri) -> karar, nedenler, kademe, kombinasyon.
//   * Her kosu icin hiz basina ozet: kararVer'in gruplari (analiz.hizOzeti: p95, p99, CPU-ms/istek, host CPU, en yuksek
//     hata, tekrar / gecerli tekrar, gurultu) + gorunum satirlarindan kapasite, test trafigi (alinan bit/sn; yeni ag
//     alanlari), bellek (PSS ortalamasi, yoksa nginx RSS ortalamasi), kip durumu. Olculmeyen deger null (eski kosu).
//   * Ref'e gore % fark ve gurultu disi mi: analiz.farkDurumu (kararVer'in gurultu x3 / esik kurali; kurali olmayan olcu
//     'renklendirilmez'). Aday satiri ref'i KENDI kararinin kombinasyonuyla okur (ayni senaryo/kip/ae).
//   * Uyumsuz kosular (farkli hedef turu / hedef / motor / protokol / wrk tavani / wrk is parcacigi, kararVer VERI_YOK ya da
//     hesaplanamadi) `karsilastirilamaz` grubunda, neden koduyla; kararVer bu kosular icin cagrilmaz (VERI_YOK haric).
// Girdi kosu nesnesi: { meta: kosuMeta(...), analizAdimlari (snake, adimAnaliz), gorunumAdimlari (camel, adimApi) }.
'use strict';

const MAX_KOSU = 16;
const GECERLI = new Set(['GECERLI', 'DOYMA']);
const PROTOKOL_ADI = Object.freeze({ h1: 'HTTP/1.1', h2: 'HTTP/2' });
const TUR_ADI = Object.freeze({ sunucu: 'sunucu', serbest: 'serbest hedef' });

/** Olcu anahtari (API, camelCase) -> grup alani (analiz.farkDurumu olcusu). Grupta olmayanlar gorunum satirlarindan. */
const OLCU_ALANI = Object.freeze({
  p95: 'p95', p99: 'p99', cpuMsIstek: 'cpu_ms_istek', hostCpu: 'host_cpu_ort', hata: 'hata_orani',
  kapasite: 'kapasite', bantBps: 'bant_bps', bellekMb: 'bellek_mb',
});
const OLCULER = Object.freeze(Object.keys(OLCU_ALANI));

const sonlu = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const ortalama = (xs) => {
  const v = xs.map(sonlu).filter((x) => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const komboAnahtari = (k) => `${k.senaryo}|${k.kip}|${k.ae}`;

/** Kosu satiri (DB, snake) + cozulmus alanlar -> karsilastirma meta'si. */
function kosuMeta(r, { motor, protokol, parametreler }) {
  const p = parametreler && typeof parametreler === 'object' ? parametreler : {};
  return {
    id: Number(r.id),
    etiket: r.etiket ?? null,
    createdAt: r.created_at == null ? null : r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    createdBy: r.created_by ?? null,
    durum: r.durum ?? null,
    gecerlilik: r.gecerlilik ?? null,
    motor,
    protokol,
    hedefTuru: r.hedef_turu || 'sunucu',
    hedefHost: r.hedef_host || null,
    hedefIp: r.hedef_ip ?? null,
    vhost: r.vhost ?? null,
    senaryoId: r.senaryo_id == null ? null : Number(r.senaryo_id),
    senaryoAd: r.senaryo_ad ?? null,
    isParcacigi: sonlu(p.is_parcacigi),
    tavanRps: sonlu(p.tavan_rps),
  };
}

const hedefOf = (m) => m.hedefHost || m.hedefIp || '';

/** Ref'e gore uyumsuzluk nedenleri (bos dizi: karsilastirilabilir). Kod sabit; metin ekranda aynen. */
function uyumsuzluk(ref, m) {
  const n = [];
  if (ref.hedefTuru !== m.hedefTuru) n.push({ kod: 'hedef_turu', metin: `Hedef türü farklı (referans ${TUR_ADI[ref.hedefTuru] || ref.hedefTuru}, bu koşu ${TUR_ADI[m.hedefTuru] || m.hedefTuru}).` });
  if (hedefOf(ref) !== hedefOf(m)) n.push({ kod: 'hedef', metin: `Hedef farklı (referans ${hedefOf(ref) || '—'}, bu koşu ${hedefOf(m) || '—'}).` });
  if (ref.motor !== m.motor) n.push({ kod: 'motor', metin: `Yük aracı farklı (referans ${ref.motor}, bu koşu ${m.motor}); k6 istek/sn, wrk bağlantı sayar.` });
  if (ref.protokol !== m.protokol) n.push({ kod: 'protokol', metin: `Protokol farklı (referans ${PROTOKOL_ADI[ref.protokol]}, bu koşu ${PROTOKOL_ADI[m.protokol]}).` });
  if (ref.motor === 'wrk' && m.motor === 'wrk') {
    if (ref.tavanRps !== null && m.tavanRps !== null && ref.tavanRps !== m.tavanRps) n.push({ kod: 'tavan', metin: `Hız tavanı farklı (referans ${ref.tavanRps}, bu koşu ${m.tavanRps} istek/sn): aynı bağlantı kademesi farklı yük demektir.` });
    if (ref.isParcacigi !== null && m.isParcacigi !== null && ref.isParcacigi !== m.isParcacigi) n.push({ kod: 'is_parcacigi', metin: `İş parçacığı sayısı farklı (referans ${ref.isParcacigi}, bu koşu ${m.isParcacigi}).` });
  }
  return n;
}

/** Gorunum satirlarindan (camel) bir kombo + hizdaki ek olculer. */
function ekOlculer(gorunum, kombo, hiz) {
  const satir = gorunum.filter((a) => a && a.senaryo === kombo.senaryo && a.kip === kombo.kip && a.ae === kombo.ae && Math.trunc(Number(a.hiz)) === hiz);
  const gecerli = satir.filter((a) => GECERLI.has(a.gecerlilik));
  // p95 ile ayni kume: yuk makinesi doymus adim olcume girmez (analiz grupHesapla olcumKume).
  const olcum = gecerli.some((a) => a.yukDoydu) ? gecerli.filter((a) => !a.yukDoydu) : gecerli;
  const pss = ortalama(olcum.map((a) => a.bellekDetay && a.bellekDetay.pssOrtMb));
  const rss = pss === null ? ortalama(olcum.map((a) => a.bellek && a.bellek.nginxRssOrtMb)) : null;
  const kipler = satir.map((a) => (a.kipDogrulama && a.kipDogrulama.durum) || 'olculmedi');
  return {
    // Kapasite CPU-ms/istek'ten turetilir: CPU kumesi gibi yalniz GECERLI adimlar (gorunum null'lari olculmedi).
    kapasite: ortalama(satir.filter((a) => a.gecerlilik === 'GECERLI').map((a) => a.kapasiteRps)),
    bantBps: ortalama(olcum.map((a) => a.ag && a.ag.testAlinanBps)),
    bellekMb: pss !== null ? pss : rss,
    bellekKaynak: pss !== null ? 'pss' : rss !== null ? 'rss' : null,
    kip: kipler.includes('uyari') ? 'uyari' : kipler.includes('tamam') ? 'tamam' : 'olculmedi',
  };
}

/** Bir kosunun kombo'daki hiz satirlari: grup + ek olculer. */
function hizSatirlari(analiz, kosu, kombo) {
  const { gruplar } = analiz.hizOzeti(kosu.analizAdimlari, kombo);
  const out = new Map();
  for (const hiz of [...gruplar.keys()].sort((a, b) => a - b)) {
    const g = gruplar.get(hiz);
    const ek = ekOlculer(kosu.gorunumAdimlari, kombo, hiz);
    out.set(hiz, {
      grup: g,
      deger: {
        hiz,
        p95: sonlu(g.p95), p99: sonlu(g.p99), cpuMsIstek: sonlu(g.cpu_ms_istek) !== null && g.cpu_ms_istek > 0 ? g.cpu_ms_istek : null,
        hostCpu: sonlu(g.host_cpu_ort), hata: sonlu(g.hata_max),
        kapasite: ek.kapasite, bantBps: ek.bantBps, bellekMb: ek.bellekMb, bellekKaynak: ek.bellekKaynak, kip: ek.kip,
        gecerlilik: String(g.durum || ''), tekrar: g.n_kosu, gecerliTekrar: g.n_gecerli,
        gurultuCpu: sonlu(g.gurultu_cpu), gurultuP95: sonlu(g.gurultu_p95),
      },
    });
  }
  return out;
}

/** Ref ve aday hiz satirlarindan olcu basina fark (analiz.farkDurumu). */
function farklar(analiz, rs, as, esikler) {
  const f = {};
  for (const o of OLCULER) {
    const alan = OLCU_ALANI[o];
    if (!rs || !as) {
      f[o] = { yuzde: null, durum: 'yok', esikYuzde: null, gurultuBilinmiyor: false };
      continue;
    }
    if (o === 'bellekMb' && rs.deger.bellekKaynak && as.deger.bellekKaynak && rs.deger.bellekKaynak !== as.deger.bellekKaynak) {
      // PSS ile RSS ayni olcu degil: yuzde verilmez.
      f[o] = { yuzde: null, durum: 'yok', esikYuzde: null, gurultuBilinmiyor: false };
      continue;
    }
    const grupMu = ['p95', 'p99', 'cpu_ms_istek', 'host_cpu_ort', 'hata_orani'].includes(alan);
    const rg = grupMu ? rs.grup : { [alan]: rs.deger[o] };
    const ag = grupMu ? as.grup : { [alan]: as.deger[o] };
    f[o] = analiz.farkDurumu(alan, rg, ag, esikler);
  }
  return f;
}

/** Karar kademesindeki ozet farklar: CPU (CPU kademesi), p95 / bant / bellek (p95 kademesi; yoksa CPU kademesi). */
function kademeFarki(satirlar, kademe) {
  const al = (hiz, o) => {
    const s = hiz == null ? null : satirlar.find((x) => x.hiz === hiz);
    if (!s) return null;
    return { hiz, ref: s.ref ? s.ref[o] : null, aday: s.deger[o], ...s.fark[o] };
  };
  const kc = kademe ? kademe.cpu : null;
  const kp = kademe ? (kademe.p95 ?? kademe.cpu) : null;
  return { cpu: al(kc, 'cpuMsIstek'), p95: al(kp, 'p95'), bant: al(kp, 'bantBps'), bellek: al(kp, 'bellekMb'), hata: al(kp, 'hata') };
}

/**
 * @param {{ ref: object, adaylar: object[], analiz: object, esikler?: {esikCpu?: number, esikP95?: number} }} p
 */
function cokluKarsilastir({ ref, adaylar, analiz, esikler = {} }) {
  const e = { ...(esikler.esikCpu !== undefined ? { esikCpu: esikler.esikCpu } : {}), ...(esikler.esikP95 !== undefined ? { esikP95: esikler.esikP95 } : {}) };
  const refOzet = analiz.hizOzeti(ref.analizAdimlari);
  const refKombolar = new Map();
  const refSatirlari = (kombo) => {
    const k = komboAnahtari(kombo);
    if (!refKombolar.has(k)) refKombolar.set(k, hizSatirlari(analiz, ref, kombo));
    return refKombolar.get(k);
  };
  const kendi = refSatirlari(refOzet.kombo);
  const refCikti = {
    ...ref.meta,
    kombinasyon: refOzet.kombo,
    hizlar: [...kendi.values()].map((s) => s.deger),
  };
  const kiyas = [];
  const karsilastirilamaz = [];
  for (const a of adaylar) {
    const m = a.meta;
    const u = uyumsuzluk(ref.meta, m);
    if (u.length) {
      karsilastirilamaz.push({ ...m, nedenler: u, karar: null, kararNedenleri: [] });
      continue;
    }
    let k;
    try {
      k = analiz.kararVer(ref.analizAdimlari, a.analizAdimlari, {
        ...e,
        refMotor: ref.meta.motor, adayMotor: m.motor, refHedefTuru: ref.meta.hedefTuru, adayHedefTuru: m.hedefTuru,
        refIsParcacigi: ref.meta.isParcacigi, adayIsParcacigi: m.isParcacigi, refTavanRps: ref.meta.tavanRps, adayTavanRps: m.tavanRps,
        refProtokol: ref.meta.protokol, adayProtokol: m.protokol,
      });
    } catch (err) {
      karsilastirilamaz.push({ ...m, nedenler: [{ kod: 'hesaplanamadi', metin: `Karşılaştırma hesaplanamadı: ${String((err && err.message) || err).slice(0, 200)}` }], karar: null, kararNedenleri: [] });
      continue;
    }
    if (k.karar === 'VERI_YOK') {
      const son = (k.nedenler || []).slice(1).join('; ') || 'ortak kademe ya da ölçüm yok';
      karsilastirilamaz.push({ ...m, nedenler: [{ kod: 'veri_yok', metin: `Karşılaştırılacak ortak ölçüm yok (${son}).` }], karar: 'VERI_YOK', kararNedenleri: k.nedenler || [] });
      continue;
    }
    const kombo = k.kombinasyon || refOzet.kombo;
    const rS = refSatirlari(kombo);
    const aS = hizSatirlari(analiz, a, kombo);
    const satirlar = [...aS.entries()].map(([hiz, s]) => ({
      hiz, deger: s.deger, ref: rS.has(hiz) ? rS.get(hiz).deger : null, fark: farklar(analiz, rS.get(hiz), s, e),
    }));
    kiyas.push({
      ...m,
      karar: k.karar,
      kararNedenleri: k.nedenler || [],
      kademe: k.kademe || null,
      kombinasyon: kombo,
      hizlar: satirlar.map((s) => ({ ...s.deger, fark: s.fark })),
      kademeFarki: kademeFarki(satirlar, k.kademe),
    });
  }
  return {
    ref: refCikti,
    adaylar: kiyas,
    karsilastirilamaz,
    olculer: [...OLCULER],
    esikler: { esikCpu: e.esikCpu ?? 10, esikP95: e.esikP95 ?? 10, esikZarar: 5 },
  };
}

module.exports = { cokluKarsilastir, kosuMeta, uyumsuzluk, MAX_KOSU, OLCULER, _ekOlculerForTest: ekOlculer };
