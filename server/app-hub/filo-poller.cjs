// server/app-hub/filo-poller.cjs - Application Hub: saatlik OpenShift filo taramasi yurutucusu (2026-11-18).
//
// Her dakika bir tur:
//   1. Aktif kosuyu ilerletir: BASLATILIYOR -> CALISIYOR (AWX isi) -> ALINIYOR (/sw dosyalari -> DB) -> BITTI | HATA.
//   2. Aktif kosu yoksa ve bu zaman diliminde (APP_HUB_FILO_ARALIK_DK, varsayilan 60) kosu acilmadiysa yenisini acar.
//   3. Alti saatte bir saklama: eski kosu satirlari, eski /sw kosu dizinleri, 7 gundur tazelenmeyen onbellek satirlari.
//
// Tek kosu / tek dilim kurali DB'de: kosu satiri tek ifadeyle (UPDLOCK + HOLDLOCK) acilir; anahtar UNIQUE.
// Iki Portal sureci ayni anda calissa da ayni dilim iki kez kosmaz, kosular ust uste binmez. Durum gecisleri
// kosullu UPDATE (CAS). Portal kapaliyken kacan dilim telafi edilmez: bir sonraki dilim zaten tam taramadir.
//
// Kapatma: APP_HUB_FILO_KAPALI=1 (yeni kosu acilmaz; aktif kosu yine de alinir). Playbook Kayitlari'nda
// app_hub_ocp_filo satiri yoksa / kapaliysa hic kosu acilmaz (bir kez log).
'use strict';

const os = require('node:os');
const fs = require('node:fs');

const TIK_MS = 60 * 1000;
const BASLATMA_KAYIP_SN = 15 * 60;
const IS_KAYIP_SN = 4 * 60 * 60;
const ALIM_KAYIP_SN = 30 * 60;
// ALINIYOR icin mutlak tavan (kosu baslangicindan): alim her denemede ayni hatayla dusse de kosu sonsuza dek
// AKTIF kalip sonraki tum dilimleri kilitlemesin.
const ALIM_TAVAN_SN = IS_KAYIP_SN + 2 * 60 * 60;
const SAKLAMA_ARALIK_MS = 6 * 60 * 60 * 1000;
const KOSU_SAKLAMA_GUN = 14;
const DIZIN_SAKLAMA_MS = 48 * 60 * 60 * 1000;
const ONBELLEK_SAKLAMA_GUN = 7;
const REGISTRY_KEY = 'app_hub_ocp_filo';
const SISTEM_KULLANICI = 'app-hub-filo-zamanlayici';
const BITMIS_AWX = new Set(['successful', 'failed', 'error', 'canceled']);
const AKTIF = "('BASLATILIYOR', 'CALISIYOR', 'ALINIYOR')";

let _timer = null;
let _ticking = false;
let _sonSaklama = 0;
let _sablonYokLog = false;

const db = () => require('../db/index.cjs');
const filo = () => require('./filo.cjs');
const M = (v, n) => String(v == null ? '' : v).slice(0, n);
const maskele = (s) => {
  try {
    return require('../retirement/is-ciktisi.cjs').maskele(String(s == null ? '' : s));
  } catch {
    return String(s == null ? '' : s);
  }
};

/** Ortam ayarlari (her turda yeniden okunur). */
function ayar(env = process.env) {
  const dk = Number(env.APP_HUB_FILO_ARALIK_DK);
  const aralikDk =
    Number.isFinite(dk) && dk > 0 ? Math.min(1440, Math.max(30, Math.round(dk))) : 60;
  const yazici = String(env.APP_HUB_FILO_YAZICI || os.hostname().split('.')[0] || '')
    .trim()
    .toUpperCase();
  return { kapali: String(env.APP_HUB_FILO_KAPALI || '') === '1', aralikDk, yazici };
}

/** Zaman dilimi anahtari: ayni dilimde tek kosu. Aralik degisirse anahtar uzayi da degisir (F<dk>-<dilim>). */
function dilimAnahtari(simdiMs, aralikDk) {
  return `F${aralikDk}-${Math.floor(simdiMs / (aralikDk * 60 * 1000))}`;
}

