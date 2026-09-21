// server/util/bounded-read.cjs — GÖVDEYİ SINIRLI OKU.
//
// NEDEN VAR
// ─────────
// Portal 2026-09'da **yedi kez** OOM ile çöktü (`FATAL ERROR: Reached heap
// limit`, heap tavanı 2 GB). Yedisinin de kökü aynı sınıftı: bir HTTP gövdesinin
// **sınırsız** tamponlanması —
//
//     let data = ''; res.on('data', (c) => { data += c; });   // ← sınır yok
//     const text = await res.body.text();                     // ← sınır yok
//
// Kapatılan yollar (PR #106/#108/#109/#112) tek tek düzeltildi ve **her seferinde
// aynı iki hata tekrarlandı**:
//
//   1. `req.destroy()` **`end` olayını öldürür.** Yalnızca `end`'de çözmek
//      promise'i SONSUZA DEK asılı bırakır — PR #106'da tam bu tuzağa düşüldü.
//   2. `.text()` çağırıp **sonra** uzunluğa bakmak işe yaramaz: o noktada veri
//      **zaten bellektedir**.
//
// Bu dosya o dersleri TEK BİR DOĞRU UYGULAMADA topluyor. Yeni bir okuma yolu
// yazarken buradan geçilir; altı ayrı yerde altı ayrı "sınır" yazmak, altı ayrı
// biçimde yanlış yazmak demekti (nitekim öyle oldu).
//
// ── ZAMAN AŞIMI TUZAĞI ──────────────────────────────────────────────────────
// Node'un `timeout` seçeneği **hareketsizlik (socket idle)** zaman aşımıdır.
// Sürekli akan bir yanıt o sayacı her chunk'ta sıfırlar → timeout **asla**
// tetiklenmez ve tampon sınırsız büyür. Yani "timeout var" demek "sınır var"
// DEMEK DEĞİLDİR. Bayt kapısı bundan bağımsız olarak şarttır.
'use strict';

/**
 * Tavanı aşan gövde için fırlatılan hata.
 * `tooLarge` işareti, çağıranın bunu "okunamadı"dan AYIRT etmesini sağlar —
 * ve bu red KALICIDIR: yanıt bir sonraki denemede küçülmez.
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
 * Node `http`/`https` yanıt akışını SINIRLI okur.
 *
 * Tavan aşılırsa akış **hemen kesilir** ve promise **hemen** reddedilir —
 * `end` beklenmez, çünkü `destroy()` sonrası `end` GELMEZ.
 *
 * @param {import('stream').Readable} response
 * @param {{ maxBytes: number, label: string, onAbort?: () => void }} opts
 *   `onAbort`: isteğin kendisini de kapatmak için (örn. `req.destroy()`).
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
 * `undici` / `fetch` gövdesini SINIRLI okur.
 *
 * `.text()` ÇAĞIRMAZ: o çağrı gövdenin tamamını belleğe alır ve uzunluğa
 * sonradan bakmak hiçbir şeyi kurtarmaz.
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
 * Metni önce SINIRLA, sonra `JSON.parse` et.
 *
 * SIRA ÖNEMLİ: `JSON.parse` metnin **3-6 katı** büyüklükte bir nesne grafiği
 * üretir. Parse'tan SONRA kırpmak (repoda bir örneği vardı) belleği hiç
 * kurtarmaz — zarar o noktada zaten oluşmuştur.
 */
function parseJsonLimited(text, { maxBytes, label } = {}) {
  const bayt = Buffer.byteLength(text || '', 'utf8');
  if (bayt > maxBytes) throw tooLargeError(label, maxBytes);
  return JSON.parse(text);
}

/**
 * Hata mesajina koymak icin gövdenin YALNIZCA BASINI okur.
 *
 * NEDEN AYRI BIR YARDIMCI: hata yollarinda tekrarlanan desen suydu —
 *
 *     const text = await res.text();                 // ← TAMAMI bellege alinir
 *     throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
 *
 * `slice(0, 200)` HICBIR SEY KURTARMAZ: o noktada gövdenin tamami zaten
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
