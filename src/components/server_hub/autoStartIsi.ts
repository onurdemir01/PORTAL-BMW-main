// src/components/server_hub/autoStartIsi.ts — tek JVM auto-start işi: başlat, izle, sonucu göster (2026-11-14).
//
// Kullanıcı: "Ayrıntı -> JVM -> Auto-Start Kapat/Aç tuşları çok yavaş çalışıyor, çalışıp çalışmadıklarından
// da emin olamıyorum".
//
// Eskiden: düğme iş BAŞLATILIR başlatılmaz normale dönüyordu (iş dakikalarca sürerken yeniden tıklanabilir),
// iş alt çubukta küçük sekmede izleniyordu, sonuç satırı (RESULT … OK|SKIP|FAIL <mesaj>) hiç okunmuyordu
// ("iş failed." dışında sebep yok; SKIP de "açıldı" deniyordu) ve Bulgular yolunda iş hiç izlenmiyordu.
//
// Şimdi: iş TERMİNAL olana kadar aynı JVM için ikinci iş açılamaz (modül düzeyi kayıt: pencere kapanıp
// açılsa da, iki ayrı ekrandan da). Satır "#iş · kuyrukta / koşuyor" gösterir. Bitince betiğin mesajı
// OK / SKIP / FAIL olarak gösterilir; OK/SKIP'te doğrulanan değer çağırana verilir (ekran taramayı
// beklemeden günceller; sunucu da aynı değeri /host'ta taşır).
import { useSyncExternalStore } from 'react';
import { serverHubApi } from '@/api/serverHubApi';
import { toast } from '@/hooks/useToast';

const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
/** JobTrackerContext MAX_ERRORS ile aynı: izleyici bu kadar art arda hatada yoklamayı bırakır. */
const YOKLAMA_HATA_MAX = 12;

export type AutoStartIsDurumu = { jobId: number | null; durum: string; baslangic: number };
export type AutoStartSonucu = {
  tur: 'ok' | 'skip' | 'fail';
  mesaj: string;
  /** OK/SKIP: CLI ile doğrulanan değer; FAIL: null. */
  deger: 'true' | 'false' | null;
  jobId: number | null;
};

/** `${host}|${gen}|${jvm}` — Bulgular, sunucu paneli ve Ayrıntı penceresi AYNI anahtarı kullanır. */
export const autoStartAnahtari = (host: string, gen: number, jvm: string) => `${host}|${gen}|${jvm}`;

/** Bir işin bitişi: hangi ekrandan başlatılmış olursa olsun, o sunucuyu gösteren HER ekran dinler. */
export type AutoStartBitisi = { anahtar: string; host: string; gen: number; jvm: string; sonuc: AutoStartSonucu };
export type AutoStartSonKaydi = AutoStartSonucu & { at: number };

// ── modül düzeyi kayıt (useSyncExternalStore) ─────────────────────────────────────────────
let isler: ReadonlyMap<string, AutoStartIsDurumu> = new Map();
/** Son biten işin sonucu (anahtar -> sonuç); satır "✗ iş #N: …" gösterir, sayfa yenilenene dek. */
let sonuclar: ReadonlyMap<string, AutoStartSonKaydi> = new Map();
const dinleyiciler = new Set<() => void>();
const bitisDinleyicileri = new Set<(e: AutoStartBitisi) => void>();
const zamanlayicilar = new Set<ReturnType<typeof setTimeout>>();
const bildir = () => dinleyiciler.forEach((f) => f());
function yaz(k: string, d: AutoStartIsDurumu | null) {
  const m = new Map(isler);
  if (d) m.set(k, d);
  else m.delete(k);
  isler = m;
  bildir();
}
function sonucYaz(k: string, s: AutoStartSonucu) {
  const m = new Map(sonuclar);
  m.set(k, { ...s, at: Date.now() });
  sonuclar = m;
  bildir();
}
const abone = (f: () => void) => {
  dinleyiciler.add(f);
  return () => {
    dinleyiciler.delete(f);
  };
};
const anlik = () => isler;
const anlikSonuc = () => sonuclar;

/** Süren auto-start işleri (anahtar -> durum). Değişince bileşen yeniden çizilir. */
export function useAutoStartIsleri(): ReadonlyMap<string, AutoStartIsDurumu> {
  return useSyncExternalStore(abone, anlik, anlik);
}

/** Son biten auto-start işlerinin sonucu (anahtar -> sonuç). */
export function useAutoStartSonuclari(): ReadonlyMap<string, AutoStartSonKaydi> {
  return useSyncExternalStore(abone, anlikSonuc, anlikSonuc);
}

/**
 * İş bitince çağrılır (başlatan pencere kapanmış olsa da). Ayrıntı penceresi kendi sunucusu için
 * /host'u yeniden okur, Bulgular listesi kendini tazeler. Dönüş: aboneliği bırak.
 */
