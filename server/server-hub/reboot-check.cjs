// server/server-hub/reboot-check.cjs — Server Hub > Reboot Kontrolü (2026-10-08).
//
// Kullanici: "reboot olacak bir sunucu var. calisma oncesi bu job'i calistirip sunucuda ne vardi ne
// yoktu not aliyor. reboot sonrasi onceki durum ile karsilastiriyor; onceden varolan ancak acilmamis
// process/jvm varsa aciyor, onceden olmayan ancak acilmis varsa kapatiyor ... Calisma oncesi ve
// sonrasi calistiralim, sunucunun sorunsuz oldugundan emin olalim." Karar: ikisi de OTOMATIK, ama
// TEK JVM bazinda (playbook: bmw_automation_folder/patch_remediation/reboot_check.yml). Sadelestirme
// (2026-10-08): yalniz Nginx/RHA/IHS/CTG/JBoss7/JBoss8/WAS urunleri ve JBoss/WAS JVM'leri; python vb. yok.
//
// "ONCE" GORUNTUSU PORTAL'DA SAKLANIR: ilk tasarim onu sunucuda /tmp'ye (reboot'ta silinebilir) ve
// AWX'in gecici is dizinine (job bitince silinir) yaziyordu. Burada once job'inin set_stats sonucu
// reboot_checks.once_json'a yazilir; "sonra" job'ina rc_once olarak Portal verir.
//
// SORUNSUZ = son goruntu OLCULDU ve "once" ile farki YOK. Olculemeyen sunucu sorunsuz SAYILMAZ.
'use strict';

const REGISTRY_KEY = 'reboot_check';
const MAX_HOST = 50;
const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);

const db = () => require('../db/index.cjs');
const jsonOku = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

/** "sonra" sonucundan sunucu basina degerlendirme (saf; test edilir). */
function sonraDegerlendir(sunucular, hedefler) {
  const out = {};
  for (const h of hedefler) {
    const r = sunucular?.[h];
    if (!r || r.sonuc_yok || r.ulasilamadi) {
      out[h] = { durum: 'olculemedi', sebep: 'sunucudan sonuc gelmedi (ulasilamadi ya da kopya dogrulanamadi)' };
      continue;
    }
    if (!r.once_var) {
      out[h] = { durum: 'olculemedi', sebep: 'bu sunucunun "once" goruntusu yok' };
      continue;
    }
    const islemler = (r.islemler || []).filter((l) => String(l).startsWith('SONUC|'));
    const hatali = islemler.filter((l) => String(l).split('|')[4] === 'FAIL').length;
    const kalan = (r.son_fark || []).filter((l) => String(l).startsWith('FARK|'));
    if (!r.son_olculdu) {
      out[h] = { durum: 'olculemedi', sebep: 'son goruntu alinamadi', islem: islemler.length, hatali };
      continue;
    }
    out[h] = {
      durum: kalan.length === 0 ? 'sorunsuz' : 'sorunlu',
      kalan: kalan.length,
      islem: islemler.length,
      hatali,
    };
  }
  return out;
}

/** Goruntu yeni bicimde ve alinmis mi: BOOT satiri olmayan (eski bicim / bos) goruntuyle duzeltme YAPILMAZ. */
const goruntuTamam = (r) => !!(r && r.goruntu_ok && Array.isArray(r.goruntu) && r.goruntu.some((l) => String(l).startsWith('BOOT|')));

/** "once" sonucundan "sonra" job'inin rc_once girdisi: yalniz goruntusu ALINAN (yeni bicim) sunucular. */
function onceGirdisi(onceSunucular) {
  const rc = {};
  for (const [h, r] of Object.entries(onceSunucular || {})) {
    if (goruntuTamam(r)) rc[h] = r.goruntu;
  }
  return rc;
}

function satir(r, ayrinti) {
  const o = {
    id: r.id,
    hosts: jsonOku(r.hosts_json) || [],
    not: r.notes || '',
    durum: r.status,
    olusturan: r.created_by,
    olusturuldu: r.created_at,
    once: { jobId: r.once_job_id, serverId: r.once_server_id, at: r.once_at },
    sonra: { jobId: r.sonra_job_id, serverId: r.sonra_server_id, at: r.sonra_at },
    ozet: jsonOku(r.ozet_json),
    // CANLI (2026-10-09, kullanici: "Suruyor kelimesi isin gercekten calisip calismadigini anlamaya
    // yetmiyor"): kosan fazda AWX'in ANLIK is durumu (pending/waiting/running) ve fazin baslangici.
    // Kosarken kayda baska yazim olmadigi icin updated_at = fazin baslatildigi an.
    awxDurum: r.awx_durum || null,
    fazBasladi: /_kosuyor$/.test(String(r.status || '')) ? r.updated_at : null,
  };
  if (ayrinti) {
    o.once.sonuc = jsonOku(r.once_json);
    o.sonra.sonuc = jsonOku(r.sonra_json);
  }
  return o;
}

