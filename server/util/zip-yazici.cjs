// server/util/zip-yazici.cjs — Kucuk ve SINIRLI ZIP yazici (yeni bagimlilik yok: DEP1).
//
// Server Hub > Uygulama Envanteri disa aktarimi (CSV'ler + uygulama basina tree.txt / inventory.json)
// icin. Node'un kendi zlib'i: deflateRawSync + crc32 (Node 22.2+ / 24 / 26).
//
// BILEREK YOK: ZIP64 (giris <= 65535, toplam < 4 GB), sifreleme, akis (tum arsiv bellekte; sinirlar
// bu yuzden var). Ad kurallari: goreli, '/' ayracli, '..' / bos parca / ters bolu / NUL yok
// (acan taraftaki "zip slip" yol kacisina karsi).
'use strict';

const zlib = require('node:zlib');

const SINIR_GIRIS = 20000;
const SINIR_BAYT = 512 * 1024 * 1024;

function hata(mesaj) {
  return Object.assign(new Error(mesaj), { status: 422, code: 'zip_siniri' });
}

/** DOS tarih/saat (yerel saat yerine UTC; arsiv icinde saat dilimi yok). */
function dosZamani(d) {
  const t = d instanceof Date && Number.isFinite(d.getTime()) ? d : new Date();
  const yil = Math.max(1980, t.getUTCFullYear());
  return {
    saat: (t.getUTCHours() << 11) | (t.getUTCMinutes() << 5) | Math.floor(t.getUTCSeconds() / 2),
    tarih: ((yil - 1980) << 9) | ((t.getUTCMonth() + 1) << 5) | t.getUTCDate(),
  };
}

function adDogrula(ad) {
  const s = String(ad || '');
  if (
    !s ||
    s.length > 512 ||
    s.startsWith('/') ||
    /[\\\0]/.test(s) ||
    s.split('/').some((p) => p === '' || p === '.' || p === '..')
  ) {
    throw hata(`gecersiz arsiv adi: ${s.slice(0, 80)}`);
  }
  return s;
}

/**
 * @param {{ad: string, veri: Buffer|string}[]} girisler
 * @returns {Buffer} tam ZIP arsivi
 */
function zipOlustur(
  girisler,
  { zaman = new Date(), sinirGiris = SINIR_GIRIS, sinirBayt = SINIR_BAYT } = {},
) {
  if (!Array.isArray(girisler)) throw hata('giris listesi yok');
  if (girisler.length > Math.min(sinirGiris, 65535))
    throw hata(`en cok ${Math.min(sinirGiris, 65535)} dosya`);
  const { saat, tarih } = dosZamani(zaman);
  const yerel = [];
  const merkez = [];
  const gorulen = new Set();
  let ofset = 0;
  for (const g of girisler) {
    const ad = adDogrula(g.ad);
    if (gorulen.has(ad)) throw hata(`ayni ad iki kez: ${ad.slice(0, 80)}`);
    gorulen.add(ad);
    const ham = Buffer.isBuffer(g.veri) ? g.veri : Buffer.from(String(g.veri ?? ''), 'utf8');
    const sikis = zlib.deflateRawSync(ham, { level: 6 });
    const yontem = sikis.length < ham.length ? 8 : 0;
    const govde = yontem ? sikis : ham;
    const crc = zlib.crc32(ham) >>> 0;
    const adBuf = Buffer.from(ad, 'utf8');

    const bas = Buffer.alloc(30);
    bas.writeUInt32LE(0x04034b50, 0);
    bas.writeUInt16LE(20, 4); // surum
    bas.writeUInt16LE(0x0800, 6); // bayrak: ad UTF-8
    bas.writeUInt16LE(yontem, 8);
    bas.writeUInt16LE(saat, 10);
    bas.writeUInt16LE(tarih, 12);
    bas.writeUInt32LE(crc, 14);
    bas.writeUInt32LE(govde.length, 18);
    bas.writeUInt32LE(ham.length, 22);
    bas.writeUInt16LE(adBuf.length, 26);
    bas.writeUInt16LE(0, 28);

    const md = Buffer.alloc(46);
    md.writeUInt32LE(0x02014b50, 0);
    md.writeUInt16LE(0x0314, 4); // Unix, surum 20
    md.writeUInt16LE(20, 6);
    md.writeUInt16LE(0x0800, 8);
    md.writeUInt16LE(yontem, 10);
    md.writeUInt16LE(saat, 12);
    md.writeUInt16LE(tarih, 14);
    md.writeUInt32LE(crc, 16);
    md.writeUInt32LE(govde.length, 20);
    md.writeUInt32LE(ham.length, 24);
    md.writeUInt16LE(adBuf.length, 28);
    md.writeUInt16LE(0, 30); // ek alan
    md.writeUInt16LE(0, 32); // aciklama
    md.writeUInt16LE(0, 34); // disk
    md.writeUInt16LE(0, 36); // ic nitelik
    md.writeUInt32LE((0o100644 << 16) >>> 0, 38); // dis nitelik: duz dosya 0644
    md.writeUInt32LE(ofset, 42);

    yerel.push(bas, adBuf, govde);
    merkez.push(md, adBuf);
    ofset += bas.length + adBuf.length + govde.length;
    if (ofset > sinirBayt) throw hata(`arsiv ${Math.round(sinirBayt / 1048576)} MB sinirini asti`);
  }
  const merkezBoyut = merkez.reduce((t, b) => t + b.length, 0);
  const son = Buffer.alloc(22);
  son.writeUInt32LE(0x06054b50, 0);
  son.writeUInt16LE(0, 4);
  son.writeUInt16LE(0, 6);
  son.writeUInt16LE(girisler.length, 8);
  son.writeUInt16LE(girisler.length, 10);
  son.writeUInt32LE(merkezBoyut, 12);
  son.writeUInt32LE(ofset, 16);
  son.writeUInt16LE(0, 20);
  return Buffer.concat([...yerel, ...merkez, son]);
}

module.exports = { zipOlustur, SINIR_GIRIS, SINIR_BAYT };
