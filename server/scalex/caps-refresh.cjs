// server/scalex/caps-refresh.cjs — YETENEK ONBELLEGI ARKA PLANDA TAZELENIR.
//
// NEDEN VAR
// ─────────
// URETIMDE OLCULDU (2026-09-30, iki AWX isi): kesif cluster basina 11-15 sn
// suruyordu ve bunun buyuk kismi ekstra CRD enumerasyonuydu (API grubu basina
// bir `oc get --raw`, ~50 cagri + iki `oc api-resources`). Enumerasyon kesiften
// CIKARILDI; kesif artik yalnizca bilinen tipleri ve ONBELLEKTEKI ekstra
// tipleri tarar.
//
// Onbellegi kim dolduracak? Kullanicinin karari: *"en dinamik, en hizli,
// guvenli; arka planda ne oldugu kullaniciyi ilgilendirmesin."* Bu modul, kesif
// istegi geldiginde kaydi OLMAYAN ya da BAYAT cluster'lar icin ayri bir
// `capabilities` AWX isi baslatir, onu SUNUCU TARAFINDA izler ve bitince
// onbellege yazar. Kesif onu BEKLEMEZ; bir sonraki kesif yeni tipi kendiliginden
// tarar.
//
// IKINCI HATA DA BURADA KAPANIYOR: Admin > "Tara" dugmesi `capabilities` isini
// baslatiyordu ama sonucu yazan kod yalnizca `/discover/:s/:j/status` YOKLANDIGINDA
// kosuyordu — ve o dugmeden sonra hicbir sey yoklamiyordu. Tarama yapiliyor,
// sonuc HICBIR ZAMAN tabloya yazilmiyordu. `izleVeKaydet` iki yolu da kapsar.
//
// GUVENLIK SINIRLARI
//   * Tetik cluster BASINA tekildir: ayni cluster icin ayni anda IKI arka plan
//     isi olmaz (`_ucan`).
//   * Basarisiz ya da sonucsuz bir deneme SOGUMA suresi boyunca tekrarlanmaz
//     (`_sonDeneme`) — kirik bir cluster her kesifte yeni bir AWX isi acmaz.
//   * Hicbir hata istegi DUSURMEZ: kesif arka plan isinin basarisina bagli degil.
'use strict';

/** Kayit bu kadar gunden eskiyse arka planda tazelenir. */
const TAZELEME_GUN = 7;
/** Ayni cluster icin iki deneme arasi en az bu kadar beklenir. */
const SOGUMA_MS = 10 * 60 * 1000;
/** Izleyici AWX'e bu aralikla sorar. Durum cagrisi stdout INDIRMEZ. */
const YOKLAMA_MS = 5000;
/** Izleyici en fazla bu kadar bekler; sonra vazgecer (is AWX'te surebilir). */
const AZAMI_IZLEME_MS = 15 * 60 * 1000;

const _ucan = new Set();
const _sonDeneme = new Map();

function anahtar(env, tenant, cluster) {
  return `${String(env).toLowerCase()}|${String(tenant).toLowerCase()}|${String(cluster).toLowerCase()}`;
}

/**
 * Saf karar: hangi cluster'lar tazelenmeli.
 *
 * Kayit YOK ya da `fetchedAt` TAZELEME_GUN'den eski → tazelenir. OKUNAMAMIS
 * kayit da ayni kurala baglidir: yetki eksigi kendiliginden gecmez, onu her
 * kesifte yeniden sormak her kesifte bosuna bir AWX isi demekti.
 */
function tazelenecekler(kayitlar, clusters, simdi = Date.now()) {
  const sinir = simdi - TAZELEME_GUN * 24 * 60 * 60 * 1000;
  const kayitHaritasi = new Map(
    (kayitlar || []).map((k) => [String(k.clusterName).trim().toLowerCase(), k]),
  );
  const sonuc = [];
  for (const c of clusters || []) {
    const k = kayitHaritasi.get(String(c).trim().toLowerCase());
    if (!k) {
      sonuc.push(c);
      continue;
    }
    const t = k.fetchedAt ? new Date(k.fetchedAt).getTime() : NaN;
    if (!Number.isFinite(t) || t < sinir) sonuc.push(c);
  }
  return sonuc;
}

