// server/crypto-hub/resources.cjs - Crypto Hub CPU / bellek: sunucu tarafi (2026-10-02).
//
// Kullanici: "CPU ve bellegi Portal'dan degistirip Helm'e KALICI isleyelim." Bastion'daki is
// Ansible'da (bmw_automation_folder/crypto_hub: resources_get / resources_plan /
// resources_apply); bu modul Portal'in payini tasir:
//
//   * RES* cikti satirlarinin ayristirilmasi (sozlesme: crypto_hub README "cikti satirlari").
//   * PLAN JETONU: temiz bir plan, onu ureten KULLANICIYA ve KIRACIYA bagli, 15 dk gecerli,
//     TEK KULLANIMLIK bir jeton olarak saklanir. AWX'in plan sha'si ve jetonu istemciye
//     guvenilmez - uygulamada sunucu kendi kaydindan gonderir.
//   * IS SAHIPLIGI: /ops-result ve /job-status yalniz o kullanicinin (Admin: herkesin) ve
//     gorebildigi uygulamanin isini dondurur. Kayit bulunamazsa ERISIM YOK (fail-closed).
//   * GECMIS KAYDI: ansible_job_history.params'a dosya ICERIGI gitmez - yalniz sha256 + boyut.
//   * DB KILIDI crypto_hub_locks: compare-and-set (ScaleX tryLockRestore deseni), birakma
//     UPDATE ile (TBMWANS'ta DELETE yok).
//   * helm_template onizlemesinde Secret data/stringData degerleri MASKELENIR.
//
// "OLCULEMEDI" ILE "YOK" KARISMAZ: LimitRange/kota satiri gelmediyse durum 'olculemedi'dir,
// 'yok' DEGIL; okunamadi (RESERR) satiri varsa yine 'olculemedi'.
'use strict';

const crypto = require('node:crypto');
const R = require('../../shared/cryptoHubResources.cjs');

const HEX64 = /^[0-9a-f]{64}$/;
const YOK = 'YOK';

// ── RES* satir ayristirici ───────────────────────────────────────────────────────────

const deger = (x) => {
  const s = String(x == null ? '' : x).trim();
  return s === YOK ? null : s;
};
const tire = (x) => {
  const s = String(x == null ? '' : x).trim();
  return s === '-' ? '' : s;
};

