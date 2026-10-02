// shared/cryptoHubResources.cjs - Crypto Hub CPU / bellek (2026-10-02).
//
// Kullanici: "CPU ve bellegi Portal'dan degistirip Helm'e KALICI isleyelim." Kalici kaynak
// bastion'daki values dosyasidir; Portal dosya ICERIGINI hic tasimaz, yalniz
// {kiraci, bilesen yolu, kap, alan, eski, yeni} gonderir (Ansible: crypto_hub_resources.py).
//
// BU DOSYA EKRAN VE SUNUCU ICIN TEK KAYNAK: birim ayristirma, dogrulama kurallari, kullanici
// kararindaki sinirlar ve bilesen -> values yolu KAYDI. Iki kopya tutmak, bir gun ekranin
// "gecer" dedigini sunucunun reddetmesi (ya da tersi) demekti.
//
// UC KURAL:
//  1) BIRIMLER NORMALLESTIRILEREK karsilastirilir: cpu '1' == '1000m'; bellek '512M' (onluk)
//     != '512Mi' (ikilik). E-notasyon, eksi isaret ve bellekte 'm' birimi REDDEDILIR. Ham
//     dizge karsilastirmasi (values-compare.cjs) burada KULLANILMAZ.
//  2) "OLCULEMEDI" ILE "YOK/GECTI" KARISMAZ: canli deger ya da LimitRange okunamadiysa
//     kontrol 'olculemedi' der, 'gecti' DEMEZ. Kesin karar bastion'daki plandadir.
//  3) YALNIZ 'kayitli' YOLA YAZILIR. Kayit, chart sablonundan kanitli esleme tasir; addan
//     tahmin edilen bir yol GOSTERILIR ama yazilmaz (cryptoHubConfigMaps.cjs deseni).
//
// Dev sunucusu shim'i yalniz `module.exports = { a, b }` bicimini anlar (vite.config.ts):
// disa acilan nesnenin icinde ic ice suslu parantez OLMAMALI.
'use strict';

const ALANLAR = ['requests.cpu', 'requests.memory', 'limits.cpu', 'limits.memory'];

// Ansible sozlesmesiyle AYNI desenler (crypto_hub_resources.py: _BILESEN, _KAP, STD_*).
const BILESEN_RE = /^[A-Za-z0-9_-]{1,63}(\.[A-Za-z0-9_-]{1,63}){0,3}$/;
const KAP_RE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const STD_CPU = /^(?:[1-9][0-9]{0,5}m|[1-9][0-9]{0,2})$/;
const STD_BELLEK = /^[1-9][0-9]{0,6}(?:Mi|Gi)$/;
const MIKTAR_RE = /^\+?([0-9]+(?:\.[0-9]*)?|\.[0-9]+)(m|k|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei)?$/;
const IKILIK = Object.freeze({
  Ki: 1024n,
  Mi: 1024n ** 2n,
  Gi: 1024n ** 3n,
  Ti: 1024n ** 4n,
  Pi: 1024n ** 5n,
  Ei: 1024n ** 6n,
});
const ONLUK = Object.freeze({
  k: 10n ** 3n,
  M: 10n ** 6n,
  G: 10n ** 9n,
  T: 10n ** 12n,
  P: 10n ** 15n,
  E: 10n ** 18n,
});

// Degisiklik ozeti AWX'e en cok bu kadar karakterle gider (playbook ve yardimci da denetler):
// values ICERIGI bu kanala sigmaz, sigmamali.
const DEGISIKLIK_AZAMI = 2048;

// Kullanici karari 3 (2026-10-02). Admin GEREKCE yazarak ORAN / TAVAN / TABAN sinirlarini
// asabilir; Kubernetes kurali (requests <= limits) ve LimitRange ASILAMAZ.
const SINIRLAR = Object.freeze({
  oranUst: 2,
  oranAlt: 2,
  cpuLimitTavanM: 16000n,
  bellekLimitTavan: 32n * 1024n ** 3n,
  bellekLimitTaban: 512n * 1024n ** 2n,
  gerekceEnAz: 10,
  gerekceEnCok: 500,
});

