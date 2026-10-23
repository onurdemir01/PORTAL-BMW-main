// server/node-guvenlik.cjs — CALISAN NODE SURUMU GUVENLIK TABANINDA MI? (2026-10-23)
//
// Uretimde Node v20.20.2 calistigi ancak elle `node -v` ile ogrenildi; acilis logu surumu hic
// yazmiyordu. Ekim 2026 Node guvenlik yayini (21 Ekim, 10 CVE: Brotli cozucude uzaktan kod
// calistirma CVE-2026-111497, IP gibi gorunen hedefte TLS ad dogrulamasini atlatan
// CVE-2026-106069 / CVE-2026-105483 ...) yalniz 22 / 24 / 26 hatlarina cikti. Node 20 Nisan
// 2026'da destek disi kaldi; tek sayili hatlar (21, 23, 25) zaten destek disi. Istek
// govdesindeki Brotli yolu auth/brotli-govde-reddi.cjs ile kapali; giden isteklerin yanitlari
// ve TLS / DNS duzeltmeleri yalniz Node yukseltmesiyle gelir (docs/DEVREYE-ALMA.md).
//
// Bu modul acilista surumu upstream tabanla karsilastirir; asagidaysa logda tek bir uyari
// satiri yazar. Davranisi degistirmez (portal yine acilir). Dagitim paketi (RHEL) duzeltmeyi
// kendi surum numarasiyla tasiyabilir; uyari o durumda `dnf updateinfo` ile dogrulanir.
// Yeni bir Node guvenlik yayini ciktiginda YAMALI tablosu yukseltilir.
'use strict';

// Hat -> o hattin son guvenlik yayinindaki ilk yamali surum.
const YAMALI = Object.freeze({
  22: [22, 23, 4],
  24: [24, 22, 1],
  26: [26, 12, 1],
});
const EN_YENI_HAT = 26;
const HEDEF = 'Node 22.23.4+, 24.22.1+ ya da 26.12.1+';

