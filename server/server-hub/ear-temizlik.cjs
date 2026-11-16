// server/server-hub/ear-temizlik.cjs - Server Hub > EAR Temizligi (2026-11-16).
//
// Kullanici: "/vhosting/GBSTPCOMPLIANCE.ear: EAR icinde WAR yok -> bu uyarilari rahatlikla temizleyebilmek icin
// bana bir sayfa hazirlamani istiyorum. ancak on kontrolde gercekten bu dizine bir ls -ltr ile bakilmali ve benim
// tarafimdan silinmeden once teyit edilmeli".
//
// GUVENLIK MODELI
//   1. Aday yalniz TAZE degerlendirmedeki EAR_WAR_YOK bulgusundan gelir. Istemcinin gonderdigi {host, kok, ad}
//      bulguyla BIREBIR eslesmezse is acilmaz (yol istemciden alinmaz, bulgudan dogrulanir).
//   2. Engel: ayni EAR Uygulama Envanteri'nde domain.xml deployment'ina bagli (xml.durum VAR) ise on kontrol de yok.
//   3. On kontrol = AWX server_hub_fix, action ear_cleanup, plan_only=true: SALT OKUNUR (ls -ltr + kapilar +
//      parmak izi). Sonuc set_stats server_hub_fix_result.ear'dan okunur, kayit PLAN_HAZIR olur.
//   4. Kullanici ls -ltr ciktisini gorur, EAR adini birebir yazar (onayMetni) ve gordugu plan isinin numarasini
//      gonderir (planJobId). Plan 30 dk gecerlidir (plan_bitis_at + 30 dk); sonra PLAN_ESKIDI (tembel).
//   5. Onay aninda bulgu TAZE degerlendirmede yeniden aranir; SILINIYOR'a gecis launch'tan ONCE CAS ile yapilir
//      (cift tik / iki sekme tek is acar). extra_vars ear_fp = plandaki parmak izi: betik yeniden hesaplar,
//      degistiyse HICBIR SEY silmez. Once tar.gz yedek, sonra rm.
//   6. Launch kesin reddedilirse (4xx / sablon yok) kayit PLAN_HAZIR'a doner; sonucu belirsizse (zaman asimi /
//      5xx) BELIRSIZ olur ve TEKRAR DENENMEZ (is acilmis olabilir).
//   7. Poller YOK: GET uclari suren kayitlari AWX'ten okuyup gecisi yazar. Her gecis CAS (WHERE durum = eski).
//   8. SILINDI'de tek sunucu Uygulama Envanteri taramasi (OZET, SECILI) baslar; uyari o tarama bitince kalkar.
//      Baska kosu suruyorsa not yazilir (uyari bir sonraki taramada kalkar).
//   Yalniz Admin (server-hub router'i). PROD dahil; PROD satiri ekranda isaretlenir, ek onay yok (kullanici karari).
'use strict';

const REGISTRY_KEY = 'server_hub_fix';
const TEMPLATE_ADI = 'server_hub_fix';
const ACTION = 'ear_cleanup';
const PLAN_GECERLILIK_DK = 30;
const SON_KAYIT = 50;
// Launch'tan sonra is numarasi yazilamadan kalan kayit (surec coktu) bu sureden sonra kapatilir.
const NUMARASIZ_DK = 10;
// AWX isi bu surede bitmezse kayit kapatilir (AWX'ten kontrol edilmeli).
const IS_ZAMAN_ASIMI_SAAT = 3;
const AKTIF = ['PLANLANIYOR', 'PLAN_HAZIR', 'SILINIYOR'];
const SUREN = ['PLANLANIYOR', 'SILINIYOR'];
const IS_TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const KOKLER = { '/vhosting': 7, '/vhosting8': 8 };
const AD_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.ear$/;
const FP_RE = /^[0-9a-f]{64}$/;
const HOST_RE_VARSAYILAN = /^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/;
const ENGEL_XML = "domain.xml'de deployment tanımlı — JBoss'a bağlı";
const ENVANTER_SURUYOR =
  'Başka Uygulama Envanteri koşusu sürüyor; uyarı bir sonraki taramada kalkar';
// Betik (server_hub_fix.sh ear_ls): dizinde 1 satir 'ls -ld P' + en cok 300 satir 'ls -ltr P' + 1 tasma notu
// ('... (N satir daha)') = en cok 302. Fazlasi gelirse son satir Portal'in kendi kesinti notu olur (sessiz kesinti yok).
const LS_MAX = 302;
// ls ilk satiri 'ls -ld P' (dizin) ya da 'ls -l P' (duzenli dosya): tur + 9 izin karakteri ve satir P ile biter.
const LS_BASLIK_RE = /^[-d][-rwxsStT]{9}[.+@]?\s/;
const INFO_MAX = 50;
const SATIR_MAX = 1000;