// JVM heap'i MaxRAMPercentage=75 ile bellek limitinin %75'i (generic-chart values.yaml:486).
const HEAP_ORANI = 0.75;

// Plan jetonu kullaniciya bagli ve bu kadar gecerli (tasarim 3, son paragraf).
const PLAN_GECERLILIK_MS = 15 * 60 * 1000;

// Riskli bilesen ADI deseni - Ansible RISKLI_BILESEN ile AYNI. Olcum tarafi (StatefulSet /
// Recreate) plan ciktisindan (RESPLAN riskli=evet) gelir; ikisinden biri yeter.
const RISKLI_YOL_RE = /^(aeron-cluster|storage)(\.|$)|(^|\.)archive(\.|$)|^indexers\./;

const KAYNAK_ISLEMLERI = ['resources_get', 'resources_plan', 'resources_apply'];
// Production'da kapali olanlar (kullanici karari 2): okuma serbest, plan/uygula kapali.
const KAYNAK_YAZAN = ['resources_plan', 'resources_apply'];

class BirimHatasi extends Error {}

/**
 * Bu kiracida CPU/bellek ONIZLEME ve UYGULAMA acik mi? (resources_get her zaman serbest.)
 * Ekran ve sunucu ayni karari verir; sunucu `status`u HTTP kodu olarak kullanir.
 *   PROD_KAPALI    403 - kullanici karari 2: ilk fazda kapali (PRODUCTION_ENABLED acilsa bile)
 *   CHART_YOK      501 - Metaco: chart bastion dizininden kuruluyor, cozum yok
 *   DOSYA_TANIMSIZ 409 - katalogda values dosyasi yok: yol TAHMIN EDILMEZ
 */
function kaynakYazmaKapisi(tenant) {
  if (!tenant) return { acik: false, kod: 'KIRACI_YOK', status: 400, mesaj: 'Bilinmeyen kiracı.' };
  if (tenant.production) {
    return {
      acik: false,
      kod: 'PROD_KAPALI',
      status: 403,
      mesaj:
        'Production ortamlarında CPU/bellek önizleme ve uygulama ilk fazda kapalı (kullanıcı kararı, 2026-10-02). Değerler yalnız gösterilir.',
    };
  }
  if (!String(tenant.chartName || '').trim()) {
    return {
      acik: false,
      kod: 'CHART_YOK',
      status: 501,
      mesaj:
        'Bu uygulamada chart bastion diskindeki bir dizinden kuruluyor; doğru dizin koşan sürüme bağlı olduğu için Portal helm upgrade çalıştırmıyor. CPU/bellek önizleme ve uygulama kapalı — değerler yalnız gösterilir.',
    };
  }
  if (!String(tenant.resValuesPath || '').trim()) {
    return {
      acik: false,
      kod: 'DOSYA_TANIMSIZ',
      status: 409,
      mesaj:
        'Kiracının values dosyası katalogda tanımlı değil — dosya yolu tahmin edilmez ve istemciden alınmaz; CPU/bellek önizleme ve uygulama yapılamaz.',
    };
  }
  return { acik: true, kod: '', status: 200, mesaj: '' };
}

/** Ondalik metni (12.5) BigInt kesire cevirir: { n, d }. */
function ondalik(s) {
  const [tam, kesir = ''] = String(s).split('.');
  return { n: BigInt((tam || '0') + kesir || '0'), d: 10n ** BigInt(kesir.length) };
}

/**
 * Kubernetes miktari -> kesir { n, d }. cpu: milicekirdek, memory: bayt.
 * '8' == '8000m' (cpu); '512M' (onluk) != '512Mi' (ikilik). E-notasyon, eksi isaret ve
 * bellekte 'm' REDDEDILIR (BirimHatasi).
 */
