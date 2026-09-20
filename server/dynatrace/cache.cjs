// server/dynatrace/cache.cjs — TTL'li bellek-ici onbellek, SINIRLI.
//
// NEDEN SINIRLI (2026-09-20 OOM denetimi): ilk hali sinirsizdi ve anahtari
// KULLANICI BELIRLIYORDU. `server/dynatrace/index.cjs` anahtari
// `events-${envAlias}-${eventType}-${from}-${entitySelector}` olarak kuruyor ve
// `entitySelector` icinde `req.query.host` SERBEST METIN olarak gomulu. TTL ise
// yalnizca OKUMADA kontrol ediliyordu; suresi dolan giris HIC SILINMIYORDU.
//
// Sonuc: kimligi dogrulanmis tek bir kullanici, degisen `?host=` degerleriyle
// donguye girerek heap'i doldurabilirdi — her giris tam Dynatrace/MCP yanitini
// tutuyor. Portal 2026-09'da uc kez OOM ile coktu; bu, ayni sinifin kullanici
// tetikleyebilen bicimiydi.
//
// Desen `server/audit/response-cache.cjs`ten alindi (MAX_ENTRIES + MAX_BODY_BYTES
// + FIFO) — o modul bu isi zaten dogru yapiyor, ikinci bir cozum uretilmedi.
'use strict';

/** En fazla giris. Dolunca EN ESKI atilir (Map ekleme sirasini korur). */
const MAX_ENTRIES = 64;
/** Tek bir girisin tavani. Asan yanit ONBELLEGE ALINMAZ — cagri yine calisir. */
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;

const _store = new Map(); // key → { data, ts, bytes }

function get(key, ttlMs) {
  const e = _store.get(key);
  if (!e) return null;
  if (Date.now() - e.ts < ttlMs) return e.data;
  // SURESI DOLAN GIRIS SILINIR. Eski hali yalnizca `null` donuyordu ve giris
  // sonsuza dek heap'te kaliyordu: "TTL" bellegi degil, yalnizca tazeligi
  // koruyordu.
  _store.delete(key);
  return null;
}

/**
 * Onbellege yazar. Tavani asan yanit SESSIZCE ATLANIR (onbelleklenmez) —
 * cagiran yine kendi verisini dondurur, yalnizca bir sonraki istek yeniden
 * hesaplar. Buyuk yaniti saklamak, tam da kacindigimiz seyi yapardi.
 */
function set(key, data) {
  let bytes = 0;
  try {
    bytes = JSON.stringify(data)?.length || 0;
  } catch {
    // Dairesel/serilestirilemez veri: olcemedigimiz seyi saklamayiz.
    return;
  }
  if (bytes > MAX_ENTRY_BYTES) return;

  // Ayni anahtar yeniden yazilirken once silinir ki FIFO sirasi TAZELENSIN;
  // `Map.set` mevcut anahtarin sirasini degistirmez ve sicak bir giris
  // haksiz yere en eski sayilirdi.
  _store.delete(key);
  while (_store.size >= MAX_ENTRIES) _store.delete(_store.keys().next().value);
  _store.set(key, { data, ts: Date.now(), bytes });
}

function del(key) {
  _store.delete(key);
}

function clear() {
  _store.clear();
}

/** Gorunurluk/test icin: giris sayisi ve toplam bayt. */
function stats() {
  let bytes = 0;
  for (const e of _store.values()) bytes += e.bytes || 0;
  return { entries: _store.size, bytes };
}

module.exports = { get, set, del, clear, stats, MAX_ENTRIES, MAX_ENTRY_BYTES };
