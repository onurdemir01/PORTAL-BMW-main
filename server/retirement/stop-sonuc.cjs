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

// ── ON KONTROL LISTESI + IZIN LISTESI (kullanici, 2026-10-22) ─────────────────────────────────────
// "On Kontrol adiminda hangi komutlarin uygulanacagi, hangi uygulamanin, hangi konfigurasyonlarin,
// filesystem'de hangi dizinlerin etkilenecegi acik acik yazdiralim ve bunlarin disinda hicbir seye
// dokunulmadigindan emin olalim."
// Playbook on kontrolde `onkontrol` (ekranda gosterilen liste) ve `izinler` (her DEGISTIREN islemin
// kimligi + `onay:<APP>|JBoss<GEN>|<controller>`) yayar. Portal izinleri on kontrol isinin numarasiyla
// saklar ve onayda hedef basina betige geri gonderir; betik listede olmayan hicbir islemi yapmaz,
// liste gelmezse hic baslamaz. Izin listesi YALNIZ ayni on kontrol isine aitse gecerlidir.

/** Saklanan izin kaydi -> izin dizisi ya da null (yok / bozuk / onay kimligi yok / baska is). */
function onKontrolIzinleri(json, jobId) {
  let o;
  try {
    o = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
  if (!o || !Array.isArray(o.izinler)) return null;
  const iz = o.izinler.map((x) => String(x)).filter(Boolean);
  if (!iz.some((x) => x.startsWith('onay:'))) return null;
  if (jobId != null && Number(o.jobId) !== Number(jobId)) return null;
  return iz;
}

/** Hedef sonucu -> { detailJson, izinJson }. Ayrinti KESILMEZ (kesik JSON okunamaz, ayrinti sessizce
 *  kaybolurdu): sinir asilirsa once adim listesi kisaltilir ve isaretlenir. */
function planKaydi(result, jobId) {
  const dizi = (x) => (Array.isArray(x) ? x.map((y) => String(y)) : null);
  const st = dizi(result?.steps);
  const rn = dizi(result?.renamed);
  const ok = dizi(result?.onkontrol);
  const iz = dizi(result?.izinler);
  let detailJson = null;
  if (st || rn || ok) {
    const d = { steps: st || [], renamed: rn || [], onkontrol: ok || [] };
    detailJson = JSON.stringify(d);
    if (detailJson.length > 60000) detailJson = JSON.stringify({ ...d, steps: d.steps.slice(0, 100), kisaltildi: true });
    if (detailJson.length > 60000) detailJson = JSON.stringify({ steps: [], renamed: d.renamed.slice(0, 100), onkontrol: d.onkontrol.slice(0, 200), kisaltildi: true });
  }
  const izinJson = iz && iz.some((x) => x.startsWith('onay:')) ? JSON.stringify({ jobId: Number(jobId), at: new Date().toISOString(), izinler: iz }) : null;
  return { detailJson, izinJson };
}

module.exports = { stopSonucu, stopKarari, onKontrolIzinleri, planKaydi };
