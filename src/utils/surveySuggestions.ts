// src/utils/surveySuggestions.ts — şablon yapılandırma ÖNERİLERİ (saf fonksiyon).
//
// NEDEN VAR: AWX şablonu Self Service'e eklendiğinde `FieldOverridesModal` zaten
// OTOMATİK açılıyor — ama içi tamamen BOŞ geliyor: `ocoCheck`, `smartApproval`,
// `outputFilter`, `customSurveyFields` hepsi kapalı/boş. Tek otomatik davranış
// password alanlarının gizlenmesiydi. Sonuç: bir şablon "eklendi" sayılıyor ama
// hiçbir onay kapısı bağlanmamış oluyor ve bunu kimse fark etmiyor.
//
// TASARIM KARARI — ÖNERİ, DAYATMA DEĞİL. Hiçbir öneri kendiliğinden UYGULANMAZ:
// `smartApproval`ı sessizce açmak, prod'da `apply` yolunu fail-closed kapatır
// (SMART yapılandırılmadan iş başlamaz) — yani "yardım" niyetiyle çalışan bir akışı
// durdurmuş oluruz. Yönetici her öneriyi ayrı ayrı kabul eder ya da reddeder.
//
// YÖN GÜVENLİ: üretilen öneriler yalnızca kapı AÇAR ya da sır GİZLER. Hiçbir öneri
// bir kapıyı kapatmayı ya da bir alanı görünür yapmayı önermez — yanlışlıkla
// uygulanan bir öneri en kötü ihtimalle gereksiz bir onay adımı ekler.
//
// HER ÖNERİ KANIT TAŞIR (`why`): "şuna benziyor" demek yetmez; yönetici kararı
// gerekçeye bakarak verir.

/** Uygulanınca yapılandırmada NE değişeceği — veri olarak; fonksiyon değil, çünkü
 *  öneriler test edilebilir ve serileştirilebilir olmalı. */
export type SuggestionPatch =
  | { kind: 'ocoCheck' }
  | { kind: 'smartApproval' }
  | { kind: 'injectUserInfo' }
  | { kind: 'hideField'; fieldName: string };

export interface SurveySuggestion {
  /** Reddedilince kaydedilen kimlik. Alan bazlı öneriler alan adını içerir. */
  id: string;
  title: string;
  /** NEDEN önerildiği — kanıt. Boş bırakılamaz. */
  why: string;
  patch: SuggestionPatch;
}

export interface SuggestionInput {
  templateName?: string | null;
  /** AWX survey alanları ve tasarımcı alanları BİRLİKTE değerlendirilir: şablonun
   *  hangisini kullandığı önerinin geçerliliğini değiştirmez. */
  fieldNames?: string[];
  /** Gizli OLMAYAN password alanları. */
  visiblePasswordFields?: string[];
  ocoEnabled?: boolean;
  smartEnabled?: boolean;
  injectUserInfoEnabled?: boolean;
  /** Yöneticinin daha önce REDDETTİĞİ öneri kimlikleri. */
  dismissed?: string[];
}

// DEĞİŞİKLİK İMA EDEN FİİLLER. Türkçe ve İngilizce birlikte: şablon adları karışık.
const CHANGE_HINTS = [
  'restart',
  'reboot',
  'start',
  'stop',
  'deploy',
  'delete',
  'remove',
  'scale',
  'update',
  'upgrade',
  'migrate',
  'rollback',
  'create',
  'patch',
  'install',
  'yeniden',
  'baslat',
  'başlat',
  'durdur',
  'sil',
  'olustur',
  'oluştur',
  'guncelle',
  'güncelle',
  'kur',
  'tasi',
  'taşı',
];

// Prod tespiti SUNUCUDA yalnızca bu iki anahtara bakar (`server/oco/prod-detect.cjs`
// `ENV_KEYS`) ve bu BİLEREK yapılandırılamaz. Öneri de aynı anahtarlara bakmalı:
// başka bir ada sahip bir ortam alanı OCO kapısını zaten ateşlemez, önermek yanıltıcı olur.
const ENV_KEYS = ['env', 'ortam'];

// Sunucunun oturumdan enjekte edebildiği kimlik alanları.
const IDENTITY_KEYS = ['email', 'eposta', 'username', 'kullanici', 'kullanıcı'];