/** Betigin RES* satirlarini yapiya cevirir. Satir gelmediyse null (bos ile karismaz). */
function parseResourceLines(lines) {
  if (!Array.isArray(lines)) return null;
  const out = {
    tools: [],
    release: null,
    src: null,
    files: [],
    workloads: [],
    live: [],
    limitRange: { durum: 'olculemedi', kurallar: [] },
    quota: { durum: 'olculemedi', satirlar: [] },
    peers: [],
    checks: [],
    edits: [],
    diffs: [],
    affect: [],
    pending: [],
    drift: [],
    repl: [],
    plan: null,
    steps: [],
    obs: [],
    errors: [],
    end: null,
  };
  let lrYok = false;
  let lrHata = false;
  let qYok = false;
  let qHata = false;
  for (const raw of lines) {
    const f = String(raw == null ? '' : raw).split('\t');
    switch (f[0]) {
      case 'RESTOOL':
        out.tools.push({ arac: f[2] || '', durum: f[3] || '', surum: tire(f[4]) });
        break;
      case 'RESREL':
        out.release = {
          ad: f[2] || '',
          surum: f[3] && f[3] !== 'olculemedi' ? f[3] : '',
          olculdu: !!f[3] && f[3] !== 'olculemedi',
        };
        break;
      case 'RESSRC':
        out.src = {
          yol: tire(f[2]),
          durum: f[3] || '',
          dogrulama: tire(f[4]),
          sha256: tire(f[5]),
          bayt: tire(f[6]) ? Number(f[6]) : null,
          yazilabilir: tire(f[7]),
          aciklama: f[8] || '',
        };
        break;
      case 'RESFILE':
        out.files.push({
          bilesen: f[2] || '',
          alan: f[3] || '',
          // 'YOK' = dosyada yok (deger chart varsayilanindan); OKUNAMADI / GECERSIZ ayri.
          deger: String(f[4] || ''),
          satir: tire(f[5]) ? Number(f[5]) : null,
        });
        break;
      case 'RESWL':
        out.workloads.push({
          kind: f[2] || '',
          ad: f[3] || '',
          replika: tire(f[4]) === '' ? null : Number(f[4]),
          hazir: Number(f[5] || 0),
          strateji: f[6] || '',
          release: tire(f[7]),
        });
        break;
      case 'RESLIVE':
        out.live.push({
          kind: f[2] || '',
          ad: f[3] || '',
          kap: f[4] || '',
          tur: f[5] || '',
          'requests.cpu': deger(f[6]),
          'requests.memory': deger(f[7]),
          'limits.cpu': deger(f[8]),
          'limits.memory': deger(f[9]),
        });
        break;
      case 'RESLR':
        if (f[2] === '-' && f[6] === YOK) lrYok = true;
        else
          out.limitRange.kurallar.push({
            ad: f[2] || '',
            tur: f[3] || '',
            ozellik: f[4] || '',
            kaynak: f[5] || '',
            deger: f[6] || '',
          });
        break;
      case 'RESQUOTA':
        if (f[2] === '-' && f[5] === YOK) qYok = true;
        else
          out.quota.satirlar.push({
            ad: f[2] || '',
            kaynak: f[3] || '',
            hard: f[4] || '',
            used: tire(f[5]),
          });
        break;
      case 'RESPEER':
        out.peers.push({
          kiraci: f[2] || '',
          yol: tire(f[3]),
          durum: f[4] || '',
          sha256: tire(f[5]),
          mesaj: f[6] || '',
        });
        break;
      case 'RESCHK':
        out.checks.push({ kontrol: f[2] || '', durum: f[3] || '', mesaj: f[4] || '' });
        break;
      case 'RESEDIT':
        out.edits.push({
          rol: f[2] || '',
          bilesen: f[3] || '',
          alan: f[4] || '',
          eski: f[5] || '',
          yeni: f[6] || '',
          islem: f[7] || '',
        });
        break;
      case 'RESDIFF':
        out.diffs.push({
          kind: f[2] || '',
          ad: f[3] || '',
          kap: f[4] || '',
          alan: f[5] || '',
          eski: f[6] || '',
          yeni: f[7] || '',
        });
        break;
      case 'RESAFFECT':
        // 7. alan: 'hedef' (istenen degisiklik) ya da 'bekleyen' (dosyada canliya uygulanmamis
        // kaynak farki - upgrade onu da yeniden baslatir). Eski betik bu alani basmaz: hedef.
        out.affect.push({
          kind: f[2] || '',
          ad: f[3] || '',
          strateji: f[4] || '',
          replika: f[5] || '',
          riskli: f[6] === 'evet',
          bekleyen: f[7] === 'bekleyen',
        });
        break;
      case 'RESPEND':
        // kaynak_disi satirlarda DEGER YOK (betik basmaz); burada da uydurulmaz.
        out.pending.push({
          tur: f[2] || '',
          kind: f[3] || '',
          ad: f[4] || '',
          yer: f[5] || '',
          canli: f[2] === 'kaynak' ? tire(f[6]) : '',
          dosya: f[2] === 'kaynak' ? tire(f[7]) : '',
        });
        break;
      case 'RESDRIFT':
        out.drift.push({
          kind: f[2] || '',
          ad: f[3] || '',
          kap: f[4] || '',
          alan: f[5] || '',
          canli: f[6] || '',
          manifest: f[7] || '',
        });
        break;
      case 'RESREPL':
        out.repl.push({ kind: f[2] || '', ad: f[3] || '', canli: f[4] || '', manifest: f[5] || '' });
        break;
      case 'RESPLAN':
        out.plan = {
          durum: f[2] === 'ok' ? 'ok' : 'dur',
          kod: tire(f[3]),
          dosyaSha: HEX64.test(f[4] || '') ? f[4] : '',
          yeniSha: HEX64.test(f[5] || '') ? f[5] : '',
          chartSha: HEX64.test(f[6] || '') ? f[6] : '',
          bekleyen: tire(f[7]),
          riskli: f[8] === 'evet',
          jeton: HEX64.test(f[9] || '') ? f[9] : '',
        };
        break;
      case 'RESSTEP':
        out.steps.push({ adim: f[2] || '', durum: f[3] || '', mesaj: f[4] || '' });
        break;
      case 'RESOBS':
        out.obs.push({ kontrol: f[2] || '', durum: f[3] || '', mesaj: f[4] || '' });
        break;
      case 'RESERR':
        out.errors.push({ asama: f[2] || '', mesaj: f[3] || '' });
        if (f[2] === 'limitrange') lrHata = true;
        if (f[2] === 'kota') qHata = true;
        break;
      case 'RESEND':
        out.end = { islem: f[2] || '', sonuc: f[3] || '', kod: tire(f[4]) };
        break;
      default:
        break;
    }
  }
  // OKUNAMADI satiri varsa 'olculemedi' - kismi satirlar 'olculdu' SAYILMAZ.
  if (lrHata) out.limitRange.durum = 'olculemedi';
  else if (out.limitRange.kurallar.length) out.limitRange.durum = 'olculdu';
  else if (lrYok) out.limitRange.durum = 'yok';
  if (qHata) out.quota.durum = 'olculemedi';
  else if (out.quota.satirlar.length) out.quota.durum = 'olculdu';
  else if (qYok) out.quota.durum = 'yok';
  return out;
}

