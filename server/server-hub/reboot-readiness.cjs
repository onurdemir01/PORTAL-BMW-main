// server/server-hub/reboot-readiness.cjs — "Bu sunucular sorunsuz acilir mi?" (2026-10-01)
//
// Kullanici: "Ben sana sunucu listesi verdigimde o sunucularin sorunsuz acilip
// acilmayacagini bana bir executive summary gibi vermeni istiyorum."
//
// SORU "SORUN VAR MI" DEGIL, "YENIDEN BASLATSAM GERI GELIR MI". Server Hub'in bulgulari
// arasinda bu soruyla ILGILI olanlar azinliktadir; gerisi (atil vhost, SSH oturum tavani,
// envanter uyusmazligi) yeniden baslatmayi etkilemez ve ozeti kalabaliklastirirdi.
//
// EN ONEMLI KURAL: TARANMAMIS SUNUCU "SORUNSUZ" DEGILDIR.
// Bu modulun tamami taranmis veriye dayanir. Listedeki bir sunucu taramada yoksa verilecek
// tek durust cevap "bilmiyorum"dur - onu "hazir" saymak, bu raporun verebilecegi en pahali
// yanlis olurdu (kullanici o sunucuyu guvenle yeniden baslatir ve geri gelmez).
'use strict';

const U = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toUpperCase();

/**
 * Bulgu kodu -> yeniden baslatma anlami.
 *
 *   blocker : yeniden baslatinca GERI GELMEZ ya da servis ACILMAZ
 *   risk    : acilir ama BEKLENMEYEN bir sey olur
 *   unknown : OLCULEMEDI - "sorun yok" demek DEGIL
 *
 * Listede OLMAYAN kodlar bilerek yok sayilir: yeniden baslatmayla ilgileri yoktur.
 */
const KOD_ANLAMI = Object.freeze({
  // Web sunucusu sozdizimi bozuksa servis ACILMAZ - yeniden baslatmanin en net engeli.
  SYNTAX_FAIL: { tip: 'blocker', aciklama: 'web sunucusu sözdizimi hatalı — servis açılmaz' },
  // JVM kosuyor ama auto-start KAPALI: makine kapanirsa uygulama GERI GELMEZ.
  REBOOT_RISK: { tip: 'blocker', aciklama: 'JVM çalışıyor ama auto-start kapalı — geri gelmez' },
  // Init script yoksa servis acilisi tanimsiz.
  INIT_MISSING: { tip: 'blocker', aciklama: 'init script eksik — servis açılışı tanımsız' },
  // JVM kapali ama auto-start ACIK: acilista kendiliginden kalkar. Bilerek durdurulmus
  // olabilir - engel degil ama SURPRIZ.
  STOPPED_AUTOSTART_ON: {
    tip: 'risk',
    aciklama: 'JVM kapalı ama auto-start açık — açılışta kendiliğinden kalkar',
  },
  INIT_DIFF: { tip: 'risk', aciklama: 'init script referanstan farklı' },
  RESTART_REQUIRED: { tip: 'risk', aciklama: 'JVM yeniden başlatma bekliyor (server-state)' },
  // OLCULEMEYENLER: "sorun yok" DEGIL.
  SYNTAX_UNKNOWN: { tip: 'unknown', aciklama: 'web sözdizimi ölçülemedi' },
  SYNTAX_UNVERIFIED: {
    tip: 'unknown',
    aciklama: 'web sözdizimi doğrulanamadı (dosya erişimi) — açılış belirsiz',
  },
  // "okunamadi" DEGIL "bilinmiyor": sebeplerden biri (tanimsiz-surec) okuma hatasi degildir.
  AUTOSTART_UNKNOWN: { tip: 'unknown', aciklama: 'JVM auto-start durumu bilinmiyor' },
  CLI_FAIL: { tip: 'unknown', aciklama: 'JBoss CLI okunamadı' },
  CLI_SKIP: { tip: 'unknown', aciklama: 'JBoss CLI hiç çalıştırılamadı (kurulum/süreç)' },
  CLI_DENIED: { tip: 'unknown', aciklama: 'JBoss CLI yetki reddi (dzdo kuralı eksik)' },
  // ── SOZLESME v3 (dalga 1): olculemeyen her sey "sorun yok" DEGIL ──
  RUNNING_UNMEASURED: {
    tip: 'unknown',
    aciklama: 'JVM çalışma durumu ölçülemedi (hidepid / ps körlüğü)',
  },
  INIT_UNREADABLE: { tip: 'unknown', aciklama: 'init script okunamadı — var/yok bilinmiyor' },
  LOAD_EXCLUDED: {
    tip: 'unknown',
    aciklama: 'son tarama yüklenemedi — gösterilen veri eski yükleme',
  },
  JVM_DATA_MISSING: { tip: 'unknown', aciklama: 'JBoss var ama JVM verisi gelmedi' },
  JVM_INVENTORY_UNMEASURED: {
    tip: 'unknown',
    aciklama: 'tanımlı JVM envanteri ölçülemedi — durmuş JVM listede olmayabilir',
  },
  // T2-C2 (cfg_src=UNAVAILABLE): tanim kaynagi OKUNDU, calisan JVM orada tanimli degil. Liste
  // eksik iddiasi YOK; bilinmeyen, bu surecin reboot'ta kimin tarafindan acilacagidir.
  JVM_UNDEFINED_PROCESS: {
    tip: 'unknown',
    aciklama: "çalışan JVM tanım kaynağında yok (ps'te tanımsız süreç) — reboot sonrası açılışı belirsiz",
  },
  // Yalniz zaman butcesi (deadline) bir fazi atlattiysa olculemedi; yalniz sigorta (fuse)
  // kesmesi acilisi etkilemez (vhost envanteri).
  SCAN_PARTIAL: {
    tip: 'unknown',
    aciklama: 'tarama zaman bütçesine takıldı — bazı fazlar ölçülmedi',
    kosul: (f) => f.deadline === true,
  },
  // EK-5: varligi olculemeyen web urunu ve envanterde olup taramanin goremedigi urun
  WEB_PRESENCE_UNKNOWN: {
    tip: 'unknown',
    aciklama: 'web ürününün varlığı ölçülemedi (yetki/dzdo)',
  },
  PRODUCT_NOT_SCANNED: {
    tip: 'unknown',
    aciklama: 'envanterdeki ürün taramada görülemedi',
  },
});

