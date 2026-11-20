// server/server-hub/reboot-check-awx.cjs - Reboot Kontrolu: AWX'te (Portal disinda) kosan reboot_check
// islerini Portal'a alir (2026-11-17).
//
// Kullanici: "bu job'i unix admin ekibime versem, onlar kendi Ansible workflow'larina ekleseler remediation
// calisir mi? portal'a veri gelir mi? ... iki turlu de sistem calissin." Portal akisi (Portal baslatir, once
// goruntusunu saklar, sonra'ya rc_once verir) DEGISMEDI. Ek olarak:
//   * Playbook (reboot_check.yml) "once" fazinda goruntuyu set_stats ile rc_once olarak da yayinlar: AWX
//     workflow'unda sonraki "sonra" dugumu onu extra var olarak alir (Portal'siz remediation).
//   * Bu modul Playbook Kayitlari'ndaki reboot_check sablonunun son GERI_GUN gunde BITEN islerini tarar.
//     Portal'in kendi baslattigi is (once_job_id / sonra_job_id) atlanir. Gerisi:
//       - faz once  -> yeni kayit (kaynak AWX, durum once_kosuyor) acilir; reboot-check.cjs ilerlet() sonucu
//                      okur ve once_hazir / once_hata yazar (Portal kaydiyla AYNI kod yolu).
//       - faz sonra -> eslesen kayda baglanir: (1) ayni AWX workflow isi, (2) yoksa kaynak AWX, once'si
//                      sonra'dan ONCE alinmis, sonra'si bos, sunuculari kapsayan EN YENI kayit (GERI_GUN icinde).
//                      Eslesme yoksa sonra isinin rc_once'undan (workflow artifacts) once goruntusu kurulur ve
//                      tek basina kayit acilir; rc_once de yoksa once'siz kayit (Portal "once goruntusu yok" der).
//                      Sonra durum sonra_kosuyor yazilir; ilerlet() sonucu okur (Portal kaydiyla AYNI kod yolu).
//   * Alinan "once" kaydindan Portal'da "Reboot sonrasi kontrol et ve duzelt" de calisir (iki yol birlikte).
//
// Ayni is iki kez alinmaz: ekleme / baglama kosulu UPDLOCK + HOLDLOCK ile ayni is numarasini arar (iki Portal
// sureci). Alinmayacagi kesinlesen is _bakildi'da tutulur (her turda AWX'ten yeniden okunmasin). AWX okunamazsa
// hicbir sey yazilmaz; sonraki tur yeniden dener (OKUNAMADI != BASARISIZ).
'use strict';

const { varsayilanSira } = require('../util/siralama.cjs');

const ARALIK_MS = 2 * 60 * 1000;
const GERI_GUN = 7;
const SAYFA = 50;
const BAKILDI_SINIR = 5000;
const STATS_ANAHTARI = 'reboot_check_result';
// Sunucu adi oldugu gibi saklanir (playbook sonuc anahtarlari target_hosts'taki yazimla gelir; ilerlet() o anahtarla
// okur). Eslestirme buyuk/kucuk harf DUYARSIZ.
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

let _sonTarama = 0;
let _timer = null;
let _ticking = false;
const _bakildi = new Set();

const db = () => require('../db/index.cjs');
const runner = () => require('../ansible/runner.cjs');
const rc = () => require('./reboot-check.cjs');
const M = (v, n) => String(v == null ? '' : v).slice(0, n);
const maskele = (s) => {
  try {
    return require('../retirement/is-ciktisi.cjs').maskele(String(s == null ? '' : s));
  } catch {
    return String(s == null ? '' : s);
  }
};

/** Playbook Kayitlari satiri -> { templateId, serverId } ya da null (tanimsiz / kapali). */
async function sablonBul() {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(rc().REGISTRY_KEY).catch(() => null);
  if (!row || row.enabled === false) return null;
  const templateId = Number(reg.getEffectiveTemplateId(row)) || 0;
  if (!templateId) return null;
  return { templateId, serverId: row.awxServerId != null ? Number(row.awxServerId) : 0 };
}

