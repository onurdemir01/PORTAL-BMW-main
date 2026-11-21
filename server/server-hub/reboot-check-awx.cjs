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
// SUNUCUDA SAKLI ONCE (2026-11-21, kullanici: "Portal'siz ve workflow'suz once / sonra ... rapor Portal'a gelip
// sanki Portal'dan tetiklenmis gibi incelensin"): playbook once fazinda goruntuyu sunucuya da yazar, rc_once'suz
// sonra fazi onu okur ve sonucuna once_goruntu olarak koyar. Tek basina sonra isi once eslesen AWX once kaydina
// baglanir; eslesme yoksa once goruntusu rc_once'tan, o da yoksa sonucun once_goruntu satirlarindan kurulur.
//
// Ayni is iki kez alinmaz: ekleme / baglama kosulu UPDLOCK + HOLDLOCK ile ayni is numarasini arar (iki Portal
// sureci). Alinmayacagi kesinlesen is _bakildi'da tutulur (her turda AWX'ten yeniden okunmasin). AWX okunamazsa
// hicbir sey yazilmaz; sonraki tur yeniden dener (OKUNAMADI != BASARISIZ).
//
// ALIM DURUMU (2026-11-21, kullanici: "job'i calistirdim ancak Reboot Kontrolu sayfasina hicbir sey gelmedi ...
// Yenile butonu calismiyor"): alim sessizdi; is neden alinmadiysa (sablon tanimsiz, baska sablon, Portal'dan
// baslatilmis, set_stats yok, AWX okunamadi) yalniz sunucu logunda kaliyordu ve Yenile AWX'i 2 dk siniri yuzunden
// hic taramiyordu. Son taramanin ozeti (zaman, sablon, hata, is basina sonuc + neden) bellekte tutulur, ekrana
// GET /reboot-check/awx-alim ile gider; ?tara=1 siniri atlayip taramayi BEKLER (Yenile). Ayni anda tek tarama:
// suren tarama varken gelen cagri ayni sozu bekler.
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
let _suren = null;
let _zorlaSirada = null;
const _bakildi = new Set();
const IS_SINIR = 30;
const _durum = {
  sonTarama: null,
  sablon: null,
  neden: null,
  hata: null,
  bulunan: null,
  isler: new Map(),
};

/** Is basina son sonuc (ekran icin): en yeni IS_SINIR is tutulur. */
function isKaydet(jobId, sonuc) {
  _durum.isler.delete(Number(jobId));
  _durum.isler.set(Number(jobId), {
    jobId: Number(jobId),
    ...sonuc,
    zaman: new Date().toISOString(),
  });
  while (_durum.isler.size > IS_SINIR) {
    const enEski = Math.min(..._durum.isler.keys());
    _durum.isler.delete(enEski);
  }
}

/** Son taramanin ozeti (kopya): ekran "neden gelmedi" sorusunu buradan yanitlar. */
function alimDurumu() {
  return {
    aralikSn: ARALIK_MS / 1000,
    geriGun: GERI_GUN,
    sonTarama: _durum.sonTarama,
    // Tarama suruyor: ekran bitince yeniden sorar (sayfa acilisinda liste ucu taramayi baslatir, beklemez).
    tariyor: !!_suren,
    sablon: _durum.sablon ? { ..._durum.sablon } : null,
    neden: _durum.neden,
    hata: _durum.hata,
    bulunan: _durum.bulunan,
    isler: [..._durum.isler.values()].sort((a, b) => b.jobId - a.jobId).map((x) => ({ ...x })),
  };
}

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

/**
 * Playbook Kayitlari satiri -> { templateId, serverId } ya da null (tanimsiz / kapali). Kayit OKUNAMAZSA
 * firlatir (2026-11-21 inceleme): eskiden null donup ekranda "sablon tanimsiz" yaziyordu; okuma hatasi ayri.
 */