function surumParcala(surum) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(surum || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * @returns {{ ok: boolean, surum: string, mesaj: string|null }}
 */
function nodeGuvenlikDurumu(surum = process.version) {
  const p = surumParcala(surum);
  if (!p)
    return {
      ok: false,
      surum: String(surum),
      mesaj: `Node surumu okunamadi (${surum}); ${HEDEF} gerekir.`,
    };
  const [ana, ara, yama] = p;
  // Tablodan yeni bir hat (ornegin 2027'de 27): bilinen bir acigi yok sayilir.
  if (ana > EN_YENI_HAT) return { ok: true, surum: String(surum), mesaj: null };
  const taban = YAMALI[ana];
  if (!taban) {
    return {
      ok: false,
      surum: String(surum),
      mesaj: `Node ${surum} destek disi bir hatta; guvenlik yamasi almiyor (Ekim 2026: CVE-2026-111497 Brotli, TLS ad dogrulamasi). ${HEDEF} gerekir.`,
    };
  }
  const eski = ara < taban[1] || (ara === taban[1] && yama < taban[2]);
  if (!eski) return { ok: true, surum: String(surum), mesaj: null };
  return {
    ok: false,
    surum: String(surum),
    mesaj: `Node ${surum} upstream Ekim 2026 guvenlik yamasindan eski (CVE-2026-111497 Brotli, TLS ad dogrulamasi). En az ${taban.join('.')} gerekir; dagitim paketi duzeltmeyi kendi numarasiyla tasiyorsa dnf updateinfo ile dogrulayin.`,
  };
}

// ── YAMASIZ NODE ICIN TELAFI KORUMALARI (2026-10-23) ─────────────────────────────
//
// Portalin calistigi makine su an Node 22.22.2'de kaliyor (yukseltme simdilik yapilamiyor) ve
// 22.23.0 / 22.23.2 / 22.23.4 guvenlik yayinlarini kaciriyor. Uygulama icinden kapatilabilenler
// burada, YALNIZCA calisan surum tabanin altindaysa kurulur (yamali Node'da hicbir sey degismez):
//
//   giden-brotli  CVE-2026-111497 (Brotli cozucude sinir disi yazma). undici `fetch` https
//                 adreslerinde varsayilan olarak `br` ister ve gelen Brotli yaniti yamasiz
//                 cozucuyle acar (MCP, AI, Smart ... bu yoldan gider). Sarmalayici: istek basligi
//                 verilmemisse `accept-encoding: gzip, deflate` gonderilir (uyumlu sunucu br
//                 gondermez); yine de `content-encoding: br` gelirse govde OKUNMADAN iptal edilir
//                 ve hata firlatilir. Gelen ISTEK govdesindeki br zaten auth/brotli-govde-reddi.cjs.
//   dns-nul       CVE-2026-105482 / CVE-2026-48930 (adinda NUL bayti olan konak). dns.lookup /
//                 dns.resolve* (geri cagirimli ve promise) boyle bir adi cozumlemeye gondermez.
//
// Uygulama icinden KAPATILAMAYANLAR (yalniz Node yukseltmesi): TLS sunucu kimligi / IP
// dogrulamasi (CVE-2026-48618, -106069, -106072), http.Agent baglanti yarisi, zlib sinir
// denetimi. Proxy kimliginin hata mesajinda gorunmesi (CVE-2026-48615) log.cjs'teki URL
// kimlik maskesiyle her surumde loga dusmez.
//
// Kurulum, diger moduller yuklenmeden ONCE yapilir (server/index.cjs): `undici.fetch`i
// sonradan okuyan modul sarilmis halini alir.
const TELAFI_ISARETI = Symbol.for('portal.yamasizNodeTelafi');
const kurulanlar = [];

function brotliKodlu(baslik) {
  return String(baslik || '')
    .toLowerCase()
    .split(',')
    .some((k) => k.trim() === 'br');
}

function brotliRedliFetch(asil, HeadersSinifi) {
  if (typeof asil !== 'function' || asil[TELAFI_ISARETI]) return asil;
  const sarilmis = async function fetchBrotliRedli(input, init) {
    const kaynak =
      (init && init.headers) ||
      (input && typeof input === 'object' && 'headers' in input ? input.headers : undefined);
    const basliklar = new HeadersSinifi(kaynak || undefined);
    if (!basliklar.has('accept-encoding')) basliklar.set('accept-encoding', 'gzip, deflate');
    const yanit = await asil(input, { ...(init || {}), headers: basliklar });
    if (brotliKodlu(yanit.headers.get('content-encoding'))) {
      try {
        await yanit.body?.cancel();
      } catch {
        /* govde zaten kapali */
      }
      throw Object.assign(
        new Error(
          `Brotli ile sikistirilmis yanit reddedildi (${yanit.url || 'bilinmeyen adres'}): ` +
            `calisan Node ${process.version} Brotli cozucusu yamasiz (CVE-2026-111497).`,
        ),
        { code: 'BROTLI_YANIT_REDDI' },
      );
    }
    return yanit;
  };
  sarilmis[TELAFI_ISARETI] = asil;
  return sarilmis;
}

const NUL = '\u0000';
function nulHatasi(ad) {
  return Object.assign(
    new Error(`Konak adinda NUL bayti var; cozumlenmedi (yamasiz Node): ${JSON.stringify(ad)}`),
    {
      code: 'ERR_INVALID_ARG_VALUE',
    },
  );
}
const DNS_GERI_CAGIRIMLI = [
  'lookup',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCname',
  'resolveMx',
  'resolveNs',
  'resolveTxt',
  'resolveSrv',
  'resolvePtr',
  'resolveNaptr',
  'resolveSoa',
  'resolveCaa',
];

function dnsNulKorumasi(dns) {
  const geri = [];
  for (const ad of DNS_GERI_CAGIRIMLI) {
    const asil = dns[ad];
    if (typeof asil !== 'function' || asil[TELAFI_ISARETI]) continue;
    const s = function (host, ...rest) {
      if (typeof host === 'string' && host.includes(NUL)) {
        const cb = rest[rest.length - 1];
        if (typeof cb === 'function') {
          process.nextTick(cb, nulHatasi(host));
          return undefined;
        }
        throw nulHatasi(host);
      }
      return asil.call(this, host, ...rest);
    };
    s[TELAFI_ISARETI] = asil;
    dns[ad] = s;
    geri.push(() => (dns[ad] = asil));
    const p = dns.promises && dns.promises[ad];
    if (typeof p === 'function' && !p[TELAFI_ISARETI]) {
      const sp = function (host, ...rest) {
        if (typeof host === 'string' && host.includes(NUL)) return Promise.reject(nulHatasi(host));
        return p.call(this, host, ...rest);
      };
      sp[TELAFI_ISARETI] = p;
      dns.promises[ad] = sp;
      geri.push(() => (dns.promises[ad] = p));
    }
  }
  return geri;
}

/**
 * Calisan Node tabanin altindaysa telafi korumalarini kurar (bir kez). Kurulanlarin adlarini
 * doner; yamali Node'da bos dizi. `{ zorla: true }` yalniz testler icin.
 */
function telafiKorumalariniKur({ surum = process.version, zorla = false } = {}) {
  if (kurulanlar.length) return kurulanlar.map((k) => k.ad);
  if (!zorla && nodeGuvenlikDurumu(surum).ok) return [];
  const geri = [];
  if (typeof globalThis.fetch === 'function') {
    const asil = globalThis.fetch;
    globalThis.fetch = brotliRedliFetch(asil, globalThis.Headers);
    geri.push(() => (globalThis.fetch = asil));
  }
  try {
    const undici = require('undici');
    const asil = undici.fetch;
    undici.fetch = brotliRedliFetch(asil, undici.Headers);
    geri.push(() => (undici.fetch = asil));
  } catch {
    /* undici yuklenemiyorsa yalniz global fetch sarilir */
  }
  kurulanlar.push({ ad: 'giden-brotli', geri });
  kurulanlar.push({ ad: 'dns-nul', geri: dnsNulKorumasi(require('node:dns')) });
  return kurulanlar.map((k) => k.ad);
}

/** Yalniz testler icin: kurulan korumalari geri alir. */
function telafiKorumalariniKaldir() {
  while (kurulanlar.length) for (const g of kurulanlar.pop().geri.reverse()) g();
}

module.exports = {
  nodeGuvenlikDurumu,
  YAMALI,
  telafiKorumalariniKur,
  telafiKorumalariniKaldir,
  brotliRedliFetch,
};
