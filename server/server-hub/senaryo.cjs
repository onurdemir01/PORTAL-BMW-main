// server/server-hub/senaryo.cjs - Retirement senaryo katalogu ve karar motoru (2026-11-07; saf, birim testli).
//
// Kullanici: "olmasi gereken her sey retire olmali ama yanlis, eksik, hatali, gereksiz hicbir sey retire
// edilemez; bunu kaldiramayiz ... app katmani ile web katmani iliskisini beraber inceleyerek retirement
// yorumu". Girdi: iliski grafigi (iliski-grafigi.cjs), capraz dogrulamalar (dogrulama.cjs) ve Server Hub
// degerlendirmesi (assess: JVM durumu, EAR -> JVM, Faz 2 deployment, capraz kontroller). Cikti: kopya
// (JVM / WAS sunucusu) ve uygulama basina KARAR + destekleyen / engelleyen MADDELER + eksik veri + celiski +
// yapilabilecekler. Motor INSAN KARARININ YERINI ALMAZ ve hicbir sey calistirmaz.
//
// KARAR SIRASI (kopya):
//   1. KULLANIMDA      olculmus gercek trafik (Server Hub ya da access log) VEYA web disi cagiran (baglanti
//                      goruntusu). Kullanim kaniti HER ZAMAN kazanir: belirsizlikte guvenli taraf.
//   2. KARAR_VERILEMEZ kopyanin ya da esli vhost'larinin capraz dogrulamasinda CELISKI, celiskili kenar.
//   3. RETIRE_ADAYI    BUTUN kosullar: en az bir KESIN ya da DOGRULANDI esleme, esli her vhost'ta trafik
//                      olculmus ve sifir (kismi log degil), Server Hub taze, baglanti goruntusu olculmus ve web
//                      disi cagiran yok YA DA JVM kapali.
//                      TAZELIK her kanitin KENDI sunucusundan okunur: vhost'un sifir trafigi web sunucusunun
//                      Server Hub taramasi (taze) ya da Uygulama Envanteri taramasi (UE_TAZE_GUN) ile; baglanti
//                      goruntusu uygulama sunucusunun Uygulama Envanteri taramasiyla. Bayat sifir "olculemedi"dir.
//   4. SUPHELI         destekleyen kanit var (kapali, trafik yok ama eksik olcum, yalniz saglik kontrolu, EAR /
//                      deployment sorunu, OpenShift'e tasinmis) ama 3'un bir kosulu eksik.
//   5. KARAR_VERILEMEZ calisiyor ve web eslemesi / trafik olcumu yok (ic servis / batch olabilir).
//   6. SORUN_YOK       hicbiri.
// DEGISMEZLER (bekci): olculemeyen engelleyici girdi varken RETIRE_ADAYI olamaz; gercek trafik varken
// KULLANIMDA disi olamaz; celiski varken (kullanim kaniti yoksa) KARAR_VERILEMEZ.
'use strict';

const { A, GUVEN } = require('./iliski-grafigi.cjs');
const { deploymentOf, earlerOf } = require('./uygulama-360.cjs');
const { tabanAd } = require('./capraz.cjs');

const UE_TAZE_GUN = 7;
const GUN_MS = 86400000;
const TAZE = Object.freeze({ sh: true, ue: true, shTarih: null, ueTarih: null });

const KARARLAR = Object.freeze([
  'KULLANIMDA',
  'RETIRE_ADAYI',
  'SUPHELI',
  'KARAR_VERILEMEZ',
  'SORUN_YOK',
]);
const KARAR_METNI = {
  KULLANIMDA: 'Kullanımda — retire etme',
  RETIRE_ADAYI: 'Retire adayı — son kontroller kaldı',
  SUPHELI: 'Şüpheli — elle doğrula',
  KARAR_VERILEMEZ: 'Karar verilemez — veri eksik ya da çelişkili',
  SORUN_YOK: 'Retirement açısından sorun yok',
};