function miktar(deger, tur) {
  if (deger === null || deger === undefined || typeof deger === 'boolean') {
    throw new BirimHatasi('boş değer');
  }
  const s = String(deger).trim();
  const m = MIKTAR_RE.exec(s);
  if (!m) throw new BirimHatasi(`geçersiz miktar: ${s.slice(0, 32)}`);
  let sayi = m[1];
  if (sayi.endsWith('.')) sayi += '0';
  const v = ondalik(sayi);
  const ek = m[2] || '';
  if (tur === 'cpu') {
    if (ek === 'm') return v;
    if (ek === '') return { n: v.n * 1000n, d: v.d };
    throw new BirimHatasi(`cpu için geçersiz birim: ${ek}`);
  }
  if (tur !== 'memory') throw new BirimHatasi(`bilinmeyen tür: ${tur}`);
  if (ek === 'm') throw new BirimHatasi('bellekte m (mili) birimi kullanılmaz');
  if (IKILIK[ek]) return { n: v.n * IKILIK[ek], d: v.d };
  if (ONLUK[ek]) return { n: v.n * ONLUK[ek], d: v.d };
  return v;
}

/** Ayristirilamazsa null (atmaz). */
function miktarYaDaNull(deger, tur) {
  try {
    return miktar(deger, tur);
  } catch {
    return null;
  }
}

