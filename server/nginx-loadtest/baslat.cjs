// server/nginx-loadtest/baslat.cjs - Yuk Testi AWX baslatma yardimcisi.
//
// Retirement'in launch'i ile AYNI sira, uc farkla (sozlesme bolum 8, kesif C2):
//   1. SUNUCU ACIK: kayitta sunucu yoksa NGINX_LOADTEST_AWX_SERVER_ID, o da yoksa 1 (ScaleX / LogX
//      kurali). 0'a ASLA dusulmez: 0 yalniz eski tek-AWX_URL kipinde var; nginx-console'un 0'a
//      dusmesi DB'de sunucu tanimliyken "awx_server_missing" demekti.
//   2. YUTULAN DEGISKEN: AWX launch yanitinda ignored_fields extra_vars tasiyorsa is HEMEN iptal
//      edilir (ScaleX launchOnAwx / new-fleet-guard deseni). Yuk testi playbook'u varsayilansiz
//      calisir; degiskensiz is zaten girdi kapisinda duser, ama bekleyip gormeyiz.
//   3. DENETIM targetHost/targetIp ile; is gecmisinde senaryo govdesi yerine boyut izi.
//
// HATA SINIFI: baslatmadan ONCE dusen hata (sablon, playbook eslesmesi, prompt) ve AWX'in KESIN
// reddi (4xx) `belirsiz: false` tasir - is yok, kilit birakilabilir. Ag hatasi / 5xx / zaman asimi
// `belirsiz: true` tasir: is AWX'te baslamis olabilir, cagiran kilidi TTL'e birakir (guvenli taraf).
'use strict';

const KAYIT_ANAHTARI = 'nginx_loadtest_run';
const BEKLENEN_PLAYBOOK_ADI = 'nginx_loadtest.yml';

function hata(status, code, message, ek) {
  return Object.assign(new Error(message), { status, code }, ek || {});
}

function maskele(s) {
  return require('../retirement/is-ciktisi.cjs').maskele(s);
}

/** Pozitif tam sayi ilk aday; hicbiri yoksa 1. */
function sunucuSec(...adaylar) {
  for (const a of adaylar) {
    const n = Number(String(a ?? '').trim());
    if (String(a ?? '').trim() !== '' && Number.isInteger(n) && n > 0) return n;
  }
  return 1;
}

/**
 * Playbook Kayitlari satirindan template + sunucu. Uc ayri sebep, uc ayri metin (retirement
 * 2026-10-08 dersi: tek tip mesaj admini yanlis alana yonlendiriyordu). Donus: { templateId, serverId }.
 */
async function sablonuCoz(env = process.env) {
  const reg = require('../ansible/playbook-registry.cjs');
  let row;
  try {
    row = await reg.getByKey(KAYIT_ANAHTARI);
  } catch (e) {
    throw hata(424, 'db_okunamadi', `Playbook Kayıtları okunamadı: ${maskele(e && e.message)}`);
  }
  const templateId = row && row.enabled !== false ? Number(reg.getEffectiveTemplateId(row)) || null : null;
  if (!templateId) {
    const neden = !row
      ? `"${KAYIT_ANAHTARI}" anahtarlı satır YOK`
      : row.enabled === false
        ? `"${KAYIT_ANAHTARI}" satırı KAPALI (etkinleştirin)`
        : `"${KAYIT_ANAHTARI}" satırında Template ID boş (ya da NGINX_LOADTEST_RUN_TEMPLATE_ID)`;
    throw hata(409, 'sablon_yok', `AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › ${neden}.`);
  }
  return { templateId, serverId: sunucuSec(row.awxServerId, env.NGINX_LOADTEST_AWX_SERVER_ID) };
}

async function playbookDogrula(serverId, templateId) {
  const pf = require('../ansible/template-preflight.cjs');
  await pf.assertRegistryPlaybook(serverId, templateId, KAYIT_ANAHTARI);
  // BEKLENEN_PLAYBOOK'ta anahtar yoksa assertRegistryPlaybook hicbir sey denetlemez (fail-open);
  // yuk testi icin dosya adi burada da sabit.
  if (!(pf.BEKLENEN_PLAYBOOK && pf.BEKLENEN_PLAYBOOK[KAYIT_ANAHTARI])) {
    await pf.assertTemplatePlaybook(serverId, templateId, BEKLENEN_PLAYBOOK_ADI, { label: KAYIT_ANAHTARI });
  }
}