/**
 * SENARYO KATALOGU. etki: ENGELLER (retire'a karsi), DESTEKLER (retire lehine), NOTR (bilgi / risk),
 * EKSIK (karar icin gereken veri yok). elle: ekranin "nasil dogrularsin" metni.
 */
const SENARYOLAR = Object.freeze({
  WEB_TRAFIK_VAR: {
    katman: 'web',
    etki: 'ENGELLER',
    baslik: 'Web katmanında gerçek trafik var',
    elle: 'Access log’da son isteklere bakın (sağlık kontrolü hariç).',
  },
  CAGIRAN_VAR: {
    katman: 'zincir',
    etki: 'ENGELLER',
    baslik: 'Web dışından doğrudan çağrılıyor',
    elle: 'Çağıran sunucunun sahibine sorun; JVM portuna gelen bağlantıları ss ile doğrulayın.',
  },
  KIRIK_ZINCIR: {
    katman: 'zincir',
    etki: 'NOTR',
    baslik: 'JVM kapalı ama vhost gerçek istek alıyor (kullanıcı hata görüyor)',
    elle: 'Web sunucusunun error_log’unda arka uç hatalarına bakın.',
  },
  WEB_TRAFIK_YOK: {
    katman: 'web',
    etki: 'DESTEKLER',
    baslik: 'Eşli vhost’larda gerçek trafik yok',
    elle: 'Access log’u en az 7 gün geriye doğru elle kontrol edin.',
  },
  WEB_YALNIZ_HC: {
    katman: 'web',
    etki: 'DESTEKLER',
    baslik: 'Yalnız LB sağlık kontrolü geliyor (gerçek kullanıcı yok)',
    elle: 'Sağlık kontrolü istemci IP’lerinin LB’ye ait olduğunu doğrulayın; LB havuzundan çıkarma ayrı adımdır.',
  },
  WEB_TRAFIK_OLCULEMEDI: {
    katman: 'web',
    etki: 'EKSIK',
    baslik: 'Web trafiği ölçülemedi',
    elle: 'Web kontrolünü (Faz W) açın ya da log okuma iznini düzeltin.',
  },
  WEB_ESLEME_YOK: {
    katman: 'web',
    etki: 'EKSIK',
    baslik: 'Web katmanı eşlenemedi',
    elle: 'Uygulamanın vhost’unu elle bulun; ic servis / batch ise web katmanı olmayabilir.',
  },
  WEB_ESLEME_ZAYIF: {
    katman: 'web',
    etki: 'EKSIK',
    baslik: 'Web eşlemesi yalnız ada dayanıyor',
    elle: 'Proxy hedefinin JVM portu olduğunu config’ten doğrulayın.',
  },
  WEB_CIFT_URUN: {
    katman: 'web',
    etki: 'NOTR',
    baslik: 'Uygulama hem IBM IHS hem Red Hat Apache’de tanımlı',
    elle: 'Hangisinin trafik aldığına bakın; diğeri geçiş kalıntısı olabilir.',
  },
  JVM_KAPALI: {
    katman: 'app',
    etki: 'DESTEKLER',
    baslik: 'JVM kapalı',
    elle: 'JVM’in ne zamandır kapalı olduğunu ve auto-start ayarını kontrol edin.',
  },
  AUTOSTART_UYUMSUZ: {
    katman: 'app',
    etki: 'NOTR',
    baslik: 'Auto-start çalışma durumuyla uyumsuz',
    elle: 'Reboot sonrası davranışı netleştirin.',
  },
  EAR_YOK: {
    katman: 'app',
    etki: 'DESTEKLER',
    baslik: 'JVM’e bağlı EAR bulunamadı (domain.xml / disk)',
    elle: 'domain.xml server-group deployment’larını kontrol edin.',
  },
  DEPLOY_SORUNU: {
    katman: 'app',
    etki: 'DESTEKLER',
    baslik: 'Deployment yok / kapalı / FAILED',
    elle: 'JBoss CLI ile deployment durumunu okuyun.',
  },
  GRUP_BOS: {
    katman: 'app',
    etki: 'DESTEKLER',
    baslik: 'JVM’in server-group’unda deployment yok',
    elle: 'domain.xml’de grubun deployments listesine bakın.',
  },
  OCP_TASINMIS: {
    katman: 'dis',
    etki: 'DESTEKLER',
    baslik: 'OpenShift’te aynı uygulama trafik alıyor',
    elle: 'OpenShift kopyasının aynı işlevi gördüğünü uygulama sahibine doğrulatın.',
  },
  RETIREMENT_KAYDI: {
    katman: 'dis',
    etki: 'NOTR',
    baslik: 'Açık Retirement kaydı var',
    elle: 'Retirement sekmesinde kaydın durumuna bakın.',
  },
  CELISKI: {
    katman: 'zincir',
    etki: 'EKSIK',
    baslik: 'Kaynaklar çelişiyor — karar kilitli',
    elle: 'Çelişen iki kaynağı elle karşılaştırın; düzeltilene kadar karar verilmez.',
  },
  BAYAT: {
    katman: 'dis',
    etki: 'EKSIK',
    baslik: 'Kanıt bayat',
    elle: 'Sunucuyu yeniden tarayın (Server Hub › Şimdi tara).',
  },
  BAGLANTI_OLCULMEDI: {
    katman: 'zincir',
    etki: 'EKSIK',
    baslik: 'Web dışı çağrılar ölçülmedi',
    elle: 'Bağlantı görüntüsünü açın ya da ss -tn ile JVM portuna gelen bağlantılara bakın.',
  },
});

