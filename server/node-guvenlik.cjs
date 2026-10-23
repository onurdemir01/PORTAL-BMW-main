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

module.exports = { nodeGuvenlikDurumu, YAMALI };