/**
 * Bitmis bir `capabilities`/kesif sonucundan onbellege yazar. `/status` ucu ve
 * arka plan izleyicisi AYNI fonksiyonu kullanir — iki kopya, birinde yapilan
 * duzeltmenin digerinde sessizce eskimesi demekti.
 *
 * OZET SATIRI (`scanned`) GELMEMIS cluster YAZILMAZ: o cluster'in taramasi
 * tamamlanmamistir ve bos listeyi "CRD yok" diye yazmak gercek tipleri siler.
 */
async function kaydetYetenekler(parsed, { save, scannedBy, awxJobId }) {
  let yazilan = 0;
  for (const c of (parsed && parsed.capabilities) || []) {
    if (!c.cluster || !c.scanned) continue;
    await save({
      env: parsed.environment,
      tenant: parsed.platform,
      clusterName: c.cluster,
      kinds: c.kinds,
      rbac: c.rbac,
      resourcesReadable: c.resourcesReadable,
      scannedBy,
      awxJobId,
    });
    yazilan += 1;
  }
  return yazilan;
}

/**
 * Bir AWX isini SUNUCU TARAFINDA bitene kadar izler ve sonucunu yazar.
 * Kimsenin yoklamadigi bir iste de sonuc kaybolmaz.
 *
 * deps: { getStatus(serverId, jobId), parse(artifacts), save(rec), sleep(ms), now() }
 */
async function izleVeKaydet({ serverId, jobId, scannedBy, deps }) {
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms).unref?.()));
  const bitis = now() + AZAMI_IZLEME_MS;
  for (;;) {
    let status;
    try {
      status = await deps.getStatus(serverId, jobId);
    } catch (e) {
      // Gecici AWX hatasi izlemeyi OLDURMEZ; sure dolana kadar yeniden sorulur.
      status = null;
      console.warn('[ScaleX] arka plan taramasi durumu okunamadi:', e.message);
    }
    if (status && status.finished) {
      const parsed = deps.parse(status.artifacts);
      return {
        finished: true,
        failed: !!status.failed,
        yazilan: await kaydetYetenekler(parsed, { save: deps.save, scannedBy, awxJobId: jobId }),
      };
    }
    if (now() >= bitis) return { finished: false, failed: false, yazilan: 0 };
    await sleep(YOKLAMA_MS);
  }
}

/**
 * Kesif istegiyle birlikte cagrilir; GERI DONUSU BEKLENMEZ.
 *
 * deps: { list({env,tenant,clusterNames}), launch(clusters) → {serverId, jobId},
 *         getStatus, parse, save, sleep?, now? }
 * Donen promise hic reddedilmez.
 */
async function arkaPlandaTazele({ env, tenant, clusters, scannedBy, deps }) {
  const now = deps.now || Date.now;
  let adaylar;
  try {
    const kayitlar = await deps.list({ env, tenant, clusterNames: clusters });
    adaylar = tazelenecekler(kayitlar, clusters, now());
  } catch (e) {
    console.warn('[ScaleX] yetenek onbellegi okunamadi, arka plan taramasi atlandi:', e.message);
    return { launched: false, clusters: [] };
  }
  const t = now();
  adaylar = adaylar.filter((c) => {
    const k = anahtar(env, tenant, c);
    if (_ucan.has(k)) return false;
    const son = _sonDeneme.get(k);
    return !(son && t - son < SOGUMA_MS);
  });
  if (!adaylar.length) return { launched: false, clusters: [] };

  const anahtarlar = adaylar.map((c) => anahtar(env, tenant, c));
  for (const k of anahtarlar) {
    _ucan.add(k);
    _sonDeneme.set(k, t);
  }
  try {
    const job = await deps.launch(adaylar);
    const sonuc = await izleVeKaydet({
      serverId: job.serverId,
      jobId: job.jobId,
      scannedBy,
      deps,
    });
    return { launched: true, clusters: adaylar, jobId: job.jobId, ...sonuc };
  } catch (e) {
    console.warn('[ScaleX] arka plan yetenek taramasi basarisiz:', e.message);
    return { launched: false, clusters: adaylar, error: e.message };
  } finally {
    for (const k of anahtarlar) _ucan.delete(k);
  }
}

/** Yalnizca testler icin: modul durumunu sifirlar. */
function _sifirla() {
  _ucan.clear();
  _sonDeneme.clear();
}

module.exports = {
  tazelenecekler,
  kaydetYetenekler,
  izleVeKaydet,
  arkaPlandaTazele,
  TAZELEME_GUN,
  SOGUMA_MS,
  YOKLAMA_MS,
  AZAMI_IZLEME_MS,
  _sifirla,
};