const madde = (kod, metin, kanit = null, ek = {}) => ({
  kod,
  ...SENARYOLAR[kod],
  metin: String(metin || SENARYOLAR[kod].baslik).slice(0, 300),
  kanit,
  ...ek,
});

/**
 * Bir vhost'un trafik durumu: { olcum: VAR | YOK | OLCULEMEDI, bayat?, hc, metin }. `t`: web sunucusunun
 * kaynak tazeligi (sh: Server Hub taramasi taze, ue: Uygulama Envanteri taramasi UE_TAZE_GUN icinde).
 * Kullanim kaniti bayat da olsa sayilir (guvenli taraf); SIFIR yalniz taze kaynaktan.
 */
function vhostTrafigi(d, t = TAZE) {
  const l = d.veri.fazWLog;
  const sh = d.veri.shReq7g;
  const shOlcul =
    d.kaynaklar.includes('server_hub') &&
    Number.isFinite(sh) &&
    sh >= 0 &&
    ['ACTIVE', 'NO_RECENT_TRAFFIC', null, undefined].includes(d.veri.shTrafik);
  const wSayi = l && Number.isFinite(l.gercek_7g) ? l.gercek_7g : null;
  if ((shOlcul && sh > 0) || (wSayi != null && wSayi > 0 && ['OLCULDU', 'KISMI'].includes(l.durum)))
    return {
      olcum: 'VAR',
      metin: `${d.ad}: ${shOlcul && sh > 0 ? `Server Hub 7 gün ${sh}` : ''}${shOlcul && sh > 0 && wSayi ? ', ' : ''}${wSayi ? `access log ${wSayi}` : ''} gerçek istek`,
    };
  const wTam = l && l.durum === 'OLCULDU' && wSayi === 0;
  const shSifir = shOlcul && sh === 0 && !(l && l.durum === 'KISMI');
  if ((wTam && t.ue) || (shSifir && t.sh))
    return {
      olcum: 'YOK',
      hc: (l && l.hc_7g) || d.veri.shHc24s || 0,
      hcIstemci: (l && l.hc_istemcileri) || [],
      metin: `${d.ad}: 7 gündür gerçek istek yok${l && l.hc_7g ? ` (yalnız ${l.hc_7g} sağlık kontrolü)` : ''}`,
    };
  if (wTam || shSifir)
    return {
      olcum: 'OLCULEMEDI',
      bayat: true,
      metin: `${d.ad}: sıfır trafik ölçümü bayat (${[wTam ? `access log ${t.ueTarih || '?'}` : '', shSifir ? `Server Hub ${t.shTarih || '?'}` : ''].filter(Boolean).join(', ')} taraması)`,
    };
  return {
    olcum: 'OLCULEMEDI',
    metin: `${d.ad}: ${l ? `access log ${l.durum}` : 'access log yok'}${shOlcul ? '' : ', Server Hub ölçemedi'}`,
  };
}

