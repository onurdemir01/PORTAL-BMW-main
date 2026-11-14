// server/util/bounded-read.cjs — GOVDEYI SINIRLI OKU.
//
// NEDEN VAR
// ─────────
// Portal 2026-09'da **yedi kez** OOM ile coktu (`FATAL ERROR: Reached heap
// limit`, heap tavani 2 GB). Yedisinin de koku ayni sinifti: bir HTTP govdesinin
// **sinirsiz** tamponlanmasi —
//
//     let data = ''; res.on('data', (c) => { data += c; });   // ← sinir yok
//     const text = await res.body.text();                     // ← sinir yok
//
// Kapatilan yollar (PR #106/#108/#109/#112) tek tek duzeltildi ve **her seferinde
// ayni iki hata tekrarlandi**:
//
//   1. `req.destroy()` **`end` olayini oldurur.** Yalnizca `end`'de cozmek
//      promise'i SONSUZA DEK asili birakir — PR #106'da tam bu tuzaga dusuldu.
//   2. `.text()` cagirip **sonra** uzunluga bakmak ise yaramaz: o noktada veri
//      **zaten bellektedir**.
//
// Bu dosya o dersleri TEK BIR DOGRU UYGULAMADA topluyor. Yeni bir okuma yolu
// yazarken buradan gecilir; alti ayri yerde alti ayri "sinir" yazmak, alti ayri
// bicimde yanlis yazmak demekti (nitekim oyle oldu).
//
// ── ZAMAN ASIMI TUZAGI ──────────────────────────────────────────────────────
// Node'un `timeout` secenegi **hareketsizlik (socket idle)** zaman asimidir.
// Surekli akan bir yanit o sayaci her chunk'ta sifirlar → timeout **asla**
// tetiklenmez ve tampon sinirsiz buyur. Yani "timeout var" demek "sinir var"
// DEMEK DEGILDIR. Bayt kapisi bundan bagimsiz olarak sarttir.
'use strict';

/**
 * Tavani asan govde icin firlatilan hata.
 * `tooLarge` isareti, cagiranin bunu "okunamadi"dan AYIRT etmesini saglar —
 * ve bu red KALICIDIR: yanit bir sonraki denemede kuculmez.
 */
function tooLargeError(label, maxBytes) {
  return Object.assign(
    new Error(
      `${label}: yanıt çok büyük (> ${Math.round(maxBytes / 1024)} KB) — okuma kesildi.`,
    ),
    { status: 502, tooLarge: true, permanent: true },
  );
}

/**
 * Node `http`/`https` yanit akisini SINIRLI okur.
 *
 * Tavan asilirsa akis **hemen kesilir** ve promise **hemen** reddedilir —
 * `end` beklenmez, cunku `destroy()` sonrasi `end` GELMEZ.
 *
 * @param {import('stream').Readable} response
 * @param {{ maxBytes: number, label: string, onAbort?: () => void }} opts
 *   `onAbort`: istegin kendisini de kapatmak icin (orn. `req.destroy()`).
 * @returns {Promise<string>}
 */
function readResponseLimited(response, { maxBytes, label, onAbort } = {}) {
  return new Promise((resolve, reject) => {
    let bayt = 0;
    let bitti = false;
    const parcalar = [];

    const kes = (err) => {
      if (bitti) return;
      bitti = true;
      try {
        if (typeof onAbort === 'function') onAbort();
        else if (typeof response.destroy === 'function') response.destroy();
      } catch {
        /* kapatma hatasi yutulur — asil hata asagida bildiriliyor */
      }
      reject(err);
    };

    response.on('data', (c) => {
      if (bitti) return;
      bayt += c.length;
      if (bayt > maxBytes) {
        kes(tooLargeError(label, maxBytes));
        return;
      }
      parcalar.push(c);
    });
    response.on('end', () => {
      if (bitti) return;
      bitti = true;
      resolve(Buffer.concat(parcalar).toString('utf8'));
    });
    // `destroy()` sonrasi gelen ECONNRESET, BIZIM kestigimiz baglantidir;
    // zaten reddedilmis promise'i ikinci kez reddetmeye calismaz.
    response.on('error', (err) => {
      if (bitti) return;
      bitti = true;
      reject(err);
    });
  });
}

