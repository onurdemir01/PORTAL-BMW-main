// server/crypto-hub/node.cjs - Crypto Hub > Indexer / Node degisikligi (2026-11-02).
//
// Baglayici sozlesme: scratchpad/cryptohub/sozlesme.md (bolum 3, 4, 7, 8). Ozet:
//   * node_env_get (salt okunur) dogrudan AWX'e gider; cikti maskeli deger + sha256.
//   * node_change Smart bileti ile baslar, onaydan sonra MEVCUT poller (performSsLaunch) isi
//     baslatir. /ops bu islemleri TANIMAZ (index.cjs OPS'ta yoklar).
//   * Smart ayari smart-ayar.cjs cozer: Crypto Hub'in kendi blogu doluysa o, ikisi de bossa OpsX
//     OpenShift blogu (D7). OpsX'te Smart kapatilmis olsa bile (enabled:false) node talebi
//     onaysiz KOSMAZ; admin atlama yolu da yok.
//   * Tek istisna (D7): Crypto Hub ayarindan Smart kapatilmis TEST kiracisi. Is onaysiz baslar
//     (dogrudanBaslat), denetime yazilir. Production kiracida bu ayar etkisizdir.
//   * OCO (D8): production kiracida her zaman, test kiracida ayar acikken talep OCO numarasi ister
//     (ocoKapisi). Bilet pencere acilana dek PENDING bekler, is pencerede baslar. AWX schedule
//     KULLANILMAZ; numara extra_vars'a konmaz, plan_sha ve Ansible degismez. Pencereye kadar sifreli
//     deger kolonda, grup kilidi acik kalir; ust sinir ufuk + acik pencere beklemesi (ocoSonBaslamaMs).
//   * Kiraci + kilit basina TEK acik talep: DB filtreli tekil indeksi (UX_chnc_acik) zorlar;
//     indeks yoksa talep acilmaz (fail-closed).
//
// DEGER KURALI (sozlesme 2026-11-03 bolum 4): node listesi YOK; kullanici yeni degeri rol basina
// serbest metin yazar (is birimi onayli). Deger Portal'da YALNIZ su yerlerde bulunur: istek
// govdesi -> crypto_hub_node_changes.yeni_deger_secret (encryptSecretValue, AES-256-GCM; is AWX'e
// verilince / talep kapaninca NULL) -> launch kancasi (launchOncesiDegerEkle; onay sonrasi ya da
// dogrudan yol) -> AWX extra_vars. pending_launch_json'da yer tutucu '' durur; is gecmisi / denetim specFields
// password satiriyla '***gizli***' gorur. Ekran, Smart, denetim ve loglar yalniz maskeli deger +
// sha256 tasir. Betigin maskeli alanlari burada bir kez daha suzulur (maskeGuvenli).
'use strict';

const crypto = require('node:crypto');
const { tenantOf } = require('../../shared/cryptoHubTenants.cjs');
const N = require('../../shared/cryptoHubNodes.cjs');
const SA = require('./smart-ayar.cjs');

const OPS_KEY = 'crypto_hub_ops';
const OPSX_OPENSHIFT_KEY = 'opsx_openshift_operation';
const TERMINAL = ['successful', 'failed', 'error', 'canceled'];
const HEX64 = /^[0-9a-f]{64}$/;
const B64_AZAMI = 8192;
const OKUMA_IS_MS = 10 * 60 * 1000;
const ACILIS_DK = 10;
// Dogrudan yolda onay beklemesi yok: betik butcesi (30 dk) + pay.
const DOGRUDAN_TAKILDI_DK = 90;
// Acik satirda dogrudan yolun isareti; kapanista talepKapat gercek sonuc koduyla ezer.
const ONAYSIZ_KOD = 'ONAYSIZ';

// Hangi islem okur / yazar. index.cjs bunu yeniden ihrac eder (SB2: OPS + NODE_OPS ==
// playbook ch_islemler == betik izin satiri). OPS sozlugune EKLENMEZ: /ops bunlari reddeder.
const NODE_OPS = Object.freeze({
  node_env_get: Object.freeze({ writes: false }),
  node_change: Object.freeze({ writes: true }),
});

// Ekran metinleri birebir (sozlesme 7.2). Degistirmek UI sozlesmesini bozar.
const METIN = Object.freeze({
  girdi: (a) => `Geçersiz istek: ${a}.`,
  yetkiYok:
    'Node değişikliği talebi açma yetkiniz yok. Yöneticinize başvurun (Admin › Crypto Hub Erişimi › Indexer / Node değişikliği).',
  okumaYetkiYok: 'Bu alana erişiminiz yok (Metaco).',
  kapali: 'Bu ortamda node değişikliği şimdilik kapalı.',
  okumaBayat:
    'Mevcut node değerleri 10 dakikadan eski ya da okunmamış — önce güncel değerler okunmalı.',
  // `no` = N.talepNoMetni(...) ("Smart #SM-1" ya da "Portal #12"); ekranla AYNI metin (PS7).
  bekleyen: (no) => `Bu grup için açık bir talep var (${no}). Sonuçlanmadan yeni talep açılamaz.`,
  degiskenYok:
    'Değiştirilemez: node değişkeni bulunamadı (bileşenlerde beklenen env yok — README "uis env haritası").',
  secimBos: 'En az bir bileşen seçilmeli.',
  secimDisi: (ad) => `Seçilen bileşen bu grupta node taşımıyor: ${ad}.`,
  takildi:
    "Talep belirlenen sürede sonuçlanmadı ve iş sonucu okunamadı; durum bilinmiyor — mevcut node'ları okuyun.",
  adminKapatti: (kim) => `Talep yönetici tarafından kapatıldı (${kim}).`,
  ayniNode: 'Girilen değer seçilen bileşenlerde zaten kullanımda — değişiklik yok.',
  degerBicim: (rol, neden) => `Geçersiz değer (${rol}): ${neden}.`,
  bosOnay: 'Boş bırakılan rol var; boş değerle yazılması ayrıca onaylanmalı.',
  sifrelemeYok:
    "Değer şifreleme anahtarı (ENV_OVERRIDES_ENCRYPTION_KEY) tanımlı değil — production'da talep açılmaz.",
  olculemedi: 'Grubun bazı değerleri ölçülemedi; kısmi plan ile talep açılmaz.',
  referans: 'Grupta Secret/ConfigMap referanslı env var — Portal bu sürümde değiştirmez.',
  gitops:
    "Bu deployment'lar GitOps (Argo CD) sahipli ya da sahiplik ölçülemedi — Portal değiştirmez.",
  tutarsiz:
    "Bileşenler farklı node'lara bağlı; seçilenlerin hepsini aynı node'a getirmek için onay kutusunu işaretleyin.",
  aracYok:
    "Bastion'da güvenli yazma yolu (oc set env stdin / patch-file) ölçülemedi — talep açılmaz.",
  onayMetni: 'Onay için grup adını aynen yazın.',
  gerekce: 'Gerekçe 10–500 karakter olmalı.',
  smartYok:
    'Node değişikliği Smart onayından geçer, ancak OpsX OpenShift için Smart Flow Key tanımlı değil. Yönetici, OpsX ekranının sağ üstündeki "Smart Onayı" penceresinden OpenShift değerini girmeli. Talep açılmadı.',
  smartOkunamadi: 'Crypto Hub Smart ayarı okunamadı — talep açılmadı. Lütfen tekrar deneyin.',
  smartYarim:
    'Crypto Hub Smart ayarı eksik: Flow Key ile metadata şablonu birlikte dolu ya da birlikte boş olmalı. Yönetici, Crypto Hub ekranının sağ üstündeki "Smart Onayı" penceresinden düzeltmeli. Talep açılmadı.',
  smartDegisti: 'Smart ayarı bu sırada değişti; iş başlatılmadı. Talebi yeniden açın.',
  smartModDegisti:
    'Smart onay ayarı siz ekrandayken değişti; hiçbir şey başlatılmadı. Güncel metni okuyup yeniden onaylayın.',
  ocoGerekli: 'Bu talep için OCO numarası gerekli.',
  ocoKolonYok: 'OCO alanları veritabanında doğrulanamadı — talep açılmadı. Yöneticinize başvurun.',
  ocoGecersiz: 'OCO penceresi okunamadı — talep açılmadı.',
  ocoKisa: `OCO penceresi ${N.OCO_SON_PAY_DK} dakikadan kısa; iş pencere içinde tamamlanamaz. Yeni bir OCO kaydı ile deneyin.`,
  ocoSonPay: (saat) =>
    `Son başlama saati (${saat}) geçti; iş pencere bitmeden tamamlanamaz. Yeni bir OCO kaydı ile deneyin.`,
  ocoUfuk: (bas) =>
    `OCO penceresi (${bas}) ${N.OCO_UFUK_GUN} günden ileride. Pencereye en çok ${N.OCO_UFUK_GUN} gün kala talep açın.`,
  ocoBekleKapali: (bas) =>
    `OCO penceresi henüz açılmadı (${bas}). Smart onayı kapalıyken iş bekletilemez; pencere açılınca tekrar açın.`,
  ocoDegisti: 'OCO ayarı bu sırada değişti; iş başlatılmadı. Talebi yeniden açın.',
  ocoPaketEksik: 'OCO penceresi talepte eksik; iş başlatılmadı. Yeni talep açın.',
  ocoAcilmadi: 'OCO penceresi açılmadı; iş başlatılmadı.',
  ocoSonGecti: 'Son başlama saati geçti; iş başlatılmadı. Yeni talep açın.',
  indeksYok: 'Talep kilidi (veritabanı tekil indeksi) doğrulanamadı — talep açılmadı.',
  yetimBilet: (no) =>
    `Smart talebi AÇILDI (kayıt no: ${no}) ancak Portal kaydı yazılamadı. Onaylansa da iş başlamaz — Smart'ta reddettirin.`,
  smartHata: (m) => `Smart talebi açılamadı: ${m}`,
  sablonBos: 'OpsX OpenShift Smart şablonu boş — ElementName eşlemesi olmadan bilet açılamaz.',
  sablonBosCrypto: 'Crypto Hub Smart şablonu boş — ElementName eşlemesi olmadan bilet açılamaz.',
  sablonEk:
    " Şablon Crypto node talebini de taşır; OpsX'e özgü alanları `| default(...)` ile yazın.",
  aileYok: 'Bu zincir ailesi için izin listesi tanımlı değil',
  templateYok: `AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › "${OPS_KEY}" satırına Template ID girilmeli.`,
  talepAcildi: (no) =>
    `Smart talebi açıldı (kayıt no: ${no}). Onay 24 saat içinde gelirse değişiklik otomatik uygulanır; bu ekranda beklemeniz gerekmez.`,
  talepAcildiOco: (no, son) =>
    `Smart talebi açıldı (kayıt no: ${no}). Onay gelirse iş OCO penceresinde otomatik başlar; en geç ${son}. Bu ekranda beklemeniz gerekmez.`,
  onaysizBasladi: (job) => `Smart onayı kapalı (test ortamı): iş onaysız başlatıldı (AWX #${job}).`,
  dogrudanHazirlik: (m) => `İş başlatılmadı: ${m}`,
  dogrudanHata: (m) => `AWX işi başlatılamadı: ${m}`,
  dogrudanBelirsiz: (no) =>
    `AWX yanıtı alınamadı; iş başlamış olabilir. Talep Portal #${no} açık kaldı, sonuç süresi dolunca kendiliğinden kapanır. Mevcut node'ları okuyun.`,
  dogrudanIptalEdilemedi: (job, no) =>
    `AWX değişkenleri yok saydı ve iş #${job} iptal edilemedi; AWX ekranından durdurun. Talep Portal #${no} açık kaldı, sonucu okununca kapanır.`,
  awxOturum: "AWX oturumu açılamadı; iş AWX'e gönderilmedi.",
  dogrudanKesildi: 'Smart onayı kapalıydı; iş başlatılmadan açılış yarıda kaldı.',
  dogrudanKapatilmaz:
    'Bu talep Smart onayı olmadan başlatıldı; iş sonucu okununca ya da süre dolunca kendiliğinden kapanır.',
});

