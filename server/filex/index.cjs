// server/filex/index.cjs — FileX: Self Servis dosya listeleme (SADECE Legacy).
//
// OpsX'in AYNI deseni: kullanici uygulama adi + JBoss surumu + sunucu secer, bu portal
// bir AWX job'i tetikler ve sonucu okur. FileX'in OpsX'ten farki: hicbir islem YAPMAZ
// (restart/stop/start yok) — yalnizca secilen uygulamanin .ear dizinindeki (logs HARIC)
// tum dosyalari `ls -la` bilgisi + sha512sum ile SALT-OKUNUR listeler. Kullanicilar
// "paketim gecmis mi gecmemis mi" sorusunu kendi repo'larindaki checksum'la
// karsilastirarak bize sormadan cevaplayabilsin diye.
//
// HANGI AWX SUNUCUSU / TEMPLATE'I: Admin > Playbook Kayitlari ekranindan yonetilir
// (ansible_playbook_registry satiri: filex_list_files). Playbook'un kendisi bu repo'nun
// DISINDA tutulur (middleware_inventory.yml/openshift_inventory.yml ile ayni konvansiyon —
// AWX'e ayri bir Ansible projesi olarak yuklenir); sozlesme (extra_vars + filex_result
// JSON semasi) icin o dosyanin basligina bakilmali.
'use strict';

const REGISTRY_KEY = 'filex_list_files';

async function resolveTarget() {
  const playbookRegistry = require('../ansible/playbook-registry.cjs');
  const row = await playbookRegistry.getByKey(REGISTRY_KEY).catch(() => null);
  if (!row || row.enabled === false) {
    return { templateId: null, serverId: null };
  }
  const templateId = playbookRegistry.getEffectiveTemplateId(row);
  const envServer = Number(String(process.env.FILEX_AWX_SERVER_ID || '').trim());
  const serverId =
    row.awxServerId != null
      ? Number(row.awxServerId)
      : Number.isInteger(envServer) && envServer >= 0
        ? envServer
        : 0;
  return { templateId: templateId || null, serverId };
}

// AWX'in `artifacts` alanindan filex_result'i okur — OpsX/LogX ile AYNI ilke: ham stdout
// ASLA parse edilmez, sonuc her zaman playbook'un set_stats ile yayinladigi yapilandirilmis
// JSON'dan gelir. LogX v2'nin jobs.cjs'teki extractLogxResultFromArtifacts'inin FileX icin
// kucuk bir kopyasi — LogX'in kendi kalici request/job tablosuna bagimli olmadan, OpsX gibi
// hafif (stateless) bir akista kullanilabilsin diye ayri tutulur.
//
// playbook v2'den itibaren her host'un dosya listesi HAM METIN olarak gelir (meta_raw +
// sha_raw, bkz. filex_list_files.yml basligindaki performans notu) — burada
// filex-parse.cjs ile path bazinda birlestirilip nihai `files[]` uretilir. Bu adim
// olmadan onyuz meta_raw/sha_raw dize ciftini gormek zorunda kalirdi.
function extractFilexResult(rawArtifacts) {
  const artifacts = rawArtifacts || {};
  const { parseFilexResult } = require('./filex-parse.cjs');
  if (artifacts.filex_result && typeof artifacts.filex_result === 'object')
    return parseFilexResult(artifacts.filex_result);
  if (artifacts.data?.filex_result && typeof artifacts.data.filex_result === 'object')
    return parseFilexResult(artifacts.data.filex_result);
  if (
    artifacts.ansible_stats?.data?.filex_result &&
    typeof artifacts.ansible_stats.data.filex_result === 'object'
  ) {
    return parseFilexResult(artifacts.ansible_stats.data.filex_result);
  }
  return null;
}

