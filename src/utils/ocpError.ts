// src/utils/ocpError.ts — `oc` hatalarını insan diline çevirir.
//
// ÇEVİRİ NEDEN BURADA: `src/utils/scalexLog.ts` ile aynı karar. AWX job log'unu
// operasyon ekibi okuyor, orada İngilizce ve teknik kalması DOĞRU. Ayrıca playbook
// AWX'e ELLE kopyalanıyor — her metin değişikliği için yeniden deploy istemek
// anlamsız. Çeviri tek yerde, saf bir fonksiyonda, test edilebilir.
//
// NEDEN GEREKLİ (üretim, AWX #3296360/#3296365/#3296411): kullanıcı üç ayrı işte
// şu duvarı gördü:
//
//   Error in configuration: Missing or incomplete configuration info.
//   Please login or point to an existing, complete config file: ...
//
// Bu mesaj GERÇEK HATANIN İKİ ADIM SONRASININ belirtisiydi. Asıl sebep, kimlik
// dosyası bulunamadığı için parolanın boş kalması ve `oc login`in sessizce
// patlamasıydı. Ekran, kullanıcıyı `~/.kube/config` aramaya yönlendiriyordu —
// yapacak hiçbir şeyin olmadığı bir yere.

export interface OcpErrorText {
  /** Kullanıcıya gösterilecek Türkçe cümle. */
  text: string;
  /** Ham metin — "teknik ayrıntı" olarak her zaman açılabilir kalır. */
  raw: string;
  /** Çeviri eşleşti mi? Eşleşmediyse `text === raw`'dır. */
  translated: boolean;
}

// Sıra ÖNEMLİ: ilk eşleşen kazanır. Daha özgül desenler önce gelir.
const RULES: { test: RegExp; text: (raw: string) => string }[] = [
  {
    // Playbook'un kendi öneki. Arkasındaki metin `oc`nin GERÇEK stderr'i —
    // eskiden `>/dev/null` ile tamamen yutuluyordu.
    test: /LOGIN_FAILED:\s*(.*)/s,
    text: (raw) => {
      const detail = (raw.match(/LOGIN_FAILED:\s*(.*)/s)?.[1] || '').trim();
      if (/401|Unauthorized|Login failed/i.test(detail)) {
        return "Cluster'a giriş reddedildi (401) — kullanıcı adı ya da parola geçersiz.";
      }
      if (/connection refused|no route to host|timeout|timed out|i\/o timeout/i.test(detail)) {
        return "Cluster API'sine ulaşılamadı — ağ/erişim sorunu.";
      }
      if (/certificate|x509|tls/i.test(detail)) {
        return 'Cluster sertifikası doğrulanamadı.';
      }
      return `Cluster'a giriş yapılamadı: ${detail || 'sebep bildirilmedi'}`;
    },
  },
  {
    // Parola boş kalınca `oc login` patlar ve BİR SONRAKİ `oc` çağrısı bunu der.
    // Kullanıcının yapacağı bir şey yok; kubeconfig'e bakmasın.
    test: /Missing or incomplete configuration info/i,
    text: () =>
      "Cluster'a giriş yapılamadı — kimlik bilgisi çözülemedi. " +
      'Bu bir kubeconfig sorunu DEĞİL: portal parolayı AWX kimlik dosyasından okuyamadı. ' +
      'Yöneticiye bildirin.',
  },
  {
    test: /Cluster kimligi cozulemedi/i,
    text: (raw) => raw, // playbook zaten Türkçe ve açık yazıyor
  },
  {
    test: /forbidden|cannot list|is not allowed/i,
    text: () => 'Bu namespace/cluster için yetkiniz yok — yöneticinize başvurun.',
  },
  {
    test: /not found|NotFound/i,
    text: () => 'İstenen nesne cluster üzerinde bulunamadı.',
  },
];

/**
 * Ham `oc`/playbook hatasını kullanıcıya gösterilecek cümleye çevirir.
 * Eşleşme yoksa ham metin AYNEN döner — uydurma yapmaz.
 */
export function humanizeOcpError(raw: unknown): OcpErrorText {
  const text = String(raw ?? '').trim();
  if (!text) return { text: 'Bilinmeyen hata.', raw: '', translated: false };
  for (const r of RULES) {
    if (r.test.test(text)) return { text: r.text(text), raw: text, translated: true };
  }
  return { text, raw: text, translated: false };
}