/** Plan TEMIZ mi: RESPLAN ok + RESEND ok + sha ve jeton bicimi dogru. */
function planTemizMi(res) {
  const p = res && res.plan;
  return !!(
    p &&
    p.durum === 'ok' &&
    HEX64.test(p.dosyaSha) &&
    HEX64.test(p.jeton) &&
    res.end &&
    res.end.islem === 'resources_plan' &&
    res.end.sonuc === 'ok'
  );
}

// ── Canli olcum onbellegi (resources_get) ───────────────────────────────────────────
//
// Plan dogrulamasi "girilmeyen alan CANLIDAN" kuralini istemcinin soyledigine degil, AWX
// ciktisina dayandirir. Bulunamazsa istemcinin gonderdigi deger yalniz ON ELEME icindir;
// kesin karari bastion'daki plan verir.
const CANLI = new Map();
const CANLI_GECERLILIK_MS = 30 * 60 * 1000;

function canliKaydet(tenantKey, res, simdi = Date.now()) {
  if (!tenantKey || !res) return;
  CANLI.set(tenantKey, {
    at: simdi,
    live: res.live || [],
    files: res.files || [],
    limitRange: res.limitRange || { durum: 'olculemedi', kurallar: [] },
  });
}

function canliAl(tenantKey, simdi = Date.now()) {
  const k = CANLI.get(tenantKey);
  if (!k || simdi - k.at > CANLI_GECERLILIK_MS) return null;
  return k;
}

/** Kap'in canli spec degerleri; olculmediyse null. */
function kapCanli(snap, kind, ad, kap) {
  if (!snap) return null;
  const x = snap.live.find(
    (l) =>
      String(l.kind).toLowerCase() === String(kind).toLowerCase() && l.ad === ad && l.kap === kap,
  );
  if (!x) return null;
  const o = {};
  for (const a of R.ALANLAR) o[a] = x[a] == null ? null : x[a];
  return o;
}

// ── Plan isleri ve jetonlar ─────────────────────────────────────────────────────────

const PLAN_ISLERI = new Map();
const PLANLAR = new Map();
const IS_SAKLAMA_MS = 2 * 60 * 60 * 1000;
// Plan isinin AWX async ust siniri (playbook ch_async_min.resources_plan): plan en gec
// baslangictan bu kadar sonra uretilmis olur.
const PLAN_ASYNC_MS = 900 * 1000;

const isAnahtari = (serverId, jobId) => `${Number(serverId)}:${Number(jobId)}`;
const ayniKisi = (a, b) =>
  !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function temizle(simdi = Date.now()) {
  for (const [k, v] of PLAN_ISLERI) if (simdi - v.at > IS_SAKLAMA_MS) PLAN_ISLERI.delete(k);
  for (const [k, v] of PLANLAR) if (v.bitis < simdi) PLANLAR.delete(k);
}

/** resources_plan isi baslatilinca istegin sunucu kopyasi (istemciye tekrar sorulmaz). */
function planIsiKaydet(serverId, jobId, istek, simdi = Date.now()) {
  temizle(simdi);
  PLAN_ISLERI.set(isAnahtari(serverId, jobId), { ...istek, at: simdi, token: null, kullanildi: false });
}