const kirp = (s, n) => {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const hata = (status, blocked, message) => ({ ok: false, status, blocked, message });

// ── Maske suzgeci ───────────────────────────────────────────────────────────────────
// Betik yalniz su bicimleri basar (sozlesme 3.3; crypto_hub_node.py maskele): sema://host[:port]
// (+ /**** ; IPv6 koseli), host:port, ****, bos literal deger (bos) ve deger yok (-). Bunlarin
// DISINDA kalan her alan ham deger olabilir -> **** olur (yol, sorgu, kullanici bilgisi gecmez).
const MASKE_RE = [
  /^[a-z][a-z0-9+.-]*:\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?(\/\*\*\*\*)?$/,
  /^[A-Za-z0-9.-]+:[0-9]{1,5}$/,
  /^\*\*\*\*$/,
  /^\(bos\)$/,
];

/** @returns {{deger: string|null, duzeltildi: boolean}} */
function maskeGuvenli(ham) {
  const s = String(ham == null ? '' : ham).trim();
  if (s === '' || s === '-') return { deger: null, duzeltildi: false };
  if (s.length <= 200 && MASKE_RE.some((r) => r.test(s))) return { deger: s, duzeltildi: false };
  return { deger: '****', duzeltildi: true };
}

// ── Satir ayristirici (sozlesme 6.4 + 7.7) ──────────────────────────────────────────
// En az alan sayisi. Eksik alanli satir SESSIZCE atilmaz: hatalar'a 'ayristir' girer.
const ALAN = Object.freeze({
  NODETOOL: 5,
  NODEGRP: 6,
  NODEDEP: 10,
  NODEALLOW: 6,
  NODEENV: 11,
  NODEEND: 4,
  NODECHG: 8,
  ROLLOUT: 5,
  VERIFY: 6,
  ROLLBACK: 4,
  NODEYEDEK: 3,
  NODESUM: 6,
  ERR: 4,
});
const ARAC_ADI = { python: 'python', oc: 'oc', stdin_env: 'stdinEnv', patch_file: 'patchFile' };
const SUM_SONUC = ['ok', 'geri_alindi', 'bayat', 'fail'];
const tamsayi = (x) => {
  const n = Number(x);
  return Number.isInteger(n) ? n : null;
};

function parseNodeLines(lines) {
  if (!Array.isArray(lines)) return null;
  const out = {
    tenantKey: '',
    araclar: { python: null, oc: null, stdinEnv: 'olculemedi', patchFile: 'olculemedi' },
    gruplar: new Map(),
    deps: [],
    allow: [],
    envler: [],
    end: null,
    degisiklikler: [],
    rollout: [],
    verify: [],
    rollback: [],
    yedek: [],
    supurme: null,
    sum: null,
    hatalar: [],
    maskeDuzeltildi: 0,
  };
  const guvenli = (x) => {
    const m = maskeGuvenli(x);
    if (m.duzeltildi) out.maskeDuzeltildi += 1;
    return m.deger;
  };
  for (const raw of lines) {
    const f = String(raw == null ? '' : raw)
      .replace(/\r$/, '')
      .split('\t');
    const tur = f[0];
    if (!Object.prototype.hasOwnProperty.call(ALAN, tur)) continue;
    if (f.length < ALAN[tur]) {
      out.hatalar.push({ stage: 'ayristir', message: `${tur} satırı eksik alanlı (${f.length})` });
      continue;
    }
    const t = String(f[1] || '').trim();
    if (!out.tenantKey) out.tenantKey = t;
    else if (t !== out.tenantKey) {
      out.hatalar.push({ stage: 'ayristir', message: `${tur} satırı başka kiracıya ait` });
      continue;
    }
    switch (tur) {
      case 'NODETOOL': {
        const ad = ARAC_ADI[f[2]];
        if (!ad) break;
        const v = String(f[3] || '').trim();
        if (ad === 'stdinEnv' || ad === 'patchFile') {
          out.araclar[ad] = ['var', 'yok', 'olculemedi'].includes(v) ? v : 'olculemedi';
        } else out.araclar[ad] = kirp(v, 40);
        break;
      }
      case 'NODEGRP': {
        const id = f[2];
        if (!N.GRUP_RE.test(id) || !['uis', 'eski'].includes(f[3])) {
          out.hatalar.push({ stage: 'ayristir', message: 'NODEGRP biçimi geçersiz' });
          break;
        }
        out.gruplar.set(id, { id, tur: f[3], kilit: f[4], baslik: kirp(f[5], 120) });
        break;
      }
      case 'NODEDEP':
        out.deps.push({
          grup: f[2],
          ad: f[3],
          bilesen: f[4] === '-' ? null : f[4],
          replicas: tamsayi(f[5]),
          ready: tamsayi(f[6]) == null ? 0 : tamsayi(f[6]),
          generation: tamsayi(f[7]),
          gitops: f[8],
          helmRelease: f[9] === '-' ? null : f[9],
          // 11. alan (2026-11-02, bilgi notu): '-' | 'var' | 'olculemedi'. Eski betik basmaz -> null.
          envFrom: ['var', 'olculemedi'].includes(f[10]) ? f[10] : null,
        });
        break;
      case 'NODEALLOW':
        if (N.YASAK_ENV_RE.test(f[4])) {
          out.hatalar.push({ stage: 'ayristir', message: `NODEALLOW yasak değişken içeriyor: ${kirp(f[4], 64)}` });
          break;
        }
        out.allow.push({ grup: f[2], rol: f[3], env: f[4], bicim: f[5] });
        break;
      case 'NODEENV':
        if (N.YASAK_ENV_RE.test(f[5])) {
          out.hatalar.push({ stage: 'ayristir', message: `NODEENV yasak değişken içeriyor: ${kirp(f[5], 64)}` });
          break;
        }
        out.envler.push({
          grup: f[2],
          deployment: f[3],
          container: f[4],
          env: f[5],
          rol: f[6],
          kaynak: f[7],
          maskeli: guvenli(f[8]),
          sha: HEX64.test(f[9]) ? f[9] : null,
          helm: ['evet', 'hayir', 'olculemedi'].includes(f[10]) ? f[10] : 'olculemedi',
        });
        break;
      case 'NODEEND':
        out.end = { islem: f[2], durum: f[3] };
        break;
      case 'NODECHG':
        out.degisiklikler.push({
          deployment: f[2],
          container: f[3],
          env: f[4],
          eski: guvenli(f[5]),
          yeni: guvenli(f[6]),
          durum: f[7],
        });
        break;
      case 'ROLLOUT':
        out.rollout.push({ deployment: f[2], durum: f[3], sureSn: tamsayi(f[4]) });
        break;
      case 'VERIFY':
        out.verify.push({ deployment: f[2], container: f[3], env: f[4], durum: f[5] });
        break;
      case 'ROLLBACK':
        out.rollback.push({ deployment: f[2], durum: f[3] });
        break;
      case 'NODEYEDEK':
        if (f[2] === 'supurme') out.supurme = tamsayi(f[3]);
        else out.yedek.push(kirp(f[2], 400));
        break;
      case 'NODESUM':
        if (!SUM_SONUC.includes(f[2])) {
          out.hatalar.push({ stage: 'ayristir', message: 'NODESUM sonucu tanınmadı' });
          break;
        }
        // 3. alan plan_sha (64 hex) ya da '-' (betik girdiyi okuyamadi).
        out.sum = { sonuc: f[2], planSha: HEX64.test(f[3]) ? f[3] : '-', talepId: f[4], kod: f[5] };
        break;
      case 'ERR':
        out.hatalar.push({ stage: f[2], message: kirp(f[3], 500) });
        break;
      default:
        break;
    }
  }
  return out;
}

// ── Grup analizi (okumadan) ──────────────────────────────────────────────────────────
// Betigin kaynak sozlugu ile AYNI liste (shared; capraz bekci CHN11). 'belirsiz' bilinen ama
// olculemedi sayilir; 'envFrom' referanstir (Portal degistirmez).
const BILINEN_KAYNAK = N.NODE_KAYNAKLARI;
const REFERANS_KAYNAK = N.REFERANS_KAYNAKLARI;

const ayniKume = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Bir grubun okumadaki durumu. Plan ve ekran AYNI analizden uretilir (iki ayri hesap bir gun
 * ayrisirdi: ekran "degistirilebilir" der, sunucu reddederdi).
 */
function grupAnalizi(parsed, grupId) {
  const g = parsed && parsed.gruplar && parsed.gruplar.get(grupId);
  if (!g) return null;
  const deps = parsed.deps.filter((d) => d.grup === grupId);
  const allow = parsed.allow.filter((a) => a.grup === grupId);
  const rolMap = new Map();
  for (const a of allow) {
    if (!rolMap.has(a.rol)) rolMap.set(a.rol, { rol: a.rol, envler: [], bicim: a.bicim });
    const r = rolMap.get(a.rol);
    if (!r.envler.includes(a.env)) r.envler.push(a.env);
  }
  const roller = [...rolMap.values()].sort((x, y) => x.rol.localeCompare(y.rol));
  const envRol = new Map(allow.map((a) => [a.env, a.rol]));
  const envler = parsed.envler.filter((e) => e.grup === grupId);
  const tasiyan = envler.filter((e) => e.kaynak !== 'yok');
  const literal = tasiyan.filter((e) => e.kaynak === 'literal');

  const izinYok = roller.length === 0;
  // Bilesenler var ama hicbiri beklenen degiskeni tasimiyor: "olculemedi" degil, kural disi grup
  // (PS-1: yeni uis grubu kurala uymuyor). Ayri metinle gosterilir.
  const degiskenYok = !izinYok && deps.length > 0 && tasiyan.length === 0;
  let olculemedi = deps.length === 0 || (tasiyan.length === 0 && !degiskenYok);
  for (const e of tasiyan) {
    if (!BILINEN_KAYNAK.includes(e.kaynak) || e.kaynak === 'belirsiz') olculemedi = true;
    if (e.kaynak === 'literal' && !e.sha) olculemedi = true;
    if (envRol.get(e.env) !== e.rol) olculemedi = true;
    if (!deps.some((d) => d.ad === e.deployment)) olculemedi = true;
  }
  if (!degiskenYok) {
    for (const r of roller) {
      if (!tasiyan.some((e) => e.rol === r.rol)) olculemedi = true;
    }
  }
  const referans = tasiyan.some((e) => REFERANS_KAYNAK.includes(e.kaynak));
  const gitops = deps.some((d) => d.gitops !== 'hayir');
  const durdurulmus = deps.filter((d) => d.replicas === 0).map((d) => d.ad);

  const rolShalari = new Map();
  for (const r of roller) {
    rolShalari.set(r.rol, new Set(literal.filter((e) => e.rol === r.rol).map((e) => e.sha)));
  }
  const tutarsiz = [...rolShalari.values()].some((s) => s.size > 1);

  const maskeliOf = (rol) =>
    [...new Set(literal.filter((e) => e.rol === rol).map((e) => e.maskeli || '****'))].join(' | ');
  const mevcutNode = tasiyan.length
    ? { maskeli: Object.fromEntries(roller.map((r) => [r.rol, maskeliOf(r.rol)])) }
    : null;
  // Bilesen (deployment) basina su anki deger: YALNIZ maskeli (rol -> maskeli, cok degerde ' | ').
  const depNodeu = (dAd) => {
    const sat = literal.filter((e) => e.deployment === dAd);
    if (!sat.length) return null;
    const maskeli = {};
    for (const rol of new Set(sat.map((e) => e.rol))) {
      maskeli[rol] = [...new Set(sat.filter((e) => e.rol === rol).map((e) => e.maskeli || '****'))].join(' | ');
    }
    return { maskeli };
  };
  const depNodelari = new Map(deps.map((d) => [d.ad, depNodeu(d.ad)]));
  // Secilebilir bilesen = literal node satiri olan deployment (plan yalniz literal satirdan kurulur).
  const secilebilir = deps.filter((d) => depNodelari.get(d.ad)).map((d) => d.ad);
  const envCikti = envler.map((e) => ({
    deployment: e.deployment,
    container: e.container,
    env: e.env,
    rol: e.rol,
    kaynak: e.kaynak,
    maskeli: e.maskeli,
    sha: e.sha,
    helm: e.helm,
  }));
  return {
    grup: g,
    deps,
    roller,
    envler,
    envCikti,
    tasiyan,
    literal,
    izinYok,
    degiskenYok,
    depNodelari,
    secilebilir,
    olculemedi,
    referans,
    gitops,
    durdurulmus,
    tutarsiz,
    mevcutNode,
    maskeliOf,
  };
}

function nodeDep(d, a) {
  const istenen = d.replicas;
  const hazir = d.ready == null ? 0 : d.ready;
  const mevcut = (a.depNodelari && a.depNodelari.get(d.ad)) || null;
  return {
    ad: d.ad,
    bilesen: d.bilesen,
    durum: istenen === 0 ? 'stopped' : istenen != null && hazir >= istenen ? 'running' : 'degraded',
    istenen,
    hazir,
    gitops: d.gitops,
    nodeBagli: a.tasiyan.some((e) => e.deployment === d.ad),
    // Bilesen secimi (kullanici karari 2026-11-02): yalniz literal node satiri olan secilebilir.
    secilebilir: a.secilebilir.includes(d.ad),
    mevcutNode: mevcut,
    envFrom: d.envFrom || null,
  };
}

const aracVar = (araclar) =>
  !!araclar && (araclar.stdinEnv === 'var' || araclar.patchFile === 'var');

/**
 * Ekrandaki grup listesi (sozlesme 7.4). `bekleyenler`: kilit -> acik talep ozeti.
 * Engel sirasi talep akisinin (7.5) sirasiyla ayni.
 */
function gruplariKur(parsed, { nodeAcik, talepYetkisi, bekleyenler } = {}) {
  const out = [];
  for (const g of parsed.gruplar.values()) {
    const a = grupAnalizi(parsed, g.id);
    const deploymentlar = a.deps.map((d) => nodeDep(d, a));
    let bilesenler = null;
    if (g.tur === 'uis') {
      bilesenler = Object.fromEntries(N.UIS_BILESENLER.map((b) => [b, null]));
      for (const d of deploymentlar) if (d.bilesen && d.bilesen in bilesenler) bilesenler[d.bilesen] = d;
    }
    const bekleyen = (bekleyenler && bekleyenler.get(g.kilit)) || null;
    let engel = null;
    if (!nodeAcik) engel = METIN.kapali;
    else if (!talepYetkisi) engel = METIN.yetkiYok;
    else if (bekleyen) engel = METIN.bekleyen(N.talepNoMetni(bekleyen.externalTicketId, bekleyen.talepId));
    else if (a.izinYok) engel = METIN.aileYok;
    else if (a.degiskenYok) engel = METIN.degiskenYok;
    else if (a.olculemedi) engel = METIN.olculemedi;
    else if (a.referans) engel = METIN.referans;
    else if (a.gitops) engel = METIN.gitops;
    else if (!aracVar(parsed.araclar)) engel = METIN.aracYok;
    out.push({
      id: g.id,
      tur: g.tur,
      baslik: g.baslik,
      kilit: g.kilit,
      bilesenler,
      deploymentlar,
      roller: a.roller.map((r) => ({ rol: r.rol, envler: [...r.envler], bicim: r.bicim })),
      envler: a.envCikti,
      mevcutNode: a.mevcutNode,
      tutarsiz: a.tutarsiz,
      degiskenYok: a.degiskenYok,
      olculemedi: a.olculemedi,
      referans: a.referans,
      gitops: a.gitops,
      durdurulmus: a.durdurulmus,
      bekleyen,
      degistirilebilir: !engel,
      engel,
      okumaBekleniyor: false,
    });
  }
  return out.sort((x, y) => (x.tur === y.tur ? x.id.localeCompare(y.id) : x.tur === 'uis' ? -1 : 1));
}

/** Okuma yokken: tarama Components listesinden yeni tip gruplar (envler bos). */
function taramadanGruplar(tenant, components, { nodeAcik, talepYetkisi, bekleyenler } = {}) {
  const re = N.uisDeseni(tenant.helmRelease);
  const map = new Map();
  for (const c of components || []) {
    if (String(c.kind || '').toLowerCase() !== 'deployment') continue;
    const m = re.exec(String(c.name || ''));
    if (!m) continue;
    const id = `uis:${m[2]}`;
    if (!N.GRUP_RE.test(id)) continue;
    if (!map.has(id)) map.set(id, { id, zincir: m[2], deps: [] });
    map.get(id).deps.push({
      ad: c.name,
      bilesen: m[1],
      durum: c.state || 'degraded',
      istenen: c.want == null ? null : Number(c.want),
      hazir: c.ready == null ? 0 : Number(c.ready),
      gitops: 'olculemedi',
      nodeBagli: false,
      secilebilir: false,
      mevcutNode: null,
      envFrom: null,
    });
  }
  return [...map.values()]
    .sort((x, y) => x.id.localeCompare(y.id))
    .map((g) => {
      const kilit = `uis-${g.zincir}`;
      const bilesenler = Object.fromEntries(N.UIS_BILESENLER.map((b) => [b, null]));
      for (const d of g.deps) bilesenler[d.bilesen] = d;
      const bekleyen = (bekleyenler && bekleyenler.get(kilit)) || null;
      const engel = !nodeAcik
        ? METIN.kapali
        : !talepYetkisi
          ? METIN.yetkiYok
          : bekleyen
            ? METIN.bekleyen(N.talepNoMetni(bekleyen.externalTicketId, bekleyen.talepId))
            : null;
      return {
        id: g.id,
        tur: 'uis',
        baslik: g.zincir,
        kilit,
        bilesenler,
        deploymentlar: g.deps,
        roller: [],
        envler: [],
        mevcutNode: null,
        tutarsiz: false,
        degiskenYok: false,
        olculemedi: false,
        referans: false,
        gitops: false,
        durdurulmus: g.deps.filter((d) => d.istenen === 0).map((d) => d.ad),
        bekleyen,
        degistirilebilir: !engel,
        engel,
        okumaBekleniyor: true,
      };
    });
}

// ── Plan (sozlesme 9.1) ─────────────────────────────────────────────────────────────
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const ONIZLEME_MASKE = '(önizleme)';

/**
 * @param {{parsed: object}} okuma  son node_env_get okumasi
 * @param {Record<string,string>|null} yeni  rol -> yeni deger (serbest metin; KIRPILMAZ).
 *          Onizlemede yok sayilir.
 * @param {{tutarsizlikOnay?: boolean, onayMetni?: string, production?: boolean,
 *          bilesenler?: string[]|null, bosOnay?: boolean, onizleme?: boolean}} opts
 *          bilesenler: secilen deployment adlari (yoksa node tasiyan HEPSI - varsayilan
 *          birlikte). Atomiklik yalniz secilenler arasinda. onizleme: deger alinmaz, ayni-deger
 *          ve bos kontrolu yapilmaz, yeni ozet her rol icin ONIZLEME_MASKE.
 */
function grupPlaniKur(okuma, grupId, yeni, opts = {}) {
  const parsed = okuma && okuma.parsed;
  const a = parsed ? grupAnalizi(parsed, grupId) : null;
  if (!a) return hata(400, 'node_girdi', METIN.girdi('grup son okumada yok'));
  if (a.izinYok) return hata(409, 'node_izin_yok', METIN.aileYok);
  if (a.degiskenYok) return hata(409, 'node_degisken_yok', METIN.degiskenYok);
  if (a.olculemedi) return hata(409, 'node_olculemedi', METIN.olculemedi);
  if (a.referans) return hata(409, 'node_referans', METIN.referans);
  if (a.gitops) return hata(409, 'node_gitops', METIN.gitops);
  if (!aracVar(parsed.araclar)) return hata(409, 'node_arac_yok', METIN.aracYok);
  // Bilesen secimi: bos olamaz, grubun node tasiyan bilesenlerinden olmali, tekrar yok.
  const secim = opts.bilesenler == null ? [...a.secilebilir] : opts.bilesenler;
  if (!Array.isArray(secim) || secim.some((x) => typeof x !== 'string')) {
    return hata(400, 'node_girdi', METIN.girdi('bileşen seçimi'));
  }
  if (secim.length === 0) return hata(400, 'node_secim', METIN.secimBos);
  if (new Set(secim).size !== secim.length || secim.length > N.MAX_HEDEF) {
    return hata(400, 'node_girdi', METIN.girdi('bileşen seçimi'));
  }
  const disari = secim.find((x) => !a.secilebilir.includes(x));
  if (disari) return hata(400, 'node_secim', METIN.secimDisi(kirp(disari, 120)));
  const secilenSatir = a.literal.filter((e) => secim.includes(e.deployment));
  const roller = a.roller.map((r) => r.rol);

  let newSha = null;
  let yeniB64 = null;
  let bosRoller = [];
  let yeniMaskeli;
  if (opts.onizleme) {
    yeniMaskeli = Object.fromEntries(roller.map((r) => [r, ONIZLEME_MASKE]));
  } else {
    // Yeni deger sekli: rol kumesi grubun rolleriyle BIREBIR, her deger metin.
    const anahtarlar =
      yeni && typeof yeni === 'object' && !Array.isArray(yeni) ? Object.keys(yeni) : null;
    if (
      !anahtarlar ||
      anahtarlar.length > 8 ||
      !ayniKume(new Set(anahtarlar), new Set(roller)) ||
      anahtarlar.some((k) => typeof yeni[k] !== 'string')
    ) {
      return hata(400, 'node_girdi', METIN.girdi('yeni değer rolleri'));
    }
    // Bicim: rol sirasi a.roller; ilk hatali rol doner (Python deger_dogrula ile ayni kural).
    for (const r of a.roller) {
      const neden = N.degerDogrula(yeni[r.rol], r.bicim);
      if (neden) {
        return { ...hata(400, 'node_deger_bicim', METIN.degerBicim(r.rol, neden)), rol: r.rol, neden };
      }
    }
    bosRoller = roller.filter((r) => yeni[r] === '');
    if (bosRoller.length && opts.bosOnay !== true) return hata(400, 'node_bos_onay', METIN.bosOnay);
    newSha = Object.fromEntries(roller.map((r) => [r, sha256(yeni[r])]));
    // Ayni deger: SECILEN bilesenlerin her literal satiri zaten girilen degerde.
    if (secilenSatir.every((e) => e.sha === newSha[e.rol])) {
      return hata(409, 'node_ayni_node', METIN.ayniNode);
    }
    yeniMaskeli = Object.fromEntries(a.roller.map((r) => [r.rol, N.maskele(yeni[r.rol], r.bicim)]));
    // Sozlesme 1.2: anahtarlar a.roller sirasiyla; bos_onay = degeri "" olan rollerin SIRALI listesi.
    yeniB64 = b64({
      degerler: Object.fromEntries(roller.map((r) => [r, yeni[r]])),
      bos_onay: [...bosRoller].sort(),
    });
  }
  // Tutarsizlik onayi: SECILENLER su an farkli node'lardaysa, hepsi tek degere toplanacak.
  const secimTutarsiz = a.roller.some(
    (r) => new Set(secilenSatir.filter((e) => e.rol === r.rol).map((e) => e.sha)).size > 1,
  );
  if (secimTutarsiz && opts.tutarsizlikOnay !== true) {
    return hata(409, 'node_tutarsiz_onay', METIN.tutarsiz);
  }
  if (opts.production && String(opts.onayMetni == null ? '' : opts.onayMetni) !== a.grup.id) {
    return hata(400, 'node_onay_metni', METIN.onayMetni);
  }
  const satirOf = (e) => ({ d: e.deployment, c: e.container, e: e.env, r: e.rol, sha: e.sha });
  const sirala = (x, y) => `${x.d}/${x.c}/${x.e}`.localeCompare(`${y.d}/${y.c}/${y.e}`);
  const plan = secilenSatir.map(satirOf).sort(sirala);
  const hedefler = [...new Set(plan.map((p) => p.d))].sort();
  if (hedefler.length > N.MAX_HEDEF) {
    return hata(400, 'node_girdi', METIN.girdi(`en çok ${N.MAX_HEDEF} deployment`));
  }
  // expect = grubun TUM literal satirlari: secilmeyen bilesen de onay beklerken degisirse is
  // hicbir sey yazmadan durur (betik BAYAT_ESKI_DEGER).
  const expect = {};
  for (const p of a.literal.map(satirOf).sort(sirala)) expect[`${p.d}/${p.c}/${p.e}`] = p.sha;
  const etiket = (ad) => {
    const d = a.deps.find((x) => x.ad === ad);
    return (d && d.bilesen) || ad;
  };
  const secilenler = hedefler.map(etiket);
  const secilmeyenler = a.secilebilir.filter((x) => !hedefler.includes(x)).map(etiket);
  const maskeliSecim = (rol) =>
    [...new Set(secilenSatir.filter((e) => e.rol === rol).map((e) => e.maskeli || '****'))].join(' | ');
  const eskiOzet = kirp(a.roller.map((r) => `${r.rol}=${maskeliSecim(r.rol)}`).join('; '), 1000);
  const yeniOzet = kirp(a.roller.map((r) => `${r.rol}=${yeniMaskeli[r.rol]}`).join('; '), 1000);
  return {
    ok: true,
    grup: a.grup,
    analiz: a,
    plan: plan.map(({ d, c, e, r }) => ({ d, c, e, r })),
    expect,
    newSha,
    yeniB64,
    bosRoller,
    yeniMaskeli,
    hedefler,
    secilenler,
    secilmeyenler,
    tutarsizToplama: secimTutarsiz,
    eskiOzet,
    yeniOzet,
  };
}

/**
 * plan / expect / new_sha base64'leri ve plan_sha (DB'de bayatlik izi). yeni_b64 plan_sha'ya
 * GIRMEZ (deger butunlugu new_sha ile baglanir) ama boyutu burada sinanir.
 */
function planKodla(plan, expect, newSha, yeniB64 = '') {
  const planB64 = b64(plan);
  const expectB64 = b64(expect);
  const newShaB64 = b64(newSha);
  for (const [ad, v] of [
    ['plan', planB64],
    ['expect', expectB64],
    ['new_sha', newShaB64],
  ]) {
    if (v.length > B64_AZAMI) throw Object.assign(new Error(`${ad} ${B64_AZAMI} sınırını aşıyor`), { status: 400 });
  }
  if (String(yeniB64 || '').length > N.YENI_B64_AZAMI) {
    throw Object.assign(new Error(`yeni değer ${N.YENI_B64_AZAMI} sınırını aşıyor`), { status: 400 });
  }
  return { planB64, expectB64, newShaB64, planSha: sha256(planB64 + expectB64 + newShaB64) };
}

/**
 * AWX extra_vars (sozlesme 1.1). crypto_hub_node_yeni_b64 burada YER TUTUCU '' olur: gercek
 * deger yalniz onay sonrasi launch kancasinda (launchOncesiDegerEkle) sifreli kolondan konur.
 * Kanca calismazsa playbook'un ilk assert'i '' degeri reddeder (fail-closed).
 */
function nodeExtraVars({ tenantKey, grupId, talepId, plan, expect, newSha, hedefler, email }) {
  const k = planKodla(plan, expect, newSha);
  return {
    crypto_hub_tenant: tenantKey,
    crypto_hub_action: 'node_change',
    crypto_hub_targets: hedefler.map((d) => `deployment/${d}`).join(','),
    crypto_hub_timeout: 1800,
    crypto_hub_node_grup: grupId,
    crypto_hub_node_talep: Number(talepId),
    crypto_hub_node_plan_b64: k.planB64,
    crypto_hub_node_expect_b64: k.expectB64,
    crypto_hub_node_new_sha_b64: k.newShaB64,
    crypto_hub_node_yeni_b64: '',
    email: String(email || ''),
  };
}

const { replaceControlCharsWithSpace } = require('../util/control-chars.cjs');
const tekSatir = (s) =>
  replaceControlCharsWithSpace(s)
    .replace(/\s{2,}/g, ' ')
    .trim();

/**
 * Smart sablon baglami `opsx` (sozlesme 3.3). OpsX OpenShift ile AYNI anahtarlar AYNI
 * sozlukle doldurulur (ortam test/prod, cluster metaco_das/metaco_gar, hedefler ns,app;...):
 * sablondaki dropdown eslemeleri (Production_9 gibi) bozulmaz. Ek anahtarlar yalniz
 * `| default(...)` ile kullanilabilir.
 */
function ozetKur({ tenant, plani, gerekce, username, esTalep, kaynak = 'opsx', oco = null }) {
  const lok = N.lokasyon(tenant);
  const g = plani.grup;
  const turAd = g.tur === 'uis' ? 'Yeni tip' : 'Eski tip';
  const hedefler = plani.hedefler.map((d) => `${tenant.namespace},${d}`).join(';');
  const ger = tekSatir(gerekce);
  const secilenler = plani.secilenler && plani.secilenler.length ? plani.secilenler : plani.hedefler;
  const secilmeyenler = plani.secilmeyenler || [];
  // PS1: kisa alan (opsx.islem, OpsX sablonunda ACIKLAMA) 400 karakter. Degisecek bilesen
  // listesi ASLA kesilmez; yeni MASKELI ozet en cok 160 karakter (iki rol x 200 karakterlik maske
  // 400'u asabiliyordu; tam hali aciklama ve opsx.yeniNode'da). Once uzun kiraci oneki
  // kisaltilir, kalan pay yalniz eski ozete verilir.
  const ISLEM_SINIRI = 400;
  const bosRoller = Array.isArray(plani.bosRoller) ? plani.bosRoller : [];
  // Bas bosluk tekSatir'in trim'inden ONCE eklenir ("...] -> yeni", "]-> " degil).
  const zorunlu = ` -> ${tekSatir(`${kirp(plani.yeniOzet, 160)} | Bileşenler: ${secilenler.join(', ')}`)}`;
  let onek = tekSatir(
    `Crypto Hub Indexer/Node Change — ${tenant.key} (${tenant.appLabel} · ${tenant.envLabel}) — ${lok} — ${g.baslik} [${g.id}]`,
  );
  if (onek.length + zorunlu.length > ISLEM_SINIRI) onek = tekSatir(`Crypto Hub Node Change — ${tenant.key} [${g.id}]`);
  const ESKI_ON = ' | Eski: ';
  const pay = ISLEM_SINIRI - onek.length - zorunlu.length - ESKI_ON.length;
  const islem = onek + zorunlu + (pay >= 12 ? ESKI_ON + kirp(tekSatir(plani.eskiOzet), pay) : '');
  // PS5: bilet metni bunun bir NODE DEGISIKLIGI oldugunu ilk satirda soyler. OpsX blogunda sablon
  // alanlari (or. JOBTYPE) OpsX degerlerini tasir, o yuzden ortak akis ayrica soylenir.
  const satirlar = [
    `Crypto Hub Indexer/Node Change — NODE DEĞİŞİKLİĞİ (rollout/restart değil${kaynak === 'opsx' ? '; OpsX OpenShift onay akışı ortak kullanılır' : ''})`,
    `Kiracı: ${tenant.key} (${tenant.appLabel} · ${tenant.domainLabel} · ${tenant.envLabel})`,
    `Lokasyon: ${lok}`,
    `Cluster / Namespace: ${tenant.cluster} / ${tenant.namespace}`,
    `Grup: ${g.baslik} [${g.id}] (${turAd})`,
    `Değişecek bileşenler: ${secilenler.join(', ')}`,
    `Değişmeyecek bileşenler: ${secilmeyenler.length ? secilmeyenler.join(', ') : '— (hepsi değişiyor)'}`,
    `Etkilenen deployment'lar: ${plani.hedefler.join(', ')}`,
    `Mevcut node: ${plani.eskiOzet}`,
    `Yeni node (maskeli): ${plani.yeniOzet}`,
    `Gerekçe: ${ger}`,
  ];
  if (bosRoller.length) {
    satirlar.push(
      `Uyarı: ${bosRoller.join(', ')} boş değerle yazılacak (talep eden onayladı; uygulama node'suz kalabilir).`,
    );
  }
  if (plani.tutarsizToplama) {
    satirlar.push("Not: seçilen bileşenler şu an farklı node'lara bağlı; talep hepsini tek node'a topluyor (kullanıcı onayladı).");
  }
  if (esTalep) satirlar.push(`İstanbul talebi: ${N.talepNoMetni(esTalep.externalTicketId, esTalep.id)}`);
  const ocoPencere = oco ? `${oco.windowStartText} – ${oco.windowEndText}` : '';
  if (oco) {
    satirlar.push(
      `OCO: ${oco.ocoNumber} (pencere ${ocoPencere}, son başlama ${oco.sonBaslamaText}). Onay pencereden önce gelirse iş pencere açılınca başlar; son başlamaya kadar başlamazsa iş hiç başlamaz.`,
    );
  }
  satirlar.push(
    'Onay sonrası Portal otomatik uygular; onay beklerken gruptaki herhangi bir node değeri değişirse iş yazmadan durur.',
  );
  return {
    islem,
    platform: 'openshift',
    uretimSebebi: tenant.production ? 'ortam=prod' : '',
    talepEden: username || '',
    ortam: tenant.production ? 'prod' : 'test',
    cluster: `metaco_${tenant.domain}`,
    hedefler,
    aciklama: satirlar.join('\n'),
    kiraci: tenant.key,
    lokasyon: lok,
    grup: g.id,
    grupBaslik: g.baslik,
    eskiNode: plani.eskiOzet,
    yeniNode: plani.yeniOzet,
    bosRoller: bosRoller.join(', '),
    gerekce: ger,
    deploymentlar: plani.hedefler.join(', '),
    bilesenler: secilenler.join(', '),
    degismeyenler: secilmeyenler.join(', '),
    esTalep: esTalep ? String(esTalep.externalTicketId || '') : '',
    ocoNo: oco ? oco.ocoNumber : '',
    ocoPencere,
  };
}

/**
 * Smart metadata: OpsX OpenShift sablonu, OpsX'in verdigi ad ve sozlukle render edilir.
 * Bos sablon OpsX'teki gibi sabit nesneye DUSMEZ (ElementName eslesmez, bilet bos acilir):
 * 400. Render hatasi da 400 (bilet acilmaz).
 * OpsX esligi (PS3/PS4; bekci node-birim N5b gercek opsxProductionKapisi baglamiyla karsilastirir):
 * extraVars = sablon varsayilanlari + OpsX sabit ek degiskenleri (cfg.openshift.extraVars) +
 * email (sabitlerde yoksa oturumdan) + oc_environment + oc_cluster/oc_input + choise:true.
 * BILINCLI istisnalar: openshift_operations (bu bir rollout DEGIL - kullanan sablon 400 verir) ve
 * target_cluster (OpsX'te de istege bagli; sablon `| default` ile yazilmali).
 * Bos sayimi SA.sablonDoluMu ile: yalniz yorum iceren sablon bos metadata ile bilet acardi.
 * @param {{ocClusterKey?: string, ocInputKey?: string, staticVars?: object, kaynak?: string}} [anahtarlar]
 */
function cryptoNodeMetadata(raw, ctx, ozet, sablonVarsayilan, anahtarlar = {}) {
  const kendi = anahtarlar.kaynak === 'crypto';
  if (!SA.sablonDoluMu(raw)) {
    throw Object.assign(new Error(kendi ? METIN.sablonBosCrypto : METIN.sablonBos), {
      status: 400,
      blocked: 'crypto_node_smart_sablon',
    });
  }
  const ck = anahtarlar.ocClusterKey || 'oc_cluster';
  const ik = anahtarlar.ocInputKey || 'oc_input';
  const sabit = anahtarlar.staticVars && typeof anahtarlar.staticVars === 'object' ? anahtarlar.staticVars : {};
  const metaGorunum = {
    ...(sablonVarsayilan && typeof sablonVarsayilan === 'object' ? sablonVarsayilan : {}),
    ...sabit,
    ...(sabit.email ? {} : { email: (ctx && ctx.email) || '' }),
    oc_environment: ozet.ortam,
    [ck]: ozet.cluster,
    [ik]: ozet.hedefler,
    choise: true,
  };
  // Bu bir rollout DEGIL: sablon openshift_operations kullaniyorsa render dusmeli (400).
  delete metaGorunum.openshift_operations;
  try {
    return require('../smart/metadata.cjs').buildSmartMetadata(raw, {
      ...(ctx || {}),
      extraVars: metaGorunum,
      opsx: ozet,
    });
  } catch (e) {
    throw Object.assign(new Error(`${e.message}${kendi ? '' : METIN.sablonEk}`), {
      status: 400,
      blocked: 'crypto_node_smart_sablon',
    });
  }
}

/** Template degisken varsayilanlari. Okunamazsa {}: sablon `| default` ile yazilmis olabilir. */
async function sablonVarsayilanOku(anahtar) {
  try {
    const reg = require('../ansible/playbook-registry.cjs');
    const row = await reg.getByKey(anahtar).catch(() => null);
    const tid = row && row.enabled !== false ? reg.getEffectiveTemplateId(row) : null;
    if (!tid) return {};
    return (await require('../ansible/runner.cjs').getTemplateVariableDefaultsOnServer(Number(row.awxServerId), tid)) || {};
  } catch (e) {
    console.warn('[CryptoHub] template degiskenleri okunamadi:', anahtar, e.message);
    return {};
  }
}

// Smart penceresindeki taslak onizleme icin ornek talep: gercek bir plan ya da kiraci bilgisi degil.
const ORNEK_PLAN = Object.freeze({
  grup: Object.freeze({ id: 'uis:ornek-zincir', tur: 'uis', baslik: 'ornek-zincir' }),
  hedefler: Object.freeze(['hmz-harmonize-uis-indexer-ornek-zincir']),
  secilenler: Object.freeze(['indexer']),
  secilmeyenler: Object.freeze([]),
  bosRoller: Object.freeze([]),
  eskiOzet: 'rpc=https://eski-node.invalid/****',
  yeniOzet: 'rpc=https://yeni-node.invalid/****',
  tutarsizToplama: false,
});

/** Kaydedilmemis sablon, gercek talep yoluyla render edilir (Smart'a gitmez). Hata firlatir. */
async function taslakOnizle(raw, ben = {}) {
  const tenant = tenantOf('metaco_das_test');
  const username = ben.username || 'ornek.kullanici';
  const ozet = ozetKur({ tenant, plani: ORNEK_PLAN, gerekce: 'Örnek gerekçe (önizleme)', username, esTalep: null, kaynak: 'crypto' });
  return cryptoNodeMetadata(
    raw,
    { username, email: ben.mail || '', templateName: `Crypto Hub: node_change @ ${tenant.key}`, templateId: 0 },
    ozet,
    await sablonVarsayilanOku(OPS_KEY),
    { kaynak: 'crypto' },
  );
}

// ── Bellek: son okuma + suren okuma isleri ──────────────────────────────────────────
const NODE_OKUMA = new Map();
const OKUMA_ISLERI = new Map();
let _indeks = { at: 0, ok: false };
let _ocoKolon = { at: 0, ok: false };

function okumaKaydet(tenantKey, parsed, at, meta = {}) {
  const eski = NODE_OKUMA.get(tenantKey);
  if (eski && eski.at > at) return false;
  NODE_OKUMA.set(tenantKey, {
    at,
    jobId: meta.jobId ?? null,
    serverId: meta.serverId ?? null,
    username: meta.username || null,
    parsed,
    eksik: !parsed.end || parsed.end.durum !== 'ok' || parsed.end.islem !== 'node_env_get',
  });
  return true;
}

function _sifirla() {
  NODE_OKUMA.clear();
  OKUMA_ISLERI.clear();
  _indeks = { at: 0, ok: false };
  _ocoKolon = { at: 0, ok: false };
}

/** Tekil indeks kapisi (sozlesme 7.3): yalniz OLUMLU sonuc 10 dk onbelleklenir. */
async function indeksVarMi(db, simdi = Date.now()) {
  if (_indeks.ok && simdi - _indeks.at < 10 * 60 * 1000) return true;
  let ok = false;
  try {
    const r = await db.query(
      `SELECT 1 AS v FROM sys.indexes WHERE name = 'UX_chnc_acik' AND is_unique = 1 AND has_filter = 1 AND object_id = OBJECT_ID('crypto_hub_node_changes')`,
    );
    ok = !!(r && r.rows && r.rows.length);
  } catch (e) {
    console.warn('[CryptoHub] node talep indeksi okunamadi:', e.message);
    ok = false;
  }
  _indeks = { at: simdi, ok };
  return ok;
}

/**
 * OCO kolonlari (D8). Setup'taki ALTER hatasi yalniz log'a duser, yani kolonlarin varligi kurulumdan
 * kanitlanamaz. Yalniz OLUMLU sonuc 10 dk onbelleklenir. Okuma hatasi "kolon yok" DEGILDIR: kolon
 * sonradan silinmez, son olumlu sonuc korunur; hic olumlu sonuc yoksa null doner.
 * @returns {Promise<boolean|null>} null = bilinmiyor
 */
async function ocoKolonOku(db, simdi = Date.now()) {
  if (_ocoKolon.ok && simdi - _ocoKolon.at < 10 * 60 * 1000) return true;
  try {
    const r = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA IN ('dbo', SCHEMA_NAME()) AND ((TABLE_NAME = 'crypto_hub_node_changes' AND COLUMN_NAME IN ('oco_no', 'oco_pencere_bas', 'oco_pencere_son')) OR (TABLE_NAME = 'smart_tickets' AND COLUMN_NAME = 'approved_at'))`,
    );
    const ok = new Set(((r && r.rows) || []).map((x) => x.COLUMN_NAME)).size === 4;
    _ocoKolon = { at: simdi, ok };
    return ok;
  } catch (e) {
    console.warn('[CryptoHub] OCO kolonlari okunamadi:', e.message);
    return _ocoKolon.ok ? true : null;
  }
}

/** Talep kapisi: bilinmiyor da hayirdir (fail-closed). */
const ocoKolonlariVarMi = async (db, simdi) => (await ocoKolonOku(db, simdi)) === true;

// ── DB ───────────────────────────────────────────────────────────────────────────────
// Genel listeler yeni_deger_secret'i ASLA secmez (yalniz launch kancasi okur; bekci N19).
const SUTUNLAR =
  'id, tenant_key, grup, kilit, lokasyon, eski_ozet, yeni_ozet, hedefler, plan_sha, gerekce, username, durum, smart_ticket_id, external_ticket_id, awx_server_id, awx_job_id, sonuc_kod, sonuc_json, es_talep_id, created_at, updated_at, kapandi_at, oco_no, oco_pencere_bas, oco_pencere_son';
// Kolonlar yoksa OCO'suz akis bozulmasin: okumalar sutunlar() ile bu listeye duser.
const SUTUNLAR_OCOSUZ = SUTUNLAR.replace(', oco_no, oco_pencere_bas, oco_pencere_son', '');
const sutunlar = async (db) => ((await ocoKolonOku(db)) === true ? SUTUNLAR : SUTUNLAR_OCOSUZ);

const ACIK_DURUMLAR = ['ACILIYOR', 'BEKLIYOR', 'CALISIYOR'];
const KAPALI_DURUMLAR = [
  'BASARILI',
  'GERI_ALINDI',
  'BAYAT',
  'BASARISIZ',
  'OLCULEMEDI',
  'REDDEDILDI',
  'ZAMAN_ASIMI',
  'IPTAL',
  'HATA',
];

const tarih = (x) => (x == null ? null : x instanceof Date ? x.toISOString() : String(x));
const zamanMs = (x) => (x instanceof Date ? x.getTime() : Date.parse(String(x || '')));

function talepOzeti(r) {
  let sonuc = null;
  if (r.sonuc_json) {
    try {
      sonuc = JSON.parse(r.sonuc_json);
    } catch {
      sonuc = null;
    }
  }
  return {
    talepId: Number(r.id),
    tenant: r.tenant_key,
    grup: r.grup,
    kilit: r.kilit,
    lokasyon: r.lokasyon,
    eskiOzet: r.eski_ozet || null,
    yeniOzet: r.yeni_ozet || null,
    hedefler: String(r.hedefler || '')
      .split(',')
      .filter(Boolean),
    gerekce: r.gerekce || '',
    username: r.username,
    durum: r.durum,
    smartTicketId: r.smart_ticket_id == null ? null : Number(r.smart_ticket_id),
    externalTicketId: r.external_ticket_id || null,
    awxServerId: r.awx_server_id == null ? null : Number(r.awx_server_id),
    awxJobId: r.awx_job_id == null ? null : Number(r.awx_job_id),
    sonucKod: r.sonuc_kod || null,
    sonuc,
    esTalepId: r.es_talep_id == null ? null : Number(r.es_talep_id),
    ocoNo: r.oco_no || null,
    ocoPencereBas: tarih(r.oco_pencere_bas),
    ocoPencereSon: tarih(r.oco_pencere_son),
    createdAt: tarih(r.created_at),
    kapandiAt: tarih(r.kapandi_at),
  };
}

/**
 * Talebi TEK KEZ kapatir (compare-and-set: `kapandi_at IS NULL`). Iki tarama ya da tarama +
 * ekran ayni anda kapatsa da denetim kaydi bir kez yazilir.
 * @returns {Promise<boolean>} bu cagri mi kapatti
 */
async function talepKapat(db, id, sonuc, denetim = null) {
  if (!KAPALI_DURUMLAR.includes(sonuc.durum)) throw new Error(`talepKapat: gecersiz durum ${sonuc.durum}`);
  const r = await db.query(
    `UPDATE crypto_hub_node_changes SET durum = $1, sonuc_kod = $2, sonuc_json = $3, kapandi_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(), yeni_deger_secret = NULL WHERE id = $4 AND kapandi_at IS NULL`,
    [sonuc.durum, sonuc.kod || null, sonuc.json == null ? null : JSON.stringify(sonuc.json), Number(id)],
  );
  const kapatti = !!r && r.rowCount === 1;
  if (kapatti && denetim) {
    try {
      require('../audit/index.cjs').auditPortal(denetim.req || null, 'crypto_hub_node_change_result', {
        username: denetim.username || undefined,
        result: sonuc.durum === 'BASARILI' ? 'ok' : 'fail',
        detail: JSON.stringify({
          talepId: Number(id),
          tenant: denetim.tenant,
          grup: denetim.grup,
          durum: sonuc.durum,
          kod: sonuc.kod || null,
          awx: denetim.awx || null,
          satirlar: sonuc.json && sonuc.json.ozet ? sonuc.json.ozet : null,
          yol: denetim.yol || 'tarama',
        }),
      });
    } catch {
      /* denetim yazilamadi - satir yine de kapandi */
    }
  }
  return kapatti;
}

/** Is sonucundan DB'ye yazilacak maskeli ozet. */
function sonucOzeti(p, awxDurum) {
  const sinir = (x) => (Array.isArray(x) ? x.slice(0, 200) : []);
  return {
    awx: awxDurum || null,
    sum: p ? p.sum : null,
    degisiklikler: p ? sinir(p.degisiklikler) : [],
    rollout: p ? sinir(p.rollout) : [],
    verify: p ? sinir(p.verify) : [],
    rollback: p ? sinir(p.rollback) : [],
    yedek: p ? sinir(p.yedek) : [],
    hatalar: p ? sinir(p.hatalar) : [],
    ozet: p
      ? {
          yazildi: p.degisiklikler.filter((x) => x.durum === 'yazildi').length,
          geriAlindi: p.degisiklikler.filter((x) => x.durum === 'geri_alindi').length,
          rollout: p.rollout.map((x) => `${x.deployment}:${x.durum}`),
          verify: p.verify.filter((x) => x.durum !== 'ok').length,
          hata: p.hatalar.length,
        }
      : null,
  };
}

/** Is kosmadan kapanan talep: ayni sekil (sum null, listeler bos) + ek alanlar. */
const bosSonuc = (ek = {}) => ({ ...sonucOzeti(null, null), ...ek });

const SUM_DURUM = { ok: 'BASARILI', geri_alindi: 'GERI_ALINDI', bayat: 'BAYAT', fail: 'BASARISIZ' };
const BILET_DURUM = {
  REJECTED: 'REDDEDILDI',
  TIMEOUT: 'ZAMAN_ASIMI',
  CANCELLED: 'IPTAL',
  ERROR: 'HATA',
  FAILED: 'HATA',
};

/** AWX isinin sonucu -> {durum, kod, json}. NODESUM yoksa OLCULEMEDI (uydurulmaz). */
function isSonucu(row, statusInfo) {
  let p = null;
  try {
    const { extractStatsKey } = require('../opsx/index.cjs');
    const stats = extractStatsKey(statusInfo && statusInfo.artifacts, 'crypto_hub_ops_result');
    p = parseNodeLines(stats && stats.lines);
  } catch {
    p = null;
  }
  const json = sonucOzeti(p, statusInfo && statusInfo.status);
  const s = p && p.sum;
  // Basari YALNIZ bu talebin satiriyla (talep no + plan_sha BIREBIR) sayilir. Betik girdiyi
  // okuyamazsa plan_sha / talep yerine '-' basar: o durumda olumsuz sonuc yine kabul edilir.
  const olumsuz = s && s.sonuc !== 'ok' && s.sonuc !== 'geri_alindi';
  const kimlik =
    s &&
    ((String(s.talepId) === String(row.id) &&
      (s.planSha === String(row.plan_sha || '').trim() || (s.planSha === '-' && olumsuz))) ||
      (s.talepId === '-' && olumsuz));
  const tutarli = kimlik && (!p.tenantKey || p.tenantKey === row.tenant_key);
  if (!tutarli) return { durum: 'OLCULEMEDI', kod: s ? 'NODESUM_UYUSMUYOR' : 'NODESUM_YOK', json };
  return { durum: SUM_DURUM[s.sonuc], kod: s.kod && s.kod !== '-' ? s.kod : null, json };
}

/** ACILIYOR kalmis satirin Smart bileti acilmis mi (yerel guncelleme dustu)? */
async function biletiBul(db, talepId) {
  const r = await db.query(
    `SELECT TOP 1 id, external_ticket_id FROM smart_tickets WHERE pending_launch_json LIKE $1 ORDER BY id DESC`,
    [`%"crypto_hub_node_talep":${Number(talepId)}[,}]%`],
  );
  return r && r.rows && r.rows[0] ? r.rows[0] : null;
}

/**
 * Tek acik satiri bir adim ilerletir. Okunamayan dis kaynak (Smart / AWX) satiri ACIK birakir:
 * sonraki tur yeniden dener (sonuc uydurulmaz).
 * @returns {Promise<string|null>} yapilan is (test/iz icin)
 */
async function satiriIlerlet(db, row, yol = 'tarama', simdi = Date.now()) {
  const yasDk = (simdi - zamanMs(row.created_at)) / 60000;
  const denetim = { username: row.username, tenant: row.tenant_key, grup: row.grup, yol };
  if (row.durum === 'ACILIYOR') {
    if (!(yasDk > ACILIS_DK)) return null;
    const onaysiz = row.sonuc_kod === ONAYSIZ_KOD;
    let b = null;
    try {
      b = onaysiz ? null : await biletiBul(db, row.id);
    } catch {
      return null;
    }
    if (b) {
      await db.query(
        `UPDATE crypto_hub_node_changes SET durum = 'BEKLIYOR', smart_ticket_id = $1, external_ticket_id = $2, updated_at = SYSUTCDATETIME() WHERE id = $3 AND kapandi_at IS NULL AND durum = 'ACILIYOR'`,
        [Number(b.id), b.external_ticket_id == null ? null : String(b.external_ticket_id), Number(row.id)],
      );
      return 'sahiplenildi';
    }
    await talepKapat(
      db,
      row.id,
      {
        durum: 'HATA',
        kod: 'ACILIS_KESILDI',
        json: bosSonuc({
          not: onaysiz
            ? METIN.dogrudanKesildi
            : "Smart'ta kayıt açılmış olabilir; Portal kaydı olmadığı için onaylansa da iş başlamaz.",
        }),
      },
      denetim,
    );
    return 'kapandi';
  }
  // Bileti olmayan CALISIYOR satiri Smart kapali dogrudan yoldur: asagida AWX sonucuyla kapanir.
  const dogrudan = row.smart_ticket_id == null && row.durum === 'CALISIYOR';
  if (row.smart_ticket_id == null && !dogrudan) {
    if (row.durum === 'BEKLIYOR' && yasDk > N.ONAY_DK) {
      await talepKapat(
        db,
        row.id,
        { durum: 'HATA', kod: 'YETIM_BILET', json: bosSonuc({ externalTicketId: row.external_ticket_id || null }) },
        denetim,
      );
      return 'kapandi';
    }
    return null;
  }
  // PS2: bilete baglanmis satira da UST YAS SINIRI. Onay suresi + betik butcesi + pay asilip is
  // sonucu hala okunamiyorsa (LAUNCHING'de takili, LAUNCHED ama job yok, SCHEDULED, Smart
  // yapilandirilmamis -> hic TIMEOUT olmayan PENDING, AWX kalici hata) satir OLCULEMEDI / TAKILDI
  // kapanir. BASARI SAYILMAZ: ekran "durum bilinmiyor, mevcut node'lari okuyun" der. Bilet hala
  // PENDING ise yerelde iptal edilir: poller sonradan onay gorse de isi BASLATMAZ.
  // Pencereli talepte bilet pencere boyunca PENDING bekler: sinir son baslamadan sayilir (normal
  // pencerede pencere sonu + 90 dk).
  const pencereSinirDk =
    (N.ocoSonBaslamaMs({
      basMs: zamanMs(row.oco_pencere_bas),
      sonMs: zamanMs(row.oco_pencere_son),
      talepMs: zamanMs(row.created_at),
    }) +
      (N.OCO_SON_PAY_DK + N.OCO_TAKILDI_PAY_DK) * 60000 -
      zamanMs(row.created_at)) /
    60000;
  const sinirAsildi =
    yasDk >
    (dogrudan
      ? DOGRUDAN_TAKILDI_DK
      : Number.isFinite(pencereSinirDk)
        ? Math.max(N.TAKILDI_DK, pencereSinirDk)
        : N.TAKILDI_DK);
  // Kolon bu okumada gelmediyse pencere bilinmiyor: sema okunamamis olabilir. "Kolon yok" kesinlesmeden
  // karar verilmez; gecici bir hata onayli talebi pencereden gunler once kapatirdi. Sonraki tur bakar.
  const pencereBilinmiyor =
    sinirAsildi && !dogrudan && !('oco_pencere_son' in row) && (await ocoKolonOku(db)) !== false;
  const takildi = sinirAsildi && !pencereBilinmiyor;
  const takildiKapat = async (neden, t) => {
    let iptal = false;
    if (t && t.status === 'PENDING') {
      try {
        iptal = !!(await require('../smart/store.cjs').cancelTicket(
          Number(row.smart_ticket_id),
          row.username,
          true,
          'Crypto Hub node talebi TAKILDI ile kapandi; is baslatilmaz.',
          'portal-crypto-hub',
        ));
      } catch {
        iptal = false;
      }
      // Iptal yarisi kaybedildiyse (poller bileti LAUNCHING'e almis olabilir) satir ve kilit
      // ACIK kalir: is sonradan kosarsa sonucu bu satira yazilir. Sonraki turda yeniden denenir.
      if (!iptal) return null;
    }
    await talepKapat(
      db,
      row.id,
      {
        durum: 'OLCULEMEDI',
        kod: 'TAKILDI',
        json: bosSonuc({ not: METIN.takildi, neden, smart: t ? { status: t.status, yerelIptal: iptal } : null }),
      },
      denetim,
    );
    return 'kapandi';
  };
  let serverId = row.awx_server_id == null ? null : Number(row.awx_server_id);
  let jobId = row.awx_job_id == null ? null : Number(row.awx_job_id);
  if (jobId == null && dogrudan) return takildi ? takildiKapat('dogrudan_job_yok', null) : null;
  if (jobId == null) {
    let t = null;
    try {
      t = await require('../smart/store.cjs').getTicket(Number(row.smart_ticket_id));
    } catch {
      return takildi ? takildiKapat('smart_kaydi_okunamadi', null) : null;
    }
    if (!t) return takildi ? takildiKapat('smart_kaydi_yok', null) : null;
    if (BILET_DURUM[t.status]) {
      await talepKapat(
        db,
        row.id,
        {
          durum: BILET_DURUM[t.status],
          kod: t.status,
          json: bosSonuc({
            smart: {
              status: t.status,
              stateName: t.smartStateName || null,
              hata: kirp(t.errorMessage || '', 500) || null,
              ...(t.approvedAt ? { onayGeldi: true } : {}),
            },
          }),
        },
        denetim,
      );
      return 'kapandi';
    }
    // PENDING / LAUNCHING / SCHEDULED (node bileti schedule dalina girmez ama poller bu durumu
    // yazabilir) / LAUNCHED-ama-job-yok: henuz is yok. Sinir asilmadiysa sonraki tur yeniden bakar.
    if (t.status !== 'LAUNCHED' || t.awxJobId == null) {
      return takildi ? takildiKapat(`bilet_${String(t.status || '').toLowerCase() || 'bilinmiyor'}`, t) : null;
    }
    serverId = Number(t.awxServerId);
    jobId = Number(t.awxJobId);
    await db.query(
      `UPDATE crypto_hub_node_changes SET durum = 'CALISIYOR', awx_server_id = $1, awx_job_id = $2, updated_at = SYSUTCDATETIME(), yeni_deger_secret = NULL WHERE id = $3 AND kapandi_at IS NULL`,
      [serverId, jobId, Number(row.id)],
    );
  }
  let st = null;
  try {
    st = await require('../ansible/runner.cjs').getJobStatusOnServer(serverId, jobId);
  } catch {
    // AWX kalici hata (is silinmis / sunucu kaldirilmis): sinir asildiysa TAKILDI.
    return takildi ? takildiKapat('awx_okunamadi', null) : 'calisiyor';
  }
  if (!st || !TERMINAL.includes(st.status)) return 'calisiyor';
  const s = isSonucu(row, st);
  await talepKapat(db, row.id, s, { ...denetim, awx: st.status });
  return 'kapandi';
}

/** Arka plan taramasi (5 dk) + GET /node-change/:id. Kapatilan satir sayisi. */
async function nodeSonuclariniTara() {
  const db = require('../db/index.cjs');
  const r = await db.query(
    `SELECT ${await sutunlar(db)} FROM crypto_hub_node_changes WHERE kapandi_at IS NULL`,
  );
  let n = 0;
  for (const row of (r && r.rows) || []) {
    try {
      if ((await satiriIlerlet(db, row, 'tarama')) === 'kapandi') n += 1;
    } catch (e) {
      console.warn('[CryptoHub] node talebi ilerletilemedi:', row.id, e.message);
    }
  }
  return n;
}

// ── Yetki ────────────────────────────────────────────────────────────────────────────
/** Okuma kapisi: app:metaco ya da node yetkisi + kiraci acik. Hata govdesi ya da null. */
function okumaKarari({ tenant, gorunen, nodeGorunen }) {
  if (!tenant) return hata(400, 'node_girdi', METIN.girdi('bilinmeyen kiracı'));
  if (tenant.app !== 'metaco') return hata(400, 'node_girdi', METIN.girdi('kiracı Metaco değil'));
  if (!((gorunen && gorunen.has('metaco')) || nodeGorunen)) {
    return hata(403, 'node_okuma_yetki_yok', METIN.okumaYetkiYok);
  }
  if (!N.nodeAcikMi(tenant)) return hata(403, 'node_kapali', METIN.kapali);
  return null;
}

const cevap = (res, h) => res.status(h.status).json({ ok: false, blocked: h.blocked, message: h.message });

// ── Uclar ────────────────────────────────────────────────────────────────────────────
/**
 * @param {import('express').Router} router  index.cjs router'i: kimlik kapisi (router.use) +
 *   requireVisible('CryptoHub') orada zaten bagli; bu modul kapiyi import ETMEZ.
 * @param {{gorunenUygulamalar: Function, nodeYetkisi: Function, kullanici: Function,
 *          loadTenant: Function, gecmisIcin: Function}} deps
 */
function initCryptoHubNode(router, deps) {
  const { gorunenUygulamalar, nodeYetkisi, kullanici, loadTenant, gecmisIcin } = deps;
  const RES = require('./resources.cjs');

  async function kapi(req, res, tenant) {
    const [gorunen, nodeGorunen] = await Promise.all([gorunenUygulamalar(req), nodeYetkisi(req)]);
    const h = okumaKarari({ tenant, gorunen, nodeGorunen });
    if (h) {
      cevap(res, h);
      return null;
    }
    if (!tenant.namespace) {
      cevap(res, hata(409, 'node_girdi', METIN.girdi('ortam henüz yapılandırılmadı')));
      return null;
    }
    return { gorunen, nodeGorunen };
  }

  async function registry() {
    const reg = require('../ansible/playbook-registry.cjs');
    const row = await reg.getByKey(OPS_KEY).catch(() => null);
    const templateId = row && row.enabled !== false ? reg.getEffectiveTemplateId(row) : null;
    const serverId = row && row.awxServerId != null ? Number(row.awxServerId) : 0;
    return { templateId, serverId };
  }

  /** Okuma isi bittiyse sonucu bellege al. Donus: {status, bitti, okuma?} */
  async function okumaIsiniYokla(tenant, serverId, jobId, username) {
    const st = await require('../ansible/runner.cjs').getJobStatusOnServer(serverId, jobId);
    const bitti = TERMINAL.includes(st.status);
    if (!bitti) return { status: st.status, bitti };
    const is = OKUMA_ISLERI.get(tenant.key);
    if (is && Number(is.jobId) === Number(jobId) && Number(is.serverId) === Number(serverId)) {
      OKUMA_ISLERI.delete(tenant.key);
    }
    const { extractStatsKey } = require('../opsx/index.cjs');
    const stats = extractStatsKey(st.artifacts, 'crypto_hub_ops_result');
    const p = parseNodeLines(stats && stats.lines);
    if (!p) return { status: st.status, bitti, okuma: null };
    if (p.tenantKey && p.tenantKey !== tenant.key) {
      throw Object.assign(new Error('İş çıktısı kayıtlı ortamla uyuşmuyor.'), { status: 403 });
    }
    const fin = Date.parse(st.finished || '');
    const at = Number.isFinite(fin) ? fin : Date.now();
    okumaKaydet(tenant.key, p, at, { jobId, serverId, username });
    const k = NODE_OKUMA.get(tenant.key);
    return {
      status: st.status,
      bitti,
      okuma: {
        at: new Date(k.at).toISOString(),
        eksik: k.eksik,
        araclar: { stdinEnv: k.parsed.araclar.stdinEnv, patchFile: k.parsed.araclar.patchFile },
        hatalar: k.parsed.hatalar.slice(0, 50),
      },
    };
  }

  async function acikTalepler(tenantKey) {
    const db = require('../db/index.cjs');
    const sut = await sutunlar(db);
    const [acik, son] = await Promise.all([
      db.query(`SELECT ${sut} FROM crypto_hub_node_changes WHERE tenant_key = $1 AND kapandi_at IS NULL`, [
        tenantKey,
      ]),
      db.query(
        `SELECT TOP 20 ${sut} FROM crypto_hub_node_changes WHERE tenant_key = $1 ORDER BY created_at DESC, id DESC`,
        [tenantKey],
      ),
    ]);
    const bekleyenler = new Map();
    const onaylilar = new Set();
    for (const r of (acik && acik.rows) || []) {
      const pencereBekliyor = await pencereBekleyenMi(r);
      if (pencereBekliyor) onaylilar.add(Number(r.id));
      bekleyenler.set(r.kilit, {
        talepId: Number(r.id),
        externalTicketId: r.external_ticket_id || null,
        username: r.username,
        createdAt: tarih(r.created_at),
        durum: r.durum,
        pencereBekliyor,
      });
    }
    const gecmis = ((son && son.rows) || [])
      .map(talepOzeti)
      .map((x) => ({ ...x, pencereBekliyor: onaylilar.has(x.talepId) }));
    return { bekleyenler, gecmis };
  }

  router.get('/nodes', async (req, res) => {
    const tenant = tenantOf(req.query.tenant);
    const g = await kapi(req, res, tenant);
    if (!g) return;
    const ben = kullanici(req);
    const simdi = Date.now();
    // Suren okuma varsa bir kez yoklanir: ekran kapansa da sonuc bellege gecer.
    const is = OKUMA_ISLERI.get(tenant.key);
    if (is) {
      if (simdi - is.at > OKUMA_IS_MS) OKUMA_ISLERI.delete(tenant.key);
      else await okumaIsiniYokla(tenant, is.serverId, is.jobId, is.username).catch(() => null);
    }
    let veri = null;
    try {
      veri = await loadTenant(tenant);
    } catch {
      veri = null;
    }
    let bekleyenler = new Map();
    let gecmis = [];
    let gecmisOkunamadi = false;
    try {
      ({ bekleyenler, gecmis } = await acikTalepler(tenant.key));
    } catch (e) {
      console.warn('[CryptoHub] node talepleri okunamadi:', e.message);
      gecmisOkunamadi = true;
    }
    const nodeAcik = N.nodeAcikMi(tenant);
    const talepYetkisi = g.nodeGorunen === true;
    const okuma = NODE_OKUMA.get(tenant.key) || null;
    const suren = OKUMA_ISLERI.get(tenant.key) || null;
    const opts = { nodeAcik, talepYetkisi: talepYetkisi && !gecmisOkunamadi, bekleyenler };
    const gruplar = okuma
      ? gruplariKur(okuma.parsed, opts)
      : taramadanGruplar(tenant, veri && veri.components, opts);
    const scanDate = veri && veri.scannedAt ? tarih(veri.scannedAt) : null;
    const esKey = N.esKiraciOf(tenant.key);
    // Yalniz ekran metinleri icin: gercek karar talep aninda yeniden okunur.
    let smartMod = 'onay';
    let smartKaynak = null;
    // Okunamazsa ekran alani gosterir (fail-closed); talep zaten 503 alir.
    let ocoGerekli = true;
    try {
      const k = await SA.cryptoSmartCoz(tenant);
      smartMod = k.mod;
      smartKaynak = k.kaynak;
      ocoGerekli = k.ocoGerekli;
    } catch (e) {
      console.warn('[CryptoHub] Smart ayari okunamadi:', e.message);
    }
    res.json({
      ok: true,
      smartMod,
      smartKaynak,
      ocoGerekli,
      tenant: {
        key: tenant.key,
        label: `${tenant.appLabel} ${tenant.domainLabel} ${tenant.envLabel}`,
        lokasyon: N.lokasyon(tenant),
        cluster: tenant.cluster,
        namespace: tenant.namespace,
        production: tenant.production,
        nodeAcik,
        esKiraci: esKey,
      },
      yetki: { okuma: true, talep: talepYetkisi, admin: ben.role === 'Admin' },
      tarama: {
        scanDate,
        eski: !scanDate || simdi - zamanMs(scanDate) > 24 * 60 * 60 * 1000,
      },
      okuma: {
        durum: suren ? 'suruyor' : !okuma ? 'yok' : simdi - okuma.at <= N.OKUMA_TAZE_MS ? 'taze' : 'bayat',
        at: okuma ? new Date(okuma.at).toISOString() : null,
        username: okuma ? okuma.username : null,
        jobId: suren ? suren.jobId : okuma ? okuma.jobId : null,
        awxServerId: suren ? suren.serverId : okuma ? okuma.serverId : null,
        eksik: okuma ? okuma.eksik : false,
        araclar: okuma
          ? { stdinEnv: okuma.parsed.araclar.stdinEnv, patchFile: okuma.parsed.araclar.patchFile }
          : null,
      },
      gruplar,
      gecmis: gecmis.map((x) => ({
        ...x,
        grupBaslik: (okuma && okuma.parsed.gruplar.get(x.grup) && okuma.parsed.gruplar.get(x.grup).baslik) || null,
      })),
      gecmisOkunamadi,
    });
  });

  router.post('/node-read', async (req, res) => {
    const tenant = tenantOf(req.body && req.body.tenant);
    const g = await kapi(req, res, tenant);
    if (!g) return;
    const ben = kullanici(req);
    const simdi = Date.now();
    const suren = OKUMA_ISLERI.get(tenant.key);
    if (suren && simdi - suren.at <= OKUMA_IS_MS) {
      return res.json({ ok: true, jobId: suren.jobId, awxServerId: suren.serverId, devam: true });
    }
    try {
      const { templateId, serverId } = await registry();
      if (!templateId) return res.status(501).json({ ok: false, message: METIN.templateYok });
      const ev = {
        crypto_hub_tenant: tenant.key,
        crypto_hub_action: 'node_env_get',
        crypto_hub_targets: '',
        crypto_hub_timeout: 600,
      };
      await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(
        serverId,
        templateId,
        ev,
        { label: OPS_KEY },
      );
      const result = await require('../ansible/runner.cjs').launchJobOnServer(
        serverId,
        templateId,
        ev,
        '',
        ben,
      );
      const jobId = result && result.jobId != null ? Number(result.jobId) : null;
      if (jobId != null) {
        OKUMA_ISLERI.set(tenant.key, { serverId, jobId, at: simdi, username: ben.username || null });
        RES.isKaydet(serverId, jobId, {
          username: ben.username || 'unknown',
          tenantKey: tenant.key,
          action: 'node_env_get',
        });
      }
      try {
        await require('../db/index.cjs').query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            ben.username || 'unknown',
            serverId,
            templateId,
            `Crypto Hub: node_env_get @ ${tenant.key}`,
            jobId,
            (result && result.status) || 'pending',
            JSON.stringify(await gecmisIcin(serverId, templateId, ev)),
          ],
        );
      } catch (e) {
        console.warn('[CryptoHub] node okuma gecmisi yazilamadi:', e.message);
      }
      try {
        require('../audit/index.cjs').auditPortal(req, 'crypto_hub_node_env_get', {
          detail: JSON.stringify({ tenant: tenant.key, jobId }),
        });
      } catch {
        /* denetim yazilamadi */
      }
      res.json({ ok: true, jobId, awxServerId: serverId, devam: false });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  router.get('/node-read/:serverId/:jobId', async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) {
      return cevap(res, hata(400, 'node_girdi', METIN.girdi('iş numarası')));
    }
    // Is bu kiracinin node_env_get'i olmali (bellek ya da is gecmisi). Sahiplik ARANMAZ:
    // cikti kiraci duzeyinde ve maskeli.
    let kayit = null;
    for (const [k, v] of OKUMA_ISLERI) {
      if (Number(v.serverId) === serverId && Number(v.jobId) === jobId) {
        kayit = { tenantKey: k, action: 'node_env_get' };
      }
    }
    if (!kayit) {
      try {
        kayit = await RES.isKaydiBul(require('../db/index.cjs'), serverId, jobId);
      } catch {
        return res
          .status(503)
          .json({ ok: false, message: 'İş sahipliği doğrulanamadı, lütfen tekrar deneyin.' });
      }
    }
    if (!kayit || kayit.yabanci || kayit.action !== 'node_env_get') {
      return res.status(403).json({ ok: false, message: 'Bu iş bir node okuma işi değil.' });
    }
    const tenant = tenantOf(kayit.tenantKey);
    const g = await kapi(req, res, tenant);
    if (!g) return;
    try {
      const r = await okumaIsiniYokla(tenant, serverId, jobId, kayit.username || null);
      res.json({ ok: true, ...r });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  router.post('/node-change', async (req, res) => {
    const r = await talepAc(req, { nodeYetkisi, kullanici, onizleme: false });
    res.status(r.status).json(r.body);
  });

  router.get('/node-change/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return cevap(res, hata(400, 'node_girdi', METIN.girdi('talep no')));
    const db = require('../db/index.cjs');
    let row;
    const sut = await sutunlar(db);
    try {
      const r = await db.query(`SELECT ${sut} FROM crypto_hub_node_changes WHERE id = $1`, [id]);
      row = r && r.rows && r.rows[0];
    } catch (e) {
      return res.status(503).json({ ok: false, message: 'Talep okunamadı, lütfen tekrar deneyin.' });
    }
    if (!row) return res.status(404).json({ ok: false, message: 'Talep bulunamadı.' });
    const tenant = tenantOf(row.tenant_key);
    const g = await kapi(req, res, tenant);
    if (!g) return;
    if (!row.kapandi_at) {
      try {
        if (await satiriIlerlet(db, row, 'ekran')) {
          const r2 = await db.query(`SELECT ${sut} FROM crypto_hub_node_changes WHERE id = $1`, [id]);
          if (r2 && r2.rows && r2.rows[0]) row = r2.rows[0];
        }
      } catch (e) {
        console.warn('[CryptoHub] node talebi ilerletilemedi:', id, e.message);
      }
    }
    let smart = null;
    if (row.smart_ticket_id != null) {
      try {
        const t = await require('../smart/store.cjs').getTicket(Number(row.smart_ticket_id));
        if (t) {
          // Poller'in TIMEOUT yazacagi an: tek kaynak deadline.cjs.
          const { deadline } = require('../smart/deadline.cjs').talepSonTarihi(t, require('../smart/config.cjs').getConfig());
          smart = {
            status: t.status,
            statusName: t.smartStateName || null,
            sonTarih: deadline ? deadline.toISOString() : null,
            hata: t.errorMessage || null,
            approvedAt: tarih(t.approvedAt),
            pencereBekliyor: onayliBekliyor(t),
          };
        }
      } catch {
        smart = null;
      }
    }
    res.json({
      ok: true,
      talep: talepOzeti(row),
      smart,
      esTalepOnerisi: esOnerisi(tenant, row.grup, Number(row.id)),
    });
  });

  router.post('/node-smart-onizle', async (req, res) => {
    if (kullanici(req).role !== 'Admin') {
      return res.status(403).json({ ok: false, error: 'Bu işlem için yönetici yetkisi gerekli.' });
    }
    const r = await talepAc(req, { nodeYetkisi, kullanici, onizleme: true });
    res.status(r.status).json(r.body);
  });

  // PS2: takili acik talebi YALNIZ Admin, gerekceyle kapatir (denetime yazilir). Bilet hala
  // PENDING ise yerelde iptal edilir (poller sonradan onay gorse de isi baslatmaz).
  router.post('/node-change/:id/kapat', async (req, res) => {
    const ben = kullanici(req) || {};
    if (ben.role !== 'Admin') {
      return res.status(403).json({ ok: false, message: 'Bu işlem için yönetici yetkisi gerekli.' });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return cevap(res, hata(400, 'node_girdi', METIN.girdi('talep no')));
    const gerekce = tekSatir(req.body && req.body.gerekce);
    if (gerekce.length < N.GEREKCE_EN_AZ || gerekce.length > N.GEREKCE_EN_COK) {
      return cevap(res, hata(400, 'node_gerekce', METIN.gerekce));
    }
    const db = require('../db/index.cjs');
    let row;
    const sut = await sutunlar(db);
    try {
      const r = await db.query(`SELECT ${sut} FROM crypto_hub_node_changes WHERE id = $1`, [id]);
      row = r && r.rows && r.rows[0];
    } catch {
      return res.status(503).json({ ok: false, message: 'Talep okunamadı, lütfen tekrar deneyin.' });
    }
    if (!row) return res.status(404).json({ ok: false, message: 'Talep bulunamadı.' });
    const tenant = tenantOf(row.tenant_key);
    const g = await kapi(req, res, tenant);
    if (!g) return;
    if (row.kapandi_at) return res.status(409).json({ ok: false, message: 'Talep zaten kapanmış.' });
    // AWX isi baslamis talep kapatilmaz: kilit birakilirsa ikinci bir degisiklik ayni gruba
    // yazabilir. Is sonucu okunamazsa satir TAKILDI suresi dolunca kendiliginden kapanir.
    if (row.awx_job_id != null) {
      return res.status(409).json({
        ok: false,
        message: `AWX işi #${row.awx_job_id} başlamış; talep iş sonucu okununca ya da süre dolunca kendiliğinden kapanır.`,
      });
    }
    // ACILIYOR satiri ile Smart biletinin DB'ye baglanmasi arasinda kisa bir pencere vardir.
    // Bu sirada kilidi acmak, dis bilet olustuktan sonra ayni gruba ikinci isi sokabilir.
    if (row.smart_ticket_id == null) {
      const onaysiz = row.durum === 'CALISIYOR' || row.sonuc_kod === ONAYSIZ_KOD;
      return res.status(409).json({
        ok: false,
        message: onaysiz ? METIN.dogrudanKapatilmaz : 'Smart kaydı henüz talebe bağlanmadı; talep kapatılmadı.',
      });
    }
    let smart = null;
    const store = require('../smart/store.cjs');
    try {
      const t = await store.getTicket(Number(row.smart_ticket_id));
      if (!t) {
        return res.status(503).json({ ok: false, message: 'Smart kaydı okunamadı; talep kapatılmadı. Lütfen tekrar deneyin.' });
      }
      smart = { status: t.status, yerelIptal: false };
      // Yalniz henuz sahiplenilmemis PENDING bilet atomik olarak iptal edilebilir.
      // APPROVED/LAUNCHING/LAUNCHED gibi bir durumda AWX numarasi satira yazilmamis olsa
      // bile poller isi baslatmak uzere olabilir; kilidi acmak ikinci isi yaristirir.
      if (t.status !== 'PENDING') {
        return res.status(409).json({ ok: false, message: 'Smart kaydı artık beklemede değil; talep kapatılmadı.' });
      }
      smart.yerelIptal = !!(await store.cancelTicket(
        Number(row.smart_ticket_id),
        ben.username || '',
        true,
        kirp(`Crypto Hub node talebi yonetici tarafindan kapatildi: ${gerekce}`, 1000),
        ben.username || 'admin',
      ));
    } catch (e) {
      return res.status(503).json({ ok: false, message: 'Smart kaydı okunamadı; talep kapatılmadı. Lütfen tekrar deneyin.' });
    }
    // PENDING bilet iptal edilemediyse (poller onayi yakalamis olabilir) kapatma: is kosabilir.
    if (!smart.yerelIptal) {
      return res.status(409).json({ ok: false, message: 'Smart kaydı iptal edilemedi; talep kapatılmadı. Lütfen tekrar deneyin.' });
    }
    const kim = ben.username || 'admin';
    let kapatti = false;
    try {
      kapatti = await talepKapat(
        db,
        id,
        { durum: 'IPTAL', kod: 'ADMIN_KAPATTI', json: bosSonuc({ not: METIN.adminKapatti(kim), gerekce, smart }) },
        { username: kim, tenant: row.tenant_key, grup: row.grup, req, yol: 'admin' },
      );
    } catch (e) {
      return res.status(503).json({ ok: false, message: `Talep kapatılamadı: ${kirp(e.message, 200)}` });
    }
    if (!kapatti) return res.status(409).json({ ok: false, message: 'Talep bu arada kapandı.' });
    try {
      require('../audit/index.cjs').auditPortal(req, 'crypto_hub_node_change_admin_kapat', {
        detail: JSON.stringify({ talepId: id, tenant: row.tenant_key, grup: row.grup, durumOnce: row.durum, gerekce, smart }),
      });
    } catch {
      /* denetim yazilamadi - satir yine de kapandi (talepKapat denetimi yazdi) */
    }
    let son = row;
    try {
      const r2 = await db.query(`SELECT ${sut} FROM crypto_hub_node_changes WHERE id = $1`, [id]);
      if (r2 && r2.rows && r2.rows[0]) son = r2.rows[0];
    } catch {
      /* eski satir doner */
    }
    res.json({ ok: true, talep: talepOzeti(son), smart });
  });
}