/** a <=> b : -1 | 0 | 1 */
function kiyasla(a, b) {
  const x = a.n * b.d;
  const y = b.n * a.d;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Iki miktar dizgesi ayni degeri mi gosteriyor? Ayristirilamayan taraf varsa false. */
function ayniMiktar(a, b, tur) {
  const x = miktarYaDaNull(a, tur);
  const y = miktarYaDaNull(b, tur);
  return !!x && !!y && kiyasla(x, y) === 0;
}

function turOf(alan) {
  return String(alan).split('.')[1];
}

/** Standart bicim: cpu `1500m` ya da tam cekirdek `2`; bellek `512Mi` / `4Gi`. */
function standartMi(deger, tur) {
  return (tur === 'cpu' ? STD_CPU : STD_BELLEK).test(String(deger || ''));
}

/** Herhangi bir gecerli miktari standart bicime cevirir; temsil edilemiyorsa null. */
function standartla(deger, tur) {
  const m = miktarYaDaNull(deger, tur);
  if (!m || m.n <= 0n || m.n % m.d !== 0n) return null;
  const v = m.n / m.d;
  if (tur === 'cpu') {
    const s = `${v}m`;
    return STD_CPU.test(s) ? s : null;
  }
  for (const [ek, carpan] of [
    ['Gi', IKILIK.Gi],
    ['Mi', IKILIK.Mi],
  ]) {
    if (v % carpan === 0n) {
      const s = `${v / carpan}${ek}`;
      if (STD_BELLEK.test(s)) return s;
    }
  }
  return null;
}

/** Gosterim icin okunur bicim (karsilastirma DEGIL). */
function bicimle(deger, tur) {
  const m = miktarYaDaNull(deger, tur);
  if (!m) return String(deger == null ? '' : deger);
  if (tur === 'cpu') {
    if (m.n % m.d === 0n) return `${m.n / m.d}m`;
    return `${(Number(m.n) / Number(m.d)).toFixed(3)}m`;
  }
  if (m.n % m.d !== 0n) return `${Number(m.n) / Number(m.d)}`;
  const v = m.n / m.d;
  for (const ek of ['Gi', 'Mi', 'Ki']) {
    if (v !== 0n && v % IKILIK[ek] === 0n) return `${v / IKILIK[ek]}${ek}`;
  }
  return `${v}`;
}

/** Yaklasik heap (MiB) = bellek limiti x 0,75. Limit yoksa ya da okunamazsa null. */
function heapTahminiMi(limitBellek) {
  const m = miktarYaDaNull(limitBellek, 'memory');
  if (!m || m.n <= 0n) return null;
  return Math.floor((Number(m.n) / Number(m.d) / 1024 / 1024) * HEAP_ORANI);
}

// ── Bilesen -> values yolu KAYDI ──────────────────────────────────────────────────────
//
// durum:
//   kayitli     - chart sablonundan kanitli: bu yol bu is yukunun bu kabinin resources'ini
//                 uretir. YALNIZ bunlara yazilir.
//   tahmin      - ada bakarak cikarildi ya da sablon resources'i OKUMUYOR gorunuyor:
//                 gosterilir, YAZILMAZ.
//   olu         - values'ta duruyor ama chart okumuyor (memory-requester vakasi): YAZILMAZ.
//   kapsam_disi - bilincli olarak bu fazin disinda (connectorTemplate): YAZILMAZ.
//
// `is` = is yuku adinin release oneki atilmis hali: Deployment/StatefulSet adi
// `<release>-<is>` (generic-chart _helpers.tpl fullname: printf "%s-%s" .Release.Name
// .Chart.Name; alias Chart.Name olur). Calisan chart surumlerinin (1.5.19, 1.14.0) kaynagi
// arsivde YOK: kanit en yakin arsiv surumunden; her plan esleseyi URETIMLE yeniden olcer
// (olu anahtar / baska kap -> DUR).
const WYDEN_KANIT_GENEL =
  'wyden-1.5.13 Chart.yaml (alias -> generic-chart) + generic-chart/templates/deployment.yaml:67,146-147 (kap "app", .Values.resources)';
const WYDEN_GENEL = [
  'access-gateway',
  'agency-trading-service',
  'audit-server',
  'auto-hedger',
  'booking-engine',
  'booking-pnl',
  'booking-reporting',
  'booking-snapshotter',
  'booking-wal',
  'broker-config-service',
  'clob-gateway',
  'custody-service',
  'fix-api',
  'fix-api-custom-ohlc',
  'fix-api-drop-copy',
  'fix-api-market-data',
  'market-data-manager',
  'message-scheduler',
  'order-collider',
  'order-gateway',
  'order-history',
  'pricing-service',
  'quoting-engine',
  'quoting-order-service',
  'rate-service',
  'reference-data',
  'rest-api',
  'rest-management',
  'risk-engine',
  'settlement-server',
  'smart-order-router',
  'smart-recommendation-engine',
  'swagger-hub',
  'target-registry',
  'websocket-server',
];

/** @type {Array<{app:string, yol:string, kind:string, is:string, kap:string, durum:string, kanit:string, not?:string}>} */
const YOL_KAYDI = Object.freeze(
  [
    ...WYDEN_GENEL.map((a) => ({
      app: 'wyden',
      yol: a,
      kind: 'Deployment',
      is: a,
      kap: 'app',
      durum: 'kayitli',
      kanit: WYDEN_KANIT_GENEL,
    })),
    {
      app: 'wyden',
      yol: 'aeron-cluster',
      kind: 'StatefulSet',
      is: 'aeron-cluster',
      kap: 'aeron-node',
      durum: 'kayitli',
      kanit: 'wyden-1.5.13 charts/wyden-aeron/templates/cluster-statefulset.yaml:6,40,90-91',
      not: 'Aeron: heap + 256m doğrudan bellek + /dev/shm aynı bütçeyi paylaşır; düğümler sırayla yeniden başlar.',
    },
    {
      app: 'wyden',
      yol: 'aeron-cluster.archive.backup',
      kind: 'Deployment',
      is: 'aeron-cluster-archive',
      kap: 'backup',
      durum: 'kayitli',
      kanit: 'wyden-1.5.13 charts/wyden-aeron/templates/backup-snapshot-deployment.yaml:6,39,107-108',
      not: 'Archive Recreate stratejisiyle güncellenir: kısa kesinti olur.',
    },
    {
      app: 'wyden',
      yol: 'aeron-cluster.archive.snapshot',
      kind: 'Deployment',
      is: 'aeron-cluster-archive',
      kap: 'snapshot',
      durum: 'kayitli',
      kanit: 'wyden-1.5.13 charts/wyden-aeron/templates/backup-snapshot-deployment.yaml:6,129,175-176',
      not: 'Archive Recreate stratejisiyle güncellenir: kısa kesinti olur.',
    },
    {
      app: 'wyden',
      yol: 'storage',
      kind: 'StatefulSet',
      is: 'storage',
      kap: 'storage',
      durum: 'kayitli',
      kanit: 'wyden 1.2.4 charts/storage/templates/storage-statefulset.yaml:6,47,127-128 (daha yeni storage chart arşivde yok)',
      not: 'Storage (Hazelcast) sırayla yeniden başlar.',
    },
    {
      app: 'wyden',
      yol: 'aeron-cluster.memory-requester',
      kind: 'StatefulSet',
      is: 'aeron-cluster',
      kap: 'memory-requester',
      durum: 'olu',
      kanit: 'wyden-1.5.13 cluster-statefulset.yaml:112-119 (kap belleği devShmSize ile verilir)',
      not: 'Chart bu yolu OKUMUYOR: buraya yazılan değer sessizce kaybolur. Bellek devShmSize ile belirlenir (bu fazda düzenlenmez).',
    },
    {
      app: 'wyden',
      yol: 'target-registry.connectorTemplate',
      kind: 'Deployment',
      is: 'target-registry',
      kap: '',
      durum: 'kapsam_disi',
      kanit: 'connector-wrapper iş yükleri helm dışında yaratılıyor',
      not: 'connectorTemplate bu fazda kapsam dışı: helm yalnız ConfigMap’i günceller.',
    },
    {
      app: 'wyden',
      yol: 'wyden-ui',
      kind: 'Deployment',
      is: 'wyden-ui',
      kap: 'ui',
      durum: 'tahmin',
      kanit: 'wyden 1.2.4 charts/wyden-ui/templates/deployment.yaml resources OKUMUYOR; daha yeni sürüm arşivde yok',
      not: 'Chart’ın bu yolu okuduğu doğrulanmadı: gösterilir, yazılmaz.',
    },
  ].map((x) => Object.freeze(x)),
);

/** values yolunun kaydi (yoksa null). */
function yolKaydi(app, yol) {
  const a = String(app || '').toLowerCase();
  const y = String(yol || '');
  return YOL_KAYDI.find((k) => k.app === a && k.yol === y) || null;
}

/**
 * Bir is yukunun kayitlari (kap basina). Is yuku adi `<release>-<is>`. Bulunamazsa [].
 * Turu de eslesmeli: ayni adli Deployment ile StatefulSet ayni sey degildir.
 */
function isYukuKayitlari(app, release, kind, name) {
  const a = String(app || '').toLowerCase();
  const r = String(release || '');
  const k = String(kind || '').toLowerCase();
  const n = String(name || '');
  if (!r || !n) return [];
  return YOL_KAYDI.filter(
    (x) => x.app === a && `${r}-${x.is}` === n && x.kind.toLowerCase() === k,
  );
}

/** Yaziya acik mi: yalniz kayitli. */
function yazilabilirKayit(k) {
  return !!k && k.durum === 'kayitli' && !!k.kap;
}

function riskliYol(yol) {
  return RISKLI_YOL_RE.test(String(yol || ''));
}

// ── Degisiklik girdisi ────────────────────────────────────────────────────────────────

/**
 * Istemci girdisi -> kanonik degisiklik listesi (ALANLAR sirasinda). Hata: Error(kod).
 * Oge yalniz {alan, eski, yeni} tasir; eski = dosyadaki deger ('' = dosyada yok).
 */
function degisiklikleriCoz(liste) {
  const hata = (kod, mesaj) => Object.assign(new Error(mesaj), { kod });
  if (!Array.isArray(liste) || liste.length < 1 || liste.length > 4) {
    throw hata('GIRDI_GECERSIZ', 'Değişiklik 1-4 alan içermeli.');
  }
  const gorulen = new Set();
  const out = [];
  for (const o of liste) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) {
      throw hata('GIRDI_GECERSIZ', 'Değişiklik öğesi geçersiz.');
    }
    const fazla = Object.keys(o).filter((k) => !['alan', 'eski', 'yeni'].includes(k));
    if (fazla.length) {
      throw hata('GIRDI_GECERSIZ', `Değişiklik öğesi yalnız alan/eski/yeni taşır: ${fazla[0]}`);
    }
    const alan = String(o.alan || '');
    if (!ALANLAR.includes(alan)) throw hata('GIRDI_GECERSIZ', `Geçersiz alan: ${alan}`);
    if (gorulen.has(alan)) throw hata('GIRDI_GECERSIZ', `Alan iki kez verildi: ${alan}`);
    gorulen.add(alan);
    const tur = turOf(alan);
    const yeni = typeof o.yeni === 'string' ? o.yeni.trim() : '';
    if (!standartMi(yeni, tur)) {
      throw hata(
        'BIRIM_GECERSIZ',
        `${alan}: yeni değer standart biçimde değil (cpu: 1500m ya da 2; bellek: 512Mi ya da 4Gi): ${yeni.slice(0, 32)}`,
      );
    }
    const eski = o.eski == null ? '' : typeof o.eski === 'string' ? o.eski.trim() : null;
    if (eski === null || eski.length > 32) {
      throw hata('GIRDI_GECERSIZ', `${alan}: eski değer geçersiz.`);
    }
    if (eski !== '' && !miktarYaDaNull(eski, tur)) {
      throw hata('BIRIM_GECERSIZ', `${alan}: eski değer ayrıştırılamadı: ${eski}`);
    }
    if (eski !== '' && ayniMiktar(eski, yeni, tur)) {
      throw hata('GIRDI_GECERSIZ', `${alan}: yeni değer eskisiyle aynı (${eski} = ${yeni}).`);
    }
    out.push({ alan, eski, yeni });
  }
  out.sort((a, b) => ALANLAR.indexOf(a.alan) - ALANLAR.indexOf(b.alan));
  return out;
}

