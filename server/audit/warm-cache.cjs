// server/audit/warm-cache.cjs - "sicak" onbellek: agir denetim hesaplari (2026-09-21).
//
// NE OLDU: /nginx-audit ve /nginx-migration 30 sn'de zaman asimina dusuyordu (14 gunluk denetim
// tablolari, indeks yok). Indeks eklendi (db/external-indexes.cjs) ama tablo buyuklugu ve DB
// yuku Portal'in elinde degil; kullanici sayfayi acinca beklememeli.
//
// DESEN: deger bir kez hesaplanip bellekte tutulur; istek geldiginde VARSA aninda (bayat olsa
// bile) doner ve suresi dolduysa ARKA PLANDA yeniler; hic hesaplanmadiysa ilk istek bekler
// (tek hesap - ayni anda gelen istekler ayni sozu paylasir). ?fresh=1 hesabi bekleyerek yeniler.
// Boot'tan sonra isitici hesaplari onceden yapar; sonuc `_cache: { computedAt, stale, ms }` tasir.
//
// DEGISIM BELIRTECI (2026-11-13, SlowQuery): isitici her 10 dakikada kosulsuz yeniden hesapliyordu
// (Nginx_Audit_Settings 1,56M satir; kaynak veri gunde bir yazilir). `token` verilirse periyodik
// tur ve get()'teki bayat-yenileme yolu once ucuz belirteci okur:
//   value yok                              -> hesapla
//   belirtec ayni ve yas < maxAgeMs        -> atla (checkedAt ilerler)
//   belirtec degisti (ilk kez goruldu)     -> atla (yukleme suruyor olabilir; stabilite bekle)
//   iki kontrol boyunca ayni ama farkli    -> hesapla (stabil)
//   yas >= maxAgeMs                        -> hesapla (belirtecin gormedigi kaynaklar icin emniyet)
// Belirtec okunamazsa agir hesap yalniz yas >= maxAgeMs iken tetiklenir. token yoksa davranis
// eskisi. maxAgeMs bir fonksiyon olabilir: (payload) => ms (or. eksik girdiyle hesap kisa omurlu).
// fresh=1 ve dogrudan run() belirtecten bagimsiz hesaplar; ucusta hesap varsa ardindan bir ek
// hesap zincirler (ucustaki hesap degisiklikten once okumus olabilir).
//
// SERI: ayni `seri` adini tasiyan onbelleklerin hesaplari modul-global bir zincirde sirayla
// calisir (uzun havuzun 4 baglantisini iki agir hesap ayni anda paylasmasin).
'use strict';

const _seriZincir = new Map();

/** fn'i `seri` zincirinin sonuna ekler; seri yoksa hemen calistirir. */
function seriyeKoy(seri, fn) {
  if (!seri) return Promise.resolve().then(fn);
  const once = _seriZincir.get(seri) || Promise.resolve();
  const p = once.then(fn);
  const son = p.then(
    () => {},
    () => {},
  );
  _seriZincir.set(seri, son);
  son.then(() => {
    if (_seriZincir.get(seri) === son) _seriZincir.delete(seri);
  });
  return p;
}