/** Onay gelmis, is henuz sahiplenilmemis bilet. */
const onayliBekliyor = (t) => !!t && t.status === 'PENDING' && !!t.approvedAt;

/** Liste satiri icin: yalniz OCO'lu acik satirda bilet okunur. Okunamazsa "onay bekliyor" kalir. */
async function pencereBekleyenMi(r) {
  if (!r.oco_no || r.smart_ticket_id == null || r.durum !== 'BEKLIYOR') return false;
  try {
    return onayliBekliyor(await require('../smart/store.cjs').getTicket(Number(r.smart_ticket_id)));
  } catch {
    return false;
  }
}

/**
 * Istanbul talebinden sonra Ankara onerisi (D4). Yalniz es kiracisi olan kiracida. Deger
 * TASINMAZ: Ankara degerini kullanici sihirbazda yeniden yazar; bag esTalepId ile kurulur.
 */
function esOnerisi(tenant, grupId, talepId) {
  const esKey = tenant ? N.esKiraciOf(tenant.key) : null;
  const es = esKey ? tenantOf(esKey) : null;
  if (!es) return null;
  return {
    tenant: es.key,
    label: es.envLabel,
    acik: N.nodeAcikMi(es),
    grup: grupId,
    esTalepId: talepId,
  };
}

/**
 * OCO kapisi (D8). Satir yazilmadan ve Smart'a gidilmeden once calisir; onizlemede calismaz.
 * Karar ocoPencereKarari'nda; red metinleri burada.
 * @returns {Promise<{ok: true, oco: object}|{ok: false, status: number, blocked: string, message: string, ek: object}>}
 */
