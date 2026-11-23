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
//      Ayni sekilde dizin kullanimdaysa (2026-11-17: dizini gosteren surec ya da taramadan once 7 gunde yazma)
//      engel. Referans Uygulama Envanteri'nin TARAMA anidir (h.ear.taranma), duvar saati degil.
//   3. On kontrol = AWX server_hub_fix, action ear_cleanup, plan_only=true: SALT OKUNUR (ls -ltr + kapilar +
//      parmak izi). Sonuc set_stats server_hub_fix_result.ear'dan okunur, kayit PLAN_HAZIR olur.
//   4. Kullanici ls -ltr ciktisini gorur, EAR adini birebir yazar (onayMetni) ve gordugu plan isinin numarasini
//      gonderir (planJobId). Plan 30 dk gecerlidir (plan_bitis_at + 30 dk); sonra PLAN_ESKIDI (tembel).
//   5. Onay aninda bulgu TAZE degerlendirmede yeniden aranir; SILINIYOR'a gecis launch'tan ONCE CAS ile yapilir
//      (cift tik / iki sekme tek is acar). extra_vars ear_fp = plandaki parmak izi: betik yeniden hesaplar,
//      degistiyse HICBIR SEY silmez. Once tar.gz yedek, sonra rm.
//   6. Launch kesin reddedilirse (4xx / sablon yok) kayit PLAN_HAZIR'a doner; sonucu belirsizse (zaman asimi /
//      5xx) BELIRSIZ olur ve TEKRAR DENENMEZ (is acilmis olabilir).
//   7. GET uclari ve hafif yurutucu (YURUTUCU_SN; toplu silme kuyrugu sekmeye bagli kalmasin diye eklendi) suren
//      kayitlari AWX'ten okuyup gecisi yazar. Her gecis CAS (WHERE durum = eski).
//   8. SILINDI'de tek sunucu Uygulama Envanteri taramasi (OZET, SECILI) baslar; uyari o tarama bitince kalkar.
//      Baska kosu suruyorsa not yazilir (uyari bir sonraki taramada kalkar).
//   Yalniz Admin (server-hub router'i). PROD dahil; PROD satiri ekranda isaretlenir, ek onay yok (kullanici karari).
//
// TOPLU (2026-11-16, kullanici: "toplu halde temizlik icin gerekli duzenlemeyi yap"; ornek 8 PROD sunucuda ayni EAR)
//   9. Toplu on kontrol: secili adaylarin HER BIRI icin yukaridaki on kontrol ayri ayri (kismi basari serbest).
//  10. Toplu silme: kullanici her EAR'in ls -ltr ciktisini gorur, tam "<n> EAR SIL" yazar. Sunucu HEPSI-YA-HIC dogrular
//      (her kayit tekli silmenin kapilarindan gecer; biri bile gecmezse HICBIR kayit degismez), sonra her kayda CAS ile
//      sil_istendi_at + toplu_id yazar ("sirada" = PLAN_HAZIR + sil_istendi_at dolu).
//  11. KUYRUK: betik EAR koku uzerinde flock -n alir (ayni sunucuda ikinci silme FAIL "kilit"), bu yuzden sunucu
//      basina AYNI ANDA TEK silme; toplamda en cok TOPLU_ESZAMANLI. Baslatma PLAN_HAZIR -> SILINIYOR CAS'i (tek
//      kazanan). Tekli silme de ayni kuyruktan gecer (sunucu bossa hemen baslar). Sirada SIRA_BEKLEME_DK'yi asan
//      kayit PLAN_ESKIDI olur; sirada kayit 30 dk kuraliyla ESKIMEZ (onay istek aninda gecerliydi; betik parmak
//      izini yeniden hesaplar).
//  12. Envanter: ayni sunucuda sirada / SILINIYOR kayit kalmayinca TEK tarama (o sunucudaki tum yeni SILINDI'ler icin).
'use strict';

const crypto = require('node:crypto');
const { kullanimKaniti, OLCULEMEDI_EKI } = require('./ear-kullanim.cjs');

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
const ENGEL_KULLANIM = 'dizin kullanımda';
const ENVANTER_SURUYOR =
  'Başka Uygulama Envanteri koşusu sürüyor; uyarı bir sonraki taramada kalkar';
// Betik (server_hub_fix.sh ear_ls): dizinde 1 satir 'ls -ld P' + en cok 300 satir 'ls -ltr P' + 1 tasma notu
// ('... (N satir daha)') = en cok 302. Fazlasi gelirse son satir Portal'in kendi kesinti notu olur (sessiz kesinti yok).
const LS_MAX = 302;
// ls ilk satiri 'ls -ld P' (dizin) ya da 'ls -l P' (duzenli dosya): tur + 9 izin karakteri ve satir P ile biter.
const LS_BASLIK_RE = /^[-d][-rwxsStT]{9}[.+@]?\s/;
const INFO_MAX = 50;
const SATIR_MAX = 1000;
// Toplu: tek istekte en cok bu kadar oge; ayni anda en cok bu kadar silme isi; sirada en cok bu kadar dakika.
const TOPLU_MAX = 50;
const TOPLU_ESZAMANLI = 5;
const SIRA_BEKLEME_DK = 60;
const SIRA_ESKIDI_NOTU = `sırada ${SIRA_BEKLEME_DK} dk bekledi, başlatılamadı — yeniden ön kontrol çalıştırın`;
const ENVANTER_BEKLIYOR = 'aynı sunucudaki sıradaki silmeden sonra taranacak';
const ENVANTER_BASLATILIYOR = 'Uygulama Envanteri taraması başlatılıyor';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

const db = () => _d?.db || require('../db/index.cjs');
const hostRe = () => _d?.HOST_RE || HOST_RE_VARSAYILAN;

async function isDurumu(serverId, jobId) {
  try {
    if (_d && typeof _d.isDurumu === 'function') return await _d.isDurumu(serverId, jobId);
    return await require('../ansible/runner.cjs').getJobStatusOnServer(serverId, jobId);
  } catch (e) {
    console.warn(`[EarTemizlik] is #${jobId} okunamadi:`, e?.message);
    return null;
  }
}

