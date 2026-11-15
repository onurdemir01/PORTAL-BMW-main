// src/components/server_hub/topluSiniflama.ts — Toplu Auto-Start / Toplu Restart başarısızlık kategorileri (2026-11-15).
//
// Kullanıcı (GBBFAA01 "host controller'a baglanilamadi ... Connection refused :9990"): başarısız / düşen öğeler
// nedenine göre kümelensin; her küme için "ne yapılır" tek satır yazsın, tablo kümeye göre süzülebilsin.
//
// SAF FONKSİYON: kategori yalnız öğenin durumundan ve neden / sonuç metninden çıkar. Desenler GERÇEK mesajlardan
// türetildi: server/server-hub/toplu-autostart.cjs, toplu-restart.cjs, autostart-dogrulama.cjs ve Ansible
// server_hub_fix.sh (`result FAIL ...`). Betik metni ASCII Türkçe ("baglanilamadi"), Portal metni gerçek Türkçe
// ("bağlanılamadı"): ikisi aynı biçime indirgenip (küçük harf, Türkçe harfler ASCII) aranır.
//
// SIRA ÖNEMLİ (ilk eşleşen kazanır): host controller / domain kapalı > ortam / yetki > tarama eski > tanım >
// iptal / yarım kaldı > bağlantı / süre / AWX > diğer. "plan eskidi (15 dk)" durumu İPTAL olsa da tarama eskidir.
//
// İnceleme (2026-11-15): "artık aday değil (<iç neden>)" sarmalayıcısında İÇ neden önce sınıflanır (iki kayıt -> tanım,
// domain kapalı -> hc_kapali); iç neden bir kümeye uymazsa sarmalayıcı (tarama eski). "toplu iş durduruldu: ..." satırı
// hiç çalıştırılmadı (başka öğe düştü): içindeki neden ne olursa olsun iptal kümesidir. "Connection refused" / "Could not
// connect" yalnız controller bağlamında (":99xx" ya da "controller") host controller'dır; Portal / DB tarafındaki aynı
// hata ("taze değerlendirme okunamadı (... Connection refused)") bağlantı kümesine düşer.

export type TopluKategori = 'hc_kapali' | 'ortam_yetki' | 'tarama_eski' | 'tanim' | 'iptal' | 'baglanti_sure' | 'diger';

export const KATEGORI_SIRASI: readonly TopluKategori[] = [
  'hc_kapali',
  'ortam_yetki',
  'tarama_eski',
  'tanim',
  'iptal',
  'baglanti_sure',
  'diger',
];

export const KATEGORI: Record<TopluKategori, { etiket: string; ne: string }> = {
  hc_kapali: {
    etiket: 'JBoss domain kapalı',
    ne: 'JBoss bilerek kapatılmış olabilir; domain açılınca sunucuyu yeniden tarayıp yeniden planlayın — taramada domain’i kapalı görünen sunucular aday olmaz.',
  },
  ortam_yetki: {
    etiket: 'Sunucu ortamı / yetki',
    ne: 'Sunucu kurulumu: AWX’teki güncel betikle yeniden deneyin, sürerse dizin sahibini / dzdo kuralını kontrol edin.',
  },
  tarama_eski: {
    etiket: 'Tarama eski / zaten hedefte',
    ne: 'Canlı durum taramadan farklıydı: işlem gerekmeyebilir; sunucuyu yeniden tarayıp listeyi yenileyin.',
  },
  tanim: {
    etiket: 'JVM tanımı',
    ne: 'JVM tanımı bulunamadı ya da belirsiz: sunucu ayrıntısından JVM’i ve host controller tanımını kontrol edin (gerekirse elle).',
  },
  iptal: {
    etiket: 'İptal / durduruldu / yarım kaldı',
    ne: 'İş iptal edildi, başka öğe düştüğü için durduruldu ya da Portal yeniden başladı: yarım kalanı önce AWX’ten kontrol edin, sonra listeyi yenileyip kalanlar için yeni toplu iş açın.',
  },
  baglanti_sure: {
    etiket: 'Bağlantı / süre / AWX',
    ne: 'AWX işine ve sunucu erişimine bakın; geçiciyse listeyi yenileyip yeniden planlayın.',
  },
  diger: {
    etiket: 'Diğer',
    ne: 'Nedeni satırda: “OpsX’ten tek tek” diyorsa işlemi OpsX’ten yapın; AWX işi varsa çıktısına bakın, sonra sunucuyu yeniden tarayın.',
  },
};