/**
 * Plan isi bitti: temizse jeton uretir (ayni is icin ikinci yoklama AYNI jetonu alir).
 * Jeton yalniz plani baslatan kullaniciya verilir.
 *
 * 15 DAKIKA PLANIN URETILDIGI ANDAN baslar, ilk yoklamadan DEGIL (dogrulayici bulgusu: gunler
 * once biten bir plan isi yoklaninca taze jeton aliyordu). Bitis = en erken: (yoklama + 15 dk),
 * (plan baslangici + async ust siniri + 15 dk), (AWX'in bildirdigi bitis + 15 dk). Suresi
 * dolmus plana jeton VERILMEZ ('suresi_doldu').
 * @param {number|null} [bittiAni] AWX job `finished` (ms); bilinmiyorsa null
 */
function planSonucu(serverId, jobId, res, username, simdi = Date.now(), bittiAni = null) {
  const anahtar = isAnahtari(serverId, jobId);
  // Kayit temizlikten ONCE alinir: saklama suresini asmis bir plan isi 'bilinmiyor' degil,
  // asagidaki bitis hesabiyla 'suresi_doldu' doner (bitis <= baslangic + 30 dk).
  const istek = PLAN_ISLERI.get(anahtar);
  temizle(simdi);
  if (!istek) return { durum: 'bilinmiyor' };
  if (!ayniKisi(istek.username, username)) return { durum: 'baskasinin' };
  if (!planTemizMi(res)) return { durum: 'dur' };
  if (istek.token && PLANLAR.has(istek.token)) {
    const p = PLANLAR.get(istek.token);
    return { durum: 'ok', token: istek.token, bitis: p.bitis };
  }
  // Jeton verilmisti ama artik yok: uygulamada TUKETILDI ya da suresi doldu. Ayni plan isi
  // yeniden yoklanarak IKINCI jeton alinamaz (tek kullanimlik).
  if (istek.token) return { durum: istek.kullanildi ? 'kullanildi' : 'suresi_doldu' };
  const bitti = Number.isFinite(bittiAni) && bittiAni > 0 ? bittiAni + R.PLAN_GECERLILIK_MS : Infinity;
  const bitis = Math.min(simdi + R.PLAN_GECERLILIK_MS, istek.at + PLAN_ASYNC_MS + R.PLAN_GECERLILIK_MS, bitti);
  if (!(bitis > simdi)) return { durum: 'suresi_doldu' };
  const token = crypto.randomBytes(32).toString('hex');
  const plan = {
    username: istek.username,
    tenantKey: istek.tenantKey,
    release: istek.release,
    bilesen: istek.bilesen,
    kap: istek.kap,
    kind: istek.kind,
    ad: istek.ad,
    degisiklikler: istek.degisiklikler,
    expectVersion: istek.expectVersion,
    asim: !!istek.asim,
    gerekce: istek.gerekce || '',
    awxSha: res.plan.dosyaSha,
    awxJeton: res.plan.jeton,
    // Riskli: bastion'un RESPLAN'i, yeniden baslayacak HER is yuku (bekleyen dahil) ya da
    // kayitli riskli yol - biri yeter (ayri onay kutusu sunucuda zorunlu, karar 1).
    riskli:
      !!res.plan.riskli ||
      (res.affect || []).some((a) => a && a.riskli) ||
      R.riskliYol(istek.bilesen),
    bekleyen: res.plan.bekleyen || '',
    planIsi: anahtar,
    olusturma: simdi,
    bitis,
  };
  PLANLAR.set(token, plan);
  istek.token = token;
  return { durum: 'ok', token, bitis: plan.bitis };
}