/**
 * @param {{ g: object, dogrulamalar: Map, hosts: object[], simdi?: () => number }} girdi
 * @returns {{ kopyalar: Map<string, object>, uygulamalar: Map<string, object> }}
 */
function kararla({ g, dogrulamalar, hosts = [], simdi = Date.now }) {
  const jvmAssess = new Map();
  for (const h of hosts)
    for (const j of h.jvms || [])
      jvmAssess.set(A.jvm(h.host, Number.isFinite(j.gen) ? j.gen : null, j.name), { h, j });
  const celiskiOf = (k) => (dogrulamalar.get(k) || []).filter((x) => x.durum === 'CELISKI');
  const an = simdi();
  /** Sunucunun kaynak tazeligi: Server Hub (assess fresh) ve Uygulama Envanteri tarama ani. */
  const tazelikOf = (host) => {
    const s = g.dugumler.get(`sunucu:${host}`);
    const v = (s && s.veri) || {};
    const ueMs = v.ueTaranma ? Date.parse(v.ueTaranma) : NaN;
    return {
      sh: !!s && s.kaynaklar.includes('server_hub') && v.taze !== false,
      ue: Number.isFinite(ueMs) && an - ueMs <= UE_TAZE_GUN * GUN_MS,
      shTarih: v.tarama ? String(v.tarama).slice(0, 10) : null,
      ueTarih: v.ueTaranma ? String(v.ueTaranma).slice(0, 10) : null,
    };
  };
  const kopyalar = new Map();

  for (const d of g.dugumler.values()) {
    if (d.tur !== 'jvm' && d.tur !== 'was') continue;
    const maddeler = [];
    const eksikler = [];
    const ax = jvmAssess.get(d.anahtar) || null;
    const kenarlar = g.komsuKenarlar(d.anahtar);
    const gelen = kenarlar.filter((e) => e.hedef === d.anahtar && e.tur === 'yonlendirir');
    const guclu = gelen.filter((e) => GUVEN[e.guven] >= GUVEN.GUCLU && e.durum !== 'CELISKI');
    const guvenli = gelen.filter(
      (e) => (e.guven === 'KESIN' || e.durum === 'DOGRULANDI') && e.durum !== 'CELISKI',
    );
    const vhostlar = [...new Set(guclu.map((e) => e.kaynak))]
      .map((k) => g.dugumler.get(k))
      .filter((x) => x && x.tur === 'vhost');
    const trafikler = vhostlar.map((v) => ({ v, t: vhostTrafigi(v, tazelikOf(v.veri.host)) }));
    // KULLANIM KANITI celiskili eslemeden de toplanir: eslemesi tartismali olsa da gercek istek alan bir
    // vhost'un arkasindaki kopya "kullanilmiyor" sayilamaz (guvenli taraf). Retire kosullari celiskisiz kenarla.
    const celiskiliVhost = gelen
      .filter((e) => GUVEN[e.guven] >= GUVEN.GUCLU && e.durum === 'CELISKI')
      .map((e) => g.dugumler.get(e.kaynak))
      .filter((x) => x && x.tur === 'vhost' && !vhostlar.includes(x));
    const calisiyor = d.tur === 'jvm' ? d.veri.calisiyor : null;
    const host = d.veri.host;

    // ── kullanim kanitlari ──
    const trafikVar = [
      ...trafikler,
      ...celiskiliVhost.map((v) => ({ v, t: vhostTrafigi(v, tazelikOf(v.veri.host)) })),
    ].filter((x) => x.t.olcum === 'VAR');
    for (const x of trafikVar) maddeler.push(madde('WEB_TRAFIK_VAR', x.t.metin, x.v.anahtar));
    if (trafikVar.length && calisiyor === false)
      maddeler.push(
        madde(
          'KIRIK_ZINCIR',
          `${d.ad} kapalı ama ${trafikVar[0].v.ad} istek alıyor`,
          trafikVar[0].v.anahtar,
        ),
      );
    // Web katmani: bu kopyaya yonlendiren vhost'larin sunuculari (onlarin AJP baglantilari beklenen trafik).
    const webSunuculari = new Set(
      gelen
        .map((e) => g.dugumler.get(e.kaynak))
        .filter(Boolean)
        .map((v) => `sunucu:${v.veri.host}`),
    );
    const cagiranlar = kenarlar.filter(
      (e) =>
        e.tur === 'cagirir' &&
        e.hedef === d.anahtar &&
        !webSunuculari.has(e.kaynak) &&
        e.kaynak !== `sunucu:${host}`,
    );
    for (const e of cagiranlar.slice(0, 5))
      maddeler.push(
        madde(
          'CAGIRAN_VAR',
          `${e.kaynak.replace(/^(sunucu|ip):/, '')} doğrudan bağlanıyor`,
          e.kaynak,
        ),
      );
    const baglantiOlculdu = d.veri.dinleniyor != null || kenarlar.some((e) => e.tur === 'cagirir');
    // Baglanti goruntusu Uygulama Envanteri taramasindan: bayatsa "web disi cagiran yok" iddiasi kurulmaz.
    const jt = tazelikOf(host);
    const baglantiTaze = baglantiOlculdu && jt.ue;

    // ── celiski ──
    const celiski = [
      ...celiskiOf(d.anahtar).map((x) => ({ anahtar: d.anahtar, ...x })),
      ...vhostlar.flatMap((v) => celiskiOf(v.anahtar).map((x) => ({ anahtar: v.anahtar, ...x }))),
      ...gelen
        .filter((e) => e.durum === 'CELISKI')
        .map((e) => ({ anahtar: e.kaynak, kod: 'ESLEME', durum: 'CELISKI', metin: e.celiski })),
    ];
    for (const c of celiski.slice(0, 5))
      maddeler.push(madde('CELISKI', `${c.kod}: ${c.metin}`, c.anahtar));

    // ── retire lehine / eksik ──
    if (calisiyor === false) maddeler.push(madde('JVM_KAPALI', null, d.anahtar));
    if (
      ax &&
      ((ax.j.running && ax.j.autoStart === 'false') ||
        (!ax.j.running && ax.j.runningKnown !== false && ax.j.autoStart === 'true'))
    )
      maddeler.push(
        madde(
          'AUTOSTART_UYUMSUZ',
          `${d.ad}: ${ax.j.running ? 'çalışıyor, auto-start kapalı' : 'kapalı, auto-start açık'}`,
          d.anahtar,
        ),
      );
    const yok = trafikler.filter((x) => x.t.olcum === 'YOK');
    const olcmedi = trafikler.filter((x) => x.t.olcum === 'OLCULEMEDI');
    if (yok.length && !trafikVar.length) {
      const hc = yok.filter((x) => x.t.hc > 0);
      maddeler.push(
        hc.length
          ? madde('WEB_YALNIZ_HC', hc[0].t.metin, hc[0].v.anahtar, {
              hcIstemcileri: hc[0].t.hcIstemci,
            })
          : madde('WEB_TRAFIK_YOK', yok.map((x) => x.t.metin).join('; '), yok[0].v.anahtar),
      );
    }
    for (const x of olcmedi) {
      maddeler.push(madde('WEB_TRAFIK_OLCULEMEDI', x.t.metin, x.v.anahtar));
      eksikler.push(
        x.t.bayat
          ? {
              ne: `${x.v.ad} trafiği (taze ölçüm)`,
              nasil: `Web sunucusunu (${x.v.veri.host}) yeniden tarayın: Server Hub › Şimdi tara ya da Uygulama Envanteri`,
            }
          : {
              ne: `${x.v.ad} trafiği`,
              nasil: 'Uygulama Envanteri › Ayarlar › Web kontrolü (Faz W) ve log okuma kimliği',
            },
      );
    }
    if (!gelen.length) {
      maddeler.push(
        madde('WEB_ESLEME_YOK', `${d.ad} için web katmanında vhost bulunamadı`, d.anahtar),
      );
      eksikler.push({
        ne: 'web eşlemesi',
        nasil: 'Web sunucusunu Uygulama Envanteri (kapsam: Web sunucuları) ile tarayın',
      });
    } else if (!guclu.length)
      maddeler.push(
        madde('WEB_ESLEME_ZAYIF', `${gelen.length} eşleme yalnız ada dayanıyor`, gelen[0].kaynak),
      );
    const urunler = new Set(vhostlar.map((v) => v.veri.urun));
    if (urunler.has('IHS') && urunler.has('RHA'))
      maddeler.push(madde('WEB_CIFT_URUN', null, d.anahtar));
    if (!baglantiOlculdu && calisiyor !== false)
      eksikler.push({
        ne: 'web dışı çağrılar',
        nasil: 'Uygulama Envanteri › Ayarlar › Bağlantı görüntüsü',
      });
    if (ax) {
      const earler = earlerOf(ax.h, ax.j);
      if (earler && !earler.length) maddeler.push(madde('EAR_YOK', null, d.anahtar));
      const dep = deploymentOf(ax.h, ax.j);
      if (dep && ['YOK', 'KAPALI', 'FAILED'].includes(dep))
        maddeler.push(madde('DEPLOY_SORUNU', `deployment ${dep}`, d.anahtar));
      const ocp = ax.j.capraz && ax.j.capraz.ocp;
      if (ocp && ocp.aday) maddeler.push(madde('OCP_TASINMIS', null, d.anahtar));
      for (const r of ax.j.retirement || [])
        maddeler.push(
          madde(
            'RETIREMENT_KAYDI',
            `Retirement #${r.id} · ${r.durum || r.status || ''}`,
            d.anahtar,
          ),
        );
      if (ax.h.fresh === false) {
        maddeler.push(madde('BAYAT', `son tarama ${ax.h.scanDate || '?'}`, `sunucu:${host}`));
        eksikler.push({ ne: 'taze tarama', nasil: 'Server Hub › Şimdi tara' });
      }
    }
    const tazelik = (dogrulamalar.get(`sunucu:${host}`) || []).find(
      (x) => x.kod === 'TAZELIK' && x.durum === 'CELISKI',
    );
    if (tazelik) maddeler.push(madde('BAYAT', tazelik.metin, `sunucu:${host}`));
    if (baglantiOlculdu && !jt.ue && calisiyor !== false && !cagiranlar.length) {
      maddeler.push(
        madde('BAYAT', `bağlantı görüntüsü ${jt.ueTarih || '?'} taramasından`, `sunucu:${host}`),
      );
      eksikler.push({
        ne: 'taze bağlantı görüntüsü',
        nasil: `${host} için Uygulama Envanteri taraması (Bağlantı görüntüsü açık)`,
      });
    }
    if (!baglantiOlculdu && calisiyor !== false)
      maddeler.push(madde('BAGLANTI_OLCULMEDI', null, d.anahtar));

    // ── karar ──
    const kullanim = trafikVar.length > 0 || cagiranlar.length > 0;
    const bayat = maddeler.some((m) => m.kod === 'BAYAT');
    let karar;
    if (kullanim) karar = 'KULLANIMDA';
    else if (celiski.length) karar = 'KARAR_VERILEMEZ';
    else if (
      guvenli.length &&
      trafikler.length &&
      yok.length === trafikler.length &&
      !bayat &&
      (calisiyor === false || (baglantiTaze && !cagiranlar.length))
    )
      karar = 'RETIRE_ADAYI';
    else if (maddeler.some((m) => m.etki === 'DESTEKLER')) karar = 'SUPHELI';
    else if (calisiyor !== false && (!guclu.length || olcmedi.length)) karar = 'KARAR_VERILEMEZ';
    else karar = 'SORUN_YOK';
    kopyalar.set(d.anahtar, {
      anahtar: d.anahtar,
      tur: d.tur,
      ad: d.ad,
      host,
      env: (g.dugumler.get(`sunucu:${host}`) || { veri: {} }).veri.env || null,
      calisiyor,
      karar,
      kararMetni: KARAR_METNI[karar],
      maddeler,
      eksikler,
      celiskiler: celiski,
    });
  }

  // ── uygulama basina ──
  const uygulamalar = new Map();
  for (const d of g.dugumler.values()) {
    if (d.tur !== 'app') continue;
    const kk = g
      .komsuKenarlar(d.anahtar)
      .filter((e) => e.kaynak === d.anahtar && e.tur === 'kopya')
      .map((e) => kopyalar.get(e.hedef))
      .filter(Boolean);
    if (!kk.length) continue;
    const say = Object.fromEntries(
      KARARLAR.map((k) => [k, kk.filter((x) => x.karar === k).length]),
    );
    const karar =
      say.RETIRE_ADAYI === kk.length
        ? 'RETIRE_ADAYI'
        : say.KULLANIMDA
          ? 'KULLANIMDA'
          : say.KARAR_VERILEMEZ
            ? 'KARAR_VERILEMEZ'
            : say.SUPHELI
              ? 'SUPHELI'
              : say.RETIRE_ADAYI
                ? 'SUPHELI'
                : 'SORUN_YOK';
    uygulamalar.set(d.anahtar, {
      anahtar: d.anahtar,
      ad: d.ad,
      karar,
      kararMetni: KARAR_METNI[karar],
      ozet: uygulamaOzeti(karar, say, kk.length),
      sayilar: say,
      kopyalar: kk.map((x) => x.anahtar),
      yapilabilecekler: yapilabilecekler(karar, kk),
    });
  }
  return { kopyalar, uygulamalar };
}