async function ocoKapisi({ db, ocoNumber, smartMod, simdi = new Date() }) {
  const red = (status, blocked, message, ek = { ocoRequired: true }) => ({ ...hata(status, blocked, message), ek });
  if (!(await ocoKolonlariVarMi(db))) return red(503, 'node_oco_kolon_yok', METIN.ocoKolonYok, {});
  const numara = String(ocoNumber == null ? '' : ocoNumber).trim();
  if (!numara) return red(400, 'node_oco_gerekli', METIN.ocoGerekli);
  const okunan = await require('../oco/pencere-oku.cjs').ocoPenceresiOku(numara, { now: simdi });
  if (!okunan.ok) return red(okunan.status, 'node_oco_okunamadi', okunan.message);
  const w = okunan.pencere;
  const { fmt } = require('../oco/window.cjs');
  const { kod, sonBaslamaMs } = N.ocoPencereKarari({
    basMs: w.windowStart.getTime(),
    sonMs: w.windowEnd.getTime(),
    simdiMs: simdi.getTime(),
    smartKapali: smartMod === 'kapali',
  });
  const sonBaslamaText = fmt(new Date(sonBaslamaMs));
  if (kod === 'gecersiz') return red(400, 'node_oco_gecersiz', METIN.ocoGecersiz);
  if (kod === 'gecti') return red(400, 'node_oco_gecti', w.message, { ocoExpired: true });
  if (kod === 'kisa') return red(400, 'node_oco_kisa', METIN.ocoKisa);
  if (kod === 'son_pay') return red(400, 'node_oco_son_baslama', METIN.ocoSonPay(sonBaslamaText));
  if (kod === 'ufuk') return red(400, 'node_oco_ufuk', METIN.ocoUfuk(w.windowStartText));
  if (kod === 'bekle_kapali') return red(400, 'node_oco_pencere_bekleniyor', METIN.ocoBekleKapali(w.windowStartText));
  return {
    ok: true,
    oco: {
      ocoNumber: okunan.ocoNumber,
      windowStart: w.windowStart,
      windowEnd: w.windowEnd,
      windowStartText: w.windowStartText,
      windowEndText: w.windowEndText,
      sonBaslamaMs,
      sonBaslamaText,
      bekleyecek: kod === 'bekle',
    },
  };
}

