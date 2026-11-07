// server/server-hub/ear-envanter-poller.cjs - Uygulama Envanteri kosu yurutucusu (2026-11-04).
//
// KOSU = bir tarama (filo ya da secili sunucular, OZET ya da TAM). Hedefler PARTI'lere bolunur
// (ayar: parti_ozet / parti_tam, en cok 100) ve partiler SIRAYLA AWX'e gider: 1000+ sunucu tek iste
// AWX olay tablosunu ve bellegini sisirirdi. Ayni anda TEK calisan kosu, kosu basina TEK calisan parti.
//
// Desen nginx-loadtest/poller.cjs: setInterval + unref + _ticking; her durum gecisi kosullu UPDATE
// (CAS) ile, iki Portal sureci ayni partiyi iki kez baslatmaz ya da iki kez almaz.
//
// PARTI: BEKLIYOR -> CALISIYOR (AWX isi) -> ALINIYOR (/sw ham dosyalari -> DB) -> BITTI
//        BEKLIYOR -> HATA (baslatma 3 kez basarisiz) | IPTAL (kosu iptal)
// ALIM: set_stats (ear_envanter_result) yalniz playbook'un host basina SINIFLAMASI icin okunur; veri
// her zaman /sw'deki ham dosyadan gelir. Is iptal edilse / dusse de yazilmis dosyalar alinir.
// Beklenen ama sonucu olmayan host SONUC_YOK olur: "gelmedi" sessizce "taranmadi"ya donusmez.
// OKUNAMADI != BASARI: AWX okunamazsa parti oldugu gibi kalir (sonraki tur); alim yarida kalirsa
// (surec yeniden basladi) ALINIYOR satiri 10 dk sonra yeniden alinir, en cok 3 deneme.
//
// ZAMANLAYICI: haftalik (ear-envanter-ayar.cjs). Ayni haftanin ikinci kosusunu
// kosulari.zamanlayici_anahtari engeller; kosu acma kosulu tek ifadede (UPDLOCK + HOLDLOCK).
//
// AWX KOSUSU (2026-11-05): AWX'ten Limit ile elle baslatilan is ear-envanter-awx.cjs ile tek partili
// kosu (kaynak AWX) olarak acilir; alimi burada, ayni yoldan. set_stats eslesmesi AWX is numarasiyla,
// ham dosyalar awx-<is>/raw altinda.
'use strict';

const alim = require('./ear-envanter-alim.cjs');
const ayar = require('./ear-envanter-ayar.cjs');

const REGISTRY_KEY = 'server_hub_ear_envanter';
const TEMPLATE_ADI = 'Server Hub — Uygulama Envanteri';
const STATS_ANAHTARI = 'ear_envanter_result';
const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const POLL_SN = 30;
const BASLATMA_DENEME = 3;
const ALIM_DENEME = 3;
const ALIM_BAYAT_DK = 10;
const KAYIP_IS_DK = 30;
const SAKLAMA_ARALIK_MS = 6 * 60 * 60 * 1000;
const FILO_SINIRI = 5000;
// Yapilandirma hatasi: tekrar denemek bir sey degistirmez, kosu durur (template yok / yanlis sablon /
// prompt on launch kapali / gecersiz girdi).
const YAPILANDIRMA_KODLARI = new Set([400, 409, 422, 501]);

let _launch = null;
let _timer = null;
let _ticking = false;
let _sonSaklama = 0;

const db = () => require('../db/index.cjs');
const runner = () => require('../ansible/runner.cjs');
const maskele = (s) => require('../retirement/is-ciktisi.cjs').maskele(String(s == null ? '' : s));
const M = (v, n) => String(v == null ? '' : v).slice(0, n);

/** server-hub/index.cjs launch()'u verir (registry + preflight + is gecmisi + denetim). */
function kur({ launch }) {
  _launch = typeof launch === 'function' ? launch : null;
}

