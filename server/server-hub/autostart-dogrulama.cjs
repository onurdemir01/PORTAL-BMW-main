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
// TOPLU IS (2026-11-14, Toplu Auto-Start sekmesi, toplu-autostart.cjs): bir host isi BIRDEN COK JVM tasir
// (action jboss_autostart_items, set_stats items[]). Ayri haritada tutulur ("serverId:jobId" -> tek JVM sozlesmesi
// bozulmaz); surenIs iki haritayi da tarar (tek satir dugmesi toplu isin calisan JVM'ini 409 ile reddeder).
// Ogenin dogrulanmasi isin GENEL durumuna bagli DEGIL: baska bir oge FAIL olunca is 'failed' biter ama bu
// ogenin satiri OK/SKIP ise betik CLI ile geri okumustur (ogeSonuclari).
//
// SINIRLAR: yalniz bellek (Portal yeniden baslarsa katman bosalir -> eski davranis: tarama
// degeri). Baskasinin AWX'ten elle kosturdugu is buraya girmez. FAIL/PLAN hicbir seyi
// degistirmez. Kayit sayisi sinirli (en eskisi atilir).
'use strict';

const IS_MAX = 500;
const DOGRULANAN_MAX = 2000;
const TTL_MS = 24 * 60 * 60 * 1000;
const AUTOSTART_EYLEMLERI = new Set(['jboss_autostart_on', 'jboss_autostart_off']);
// DOMAIN KAPALIYKEN HOST XML (2026-11-15, kullanici: "Tek tek, bilincli kullanim icin XML yolu ... bunlar yanlis
// retire edilmis uygulamalar o yuzden auto-start'lari kapatilmali"). server_hub_fix.sh jboss_autostart_xml_off: YALNIZ
// host controller calismiyorken, YALNIZ true -> false, host XML'e yazar ve geri okur. Tek host, bir ya da birden cok
// JVM (ayni nesil); set_stats items[] Toplu Auto-Start ile ayni sekil. Toplu Auto-Start'ta ayri bolum (2026-11-15:
// "Domain kapali (host XML)", toplu-autostart.cjs; tek toplu iste CLI ogeleriyle karismaz).
const XML_KAPAT_EYLEMI = 'jboss_autostart_xml_off';
const XML_KAPAT_MAX = 200;
/** Eylemin yazdigi auto-start degeri ('true' | 'false'); auto-start eylemi degilse null. */
const hedefOf = (action) =>
  action === 'jboss_autostart_on' ? 'true' : action === 'jboss_autostart_off' || action === XML_KAPAT_EYLEMI ? 'false' : null;

/** RESULT\t<action>\t<OK|SKIP|FAIL|PLAN>\t<mesaj> -> { action, durum, mesaj } ya da null. */
function sonucSatiri(line) {
  const p = String(line || '').split('\t');
  if (p[0] !== 'RESULT' || p.length < 3) return null;
  return { action: p[1] || '', durum: String(p[2] || '').toUpperCase(), mesaj: p.slice(3).join(' ').trim() };
}

const dogruMu = (v) => v === true || String(v).toLowerCase() === 'true';
const sayiMi = (x) => typeof x === 'number' && Number.isFinite(x);
const LISTE_EYLEMI = 'jboss_autostart_items';
const jvmAnahtari = (gen, jvm) => `${Number(gen)}|${String(jvm || '').trim().toLowerCase()}`;

/**
 * Toplu (liste kipi) isin set_stats sonucunu ogelere esler. items: [{gen, jvm, action}].
 * Donus: ayni sirada [{gen, jvm, action, durum: OK|SKIP|FAIL|PLAN|null, mesaj, dogrulandi}].
 * dogrulandi: uygulama kipi (plan degil) + ayni eylem + OK|SKIP. Satiri olmayan oge durum null.
 */
