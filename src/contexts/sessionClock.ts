// src/contexts/sessionClock.ts — OTURUM SAATI (Faz B, 2026-10-02).
//
// NEDEN: "sik atiyor" sikayetinin istemci tarafindaki koku. Eskiden HER SEKMENIN kendi
// 30 dk'lik sayaci vardi ve sayac dolunca `POST /api/auth/logout` cagiriyordu: ORTAK
// oturum oldugu icin bosta duran bir sekme, o an baska sekmede calisan kullaniciyi da
// disari atiyordu. Etkinlik de yalnizca o sekmedeki fare/klavye ile sayiliyordu.
//
// ARTIK:
//   * Tek dogruluk kaynagi SUNUCUNUN bitis zamanlaridir (Faz A: her yanittaki
//     `X-Portal-Session-Expires/-Absolute` basliklari, `GET /api/auth/session`).
//   * Istemci KENDI BASINA logout CAGIRMAZ. Sure doldugunda sunucuya sorar; oturum
//     gercekten bittiyse imzali 401 `sessionGuard` kapisini kapatir.
//   * Sekmeler tek saati paylasir (BroadcastChannel; yoksa `storage` olayi): bir
//     sekmedeki uzatma hepsinin saatini ilerletir; cikis/giris hepsine yayilir.
//   * Ekranda okuma gibi API cagrisi URETMEYEN etkinlik, kisitli `extend` ile
//     sunucuya bildirilir.
//
// Saf modul (React yok): bekciler iki "sekmeyi" ayni surecte simule eder.

export interface OturumOzeti {
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  warnSeconds?: number;
  remember?: boolean;
  serverNow?: number;
}

/** Istemci saatine cevrilmis durum. `bilinen` false iken zamanlayici kurulmaz. */
export interface SaatDurumu {
  /**
   * SUNUCUNUN bitis degerleri her degistiginde artar. "Bu, ayni oturum bitisi mi?" sorusu
   * ZAMAN karsilastirmasiyla degil bununla cevaplanir: istemci saatine cevrilmis degerler
   * saat farki olcumuyle birkac ms oynar, esitlik karsilastirmasi guvenilmezdir.
   */
  surum: number;
  bilinen: boolean;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  warnSeconds: number;
  remember: boolean;
}

export type SaatMesaji =
  | { tur: 'saat'; idleExpiresAt: number; absoluteExpiresAt: number; warnSeconds?: number; remember?: boolean }
  | { tur: 'cikis' }
  | { tur: 'giris'; username: string };

export interface SaatKanali {
  gonder(m: SaatMesaji): void;
  dinle(fn: (m: SaatMesaji) => void): () => void;
  kapat(): void;
}

const KANAL_ADI = 'portal-session';
const DEPO_ANAHTARI = 'portal-session-msg';

/** Tarayici kanali: BroadcastChannel; yoksa localStorage `storage` olayi; o da yoksa sessiz. */
export function tarayiciKanali(): SaatKanali {
  if (typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel(KANAL_ADI);
    return {
      gonder: (m) => {
        try {
          bc.postMessage(m);
        } catch {
          /* kapanmis kanal */
        }
      },
      dinle: (fn) => {
        const h = (e: MessageEvent) => fn(e.data as SaatMesaji);
        bc.addEventListener('message', h);
        return () => bc.removeEventListener('message', h);
      },
      kapat: () => bc.close(),
    };
  }
  return {
    gonder: (m) => {
      try {
        // Ayni deger iki kez yazilirsa `storage` olayi tetiklenmez: damga eklenir.
        localStorage.setItem(DEPO_ANAHTARI, JSON.stringify({ ...m, _t: Date.now() + Math.random() }));
      } catch {
        /* gizli pencere / engellenmis depo */
      }
    },
    dinle: (fn) => {
      const h = (e: StorageEvent) => {
        if (e.key !== DEPO_ANAHTARI || !e.newValue) return;
        try {
          fn(JSON.parse(e.newValue) as SaatMesaji);
        } catch {
          /* bozuk mesaj */
        }
      };
      window.addEventListener('storage', h);
      return () => window.removeEventListener('storage', h);
    },
    kapat: () => {},
  };
}