/** Jetonu dogrular; tuketmez. Hata: { hata, mesaj }. */
function planAl(token, username, tenantKey, simdi = Date.now()) {
  const t = String(token || '');
  if (!HEX64.test(t)) return { hata: 'JETON_YOK', mesaj: 'Plan jetonu yok ya da geçersiz.' };
  const p = PLANLAR.get(t);
  if (!p) {
    return {
      hata: 'JETON_YOK',
      mesaj: 'Plan bulunamadı (kullanılmış, süresi dolmuş ya da sunucu yeniden başlamış). Önizlemeyi yeniden çalıştırın.',
    };
  }
  if (p.bitis < simdi) {
    PLANLAR.delete(t);
    return { hata: 'JETON_SURESI', mesaj: 'Planın 15 dakikalık süresi doldu. Önizlemeyi yeniden çalıştırın.' };
  }
  if (!ayniKisi(p.username, username)) {
    return { hata: 'JETON_BASKASI', mesaj: 'Bu plan başka bir kullanıcıya ait.' };
  }
  if (p.tenantKey !== tenantKey) {
    return { hata: 'JETON_KIRACI', mesaj: 'Plan başka bir ortam için üretilmiş.' };
  }
  return { plan: p };
}

/** Tek kullanimlik: uygulama baslatilinca jeton silinir ve plan isi 'kullanildi' isaretlenir. */
function planTuket(token) {
  const t = String(token || '');
  const p = PLANLAR.get(t);
  if (p && PLAN_ISLERI.has(p.planIsi)) PLAN_ISLERI.get(p.planIsi).kullanildi = true;
  PLANLAR.delete(t);
}

// ── Is sahipligi ────────────────────────────────────────────────────────────────────

const ISLER = new Map();

function isKaydet(serverId, jobId, kayit, simdi = Date.now()) {
  if (jobId == null) return;
  for (const [k, v] of ISLER) if (simdi - v.at > 24 * 60 * 60 * 1000) ISLER.delete(k);
  ISLER.set(isAnahtari(serverId, jobId), { ...kayit, at: simdi });
}

/** Gecmis kaydindaki ad: "Crypto Hub: <islem> @ <kiraci>" ya da "Crypto Hub: <kiraci>". */
function sablonAdiCoz(ad) {
  const m = /^Crypto Hub: (?:([a-z_]+) @ )?([a-z0-9_]+)$/.exec(String(ad || '').trim());
  if (!m) return null;
  return { action: m[1] || 'rescan', tenantKey: m[2] };
}

/**
 * Isin kaydi: once bu surecin bellegi, sonra ansible_job_history (birden cok Portal
 * ornegi). Bulunamazsa null; Crypto Hub disi bir is ise { yabanci: true }.
 * DB okunamazsa ATAR - cagiran 503 doner (bilinmezlikte erisim VERILMEZ).
 */
async function isKaydiBul(db, serverId, jobId) {
  const mem = ISLER.get(isAnahtari(serverId, jobId));
  if (mem) return mem;
  const { rows } = await db.query(
    `SELECT TOP 1 username, template_name FROM ansible_job_history WHERE job_id = $1 AND awx_server_id = $2`,
    [Number(jobId), Number(serverId)],
  );
  if (!rows || !rows.length) return null;
  const c = sablonAdiCoz(rows[0].template_name);
  if (!c) return { yabanci: true };
  return { username: rows[0].username || '', tenantKey: c.tenantKey, action: c.action };
}

/**
 * Erisim karari (saf). Uygulama kapisi + kapali kiraci + sahiplik. Admin her isi gorur
 * (ama uygulama kapisi Admin icin de motorda sorulur).
 */
function isErisimKarari({ kayit, user, gorunen, tenantOf, isOpen }) {
  if (!kayit) {
    return { izin: false, status: 403, mesaj: 'Bu iş Crypto Hub kaydında bulunamadı — erişim verilmedi.' };
  }
  if (kayit.yabanci) return { izin: false, status: 403, mesaj: 'Bu iş bir Crypto Hub işi değil.' };
  const tenant = tenantOf(kayit.tenantKey);
  if (!tenant) return { izin: false, status: 403, mesaj: 'İşin ortamı tanınmadı — erişim verilmedi.' };
  if (!gorunen || !gorunen.has(tenant.app)) {
    return {
      izin: false,
      status: 403,
      mesaj: `Bu alana erişiminiz yok (${tenant.appLabel || tenant.app}).`,
    };
  }
  if (!isOpen(tenant)) return { izin: false, status: 403, closed: true, mesaj: 'kapali' };
  const u = user || {};
  if (u.role !== 'Admin' && !ayniKisi(kayit.username, u.username)) {
    return { izin: false, status: 403, mesaj: 'Bu iş size ait değil.' };
  }
  return { izin: true, tenant, kayit };
}

