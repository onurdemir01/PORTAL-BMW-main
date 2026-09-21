// src/api/sessionGuard.ts — OTURUM BITTIGINDE ISTEKLERI TEK YERDEN DURDUR.
//
// NEDEN VAR
// ─────────
// Uretim olcumu (13,5 gun): 10.211 adet 401. Bunlarin buyuk cogunlugu, oturumu
// dusmus ACIK BIR SEKMENIN sonsuza dek donen yoklama donguleridir. PR #117
// bunlardan BIRINI (gorunurluk yoklamasi) `user` bagimliligina baglayarak
// durdurdu; geriye ayni hatanin baska bicimleri kaldi:
//
//   /api/ansible/ss/smart-tickets/mine   854   ← `user` kapisi YOK, 120 sn'de bir
//   /api/auth/me · /api/auth/prefs       ~670  ← acilis yoklamasi
//   users/online · ss/job-status         ~220
//
// Her donguyu tek tek yamamak WHACK-A-MOLE olurdu: bugun ondan fazla
// `setInterval` var ve gelecek ay yazilacak on birincisi ayni hatayi yeniden
// getirir. Bu dosya kapiyi DONGULERIN ALTINA koyar: oturumun bittigi bir kez
// anlasildiginda `/api/*` istekleri AGA HIC CIKMAZ. Dongu donmeye devam etse
// bile sunucu bir daha rahatsiz edilmez.
//
// ── CIPLAK 401'E BAKMAK NEDEN YANLIS OLURDU ─────────────────────────────────
// Bu depoda 401 iki ayri sey demek. `server/ansible/runner.cjs:894` AWX
// hatasini `{ status: res.statusCode }` ile sariyor ve 22 route
// `res.status(err.status || 500)` yaziyor — yani PORTALIN AWX token'i duserse
// tarayici 401 gorur. Ciplak duruma bakan bir kapi, o anda portali kullanan
// HERKESI disari atardi.
//
// Bu yuzden yalnizca sunucunun IMZALADIGI 401'ler sayilir
// (`server/auth/utils.cjs` → `oturumYok`).

/** Sunucunun oturum 401'ine bastigi imza. `server/auth/utils.cjs` ile ayni. */
export const SESSION_HEADER = 'X-Portal-Session';

/**
 * Kapinin DISINDA kalan uclar. Giris denemesi engellenirse kullanici bir daha
 * hic giremezdi — kilit kendi anahtarini da kilitlemis olurdu.
 */
const MUAF = ['/api/auth/login', '/api/auth/logout'];

let _kurulu = false;
let _gercekFetch: typeof fetch | null = null;

/**
 * Istemci "oturumum var" diyor mu? AuthContext bildirir.
 *
 * NEDEN SART: acilista, giris ekraninda 401 NORMALDIR — ortada bitmis bir
 * oturum yoktur. O 401'lerde kapiyi kapatmak, henuz giris yapmamis kullanicinin
 * isteklerini sessizce yutmak olurdu. Kapi yalnizca "oturum VARDI ve OLDU"
 * durumunda kapanir.
 */
let _oturumVar = false;

/** Oturumun bittigi kanitlandi mi. Kapali kaldigi surece ag'a cikilmaz. */
let _bitti = false;

const _aboneler = new Set<() => void>();

/** Oturum bitince haber verilir (AuthContext kullaniciyi giris ekranina duser). */
export function oturumBittiAbone(fn: () => void): () => void {
  _aboneler.add(fn);
  return () => _aboneler.delete(fn);
}

/** AuthContext her `user` degisiminde cagirir. `true` kapiyi ACAR (yeni giris). */
export function oturumDurumunuBildir(varMi: boolean): void {
  _oturumVar = varMi;
  if (varMi) _bitti = false;
}

/** Kapi su an kapali mi (teshis/test icin). */
export function oturumBittiMi(): boolean {
  return _bitti;
}

function muafMi(url: string): boolean {
  return MUAF.some((m) => url.startsWith(m));
}

function apiMi(url: string): boolean {
  return url.startsWith('/api/');
}

/**
 * `Request | string | URL` → yol. Mutlak URL'lerde YALNIZCA ayni kokenli
 * olanlar `/api/...` yoluna indirgenir; baska bir kokene giden istek bu kapinin
 * konusu degildir.
 */
function yolCikar(input: RequestInfo | URL): string {
  const ham =
    typeof input === 'string' ? input
      : input instanceof URL ? input.href
        : (input as Request).url || '';
  if (ham.startsWith('/')) return ham;
  try {
    const u = new URL(ham, window.location.href);
    return u.origin === window.location.origin ? u.pathname + u.search : '';
  } catch {
    return '';
  }
}

/**
 * Ag'a cikmadan uretilen 401. GERCEGININ AYNISI gorunur — ayni durum, ayni
 * imza, ayni govde sekli — ki cagiran tarafin mevcut hata yolu degismeden
 * calissin. `safeJson` bunu `{ ok:false, error, _httpStatus:401 }` olarak
 * cozer; yani hicbir bilesenin yeniden yazilmasi gerekmez.
 */
function sentetik401(): Response {
  return new Response(
    JSON.stringify({ ok: false, error: 'Oturum sona erdi. Lütfen yeniden giriş yapın.' }),
    { status: 401, headers: { 'content-type': 'application/json', [SESSION_HEADER]: 'expired' } },
  );
}

function kapiyiKapat(): void {
  if (_bitti) return;
  _bitti = true;
  for (const fn of _aboneler) {
    try {
      fn();
    } catch {
      /* bir abonenin hatasi digerlerini engellemesin */
    }
  }
}

/**
 * `window.fetch`i bir kez sarar. Tekrar cagrilmasi ZARARSIZDIR (HMR, StrictMode,
 * test) — ikinci kez sarmak sarmali ust uste bindirip her istegi iki kez
 * sayardi.
 */
export function sessionGuardKur(): void {
  if (_kurulu) return;
  _kurulu = true;
  _gercekFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const yol = yolCikar(input);

    // `/api/` disi her sey (statik varlik, Vite HMR, dis servis) DOKUNULMAZ.
    if (!apiMi(yol)) return _gercekFetch!(input, init);

    // Kapi kapali: istek AGA CIKMAZ. P1-3'un kabul olcutu ("oturumu dolmus bir
    // sekme 60 saniyede <= 2 istek") ancak burada saglanir — dongunun kendisini
    // durdurmak, o donguyu YAZAN her gelistiriciye guvenmek demekti.
    if (_bitti && !muafMi(yol)) return sentetik401();

    const res = await _gercekFetch!(input, init);
    if (res.status === 401 && _oturumVar && res.headers.get(SESSION_HEADER) === 'expired') {
      kapiyiKapat();
    }
    return res;
  };
}

/** Testler icin: sarmali soker ve durumu sifirlar. */
export function _sessionGuardSifirla(): void {
  if (_kurulu && _gercekFetch) window.fetch = _gercekFetch;
  _kurulu = false;
  _gercekFetch = null;
  _oturumVar = false;
  _bitti = false;
  _aboneler.clear();
}