/** AWX'e giden base64(JSON). Sinir asilirsa hata - values icerigi bu kanala sigmaz. */
function degisiklikB64(kanonik) {
  // Yalniz sunucuda cagrilir (ekran AWX'e dogrudan gondermez); tarayicida Buffer yok.
  const B = globalThis.Buffer;
  if (!B) throw new Error('degisiklikB64 yalnız sunucuda çalışır.');
  const b64 = B.from(JSON.stringify(kanonik), 'utf8').toString('base64');
  if (b64.length > DEGISIKLIK_AZAMI) {
    throw Object.assign(new Error(`Değişiklik ${DEGISIKLIK_AZAMI} karakteri aşıyor.`), {
      kod: 'GIRDI_GECERSIZ',
    });
  }
  return b64;
}

// ── Dogrulama (kullanici karari 3) ────────────────────────────────────────────────────

/**
 * @param {object} p
 * @param {Array<{alan:string, eski:string, yeni:string}>} p.degisiklikler kanonik liste
 * @param {Record<string, string|null>|null} p.canli calisan spec degerleri; null = OLCULEMEDI
 *        (alan degeri null = canli spec'te YOK)
 * @param {{durum:'olculdu'|'yok'|'olculemedi', kurallar?:Array<{tur:string, ozellik:string, kaynak:string, deger:string}>}} [p.limitRange]
 * @param {boolean} [p.asim]   politika asimi istendi (yalniz Admin + gerekce)
 * @param {boolean} [p.admin]
 * @param {string}  [p.gerekce]
 * @returns {{ok:boolean, hatalar:Array<object>, uyarilar:Array<object>, kontroller:Array<object>, asimKullanildi:boolean, politikaIhlali:boolean}}
 */