function ogeSonuclari(items, result) {
  const r = result && typeof result === 'object' ? result : null;
  const listeMi = !!r && (r.action === LISTE_EYLEMI || r.action === XML_KAPAT_EYLEMI) && Array.isArray(r.items);
  const plan = !r || dogruMu(r.plan_only);
  const satirlar = new Map();
  if (listeMi)
    for (const x of r.items)
      if (x && typeof x === 'object') satirlar.set(`${jvmAnahtari(x.gen, x.jvm)}|${String(x.action || '')}`, x);
  return (items || []).map((m) => {
    const x = satirlar.get(`${jvmAnahtari(m.gen, m.jvm)}|${m.action}`);
    const s = x ? sonucSatiri(x.line) : null;
    const durum = s && s.action === m.action ? s.durum : null;
    return {
      gen: Number(m.gen),
      jvm: String(m.jvm || ''),
      action: m.action,
      durum,
      mesaj: s ? s.mesaj : '',
      dogrulandi: !plan && (durum === 'OK' || durum === 'SKIP'),
    };
  });
}

/**
 * Sunucu duzeyi yazma kapisi (/jvm-autostart ve Toplu Auto-Start AYNI fonksiyon): sema okunamadi ya da bayat /
 * son yuklemede disarida kalan sunucuda auto-start degistirilmez. Donus: null ya da { status, message }.
 */
function sunucuYazmaKapisi(a, h, host) {
  if ((a && a.schemaUnknown === true) || (h && h.schemaUnknown === true))
    return {
      status: 400,
      message:
        'Server Hub şeması (sys.columns) okunamadı — eylem önerilmez; auto-start değiştirilemez, iş açılmadı. Sayfayı yenileyin.',
    };
  if (!h || h.fresh !== true)
    return {
      status: 400,
      message: `${host} taraması bayat (bayat kanıt: ${(h && h.scanDate) || '?'}${h && h.loadExcluded ? ', son yükleme dışlandı' : ''}) — auto-start değiştirilemez, iş açılmadı. Önce sunucuyu yeniden tarayın.`,
    };
  return null;
}

/**
 * JVM duzeyi auto-start kapisi (/jvm-autostart ve Toplu Auto-Start AYNI fonksiyon). j: dogrulama katmani
 * uygulanmis JVM (uygulaJvm). Donus: null ya da { status, message }.
 */