/**
 * BAYAT KANIT (sozlesme v3 EK-2): taze olmayan (bayat ya da son yuklemede disarida kalan)
 * sunucunun kovasi `unknown`dur - eski bir taramanin engeli de temizligi de bugunu anlatmaz.
 * Sunucu nesnesinde `fresh` alani yoksa (eski cagiranlar) taze sayilir.
 */
const BAYAT = Object.freeze({
  code: 'STALE_EVIDENCE',
  tip: 'unknown',
  aciklama: 'tarama bayat ya da son yükleme dışlandı — güncel durum bilinmiyor',
});

/**
 * SEMA BILINMIYOR (C3): Portal Server Hub kolon listesini (sys.columns) okuyamadi; v3
 * kanitlari (running_src, vhost_trust, scan_errors, LoadIssues izi) hic secilmedi. Eski
 * kolonlarla verilecek "ok" ya da "risk" kanitsizdir - kova `unknown`.
 */
const SEMA = Object.freeze({
  code: 'SCHEMA_UNKNOWN',
  tip: 'unknown',
  aciklama: 'Server Hub şeması okunamadı — güncel durum bilinmiyor',
});

const DURUM_SIRASI = ['blocked', 'unknown', 'risk', 'ok', 'notScanned'];

/**
 * @param {object[]} hosts     assess() ciktisindaki taranmis sunucular
 * @param {string[]} istenen   kullanicinin verdigi sunucu adlari (kisa ad, buyuk harf)
 * @param {string|null} latestScan
 */