/** Sonucun sunucu adlari: gecerli ad, yazim KORUNUR, tekil, sirali. */
function hostlarOf(sunucular) {
  const out = new Set();
  for (const h of Object.keys(sunucular && typeof sunucular === 'object' ? sunucular : {})) {
    if (HOST_RE.test(h)) out.add(h);
  }
  return [...out].sort(varsayilanSira);
}

/**
 * AWX extra_vars HAM metninden rc_once (sunucu -> satirlar) ya da null. AWX extra_vars'i JSON (ya da
 * YAML) saklar; yalniz JSON cozulur (workflow artifacts JSON gelir). Satir disi deger atilir.
 */
function rcOnceOf(ham) {
  let o;
  try {
    o = JSON.parse(String(ham || ''));
  } catch {
    return null;
  }
  const v = o && typeof o === 'object' ? o.rc_once : null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const [h, satirlar] of Object.entries(v)) {
    if (HOST_RE.test(h) && Array.isArray(satirlar)) out[h] = satirlar.map((l) => String(l));
  }
  return Object.keys(out).length ? out : null;
}

// Tek ifade: ayni AWX isi bir kayitta (once ya da sonra) varsa satir EKLENMEZ.
const ONCE_EKLE_SQL = `SET XACT_ABORT ON;
DECLARE @id INT = NULL;
BEGIN TRAN;
INSERT INTO reboot_checks (hosts_json, notes, status, created_by, once_job_id, once_server_id, kaynak, awx_workflow_id)
  SELECT $1, $2, 'once_kosuyor', $3, $4, $5, 'AWX', $6
   WHERE NOT EXISTS (SELECT 1 FROM reboot_checks WITH (UPDLOCK, HOLDLOCK)
                      WHERE (once_server_id = $5 AND once_job_id = $4) OR (sonra_server_id = $5 AND sonra_job_id = $4));
IF @@ROWCOUNT = 1 SET @id = SCOPE_IDENTITY();
COMMIT;
SELECT @id AS id;`;

// Once'siz (ya da rc_once'tan kurulan) tek basina sonra kaydi: once alanlari doldurulur, durum sonra_kosuyor.
const SONRA_EKLE_SQL = `SET XACT_ABORT ON;
DECLARE @id INT = NULL;
BEGIN TRAN;
INSERT INTO reboot_checks (hosts_json, notes, status, created_by, once_json, once_at, ozet_json, sonra_job_id, sonra_server_id,
                           sonra_hedef_json, kaynak, awx_workflow_id)
  SELECT $1, $2, 'sonra_kosuyor', $3, $4, CASE WHEN $4 IS NULL THEN NULL ELSE SYSUTCDATETIME() END, $5, $6, $7, $8, 'AWX', $9
   WHERE NOT EXISTS (SELECT 1 FROM reboot_checks WITH (UPDLOCK, HOLDLOCK)
                      WHERE (once_server_id = $7 AND once_job_id = $6) OR (sonra_server_id = $7 AND sonra_job_id = $6));
IF @@ROWCOUNT = 1 SET @id = SCOPE_IDENTITY();
COMMIT;
SELECT @id AS id;`;

// Var olan kayda sonra isini baglar: kayit hala baglanabilir durumda ve is baska kayitta yok.
const SONRA_BAGLA_SQL = `SET XACT_ABORT ON;
DECLARE @n INT = 0;
BEGIN TRAN;
UPDATE reboot_checks SET status = 'sonra_kosuyor', sonra_job_id = $1, sonra_server_id = $2, sonra_hedef_json = $3,
       sonra_json = NULL, updated_at = SYSUTCDATETIME()
 WHERE id = $4 AND sonra_job_id IS NULL AND status IN ('once_hazir')
   AND NOT EXISTS (SELECT 1 FROM reboot_checks WITH (UPDLOCK, HOLDLOCK)
                    WHERE (once_server_id = $2 AND once_job_id = $1) OR (sonra_server_id = $2 AND sonra_job_id = $1));
SET @n = @@ROWCOUNT;
COMMIT;
SELECT @n AS n;`;