// ── Gecmis kaydi: icerik YOK, yalniz sha256 + boyut ─────────────────────────────────

// Dosya/patch ICERIGI tasiyan degiskenler. Ayrica anahtar adi degisse bile kacmasin diye
// her uzun deger (> GECMIS_DEGER_AZAMI) ozetlenir (B3 korlugu: ad degisirse kacabilir).
const ICERIK_ANAHTARLARI = ['crypto_hub_values_b64', 'crypto_hub_cm_patch_b64'];
const GECMIS_DEGER_AZAMI = 2048;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function icerikOzeti(ham, base64mu) {
  const s = String(ham == null ? '' : ham);
  const buf = base64mu ? Buffer.from(s, 'base64') : Buffer.from(s, 'utf8');
  return { gecmiseYazilmadi: true, sha256: sha256(buf), bayt: buf.length };
}

/** ansible_job_history.params icin sirsiz ozet. */
function gecmisParametreleri(extraVars) {
  const out = {};
  for (const [k, v] of Object.entries(extraVars || {})) {
    if (ICERIK_ANAHTARLARI.includes(k)) {
      out[k] = icerikOzeti(v, true);
      continue;
    }
    if (typeof v === 'string' && v.length > GECMIS_DEGER_AZAMI) {
      out[k] = icerikOzeti(v, false);
      continue;
    }
    if (v && typeof v === 'object') {
      const j = JSON.stringify(v);
      if (j.length > GECMIS_DEGER_AZAMI) {
        out[k] = icerikOzeti(j, false);
        continue;
      }
    }
    out[k] = v;
  }
  return out;
}

/**
 * /api/ansible/history cevabi icin: ESKI satirlarda (bu duzeltmeden once yazilmis) duran
 * icerik de cevaba gitmesin. Yalniz Crypto Hub satirlarina dokunur.
 */
function gecmisSatiriniTemizle(row) {
  if (!row || !/^Crypto Hub:/.test(String(row.template_name || ''))) return row;
  const p = row.params;
  if (p == null || p === '') return row;
  try {
    const obj = typeof p === 'string' ? JSON.parse(p) : p;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('nesne degil');
    return { ...row, params: JSON.stringify(gecmisParametreleri(obj)) };
  } catch {
    const s = String(p);
    return s.length > GECMIS_DEGER_AZAMI
      ? { ...row, params: JSON.stringify({ params: icerikOzeti(s, false) }) }
      : row;
  }
}

// ── DB kilidi: crypto_hub_locks ─────────────────────────────────────────────────────
//
// Anahtar = kiraci|release. Tek ifadelik compare-and-set; satir SILINMEZ, birakma
// `held = 0` UPDATE'iyle. Sure siniri: uygulama isinin async ust siniri (2400 sn) + AWX
// kuyrugu icin pay. Yetim kilit (Portal coktu, kimse yoklamadi) sure dolunca ya da sahibi
// olan is AWX'te bittiyse devralinir.
const KILIT_DK = 75;

const kilitAnahtari = (tenantKey, release) => `${tenantKey}|${release}`;

async function kilitAl(db, { tenantKey, release, username, lockId }) {
  const key = kilitAnahtari(tenantKey, release);
  const r = await db.query(
    `UPDATE crypto_hub_locks
        SET held = 1, holder = $2, lock_id = $3, awx_server_id = NULL, awx_job_id = NULL,
            locked_until = DATEADD(minute, ${KILIT_DK}, GETUTCDATE()), last_result = NULL,
            updated_at = GETUTCDATE()
      WHERE lock_key = $1
        AND (held IS NULL OR held = 0 OR locked_until IS NULL OR locked_until < GETUTCDATE())`,
    [key, username, lockId],
  );
  if (r && r.rowCount > 0) return { durum: 'alindi', key };
  const sec = async () =>
    db.query(
      `SELECT TOP 1 held, holder, awx_server_id, awx_job_id, locked_until FROM crypto_hub_locks WHERE lock_key = $1`,
      [key],
    );
  const s = await sec();
  if (s.rows && s.rows.length) return { durum: 'mesgul', key, sahip: s.rows[0] };
  try {
    await db.query(
      `INSERT INTO crypto_hub_locks (lock_key, tenant_key, release_name, held, holder, lock_id, locked_until)
       VALUES ($1, $2, $3, 1, $4, $5, DATEADD(minute, ${KILIT_DK}, GETUTCDATE()))`,
      [key, tenantKey, release, username, lockId],
    );
    return { durum: 'alindi', key };
  } catch (e) {
    // Yaris: arada baskasi ekledi (UNIQUE). Satir varsa mesgul; yoksa gercek hata.
    const s2 = await sec();
    if (s2.rows && s2.rows.length) return { durum: 'mesgul', key, sahip: s2.rows[0] };
    throw e;
  }
}