export function autoStartBittiDinle(f: (e: AutoStartBitisi) => void): () => void {
  bitisDinleyicileri.add(f);
  return () => {
    bitisDinleyicileri.delete(f);
  };
}

/** Bu JVM için süren iş var mı (çift tık / iki ekrandan aynı anda koruması). */
export const autoStartIsVar = (k: string): boolean => isler.has(k);

export function _sifirlaForTest(): void {
  zamanlayicilar.forEach((t) => clearTimeout(t));
  zamanlayicilar.clear();
  bitisDinleyicileri.clear();
  isler = new Map();
  sonuclar = new Map();
  bildir();
}

/**
 * YEDEK YOKLAMA (inceleme 2026-11-14): iş çubuğundaki sekme kapatılınca (JobTrackerContext.remove) izleyici
 * yoklamayı bırakır; eskiden kayıt hiç silinmez, JVM sayfa yenilenene dek "#N · koşuyor" kalır, sonuç hiç
 * gelmezdi. Bu modül kendi yedek döngüsüyle izler: izleyici son YEDEK_MS içinde yokladıysa AWX'e EK istek
 * atılmaz (aynı uçuş paylaşılır).
 */
export const YEDEK_MS = 10_000;
/** Bu kadar süredir terminal olmayan iş için kilit bırakılır (AWX'ten kontrol uyarısıyla). */
export const KILIT_EN_COK_MS = 45 * 60_000;
function zamanla(f: () => void, ms: number) {
  const t = setTimeout(() => {
    zamanlayicilar.delete(t);
    f();
  }, ms);
  zamanlayicilar.add(t);
}

const ETIKET: Record<string, string> = {
  baslatiliyor: 'başlatılıyor',
  new: 'kuyrukta',
  pending: 'kuyrukta',
  waiting: 'bekliyor',
  running: 'koşuyor',
};
/** Düğme / hücre metni: "#123 · koşuyor" (iş no henüz yoksa "başlatılıyor…"). */
export function isMetni(d: AutoStartIsDurumu): string {
  const e = ETIKET[d.durum] || d.durum || 'kuyrukta';
  return d.jobId == null ? `${e}…` : `#${d.jobId} · ${e}`;
}

/** RESULT\t<eylem>\t<OK|SKIP|FAIL|PLAN>\t<mesaj> satırı (server_hub_fix set_stats `line`). */
export function sonucSatiri(result: unknown): { durum: string; mesaj: string } | null {
  const line = (result as { line?: unknown } | null)?.line;
  if (typeof line !== 'string') return null;
  const p = line.split('\t');
  if (p[0] !== 'RESULT' || p.length < 3) return null;
  return { durum: String(p[2] || '').toUpperCase(), mesaj: p.slice(3).join(' ').trim() };
}

/** İşin sonucu. OK/SKIP yalnız iş 'successful' iken; geri kalan her şey FAIL (sebep betikten). */
export function autoStartSonucu(
  status: string,
  result: unknown,
  ac: boolean,
  jobId: number | null,
): AutoStartSonucu {
  const s = sonucSatiri(result);
  const hedef = ac ? 'true' : 'false';
  if (status === 'successful' && s && (s.durum === 'OK' || s.durum === 'SKIP'))
    return { tur: s.durum === 'OK' ? 'ok' : 'skip', mesaj: s.mesaj, deger: hedef, jobId };
  const neden =
    s?.mesaj ||
    (status === 'successful'
      ? 'iş bitti ama sonuç satırı (RESULT) okunamadı — değer doğrulanamadı'
      : `iş ${status}; betik sonuç satırı vermedi (AWX iş çıktısına bakın)`);
  return { tur: 'fail', mesaj: neden, deger: null, jobId };
}

/**
 * Çalışan JVM'de auto-start KAPATILAMAZ: betik (server_hub_fix.sh) FORCE olmadan reddeder, Portal FORCE
 * göndermez; sunucu da iş açmadan 400 döner. Çalışma durumu ÖLÇÜLEMEYEN JVM'de engel yok (v3).
 */
export function kapatEngeli(j: {
  running: boolean;
  runningKnown?: boolean | null;
  runningSrc?: string | null;
}): string {
  const bilinir = j.runningKnown !== false && String(j.runningSrc || '').toUpperCase() !== 'UNMEASURED';
  return bilinir && j.running === true
    ? "JVM çalışıyor — çalışan JVM'in auto-start'ı kapatılmaz (betik reddeder). Önce JVM'i durdurun, sonra yeniden tarayın."
    : '';
}

type AddJob = (input: {
  title: string;
  fetchStatus: () => Promise<{ status: string; output: string; result?: unknown }>;
}) => string;

/**
 * Tek JVM auto-start işini başlatır ve terminal olana kadar izler. Aynı JVM'de süren iş varsa hiçbir şey
 * yapmaz (false). Onay çağıranın işidir (bu fonksiyon onay İSTEMEZ).
 */
