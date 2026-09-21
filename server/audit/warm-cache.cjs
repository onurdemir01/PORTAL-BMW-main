// server/audit/warm-cache.cjs - "sicak" onbellek: agir denetim hesaplari (2026-09-21).
//
// NE OLDU: /nginx-audit ve /nginx-migration 30 sn'de zaman asimina dusuyordu (14 gunluk denetim
// tablolari, indeks yok). Indeks eklendi (db/external-indexes.cjs) ama tablo buyuklugu ve DB
// yuku Portal'in elinde degil; kullanici sayfayi acinca beklememeli.
//
// DESEN: deger bir kez hesaplanip bellekte tutulur; istek geldiginde VARSA aninda (bayat olsa
// bile) doner ve suresi dolduysa ARKA PLANDA yeniler; hic hesaplanmadiysa ilk istek bekler
// (tek hesap - ayni anda gelen istekler ayni sozu paylasir). ?fresh=1 hesabi bekleyerek yeniler.
// Boot'tan sonra isitici hesaplari onceden yapar; sonuc `_cache: { computedAt, stale, ms }` tasir.
'use strict';

function createWarmCache({ name, ttlMs = 10 * 60 * 1000, compute, log = console }) {
  let value = null; // { at, ms, payload }
  let inflight = null;

  async function run() {
    if (inflight) return inflight;
    const t0 = Date.now();
    inflight = Promise.resolve()
      .then(compute)
      .then((payload) => {
        value = { at: Date.now(), ms: Date.now() - t0, payload };
        if (value.ms > 5000) log.warn(`[warm:${name}] hesap ${value.ms} ms surdu`);
        return value;
      })
      .finally(() => { inflight = null; });
    return inflight;
  }

  function decorate(v) {
    return { ...v.payload, _cache: { computedAt: new Date(v.at).toISOString(), ms: v.ms, stale: Date.now() - v.at > ttlMs } };
  }

  /** @param {{fresh?: boolean}} o  fresh: hesabi BEKLE (kullanici "Yenile"ye basti) */
  async function get({ fresh = false } = {}) {
    if (fresh || !value) return decorate(await run());
    if (Date.now() - value.at > ttlMs) run().catch((e) => log.warn(`[warm:${name}] arka plan yenileme hatasi:`, e.message));
    return decorate(value);
  }

  function warm(delayMs = 45000) {
    setTimeout(() => {
      run().catch((e) => log.warn(`[warm:${name}] isitma hatasi:`, e.message));
      setInterval(() => run().catch((e) => log.warn(`[warm:${name}] periyodik yenileme hatasi:`, e.message)), ttlMs).unref?.();
    }, delayMs).unref?.();
  }

  return { get, warm, run, peek: () => value };
}

module.exports = { createWarmCache };