// ── BUYUK SONUC (2026-10-14) ────────────────────────────────────────────────
//
// URETIM (13 Ekim): 9 FileX isinin 3'u hic sonuc gostermedi. Hepsi TEK sunucuydu; o
// sunucunun dosya listesi (her dosya icin meta + sha512) `artifacts`a sigmadi ve
// `/api/v2/jobs/<id>/` yaniti genel 4 MB bayt kapisina takildi. Uc 502 donuyordu;
// kurumsal vekil 5xx govdesini degistirdigi icin ekran "Portal yeniden baslatiliyor,
// tekrar deneyin" dedi ve kullanici isi iki kez daha baslatti. Sonuc HICBIR denemede
// gorunemezdi: ayni sunucu, ayni liste.
//
// 4 MB kapisi bir OOM onlemi (uzlastirici acilista cok sayida isi ayni anda okuyordu)
// ve genel olarak KALIR. Burada yalniz su durumda genisletilir: normal okuma tavana
// takildiysa ayni is BIR KEZ daha, daha genis tavanla okunur. Bellek sinirli kalsin
// diye:
//   - surec genelinde AYNI ANDA TEK genis okuma (sira),
//   - ayni isin ust uste gelen yoklamalari AYNI okumayi bekler (tek ucus),
//   - bitmis isin cevabi kisa sure saklanir (ucusta kalan yoklama yeniden indirmesin),
//   - genis tavan da asildiysa is "cok buyuk" diye hatirlanir; her yoklama 32 MB
//     indirmeye kalkmaz.
const FILEX_SONUC_MAX_BYTES = 32 * 1024 * 1024;
const SONUC_SAKLA_MS = 60 * 1000;
// Saklanan cevaplar BUYUK (on binlerce dosya): en fazla iki tane, sure dolunca silinir.
const SONUC_TAVAN = 2;
// Yalniz anahtar (ve kisa hata) tutan kumeler.
const HATIRLA_TAVAN = 50;
const _buyuk = {
  sira: Promise.resolve(),
  ucusta: new Map(),
  sonuc: new Map(),
  buyukIsler: new Set(),
  cokBuyuk: new Map(),
};

function sinirliEkle(kume, anahtar, deger, tavan = HATIRLA_TAVAN) {
  while (kume.size >= tavan) kume.delete(kume.keys().next().value);
  if (kume instanceof Map) kume.set(anahtar, deger);
  else kume.add(anahtar);
}

function sonucuSakla(anahtar, cevap) {
  sinirliEkle(_buyuk.sonuc, anahtar, { at: Date.now(), cevap }, SONUC_TAVAN);
  const t = setTimeout(() => {
    const kayit = _buyuk.sonuc.get(anahtar);
    if (kayit && Date.now() - kayit.at >= SONUC_SAKLA_MS) _buyuk.sonuc.delete(anahtar);
  }, SONUC_SAKLA_MS);
  if (typeof t.unref === 'function') t.unref();
}

// Zincir yalniz SIRAYI tasir, SONUCU degil: `undefined`a cevrilmezse son genis okumanin
// nesnesi (on binlerce dosya) bir sonraki okumaya dek bellekte kalirdi.
function sirayla(is) {
  const p = _buyuk.sira.then(is);
  _buyuk.sira = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}

function durumCevabi(statusInfo) {
  const finished = statusInfo.finished;
  const result = finished ? extractFilexResult(statusInfo.artifacts) : null;
  return {
    ok: true,
    status: statusInfo.status,
    finished,
    failed: statusInfo.failed || (finished && !result),
    result,
  };
}

// Bir isin durum cevabini uretir. Kalici "cok buyuk" durumunda `tooLarge` isaretli bir
// hata firlatir; cagiran onu 4xx'e cevirir.
async function isDurumu(runner, serverId, jobId) {
  const anahtar = `${serverId}:${jobId}`;
  const saklanan = _buyuk.sonuc.get(anahtar);
  if (saklanan && Date.now() - saklanan.at < SONUC_SAKLA_MS) return saklanan.cevap;
  if (saklanan) _buyuk.sonuc.delete(anahtar);
  const bilinenHata = _buyuk.cokBuyuk.get(anahtar);
  if (bilinenHata) throw bilinenHata;

  if (!_buyuk.buyukIsler.has(anahtar)) {
    try {
      return durumCevabi(await runner.getJobStatusOnServer(serverId, jobId));
    } catch (e) {
      if (!e || !e.tooLarge) throw e;
      sinirliEkle(_buyuk.buyukIsler, anahtar);
    }
  }

  let ucus = _buyuk.ucusta.get(anahtar);
  if (!ucus) {
    ucus = sirayla(() => runner.getJobStatusOnServer(serverId, jobId, { maxBytes: FILEX_SONUC_MAX_BYTES }))
      .then((statusInfo) => {
        const cevap = durumCevabi(statusInfo);
        if (cevap.finished) sonucuSakla(anahtar, cevap);
        return cevap;
      })
      .catch((e) => {
        if (e && e.tooLarge) sinirliEkle(_buyuk.cokBuyuk, anahtar, e);
        throw e;
      })
      .finally(() => _buyuk.ucusta.delete(anahtar));
    _buyuk.ucusta.set(anahtar, ucus);
  }
  return ucus;
}