const SIMDI = Symbol('SYSUTCDATETIME');

let _d = null;

const M = (v, n) => String(v == null ? '' : v).slice(0, n);
const hata = (status, message, code) => Object.assign(new Error(message), { status, code });
const IN = (l) => l.map((x) => `'${x}'`).join(', ');

/**
 * Bagimliliklar (index.cjs mount'u verir; testler sahtelerini verir):
 *   launch(req, key, templateName, extraVars, detail), getAssessment(fresh), audit(req, detail), HOST_RE,
 *   istege bagli: db ({query}), isDurumu(serverId, jobId), envanterKosu(opts).
 */
function kur(deps) {
  _d = deps || null;
}

const db = () => (_d && _d.db) || require('../db/index.cjs');
const hostRe = () => (_d && _d.HOST_RE) || HOST_RE_VARSAYILAN;

async function isDurumu(serverId, jobId) {
  try {
    if (_d && typeof _d.isDurumu === 'function') return await _d.isDurumu(serverId, jobId);
    return await require('../ansible/runner.cjs').getJobStatusOnServer(serverId, jobId);
  } catch (e) {
    console.warn(`[EarTemizlik] is #${jobId} okunamadi:`, e && e.message);
    return null;
  }
}

function envanterKosu(opts) {
  if (_d && typeof _d.envanterKosu === 'function') return _d.envanterKosu(opts);
  return require('./ear-envanter-poller.cjs').kosuOlustur(opts);
}

function sonucOku(st) {
  const { extractStatsKey } = require('../opsx/index.cjs');
  return extractStatsKey(st && st.artifacts, 'server_hub_fix_result') || null;
}

function denetim(req, detail) {
  try {
    if (_d && _d.audit) _d.audit(req, detail);
  } catch {
    // denetim kaydi yazilamadi: islem yine tamam
  }
}

/** Yurutucunun AWX'e ve denetime "kim istedi" diye verecegi sozde istek (GET'te gecisi yazan onaylayan). */
function sozdeIstek(kim) {
  const ad = M(kim, 128) || 'unknown';
  return {
    session: { user: { username: ad, displayName: ad, role: 'Admin' } },
    sessionID: null,
    ip: null,
  };
}

const kullanici = (req) => M(req.session?.user?.username || 'unknown', 128);

// ── ADAYLAR ──────────────────────────────────────────────────────────────────────────────────────

/** Production / ortami bilinmeyen sunucu prod sayilir (fail-closed). */
const prodMu = (h) => !h || h.envGroup !== 'Non-Production';

/** Bulgu {kok, ad, jboss} temizlige uygun mu; degilse nedeni. */
function bicimEngeli(kok, ad, jboss) {
  if (!Object.hasOwn(KOKLER, kok))
    return `Kök ${kok} temizlik kapsamında değil (yalnız /vhosting, /vhosting8)`;
  if (KOKLER[kok] !== jboss) return `Kök ${kok} ile JBoss ${jboss} uyuşmuyor`;
  if (!AD_RE.test(String(ad || ''))) return 'EAR adı temizlik için izin verilen biçimde değil';
  return null;
}

/** Ayni kok/ad Uygulama Envanteri'nde domain.xml deployment'ina bagliysa engel metni. */
function xmlEngeli(h, kok, ad) {
  const ul = (h.ear && Array.isArray(h.ear.uygulamalar) && h.ear.uygulamalar) || [];
  return ul.some((u) => u && u.kok === kok && u.ad === ad && u.xml && u.xml.durum === 'VAR')
    ? ENGEL_XML
    : null;
}

/** Taze degerlendirmeden EAR_WAR_YOK adaylari (kayit alani bos). */
function adaylariTuret(a) {
  const out = [];
  for (const h of (a && a.hosts) || []) {
    for (const f of h.findings || []) {
      if (!f || f.code !== 'EAR_WAR_YOK' || !f.ear) continue;
      const kok = String(f.ear.kok || '');
      const ad = String(f.ear.ad || '');
      const jboss = Number(f.ear.jboss);
      out.push({
        host: h.host,
        ortam: h.env || null,
        prod: prodMu(h),
        kok,
        ad,
        jboss,
        envanterTarihi: (h.ear && h.ear.taranma) || null,
        engel: bicimEngeli(kok, ad, jboss) || xmlEngeli(h, kok, ad),
        kayit: null,
      });
    }
  }
  return out;
}

/** Istemcinin {host, kok, ad} uclusu taze bulguyla birebir eslesen aday; yoksa null. */
function adayBul(a, host, kok, ad) {
  return adaylariTuret(a).find((x) => x.host === host && x.kok === kok && x.ad === ad) || null;
}

// ── KAYIT ────────────────────────────────────────────────────────────────────────────────────────