/** Etkinlik varken en fazla bu aralikla `extend` cagrilir (bosta kalma kisaysa daha sik). */
export const UZATMA_ARALIGI_MS = 5 * 60 * 1000;
const EN_KISA_UZATMA_MS = 60 * 1000;

export interface SaatSecenekleri {
  kanal?: SaatKanali;
  istek?: typeof fetch;
  simdi?: () => number;
}

export function oturumSaatiOlustur(sec: SaatSecenekleri = {}) {
  // Kanal SONRADAN baglanir/ayrilir (`baglan`). Saat nesnesi bilesen omru boyunca yasar
  // ama kanal bir EFEKT kaynagidir: kurulumu ve sokumu simetrik olmali. Ilk surumde kanal
  // olusturulurken verilip efekt temizliginde kapatiliyordu; React StrictMode (gelistirme)
  // efekti bir kez sokup yeniden kurdugu icin kanal KALICI olarak kapaniyor, sekmeler
  // arasi esitleme sessizce oluyordu (2026-10-03, gercek tarayici testinde bulundu).
  let kanal: SaatKanali | undefined;
  let kanalBirak: (() => void) | undefined;
  const istek = sec.istek ?? ((i: RequestInfo | URL, o?: RequestInit) => window.fetch(i, o));
  const simdi = sec.simdi ?? (() => Date.now());

  // Sunucu saati cinsinden degerler + sapma (sunucu - istemci).
  let sunucuBosta = 0;
  let sunucuMutlak = 0;
  let sapma = 0;
  let sapmaOlculdu = false;
  let surum = 0;
  let warnSeconds = 120;
  let remember = false;
  let sonUzatma = 0;
  let uzatiliyor: Promise<boolean> | null = null;

  const aboneler = new Set<(d: SaatDurumu) => void>();
  const cikisAboneleri = new Set<() => void>();
  const girisAboneleri = new Set<(username: string) => void>();

  function durum(): SaatDurumu {
    return {
      surum,
      bilinen: sunucuBosta > 0 && sunucuMutlak > 0,
      idleExpiresAt: sunucuBosta - sapma,
      absoluteExpiresAt: sunucuMutlak - sapma,
      warnSeconds,
      remember,
    };
  }

  function bildir() {
    const d = durum();
    for (const fn of aboneler) fn(d);
  }

  // Bitisler degistiyse uygular ve true doner. Bosta bitisinin ILERLEMESI, sunucunun
  // etkinligi zaten kaydettigi demektir: kisitli extend sayaci da sifirlanir.
  function uygula(idle: number, abs: number, ek?: { warnSeconds?: number; remember?: boolean }): boolean {
    if (!(idle > 0) || !(abs > 0)) return false;
    let degisti = idle !== sunucuBosta || abs !== sunucuMutlak;
    if (degisti) surum += 1;
    // Ilk deger (giris / sayfa acilisi) de sunucunun etkinligi az once kaydettigi andir:
    // hemen ardindan gelen ilk fare hareketi gereksiz bir extend uretmesin.
    if (idle > sunucuBosta) sonUzatma = simdi();
    sunucuBosta = idle;
    sunucuMutlak = abs;
    if (ek?.warnSeconds && ek.warnSeconds !== warnSeconds) {
      warnSeconds = ek.warnSeconds;
      degisti = true;
    }
    if (typeof ek?.remember === 'boolean' && ek.remember !== remember) {
      remember = ek.remember;
      degisti = true;
    }
    if (degisti) bildir();
    return degisti;
  }

  function yay(m: SaatMesaji) {
    kanal?.gonder(m);
  }

  /** Sunucu ozetini uygular (GET /session, /extend, /login yaniti) ve diger sekmelere yayar. */
  function ozetUygula(o: OturumOzeti | null | undefined, { yayinla = true } = {}) {
    if (!o) return;
    // Saat farki: ILK olcum her zaman uygulanir; sonrakiler yalnizca 1 sn'den fazla
    // degistiyse (gercek saat degisimi). Aradaki birkac ms'lik oynama ag gecikmesidir —
    // her yanitta saati kipirdatmak zamanlayicilari bosuna yeniden kurardi.
    let sapmaDegisti = false;
    if (typeof o.serverNow === 'number' && o.serverNow > 0) {
      const yeni = o.serverNow - simdi();
      if (!sapmaOlculdu || Math.abs(yeni - sapma) > 1000) {
        sapmaDegisti = yeni !== sapma;
        sapma = yeni;
        sapmaOlculdu = true;
      }
    }
    const degisti = uygula(o.idleExpiresAt, o.absoluteExpiresAt, o);
    // Sunucu degerleri ayni kalsa da saat farki degistiyse istemci-saatindeki degerler
    // degisti: aboneler haberdar edilmeli (yoksa abonenin elindeki durum bayat kalir).
    if (!degisti && sapmaDegisti) bildir();
    if (degisti && yayinla) {
      yay({
        tur: 'saat',
        idleExpiresAt: o.idleExpiresAt,
        absoluteExpiresAt: o.absoluteExpiresAt,
        warnSeconds: o.warnSeconds,
        remember: o.remember,
      });
    }
  }

  /** Her `/api` yanitinin basliklari (sessionGuard). Degistiyse diger sekmelere yayilir. */
  function basliklariUygula(b: { idleExpiresAt: number; absoluteExpiresAt: number }) {
    if (uygula(b.idleExpiresAt, b.absoluteExpiresAt)) {
      yay({ tur: 'saat', idleExpiresAt: b.idleExpiresAt, absoluteExpiresAt: b.absoluteExpiresAt });
    }
  }

  async function oku(url: string, init?: RequestInit): Promise<OturumOzeti | null> {
    try {
      const r = await istek(url, init);
      if (!r.ok) return null;
      const d = await r.json();
      return d && d.ok ? (d as OturumOzeti) : null;
    } catch {
      return null;
    }
  }

  /** Sunucuya "saatim ne" diye sorar — ETKINLIK SAYILMAZ. Oturum yoksa imzali 401 kapiyi kapatir. */
  async function tazele(): Promise<boolean> {
    const o = await oku('/api/auth/session');
    if (o) ozetUygula(o);
    return !!o;
  }

  /** "Surdur" ve kisitli etkinlik bildirimi. Ayni anda tek istek. */
  function uzat(): Promise<boolean> {
    if (uzatiliyor) return uzatiliyor;
    sonUzatma = simdi();
    uzatiliyor = oku('/api/auth/session/extend', { method: 'POST' })
      .then((o) => {
        if (o) ozetUygula(o);
        return !!o;
      })
      .finally(() => {
        uzatiliyor = null;
      });
    return uzatiliyor;
  }

  /**
   * Kullanici etkinligi (fare, klavye, kaydirma, sekmeye donus). Sunucuya en fazla
   * UZATMA_ARALIGI_MS'de bir bildirilir; bosta kalma suresi kisaysa (Admin 5 dk
   * yaptiysa) kalan surenin yarisinda bir — aksi halde okuyan kullanici atilirdi.
   */
  function etkinlik(): void {
    const d = durum();
    if (!d.bilinen) return;
    const now = simdi();
    const kalan = d.idleExpiresAt - now;
    if (kalan <= 0) return; // sure doldu: karar sunucunun (tazele), etkinlik geri getirmez
    const esik = Math.min(UZATMA_ARALIGI_MS, Math.max(EN_KISA_UZATMA_MS, kalan / 2));
    if (now - sonUzatma >= esik) void uzat();
  }

  function cikisYay() {
    yay({ tur: 'cikis' });
  }
  function girisYay(username: string) {
    yay({ tur: 'giris', username });
  }

  function sifirla() {
    sunucuBosta = 0;
    sunucuMutlak = 0;
    surum += 1;
    sonUzatma = 0;
    bildir();
  }

  /** Kanali baglar; donen fonksiyon YALNIZCA bu kanali ayirir (aboneler yerinde kalir). */
  function baglan(yeni: SaatKanali): () => void {
    kanalBirak?.();
    kanal?.kapat();
    kanal = yeni;
    kanalBirak = yeni.dinle((m) => {
      if (!m || typeof m !== 'object') return;
      if (m.tur === 'saat') uygula(m.idleExpiresAt, m.absoluteExpiresAt, m);
      else if (m.tur === 'cikis') for (const fn of cikisAboneleri) fn();
      else if (m.tur === 'giris') for (const fn of girisAboneleri) fn(m.username);
    });
    return () => {
      if (kanal !== yeni) return; // baska bir kanal baglanmis: ona dokunma
      kanalBirak?.();
      yeni.kapat();
      kanal = undefined;
      kanalBirak = undefined;
    };
  }
  if (sec.kanal) baglan(sec.kanal);

  return {
    baglan,
    durum,
    ozetUygula,
    basliklariUygula,
    tazele,
    uzat,
    etkinlik,
    cikisYay,
    girisYay,
    sifirla,
    abone(fn: (d: SaatDurumu) => void) {
      aboneler.add(fn);
      return () => {
        aboneler.delete(fn);
      };
    },
    cikisAbone(fn: () => void) {
      cikisAboneleri.add(fn);
      return () => {
        cikisAboneleri.delete(fn);
      };
    },
    girisAbone(fn: (username: string) => void) {
      girisAboneleri.add(fn);
      return () => {
        girisAboneleri.delete(fn);
      };
    },
    kapat() {
      kanalBirak?.();
      kanal?.kapat();
      kanal = undefined;
      kanalBirak = undefined;
      aboneler.clear();
      cikisAboneleri.clear();
      girisAboneleri.clear();
    },
  };
}