/**
 * `undici` / `fetch` govdesini SINIRLI okur.
 *
 * `.text()` CAGIRMAZ: o cagri govdenin tamamini bellege alir ve uzunluga
 * sonradan bakmak hicbir seyi kurtarmaz.
 *
 * @param {AsyncIterable<Buffer>} body
 * @param {{ maxBytes: number, label: string }} opts
 * @returns {Promise<string>}
 */
async function readBodyLimited(body, { maxBytes, label } = {}) {
  let bayt = 0;
  const parcalar = [];
  for await (const parca of body) {
    bayt += parca.length;
    if (bayt > maxBytes) {
      if (typeof body.destroy === 'function') body.destroy();
      throw tooLargeError(label, maxBytes);
    }
    parcalar.push(parca);
  }
  return Buffer.concat(parcalar).toString('utf8');
}

/**
 * Metni once SINIRLA, sonra `JSON.parse` et.
 *
 * SIRA ONEMLI: `JSON.parse` metnin **3-6 kati** buyuklukte bir nesne grafigi
 * uretir. Parse'tan SONRA kirpmak (repoda bir ornegi vardi) bellegi hic
 * kurtarmaz — zarar o noktada zaten olusmustur.
 */
function parseJsonLimited(text, { maxBytes, label } = {}) {
  const bayt = Buffer.byteLength(text || '', 'utf8');
  if (bayt > maxBytes) throw tooLargeError(label, maxBytes);
  return JSON.parse(text);
}

/**
 * Hata mesajina koymak icin govdenin YALNIZCA BASINI okur.
 *
 * NEDEN AYRI BIR YARDIMCI: hata yollarinda tekrarlanan desen suydu —
 *
 *     const text = await res.text();                 // ← TAMAMI bellege alinir
 *     throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
 *
 * `slice(0, 200)` HICBIR SEY KURTARMAZ: o noktada govdenin tamami zaten
 * bellektedir. Bu dosyanin basindaki 2 numarali ders tam olarak budur, ve
 * portalda uc ayri yerde (Teams webhook hata yollari) aynen tekrarlaniyordu.
 * Araya giren bir kurumsal vekil sunucu bu uclara MB'larca HTML hata sayfasi
 * dondurebiliyor.
 *
 * `readBodyLimited`den FARKI: bu fonksiyon HATA FIRLATMAZ. Cagiran taraf zaten
 * bir hatayi bildirmek uzeredir; tavan asildi diye BASKA bir hata firlatmak
 * gercek HTTP durumunu maskelerdi. Tavan asilirsa okuma kesilir ve eldeki
 * bas kismi dondurulur.
 *
 * @param {AsyncIterable<Buffer>|null|undefined} body
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<string>} en fazla `maxBytes` baytlik metin (hic okunamazsa '')
 */
async function readBodyPreview(body, { maxBytes = 4096 } = {}) {
  // NOT: bu erken donus GOZLENEBILIR bir sey degistirmez (mutasyon turu
  // dogruladi) — `for await (… of null)` asagidaki `catch`e duser ve yine ''
  // doner. Yine de DURUYOR, cunku govdesiz yanit (204, HEAD) bir SAVUNMA
  // durumu degil NORMAL bir durumdur; normal yolu istisna mekanizmasina
  // yikmak kodu okunmaz yapardi.
  if (!body) return '';
  const parcalar = [];
  let bayt = 0;
  try {
    for await (const parca of body) {
      parcalar.push(parca);
      bayt += parca.length;
      if (bayt >= maxBytes) break;
    }
  } catch {
    /* okuma yarida kesildi — eldeki kadari yine de teshise yarar */
  }
  // AKIS ACIKCA KAPATILMAZ — ve bu bilerek boyle. `for await ... break`,
  // async yineleyici sozlesmesi geregi `return()` cagirir ve akisi ZATEN
  // kapatir. Ilk yazimda buraya elle bir `destroy()/cancel()` konmustu;
  // mutasyon turu onu kaldirdiginda hicbir bekci atesledi, cunku gozlenebilir
  // bir sey degistirmiyordu. Daha kotusu, okuyana "elle kapatmak gerekiyor"
  // izlenimi veriyordu. SS1 akisin gercekten kesildigini SUNUCUNUN YAZABILDIGI
  // BAYTLA olcuyor.
  return Buffer.concat(parcalar.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))))
    .toString('utf8')
    .slice(0, maxBytes);
}

module.exports = { readResponseLimited, readBodyLimited, readBodyPreview, parseJsonLimited, tooLargeError };
