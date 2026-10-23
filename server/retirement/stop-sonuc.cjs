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

// ONAY KIMLIGI ISE OZEL (2026-10-22, silme ve geri alma da on kontrollu): STOP `onay:<APP>|...`,
// silme `onay:sil:<APP>|...`, geri alma `onay:geri-al:<APP>|...`. Betikler kimligi BIREBIR arar, yani bir
// isin listesi digerini acmaz; Portal da her isin listesini kendi onekiyle dogrular. APP ':' iceremez
// (betik ve playbook [A-Za-z0-9_.-] ile sinirliyor), dolayisiyla onekler karismaz.
const ONAY_ONEKI = Object.freeze({ stop: 'onay:', delete: 'onay:sil:', rollback: 'onay:geri-al:' });
function onayVar(iz, kind) {
  if (kind === 'stop') return iz.some((x) => x.startsWith('onay:') && !x.startsWith(ONAY_ONEKI.delete) && !x.startsWith(ONAY_ONEKI.rollback));
  return iz.some((x) => x.startsWith(ONAY_ONEKI[kind]));
}

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
  if (!onayVar(iz, 'stop')) return null;
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
  const izinJson = iz && onayVar(iz, 'stop') ? JSON.stringify({ jobId: Number(jobId), at: new Date().toISOString(), izinler: iz }) : null;
  return { detailJson, izinJson };
}

// ── SILME VE GERI ALMA ON KONTROLU (kullanici, 2026-10-22: "DELETE ve GERI AL icin de on kontrol listesini
// yap") ──────────────────────────────────────────────────────────────────────────────────────────────────
// STOP'tan farkli olarak hedef durumu DEGISMEZ (hedef 'stopped' kalir); on kontrol kendi kaydinda yasar:
// delete_onkontrol_json / rollback_onkontrol_json =
//   { jobId, at, durum: 'baslatiliyor'|'running'|'ok'|'failed', mesaj, onkontrol[], izinler[], kaynak,
//     kullanici, kullanildi, kisaltildi }
// `at`: baslatma ani, sonuc gelince sonucun ani (tazelik bundan olculur). Bir on kontrol BIR onaya / BIR
// gercek kosuya verilir (`kullanildi`): yeniden denemek yeni on kontrol ister.

/** Kayit -> nesne ya da null (yok / bozuk). */
function onKontrolOku(json) {
  try {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** Baslatilan on kontrolun kaydi (JSON). */
function onKontrolBasladi(jobId, ek = {}) {
  return JSON.stringify({ ...ek, jobId: jobId == null ? null : Number(jobId), at: new Date().toISOString(), durum: jobId == null ? 'baslatiliyor' : 'running' });
}

/** Biten on kontrol isi -> kayit (JSON). Basari: is 'successful' + RESULT PLAN + bu isin onay kimligi.
 *  PLAN dondugu halde onay kimligi yoksa (AWX'teki betik eski) BASARISIZ sayilir ve sebebi yazilir. */
function onKontrolSonucu(kind, jobStatus, result, jobId, onceki = null) {
  const dizi = (x) => (Array.isArray(x) ? x.map((y) => String(y)) : []);
  const line = String(result?.line || '');
  const kod = line.split('\t')[2] || '';
  const iz = dizi(result?.izinler);
  const plan = jobStatus === 'successful' && kod === 'PLAN';
  const ok = plan && onayVar(iz, kind);
  let mesaj = line.split('\t').slice(2).join(' — ') || `iş ${jobStatus || 'sonucu okunamadı'}`;
  if (plan && !ok)
    mesaj = 'Ön kontrolün izin listesi gelmedi — AWX’teki retirement betikleri güncel değil (ön kontrol listesini üretmiyor). Betikler yüklenmeden bu işlem yapılmaz.';
  const o = {
    ...(onceki || {}),
    jobId: Number(jobId),
    at: new Date().toISOString(),
    durum: ok ? 'ok' : 'failed',
    mesaj: mesaj.slice(0, 1000),
    onkontrol: dizi(result?.onkontrol),
    izinler: ok ? iz : [],
  };
  delete o.kullanildi;
  let s = JSON.stringify(o);
  // Liste cok uzunsa EKRAN listesi kisaltilir; izinler (onaylanacak olan) ASLA kesilmez.
  if (s.length > 60000) s = JSON.stringify({ ...o, onkontrol: o.onkontrol.slice(0, 300), kisaltildi: true });
  return s;
}

/** Onaya / gercek kosuya verilebilecek izinler ya da null: on kontrol BASARILI, KULLANILMAMIS ve bu isin
 *  onay kimligini tasiyor; `jobId` verilirse ayni is, `maxYasDk` verilirse sonuc o kadar dakikadan taze. */
function onKontrolGecerli(json, kind, { jobId = null, maxYasDk = null, now = new Date() } = {}) {
  const o = onKontrolOku(json);
  if (!o || o.durum !== 'ok' || o.kullanildi) return null;
  const iz = Array.isArray(o.izinler) ? o.izinler.map((x) => String(x)).filter(Boolean) : [];
  if (!onayVar(iz, kind)) return null;
  if (jobId != null && Number(o.jobId) !== Number(jobId)) return null;
  if (maxYasDk != null) {
    const t = Date.parse(o.at);
    if (!Number.isFinite(t) || now.getTime() - t > maxYasDk * 60000 || t - now.getTime() > 60000) return null;
  }
  return iz;
}

/** Ekran icin gorunum (hedef satiri): liste + durum + onaya hazir mi. Izinler yalniz hazirken doner. */
function onKontrolGorunum(json, kind, secenek = {}) {
  const o = onKontrolOku(json);
  if (!o) return null;
  const iz = onKontrolGecerli(o, kind, secenek);
  return {
    jobId: o.jobId ?? null,
    at: o.at ?? null,
    durum: String(o.durum || ''),
    mesaj: o.mesaj ?? null,
    onkontrol: Array.isArray(o.onkontrol) ? o.onkontrol.map((x) => String(x)) : [],
    kisaltildi: !!o.kisaltildi,
    kaynak: o.kaynak ?? null,
    kullanici: o.kullanici ?? null,
    kullanildi: !!o.kullanildi,
    hazir: !!iz,
    izinler: iz || [],
  };
}

module.exports = {
  stopSonucu,
  stopKarari,
  onKontrolIzinleri,
  planKaydi,
  ONAY_ONEKI,
  onKontrolOku,
  onKontrolBasladi,
  onKontrolSonucu,
  onKontrolGecerli,
  onKontrolGorunum,
};
