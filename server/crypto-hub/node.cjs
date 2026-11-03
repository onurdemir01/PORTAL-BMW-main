// server/crypto-hub/node.cjs - Crypto Hub > Indexer / Node degisikligi (2026-11-02).
//
// Baglayici sozlesme: scratchpad/cryptohub/sozlesme.md (bolum 3, 4, 7, 8). Ozet:
//   * node_env_get (salt okunur) dogrudan AWX'e gider; cikti maskeli deger + sha256.
//   * node_change ASLA dogrudan baslatilmaz: OpsX OpenShift'in Smart flow'unda bilet acilir
//     (kullanici karari D1: yeni flow YOK, konsolide katalog), onaydan sonra MEVCUT poller
//     (performSsLaunch) isi baslatir. /ops bu islemleri TANIMAZ (index.cjs OPS'ta yoklar).
//   * Smart ayari OpsX'ten okunur (smartApprovalFor('openshift')). OpsX'te Smart kapatilmis
//     olsa bile (enabled:false) node talebi onaysiz KOSMAZ; admin atlama yolu da yok.
//   * Kiraci + kilit basina TEK acik talep: DB filtreli tekil indeksi (UX_chnc_acik) zorlar;
//     indeks yoksa talep acilmaz (fail-closed).
//
// SIR KURALI (bolum 4): Portal node DEGERLERINI hic gormez. Betigin maskeli alanlari bile
// burada bir kez daha suzulur (maskeGuvenli): betikte bir maske hatasi olsa da ham deger DB'ye,
// Smart'a, loga ya da denetime gitmez.
'use strict';

const crypto = require('node:crypto');
const { tenantOf } = require('../../shared/cryptoHubTenants.cjs');
const N = require('../../shared/cryptoHubNodes.cjs');

const OPS_KEY = 'crypto_hub_ops';
const OPSX_OPENSHIFT_KEY = 'opsx_openshift_operation';
const TERMINAL = ['successful', 'failed', 'error', 'canceled'];
const HEX64 = /^[0-9a-f]{64}$/;
const B64_AZAMI = 8192;
const OKUMA_IS_MS = 10 * 60 * 1000;
const ACILIS_DK = 10;

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
  ayniNode: 'Seçilen node zaten kullanımda — değişiklik yok.',
  katalogDisi: 'Seçilen node bu grup için katalogda yok ya da sırrı çözülemedi.',
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
  indeksYok: 'Talep kilidi (veritabanı tekil indeksi) doğrulanamadı — talep açılmadı.',
  yetimBilet: (no) =>
    `Smart talebi AÇILDI (kayıt no: ${no}) ancak Portal kaydı yazılamadı. Onaylansa da iş başlamaz — Smart'ta reddettirin.`,
  smartHata: (m) => `Smart talebi açılamadı: ${m}`,
  sablonBos: 'OpsX OpenShift Smart şablonu boş — ElementName eşlemesi olmadan bilet açılamaz.',
  sablonEk:
    " Şablon Crypto node talebini de taşır; OpsX'e özgü alanları `| default(...)` ile yazın.",
  aileYok: 'Bu zincir ailesi için izin listesi tanımlı değil',
  templateYok: `AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › "${OPS_KEY}" satırına Template ID girilmeli.`,
  talepAcildi: (no) =>
    `Smart talebi açıldı (kayıt no: ${no}). Onay 24 saat içinde gelirse değişiklik otomatik uygulanır; bu ekranda beklemeniz gerekmez.`,
});

