// server/retirement/index.cjs - Uygulama Retirement akisi (2026-09-21) — kayit + kesif + STOP adimi.
//
// Ekibin elle sureci: Smart silme kaydi (364244_Delete_6) -> [prod: OCO + SCC bilgi] -> STOP
// (auto-start kapat, durdur, paketi .<smart>.old) -> stop + >=10 gun ve secilen tarih -> SILME ->
// IP/LB/DNS Smart kayitlari. Burada ilk uc parca: kayit, kesif (tum ortamlar + Ankara), STOP.
// Silme ve IP/LB/DNS adimlari sonraki surumde (kayit alanlari simdiden var: planned_delete_at,
// dns_reuse, lb_reuse).
//
// Kurallar: silme tarihi = planned_delete_at (kaydi acan verdi) ya da stop + delete_after_days (45).
// PROD hedef: oco_no zorunlu; ilk gercek STOP'ta SCC maili (adres: Retirement sayfasi ya da RETIREMENT_SCC_MAIL_TO; bossa uyari).
// STOP her zaman once PLAN (plan_only=true) kosar, kullanici onaylayinca uygulanir.
'use strict';

const express = require('express');
const { discover, searchApps } = require('./discover.cjs');

const REGISTRY_KEY = 'app_retirement_stop';
// DELETE AYRI TEMPLATE (2026-10-06): kendi playbook'u, kendi girdileri ve kendi
// `set_stats` anahtari var. STOP'un template'ini kullanmak, plan_only gibi ortak bir
// degisken yuzunden yanlis adimi tetiklemek demekti.
const DELETE_REGISTRY_KEY = 'app_retirement_delete';
// GERI ALMA (2026-10-07, kullanici): "eger belli bir t sure sonra, uygulama daha
// silinmeden sorun olursa geri donebilmek icin bir ozellik yapmaliyiz. Uygulamami geri
// aktif et vs ve yaptigimiz degisiklikler geri alinmali."
const ROLLBACK_REGISTRY_KEY = 'app_retirement_rollback';
// ON KONTROLDE TAZE TRAFIK (2026-10-08, kullanici: "uygulama stop edilmeden once plan
// asamasinda Apache loglarini okuyabilir miyiz?"). Yeni bir playbook YOK: Server Hub
// taramasi `target_hosts` ile yalniz hedefin WEB sunucularinda kosar (Server Hub ekranindaki
// "tek sunucuyu tara" ile ayni yol). Yukleyici yalniz o sunucularin BUGUNKU satirlarini
// yeniler; onay penceresi kesif uzerinden taze vhost trafigini okur.
const TRAFIK_REGISTRY_KEY = 'server_hub_scan';
const DEFAULT_DAYS = Number(process.env.RETIREMENT_DELETE_DAYS || 45);
// SCC ADRESI ARTIK SABIT DEGIL (2026-10-08): ekrandan girilebiliyor, her kullanimda taze
// okunur (kaydedilen deger yeniden baslatmadan bir sonraki STOP'ta gecerli). Oncelik ve
// kaynak: server/retirement/ayar.cjs. Ortam degiskeni yedek olarak kalir.
const { sccAyar, sccKaydet } = require('./ayar.cjs');
const isAdmin = (req) => req.session?.user?.role === 'Admin';
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function db() { return require('../db/index.cjs'); }
const _sched = require('./schedule.cjs');
const silmeBilgi = (r) =>
  _sched.silmeAni({ plannedDeleteAt: r.planned_delete_at, stopAt: r.stop_at, deleteAfterDays: r.delete_after_days });
function rowRecord(r) {
  return {
    id: r.id, app: r.app, smartNo: r.smart_no, ocoNo: r.oco_no, ownerEmail: r.owner_email, requestedBy: r.requested_by,
    status: r.status, deleteAfterDays: r.delete_after_days, plannedDeleteAt: r.planned_delete_at ? new Date(r.planned_delete_at).toISOString().slice(0, 10) : null,
    stopAt: r.stop_at, dnsReuse: !!r.dns_reuse, lbReuse: !!r.lb_reuse, sccNotifiedAt: r.scc_notified_at, notes: r.notes,
    createdAt: r.created_at, updatedAt: r.updated_at,
    // ETKIN SILME TARIHI ZAMANLAYICIYLA AYNI KAYNAKTAN (schedule.cjs). Eskiden burada ayri
    // bir hesap vardi: UTC gun ve eksik gun sayisinda 45'e dusme - ekran zamanlayicinin
    // kosacagi gunden FARKLI bir gun gosterebiliyordu.
    effectiveDeleteAt: silmeBilgi(r) ? silmeBilgi(r).gun : null,
    // Silme ANI (TR silme saatinde) - ekran "21.11.2026 23:00" der.
    deleteAt: silmeBilgi(r),
    deleteNowAt: r.delete_now_at ?? null,
  };
}
function rowTarget(t) {
  let web = [];
  try { web = t.web_json ? JSON.parse(t.web_json) : []; } catch { web = []; }
  return {
    id: t.id, recordId: t.record_id, host: t.host, site: t.site, env: t.env, appName: t.app_name, gen: t.jboss_gen, appPath: t.app_path,
    web, status: t.status, planText: t.plan_text, resultText: t.result_text, lastJobId: t.last_job_id, stoppedAt: t.stopped_at, updatedAt: t.updated_at,
    // `deletedAt`/`rolledBackAt` ONYUZ ICIN DEGIL SADECE: /rollback kapisi da bunu
    // okuyor. Donmuyordu ve `t.deletedAt` kontrolu OLU KODDU (hep undefined).
    deletedAt: t.deleted_at ?? null, rolledBackAt: t.rolled_back_at ?? null, rollbackJobId: t.rollback_job_id ?? null,
    // OCO penceresine zamanlanmis STOP icin: akis paneli "ne zaman kosacak" diyebilsin.
    scheduledAt: t.scheduled_at ?? null, windowEnd: t.window_end ?? null,
    // UYGULANAN web sonucu (DONMUS liste + her vhost'un akibeti). `web` alani KESIF
    // listesidir; ekranda "1 kaldirildi, 1 elle" demek icin uygulanan sonuc gerekiyor
    // ve o bugune kadar onyuze HIC gitmiyordu (akis paneli, 2026-10-08).
    webSonuc: (() => {
      try { return t.web_result_json ? JSON.parse(t.web_result_json) : null; } catch { return null; }
    })(),
    // PLAN/SONUC AYRINTISI (uretim bulgusu 2026-10-06): playbook `set_stats` ile STEP ve
    // RENAMED satirlarini da yayinliyor. Onceden YALNIZ tek satirlik RESULT saklaniyordu;
    // kullanici plani gozden gecirirken "2 paket yeniden adlandirilacak" goruyordu, HANGI
    // iki paket oldugunu DEGIL. Islem geri alinamaz, ayrinti gorunmek zorunda.
    detail: (() => {
      try {
        return t.detail_json ? JSON.parse(t.detail_json) : null;
      } catch {
        return null;
      }
    })(),
  };
}
async function addEvent(recordId, username, kind, text) {
  try { await db().query(`INSERT INTO retirement_events (record_id, username, kind, text) VALUES ($1, $2, $3, $4)`, [recordId, username || null, kind, String(text || '').slice(0, 1000)]); } catch (e) { console.warn('[Retirement] event yazilamadi:', e.message); }
}
async function loadRecord(id) {
  const r = await db().query(`SELECT * FROM retirement_records WHERE id = $1`, [id]);
  if (!r.rows?.length) return null;
  const [t, e] = await Promise.all([
    db().query(`SELECT * FROM retirement_targets WHERE record_id = $1 ORDER BY CASE env WHEN 'PROD' THEN 0 WHEN 'QA' THEN 1 WHEN 'TEST' THEN 2 ELSE 3 END, site, host`, [id]),
    db().query(`SELECT TOP 200 * FROM retirement_events WHERE record_id = $1 ORDER BY at DESC, id DESC`, [id]),
  ]);
  return { ...rowRecord(r.rows[0]), targets: (t.rows || []).map(rowTarget), events: (e.rows || []).map((x) => ({ id: x.id, at: x.at, username: x.username, kind: x.kind, text: x.text })) };
}

