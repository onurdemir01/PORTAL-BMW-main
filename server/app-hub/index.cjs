// server/app-hub/index.cjs - Application Hub API (2026-11-08).
//
// GET  /api/app-hub/ara?q=                      uc tipte ad aramasi (JBoss taban ad, WAS, OCP)
// GET  /api/app-hub/uygulama/:tip/:ad           tek uygulamanin birlesik gorunumu (tip: jboss|was|ocp)
// POST /api/app-hub/ocp/:ad/canli               OCP canli okuma isi (AWX, salt okunur)
// GET  /api/app-hub/ocp/canli/:serverId/:jobId  isin durumu; bitince sonuc kaydedilir ve doner
//
// YETKI (faz 1): yalniz Admin + AppHub gorunurlugu. Server Hub / Uygulama 360 verisi (JVM,
// vhost, maskeli jvm_args) bugun yalniz Admin'e acik; Hub uygulama ekiplerine acilacaksa
// legacy_app / ocp_namespace / env kisit suzgecleri bu router'a eklenmeden ACILMAMALI.
//
// ONBELLEK: ayni uygulama 60 sn icinde yeniden istenirse tek okuma paylasilir (tek ucus);
// `?fresh=1` atlar. Kaynaklarin kendi tazeligi yanitta ayrica yazar.
'use strict';

const express = require('express');
const V = require('./veri.cjs');
const C = require('./canli.cjs');

const ONBELLEK_MS = 60 * 1000;
const _onbellek = new Map();
const TIPLER = new Set(['jboss', 'was', 'ocp']);

function onbellekli(anahtar, fresh, uret) {
  const simdi = Date.now();
  const v = _onbellek.get(anahtar);
  if (!fresh && v && (v.ucus || simdi - v.at < ONBELLEK_MS)) return v.ucus || Promise.resolve(v.deger);
  const ucus = uret().then(
    (deger) => {
      _onbellek.set(anahtar, { at: Date.now(), deger });
      if (_onbellek.size > 200) _onbellek.delete(_onbellek.keys().next().value);
      return deger;
    },
    (e) => {
      _onbellek.delete(anahtar);
      throw e;
    },
  );
  _onbellek.set(anahtar, { at: simdi, ucus });
  return ucus;
}

async function detayOku(tip, ad) {
  if (tip === 'jboss') return V.jbossDetay(ad);
  if (tip === 'was') return V.wasDetay(ad);
  const d = await V.ocpDetay(ad);
  if (d) {
    d.canli = await C.sonOkumalar(ad).catch((e) => ({ hata: String((e && e.message) || e) }));
  }
  return d;
}

async function resolveByKey(keyName) {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(keyName).catch(() => null);
  if (!row || row.enabled === false) return { templateId: null, serverId: null, keyName };
  const envServer = Number(String(process.env.OPSX_AWX_SERVER_ID || '').trim());
  const serverId = row.awxServerId != null ? Number(row.awxServerId) : Number.isInteger(envServer) && envServer >= 0 ? envServer : 0;
  return { templateId: reg.getEffectiveTemplateId(row) || null, serverId, keyName };
}

function createRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));
  try {
    router.use(require('../util/nginx-red.cjs').nginxRedCevirici({ onek: 'apphub', eylem5xx: true }));
  } catch {
    /* yoksay */
  }
  const { requireAdmin } = require('../auth/index.cjs');
  router.use(requireAdmin);
  try {
    router.use(require('../auth/visibility.cjs').requireVisiblePrefix('AppHub'));
  } catch {
    /* motor yoksa yoksay */
  }
  try {
    // JVM parametresi ucu KENDI denetimini MASKELI yazar (jvm-param.cjs): genel katman govdeyi acik yazardi.
    router.use(require('../audit/index.cjs').auditMutations('app_hub', { exclude: ['/jboss/jvm-param'] }));
  } catch {
    /* yoksay */
  }

  router.get('/ara', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!V.ARA_RE.test(q)) {
      return res.json({ ok: true, sonuclar: [], okunamayan: [], mesaj: 'En az 2 karakter yazın (harf, rakam, nokta, alt çizgi, tire).' });
    }
    try {
      res.json({ ok: true, ...(await V.ara(q)) });
    } catch (e) {
      res.status(500).json({ ok: false, error: `Arama yapılamadı: ${(e && e.message) || e}` });
    }
  });

  router.get('/uygulama/:tip/:ad', async (req, res) => {
    const tip = String(req.params.tip || '');
    const ad = String(req.params.ad || '');
    if (!TIPLER.has(tip)) return res.status(400).json({ ok: false, error: 'Uygulama tipi jboss, was ya da ocp olmalı.' });
    if (!V.AD_RE.test(ad)) return res.status(400).json({ ok: false, error: 'Geçersiz uygulama adı.' });
    try {
      const d = await onbellekli(`${tip}|${ad.toUpperCase()}`, req.query.fresh === '1', () => detayOku(tip, ad));
      if (!d) return res.status(404).json({ ok: false, code: 'apphub_yok', error: `${ad} envanterde ${tip.toUpperCase()} uygulaması olarak bulunamadı.` });
      res.json({ ok: true, uygulama: d, okundu: new Date().toISOString() });
    } catch (e) {
      console.warn(`[AppHub] ${tip}/${ad} okunamadi: ${e && e.message}`);
      res.status(424).json({ ok: false, error: `Uygulama bilgisi okunamadı: ${(e && e.message) || e}` });
    }
  });

  router.post('/ocp/:ad/canli', async (req, res) => {
    const ad = String(req.params.ad || '');
    if (!V.AD_RE.test(ad)) return res.status(400).json({ ok: false, error: 'Geçersiz uygulama adı.' });
    const { templateId, serverId, keyName } = await resolveByKey(C.REGISTRY_KEY);
    if (!templateId) {
      return res.status(501).json({
        ok: false,
        error: `OpenShift canlı okuma için AWX job template'i tanımlı değil. Admin > Playbook Kayıtları ekranında "${keyName}" satırının Template ID alanı doldurulmalı.`,
      });
    }
    let kur;
    try {
      const d = await V.ocpDetay(ad);
      if (!d) return res.status(404).json({ ok: false, error: `${ad} OpenShift envanterinde yok.` });
      kur = await C.hedefleriKur(ad, d.yerler, req.body && req.body.hedefler);
    } catch (e) {
      return res.status(e.status || 500).json({ ok: false, error: e.message });
    }
    const u = (req.session && req.session.user) || {};
    try {
      await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(serverId, templateId, kur.extraVars, { label: keyName });
      const runner = require('../ansible/runner.cjs');
      const job = await runner.launchJobOnServer(serverId, templateId, kur.extraVars, '', u);
      try {
        await require('../db/index.cjs').query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [u.username || 'unknown', serverId, templateId, 'Application Hub: OpenShift canlı okuma', job && job.jobId, (job && job.status) || 'pending', JSON.stringify({ platform: 'app-hub-ocp', app_hub_app: ad, app_hub_targets: kur.extraVars.app_hub_targets })],
        );
      } catch (e) {
        console.warn('[AppHub] is gecmisi yazilamadi:', e.message);
      }
      console.log(`[AppHub] ${u.username} -> ocp canli app=${ad} hedef=${kur.extraVars.app_hub_targets.length} template=${templateId} server=${serverId} job=${(job && job.jobId) || '?'}`);
      res.json({ ok: true, serverId, jobId: (job && job.jobId) || null, hedefler: kur.extraVars.app_hub_targets, atlanan: kur.atlanan });
    } catch (e) {
      res.status(e.status || 502).json({ ok: false, error: e.message });
    }
  });

  router.get('/ocp/canli/:serverId/:jobId', async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    const ad = String(req.query.ad || '');
    if (!Number.isInteger(serverId) || serverId < 0 || !Number.isInteger(jobId) || jobId <= 0 || !V.AD_RE.test(ad)) {
      return res.status(400).json({ ok: false, error: 'Geçersiz iş numarası ya da uygulama adı.' });
    }
    try {
      const st = await require('../ansible/runner.cjs').getJobStatusOnServer(serverId, jobId);
      const BITTI = new Set(['successful', 'failed', 'error', 'canceled']);
      if (!BITTI.has(st.status)) return res.json({ ok: true, status: st.status, finished: false });
      const raw = C.statsOku(st.artifacts);
      if (!raw) {
        return res.json({
          ok: true,
          status: st.status,
          finished: true,
          error: st.status === 'successful' ? "İş bitti ama sonuç yayınlanmadı (playbook'un set_stats adımı)." : 'İş başarısız oldu ve sonuç yayınlanmadı; AWX iş çıktısına bakın.',
        });
      }
      if (String(raw.app || '') && String(raw.app) !== ad) {
        return res.status(400).json({ ok: false, error: 'Bu iş başka bir uygulamaya ait.' });
      }
      const cozum = C.sonucuCoz(raw);
      const u = (req.session && req.session.user) || {};
      await C.sonucuKaydet(ad, cozum, { serverId, jobId, kullanici: String(u.username || '').toLowerCase() || 'bilinmiyor', adSoyad: u.displayName || u.username || null }).catch((e) =>
        console.warn('[AppHub] canli sonuc kaydedilemedi:', e.message),
      );
      _onbellek.delete(`ocp|${ad.toUpperCase()}`);
      res.json({ ok: true, status: st.status, finished: true, genel: cozum.genel, okumalar: await C.sonOkumalar(ad).catch(() => []) });
    } catch (e) {
      res.status(502).json({ ok: false, error: `İş durumu okunamadı: ${(e && e.message) || e}` });
    }
  });

  // JBoss JVM parametresi degistir / ekle (2026-11-11): server_hub_fix hatti, plan -> onay -> (prod: Smart).
  require('./jvm-param.cjs').mount(router, { resolveByKey });

  return router;
}

function initAppHub(app) {
  app.use('/api/app-hub', createRouter());
  console.log('[AppHub] module mounted at /api/app-hub');
}

module.exports = { initAppHub, createRouter, _ic: { onbellekli, detayOku, _onbellek } };