const kirp = (s, n) => {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const hata = (status, blocked, message) => ({ ok: false, status, blocked, message });

// ── Maske suzgeci ───────────────────────────────────────────────────────────────────
// Betik yalniz su bicimleri basar (sozlesme 4; crypto_hub_node.py maskele): sema://host[:port]
// (+ /**** ; IPv6 koseli), host:port, **** ve bos (-). Bunlarin DISINDA kalan her alan ham
// deger olabilir -> **** olur (yol, sorgu, kullanici bilgisi hic gecmez).
const MASKE_RE = [
  /^[a-z][a-z0-9+.-]*:\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?(\/\*\*\*\*)?$/,
  /^[A-Za-z0-9.-]+:[0-9]{1,5}$/,
  /^\*\*\*\*$/,
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
  NODECAT: 9,
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
    katalog: [],
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
      case 'NODECAT': {
        const sha = HEX64.test(f[7]) ? f[7] : null;
        out.katalog.push({
          id: f[2],
          grup: f[3],
          rol: f[4],
          ad: kirp(f[5], 80),
          maskeli: guvenli(f[6]),
          sha,
          cozulemedi: !sha,
          neden: f[8] && f[8] !== '-' ? kirp(f[8], 200) : null,
        });
        break;
      }
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
        out.sum = { sonuc: f[2], nodeId: f[3], talepId: f[4], kod: f[5] };
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

  const rolKumesi = new Set(roller.map((r) => r.rol));
  const adayMap = new Map();
  for (const k of parsed.katalog.filter((x) => x.grup === grupId)) {
    if (!adayMap.has(k.id)) adayMap.set(k.id, { id: k.id, ad: k.ad, roller: new Map() });
    adayMap.get(k.id).roller.set(k.rol, k);
  }
  const adaylar = [...adayMap.values()].map((n) => {
    const nRol = new Set(n.roller.keys());
    const rolEsit = !izinYok && ayniKume(nRol, rolKumesi);
    const cozulemeyen = [...n.roller.values()].find((x) => x.cozulemedi);
    const cozulemedi = !!cozulemeyen || !rolEsit;
    const neden =
      (cozulemeyen && cozulemeyen.neden) ||
      (!rolEsit ? 'rol kümesi grupla eşleşmiyor' : cozulemeyen ? 'sır çözülemedi' : null);
    const kullanimda =
      !cozulemedi &&
      roller.every((r) => {
        const s = rolShalari.get(r.rol);
        return s && s.size === 1 && s.has(n.roller.get(r.rol).sha);
      });
    const maskeli = {};
    for (const [rol, k] of n.roller) maskeli[rol] = k.maskeli || '****';
    return { id: n.id, ad: n.ad, maskeli, kullanimda, cozulemedi, neden, roller: n.roller };
  });

  const maskeliOf = (rol) =>
    [...new Set(literal.filter((e) => e.rol === rol).map((e) => e.maskeli || '****'))].join(' | ');
  const mevcutAday = adaylar.find((a) => a.kullanimda) || null;
  const mevcutNode = tasiyan.length
    ? {
        katalogId: mevcutAday ? mevcutAday.id : null,
        ad: mevcutAday ? mevcutAday.ad : null,
        maskeli: Object.fromEntries(roller.map((r) => [r.rol, maskeliOf(r.rol)])),
      }
    : null;
  // Bilesen (deployment) basina su anki node: o deployment'in literal satirlari BIR katalog
  // kaydina tam esleniyorsa o kayit; yoksa yalniz maskeli deger (ekran "Katalogda yok" der).
  const depNodeu = (dAd) => {
    const sat = literal.filter((e) => e.deployment === dAd);
    if (!sat.length) return null;
    const rolSha = new Map();
    for (const e of sat) {
      if (!rolSha.has(e.rol)) rolSha.set(e.rol, new Set());
      rolSha.get(e.rol).add(e.sha);
    }
    const aday = adaylar.find(
      (x) =>
        !x.cozulemedi &&
        [...rolSha].every(([rol, s]) => s.size === 1 && x.roller.get(rol) && s.has(x.roller.get(rol).sha)),
    );
    const maskeli = {};
    for (const rol of rolSha.keys()) {
      maskeli[rol] = [...new Set(sat.filter((e) => e.rol === rol).map((e) => e.maskeli || '****'))].join(' | ');
    }
    return { katalogId: aday ? aday.id : null, ad: aday ? aday.ad : null, maskeli };
  };
  const depNodelari = new Map(deps.map((d) => [d.ad, depNodeu(d.ad)]));
  // Secilebilir bilesen = literal node satiri olan deployment (plan yalniz literal satirdan kurulur).
  const secilebilir = deps.filter((d) => depNodelari.get(d.ad)).map((d) => d.ad);
  const envCikti = envler.map((e) => {
    const k = e.sha
      ? adaylar.find((a) => !a.cozulemedi && a.roller.get(e.rol) && a.roller.get(e.rol).sha === e.sha)
      : null;
    return {
      deployment: e.deployment,
      container: e.container,
      env: e.env,
      rol: e.rol,
      kaynak: e.kaynak,
      maskeli: e.maskeli,
      sha: e.sha,
      katalogId: k ? k.id : null,
      helm: e.helm,
    };
  });
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
    adaylar,
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
      adaylar: a.adaylar.map((x) => ({
        id: x.id,
        ad: x.ad,
        maskeli: x.maskeli,
        kullanimda: x.kullanimda,
        cozulemedi: x.cozulemedi,
        neden: x.neden,
      })),
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
        adaylar: [],
        bekleyen,
        degistirilebilir: !engel,
        engel,
        okumaBekleniyor: true,
      };
    });
}