/**
 * Sonra isi icin eslesen kayit (dogrulama bulgulari 2026-11-17): aday kayitlar kaynak AWX, once_hazir, sonra'si bos, ayni
 * AWX sunucusu. Bir aday YALNIZ su kosullarla secilir:
 *   - once isi sonra isinden ONCE: ayni AWX sunucusunda is numarasi artar (once_job_id < sonra is no). Ice alma ani
 *     (once_at) KULLANILMAZ: ayni turda ya da gecikmeli alinan once'nin once_at'i sonra'nin baslangicindan sonradir;
 *   - kaydin sunuculari sonra isinin sunucularini KAPSAR (harf duyarsiz);
 *   - sonra isi rc_once aldiysa (workflow artifacts / extra_vars), o rc_once'un sunuculari kaydin sunuculariyla AYNI
 *     (ayni workflow'da birden cok once varken dogru once'yi secer);
 *   - workflow'u bilinen iki is farkli workflow'daysa eslesmez.
 * Ayni workflow'un adayi once denenir, sonra workflow'suz / farkli zamanli adaylar (en yeni once). Yoksa null.
 */
async function eslesenKayit(s, st, hedef, jobId) {
  const { rows } = await db().query(
    `SELECT TOP 50 * FROM reboot_checks
      WHERE kaynak = 'AWX' AND once_server_id = $1 AND sonra_job_id IS NULL AND status = 'once_hazir'
        AND once_job_id IS NOT NULL AND once_job_id < $2
        AND created_at >= DATEADD(day, -${GERI_GUN}, SYSUTCDATETIME())
      ORDER BY once_job_id DESC`,
    [s.serverId, Number(jobId)],
  );
  const buyuk = (l) => new Set((Array.isArray(l) ? l : []).map((h) => String(h).toUpperCase()));
  const hedefK = buyuk(hedef);
  const rcOnce = rcOnceOf(st.extraVarsHam);
  const rcK = rcOnce ? buyuk(Object.keys(rcOnce)) : null;
  const uygun = (r) => {
    if (
      st.workflowJobId &&
      r.awx_workflow_id &&
      Number(r.awx_workflow_id) !== Number(st.workflowJobId)
    )
      return false;
    let hostlar = [];
    try {
      hostlar = JSON.parse(r.hosts_json || '[]');
    } catch {
      hostlar = [];
    }
    const kume = buyuk(hostlar);
    if (!hedefK.size || ![...hedefK].every((h) => kume.has(h))) return false;
    if (rcK && (rcK.size !== kume.size || ![...rcK].every((h) => kume.has(h)))) {
      // rc_once kaydin once goruntusunden gelmediyse (baska once): kaydin goruntusu alinan sunuculari ile karsilastir.
      let alinan = null;
      try {
        const o = JSON.parse(r.once_json || 'null');
        alinan = o?.sunucular
          ? buyuk(Object.keys(o.sunucular).filter((h) => o.sunucular[h]?.goruntu_ok))
          : null;
      } catch {
        alinan = null;
      }
      if (alinan?.size !== rcK.size || ![...rcK].every((h) => alinan.has(h))) return false;
    }
    return true;
  };
  const adaylar = rows || [];
  const ayniWf = st.workflowJobId
    ? adaylar.filter((r) => Number(r.awx_workflow_id) === Number(st.workflowJobId))
    : [];
  return ayniWf.find(uygun) || adaylar.filter((r) => !ayniWf.includes(r)).find(uygun) || null;
}

/** Portal'in baslattigi is mi: her Portal baslatmasi ansible_job_history'ye yazilir (server-hub/index.cjs launch). */
async function portalIsiMi(s, jobId) {
  try {
    const { rows } = await db().query(
      `SELECT TOP 1 1 AS var FROM ansible_job_history WHERE job_id = $1 AND (awx_server_id = $2 OR ($2 = 0 AND awx_server_id IS NULL))`,
      [Number(jobId), s.serverId],
    );
    return !!rows?.length;
  } catch {
    // Okunamadiysa ALINMAZ (yanlis "AWX" kaydi acmaktan iyidir); sonraki turda yeniden denenir.
    return null;
  }
}

