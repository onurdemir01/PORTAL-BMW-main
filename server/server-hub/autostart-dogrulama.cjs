// server/server-hub/autostart-dogrulama.cjs - auto-start isinin DOGRULANMIS sonucu (2026-11-14).
//
// Kullanici: "Ayrinti -> JVM -> Auto-Start Kapat/Ac tuslari cok yavas calisiyor, calisip
// calismadiklarindan da emin olamiyorum".
//
// SEBEP: server_hub_fix isi auto-start'i jboss-cli ile yazar ve GERI OKUYARAK dogrular
// (RESULT ... OK), ama dbo.Server_Hub_Jvms'e YAZMAZ. Ekran degeri yalniz taramadan okudugu icin
// basarili isten sonra bile eski deger ("acik" + "Kapat" dugmesi) gorunuyordu; ikinci tik ayni
// isi yeniden aciyor, betik SKIP donuyor, ekran yine "kapatildi" diyordu.
//
// BU KATMAN: Portal'in KENDI baslattigi auto-start isi (serverId:jobId -> host/gen/jvm/hedef)
// bellekte tutulur. Is 'successful' biter VE set_stats sonucu ayni eylem icin OK ya da SKIP
// derse (betik CLI ile geri okudu) o JVM'in auto-start'i HEDEF degerle "dogrulandi" isaretlenir.
// /host yaniti, /findings (bulgunun duzeltme dugmesi) ve /jvm-autostart "zaten" kapisi bu degeri
// kullanir. Is acildiktan sonra yeni bir tarama yuklenince (loaded_at artti) tarama yeniden tek
// kaynak olur; en gec 24 saat.
//
// SAAT TABANI (inceleme 2026-11-14): loaded_at DB'de SYSDATETIME() (yerel saat, UTC+3) ile yazilir;
// surucu (useUTC varsayilani) onu UTC sanar, h.loadedAt gercekten ~3 saat ILERI gelir. Bu yuzden
// loaded_at ASLA duvar saatiyle (Date.now) karsilastirilmaz: is acilirkenki loaded_at saklanir ve
// yalniz onunla karsilastirilir (ayni saat tabani, ofset onemsiz).
//
// SUREN IS KILIDI: ayni host|gen|jvm icin terminal olmamis kayitli is varsa (ya da su an baslatiliyorsa)
// cagiran yeni is ACMAZ (iki kullanici / iki sekme zit yonde is acamasin; dogrulanan deger son biten
// isi gostersin). Kilit is terminal olunca (job-status) ya da cagiranin AWX kontrolunde biter.
//
// SINIRLAR: yalniz bellek (Portal yeniden baslarsa katman bosalir -> eski davranis: tarama
// degeri). Baskasinin AWX'ten elle kosturdugu is buraya girmez. FAIL/PLAN hicbir seyi
// degistirmez. Kayit sayisi sinirli (en eskisi atilir).
'use strict';

const IS_MAX = 500;
const DOGRULANAN_MAX = 2000;
const TTL_MS = 24 * 60 * 60 * 1000;
const AUTOSTART_EYLEMLERI = new Set(['jboss_autostart_on', 'jboss_autostart_off']);

/** RESULT\t<action>\t<OK|SKIP|FAIL|PLAN>\t<mesaj> -> { action, durum, mesaj } ya da null. */
function sonucSatiri(line) {
  const p = String(line || '').split('\t');
  if (p[0] !== 'RESULT' || p.length < 3) return null;
  return { action: p[1] || '', durum: String(p[2] || '').toUpperCase(), mesaj: p.slice(3).join(' ').trim() };
}

const dogruMu = (v) => v === true || String(v).toLowerCase() === 'true';
const sayiMi = (x) => typeof x === 'number' && Number.isFinite(x);