/** Denetim alanlari; OCO'suz talepte bos (denetim satiri degismez). */
function ocoDenetim(oco) {
  if (!oco) return {};
  return {
    ocoNo: oco.ocoNumber,
    pencere: {
      bas: oco.windowStart.toISOString(),
      son: oco.windowEnd.toISOString(),
      sonBaslama: new Date(oco.sonBaslamaMs).toISOString(),
    },
  };
}

/**
 * POST /node-change (ve onizleme). Sira sozlesme 9.1 ile BIREBIR. Govde: {tenant, grup, yeni,
 * bosOnay?, gerekce, bilesenler?, tutarsizlikOnay?, onayMetni?, esTalepId?, onaysizKabul?,
 * ocoNumber?}.
 * Onizleme deger ALMAZ.
 * @returns {Promise<{status:number, body:object}>}
 */
async function talepAc(req, { nodeYetkisi, kullanici, onizleme }) {
  const body = (req && req.body) || {};
  const red = (h) => ({
    status: h.status,
    body: {
      ok: false,
      blocked: h.blocked,
      message: h.message,
      ...(h.rol ? { rol: h.rol, neden: h.neden } : {}),
      ...(h.ek || {}),
    },
  });
  // 1
  const tenant = tenantOf(body.tenant);
  if (!tenant) return red(hata(400, 'node_girdi', METIN.girdi('bilinmeyen kiracı')));
  if (tenant.app !== 'metaco') return red(hata(400, 'node_girdi', METIN.girdi('kiracı Metaco değil')));
  // 2 - YALNIZ node yetkisi (app:metaco tek basina talep actirmaz).
  let yetki = false;
  try {
    yetki = (await nodeYetkisi(req)) === true;
  } catch {
    yetki = false;
  }
  if (!yetki) return red(hata(403, 'node_yetki_yok', METIN.yetkiYok));
  if (!N.nodeAcikMi(tenant)) return red(hata(403, 'node_kapali', METIN.kapali));
  // 3
  const grupId = String(body.grup || '').trim();
  if (!N.GRUP_RE.test(grupId)) return red(hata(400, 'node_girdi', METIN.girdi('grup')));
  const gerekce = String(body.gerekce == null ? '' : body.gerekce).trim();
  if (!onizleme && (gerekce.length < N.GEREKCE_EN_AZ || gerekce.length > N.GEREKCE_EN_COK)) {
    return red(hata(400, 'node_gerekce', METIN.gerekce));
  }
  // 4
  const okuma = NODE_OKUMA.get(tenant.key);
  if (!okuma || Date.now() - okuma.at > N.OKUMA_TAZE_MS || okuma.eksik) {
    return red(hata(409, 'node_okuma_bayat', METIN.okumaBayat));
  }
  // 5
  // Deger KIRPILMAZ (trim yok): bas/son bosluk desene takilir, ekran nedenini soyler.
  const plani = grupPlaniKur(okuma, grupId, onizleme ? null : body.yeni, {
    tutarsizlikOnay: onizleme ? true : body.tutarsizlikOnay === true,
    onayMetni: onizleme ? grupId : body.onayMetni,
    production: tenant.production,
    bilesenler: body.bilesenler == null ? null : body.bilesenler,
    bosOnay: body.bosOnay === true,
    onizleme: !!onizleme,
  });
  if (!plani.ok) return red(plani);
  let kod = null;
  if (!onizleme) {
    try {
      kod = planKodla(plani.plan, plani.expect, plani.newSha, plani.yeniB64);
    } catch (e) {
      return red(hata(400, 'node_girdi', METIN.girdi(e.message)));
    }
  }
  // 6
  // Okuma hatasi OpsX'e DUSMEZ (bilet yanlis onaycilara giderdi): 503.
  let karar;
  try {
    karar = await SA.cryptoSmartCoz(tenant);
  } catch (e) {
    console.warn('[CryptoHub] Smart ayari okunamadi:', e.message);
    return red(hata(503, 'crypto_node_smart_okunamadi', METIN.smartOkunamadi));
  }
  if (karar.yarim) return red(hata(503, 'crypto_node_smart_yarim', METIN.smartYarim));
  const { sa, kaynak: smartKaynak, mod: smartMod } = karar;
  // Onizleme kapali modda da Smart yolunda kalir: "acilinca bilet boyle olur" gosterir.
  const dogrudan = smartMod === 'kapali' && !onizleme;
  // onaysizKabul karari VERMEZ (smartKapaliMi govdeyi gormez), yalniz durdurur: kullanicinin onayladigi
  // metin sunucunun kararina uymuyorsa hicbir sey yazilmaz. Bayat sihirbaz onaysiz is baslatamasin.
  if (!onizleme && (body.onaysizKabul === true) !== dogrudan) {
    return red(hata(409, 'crypto_node_smart_mod_degisti', METIN.smartModDegisti));
  }
  if (!sa && !dogrudan) return red(hata(503, 'crypto_node_smart_yok', METIN.smartYok));
  // 7
  const reg = require('../ansible/playbook-registry.cjs');
  const regRow = await reg.getByKey(OPS_KEY).catch(() => null);
  const templateId = regRow && regRow.enabled !== false ? reg.getEffectiveTemplateId(regRow) : null;
  const serverId = regRow && regRow.awxServerId != null ? Number(regRow.awxServerId) : 0;
  if (!templateId) return { status: 501, body: { ok: false, message: METIN.templateYok } };
  // 8
  const db = require('../db/index.cjs');
  if (!(await indeksVarMi(db))) return red(hata(503, 'node_kilit_indeksi_yok', METIN.indeksYok));

  const ben = kullanici(req) || {};
  const username = ben.username || 'unknown';

  // Ankara talebi: Istanbul satiri dogrulanir (ayni grup, Istanbul kiracisi).
  let esTalep = null;
  if (body.esTalepId != null && body.esTalepId !== '') {
    const esId = Number(body.esTalepId);
    const kaynak = Object.keys(N.ES_KIRACI).find((k) => N.ES_KIRACI[k] === tenant.key);
    if (!Number.isInteger(esId) || esId <= 0 || !kaynak) {
      return red(hata(400, 'node_girdi', METIN.girdi('İstanbul talebi')));
    }
    let r = null;
    try {
      r = await db.query(`SELECT ${SUTUNLAR_OCOSUZ} FROM crypto_hub_node_changes WHERE id = $1`, [esId]);
    } catch {
      return { status: 503, body: { ok: false, message: 'İstanbul talebi okunamadı, lütfen tekrar deneyin.' } };
    }
    const row = r && r.rows && r.rows[0];
    if (!row || row.tenant_key !== kaynak || row.grup !== grupId) {
      return red(hata(400, 'node_girdi', METIN.girdi('İstanbul talebi bu grupla eşleşmiyor')));
    }
    esTalep = { id: esId, externalTicketId: row.external_ticket_id || null };
  } else {
    // PS6: bag istemcinin hatirlamasina BAGLI DEGIL. Sihirbaz kapanip elle yeniden acilsa da
    // Ankara talebi, Istanbul'da ayni grup icin son ES_TALEP_GUN gunde acilmis (reddedilmemis /
    // hatayla kapanmamis) ve henuz baska bir Ankara talebine baglanmamis talebe SUNUCUDA baglanir.
    const kaynak = Object.keys(N.ES_KIRACI).find((k) => N.ES_KIRACI[k] === tenant.key);
    if (kaynak) {
      try {
        const r = await db.query(
          `SELECT TOP 1 id, external_ticket_id FROM crypto_hub_node_changes WHERE tenant_key = $1 AND grup = $2 AND created_at >= DATEADD(day, -${Number(N.ES_TALEP_GUN)}, SYSUTCDATETIME()) AND durum NOT IN ('REDDEDILDI', 'HATA', 'IPTAL') AND id NOT IN (SELECT es_talep_id FROM crypto_hub_node_changes WHERE es_talep_id IS NOT NULL AND tenant_key = $3) ORDER BY created_at DESC, id DESC`,
          [kaynak, grupId, tenant.key],
        );
        const x = r && r.rows && r.rows[0];
        if (x) esTalep = { id: Number(x.id), externalTicketId: x.external_ticket_id || null };
      } catch (e) {
        console.warn('[CryptoHub] Istanbul talebi baglanamadi (Ankara talebi bagsiz acilir):', e.message);
      }
    }
  }

  // Sablon baglami. OpsX blogunda OpenShift template'inin degiskenleri + OpsX anahtar adlari; kendi
  // blokta crypto_hub_ops template'i ve varsayilan anahtar adlari (OpsX degerleri kendi flow'a karismaz).
  const runner = require('../ansible/runner.cjs');
  const kendiBlok = smartKaynak === 'crypto';
  const sablonVarsayilaniOku = () => sablonVarsayilanOku(kendiBlok ? OPS_KEY : OPSX_OPENSHIFT_KEY);
  let anahtarlar = { kaynak: smartKaynak };
  if (!kendiBlok && !dogrudan) {
    try {
      const cfgMod = require('../opsx/config.cjs');
      const cfg = await cfgMod.getConfig();
      anahtarlar = { ...anahtarlar, ...((cfg && cfg.openshift) || {}) };
      // OpsX ile ayni sabit ek degiskenler (opsx/index.cjs parseExtraVarLines(cfg.extraVars)).
      anahtarlar.staticVars =
        typeof cfgMod.parseExtraVarLines === 'function' ? cfgMod.parseExtraVarLines(anahtarlar.extraVars).vars : {};
    } catch {
      anahtarlar = { kaynak: smartKaynak };
    }
  }

  if (onizleme) {
    const ozet = ozetKur({ tenant, plani, gerekce: gerekce || '(önizleme)', username, esTalep, kaynak: smartKaynak });
    const sablonVarsayilan = await sablonVarsayilaniOku();
    try {
      const metadata = cryptoNodeMetadata(
        String(sa.metadataFields || ''),
        { username, email: ben.mail || '', templateName: `Crypto Hub: node_change @ ${tenant.key}`, templateId },
        ozet,
        sablonVarsayilan,
        anahtarlar,
      );
      return { status: 200, body: { ok: true, flowKey: sa.flowKey, kaynak: smartKaynak, smartMod, metadata } };
    } catch (e) {
      return {
        status: 200,
        body: { ok: true, flowKey: sa.flowKey, kaynak: smartKaynak, smartMod, metadata: null, hata: e.message },
      };
    }
  }

  // 8a - OCO kapisi (D8)
  let oco = null;
  if (karar.ocoGerekli) {
    const k = await ocoKapisi({ db, ocoNumber: body.ocoNumber, smartMod });
    if (!k.ok) return red(k);
    oco = k.oco;
  }

  // 8b - sifreleme anahtari kapisi (sozlesme 4.2/5): production'da anahtar yoksa satir yazilmaz,
  // Smart acilmaz (fail-closed). Dev/test'te encryptSecretValue anahtarsiz duz doner (mevcut
  // yardimci davranisi). Deger YALNIZ bu kolonda; pending_launch_json'da yer tutucu ''.
  let yeniSifreli;
  {
    const envMod = require('../db/env-overrides.cjs');
    if (process.env.NODE_ENV === 'production' && !envMod.getEncryptionKey()) {
      return red(hata(503, 'node_sifreleme_yok', METIN.sifrelemeYok));
    }
    try {
      yeniSifreli = envMod.encryptSecretValue(plani.yeniB64);
    } catch {
      return red(hata(503, 'node_sifreleme_yok', METIN.sifrelemeYok));
    }
  }

  // 9 - kilit: filtreli tekil indeks
  let talepId;
  try {
    // OCO kolonlari yalniz OCO'lu talepte yazilir: OCO'suz INSERT eski semada da calisir.
    const r = await db.query(
      `INSERT INTO crypto_hub_node_changes (tenant_key, grup, kilit, lokasyon, eski_ozet, yeni_ozet, hedefler, plan_sha, gerekce, username, durum, es_talep_id, yeni_deger_secret, sonuc_kod${oco ? ', oco_no, oco_pencere_bas, oco_pencere_son' : ''}) OUTPUT INSERTED.id VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACILIYOR', $11, $12, $13${oco ? ', $14, $15, $16' : ''})`,
      [
        tenant.key,
        grupId,
        plani.grup.kilit,
        N.lokasyon(tenant),
        plani.eskiOzet,
        plani.yeniOzet,
        kirp(plani.hedefler.join(','), 2000),
        kod.planSha,
        gerekce,
        username,
        esTalep ? esTalep.id : null,
        yeniSifreli,
        dogrudan ? ONAYSIZ_KOD : null,
        ...(oco ? [oco.ocoNumber, oco.windowStart, oco.windowEnd] : []),
      ],
    );
    talepId = Number(r && r.rows && r.rows[0] && r.rows[0].id);
    if (!Number.isInteger(talepId) || talepId <= 0) throw new Error('talep numarası dönmedi');
  } catch (e) {
    if (/2627|2601|duplicate|UNIQUE/i.test(String(e && (e.number ?? '')) + String(e && e.message))) {
      let no = N.talepNoMetni(null, null);
      try {
        const a = await db.query(
          `SELECT TOP 1 id, external_ticket_id FROM crypto_hub_node_changes WHERE tenant_key = $1 AND kilit = $2 AND kapandi_at IS NULL`,
          [tenant.key, plani.grup.kilit],
        );
        const x = a && a.rows && a.rows[0];
        if (x) no = N.talepNoMetni(x.external_ticket_id, Number(x.id));
      } catch {
        /* numara okunamadi - mesaj 'Portal #?' ile doner */
      }
      return red(hata(409, 'node_bekleyen_talep', METIN.bekleyen(no)));
    }
    console.warn('[CryptoHub] node talebi yazilamadi:', e.message);
    return { status: 503, body: { ok: false, message: 'Talep kaydı yazılamadı — talep açılmadı.' } };
  }
  const kapat = (durum, k, json) =>
    talepKapat(db, talepId, { durum, kod: k, json }, { username, tenant: tenant.key, grup: grupId, req, yol: 'acilis' }).catch(
      (e) => console.warn('[CryptoHub] node talebi kapatilamadi:', talepId, e.message),
    );

  // 10
  const awxExtraVars = nodeExtraVars({
    tenantKey: tenant.key,
    grupId,
    talepId,
    plan: plani.plan,
    expect: plani.expect,
    newSha: plani.newSha,
    hedefler: plani.hedefler,
    email: ben.mail || '',
  });
  // 11
  try {
    await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(
      serverId,
      templateId,
      awxExtraVars,
      { label: OPS_KEY },
    );
  } catch (e) {
    await kapat('HATA', 'PREFLIGHT', bosSonuc({ hata: kirp(e.message, 500) }));
    return { status: e.status || 409, body: { ok: false, message: e.message } };
  }
  let tamExtraVars = awxExtraVars;
  try {
    tamExtraVars = (await runner.prefillSurveyDefaultsOnServer(serverId, templateId, awxExtraVars)) || awxExtraVars;
  } catch (e) {
    console.warn('[CryptoHub] survey varsayilanlari doldurulamadi:', e.message);
  }
  // Yer tutucu KORUNUR: ankette crypto_hub_node_yeni_b64 icin zorunlu + varsayilanli bir soru
  // varsa prefill '' yerine '$encrypted$' koyar; kanca o zaman her talebi reddederdi.
  tamExtraVars = { ...tamExtraVars, crypto_hub_node_yeni_b64: '' };
  if (dogrudan) {
    return dogrudanBaslat({
      req, db, tenant, grupId, plani, gerekce, username, talepId, esTalep, serverId, templateId, tamExtraVars, kapat, oco,
    });
  }
  // 12
  const sablonVarsayilan = await sablonVarsayilaniOku();
  const ozet = ozetKur({ tenant, plani, gerekce, username, esTalep, kaynak: smartKaynak, oco });
  // 13
  let opened;
  try {
    opened = await require('../ansible/change-gates.cjs').openSmartTicket({
      server: { id: Number(serverId) },
      templateId: Number(templateId),
      username,
      email: ben.mail || '',
      templateName: `Crypto Hub: node_change @ ${tenant.key}`,
      overrides: { smartApproval: sa },
      extraVars: tamExtraVars,
      detail: { ask_limit_on_launch: false },
      resolvedLaunchOptions: {},
      // Launch sonrasi ansible_job_history.params / denetim / bilet ayrinti ekranlari degeri
      // '***gizli***' gorur (redactExtraVarsForHistory).
      specFields: [{ variable: 'crypto_hub_node_yeni_b64', type: 'password' }],
      buildSmartMetadata: (raw, ctx) => cryptoNodeMetadata(raw, ctx, ozet, sablonVarsayilan, anahtarlar),
      auditAction: 'crypto_hub_node_change_ticket_open',
      req,
      // launchOncesi: runner poller geri cagrisindaki TEK kanca (launchOncesiDegerEkle).
      // overrides: {} bekleyen paketteki smartApproval'i ezer: cozulmus token pending_launch_json'a
      // (duz metin) yazilmaz. Token yalniz createTicket'e gider; poller overrides.smartApproval okumaz.
      // Pencereli bilette onayZamanAsimiDk VERILMEZ: sure kurali son baslamadan once TIMEOUT yazardi.
      pendingLaunchExtras: {
        ...(oco
          ? {
              ocoNumber: oco.ocoNumber,
              ocoWindowStartIso: oco.windowStart.toISOString(),
              ocoWindowEndIso: oco.windowEnd.toISOString(),
              sonBaslamaIso: new Date(oco.sonBaslamaMs).toISOString(),
              pencereBekle: true,
            }
          : { onayZamanAsimiDk: N.ONAY_DK }),
        yutmaKorumasi: true,
        launchOncesi: 'crypto_hub_node',
        overrides: {},
      },
    });
  } catch (e) {
    if (e && e.blocked === 'crypto_node_smart_sablon') {
      await kapat('HATA', 'SMART_SABLON', bosSonuc({ hata: kirp(e.message, 500) }));
      return { status: 400, body: { ok: false, blocked: 'crypto_node_smart_sablon', message: e.message } };
    }
    if (e && e.code === 'smart_ticket_store_failed') {
      // Bilet dis sistemde ACIK: satir BEKLIYOR + dis numara ile kalir ki ikinci talep acilmasin;
      // tarama 24 sa sonra YETIM_BILET ile kapatir.
      try {
        await db.query(
          `UPDATE crypto_hub_node_changes SET durum = 'BEKLIYOR', external_ticket_id = $1, updated_at = SYSUTCDATETIME() WHERE id = $2 AND kapandi_at IS NULL`,
          [String(e.externalTicketId || ''), talepId],
        );
      } catch (e2) {
        console.warn('[CryptoHub] yetim bilet numarasi yazilamadi:', talepId, e2.message);
      }
      return {
        status: 500,
        body: {
          ok: false,
          blocked: 'smart_ticket_store_failed',
          externalTicketId: e.externalTicketId,
          message: METIN.yetimBilet(e.externalTicketId),
        },
      };
    }
    await kapat('HATA', 'SMART_HATA', bosSonuc({ hata: kirp(e && e.message, 500) }));
    return {
      status: 502,
      body: { ok: false, blocked: 'crypto_node_smart_hata', message: METIN.smartHata(e && e.message) },
    };
  }
  // 14
  let baglandi = false;
  try {
    const bag = await db.query(
      `UPDATE crypto_hub_node_changes SET durum = 'BEKLIYOR', smart_ticket_id = $1, external_ticket_id = $2, updated_at = SYSUTCDATETIME() WHERE id = $3 AND kapandi_at IS NULL`,
      [Number(opened.ticketId), String(opened.externalTicketId), talepId],
    );
    baglandi = !!bag && bag.rowCount === 1;
  } catch (e) {
    console.warn('[CryptoHub] node talebi bilete baglanamadi:', talepId, e.message);
  }
  if (!baglandi) {
    // Dis bilet acildi fakat Portal satirina baglanamadi. Basari uydurma; mumkunse PENDING
    // bileti iptal et. Iptal yarisi varsa ACILIYOR satiri kilidi korur ve tarama bileti
    // pending_launch_json icindeki talep numarasiyla sahiplenir.
    let yerelIptal = false;
    try {
      yerelIptal = !!(await require('../smart/store.cjs').cancelTicket(
        Number(opened.ticketId),
        username,
        true,
        'Crypto Hub node talebi Portal kaydina baglanamadi; is baslatilmaz.',
        username,
      ));
    } catch {
      yerelIptal = false;
    }
    if (yerelIptal) {
      await kapat('HATA', 'SMART_BAGLAMA', bosSonuc({ hata: 'Smart bileti Portal talebine bağlanamadı; bilet iptal edildi.' }));
    }
    // 424: kurumsal nginx 5xx govdesini HTML ile degistirir; kullanici Smart numarasini gormeli.
    return {
      status: 424,
      body: {
        ok: false,
        blocked: 'smart_ticket_link_failed',
        externalTicketId: opened.externalTicketId,
        message: yerelIptal
          ? 'Smart bileti talebe bağlanamadı ve iptal edildi. Lütfen yeniden deneyin.'
          : `Smart bileti talebe bağlanamadı. Smart #${opened.externalTicketId} kaydını kontrol edin.`,
      },
    };
  }
  // 15
  try {
    require('../audit/index.cjs').auditPortal(req, 'crypto_hub_node_change_talep', {
      detail: JSON.stringify({
        tenant: tenant.key,
        lokasyon: N.lokasyon(tenant),
        grup: grupId,
        hedefler: plani.hedefler,
        bilesenler: plani.secilenler,
        degismeyenler: plani.secilmeyenler,
        eskiOzet: plani.eskiOzet,
        yeniOzet: plani.yeniOzet,
        yeniSha: plani.newSha,
        bosRoller: plani.bosRoller,
        gerekce,
        talepId,
        ticketId: opened.ticketId,
        externalTicketId: opened.externalTicketId,
        esTalepId: esTalep ? esTalep.id : null,
        ...ocoDenetim(oco),
      }),
    });
  } catch {
    /* denetim yazilamadi - talep yine de acildi */
  }
  // 16
  const out = {
    ok: true,
    pendingApproval: true,
    ticketId: opened.ticketId,
    externalTicketId: opened.externalTicketId,
    talepId,
    ...(oco
      ? {
          oco: {
            ocoNumber: oco.ocoNumber,
            windowStartIso: oco.windowStart.toISOString(),
            windowEndIso: oco.windowEnd.toISOString(),
            sonBaslamaIso: new Date(oco.sonBaslamaMs).toISOString(),
            bekleyecek: oco.bekleyecek,
          },
          message: METIN.talepAcildiOco(opened.externalTicketId, oco.sonBaslamaText),
        }
      : { onayZamanAsimiDk: N.ONAY_DK, message: METIN.talepAcildi(opened.externalTicketId) }),
  };
  const oneri = esOnerisi(tenant, grupId, talepId);
  if (oneri) out.esTalepOnerisi = oneri;
  return { status: 200, body: out };
}