async function sablonBul() {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(REGISTRY_KEY).catch(() => null);
  if (!row || row.enabled === false) return null;
  const templateId = Number(reg.getEffectiveTemplateId(row)) || 0;
  if (!templateId) return null;
  const envServer = Number(String(process.env.OPSX_AWX_SERVER_ID || '').trim());
  let serverId = 0;
  if (row.awxServerId != null) serverId = Number(row.awxServerId);
  else if (Number.isInteger(envServer) && envServer >= 0) serverId = envServer;
  return { templateId, serverId };
}

const KOSU_AC_SQL = `SET XACT_ABORT ON;
DECLARE @id INT = NULL;
BEGIN TRAN;
INSERT INTO app_hub_ocp_filo_kosu (anahtar, durum, awx_server_id)
  SELECT $1, 'BASLATILIYOR', $2
   WHERE NOT EXISTS (SELECT 1 FROM app_hub_ocp_filo_kosu WITH (UPDLOCK, HOLDLOCK)
                      WHERE anahtar = $1 OR durum IN ${AKTIF});
IF @@ROWCOUNT = 1 SET @id = SCOPE_IDENTITY();
COMMIT;
SELECT @id AS id;`;

/** Katalogdaki tum aktif cluster'lar icin fan-out extra_vars'i (canli okumayla ayni cozum yolu). */
async function extraVarsKur(kosuId, a) {
  const { rows } = await db().query(
    'SELECT env, tenant, cluster_name FROM ocp_cluster_index WHERE is_active = 1',
  );
  const admin = require('../logx/v2/admin.cjs');
  const ocp = require('../logx/v2/ocp.cjs');
  const gruplar = new Map();
  for (const r of rows) {
    const k = `${r.env}|${r.tenant}`;
    if (!gruplar.has(k)) gruplar.set(k, { env: r.env, tenant: r.tenant, clusters: [] });
    gruplar.get(k).clusters.push(String(r.cluster_name || '').trim());
  }
  const gorulen = new Set();
  const ocpClusters = [];
  const terminal = new Set();
  const atlanan = [];
  for (const g of gruplar.values()) {
    const { hosts, missing } = await admin.resolveTerminalHosts(g.env, g.tenant, g.clusters);
    atlanan.push(...missing);
    const meta = await admin.resolveClusterMeta(g.env, g.tenant, g.clusters).catch(() => ({}));
    const kullan = g.clusters.filter(
      (c) => c && !missing.includes(c) && !gorulen.has(c.toLowerCase()),
    );
    kullan.forEach((c) => gorulen.add(c.toLowerCase()));
    const ev = ocp.buildOcpExtraVars({
      env: g.env,
      tenant: g.tenant,
      clusters: kullan,
      hosts,
      meta,
    });
    ocpClusters.push(...ev.ocp_clusters);
    for (const t of ev.terminal_hosts) if (t) terminal.add(t);
  }
  if (!ocpClusters.length) {
    throw Object.assign(
      new Error('Katalogda Jump Server (bastion) tanımlı aktif OpenShift cluster yok.'),
      { status: 422 },
    );
  }
  const runtime = ocp.buildOcpRuntimeVars(
    await require('../logx/v2/ocp-runtime-config.cjs')
      .getConfig()
      .catch(() => ({})),
  );
  const { varsayilanSira } = require('../util/siralama.cjs');
  return {
    extraVars: {
      ...runtime,
      terminal_hosts: [...terminal].sort(varsayilanSira),
      ocp_clusters: ocpClusters,
      app_hub_fleet_run: kosuId,
      app_hub_fleet_dir: filo().filoDizini(),
      app_hub_fleet_writer: a.yazici,
    },
    atlanan,
  };
}

async function kosuHata(id, mesaj, onceki) {
  await db().query(
    `UPDATE app_hub_ocp_filo_kosu SET durum = 'HATA', hata = $1, bitis = SYSUTCDATETIME() WHERE id = $2 AND durum = $3`,
    [M(maskele(mesaj), 2000), id, onceki],
  );
}