function initFileX(app) {
  const express = require('express');

  let requireAuth = (req, res, next) =>
    res.status(401).json({ ok: false, message: 'Auth modülü yok.' });
  try {
    const authMod = require('../auth/index.cjs');
    if (typeof authMod.requireAuth === 'function') requireAuth = authMod.requireAuth;
  } catch {
    /* auth modulu yoksa deny kalir */
  }

  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    app.use('/api/filex', requireVisiblePrefix('FileX'));
  } catch {
    /* motor yoksa yoksay */
  }

  // GET /api/filex/apps?search= — OpsX/LogX ile AYNI kaynak.
  app.get('/api/filex/apps', requireAuth, async (req, res) => {
    try {
      const legacy = require('../logx/v2/legacy.cjs');
      const result = await legacy.searchApps(req.query.search);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/filex/hosts?app= — OpsX'in hostsForApp'ini AYNEN kullanir (kod tekrari yok).
  app.get('/api/filex/hosts', requireAuth, async (req, res) => {
    try {
      const { hostsForApp } = require('../opsx/index.cjs');
      const hosts = await hostsForApp(req.query.app);
      res.json({ ok: true, hosts });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // POST /api/filex/run — { application, hosts } -> AWX job tetikler.
  app.post('/api/filex/run', requireAuth, express.json({ limit: '64kb' }), async (req, res) => {
    const { application, hosts } = req.body || {};

    const { templateId, serverId } = await resolveTarget();
    if (!templateId) {
      return res.status(501).json({
        ok: false,
        message:
          `FileX için AWX job template'i henüz tanımlanmadı. Yönetici, Admin > ` +
          `Playbook Kayıtları ekranında "${REGISTRY_KEY}" satırının Template ID ` +
          `alanını doldurmalı.`,
      });
    }

    if (!String(application || '').trim()) {
      return res.status(400).json({ ok: false, message: 'Uygulama adı gerekli.' });
    }
    if (!Array.isArray(hosts) || hosts.length === 0) {
      return res.status(400).json({ ok: false, message: 'En az bir sunucu seçilmeli.' });
    }

    // ANTI-TOCTOU: OpsX ile AYNI kontrol — client'in gonderdigi host listesine guvenilmez.
    const { hostsForApp } = require('../opsx/index.cjs');
    let allowed;
    try {
      allowed = new Set((await hostsForApp(application)).map((h) => h.host.toUpperCase()));
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, message: err.message });
    }
    const requested = hosts
      .map((h) =>
        String(h || '')
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);
    const notMine = requested.filter((h) => !allowed.has(h));
    if (notMine.length) {
      return res.status(400).json({
        ok: false,
        message: `Bu sunucular seçilen uygulamaya ait değil: ${notMine.join(', ')}`,
      });
    }

    const extraVars = { app_name: String(application).trim(), target_hosts: requested.join(',') };

    try {
      const runner = require('../ansible/runner.cjs');
      const result = await runner.launchJobOnServer(
        serverId,
        templateId,
        extraVars,
        '',
        req.session?.user,
      );

      try {
        const db = require('../db/index.cjs');
        await db.query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            req.session?.user?.username || 'unknown',
            serverId,
            templateId,
            'FileX: dosya listeleme',
            result?.jobId,
            result?.status || 'pending',
            JSON.stringify(extraVars),
          ],
        );
      } catch (e) {
        console.warn('[FileX] Gecmis kaydedilemedi:', e.message);
      }

      try {
        require('../audit/index.cjs').auditPortal(req, 'filex_list_files', {
          detail: JSON.stringify({ extraVars, jobId: result?.jobId ?? null }),
        });
      } catch {
        /* denetim kaydi best-effort */
      }

      console.log(
        `[FileX] ${req.session?.user?.username} -> app=${extraVars.app_name} hosts=${extraVars.target_hosts} template=${templateId} server=${serverId} job=${result?.jobId ?? '?'}`,
      );
      res.json({
        ok: true,
        jobId: result?.jobId ?? null,
        status: result?.status ?? null,
        awxServerId: serverId,
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/filex/job-status/:serverId/:jobId — canli durum + (bitince) yapilandirilmis sonuc.
  app.get('/api/filex/job-status/:serverId/:jobId', requireAuth, async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ ok: false, message: 'Geçersiz sunucu/iş numarası.' });
    }

    // IDOR korumasi: OpsX ile AYNI kontrol.
    try {
      const db = require('../db/index.cjs');
      const reqUser = req.session?.user || {};
      if (reqUser.role !== 'Admin') {
        // SAHIPLIK KAPISI FAIL-CLOSED (2026-09-07'de duzeltildi).
        //
        // Eski hali IKI yerde fail-open'di ve ikisi de sessizdi:
        //   1) `rows.length &&` — is `ansible_job_history`de YOKSA kontrol atlanip
        //      erisim VERILIYORDU.
        //   2) `catch { /* DB hiccup -> fail-open */ }` — DB hatasinda da veriliyordu.
        // Sonuc: giris yapmis bir kullanici serverId/jobId (kucuk tamsayilar)
        // deneyerek BASKASININ FileX sonucunu — yani sunuculardaki dizin listelerini —
        // okuyabilirdi.
        //
        // ScaleX'in `denyIfNotOwner`i bu kapiyi ZATEN fail-closed kuruyordu; iki
        // modul ayni soruyu farkli katilikta yanitliyordu. Desen ScaleX'e hizalandi.
        let owner = null;
        try {
          const { rows } = await db.query(
            `SELECT TOP 1 username FROM ansible_job_history WHERE job_id = $1 AND awx_server_id = $2`,
            [jobId, serverId],
          );
          owner = rows.length && rows[0].username ? String(rows[0].username).toLowerCase() : null;
        } catch (e) {
          // DB okunamiyorsa sahiplik DOGRULANAMAZ. Bilinmezlikte erisim VERMEK,
          // tam da kapinin engellemesi gereken sey.
          console.warn('[FileX] sahiplik sorgusu basarisiz — erisim reddedildi:', e.message);
          return res
            .status(503)
            .json({ ok: false, message: 'İş sahipliği doğrulanamadı, lütfen tekrar deneyin.' });
        }
        if (!owner || owner !== String(reqUser.username || '').toLowerCase()) {
          // BASKASININ ISINE ERISIM DENEMESI DENETIME (ScaleX ile ayni gerekce):
          // 403 donmek tek basina hicbir iz birakmiyordu.
          try {
            require('../audit/index.cjs').auditPortal(req, 'filex_access_denied', {
              result: 'fail',
              detail: JSON.stringify({ serverId, jobId, owner: owner || null }),
            });
          } catch {
            /* denetim yazilamadi — kapi yine de kapali kalir */
          }
          return res.status(403).json({ ok: false, message: 'Bu iş size ait değil.' });
        }
      }
    } catch (e) {
      // Beklenmeyen bir hata: kapiyi ACIK birakma.
      console.warn('[FileX] sahiplik kontrolu beklenmeyen hata — erisim reddedildi:', e.message);
      return res.status(503).json({ ok: false, message: 'İş sahipliği doğrulanamadı.' });
    }

    try {
      const runner = require('../ansible/runner.cjs');
      res.json(await isDurumu(runner, serverId, jobId));
    } catch (err) {
      if (err && err.tooLarge) {
        // KALICI ve KULLANICIYA OKUNUR: 422 vekilden degismeden gecer (5xx gecmez) ve
        // ekran yoklamayi durdurup bu metni gosterir. "Tekrar deneyin" DENMEZ: ayni
        // sunucunun listesi bir sonraki denemede kuculmez.
        return res.status(422).json({
          ok: false,
          code: 'filex_result_too_large',
          message:
            `İş bitti (AWX iş #${jobId}) ama dosya listesi portalın gösterebileceği boyutu ` +
            `(${Math.round(FILEX_SONUC_MAX_BYTES / (1024 * 1024))} MB) aşıyor. Listeyi AWX ` +
            'arayüzünde bu işin çıktısından inceleyin; işi yeniden başlatmak sonucu değiştirmez.',
        });
      }
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  console.log('[FileX] endpoints mounted at /api/filex');
}

module.exports = { initFileX };