/** Kilit satiri (yoksa null). Devralmadan ONCE: bagli is bittiyse sonucu kapatmak icin. */
async function kilitOku(db, tenantKey, release) {
  const r = await db.query(
    `SELECT TOP 1 held, holder, awx_server_id, awx_job_id, locked_until FROM crypto_hub_locks WHERE lock_key = $1`,
    [kilitAnahtari(tenantKey, release)],
  );
  return r && r.rows && r.rows.length ? r.rows[0] : null;
}

/** Satir tutuluyor ve suresi dolmamis mi (locked_until UTC). */
function kilitAktifMi(row, simdi = Date.now()) {
  if (!row || !row.held) return false;
  const t = row.locked_until == null ? NaN : new Date(row.locked_until).getTime();
  return Number.isFinite(t) && t > simdi;
}

/** Bir ise bagli, hala tutulan kilitler (arka plan sonuc taramasi; en cok 50). */
async function tutulanKilitler(db) {
  const r = await db.query(
    `SELECT TOP 50 lock_key, awx_server_id, awx_job_id FROM crypto_hub_locks WHERE held = 1 AND awx_job_id IS NOT NULL`,
    [],
  );
  return (r && r.rows) || [];
}

async function kilitIseBagla(db, key, lockId, serverId, jobId) {
  await db.query(
    `UPDATE crypto_hub_locks SET awx_server_id = $3, awx_job_id = $4, updated_at = GETUTCDATE()
      WHERE lock_key = $1 AND lock_id = $2 AND held = 1`,
    [key, lockId, Number(serverId), Number(jobId)],
  );
}

/** Baslatma basarisiz: kilidi kendi lock_id'siyle birak. */
async function kilitBirak(db, key, lockId, sonuc) {
  const r = await db.query(
    `UPDATE crypto_hub_locks SET held = 0, locked_until = NULL, last_result = $3, updated_at = GETUTCDATE()
      WHERE lock_key = $1 AND lock_id = $2 AND held = 1`,
    [key, lockId, String(sonuc || '').slice(0, 64)],
  );
  return !!(r && r.rowCount > 0);
}

/**
 * Is bitti (terminal): o ise bagli kilidi birak. true = kilidi GERCEKTEN bu cagri birakti
 * (held 1 -> 0 compare-and-set). Uygulama SONUCU denetim kaydi buna baglidir: hangi yoldan
 * (ekran, /job-status, devralma, arka plan taramasi) ve hangi Portal orneginden gelinirse
 * gelinsin, yeniden baslatmadan sonra da TEK kez yazilir (isaret DB'de, bellekte degil).
 */
async function kilitBirakIs(db, serverId, jobId, sonuc) {
  const r = await db.query(
    `UPDATE crypto_hub_locks SET held = 0, locked_until = NULL, last_result = $3, updated_at = GETUTCDATE()
      WHERE awx_server_id = $1 AND awx_job_id = $2 AND held = 1`,
    [Number(serverId), Number(jobId), String(sonuc || '').slice(0, 64)],
  );
  return !!(r && r.rowCount > 0);
}

