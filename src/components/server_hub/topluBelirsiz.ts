// src/components/server_hub/topluBelirsiz.ts — Toplu Restart / Toplu Auto-Start "oluştur" isteği belirsiz bitince.
//
// ÜRETİM (2026-11-14): 33 JVM seçilip Toplu Restart'a basıldı; ekranda
//   "Sunucu beklenmeyen bir yanıt döndü (HTTP 500) — lütfen tekrar deneyin ... [<!doctype html> ...]"
// göründü. Kurumsal nginx (proxy_intercept_errors + error_page 500) sunucunun JSON hatasını Portal'ın kendi
// index.html'iyle değiştirmişti; asıl mesaj kayboldu ve ekran kör bir "tekrar deneyin" diyordu. Oysa sunucu
// işi kaydetmiş olabilir (öğe yazımı yarıda kalırsa PLAN_HATA satırı kalır). Bu yüzden 5xx / ağ geçidi / ağ
// hatasından sonra ekran önce aktif / son işi YENİDEN OKUR: iş açılmışsa onu izler ve yeniden gönderilmemesini
// söyler; açılmadığı doğrulanırsa bunu söyler; okunamazsa kontrol etmeden yeniden göndermemesini söyler.

/** HTTP durumu olmayan (ağ) ya da 5xx hata: istek sunucuda işlenmiş olabilir. 4xx kesin rettir. */
export function belirsizHataMi(e: unknown): boolean {
  const st = e && typeof e === 'object' ? (e as { status?: unknown }).status : undefined;
  return typeof st !== 'number' || st >= 500;
}

interface IsOzet {
  id: number;
  durum: string;
  createdAt: string | null;
}

/** Saat farkına pay: sunucu saati istemciden biraz geri olabilir. */
const SAAT_PAYI_MS = 2 * 60 * 1000;

/**
 * Belirsiz hatadan sonra izlenecek iş: aktif iş varsa o; yoksa istekten (SAAT_PAYI içinde) sonra açılmış son
 * iş (örn. öğeler yazılamadı → PLAN_HATA). Yoksa null. oncekiSonId: istekten ÖNCE ekranın bildiği en son iş;
 * o ya da daha eskisi bu istekte açılmış sayılmaz (iki dakika içindeki önceki başarısız deneme "kayıtlı —
 * yeniden göndermeyin" diye gösterilmesin).
 */
export function belirsizSonrasiIs<T extends IsOzet>(
  liste: { ok: boolean; aktif: T | null; son: T[] },
  istekBaslangicMs: number,
  oncekiSonId: number | null = null,
): T | null {
  if (!liste || !liste.ok) return null;
  if (liste.aktif) return liste.aktif;
  const s = (liste.son || [])[0];
  if (!s || (oncekiSonId != null && s.id <= oncekiSonId)) return null;
  if (s.createdAt && new Date(s.createdAt).getTime() >= istekBaslangicMs - SAAT_PAYI_MS) return s;
  return null;
}

/** Kullanıcı mesajı (Türkçe). ad: "Toplu restart" / "Toplu auto-start". */
export function belirsizMesaji(
  ad: string,
  hataMesaji: string,
  sonuc: { is: IsOzet | null; okunamadi: boolean },
): string {
  if (sonuc.okunamadi)
    return `${hataMesaji} ${ad} işinin açılıp açılmadığı okunamadı — yeniden göndermeden önce sayfayı yenileyip bu sekmedeki işi kontrol edin.`;
  if (sonuc.is)
    return `${hataMesaji} ${ad} işi #${sonuc.is.id} kayıtlı (${sonuc.is.durum}) — aşağıda izleniyor; yeniden göndermeyin.`;
  return `${hataMesaji} İş kaydı açılmadı (doğrulandı; hiçbir JVM'e dokunulmadı) — birkaç dakika sonra yeniden deneyebilirsiniz.`;
}
