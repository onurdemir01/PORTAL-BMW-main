// server/server-hub/ear-envanter-awx.cjs - AWX'ten (Limit ile) elle baslatilan Uygulama Envanteri
// islerini Portal'a alir (2026-11-05).
//
// Playbook Limit kipinde (hedefler yok) sonucu <ear_dizin>/awx-<is no>/raw'a yazar ve set_stats'ta
// `kaynak: AWX` yayinlar. Burada sablonun BITMIS isleri (son 7 gun) taranir. Alinmayanlar: Portal'in
// kendi baslattigi is (partileri.awx_job_id), set_stats'i olmayan is (or. Limit bos: ilk play'de
// durdu) ve kaynak AWX olmayan is (elle hedefler yazilmis Portal kipi). Alinacak is icin TEK partili
// bir kosu (kaynak AWX, kapsam SECILI) CALISIYOR acilir; gerisini poller'in olagan alim yolu yapar
// (partiyiKontrolEt -> alimaAl -> partiyiAl). Is zaten bittigi icin kosu ayni turda kapanir.
//
// Ayni is iki kez alinmaz: kosu acma kosulu partileri.awx_job_id uzerinde UPDLOCK + HOLDLOCK (iki
// Portal sureci). Portal'in calisan kosusunu BEKLEMEZ ve onu engellemez: haftalik tarama saatlerce
// surer, AWX'te biten is o kadar gecikmemeli.
//
// LIMIT DENETIMI: sablonun varsayilan Limit'i doluyken Portal kipi hicbir sey taramadan "successful"
// biter (ear_envanter.yml TUZAK, EP8). Portal o sablonla parti BASLATMAZ (limitDenetimi).
'use strict';

const alim = require('./ear-envanter-alim.cjs');

const ARALIK_MS = 2 * 60 * 1000;
const GERI_GUN = 7;
const SAYFA = 50;
const BAKILDI_SINIR = 5000;
const STATS_ANAHTARI = 'ear_envanter_result';

let _sonTarama = 0;
// Alinmayacagi kesinlesen isler (`<sunucu>:<is>`): her turda AWX'ten yeniden okunmasin.
const _bakildi = new Set();

const db = () => require('../db/index.cjs');
const runner = () => require('../ansible/runner.cjs');
const maskele = (s) => require('../retirement/is-ciktisi.cjs').maskele(String(s == null ? '' : s));
const M = (v, n) => String(v == null ? '' : v).slice(0, n);

