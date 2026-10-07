// src/utils/legacySebep.ts — LogX Legacy playbook'larının bildirdiği sebepleri insan
// diline çevirir.
//
// NEDEN: Legacy keşif ve aktarım playbook'ları sunucu ve dosya başına sebep yayınlar
// ("sonuc bildirmedi (AWX envanterinde eslesmedi)", "Dosya bulunamadi", "okunamayan 1 yol:
// ..."). Bu metinler AWX'i okuyan operasyon ekibi için yazıldı; portal kullanıcısı için
// bir cümlelik özet gerekir. Çeviri `src/utils/ocpError.ts` ile aynı karara uyar: tek
// yerde, saf bir fonksiyonda; playbook metni AWX'e ELLE kopyalandığı için orada değil.
//
// HAM METİN KAYBOLMAZ: özet eşleşse de ham sebep ekranda özetin altında durur (yolu, hatayı
// ve hangi kullanıcıyla denendiğini o taşır). Eşleşme yoksa ham metin AYNEN döner —
// uydurma yapılmaz.
//
// Kuralların sınandığı metinler GERÇEK playbook çıktılarıdır:
// src/components/logx_v2/__tests__/fixtures/legacy-sonuc-ornekleri.json

export interface LegacySebep {
  /** Kullanıcıya gösterilecek cümle. */
  ozet: string;
  /** Playbook'un yayınladığı ham metin. */
  ham: string;
  /** Özet bir kuraldan mı geldi? Gelmediyse `ozet === ham`'dır. */
  cevrildi: boolean;
  /**
   * Ham metin özetin söylemediği bir şey taşıyor mu (yol, asıl hata, kullanıcı)? Taşımıyorsa
   * ekranda özetin altında TEKRAR edilmez ("Dosya bulunamadi" gibi sabit ifadeler).
   */
  hamEkBilgi: boolean;
}

// Özetin birebir karşıladığı sabit ifadeler: ham metin başka hiçbir şey söylemez.
const BILGISIZ =
  /^(Dosya bulunamadi|Dosya okunamiyor|Path normal dosya degil|sonuc bildirmedi( \(AWX envanterinde eslesmedi\))?)$/i;

// Sıra ÖNEMLİ: ilk eşleşen kazanır. Bağlantı hataları her şeyden önce gelir — "Dosya was
// ile denetlenemedi: ... Failed to connect to the host via ssh" bir dosya sorunu DEĞİL,
// sunucuya hiç ulaşılamamasıdır.
const KURALLAR: { test: RegExp; ozet: string }[] = [
  {
    test: /AWX envanterinde eslesmedi/i,
    ozet: 'Bu ad AWX envanterinde yok — sunucu adını kontrol edin.',
  },
  {
    test: /Failed to connect to the host|Connection refused|Connection timed out|Operation timed out|No route to host|Could not resolve hostname|Name or service not known|Host is down|UNREACHABLE/i,
    ozet: 'Sunucuya bağlanılamadı.',
  },
  {
    test: /sonuc bildirmedi/i,
    ozet: 'Sunucu sonuç bildirmedi (erişilemedi ya da iş yarıda kesildi).',
  },
  {
    // Kelime sınırı YOK: "... is not in the sudoers file" da bir yetki reddidir.
    test: /dzdo|sudo|privilege escalation|becoming an unprivileged user|Failed to set permissions on the temporary files/i,
    ozet: 'Logları okuyan kullanıcıya geçilemedi (yetki).',
  },
  {
    test: /okunamayan \d+ yol/i,
    ozet: 'Sunucuda okunamayan bir dizin var; tarama tamamlanamadı.',
  },
  {
    test: /hicbir kaynak hosttan parca ZIP gelmedi/i,
    ozet: 'Hiçbir sunucudan arşivlenecek dosya alınamadı.',
  },
  {
    test: /Parca dizini aranamadi/i,
    ozet: 'Arşiv parçaları birleştirilemedi — teslim dizinine erişilemedi.',
  },
  {
    // Sunucu düzeyindeki sarmalayıcı mesajlar (dosya başına sebepler ham metnin içinde).
    test: /Bu hostta arsivlenecek okunabilir dosya yok|Arsivlenecek mevcut ve okunabilir bir dosya bulunamadi/i,
    ozet: 'Bu sunucuda seçilen dosyaların hiçbiri alınamadı.',
  },
  {
    test: /Dosya bulunamadi/i,
    ozet: 'Dosya artık yerinde değil (taramadan sonra silinmiş ya da döndürülmüş olabilir).',
  },
  {
    test: /Dosya okunamiyor|Permission denied/i,
    ozet: 'Dosya okunamıyor (yetki).',
  },
  {
    test: /Path normal dosya degil/i,
    ozet: 'Bu yol normal bir dosya değil.',
  },
];

/** Ham playbook sebebini kullanıcıya gösterilecek özete çevirir. Eşleşme yoksa ham metin döner. */
export function legacySebep(ham: unknown): LegacySebep {
  const metin = String(ham ?? '').trim();
  if (!metin) return { ozet: 'Sebep bildirilmedi.', ham: '', cevrildi: false, hamEkBilgi: false };
  for (const k of KURALLAR) {
    if (k.test.test(metin)) {
      return { ozet: k.ozet, ham: metin, cevrildi: true, hamEkBilgi: !BILGISIZ.test(metin) };
    }
  }
  return { ozet: metin, ham: metin, cevrildi: false, hamEkBilgi: false };
}