/** Bu dilimde kosu acilmadiysa acar ve AWX isini baslatir. Donus: acilan kosu id'si ya da null. */
async function zamanla(simdiMs = Date.now()) {
  const a = ayar();
  if (a.kapali) return null;
  const s = await sablonBul();
  if (!s) {
    if (!_sablonYokLog)
      console.log(`[AppHubFilo] ${REGISTRY_KEY} sablonu tanimli degil; saatlik tarama bekliyor`);
    _sablonYokLog = true;
    return null;
  }
  _sablonYokLog = false;
  const anahtar = dilimAnahtari(simdiMs, a.aralikDk);
  const { rows } = await db().query(KOSU_AC_SQL, [anahtar, s.serverId], { tekrar: false });
  const id = rows[0]?.id != null ? Number(rows[0].id) : null;
  if (!id) return null;
  try {
    if (!a.yazici)
      throw Object.assign(new Error('APP_HUB_FILO_YAZICI bos ve sunucu adi okunamadi.'), {
        status: 422,
      });
    const kur = await extraVarsKur(id, a);
    // Yanlis eslenmis sablon baska bir isi her saat filo degiskenleriyle kosturmasin: playbook adi + prompt on launch.
    await require('../ansible/template-preflight.cjs').assertRegistryTemplate(
      s.serverId,
      s.templateId,
      REGISTRY_KEY,
      kur.extraVars,
    );
    const job = await require('../ansible/runner.cjs').launchJobOnServer(
      s.serverId,
      s.templateId,
      kur.extraVars,
      '',
      {
        username: SISTEM_KULLANICI,
        displayName: 'Application Hub saatlik tarama',
        role: 'system',
      },
    );
    const jobId = job?.jobId ? Number(job.jobId) : null;
    if (!jobId) throw new Error('AWX iş numarası dönmedi.');
    await db().query(
      `UPDATE app_hub_ocp_filo_kosu SET durum = 'CALISIYOR', awx_job_id = $1, cluster_sayisi = $2 WHERE id = $3 AND durum = 'BASLATILIYOR'`,
      [jobId, kur.extraVars.ocp_clusters.length, id],
    );
    await isGecmisi(s, jobId, id, kur).catch((e) =>
      console.warn('[AppHubFilo] is gecmisi yazilamadi:', maskele(e?.message)),
    );
    console.log(
      `[AppHubFilo] kosu ${id} basladi: job=${jobId} cluster=${kur.extraVars.ocp_clusters.length} atlanan=${kur.atlanan.length}`,
    );
  } catch (e) {
    console.warn(`[AppHubFilo] kosu ${id} baslatilamadi:`, maskele(e?.message));
    await kosuHata(id, e?.message || e, 'BASLATILIYOR');
  }
  return id;
}

