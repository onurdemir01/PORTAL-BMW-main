// server/ansible/degisken-gizle.cjs — AWX sablonunun statik `extra_vars` metni tarayiciya gitmeden
// once sir tasiyan degiskenlerden ARINDIRILIR (2026-11-14).
//
// NEDEN: sablon listesi (`/api/ansible/templates/:id`, Ansible sayfasini goren HER kullanici) ve
// sablon ayrintisi `extra_vars` metnini ham donduruyordu. Uretimde bir sablonun degiskenlerinde
// veritabani baglanti dizgisi (parolasiyla), bir digerinde AWX belirteci vardi; ikisi de tarayiciya
// ve baslatma penceresindeki duzenleyiciye duz metin gidiyordu.
//
// MASKELEME DEGIL, CIKARMA: baslatma penceresi bu metni duzenleyiciye koyar ve "Baslat"ta HEPSINI
// AWX'e geri yollar. "***" ile maskelenen deger de geri gider ve sablondaki gercek degeri EZERDI
// (is bozulur). Cikarilan degiskeni AWX zaten sablondaki degeriyle uygular.
//
// BIRIM = UST SEVIYE DEGISKEN: ic ice bir anahtar sir tasiyorsa ust seviye degiskenin TAMAMI
// cikarilir. Yalniz ic satir cikarilsaydi baslatmada yarim nesne gider, AWX sablondaki nesnenin
// tamamini onunla degistirir (hash_behaviour=replace) ve sir yine kaybolurdu.
'use strict';

// Adi sir olduguna isaret eden degisken. Yanlis pozitif ZARARSIZ: degisken ekranda gorunmez,
// AWX sablondaki degeri kullanmaya devam eder.
const SIR_ANAHTARI =
  /pass(word|wd|phrase)?|parola|sifre|secret|token|api[_-]?key|private[_-]?key|credential|webhook|(^|[_-])pwd([_-]|$)|(^|[_-])key$/i;

