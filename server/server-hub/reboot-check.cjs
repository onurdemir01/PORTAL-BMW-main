// server/server-hub/reboot-check.cjs — Server Hub > Reboot Kontrolu (2026-10-08).
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
//
// KONTROL GEREKLI (2026-11-14, ilk gercek kosu: her sey "dokunulmadi" yazdi ve sunucular "sorunsuz"
// cikti). Fark kalmasa bile iki durumda sunucu SORUNSUZ SAYILMAZ, durum 'kontrol' olur:
//   (a) "once" goruntusunde hic izlenen satir (URUN/JVM) yok: betik o sunucuda hicbir seyi acip
//       kapatmaz, "kalan" bos cikar - bu bir dogrulama degil, sessiz gecis olurdu;
//   (b) once calismayan bir urun ya da (urunu once calismayan) JVM simdi CALISIYOR: kural geregi
//       dokunulmadi ama beklenen durum mu, insan bakmali (once <-> son goruntuden; rapor NEW_URUN ile ayni);
//   (c) once goruntusu eski betik surumuyle alinmis: JBoss karsilastirilamadi (BILGI|ESKI).
// Kalan: betigin son_fark'i ile Portal'in ayni kuralla kendi hesabinin (portalKalan) buyugu.
// Kayit durumu: hic 'sorunlu' / 'olculemedi' yok ve en az bir 'kontrol' varsa 'kontrol'.
'use strict';

const REGISTRY_KEY = 'reboot_check';
// Varsayilan; Admin Server Hub > Kurallar & Limitler'den degistirir (ayarlar.cjs 'limit:reboot').
const MAX_HOST = 500;
const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
// "sonra" (yeniden) kosturulabilen kayit durumlari; ekran (RebootKontroluTab) ayni listeyi kullanir.
const SONRA_ACIK = ['once_hazir', 'tamam', 'sorunlu', 'sonra_hata', 'kontrol'];

const db = () => require('../db/index.cjs');
const jsonOku = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

const dizi = (x) => (Array.isArray(x) ? x : []).map((l) => String(l));
const izlenenVar = (satirlar) => dizi(satirlar).some((l) => /^(URUN|JVM)\|/.test(l));
const bootVar = (satirlar) => dizi(satirlar).some((l) => l.startsWith('BOOT|'));
const surumVar = (satirlar) => dizi(satirlar).some((l) => l.startsWith('SURUM|'));
const JB_SATIR = /^(URUN|JVM)\|JBOSS[78]\|/;

/**
 * Eski surum once goruntusu (SURUM satiri yok, JBoss satiri var) yeni surum goruntuyle JBoss bazinda
 * KARSILASTIRILAMAZ: JBoss nesil kurali 2026-11-14'te degisti (reboot_goruntu.sh). reboot_duzelt.sh o durumda
 * JBoss satirlarini iki taraftan da cikarir ve BILGI|ESKI yazar; Portal, rapor ve ekran ayni kurali kullanir.
 */
function nesilKarsilastirilamaz(once, diger) {
  return !surumVar(once) && dizi(once).some((l) => JB_SATIR.test(l)) && surumVar(diger);
}

/** Goruntu satirlari -> { urun: Set, jvm: Set('URUN|ad') }; haricJb: JBoss satirlari sayilmaz. */
function kume(satirlar, haricJb = false) {
  const g = { urun: new Set(), jvm: new Set() };
  for (const l of dizi(satirlar)) {
    if (haricJb && JB_SATIR.test(l)) continue;
    const p = l.split('|');
    if (p[0] === 'URUN' && p[1]) g.urun.add(p[1]);
    else if (p[0] === 'JVM' && p[1] && p[2]) g.jvm.add(`${p[1]}|${p[2]}`);
  }
  return g;
}
/** Reboot oncesi kume (reboot_duzelt.sh once_norm): URUN satirlari + JVM'i gorulen urunler. */
function onceKume(satirlar, haricJb = false) {
  const g = kume(satirlar, haricJb);
  for (const k of g.jvm) g.urun.add(k.split('|')[0]);
  return g;
}

