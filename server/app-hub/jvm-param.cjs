// server/app-hub/jvm-param.cjs - Application Hub: JBoss JVM parametresi degistir / ekle (2026-11-11).
//
// Kullanici: "Application Hub'da uygulama goruntulemede JVM parametrelerini gosterebiliyoruz ancak
// degisiklik ve ekleme yapamiyoruz. Hem mevcut JVM parametresinde degisiklik hem yeni JVM parametresi
// ekleme yapabilme kabiliyeti getirmeni istiyorum."
//
// NASIL: Server Hub'in duzeltme hatti (server_hub_fix.yml, action=jboss_jvm_option). Betik SUNUCU
// DUZEYINDE (/host=H/server-config=JVM/jvm=R) tek parametreyi ekler ya da ayni anahtardaki degeri
// degistirir (batch: eski cikar + yeni eklenir), once host xml yedegi alir, sonucu CLI ile geri okur.
// -Xms / -Xmx heap ozniteligine yazilir. Calisan JVM'e RESTART'ta yansir; restart OTOMATIK YAPILMAZ.
//
// KAPILAR (sirayla):
//   1. Parametre IZIN LISTESINDE (betikle AYNI desen): tek belirtec; tirnak, bosluk, satir sonu, $, ;,
//      virgul, parantez, *** (maske) YOK. YASAK (inceleme 2026-11-11): komut calistiran (OnError,
//      OnOutOfMemoryError, javaagent/agentlib - zaten izin listesi disi), baska dosyadan secenek / sinif
//      yukleyen (VMOptionsFile, Flags, java.ext.dirs, class.path, system.class.loader ...), uzak yonetim
//      acan (com.sun.management.* JMX, rmi), guvenligi / TLS'i degistiren (java.security.*, javax.net.ssl.*).
//   2. SIR ANAHTARI YOK: -D anahtari parola/anahtar/token desenine uyuyorsa (mask.cjs KEY_ERE) yazilmaz:
//      deger AWX is kaydinda (extra_vars) acik gorunurdu. Bunlar elle / vault ile degistirilir.
//   3. Hedef istemciden ALINMAZ: host/gen/jvm son Server Hub taramasinda var mi; tarama taze mi; sema
//      okundu mu; JVM tanim kaynaginda mi (ps'te tanimsiz surec degil).
//   4. Once PLAN (plan_only, hicbir sey degismez); uygulama ayri istek + JVM adini elle yazma onayi.
//   5. PRODUCTION: OpsX ile AYNI Smart onay kapisi (Legacy flow key). Yalniz envGroup 'Non-Production'
//      olan sunucu prod disi sayilir; PROD, BILINMIYOR ya da bos -> PRODUCTION (fail-closed).
//   6. Sir anahtarli -D hic kabul edilmedigi icin deger ACIK yazilir (onaylayan neyi onayladigini gorsun);
//      goster() yine de sir desenli anahtari gizler (savunma derinligi).
'use strict';

const REGISTRY_KEY = 'server_hub_fix';
const ACTION = 'jboss_jvm_option';
const JVM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// server_hub_fix.sh JVMOPT_RE ile BIREBIR (bekci: app-hub-jvm-param.test.cjs sozlesme testi).
const JVMOPT_RE =
  /^(-D[A-Za-z0-9_.-]{1,128}(=[A-Za-z0-9_./:@%+=-]{0,512})?|-X(ms|mx|ss)[0-9]{1,6}[kKmMgG]|-XX:[+-][A-Za-z0-9]{1,64}|-XX:[A-Za-z0-9]{1,64}=[A-Za-z0-9_./:%-]{1,256})$/;
const JVMOPT_YASAK_RE =
  /^-XX:[+-]?(OnError|OnOutOfMemoryError|VMOptionsFile|Flags|CompileCommandFile|CompilerDirectivesFile)|^-D(java\.security\.|java\.ext\.dirs|java\.endorsed\.dirs|java\.class\.path|java\.library\.path|java\.system\.class\.loader|sun\.boot\.|com\.sun\.management\.|jdk\.attach\.|java\.rmi\.server\.|jboss\.modules\.system\.pkgs|javax\.net\.ssl\.)/;