function jvmAutoStartKapisi(j, { host, jvm, gen, enable }) {
  if (!j)
    return { status: 400, message: `${host} üzerinde ${jvm} (JBoss ${gen}) taramada yok — sayfayı yenileyin.` };
  // YALNIZ ENVANTERDE (2026-11-14): MWAppsInventory satiri, taramada JVM'i yok (gen 0). Playbook'un
  // degistirecegi bir JVM tanimi bilinmiyor: is ACILMAZ.
  if (j.yalnizEnvanter === true || j.source === 'envanter')
    return {
      status: 400,
      message: `${host} üzerinde ${jvm} yalnız envanterde (MWAppsInventory) — taramada JVM'i yok, auto-start değiştirilemez; iş açılmadı.`,
    };
  // TANIMSIZ SUREC (EK-6.7, tur 3 #8): cfg_src=UNAVAILABLE JVM tanim kaynaginda YOK;
  // auto-start'i olmayan bir sey degistirilemez (playbook da host XML'de bulamaz).
  if (j.source === 'cli' && j.cfgSrc === 'UNAVAILABLE')
    return {
      status: 400,
      message: `${jvm} (JBoss ${gen}) tanım kaynağında yok (ps'te tanımsız süreç) — auto-start değiştirilemez, iş açılmadı.`,
    };
  // DOMAIN KAPALI (2026-11-15, uretim GBBFAA01 "Connection refused :9990"): taramada host controller
  // calismiyordu (assess hcKapali -> j.domainKapali). Betik auto-start'i yalniz calisan host controller
  // uzerinden okur / yazar; is acilsa "host controller'a baglanilamadi" ile duserdi. Iki yon de kapali.
  if (j.domainKapali === true)
    return {
      status: 400,
      message: `JBoss ${gen} domain kapalı (taramada host controller çalışmıyordu) — auto-start canlı okunamaz; iş açılmaz. Domain sonradan açıldıysa önce sunucuyu yeniden tarayın.`,
    };
  // ZATEN ISTENEN DURUMDAYSA IS ACILMAZ. "unknown" ise ACILIR: olculemedigi icin
  // kullanici bilerek bir tarafa cekmek isteyebilir.
  const hedef = enable ? 'true' : 'false';
  if (j.autoStart === hedef)
    return {
      status: 400,
      message: `${jvm} zaten auto-start ${enable ? 'AÇIK' : 'KAPALI'} görünüyor${j.autoStartDogrulama ? ` (iş #${j.autoStartDogrulama.jobId} ile doğrulandı)` : ''} — iş açılmadı.`,
    };
  // CALISAN JVM'DE KAPAT (2026-11-14, A2): server_hub_fix.sh calisan JVM'in auto-start'ini FORCE olmadan
  // KAPATMAZ (FAIL "su an CALISIYOR"); Portal force gondermez. Calisma durumu OLCULEMEYEN JVM
  // (runningKnown=false) kapi DEGIL (v3: dugme admine acik; betik canli durumu kendisi kontrol eder).
  if (!enable && j.running === true && j.runningKnown !== false)
    return {
      status: 400,
      message: `${jvm} son taramada ÇALIŞIYOR — çalışan JVM'in auto-start'ı kapatılmaz (betik reddeder); iş açılmadı. Önce JVM'i durdurun, sonra sunucuyu yeniden tarayın.`,
    };
  return null;
}

/**
 * HOST XML ile auto-start KAPAT kapisi (2026-11-15, /jvm-autostart-xml). j: dogrulama katmani uygulanmis JVM.
 * YALNIZ domain kapali (j.domainKapali, taramada host controller calismiyordu) + durmus + auto-start true JVM.
 * Calisan domain'de ASLA (orada CLI yolu gecerli; calisan host controller dosyayi kendi modeliyle ezer).
 * Donus: null ya da { status, message }.
 */
function xmlKapatKapisi(j, { host, jvm, gen }) {
  if (!j)
    return { status: 400, message: `${host} üzerinde ${jvm} (JBoss ${gen}) taramada yok — sayfayı yenileyin; iş açılmadı.` };
  if (j.yalnizEnvanter === true || j.source === 'envanter')
    return {
      status: 400,
      message: `${host} üzerinde ${jvm} yalnız envanterde (MWAppsInventory) — host XML'de tanımı bilinmiyor; iş açılmadı.`,
    };
  if (j.domainKapali !== true)
    return {
      status: 400,
      message: `${jvm} (JBoss ${gen}) domain'i kapalı görünmüyor (taramada host controller çalışıyordu ya da ölçülemedi) — host XML yolu yalnız domain kapalıyken açılır; çalışan domain'de satırdaki Auto-start Kapat'ı kullanın; iş açılmadı.`,
    };
  // Inceleme 2026-11-15 (F6): arayuz (xmlKapatilabilir) gibi KAYNAKTAN BAGIMSIZ - tanim kaynaginda olmayan JVM'in
  // host XML'de degistirilecek <server> tanimi yoktur (betik de 'tanimli degil' FAIL verirdi).
  if (String(j.cfgSrc || '').toUpperCase() === 'UNAVAILABLE')
    return { status: 400, message: `${jvm} (JBoss ${gen}) tanım kaynağında yok — host XML'de değiştirilecek tanım yok; iş açılmadı.` };
  if (j.runningKnown === false)
    return {
      status: 400,
      message: `${jvm} çalışma durumu ölçülemedi — host XML yolu yalnız durmuş olduğu ölçülen JVM'de açılır; iş açılmadı.`,
    };
  if (j.running === true)
    return {
      status: 400,
      message: `${jvm} son taramada ÇALIŞIYOR — host XML yolu yalnız durmuş JVM için; iş açılmadı.`,
    };
  if (j.autoStart === 'false')
    return {
      status: 400,
      message: `${jvm} zaten auto-start KAPALI görünüyor${j.autoStartDogrulama ? ` (iş #${j.autoStartDogrulama.jobId} ile doğrulandı)` : ''} — iş açılmadı.`,
    };
  if (j.autoStart !== 'true')
    return { status: 400, message: `${jvm} auto-start değeri taramada bilinmiyor — host XML yolu açılmaz; iş açılmadı.` };
  return null;
}

function kur({ simdi = Date.now } = {}) {
  const isler = new Map();
  const topluIsler = new Map();
  const dogrulanan = new Map();
  const rezerve = new Set();
  // HOST XML ISI sunucu + nesil basina TEK (inceleme 2026-11-15 F1/F2): ayni host XML dosyasini iki is ayni anda
  // yazmasin. JVM kilidi yetmez (domain dugmesi {A,B} surerken satir dugmesi C ayni dosyayi yazardi) ve JVM basina
  // await'li kilit dongusu iki istegi araya sokabilirdi; bu rezervasyon istegin EN BASINDA, await'ten once alinir.
  const rezerveXml = new Set();
  const xmlAnahtar = (host, gen) => `${String(host || '').toUpperCase()}|${Number(gen)}`;
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

  /** Toplu (liste kipi) host isi: items [{gen, jvm, action}]; h: is acilirkenki sunucu (tarama damgasi). */
  function isKaydetToplu(serverId, jobId, { host, h, items }) {
    if (jobId == null) return;
    const liste = (items || []).filter((x) => x && hedefOf(x.action) != null);
    if (!liste.length) return;
    topluIsler.set(`${Number(serverId)}:${Number(jobId)}`, {
      host: String(host || '').toUpperCase(),
      items: liste.map((x) => ({ gen: Number(x.gen), jvm: String(x.jvm || ''), action: x.action })),
      scanDate: (h && h.scanDate) || null,
      loadedAt: h && sayiMi(h.loadedAt) ? h.loadedAt : null,
      at: simdi(),
    });
    sinirla(topluIsler, IS_MAX);
  }

  function dogrulandiYaz(host, gen, jvm, hedef, jobId, scanDate, loadedAt) {
    const ak = anahtar(host, gen, jvm);
    dogrulanan.delete(ak);
    dogrulanan.set(ak, { autoStart: hedef, jobId: Number(jobId), at: simdi(), scanDate, loadedAt });
    sinirla(dogrulanan, DOGRULANAN_MAX);
  }

  /**
   * Is terminal oldu. Donus: { kayitli } (bu katmanin isi mi), dogrulandiysa { deger, durum, mesaj }.
   * Toplu iste { kayitli, toplu: true, host, ogeler: ogeSonuclari(...) }. Is bir kez islenir (kayit silinir).
   */
  function isBitti(serverId, jobId, status, result) {
    const k = `${Number(serverId)}:${Number(jobId)}`;
    const t = topluIsler.get(k);
    if (t) {
      topluIsler.delete(k);
      const ogeler = ogeSonuclari(t.items, result);
      for (const o of ogeler)
        if (o.dogrulandi)
          dogrulandiYaz(t.host, o.gen, o.jvm, hedefOf(o.action), jobId, t.scanDate, t.loadedAt);
      return { kayitli: true, toplu: true, host: t.host, ogeler };
    }
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
    dogrulandiYaz(m.host, m.gen, m.jvm, m.hedef, jobId, m.scanDate, m.loadedAt);
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
    if (f && f.code === 'JBOSS_DOMAIN_DOWN') return domainBulgusu(h, f);
    if (!f || !f.fix || !AUTOSTART_EYLEMLERI.has(f.fix.action) || dogrulanan.size === 0) return f;
    const d = gecerli(h, { gen: f.fix.gen, name: f.fix.jvm });
    const hedef = f.fix.action === 'jboss_autostart_on' ? 'true' : 'false';
    if (!d || d.autoStart !== hedef) return f;
    return { ...f, fix: null, ...('fixable' in f ? { fixable: false } : {}), autoStartDogrulama: dogrulamaBilgisi(d) };
  }

  /**
   * JBOSS_DOMAIN_DOWN (2026-11-15): host XML isi (ya da baska auto-start isi) o domain'in JVM'lerinde auto-start'i
   * dogruladiysa bulgu metni / autoStartAcik dogrulanmis degerle yeniden kurulur (assess ile AYNI fonksiyon,
   * assess.cjs domainKapaliOzeti). Hepsi false olduysa seviye bilgi (reboot'ta acilacak JVM yok) - Admin seviye
   * degistirdiyse (adminSeviye) o gecerli. Sunucu durumu / sayaclar tarama gelene kadar degismez.
   */
  function domainBulgusu(h, f) {
    if (dogrulanan.size === 0 || !h || !Array.isArray(h.jvms)) return f;
    const nj = h.jvms
      .filter((j) => j && j.domainKapali === true && Number(j.gen) === Number(f.gen))
      .map((j) => uygulaJvm(h, j));
    const son = nj
      .map((j) => j.autoStartDogrulama)
      .filter(Boolean)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    if (!son) return f;
    const oz = require('./assess.cjs').domainKapaliOzeti(f.gen, nj);
    if (oz.text === f.text && oz.autoStartAcik === f.autoStartAcik) return f;
    const g = { ...f, text: oz.text, autoStartAcik: oz.autoStartAcik, autoStartDogrulama: son };
    if (oz.hepsiKapali && f.adminSeviye !== true) {
      g.severity = 'info';
      delete g.defaultSeverity;
      delete g.ortamTavani;
      delete g.prodSeverity;
    }
    return g;
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
    for (const [k, t] of topluIsler) {
      const o = t.items.find((x) => anahtar(t.host, x.gen, x.jvm) === ak);
      if (!o) continue;
      const [serverId, jobId] = k.split(':').map(Number);
      return { baslatiliyor: false, serverId, jobId, action: o.action, toplu: true };
    }
    return null;
  }

  /** Bu sunucu + nesilde terminal olmamis kayitli host XML isi (ilk ogesinin JVM'i ile); yoksa null. */
  function xmlSurenIs(host, gen) {
    const ak = xmlAnahtar(host, gen);
    for (const [k, t] of topluIsler) {
      const o = t.items.find((x) => x.action === XML_KAPAT_EYLEMI && xmlAnahtar(t.host, x.gen) === ak);
      if (!o) continue;
      const [serverId, jobId] = k.split(':').map(Number);
      return { serverId, jobId, jvm: o.jvm };
    }
    return null;
  }

  /** Host XML istegi icin sunucu + nesil rezervasyonu (senkron). Doluysa null, degilse birak(). */
  function xmlRezervasyon(host, gen) {
    const ak = xmlAnahtar(host, gen);
    if (rezerveXml.has(ak)) return null;
    rezerveXml.add(ak);
    return () => rezerveXml.delete(ak);
  }

  /** Is baslatilirken (launch suresince) ayni JVM'e ikinci istek gelmesin. Donus: birak(). */
  function rezervasyon(host, gen, jvm) {
    const ak = anahtar(host, gen, jvm);
    rezerve.add(ak);
    return () => rezerve.delete(ak);
  }

  return {
    isKaydet,
    isKaydetToplu,
    isBitti,
    gecerli,
    uygulaJvm,
    uygulaBulgu,
    surenIs,
    rezervasyon,
    xmlSurenIs,
    xmlRezervasyon,
    _boyut: () => ({ isler: isler.size, topluIsler: topluIsler.size, dogrulanan: dogrulanan.size, rezerve: rezerve.size, rezerveXml: rezerveXml.size }),
  };
}

module.exports = {
  kur,
  sonucSatiri,
  ogeSonuclari,
  sunucuYazmaKapisi,
  jvmAutoStartKapisi,
  xmlKapatKapisi,
  hedefOf,
  AUTOSTART_EYLEMLERI,
  LISTE_EYLEMI,
  XML_KAPAT_EYLEMI,
  XML_KAPAT_MAX,
  TTL_MS,
};