/**
 * Isi baslatir. `sablon`: sablonuCoz() sonucu (cagiran kilitten ONCE cozer ki template yoksa kilit
 * ve satir hic olusmasin). Donus: { jobId, status, awxServerId, templateId }.
 */
async function isBaslat(req, { sablon, extraVars, sablonAdi, denetim }) {
  const { templateId, serverId } = sablon;
  const pf = require('../ansible/template-preflight.cjs');
  try {
    await playbookDogrula(serverId, templateId);
    await pf.assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: KAYIT_ANAHTARI });
  } catch (e) {
    if (e && e.status === 409) throw Object.assign(e, { belirsiz: false });
    throw hata(424, 'awx_okunamadi', `AWX şablonu doğrulanamadı: ${maskele(e && e.message)}`, { belirsiz: false });
  }
  const runner = require('../ansible/runner.cjs');
  const user = (req && req.session && req.session.user) || {};
  let result;
  try {
    // limit BILEREK '': AWX limit'i prompt kapaliysa sessizce yok sayar; hedefler add_host ile.
    result = await runner.launchJobOnServer(serverId, templateId, extraVars, '', user);
  } catch (e) {
    const st = Number(e && e.status);
    const kesin = Number.isInteger(st) && st >= 400 && st < 500;
    throw hata(424, 'awx_okunamadi', `AWX işi başlatılamadı: ${maskele(e && e.message)}`, { belirsiz: !kesin });
  }
  if (!result || result.jobId == null) {
    throw hata(424, 'awx_okunamadi', 'AWX iş numarası döndürmedi; iş başlamış olabilir, kilit süre dolunca düşer.', { belirsiz: true });
  }
  const yutulan = (result.ignoredFields || []).filter((ad) => String(ad).startsWith('extra_vars'));
  if (yutulan.length) {
    let iptal = 'iptal edildi';
    try {
      await runner.cancelJobOnServer(serverId, result.jobId);
    } catch (e) {
      iptal = `İPTAL EDİLEMEDİ (${maskele(e && e.message)}) - AWX'ten elle durdurun`;
      console.warn(`[NginxYukTesti] yutulan degiskenli is #${result.jobId} iptal edilemedi:`, maskele(e && e.message));
    }
    const e = pf.promptKapaliHatasi({ templateId, templateName: '', label: KAYIT_ANAHTARI, degiskenSayisi: yutulan.length });
    e.message += ` (AWX iş #${result.jobId} ${iptal}.)`;
    throw Object.assign(e, { belirsiz: false, jobId: result.jobId, awxServerId: serverId });
  }
  try {
    await require('../db/index.cjs').query(
      `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.username || 'unknown', serverId, templateId, String(sablonAdi || '').slice(0, 500), result.jobId, result.status || 'pending',
        JSON.stringify(require('./dogrula.cjs').gecmisIcinMaskele(extraVars))],
    );
  } catch (e) {
    // Is ZATEN basladi; kayit hatasi geri cevirmez ama yutulmaz.
    console.warn('[NginxYukTesti] job gecmisi yazilamadi:', maskele(e && e.message));
  }
  try {
    const d = denetim || {};
    require('../audit/index.cjs').auditPortal(req, d.eylem || 'nginx_loadtest_baslat', {
      targetHost: d.targetHost || null,
      targetIp: d.targetIp || null,
      detail: JSON.stringify({ ...(d.ayrinti || {}), jobId: result.jobId, awxServerId: serverId, templateId }).slice(0, 2000),
    });
  } catch {
    /* best-effort */
  }
  return { jobId: result.jobId, status: result.status ?? null, awxServerId: serverId, templateId };
}

module.exports = { KAYIT_ANAHTARI, BEKLENEN_PLAYBOOK_ADI, sunucuSec, sablonuCoz, playbookDogrula, isBaslat };