// ── Plan (sozlesme 7.5 adim 5) ──────────────────────────────────────────────────────
/**
 * @param {{parsed: object}} okuma  son node_env_get okumasi
 * @param {{tutarsizlikOnay?: boolean, onayMetni?: string, production?: boolean,
 *          bilesenler?: string[]|null}} opts  bilesenler: secilen deployment adlari (yoksa
 *          node tasiyan HEPSI - varsayilan birlikte). Atomiklik yalniz secilenler arasinda.
 */
function grupPlaniKur(okuma, grupId, nodeId, opts = {}) {
  const parsed = okuma && okuma.parsed;
  const a = parsed ? grupAnalizi(parsed, grupId) : null;
  if (!a) return hata(400, 'node_girdi', METIN.girdi('grup son okumada yok'));
  if (a.izinYok) return hata(409, 'node_katalog_disi', METIN.katalogDisi);
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
  const node = a.adaylar.find((x) => x.id === nodeId);
  if (!node || node.cozulemedi) return hata(409, 'node_katalog_disi', METIN.katalogDisi);
  const secilenSatir = a.literal.filter((e) => secim.includes(e.deployment));
  // Ayni node: SECILEN bilesenlerin hepsi zaten bu node'da (gruptaki digerleri onemsiz).
  if (secilenSatir.every((e) => node.roller.get(e.rol) && node.roller.get(e.rol).sha === e.sha)) {
    return hata(409, 'node_ayni_node', METIN.ayniNode);
  }
  // Tutarsizlik onayi: SECILENLER su an farkli node'lardaysa, hepsi tek node'a toplanacak.
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
  const newSha = {};
  for (const r of a.roller) newSha[r.rol] = node.roller.get(r.rol).sha;
  const etiket = (ad) => {
    const d = a.deps.find((x) => x.ad === ad);
    return (d && d.bilesen) || ad;
  };
  const secilenler = hedefler.map(etiket);
  const secilmeyenler = a.secilebilir.filter((x) => !hedefler.includes(x)).map(etiket);
  const katalogIdleri = new Set(hedefler.map((d) => (a.depNodelari.get(d) || {}).katalogId || null));
  const tekKatalog = katalogIdleri.size === 1 ? [...katalogIdleri][0] : null;
  const katalogAd = tekKatalog ? (a.adaylar.find((x) => x.id === tekKatalog) || {}).ad || tekKatalog : null;
  const katalogNotu = katalogAd
    ? `Katalog: ${katalogAd}`
    : katalogIdleri.size > 1
      ? "Bileşenler farklı node'larda"
      : 'Katalogda yok';
  const maskeliSecim = (rol) =>
    [...new Set(secilenSatir.filter((e) => e.rol === rol).map((e) => e.maskeli || '****'))].join(' | ');
  const eskiOzet = kirp(
    `${a.roller.map((r) => `${r.rol}=${maskeliSecim(r.rol)}`).join('; ')} [${katalogNotu}]`,
    1000,
  );
  const yeniOzet = kirp(a.roller.map((r) => `${r.rol}=${node.maskeli[r.rol] || '****'}`).join('; '), 1000);
  return {
    ok: true,
    grup: a.grup,
    analiz: a,
    node: { id: node.id, ad: node.ad, maskeli: node.maskeli },
    plan: plan.map(({ d, c, e, r }) => ({ d, c, e, r })),
    expect,
    newSha,
    hedefler,
    secilenler,
    secilmeyenler,
    tutarsizToplama: secimTutarsiz,
    eskiOzet,
    yeniOzet,
  };
}