function envanterKosu(opts) {
  if (_d && typeof _d.envanterKosu === 'function') return _d.envanterKosu(opts);
  return require('./ear-envanter-poller.cjs').kosuOlustur(opts);
}

function sonucOku(st) {
  const { extractStatsKey } = require('../opsx/index.cjs');
  return extractStatsKey(st?.artifacts, 'server_hub_fix_result') || null;
}

function denetim(req, detail) {
  try {
    if (_d?.audit) _d.audit(req, detail);
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
const prodMu = (h) => h?.envGroup !== 'Non-Production';

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
  return ul.some((u) => u && u.kok === kok && u.ad === ad && u.xml?.durum === 'VAR')
    ? ENGEL_XML
    : null;
}

/**
 * Ayni kok/ad dizini kullanimdaysa (surec ya da taramadan once 7 gunde yazma; ear-kullanim.cjs, Server Hub
 * bulgusuyla ayni karar ve ayni referans: h.ear.taranma) engel metni (2026-11-17, ODCRPAP01: domain.xml'de
 * olmayan EAR'da canli Node.js). FAIL-CLOSED (kullanici karari 2026-11-17): kullanim olculup YOK cikmadikca
 * (eski tarayici / alan yok, /proc okunamadi, KISMI, ileri tarihli mtime, envanter kaydi yok) silme REDDEDILIR.
 * Yalniz izin yuzunden okunamayan (root) surecler engel degil; uyari olarak gosterilir (kullanimUyarisi).
 */
function kullanimEngeli(h, kok, ad, now) {
  const ul = (h.ear && Array.isArray(h.ear.uygulamalar) && h.ear.uygulamalar) || [];
  const u = ul.find((x) => x && x.kok === kok && x.ad === ad);
  if (!u) return `${OLCULEMEDI_EKI} (envanter kaydı bulunamadı)`;
  const k = u.kullanim || u.xml?.kullanim || null;
  const kk = kullanimKaniti(k, h.ear?.taranma, now);
  if (kk.aktif) return `${ENGEL_KULLANIM} (${kk.metin})`;
  if (kk.olculemedi)
    return `${OLCULEMEDI_EKI}${kk.neden ? ' (' + kk.neden + ')' : ''}; silmek için yeni tarayıcıyla yeniden taranmalı`;
  return null;
}

/**
 * Engel olmayan ama kullanimi olculememis / kismen gorulmus JVM'siz EAR icin on kontrol ekraninda gosterilecek uyari
 * (inceleme B12, 2026-11-17): silme acik kalir (ls -ltr + teyit + betik surec kapisi) ama "kullanilmiyor" sanilmaz.
 */
function kullanimUyarisi(h, kok, ad, now) {
  const ul = (h.ear && Array.isArray(h.ear.uygulamalar) && h.ear.uygulamalar) || [];
  const u = ul.find((x) => x && x.kok === kok && x.ad === ad);
  if (u?.xml?.durum !== 'JVM_YOK') return null;
  const kk = kullanimKaniti(u.kullanim || u.xml.kullanim, h.ear?.taranma, now);
  if (kk.aktif || kk.olculemedi) return null;
  return kk.kor ? `dizin kullanımı kısmen görüldü: ${kk.kor}` : null;
}

/** Taze degerlendirmeden EAR_WAR_YOK adaylari (kayit alani bos). */
function adaylariTuret(a, now = Date.now()) {
  const out = [];
  for (const h of a?.hosts || []) {
    for (const f of h.findings || []) {
      if (f?.code !== 'EAR_WAR_YOK' || !f.ear) continue;
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
        envanterTarihi: h.ear?.taranma || null,
        engel:
          bicimEngeli(kok, ad, jboss) || xmlEngeli(h, kok, ad) || kullanimEngeli(h, kok, ad, now),
        kullanimUyarisi: kullanimUyarisi(h, kok, ad, now),
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

/** Silme istendi, kuyrukta baslamayi bekliyor. */
const siradaMi = (r) => !!r && r.durum === 'PLAN_HAZIR' && r.sil_istendi_at != null;

function kalanSn(r) {
  if (r.durum !== 'PLAN_HAZIR' || !r.plan_bitis_at || siradaMi(r)) return null;
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
    sirada: siradaMi(r),
    topluId: r.toplu_id || null,
  };
}

async function kayitOku(id) {
  const { rows } = await db().query(`SELECT * FROM server_hub_ear_temizlik WHERE id = $1`, [id]);
  return rows?.[0] ? rows[0] : null;
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
  return r?.rowCount === 1;
}

/**
 * Tembel eskime: plan_bitis_at + 30 dk gecmis PLAN_HAZIR -> PLAN_ESKIDI. Sirada kayit (sil_istendi_at dolu) bu
 * kuralla eskimez: onay istek aninda gecerliydi; sirada beklemenin kendi siniri var (SIRA_BEKLEME_DK, kuyrukta).
 */
async function eskit() {
  await db().query(
    `UPDATE server_hub_ear_temizlik SET durum = 'PLAN_ESKIDI', updated_at = SYSUTCDATETIME() WHERE durum = 'PLAN_HAZIR' AND sil_istendi_at IS NULL AND plan_bitis_at < DATEADD(minute, -${PLAN_GECERLILIK_DK}, SYSUTCDATETIME())`,
  );
}

async function aktifKayit(host, kok, ad) {
  const { rows } = await db().query(
    `SELECT TOP 1 * FROM server_hub_ear_temizlik WHERE host = $1 AND kok = $2 AND ad = $3 AND durum IN (${IN(AKTIF)}) ORDER BY id DESC`,
    [host, kok, ad],
  );
  return rows?.[0] ? rows[0] : null;
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

/** SILINDI'den sonra tek sunucu Uygulama Envanteri taramasi; sonucu verilen kayitlara yazilir. */
async function envanterBaslat(host, idler, kim) {
  let kosuId = null;
  let not = null;
  try {
    const k = await envanterKosu({
      kip: 'OZET',
      hedefler: [host],
      kapsam: 'SECILI',
      kaynak: 'ELLE',
      baslatan: kim,
      req: sozdeIstek(kim),
    });
    kosuId = k?.id != null ? Number(k.id) : null;
    const ph = k?.ilkParti?.hata;
    // ilkParti.hata: AWX isi baslatilamadi (gecici: poller yeniden dener / son deneme: tarama sonucsuz biter).
    if (ph)
      not = k.ilkParti.yenidenDenenecek
        ? `Uygulama Envanteri taraması #${kosuId} açıldı ama AWX işi henüz başlatılamadı (${M(ph, 200)}); yeniden denenecek`
        : `Uygulama Envanteri taraması #${kosuId} başlatılamadı (${M(ph, 200)}); uyarı bir sonraki taramada kalkar`;
    else not = `Uygulama Envanteri taraması #${kosuId} başladı; uyarı tarama bitince kalkar`;
  } catch (e) {
    // Yalniz 'kosu_calisiyor' baska kosu demektir; diger 409'lar (sablon / limit yapilandirmasi) gercek hata.
    not =
      e?.code === 'kosu_calisiyor'
        ? ENVANTER_SURUYOR
        : `Uygulama Envanteri taraması başlatılamadı (${M(e?.message, 200)}); uyarı bir sonraki taramada kalkar`;
  }
  for (const id of idler)
    await db().query(
      `UPDATE server_hub_ear_temizlik SET envanter_kosu_id = $2, envanter_notu = $3, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'SILINDI'`,
      [id, kosuId, M(not, 400)],
    );
}

/** Sunucuda sirada ya da SILINIYOR kayit var mi (varsa envanter taramasi son silmeye birakilir). */
async function hostBekleyenVar(host) {
  const { rows } = await db().query(
    `SELECT * FROM server_hub_ear_temizlik WHERE host = $1 AND durum IN ('PLAN_HAZIR', 'SILINIYOR') ORDER BY id`,
    [host],
  );
  return (rows || []).some((x) => x.durum === 'SILINIYOR' || siradaMi(x));
}

/**
 * Sunucuda bekleyen silme kalmadiysa taramayi bekleyen SILINDI kayitlarini (ENVANTER_BEKLIYOR) CAS ile sahiplenir ve
 * hepsi icin TEK tarama baslatir. Sahiplenme kayit basina CAS: iki es zamanli cagridan yalniz biri sahiplenir.
 */
async function envanterKontrol(host) {
  if (await hostBekleyenVar(host)) return;
  const { rows } = await db().query(
    `SELECT * FROM server_hub_ear_temizlik WHERE host = $1 AND durum = 'SILINDI' AND envanter_notu = $2 ORDER BY id`,
    [host, ENVANTER_BEKLIYOR],
  );
  const alinan = [];
  for (const r of rows || []) {
    const u = await db().query(
      `UPDATE server_hub_ear_temizlik SET envanter_notu = $3, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'SILINDI' AND envanter_notu = $2`,
      [r.id, ENVANTER_BEKLIYOR, ENVANTER_BASLATILIYOR],
    );
    if (u?.rowCount === 1) alinan.push(r);
  }
  if (!alinan.length) return;
  const son = alinan.at(-1);
  await envanterBaslat(
    host,
    alinan.map((x) => x.id),
    son.onaylayan || son.sil_isteyen || son.olusturan,
  );
}

/** SILINIYOR kaydi: silme isi bittiyse SILINDI / HATA. */
async function silIlerlet(r) {
  // BELIRSIZ'e gecis de sunucudaki son bekleyen silme olabilir: ayni sunucuda taramayi bekleyen SILINDI kayitlari
  // varsa envanterKontrol tek taramayi baslatir (yoksa not sonsuza dek 'taranacak' kalirdi).
  if (r.sil_job_id == null) {
    if (
      dakikaGecti(r.updated_at, NUMARASIZ_DK) &&
      (await gecis(r.id, 'SILINIYOR', 'BELIRSIZ', {
        sonuc: "silme işinin numarası yazılamadı — AWX'e gitmiş olabilir; AWX'ten kontrol edin",
      }))
    )
      await envanterKontrol(r.host);
    return;
  }
  const st = await isDurumu(r.sil_awx_server_id, r.sil_job_id);
  if (!st || !IS_TERMINAL.has(st.status)) {
    if (
      dakikaGecti(r.updated_at, IS_ZAMAN_ASIMI_SAAT * 60) &&
      (await gecis(r.id, 'SILINIYOR', 'BELIRSIZ', {
        sonuc: `silme işi #${r.sil_job_id} ${IS_ZAMAN_ASIMI_SAAT} saatte bitmedi — AWX'ten kontrol edin`,
      }))
    )
      await envanterKontrol(r.host);
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
  // SILINDI once taramayi bekler; sunucuda baska bekleyen silme yoksa envanterKontrol hemen tek tarama baslatir.
  if (yeni === 'SILINDI')
    await db().query(
      `UPDATE server_hub_ear_temizlik SET envanter_notu = $2, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'SILINDI'`,
      [r.id, ENVANTER_BEKLIYOR],
    );
  await envanterKontrol(r.host);
}

async function ilerlet(r) {
  if (r.durum === 'PLANLANIYOR') await planIlerlet(r);
  else if (r.durum === 'SILINIYOR') await silIlerlet(r);
}

/** Suren tum kayitlari ilerlet, sonra kuyrugu (GET uclari). */
async function surenleriIlerlet() {
  const { rows } = await db().query(
    `SELECT * FROM server_hub_ear_temizlik WHERE durum IN (${IN(SUREN)}) ORDER BY id`,
  );
  for (const r of rows || []) await ilerlet(r);
  await kuyrukIlerlet();
}

// ── KUYRUK ───────────────────────────────────────────────────────────────────────────────────────

// Kuyruk turu surerken gelen cagri ayni tura baglanir ve tur bir kez daha doner (arada isaretlenen kayit kacmaz).
// Ayni kaydin iki kez baslamasina karsi asil savunma baslatma CAS'idir; bu yalniz surec ici siralama.
let _kuyrukSurer = null;
let _kuyrukTekrar = false;
// Silme istegini yapan, yaniti bekleyen tekli istek (id -> req): AWX'e ve denetime gercek oturum gider; kesin
// launch reddinde kayit eski haline doner ve hata o istege iletilir.
const _istekler = new Map();

/** Sirada kaydi baslat: CAS PLAN_HAZIR(+sirada) -> SILINIYOR, sonra launch. sonuc: id -> { basladi } | { hata }. */
async function baslat(r, sonuc) {
  const kim = M(r.sil_isteyen || r.onaylayan || r.olusturan, 128);
  const al = await db().query(
    `UPDATE server_hub_ear_temizlik SET durum = 'SILINIYOR', onaylayan = $2, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLAN_HAZIR' AND sil_istendi_at IS NOT NULL`,
    [r.id, kim],
  );
  if (al?.rowCount !== 1) return false;
  const bekleyen = _istekler.get(r.id);
  const req = bekleyen || sozdeIstek(kim);
  const plan = planOku(r.plan_json);
  const fp = plan ? plan.fp : '';
  const ozet = { id: r.id, host: r.host, kok: r.kok, ad: r.ad };
  let j;
  try {
    j = await _d.launch(req, REGISTRY_KEY, TEMPLATE_ADI, extraVarsOf(r, false, fp), {
      op: 'ear_temizlik_sil',
      ...ozet,
      ...(r.toplu_id ? { topluId: r.toplu_id } : {}),
    });
  } catch (e) {
    if (e?.launchBelirsiz) {
      const not = `AWX yanıtı belirsiz — silme işi açılmış olabilir; tekrar denenmez, AWX'ten kontrol edin (${M(e.message, 300)})`;
      await gecis(r.id, 'SILINIYOR', 'BELIRSIZ', { sonuc: M(not, 1000) });
      denetim(req, { op: 'ear_temizlik_sonuc', faz: 'sil', ...ozet, durum: 'BELIRSIZ' });
      sonuc.set(r.id, { hata: hata(502, not, 'launch_belirsiz') });
    } else if (bekleyen && !r.toplu_id) {
      // Tekli istek yanit bekliyor: kayit teyit bekleyen plana doner, istek hatayi gorur (yeniden denenebilir).
      await db().query(
        `UPDATE server_hub_ear_temizlik SET durum = 'PLAN_HAZIR', onaylayan = NULL, sil_istendi_at = NULL, sil_isteyen = NULL, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'SILINIYOR' AND sil_job_id IS NULL`,
        [r.id],
      );
      sonuc.set(r.id, { hata: e });
    } else {
      // Yanit bekleyen yok (toplu / kuyruktan sonradan): kayit kapanir, neden kayitta gorunur.
      const not = `silme işi başlatılamadı: ${M(e?.message, 300)} — yeniden ön kontrol çalıştırın`;
      await db().query(
        `UPDATE server_hub_ear_temizlik SET durum = 'HATA', sonuc = $2, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'SILINIYOR' AND sil_job_id IS NULL`,
        [r.id, M(not, 1000)],
      );
      denetim(req, { op: 'ear_temizlik_sonuc', faz: 'sil', ...ozet, durum: 'HATA' });
      sonuc.set(r.id, { hata: e });
    }
    await envanterKontrol(r.host);
    return true;
  }
  // Bu noktada silme isi AWX'te ACIK: denetim once yazilir; kayda yazim duserse kullaniciya is numarasi soylenir.
  denetim(req, {
    op: 'ear_temizlik_sil',
    ...ozet,
    prod: r.prod === true || r.prod === 1,
    jobId: j.jobId ?? null,
    ...(r.toplu_id ? { topluId: r.toplu_id } : {}),
  });
  try {
    await db().query(
      `UPDATE server_hub_ear_temizlik SET sil_awx_server_id = $2, sil_job_id = $3, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'SILINIYOR'`,
      [
        r.id,
        j.awxServerId == null ? null : Number(j.awxServerId),
        j.jobId == null ? null : Number(j.jobId),
      ],
    );
    sonuc.set(r.id, { basladi: true });
  } catch (e) {
    console.error(`[EarTemizlik] kayit #${r.id} silme isi #${j.jobId} yazilamadi:`, e?.message);
    sonuc.set(r.id, {
      hata: hata(
        502,
        `Silme işi #${j.jobId ?? '?'} AWX'te başlatıldı ama kayda yazılamadı (${M(e?.message, 200)}) — tekrar denemeyin; sonucu AWX'ten izleyin (kayıt ${NUMARASIZ_DK} dk sonra BELIRSIZ olur).`,
        'kayit_yazilamadi',
      ),
    });
  }
  return true;
}

/** Sirada SIRA_BEKLEME_DK'yi asan kayitlar PLAN_ESKIDI (DB saatiyle). */
async function siraEskit() {
  const { rows } = await db().query(
    `SELECT * FROM server_hub_ear_temizlik WHERE durum = 'PLAN_HAZIR' AND sil_istendi_at < DATEADD(minute, -${SIRA_BEKLEME_DK}, SYSUTCDATETIME()) ORDER BY id`,
  );
  const hostlar = new Set();
  for (const r of rows || []) {
    const u = await db().query(
      `UPDATE server_hub_ear_temizlik SET durum = 'PLAN_ESKIDI', sonuc = $2, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLAN_HAZIR' AND sil_istendi_at IS NOT NULL`,
      [r.id, SIRA_ESKIDI_NOTU],
    );
    if (u?.rowCount !== 1) continue;
    hostlar.add(r.host);
    denetim(sozdeIstek(r.sil_isteyen || r.olusturan), {
      op: 'ear_temizlik_sonuc',
      faz: 'sira',
      id: r.id,
      host: r.host,
      kok: r.kok,
      ad: r.ad,
      durum: 'PLAN_ESKIDI',
    });
  }
  for (const h of hostlar) await envanterKontrol(h);
}

/** Tek kuyruk turu: sunucu basina tek SILINIYOR, toplamda en cok TOPLU_ESZAMANLI. */
async function kuyrukTuru(sonuc) {
  await siraEskit();
  const { rows } = await db().query(
    `SELECT * FROM server_hub_ear_temizlik WHERE durum IN ('PLAN_HAZIR', 'SILINIYOR') ORDER BY id`,
  );
  const hepsi = rows || [];
  const mesgul = new Set(hepsi.filter((x) => x.durum === 'SILINIYOR').map((x) => x.host));
  let suren = hepsi.filter((x) => x.durum === 'SILINIYOR').length;
  const sira = hepsi
    .filter(siradaMi)
    .sort(
      (a, b) =>
        new Date(a.sil_istendi_at).getTime() - new Date(b.sil_istendi_at).getTime() || a.id - b.id,
    );
  let a;
  for (const r of sira) {
    if (suren >= TOPLU_ESZAMANLI) break;
    if (mesgul.has(r.host)) continue;
    // Sirada beklerken bulgu kalkmis / engel olusmus olabilir: baslatmadan once onbellekli degerlendirmeyle yeniden
    // denetlenir (betigin silme anindaki kapilarinin onunde ikinci savunma). Degerlendirme okunamazsa bu tur
    // HICBIR kayit baslamaz (fail-closed); kayitlar sirada kalir.
    if (a === undefined) {
      try {
        a = await _d.getAssessment(false);
      } catch (e) {
        console.warn(
          '[EarTemizlik] kuyruk: degerlendirme okunamadi, baslatma ertelendi:',
          e?.message,
        );
        return;
      }
    }
    if (!(await siradanDusur(r, a, sonuc))) continue;
    // CAS'i kaybetse de (baska tur baslatti / iptal edildi) sunucu bu tur icin dolu sayilir: temkinli.
    mesgul.add(r.host);
    suren += 1;
    await baslat(r, sonuc);
  }
}

/**
 * Sirada kayit icin bulgu kapisi: gecerse true. Gecmezse kayit CAS ile IPTAL olur (neden kayitta), yanit bekleyen
 * tekli istege hata iletilir; false.
 */
async function siradanDusur(r, a, sonuc) {
  try {
    bulguKapisi(a, r);
    return true;
  } catch (e) {
    const not = `sırada iken yeniden denetlendi: ${M(e?.message, 300)}`;
    const u = await db().query(
      `UPDATE server_hub_ear_temizlik SET durum = 'IPTAL', sonuc = $2, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLAN_HAZIR' AND sil_istendi_at IS NOT NULL`,
      [r.id, M(not, 1000)],
    );
    if (u?.rowCount === 1) {
      denetim(sozdeIstek(r.sil_isteyen || r.olusturan), {
        op: 'ear_temizlik_sonuc',
        faz: 'sira',
        id: r.id,
        host: r.host,
        kok: r.kok,
        ad: r.ad,
        durum: 'IPTAL',
      });
      sonuc.set(r.id, { hata: e });
      await envanterKontrol(r.host);
    }
    return false;
  }
}

/** Kuyrugu ilerlet; donus: bu cagrinin (ve bagli turlarin) baslatma sonuclari (id -> { basladi } | { hata }). */
function kuyrukIlerlet() {
  if (_kuyrukSurer) {
    _kuyrukTekrar = true;
    return _kuyrukSurer;
  }
  const sonuc = new Map();
  _kuyrukSurer = (async () => {
    try {
      do {
        _kuyrukTekrar = false;
        await kuyrukTuru(sonuc);
      } while (_kuyrukTekrar);
      return sonuc;
    } finally {
      _kuyrukSurer = null;
    }
  })();
  return _kuyrukSurer;
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

/**
 * POST on-kontrol: taze bulgu dogrulamasi -> kayit -> salt okunur plan isi. Toplu on kontrol ayni taze
 * degerlendirmeyi (degerlendirme) tum ogelere verir.
 */
async function onKontrol(req, body, degerlendirme) {
  const { host, kok, ad } = girdiDogrula(body);
  const a = degerlendirme || (await _d.getAssessment(true));
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
    id = r.rows?.[0]?.id;
  } catch (e) {
    if (/UX_shet_aktif|duplicate key|UNIQUE/i.test(String(e?.message)))
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
    const not = e?.launchBelirsiz
      ? 'AWX yanıtı belirsiz (salt okunur ön kontrol; yeniden deneyin)'
      : 'ön kontrol başlatılamadı';
    await gecis(id, 'PLANLANIYOR', 'PLAN_HATA', { sonuc: M(`${not}: ${e?.message}`, 1000) });
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

/**
 * Kaydin sil isteminden once gecmesi gereken kapilar (CAS'tan once; CAS ayrica yeniden denetler). adKontrol=false:
 * toplu silme (onay metni orada "<n> EAR SIL"; EAR adi kayit basina sorulmaz).
 */
function silKapilari(r, body, adKontrol = true) {
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
  if (siradaMi(r)) throw hata(409, `Kayıt #${r.id} için silme zaten istendi (sırada).`, 'sirada');
  if (adKontrol && String(body.onayMetni ?? '') !== r.ad)
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

/** Silme aninda taze bulgu hala var ve engel yok; degilse hata atar. */
function bulguKapisi(a, r) {
  const aday = adayBul(a, r.host, r.kok, r.ad);
  if (!aday)
    throw hata(
      409,
      `${r.kok}/${r.ad} için "EAR içinde WAR yok" bulgusu artık yok — silinmedi.`,
      'bulgu_yok',
    );
  if (aday.engel) throw hata(409, `${r.kok}/${r.ad}: ${aday.engel} — silinmedi.`, 'engel');
}

/**
 * Silme istegi CAS'i: yalniz PLAN_HAZIR, ayni plan isi, henuz istenmemis (sil_istendi_at IS NULL) ve plan suresi
 * DB saatine gore gecerliyse sil_istendi_at / sil_isteyen / toplu_id yazar. Donus: yazildi mi.
 */
async function silIste(id, planJobId, kim, topluId) {
  const r = await db().query(
    `UPDATE server_hub_ear_temizlik SET sil_istendi_at = SYSUTCDATETIME(), sil_isteyen = $2, onaylayan = $2, toplu_id = $4, updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLAN_HAZIR' AND plan_job_id = $3 AND sil_istendi_at IS NULL AND plan_bitis_at > DATEADD(minute, -${PLAN_GECERLILIK_DK}, SYSUTCDATETIME())`,
    [id, kim, Number(planJobId), topluId],
  );
  return !!r && r.rowCount === 1;
}

/**
 * POST :id/sil: kapilar -> taze bulgu -> CAS silme istendi -> kuyruk. Sunucu bossa kayit hemen SILINIYOR olur
 * (launch plan_only=false, ear_fp); sunucuda baska silme suruyorsa sirada kalir.
 */
async function sil(req, id, body) {
  await eskit();
  const r = await kayitOku(id);
  if (!r) throw hata(404, `Kayıt #${id} yok.`, 'kayit_yok');
  silKapilari(r, body);
  bulguKapisi(await _d.getAssessment(true), r);
  const kim = kullanici(req);
  if (!(await silIste(id, r.plan_job_id, kim, null))) {
    await eskit();
    const g = await kayitOku(id);
    if (g?.durum === 'PLAN_ESKIDI')
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
  _istekler.set(id, req);
  let sonuc = new Map();
  try {
    sonuc = await kuyrukIlerlet();
  } catch (e) {
    // Silme istendi ve kayitta: kuyruk hatasi istegi dusurmez (yurutucu / GET devam ettirir); kayit sirada doner.
    console.error(`[EarTemizlik] kayit #${id} icin kuyruk ilerletilemedi:`, e?.message);
  } finally {
    _istekler.delete(id);
  }
  const s = sonuc.get(id);
  if (s?.hata) throw s.hata;
  const kayit = kayitSatiri(await kayitOku(id));
  // Kuyruk hatasi sonucu yuttuysa ve istek geri alindiysa (PLAN_HAZIR, sirada degil) basari denmez.
  if (kayit?.durum === 'PLAN_HAZIR' && !kayit.sirada)
    throw hata(
      502,
      `Kayıt #${id} için silme işi başlatılamadı — kayıt hazır ön kontrole döndü; yeniden deneyin.`,
      'baslatilamadi',
    );
  if (kayit?.sirada)
    denetim(req, {
      op: 'ear_temizlik_sil',
      id,
      host: r.host,
      kok: r.kok,
      ad: r.ad,
      prod: r.prod === true || r.prod === 1,
      sirada: true,
    });
  return kayit;
}

/** POST :id/iptal: PLAN_HAZIR (sirada olan dahil) -> IPTAL. */
async function iptal(req, id) {
  await eskit();
  const once = await kayitOku(id);
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
  const sirada = siradaMi(once);
  denetim(req, {
    op: 'ear_temizlik_iptal',
    id,
    host: r?.host,
    kok: r?.kok,
    ad: r?.ad,
    ...(sirada ? { sirada: true } : {}),
  });
  if (sirada && r) await envanterKontrol(r.host);
  return kayitSatiri(r);
}

/** GET liste: suren kayitlar ve kuyruk ilerletilir, adaylar taze bulgudan, son 50 kayit. */
async function liste(fresh) {
  await eskit();
  await surenleriIlerlet();
  const [a, son, aktif] = await Promise.all([
    _d.getAssessment(fresh === true),
    db().query(`SELECT TOP ${SON_KAYIT} * FROM server_hub_ear_temizlik ORDER BY id DESC`),
    // Son 50'ye ek olarak TUM aktif kayitlar (50 ogelik toplu islem + yeni kayitlar: sirada olan listeden dusmez).
    db().query(
      `SELECT * FROM server_hub_ear_temizlik WHERE durum IN (${IN(AKTIF)}) ORDER BY id DESC`,
    ),
  ]);
  const birlesik = new Map();
  for (const r of [...(son?.rows || []), ...(aktif?.rows || [])]) birlesik.set(Number(r.id), r);
  const kayitlar = [...birlesik.values()]
    .sort((x, y) => Number(y.id) - Number(x.id))
    .map(kayitSatiri);
  const adaylar = a?.tableMissing ? [] : adaylariTuret(a);
  for (const x of adaylar)
    x.kayit = kayitlar.find((k) => k.host === x.host && k.kok === x.kok && k.ad === x.ad) || null;
  return { planGecerlilikDk: PLAN_GECERLILIK_DK, adaylar, kayitlar };
}

/**
 * GET :id: suren kayit ilerletilir; sirada kayitta ayni sunucudaki SILINIYOR kayit ilerletilir. Ikisinde de
 * ardindan kuyruk (biten silme yer acmis olabilir).
 */
async function tekKayit(id) {
  await eskit();
  const r = await kayitOku(id);
  if (!r) throw hata(404, `Kayıt #${id} yok.`, 'kayit_yok');
  const sirada = siradaMi(r);
  if (!SUREN.includes(r.durum) && !sirada) return kayitSatiri(r);
  if (sirada) {
    const { rows } = await db().query(
      `SELECT * FROM server_hub_ear_temizlik WHERE host = $1 AND durum = 'SILINIYOR' ORDER BY id`,
      [r.host],
    );
    for (const x of rows || []) await ilerlet(x);
  } else await ilerlet(r);
  if (sirada || r.durum === 'SILINIYOR') await kuyrukIlerlet();
  return kayitSatiri(await kayitOku(id));
}

// ── TOPLU ────────────────────────────────────────────────────────────────────────────────────────

/** Toplu oge listesi: dizi, 1..TOPLU_MAX. */
function topluListe(liste, ad) {
  if (!Array.isArray(liste) || !liste.length) throw hata(400, `${ad} boş olamaz.`, 'toplu_bos');
  if (liste.length > TOPLU_MAX)
    throw hata(400, `Tek seferde en çok ${TOPLU_MAX} öğe (${liste.length} geldi).`, 'toplu_fazla');
  return liste;
}

/** POST toplu/on-kontrol: her aday icin ayri on kontrol (kismi basari serbest). */
async function topluOnKontrol(req, body) {
  const liste = topluListe(body?.adaylar, 'Aday listesi');
  // Oge basina girdi denetimi (kismi basari): gecersiz oge sonuclarda ok:false; tekillik gecerli ogeler uzerinde.
  const girdiler = liste.map((x) => {
    const o = x && typeof x === 'object' ? x : {};
    try {
      return girdiDogrula(o);
    } catch (e) {
      return {
        host: M(o.host, 128),
        kok: M(o.kok, 64),
        ad: M(o.ad, 256),
        gecersiz: e,
      };
    }
  });
  const gecerli = girdiler.filter((g) => !g.gecersiz);
  const anahtarlar = new Set(gecerli.map((g) => `${g.host}\t${g.kok}\t${g.ad}`));
  if (anahtarlar.size !== gecerli.length)
    throw hata(400, 'Aynı EAR listede birden fazla kez var.', 'toplu_tekrar');
  const a = await _d.getAssessment(true);
  const sonuclar = [];
  const hatalar = [];
  for (const { gecersiz, ...g } of girdiler) {
    if (gecersiz) {
      hatalar.push(gecersiz);
      sonuclar.push({ ...g, ok: false, message: M(gecersiz.message, 500) });
      continue;
    }
    try {
      const k = await onKontrol(req, g, a);
      sonuclar.push({ ...g, ok: true, id: k.id });
    } catch (e) {
      hatalar.push(e);
      sonuclar.push({ ...g, ok: false, message: M(e?.message, 500) });
    }
  }
  const basarili = sonuclar.filter((x) => x.ok).length;
  const basarisiz = sonuclar.length - basarili;
  denetim(req, {
    op: 'ear_temizlik_toplu_plan',
    basarili,
    basarisiz,
    ogeler: sonuclar.slice(0, TOPLU_MAX).map((x) => ({
      host: x.host,
      kok: x.kok,
      ad: x.ad,
      ok: x.ok,
      ...(x.id ? { id: x.id } : {}),
    })),
  });
  const ek = { sonuclar, basarili, basarisiz };
  if (!basarili) {
    // AWX'e ulasilamadi: 5xx ya da durum kodu olmayan belirsiz launch (ag kopmasi) -> 5xx (HTTP'de 424).
    const awxHatasi = (e) => !!e && (Number(e.status) >= 500 || !!e.launchBelirsiz);
    const awx = hatalar.every(awxHatasi);
    let e;
    if (awx) {
      const durum = Number(hatalar[0].status);
      e = hata(
        durum >= 500 ? durum : 502,
        `Hiçbir ön kontrol başlatılamadı (AWX: ${M(hatalar[0].message, 200)}).`,
        'toplu_awx',
      );
    } else e = hata(409, 'Hiçbir ön kontrol başlatılamadı.', 'toplu_hicbiri');
    throw Object.assign(e, { ek });
  }
  return ek;
}

/**
 * POST toplu/sil: HEPSI-YA-HIC dogrulama (biri bile gecmezse hicbir kayit degismez) -> her kayda CAS ile silme
 * istegi + ortak toplu_id -> kuyruk. CAS'i kaybeden kayit (arada degisti) yanitta kaybedenler'de.
 */
async function topluSil(req, body) {
  const liste = topluListe(body?.kayitlar, 'Kayıt listesi');
  const ogeler = liste.map((x) => {
    const id = Number(x?.id);
    if (!Number.isInteger(id) || id <= 0)
      throw hata(400, 'Geçersiz kayıt numarası.', 'gecersiz_id');
    return { id, planJobId: x.planJobId };
  });
  if (new Set(ogeler.map((x) => x.id)).size !== ogeler.length)
    throw hata(400, 'Aynı kayıt listede birden fazla kez var.', 'toplu_tekrar');
  const beklenen = `${ogeler.length} EAR SIL`;
  if (String(body?.onayMetni ?? '') !== beklenen)
    throw hata(409, `Onay için tam "${beklenen}" yazılmalı.`, 'onay_metni');
  await eskit();
  const { rows } = await db().query(
    `SELECT * FROM server_hub_ear_temizlik WHERE id IN (${ogeler.map((_, i) => '$' + (i + 1)).join(', ')}) ORDER BY id`,
    ogeler.map((x) => x.id),
  );
  const kayitlar = new Map((rows || []).map((r) => [Number(r.id), r]));
  const a = await _d.getAssessment(true);
  const reddedilenler = [];
  for (const o of ogeler) {
    const r = kayitlar.get(o.id);
    try {
      if (!r) throw hata(404, `Kayıt #${o.id} yok.`, 'kayit_yok');
      silKapilari(r, { planJobId: o.planJobId }, false);
      bulguKapisi(a, r);
    } catch (e) {
      reddedilenler.push({ id: o.id, message: M(e?.message, 500) });
    }
  }
  if (reddedilenler.length)
    throw Object.assign(
      hata(
        409,
        `${reddedilenler.length} kayıt silmeye uygun değil — hiçbir kayıt değişmedi.`,
        'toplu_red',
      ),
      { ek: { reddedilenler } },
    );
  const topluId = crypto.randomUUID();
  const kim = kullanici(req);
  const isaretli = [];
  const kaybedenler = [];
  let isaretHatasi = null;
  for (const o of ogeler) {
    // Isaretleme yarida DB hatasiyla kesilirse isaretlenenler (kullanici onayladi) kuyrukta silinir: yanit da
    // basari + kaybedenler olur ("hata" deyip arkada silmek yok). Hicbiri isaretlenemediyse hata yukari gider.
    if (isaretHatasi) {
      kaybedenler.push(o.id);
      continue;
    }
    try {
      if (await silIste(o.id, kayitlar.get(o.id).plan_job_id, kim, topluId)) isaretli.push(o.id);
      else kaybedenler.push(o.id);
    } catch (e) {
      console.error(`[EarTemizlik] toplu ${topluId} kayit #${o.id} isaretlenemedi:`, e?.message);
      isaretHatasi = e;
      kaybedenler.push(o.id);
    }
  }
  if (isaretHatasi && !isaretli.length) throw isaretHatasi;
  const prod = isaretli.filter((id) => {
    const r = kayitlar.get(id);
    return r.prod === true || r.prod === 1;
  }).length;
  denetim(req, {
    op: 'ear_temizlik_toplu_sil',
    topluId,
    istenen: ogeler.length,
    isaretlenen: isaretli.length,
    prod,
    kaybedenler,
    ogeler: isaretli.map((id) => {
      const r = kayitlar.get(id);
      return { id, host: r.host, kok: r.kok, ad: r.ad };
    }),
  });
  if (!isaretli.length)
    throw Object.assign(
      hata(
        409,
        'Kayıtların hiçbiri işaretlenemedi (bu arada durumları değişti) — sayfayı yenileyin.',
        'toplu_kaybedildi',
      ),
      {
        ek: {
          kaybedenler,
          reddedilenler: kaybedenler.map((id) => ({ id, message: 'Bu arada durumu değişti.' })),
        },
      },
    );
  // Isaretlenen kayitlar artik kuyrukta: kuyruk / sayim hatasi istegi DUSURMEZ (kuyruk yurutucusu ve GET uclari
  // devam ettirir); sayilar o durumda isaretlenenlerden turetilir.
  let sonuc = new Map();
  try {
    sonuc = await kuyrukIlerlet();
  } catch (e) {
    console.error(`[EarTemizlik] toplu ${topluId} kuyruk ilerletilemedi:`, e?.message);
  }
  const baslatilan = isaretli.filter((id) => sonuc.get(id)?.basladi).length;
  let sirada = isaretli.length - baslatilan;
  try {
    const { rows: sonra } = await db().query(
      `SELECT * FROM server_hub_ear_temizlik WHERE toplu_id = $1 ORDER BY id`,
      [topluId],
    );
    sirada = (sonra || []).filter(siradaMi).length;
  } catch (e) {
    console.error(`[EarTemizlik] toplu ${topluId} sayilamadi:`, e?.message);
  }
  return { topluId, sirada, baslatilan, ...(kaybedenler.length ? { kaybedenler } : {}) };
}

/** POST toplu/:topluId/iptal: o toplu islemde hala sirada olanlar IPTAL (CAS); SILINIYOR olanlara dokunulmaz. */
async function topluIptal(req, topluId) {
  const t = String(topluId || '').toLowerCase();
  if (!UUID_RE.test(t)) throw hata(400, 'Geçersiz toplu işlem kimliği.', 'gecersiz_toplu');
  const { rows } = await db().query(
    `SELECT * FROM server_hub_ear_temizlik WHERE toplu_id = $1 ORDER BY id`,
    [t],
  );
  if (!rows?.length) throw hata(404, `Toplu işlem ${t} yok.`, 'toplu_yok');
  const iptalEdilen = [];
  for (const r of rows.filter(siradaMi)) {
    const u = await db().query(
      `UPDATE server_hub_ear_temizlik SET durum = 'IPTAL', updated_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLAN_HAZIR' AND sil_istendi_at IS NOT NULL AND toplu_id = $2`,
      [r.id, t],
    );
    if (u?.rowCount === 1) iptalEdilen.push(r);
  }
  const { rows: sonra } = await db().query(
    `SELECT * FROM server_hub_ear_temizlik WHERE toplu_id = $1 ORDER BY id`,
    [t],
  );
  const suren = (sonra || []).filter((x) => x.durum === 'SILINIYOR').length;
  denetim(req, {
    op: 'ear_temizlik_toplu_iptal',
    topluId: t,
    iptal: iptalEdilen.length,
    suren,
    ogeler: iptalEdilen.map((r) => ({ id: r.id, host: r.host, kok: r.kok, ad: r.ad })),
  });
  for (const h of new Set(iptalEdilen.map((r) => r.host))) await envanterKontrol(h);
  return { iptal: iptalEdilen.length, suren };
}

// ── YURUTUCU ─────────────────────────────────────────────────────────────────────────────────────

// Kuyruk sekmeye bagli kalmasin: onaylanmis silmeler kullanici sayfayi kapatsa da siradan baslar (yoksa sirada
// SIRA_BEKLEME_DK sonra PLAN_ESKIDI olurdu). Tur = GET listesinin ilerletmesiyle ayni is (surenler + kuyruk);
// ayni anda GET ile cakisirsa CAS ve surec ici kuyruk kilidi tek kazanani korur.
const YURUTUCU_SN = 30;
let _timer = null;
let _turSurer = false;

/** Tek yurutucu turu; bagimliliklar kurulmadiysa (mount olmadi) hicbir sey yapmaz. Donus: tur kostu mu. */
async function yurutucuTuru() {
  if (!_d || _turSurer) return false;
  _turSurer = true;
  try {
    await eskit();
    await surenleriIlerlet();
    return true;
  } finally {
    _turSurer = false;
  }
}

function startPoller() {
  if (_timer) return;
  _timer = setInterval(() => {
    yurutucuTuru().catch((e) => console.warn('[EarTemizlik] yurutucu turu hatasi:', e?.message));
  }, YURUTUCU_SN * 1000);
  if (_timer.unref) _timer.unref();
  console.log(`[EarTemizlik] yurutucu basladi (${YURUTUCU_SN} sn)`);
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
        err?.message,
      );
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return res.status(424).json({
          ok: false,
          message: err.message,
          code: err.code || 'ear_temizlik_sunucu_hatasi',
          upstreamStatus: status,
          nginxRed: true,
          ...(err.ek || {}),
        });
    }
    return res.status(status).json({
      ok: false,
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.ek || {}),
    });
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

  // TOPLU uclar :id uclarindan ONCE: '/ear-temizlik/:id/sil' 'toplu/sil'i de eslerdi.
  router.post('/ear-temizlik/toplu/on-kontrol', async (req, res) => {
    try {
      res.json({ ok: true, ...(await topluOnKontrol(req, req.body)) });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.post('/ear-temizlik/toplu/sil', async (req, res) => {
    if (req.body?.confirmed !== true)
      return res.status(400).json({ ok: false, message: 'Bu işlem açık onay ister (confirmed).' });
    try {
      res.json({ ok: true, ...(await topluSil(req, req.body)) });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.post('/ear-temizlik/toplu/:topluId/iptal', async (req, res) => {
    try {
      res.json({ ok: true, ...(await topluIptal(req, req.params.topluId)) });
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
      const kayit = await sil(req, id, req.body);
      res.json({ ok: true, kayit, sirada: !!kayit?.sirada });
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
  ENGEL_KULLANIM,
  ENVANTER_SURUYOR,
  ENVANTER_BEKLIYOR,
  SIRA_ESKIDI_NOTU,
  TOPLU_MAX,
  TOPLU_ESZAMANLI,
  SIRA_BEKLEME_DK,
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
  kuyrukIlerlet,
  topluOnKontrol,
  topluSil,
  topluIptal,
  yurutucuTuru,
  startPoller,
  YURUTUCU_SN,
};