async function sablonBul() {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(rc().REGISTRY_KEY);
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

/**
 * Sonra sonucunun sunucuda sakli once goruntusu (playbook once_goruntu, once_kaynak 'sunucu') -> { SUNUCU: satirlar }
 * ya da null. Yalniz BOOT satiri olan (Portal goruntuTamam kurali) sunucu alinir.
 */
function sakliOnceOf(sunucular) {
  const out = {};
  for (const [h, r] of Object.entries(
    sunucular && typeof sunucular === 'object' ? sunucular : {},
  )) {
    const g = r && Array.isArray(r.once_goruntu) ? r.once_goruntu.map((l) => String(l)) : [];
    if (HOST_RE.test(h) && g.some((l) => l.startsWith('BOOT|'))) out[h] = g;
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
  const workflow = st.workflowJobId ? ', workflow #' + st.workflowJobId : '';
  const baslatan = st.launchedBy ? ', başlatan ' + st.launchedBy : '';
  return M(`AWX'ten alındı: iş #${jobId}${workflow}${baslatan}`, 500);
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
      const rcOnceEv = rcOnceOf(st.extraVarsHam);
      const rcOnce = rcOnceEv || sakliOnceOf(sonuc.sunucular);
      const onceJson = rcOnce
        ? JSON.stringify({
            faz: 'once',
            kaynak: rcOnceEv ? 'rc_once' : 'sunucu',
            sunucular: Object.fromEntries(
              Object.entries(rcOnce).map(([h, g]) => [h, { goruntu_ok: true, goruntu: g }]),
            ),
          })
        : null;
      const hostlar = [...new Set([...hedef, ...Object.keys(rcOnce || {})])].sort(varsayilanSira);
      let onceKaynagi = 'yok';
      if (rcOnceEv) onceKaynagi = 'rc_once';
      else if (rcOnce) onceKaynagi = 'sunucu';
      const ozet = {
        once: {
          alinan: Object.keys(rcOnce || {}).length,
          toplam: hostlar.length,
          job: onceKaynagi,
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
  // Suren tarama varsa ikinci tarama ayni anda baslamaz. Zorla (Yenile) cagri suren taramaya KATILMAZ: o tarama
  // AWX'i Yenile'den once listelemis olabilir (az once biten is onda yok). Bitince BIR yeni tarama kuyruga girer;
  // kuyruktaki varken gelen zorla cagri ona katilir (2026-11-21 inceleme).
  if (_suren) {
    if (!zorla) return _suren;
    if (!_zorlaSirada) {
      _zorlaSirada = _suren
        .catch(() => {})
        .then(() => {
          _zorlaSirada = null;
          return awxIsleriniAl({ zorla: true });
        });
    }
    return _zorlaSirada;
  }
  if (!zorla && simdi - _sonTarama < ARALIK_MS) return null;
  _sonTarama = simdi;
  _suren = tara(simdi).finally(() => {
    _suren = null;
  });
  return _suren;
}

async function tara(simdi) {
  _durum.sonTarama = new Date(simdi).toISOString();
  _durum.hata = null;
  _durum.neden = null;
  _durum.bulunan = null;
  _durum.sablon = null;
  let s;
  try {
    s = await sablonBul();
  } catch (e) {
    _durum.hata = maskele(e?.message) || 'Playbook Kayıtları okunamadı';
    throw e;
  }
  // AWX sunucusunun adi da yazilir: is BASKA bir AWX'te (or. Maestro3) kosturulduysa Portal onu hic gormez;
  // ekran hangi AWX'in tarandigini soylemezse bu fark edilmez (2026-11-21 sahada boyle oldu).
  let sunucuAdi = null;
  if (s) {
    try {
      sunucuAdi = runner().getServerById(s.serverId)?.name || null;
    } catch {
      sunucuAdi = null;
    }
  }
  _durum.sablon = s ? { ...s, sunucuAdi } : null;
  if (!s) {
    _durum.neden = 'template_yok';
    return { atlandi: 'template_yok' };
  }
  let isler;
  try {
    isler = await runner().listTemplateJobsOnServer(s.serverId, s.templateId, {
      finishedAfter: new Date(simdi - GERI_GUN * 86400000).toISOString(),
      pageSize: SAYFA,
    });
  } catch (e) {
    _durum.hata = maskele(e?.message) || 'AWX okunamadı';
    throw e;
  }
  _durum.bulunan = isler.length;
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
      isKaydet(
        j.id,
        r.alindi
          ? { sonuc: 'alindi', kayitId: r.alindi, faz: r.faz || null, awxDurum: j.status || null }
          : { sonuc: 'atlandi', neden: r.atlandi || null, awxDurum: j.status || null },
      );
    } catch (e) {
      const mesaj = maskele(e?.message);
      isKaydet(j.id, {
        sonuc: 'hata',
        neden: 'hata',
        mesaj: M(mesaj, 300),
        awxDurum: j.status || null,
      });
      console.warn(`[RebootCheck] AWX isi ${j.id} alinamadi:`, mesaj);
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
  sakliOnceOf,
  eslesenKayit,
  portalIsiMi,
  isiAl,
  awxIsleriniAl,
  alimDurumu,
  startPoller,
  _sifirlaForTest: () => {
    _sonTarama = 0;
    _suren = null;
    _zorlaSirada = null;
    _bakildi.clear();
    Object.assign(_durum, {
      sonTarama: null,
      sablon: null,
      neden: null,
      hata: null,
      bulunan: null,
    });
    _durum.isler.clear();
  },
};
