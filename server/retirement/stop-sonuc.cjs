// server/retirement/stop-sonuc.cjs — STOP isinin hedef basina sonucu (2026-10-08).
//
// TOPLU STOP (kullanici: "Production'da 2 ya da 4 sunucu ayni anda sectim; hepsi icin ayri ayri
// job tetiklemek istemiyorum. Tek seferde calistiralim ve SCC'ye tek e-posta gitsin"): birden
// fazla hedef TEK AWX isinde kosar. Playbook (app_retirement_stop.yml) her sunucu icin
// `app_retirement_stop_results: {SUNUCU: sonuc}` yayar; eski tek anahtar
// (`app_retirement_stop_result`) yalniz tek hedefte anlamli - coklu iste son kosan sunucunun
// sonucunu tasir ve BASKA hedefe yazilmamali.
//
// COKLU ISTE IS DURUMU HEDEFIN SONUCU DEGILDIR: bir sunucu duserse AWX isi 'failed' biter ama
// digerleri gercekten durdurulmus olabilir. Karar hedefin KENDI RESULT satirindan verilir.
// Tek hedefte eski kural aynen: is 'successful' DEGILSE OK sayilmaz.
'use strict';

const U = (s) => String(s ?? '').trim().toUpperCase();

/** artifacts + hedef sunucu -> { sonuc, coklu }. Sonuc bulunamazsa sonuc=null (uydurulmaz). */
function stopSonucu(artifacts, host, extract, tekAnahtar = 'app_retirement_stop_result', cokAnahtar = 'app_retirement_stop_results') {
  const cok = cokAnahtar ? extract(artifacts, cokAnahtar) : null;
  if (cok && typeof cok === 'object' && !Array.isArray(cok)) {
    const anahtarlar = Object.keys(cok);
    const k = anahtarlar.find((x) => U(x) === U(host));
    if (k) return { sonuc: cok[k], coklu: anahtarlar.length > 1 };
    if (anahtarlar.length > 1) return { sonuc: null, coklu: true };
  }
  const tek = extract(artifacts, tekAnahtar);
  if (tek && (!tek.host || U(tek.host) === U(host))) return { sonuc: tek, coklu: false };
  return { sonuc: null, coklu: false };
}

/** Is durumu + hedef sonucu -> karar. ok: gercek STOP basarili; plan: on kontrol basarili. */
function stopKarari(jobStatus, { sonuc, coklu }) {
  const line = String(sonuc?.line || '');
  const kod = line.split('\t')[2] || '';
  const mesaj = line.split('\t').slice(2).join(' — ') || jobStatus;
  if (coklu) return { line, kod, mesaj, ok: kod === 'OK', plan: kod === 'PLAN', planOnly: sonuc ? !!sonuc.plan_only : null };
  return { line, kod, mesaj, ok: jobStatus === 'successful' && kod === 'OK', plan: jobStatus === 'successful', planOnly: sonuc ? !!sonuc.plan_only : null };
}

module.exports = { stopSonucu, stopKarari };