async function isGecmisi(s, jobId, kosuId, kur) {
  await db().query(
    `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      SISTEM_KULLANICI,
      s.serverId,
      s.templateId,
      'Application Hub: OpenShift saatlik tarama',
      jobId,
      'pending',
      JSON.stringify({
        platform: 'app-hub-ocp-filo',
        kosu: kosuId,
        cluster_sayisi: kur.extraVars.ocp_clusters.length,
      }),
    ],
  );
}

/** Biten isin sonucunu alir (ALINIYOR kilidi alinmis olmali). */
async function al(r, st) {
  const C = require('./canli.cjs');
  const raw = C.statsOku(st.artifacts, filo().STATS_KEY);
  if (!raw) {
    await kosuHata(
      r.id,
      `İş ${st.status} bitti ama sonuç yayınlanmadı (set_stats ${filo().STATS_KEY}); AWX iş çıktısına bakın.`,
      'ALINIYOR',
    );
    return;
  }
  if (String(raw.run) !== String(r.id)) {
    await kosuHata(r.id, `İş başka bir koşuya ait (run=${M(raw.run, 20)}).`, 'ALINIYOR');
    return;
  }
  // Tarama zamani: AWX isinin basladigi an (yoksa kosu acilisi). Alim zamani DEGIL (bkz. filo.kosuyuAl).
  const zaman = st.started
    ? new Date(st.started)
    : r.baslangic
      ? new Date(r.baslangic)
      : new Date();
  const sonuc = await filo().kosuyuAl(
    r.id,
    raw,
    Number.isNaN(zaman.getTime()) ? new Date() : zaman,
  );
  const ok = sonuc.clusterlar.filter((c) => c.ok).length;
  await db().query(
    `UPDATE app_hub_ocp_filo_kosu SET durum = 'BITTI', bitis = SYSUTCDATETIME(), ozet_json = $1, hata = $2 WHERE id = $3 AND durum = 'ALINIYOR'`,
    [
      JSON.stringify({
        awx: st.status,
        genel: raw.overall_status || null,
        clusterlar: sonuc.clusterlar,
      }),
      ok ? null : 'Hiçbir cluster alınamadı.',
      r.id,
    ],
  );
  try {
    require('./index.cjs')._ic._onbellek.clear();
  } catch {
    /* modul yuklu degil */
  }
  console.log(`[AppHubFilo] kosu ${r.id} alindi: ${ok}/${sonuc.clusterlar.length} cluster`);
}

/** Takilan isi AWX'te iptal eder (en iyi caba): HATA yazilip yeni dilim acilinca eski is ust uste binmesin. */
async function isiIptalEt(r) {
  try {
    await require('../ansible/runner.cjs').cancelJobOnServer(r.awx_server_id || 0, r.awx_job_id);
  } catch (e) {
    console.warn(`[AppHubFilo] kosu ${r.id} AWX isi iptal edilemedi:`, maskele(e?.message));
  }
}

/** Is gecmisi satirini sonlandirir (yoksa 24 satir/gun sonsuza dek "pending" kalirdi). */
async function gecmisiKapat(r, durum) {
  await db()
    .query(
      `UPDATE ansible_job_history SET status = $1, finished_at = COALESCE(finished_at, GETUTCDATE())
        WHERE job_id = $2 AND awx_server_id = $3 AND status <> $1`,
      [durum, r.awx_job_id, r.awx_server_id || 0],
    )
    .catch((e) => console.warn('[AppHubFilo] is gecmisi kapatilamadi:', maskele(e?.message)));
}

async function calisaniIlerlet(r) {
  let st;
  try {
    st = await require('../ansible/runner.cjs').getJobStatusOnServer(
      r.awx_server_id || 0,
      r.awx_job_id,
    );
  } catch (e) {
    // AWX okunamiyor (404, sunucu kaldirilmis, erisilemiyor): kisa kesintide bekle; tavan asilinca kosuyu kapat ki
    // sonraki dilimler kilitli kalmasin.
    if (r.yas <= IS_KAYIP_SN) throw e;
    await kosuHata(
      r.id,
      `AWX işinin durumu ${Math.round(IS_KAYIP_SN / 3600)} saattir okunamıyor: ${e?.message || e}`,
      'CALISIYOR',
    );
    return;
  }
  if (!BITMIS_AWX.has(st.status)) {
    if (r.yas > IS_KAYIP_SN) {
      await isiIptalEt(r);
      await kosuHata(
        r.id,
        `AWX işi ${Math.round(IS_KAYIP_SN / 3600)} saatte bitmedi (durum ${st.status}); iş iptal edildi.`,
        'CALISIYOR',
      );
      await gecmisiKapat(r, 'canceled');
    }
    return;
  }
  await gecmisiKapat(r, st.status);
  const u = await db().query(
    `UPDATE app_hub_ocp_filo_kosu SET durum = 'ALINIYOR', alim_baslangic = SYSUTCDATETIME() WHERE id = $1 AND durum = 'CALISIYOR'`,
    [r.id],
    { tekrar: false },
  );
  if (u.rowCount === 1) await al(r, st);
}

async function alimiYenile(r) {
  if (r.yas > ALIM_TAVAN_SN) {
    await kosuHata(
      r.id,
      'Sonuç alımı tekrar tekrar yarım kaldı; koşu kapatıldı (sonraki dilim yeniden tarar).',
      'ALINIYOR',
    );
    return;
  }
  if (r.alim_yas == null || r.alim_yas <= ALIM_KAYIP_SN) return;
  const u = await db().query(
    `UPDATE app_hub_ocp_filo_kosu SET alim_baslangic = SYSUTCDATETIME()
      WHERE id = $1 AND durum = 'ALINIYOR' AND DATEDIFF(SECOND, alim_baslangic, SYSUTCDATETIME()) > $2`,
    [r.id, ALIM_KAYIP_SN],
    { tekrar: false },
  );
  if (u.rowCount !== 1) return;
  const st = await require('../ansible/runner.cjs').getJobStatusOnServer(
    r.awx_server_id || 0,
    r.awx_job_id,
  );
  await al(r, st);
}

/** Aktif kosulari ilerletir. AWX okunamazsa hicbir sey yazilmaz; sonraki tur yeniden dener. */
async function ilerlet() {
  const { rows } = await db().query(
    `SELECT TOP 5 id, durum, awx_server_id, awx_job_id, baslangic,
            DATEDIFF(SECOND, baslangic, SYSUTCDATETIME()) AS yas,
            DATEDIFF(SECOND, alim_baslangic, SYSUTCDATETIME()) AS alim_yas
       FROM app_hub_ocp_filo_kosu WHERE durum IN ${AKTIF} ORDER BY id`,
  );
  for (const r of rows) {
    try {
      if (r.durum === 'BASLATILIYOR') {
        if (r.yas > BASLATMA_KAYIP_SN)
          await kosuHata(
            r.id,
            'Başlatma yarım kaldı (Portal yeniden başlamış olabilir).',
            'BASLATILIYOR',
          );
      } else if (r.durum === 'CALISIYOR') await calisaniIlerlet(r);
      else await alimiYenile(r);
    } catch (e) {
      console.warn(`[AppHubFilo] kosu ${r.id} ilerletilemedi:`, maskele(e?.message));
    }
  }
}

/** Alti saatte bir: eski kosular, eski /sw kosu dizinleri, uzun suredir tazelenmeyen onbellek satirlari. */
async function saklama(simdiMs = Date.now()) {
  if (simdiMs - _sonSaklama < SAKLAMA_ARALIK_MS) return;
  _sonSaklama = simdiMs;
  await db().query(
    `DELETE FROM app_hub_ocp_filo_kosu WHERE durum IN ('BITTI', 'HATA') AND baslangic < DATEADD(DAY, -${KOSU_SAKLAMA_GUN}, SYSUTCDATETIME())`,
  );
  await db().query(
    `DELETE FROM app_hub_ocp_filo WHERE alinma < DATEADD(DAY, -${ONBELLEK_SAKLAMA_GUN}, SYSUTCDATETIME())`,
  );
  dizinleriTemizle(simdiMs);
}

function dizinleriTemizle(simdiMs) {
  let dizin;
  try {
    dizin = filo().filoDizini();
  } catch {
    return;
  }
  let adlar = [];
  try {
    adlar = fs.readdirSync(dizin);
  } catch {
    return;
  }
  for (const ad of adlar) {
    if (!/^run-\d+$/.test(ad)) continue;
    try {
      const yol = `${dizin}/${ad}`;
      if (simdiMs - fs.statSync(yol).mtimeMs > DIZIN_SAKLAMA_MS)
        fs.rmSync(yol, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[AppHubFilo] ${ad} silinemedi:`, maskele(e?.message));
    }
  }
}

async function tur() {
  await ilerlet();
  await zamanla();
  await saklama();
}

function startPoller() {
  if (_timer) return;
  _timer = setInterval(() => {
    if (_ticking) return;
    _ticking = true;
    tur()
      .catch((e) => console.warn('[AppHubFilo] tur:', maskele(e?.message)))
      .finally(() => {
        _ticking = false;
      });
  }, TIK_MS);
  if (_timer.unref) _timer.unref();
  console.log(`[AppHubFilo] saatlik tarama yurutucusu basladi (${TIK_MS / 1000} sn tur)`);
}

module.exports = {
  REGISTRY_KEY,
  ayar,
  dilimAnahtari,
  zamanla,
  ilerlet,
  saklama,
  extraVarsKur,
  startPoller,
  _ic: { al },
};