export async function autoStartBaslat(p: {
  host: string;
  gen: number;
  jvm: string;
  ac: boolean;
  addJob: AddJob;
  onBitti?: (s: AutoStartSonucu) => void;
}): Promise<boolean> {
  const k = autoStartAnahtari(p.host, p.gen, p.jvm);
  if (isler.has(k)) return false;
  const yon = p.ac ? 'AÇ' : 'KAPAT';
  yaz(k, { jobId: null, durum: 'baslatiliyor', baslangic: Date.now() });
  let r: Awaited<ReturnType<typeof serverHubApi.jvmAutoStart>>;
  try {
    r = await serverHubApi.jvmAutoStart({ host: p.host, gen: p.gen, jvm: p.jvm, enable: p.ac });
  } catch (e: unknown) {
    yaz(k, null);
    toast.error(e instanceof Error ? e.message : String(e));
    return false;
  }
  if (!r.ok || r.jobId == null) {
    yaz(k, null);
    toast.error(r.message || 'İş başlatılamadı.');
    return false;
  }
  const jobId = r.jobId;
  const awx = r.awxServerId ?? 0;
  const baslangic = Date.now();
  yaz(k, { jobId, durum: 'pending', baslangic });
  toast.success(`${p.jvm}: auto-start ${yon} işi başladı (#${jobId}). Bitince sonuç bildirilir ve satıra yazılır.`);
  let bitti = false;
  let hata = 0;
  let sonYoklama = 0;
  type Durum = Awaited<ReturnType<typeof serverHubApi.jobStatus>>;
  let ucus: Promise<Durum> | null = null;
  const birak = (son: AutoStartSonucu | null) => {
    bitti = true;
    yaz(k, null);
    if (son) {
      sonucYaz(k, son);
      p.onBitti?.(son);
      const e: AutoStartBitisi = { anahtar: k, host: p.host, gen: p.gen, jvm: p.jvm, sonuc: son };
      bitisDinleyicileri.forEach((f) => {
        try {
          f(e);
        } catch {
          /* bir dinleyicinin hatası ötekileri durdurmasın */
        }
      });
    }
  };
  const isle = (s: Durum) => {
    hata = 0;
    if (bitti) return;
    if (TERMINAL.has(s.status)) {
      const son = autoStartSonucu(s.status, s.result, p.ac, jobId);
      if (son.tur === 'ok')
        toast.success(`${p.jvm}: auto-start ${p.ac ? 'AÇILDI' : 'KAPATILDI'} (CLI ile doğrulandı, iş #${jobId}). ${son.mesaj}`, 8000);
      else if (son.tur === 'skip')
        toast.info(`${p.jvm}: auto-start zaten ${p.ac ? 'açık' : 'kapalı'} — değişiklik yapılmadı (iş #${jobId}). ${son.mesaj}`, 8000);
      else toast.error(`${p.jvm}: auto-start ${yon} BAŞARISIZ (iş #${jobId}): ${son.mesaj}`, 12000);
      birak(son);
    } else yaz(k, { jobId, durum: s.status || 'pending', baslangic });
  };
  const hataIsle = () => {
    // Art arda YOKLAMA_HATA_MAX hatada vazgeçilir: düğme sonsuza dek meşgul kalmasın.
    hata += 1;
    if (hata >= YOKLAMA_HATA_MAX && !bitti) {
      birak(null);
      toast.warning(`${p.jvm}: iş #${jobId} durumu okunamıyor — sonucu AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın.`, 12000);
    }
  };
  /** Tek uçuş: izleyici ve yedek döngü aynı anda isterse AWX'e tek istek; sonuç bir kez işlenir. */
  const yokla = (): Promise<Durum> => {
    if (ucus) return ucus;
    sonYoklama = Date.now();
    const u = serverHubApi
      .jobStatus(awx, jobId)
      .then((s) => {
        if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
        isle(s);
        return s;
      })
      .catch((e: unknown) => {
        hataIsle();
        throw e;
      })
      .finally(() => {
        if (ucus === u) ucus = null;
      });
    ucus = u;
    return u;
  };
  const yedek = () => {
    if (bitti) return;
    if (Date.now() - baslangic > KILIT_EN_COK_MS) {
      birak(null);
      toast.warning(`${p.jvm}: iş #${jobId} ${Math.round(KILIT_EN_COK_MS / 60_000)} dakikadır bitmedi — kilit bırakıldı; sonucu AWX'ten kontrol edin.`, 12000);
      return;
    }
    if (Date.now() - sonYoklama >= YEDEK_MS) yokla().catch(() => {});
    zamanla(yedek, YEDEK_MS);
  };
  zamanla(yedek, YEDEK_MS);
  p.addJob({
    title: `Server Hub: auto-start ${yon} @ ${p.host}/${p.jvm}`,
    fetchStatus: async () => {
      const s = await yokla();
      return { status: s.status, output: s.output || '', result: s.result };
    },
  });
  return true;
}