function planOku(json) {
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    if (!p || typeof p !== 'object') return null;
    return {
      fp: typeof p.fp === 'string' ? p.fp : '',
      ls: Array.isArray(p.ls) ? p.ls.map(String) : [],
      info: Array.isArray(p.info) ? p.info.filter((x) => x && typeof x === 'object') : [],
    };
  } catch {
    return null;
  }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

function kalanSn(r) {
  if (r.durum !== 'PLAN_HAZIR' || !r.plan_bitis_at) return null;
  const son = new Date(r.plan_bitis_at).getTime() + PLAN_GECERLILIK_DK * 60 * 1000;
  return Math.max(0, Math.round((son - Date.now()) / 1000));
}

function kayitSatiri(r) {
  if (!r) return null;
  return {
    id: r.id,
    host: r.host,
    kok: r.kok,
    ad: r.ad,
    jboss: Number(r.jboss),
    prod: r.prod === true || r.prod === 1,
    durum: r.durum,
    olusturan: r.olusturan,
    onaylayan: r.onaylayan || null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    planBitisAt: iso(r.plan_bitis_at),
    kalanSn: kalanSn(r),
    planJobId: r.plan_job_id == null ? null : Number(r.plan_job_id),
    silJobId: r.sil_job_id == null ? null : Number(r.sil_job_id),
    plan: planOku(r.plan_json),
    sonuc: r.sonuc || null,
    yedek: r.yedek || null,
    envanter: {
      kosuId: r.envanter_kosu_id == null ? null : Number(r.envanter_kosu_id),
      not: r.envanter_notu || null,
    },
  };
}

async function kayitOku(id) {
  const { rows } = await db().query(`SELECT * FROM server_hub_ear_temizlik WHERE id = $1`, [id]);
  return rows && rows[0] ? rows[0] : null;
}

/**
 * CAS gecisi: yalniz durum eskiyse yazar. alanlar: { kolon: deger } (deger parametre olur).
 * Donus: yazildi mi (rowCount === 1).
 */
async function gecis(id, eski, yeni, alanlar = {}) {
  const set = ['durum = $3', 'updated_at = SYSUTCDATETIME()'];
  const p = [id, eski, yeni];
  for (const [k, v] of Object.entries(alanlar)) {
    // SIMDI: DB saati (plan_bitis_at eskime kosulu da DB saatiyle; iki saat karismaz).
    if (v === SIMDI) set.push(`${k} = SYSUTCDATETIME()`);
    else {
      p.push(v);
      set.push(`${k} = $${p.length}`);
    }
  }
  const r = await db().query(
    `UPDATE server_hub_ear_temizlik SET ${set.join(', ')} WHERE id = $1 AND durum = $2`,
    p,
  );
  return r && r.rowCount === 1;
}

/** Tembel eskime: plan_bitis_at + 30 dk gecmis PLAN_HAZIR -> PLAN_ESKIDI. */
async function eskit() {
  await db().query(
    `UPDATE server_hub_ear_temizlik SET durum = 'PLAN_ESKIDI', updated_at = SYSUTCDATETIME() WHERE durum = 'PLAN_HAZIR' AND plan_bitis_at < DATEADD(minute, -${PLAN_GECERLILIK_DK}, SYSUTCDATETIME())`,
  );
}

async function aktifKayit(host, kok, ad) {
  const { rows } = await db().query(
    `SELECT TOP 1 * FROM server_hub_ear_temizlik WHERE host = $1 AND kok = $2 AND ad = $3 AND durum IN (${IN(AKTIF)}) ORDER BY id DESC`,
    [host, kok, ad],
  );
  return rows && rows[0] ? rows[0] : null;
}

// ── AWX SONUCLARI ────────────────────────────────────────────────────────────────────────────────

/** set_stats sonucu: { sonuc, mesaj, ear } ya da null (yok / baska eylem). */
function earSonucu(result) {
  if (!result || typeof result !== 'object' || result.action !== ACTION) return null;
  const p = String(result.line || '').split('\t');
  if (p[0] !== 'RESULT' || p[1] !== ACTION) return null;
  const ear = result.ear && typeof result.ear === 'object' ? result.ear : {};
  return { sonuc: p[2] || '', mesaj: p.slice(3).join(' '), ear };
}

/** Kullanicinin teyit edecegi ls ciktisi gecerli mi: ilk satir P'nin 'ls -ld' / 'ls -l' satiri olmali. */
function lsBasligiGecerli(r, ilk) {
  const s = String(ilk == null ? '' : ilk);
  return LS_BASLIK_RE.test(s) && s.endsWith(` ${r.kok}/${r.ad}`);
}