function dogrula(p) {
  const hatalar = [];
  const uyarilar = [];
  const kontroller = [];
  const politika = [];
  const deg = Array.isArray(p && p.degisiklikler) ? p.degisiklikler : [];
  const canli = p && p.canli && typeof p.canli === 'object' ? p.canli : null;
  const lr = (p && p.limitRange) || { durum: 'olculemedi' };
  const yeniOf = (alan) => (deg.find((d) => d.alan === alan) || {}).yeni;

  // Etkin deger: degisen alan yeni degeriyle; degismeyen alan CANLIDAN (girilmeyen alan).
  // canli null = olculemedi -> bilinmiyor (undefined); canli[alan] null = spec'te YOK.
  const etkin = {};
  for (const alan of ALANLAR) {
    const y = yeniOf(alan);
    if (y !== undefined) etkin[alan] = y;
    else if (!canli) etkin[alan] = undefined;
    else etkin[alan] = canli[alan] == null ? null : canli[alan];
  }

  // 1) Kubernetes kurali: requests <= limits. ASILAMAZ.
  // Oncelik: dur > olculemedi > gecti. Bir turun 'olculemedi'si otekinin 'dur'unu ORTMEZ.
  let k8sDurum = 'gecti';
  let k8sEksik = false;
  const olculemedi = () => {
    k8sEksik = true;
    if (k8sDurum !== 'dur') k8sDurum = 'olculemedi';
  };
  for (const tur of ['cpu', 'memory']) {
    const r = etkin[`requests.${tur}`];
    const l = etkin[`limits.${tur}`];
    if (r === undefined || l === undefined) {
      if (deg.some((d) => turOf(d.alan) === tur)) olculemedi();
      continue;
    }
    if (r === null || l === null) continue;
    const rm = miktarYaDaNull(r, tur);
    const lm = miktarYaDaNull(l, tur);
    if (!rm || !lm) {
      olculemedi();
      continue;
    }
    if (kiyasla(rm, lm) > 0) {
      k8sDurum = 'dur';
      hatalar.push({
        kod: 'K8S_KURAL',
        asilabilir: false,
        mesaj: `${tur}: requests (${r}) limits'ten (${l}) büyük olamaz — Kubernetes reddeder.`,
      });
    }
  }
  kontroller.push({ kontrol: 'k8s_kural', durum: k8sDurum });
  if (k8sEksik) {
    uyarilar.push({
      kod: 'K8S_KURAL',
      durum: 'olculemedi',
      mesaj:
        'Çalışan değerler okunamadı: requests ≤ limits denetimi burada YAPILAMADI, önizleme (bastion) denetleyecek.',
    });
  }

  // 2) Politika: oran, tavan, taban. Admin gerekceyle asabilir.
  for (const d of deg) {
    const tur = turOf(d.alan);
    const y = miktar(d.yeni, tur);
    const tabanHam = canli && canli[d.alan] != null ? canli[d.alan] : d.eski || null;
    const taban = tabanHam ? miktarYaDaNull(tabanHam, tur) : null;
    if (taban && taban.n > 0n) {
      // yeni <= 2 x taban  ve  yeni >= taban / 2
      if (y.n * taban.d > BigInt(SINIRLAR.oranUst) * taban.n * y.d) {
        politika.push(`${d.alan}: tek seferde en çok ${SINIRLAR.oranUst} kat artış (${tabanHam} → ${d.yeni}).`);
      }
      if (BigInt(SINIRLAR.oranAlt) * y.n * taban.d < taban.n * y.d) {
        politika.push(`${d.alan}: tek seferde en çok yarıya iniş (${tabanHam} → ${d.yeni}).`);
      }
    }
    if (d.alan === 'limits.cpu' && kiyasla(y, { n: SINIRLAR.cpuLimitTavanM, d: 1n }) > 0) {
      politika.push(`limits.cpu en çok 16 çekirdek (${d.yeni}).`);
    }
    if (d.alan === 'limits.memory') {
      if (kiyasla(y, { n: SINIRLAR.bellekLimitTavan, d: 1n }) > 0) {
        politika.push(`limits.memory en çok 32Gi (${d.yeni}).`);
      }
      if (kiyasla(y, { n: SINIRLAR.bellekLimitTaban, d: 1n }) < 0) {
        politika.push(`limits.memory en az 512Mi (JVM) (${d.yeni}).`);
      }
    }
  }
  const asimIstendi = !!(p && p.asim);
  const gerekce = String((p && p.gerekce) || '').trim();
  const asimGecerli =
    asimIstendi &&
    !!(p && p.admin) &&
    gerekce.length >= SINIRLAR.gerekceEnAz &&
    gerekce.length <= SINIRLAR.gerekceEnCok;
  if (asimIstendi && !asimGecerli) {
    hatalar.push({
      kod: 'YETKI',
      asilabilir: false,
      mesaj: p && p.admin
        ? `Sınır aşımı için ${SINIRLAR.gerekceEnAz}-${SINIRLAR.gerekceEnCok} karakter gerekçe zorunlu.`
        : 'Sınır aşımı yalnız Admin tarafından, gerekçe yazılarak yapılabilir.',
    });
  }
  if (politika.length) {
    if (asimGecerli) {
      uyarilar.push({ kod: 'POLITIKA', durum: 'asildi', mesaj: `Admin gerekçeyle aştı: ${politika.join(' ')}` });
      kontroller.push({ kontrol: 'politika', durum: 'uyari' });
    } else {
      for (const m of politika) hatalar.push({ kod: 'POLITIKA', asilabilir: true, mesaj: m });
      kontroller.push({ kontrol: 'politika', durum: 'dur' });
    }
  } else {
    kontroller.push({ kontrol: 'politika', durum: 'gecti' });
  }

  // 3) LimitRange (Container). ASILAMAZ. Okunamadiysa 'olculemedi' - 'gecti' DEGIL.
  if (lr.durum === 'olculemedi' || !lr.durum) {
    kontroller.push({ kontrol: 'limitrange', durum: 'olculemedi' });
    uyarilar.push({
      kod: 'LIMITRANGE',
      durum: 'olculemedi',
      mesaj: 'LimitRange okunamadı (ölçülemedi) — sınırlar burada denetlenemedi; önizleme denetleyecek.',
    });
  } else if (lr.durum === 'yok') {
    kontroller.push({ kontrol: 'limitrange', durum: 'yok' });
  } else {
    let lrDur = false;
    const kurallar = (lr.kurallar || []).filter((k) => String(k.tur) === 'Container');
    for (const d of deg) {
      const tur = turOf(d.alan);
      const y = miktar(d.yeni, tur);
      for (const k of kurallar.filter((x) => x.kaynak === tur)) {
        const sinir = miktarYaDaNull(k.deger, tur);
        if (!sinir) continue;
        if (k.ozellik === 'max' && kiyasla(y, sinir) > 0) {
          lrDur = true;
          hatalar.push({ kod: 'LIMITRANGE', asilabilir: false, mesaj: `${d.alan} ${d.yeni} > LimitRange azami ${k.deger}.` });
        }
        if (k.ozellik === 'min' && kiyasla(y, sinir) < 0) {
          lrDur = true;
          hatalar.push({ kod: 'LIMITRANGE', asilabilir: false, mesaj: `${d.alan} ${d.yeni} < LimitRange asgari ${k.deger}.` });
        }
      }
    }
    for (const tur of ['cpu', 'memory']) {
      const oran = kurallar.find((x) => x.kaynak === tur && x.ozellik === 'maxLimitRequestRatio');
      const r = miktarYaDaNull(etkin[`requests.${tur}`], tur);
      const l = miktarYaDaNull(etkin[`limits.${tur}`], tur);
      const o = oran ? miktarYaDaNull(oran.deger, 'memory') : null;
      if (o && r && l && r.n > 0n && l.n * r.d * o.d > o.n * r.n * l.d) {
        lrDur = true;
        hatalar.push({ kod: 'LIMITRANGE', asilabilir: false, mesaj: `${tur}: limits/requests oranı LimitRange azami oranı (${oran.deger}) aşıyor.` });
      }
    }
    kontroller.push({ kontrol: 'limitrange', durum: lrDur ? 'dur' : 'gecti' });
  }

  return {
    ok: hatalar.length === 0,
    hatalar,
    uyarilar,
    kontroller,
    asimKullanildi: asimGecerli && politika.length > 0,
    politikaIhlali: politika.length > 0,
  };
}

module.exports = {
  ALANLAR,
  BILESEN_RE,
  KAP_RE,
  STD_CPU,
  STD_BELLEK,
  DEGISIKLIK_AZAMI,
  SINIRLAR,
  HEAP_ORANI,
  PLAN_GECERLILIK_MS,
  RISKLI_YOL_RE,
  KAYNAK_ISLEMLERI,
  KAYNAK_YAZAN,
  YOL_KAYDI,
  BirimHatasi,
  kaynakYazmaKapisi,
  miktar,
  miktarYaDaNull,
  kiyasla,
  ayniMiktar,
  turOf,
  standartMi,
  standartla,
  bicimle,
  heapTahminiMi,
  yolKaydi,
  isYukuKayitlari,
  yazilabilirKayit,
  riskliYol,
  degisiklikleriCoz,
  degisiklikB64,
  dogrula,
};
