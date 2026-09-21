// server/ansible/job-stdout-cache.cjs — AWX stdout'unu ARTIMLI cek.
//
// NEDEN VAR
// ─────────
// `ss/job-status` her yoklamada job'in stdout'unun TAMAMINI yeniden indiriyordu.
// Uretim olcumu (13,5 gun):
//
//   GET /jobs/N/output   98 yavas istek · ortalama 20,8 sn · en fazla 35,8 sn
//   ss/job-status     2.446 yavas istek
//
// Istemci ise (`JobTrackerContext` RUN_MS) stdout akarken 1,5 SANIYEDE BIR
// yokluyor. Yani ortalama 20 saniye suren bir indirme 1,5 saniyede bir yeniden
// baslatiliyor: yoklamalar ust uste biniyor ve is uzadikca her yoklama DAHA
// PAHALI hale geliyor (cikti buyuyor). Toplam trafik ciktinin karesiyle buyuyor.
//
// Bu, `runner.cjs:fetchAwxPlainText` icindeki OOM notunun tarif ettigi
// BIRIKIM'in ta kendisi: orada bayt tavani konuldu ama tekrar tekrar indirme
// DURMADI. Bu modul indirmenin kendisini kesiyor.
//
// ── NASIL GUVENDE KALIYOR ───────────────────────────────────────────────────
// AWX `?start_line=N` destekler. Desteklemezse (surum farki, araya giren proxy,
// yanlis yapilandirma) TUM metni doner ve naif bir kod onu onbellege EKLEYIP
// ciktiyi SESSIZCE IKIYE KATLARDI. Bu yuzden her artimli cekim BIR SATIR
// BINDIRME ile yapilir ve donen ilk satir, onbellekteki son satirla
// KARSILASTIRILIR. Tutmazsa onbellek atilir ve bugunku tam cekime DUSULUR.
// Yani iyilestirme KENDINI DOGRULAR: calismadigi anda zarar vermeden kapanir.
//
// ── SINIRLAR ────────────────────────────────────────────────────────────────
// Bu depoda sinirsiz `Map` bir OOM sinifiydi (yedi cokme). Burada uc tavan var:
// is basina bayt, toplam girdi sayisi ve bosta kalma suresi. Tavan asilirsa
// satir SILINIR (kirpilmaz) — kirpilmis bir onbellek uzerine artim eklemek
// ciktiyi bozardi; yavas ama DOGRU olan yol her zaman tercih edilir.
'use strict';

/** Is basina en fazla tutulan stdout. `AWX_RESPONSE_MAX_BYTES` ile ayni buyukluk. */
const MAX_BYTES_PER_JOB = 8 * 1024 * 1024;

/** En fazla kac is ayni anda onbellekte. Es zamanli izlenen is sayisi kadar. */
const MAX_ENTRIES = 40;

/** Bosta kalma suresi. Bitmiş bir isin satiri burada cürümemeli. */
const TTL_MS = 10 * 60 * 1000;

/** Artimli cekimde kac satir bindirme istenir. Bkz. `birlestir`. */
const BINDIRME = 2;

const _kayitlar = new Map();

function anahtar(serverId, jobId) {
  return `${Number(serverId)}:${Number(jobId)}`;
}

/** Suresi dolmus satirlari atar. Her erisimde cagrilir — ayri bir zamanlayici yok. */
function _temizle(simdi) {
  for (const [k, v] of _kayitlar) {
    if (simdi - v.at > TTL_MS) _kayitlar.delete(k);
  }
}

function al(serverId, jobId) {
  const k = anahtar(serverId, jobId);
  const simdi = Date.now();
  _temizle(simdi);
  const v = _kayitlar.get(k);
  if (!v) return null;
  // FIFO tazeleme: `Map.set` MEVCUT bir anahtarin sirasini DEGISTIRMEZ, bu yuzden
  // once silinir. (Bu depoda bir kez yanlis yazildi: en cok kullanilan satir
  // tahliye ediliyordu.)
  _kayitlar.delete(k);
  v.at = simdi;
  _kayitlar.set(k, v);
  return v;
}

function yaz(serverId, jobId, text, lines) {
  const k = anahtar(serverId, jobId);
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES_PER_JOB) {
    // KIRPMA YOK: kirpilmis bir metnin uzerine artim eklemek ciktiyi bozardi.
    _kayitlar.delete(k);
    return false;
  }
  _kayitlar.delete(k);
  _kayitlar.set(k, { text, lines, at: Date.now() });
  while (_kayitlar.size > MAX_ENTRIES) {
    _kayitlar.delete(_kayitlar.keys().next().value); // en eski
  }
  return true;
}

function sil(serverId, jobId) {
  _kayitlar.delete(anahtar(serverId, jobId));
}

/** Test/teshis. */
function _durum() {
  return { boyut: _kayitlar.size, anahtarlar: [..._kayitlar.keys()] };
}
function _sifirla() {
  _kayitlar.clear();
}

/** Artimli cekimde istenecek baslangic satiri. Bkz. `birlestir` — IKI satir bindirme. */
function baslangicSatiri(lines) {
  return Math.max(0, lines - BINDIRME);
}

/**
 * Artimli cekimi BIRLESTIRIR — ag katmanindan bagimsiz, saf fonksiyon.
 *
 * ── NEDEN IKI SATIR BINDIRME ────────────────────────────────────────────────
 * Onbellekteki SON satir YARIM olabilir: is hala kosuyor ve AWX o satiri henuz
 * bitirmemis olabilir. Tek satirlik bindirmede karsilastirma o yarim satira
 * dusecegi icin tutmaz ve iyilestirme HER YOKLAMADA tam cekime duserdi —
 * sessizce ise yaramaz hale gelirdi.
 *
 * Iki satir bindirmede karsilastirma SONDAN BIR ONCEKI satira duser; ardindan
 * baska bir satir geldigi icin o satir KESIN TAMAMLANMISTIR. Son satir ise her
 * zaman ATILIP yenisiyle degistirilir.
 *
 * Dogrulamanin kendisi yine KATIDIR: tutmazsa `ok:false`. AWX `start_line`i yok
 * sayip tum metni donerse bu kontrol ateslenmeseydi cikti IKIYE KATLANIRDI.
 *
 * @param {string} onbellekMetni  onbellekteki tam metin
 * @param {string} gelen          `baslangicSatiri(lines)` ile donen parca
 * @returns {{ok: true, text: string, lines: number} | {ok: false, sebep: string}}
 *   `ok:false` → cagiran taraf onbellegi ATAR ve tam cekime duser.
 */
function birlestir(onbellekMetni, gelen) {
  const eski = onbellekMetni.split('\n');
  const bas = baslangicSatiri(eski.length);
  const capa = eski[bas];
  const yeni = String(gelen == null ? '' : gelen).split('\n');

  if (yeni[0] !== capa) return { ok: false, sebep: 'bindirme tutmadi' };

  const text = eski.slice(0, bas).concat(yeni).join('\n');
  return { ok: true, text, lines: bas + yeni.length };
}

module.exports = {
  al, yaz, sil, birlestir, baslangicSatiri,
  BINDIRME,
  MAX_BYTES_PER_JOB, MAX_ENTRIES, TTL_MS,
  _durum, _sifirla,
};