/** Plan kipinde ekranda teyit edilecek ls ciktisi eksikse nedeni; tamsa null. */
function lsEksigi(r, ear) {
  if (!Array.isArray(ear.ls))
    return `ls -ltr çıktısı gelmedi (set_stats ear.ls liste değil: ${typeof ear.ls}) — playbook güncel mi?`;
  if (!ear.ls.length) return 'ls -ltr çıktısı gelmedi — teyit edilemez';
  if (!lsBasligiGecerli(r, ear.ls[0]))
    return `ls çıktısının ilk satırı ${r.kok}/${r.ad} için ls -ld / ls -l satırı değil — teyit edilemez`;
  return null;
}

function lsKes(ls) {
  const l = (Array.isArray(ls) ? ls : []).map((x) => M(x, SATIR_MAX));
  if (l.length <= LS_MAX) return l;
  return [
    ...l.slice(0, LS_MAX - 1),
    `... (Portal: ${l.length - (LS_MAX - 1)} satır daha gösterilmedi)`,
  ];
}

function planJson(ear) {
  const ls = lsKes(ear.ls);
  const info = (Array.isArray(ear.info) ? ear.info : []).slice(0, INFO_MAX).map((x) => {
    const [anahtar, ...dg] = String(x).split('\t');
    return { anahtar: M(anahtar, 64), deger: M(dg.join('\t'), SATIR_MAX) };
  });
  return JSON.stringify({ fp: FP_RE.test(String(ear.fp || '')) ? ear.fp : '', ls, info });
}

const dakikaGecti = (v, dk) => v && Date.now() - new Date(v).getTime() > dk * 60 * 1000;
const playbookNotu = (jobId, status) =>
  `iş #${jobId} ${status}; set_stats yok ya da başka eylem — AWX'teki server_hub_fix.yml ${ACTION} eylemini tanımıyor olabilir (playbook güncel mi?)`;

/** PLANLANIYOR kaydi: plan isi bittiyse PLAN_HAZIR ya da PLAN_HATA. */
async function planIlerlet(r) {
  if (r.plan_job_id == null) {
    if (dakikaGecti(r.updated_at || r.created_at, NUMARASIZ_DK))
      await gecis(r.id, 'PLANLANIYOR', 'PLAN_HATA', {
        sonuc: 'ön kontrol başlatılamadı (iş numarası yok)',
      });
    return;
  }
  const st = await isDurumu(r.plan_awx_server_id, r.plan_job_id);
  if (!st || !IS_TERMINAL.has(st.status)) {
    if (dakikaGecti(r.updated_at || r.created_at, IS_ZAMAN_ASIMI_SAAT * 60))
      await gecis(r.id, 'PLANLANIYOR', 'PLAN_HATA', {
        sonuc: `ön kontrol işi #${r.plan_job_id} ${IS_ZAMAN_ASIMI_SAAT} saatte bitmedi — AWX'ten kontrol edin`,
      });
    return;
  }
  const s = earSonucu(sonucOku(st));
  if (!s) {
    await gecis(r.id, 'PLANLANIYOR', 'PLAN_HATA', {
      sonuc: M(playbookNotu(r.plan_job_id, st.status), 1000),
    });
    return;
  }
  const pj = planJson(s.ear);
  const fp = JSON.parse(pj).fp;
  // Salt okunur on kontrol OK donmemeli (OK = silindi): betik silme kipinde kosmus olabilir; ayrica isaretlenir.
  const anomali = s.sonuc === 'OK';
  let neden = null;
  if (anomali)
    neden = `BEKLENMEDİK: salt okunur ön kontrol işi #${r.plan_job_id} sonucu OK (${s.mesaj}) — silme kipinde koşmuş olabilir; AWX'ten ve sunucudan kontrol edin`;
  else if (s.sonuc !== 'PLAN') neden = `${s.sonuc || '?'} ${s.mesaj}`.trim();
  else if (!fp) neden = `parmak izi yok: ${s.mesaj}`;
  else neden = lsEksigi(r, s.ear);
  let yazildi;
  if (!neden)
    yazildi = await gecis(r.id, 'PLANLANIYOR', 'PLAN_HAZIR', {
      plan_json: pj,
      plan_bitis_at: SIMDI,
      sonuc: M(s.mesaj, 1000) || null,
    });
  else
    yazildi = await gecis(r.id, 'PLANLANIYOR', 'PLAN_HATA', {
      plan_json: pj,
      plan_bitis_at: SIMDI,
      sonuc: M(neden, 1000),
    });
  if (yazildi)
    denetim(sozdeIstek(r.olusturan), {
      op: 'ear_temizlik_sonuc',
      faz: 'plan',
      id: r.id,
      host: r.host,
      kok: r.kok,
      ad: r.ad,
      sonuc: s.sonuc,
      jobId: r.plan_job_id,
      ...(anomali ? { anomali: true, yedek: M(s.ear.backup, 400) || null } : {}),
    });
}