function hata(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

/** Kosu satirindaki parametreler (JSON metin) -> nesne. */
function parametreler(kosu) {
  try {
    const p =
      typeof kosu.parametreler === 'string' ? JSON.parse(kosu.parametreler) : kosu.parametreler;
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

function hostlarOf(parti) {
  try {
    const h = typeof parti.hostlar === 'string' ? JSON.parse(parti.hostlar) : parti.hostlar;
    return Array.isArray(h) ? h.filter((x) => x && alim.HOST_RE.test(String(x.host))) : [];
  } catch {
    return [];
  }
}

/** Poller'in AWX'e "kim istedi" diye verecegi sozde istek (launch req ister; null olamaz). */
function sozdeIstek(kosu) {
  const zamanlayici = kosu.kaynak === 'ZAMANLAYICI';
  const ad = zamanlayici ? 'ear-envanter-zamanlayici' : M(kosu.baslatan, 128) || 'unknown';
  return {
    session: {
      user: {
        username: ad,
        displayName: zamanlayici ? 'Uygulama Envanteri zamanlayıcısı' : ad,
        role: zamanlayici ? 'system' : 'Admin',
      },
    },
    sessionID: null,
    ip: null,
  };
}

// ── HEDEFLER ────────────────────────────────────────────────────────────────────────────────────

/**
 * Filo: JBoss uygulama envanterindeki (dbo.MWAppsInventory, SALT OKUNUR) tum hostlar ve ortamlari.
 * Gecersiz adli host dislanir ve sayilir (playbook'un host regex'i ile ayni).
 */
async function filoHedefleri() {
  const { query } = require('../inventory/mssql.cjs');
  const { getAppsTable } = require('../config/apps-table.cjs');
  const tablo = getAppsTable();
  const r = await query(
    `SELECT host, env FROM ${tablo.includes('.') ? tablo : `dbo.${tablo}`} WHERE host IS NOT NULL AND LTRIM(RTRIM(host)) <> '' GROUP BY host, env`,
  );
  return hedefleriDuzle((r.recordset || []).map((x) => ({ host: x.host, ortam: x.env })));
}

/**
 * WEB SUNUCULARI (2026-11-07, Faz W): Server Hub'in son taramasinda urunlerinde IHS ya da RHA olan sunucular
 * (dbo.Server_Hub_Hosts, SALT OKUNUR). 3-tier web sunuculari JBoss envanterinde (MWAppsInventory) yoktur.
 * Okunamazsa 424: "web sunucusu yok" denmez.
 */
async function webHedefleri() {
  const { query } = require('../inventory/mssql.cjs');
  let r;
  try {
    r = await query(
      `SELECT h.host, h.products FROM dbo.Server_Hub_Hosts h
         JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_Hosts GROUP BY host) m
           ON m.host = h.host AND m.d = h.scan_date`,
    );
  } catch (e) {
    throw hata(424, `Server Hub sunucu listesi okunamadı: ${M(maskele(e && e.message), 200)}`, 'web_listesi_okunamadi');
  }
  return hedefleriDuzle(
    (r.recordset || [])
      .filter((x) =>
        String(x.products || '')
          .split(/[\s,]+/)
          .some((u) => /^(IHS|RHA)/i.test(u)),
      )
      .map((x) => ({ host: String(x.host || '').split('.')[0], ortam: '' })),
  );
}

/**
 * KAPSAM (2026-11-05): FILO | SORUNLU | ORTAM:A,B | WEB | FILO_WEB | SECILI (liste). Planlar ve elle tarama ayni cozucuyu
 * kullanir. SORUNLU: filodaki sunuculardan son denemesi TAM ya da KOK_YOK olmayanlar ve hic taranmamislar
 * (filodan cikmis sunucu taranmaz). ORTAM: sunucunun envanter ortamlarindan biri (normalize) listede.
 */
const SORUN_DEGIL = Object.freeze(['TAM', 'KOK_YOK']);

async function kapsamHedefleri(kapsam, hostlar) {
  if (kapsam === 'SECILI') return hedefleriDuzle(hostlar);
  if (kapsam === 'WEB') return webHedefleri();
  if (kapsam === 'FILO_WEB') {
    const [f, w] = await Promise.all([filoHedefleri(), webHedefleri()]);
    const birlesik = hedefleriDuzle([...f.hedefler, ...w.hedefler]);
    return { hedefler: birlesik.hedefler, gecersiz: f.gecersiz + w.gecersiz };
  }
  const filo = await filoHedefleri();
  if (kapsam === 'FILO') return filo;
  if (String(kapsam).startsWith('ORTAM:')) {
    const istenen = new Set(String(kapsam).slice(6).split(','));
    return {
      hedefler: filo.hedefler.filter((h) =>
        String(h.ortam || '')
          .split(',')
          .some((o) => istenen.has(o.trim().toUpperCase())),
      ),
      gecersiz: filo.gecersiz,
    };
  }
  if (kapsam === 'SORUNLU') {
    const { rows } = await db().query(
      `WITH son AS (SELECT host, MAX(kosu_id) AS kosu_id FROM ear_envanter_hostlari GROUP BY host)
       SELECT h.host, h.durum FROM ear_envanter_hostlari h JOIN son ON son.host = h.host AND son.kosu_id = h.kosu_id`,
    );
    // KOK_YOK bir cevaptir (o sunucuda uygulama yok): sorun sayilmaz.
    const iyi = new Set(
      (rows || [])
        .filter((r) => SORUN_DEGIL.includes(String(r.durum)))
        .map((r) => String(r.host).toUpperCase()),
    );
    return { hedefler: filo.hedefler.filter((h) => !iyi.has(h.host)), gecersiz: filo.gecersiz };
  }
  throw hata(400, 'Kapsam FILO, SORUNLU, ORTAM, WEB, FILO_WEB ya da SECILI olmalı.', 'gecersiz_kapsam');
}

/** Filodaki ortamlar ve sunucu sayilari (acilir liste; MWAppsInventory SALT OKUNUR). */
async function ortamlar() {
  const { hedefler } = await filoHedefleri();
  const sayi = new Map();
  for (const h of hedefler)
    for (const o of new Set(
      String(h.ortam || '')
        .split(',')
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    ))
      sayi.set(o, (sayi.get(o) || 0) + 1);
  return [...sayi.entries()]
    .map(([ortam, sunucu]) => ({ ortam, sunucu }))
    .sort((a, b) => b.sunucu - a.sunucu || (a.ortam < b.ortam ? -1 : 1));
}

/** Baslatmadan once: kac sunucu, kac parti (kosu acmaz). */
async function kapsamOnizleme(kapsam, kip) {
  const a = (await ayar.oku()).deger;
  const { hedefler } = await kapsamHedefleri(kapsam, []);
  const n = Math.max(1, Math.min(100, Number(kip === 'TAM' ? a.parti_tam : a.parti_ozet) || 50));
  return {
    sunucu: hedefler.length,
    parti: Math.ceil(hedefler.length / n),
    ornek: hedefler.slice(0, 10).map((h) => h.host),
  };
}

/** [{host, ortam}] -> tekil, BUYUK harf, sirali; ayni hostun ortamlari ',' ile birlesir. */
function hedefleriDuzle(liste) {
  const harita = new Map();
  let gecersiz = 0;
  for (const x of liste || []) {
    const h = String((x && x.host) || '')
      .trim()
      .toUpperCase();
    if (!alim.HOST_RE.test(h)) {
      if (h) gecersiz += 1;
      continue;
    }
    if (!harita.has(h)) harita.set(h, new Set());
    const o = String((x && x.ortam) || '').trim();
    if (o) harita.get(h).add(o);
  }
  const hedefler = [...harita.keys()]
    .sort()
    .map((host) => ({ host, ortam: M([...harita.get(host)].sort().join(','), 128) }));
  return { hedefler, gecersiz };
}

function partilereBol(hedefler, boyut) {
  const n = Math.max(1, Math.min(100, Number(boyut) || 50));
  const out = [];
  for (let i = 0; i < hedefler.length; i += n)
    out.push({
      parti_no: out.length + 1,
      hostlar: hedefler.slice(i, i + n),
      host_sayisi: Math.min(n, hedefler.length - i),
    });
  return out;
}

// ── KOSU ACMA ───────────────────────────────────────────────────────────────────────────────────

// Tek ifade: calisan kosu varsa (ya da bu haftanin zamanlayici kosusu zaten acildiysa) satir EKLENMEZ.
const KOSU_OLUSTUR_SQL = `SET XACT_ABORT ON;
DECLARE @id INT = NULL;
BEGIN TRAN;
INSERT INTO ear_envanter_kosulari (kip, kaynak, kapsam, durum, beklenen, parti_sayisi, parametreler, baslatan, zamanlayici_anahtari)
  SELECT $1, $2, $3, 'CALISIYOR', $4, $5, $6, $7, $8
   WHERE NOT EXISTS (SELECT 1 FROM ear_envanter_kosulari WITH (UPDLOCK, HOLDLOCK)
                      WHERE durum = 'CALISIYOR' OR ($8 IS NOT NULL AND zamanlayici_anahtari = $8)
                         OR ($10 IS NOT NULL AND zamanlayici_anahtari IN (SELECT value FROM OPENJSON($10))));
IF @@ROWCOUNT = 1
BEGIN
  SET @id = SCOPE_IDENTITY();
  INSERT INTO ear_envanter_partileri (kosu_id, parti_no, hostlar, host_sayisi, durum)
    SELECT @id, j.parti_no, j.hostlar, j.host_sayisi, 'BEKLIYOR'
      FROM OPENJSON($9) WITH (parti_no INT, hostlar NVARCHAR(MAX) AS JSON, host_sayisi INT) j;
END
COMMIT;
SELECT @id AS id;`;

/**
 * Yeni kosu. hedefler null -> filo. Calisan kosu varsa 409. req verilirse ilk parti HEMEN baslar
 * (yapilandirma hatasi kullaniciya o istekte doner); verilmezse poller baslatir.
 */
async function kosuOlustur({
  kip,
  hedefler = null,
  kapsam = null,
  kaynak = 'ELLE',
  baslatan,
  zamanlayiciAnahtari = null,
  esAnahtarlar = [],
  req = null,
}) {
  if (!['OZET', 'TAM'].includes(kip)) throw hata(400, 'Kip OZET ya da TAM olmalı.', 'gecersiz_kip');
  const a = (await ayar.oku()).deger;
  // Liste verildiyse SECILI; yoksa kapsam (verilmezse FILO: eski cagri).
  const k = hedefler != null ? 'SECILI' : ayar.kapsamDogrula(kapsam || 'FILO');
  if (!k) throw hata(400, 'Kapsam geçersiz.', 'gecersiz_kapsam');
  const cozulen = await kapsamHedefleri(k, hedefler);
  const liste = cozulen.hedefler;
  const gecersiz = cozulen.gecersiz || 0;
  if (k === 'SECILI' && gecersiz) throw hata(400, `${gecersiz} geçersiz sunucu adı.`, 'gecersiz_host');
  if (liste.length > FILO_SINIRI)
    throw hata(422, `Kapsam ${liste.length} sunucu; sınır ${FILO_SINIRI}.`, 'filo_siniri');
  if (!liste.length)
    throw hata(
      422,
      k === 'SORUNLU'
        ? 'Sorunlu sunucu yok: hepsinin son taraması tam (ya da kök yok).'
        : k.startsWith('ORTAM:')
          ? `Seçilen ortamlarda sunucu yok (${k.slice(6)}).`
          : 'Taranacak sunucu yok (envanter boş ya da liste boş).',
      'hedef_yok',
    );
  const partiler = partilereBol(liste, kip === 'TAM' ? a.parti_tam : a.parti_ozet);
  const p = {
    kokler: a.kokler,
    okuma_kullanicisi: a.okuma_kullanicisi,
    // Faz 2: kosu basladigi andaki ayar (sonradan degisse de partiler ayni davranir).
    deployment_kontrolu: a.deployment_kontrolu,
    // Faz W: kosu basladigi andaki web ayarlari.
    web_kontrolu: a.web_kontrolu,
    web_okuma_kullanicisi: a.web_okuma_kullanicisi,
    web_hc: a.web_hc,
    web_kokler: a.web_kokler,
    // Faz A: kosu basladigi andaki baglanti / WAS ayarlari.
    baglanti_kontrolu: a.baglanti_kontrolu,
    was_kokler: a.was_kokler,
    dizin: alim.earDizin(),
    parti_boyutu: partiler[0].host_sayisi,
    gecersiz_host: gecersiz,
    ...(k.startsWith('ORTAM:') ? { ortamlar: k.slice(6).split(',') } : {}),
  };
  const r = await db().query(
    KOSU_OLUSTUR_SQL,
    [
      kip,
      kaynak,
      k.startsWith('ORTAM:') ? 'ORTAM' : k,
      liste.length,
      partiler.length,
      JSON.stringify(p),
      M(baslatan, 128) || 'unknown',
      zamanlayiciAnahtari,
      JSON.stringify(
        partiler.map((x) => ({
          parti_no: x.parti_no,
          hostlar: x.hostlar,
          host_sayisi: x.host_sayisi,
        })),
      ),
      esAnahtarlar && esAnahtarlar.length ? JSON.stringify(esAnahtarlar) : null,
    ],
    { tekrar: false },
  );
  const id = r.rows && r.rows[0] ? r.rows[0].id : null;
  if (id == null) {
    if (zamanlayiciAnahtari) return null;
    throw hata(
      409,
      'Çalışan bir Uygulama Envanteri taraması var; bitmesini bekleyin ya da iptal edin.',
      'kosu_calisiyor',
    );
  }
  const kosuId = Number(id);
  let ilk = null;
  if (req) {
    const kosu = await kosuOku(kosuId);
    ilk = await siradakiPartiyiBaslat(kosu, req);
  }
  return { id: kosuId, beklenen: liste.length, partiSayisi: partiler.length, ilkParti: ilk };
}

async function kosuOku(id) {
  const { rows } = await db().query(`SELECT * FROM ear_envanter_kosulari WHERE id = $1`, [
    Number(id),
  ]);
  return rows && rows[0] ? rows[0] : null;
}

// ── PARTI BASLATMA ──────────────────────────────────────────────────────────────────────────────

function extraVarsOf(kosu, parti) {
  const p = parametreler(kosu);
  return {
    hedefler: hostlarOf(parti).map((h) => h.host),
    ear_kip: kosu.kip,
    ear_kosu_no: String(kosu.id),
    ear_parti_no: String(parti.parti_no),
    ear_dizin: p.dizin || alim.earDizin(),
    ear_okuma_kullanicisi: p.okuma_kullanicisi == null ? 'was' : p.okuma_kullanicisi,
    ear_kokler: p.kokler || '/vhosting:/vhosting8',
    // Faz 2 yalniz aciksa gonderilir (kapaliyken extra_vars eskisiyle birebir).
    ...(p.deployment_kontrolu === 'ACIK' ? { ear_deployment_kontrol: true } : {}),
    ...(p.baglanti_kontrolu === 'ACIK' ? { ear_baglanti_kontrol: true } : {}),
    ...(p.was_kokler ? { ear_was_kokler: p.was_kokler } : {}),
    // Faz W yalniz aciksa (kapaliyken extra_vars eskisiyle birebir).
    ...(p.web_kontrolu === 'ACIK'
      ? {
          ear_web_kontrol: true,
          ...(p.web_hc ? { ear_web_hc: p.web_hc } : {}),
          ...(p.web_kokler ? { ear_web_kokler: p.web_kokler } : {}),
          ...(p.web_okuma_kullanicisi ? { ear_web_okuma_kullanicisi: p.web_okuma_kullanicisi } : {}),
        }
      : {}),
  };
}

/**
 * Kosunun siradaki BEKLIYOR partisini baslatir. Kosu basina tek calisan parti: CAS kosulu.
 * Donus: { partiNo, jobId } | { bekliyor: true } | null (baslatilacak parti yok).
 */
async function siradakiPartiyiBaslat(kosu, req = null) {
  const { rows } = await db().query(
    `SELECT TOP 1 * FROM ear_envanter_partileri WHERE kosu_id = $1 AND durum = 'BEKLIYOR' ORDER BY parti_no`,
    [kosu.id],
  );
  const parti = rows && rows[0];
  if (!parti) return null;
  if (!_launch) return { bekliyor: true, neden: 'AWX başlatıcı hazır değil' };
  const al = await db().query(
    `UPDATE ear_envanter_partileri
        SET durum = 'CALISIYOR', baslatma_denemesi = baslatma_denemesi + 1, started_at = SYSUTCDATETIME(), hata = NULL
      WHERE id = $1 AND durum = 'BEKLIYOR'
        AND NOT EXISTS (SELECT 1 FROM ear_envanter_partileri x WITH (UPDLOCK, HOLDLOCK)
                         WHERE x.kosu_id = $2 AND x.durum IN ('CALISIYOR', 'ALINIYOR'))`,
    [parti.id, kosu.id],
    { tekrar: false },
  );
  if (al.rowCount !== 1) return { bekliyor: true };
  const deneme = Number(parti.baslatma_denemesi || 0) + 1;
  let sonuc;
  try {
    // Sablonun Limit'i doluyken is hicbir sey taramadan "successful" biter (EP8): baslatma.
    await require('./ear-envanter-awx.cjs').limitDenetimi();
    sonuc = await _launch(
      req || sozdeIstek(kosu),
      REGISTRY_KEY,
      TEMPLATE_ADI,
      extraVarsOf(kosu, parti),
      {
        action: 'ear_envanter',
        kosu: kosu.id,
        parti: parti.parti_no,
        kip: kosu.kip,
        hostSayisi: parti.host_sayisi,
      },
    );
  } catch (e) {
    const mesaj = M(maskele(e && e.message), 1000) || 'AWX işi başlatılamadı';
    const yapilandirma = YAPILANDIRMA_KODLARI.has(Number(e && e.status));
    if (yapilandirma) {
      await db().query(
        `UPDATE ear_envanter_partileri SET durum = 'BEKLIYOR', hata = $2 WHERE id = $1 AND durum = 'CALISIYOR'`,
        [parti.id, mesaj],
      );
      await kosuBitir(kosu.id, { durum: 'BASARISIZ', hata: mesaj });
      if (req) throw e;
      return { hata: mesaj };
    }
    const son = deneme >= BASLATMA_DENEME;
    await db().query(
      `UPDATE ear_envanter_partileri SET durum = $2, hata = $3, finished_at = CASE WHEN $2 = 'HATA' THEN SYSUTCDATETIME() ELSE NULL END
        WHERE id = $1 AND durum = 'CALISIYOR'`,
      [parti.id, son ? 'HATA' : 'BEKLIYOR', `${mesaj} (deneme ${deneme}/${BASLATMA_DENEME})`],
    );
    if (son) await sonucsuzHostlariYaz(kosu, parti, 'SONUC_YOK', `AWX işi başlatılamadı: ${mesaj}`);
    // Gecici hata: kosu acik kalir, poller yeniden dener; istek sahibine bu SOYLENIR (firlatilmaz).
    return { hata: mesaj, yenidenDenenecek: !son };
  }
  const bag = await launchSonucunuBagla(kosu, parti, sonuc);
  return { partiNo: parti.parti_no, jobId: sonuc.jobId ?? null, ...bag };
}

/**
 * AWX launch dis yan etkidir. Job ID ancak parent kosu ve claim edilen parti hala bizimse normal
 * yoldan baglanir. Arada Admin iptali veya DB yazim belirsizligi olursa isi fail-closed iptal et;
 * job kimligini ve uzlasma notunu ikinci, dar bir yazimla koru ki dis is takipsiz kalmasin.
 */
async function launchSonucunuBagla(kosu, parti, sonuc) {
  const awxServerId = Number(sonuc.awxServerId) || 0;
  const jobId = sonuc.jobId == null ? null : Number(sonuc.jobId);
  const awxDurum = M(sonuc.status, 16) || 'pending';
  let yazimHatasi = null;
  try {
    const r = await db().query(
      `UPDATE p
          SET awx_server_id = $2, awx_job_id = $3, awx_durum = $4
         FROM ear_envanter_partileri p
        WHERE p.id = $1 AND p.kosu_id = $5 AND p.durum = 'CALISIYOR'
          AND EXISTS (SELECT 1 FROM ear_envanter_kosulari k
                       WHERE k.id = $5 AND k.durum = 'CALISIYOR')`,
      [parti.id, awxServerId, jobId, awxDurum, kosu.id],
      { tekrar: false },
    );
    if (r.rowCount === 1) return {};
  } catch (e) {
    yazimHatasi = e;
  }

  let iptalEdildi = false;
  let iptalHatasi = null;
  if (jobId != null) {
    try {
      await runner().cancelJobOnServer(awxServerId, jobId);
      iptalEdildi = true;
    } catch (e) {
      iptalHatasi = e;
    }
  }
  const neden = yazimHatasi
    ? `AWX işi başladı; job kimliği normal yoldan yazılamadı: ${M(maskele(yazimHatasi.message), 500)}`
    : 'AWX işi başladıktan sonra koşu/parti sahipliği kaybedildi';
  let uzlasma = jobId == null
    ? `${neden}; AWX job kimliği yok, iptal doğrulanamadı`
    : iptalEdildi
      ? `${neden}; AWX iptali istendi`
      : `${neden}; AWX iptali başarısız: ${M(maskele(iptalHatasi && iptalHatasi.message), 300) || 'bilinmeyen hata'}`;
  let uzlasmaKaydi = false;
  try {
    const kurtarma = await db().query(
      `UPDATE ear_envanter_partileri
          SET awx_server_id = $2, awx_job_id = $3, awx_durum = $4, hata = $5
        WHERE id = $1
          AND (awx_job_id IS NULL OR (COALESCE(awx_server_id, 0) = $2 AND awx_job_id = $3))`,
      [parti.id, awxServerId, jobId, awxDurum, M(uzlasma, 1000)],
      { tekrar: false },
    );
    uzlasmaKaydi = kurtarma.rowCount === 1;
    if (!uzlasmaKaydi) {
      uzlasma = `${uzlasma}; yeni AWX işi ${awxServerId}/${jobId == null ? 'bilinmiyor' : jobId}; farklı AWX job kimliği bulundu, mevcut kimlik ezilmedi`;
      const cakisma = await db().query(
        `UPDATE ear_envanter_partileri SET hata = $2 WHERE id = $1`,
        [parti.id, M(uzlasma, 1000)],
        { tekrar: false },
      );
      uzlasmaKaydi = cakisma.rowCount === 1;
    }
  } catch (e) {
    console.error('[EarEnvanter] launch uzlasma kaydi yazilamadi:', maskele(e && e.message));
  }
  console.error(
    `[EarEnvanter] kosu ${kosu.id} parti ${parti.parti_no} launch uzlasmasi${uzlasmaKaydi ? '' : ' KAYDEDILEMEDI'}:`,
    uzlasma,
  );
  return {
    sahiplikKaybi: true,
    awxIptal: iptalEdildi,
    uzlasmaKaydi,
    hata: M(uzlasma, 1000),
  };
}

// ── PARTI ALIMI ─────────────────────────────────────────────────────────────────────────────────

/** set_stats -> host basina playbook siniflamasi. Baska kosuya / partiye / AWX isine aitse kullanilmaz. */
function statsHaritasi(stats, kosu, parti) {
  const harita = new Map();
  if (!stats || typeof stats !== 'object') return { harita, uyusmazlik: null };
  if (kosu.kaynak === 'AWX') {
    if (String(stats.kaynak) !== 'AWX' || Number(stats.awx_job_id) !== Number(parti.awx_job_id))
      return {
        harita,
        uyusmazlik: `set_stats başka bir AWX işine ait (${M(stats.awx_job_id, 12)})`,
      };
  } else if (
    Number(stats.kosu_no) !== Number(kosu.id) ||
    Number(stats.parti_no) !== Number(parti.parti_no)
  )
    return {
      harita,
      uyusmazlik: `set_stats başka bir koşuya ait (${M(stats.kosu_no, 12)}/${M(stats.parti_no, 8)})`,
    };
  for (const h of Array.isArray(stats.hostlar) ? stats.hostlar : []) {
    const ad = String((h && h.host) || '').toUpperCase();
    if (alim.HOST_RE.test(ad)) harita.set(ad, h);
  }
  return { harita, uyusmazlik: null };
}

/** Hostun sonucu: ham dosya varsa ONDAN; yoksa playbook siniflamasi; o da yoksa SONUC_YOK. */
async function hostuAl(kosu, parti, hedef, statsHost, dizin, isNotu) {
  const playbookDurum = statsHost ? M(statsHost.durum, 24) : null;
  let buf = null;
  try {
    buf = await alim.hamOku(alim.hamDosyaYolu(dizin, alim.kosuAltDizini(kosu), hedef.host));
  } catch (e) {
    if (e.kod !== 'DOSYA_YOK')
      return alim.bosHostKaydi({
        partiNo: parti.parti_no,
        ortam: hedef.ortam,
        durum: 'OKUNAMADI',
        playbookDurum,
        hata: e.message,
      });
    const paketVardi =
      statsHost &&
      (statsHost.paket === true || statsHost.paket === 'True' || statsHost.paket === 'true');
    const durum = paketVardi
      ? 'OKUNAMADI'
      : playbookDurum && playbookDurum !== 'SONUC'
        ? playbookDurum
        : 'SONUC_YOK';
    const neden = paketVardi
      ? "playbook paketi yazdığını bildirdi ama dosya /sw'de yok"
      : statsHost
        ? M(maskele(statsHost.hata), 600) || null
        : isNotu || 'bu host için sonuç gelmedi';
    return alim.bosHostKaydi({
      partiNo: parti.parti_no,
      ortam: hedef.ortam,
      durum,
      playbookDurum,
      hata: neden,
    });
  }
  try {
    const p = alim.paketCoz(buf);
    return alim.hostKaydi(p, {
      host: hedef.host,
      kip: kosu.kip,
      partiNo: parti.parti_no,
      ortam: hedef.ortam,
      playbookDurum,
      hamBayt: buf.length,
      deployment: alim.deploymentCoz(buf),
      web: alim.webCoz(buf),
    });
  } catch (e) {
    return alim.bosHostKaydi({
      partiNo: parti.parti_no,
      ortam: hedef.ortam,
      durum: 'OKUNAMADI',
      playbookDurum,
      hata: e.message,
      hamBayt: buf.length,
    });
  }
}

/** ALINIYOR'a alinmis partiyi isler: her host sirayla (bellekte tek host). */
async function partiyiAl(kosu, parti, st) {
  const { extractStatsKey } = require('../scalex/result.cjs');
  const stats = st && st.artifacts ? extractStatsKey(st.artifacts, STATS_ANAHTARI) : null;
  const { harita, uyusmazlik } = statsHaritasi(stats, kosu, parti);
  const dizin = parametreler(kosu).dizin || alim.earDizin();
  const isNotu =
    st && st.status && st.status !== 'successful'
      ? `AWX işi ${st.status}${st.jobExplanation ? `: ${M(maskele(st.jobExplanation), 300)}` : ''}`
      : null;
  let veri = 0;
  for (const hedef of hostlarOf(parti)) {
    const kayit = await hostuAl(kosu, parti, hedef, harita.get(hedef.host) || null, dizin, isNotu);
    try {
      await alim.hostuYaz(db(), kosu.id, hedef.host, kayit);
      if (kayit.host.veri_var) veri += 1;
    } catch (e) {
      // Verisi yazilamayan host partinin geri kalanini KILITLEMEZ: OKUNAMADI olarak yazilir. Bos
      // satir da yazilamazsa (DB yok) hata yukari gider; parti ALINIYOR kalir, sonra yeniden alinir.
      if (!kayit.host.veri_var) throw e;
      await alim.hostuYaz(
        db(),
        kosu.id,
        hedef.host,
        alim.bosHostKaydi({
          partiNo: parti.parti_no,
          ortam: hedef.ortam,
          durum: 'OKUNAMADI',
          playbookDurum: kayit.host.playbook_durum,
          hata: `DB'ye yazılamadı: ${M(maskele(e && e.message), 300)}`,
          hamBayt: kayit.host.ham_bayt,
        }),
      );
    }
  }
  const notlar = [
    isNotu,
    uyusmazlik,
    !stats && st && st.status === 'successful' ? 'set_stats (ear_envanter_result) yok' : null,
  ].filter(Boolean);
  await db().query(
    `UPDATE ear_envanter_partileri SET durum = 'BITTI', finished_at = SYSUTCDATETIME(), awx_durum = $2, hata = $3
      WHERE id = $1 AND durum = 'ALINIYOR'`,
    [parti.id, M(st && st.status, 16) || null, M(notlar.join(' · '), 1000) || null],
  );
  return { veri, toplam: hostlarOf(parti).length };
}

/** Partinin hostlarini veri olmadan yazar (baslatilamadi / iptal). Zaten yazilmis host ezilmez. */
async function sonucsuzHostlariYaz(kosu, parti, durum, neden) {
  const { rows } = await db().query(`SELECT host FROM ear_envanter_hostlari WHERE kosu_id = $1`, [
    kosu.id,
  ]);
  const yazilmis = new Set((rows || []).map((r) => String(r.host).toUpperCase()));
  for (const h of hostlarOf(parti)) {
    if (yazilmis.has(h.host)) continue;
    await alim.hostuYaz(
      db(),
      kosu.id,
      h.host,
      alim.bosHostKaydi({ partiNo: parti.parti_no, ortam: h.ortam, durum, hata: neden }),
    );
  }
}

/** CALISIYOR partinin AWX isine bakar; bittiyse ALINIYOR'a alip isler. */
async function partiyiKontrolEt(kosu, parti) {
  if (parti.awx_job_id == null) {
    // Is baslatildi ama numarasi yazilamadi (surec dustu): dosyalar yine de alinir.
    const yas = await yasDk(parti.started_at);
    if (yas == null || yas < KAYIP_IS_DK) return { bekliyor: true };
    return alimaAl(kosu, parti, {
      status: 'unknown',
      artifacts: {},
      jobExplanation: 'AWX iş numarası kaydedilemedi',
    });
  }
  let st;
  try {
    st = await runner().getJobStatusOnServer(
      Number(parti.awx_server_id) || 0,
      Number(parti.awx_job_id),
    );
  } catch (e) {
    const yas = await yasDk(parti.started_at);
    if (Number(e && e.status) === 404 && yas != null && yas >= KAYIP_IS_DK)
      return alimaAl(kosu, parti, {
        status: 'unknown',
        artifacts: {},
        jobExplanation: 'AWX işi bulunamadı (404)',
      });
    return { bekliyor: true, okunamadi: M(maskele(e && e.message), 200) };
  }
  if (!TERMINAL.has(st.status)) {
    if (st.status && st.status !== parti.awx_durum)
      await db()
        .query(`UPDATE ear_envanter_partileri SET awx_durum = $2 WHERE id = $1`, [
          parti.id,
          M(st.status, 16),
        ])
        .catch(() => {});
    return { bekliyor: true, status: st.status };
  }
  return alimaAl(kosu, parti, st);
}

async function alimaAl(kosu, parti, st) {
  const r = await db().query(
    `UPDATE ear_envanter_partileri SET durum = 'ALINIYOR', alim_denemesi = alim_denemesi + 1, alim_at = SYSUTCDATETIME(), awx_durum = $2
      WHERE id = $1 AND durum = 'CALISIYOR'`,
    [parti.id, M(st.status, 16)],
    { tekrar: false },
  );
  if (r.rowCount !== 1) return { atlandi: true };
  return partiyiAl(kosu, { ...parti, durum: 'ALINIYOR' }, st);
}

/** Yarida kalmis alim (surec yeniden basladi): 10 dk sonra yeniden; 3 denemeden sonra HATA. */
async function yarimAlim(kosu, parti) {
  const yas = await yasDk(parti.alim_at);
  if (yas == null || yas < ALIM_BAYAT_DK) return { bekliyor: true };
  if (Number(parti.alim_denemesi || 0) >= ALIM_DENEME) {
    await db().query(
      `UPDATE ear_envanter_partileri SET durum = 'HATA', finished_at = SYSUTCDATETIME(), hata = $2 WHERE id = $1 AND durum = 'ALINIYOR'`,
      [parti.id, `sonuçlar ${ALIM_DENEME} denemede alınamadı`],
    );
    await sonucsuzHostlariYaz(
      kosu,
      parti,
      'OKUNAMADI',
      `sonuçlar ${ALIM_DENEME} denemede alınamadı`,
    );
    return { hata: true };
  }
  const r = await db().query(
    `UPDATE ear_envanter_partileri SET alim_denemesi = alim_denemesi + 1, alim_at = SYSUTCDATETIME()
      WHERE id = $1 AND durum = 'ALINIYOR' AND alim_denemesi = $2`,
    [parti.id, Number(parti.alim_denemesi || 0)],
    { tekrar: false },
  );
  if (r.rowCount !== 1) return { atlandi: true };
  let st = { status: parti.awx_durum || 'unknown', artifacts: {} };
  if (parti.awx_job_id != null) {
    st = await runner()
      .getJobStatusOnServer(Number(parti.awx_server_id) || 0, Number(parti.awx_job_id))
      .catch(() => st);
  }
  return partiyiAl(kosu, parti, st);
}

/** DB saatine gore yas (dk); okunamazsa yerel saat. */
async function yasDk(t) {
  if (!t) return null;
  const d = t instanceof Date ? t : new Date(t);
  return Number.isFinite(d.getTime()) ? (Date.now() - d.getTime()) / 60000 : null;
}

// ── KOSU SONU ───────────────────────────────────────────────────────────────────────────────────

/**
 * Sayimlar host satirlarindan. Beklenen ama satiri olmayan host BASARISIZ sayilir.
 * TAMAMLANDI yalniz her host TAM ya da KOK_YOK iken; veri var ama eksikse KISMI; hic veri yoksa BASARISIZ.
 */
async function sayim(kosuId) {
  const { rows } = await db().query(
    `SELECT k.beklenen,
            SUM(CASE WHEN h.durum = 'TAM' THEN 1 ELSE 0 END) AS tam,
            SUM(CASE WHEN h.durum = 'KOK_YOK' THEN 1 ELSE 0 END) AS kok_yok,
            SUM(CASE WHEN h.veri_var = 1 AND h.durum NOT IN ('TAM', 'KOK_YOK') THEN 1 ELSE 0 END) AS kismi,
            COUNT(h.id) AS alinan
       FROM ear_envanter_kosulari k LEFT JOIN ear_envanter_hostlari h ON h.kosu_id = k.id
      WHERE k.id = $1 GROUP BY k.beklenen`,
    [kosuId],
  );
  const r = (rows && rows[0]) || {};
  const beklenen = Number(r.beklenen || 0);
  const tam = Number(r.tam || 0);
  const kokYok = Number(r.kok_yok || 0);
  const kismi = Number(r.kismi || 0);
  return {
    beklenen,
    tam,
    kokYok,
    kismi,
    basarisiz: Math.max(0, beklenen - tam - kokYok - kismi),
    alinan: Number(r.alinan || 0),
  };
}

function kosuSonucu(s) {
  if (s.tam + s.kokYok + s.kismi === 0) return 'BASARISIZ';
  if (s.kismi === 0 && s.basarisiz === 0) return 'TAMAMLANDI';
  return 'KISMI';
}

/** Kosuyu kapatir (CAS: yalniz CALISIYOR). durum verilmezse sayimdan hesaplanir. */
async function kosuBitir(kosuId, { durum = null, hata: neden = null } = {}) {
  const s = await sayim(kosuId);
  const son = durum || kosuSonucu(s);
  if (son === 'BASARISIZ' || son === 'IPTAL')
    await db().query(
      `UPDATE ear_envanter_partileri SET durum = 'IPTAL', finished_at = SYSUTCDATETIME() WHERE kosu_id = $1 AND durum = 'BEKLIYOR'`,
      [kosuId],
    );
  const r = await db().query(
    `UPDATE ear_envanter_kosulari
        SET durum = $2, tam = $3, kismi = $4, kok_yok = $5, basarisiz = $6, finished_at = SYSUTCDATETIME(),
            hata = COALESCE($7, hata)
      WHERE id = $1 AND durum = 'CALISIYOR'`,
    [kosuId, son, s.tam, s.kismi, s.kokYok, s.basarisiz, neden ? M(neden, 1000) : null],
    { tekrar: false },
  );
  return { durum: son, sayim: s, kapandi: r.rowCount === 1 };
}

/** Kapanmis kosunun sayimlarini tazeler (iptalden sonra biten parti). Durum degismez. */
async function sayimTazele(kosuId) {
  const s = await sayim(kosuId);
  await db().query(
    `UPDATE ear_envanter_kosulari SET tam = $2, kismi = $3, kok_yok = $4, basarisiz = $5 WHERE id = $1`,
    [kosuId, s.tam, s.kismi, s.kokYok, s.basarisiz],
  );
}

/** Admin iptali: bekleyen partiler IPTAL, calisan AWX isi iptal istenir; gelen sonuclar yine alinir. */
async function kosuIptal(kosuId, kim) {
  const kosu = await kosuOku(kosuId);
  if (!kosu) throw hata(409, 'Koşu bulunamadı.', 'kosu_yok');
  if (kosu.durum !== 'CALISIYOR') throw hata(409, `Koşu zaten ${kosu.durum}.`, 'kosu_bitmis');
  const b = await kosuBitir(kosu.id, {
    durum: 'IPTAL',
    hata: `iptal: ${M(kim, 100) || 'unknown'}`,
  });
  const { rows } = await db().query(
    `SELECT awx_server_id, awx_job_id FROM ear_envanter_partileri WHERE kosu_id = $1 AND durum = 'CALISIYOR' AND awx_job_id IS NOT NULL`,
    [kosu.id],
  );
  const iptalEdilen = [];
  for (const p of rows || []) {
    try {
      await runner().cancelJobOnServer(Number(p.awx_server_id) || 0, Number(p.awx_job_id));
      iptalEdilen.push(Number(p.awx_job_id));
    } catch (e) {
      console.warn(
        `[EarEnvanter] AWX isi ${p.awx_job_id} iptal edilemedi:`,
        maskele(e && e.message),
      );
    }
  }
  return { ...b, awxIptal: iptalEdilen };
}

// ── TUR ─────────────────────────────────────────────────────────────────────────────────────────

/** Bir kosuyu bir adim ilerletir. */
async function kosuyuIlerlet(kosu) {
  const { rows } = await db().query(
    `SELECT * FROM ear_envanter_partileri WHERE kosu_id = $1 AND durum IN ('CALISIYOR', 'ALINIYOR') ORDER BY parti_no`,
    [kosu.id],
  );
  for (const p of rows || []) {
    if (p.durum === 'CALISIYOR') await partiyiKontrolEt(kosu, p);
    else await yarimAlim(kosu, p);
  }
  if (kosu.durum !== 'CALISIYOR') {
    if ((rows || []).length) await sayimTazele(kosu.id);
    return;
  }
  const b = await siradakiPartiyiBaslat(kosu);
  if (b !== null) return;
  const acik = await db().query(
    `SELECT COUNT(*) AS n FROM ear_envanter_partileri WHERE kosu_id = $1 AND durum IN ('BEKLIYOR', 'CALISIYOR', 'ALINIYOR')`,
    [kosu.id],
  );
  if (Number(acik.rows && acik.rows[0] && acik.rows[0].n) === 0) {
    const s = await kosuBitir(kosu.id);
    if (s.kapandi)
      console.log(
        `[EarEnvanter] kosu ${kosu.id} ${s.durum}: tam=${s.sayim.tam} kismi=${s.sayim.kismi} basarisiz=${s.sayim.basarisiz}`,
      );
  }
}

// Ayni plan orneginde ayni bildirimi her turda yeniden yazma; basarisiz ornegi 10 dk bekle.
const _bildirilen = new Set();
const _bekle = new Map();
const BEKLEME_MS = 10 * 60 * 1000;
function birKez(anahtar, metin) {
  if (_bildirilen.has(anahtar)) return;
  if (_bildirilen.size > 500) _bildirilen.clear();
  _bildirilen.add(anahtar);
  console.log(metin);
}

/**
 * Planin zamani geldiyse kosu acar (template tanimli degilse acmaz: bos kosu birikmesin). Ayni anda tek
 * kosu: TAM once; OZET ornegi onu kapsayan TAM ile birlesmisse acilmaz. Donus: acilan kosu | null |
 * { atlandi } | { hata }.
 */
async function zamanlayiciyiKontrolEt(simdi = new Date()) {
  const a = await ayar.oku();
  if (a.okunamadi) return null;
  const adaylar = ayar.bekleyenZamanlama(a.deger, simdi);
  if (!adaylar.length) return null;
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(REGISTRY_KEY).catch(() => null);
  if (!row || row.enabled === false || !reg.getEffectiveTemplateId(row))
    return { atlandi: 'template_yok' };
  let son = null;
  for (const z of adaylar) {
    if (z.birlesti) {
      birKez(z.anahtar, `[EarEnvanter] ${z.anahtar} OZET ornegi ${z.birlesti} TAM taramasiyla birlesti`);
      son = son || { atlandi: 'tam_ile_birlesti', anahtar: z.anahtar };
      continue;
    }
    const bekle = _bekle.get(z.anahtar);
    if (bekle && simdi.getTime() < bekle) continue;
    try {
      const k = await kosuOlustur({
        kip: z.plan.kip,
        kapsam: z.plan.kapsam,
        kaynak: 'ZAMANLAYICI',
        baslatan: 'ear-envanter-zamanlayici',
        zamanlayiciAnahtari: z.anahtar,
        esAnahtarlar: z.esAnahtarlar,
      });
      if (k) {
        console.log(`[EarEnvanter] plan kosusu ${k.id} acildi (${z.anahtar}, ${k.beklenen} sunucu)`);
        return k;
      }
    } catch (e) {
      _bekle.set(z.anahtar, simdi.getTime() + BEKLEME_MS);
      console.warn(`[EarEnvanter] plan kosusu acilamadi (${z.anahtar}):`, maskele(e && e.message));
      son = { hata: M(e && e.message, 200), anahtar: z.anahtar };
    }
  }
  return son;
}

async function tick(simdi = new Date()) {
  await zamanlayiciyiKontrolEt(simdi).catch((e) =>
    console.warn('[EarEnvanter] zamanlayici:', maskele(e && e.message)),
  );
  // AWX'ten elle baslatilan bitmis isler kosu olarak acilir; asagidaki tur ayni anda alir.
  await require('./ear-envanter-awx.cjs')
    .awxIsleriniAl({ simdi: simdi.getTime() })
    .catch((e) => console.warn('[EarEnvanter] AWX isleri:', maskele(e && e.message)));
  const { rows } = await db().query(
    `SELECT TOP 5 * FROM ear_envanter_kosulari k
      WHERE k.durum = 'CALISIYOR'
         OR EXISTS (SELECT 1 FROM ear_envanter_partileri p WHERE p.kosu_id = k.id AND p.durum IN ('CALISIYOR', 'ALINIYOR'))
      ORDER BY k.id`,
  );
  for (const k of rows || []) {
    try {
      await kosuyuIlerlet(k);
    } catch (e) {
      console.warn(`[EarEnvanter] kosu ${k.id} ilerletilemedi:`, maskele(e && e.message));
    }
  }
  if (Date.now() - _sonSaklama > SAKLAMA_ARALIK_MS) {
    _sonSaklama = Date.now();
    await require('./ear-envanter-saklama.cjs')
      .saklama()
      .catch((e) => console.warn('[EarEnvanter] saklama:', maskele(e && e.message)));
  }
}

function startPoller() {
  if (_timer) return;
  _timer = setInterval(() => {
    if (_ticking) return;
    _ticking = true;
    tick()
      .catch((e) => console.warn('[EarEnvanter] tick hatasi:', maskele(e && e.message)))
      .finally(() => {
        _ticking = false;
      });
  }, POLL_SN * 1000);
  if (_timer.unref) _timer.unref();
  console.log(`[EarEnvanter] poller basladi (${POLL_SN} sn)`);
}

module.exports = {
  REGISTRY_KEY,
  TEMPLATE_ADI,
  STATS_ANAHTARI,
  KOSU_OLUSTUR_SQL,
  BASLATMA_DENEME,
  ALIM_DENEME,
  kur,
  hedefleriDuzle,
  partilereBol,
  filoHedefleri,
  kosuOlustur,
  kosuOku,
  extraVarsOf,
  sozdeIstek,
  siradakiPartiyiBaslat,
  statsHaritasi,
  hostuAl,
  partiyiAl,
  partiyiKontrolEt,
  yarimAlim,
  sayim,
  kosuSonucu,
  kosuBitir,
  kosuIptal,
  kosuyuIlerlet,
  zamanlayiciyiKontrolEt,
  kapsamHedefleri,
  ortamlar,
  kapsamOnizleme,
  tick,
  startPoller,
  _durdurForTest: () => {
    if (_timer) clearInterval(_timer);
    _timer = null;
    _ticking = false;
    _launch = null;
    _sonSaklama = 0;
    _bildirilen.clear();
    _bekle.clear();
  },
};