/**
 * Portal'in KENDI kalan hesabi (reboot_duzelt.sh kalan ile ayni kural, saf): once calisan her urun/JVM son
 * goruntude yoksa DOWN; once calisan urunun once olmayan JVM'i son goruntude varsa NEW. Betigin son_fark'i
 * kaydin alindigi gunun kuraliyla hesaplanir; eski kayit yeni kuralla bu fonksiyonla yeniden degerlendirilir.
 */
function portalKalan(once, son) {
  const haric = nesilKarsilastirilamaz(once, son);
  const o = onceKume(once, haric);
  const s = kume(son, haric);
  const out = [];
  for (const u of [...o.urun].sort()) if (!s.urun.has(u)) out.push(`FARK|DOWN|URUN|${u}||`);
  for (const k of [...o.jvm].sort()) if (!s.jvm.has(k)) out.push(`FARK|DOWN|JVM|${k}|`);
  for (const k of [...s.jvm].sort()) if (!o.jvm.has(k) && o.urun.has(k.split('|')[0])) out.push(`FARK|NEW|JVM|${k}|`);
  return out;
}

/**
 * Bir sunucuyu (fark kalmasa da) 'kontrol' yapan nedenler (saf). once: o sunucunun "once" satirlari.
 * "Once calismayip simdi calisan, kurala gore dokunulmayan" oge DOGRUDAN once <-> son goruntu karsilastirmasiyla
 * bulunur (rapor NEW_URUN kuraliyla ayni); plan BILGI satirlari yalniz plandan SONRA kalkan ogeyi kacirirdi.
 * once verilmezse (eski cagiran) plandaki BILGI satirlarina bakilir.
 */
function kontrolNedenleri(once, r) {
  const neden = [];
  const plan = dizi(r?.plan);
  const onceVar = Array.isArray(once) && bootVar(once);
  const onceBos = (onceVar && !izlenenVar(once)) || plan.some((l) => l.startsWith('BILGI|BOS|'));
  if (onceBos)
    neden.push('Reboot öncesi görüntüde izlenen ürün/JVM yoktu; bu sunucuda hiçbir şey açılıp kapatılmadı (uygulamalar zaten kapalıyken mi alındı?).');
  const eski = plan.some((l) => l.startsWith('BILGI|ESKI|')) || (onceVar && nesilKarsilastirilamaz(once, r?.son_goruntu));
  if (eski)
    neden.push('Reboot öncesi görüntü eski betik sürümüyle alınmış; JBoss nesil kuralı değiştiği için JBoss ürün/JVM\'leri karşılaştırılmadı ve dokunulmadı — elle kontrol edin.');
  const calisan = [];
  if (onceVar) {
    const haric = nesilKarsilastirilamaz(once, r?.son_goruntu);
    const o = onceKume(once, haric);
    const s = kume(r?.son_goruntu, haric);
    for (const u of [...s.urun].sort()) if (!o.urun.has(u)) calisan.push(u);
    for (const k of [...s.jvm].sort()) {
      const u = k.split('|')[0];
      if (!o.jvm.has(k) && !o.urun.has(u)) calisan.push(k.replace('|', '/'));
    }
  } else {
    const son = new Set(dizi(r?.son_goruntu).map((l) => l.split('|').slice(0, 3).join('|')));
    for (const l of plan) {
      if (!l.startsWith('BILGI|') || !/dokunulmadi/.test(l)) continue;
      const p = l.split('|');
      const u = p[2] || '';
      const ad = p[3] || '';
      if (!u) continue;
      const anahtar = ad ? `JVM|${u}|${ad}` : `URUN|${u}|`;
      const etiket = ad ? `${u}/${ad}` : u;
      if (son.has(anahtar) && !calisan.includes(etiket)) calisan.push(etiket);
    }
  }
  if (calisan.length)
    neden.push(`Reboot öncesi çalışmayan ${calisan.length} öğe şimdi çalışıyor ve kurala göre dokunulmadı: ${calisan.slice(0, 10).join(', ')}${calisan.length > 10 ? ' …' : ''} — beklenen durum mu kontrol edin.`);
  return neden;
}