function hata(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

/** Playbook Kayitlari satiri -> { templateId, serverId } ya da null (tanimsiz / kapali). */
async function sablonBul() {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg
    .getByKey(require('./ear-envanter-poller.cjs').REGISTRY_KEY)
    .catch(() => null);
  if (!row || row.enabled === false) return null;
  const templateId = Number(reg.getEffectiveTemplateId(row)) || 0;
  if (!templateId) return null;
  return { templateId, serverId: row.awxServerId != null ? Number(row.awxServerId) : 0 };
}

/**
 * Portal kipinde parti baslatmadan once: sablonun varsayilan Limit'i dolu ise 409. Ayarlar
 * okunamazsa ENGELLEMEZ (template-preflight gibi fail-open): bu ek bir emniyettir.
 */
async function limitDenetimi() {
  const s = await sablonBul().catch(() => null);
  if (!s) return;
  let ham;
  try {
    ham = await runner().getTemplateDefaultLimitOnServer(s.serverId, s.templateId);
  } catch {
    return;
  }
  const limit = typeof ham === 'string' ? ham.trim() : '';
  if (limit)
    throw hata(
      409,
      `AWX şablonunun (Template ID ${s.templateId}) Limit alanı dolu ("${M(limit, 80)}"). Limit doluyken playbook ` +
        `hiçbir sunucuyu taramadan biter; Portal taraması için Limit alanını boşaltın. Elle taramada Limit'i ` +
        `Launch ekranında yazın (Limit › Prompt on launch açık).`,
      'sablon_limit_dolu',
    );
}

/** set_stats hostlari -> [{host, ortam}]: BUYUK harf, gecerli ad, tekil, sirali. */
function hostlarOf(stats, ortamlar) {
  const gorulen = new Set();
  const out = [];
  for (const h of Array.isArray(stats && stats.hostlar) ? stats.hostlar : []) {
    const ad = String((h && h.host) || '')
      .trim()
      .toUpperCase();
    if (!alim.HOST_RE.test(ad) || gorulen.has(ad)) continue;
    gorulen.add(ad);
    out.push({ host: ad, ortam: M(ortamlar.get(ad) || '', 128) });
  }
  return out.sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
}

/** MWAppsInventory'den host -> ortam (SALT OKUNUR). Okunamazsa bos: ortam bilgisi eksik kalir. */
async function ortamHaritasi() {
  try {
    const { hedefler } = await require('./ear-envanter-poller.cjs').filoHedefleri();
    return new Map(hedefler.map((h) => [h.host, h.ortam]));
  } catch {
    return new Map();
  }
}

// Tek ifade: ayni AWX isi icin parti varsa (Portal'in kendi isi ya da daha once alinmis) satir EKLENMEZ.
const AWX_KOSU_SQL = `SET XACT_ABORT ON;
DECLARE @id INT = NULL;
BEGIN TRAN;
INSERT INTO ear_envanter_kosulari (kip, kaynak, kapsam, durum, beklenen, parti_sayisi, parametreler, baslatan)
  SELECT $1, 'AWX', 'SECILI', 'CALISIYOR', $2, 1, $3, $4
   WHERE NOT EXISTS (SELECT 1 FROM ear_envanter_partileri WITH (UPDLOCK, HOLDLOCK)
                      WHERE awx_server_id = $5 AND awx_job_id = $6);
IF @@ROWCOUNT = 1
BEGIN
  SET @id = SCOPE_IDENTITY();
  INSERT INTO ear_envanter_partileri (kosu_id, parti_no, hostlar, host_sayisi, durum, baslatma_denemesi, started_at, awx_server_id, awx_job_id, awx_durum)
    VALUES (@id, 1, $7, $2, 'CALISIYOR', 1, SYSUTCDATETIME(), $5, $6, $8);
END
COMMIT;
SELECT @id AS id;`;

/**
 * Tek AWX isi. Donus: { alindi: kosuId } | { atlandi: neden }. Kesin "alinmaz" kararinda is
 * _bakildi'ya yazilir; AWX okunamazsa yazilmaz (sonraki turda yeniden denenir).
 */
async function isiAl(s, jobId, ortamlar) {
  const anahtar = `${s.serverId}:${jobId}`;
  const bilinen = await db().query(
    `SELECT TOP 1 kosu_id FROM ear_envanter_partileri WHERE awx_server_id = $1 AND awx_job_id = $2`,
    [s.serverId, jobId],
  );
  if (bilinen.rows && bilinen.rows.length) {
    _bakildi.add(anahtar);
    return { atlandi: 'portal_bilinen' };
  }
  const st = await runner().getJobStatusOnServer(s.serverId, jobId);
  if (st.templateId !== undefined && Number(st.templateId) !== s.templateId) {
    _bakildi.add(anahtar);
    return { atlandi: 'baska_sablon' };
  }
  const { extractStatsKey } = require('../scalex/result.cjs');
  const stats = st.artifacts ? extractStatsKey(st.artifacts, STATS_ANAHTARI) : null;
  if (!stats || typeof stats !== 'object') {
    _bakildi.add(anahtar);
    return { atlandi: 'set_stats_yok' };
  }
  if (String(stats.kaynak) !== 'AWX' || Number(stats.awx_job_id) !== Number(jobId)) {
    _bakildi.add(anahtar);
    return { atlandi: 'limit_kipi_degil' };
  }
  const hostlar = hostlarOf(stats, ortamlar);
  if (!hostlar.length) {
    _bakildi.add(anahtar);
    return { atlandi: 'host_yok' };
  }
  const kip = ['OZET', 'TAM'].includes(String(stats.kip)) ? String(stats.kip) : 'OZET';
  const baslatan = M(st.launchedBy, 100) || 'awx';
  const parametreler = {
    dizin: alim.earDizin(),
    awx_job_id: Number(jobId),
    limit: M(stats.limit, 300),
    awx_baslatan: baslatan,
  };
  const r = await db().query(
    AWX_KOSU_SQL,
    [
      kip,
      hostlar.length,
      JSON.stringify(parametreler),
      `awx:${baslatan}`.slice(0, 128),
      s.serverId,
      Number(jobId),
      JSON.stringify(hostlar),
      M(st.status, 16) || 'unknown',
    ],
    { tekrar: false },
  );
  _bakildi.add(anahtar);
  const id = r.rows && r.rows[0] ? r.rows[0].id : null;
  if (id == null) return { atlandi: 'zaten_alindi' };
  console.log(
    `[EarEnvanter] AWX isi ${jobId} kosu ${id} olarak alindi (${hostlar.length} sunucu, ${kip})`,
  );
  return { alindi: Number(id) };
}

/** Poller turundan: en cok 2 dk'da bir, sablonun son 7 gunde biten isleri. */
async function awxIsleriniAl({ simdi = Date.now(), zorla = false } = {}) {
  if (!zorla && simdi - _sonTarama < ARALIK_MS) return null;
  _sonTarama = simdi;
  const s = await sablonBul();
  if (!s) return { atlandi: 'template_yok' };
  const isler = await runner().listTemplateJobsOnServer(s.serverId, s.templateId, {
    finishedAfter: new Date(simdi - GERI_GUN * 86400000).toISOString(),
    pageSize: SAYFA,
  });
  const yeni = isler.filter((j) => !_bakildi.has(`${s.serverId}:${j.id}`));
  if (!yeni.length) return { alinan: [] };
  if (_bakildi.size > BAKILDI_SINIR) _bakildi.clear();
  const ortamlar = await ortamHaritasi();
  const alinan = [];
  for (const j of yeni) {
    try {
      const r = await isiAl(s, j.id, ortamlar);
      if (r.alindi) alinan.push(r.alindi);
    } catch (e) {
      console.warn(`[EarEnvanter] AWX isi ${j.id} alinamadi:`, maskele(e && e.message));
    }
  }
  return { alinan };
}

module.exports = {
  ARALIK_MS,
  GERI_GUN,
  AWX_KOSU_SQL,
  sablonBul,
  limitDenetimi,
  hostlarOf,
  isiAl,
  awxIsleriniAl,
  _sifirlaForTest: () => {
    _sonTarama = 0;
    _bakildi.clear();
  },
};