const lower = (s?: string | null) => String(s ?? '').toLowerCase();

export function looksLikeChange(templateName?: string | null): boolean {
  const n = lower(templateName);
  if (!n) return false;
  // Salt-okunur şablonlar (status/durum/list/rapor) bu listeyle zaten EŞLEŞMEZ;
  // ayrı bir "salt-okunur" listesi tutmak aynı kararı iki kez yazmak olurdu.
  return CHANGE_HINTS.some((h) => n.includes(h));
}

export function buildSuggestions(input: SuggestionInput): SurveySuggestion[] {
  const dismissed = new Set(input.dismissed || []);
  const names = (input.fieldNames || []).map((n) => lower(n).trim());
  const isChange = looksLikeChange(input.templateName);
  const out: SurveySuggestion[] = [];

  const push = (s: SurveySuggestion) => {
    if (!dismissed.has(s.id)) out.push(s);
  };

  // 1) SMART onayı — değişiklik ima eden bir şablonda kapı yoksa.
  if (isChange && !input.smartEnabled) {
    push({
      id: 'smartApproval',
      title: 'Smart onayı önerilir',
      why:
        `Şablon adı bir DEĞİŞİKLİK işlemi ima ediyor ("${String(input.templateName)}") ` +
        'ama Smart onayı kapalı. Kapalıyken bu iş hiçbir onaydan geçmeden çalışır.',
      patch: { kind: 'smartApproval' },
    });
  }

  // 2) OCO kontrolü — YALNIZCA değişiklik işlemlerinde ve `env`/`ortam` alanı varsa.
  //    Salt-okunur bir sorguya kesinti penceresi sormak anlamsız olurdu.
  const envField = names.find((n) => ENV_KEYS.includes(n));
  if (isChange && envField && !input.ocoEnabled) {
    push({
      id: 'ocoCheck',
      title: 'OCO kesinti penceresi kontrolü önerilir',
      why:
        `Şablonda "${envField}" alanı var ve sunucudaki prod tespiti tam olarak bu ` +
        "anahtara bakıyor — yani bu şablon production'a gidebilir. OCO kapalıyken " +
        'prod değişikliği kesinti penceresi sorulmadan çalışır.',
      patch: { kind: 'ocoCheck' },
    });
  }

  // 3) Kullanıcıdan ELLE istenen kimlik alanı — sunucu bunu zaten enjekte edebilir.
  const identityField = names.find((n) => IDENTITY_KEYS.includes(n));
  if (identityField && !input.injectUserInfoEnabled) {
    push({
      id: 'injectUserInfo',
      title: 'Kullanıcı bilgisini sunucu enjekte etsin',
      why:
        `Şablon "${identityField}" alanını KULLANICIDAN istiyor. Bu alan hem gereksiz ` +
        'bir soru hem de bir sahtecilik yolu: kullanıcı başkasının adını yazabilir. ' +
        "Sunucu bu değeri launch'ın en son adımında OTURUMDAN yazar ve üzerine " +
        'yazılamaz.',
      patch: { kind: 'injectUserInfo' },
    });
  }

  // 4) Görünür password alanı — sır ekranda ve denetim kaydında görünür.
  for (const f of input.visiblePasswordFields || []) {
    push({
      id: `hideField:${f}`,
      title: `"${f}" alanı gizlensin`,
      why:
        'Alan `password` tipinde ama gizli değil. Gizlenmediğinde değer ekranda ' +
        'durur ve yöneticinin girdiği sabit değer yerine kullanıcının yazdığı değer gider.',
      patch: { kind: 'hideField', fieldName: f },
    });
  }

  // SON FİLTRE YOK — BİLEREK.
  //
  // İlk sürümde salt-okunur şablonlarda TÜM öneriler eleniyordu ve bu YANLIŞTI:
  // kimlik enjeksiyonu ile sır gizleme birer KAPI DEĞİL. Elle yazılan bir kullanıcı
  // adının sahtecilik riski, işlemin salt-okunur olup olmamasından bağımsızdır;
  // görünür bir parola da öyle. (Testle yakalandı: SG6/SG7.)
  //
  // Kapı önerileri zaten `isChange` şartına bağlı, yani salt-okunur bir şablonda
  // hiç üretilmiyorlar — ayrıca bir filtreye gerek yok.
  return out;
}