/**
 * "sonra" sonucundan sunucu basina degerlendirme (saf; test edilir). onceSat: { SUNUCU: [once satirlari] }
 * (rc_once ile ayni bicim); verilmezse once-bos kontrolu yalniz plandaki BILGI|BOS satirina bakar ve Portal'in
 * kendi kalan hesabi yapilmaz. Kalan = betigin son_fark'i ile Portal'in kalan'inin BUYUGU (eski kayit yeni
 * kuralla). Nedenler fark kalsa da yazilir (ekran gosterir); durum yalniz fark yoksa 'kontrol' olur.
 */
function sonraDegerlendir(sunucular, hedefler, onceSat = null) {
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
    const islemler = dizi(r.islemler).filter((l) => l.startsWith('SONUC|'));
    const hatali = islemler.filter((l) => l.split('|')[4] === 'FAIL').length;
    const kalanBetik = dizi(r.son_fark).filter((l) => l.startsWith('FARK|'));
    if (!r.son_olculdu) {
      out[h] = { durum: 'olculemedi', sebep: 'son goruntu alinamadi', islem: islemler.length, hatali };
      continue;
    }
    const once = onceSat?.[h];
    const kalanPortal = Array.isArray(once) && bootVar(once) ? portalKalan(once, r.son_goruntu) : [];
    const kalan = Math.max(kalanBetik.length, kalanPortal.length);
    const neden = kontrolNedenleri(once, r);
    const durum = kalan ? 'sorunlu' : neden.length ? 'kontrol' : 'sorunsuz';
    out[h] = {
      durum,
      kalan,
      islem: islemler.length,
      hatali,
      ...(neden.length ? { neden } : {}),
      ...(durum === 'kontrol' ? { sebep: neden.join(' ') } : {}),
      ...(r.durulma ? { durulma: String(r.durulma) } : {}),
    };
  }
  return out;
}