async function kayit(id) {
  const { rows } = await db().query(`SELECT * FROM reboot_checks WHERE id = $1`, [id]);
  return rows?.[0] || null;
}

/** Kosan faz bittiyse AWX sonucunu okuyup kayda yazar (okunamazsa hicbir sey yazmaz). */
async function ilerlet(r) {
  const faz = r.status === 'once_kosuyor' ? 'once' : r.status === 'sonra_kosuyor' ? 'sonra' : null;
  if (!faz) return r;
  const jobId = faz === 'once' ? r.once_job_id : r.sonra_job_id;
  const serverId = faz === 'once' ? r.once_server_id : r.sonra_server_id;
  if (!jobId) return r;
  const runner = require('../ansible/runner.cjs');
  const info = await runner.getJobStatusOnServer(Number(serverId) || 0, Number(jobId));
  if (!TERMINAL.has(info.status)) return { ...r, awx_durum: String(info.status || 'bilinmiyor') };
  const { extractStatsKey } = require('../opsx/index.cjs');
  const sonuc = extractStatsKey(info.artifacts, 'reboot_check_result') || null;
  const hedefler = jsonOku(r.hosts_json) || [];
  if (faz === 'once') {
    const sunucular = sonuc?.sunucular || {};
    const alinan = hedefler.filter((h) => goruntuTamam(sunucular[h]));
    const durum = alinan.length ? 'once_hazir' : 'once_hata';
    const ozet = { once: { alinan: alinan.length, toplam: hedefler.length, job: info.status } };
    await db().query(
      `UPDATE reboot_checks SET status = $1, once_json = $2, once_at = GETUTCDATE(), ozet_json = $3, updated_at = GETUTCDATE() WHERE id = $4 AND status = 'once_kosuyor'`,
      [durum, JSON.stringify(sonuc || { job: info.status }).slice(0, 4000000), JSON.stringify(ozet), r.id],
    );
  } else {
    const deg = sonraDegerlendir(sonuc?.sunucular || {}, jsonOku(r.sonra_hedef_json) || hedefler);
    const d = Object.values(deg);
    const sorunsuz = d.filter((x) => x.durum === 'sorunsuz').length;
    const durum = d.length && sorunsuz === d.length ? 'tamam' : sonuc ? 'sorunlu' : 'sonra_hata';
    const ozet = {
      ...(jsonOku(r.ozet_json) || {}),
      sonra: { sorunsuz, toplam: d.length, job: info.status, sunucu: deg },
    };
    await db().query(
      `UPDATE reboot_checks SET status = $1, sonra_json = $2, sonra_at = GETUTCDATE(), ozet_json = $3, updated_at = GETUTCDATE() WHERE id = $4 AND status = 'sonra_kosuyor'`,
      [durum, JSON.stringify(sonuc || { job: info.status }).slice(0, 4000000), JSON.stringify(ozet), r.id],
    );
  }
  return kayit(r.id);
}