const TR: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
/** Küçük harf + Türkçe harfler ASCII + kıvrık kesme işareti düz. */
export function sade(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => TR[c] || c)
    .replace(/[’‘`]/g, "'")
    .toLowerCase();
}

const DESEN: [TopluKategori, RegExp][] = [
  [
    'hc_kapali',
    /failed to connect to the controller|controller is not available|host controller'a baglanilamadi|domain kapali|host controller calismiyor|(connection refused|could not connect)[\s\S]*(:99\d\d|controller)|(:99\d\d|controller)[\s\S]*(connection refused|could not connect)/,
  ],
  [
    'ortam_yetki',
    /yedek dizini acilamadi|yedek alinamadi|gecici dizin acilamadi|permission denied|dzdo|izin vermedi|not allowed|yetki reddi|(dosya|dizin\w*) yazilamadi|yazilamiyor|olarak kosulmuyor|java_home|jboss-cli yok|playbook guncel mi/,
  ],
  [
    'tarama_eski',
    /zaten|artik aday degil|tarama degisti|tarama eski|bayat|plan eskidi|onizleme eskidi|eylem degisti|fark kalmadi|fark degisti|fark artik olculemiyor|yeni taramada yok|artik calismiyor|su an calisiyor|son taramada calisiyor/,
  ],
  [
    'tanim',
    /tanimli degil|bulunamadi|iki kez|taramada yok|taramada jvm'i yok|yalniz envanterde|eslesen uygulama yok|tanim kaynaginda yok|gecersiz|beklenmeyen|belirlenemedi|surumu \(7\/8\) bilinmiyor|ifade \(/,
  ],
  ['iptal', /iptal edildi|yarim kaldi|portal yeniden basladi/],
  [
    'baglanti_sure',
    /ulasilamadi|unreachable|timeout|zaman asimi|bitmedi|basarilamadi|awx'ten kontrol|awx'te suruyor|awx'e gitmis|is numarasi (yok|yazilamadi)|baslatilamadi|okunamadi|awx/,
  ],
];
// "AWX çıktısına bakın" restart sonuçlarının çoğunda geçer: tek başına bağlantı sorunu değildir.
const AWX_CIKTI = /awx ciktisina bakin/g;

/**
 * Başarısız öğenin kategorisi. durum: öğe durumu (IPTAL / YARIM_KALDI metin eşleşmezse 'iptal').
 * Metin hiçbir desene uymazsa 'diger'.
 */
export function siniflandir(neden: string | null | undefined, durum?: string | null): TopluKategori {
  const t = sade(neden).replace(AWX_CIKTI, '');
  // Hiç çalıştırılmayan satır (Toplu Restart "toplu iş durduruldu: <başka öğe> <neden>"): içteki neden o öğenindir.
  if (/^(atlandi: )?toplu is durduruldu/.test(t)) return 'iptal';
  // Server Hub şeması (sys.columns) okunamadı: Portal tarafı; bağlantı / AWX değil.
  if (/semasi \(sys\.columns\) okunamadi/.test(t)) return 'diger';
  // server_hub_fix.sh JN eki (rc != 0): JDK yok / JAVA_HOME geçersiz. jboss-cli hiç başlamadıysa "host controller'a
  // bağlanılamadı" sarmalayıcısı da yazılır ama neden host controller değil, sunucu kurulumudur.
  if (/java_home='[^']*' gecersiz/.test(t) && !/connection refused|could not connect|controller is not available/.test(t))
    return 'ortam_yetki';
  // "artık aday değil (<iç neden>)": iç neden bir kümeye uyuyorsa o.
  const ic = /artik aday degil \((.*)$/.exec(t);
  if (ic) {
    const k = desenle(ic[1].replace(/\)\s*$/, ''), durum);
    if (k) return k;
  }
  return desenle(t, durum) || (durum === 'IPTAL' || durum === 'YARIM_KALDI' ? 'iptal' : 'diger');
}

function desenle(t: string, durum?: string | null): TopluKategori | null {
  for (const [k, re] of DESEN) {
    if (k === 'baglanti_sure' && (durum === 'IPTAL' || durum === 'YARIM_KALDI')) return 'iptal';
    if (re.test(t)) return k;
  }
  return null;
}

/** Toplu Auto-Start: başarısız sayılan öğe durumları (SKIP: zaten hedefteydi, tarama eskiydi). */
export const AUTOSTART_BASARISIZ = new Set(['FAIL', 'DUSTU', 'YARIM_KALDI', 'IPTAL', 'SKIP']);
/** Toplu Restart: başarısız sayılan öğe durumları (KAPANMADI: restart edildi ama fark kapanmadı). */
export const RESTART_BASARISIZ = new Set(['FAIL', 'DUSTU', 'YARIM_KALDI', 'IPTAL', 'ATLANDI', 'KAPANMADI']);

/** Kategori sayımı: yalnız sıfır olmayanlar, KATEGORI_SIRASI'yla. */
export function kategoriSayimi(
  ogeler: { durum: string; neden?: string | null }[],
  basarisiz: Set<string>,
): { kategori: TopluKategori; adet: number }[] {
  const n = new Map<TopluKategori, number>();
  for (const o of ogeler) {
    if (!basarisiz.has(o.durum)) continue;
    const k = siniflandir(o.neden, o.durum);
    n.set(k, (n.get(k) || 0) + 1);
  }
  return KATEGORI_SIRASI.filter((k) => n.has(k)).map((k) => ({ kategori: k, adet: n.get(k) || 0 }));
}

/** Seçili kategoriye göre süzülmüş öğeler (seçim yoksa ya da o kategoride öğe kalmadıysa hepsi). */
export function kategoriyeGore<T extends { durum: string; neden?: string | null }>(
  ogeler: T[],
  basarisiz: Set<string>,
  secili: TopluKategori | null,
): T[] {
  if (!secili) return ogeler;
  const s = ogeler.filter((o) => basarisiz.has(o.durum) && siniflandir(o.neden, o.durum) === secili);
  return s.length ? s : ogeler;
}