// ── helm_template onizlemesi: Secret maskesi ────────────────────────────────────────
//
// Bastion zaten maskeliyor (crypto_hub_ops.sh), ama AWX'in hangi revizyonu kosturdugu
// bilinmiyor (K-5): Portal da maskeler. Secret belgesindeki data / stringData altindaki HER
// deger, env'de sir adli `name:` sonrasindaki `value:` ve sir adli anahtarlar '****' olur.
function maskeleManifest(lines, sirRe) {
  const s = (Array.isArray(lines) ? lines : []).map((x) => String(x == null ? '' : x));
  const sinirlar = [0];
  s.forEach((l, i) => {
    if (/^---(\s|$)/.test(l)) sinirlar.push(i);
  });
  sinirlar.push(s.length);
  const secret = new Array(s.length).fill(false);
  for (let b = 0; b < sinirlar.length - 1; b += 1) {
    const [bas, son] = [sinirlar[b], sinirlar[b + 1]];
    const parca = s.slice(bas, son);
    if (parca.some((l) => /^kind:\s*["']?Secret["']?\s*(#.*)?$/.test(l))) {
      for (let i = bas; i < son; i += 1) secret[i] = true;
    }
  }
  const out = [];
  let blok = false;
  let blokGirinti = -1;
  let atla = -1;
  let envSir = -1;
  for (let i = 0; i < s.length; i += 1) {
    const l = s[i];
    const girinti = l.length - l.trimStart().length;
    const bos = l.trim() === '' || /^\s*#/.test(l);
    if (/^---(\s|$)/.test(l)) {
      blok = false;
      atla = -1;
      envSir = -1;
      out.push(l);
      continue;
    }
    if (atla >= 0) {
      if (bos || girinti > atla) continue;
      atla = -1;
    }
    if (blok) {
      if (!bos && girinti === 0) {
        blok = false;
      } else {
        if (bos) continue;
        if (blokGirinti < 0) blokGirinti = girinti;
        const m = /^(\s*)("[^"]*"|'[^']*'|[^\s:#][^:#]*?)\s*:(\s|$)/.exec(l);
        if (m && girinti === blokGirinti) {
          out.push(`${m[1]}${m[2]}: ****`);
          atla = girinti;
        }
        continue;
      }
    }
    if (secret[i] && girinti === 0) {
      const m = /^(data|stringData):(.*)$/.exec(l);
      if (m) {
        const rest = m[2].replace(/#.*$/, '').trim();
        if (rest) out.push(`${m[1]}: ****`);
        else {
          out.push(l);
          blok = true;
          blokGirinti = -1;
        }
        continue;
      }
    }
    const ad = /^(\s*)-?\s*name:\s*["']?([A-Za-z0-9_.-]+)["']?\s*$/.exec(l);
    if (ad && sirRe && sirRe.test(ad[2])) {
      envSir = i;
      out.push(l);
      continue;
    }
    if (envSir >= 0 && i - envSir <= 2) {
      const v = /^(\s*)(-\s*)?value:\s*(.*)$/.exec(l);
      if (v && v[3].trim() && v[3].trim() !== '|' && v[3].trim() !== '>') {
        out.push(`${v[1]}${v[2] || ''}value: ****`);
        envSir = -1;
        continue;
      }
      if (v) {
        out.push(`${v[1]}${v[2] || ''}value: ****`);
        atla = girinti;
        envSir = -1;
        continue;
      }
    }
    const k = /^(\s*-?\s*)([A-Za-z0-9_.-]+)\s*:\s*(.+?)\s*$/.exec(l);
    if (k && sirRe && sirRe.test(k[2])) {
      const d = k[3];
      if (d === '|' || d === '>' || d === '|-' || d === '>-') {
        out.push(`${k[1]}${k[2]}: ****`);
        atla = girinti;
        continue;
      }
      if (d !== '{}' && d !== '[]' && d !== 'null' && d !== '""' && d !== "''") {
        out.push(`${k[1]}${k[2]}: ****`);
        continue;
      }
    }
    out.push(l);
  }
  return out;
}

module.exports = {
  parseResourceLines,
  planTemizMi,
  canliKaydet,
  canliAl,
  kapCanli,
  planIsiKaydet,
  planSonucu,
  planAl,
  planTuket,
  isKaydet,
  sablonAdiCoz,
  isKaydiBul,
  isErisimKarari,
  ICERIK_ANAHTARLARI,
  GECMIS_DEGER_AZAMI,
  gecmisParametreleri,
  gecmisSatiriniTemizle,
  KILIT_DK,
  PLAN_ASYNC_MS,
  kilitAnahtari,
  kilitAl,
  kilitOku,
  kilitAktifMi,
  tutulanKilitler,
  kilitIseBagla,
  kilitBirak,
  kilitBirakIs,
  maskeleManifest,
  _sifirla() {
    CANLI.clear();
    PLAN_ISLERI.clear();
    PLANLAR.clear();
    ISLER.clear();
  },
};