function mount(router, { launch, HOST_RE }) {
  router.get('/reboot-check', async (req, res) => {
    try {
      const { rows } = await db().query(
        `SELECT TOP 50 id, hosts_json, notes, status, created_by, created_at, once_job_id, once_server_id, once_at,
                sonra_job_id, sonra_server_id, sonra_at, ozet_json FROM reboot_checks ORDER BY id DESC`,
      );
      res.json({ ok: true, kayitlar: (rows || []).map((r) => satir(r, false)) });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // DURUM RAPORU (2026-10-09): ekip arkadasinin patch-aggregate-report.py tasarimi, Portal verisiyle
  // (reboot-rapor.cjs). Yeni sekmede acilir; e-postaya yapistirilabilir (Outlook uyumlu tablo yerlesimi).
  router.get('/reboot-check/:id/rapor', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).type('text').send('Geçersiz kayıt.');
    try {
      const r = await kayit(id);
      if (!r) return res.status(404).type('text').send('Kayıt yok.');
      res.set('Cache-Control', 'no-store').type('html').send(require('./reboot-rapor.cjs').raporHtml(satir(r, true)));
    } catch (err) {
      res.status(500).type('text').send(err.message);
    }
  });

  router.get('/reboot-check/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: 'Geçersiz kayıt.' });
    try {
      let r = await kayit(id);
      if (!r) return res.status(404).json({ ok: false, message: 'Kayıt yok.' });
      try {
        r = await ilerlet(r);
      } catch (e) {
        // OKUNAMADI != BASARISIZ: AWX okunamazsa kayit degismez, bir sonraki okumada tekrar denenir.
        console.warn('[RebootCheck] is durumu okunamadi:', e.message);
        r = { ...r, awx_durum: 'okunamadi' };
      }
      res.json({ ok: true, kayit: satir(r, true) });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // REBOOT ONCESI: secilen sunucularin anlik goruntusu alinir ve Portal'da saklanir.
  router.post('/reboot-check', async (req, res) => {
    const hosts = [
      ...new Set(
        (Array.isArray(req.body?.hosts) ? req.body.hosts : [])
          .map((h) => String(h || '').trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    if (!hosts.length || hosts.length > MAX_HOST || hosts.some((h) => !HOST_RE.test(h)))
      return res.status(400).json({ ok: false, message: `1-${MAX_HOST} arası geçerli sunucu adı gerekli.` });
    const not = String(req.body?.not || '').slice(0, 500);
    try {
      const j = await launch(
        req,
        REGISTRY_KEY,
        `Reboot kontrolü: ÖNCE ${hosts.length === 1 ? hosts[0] : hosts.length + ' sunucu'}`,
        { rc_faz: 'once', target_hosts: hosts.join(',') },
        { op: 'reboot_check_once', hosts },
      );
      const { rows } = await db().query(
        `INSERT INTO reboot_checks (hosts_json, notes, status, created_by, once_job_id, once_server_id)
         VALUES ($1, $2, 'once_kosuyor', $3, $4, $5) RETURNING id`,
        [JSON.stringify(hosts), not || null, req.session?.user?.username || 'unknown', j.jobId, j.awxServerId],
      );
      res.json({ ok: true, id: rows?.[0]?.id ?? null, ...j });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // REBOOT SONRASI: once goruntusuyle karsilastir + otomatik duzelt. Onay zorunlu (JVM/web baslatir
  // ve DURDURUR). Yalniz "once" goruntusu ALINAN sunucular hedeflenir.
  router.post('/reboot-check/:id/sonra', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: 'Geçersiz kayıt.' });
    if (req.body?.onay !== true)
      return res.status(400).json({ ok: false, message: 'Reboot sonrası düzeltme JVM/web başlatır ve durdurur; onay gerekli.' });
    try {
      const r = await kayit(id);
      if (!r) return res.status(404).json({ ok: false, message: 'Kayıt yok.' });
      if (!['once_hazir', 'tamam', 'sorunlu', 'sonra_hata'].includes(r.status))
        return res.status(409).json({ ok: false, message: `Kayıt bu durumda reboot sonrası kontrole uygun değil (${r.status}).` });
      const once = jsonOku(r.once_json);
      const rcOnce = onceGirdisi(once?.sunucular);
      const hedef = Object.keys(rcOnce);
      if (!hedef.length)
        return res.status(409).json({ ok: false, message: 'Hiçbir sunucunun (yeni biçimde) "önce" görüntüsü yok; reboot sonrası kontrol yapılamaz. Reboot öncesi görüntüyü yeniden alın.' });
      const j = await launch(
        req,
        REGISTRY_KEY,
        `Reboot kontrolü: SONRA ${hedef.length === 1 ? hedef[0] : hedef.length + ' sunucu'}`,
        { rc_faz: 'sonra', target_hosts: hedef.join(','), rc_once: rcOnce },
        { op: 'reboot_check_sonra', id, hosts: hedef },
      );
      await db().query(
        `UPDATE reboot_checks SET status = 'sonra_kosuyor', sonra_job_id = $1, sonra_server_id = $2, sonra_hedef_json = $3,
                sonra_json = NULL, updated_at = GETUTCDATE() WHERE id = $4`,
        [j.jobId, j.awxServerId, JSON.stringify(hedef), id],
      );
      const disarida = (jsonOku(r.hosts_json) || []).filter((h) => !hedef.includes(h));
      res.json({ ok: true, ...j, hedef, disarida });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });
}

module.exports = { mount, sonraDegerlendir, onceGirdisi, REGISTRY_KEY };
