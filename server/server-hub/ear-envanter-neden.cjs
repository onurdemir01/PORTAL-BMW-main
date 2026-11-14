// server/server-hub/ear-envanter-neden.cjs - Sunucu satirinin "Neden" ve "Playbook" metni (2026-11-05).
//
// Kullanici: "nedeni - olanlar basarili mantiksiz basarili yaz ya da degis" + anket: "hep dolu yaz".
// Veri gelen sunucuda `hata` bos kalir (alim); kismi taramanin nedeni uyarilarda ya da eksik uygulamada
// durur. Bu modul her durum icin DOLU, kisa bir metin uretir; ekran ve CSV ayni metni kullanir.
'use strict';

const UYGULAMA_ETIKET = Object.freeze({
  TAM: 'tam',
  KISMI_SINIR: 'kısmi · sınır',
  KISMI_ZAMAN: 'kısmi · süre',
  KISMI_IZIN: 'kısmi · izin',
  ARSIV_ACILMADI: 'arşiv açılmadı',
  ATLANDI_ZAMAN: 'atlandı · süre',
  HATA: 'hata',
});

const HOST_ACIKLAMA = Object.freeze({
  ZAMAN_ASIMI: 'Tarama süresi doldu; sonuç eksik.',
  PYTHON_YOK: 'Sunucuda python3 / platform-python bulunamadı.',
  KIMLIK_GECISI_YOK: 'dzdo ile okuma kimliğine geçilemedi.',
  ULASILAMADI: 'AWX sunucuya bağlanamadı.',
  YAZILAMADI: "Sonuç /sw'ye yazılamadı.",
  HATA: 'Tarama hata verdi.',
  SONUC_YOK: 'Bu sunucudan sonuç gelmedi.',
  OKUNAMADI: 'Sonuç dosyası okunamadı ya da bozuk.',
});

const PLAYBOOK_ETIKET = Object.freeze({
  SONUC: 'sonuç geldi',
  ULASILAMADI: 'ulaşılamadı',
  PYTHON_YOK: 'python yok',
  ZAMAN_ASIMI: 'zaman aşımı',
  KIMLIK_GECISI_YOK: 'kimlik geçişi yok',
  YAZILAMADI: 'yazılamadı',
  HATA: 'hata',
});

function jsonDizi(v) {
  if (Array.isArray(v)) return v;
  try {
    const x = JSON.parse(String(v || '[]'));
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

const kisa = (s, n = 300) => {
  const t = String(s == null ? '' : s).trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Sunucu satiri -> hic bos kalmayan neden metni. */
function nedenMetni(h) {
  const durum = String((h && h.durum) || '');
  const uyarilar = jsonDizi(h && h.uyarilar)
    .map((x) => kisa(x, 200))
    .filter(Boolean);
  const kokler = jsonDizi(h && h.kokler);
  const uyg = Number((h && h.uygulama_sayisi) || 0);
  const eksik = Number((h && h.eksik_uygulama) || 0);
  if (durum === 'TAM')
    return uyg > 0 ? `başarılı · ${uyg} uygulama tam tarandı` : 'başarılı · kök var, uygulama yok';
  if (durum === 'KOK_YOK') {
    const yok = kokler
      .filter((k) => k && k.durum === 'YOK')
      .map((k) => k.yol)
      .filter(Boolean);
    return yok.length
      ? `${yok.join(' ve ')} yok: bu sunucuda taranacak uygulama yok`
      : 'Taranan kökler yok: bu sunucuda taranacak uygulama yok';
  }
  if (durum === 'KISMI' || durum === 'ZAMAN_ASIMI') {
    const parca = [];
    if (durum === 'ZAMAN_ASIMI') parca.push('süre doldu');
    if (eksik > 0) {
      const ilk = h.ilk_eksik_ad
        ? `: ${kisa(h.ilk_eksik_ad, 80)} (${UYGULAMA_ETIKET[h.ilk_eksik_durum] || String(h.ilk_eksik_durum || '').toLowerCase()})`
        : '';
      parca.push(`${eksik} uygulama eksik tarandı${ilk}${eksik > 1 ? ' …' : ''}`);
    }
    const kokHata = kokler.filter((k) => k && k.durum === 'HATA');
    for (const k of kokHata.slice(0, 2))
      parca.push(`${k.yol} okunamadı${k.hata ? (" (" + k.hata + ")") : ''}`);
    if (uyarilar.length)
      parca.push(
        uyarilar.length > 1 ? `${uyarilar[0]} (+${uyarilar.length - 1} uyarı)` : uyarilar[0],
      );
    if (h.hata) parca.push(kisa(h.hata, 200));
    if (parca.length) return kisa(parca.join(' · ')); if (durum === 'ZAMAN_ASIMI') return HOST_ACIKLAMA.ZAMAN_ASIMI; return 'kısmi tarandı; ayrıntı kaydı yok';
  }
  if (h && h.hata) return kisa(h.hata);
  return HOST_ACIKLAMA[durum] || (durum ? `durum: ${durum}` : 'durum kaydı yok');
}

/** Playbook ham kodu -> okunur metin; bilinmeyen kod oldugu gibi, bos kod icin "kayit yok" metni. */
function playbookEtiketi(kod) {
  const k = String(kod || '').trim();
  if (!k) return 'kayıt yok';
  return PLAYBOOK_ETIKET[k] || k;
}

module.exports = { nedenMetni, playbookEtiketi, UYGULAMA_ETIKET, HOST_ACIKLAMA, PLAYBOOK_ETIKET };