// Baglanti kurulamadi: istek AWX'e hic ulasmadi. ETIMEDOUT / ECONNRESET burada YOK, is baslamis olabilir.
const BAGLANTI_YOK = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

/** Is kesin baslamadi mi? Yalniz o zaman kilit birakilir; suphede satir acik kalir. */
function kesinRet(e) {
  if (e && (e.code === 'ss_launch_hazir_degil' || e.postOncesi === true || BAGLANTI_YOK.has(e.code))) return true;
  // Yutma korumasi: is acildi; iptal edilemediyse kosuyor olabilir.
  if (e && e.code === 'awx_prompt_on_launch_disabled') return e.iptalEdildi !== false;
  // httpStatus: JSON olmayan (vekil HTML) yanit; status tasimaz.
  const st = Number(e && (e.status ?? e.httpStatus));
  return st >= 400 && st < 500 && st !== 408;
}

/**
 * Smart kapali TEST kiracisi: talepAc'in prefill sonrasi dali. Sira bilincli: deger hazirlanmadan
 * satir sahiplenilmez, sahiplenmeden baslatilmaz, denetim baslatmadan once yazilir. Deger
 * sahiplenmede kolondan silinir; bundan sonra yalniz bellekte ve AWX extra_vars'ta durur.
 * @returns {Promise<{status: number, body: object}>}
 */