/** SILINDI'den sonra tek sunucu Uygulama Envanteri taramasi; sonucu kayda yazilir. */
async function envanterBaslat(r) {
  const kim = r.onaylayan || r.olusturan;
  let kosuId = null;
  let not = null;
  try {
    const k = await envanterKosu({
      kip: 'OZET',
      hedefler: [r.host],
      kapsam: 'SECILI',
      kaynak: 'ELLE',
      baslatan: kim,
      req: sozdeIstek(kim),
    });
    kosuId = k && k.id != null ? Number(k.id) : null;
    const ph = k && k.ilkParti && k.ilkParti.hata;
    // ilkParti.hata: AWX isi baslatilamadi (gecici: poller yeniden dener / son deneme: tarama sonucsuz biter).
    if (ph)
      not = k.ilkParti.yenidenDenenecek
        ? `Uygulama Envanteri taraması #${kosuId} açıldı ama AWX işi henüz başlatılamadı (${M(ph, 200)}); yeniden denenecek`
        : `Uygulama Envanteri taraması #${kosuId} başlatılamadı (${M(ph, 200)}); uyarı bir sonraki taramada kalkar`;
    else not = `Uygulama Envanteri taraması #${kosuId} başladı; uyarı tarama bitince kalkar`;
  } catch (e) {
    // Yalniz 'kosu_calisiyor' baska kosu demektir; diger 409'lar (sablon / limit yapilandirmasi) gercek hata.
    not =
      e && e.code === 'kosu_calisiyor'
        ? ENVANTER_SURUYOR
        : `Uygulama Envanteri taraması başlatılamadı (${M(e && e.message, 200)}); uyarı bir sonraki taramada kalkar`;
  }
  await db().query(
    `UPDATE server_hub_ear_temizlik SET envanter_kosu_id = $2, envanter_notu = $3, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'SILINDI'`,
    [r.id, kosuId, M(not, 400)],
  );
}

/** SILINIYOR kaydi: silme isi bittiyse SILINDI / HATA. */
async function silIlerlet(r) {
  if (r.sil_job_id == null) {
    if (dakikaGecti(r.updated_at, NUMARASIZ_DK))
      await gecis(r.id, 'SILINIYOR', 'BELIRSIZ', {
        sonuc: "silme işinin numarası yazılamadı — AWX'e gitmiş olabilir; AWX'ten kontrol edin",
      });
    return;
  }
  const st = await isDurumu(r.sil_awx_server_id, r.sil_job_id);
  if (!st || !IS_TERMINAL.has(st.status)) {
    if (dakikaGecti(r.updated_at, IS_ZAMAN_ASIMI_SAAT * 60))
      await gecis(r.id, 'SILINIYOR', 'BELIRSIZ', {
        sonuc: `silme işi #${r.sil_job_id} ${IS_ZAMAN_ASIMI_SAAT} saatte bitmedi — AWX'ten kontrol edin`,
      });
    return;
  }
  const s = earSonucu(sonucOku(st));
  let yeni;
  let alan;
  if (!s) {
    yeni = 'HATA';
    alan = { sonuc: M(playbookNotu(r.sil_job_id, st.status), 1000) };
  } else if (s.sonuc === 'OK') {
    yeni = 'SILINDI';
    alan = { sonuc: M(s.mesaj, 1000), yedek: M(s.ear.backup, 400) || null };
  } else {
    yeni = 'HATA';
    alan = { sonuc: M(`${s.sonuc || '?'} ${s.mesaj}`.trim(), 1000) };
  }
  if (!(await gecis(r.id, 'SILINIYOR', yeni, alan))) return;
  denetim(sozdeIstek(r.onaylayan || r.olusturan), {
    op: 'ear_temizlik_sonuc',
    faz: 'sil',
    id: r.id,
    host: r.host,
    kok: r.kok,
    ad: r.ad,
    durum: yeni,
    yedek: alan.yedek || null,
    jobId: r.sil_job_id,
  });
  if (yeni === 'SILINDI') await envanterBaslat(r);
}

async function ilerlet(r) {
  if (r.durum === 'PLANLANIYOR') await planIlerlet(r);
  else if (r.durum === 'SILINIYOR') await silIlerlet(r);
}

/** Suren tum kayitlari ilerlet (GET uclari). */
async function surenleriIlerlet() {
  const { rows } = await db().query(
    `SELECT * FROM server_hub_ear_temizlik WHERE durum IN (${IN(SUREN)}) ORDER BY id`,
  );
  for (const r of rows || []) await ilerlet(r);
}

// ── ISLEMLER ─────────────────────────────────────────────────────────────────────────────────────

function extraVarsOf(r, planOnly, fp) {
  return {
    target_host: r.host,
    action: ACTION,
    plan_only: planOnly,
    gen: Number(r.jboss),
    ear_root: r.kok,
    ear_name: r.ad,
    ear_fp: planOnly ? '' : fp,
  };
}