export type OturumSaati = ReturnType<typeof oturumSaatiOlustur>;

/**
 * Uyari ne zaman acilir ve "Surdur" ise yarar mi. Mutlak sinir bosta kalma
 * sinirindan once geliyorsa uzatmak ise YARAMAZ — kullaniciya bu acikca soylenir.
 */
export function uyariHesapla(d: SaatDurumu) {
  const bitis = Math.min(d.idleExpiresAt, d.absoluteExpiresAt);
  return {
    bitis,
    uyariAni: bitis - d.warnSeconds * 1000,
    uzatilabilir: d.idleExpiresAt < d.absoluteExpiresAt,
  };
}

/**
 * Sunucu oturumun NEDEN bittigini yalnizca suresi dolan oturuma gelen ILK istekte soyler
 * (o istek oturumu siler). Birden cok sekme acikken digerleri sebepsiz bir 401 alir ve
 * genel "oturumunuz sona erdi" mesajini gosterirdi. Sekmenin kendi saati bitisi zaten
 * bilir: 401 bilinen bitis aninda (ya da sonrasinda) geldiyse sebep yerelde cikarilir.
 * Bitisten ONCE gelen sebepsiz 401 (iptal, sunucu yeniden baslatma) `undefined` kalir.
 */
export function bitisSebebi(d: SaatDurumu, now: number): 'idle' | 'absolute' | undefined {
  if (!d.bilinen) return undefined;
  const PAY_MS = 5000; // saat sapmasi + zamanlayici gecikmesi
  if (now >= d.absoluteExpiresAt - PAY_MS) return 'absolute';
  if (now >= d.idleExpiresAt - PAY_MS) return 'idle';
  return undefined;
}