async function dogrudanBaslat({
  req, db, tenant, grupId, plani, gerekce, username, talepId, esTalep, serverId, templateId, tamExtraVars, kapat, oco = null,
}) {
  const ret = (status, blocked, message) => ({ status, body: { ok: false, blocked, message, talepId } });
  // (a) Preflight/prefill suresince ayar degismis olabilir; kiraci yine sabit listeden.
  let blob;
  try {
    blob = await SA.oku();
  } catch {
    await kapat('HATA', 'DOGRUDAN_AYAR', bosSonuc({ hata: METIN.smartOkunamadi }));
    return ret(503, 'crypto_node_smart_okunamadi', METIN.smartOkunamadi);
  }
  if (!SA.smartKapaliMi(tenantOf(tenant.key), blob)) {
    await kapat('HATA', 'DOGRUDAN_AYAR', bosSonuc({ hata: METIN.smartDegisti }));
    return ret(409, 'crypto_node_smart_degisti', METIN.smartDegisti);
  }
  // Ayar bu arada OCO'yu acmis ya da preflight son baslamayi gecirmis olabilir.
  if (!oco && SA.ocoGerekliMi(tenantOf(tenant.key), blob)) {
    await kapat('HATA', 'DOGRUDAN_AYAR', bosSonuc({ hata: METIN.ocoDegisti }));
    return ret(409, 'crypto_node_smart_degisti', METIN.ocoDegisti);
  }
  if (oco && Date.now() > oco.sonBaslamaMs) {
    await kapat('HATA', 'DOGRUDAN_AYAR', bosSonuc({ hata: METIN.ocoSonPay(oco.sonBaslamaText) }));
    return ret(409, 'node_oco_son_baslama', METIN.ocoSonPay(oco.sonBaslamaText));
  }
  // (b) Plan / zarf / sha denetimleri poller yoluyla ayni kanca.
  let hazir;
  try {
    hazir = await launchOncesiDegerEkle({ id: null, pendingLaunch: { extraVars: tamExtraVars } }, { db });
  } catch (e) {
    const m = kirp(e && e.message, 500);
    await kapat('HATA', 'DOGRUDAN_HAZIRLIK', bosSonuc({ hata: m }));
    return ret(409, 'crypto_node_dogrudan_hazirlik', METIN.dogrudanHazirlik(m));
  }
  // (c) CAS: tarama satiri bu arada kapattiysa is baslamaz.
  let sahiplendi = false;
  try {
    const r = await db.query(
      `UPDATE crypto_hub_node_changes SET durum = 'CALISIYOR', yeni_deger_secret = NULL, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'ACILIYOR' AND kapandi_at IS NULL`,
      [talepId],
    );
    sahiplendi = !!r && r.rowCount === 1;
  } catch (e) {
    console.warn('[CryptoHub] node talebi sahiplenilemedi:', talepId, e.message);
    await kapat('HATA', 'DOGRUDAN_SAHIPLENME', bosSonuc({ hata: 'Talep satırı güncellenemedi.' }));
    return ret(503, 'crypto_node_dogrudan_sahiplenme', 'Talep satırı güncellenemedi — iş başlatılmadı.');
  }
  if (!sahiplendi) return ret(409, 'crypto_node_dogrudan_sahiplenme', 'Talep bu arada kapandı — iş başlatılmadı.');
  // (d) Denetim AWX'ten ONCE: is sonrasi cokme onaysiz kosuyu izsiz birakmasin.
  try {
    require('../audit/index.cjs').auditPortal(req, 'crypto_hub_node_onaysiz_calisti', {
      detail: JSON.stringify({
        tenant: tenant.key,
        lokasyon: N.lokasyon(tenant),
        grup: grupId,
        talepId,
        hedefler: plani.hedefler,
        eskiOzet: plani.eskiOzet,
        yeniOzet: plani.yeniOzet,
        yeniSha: plani.newSha,
        gerekce,
        ...ocoDenetim(oco),
      }),
    });
  } catch {
    /* denetim yazilamadi - auditPortal zaten fire-and-forget */
  }
  const jobBagla = async (jobId) => {
    try {
      await db.query(
        `UPDATE crypto_hub_node_changes SET durum = 'CALISIYOR', awx_server_id = $1, awx_job_id = $2, updated_at = SYSUTCDATETIME(), yeni_deger_secret = NULL WHERE id = $3 AND kapandi_at IS NULL`,
        [serverId, jobId, talepId],
      );
    } catch (e) {
      // Satir CALISIYOR + job yok kalir: kilit korunur, 90 dk sonra TAKILDI kapanir.
      console.warn('[CryptoHub] node isi talebe baglanamadi:', talepId, e.message);
    }
    require('./resources.cjs').isKaydet(serverId, jobId, { username, tenantKey: tenant.key, action: 'node_change' });
  };
  // (e) launchJobOnServer ve gecmisIcin KULLANILMAZ: biri gizliler tasimaz, oteki degeri
  // gecmise duz yazar. performSsLaunch ikisini de cozer (specFields password -> '***gizli***').
  let sonuc;
  try {
    sonuc = await require('../ansible/runner.cjs').performSsLaunchOnServer(serverId, Number(templateId), {
      detail: { ask_limit_on_launch: false },
      extraVars: hazir.extraVars,
      resolvedLaunchOptions: {},
      specFields: [{ variable: 'crypto_hub_node_yeni_b64', type: 'password' }],
      overrides: {},
      username,
      templateName: `Crypto Hub: node_change @ ${tenant.key}`,
      req,
      yutmaKorumasi: true,
      gizliler: hazir.gizliler,
    });
  } catch (e) {
    // Token ucu hatasi sunucu yanitindan parca tasir: kullaniciya ve sonuc_json'a sabit metin.
    const m = e && e.postOncesi === true ? METIN.awxOturum : gizliTemizle(e && e.message, hazir.gizliler);
    if (kesinRet(e)) {
      await kapat('HATA', 'DOGRUDAN_HATA', bosSonuc({ hata: m }));
      return ret(409, 'crypto_node_dogrudan_hata', METIN.dogrudanHata(m));
    }
    // Yutma korumasi iptal edemedi: is KOSUYOR ve numarasi belli. Baglanmazsa sonucu hic okunmaz,
    // kilit 90 dk sonra is surerken acilirdi.
    const kosan = e && e.code === 'awx_prompt_on_launch_disabled' ? Number(e.jobId) : 0;
    if (Number.isInteger(kosan) && kosan > 0) {
      await jobBagla(kosan);
      return {
        status: 424,
        body: {
          ok: false,
          blocked: 'crypto_node_dogrudan_belirsiz',
          message: METIN.dogrudanIptalEdilemedi(kosan, talepId),
          talepId,
          jobId: kosan,
          awxServerId: serverId,
        },
      };
    }
    // Is baslamis olabilir: satir CALISIYOR kalir, kilit korunur; 90 dk sonra TAKILDI kapanir.
    console.warn('[CryptoHub] node isi belirsiz:', talepId, m);
    return ret(424, 'crypto_node_dogrudan_belirsiz', METIN.dogrudanBelirsiz(talepId));
  }
  const jobId = sonuc && sonuc.jobId != null ? Number(sonuc.jobId) : null;
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return ret(424, 'crypto_node_dogrudan_belirsiz', METIN.dogrudanBelirsiz(talepId));
  }
  // (f)
  await jobBagla(jobId);
  // (g)
  try {
    require('../audit/index.cjs').auditPortal(req, 'crypto_hub_node_change_talep', {
      detail: JSON.stringify({
        tenant: tenant.key,
        lokasyon: N.lokasyon(tenant),
        grup: grupId,
        hedefler: plani.hedefler,
        bilesenler: plani.secilenler,
        degismeyenler: plani.secilmeyenler,
        eskiOzet: plani.eskiOzet,
        yeniOzet: plani.yeniOzet,
        yeniSha: plani.newSha,
        bosRoller: plani.bosRoller,
        gerekce,
        talepId,
        ticketId: null,
        externalTicketId: null,
        onaysiz: true,
        awxJobId: jobId,
        esTalepId: esTalep ? esTalep.id : null,
        ...ocoDenetim(oco),
      }),
    });
  } catch {
    /* denetim yazilamadi - is yine de basladi */
  }
  // (h)
  const out = {
    ok: true,
    pendingApproval: false,
    onaysiz: true,
    talepId,
    jobId,
    awxServerId: serverId,
    message: METIN.onaysizBasladi(jobId),
  };
  const oneri = esOnerisi(tenant, grupId, talepId);
  if (oneri) out.esTalepOnerisi = oneri;
  return { status: 200, body: out };
}