// ── WEB KATMANI STOP'TA KALKAR (kullanici karari 2026-10-06) ─────────────────────────
// "1. soruna cevabim direkt STOP'ta kalkacak." + "paylasimli vhost olmamali ama sen
//  kaldirilacak vhost'u STOP esnasinda ekrana yansitsan biz oradan onaylasak olur mu?"
//
// LISTE ONAY ANINDA DONDURULUR (kullanici karari: "dondur, bulunamayani atla" - pod
// silmede verdigi ayni karar). Gerekcesi: STOP artik OCO penceresine zamanlaniyor, yani
// onay pencereden SAATLER once veriliyor. Onayladigin liste ile isin kostugu andaki
// gercek ayrisabilir; o anda ekranda kimse yok. Donmus liste uygulanir, bulunamayan
// vhost ATLANIR ve raporlanir - sessizce "tamamlandi" demek en kotu sonuc olurdu.
function webDondur(web) {
  return (Array.isArray(web) ? web : []).map((w) => ({
    host: String(w.host || ''),
    serverName: String(w.serverName || ''),
    product: String(w.product || ''),
    confFile: String(w.confFile || ''),
    status: 'pending',
    jobId: null,
    message: null,
  }));
}

// STOP'ta kaldirilan vhost'lari GERI ACAR (2026-10-07).
//
// `apache_restore_vhost`, `apache_retire_vhost`un tersidir ve AYNI disiplini tasir:
// yedek alir, arsivden geri tasir ya da yorum onegini kaldirir, `apachectl -t` gecmezse
// YAPTIGINI GERI ALIR. Yeniden yazilmaz, var olan eylem cagrilir.
//
// YALNIZ GERCEKTEN KALDIRILMIS OLANLAR. 'manual' (NGINX) ya da 'failed' girdilerde
// ortada geri acilacak bir sey YOK; onlari "geri acildi" saymak, yapilmayan bir isi
// basari gostermek olurdu. Sebebi girdide yazili kalir.
const APACHE_URUN_GERI = new Set(['RHA', 'IHS', 'APACHE', 'IBMIHS']);

async function webGeriAl(id, tid, username) {
  const ozet = { denendi: 0, atlanan: 0, hata: 0, notlar: [] };
  const { rows } = await db().query(`SELECT web_result_json FROM retirement_targets WHERE id = $1`, [tid]);
  let liste;
  try {
    liste = JSON.parse(rows?.[0]?.web_result_json || 'null');
  } catch {
    liste = null;
  }
  if (!Array.isArray(liste) || liste.length === 0) return ozet;

  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey('server_hub_fix').catch(() => null);
  const templateId = row && row.enabled !== false ? reg.getEffectiveTemplateId(row) : null;
  const serverId = row && row.awxServerId != null ? Number(row.awxServerId) : 0;

  for (const w of liste) {
    if (w.status !== 'ok') {
      ozet.atlanan += 1;
      ozet.notlar.push(`${w.serverName || '?'}: kaldirilmamisti (${w.status}) — geri açılacak bir şey yok`);
      continue;
    }
    if (!APACHE_URUN_GERI.has(String(w.product || '').toUpperCase())) {
      ozet.atlanan += 1;
      ozet.notlar.push(`${w.serverName}: ${w.product} — otomatik geri açma yok`);
      continue;
    }
    if (!templateId) {
      // SESSIZ GECMEZ: template tanimsizsa vhost GERI ACILMADI ve bu girdide yazili
      // kalir. Uygulama ayaga kalkar ama onune trafik gelmez; bunu bilmek sart.
      w.status = 'restore_manual';
      w.message = 'server_hub_fix Template ID tanımsız — vhost ELLE geri açılmalı.';
      ozet.hata += 1;
      continue;
    }
    const extraVars = {
      target_host: w.host,
      action: 'apache_restore_vhost',
      product: w.product,
      file: w.confFile,
      server_name: w.serverName,
      reload: true,
      plan_only: false,
    };
    try {
      await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: 'server_hub_fix' });
      const runner = require('../ansible/runner.cjs');
      const r = await runner.launchJobOnServer(serverId, templateId, extraVars, '', {});
      w.status = 'restoring';
      w.jobId = r?.jobId ?? null;
      w.message = `apache_restore_vhost iş #${r?.jobId ?? '?'}`;
      ozet.denendi += 1;
    } catch (e) {
      w.status = 'restore_failed';
      w.message = `geri açma başlatılamadı: ${e.message}`;
      ozet.hata += 1;
    }
  }
  await db().query(`UPDATE retirement_targets SET web_result_json = $1 WHERE id = $2`, [JSON.stringify(liste), tid]);
  if (ozet.denendi || ozet.hata)
    await addEvent(id, username, 'rollback-web', `vhost geri açma: ${ozet.denendi} iş başlatıldı, ${ozet.atlanan} atlandı, ${ozet.hata} hata`);
  return ozet;
}