/** "AWX'ten alindi" notu: kim baslatti, hangi workflow, hangi is (ekranda ve raporda gorunur). */
function notMetni(st, jobId) {
  return M(
    `AWX'ten alındı: iş #${jobId}${st.workflowJobId ? `, workflow #${st.workflowJobId}` : ''}${st.launchedBy ? `, başlatan ${st.launchedBy}` : ''}`,
    500,
  );
}

/**
 * Tek AWX isi. Donus: { alindi: kayitId, faz } | { atlandi: neden }. Kesin "alinmaz" kararinda is _bakildi'ya
 * yazilir; AWX okunamazsa yazilmaz (sonraki turda yeniden denenir).
 */
async function isiAl(s, jobId) {
  const anahtar = `${s.serverId}:${jobId}`;
  const bilinen = await db().query(
    `SELECT TOP 1 id FROM reboot_checks
      WHERE (once_server_id = $1 AND once_job_id = $2) OR (sonra_server_id = $1 AND sonra_job_id = $2)`,
    [s.serverId, jobId],
  );
  if (bilinen.rows?.length) {
    _bakildi.add(anahtar);
    return { atlandi: 'portal_bilinen' };
  }
  // Portal'in baslattigi is (yeniden calistirmada kayittan dusen eski sonra isi dahil) ALINMAZ.
  const portal = await portalIsiMi(s, jobId);
  if (portal === null) return { atlandi: 'gecmis_okunamadi' };
  if (portal) {
    _bakildi.add(anahtar);
    return { atlandi: 'portal_gecmisi' };
  }
  const st = await runner().getJobStatusOnServer(s.serverId, jobId);
  if (st.templateId !== undefined && Number(st.templateId) !== s.templateId) {
    _bakildi.add(anahtar);
    return { atlandi: 'baska_sablon' };
  }
  const { extractStatsKey } = require('../opsx/index.cjs');
  const sonuc = st.artifacts ? extractStatsKey(st.artifacts, STATS_ANAHTARI) : null;
  const faz = String(sonuc?.faz || '').toLowerCase();
  if (!sonuc || typeof sonuc !== 'object' || !['once', 'sonra'].includes(faz)) {
    _bakildi.add(anahtar);
    return { atlandi: 'set_stats_yok' };
  }
  const hedef = hostlarOf(sonuc.sunucular);
  if (!hedef.length) {
    _bakildi.add(anahtar);
    return { atlandi: 'host_yok' };
  }
  const baslatan = `awx:${M(st.launchedBy, 100) || 'awx'}`.slice(0, 128);
  const wf = st.workflowJobId || null;
  let id = null;
  if (faz === 'once') {
    const r = await db().query(
      ONCE_EKLE_SQL,
      [JSON.stringify(hedef), notMetni(st, jobId), baslatan, Number(jobId), s.serverId, wf],
      { tekrar: false },
    );
    id = r.rows?.[0] ? r.rows[0].id : null;
  } else {
    const es = await eslesenKayit(s, st, hedef, jobId);
    if (es) {
      const r = await db().query(
        SONRA_BAGLA_SQL,
        [Number(jobId), s.serverId, JSON.stringify(hedef), es.id],
        { tekrar: false },
      );
      if (r.rows?.[0] && Number(r.rows[0].n) === 1) id = es.id;
    }
    if (id == null) {
      const rcOnce = rcOnceOf(st.extraVarsHam);
      const onceJson = rcOnce
        ? JSON.stringify({
            faz: 'once',
            kaynak: 'rc_once',
            sunucular: Object.fromEntries(
              Object.entries(rcOnce).map(([h, g]) => [h, { goruntu_ok: true, goruntu: g }]),
            ),
          })
        : null;
      const hostlar = [...new Set([...hedef, ...Object.keys(rcOnce || {})])].sort(varsayilanSira);
      const ozet = {
        once: {
          alinan: Object.keys(rcOnce || {}).length,
          toplam: hostlar.length,
          job: rcOnce ? 'rc_once' : 'yok',
          once_bos: [],
        },
      };
      const r = await db().query(
        SONRA_EKLE_SQL,
        [
          JSON.stringify(hostlar),
          notMetni(st, jobId) + (rcOnce ? '' : ' — önce görüntüsü bulunamadı'),
          baslatan,
          onceJson,
          JSON.stringify(ozet),
          Number(jobId),
          s.serverId,
          JSON.stringify(hedef),
          wf,
        ],
        { tekrar: false },
      );
      id = r.rows?.[0] ? r.rows[0].id : null;
    }
  }
  _bakildi.add(anahtar);
  if (id == null) return { atlandi: 'zaten_alindi' };
  // Sonucu Portal kaydiyla AYNI yoldan yaz (once_hazir / once_hata ya da sonra degerlendirmesi).
  try {
    const kayit = await rc().kayit(Number(id));
    if (kayit) await rc().ilerlet(kayit);
  } catch (e) {
    console.warn(
      `[RebootCheck] AWX isi ${jobId} (kayit ${id}) sonucu okunamadi, sonraki okumada:`,
      maskele(e?.message),
    );
  }
  console.log(
    `[RebootCheck] AWX isi ${jobId} (${faz}) kayit ${id} olarak alindi (${hedef.length} sunucu)`,
  );
  return { alindi: Number(id), faz };
}

