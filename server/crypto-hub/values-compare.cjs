// server/crypto-hub/values-compare.cjs — cluster values dosyalarını karşılaştırır.
//
// NEDEN VAR (2026-09-27, kullanıcı): Wyden AKTİF-PASİF çalışıyor. Her ortam için ayrı
// OpenShift cluster'larına özgü values dosyaları var (non-prod 2, prod 3). Bu dosyaların
// birbirinden sessizce ayrışması, aktif-pasif devrinde uygulamanın BAŞKA bir
// konfigürasyonla açılması demek.
//
// NEDEN SUNUCUDA: maskeleme burada. Karşılaştırma HAM veri üzerinde yapılmak ZORUNDA
// (aşağıdaki maske notu), o yüzden ekranda yapılamaz.
//
// MASKE TUZAGI - BU MODULUN VAROLUS SEBEBI: maskValues bir sirri '****' ile degistirir.
// Iki cluster'da FARKLI iki parola maskelendikten sonra IKISI DE '****' olur. Karsilastirma
// maskeli veride yapilsa, gercek bir fark "ayni" gorunurdu - sessiz basarisizlik. Bu yuzden
// `ayni` HAM degerlerden hesaplanir; maske yalnizca GOSTERILEN degeri degistirir. Boylece
// "bu iki dosyada parola farkli" bilgisi, parolanin kendisi hic gosterilmeden raporlanir.
//
// NEDEN ANAHTAR BAZLI, SATIR BAZLI DEĞİL: sorulan soru "dosyalar birebir aynı mı" değil,
// "hangi AYAR farklı". Satır bazlı diff, yalnızca sırası değişmiş iki dosyayı baştan aşağı
// farklı gösterir ve gerçek farkı gürültüde kaybeder.
'use strict';

/**
 * YAML satırlarını "a.b.c" -> değer haritasına çevirir.
 * Tam bir YAML ayrıştırıcısı DEĞİL: girinti hiyerarşisini yol olarak kurar. Bu dosyalar
 * helm values'ı; liste elemanları ve çok satırlı bloklar karşılaştırmanın konusu değil.
 */