function girdiDogrula(body) {
  const b = body || {};
  const host = String(b.host || '').toUpperCase();
  const kok = String(b.kok || '');
  const ad = String(b.ad || '');
  if (!hostRe().test(host)) throw hata(400, 'Geçersiz sunucu adı.', 'gecersiz_host');
  if (!Object.hasOwn(KOKLER, kok))
    throw hata(400, 'Kök yalnız /vhosting ya da /vhosting8 olabilir.', 'gecersiz_kok');
  if (!AD_RE.test(ad)) throw hata(400, 'Geçersiz EAR adı.', 'gecersiz_ad');
  return { host, kok, ad };
}

/** POST on-kontrol: taze bulgu dogrulamasi -> kayit -> salt okunur plan isi. */
async function onKontrol(req, body) {
  const { host, kok, ad } = girdiDogrula(body);
  const a = await _d.getAssessment(true);
  const aday = adayBul(a, host, kok, ad);
  if (!aday)
    throw hata(
      404,
      `${host} üzerinde ${kok}/${ad} için güncel "EAR içinde WAR yok" bulgusu yok — sayfayı yenileyin.`,
      'bulgu_yok',
    );
  if (aday.engel) throw hata(409, `${kok}/${ad}: ${aday.engel}`, 'engel');
  await eskit();
  const akt = await aktifKayit(host, kok, ad);
  if (akt) throw hata(409, `${kok}/${ad} için kayıt #${akt.id} hâlâ ${akt.durum}.`, 'aktif_kayit');
  let id;
  try {
    const r = await db().query(
      `INSERT INTO server_hub_ear_temizlik (host, kok, ad, jboss, ortam, prod, durum, olusturan) VALUES ($1, $2, $3, $4, $5, $6, 'PLANLANIYOR', $7) RETURNING id`,
      [host, kok, ad, aday.jboss, aday.ortam, aday.prod ? 1 : 0, kullanici(req)],
    );
    id = r.rows && r.rows[0] && r.rows[0].id;
  } catch (e) {
    if (/UX_shet_aktif|duplicate key|UNIQUE/i.test(String(e && e.message)))
      throw hata(
        409,
        `${kok}/${ad} için başka bir kayıt az önce açıldı — sayfayı yenileyin.`,
        'aktif_kayit',
      );
    throw e;
  }
  if (!id) throw hata(500, 'EAR temizlik kaydı oluşturulamadı.');
  const kayit = { id, host, kok, ad, jboss: aday.jboss };
  let j;
  try {
    j = await _d.launch(req, REGISTRY_KEY, TEMPLATE_ADI, extraVarsOf(kayit, true, ''), {
      op: 'ear_temizlik_plan',
      id,
      host,
      kok,
      ad,
    });
  } catch (e) {
    const not =
      e && e.launchBelirsiz
        ? 'AWX yanıtı belirsiz (salt okunur ön kontrol; yeniden deneyin)'
        : 'ön kontrol başlatılamadı';
    await gecis(id, 'PLANLANIYOR', 'PLAN_HATA', { sonuc: M(`${not}: ${e && e.message}`, 1000) });
    throw e;
  }
  await db().query(
    `UPDATE server_hub_ear_temizlik SET plan_awx_server_id = $2, plan_job_id = $3, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLANLANIYOR'`,
    [
      id,
      j.awxServerId == null ? null : Number(j.awxServerId),
      j.jobId == null ? null : Number(j.jobId),
    ],
  );
  denetim(req, {
    op: 'ear_temizlik_plan',
    id,
    host,
    kok,
    ad,
    prod: aday.prod,
    jobId: j.jobId ?? null,
  });
  return kayitSatiri(await kayitOku(id));
}

/** Kaydin sil isteminden once gecmesi gereken kapilar (CAS'tan once; CAS ayrica yeniden denetler). */
function silKapilari(r, body) {
  if (r.durum === 'PLAN_ESKIDI')
    throw hata(
      409,
      `Ön kontrol ${PLAN_GECERLILIK_DK} dakikadan eski — yeniden ön kontrol çalıştırın.`,
      'plan_eskidi',
    );
  if (r.durum !== 'PLAN_HAZIR')
    throw hata(
      409,
      `Kayıt #${r.id} ${r.durum} durumunda; silme yalnız hazır ön kontrolden sonra.`,
      'durum',
    );
  if (String(body.onayMetni ?? '') !== r.ad)
    throw hata(400, `Onay için EAR adı birebir yazılmalı (${r.ad}).`, 'onay_metni');
  if (Number(body.planJobId) !== Number(r.plan_job_id) || r.plan_job_id == null)
    throw hata(
      409,
      'Ekranda görülen ön kontrol işi kayıttakiyle aynı değil — sayfayı yenileyin.',
      'plan_degisti',
    );
  const plan = planOku(r.plan_json);
  if (!plan || !FP_RE.test(plan.fp))
    throw hata(409, 'Ön kontrolde parmak izi yok — yeniden ön kontrol çalıştırın.', 'fp_yok');
  // Kullanici ls -ltr'yi gormeden teyit edemez: kayitta gecerli ls ciktisi yoksa silme yok.
  if (!plan.ls.length || !lsBasligiGecerli(r, plan.ls[0]))
    throw hata(
      409,
      'Ön kontrolde ls -ltr çıktısı yok — teyit edilemez; yeniden ön kontrol çalıştırın.',
      'ls_yok',
    );
  return plan.fp;
}