/** En cok ARALIK_MS'de bir: sablonun son GERI_GUN gunde biten isleri, eskiden yeniye (once once'ler alinsin). */
async function awxIsleriniAl({ simdi = Date.now(), zorla = false } = {}) {
  if (!zorla && simdi - _sonTarama < ARALIK_MS) return null;
  _sonTarama = simdi;
  const s = await sablonBul();
  if (!s) return { atlandi: 'template_yok' };
  const isler = await runner().listTemplateJobsOnServer(s.serverId, s.templateId, {
    finishedAfter: new Date(simdi - GERI_GUN * 86400000).toISOString(),
    pageSize: SAYFA,
  });
  const yeni = isler
    .filter((j) => !_bakildi.has(`${s.serverId}:${j.id}`))
    .sort((a, b) => a.id - b.id);
  if (!yeni.length) return { alinan: [] };
  if (_bakildi.size > BAKILDI_SINIR) _bakildi.clear();
  const alinan = [];
  for (const j of yeni) {
    try {
      const r = await isiAl(s, j.id);
      if (r.alindi) alinan.push(r.alindi);
    } catch (e) {
      console.warn(`[RebootCheck] AWX isi ${j.id} alinamadi:`, maskele(e?.message));
    }
  }
  return { alinan };
}

function startPoller() {
  if (_timer) return;
  _timer = setInterval(() => {
    if (_ticking) return;
    _ticking = true;
    awxIsleriniAl()
      .catch((e) => console.warn('[RebootCheck] AWX isleri:', maskele(e?.message)))
      .finally(() => {
        _ticking = false;
      });
  }, ARALIK_MS);
  if (_timer.unref) _timer.unref();
  console.log(`[RebootCheck] AWX alimi basladi (${ARALIK_MS / 1000} sn)`);
}

module.exports = {
  ARALIK_MS,
  GERI_GUN,
  STATS_ANAHTARI,
  ONCE_EKLE_SQL,
  SONRA_EKLE_SQL,
  SONRA_BAGLA_SQL,
  sablonBul,
  hostlarOf,
  rcOnceOf,
  eslesenKayit,
  portalIsiMi,
  isiAl,
  awxIsleriniAl,
  startPoller,
  _sifirlaForTest: () => {
    _sonTarama = 0;
    _bakildi.clear();
  },
};
