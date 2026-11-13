// server/oco/takvim-onbellek.cjs - OCO Takvimi onbellegi (2026-11-13).
//
// NEDEN: kullanici "OCO Takvimi sayfasi 3-4 saniye suruyor" dedi; SlowQuery'de yoktu cunku
// sure SQL degil, kurumsal arama servisine giden sayfali HTTP. Eski onbellek 60 sn'lik tek
// giristi ve ucustaki cekim paylasilmiyordu: sayfa pratikte her acilista soguk taramayi
// bekliyordu.
//
// DESEN (stale-while-revalidate + tek-ucus):
//   - taze (yas <= tazeMs): hemen don (cache: 'hit').
//   - bayat ama yas <= enEskiMs: HEMEN eski degeri don (cache: 'stale', fetchedAt eski degeri
//     gosterir - ekran zaten fetchedAt yaziyor) ve arka planda TEK yenileme baslat.
//   - yok ya da yas > enEskiMs: bekle (cache: 'miss'); ucustaki cekim varsa onu paylas.
//   - refresh: ucustaki cekim varsa onu bekle, yoksa yeni cekimi bekle (zorunlu taze).
//   - HATA: onceki iyi deger KORUNUR (bos liste / hata onbellege yazilmaz). Bekleyen istege
//     hata doner; arka plan yenilemesinin hatasi yalniz console.warn.
//   - "eksik" (iki rolden biri dustu) sonuc onbellege girer ama tazeMs yerine eksikTazeMs
//     (60 sn) taze sayilir: gecici bir dusus 5 dk boyunca gosterilmesin.
//   - isit(): ilk istekten sonra varsayilan grup periyodik tazelenir (unref); son 2 saatte hic
//     istek yoksa tur atlanir (gece kurumsal servise yuk yok).
'use strict';

const VARSAYILAN_TAZE_MS = 5 * 60 * 1000;
const VARSAYILAN_EN_ESKI_MS = 60 * 60 * 1000;
const EKSIK_TAZE_MS = 60 * 1000;
const MAKS_ANAHTAR = 8;
const ISIT_SESSIZ_MS = 2 * 60 * 60 * 1000;

function envMs(ad, varsayilan) {
  const n = Number.parseInt(process.env[ad], 10);
  return Number.isFinite(n) && n > 0 ? n : varsayilan;
}

/**
 * @param {object} o
 * @param {(group:string)=>Promise<object>} o.fetch  grubun tam degerini ceker (index.cjs value)
 * @param {()=>number} [o.now]
 * @param {number} [o.tazeMs]
 * @param {number} [o.enEskiMs]
 * @param {number} [o.eksikTazeMs]
 * @param {{warn:Function}} [o.log]
 */
function createTakvimOnbellek({
  fetch,
  now = Date.now,
  tazeMs = VARSAYILAN_TAZE_MS,
  enEskiMs = VARSAYILAN_EN_ESKI_MS,
  eksikTazeMs = EKSIK_TAZE_MS,
  log = console,
} = {}) {
  if (typeof fetch !== 'function') throw new Error('takvim-onbellek: fetch zorunlu');
  // group -> { value, at, inflight }
  const girisler = new Map();
  let sonIstekAt = null;
  let isitIv = null;

  function giris(group) {
    let g = girisler.get(group);
    if (!g) {
      g = { value: null, at: 0, inflight: null };
      girisler.set(group, g);
      // En fazla MAKS_ANAHTAR grup: en eski eklenen (ucusu olmayan) atilir.
      while (girisler.size > MAKS_ANAHTAR) {
        const ilk = [...girisler.entries()].find(([k, v]) => k !== group && !v.inflight);
        if (!ilk) break;
        girisler.delete(ilk[0]);
      }
    }
    return g;
  }

  /** Tek-ucus cekim; basarida degeri yazar, hatada onceki degeri KORUR. */
  function cek(group, g) {
    if (g.inflight) return g.inflight;
    g.inflight = Promise.resolve()
      .then(() => fetch(group))
      .then((value) => {
        g.value = value;
        g.at = now();
        return value;
      })
      .finally(() => {
        g.inflight = null;
      });
    return g.inflight;
  }

  function tazeSure(v) {
    return v && Array.isArray(v.eksik) && v.eksik.length ? Math.min(eksikTazeMs, tazeMs) : tazeMs;
  }

  /**
   * @returns {Promise<{value:object, cache:'hit'|'stale'|'miss'}>}
   */
  async function get({ group, refresh = false } = {}) {
    const anahtar = String(group || '');
    sonIstekAt = now();
    const g = giris(anahtar);
    if (refresh) return { value: await cek(anahtar, g), cache: 'miss' };
    if (g.value) {
      const yas = now() - g.at;
      if (yas <= tazeSure(g.value)) return { value: g.value, cache: 'hit' };
      if (yas <= enEskiMs) {
        cek(anahtar, g).catch((e) =>
          log.warn(`[OCO] takvim arka plan yenilemesi basarisiz: ${e && e.message}`),
        );
        return { value: g.value, cache: 'stale' };
      }
    }
    return { value: await cek(anahtar, g), cache: 'miss' };
  }

  /**
   * Varsayilan grubu periyodik tazeler. Ilk /calendar isteginden sonra cagrilir; ikinci
   * cagri yeni zamanlayici kurmaz. Son ISIT_SESSIZ_MS icinde istek yoksa tur atlanir.
   */
  function isit({ group, araMs = envMs('OCO_TAKVIM_ISIT_MS', VARSAYILAN_TAZE_MS), isConfigured = () => true } = {}) {
    if (isitIv) return false;
    const anahtar = String(group || '');
    isitIv = setInterval(() => {
      isitTuru({ group: anahtar, isConfigured }).catch(() => {});
    }, araMs);
    if (isitIv.unref) isitIv.unref();
    return true;
  }

  /** Tek isitma turu (testler dogrudan cagirir). true: cekim baslatildi. */
  async function isitTuru({ group, isConfigured = () => true } = {}) {
    if (!isConfigured()) return false;
    if (sonIstekAt == null || now() - sonIstekAt > ISIT_SESSIZ_MS) return false;
    const anahtar = String(group || '');
    const g = giris(anahtar);
    try {
      await cek(anahtar, g);
    } catch (e) {
      log.warn(`[OCO] takvim isitma basarisiz: ${e && e.message}`);
    }
    return true;
  }

  function durdur() {
    if (isitIv) clearInterval(isitIv);
    isitIv = null;
  }

  return { get, isit, isitTuru, durdur, _girisler: girisler };
}

module.exports = { createTakvimOnbellek, VARSAYILAN_TAZE_MS, VARSAYILAN_EN_ESKI_MS, EKSIK_TAZE_MS, MAKS_ANAHTAR };