function kur({ simdi = Date.now } = {}) {
  const isler = new Map();
  const dogrulanan = new Map();
  const rezerve = new Set();
  const anahtar = (host, gen, jvm) =>
    `${String(host || '').toUpperCase()}|${Number(gen)}|${String(jvm || '').trim().toLowerCase()}`;
  const sinirla = (m, max) => {
    while (m.size > max) m.delete(m.keys().next().value);
  };

  /** Portal'in baslattigi auto-start isi. h: is acilirken degerlendirmedeki sunucu (tarama damgasi). */
  function isKaydet(serverId, jobId, { host, gen, jvm, action, h }) {
    if (jobId == null || !AUTOSTART_EYLEMLERI.has(action)) return;
    isler.set(`${Number(serverId)}:${Number(jobId)}`, {
      host: String(host || '').toUpperCase(),
      gen: Number(gen),
      jvm: String(jvm || ''),
      action,
      hedef: action === 'jboss_autostart_on' ? 'true' : 'false',
      scanDate: (h && h.scanDate) || null,
      loadedAt: h && sayiMi(h.loadedAt) ? h.loadedAt : null,
      at: simdi(),
    });
    sinirla(isler, IS_MAX);
  }

  /**
   * Is terminal oldu. Donus: { kayitli } (bu katmanin isi mi), dogrulandiysa { deger, durum, mesaj }.
   * Is bir kez islenir (kayit silinir).
   */
  function isBitti(serverId, jobId, status, result) {
    const k = `${Number(serverId)}:${Number(jobId)}`;
    const m = isler.get(k);
    if (!m) return { kayitli: false };
    isler.delete(k);
    const r = result && typeof result === 'object' ? result : null;
    const s = sonucSatiri(r && r.line);
    const tamam =
      status === 'successful' &&
      !!r &&
      r.action === m.action &&
      !dogruMu(r.plan_only) &&
      !!s &&
      s.action === m.action &&
      (s.durum === 'OK' || s.durum === 'SKIP');
    if (!tamam) return { kayitli: true, dogrulandi: false, durum: s ? s.durum : null, mesaj: s ? s.mesaj : '' };
    const ak = anahtar(m.host, m.gen, m.jvm);
    dogrulanan.delete(ak);
    dogrulanan.set(ak, {
      autoStart: m.hedef,
      jobId: Number(jobId),
      at: simdi(),
      scanDate: m.scanDate,
      loadedAt: m.loadedAt,
    });
    sinirla(dogrulanan, DOGRULANAN_MAX);
    return { kayitli: true, dogrulandi: true, deger: m.hedef, durum: s.durum, mesaj: s.mesaj };
  }

  /** Bu JVM icin GECERLI dogrulanmis deger (yoksa null). h: guncel degerlendirmedeki sunucu. */
  function gecerli(h, j) {
    if (!h || !j || dogrulanan.size === 0) return null;
    const ak = anahtar(h.host, j.gen, j.name);
    const d = dogrulanan.get(ak);
    if (!d) return null;
    // Is acildiktan SONRA yeni tarama yuklendiyse tarama tek kaynak. loaded_at yalniz loaded_at ile
    // karsilastirilir (bkz. SAAT TABANI). Is acilirken loaded_at yoktu ama simdi var: yeni yukleyici
    // yeni tarama yazdi. Ikisi de yoksa (eski satir) tarama gunu.
    const yeniTarama = sayiMi(h.loadedAt)
      ? d.loadedAt == null || h.loadedAt > d.loadedAt
      : (h.scanDate || null) !== d.scanDate;
    if (yeniTarama || simdi() - d.at > TTL_MS) {
      dogrulanan.delete(ak);
      return null;
    }
    return d;
  }

  const dogrulamaBilgisi = (d) => ({ jobId: d.jobId, at: new Date(d.at).toISOString() });

  /** JVM satirina katman: autoStart dogrulanmis deger, autoStartTarama taramadaki deger. */
  function uygulaJvm(h, j) {
    const d = gecerli(h, j);
    if (!d) return j;
    if (d.autoStart === j.autoStart) return { ...j, autoStartDogrulama: dogrulamaBilgisi(d) };
    return {
      ...j,
      autoStart: d.autoStart,
      autoStartTarama: j.autoStart,
      autoStartDogrulama: dogrulamaBilgisi(d),
    };
  }

  /**
   * Bulguya katman: auto-start duzeltmesi oneren bulgu, o JVM'de ayni hedef DOGRULANDIYSA duzeltme
   * dugmesini kaybeder (fix: null) ve autoStartDogrulama tasir. Bulgu kendisi kalir (tarama gelene kadar
   * kanit tarama); ekran "is #N ile dogrulandi - tarama bekleniyor" der. Eskiden ayni pencerede JVM
   * sekmesi "acik" derken Bulgular "AC" dugmesi gosteriyor, tik 400 "zaten" donuyordu.
   */
  function uygulaBulgu(h, f) {
    if (!f || !f.fix || !AUTOSTART_EYLEMLERI.has(f.fix.action) || dogrulanan.size === 0) return f;
    const d = gecerli(h, { gen: f.fix.gen, name: f.fix.jvm });
    const hedef = f.fix.action === 'jboss_autostart_on' ? 'true' : 'false';
    if (!d || d.autoStart !== hedef) return f;
    return { ...f, fix: null, ...('fixable' in f ? { fixable: false } : {}), autoStartDogrulama: dogrulamaBilgisi(d) };
  }

  /** Bu JVM icin suren (terminal olmamis) kayitli is ya da su an baslatilan is; yoksa null. */
  function surenIs(host, gen, jvm) {
    const ak = anahtar(host, gen, jvm);
    if (rezerve.has(ak)) return { baslatiliyor: true, serverId: null, jobId: null };
    for (const [k, m] of isler) {
      if (anahtar(m.host, m.gen, m.jvm) !== ak) continue;
      const [serverId, jobId] = k.split(':').map(Number);
      return { baslatiliyor: false, serverId, jobId, action: m.action };
    }
    return null;
  }

  /** Is baslatilirken (launch suresince) ayni JVM'e ikinci istek gelmesin. Donus: birak(). */
  function rezervasyon(host, gen, jvm) {
    const ak = anahtar(host, gen, jvm);
    rezerve.add(ak);
    return () => rezerve.delete(ak);
  }

  return {
    isKaydet,
    isBitti,
    gecerli,
    uygulaJvm,
    uygulaBulgu,
    surenIs,
    rezervasyon,
    _boyut: () => ({ isler: isler.size, dogrulanan: dogrulanan.size, rezerve: rezerve.size }),
  };
}

module.exports = { kur, sonucSatiri, AUTOSTART_EYLEMLERI, TTL_MS };