function createWarmCache({
  name,
  ttlMs = 10 * 60 * 1000,
  compute,
  log = console,
  token = null,
  maxAgeMs = 6 * 60 * 60 * 1000,
  checkMs = 5 * 60 * 1000,
  seri = null,
  now = Date.now,
}) {
  let value = null; // { at, checkedAt, ms, payload, token }
  let inflight = null;
  let checking = null;
  let sonGorulen; // son kontrolde okunan belirtec
  const bilgi = (m) => (typeof log.log === 'function' ? log.log(m) : undefined);

  async function belirtecOku() {
    return String(await token());
  }

  /** Hesap baslatir; ucusta hesap varsa ONA KATILIR (ayni soz). Ic kullanim: isitma, kontrol, ilk get. */
  function baslat() {
    if (inflight) return inflight;
    inflight = seriyeKoy(seri, async () => {
      let tk;
      if (token) {
        // Belirtec hesaptan ONCE okunur: hesap sirasindaki degisim bir sonraki kontrolde yakalanir.
        try {
          tk = await belirtecOku();
        } catch (e) {
          log.warn(`[warm:${name}] belirtec okunamadi:`, e && e.message);
        }
      }
      const t0 = now();
      const payload = await compute();
      const at = now();
      value = { at, checkedAt: at, ms: at - t0, payload, token: tk };
      if (tk !== undefined) sonGorulen = tk;
      if (value.ms > 5000) log.warn(`[warm:${name}] hesap ${value.ms} ms surdu`);
      return value;
    }).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  // TEKRAR (2026-11-13, inceleme): run() "girdi simdi degisti" demektir (Admin yazimi, eski sunucu
  // temizligi, fresh=1). Ucustaki hesap girdileri cagridan ONCE okumus olabilir; ona katilmak
  // degisikligi kaybettirir ve belirtec (Portal DB'yi gormez) bunu sonradan yakalamaz. Bu yuzden
  // ucus varken run() ucus bittikten sonra TEK ek hesap zincirler; o arada gelen run()'lar ayni
  // ek hesabi paylasir.
  let tekrar = null;
  function run() {
    if (!inflight) return baslat();
    if (tekrar) return tekrar;
    const p = inflight
      .then(
        () => {},
        () => {},
      )
      .then(() => {
        if (tekrar === p) tekrar = null;
        return baslat();
      });
    tekrar = p;
    return p;
  }

  const azamiYas = (v) => (typeof maxAgeMs === 'function' ? maxAgeMs(v && v.payload) : maxAgeMs);

  /** Belirtecli tur: gerekirse hesaplar, gerekmezse mevcut degeri doner. Belirtec yoksa run(). */
  function kontrol() {
    if (!token) return baslat();
    if (checking) return checking;
    checking = (async () => {
      if (inflight) return inflight;
      if (!value) return baslat();
      const yas = now() - value.at;
      const azami = azamiYas(value);
      let t;
      try {
        t = await belirtecOku();
      } catch (e) {
        // Belirtec okunamiyor: azami yas emniyeti yine gecerli (yoksa onbellek suresiz donardi).
        if (yas >= azami) {
          log.warn(`[warm:${name}] belirtec okunamadi, azami yas asildi, hesaplaniyor:`, e && e.message);
          return baslat();
        }
        log.warn(`[warm:${name}] belirtec okunamadi, hesap atlandi:`, e && e.message);
        return value;
      }
      if (t === value.token && yas < azami) {
        value.checkedAt = now();
        sonGorulen = t;
        return value;
      }
      if (t !== value.token && t !== sonGorulen) {
        sonGorulen = t;
        bilgi(`[warm:${name}] belirtec degisti, stabilite bekleniyor`);
        return value;
      }
      bilgi(`[warm:${name}] hesaplaniyor (${t !== value.token ? 'belirtec degisti' : 'azami yas'})`);
      return baslat();
    })().finally(() => {
      checking = null;
    });
    return checking;
  }

  function decorate(v) {
    const kontrolAt = v.checkedAt == null ? v.at : v.checkedAt;
    // stale: son KONTROL ttl'den eski (belirtec dogrulamasi gecikti). yasMs: hesabin gercek yasi;
    // belirtecin gormedigi girdiler (or. Inventory.env) bu kadar eski olabilir - ekran gosterir.
    return {
      ...v.payload,
      _cache: {
        computedAt: new Date(v.at).toISOString(),
        checkedAt: new Date(kontrolAt).toISOString(),
        yasMs: Math.max(0, now() - v.at),
        ms: v.ms,
        stale: now() - kontrolAt > ttlMs,
      },
    };
  }

  /** @param {{fresh?: boolean}} o  fresh: hesabi BEKLE (kullanici "Yenile"ye basti) */
  async function get({ fresh = false } = {}) {
    if (fresh) return decorate(await run());
    if (!value) return decorate(await baslat());
    const kontrolAt = token ? value.checkedAt : value.at;
    if (now() - kontrolAt > ttlMs) {
      Promise.resolve()
        .then(kontrol)
        .catch((e) => log.warn(`[warm:${name}] arka plan yenileme hatasi:`, e && e.message));
    }
    return decorate(value);
  }

  function warm(delayMs = 45000) {
    const araMs = token ? checkMs : ttlMs;
    setTimeout(() => {
      baslat().catch((e) => log.warn(`[warm:${name}] isitma hatasi:`, e && e.message));
      setInterval(
        () => kontrol().catch((e) => log.warn(`[warm:${name}] periyodik yenileme hatasi:`, e && e.message)),
        araMs,
      ).unref?.();
    }, delayMs).unref?.();
  }

  return { get, warm, run, kontrol, peek: () => value };
}

module.exports = { createWarmCache, _seriyeKoy: seriyeKoy };