// AWX (Server Hub ile ayni desen)
async function launch(req, templateName, extraVars, detail, key = REGISTRY_KEY) {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(key).catch(() => null);
  const templateId = row && row.enabled !== false ? reg.getEffectiveTemplateId(row) : null;
  const serverId = row && row.awxServerId != null ? Number(row.awxServerId) : 0;
  // UC AYRI SEBEP, UC AYRI METIN (2026-10-08 kullanici bulgusu: "template id kayitli olmasina
  // ragmen" tek tip mesaj aliyordu - sebep, satirin ANAHTARININ farkli olmasiydi). Hangi
  // kosulun tutmadigi soylenmezse admin dogru alana Template ID girmis gibi gorunur.
  if (!templateId) {
    const neden = !row
      ? `"${key}" anahtarlı satır YOK (Anahtar alanı tam olarak "${key}" olmalı; başka adla açılmış satır kullanılmaz)`
      : row.enabled === false
        ? `"${key}" satırı KAPALI (etkinleştirin)`
        : `"${key}" satırında Template ID boş`;
    throw Object.assign(new Error(`AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › ${neden}.`), { status: 501 });
  }
  const runner = require('../ansible/runner.cjs');
  await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: key });
  const user = req.session?.user || {};
  const result = await runner.launchJobOnServer(serverId, templateId, extraVars, '', user);
  try {
    await db().query(`INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.username || 'unknown', serverId, templateId, templateName, result?.jobId, result?.status || 'pending', JSON.stringify(extraVars)]);
  } catch (e) { console.warn('[Retirement] job gecmisi yazilamadi:', e.message); }
  try { require('../audit/index.cjs').auditPortal(req, 'retirement', { detail: JSON.stringify({ ...detail, jobId: result?.jobId ?? null }) }); } catch { /* best-effort */ }
  return { jobId: result?.jobId ?? null, status: result?.status ?? null, awxServerId: serverId };
}

function initRetirement(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '512kb' }));
  router.use(requireAuth);
  router.use((req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ ok: false, message: 'Retirement yalnız Admin.' })));
  try { router.use(require('../auth/visibility.cjs').requireVisiblePrefix('ServerHub')); } catch { /* yoksay */ }

  router.get('/config', async (_req, res) => { const scc = await sccAyar(); res.json({ ok: true, defaultDays: DEFAULT_DAYS, sccMailConfigured: !!scc.to, sccMailTo: scc.to || null,
    sccMailCc: scc.cc || null, sccKaynak: scc.kaynak, sccGuncelleyen: scc.guncelleyen, sccGuncellendi: scc.guncellendi, sccDbHatasi: scc.dbHatasi,
    // ZAMANLAYICI BILGISI (ekran bilgilendirmesi): silme saati (TR) ve kontrol araligi.
    deleteHour: _sched.silmeSaati(),
    pollSeconds: (() => { const n = Number(process.env.RETIREMENT_POLL_INTERVAL_SECONDS); return Number.isFinite(n) && n >= 30 ? n : 300; })(),
    smartFlows: { delete: '364244_Delete_6', lbMemberUpdate: '642180_Update', lbDelete: '364378_Delete_6', lbIpDelete: '364308_Delete_6', dnsIntranetDelete: '2523535_Delete_6', dnsInternetDelete: '349792_Delete' } }); });

  // SCC bilgilendirme adresini ekrandan kaydet (router zaten yalniz Admin). Kime BOS ->
  // ekran degeri kalkar, ortam degiskenine dusulur.
  router.put('/config/scc', async (req, res) => {
    try {
      const r = await sccKaydet({ to: req.body?.to, cc: req.body?.cc }, req.session?.user?.username);
      if (!r.ok) return res.status(400).json(r);
      try { require('../audit/index.cjs').auditPortal(req, 'retirement_scc_ayar', { detail: JSON.stringify({ kaynak: r.ayar.kaynak, to: r.ayar.to, cc: r.ayar.cc }) }); } catch { /* best-effort */ }
      res.json({ ok: true, sccMailTo: r.ayar.to || null, sccMailCc: r.ayar.cc || null, sccKaynak: r.ayar.kaynak, sccGuncelleyen: r.ayar.guncelleyen, sccGuncellendi: r.ayar.guncellendi });
    } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  router.get('/apps', async (req, res) => {
    try { res.json({ ok: true, apps: await searchApps(String(req.query.q || '')) }); }
    catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  router.get('/discover', async (req, res) => {
    const base = String(req.query.app || '').trim();
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(base)) return res.status(400).json({ ok: false, message: 'Geçersiz uygulama adı.' });
    try { res.json({ ok: true, ...(await discover(base)) }); }
    catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  router.get('/', async (_req, res) => {
    try {
      const r = await db().query(`SELECT r.*, (SELECT COUNT(*) FROM retirement_targets t WHERE t.record_id = r.id) AS n_targets,
        (SELECT COUNT(*) FROM retirement_targets t WHERE t.record_id = r.id AND t.status = 'stopped') AS n_stopped
        FROM retirement_records r ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'stopped' THEN 1 ELSE 2 END, r.created_at DESC`);
      // ORTAM KIRILIMI (kullanici, 2026-10-08): "uygulama ismi -t, -d, -q gibi soneksiz
      // listelendigi icin insanlar hangi ortamin silindigini tiklamadan anlayamayacak."
      // Kayit TABAN adla tutuluyor (GBSVCVOICEORDER); ortam hedeflerden gelir. TEK sorgu,
      // kayit basina sorgu (N+1) DEGIL.
      const tr = await db().query(`SELECT record_id, env, app_name, host, status FROM retirement_targets`);
      const SIRA = ['DEV', 'TEST', 'QA', 'EDU', 'PROD'];
      const envBy = new Map();
      for (const t of tr.rows || []) {
        const k = Number(t.record_id);
        if (!envBy.has(k)) envBy.set(k, new Map());
        const m = envBy.get(k);
        const e = String(t.env || '?').toUpperCase();
        if (!m.has(e)) m.set(e, { env: e, toplam: 0, durdurulan: 0, silinen: 0, uygulamalar: new Set() });
        const g = m.get(e);
        g.toplam++;
        if (t.status === 'stopped') g.durdurulan++;
        if (t.status === 'deleted') g.silinen++;
        g.uygulamalar.add(`${t.app_name} @ ${t.host}`);
      }
      const envsOf = (id) =>
        [...(envBy.get(Number(id)) || new Map()).values()]
          .map((g) => ({ ...g, uygulamalar: [...g.uygulamalar] }))
          .sort((a, b) => (SIRA.indexOf(a.env) + 1 || 99) - (SIRA.indexOf(b.env) + 1 || 99));
      res.json({ ok: true, records: (r.rows || []).map((x) => ({ ...rowRecord(x), targets: Number(x.n_targets), stopped: Number(x.n_stopped), envs: envsOf(x.id) })) });
    } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  router.get('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: 'Geçersiz kayıt.' });
    try {
      const rec = await loadRecord(id);
      if (!rec) return res.status(400).json({ ok: false, message: 'Kayıt yok.' });
      res.json({ ok: true, record: rec });
    } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  // Kayit ac: kesif snapshot'i hedef olarak yazilir (kullanici hedef secebilir: targets[] host|appName)
  router.post('/', async (req, res) => {
    const b = req.body || {};
    const app = String(b.app || '').trim();
    const smartNo = String(b.smartNo || '').trim();
    const ocoNo = String(b.ocoNo || '').trim();
    const days = Number.isInteger(Number(b.deleteAfterDays)) && Number(b.deleteAfterDays) > 0 ? Number(b.deleteAfterDays) : DEFAULT_DAYS;
    const planned = b.plannedDeleteAt ? String(b.plannedDeleteAt).slice(0, 10) : null;
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(app)) return res.status(400).json({ ok: false, message: 'Geçersiz uygulama adı.' });
    if (!SAFE_ID.test(smartNo)) return res.status(400).json({ ok: false, message: 'Smart kayıt numarası gerekli (harf/rakam).' });
    if (ocoNo && !SAFE_ID.test(ocoNo)) return res.status(400).json({ ok: false, message: 'OCO numarası harf/rakam olmalı.' });
    if (planned && !/^\d{4}-\d{2}-\d{2}$/.test(planned)) return res.status(400).json({ ok: false, message: 'Silme tarihi YYYY-AA-GG olmalı.' });
    try {
      const disc = await discover(app);
      const wanted = Array.isArray(b.targets) && b.targets.length ? new Set(b.targets.map((t) => `${String(t.host).toUpperCase()}|${t.appName}`)) : null;
      const targets = disc.targets.filter((t) => !wanted || wanted.has(`${t.host}|${t.appName}`));
      if (!targets.length) return res.status(400).json({ ok: false, message: 'Envanterde bu uygulama için hedef bulunamadı (MWAppsInventory).' });
      if (targets.some((t) => t.env === 'PROD') && !ocoNo) return res.status(400).json({ ok: false, message: 'PROD hedef var: altyapı OCO numarası zorunlu (kayıtla birlikte açılmalı).' });
      const user = req.session?.user?.username || 'unknown';
      const ins = await db().query(
        `INSERT INTO retirement_records (app, smart_no, oco_no, owner_email, requested_by, delete_after_days, planned_delete_at, dns_reuse, lb_reuse, notes)
         OUTPUT INSERTED.id VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [app, smartNo, ocoNo || null, String(b.ownerEmail || '').slice(0, 256) || null, user, days, planned, b.dnsReuse ? 1 : 0, b.lbReuse ? 1 : 0, String(b.notes || '').slice(0, 4000) || null],
      );
      const id = ins.rows[0].id;
      for (const t of targets) {
        await db().query(`INSERT INTO retirement_targets (record_id, host, site, env, app_name, jboss_gen, app_path, web_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, t.host, t.site, t.env, t.appName, t.gen, t.appPath || null, JSON.stringify(t.web)]);
      }
      await addEvent(id, user, 'created', `Kayıt açıldı: ${targets.length} hedef (${disc.summary.bySite.Pendik} Pendik, ${disc.summary.bySite.Ankara} Ankara); Smart ${smartNo}${ocoNo ? ', OCO ' + ocoNo : ''}; silme ${planned || days + ' gün sonra'}`);
      try { require('../audit/index.cjs').auditPortal(req, 'retirement', { detail: JSON.stringify({ op: 'create', id, app, targets: targets.length }) }); } catch { /* */ }
      res.json({ ok: true, id, record: await loadRecord(id) });
    } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  router.post('/:id/cancel', async (req, res) => {
    const id = Number(req.params.id);
    try {
      await db().query(`UPDATE retirement_records SET status = 'cancelled', updated_at = GETUTCDATE() WHERE id = $1`, [id]);
      await addEvent(id, req.session?.user?.username, 'cancelled', String(req.body?.reason || '').slice(0, 500) || 'iptal');
      res.json({ ok: true, record: await loadRecord(id) });
    } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  // ── BEKLEMEYI ATLA (admin, 2026-10-08) ─────────────────────────────────────────
  // Kullanici: "ben admin olarak bu bekleme asamasinin duzgun calistigini anlayabilmek
  // icin direkt tetikleme asamasina gecmek istiyorum."
  //
  // DELETE'I BURADAN BASLATMAZ. Yalnizca silme tarihini BUGUNE ceker; silmeyi her zamanki
  // zamanlayici (poller.deleteTick) yakalar ve baslatir. Sinanmak istenen sey tam o yol:
  // dogrudan launch, beklemenin kendisini (tarih hesabi, 'stopped' secimi, claim, is
  // baslatma, sonuclandirma) ATLARDI ve "calisiyor" sonucu yaniltici olurdu.
  //
  // DELETE GERI ALINAMAZ: onay icin uygulama adi AYNEN yazilir (yanlis kayitta tek tikla
  // silme tetiklenmesin). Onceki tarih olaya yazilir - "acan belirledi" tarihi kaybolmaz.
  // Router zaten yalniz Admin (yukaridaki router.use).
  router.post('/:id/delete-now', async (req, res) => {
    const id = Number(req.params.id);
    try {
      const rec = await loadRecord(id);
      if (!rec) return res.status(400).json({ ok: false, message: 'Kayıt yok.' });
      if (rec.status === 'cancelled' || rec.status === 'deleted')
        return res.status(400).json({ ok: false, message: `Kayıt ${rec.status === 'cancelled' ? 'iptal edilmiş' : 'zaten silinmiş'}.` });
      const hazir = rec.targets.filter((t) => t.status === 'stopped' && !t.deletedAt);
      if (!hazir.length)
        return res.status(400).json({ ok: false, message: 'Silinmeye hazır (durdurulmuş, silinmemiş) hedef yok — zamanlayıcı yalnız durdurulmuş hedefleri siler.' });
      if (String(req.body?.confirmApp ?? '').trim() !== rec.app)
        return res.status(400).json({ ok: false, message: `Onay için uygulama adını aynen yazın: ${rec.app}` });
      const onceki = rec.effectiveDeleteAt;
      await db().query(
        `UPDATE retirement_records SET planned_delete_at = GETUTCDATE(), delete_now_at = GETUTCDATE(), updated_at = GETUTCDATE()
          WHERE id = $1 AND status NOT IN ('cancelled', 'deleted')`,
        [id],
      );
      const pollSn = (() => { const n = Number(process.env.RETIREMENT_POLL_INTERVAL_SECONDS); return Number.isFinite(n) && n >= 30 ? n : 300; })();
      await addEvent(
        id,
        req.session?.user?.username,
        'delete_now',
        `ADMIN beklemeyi atladi: silme tarihi ${onceki || 'belirsiz'} -> bugun. Zamanlayici en gec ~${Math.ceil(pollSn / 60)} dk icinde ` +
          `${hazir.length} durdurulmus hedefi silecek: ${hazir.map((t) => `${t.appName} @ ${t.host} (${t.env})`).join(', ')}`,
      );
      res.json({ ok: true, oncekiTarih: onceki, hedefSayisi: hazir.length, pollSaniye: pollSn, record: await loadRecord(id) });
    } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  router.post('/:id/note', async (req, res) => {
    const id = Number(req.params.id);
    const text = String(req.body?.text || '').trim().slice(0, 1000);
    if (!text) return res.status(400).json({ ok: false, message: 'Not boş.' });
    try { await addEvent(id, req.session?.user?.username, 'note', text); res.json({ ok: true, record: await loadRecord(id) }); }
    catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  // STOP: plan (confirmed=false) -> onay (confirmed=true). PROD: OCO zorunlu, ilk gercek stop'ta SCC maili.
  router.post('/:id/targets/:tid/stop', async (req, res) => {
    const id = Number(req.params.id); const tid = Number(req.params.tid);
    const confirmed = req.body?.confirmed === true;
    try {
      const rec = await loadRecord(id);
      if (!rec) return res.status(400).json({ ok: false, message: 'Kayıt yok.' });
      if (rec.status === 'cancelled') return res.status(400).json({ ok: false, message: 'Kayıt iptal edilmiş.' });
      const t = rec.targets.find((x) => x.id === tid);
      if (!t) return res.status(400).json({ ok: false, message: 'Hedef yok.' });
      if (!t.gen) return res.status(400).json({ ok: false, message: `${t.host}: JBoss nesli belirlenemedi (envanter jboss_version boş).` });
      if (t.env === 'PROD' && !rec.ocoNo) return res.status(400).json({ ok: false, message: 'PROD hedef için OCO numarası gerekli.' });
      if (t.status === 'stopped') return res.status(400).json({ ok: false, message: 'Bu hedef zaten durdurulmuş.' });
      // ── TEK DUGMELI AKISIN SUNUCU KAPILARI (2026-10-08) ──────────────────────────
      // (1) Gecis durumunda ikinci is YOK: suren bir ise ikinci on kontrol/STOP eklemek
      //     sonucu hangi isin yazacagini belirsizlestirir.
      // (2) ZAMANLANMIS hedefte on kontrol YOK: on kontrol hedefi 'planning'e cekiyor ve
      //     poller yalniz 'stop_scheduled'a baktigi icin OCO'ya zamanlanmis STOP SESSIZCE
      //     dusuyordu (eski "Plan" dugmesi bu durumda da gorunuyordu).
      // (3) ONAYLI STOP YALNIZ ON KONTROLU BASARIYLA DONMUS hedefte. Bu kapi eskiden
      //     YALNIZ ekrandaydi (STOP dugmesi 'planned'de gorunuyordu); dogrudan istek onu
      //     atlayabiliyordu. Zamanlanmis STOP'lar bu uca gelmez, poller'dan kosar.
      if (['planning', 'stopping', 'deleting', 'rolling_back'].includes(t.status))
        return res.status(409).json({ ok: false, message: `Bu hedefte süren bir iş var (${t.status}); bitmesini bekleyin ya da "Durumu tazele".` });
      if (!confirmed && t.status === 'stop_scheduled')
        return res.status(409).json({ ok: false, message: "Bu hedefin STOP'u OCO penceresine zamanlanmış; ön kontrol zamanlamayı düşürürdü. Gerekirse önce kaydı iptal edin." });
      if (confirmed && t.status !== 'planned')
        return res.status(409).json({ ok: false, message: "Önce ön kontrol: \"Retirement'ı başlat\" sunucuda ne yapılacağını okur, başarıyla dönünce onay açılır." });
      // ── OCO PENCERESINE ZAMANLAMA (kullanici karari 2026-10-06) ─────────────────
      // "Production icin OCO talebi girisi zorunlu olacak, OCO'daki tarih ve saate gore
      //  uygulama stop adimi baslar."
      //
      // YALNIZ GERCEK STOP'TA: plan (confirmed=false) hicbir seyi degistirmez, pencere
      // beklemesi anlamsiz olurdu - kullanici plani GORMEK icin kosturuyor.
      // YALNIZ PROD'DA: test/qa hedeflerinde OCO yok ve beklemek gereksiz.
      if (confirmed && t.env === 'PROD' && rec.ocoNo) {
        const ocoClient = require('../oco/client.cjs');
        const ocoWindow = require('../oco/window.cjs');
        let order;
        try {
          order = await ocoClient.getChangeOrder(rec.ocoNo);
        } catch (e) {
          return res.status(ocoClient.httpStatus(e)).json({ ok: false, ocoRequired: true, message: e.message });
        }
        const pi = ocoWindow.extractPlannedInterruption(order.payload);
        if (!pi || !pi.startDate)
          return res.status(400).json({ ok: false, message: `OCO ${rec.ocoNo} kaydinda planlanan kesinti tarihi yok — STOP baslatilmadi.` });
        const w = ocoWindow.evaluateWindow({ startDate: pi.startDate, endDate: pi.endDate });
        if (!w.ok) return res.status(400).json({ ok: false, message: w.message });
        const plan = ocoWindow.nextRunAt({ windowStart: w.windowStart, windowEnd: w.windowEnd });
        // ── ADMIN: OCO SAAT KISITI YOK (kullanici, 2026-10-08) ─────────────────────────
        // "Application Retirement'ta Admin'lere OCO kontrolunun saat kisitlamasini kaldirir
        // misin?" OCO NUMARASI ve KAYDIN GECERLILIGI (planlanan kesinti tarihi) yine
        // zorunlu - izlenebilirlik korunur. Kalkan yalniz SAAT: pencere ileride ise
        // zamanlanmaz, kapandiysa reddedilmez; is onayla HEMEN kosar ve pencere DISINDA
        // basladiysa olaya ('oco_saatsiz') yazilir. Bozuk OCO kaydi (tarih okunamaz / aralik
        // gecersiz -> w.ok false) Admin icin de REDDEDILIR. Router zaten yalniz Admin; kural
        // Admin DISI icin korunur ki modul ileride acilirsa sessizce gevsemesin.
        const adminSaatsiz = isAdmin(req);
        if (!adminSaatsiz && plan.mode === 'none') return res.status(400).json({ ok: false, message: plan.reason });
        if (!adminSaatsiz && plan.mode === 'schedule') {
          // IS BASLATILMAZ. Zamanlama kaydin kendisinde durur; retirement poller'i
          // pencere acilinca tetikler (bkz. poller.cjs). AWX-native schedule YOK:
          // kaydi Portal tutuyor, iptal ve gorunurluk burada.
          await db().query(
            `UPDATE retirement_targets SET status = 'stop_scheduled', scheduled_at = $1, window_end = $2, plan_text = $3, updated_at = GETUTCDATE() WHERE id = $4`,
            [plan.runAt, w.windowEnd, `OCO ${rec.ocoNo} penceresine zamanlandi: ${plan.text}`.slice(0, 1000), tid],
          );
          await db().query(`UPDATE retirement_targets SET web_result_json = $1 WHERE id = $2`, [JSON.stringify(webDondur(t.web)), tid]);
          await addEvent(id, req.session?.user?.username, 'schedule', `${t.appName} @ ${t.host}: ${plan.reason} · ${t.web.length} vhost kaldirilacak`);
          return res.json({ ok: true, scheduled: true, runAt: plan.runAt, runAtText: plan.text, windowEnd: w.windowEnd, message: plan.reason });
        }
        // Buraya: pencere ACIK (herkes) ya da ADMIN (pencere ne olursa olsun). Normal launch
        // asagida kosar. Gercek pencere sonu yazilir: poller window_end'i yalniz
        // 'stop_scheduled' hedefte okur, burada iz ve ekran icin.
        await db().query(`UPDATE retirement_targets SET window_end = $1, web_result_json = $2 WHERE id = $3`, [w.windowEnd, JSON.stringify(webDondur(t.web)), tid]);
        if (adminSaatsiz && plan.mode !== 'now') {
          // Pencere DISI admin kosusu IZ BIRAKIR. "Baslatiliyor" - "kostu" DEGIL: launch asagida
          // ve dusebilir; gercek is numarasi hemen ardindaki 'stop' olayinda.
          await addEvent(id, req.session?.user?.username, 'oco_saatsiz',
            `${t.appName} @ ${t.host}: ADMIN - OCO ${rec.ocoNo} saat kisiti uygulanmadi (pencere ${w.windowStartText} - ${w.windowEndText}, ` +
              `${plan.mode === 'schedule' ? 'henuz ACILMAMIS' : 'KAPANMIS'}); STOP simdi baslatiliyor`);
        }
      }

      const scc = await sccAyar();
      const SCC_MAIL_TO = scc.to;
      const SCC_MAIL_CC = scc.cc;
      const notifyScc = confirmed && t.env === 'PROD' && !rec.sccNotifiedAt;
      if (notifyScc && !SCC_MAIL_TO) console.warn('[Retirement] SCC adresi tanimsiz (ekran ve RETIREMENT_SCC_MAIL_TO bos); SCC maili gonderilemeyecek');
      const extraVars = {
        target_host: t.host, application: t.appName, jboss_gen: String(t.gen), smart_no: rec.smartNo, app_path: t.appPath || '',
        plan_only: !confirmed, notify_scc: notifyScc && !!SCC_MAIL_TO, scc_mail_to: SCC_MAIL_TO, scc_mail_cc: SCC_MAIL_CC || undefined,
        oco_no: rec.ocoNo || '', requested_by: req.session?.user?.username || 'Portal',
      };
      // TEST/QA HEDEFLERI OCO KAPISINA GIRMEZ: listeyi orada donduramadik, burada
      // donduruyoruz. `COALESCE` DEGIL kosullu yazim: PROD dalinda zaten yazildi, onu
      // ikinci kez ezmek "pending" durumlarini sifirlardi.
      if (confirmed && t.env !== 'PROD')
        await db().query(`UPDATE retirement_targets SET web_result_json = $1 WHERE id = $2 AND web_result_json IS NULL`, [JSON.stringify(webDondur(t.web)), tid]);
      const r = await launch(req, `Retirement: ${confirmed ? 'STOP' : 'plan'} ${t.appName} @ ${t.host}`, extraVars, { op: confirmed ? 'stop' : 'plan', id, tid });
      await db().query(`UPDATE retirement_targets SET status = $1, last_job_id = $2, updated_at = GETUTCDATE() WHERE id = $3`, [confirmed ? 'stopping' : 'planning', r.jobId, tid]);
      if (rec.status === 'open' && confirmed) await db().query(`UPDATE retirement_records SET status = 'stopping', updated_at = GETUTCDATE() WHERE id = $1`, [id]);
      await addEvent(id, req.session?.user?.username, confirmed ? 'stop' : 'plan', `${t.appName} @ ${t.host} (${t.env}, ${t.site}) iş #${r.jobId}${notifyScc ? (SCC_MAIL_TO ? ' · SCC maili' : ' · SCC adresi tanımsız!') : ''}`);
      // ON KONTROLDE WEB TRAFIGI TAZELENIR (yalniz on kontrolde, onayli STOP'ta degil).
      // Tarama baslatilamazsa ON KONTROL DUSMEZ: sebep (sablon yok, "Prompt on launch"
      // kapali...) ekrana tasinir ve pencere eldeki - daha eski - Server Hub verisiyle acilir.
      // Is numarasi STOP'unkinden FARKLI: job-status ucu hedefi yalniz kendi last_job_id'si
      // icin gunceller, tarama isi hedefe hicbir sey yazmaz.
      let trafikTarama = null;
      if (!confirmed) {
        const webHosts = [...new Set((t.web || []).map((w) => String(w.host || '').trim().toUpperCase()))]
          .filter((h) => /^[A-Z0-9][A-Z0-9._-]{0,62}$/.test(h));
        if (webHosts.length) {
          try {
            const s = await launch(req, `Retirement: trafik ölçümü ${t.appName} (${webHosts.join(', ')})`,
              { target_hosts: webHosts.join(',') }, { op: 'trafik', id, tid, hosts: webHosts }, TRAFIK_REGISTRY_KEY);
            trafikTarama = { ok: true, jobId: s.jobId, awxServerId: s.awxServerId, hosts: webHosts };
            await addEvent(id, req.session?.user?.username, 'trafik',
              `${t.appName}: web trafigi on kontrolde tazeleniyor - Server Hub taramasi #${s.jobId} (${webHosts.join(', ')})`);
          } catch (e) {
            trafikTarama = { ok: false, hosts: webHosts, message: String(e.message || e) };
            await addEvent(id, req.session?.user?.username, 'trafik',
              `${t.appName}: web trafigi TAZELENEMEDI (${webHosts.join(', ')}): ${String(e.message || e).slice(0, 300)}`);
          }
        }
      }
      // KAPATILACAK VHOST BLOKLARI (2026-10-08, kullanici: "tetiklemeden once disabled edilecek
      // virtualhost blogunu gormek istiyorum"). Web adimiyla AYNI eylem (server_hub_fix /
      // apache_retire_vhost) plan_only=true kosar ve kapatacagi blogu BLOK satirlariyla
      // dondurur - ekranda gorulen blok, sonra gercekte yorumlanan blogun ta kendisi.
      // Yalniz on kontrolde; Apache/IHS disi (NGINX) ya da conf'u/ServerName'i bilinmeyen
      // vhost icin is baslatilmaz, sebebi listede yazar. Baslatilamazsa on kontrol DUSMEZ.
      let vhostPlan = null;
      if (!confirmed && (t.web || []).length) {
        const APACHE = new Set(['RHA', 'IHS', 'APACHE', 'IBMIHS']);
        vhostPlan = [];
        for (const w of t.web) {
          const kim = { host: w.host, serverName: w.serverName, confFile: w.confFile || '' };
          if (!APACHE.has(String(w.product || '').toUpperCase())) { vhostPlan.push({ ...kim, ok: false, elle: true, message: `${w.product || 'bilinmeyen urun'}: otomatik kapatma yok (NGINX elle)` }); continue; }
          if (!w.confFile || !w.serverName) { vhostPlan.push({ ...kim, ok: false, elle: true, message: 'conf dosyasi ya da ServerName kesifte cozulemedi' }); continue; }
          try {
            const s = await launch(req, `Retirement: vhost plani ${w.serverName} @ ${w.host}`,
              { target_host: w.host, action: 'apache_retire_vhost', product: w.product, file: w.confFile, server_name: w.serverName, reload: false, plan_only: true },
              { op: 'vhost_plan', id, tid }, 'server_hub_fix');
            vhostPlan.push({ ...kim, ok: true, jobId: s.jobId, awxServerId: s.awxServerId });
          } catch (e) {
            vhostPlan.push({ ...kim, ok: false, message: String(e.message || e) });
          }
        }
      }
      res.json({ ok: true, ...r, planOnly: !confirmed, trafikTarama, vhostPlan, sccWarning: notifyScc && !SCC_MAIL_TO ? 'SCC bilgilendirme adresi tanımlı değil (Retirement sayfası › SCC adresi) — SCC maili gönderilmedi.' : null });
    } catch (err) { res.status(err.status || 500).json({ ok: false, message: err.message }); }
  });

  // ── DURUMU TAZELE (kullanici bulgusu 2026-10-08) ────────────────────────────────────
  // "Benim iptal ettigim kayda su an dokunamiyorum. Uygulama disabled edildi ama kaldi
  // bu sekilde."
  //
  // SEBEP: gecis durumlari ('stopping' / 'rolling_back' / 'deleting') bir ISIN SONUCU
  // yazilana kadar surer. O sonucu poller yaziyor - ama poller tabanli sonuclandirma
  // `t.delete_job_id` sabit yazimi yuzunden HIC CALISMIYORDU (6177b4e ile duzeldi) ve
  // onyuzun job yoklamasi yalnizca ekranda bekleyen biri varken kosuyor. Sonuc: hedef
  // 'stopping'de kaliyor, `canAct` da geri alma kosulu da tutmuyor -> EKRANDA HICBIR
  // DUGME YOK, uygulama kapali.
  //
  // Bu uc DURUMU OLCER, tahmin etmez: AWX isini okur, terminal ise gercek sonucu yazar.
  // OKUNAMADIYSA HICBIR SEY YAZMAZ ve bunu soyler - "okunamadi" ile "basarisiz" ayni sey
  // degil; basarili olmus bir stop'u basarisiz yazmak uygulamayi erisilemez gosterirdi.
  const TAZELE_ADIM = Object.freeze({
    planning: { alan: 'last_job_id', kind: 'stop', ok: 'planned', hata: 'failed', zaman: null },
    stopping: { alan: 'last_job_id', kind: 'stop', ok: 'stopped', hata: 'failed', zaman: 'stopped_at' },
    rolling_back: { alan: 'rollback_job_id', kind: 'rollback', ok: 'active', hata: 'rollback_failed', zaman: 'rolled_back_at' },
    deleting: { alan: 'delete_job_id', kind: 'delete', ok: 'deleted', hata: 'failed', zaman: 'deleted_at' },
  });
  const TAZELE_KEY = Object.freeze({ stop: REGISTRY_KEY, delete: DELETE_REGISTRY_KEY, rollback: ROLLBACK_REGISTRY_KEY });
  const TAZELE_STATS = Object.freeze({
    stop: 'app_retirement_stop_result',
    delete: 'app_retirement_delete_result',
    rollback: 'app_retirement_rollback_result',
  });

  // ── WEB ADIMINI YENIDEN DENE (2026-10-08, kullanici: "web adimi duzgun calismadigi icin o
  // adimin success gozukmemesi ve job'i bitirdikten sonra tekrar tetikleyebilmek istiyorum").
  // Basarisiz ('failed') ve atlanmis ('skip') vhost girdileri 'pending'e doner; poller.webTick
  // bir sonraki turda yeniden baslatir (ayni yol, ayni urun kurallari - NGINX yine 'manual').
  // 'running' girdilere DOKUNULMAZ: sonucu henuz okunmamis is iki kez kosmasin. Yalniz
  // 'stopped' hedefte: webTick zaten yalniz durdurulmus hedefin vhost'larini kaldirir.
  router.post('/:id/targets/:tid/web-retry', async (req, res) => {
    const id = Number(req.params.id); const tid = Number(req.params.tid);
    try {
      const rec = await loadRecord(id);
      if (!rec) return res.status(400).json({ ok: false, message: 'Kayıt yok.' });
      if (rec.status === 'cancelled') return res.status(400).json({ ok: false, message: 'Kayıt iptal edilmiş.' });
      const t = rec.targets.find((x) => x.id === tid);
      if (!t) return res.status(400).json({ ok: false, message: 'Hedef yok.' });
      if (t.status !== 'stopped')
        return res.status(409).json({ ok: false, message: `Web adımı yalnız durdurulmuş hedefte yeniden denenir (hedef: ${t.status}).` });
      const { rows } = await db().query(`SELECT web_result_json FROM retirement_targets WHERE id = $1`, [tid]);
      let liste;
      try { liste = JSON.parse(rows?.[0]?.web_result_json || 'null'); } catch { liste = null; }
      if (!Array.isArray(liste) || !liste.length)
        return res.status(400).json({ ok: false, message: 'Bu hedefin web listesi yok (kayıt açılırken vhost bulunamamış).' });
      const YENIDEN = new Set(['failed', 'skip']);
      const secilen = liste.filter((w) => YENIDEN.has(w.status));
      if (!secilen.length) {
        const suren = liste.filter((w) => w.status === 'running').length;
        return res.status(409).json({ ok: false, message: suren ? `${suren} vhost işi hâlâ sürüyor; sonuç okunmadan yeniden denenmez.` : 'Yeniden denenecek başarısız ya da atlanmış vhost yok.' });
      }
      for (const w of secilen) {
        w.oncekiJobId = w.jobId ?? null;
        w.oncekiMesaj = w.message ?? null;
        w.status = 'pending';
        w.jobId = null;
        w.message = 'yeniden denenecek';
      }
      await db().query(`UPDATE retirement_targets SET web_result_json = $1, updated_at = GETUTCDATE() WHERE id = $2 AND status = 'stopped'`, [JSON.stringify(liste).slice(0, 60000), tid]);
      await addEvent(id, req.session?.user?.username, 'web',
        `${t.appName} @ ${t.host}: web adimi YENIDEN DENENECEK - ${secilen.map((w) => `${w.host} / ${w.serverName}`).join(', ')}`);
      res.json({ ok: true, adet: secilen.length, record: await loadRecord(id) });
    } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  router.post('/:id/targets/:tid/refresh-status', async (req, res) => {
    const id = Number(req.params.id);
    const tid = Number(req.params.tid);
    try {
      const rec = await loadRecord(id);
      if (!rec) return res.status(400).json({ ok: false, message: 'Kayıt yok.' });
      const t = rec.targets.find((x) => x.id === tid);
      if (!t) return res.status(400).json({ ok: false, message: 'Hedef yok.' });
      const adim = TAZELE_ADIM[t.status];
      if (!adim)
        return res.status(400).json({
          ok: false,
          message: `"${t.status}" bir geçiş durumu değil — tazelenecek bir iş yok.`,
        });

      const row = await db().query(`SELECT ${adim.alan} AS job_id FROM retirement_targets WHERE id = $1`, [tid]);
      const jobId = Number(row.rows?.[0]?.job_id);
      if (!Number.isInteger(jobId) || jobId <= 0)
        return res.status(400).json({
          ok: false,
          message:
            `Hedef "${t.status}" durumunda ama iş numarası yok (${adim.alan} boş) — iş hiç ` +
            `başlatılamamış. Durum elle çözülmeli; "${adim.hata}" olarak işaretlemek için ` +
            `yöneticiye başvurun.`,
          jobMissing: true,
        });

      const reg = require('../ansible/playbook-registry.cjs');
      const pr = await reg.getByKey(TAZELE_KEY[adim.kind]).catch(() => null);
      const serverId = pr && pr.awxServerId != null ? Number(pr.awxServerId) : 0;
      const runner = require('../ansible/runner.cjs');
      let info;
      try {
        info = await runner.getJobStatusOnServer(serverId, jobId);
      } catch (e) {
        // OKUNAMADI: hedefe DOKUNULMAZ.
        return res.status(502).json({ ok: false, message: `AWX işi okunamadı (#${jobId}): ${e.message}` });
      }
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      if (!TERMINAL.has(info.status))
        return res.json({ ok: true, degisti: false, jobId, jobStatus: info.status, message: `İş hâlâ çalışıyor (${info.status}).` });

      const { extractStatsKey } = require('../opsx/index.cjs');
      const r = extractStatsKey(info.artifacts, TAZELE_STATS[adim.kind]) || null;
      const line = String(r?.line || '');
      const msg = line.split('	').slice(2).join(' — ') || info.status;
      // ARTIFACT YOKSA 'successful' OLSA BILE OK SAYILMAZ: playbook sonucu set_stats ile
      // bildiriyor; bildirim yoksa ne yapildigini BILMIYORUZ (poller ile ayni kural).
      const basarili = info.status === 'successful' && line.split('	')[2] === 'OK';
      const yeni = basarili ? adim.ok : adim.hata;
      const zamanSql = basarili && adim.zaman ? `, ${adim.zaman} = GETUTCDATE()` : '';
      await db().query(
        `UPDATE retirement_targets SET status = $1, result_text = $2${zamanSql}, updated_at = GETUTCDATE()
          WHERE id = $3 AND status = $4`,
        [yeni, msg.slice(0, 1000), tid, t.status],
      );
      await addEvent(id, req.session?.user?.username, 'refresh', `${t.appName} @ ${t.host}: ${t.status} -> ${yeni} (iş #${jobId}, ${info.status})`);
      res.json({ ok: true, degisti: true, from: t.status, to: yeni, jobId, jobStatus: info.status, message: msg, record: await loadRecord(id) });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // ── GERI AL (kullanici, 2026-10-07) ───────────────────────────────────────────────
  // "Eger belli bir t sure sonra, uygulama daha SILINMEDEN sorun olursa geri donebilmek
  // icin bir ozellik yapmaliyiz. Uygulamami geri aktif et vs ve yaptigimiz degisiklikler
  // geri alinmali."
  //
  // NE YAPAR: STOP'un BIREBIR TERSI (app_retirement_rollback.yml):
  //   paketler .<SMART_NO>.old sonekinden kurtarilir -> auto-start=true -> start
  // Ayrica STOP'ta kaldirilan Apache/IHS vhost'lari apache_restore_vhost ile geri acilir.
  //
  // ── SILMEYI OTOMATIK IPTAL EDER (en kritik davranis) ──────────────────────────────
  // `deleteTick` YALNIZ `status='stopped'` hedeflere bakiyor. Hedef 'rolling_back' olur
  // olmaz zamanlanmis silme DEVRE DISI kalir; ayri bir "iptal" cagrisina gerek YOK ve
  // olmasi da yanlis olurdu (iki ayri yerden yurutulen bir kural, biri unutulunca geri
  // aktif edilmis bir uygulamayi siler).
  //
  // SILINMIS KAYIT GERI ALINAMAZ: DELETE paketleri siler, server-config/server-group'u
  // kaldirir. O noktadan sonrasi yedekten restore isidir; burada "geri aldim" demek
  // yapilmayan bir isi basari saymak olurdu.
  router.post('/:id/targets/:tid/rollback', async (req, res) => {
    const id = Number(req.params.id);
    const tid = Number(req.params.tid);
    const confirmed = req.body?.confirmed === true;
    try {
      const rec = await loadRecord(id);
      if (!rec) return res.status(400).json({ ok: false, message: 'Kayıt yok.' });
      const t = rec.targets.find((x) => x.id === tid);
      if (!t) return res.status(400).json({ ok: false, message: 'Hedef yok.' });
      if (!t.gen)
        return res.status(400).json({ ok: false, message: `${t.host}: JBoss nesli belirlenemedi.` });

      // DURUM KAPISI. Geri alinabilir TEK durum "durdurulmus ama silinmemis"tir;
      // 'rollback_failed' tekrar denemeye aciktir (yarim kalmis bir geri almayi
      // kilitlemek, uygulamayi erisilemez halde birakmak olurdu).
      const IZINLI = new Set(['stopped', 'rollback_failed']);
      if (t.deletedAt || t.status === 'deleted')
        return res.status(400).json({
          ok: false,
          message:
            `${t.appName} @ ${t.host} SILINDI — geri alma artık mümkün değil. Paketler ve ` +
            `server-config kaldırıldı; geri dönüş yedekten restore işidir (JBoss ekibi).`,
        });
      if (t.status === 'deleting')
        return res.status(409).json({
          ok: false,
          message: `${t.appName} @ ${t.host} için silme işi ŞU AN çalışıyor — geri alma başlatılamaz.`,
        });
      if (t.status === 'rolling_back')
        return res.status(409).json({ ok: false, message: 'Geri alma işi zaten çalışıyor.' });
      if (!IZINLI.has(t.status))
        return res.status(400).json({
          ok: false,
          message: `${t.appName} @ ${t.host} durumu "${t.status}" — geri alma yalnızca durdurulmuş (stopped) hedefler için yapılır.`,
        });

      const extraVars = {
        target_host: t.host,
        application: t.appName,
        jboss_gen: String(t.gen),
        smart_no: rec.smartNo,
        plan_only: !confirmed,
        requested_by: req.session?.user?.username || 'Portal',
      };
      const r = await launch(
        req,
        `Retirement: ${confirmed ? 'GERI AL' : 'geri alma planı'} ${t.appName} @ ${t.host}`,
        extraVars,
        { op: confirmed ? 'rollback' : 'rollback_plan', id, tid },
        ROLLBACK_REGISTRY_KEY,
      );

      if (confirmed) {
        // DURUMU HEMEN DEGISTIR. Is numarasini yazmadan once durumu 'rolling_back'
        // yapmak, silme kapisini AYNI transaksiyonda kapatir; arada gececek bir
        // deleteTick'in hedefi 'stopped' gorup silmeye baslamasi imkansiz olur.
        await db().query(
          `UPDATE retirement_targets SET status = 'rolling_back', rollback_job_id = $1, result_text = NULL, updated_at = GETUTCDATE() WHERE id = $2`,
          [r.jobId, tid],
        );
        await addEvent(
          id,
          req.session?.user?.username,
          'rollback',
          `${t.appName} @ ${t.host} GERİ ALINIYOR (iş #${r.jobId}) — zamanlanmış silme devre dışı`,
        );
        // WEB KATMANI: STOP'ta kaldirilan vhost'lar geri acilir. `apache_restore_vhost`
        // apache_retire_vhost'un tersidir ve ayni disiplini tasir (yedek, apachectl -t,
        // gecmezse geri alma). NGINX hedefleri otomatik kaldirilmamisti ('manual'), geri
        // acilacak bir sey de yok - sessizce "geri acildi" demeyiz.
        const web = await webGeriAl(id, tid, req.session?.user?.username);
        return res.json({ ok: true, ...r, planOnly: false, web });
      }

      await db().query(
        `UPDATE retirement_targets SET rollback_job_id = $1, updated_at = GETUTCDATE() WHERE id = $2`,
        [r.jobId, tid],
      );
      await addEvent(id, req.session?.user?.username, 'rollback_plan', `${t.appName} @ ${t.host} geri alma planı (iş #${r.jobId})`);
      res.json({ ok: true, ...r, planOnly: true });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // Is durumu: bitince hedef/kayit durumu guncellenir (set_stats app_retirement_stop_result)
  router.get('/:id/targets/:tid/job-status/:serverId/:jobId', async (req, res) => {
    const id = Number(req.params.id); const tid = Number(req.params.tid);
    const serverId = Number(req.params.serverId); const jobId = Number(req.params.jobId);
    if (![id, tid, serverId, jobId].every(Number.isInteger)) return res.status(400).json({ ok: false, message: 'Geçersiz parametre.' });
    try {
      const runner = require('../ansible/runner.cjs');
      const [statusInfo, outputInfo] = await Promise.all([runner.getJobStatusOnServer(serverId, jobId), runner.getJobOutputOnServer(serverId, jobId)]);
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      let result = null;
      if (TERMINAL.has(statusInfo.status)) {
        const { extractStatsKey } = require('../opsx/index.cjs');
        result = extractStatsKey(statusInfo.artifacts, 'app_retirement_stop_result') || null;
        const line = String(result?.line || '');
        const msg = line.split('\t').slice(2).join(' — ') || statusInfo.status;
        // AYRINTI: STEP ve RENAMED satirlari. `line` yalniz OZET; plan onayinda hangi
        // dosyalara dokunulacagi bu listelerde. Alanlar gelmezse null yazilir (eski
        // playbook surumu) - uydurulmaz.
        const detailJson = (() => {
          const st = Array.isArray(result?.steps) ? result.steps : null;
          const rn = Array.isArray(result?.renamed) ? result.renamed : null;
          if (!st && !rn) return null;
          return JSON.stringify({ steps: st || [], renamed: rn || [] }).slice(0, 60000);
        })();
        const cur = await db().query(`SELECT status, last_job_id FROM retirement_targets WHERE id = $1`, [tid]);
        const row = cur.rows?.[0];
        if (row && Number(row.last_job_id) === jobId && (row.status === 'planning' || row.status === 'stopping')) {
          const planOnly = result ? !!result.plan_only : row.status === 'planning';
          if (planOnly) {
            await db().query(`UPDATE retirement_targets SET status = $1, plan_text = $2, detail_json = $3, updated_at = GETUTCDATE() WHERE id = $4`, [statusInfo.status === 'successful' ? 'planned' : 'failed', msg.slice(0, 1000), detailJson, tid]);
          } else if (statusInfo.status === 'successful' && /\tOK\t/.test(line)) {
            await db().query(`UPDATE retirement_targets SET status = 'stopped', result_text = $1, detail_json = $2, stopped_at = GETUTCDATE(), updated_at = GETUTCDATE() WHERE id = $3`, [msg.slice(0, 1000), detailJson, tid]);
            await db().query(`UPDATE retirement_records SET stop_at = COALESCE(stop_at, GETUTCDATE()), scc_notified_at = CASE WHEN $2 = 1 THEN COALESCE(scc_notified_at, GETUTCDATE()) ELSE scc_notified_at END, updated_at = GETUTCDATE() WHERE id = $1`, [id, (await sccAyar()).to ? 1 : 0]);
            const left = await db().query(`SELECT COUNT(*) AS n FROM retirement_targets WHERE record_id = $1 AND status <> 'stopped' AND status <> 'skipped'`, [id]);
            if (Number(left.rows?.[0]?.n) === 0) await db().query(`UPDATE retirement_records SET status = 'stopped', updated_at = GETUTCDATE() WHERE id = $1`, [id]);
          } else {
            await db().query(`UPDATE retirement_targets SET status = 'failed', result_text = $1, detail_json = $2, updated_at = GETUTCDATE() WHERE id = $3`, [msg.slice(0, 1000), detailJson, tid]);
          }
          await addEvent(id, null, planOnly ? 'plan-result' : 'stop-result', `iş #${jobId}: ${msg}`);
        }
      }
      // Vhost plan isi icin (server_hub_fix): kapatilacak blok + RESULT satiri. Bu is hedefin
      // last_job_id'si olmadigi icin yukaridaki sonuclandirma ona dokunmaz.
      let fixResult = null;
      if (TERMINAL.has(statusInfo.status)) {
        fixResult = require('../opsx/index.cjs').extractStatsKey(statusInfo.artifacts, 'server_hub_fix_result') || null;
      }
      res.json({ ok: true, status: statusInfo.status, output: outputInfo.output || '', result, fixResult });
    } catch (err) { res.status(err.status || 500).json({ ok: false, message: err.message }); }
  });

  // ── POLLER (kullanici karari 2026-10-06) ──────────────────────────────────────
  // STOP: OCO kesinti penceresi acilinca. DELETE: silme tarihi gelince, ekstra onay YOK.
  // Launcher ENJEKTE EDILIR; poller AWX'i tanimaz (dongusel require yok, testi aga cikmaz).
  //
  // `req` YOK: isi poller basliyor, oturum da yok. launch() `req.session?.user` okuyor ve
  // undefined'a dayanikli; tetikleyen kimlik olay kaydinda (addEvent username=null ->
  // "sistem") ve extraVars.requested_by'da yaziyor.
  try {
    require('./poller.cjs').startPoller(async (kind, t) => {
      const ortak = {
        target_host: t.host,
        application: t.application,
        jboss_gen: String(t.gen),
        smart_no: t.smartNo,
        app_path: t.appPath || '',
        requested_by: 'Portal (zamanlanmis)',
      };
      if (kind === 'stop') {
        // SCC MAILI ZAMANLANMIS KOSUDA DA GIDER: PROD'da ilk gercek stop'ta bildirim
        // sarti, isi insanin mi poller'in mi baslattigina bagli degil.
        const rec = await db().query(`SELECT scc_notified_at FROM retirement_records WHERE id = $1`, [t.recordId]);
        const scc = await sccAyar();
        const notify = t.env === 'PROD' && !rec.rows?.[0]?.scc_notified_at && !!scc.to;
        return launch(
          null,
          `Retirement: STOP ${t.application} @ ${t.host} (zamanlanmis)`,
          { ...ortak, plan_only: false, notify_scc: notify, scc_mail_to: scc.to, scc_mail_cc: scc.cc || undefined, oco_no: t.ocoNo || '' },
          { op: 'stop', id: t.recordId, tid: t.targetId },
        );
      }
      return launch(
        null,
        `Retirement: DELETE ${t.application} @ ${t.host}`,
        { ...ortak, plan_only: false },
        { op: 'delete', id: t.recordId, tid: t.targetId },
        DELETE_REGISTRY_KEY,
      );
    },
    // SONLANDIRICI: DELETE'i kimse izlemiyor, sonucu poller yazmak zorunda.
    // OKUNAMADI != BASARISIZ: AWX'e ulasilamadiysa `terminal:false` doner ve hedef
    // 'deleting'de KALIR; bir sonraki tick tekrar bakar. 'failed' yazmak, aslinda
    // basarili olmus bir silmeyi basarisiz gostermek olurdu.
    async (kind, t) => {
      const reg = require('../ansible/playbook-registry.cjs');
      // 'web': vhost kaldirma isi (server_hub_fix / apache_retire_vhost) - poller.webSonucTick.
      const KEYS = { stop: REGISTRY_KEY, delete: DELETE_REGISTRY_KEY, rollback: ROLLBACK_REGISTRY_KEY, web: 'server_hub_fix' };
      const row = await reg.getByKey(KEYS[kind] || DELETE_REGISTRY_KEY).catch(() => null);
      const serverId = row && row.awxServerId != null ? Number(row.awxServerId) : 0;
      const runner = require('../ansible/runner.cjs');
      // IS NUMARASI ADIMIN KENDI ALANINDAN gelir: poller `job_id` olarak secip veriyor.
      // `t.delete_job_id` SABIT YAZMAK, STOP ve GERI ALMA isleri icin HEP null okumak
      // demekti (adim kendi alanini `job_id` takma adiyla donduruyor, bkz. finalizeAdim).
      const jobId = Number(t.job_id ?? t.delete_job_id);
      const info = await runner.getJobStatusOnServer(serverId, jobId);
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      if (!TERMINAL.has(info.status)) return { terminal: false };
      const { extractStatsKey } = require('../opsx/index.cjs');
      const STATS = {
        stop: 'app_retirement_stop_result',
        delete: 'app_retirement_delete_result',
        rollback: 'app_retirement_rollback_result',
        web: 'server_hub_fix_result',
      };
      const r = extractStatsKey(info.artifacts, STATS[kind] || STATS.delete) || null;
      const line = String(r?.line || '');
      const msg = line.split('	').slice(2).join(' — ') || info.status;
      // ARTIFACT OKUNAMADIYSA is 'successful' olsa bile OK SAYILMAZ: playbook sonucu
      // `set_stats` ile bildiriyor; bildirim yoksa ne yapildigini BILMIYORUZ.
      const ok = info.status === 'successful' && line.split('\t')[2] === 'OK';
      // SKIP (yalniz web): eylem yapilacak bir sey bulmadi - basarili DEGIL, ayri gosterilir.
      const skip = info.status === 'successful' && line.split('\t')[2] === 'SKIP';
      return { terminal: true, ok, skip, message: msg };
    },
    // WEB KATMANI: var olan `server_hub_fix` / apache_retire_vhost CAGRILIR, yeniden
    // YAZILMAZ. O eylem kanitli davraniyor: yedek alir, dosyada tek vhost varsa
    // .retired/ altina tasir, cok vhost'luda yalniz o blogu yorumlar, apachectl -t
    // gecmezse GERI ALIR, gecerse reload eder (server_hub/files/server_hub_fix.sh).
    async (w) => {
      const reg = require('../ansible/playbook-registry.cjs');
      const row = await reg.getByKey('server_hub_fix').catch(() => null);
      const templateId = row && row.enabled !== false ? reg.getEffectiveTemplateId(row) : null;
      if (!templateId)
        throw Object.assign(
          new Error(
            'AWX job template\'i tanımlı değil: Admin › Playbook Kayıtları › "server_hub_fix" ' +
              'satırına Template ID girilmeli (vhost kaldırma onu kullanır).',
          ),
          { status: 501 },
        );
      const serverId = row.awxServerId != null ? Number(row.awxServerId) : 0;
      const runner = require('../ansible/runner.cjs');
      // plan_only=false: liste onay aninda dondurulmustu, onay zaten verildi.
      const extraVars = {
        target_host: w.webHost,
        action: 'apache_retire_vhost',
        product: w.product,
        file: w.confFile,
        server_name: w.serverName,
        reload: true,
        plan_only: false,
      };
      await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: 'server_hub_fix' });
      return runner.launchJobOnServer(serverId, templateId, extraVars, '', {});
    });
  } catch (e) {
    console.warn('[Retirement] poller baslatilamadi:', e.message);
  }

  app.use('/api/retirement', router);
  console.log('[Retirement] mounted at /api/retirement');
}

module.exports = { initRetirement, REGISTRY_KEY, DELETE_REGISTRY_KEY, ROLLBACK_REGISTRY_KEY, DEFAULT_DAYS };