// ── Launch oncesi kanca (sozlesme 4.3) ──────────────────────────────────────────────
// runner.cjs poller geri cagrisi YALNIZ `pendingLaunch.launchOncesi === 'crypto_hub_node'` iken
// cagirir; dogrudanBaslat da ayni denetimler icin buradan gecer. Bekleyen paketteki yer tutucu '' yerine sifreli kolondaki degeri koyar; paketin
// kendisi DEGISMEZ (kopya doner). Her ret ASCII bir neden tasir, DEGER ICERMEZ.
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * @param {{id: number|null, pendingLaunch: {extraVars: object}}} ticket  smart_tickets kaydi ya da
 *   dogrudan yolun id:null sahte kaydi
 * @param {{db?: {query: Function}}} [o]
 * @returns {Promise<{extraVars: object, gizliler: string[]}>}
 */
async function launchOncesiDegerEkle(ticket, { db } = {}) {
  const pl = (ticket && ticket.pendingLaunch) || {};
  const ev = (pl && pl.extraVars) || {};
  const talepId = Number(ev.crypto_hub_node_talep);
  const gecerliNo = Number.isInteger(talepId) && talepId > 0;
  const red = (neden) => {
    throw new Error(`Crypto Hub node talebi #${gecerliNo ? talepId : '?'}: ${neden}`);
  };
  if (!gecerliNo) red('talep no gecersiz');
  if (ev.crypto_hub_node_yeni_b64 !== '') red('bekleyen pakette deger var (beklenmiyor)');
  const vt = db || require('../db/index.cjs');
  let row = null;
  try {
    const r = await vt.query(
      `SELECT id, tenant_key, grup, plan_sha, smart_ticket_id, kapandi_at, yeni_deger_secret FROM crypto_hub_node_changes WHERE id = $1`,
      [talepId],
    );
    row = r && r.rows && r.rows[0];
  } catch {
    red('kayit okunamadi');
  }
  if (!row) red('kayit yok');
  if (row.kapandi_at != null) red('talep kapanmis');
  if (row.tenant_key !== ev.crypto_hub_tenant || row.grup !== ev.crypto_hub_node_grup) red('kayit uyusmuyor');
  // ACILIYOR'da kalmis satirda (bilete baglanamadi) smart_ticket_id null olabilir: kabul.
  if (row.smart_ticket_id != null && Number(row.smart_ticket_id) !== Number(ticket.id)) red('bilet uyusmuyor');
  const planSha = sha256(
    String(ev.crypto_hub_node_plan_b64 || '') +
      String(ev.crypto_hub_node_expect_b64 || '') +
      String(ev.crypto_hub_node_new_sha_b64 || ''),
  );
  if (planSha !== String(row.plan_sha || '').trim()) red('plan ozeti uyusmuyor');
  const sakli = row.yeni_deger_secret;
  if (sakli == null || sakli === '') red('deger yok (temizlenmis)');
  const envMod = require('../db/env-overrides.cjs');
  if (process.env.NODE_ENV === 'production' && !String(sakli).startsWith(envMod.ENC_PREFIX)) red('deger sifresiz');
  let yeniB64 = '';
  try {
    yeniB64 = envMod.decryptSecretValue(String(sakli));
  } catch {
    red('deger cozulemedi');
  }
  let zarf = null;
  let newSha = null;
  try {
    if (!B64_RE.test(yeniB64) || yeniB64.length > N.YENI_B64_AZAMI) throw new Error('b64');
    zarf = JSON.parse(Buffer.from(yeniB64, 'base64').toString('utf8'));
    newSha = JSON.parse(Buffer.from(String(ev.crypto_hub_node_new_sha_b64 || ''), 'base64').toString('utf8'));
  } catch {
    red('deger bicimi gecersiz');
  }
  const nesne = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  if (!nesne(zarf) || !ayniKume(new Set(Object.keys(zarf)), new Set(['degerler', 'bos_onay']))) {
    red('deger bicimi gecersiz');
  }
  const degerler = zarf.degerler;
  if (!nesne(degerler) || Object.values(degerler).some((v) => typeof v !== 'string')) red('deger bicimi gecersiz');
  const bos = Object.keys(degerler).filter((r) => degerler[r] === '');
  const bosOnay = zarf.bos_onay;
  if (
    !Array.isArray(bosOnay) ||
    bosOnay.some((x) => typeof x !== 'string') ||
    new Set(bosOnay).size !== bosOnay.length ||
    !ayniKume(new Set(bosOnay), new Set(bos))
  ) {
    red('deger bicimi gecersiz');
  }
  if (
    !nesne(newSha) ||
    !ayniKume(new Set(Object.keys(newSha)), new Set(Object.keys(degerler))) ||
    Object.keys(degerler).some((r) => sha256(degerler[r]) !== newSha[r])
  ) {
    red('deger ozeti uyusmuyor');
  }
  return {
    extraVars: { ...ev, crypto_hub_node_yeni_b64: yeniB64 },
    gizliler: [yeniB64, ...Object.values(degerler).filter((v) => v !== '')],
  };
}

/**
 * Poller geri cagrisinda kancadan ONCE: pencereli bilet yalniz acik pencerede ve son baslamaya kadar
 * baslar. 'schedule' sonucu da rettir; poller pencereyi bekler, AWX schedule kurulmaz. Pencere alani
 * olmayan bilet (OCO'suz talep) gecer. Throw eden bilet ERROR olur, is baslamaz.
 * @param {object} pl pendingLaunch
 * @param {Date} [simdi]
 */
function launchPenceresiDenetle(pl, simdi = new Date()) {
  const { ocoWindowStartIso, ocoWindowEndIso, sonBaslamaIso, pencereBekle } = pl || {};
  if (!ocoWindowStartIso && !ocoWindowEndIso) return;
  if (!ocoWindowStartIso || !ocoWindowEndIso || pencereBekle !== true) {
    throw new Error(METIN.ocoPaketEksik);
  }
  const plan = require('../oco/window.cjs').nextRunAt({
    windowStart: new Date(ocoWindowStartIso),
    windowEnd: new Date(ocoWindowEndIso),
    now: simdi,
  });
  if (plan.mode === 'none') throw new Error(plan.reason);
  if (plan.mode !== 'now') throw new Error(METIN.ocoAcilmadi);
  const son = new Date(sonBaslamaIso).getTime();
  if (!Number.isFinite(son) || simdi.getTime() > son) {
    throw new Error(METIN.ocoSonGecti);
  }
}

/** Hata metninden bilinen degerleri cikarir (Python `temizle` aynasi): uzun olan once. */
function gizliTemizle(metin, gizliler) {
  let s = String(metin == null ? '' : metin);
  const liste = [...new Set((gizliler || []).filter((x) => typeof x === 'string' && x))].sort(
    (a, b) => b.length - a.length,
  );
  for (const g of liste) s = s.split(g).join('****');
  return s.slice(0, 500);
}

module.exports = {
  NODE_OPS,
  METIN,
  maskeGuvenli,
  parseNodeLines,
  grupAnalizi,
  gruplariKur,
  taramadanGruplar,
  grupPlaniKur,
  planKodla,
  nodeExtraVars,
  ozetKur,
  cryptoNodeMetadata,
  taslakOnizle,
  okumaKarari,
  okumaKaydet,
  indeksVarMi,
  ocoKolonlariVarMi,
  ocoKapisi,
  launchPenceresiDenetle,
  talepOzeti,
  talepKapat,
  isSonucu,
  satiriIlerlet,
  nodeSonuclariniTara,
  talepAc,
  esOnerisi,
  launchOncesiDegerEkle,
  gizliTemizle,
  initCryptoHubNode,
  NODE_OKUMA,
  OKUMA_ISLERI,
  KAPALI_DURUMLAR,
  ACIK_DURUMLAR,
  DOGRUDAN_TAKILDI_DK,
  ONAYSIZ_KOD,
  kesinRet,
  _sifirla,
};