// Adi masum ama DEGERI sir tasiyan degisken.
const SIR_DEGERI = [
  /\b(pwd|password|parola|sifre)\s*=\s*[^;\s"']+/i, // baglanti dizgisi: ...;PWD=...
  /(?:^|[\s;|&"'])(?:export\s+)?[A-Za-z0-9_]*(?:password|passwd|pwd|parola|sifre|secret|token|api[_-]?key)[A-Za-z0-9_]*\s*=\s*[^\s"';]+/i, // export PGPASSWORD=..., MY_TOKEN=...
  /:\/\/[^/\s:@]+:[^@\s/]+@/, // kullanici:parola@host
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}\b/i, // Basic <base64>
  /[?&](sig|signature|token|access_token|api[_-]?key|code)=[^&\s"']{8,}/i, // imzali adres
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /--(password|passwd|pwd|token|secret|api-key)[= ]\S+/i, // komut satiri bayragi
];

const degerSirMi = (metin) => SIR_DEGERI.some((d) => d.test(String(metin)));

/** Bir degerin (ic ice nesne / dizi dahil) herhangi bir yerinde sir isareti var mi. */
function icindeSirVar(deger) {
  if (deger === null || deger === undefined) return false;
  if (Array.isArray(deger)) return deger.some(icindeSirVar);
  if (typeof deger === 'object')
    return Object.entries(deger).some(([k, v]) => SIR_ANAHTARI.test(k) || icindeSirVar(v));
  return degerSirMi(deger);
}

/** Nesne bicimindeki degiskenler -> { nesne, gizlenen } (ust seviye birimiyle). Saf islev. */
function nesnedenAyikla(obj) {
  const nesne = {};
  const gizlenen = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (SIR_ANAHTARI.test(k) || icindeSirVar(v)) gizlenen.push(k);
    else nesne[k] = v;
  }
  return { nesne, gizlenen };
}

const UST_ANAHTAR = /^(["']?)([A-Za-z_][\w.-]*)\1[ \t]*:(?:[ \t]|$)/;

/** YAML metni: ust seviye bloklara ayrilir; sir tasiyan blok butunuyle atilir. */
function yamldanAyikla(metin) {
  const satirlar = metin.split('\n');
  const bloklar = []; // { anahtar | null, satirlar[] }
  for (const s of satirlar) {
    const m = UST_ANAHTAR.exec(s);
    if (m) bloklar.push({ anahtar: m[2], satirlar: [s] });
    else if (
      bloklar.length &&
      bloklar[bloklar.length - 1].anahtar &&
      (/^[ \t]/.test(s) || !s.trim())
    )
      bloklar[bloklar.length - 1].satirlar.push(s); // girintili devam / bos satir
    else bloklar.push({ anahtar: null, satirlar: [s] }); // yorum, `---`, taninmayan satir
  }
  const gizlenen = [];
  const kalan = [];
  for (const b of bloklar) {
    const govde = b.satirlar.join('\n');
    // Ic ice anahtar adlari: girintili `ad:` veya akis bicimi `{ ad: ... }` anahtarlari.
    const icAnahtar = b.satirlar
      .slice(1)
      .some((s) =>
        [...s.matchAll(/(?:^|[{\[, \t])["']?([A-Za-z_][\w.-]*)["']?[ \t]*:/g)].some((m) =>
          SIR_ANAHTARI.test(m[1]),
        ),
      );
    if (b.anahtar) {
      if (SIR_ANAHTARI.test(b.anahtar) || icAnahtar || degerSirMi(govde)) gizlenen.push(b.anahtar);
      else kalan.push(govde);
    } else if (
      degerSirMi(govde) ||
      /["']?[\w.-]*(pass|secret|token|parola|sifre)[\w.-]*["']?\s*:/i.test(govde)
    ) {
      // Ust seviye anahtara baglanamayan ama sir isareti tasiyan satir (akis bicimi `{a: 1, ...}`
      // gibi): hangi degiskene ait oldugu bilinemez, satir atilir.
      gizlenen.push('(taninmayan satir)');
    } else kalan.push(govde);
  }
  return { metin: kalan.join('\n'), gizlenen };
}

/**
 * AWX `extra_vars` metni -> tarayiciya gidebilecek metin + cikarilan ust seviye degisken adlari.
 * Hicbir sey cikarilmadiysa metin AYNEN doner (bicim korunur).
 * @param {unknown} ham
 * @returns {{ metin: string, gizlenen: string[] }}
 */
function awxDegiskenleriniAyikla(ham) {
  const metin =
    typeof ham === 'string' ? ham : ham && typeof ham === 'object' ? JSON.stringify(ham) : '';
  if (!metin.trim()) return { metin: '', gizlenen: [] };
  if (metin.trim().startsWith('{')) {
    let obj = null;
    try {
      obj = JSON.parse(metin);
    } catch {
      obj = null; // gecerli JSON degil: YAML akis bicimi olabilir, satir yoluna duser
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const { nesne, gizlenen } = nesnedenAyikla(obj);
      return gizlenen.length
        ? { metin: JSON.stringify(nesne, null, 2), gizlenen }
        : { metin, gizlenen };
    }
  }
  const { metin: kalan, gizlenen } = yamldanAyikla(metin);
  return gizlenen.length ? { metin: kalan, gizlenen } : { metin, gizlenen };
}

/** Sablon listesi satirina yayilan iki alan: `variables` (arindirilmis) + `hiddenVariables` (adlar). */
function sablonDegiskenAlanlari(ham) {
  const { metin, gizlenen } = awxDegiskenleriniAyikla(ham);
  return { variables: metin, hiddenVariables: gizlenen };
}

module.exports = {
  awxDegiskenleriniAyikla,
  sablonDegiskenAlanlari,
  nesnedenAyikla,
  SIR_ANAHTARI,
  SIR_DEGERI,
};