/** POST :id/sil: kapilar -> taze bulgu -> CAS SILINIYOR -> launch (plan_only=false, ear_fp). */
async function sil(req, id, body) {
  await eskit();
  const r = await kayitOku(id);
  if (!r) throw hata(404, `Kayıt #${id} yok.`, 'kayit_yok');
  const fp = silKapilari(r, body);
  const a = await _d.getAssessment(true);
  const aday = adayBul(a, r.host, r.kok, r.ad);
  if (!aday)
    throw hata(
      409,
      `${r.kok}/${r.ad} için "EAR içinde WAR yok" bulgusu artık yok — silinmedi.`,
      'bulgu_yok',
    );
  if (aday.engel) throw hata(409, `${r.kok}/${r.ad}: ${aday.engel} — silinmedi.`, 'engel');
  const kim = kullanici(req);
  const al = await db().query(
    `UPDATE server_hub_ear_temizlik SET durum = 'SILINIYOR', onaylayan = $2, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLAN_HAZIR' AND plan_job_id = $3 AND plan_bitis_at > DATEADD(minute, -${PLAN_GECERLILIK_DK}, SYSUTCDATETIME())`,
    [id, kim, Number(r.plan_job_id)],
  );
  if (!al || al.rowCount !== 1) {
    await eskit();
    const g = await kayitOku(id);
    if (g && g.durum === 'PLAN_ESKIDI')
      throw hata(
        409,
        `Ön kontrol ${PLAN_GECERLILIK_DK} dakikadan eski — yeniden ön kontrol çalıştırın.`,
        'plan_eskidi',
      );
    throw hata(
      409,
      `Kayıt #${id} az önce değişti (${g ? g.durum : 'yok'}) — sayfayı yenileyin.`,
      'durum',
    );
  }
  let j;
  try {
    j = await _d.launch(req, REGISTRY_KEY, TEMPLATE_ADI, extraVarsOf(r, false, fp), {
      op: 'ear_temizlik_sil',
      id,
      host: r.host,
      kok: r.kok,
      ad: r.ad,
    });
  } catch (e) {
    if (e && e.launchBelirsiz) {
      const not = `AWX yanıtı belirsiz — silme işi açılmış olabilir; tekrar denenmez, AWX'ten kontrol edin (${M(e.message, 300)})`;
      await gecis(id, 'SILINIYOR', 'BELIRSIZ', { sonuc: M(not, 1000) });
      denetim(req, {
        op: 'ear_temizlik_sonuc',
        faz: 'sil',
        id,
        host: r.host,
        kok: r.kok,
        ad: r.ad,
        durum: 'BELIRSIZ',
      });
      throw hata(502, not, 'launch_belirsiz');
    }
    await db().query(
      `UPDATE server_hub_ear_temizlik SET durum = 'PLAN_HAZIR', onaylayan = NULL, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'SILINIYOR' AND sil_job_id IS NULL`,
      [id],
    );
    throw e;
  }
  // Bu noktada silme isi AWX'te ACIK: denetim once yazilir; kayda yazim duserse kullaniciya is numarasi soylenir.
  denetim(req, {
    op: 'ear_temizlik_sil',
    id,
    host: r.host,
    kok: r.kok,
    ad: r.ad,
    prod: r.prod === true || r.prod === 1,
    jobId: j.jobId ?? null,
  });
  try {
    await db().query(
      `UPDATE server_hub_ear_temizlik SET sil_awx_server_id = $2, sil_job_id = $3, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'SILINIYOR'`,
      [
        id,
        j.awxServerId == null ? null : Number(j.awxServerId),
        j.jobId == null ? null : Number(j.jobId),
      ],
    );
  } catch (e) {
    console.error(`[EarTemizlik] kayit #${id} silme isi #${j.jobId} yazilamadi:`, e && e.message);
    throw hata(
      502,
      `Silme işi #${j.jobId ?? '?'} AWX'te başlatıldı ama kayda yazılamadı (${M(e && e.message, 200)}) — tekrar denemeyin; sonucu AWX'ten izleyin (kayıt ${NUMARASIZ_DK} dk sonra BELIRSIZ olur).`,
      'kayit_yazilamadi',
    );
  }
  return kayitSatiri(await kayitOku(id));
}