function rebootReadiness(hosts, istenen, latestScan = null) {
  const byHost = new Map((hosts || []).map((h) => [U(h.host), h]));
  const liste = [...new Set((istenen || []).map(U).filter(Boolean))].sort();

  const satirlar = liste.map((host) => {
    const h = byHost.get(host);
    if (!h) {
      // TARANMAMIS = BILINMIYOR. Bu satir "hazir" kovasina ASLA girmez.
      return {
        host,
        verdict: 'notScanned',
        scanDate: null,
        reasons: [],
        note: 'Bu sunucu taramada yok — açılıp açılmayacağı hakkında bir şey söylenemez.',
      };
    }
    const reasons = [];
    for (const f of h.findings || []) {
      const anlam = KOD_ANLAMI[f.code];
      if (!anlam) continue;
      if (typeof anlam.kosul === 'function' && !anlam.kosul(f)) continue;
      reasons.push({
        code: f.code,
        tip: anlam.tip,
        aciklama: anlam.aciklama,
        text: f.text || '',
        area: f.area || null,
      });
    }
    const bayat = h.fresh === false;
    if (bayat)
      reasons.push({
        code: BAYAT.code,
        tip: BAYAT.tip,
        aciklama: BAYAT.aciklama,
        text: `son tarama ${h.scanDate || '?'}`,
        area: 'scan',
      });
    const sema = h.schemaUnknown === true;
    if (sema)
      reasons.push({
        code: SEMA.code,
        tip: SEMA.tip,
        aciklama: SEMA.aciklama,
        text: 'sys.columns okunamadı',
        area: 'scan',
      });
    const varMi = (t) => reasons.some((r) => r.tip === t);
    // SIRA ONEMLI: engel > olculemedi > risk. Olculemeyeni "risk"in altina koymak,
    // bilmedigimiz bir seyi bildigimiz bir seyden daha masum gostermek olurdu.
    // BAYAT sunucu engel/risk/hazir DEGIL, olculemedidir (EK-2); sema bilinmiyorsa da (C3).
    const verdict = bayat || sema
      ? 'unknown'
      : varMi('blocker')
        ? 'blocked'
        : varMi('unknown')
          ? 'unknown'
          : varMi('risk')
            ? 'risk'
            : 'ok';
    return {
      host,
      verdict,
      scanDate: h.scanDate || null,
      reasons,
      note: bayat
        ? `Tarama bayat (${h.scanDate || '?'}) — güncel durum bilinmiyor.`
        : sema
          ? 'Server Hub şeması okunamadı — güncel durum bilinmiyor.'
          : '',
    };
  });

  satirlar.sort(
    (a, b) =>
      DURUM_SIRASI.indexOf(a.verdict) - DURUM_SIRASI.indexOf(b.verdict) ||
      a.host.localeCompare(b.host),
  );

  const say = (v) => satirlar.filter((x) => x.verdict === v).length;
  const summary = {
    requested: liste.length,
    scanned: satirlar.filter((x) => x.verdict !== 'notScanned').length,
    notScanned: say('notScanned'),
    ok: say('ok'),
    risk: say('risk'),
    blocked: say('blocked'),
    unknown: say('unknown'),
  };

  // EN SIK SEBEPLER: ozet "kac sunucu" der, bu "neden" der.
  const sebepSayac = new Map();
  for (const s of satirlar)
    for (const r of s.reasons) {
      const k = r.code;
      if (!sebepSayac.has(k))
        sebepSayac.set(k, { code: k, tip: r.tip, aciklama: r.aciklama, hosts: [] });
      const e = sebepSayac.get(k);
      if (!e.hosts.includes(s.host)) e.hosts.push(s.host);
    }
  const topReasons = [...sebepSayac.values()]
    .map((r) => ({ ...r, hostCount: r.hosts.length, hosts: r.hosts.sort().slice(0, 50) }))
    .sort(
      (a, b) =>
        DURUM_SIRASI.indexOf(a.tip === 'blocker' ? 'blocked' : a.tip) -
          DURUM_SIRASI.indexOf(b.tip === 'blocker' ? 'blocked' : b.tip) ||
        b.hostCount - a.hostCount,
    );

  return { summary, rows: satirlar, topReasons, latestScan, verdictOrder: DURUM_SIRASI };
}

module.exports = { rebootReadiness, KOD_ANLAMI, DURUM_SIRASI, BAYAT, SEMA };