/** Sunucu degerlendirmelerinden kayit durumu (saf): hepsi sorunsuz -> tamam; sorunsuz + kontrol -> kontrol. */
function kayitDurumu(d, sonucVar) {
  const sorunsuz = d.filter((x) => x.durum === 'sorunsuz').length;
  const kontrol = d.filter((x) => x.durum === 'kontrol').length;
  if (d.length && sorunsuz === d.length) return 'tamam';
  if (d.length && kontrol > 0 && sorunsuz + kontrol === d.length) return 'kontrol';
  return sonucVar ? 'sorunlu' : 'sonra_hata';
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

/** Kayit + "sonra" sonucu -> { durum, ozet } (saf). Sonuclanmis kaydi okurken de yeni kuralla yeniden hesaplar. */
function sonraOzeti(r, sonuc, job) {
  const hedefler = jsonOku(r.hosts_json) || [];
  const onceSat = onceGirdisi(jsonOku(r.once_json)?.sunucular);
  const deg = sonraDegerlendir(sonuc?.sunucular || {}, jsonOku(r.sonra_hedef_json) || hedefler, onceSat);
  const d = Object.values(deg);
  const durum = kayitDurumu(d, !!sonuc);
  const sorunsuz = d.filter((x) => x.durum === 'sorunsuz').length;
  const kontrol = d.filter((x) => x.durum === 'kontrol').length;
  const ozet = { ...(jsonOku(r.ozet_json) || {}), sonra: { sorunsuz, kontrol, toplam: d.length, job, sunucu: deg } };
  return { durum, ozet };
}

// ESKI KAYIT YENI KURALLA (2026-11-14, inceleme): ekrandaki tablo ve rapor her acilista yeni kuralla hesaplanir;
// saklanmis durum (ozet_json / status) ise kaydin sonuclandigi gunun kuralindaydi -> ayni kayitta rozet "Sorunsuz",
// tablo kirmizi "hala KAPALI" diyebiliyordu. Sonuclanmis kayit ayrintisi acilirken durum yeniden hesaplanir; degistiyse
// kayda yazilir (liste rozeti de duzelir). Yalniz sonuclanmis durumlar; kosan faz ilerlet'te.
const SONUCLANMIS = new Set(['tamam', 'sorunlu', 'kontrol']);
async function yenidenDegerlendir(r) {
  if (!r || !SONUCLANMIS.has(r.status)) return r;
  const sonuc = jsonOku(r.sonra_json);
  if (!sonuc?.sunucular) return r;
  const eski = jsonOku(r.ozet_json) || {};
  const { durum, ozet } = sonraOzeti(r, sonuc, eski.sonra?.job || sonuc.job || '');
  if (durum === r.status && JSON.stringify(ozet.sonra) === JSON.stringify(eski.sonra)) return r;
  const ozetJson = JSON.stringify(ozet);
  await db().query(
    `UPDATE reboot_checks SET status = $1, ozet_json = $2 WHERE id = $3 AND status = $4`,
    [durum, ozetJson, r.id, r.status],
  );
  return { ...r, status: durum, ozet_json: ozetJson };
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
    // ONCE BOS: goruntu alindi ama izlenen urun/JVM yok -> uyari (kayit yine once_hazir olabilir).
    const onceBos = alinan.filter((h) => !izlenenVar(sunucular[h].goruntu));
    const durum = alinan.length ? 'once_hazir' : 'once_hata';
    const ozet = { once: { alinan: alinan.length, toplam: hedefler.length, job: info.status, once_bos: onceBos } };
    await db().query(
      `UPDATE reboot_checks SET status = $1, once_json = $2, once_at = GETUTCDATE(), ozet_json = $3, updated_at = GETUTCDATE() WHERE id = $4 AND status = 'once_kosuyor'`,
      [durum, JSON.stringify(sonuc || { job: info.status }).slice(0, 4000000), JSON.stringify(ozet), r.id],
    );
  } else {
    const { durum, ozet } = sonraOzeti(r, sonuc, info.status);
    await db().query(
      `UPDATE reboot_checks SET status = $1, sonra_json = $2, sonra_at = GETUTCDATE(), ozet_json = $3, updated_at = GETUTCDATE() WHERE id = $4 AND status = 'sonra_kosuyor'`,
      [durum, JSON.stringify(sonuc || { job: info.status }).slice(0, 4000000), JSON.stringify(ozet), r.id],
    );
  }
  return kayit(r.id);
}

function mount(router, { launch, HOST_RE, limit }) {
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
      let r = await kayit(id);
      if (!r) return res.status(404).type('text').send('Kayıt yok.');
      try {
        r = await yenidenDegerlendir(r);
      } catch (e) {
        console.warn('[RebootCheck] kayit yeniden degerlendirilemedi:', e.message);
      }
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
      try {
        r = await yenidenDegerlendir(r);
      } catch (e) {
        console.warn('[RebootCheck] kayit yeniden degerlendirilemedi:', e.message);
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
    const enCok = limit ? await limit('reboot') : MAX_HOST;
    if (!hosts.length || hosts.length > enCok || hosts.some((h) => !HOST_RE.test(h)))
      return res.status(400).json({
        ok: false,
        message: `1-${enCok} arası geçerli sunucu adı gerekli (tek seferde en fazla ${enCok} sunucu; Admin Server Hub › Kurallar & Limitler'den artırabilir).`,
      });
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
      if (!SONRA_ACIK.includes(r.status))
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

module.exports = {
  mount, sonraDegerlendir, onceGirdisi, kontrolNedenleri, kayitDurumu, portalKalan, nesilKarsilastirilamaz, onceKume, kume,
  sonraOzeti, yenidenDegerlendir, SONRA_ACIK, REGISTRY_KEY,
};