/** Belirtecin "ayni parametre" anahtari (betikteki jvmopt_anahtar ile ayni). */
function anahtar(opt) {
  const s = String(opt || '');
  if (s.startsWith('-D')) return s.includes('=') ? s.slice(0, s.indexOf('=')) : s;
  if (/^-X(ms|mx|ss)/.test(s)) return s.slice(0, 4);
  if (/^-XX:[+-]/.test(s)) return `-XX:${s.slice(5)}`;
  if (s.startsWith('-XX:') && s.includes('=')) return `${s.slice(0, s.indexOf('='))}=`;
  return s;
}

/** Ekran / denetim icin: yalniz sir desenli -D anahtarinin degeri gizli (kapi 2 bunlari zaten reddeder). */
function goster(opt) {
  const s = String(opt || '');
  if (!(s.startsWith('-D') && s.includes('='))) return s;
  const { KEY_ERE } = require('../server-hub/mask.cjs');
  const k = s.slice(0, s.indexOf('='));
  return new RegExp(KEY_ERE, 'i').test(k.slice(2)) ? `${k}=<gizli>` : s;
}

/** Parametre dogrulama. Donus: { ok, message?, anahtar? } */
function parametreDogrula(opt) {
  const s = String(opt ?? '').trim();
  if (!s) return { ok: false, message: 'Parametre boş.' };
  if (s.includes('***')) return { ok: false, message: 'Maskeli değer (***) yazılamaz: ekranda gizlenen değeri tekrar girmeniz gerekir.' };
  if (!JVMOPT_RE.test(s)) {
    return {
      ok: false,
      message:
        'Parametre izin verilen biçimde değil. Örnekler: -Dozellik=deger, -Xmx2g, -Xms1g, -XX:+UseG1GC, -XX:MaxMetaspaceSize=512m. ' +
        'Tek parametre girin; boşluk, tırnak, virgül, $ ; ( ) gibi karakterler kullanılamaz.',
    };
  }
  if (JVMOPT_YASAK_RE.test(s)) return { ok: false, message: `${anahtar(s)} Portal'dan değiştirilemez (komut çalıştırır ya da güvenliği kapatır).` };
  if (s.startsWith('-D')) {
    const { KEY_ERE } = require('../server-hub/mask.cjs');
    if (new RegExp(KEY_ERE, 'i').test(anahtar(s).slice(2))) {
      return {
        ok: false,
        message: `${anahtar(s)} parola / anahtar içeren bir parametreye benziyor: değeri AWX iş kaydında açık görüneceği için Portal'dan yazılmaz.`,
      };
    }
  }
  return { ok: true, parametre: s, anahtar: anahtar(s) };
}

/** Hedefi son taramadan dogrular. Donus: { ok, h, j } ya da { ok:false, status, message }. */
async function hedefDogrula({ host, gen, jvm }) {
  const sh = require('../server-hub/index.cjs');
  const H = String(host || '').toUpperCase();
  if (!sh.HOST_RE.test(H)) return { ok: false, status: 400, message: 'Geçersiz sunucu adı.' };
  if (!JVM_RE.test(String(jvm || ''))) return { ok: false, status: 400, message: 'Geçersiz JVM adı.' };
  if (!Number.isInteger(gen)) return { ok: false, status: 400, message: 'Geçersiz JBoss sürümü.' };
  const a = await sh.getAssessment(true);
  const h = (a.hosts || []).find((x) => x.host === H);
  if (!h) return { ok: false, status: 400, message: `${H} için Server Hub tarama verisi yok.` };
  if (a.schemaUnknown === true || h.schemaUnknown === true) {
    return { ok: false, status: 400, message: 'Server Hub şeması okunamadı; JVM parametresi değiştirilemez. Sayfayı yenileyin.' };
  }
  if (h.fresh !== true) {
    return { ok: false, status: 400, message: `${H} taraması bayat (${h.scanDate || '?'}); önce Server Hub'da sunucuyu yeniden tarayın.` };
  }
  const j = (h.jvms || []).find((x) => x.name === jvm && Number(x.gen) === gen);
  if (!j) return { ok: false, status: 400, message: `${H} üzerinde ${jvm} (JBoss ${gen}) taramada yok; sayfayı yenileyin.` };
  if (j.source === 'cli' && j.cfgSrc === 'UNAVAILABLE') {
    return { ok: false, status: 400, message: `${jvm} tanım kaynağında yok (ps'te tanımsız süreç); parametresi değiştirilemez.` };
  }
  return { ok: true, h, j, host: H };
}