const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');

/** plan / expect / new_sha base64'leri ve plan_sha (DB'de bayatlik izi). */
function planKodla(plan, expect, newSha) {
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
  return { planB64, expectB64, newShaB64, planSha: sha256(planB64 + expectB64 + newShaB64) };
}

/**
 * AWX extra_vars (sozlesme 6.3). YALNIZ id / ad / sha256: deger (URL / sir) YOK.
 * Smart onayindan sonra poller bunu AYNEN oynatir.
 */
function nodeExtraVars({ tenantKey, grupId, nodeId, talepId, plan, expect, newSha, hedefler, email }) {
  const k = planKodla(plan, expect, newSha);
  return {
    crypto_hub_tenant: tenantKey,
    crypto_hub_action: 'node_change',
    crypto_hub_targets: hedefler.map((d) => `deployment/${d}`).join(','),
    crypto_hub_node_grup: grupId,
    crypto_hub_node_id: nodeId,
    crypto_hub_node_talep: Number(talepId),
    crypto_hub_node_plan_b64: k.planB64,
    crypto_hub_node_expect_b64: k.expectB64,
    crypto_hub_node_new_sha_b64: k.newShaB64,
    crypto_hub_timeout: 1800,
    email: String(email || ''),
  };
}

const tekSatir = (s) =>
  String(s == null ? '' : s)
    // Kontrol karakterleri (TAB / satir sonu dahil) bilerek bosluga cevrilir.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

/**
 * Smart sablon baglami `opsx` (sozlesme 3.3). OpsX OpenShift ile AYNI anahtarlar AYNI
 * sozlukle doldurulur (ortam test/prod, cluster metaco_das/metaco_gar, hedefler ns,app;...):
 * sablondaki dropdown eslemeleri (Production_9 gibi) bozulmaz. Ek anahtarlar yalniz
 * `| default(...)` ile kullanilabilir.
 */