function uygulamaOzeti(karar, say, n) {
  const parca = [];
  if (say.KULLANIMDA) parca.push(`${say.KULLANIMDA} kopya kullanımda`);
  if (say.RETIRE_ADAYI) parca.push(`${say.RETIRE_ADAYI} kopya retire adayı`);
  if (say.SUPHELI) parca.push(`${say.SUPHELI} kopya şüpheli`);
  if (say.KARAR_VERILEMEZ) parca.push(`${say.KARAR_VERILEMEZ} kopyada karar verilemiyor`);
  return `${n} kopya: ${parca.join(', ') || 'sorun yok'}`;
}

/** Yalniz yonlendirme ve elle adim; hicbiri bir sey calistirmaz. En cok 3. */
function yapilabilecekler(karar, kk) {
  const out = [];
  const tum = kk.flatMap((x) => x.maddeler);
  const eksik = kk.flatMap((x) => x.eksikler);
  if (karar === 'KULLANIMDA')
    out.push({ tur: 'bilgi', metin: 'Retire etmeyin: trafik ya da doğrudan çağrı var.' });
  if (karar === 'RETIRE_ADAYI')
    out.push({
      tur: 'yonlendir',
      metin: 'Retirement kaydı açılabilir',
      hedef: 'bmw-hub?sekme=retirement',
    });
  const celiski = tum.find((m) => m.kod === 'CELISKI');
  if (celiski) out.push({ tur: 'elle', metin: `Çelişkiyi inceleyin: ${celiski.metin}` });
  for (const e of eksik)
    if (out.length < 3 && !out.some((x) => x.metin.includes(e.nasil)))
      out.push({ tur: 'yonlendir', metin: `${e.ne} eksik: ${e.nasil}` });
  const hc = tum.find((m) => m.kod === 'WEB_YALNIZ_HC');
  if (hc && out.length < 3) out.push({ tur: 'elle', metin: hc.elle });
  if (out.length < 3 && (karar === 'SUPHELI' || karar === 'RETIRE_ADAYI'))
    out.push({ tur: 'elle', metin: 'Uygulama sahibine kullanılmadığını doğrulatın.' });
  return out.slice(0, 3);
}

module.exports = {
  kararla,
  vhostTrafigi,
  SENARYOLAR,
  KARARLAR,
  KARAR_METNI,
  UE_TAZE_GUN,
  tabanAd,
};