/**
 * Uretim etiketleri. FAIL-CLOSED (inceleme 2026-11-11): assess env'i envanterde yoksa ya da tanimsizsa
 * 'BILINMIYOR' yapar ve uretimEtiketi('bilinmiyor') false doner - eski hal Smart'i ATLIYORDU. Simdi yalniz
 * envGroup === 'Non-Production' olan sunucu prod disidir; geri kalan her sey production etiketi tasir.
 */
function uretimEtiketleri(h) {
  const env = String(h.env || '').trim();
  const prodDisi = h.envGroup === 'Non-Production' && env && env !== 'PROD' && env !== 'BILINMIYOR';
  return [
    { alan: 'ortam', deger: prodDisi ? env : env === 'PROD' ? 'PROD' : `prod (ortam ${env || 'bos'}; production sayıldı)` },
    { alan: 'sunucu', deger: h.host },
  ];
}

function mount(router, { resolveByKey }) {
  router.post('/jboss/jvm-param', async (req, res) => {
    const b = req.body || {};
    const uygula = b.apply === true;
    const pd = parametreDogrula(b.parametre);
    if (!pd.ok) return res.status(400).json({ ok: false, error: pd.message });
    let hd;
    try {
      hd = await hedefDogrula({ host: b.host, gen: Number(b.gen), jvm: String(b.jvm || '').trim() });
    } catch (e) {
      return res.status(424).json({ ok: false, error: `Server Hub okunamadı: ${(e && e.message) || e}` });
    }
    if (!hd.ok) return res.status(hd.status).json({ ok: false, error: hd.message });
    const { h, j, host } = hd;
    if (uygula && String(b.onayMetni || '').trim() !== j.name) {
      return res.status(428).json({ ok: false, error: `Uygulamak için JVM adını (${j.name}) onay kutusuna aynen yazın.` });
    }
    const { templateId, serverId, keyName } = await resolveByKey(REGISTRY_KEY);
    if (!templateId) {
      return res.status(501).json({
        ok: false,
        error: `Düzeltme playbook'u tanımlı değil: Admin › Playbook Kayıtları › "${keyName}" satırına Template ID girilmeli.`,
      });
    }
    const extraVars = { target_host: host, action: ACTION, plan_only: !uygula, reload: false, gen: Number(j.gen), jvm: j.name, jvm_option: pd.parametre };
    const maskeli = { ...extraVars, jvm_option: goster(pd.parametre) };
    const islem = `Application Hub JVM parametresi ${uygula ? 'uygula' : 'plan'}: ${goster(pd.parametre)} @ ${host}/${j.name}`;
    try {
      const tp = require('../ansible/template-preflight.cjs');
      await tp.assertRegistryPlaybook(serverId, templateId, REGISTRY_KEY);
      await tp.assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: REGISTRY_KEY });
      if (uygula) {
        const kapi = await require('../opsx/prod-approval.cjs').opsxProductionKapisi({
          platform: 'legacy',
          serverId,
          templateId,
          extraVars,
          limitValue: '',
          etiketler: uretimEtiketleri(h),
          req,
          islemAdi: 'Application Hub JVM parametresi',
          // Uygulama adi istemciden ALINMAZ: onaylayana yanlis ad gosterilebilirdi; JVM adinin tabanindan.
          ozet: { sunucular: host, jvm: j.name, parametre: goster(pd.parametre), uygulama: require('../server-hub/capraz.cjs').tabanAd(j.name) },
        });
        if (!kapi.proceed) {
          denetle(req, 'app_hub_jvm_param_onay', { ...maskeli, sonuc: kapi.body && kapi.body.pendingApproval ? 'smart_talebi' : 'reddedildi' });
          return res.status(kapi.status || 200).json({ ...(kapi.body || {}), error: kapi.body && !kapi.body.ok ? kapi.body.message : undefined });
        }
      }
      const u = (req.session && req.session.user) || {};
      const job = await require('../ansible/runner.cjs').launchJobOnServer(serverId, templateId, extraVars, '', u);
      try {
        await require('../db/index.cjs').query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [u.username || 'unknown', serverId, templateId, islem.slice(0, 250), job && job.jobId, (job && job.status) || 'pending', JSON.stringify(maskeli)],
        );
      } catch (e) {
        console.warn('[AppHub] jvm-param is gecmisi yazilamadi:', e.message);
      }
      denetle(req, uygula ? 'app_hub_jvm_param_uygula' : 'app_hub_jvm_param_plan', { ...maskeli, jobId: (job && job.jobId) || null });
      res.json({ ok: true, serverId, jobId: (job && job.jobId) || null, plan: !uygula, host, jvm: j.name, gen: Number(j.gen), parametre: goster(pd.parametre) });
    } catch (e) {
      res.status(e.status || 502).json({ ok: false, error: e.message });
    }
  });

  router.get('/jboss/jvm-param/:serverId/:jobId', async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || serverId < 0 || !Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ ok: false, error: 'Geçersiz iş numarası.' });
    }
    // SAHIPLIK (inceleme 2026-11-11): yalniz bu ucun baslattigi isler okunur (keyfi AWX isi degil).
    try {
      const k = await require('../db/index.cjs').query(
        `SELECT TOP 1 id FROM ansible_job_history WHERE awx_server_id = $1 AND job_id = $2 AND template_name LIKE 'Application Hub JVM parametresi%'`,
        [serverId, jobId],
      );
      if (!k.rows || !k.rows.length) return res.status(404).json({ ok: false, error: 'Bu iş bir Application Hub JVM parametresi işi değil.' });
    } catch (e) {
      return res.status(424).json({ ok: false, error: `İş kaydı okunamadı: ${(e && e.message) || e}` });
    }
    try {
      const st = await require('../ansible/runner.cjs').getJobStatusOnServer(serverId, jobId);
      const BITTI = new Set(['successful', 'failed', 'error', 'canceled']);
      if (!BITTI.has(st.status)) return res.json({ ok: true, status: st.status, finished: false });
      const { extractStatsKey } = require('../opsx/index.cjs');
      const r = extractStatsKey(st.artifacts, 'server_hub_fix_result');
      if (r && String(r.action || '') !== ACTION) return res.status(400).json({ ok: false, error: 'Bu iş bir JVM parametresi işi değil.' });
      const parca = String((r && r.line) || '').split('\t');
      const sonuc = parca[2] || (st.status === 'successful' ? 'BILINMIYOR' : 'FAIL');
      const mesaj = parca[3] || (r ? '' : 'İş bitti ama sonuç yayınlanmadı; AWX iş çıktısına bakın.');
      if (sonuc === 'OK') {
        try {
          require('../server-hub/index.cjs').onbellekSil();
        } catch {
          /* yoksay */
        }
      }
      res.json({ ok: true, status: st.status, finished: true, sonuc, mesaj, plan: r ? r.plan_only === true || r.plan_only === 'True' || r.plan_only === 'true' : null });
    } catch (e) {
      res.status(502).json({ ok: false, error: `İş durumu okunamadı: ${(e && e.message) || e}` });
    }
  });
}

function denetle(req, eylem, detay) {
  try {
    require('../audit/index.cjs').auditPortal(req, eylem, { detail: JSON.stringify(detay) });
  } catch {
    /* best-effort */
  }
}

module.exports = { mount, parametreDogrula, anahtar, goster, uretimEtiketleri, hedefDogrula, JVMOPT_RE, JVMOPT_YASAK_RE, ACTION, REGISTRY_KEY };