/** POST :id/iptal: yalniz PLAN_HAZIR -> IPTAL. */
async function iptal(req, id) {
  await eskit();
  if (!(await gecis(id, 'PLAN_HAZIR', 'IPTAL'))) {
    const r = await kayitOku(id);
    if (!r) throw hata(404, `Kayıt #${id} yok.`, 'kayit_yok');
    throw hata(
      409,
      `Kayıt #${id} ${r.durum} durumunda; yalnız hazır ön kontrol iptal edilebilir.`,
      'durum',
    );
  }
  const r = await kayitOku(id);
  denetim(req, { op: 'ear_temizlik_iptal', id, host: r && r.host, kok: r && r.kok, ad: r && r.ad });
  return kayitSatiri(r);
}

/** GET liste: suren kayitlar ilerletilir, adaylar taze bulgudan, son 50 kayit. */
async function liste(fresh) {
  await eskit();
  await surenleriIlerlet();
  const [a, son] = await Promise.all([
    _d.getAssessment(fresh === true),
    db().query(`SELECT TOP ${SON_KAYIT} * FROM server_hub_ear_temizlik ORDER BY id DESC`),
  ]);
  const kayitlar = ((son && son.rows) || []).map(kayitSatiri);
  const adaylar = a && a.tableMissing ? [] : adaylariTuret(a);
  for (const x of adaylar)
    x.kayit = kayitlar.find((k) => k.host === x.host && k.kok === x.kok && k.ad === x.ad) || null;
  return { planGecerlilikDk: PLAN_GECERLILIK_DK, adaylar, kayitlar };
}

async function tekKayit(id) {
  await eskit();
  const r = await kayitOku(id);
  if (!r) throw hata(404, `Kayıt #${id} yok.`, 'kayit_yok');
  if (SUREN.includes(r.durum)) {
    await ilerlet(r);
    return kayitSatiri(await kayitOku(id));
  }
  return kayitSatiri(r);
}

// ── UCLAR ────────────────────────────────────────────────────────────────────────────────────────

function mount(router, deps) {
  kur(deps);
  // 5xx: kurumsal nginx govdeyi index.html ile degistirir (toplu-autostart.cjs mount ile ayni gerekce). GET disi
  // isteklerde 424 + upstreamStatus + nginxRed.
  const gonder = (req, res, err) => {
    const status = err.status || 500;
    if (status >= 500) {
      console.error(
        `[EarTemizlik] ${req.method} ${req.originalUrl || req.path} ${status}:`,
        err && err.message,
      );
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return res.status(424).json({
          ok: false,
          message: err.message,
          code: err.code || 'ear_temizlik_sunucu_hatasi',
          upstreamStatus: status,
          nginxRed: true,
        });
    }
    return res
      .status(status)
      .json({ ok: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
  };
  const idOf = (req) => {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id > 0 ? id : null;
  };
  const gecersiz = (res) =>
    res.status(400).json({ ok: false, message: 'Geçersiz kayıt numarası.' });

  router.get('/ear-temizlik', async (req, res) => {
    try {
      res.json({ ok: true, ...(await liste(req.query.fresh === '1')) });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.get('/ear-temizlik/:id', async (req, res) => {
    const id = idOf(req);
    if (!id) return gecersiz(res);
    try {
      res.json({ ok: true, kayit: await tekKayit(id) });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.post('/ear-temizlik/on-kontrol', async (req, res) => {
    try {
      res.json({ ok: true, kayit: await onKontrol(req, req.body) });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.post('/ear-temizlik/:id/sil', async (req, res) => {
    const id = idOf(req);
    if (!id) return gecersiz(res);
    if (req.body?.confirmed !== true)
      return res.status(400).json({ ok: false, message: 'Bu işlem açık onay ister (confirmed).' });
    try {
      res.json({ ok: true, kayit: await sil(req, id, req.body) });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.post('/ear-temizlik/:id/iptal', async (req, res) => {
    const id = idOf(req);
    if (!id) return gecersiz(res);
    try {
      res.json({ ok: true, kayit: await iptal(req, id) });
    } catch (err) {
      gonder(req, res, err);
    }
  });
}

module.exports = {
  REGISTRY_KEY,
  ACTION,
  PLAN_GECERLILIK_DK,
  AKTIF,
  ENGEL_XML,
  ENVANTER_SURUYOR,
  LS_MAX,
  AD_RE,
  FP_RE,
  kur,
  mount,
  prodMu,
  adaylariTuret,
  earSonucu,
  extraVarsOf,
  kayitSatiri,
  onKontrol,
  sil,
  iptal,
  liste,
  tekKayit,
};