function ozetKur({ tenant, plani, gerekce, username, esTalep }) {
  const lok = N.lokasyon(tenant);
  const g = plani.grup;
  const turAd = g.tur === 'uis' ? 'Yeni tip' : 'Eski tip';
  const hedefler = plani.hedefler.map((d) => `${tenant.namespace},${d}`).join(';');
  const ger = tekSatir(gerekce);
  const secilenler = plani.secilenler && plani.secilenler.length ? plani.secilenler : plani.hedefler;
  const secilmeyenler = plani.secilmeyenler || [];
  // PS1: kisa alan (opsx.islem, OpsX sablonunda ACIKLAMA) 400 karakter. YENI node id ve
  // degisecek bilesen listesi ASLA kesilmez; once uzun kiraci oneki kisaltilir, kalan pay
  // yalniz eski ozete verilir (tutarsiz grupta eski ozet 1000 karaktere cikabilir).
  const ISLEM_SINIRI = 400;
  const zorunlu = tekSatir(
    ` -> ${plani.node.id} (${kirp(plani.node.ad, 80)}) | Bileşenler: ${secilenler.join(', ')}`,
  );
  let onek = tekSatir(
    `Crypto Hub Indexer/Node Change — ${tenant.key} (${tenant.appLabel} · ${tenant.envLabel}) — ${lok} — ${g.baslik} [${g.id}]`,
  );
  if (onek.length + zorunlu.length > ISLEM_SINIRI) onek = tekSatir(`Crypto Hub Node Change — ${tenant.key} [${g.id}]`);
  const ESKI_ON = ' | Eski: ';
  const pay = ISLEM_SINIRI - onek.length - zorunlu.length - ESKI_ON.length;
  const islem = onek + zorunlu + (pay >= 12 ? ESKI_ON + kirp(tekSatir(plani.eskiOzet), pay) : '');
  // PS5: konsolide OpsX OpenShift flow'u kullanilir; bilet metni bunun bir NODE DEGISIKLIGI
  // oldugunu ilk satirda soyler (sablon alanlari - or. JOBTYPE - OpsX degerlerini tasir).
  const satirlar = [
    'Crypto Hub Indexer/Node Change — NODE DEĞİŞİKLİĞİ (rollout/restart değil; OpsX OpenShift onay akışı ortak kullanılır)',
    `Kiracı: ${tenant.key} (${tenant.appLabel} · ${tenant.domainLabel} · ${tenant.envLabel})`,
    `Lokasyon: ${lok}`,
    `Cluster / Namespace: ${tenant.cluster} / ${tenant.namespace}`,
    `Grup: ${g.baslik} [${g.id}] (${turAd})`,
    `Değişecek bileşenler: ${secilenler.join(', ')}`,
    `Değişmeyecek bileşenler: ${secilmeyenler.length ? secilmeyenler.join(', ') : '— (hepsi değişiyor)'}`,
    `Etkilenen deployment'lar: ${plani.hedefler.join(', ')}`,
    `Mevcut node: ${plani.eskiOzet}`,
    `Yeni node: ${plani.node.id} (${plani.node.ad}) — ${plani.yeniOzet}`,
    `Gerekçe: ${ger}`,
  ];
  if (plani.tutarsizToplama) {
    satirlar.push("Not: seçilen bileşenler şu an farklı node'lara bağlı; talep hepsini tek node'a topluyor (kullanıcı onayladı).");
  }
  if (esTalep) satirlar.push(`İstanbul talebi: ${N.talepNoMetni(esTalep.externalTicketId, esTalep.id)}`);
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
    yeniNode: plani.node.id,
    yeniNodeAd: plani.node.ad,
    gerekce: ger,
    deploymentlar: plani.hedefler.join(', '),
    bilesenler: secilenler.join(', '),
    degismeyenler: secilmeyenler.join(', '),
    esTalep: esTalep ? String(esTalep.externalTicketId || '') : '',
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
 * @param {{ocClusterKey?: string, ocInputKey?: string, staticVars?: object}} [anahtarlar]
 */
function cryptoNodeMetadata(raw, ctx, ozet, sablonVarsayilan, anahtarlar = {}) {
  if (!String(raw || '').trim()) {
    throw Object.assign(new Error(METIN.sablonBos), {
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
    throw Object.assign(new Error(`${e.message}${METIN.sablonEk}`), {
      status: 400,
      blocked: 'crypto_node_smart_sablon',
    });
  }
}

// ── Bellek: son okuma + suren okuma isleri ──────────────────────────────────────────
const NODE_OKUMA = new Map();
const OKUMA_ISLERI = new Map();
let _indeks = { at: 0, ok: false };

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

// ── DB ───────────────────────────────────────────────────────────────────────────────
const SUTUNLAR =
  'id, tenant_key, grup, kilit, lokasyon, yeni_node_id, yeni_node_ad, eski_ozet, yeni_ozet, hedefler, gerekce, username, durum, smart_ticket_id, external_ticket_id, awx_server_id, awx_job_id, sonuc_kod, sonuc_json, es_talep_id, created_at, updated_at, kapandi_at';

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
    yeniNodeId: r.yeni_node_id,
    yeniNodeAd: r.yeni_node_ad || null,
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
    `UPDATE crypto_hub_node_changes SET durum = $1, sonuc_kod = $2, sonuc_json = $3, kapandi_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = $4 AND kapandi_at IS NULL`,
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
  // Basari YALNIZ bu talebin satiriyla (talep no + node id) sayilir. Betik girdiyi gecersiz
  // bulursa kimlikleri '-' basar: o durumda olumsuz sonuc (fail / bayat) yine kabul edilir.
  const kimlik =
    s &&
    ((String(s.talepId) === String(row.id) && String(s.nodeId) === String(row.yeni_node_id)) ||
      (s.sonuc !== 'ok' && s.sonuc !== 'geri_alindi' && s.talepId === '-'));
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
    let b = null;
    try {
      b = await biletiBul(db, row.id);
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
          not: "Smart'ta kayıt açılmış olabilir; Portal kaydı olmadığı için onaylansa da iş başlamaz.",
        }),
      },
      denetim,
    );
    return 'kapandi';
  }
  if (row.smart_ticket_id == null) {
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
  const takildi = yasDk > N.TAKILDI_DK;
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
            smart: { status: t.status, stateName: t.smartStateName || null, hata: kirp(t.errorMessage || '', 500) || null },
          }),
        },
        denetim,
      );
      return 'kapandi';
    }
    // PENDING / LAUNCHING / SCHEDULED (node akisi OCO'ya girmez ama poller bu durumu yazabilir) /
    // LAUNCHED-ama-job-yok: henuz is yok. Sinir asilmadiysa sonraki tur yeniden bakar.
    if (t.status !== 'LAUNCHED' || t.awxJobId == null) {
      return takildi ? takildiKapat(`bilet_${String(t.status || '').toLowerCase() || 'bilinmiyor'}`, t) : null;
    }
    serverId = Number(t.awxServerId);
    jobId = Number(t.awxJobId);
    await db.query(
      `UPDATE crypto_hub_node_changes SET durum = 'CALISIYOR', awx_server_id = $1, awx_job_id = $2, updated_at = SYSUTCDATETIME() WHERE id = $3 AND kapandi_at IS NULL`,
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
    `SELECT ${SUTUNLAR} FROM crypto_hub_node_changes WHERE kapandi_at IS NULL`,
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
    const [acik, son] = await Promise.all([
      db.query(`SELECT ${SUTUNLAR} FROM crypto_hub_node_changes WHERE tenant_key = $1 AND kapandi_at IS NULL`, [
        tenantKey,
      ]),
      db.query(
        `SELECT TOP 20 ${SUTUNLAR} FROM crypto_hub_node_changes WHERE tenant_key = $1 ORDER BY created_at DESC, id DESC`,
        [tenantKey],
      ),
    ]);
    const bekleyenler = new Map();
    for (const r of (acik && acik.rows) || []) {
      bekleyenler.set(r.kilit, {
        talepId: Number(r.id),
        externalTicketId: r.external_ticket_id || null,
        username: r.username,
        createdAt: tarih(r.created_at),
        durum: r.durum,
      });
    }
    return { bekleyenler, gecmis: ((son && son.rows) || []).map(talepOzeti) };
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
    res.json({
      ok: true,
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
    try {
      const r = await db.query(`SELECT ${SUTUNLAR} FROM crypto_hub_node_changes WHERE id = $1`, [id]);
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
          const r2 = await db.query(`SELECT ${SUTUNLAR} FROM crypto_hub_node_changes WHERE id = $1`, [id]);
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
          const c = zamanMs(t.createdAt);
          smart = {
            status: t.status,
            statusName: t.smartStateName || null,
            sonTarih: Number.isFinite(c) ? new Date(c + N.ONAY_DK * 60000).toISOString() : null,
            hata: t.errorMessage || null,
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
      esTalepOnerisi: esOnerisi(tenant, row.grup, row.yeni_node_id, Number(row.id)),
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
    try {
      const r = await db.query(`SELECT ${SUTUNLAR} FROM crypto_hub_node_changes WHERE id = $1`, [id]);
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
    let smart = null;
    if (row.smart_ticket_id != null) {
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
      if (smart.status === 'PENDING' && !smart.yerelIptal) {
        return res.status(409).json({ ok: false, message: 'Smart kaydı iptal edilemedi; talep kapatılmadı. Lütfen tekrar deneyin.' });
      }
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
      const r2 = await db.query(`SELECT ${SUTUNLAR} FROM crypto_hub_node_changes WHERE id = $1`, [id]);
      if (r2 && r2.rows && r2.rows[0]) son = r2.rows[0];
    } catch {
      /* eski satir doner */
    }
    res.json({ ok: true, talep: talepOzeti(son), smart });
  });
}

/** Istanbul talebinden sonra Ankara onerisi (D4). Yalniz es kiracisi olan kiracida. */
function esOnerisi(tenant, grupId, nodeId, talepId) {
  const esKey = tenant ? N.esKiraciOf(tenant.key) : null;
  const es = esKey ? tenantOf(esKey) : null;
  if (!es) return null;
  const ok = NODE_OKUMA.get(es.key);
  const varMi =
    ok && ok.parsed.katalog.some((k) => k.id === nodeId && k.grup === grupId && !k.cozulemedi);
  return {
    tenant: es.key,
    label: es.envLabel,
    acik: N.nodeAcikMi(es),
    grup: grupId,
    nodeId: varMi ? nodeId : null,
    esTalepId: talepId,
  };
}

/**
 * POST /node-change (ve onizleme). Sira sozlesme 7.5 ile BIREBIR.
 * @returns {Promise<{status:number, body:object}>}
 */
async function talepAc(req, { nodeYetkisi, kullanici, onizleme }) {
  const body = (req && req.body) || {};
  const red = (h) => ({ status: h.status, body: { ok: false, blocked: h.blocked, message: h.message } });
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
  const nodeId = String(body.nodeId || '').trim();
  if (!N.GRUP_RE.test(grupId)) return red(hata(400, 'node_girdi', METIN.girdi('grup')));
  if (!N.NODE_ID_RE.test(nodeId)) return red(hata(400, 'node_girdi', METIN.girdi('node')));
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
  const plani = grupPlaniKur(okuma, grupId, nodeId, {
    tutarsizlikOnay: onizleme ? true : body.tutarsizlikOnay === true,
    onayMetni: onizleme ? grupId : body.onayMetni,
    production: tenant.production,
    bilesenler: body.bilesenler == null ? null : body.bilesenler,
  });
  if (!plani.ok) return red(plani);
  let kod;
  try {
    kod = planKodla(plani.plan, plani.expect, plani.newSha);
  } catch (e) {
    return red(hata(400, 'node_girdi', METIN.girdi(e.message)));
  }
  // 6
  const { smartApprovalFor } = require('../opsx/prod-approval.cjs');
  let sa = null;
  try {
    sa = await smartApprovalFor('openshift');
  } catch {
    sa = null;
  }
  if (!sa) return red(hata(503, 'crypto_node_smart_yok', METIN.smartYok));
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
      r = await db.query(`SELECT ${SUTUNLAR} FROM crypto_hub_node_changes WHERE id = $1`, [esId]);
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

  // Sablon baglami: OpsX OpenShift template'inin degiskenleri + OpsX anahtar adlari.
  const runner = require('../ansible/runner.cjs');
  const sablonVarsayilaniOku = async () => {
    try {
      const row = await reg.getByKey(OPSX_OPENSHIFT_KEY).catch(() => null);
      const tid = row && row.enabled !== false ? reg.getEffectiveTemplateId(row) : null;
      if (!tid) return {};
      return (await runner.getTemplateVariableDefaultsOnServer(Number(row.awxServerId), tid)) || {};
    } catch (e) {
      console.warn('[CryptoHub] OpsX OpenShift template degiskenleri okunamadi:', e.message);
      return {};
    }
  };
  let anahtarlar = {};
  try {
    const cfgMod = require('../opsx/config.cjs');
    const cfg = await cfgMod.getConfig();
    anahtarlar = { ...((cfg && cfg.openshift) || {}) };
    // OpsX ile ayni sabit ek degiskenler (opsx/index.cjs parseExtraVarLines(cfg.extraVars)).
    anahtarlar.staticVars =
      typeof cfgMod.parseExtraVarLines === 'function' ? cfgMod.parseExtraVarLines(anahtarlar.extraVars).vars : {};
  } catch {
    anahtarlar = {};
  }

  if (onizleme) {
    const ozet = ozetKur({ tenant, plani, gerekce: gerekce || '(önizleme)', username, esTalep });
    const sablonVarsayilan = await sablonVarsayilaniOku();
    try {
      const metadata = cryptoNodeMetadata(
        String(sa.metadataFields || ''),
        { username, email: ben.mail || '', templateName: `Crypto Hub: node_change @ ${tenant.key}`, templateId },
        ozet,
        sablonVarsayilan,
        anahtarlar,
      );
      return { status: 200, body: { ok: true, flowKey: sa.flowKey, metadata } };
    } catch (e) {
      return { status: 200, body: { ok: true, flowKey: sa.flowKey, metadata: null, hata: e.message } };
    }
  }

  // 9 - kilit: filtreli tekil indeks
  let talepId;
  try {
    const r = await db.query(
      `INSERT INTO crypto_hub_node_changes (tenant_key, grup, kilit, lokasyon, yeni_node_id, yeni_node_ad, eski_ozet, yeni_ozet, hedefler, plan_sha, gerekce, username, durum, es_talep_id) OUTPUT INSERTED.id VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ACILIYOR', $13)`,
      [
        tenant.key,
        grupId,
        plani.grup.kilit,
        N.lokasyon(tenant),
        nodeId,
        kirp(plani.node.ad, 200),
        plani.eskiOzet,
        plani.yeniOzet,
        kirp(plani.hedefler.join(','), 2000),
        kod.planSha,
        gerekce,
        username,
        esTalep ? esTalep.id : null,
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
    nodeId,
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
  // 12
  const sablonVarsayilan = await sablonVarsayilaniOku();
  const ozet = ozetKur({ tenant, plani, gerekce, username, esTalep });
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
      specFields: [],
      buildSmartMetadata: (raw, ctx) => cryptoNodeMetadata(raw, ctx, ozet, sablonVarsayilan, anahtarlar),
      auditAction: 'crypto_hub_node_change_ticket_open',
      req,
      pendingLaunchExtras: { onayZamanAsimiDk: N.ONAY_DK, yutmaKorumasi: true },
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
  try {
    await db.query(
      `UPDATE crypto_hub_node_changes SET durum = 'BEKLIYOR', smart_ticket_id = $1, external_ticket_id = $2, updated_at = SYSUTCDATETIME() WHERE id = $3 AND kapandi_at IS NULL`,
      [Number(opened.ticketId), String(opened.externalTicketId), talepId],
    );
  } catch (e) {
    // Bilet ACIK ve smart_tickets'ta duruyor: satir ACILIYOR kalir, tarama 10 dk sonra
    // bileti pending_launch_json'dan bulup sahiplenir (biletiBul).
    console.warn('[CryptoHub] node talebi bilete baglanamadi:', talepId, e.message);
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
        yeniNodeId: nodeId,
        gerekce,
        talepId,
        ticketId: opened.ticketId,
        externalTicketId: opened.externalTicketId,
        esTalepId: esTalep ? esTalep.id : null,
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
    onayZamanAsimiDk: N.ONAY_DK,
    message: METIN.talepAcildi(opened.externalTicketId),
  };
  const oneri = esOnerisi(tenant, grupId, nodeId, talepId);
  if (oneri) out.esTalepOnerisi = oneri;
  return { status: 200, body: out };
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
  okumaKarari,
  okumaKaydet,
  indeksVarMi,
  talepOzeti,
  talepKapat,
  isSonucu,
  satiriIlerlet,
  nodeSonuclariniTara,
  talepAc,
  esOnerisi,
  initCryptoHubNode,
  NODE_OKUMA,
  OKUMA_ISLERI,
  KAPALI_DURUMLAR,
  ACIK_DURUMLAR,
  _sifirla,
};