function anahtarla(lines) {
  const out = new Map();
  const yol = [];
  for (const raw of lines || []) {
    const l = String(raw == null ? '' : raw);
    if (!l.trim() || l.trim().startsWith('#')) continue;
    const m = l.match(/^(\s*)(-\s*)?([A-Za-z0-9_.\-/]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const girinti = m[1].length;
    const ad = m[3];
    const deger = String(m[4] == null ? '' : m[4]).trim();
    while (yol.length && yol[yol.length - 1].girinti >= girinti) yol.pop();
    const tam = [...yol.map((x) => x.ad), ad].join('.');
    if (deger === '') yol.push({ girinti, ad });
    else out.set(tam, deger);
  }
  return out;
}

/** Dosya yolundan cluster adı: ".../1.8.2/cldev1/garanti_values.yaml" -> "cldev1".
 *  Alt dizin yoksa dosya adına düşer (eski düzen: sürüm dizininde tek dosya). */
function clusterAdi(p) {
  const par = String(p || '')
    .split('/')
    .filter(Boolean);
  return par.length >= 2 ? par[par.length - 2] : par[par.length - 1] || String(p || '');
}

/**
 * @param files [{ path, lines (HAM), error }]
 * @param sirRe sır anahtarı deseni (maskeli gösterim için) ya da null (ham gösterim)
 * @returns {{ okunan, okunamayan, satirlar, farkliSayi, anahtarSayi, karsilastirilabilir }}
 */
function karsilastir(files, sirRe) {
  const hepsi = Array.isArray(files) ? files : [];
  // OKUNAMAYAN DOSYA KARSILASTIRMAYA GIRMEZ ve "fark yok" DEMEK DEGILDIR: ayri raporlanir.
  const okunan = hepsi.filter((f) => f && !f.error);
  const okunamayan = hepsi
    .filter((f) => f && f.error)
    .map((f) => ({ path: f.path, cluster: clusterAdi(f.path), error: f.error }));

  const haritalar = okunan.map((f) => anahtarla(f.lines));
  const anahtarlar = [...new Set(haritalar.flatMap((h) => [...h.keys()]))].sort();

  const tumu = anahtarlar.map((a) => {
    const ham = haritalar.map((h) => (h.has(a) ? h.get(a) : null));
    const varOlanlar = ham.filter((v) => v !== null);
    // BIR DOSYADA HIC OLMAYAN anahtar "ayni" SAYILMAZ: eksiklik de bir farktir.
    const ayni = ham.every((v) => v !== null) && new Set(varOlanlar).size === 1;
    const leaf = a.split('.').pop();
    const sirli = !!(sirRe && sirRe.test(leaf));
    return {
      anahtar: a,
      // GOSTERILEN deger maskeli olabilir; `ayni` YUKARIDA HAM degerlerden hesaplandi.
      degerler: ham.map((v) => (v === null ? null : sirli ? '****' : v)),
      ayni,
      sirli,
      eksikVar: ham.some((v) => v === null),
    };
  });

  const farkli = tumu.filter((x) => !x.ayni);
  return {
    okunan: okunan.map((f) => ({ path: f.path, cluster: clusterAdi(f.path) })),
    okunamayan,
    // Ekran yalnizca FARKLI olanlari gosterir; tamami gereksiz yere uzun olurdu.
    satirlar: farkli,
    farkliSayi: farkli.length,
    anahtarSayi: tumu.length,
    // IKIDEN AZ dosya okunduysa karsilastirma YAPILAMAZ - "uyumlu" demek yanlis olurdu.
    karsilastirilabilir: okunan.length >= 2,
  };
}

/**
 * Secilen anahtarlarin degerini HEDEF dosyada gunceller.
 *
 * Kullanici (2026-09-28): karsilastirmada gorulen farki oteki cluster'a da yazabilmek.
 *
 * YALNIZ VAR OLAN ANAHTAR GUNCELLENIR. Olmayan anahtar EKLENMEZ: nereye, hangi girintiyle
 * ve hangi blogun altina ekleneceği bu dosyalarda tek bir dogru cevabi olmayan bir sorudur
 * ve yanlis tahmin, values dosyasini sessizce bozar. Eklenemeyenler `atlanan` olarak
 * DONDURULUR - ekran bunlari "elle eklenmeli" diye gosterir, sessizce yutmaz.
 *
 * MASKELI ICERIGE YAZILMAZ: maskeli bir dosyayi geri yazmak, gercek parolayi '****' ile
 * degistirmek olurdu. Cagiran taraf ham icerik vermek zorunda; kontrol burada.
 *
 * @param lines hedef dosyanin HAM satirlari
 * @param secimler [{ anahtar: 'a.b.c', deger: 'x' }]
 * @returns { lines, degisen, atlanan, maskeli }
 */
function uygula(lines, secimler) {
  const kaynak = Array.isArray(lines) ? lines.map((x) => String(x == null ? '' : x)) : [];
  const istek = Array.isArray(secimler) ? secimler : [];

  // MASKE KAPISI: tek bir maskeli satir bile varsa HICBIR SEY yazilmaz.
  const maskeli = kaynak.some((l) => /:\s*\*{4}\s*$/.test(l));
  if (maskeli) return { lines: kaynak, degisen: [], atlanan: [], maskeli: true };

  const cikti = [...kaynak];
  const degisen = [];
  const atlanan = [];

  for (const sec of istek) {
    const anahtar = String((sec && sec.anahtar) || '').trim();
    const deger = String(sec && sec.deger != null ? sec.deger : '');
    if (!anahtar) continue;

    // Hedef satiri YOL uzerinden bul: ayni adli baska bir anahtar (ornegin iki ayri blokta
    // `enabled`) yanlislikla guncellenmesin.
    const yol = [];
    let bulundu = -1;
    let girinti = '';
    for (let i = 0; i < cikti.length; i += 1) {
      const l = cikti[i];
      if (!l.trim() || l.trim().startsWith('#')) continue;
      const m = l.match(/^(\s*)(-\s*)?([A-Za-z0-9_.\-/]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const gir = m[1].length;
      while (yol.length && yol[yol.length - 1].girinti >= gir) yol.pop();
      const tam = [...yol.map((x) => x.ad), m[3]].join('.');
      if (String(m[4] || '').trim() === '') {
        yol.push({ girinti: gir, ad: m[3] });
      } else if (tam === anahtar) {
        bulundu = i;
        girinti = m[1];
        break;
      }
    }

    if (bulundu < 0) {
      atlanan.push({
        anahtar,
        sebep: 'hedef dosyada bu anahtar yok - nereye ekleneceği belirsiz, elle eklenmeli',
      });
      continue;
    }
    const eski = cikti[bulundu];
    const ad = eski.match(/^\s*(-\s*)?([A-Za-z0-9_.\-/]+)\s*:/);
    cikti[bulundu] =
      `${girinti}${(ad && ad[1]) || ''}${(ad && ad[2]) || anahtar.split('.').pop()}: ${deger}`;
    degisen.push({ anahtar, eski: eski.trim(), yeni: cikti[bulundu].trim() });
  }

  return { lines: cikti, degisen, atlanan, maskeli: false };
}

module.exports = { anahtarla, karsilastir, clusterAdi, uygula };
