// server/nginx-loadtest/index.cjs - Nginx Hub > Yuk Testi HTTP yuzeyi (/api/nginx-loadtest).
//
// Ayri router (nginx-cis deseni, kesif C3): nginx-console'un 1600 satirlik router'ina eklenmedi ve
// nginxRedCevirici `haric` listesine KONMADI - 403/404 govdeleri kurumsal nginx'in HTML sayfasina
// donmesin diye 409'a cevrilir; is hatalari zaten 409 (kalici) / 424 (gecici). 5xx YOK.
//
// KAPILAR (sira onemli): requireAuth -> adminOkumaKapisi (Admin olmayana yalniz ADMIN_DISI_OKUMA
// GET yollari) -> requireVisiblePrefix('NginxConsole') -> requireVisible('tab:nginx:yuktesti').
// Yazan her uc ve /durum ayrica isleyicide Admin ister.
//
// AWX KIMLIKLERI ISTEMCIDEN ALINMAZ: sunucu / is numarasi kosu satirindan okunur.
//
// HEDEF IP SINIFLANDIRMASI (tur 3, 2026-10-28): hedef IP'yi kullanici yazar (host secici istege
// bagli). Sunucu IP'nin sahibini envanterlerden bulur (dogrula.ipSinifla) ve karari KENDISI verir:
// IP tam bir non-prod nginx sunucusunun (ya da secilen hostun; paylasilan VIP dahil) ise 'sunucu'
// (bugunku yol: CPU kaydedici + nginx logu, IP sunucunun aday listesinde olmak ZORUNDA); hicbir
// nginx sunucusunun degilse ancak Portal izin listesinde (NGINX_LOADTEST_SERBEST_AGLAR), yasak
// listenin disinda, PROD / EDU / bilinmeyen sahipsiz ve envanter tazeyse 'serbest' (yalniz istemci
// olcumu; hedefe SSH yok; tavan 200 r/s / 50 baglanti; onay metni = IP; on kontrol de G|global).
// Ekran (/ip-sinifi) yalniz gosterir; on kontrol VE kosu kapisi siniflandirmayi YENIDEN yapar.
//
// TEHDIT MODELI: extra_vars AWX'te her degiskenin ustundedir; playbook kapilari Portal hatasina ve
// AWX Relaunch'una (yuk_son_epoch, 15 dk) karsi savunma derinligidir, AWX'te Execute yetkili
// kotu niyetli kullaniciya karsi SINIR DEGIL. Asil sinir AWX RBAC (sablonun Execute / Admin rolu
// yalniz Portal servis hesabinda). "Sahipsiz" IP PROD olmadiginin kaniti degil: LB VIP'leri
// envanterde yok, asil koruma dar tutulan izin listesidir.
//
// AKIS: senaryo (yalniz yol satirlari) -> on kontrol isi (yuk uretmez) -> kosu (on kontrol <= 15 dk,
// ayni kullanici, DONE/OK, onay metni = hedef host ya da serbestte hedef IP, uyarilar - plan
// uyarilari dahil - acikca onaylanmis, sinif ve plan uyarilari degismemis) -> poller sonuclandirir
// (bkz. poller.cjs). Ayrintilar: docs/NGINX-YUK-TESTI.md.
//
// DURDUR: AWX iptali uzaktaki async kos.sh/k6'yi ve ayrik kaydediciyi DURDURMAZ. Kosu icin durdur
// kipindeki is baslatilamazsa 424 durdur_baslatilamadi (iptal basarili olsa da); baslarsa kosunun
// kilitleri (kilit_id) durdur isine baglanir ve o is basariyla bitince birakilir (kilit.cjs).
'use strict';

const crypto = require('node:crypto');
const express = require('express');
const dg = require('./dogrula.cjs');
const kilit = require('./kilit.cjs');
const baslat = require('./baslat.cjs');
const poller = require('./poller.cjs');
const { adminOkumaKapisi, isAdmin } = require('../auth/admin-okuma-kapisi.cjs');

const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const AKTIF = new Set(['QUEUED', 'RUNNING', 'FINALIZING']);
const ON_KONTROL_MAX_YAS_SN = 15 * 60;
const SEKME = 'tab:nginx:yuktesti';
// Baslatma suren (QUEUED, is numarasi henuz yazilmamis) satir bu sure dolmadan durdurulmaz: durdur
// satiri CANCELED yapip baslatilan isi takipsiz birakirdi.
const BASLATMA_PENCERESI_SN = 120;
// Tutulan kosu kilidinin ek suresi (butce + bu kadar); poller ile ayni.
const KILIT_EK_SN = 180;
const LISTE_ISLEMLERI = new Set(['kosu', 'on_kontrol']);
const LISTE_DURUMLARI = new Set(['QUEUED', 'RUNNING', 'FINALIZING', 'DONE', 'FAILED', 'CANCELED', 'OKUNAMADI']);

/** Admin olmayana (sekmesi acik) salt okunur uclar. /durum ve yazan her uc Admin'de kalir. */
const ADMIN_DISI_OKUMA = Object.freeze([
  /^\/hedefler\/?$/,
  /^\/senaryolar\/?$/,
  /^\/senaryolar\/\d+\/?$/,
  /^\/kosular\/?$/,
  /^\/kosular\/\d+\/?$/,
  /^\/karsilastir\/?$/,
]);

const db = () => require('../db/index.cjs');
const maskele = (s) => require('../retirement/is-ciktisi.cjs').maskele(s);
const maskeleDerin = (v) => require('../retirement/is-ciktisi.cjs').maskeleDerin(v);

function hata(status, code, message, ek) {
  return Object.assign(new Error(message), { status, code }, ek || {});
}
/** dogrula.cjs kapisinin red nesnesi -> firlatilabilir hata (ek alanlar korunur). */
function kapidan(r) {
  const { ok, status, code, message, ...ek } = r;
  return hata(status, code, message, ek);
}

const sayi = (v) => {
  const n = dg.tamSayi(v);
  return n !== null && n > 0 ? n : null;
};
const iso = (v) => (v == null || v === '' ? null : v instanceof Date ? v.toISOString() : String(v));
function jsonOku(s) {
  if (s == null || s === '') return null;
  try {
    return typeof s === 'string' ? JSON.parse(s) : s;
  } catch {
    return null;
  }
}
/** Anahtar sirasindan bagimsiz karsilastirma icin kararli JSON. */
function kararliJson(v) {
  if (Array.isArray(v)) return `[${v.map(kararliJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${kararliJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const kullanici = (req) => (req.session && req.session.user) || {};
const ayniKullanici = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() && String(a || '').trim() !== '';

const DENETLENEN_RET = new Set([409, 424]);

/** Tek hata yaniti. Beklenmeyen hata da 424: 500 govdesi kurumsal gecitte HTML'e doner. */
function hataYaniti(req, res, e, eylem, hedef) {
  let status = Number.isInteger(e && e.status) ? e.status : 424;
  if (status >= 500) status = 424;
  const code = (e && e.code) || (status === 424 ? 'beklenmeyen' : 'gecersiz_istek');
  if (!(e && Number.isInteger(e.status))) console.warn('[NginxYukTesti] beklenmeyen hata:', maskele(e && e.message));
  const body = { ok: false, code, message: maskele((e && e.message) || 'Beklenmeyen hata.') };
  for (const k of ['uyarilar', 'engeller', 'asimlar', 'hatalar', 'kilit', 'env', 'iptal', 'iptalHatasi', 'durdurHatasi', 'sahipler']) if (e && e[k] !== undefined) body[k] = e[k];
  // Reddedilen baslatma denemesi de denetime yazilir (uretim hedefi, izinsiz yuk makinesi ...).
  if (eylem && DENETLENEN_RET.has(status)) {
    try {
      require('../audit/index.cjs').auditPortal(req, eylem, {
        result: 'fail',
        targetHost: (hedef && hedef.host) || null,
        targetIp: (hedef && hedef.ip) || null,
        // Gecerli JSON, en cok 2000 karakter (uzun mesaj kisaltilir; kod ve kosu no kalir) - baslat.cjs.
        detail: baslat.denetimAyrintisi({ code, message: body.message, ...(hedef && hedef.kosuId ? { kosuId: hedef.kosuId } : {}) }),
      });
    } catch {
      /* best-effort */
    }
  }
  if (!res.headersSent) res.status(status).json(body);
}

async function dbOku(fn) {
  try {
    return await fn(db());
  } catch (e) {
    throw hata(424, 'db_okunamadi', `Portal veritabanı okunamadı: ${maskele(e && e.message)}`);
  }
}

// Is ZATEN baslatildiysa kayit yazimi bir kez kisa gecikmeyle yeniden denenir (opsx was deseni).
async function birKezTekrarla(ad, fn) {
  try {
    await fn();
    return true;
  } catch (e1) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      await fn();
      return true;
    } catch (e2) {
      console.warn(`[NginxYukTesti] ${ad} yazilamadi (2 deneme):`, maskele((e2 && e2.message) || (e1 && e1.message)));
      return false;
    }
  }
}

// Is baslamadigi KESIN olan her yolda bu istegin kilitleri birakilir (yalniz bu lock_id'li dolu
// satirlar). Birakma da hata alirsa (DB hala erisilemiyor) kilit TTL ile duser ve uyari yazilir;
// yeniden deneme yok (kesintiyi cozmez).
function kilitleriBirak(anahtarlar, lockId) {
  return kilit.releaseLocks(db(), anahtarlar, lockId).catch((e) => console.warn('[NginxYukTesti] kilit birakilamadi (TTL ile dusecek):', maskele(e && e.message)));
}

// ── SATIR -> API ──────────────────────────────────────────────────────────────────────────

function senaryoApi(r) {
  return {
    id: Number(r.id),
    ad: r.ad,
    aciklama: r.aciklama ?? null,
    vhost: r.vhost ?? null,
    senaryoTur: r.senaryo_tur,
    yolSayisi: r.yol_sayisi == null ? null : Number(r.yol_sayisi),
    sha256: r.sha256 == null ? null : String(r.sha256).trim(),
    kaynak: r.kaynak,
    createdBy: r.created_by ?? null,
    createdAt: iso(r.created_at),
  };
}

function kosuApi(r) {
  return {
    id: Number(r.id),
    islem: r.islem,
    etiket: r.etiket ?? null,
    adim: r.adim ?? null,
    // Serbest satirda hedef_host '' (DB'de NULL'a cevrilmez); API null doner. Eski satir: sunucu / k6.
    hedefTuru: r.hedef_turu || 'sunucu',
    motor: r.motor || 'k6',
    hedefHost: r.hedef_host || null,
    hedefIp: r.hedef_ip,
    vhost: r.vhost,
    yukHost: r.yuk_host,
    senaryoId: r.senaryo_id == null ? null : Number(r.senaryo_id),
    senaryoAd: r.senaryo_ad ?? null,
    onKontrolKosuId: r.on_kontrol_kosu_id == null ? null : Number(r.on_kontrol_kosu_id),
    durum: r.durum,
    gecerlilik: r.gecerlilik ?? null,
    createdBy: r.created_by ?? null,
    createdAt: iso(r.created_at),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    awxJobId: r.awx_job_id == null ? null : Number(r.awx_job_id),
    awxServerId: r.awx_server_id == null ? null : Number(r.awx_server_id),
  };
}

const deve = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
function adimApi(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'nedenler' || k === 'ham') o[k] = jsonOku(v);
    else o[deve(k)] = v;
  }
  return o;
}
/** kararVer'e giden adim: analiz ciktisiyla AYNI anahtarlar (snake), JSON alanlar cozulmus. */
function adimAnaliz(r) {
  return { ...r, nedenler: jsonOku(r.nedenler) || [], ham: jsonOku(r.ham) };
}

const KOSU_KOLONLARI = `k.id, k.senaryo_id, k.on_kontrol_kosu_id, k.islem, k.etiket, k.adim, k.hedef_host, k.hedef_ip, k.vhost,
  k.yuk_host, k.parametreler, k.durum, k.awx_server_id, k.awx_job_id, k.sw_dizin, k.sonuc, k.on_kontrol_ozet,
  k.gecerlilik, k.gecersiz_nedenleri, k.created_by, k.created_at, k.started_at, k.finished_at, k.finalized_at,
  k.iptal_eden, k.kilit_id, k.durdur_awx_server_id, k.durdur_awx_job_id, k.sonuclandirma_denemesi,
  k.hedef_turu, k.motor, k.plan_uyarilari,
  s.ad AS senaryo_ad, DATEDIFF(SECOND, k.finished_at, GETUTCDATE()) AS yas_sn,
  DATEDIFF(SECOND, k.created_at, GETUTCDATE()) AS olusma_yas_sn`;

// Liste ucu: buyuk JSON kolonlari (sonuc, on kontrol ozeti, parametreler) TASINMAZ.
const LISTE_KOLONLARI = `k.id, k.senaryo_id, k.on_kontrol_kosu_id, k.islem, k.etiket, k.adim, k.hedef_host, k.hedef_ip, k.vhost,
  k.yuk_host, k.durum, k.awx_server_id, k.awx_job_id, k.gecerlilik, k.created_by, k.created_at, k.started_at,
  k.finished_at, k.hedef_turu, k.motor, s.ad AS senaryo_ad`;

/** Satirin motoru: liste kopyasi (kosular.motor), yoksa kanonik parametreler.motor, yoksa k6 (eski satir). */
function motorOf(x) {
  return (x && x.motor) || (jsonOku(x && x.parametreler) || {}).motor || 'k6';
}

/** Saklanmis JSON metin dizisi (plan_uyarilari) -> string[] (bozuk / yok -> []). */
function metinDizisi(v) {
  const d = jsonOku(v);
  return Array.isArray(d) ? d.filter((s) => typeof s === 'string') : [];
}

async function kosuOku(id) {
  const { rows } = await dbOku((d) =>
    d.query(`SELECT ${KOSU_KOLONLARI} FROM nginx_loadtest_kosular k LEFT JOIN nginx_loadtest_senaryolar s ON s.id = k.senaryo_id WHERE k.id = $1`, [id]));
  return rows[0] || null;
}

async function senaryoOku(id) {
  const { rows } = await dbOku((d) =>
    d.query(
      `SELECT id, ad, aciklama, vhost, senaryo_tur, tsv, sha256, yol_sayisi, ozet, kaynak, created_by, created_at, silindi
         FROM nginx_loadtest_senaryolar WHERE id = $1`,
      [id],
    ));
  return rows[0] || null;
}

// ── PLAN: kapilarin TAMAMI (on kontrol ve kosu AYNI fonksiyondan gecer) ───────────────────

/** Bugunku (tur 2) ip_hedefte_yok metni: hostun aday IP listesiyle. */
function ipHedefteYok(hedefIp, hedefHost, ay, ek) {
  return hata(409, 'ip_hedefte_yok', ay.ipler.length
    ? `${hedefIp}, ${hedefHost} için bilinen IP'lerden değil (${ay.ipler.join(', ')}).`
    : `${hedefHost} için bilinen bir IP yok (nginx taraması / envanter).`, ek);
}

/**
 * Senaryo + envanter + IP siniflandirmasi + ortam + yuk makinesi + Host basligi + sinirlar. Her
 * kosu baslatmasinda YENIDEN olculur (15 dk icinde envanter / limit / IP'nin sahibi degismis
 * olabilir). `hedefHost` istege bagli (null = yazilan IP siniflandirilir). Sira: kaynaklar ->
 * (hedefHost varsa) hedef kapisi -> ipSinifla -> sunucu: hedef / yuk makinesi kapisi, aday IP
 * savunmasi, vhost listede mi (D7: firlatma yok), sinirlar; serbest: yuk makinesi kapisi, serbest
 * sinirlari -> iki kipte Host basligi uretim kapisi (409 host_uretim) ve plan uyarilari.
 */
async function kosuPlani({ senaryoId, hedefHost = null, hedefIp, vhost, yukHost, sni, parametrelerHam, etiket }) {
  const sen = await senaryoOku(senaryoId);
  if (!sen || sen.silindi === true || sen.silindi === 1) throw hata(409, 'senaryo_yok', 'Senaryo bulunamadı (silinmiş olabilir).');
  if (dg.sha256Hex(sen.tsv || '') !== String(sen.sha256 || '').trim()) {
    throw hata(409, 'senaryo_yok', 'Senaryonun içeriği kayıtlı özetiyle (sha256) uyuşmuyor; senaryoyu yeniden oluşturun.');
  }
  const { query, sql } = require('../inventory/mssql.cjs');
  const izinli = dg.yukHostlari();
  const aglar = dg.serbestAglar();
  const yasak = dg.serbestYasak();
  const k = await dg.kaynaklariOku({ query, sql, hostlar: [hedefHost, yukHost].filter(Boolean), ip: hedefIp, vhost });
  if (hedefHost) {
    const hk0 = dg.hedefKapisi(hedefHost, { nginxSatiri: k.nginx.get(hedefHost) || null, invEnv: k.inv.get(hedefHost) });
    if (!hk0.ok) throw kapidan(hk0);
  }
  const sinif = dg.ipSinifla(hedefIp, k, { aglar, yasak, hedefHost, yukHost });
  if (!sinif.ok) {
    if (sinif.code === 'ip_hedefte_yok' && hedefHost) throw ipHedefteYok(hedefIp, hedefHost, dg.hedefAyrintisi(k, hedefHost), { sahipler: sinif.sahipler });
    throw kapidan(sinif);
  }
  const yukKapisi = (hedef) => dg.yukHostKapisi(yukHost, {
    hedef, izinli, nginxSatiri: k.nginx.get(yukHost) || null, invEnv: k.inv.get(yukHost), invVar: k.inv.has(yukHost),
  });
  let env = null;
  let p;
  let vhostListede = null;
  if (sinif.tur === 'sunucu') {
    const host = sinif.host;
    const hk = dg.hedefKapisi(host, { nginxSatiri: k.nginx.get(host) || null, invEnv: k.inv.get(host) });
    if (!hk.ok) throw kapidan(hk);
    env = hk.env;
    const yk = yukKapisi(host);
    if (!yk.ok) throw kapidan(yk);
    const ay = dg.hedefAyrintisi(k, host);
    // Savunma: IP sunucunun aday listesinde (tarama listen + envanter IP'si) olmak ZORUNDA.
    if (!ay.ipler.includes(hedefIp)) throw ipHedefteYok(hedefIp, host, ay);
    // D7: listede olmayan Host basligi ENGEL degil (joker / regex server_name); denetime yazilir.
    vhostListede = Array.isArray(ay.vhostlar) ? ay.vhostlar.includes(vhost) : null;
    p = dg.parametreler(parametrelerHam, { sni, hizSiniri: ay.hizSiniri, vuSiniri: ay.vuSiniri, hedefTuru: 'sunucu' });
  } else {
    const yk = yukKapisi(null);
    if (!yk.ok) throw kapidan(yk);
    p = dg.parametreler(parametrelerHam, { sni, hizSiniri: null, vuSiniri: null, hedefTuru: 'serbest' });
  }
  if (!p.ok) throw kapidan(p);
  const hb = dg.hostBasligiDegerlendir(vhost, k, { hedefTuru: sinif.tur, yukHost });
  if (!hb.ok) throw kapidan(hb);
  return {
    senaryo: { id: Number(sen.id), ad: sen.ad, tur: sen.senaryo_tur, tsv: sen.tsv, sha256: String(sen.sha256).trim() },
    hedefTuru: sinif.tur, hedefHost: sinif.tur === 'sunucu' ? sinif.host : null, hedefIp, vhost, yukHost, etiket: etiket || null, env,
    parametreler: p.deger, serbestAg: sinif.tur === 'serbest' ? sinif.ag : null, vhostListede, uyarilar: hb.uyarilar,
  };
}

async function kosuBasarisiz(kosuId, adim, sonuc, jobId = null, awxServerId = null) {
  await birKezTekrarla('basarisiz kosu satiri', () => db().query(
    `UPDATE nginx_loadtest_kosular
        SET durum = 'FAILED', adim = $2, sonuc = $3, awx_server_id = $4, awx_job_id = $5,
            finished_at = GETUTCDATE(), finalized_at = GETUTCDATE()
      WHERE id = $1 AND durum = 'QUEUED'`,
    [kosuId, adim, JSON.stringify(sonuc), awxServerId, jobId],
  ));
}

/**
 * Kilit -> satir (QUEUED) -> son kapi -> AWX -> kilidi ise bagla -> RUNNING.
 * Sablon kilitten ONCE cozulur: template yoksa ne kilit ne satir olusur.
 */
async function kosuyuBaslat(req, { islem, plan, onKontrolKosuId = null, onaylananUyarilar = [] }) {
  const user = kullanici(req);
  const kullaniciAdi = String(user.username || 'unknown').slice(0, 100);
  const sablon = await baslat.sablonuCoz();
  const hedefTuru = plan.hedefTuru === 'serbest' ? 'serbest' : 'sunucu';
  const motor = plan.parametreler && plan.parametreler.motor === 'wrk' ? 'wrk' : 'k6';
  const anahtarlar = kilit.kilitAnahtarlari({ hedef: plan.hedefHost, hedefIp: plan.hedefIp, hedefTuru, yuk: plan.yukHost, kosu: islem === 'kosu' });
  const lockId = crypto.randomUUID();
  const runner = require('../ansible/runner.cjs');
  // Kilit aciklamasi (kilit_dolu mesajinda target_desc): k6 + sunucu metni tur 2 ile BIREBIR.
  const hedefMetni = plan.hedefHost || `${plan.hedefIp} (serbest)`;
  const planUyarilari = Array.isArray(plan.uyarilar) ? plan.uyarilar : [];
  let alinan;
  try {
    alinan = await kilit.acquireLocks(db(), anahtarlar, {
      lockId,
      holder: kullaniciAdi,
      desc: `${islem === 'kosu' ? 'yük testi' : 'ön kontrol'} ${hedefMetni} <- ${plan.yukHost}${motor === 'wrk' ? ' (wrk)' : ''}`,
      ttlMin: kilit.kilitSuresiDk(),
      // Durum da doner: bayat kilidin birakilip birakilmayacagina bag turuyle kural karar verir.
      isJobTerminal: async (sid, jid) => {
        const s = await runner.getJobStatusOnServer(sid, jid);
        return { terminal: TERMINAL.has(s.status), finished: s.finished || null, status: s.status };
      },
    });
  } catch (e) {
    console.warn('[NginxYukTesti] kilit alinamadi (DB) - is baslatilmadi:', maskele(e && e.message));
    // Onceki anahtarlar alinmis olabilir (G|global alindi, T|... satiri hata atti): birakilmazsa G
    // TTL boyunca var olmayan bir isi gosterirdi.
    await kilitleriBirak(anahtarlar, lockId);
    throw hata(424, 'db_okunamadi', 'İş kilidi alınamadı; iş başlatılmadı, lütfen tekrar deneyin.');
  }
  if (!alinan.ok) throw hata(409, 'kilit_dolu', kilit.doluKilitMesaji(alinan.busyKey, alinan.busy), { kilit: alinan.busyKey });

  let kosuId;
  try {
    // kilit_id: Durdur kosunun kilitlerini (ise bagli olmasalar da) bu kimlikle durdur isine baglar.
    // Serbest satirda hedef_host '' (NULL'a cevrilmez); motor parametreler.motor'un liste kopyasi;
    // plan_uyarilari bos ise NULL (ekran ve kosu onayi ayni listeyi gorur).
    const ins = await db().query(
      `INSERT INTO nginx_loadtest_kosular (senaryo_id, on_kontrol_kosu_id, islem, etiket, hedef_host, hedef_ip, vhost, yuk_host, parametreler, durum, created_by, kilit_id, hedef_turu, motor, plan_uyarilari)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'QUEUED', $10, $11, $12, $13, $14) RETURNING id`,
      [plan.senaryo.id, onKontrolKosuId, islem, plan.etiket, plan.hedefHost || '', plan.hedefIp, plan.vhost, plan.yukHost, JSON.stringify(plan.parametreler), kullaniciAdi, lockId,
        hedefTuru, motor, planUyarilari.length ? JSON.stringify(planUyarilari) : null],
    );
    kosuId = Number(ins.rows && ins.rows[0] && ins.rows[0].id);
    if (!(kosuId > 0)) throw new Error('koşu numarası dönmedi');
  } catch (e) {
    await kilitleriBirak(anahtarlar, lockId);
    throw hata(424, 'db_okunamadi', `Koşu kaydı yazılamadı; iş başlatılmadı: ${maskele(e && e.message)}`);
  }
  const adim = `R${kosuId}`;
  const kok = dg.ciktiKok();
  const simdiSn = Math.floor(Date.now() / 1000);
  const ev = dg.ekstraDegiskenler({
    islem, kosuId, hedefHost: plan.hedefHost, yukHost: plan.yukHost, hedefIp: plan.hedefIp, vhost: plan.vhost,
    senaryo: plan.senaryo, p: plan.parametreler, k6: dg.k6Yolu(), kok, hedefTuru, wrk: dg.wrkYolu(), simdiSn,
  });
  const ihlal = dg.ekstraDegiskenleriDenetle(ev, { simdiSn });
  if (ihlal.length) {
    await kilitleriBirak(anahtarlar, lockId);
    await kosuBasarisiz(kosuId, adim, { hata: `son kapı: ${ihlal.join(', ')}` });
    throw hata(409, 'sinir_asildi', `Gönderilecek değişkenler son denetimi geçemedi: ${ihlal.join(', ')}.`);
  }
  let is;
  try {
    is = await baslat.isBaslat(req, {
      sablon,
      extraVars: ev,
      sablonAdi: `Nginx Yük Testi: ${islem === 'kosu' ? 'koşu' : 'ön kontrol'} ${adim} ${plan.hedefHost || plan.hedefIp}`,
      denetim: {
        eylem: islem === 'kosu' ? 'nginx_loadtest_baslat' : 'nginx_loadtest_on_kontrol',
        targetHost: plan.hedefHost || null,
        targetIp: plan.hedefIp,
        // Uzun diziler sonda. 2000 karaktere sigmazsa baslat.denetimAyrintisi once dizilerin ogelerini
        // kisaltir, sonra dizileri atar (sayilari kalir); kimlik alanlari her zaman kalir, JSON gecerli.
        ayrinti: {
          kosuId, adim, islem, hedefTuru, motor, hedefHost: plan.hedefHost || null, hedefIp: plan.hedefIp,
          vhost: plan.vhost, vhostListede: plan.vhostListede ?? null, serbestAg: plan.serbestAg ?? null,
          yukHost: plan.yukHost, senaryoId: plan.senaryo.id, senaryoSha256: plan.senaryo.sha256,
          parametreler: plan.parametreler, etiket: plan.etiket, onKontrolKosuId, planUyarilari, onaylananUyarilar,
        },
      },
    });
  } catch (e) {
    if (e && e.jobId != null) {
      // AWX degiskenleri yuttu, is baslatildi ve iptali denendi: kilit O ISE baglanir, is
      // terminale ulasinca supurme kurala gore birakir / tutar (iptal edilemediyse yuk kilitli kalir).
      await kilit.bindLocks(db(), anahtarlar, lockId, { awxServerId: e.awxServerId, awxJobId: e.jobId, bagTuru: islem }).catch(() => {});
    } else if (!(e && e.belirsiz)) {
      await kilitleriBirak(anahtarlar, lockId);
    }
    await kosuBasarisiz(kosuId, adim, { hata: maskele(e && e.message).slice(0, 1000), code: (e && e.code) || null, belirsiz: !!(e && e.belirsiz) },
      e && e.jobId != null ? e.jobId : null, e && e.jobId != null ? e.awxServerId : null);
    throw Object.assign(e, { kosuId });
  }
  try {
    await kilit.bindLocks(db(), anahtarlar, lockId, { awxServerId: is.awxServerId, awxJobId: is.jobId, bagTuru: islem });
  } catch (e) {
    // Kilit tam TTL ile alindi; baglanamamasi yalniz erken birakmayi geciktirir.
    console.warn('[NginxYukTesti] kilit isle baglanamadi (TTL ile dusecek):', maskele(e && e.message));
  }
  const swDizin = islem === 'kosu' ? dg.kosuDizini(kok, kosuId) : null;
  // Is numarasi HER ZAMAN yazilir (WHERE awx_job_id IS NULL); durum yalniz QUEUED ise RUNNING olur.
  // Baslatma surerken satir CANCELED (Durdur) / FAILED (bayat kuyruk) olduysa is takipsiz kalmasin:
  // hemen iptal edilir; kilitler o ise bagli kalir ve kural (kosu iptali) TTL'e kadar tutar.
  await birKezTekrarla('kosu satiri', () => db().query(
    `UPDATE nginx_loadtest_kosular
        SET adim = $2, awx_server_id = $3, awx_job_id = $4, sw_dizin = $5, started_at = GETUTCDATE(),
            durum = CASE WHEN durum = 'QUEUED' THEN 'RUNNING' ELSE durum END
      WHERE id = $1 AND awx_job_id IS NULL`,
    [kosuId, adim, is.awxServerId, is.jobId, swDizin],
  ));
  let sonDurum = null;
  try {
    const { rows } = await db().query(`SELECT durum FROM nginx_loadtest_kosular WHERE id = $1`, [kosuId]);
    sonDurum = rows && rows[0] ? rows[0].durum : null;
  } catch (e) {
    console.warn(`[NginxYukTesti] kosu ${kosuId} durumu baslatmadan sonra okunamadi:`, maskele(e && e.message));
  }
  if (sonDurum === 'CANCELED' || sonDurum === 'FAILED') {
    console.warn(`[NginxYukTesti] kosu ${kosuId} baslatilirken ${sonDurum} oldu; AWX is #${is.jobId} iptal ediliyor`);
    try {
      await runner.cancelJobOnServer(is.awxServerId, is.jobId);
    } catch (e) {
      console.warn(`[NginxYukTesti] AWX is #${is.jobId} iptal edilemedi (kilit TTL ile dusecek):`, maskele(e && e.message));
    }
  }
  return { kosuId, jobId: is.jobId, awxServerId: is.awxServerId };
}

// ── UCLAR ─────────────────────────────────────────────────────────────────────────────────

function adminSart(req) {
  if (!isAdmin(req)) throw hata(403, 'yetki_yok', 'Yük testi işlemleri yalnız Admin.');
}

function onKontrolGovdesi(b) {
  const g = b && typeof b === 'object' ? b : {};
  const senaryoId = sayi(g.senaryoId);
  if (!senaryoId) throw hata(400, 'gecersiz_istek', 'senaryoId gerekli.');
  // Hedef host ISTEGE BAGLI (host secici): yoksa yazilan IP siniflandirilir. Verilmis ama gecersizse 400.
  let hedefHost = null;
  if (g.hedefHost !== undefined && g.hedefHost !== null && g.hedefHost !== '') {
    hedefHost = dg.hostNormalle(g.hedefHost);
    if (!hedefHost) throw hata(400, 'gecersiz_istek', 'Geçersiz hedef sunucu adı.');
  }
  const yukHost = dg.hostNormalle(g.yukHost);
  if (!yukHost) throw hata(400, 'gecersiz_istek', 'Geçersiz yük makinesi adı.');
  const hedefIp = typeof g.hedefIp === 'string' ? g.hedefIp.trim() : '';
  if (!dg.gecerliIpv4(hedefIp)) throw hata(400, 'gecersiz_istek', 'hedefIp noktalı IPv4 olmalı.');
  const vhost = typeof g.vhost === 'string' ? g.vhost.trim().toLowerCase() : '';
  if (!dg.gecerliVhost(vhost)) throw hata(400, 'gecersiz_istek', 'vhost geçerli bir ad olmalı (küçük harf, port / joker / regex yok).');
  if (typeof g.sni !== 'boolean') throw hata(400, 'gecersiz_istek', 'sni true/false olmalı.');
  const e = dg.etiket(g.etiket);
  if (!e.ok) throw kapidan(e);
  return { senaryoId, hedefHost, hedefIp, vhost, yukHost, sni: g.sni, parametrelerHam: g.parametreler, etiket: e.deger };
}

function yonlendiriciKur() {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(requireAuth);
  // SALT OKUNUR ERISIM: sekmesi acilan Admin olmayan kullanici sonuclari OKUR; baslatma, durdurma,
  // senaryo yazma ve canli is ciktisi (/durum) Admin'de kalir.
  let gorunurlukKapisi = false;
  router.use(
    adminOkumaKapisi({
      okuma: ADMIN_DISI_OKUMA,
      mesaj: 'Yük testi işlemleri yalnız Admin.',
      hazir: () => gorunurlukKapisi,
    }),
  );
  try {
    const { requireVisiblePrefix, requireVisible } = require('../auth/visibility.cjs');
    router.use(requireVisiblePrefix('NginxConsole'));
    router.use(requireVisible('tab:nginx:yuktesti'));
    gorunurlukKapisi = true;
  } catch {
    /* motor yoksa: hazir() false kalir, Admin olmayan hicbir uca gecemez */
  }

  router.get('/hedefler', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const { envOfHost } = require('../audit/nginx-hosts.cjs');
      const izinli = dg.yukHostlari();
      const k = await dg.kaynaklariOku({ query, sql, ekHostlar: izinli });
      const hedefler = [...k.nginx.keys()].sort().map((h) => {
        const kp = dg.hedefKapisi(h, { nginxSatiri: k.nginx.get(h), invEnv: k.inv.get(h) });
        if (!kp.ok) return { host: h, env: envOfHost(h), ipler: [], vhostlar: [], vhostVerisi: false, uygun: false, neden: kp.message, kod: kp.code, hizSiniri: null, vuSiniri: null };
        const ay = dg.hedefAyrintisi(k, h);
        // Olculmus tavan 0 (limit_req < 2 r/s ya da limit_conn <= 1): baslatma yolu 409 sinir_asildi
        // der; ekran hedefi bastan uygun degil gostersin (ayni metin).
        const sifir = dg.sifirSinir(ay.hizSiniri, ay.vuSiniri);
        const ipYok = ay.ipler.length === 0;
        return {
          host: h, env: kp.env, ipler: ay.ipler, vhostlar: ay.vhostlar || [], vhostVerisi: Array.isArray(ay.vhostlar),
          uygun: !sifir && !ipYok,
          neden: sifir ? dg.SIFIR_SINIR_MESAJI : ipYok ? 'Bilinen IP yok (nginx taraması / envanter).' : null,
          kod: sifir ? 'sinir_asildi' : ipYok ? 'ip_hedefte_yok' : null,
          hizSiniri: ay.hizSiniri, vuSiniri: ay.vuSiniri,
        };
      });
      hedefler.sort((a, b) => Number(b.uygun) - Number(a.uygun) || a.host.localeCompare(b.host));
      const yukHostlari = izinli.map((h) => {
        const y = dg.yukHostKapisi(h, { izinli, nginxSatiri: k.nginx.get(h) || null, invEnv: k.inv.get(h), invVar: k.inv.has(h) });
        return { host: h, env: envOfHost(h), uygun: y.ok, neden: y.ok ? null : y.message };
      });
      // Serbest hedef izin listesi: acik mi herkese, aglarin kendisi YALNIZ Admin'e.
      const aglar = dg.serbestAglar();
      res.json({
        ok: true, hedefler, yukHostlari, sinirlar: dg.SINIRLAR, varsayilan: dg.VARSAYILAN,
        taramaVerisi: k.sunucular !== null, rateLimitVerisi: k.ayarlar !== null,
        serbest: { acik: aglar.length > 0, aglar: isAdmin(req) ? aglar.map((a) => a.metin) : [] },
        motorlar: [...dg.MOTORLAR],
      });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  // Yazilan IP'nin sinifi (ekran yalniz GOSTERIR; kesin karar on kontrol / kosu kapisinda yeniden
  // verilir). Yalniz Admin (ADMIN_DISI_OKUMA'da YOK); Portal DB'ye ve denetime YAZMAZ. Akis
  // kosuPlani ile ayni sira: kaynaklar -> (hedefHost varsa) hedef kapisi -> ipSinifla.
  router.get('/ip-sinifi', async (req, res) => {
    try {
      adminSart(req);
      const q = req.query || {};
      const ip = typeof q.ip === 'string' ? q.ip.trim() : '';
      if (!dg.gecerliIpv4(ip)) throw hata(400, 'gecersiz_istek', 'ip noktalı IPv4 olmalı.');
      const hostAl = (ad) => {
        const v = q[ad];
        if (v === undefined || v === '') return null;
        const h = typeof v === 'string' ? dg.hostNormalle(v) : '';
        if (!h) throw hata(400, 'gecersiz_istek', `Geçersiz ${ad === 'yukHost' ? 'yük makinesi' : 'hedef sunucu'} adı.`);
        return h;
      };
      const yukHost = hostAl('yukHost');
      const hedefHost = hostAl('hedefHost');
      const { query, sql } = require('../inventory/mssql.cjs');
      const k = await dg.kaynaklariOku({ query, sql, hostlar: [hedefHost, yukHost].filter(Boolean), ip });
      if (hedefHost) {
        const hk0 = dg.hedefKapisi(hedefHost, { nginxSatiri: k.nginx.get(hedefHost) || null, invEnv: k.inv.get(hedefHost) });
        if (!hk0.ok) throw kapidan(hk0);
      }
      const sinif = dg.ipSinifla(ip, k, { aglar: dg.serbestAglar(), yasak: dg.serbestYasak(), hedefHost, yukHost });
      if (!sinif.ok) {
        if (sinif.code === 'ip_hedefte_yok' && hedefHost) throw ipHedefteYok(ip, hedefHost, dg.hedefAyrintisi(k, hedefHost), { sahipler: sinif.sahipler });
        throw kapidan(sinif);
      }
      if (sinif.tur === 'serbest') {
        return res.json({ ok: true, tur: 'serbest', ip, host: null, ag: sinif.ag, digerSahipler: sinif.digerSahipler });
      }
      // Sunucu: /hedefler satiriyla AYNI alanlar; uygun:false da 200 (ekran on kontrol dugmesini kapatir).
      const h = sinif.host;
      const kaynaklar = [...((k.ipSahipleri && k.ipSahipleri.get(h)) || [])].sort();
      const kp = dg.hedefKapisi(h, { nginxSatiri: k.nginx.get(h) || null, invEnv: k.inv.get(h) });
      if (!kp.ok) {
        const { envOfHost } = require('../audit/nginx-hosts.cjs');
        return res.json({
          ok: true, tur: 'sunucu', ip, host: h, env: envOfHost(h), vhostlar: [], vhostVerisi: false, hizSiniri: null, vuSiniri: null,
          uygun: false, neden: kp.message, kod: kp.code, kaynaklar,
        });
      }
      const ay = dg.hedefAyrintisi(k, h);
      const sifir = dg.sifirSinir(ay.hizSiniri, ay.vuSiniri);
      const adaySiz = !ay.ipler.includes(ip);
      res.json({
        ok: true, tur: 'sunucu', ip, host: h, env: kp.env, vhostlar: ay.vhostlar || [], vhostVerisi: Array.isArray(ay.vhostlar),
        hizSiniri: ay.hizSiniri, vuSiniri: ay.vuSiniri,
        uygun: !sifir && !adaySiz,
        neden: sifir ? dg.SIFIR_SINIR_MESAJI : adaySiz ? ipHedefteYok(ip, h, ay).message : null,
        kod: sifir ? 'sinir_asildi' : adaySiz ? 'ip_hedefte_yok' : null,
        kaynaklar,
      });
    } catch (e) {
      // Eylem yok: salt okunur siniflandirma denetime yazilmaz.
      hataYaniti(req, res, e);
    }
  });

  router.get('/senaryolar', async (req, res) => {
    try {
      const { rows } = await dbOku((d) => d.query(
        `SELECT TOP 200 id, ad, aciklama, vhost, senaryo_tur, yol_sayisi, sha256, kaynak, created_by, created_at
           FROM nginx_loadtest_senaryolar WHERE silindi = 0 ORDER BY id DESC`,
      ));
      res.json({ ok: true, senaryolar: rows.map(senaryoApi) });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.get('/senaryolar/:id', async (req, res) => {
    try {
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz senaryo numarası.');
      const s = await senaryoOku(id);
      if (!s || s.silindi === true || s.silindi === 1) throw hata(409, 'senaryo_yok', 'Senaryo bulunamadı (silinmiş olabilir).');
      res.json({ ok: true, senaryo: { ...senaryoApi(s), tsv: s.tsv, ozet: jsonOku(s.ozet) } });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.post('/senaryolar', async (req, res) => {
    try {
      adminSart(req);
      const v = dg.senaryoGovdesi(req.body);
      if (!v.ok) throw kapidan(v);
      const s = v.deger;
      const kim = String(kullanici(req).username || 'unknown').slice(0, 100);
      const { rows } = await dbOku((d) => d.query(
        `INSERT INTO nginx_loadtest_senaryolar (ad, aciklama, vhost, senaryo_tur, tsv, sha256, yol_sayisi, ozet, kaynak, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [s.ad, s.aciklama, s.vhost, s.senaryoTur, s.tsv, s.sha256, s.yolSayisi, s.ozet, s.kaynak, kim],
      ));
      const id = Number(rows[0] && rows[0].id);
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_senaryo_ekle', {
          detail: baslat.denetimAyrintisi({ id, ad: s.ad, vhost: s.vhost, senaryoTur: s.senaryoTur, kaynak: s.kaynak, yolSayisi: s.yolSayisi, sha256: s.sha256 }),
        });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true, id });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.delete('/senaryolar/:id', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz senaryo numarası.');
      // Yumusak silme: gecmis kosular senaryo govdesine (durdurma dahil) erismeye devam eder.
      const r = await dbOku((d) => d.query(`UPDATE nginx_loadtest_senaryolar SET silindi = 1 WHERE id = $1 AND silindi = 0`, [id]));
      if (!r.rowCount) throw hata(409, 'senaryo_yok', 'Senaryo bulunamadı ya da zaten silinmiş.');
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_senaryo_sil', { detail: baslat.denetimAyrintisi({ id }) });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.post('/kosular/on-kontrol', async (req, res) => {
    let g = null;
    try {
      adminSart(req);
      g = onKontrolGovdesi(req.body);
      const plan = await kosuPlani(g);
      const r = await kosuyuBaslat(req, { islem: 'on_kontrol', plan });
      res.json({ ok: true, ...r });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_on_kontrol', g ? { host: g.hedefHost, ip: g.hedefIp, kosuId: e && e.kosuId } : null);
    }
  });

  router.post('/kosular', async (req, res) => {
    let ok = null;
    try {
      adminSart(req);
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const okId = sayi(b.onKontrolKosuId);
      if (!okId) throw hata(400, 'gecersiz_istek', 'onKontrolKosuId gerekli (önce ön kontrolü çalıştırın).');
      ok = await kosuOku(okId);
      if (!ok || ok.islem !== 'on_kontrol') throw hata(409, 'on_kontrol_eski', 'Ön kontrol bulunamadı; önce ön kontrolü çalıştırın.');
      if (!ayniKullanici(ok.created_by, kullanici(req).username)) {
        throw hata(409, 'on_kontrol_eski', 'Bu ön kontrol size ait değil; koşudan önce kendi ön kontrolünüzü çalıştırın.');
      }
      if (ok.durum !== 'DONE') throw hata(409, 'on_kontrol_eski', `Ön kontrol "${ok.durum}" durumunda; tamamlanmış (DONE) bir ön kontrol gerekli.`);
      const okSonuc = jsonOku(ok.sonuc);
      if (!okSonuc || String(okSonuc.durum || '').toUpperCase() !== 'OK') throw hata(409, 'on_kontrol_eski', 'Ön kontrol sonucu OK değil; yeniden çalıştırın.');
      const yas = ok.yas_sn == null ? null : Number(ok.yas_sn);
      if (yas == null || !Number.isFinite(yas) || yas > ON_KONTROL_MAX_YAS_SN || yas < -60) {
        throw hata(409, 'on_kontrol_eski', `Ön kontrol ${yas == null ? 'zamanı okunamadı' : `${Math.round(yas / 60)} dk önce bitti`}; en çok 15 dk önceki ön kontrol kabul edilir.`);
      }
      // Tur ve motor SATIRDAN (set_stats yankisindan degil); eski satir: DB varsayilani sunucu / k6.
      const tur = ok.hedef_turu || 'sunucu';
      const motor = motorOf(ok);
      if (tur === 'serbest' ? !dg.onayMetniDogru(b.confirmText, ok.hedef_ip) : !dg.onayMetniDogru(b.confirmText, ok.hedef_host)) {
        throw hata(409, 'onay_metni', tur === 'serbest'
          ? `Onay için hedef IP'yi (${ok.hedef_ip}) birebir yazın.`
          : `Onay için hedef sunucu adını (${ok.hedef_host}) birebir yazın.`);
      }
      const deg = dg.onKontrolDegerlendir(jsonOku(ok.on_kontrol_ozet), { hedefTuru: tur, motor });
      if (deg.engeller.length) throw hata(409, 'on_kontrol_eski', `Ön kontrol koşuya izin vermiyor: ${deg.engeller.join('; ')}.`, { engeller: deg.engeller });
      // Onaylanacak liste = on kontrolde saklanan plan uyarilari + on kontrol degerlendirmesi (ekranla ayni).
      const sakliPlanUyarilari = metinDizisi(ok.plan_uyarilari);
      const uyarilar = [...sakliPlanUyarilari, ...deg.uyarilar];
      if (uyarilar.length && b.uyariOnay !== true) {
        throw hata(409, 'uyari_onayi', 'Ön kontrol uyarılarını okuyup açıkça onaylamanız gerekiyor.', { uyarilar });
      }
      // Parametreler ISTEMCIDEN DEGIL on kontrol satirindan; yeniden olculur ve ayni kalmali.
      const sakli = jsonOku(ok.parametreler) || {};
      const plan = await kosuPlani({
        senaryoId: Number(ok.senaryo_id), hedefHost: tur === 'serbest' ? null : ok.hedef_host, hedefIp: ok.hedef_ip, vhost: ok.vhost, yukHost: ok.yuk_host,
        sni: sakli.sni, parametrelerHam: sakli, etiket: ok.etiket,
      });
      if (plan.hedefTuru !== tur || (plan.hedefHost || '') !== (ok.hedef_host || '')) {
        throw hata(409, 'on_kontrol_eski', "Hedef IP'nin sınıfı ön kontrolden bu yana değişti; ön kontrolü yeniden çalıştırın.");
      }
      // Onaylanmamis uyari gecmez: yeniden kurulan planin saklanmayan uyarisi varsa on kontrol eskidir.
      const yeniUyari = plan.uyarilar.find((u) => !sakliPlanUyarilari.includes(u));
      if (yeniUyari) throw hata(409, 'on_kontrol_eski', `Ön kontrolden bu yana yeni uyarı çıktı (${yeniUyari}); ön kontrolü yeniden çalıştırın.`);
      if (kararliJson(plan.parametreler) !== kararliJson(sakli)) {
        throw hata(409, 'on_kontrol_eski', 'Parametreler ön kontrolden bu yana değişti; ön kontrolü yeniden çalıştırın.');
      }
      const r = await kosuyuBaslat(req, { islem: 'kosu', plan, onKontrolKosuId: okId, onaylananUyarilar: uyarilar });
      res.json({ ok: true, ...r });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_baslat', ok ? { host: ok.hedef_host, ip: ok.hedef_ip, kosuId: e && e.kosuId } : null);
    }
  });

  // Liste: islem / durum / hedef suzgeci ve `onceki` (id < onceki) ile sayfalama. Gecersiz deger
  // sessizce yok sayilmaz (yanlis listeyi "tamami" diye gostermek yerine 400). limit + 1 satir
  // cekilir: fazlasi varsa dahaVar.
  router.get('/kosular', async (req, res) => {
    try {
      const q = req.query || {};
      const deger = (ad) => {
        const v = q[ad];
        if (v === undefined || v === '') return undefined;
        if (typeof v !== 'string') throw hata(400, 'gecersiz_istek', `${ad} tek bir değer olmalı.`);
        return v;
      };
      let limit = 50;
      const hamLimit = deger('limit');
      if (hamLimit !== undefined) {
        limit = dg.tamSayi(hamLimit);
        if (limit === null || limit < 1 || limit > 200) throw hata(400, 'gecersiz_istek', 'limit 1..200 arasında bir tam sayı olmalı.');
      }
      const params = [limit + 1];
      const kosullar = [];
      const kosul = (ifade, v) => {
        params.push(v);
        kosullar.push(`${ifade} $${params.length}`);
      };
      const hamHedef = deger('hedef');
      if (hamHedef !== undefined) {
        const hedef = dg.hostNormalle(hamHedef);
        if (!hedef) throw hata(400, 'gecersiz_istek', 'Geçersiz hedef sunucu adı.');
        kosul('k.hedef_host =', hedef);
      }
      const islem = deger('islem');
      if (islem !== undefined) {
        if (!LISTE_ISLEMLERI.has(islem)) throw hata(400, 'gecersiz_istek', "islem 'kosu' ya da 'on_kontrol' olmalı.");
        kosul('k.islem =', islem);
      }
      const durum = deger('durum');
      if (durum !== undefined) {
        if (!LISTE_DURUMLARI.has(durum)) throw hata(400, 'gecersiz_istek', `durum şunlardan biri olmalı: ${[...LISTE_DURUMLARI].join(', ')}.`);
        kosul('k.durum =', durum);
      }
      // Serbest satirin hedef sunucusu yok: IP / hedef turu / motor suzgecleri (gecersiz deger 400).
      const ipSuz = deger('ip');
      if (ipSuz !== undefined) {
        if (!dg.gecerliIpv4(ipSuz)) throw hata(400, 'gecersiz_istek', 'ip noktalı IPv4 olmalı.');
        kosul('k.hedef_ip =', ipSuz);
      }
      const turSuz = deger('hedefTuru');
      if (turSuz !== undefined) {
        if (!dg.HEDEF_TURLERI.includes(turSuz)) throw hata(400, 'gecersiz_istek', "hedefTuru 'sunucu' ya da 'serbest' olmalı.");
        kosul('k.hedef_turu =', turSuz);
      }
      const motorSuz = deger('motor');
      if (motorSuz !== undefined) {
        if (!dg.MOTORLAR.includes(motorSuz)) throw hata(400, 'gecersiz_istek', "motor 'k6' ya da 'wrk' olmalı.");
        kosul('k.motor =', motorSuz);
      }
      const hamOnceki = deger('onceki');
      if (hamOnceki !== undefined) {
        const onceki = sayi(hamOnceki);
        if (!onceki) throw hata(400, 'gecersiz_istek', 'onceki pozitif bir koşu numarası olmalı.');
        kosul('k.id <', onceki);
      }
      const nerede = kosullar.length ? `WHERE ${kosullar.join(' AND ')}` : '';
      const { rows } = await dbOku((d) => d.query(
        `SELECT TOP ($1) ${LISTE_KOLONLARI} FROM nginx_loadtest_kosular k LEFT JOIN nginx_loadtest_senaryolar s ON s.id = k.senaryo_id
          ${nerede} ORDER BY k.id DESC`,
        params,
      ));
      res.json({ ok: true, kosular: rows.slice(0, limit).map(kosuApi), dahaVar: rows.length > limit });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.get('/kosular/:id', async (req, res) => {
    try {
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz koşu numarası.');
      const k = await kosuOku(id);
      if (!k) throw hata(409, 'kosu_yok', 'Koşu bulunamadı.');
      const { rows: adimlar } = await dbOku((d) => d.query(`SELECT * FROM nginx_loadtest_adimlar WHERE kosu_id = $1 ORDER BY id ASC`, [id]));
      let okOzet = null;
      let planUyarilari = [];
      if (k.islem === 'on_kontrol') {
        okOzet = jsonOku(k.on_kontrol_ozet);
        planUyarilari = metinDizisi(k.plan_uyarilari);
      } else if (k.on_kontrol_kosu_id != null) {
        const { rows } = await dbOku((d) => d.query(`SELECT on_kontrol_ozet, plan_uyarilari FROM nginx_loadtest_kosular WHERE id = $1`, [Number(k.on_kontrol_kosu_id)]));
        okOzet = jsonOku(rows[0] && rows[0].on_kontrol_ozet);
        planUyarilari = metinDizisi(rows[0] && rows[0].plan_uyarilari);
      }
      const tur = k.hedef_turu || 'sunucu';
      const motor = motorOf(k);
      const deg = okOzet ? dg.onKontrolDegerlendir(okOzet, { hedefTuru: tur, motor }) : null;
      // Izinli ag ekran icin env'den SU AN hesaplanir (DB okumaz); playbook'un esledigi girdi onKontrol.serbest_ag.
      const serbestAg = tur === 'serbest' ? (dg.serbestAgBul(k.hedef_ip, dg.serbestAglar()) || {}).metin || null : null;
      res.json({
        ok: true,
        kosu: {
          ...kosuApi(k),
          parametreler: jsonOku(k.parametreler),
          planUyarilari,
          serbestAg,
          onKontrol: okOzet,
          onKontrolEngelleri: deg ? deg.engeller : [],
          // Ekran ve kosu onayi AYNI listeyi gorur: plan uyarilari basta.
          onKontrolUyarilari: [...planUyarilari, ...(deg ? deg.uyarilar : [])],
          onKontrolYasSn: k.islem === 'on_kontrol' && k.yas_sn != null ? Number(k.yas_sn) : null,
          gecersizNedenleri: jsonOku(k.gecersiz_nedenleri) || [],
          sonucOzet: jsonOku(k.sonuc),
          swDizin: k.sw_dizin ?? null,
          iptalEden: k.iptal_eden ?? null,
          finalizedAt: iso(k.finalized_at),
          durdurIsi: k.durdur_awx_job_id == null ? null : { awxServerId: Number(k.durdur_awx_server_id), awxJobId: Number(k.durdur_awx_job_id) },
          sonuclandirmaDenemesi: Number(k.sonuclandirma_denemesi) || 0,
        },
        adimlar: adimlar.map(adimApi),
      });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.get('/kosular/:id/durum', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz koşu numarası.');
      const k = await kosuOku(id);
      if (!k) throw hata(409, 'kosu_yok', 'Koşu bulunamadı.');
      const temel = { kosuDurum: k.durum, gecerlilik: k.gecerlilik ?? null };
      const sid = k.awx_server_id == null ? null : Number(k.awx_server_id);
      const jid = k.awx_job_id == null ? null : Number(k.awx_job_id);
      if (sid == null || !(jid > 0)) {
        const status = k.durum === 'QUEUED' ? 'pending' : k.durum === 'CANCELED' ? 'canceled' : 'failed';
        return res.json({ ok: true, status, finished: !AKTIF.has(k.durum), output: '', outputOffset: 0, outputLength: 0, result: null, ...temel });
      }
      const runner = require('../ansible/runner.cjs');
      const parcala = (metin) => {
        // `since`: istemcinin elindeki MASKELI metnin uzunlugu. Gecersiz / metinden uzunsa tamami.
        const since = dg.tamSayi(req.query && req.query.since);
        const ofs = since !== null && since >= 0 && since <= metin.length ? since : 0;
        return { output: metin.slice(ofs), outputOffset: ofs, outputLength: metin.length };
      };
      let st;
      try {
        st = await runner.getJobStatusOnServer(sid, jid);
      } catch (e) {
        if (e && (e.code === 'awx_server_missing' || Number(e.status) === 404)) {
          const { rows } = await dbOku((d) => d.query(`SELECT TOP 1 stdout FROM ansible_job_output WHERE awx_server_id = $1 AND job_id = $2`, [sid, jid]));
          if (!rows.length) throw hata(409, 'awx_okunamadi', `AWX iş #${jid} okunamıyor ve Portal arşivinde çıktısı yok.`);
          return res.json({ ok: true, kaynak: 'arsiv', status: k.durum === 'CANCELED' ? 'canceled' : k.durum === 'DONE' ? 'successful' : 'failed', finished: true, ...parcala(maskele(rows[0].stdout)), result: null, jobId: jid, awxServerId: sid, ...temel });
        }
        throw hata(424, 'awx_okunamadi', `AWX işi okunamadı (#${jid}): ${maskele(e && e.message)}`);
      }
      // BAGLAMA: kosu satirindaki is bu modulun playbook'u olmali (ayni numarali baska is gosterilmez).
      const beklenen = String((require('../ansible/template-preflight.cjs').BEKLENEN_PLAYBOOK || {})[baslat.KAYIT_ANAHTARI] || baslat.BEKLENEN_PLAYBOOK_ADI).toLowerCase();
      const gercek = String(st.playbook || '').split('/').pop().toLowerCase();
      if (!gercek) throw hata(424, 'awx_okunamadi', `AWX iş #${jid}: playbook bilgisi okunamadı; çıktı doğrulanmadan gösterilmez.`);
      if (gercek !== beklenen) throw hata(409, 'awx_template_playbook_mismatch', `AWX'teki #${jid} yük testi playbook'u değil (${st.playbook}); çıktı gösterilmedi.`);
      // Is bitse de olaylar islenirken stdout eksik olabilir: o surece BITMEMIS sayilir.
      const bitti = TERMINAL.has(String(st.status)) && st.eventProcessingFinished !== false;
      if (bitti) require('../ansible/job-stdout-cache.cjs').sil(sid, jid);
      let ham;
      try {
        ({ output: ham } = await runner.getJobOutputOnServer(sid, jid, { artimli: !bitti }));
      } catch (e) {
        throw hata(424, 'awx_okunamadi', `AWX iş #${jid} çıktısı okunamadı: ${maskele(e && e.message)}`);
      }
      // Bitmis is: arsiv + /sw okuma + analiz poller'da (uzun surebilir; yoklamayi bekletmez).
      if (bitti && AKTIF.has(k.durum)) poller.tetikle(id);
      const ozet = require('../scalex/result.cjs').extractStatsKey(st.artifacts, poller.STATS_ANAHTARI);
      res.json({
        ok: true, kaynak: 'awx', status: st.status, finished: bitti, ...parcala(maskele(ham)),
        result: ozet ? maskeleDerin(ozet) : null, jobId: jid, awxServerId: sid, ...temel,
      });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.post('/kosular/:id/durdur', async (req, res) => {
    let k = null;
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz koşu numarası.');
      k = await kosuOku(id);
      if (!k) throw hata(409, 'kosu_yok', 'Koşu bulunamadı.');
      if (k.durum === 'DONE') throw hata(409, 'kosu_bitti', 'Koşu tamamlanmış; durdurulacak bir şey yok.');
      const sid = k.awx_server_id == null ? null : Number(k.awx_server_id);
      const jid = k.awx_job_id == null ? null : Number(k.awx_job_id);
      // Baslatma suruyor (is numarasi henuz yazilmadi): durdur satiri CANCELED yapar, sonra donen is
      // takipsiz kalirdi. Pencere icinde reddet; daha eski yarim satir eskisi gibi kapanir.
      if (k.durum === 'QUEUED' && !(jid > 0)) {
        const yas = k.olusma_yas_sn == null ? NaN : Number(k.olusma_yas_sn);
        if (!Number.isFinite(yas) || yas < BASLATMA_PENCERESI_SN) {
          throw hata(409, 'baslatiliyor', 'Koşu başlatılıyor; birkaç saniye sonra yeniden deneyin.');
        }
      }
      const kim = String(kullanici(req).username || 'unknown').slice(0, 100);
      const sonuc = { iptal: null, iptalHatasi: null, durdurIsi: null, durdurHatasi: null };
      const runner = require('../ansible/runner.cjs');
      // Durdurmada siniflandirma YENIDEN YAPILMAZ: tur ve motor satirdan (eski satir: sunucu / k6).
      const tur = k.hedef_turu || 'sunucu';
      const motor = motorOf(k);
      if (sid != null && jid > 0) {
        try {
          sonuc.iptal = await runner.cancelJobOnServer(sid, jid);
        } catch (e) {
          sonuc.iptalHatasi = maskele(e && e.message).slice(0, 500);
        }
      }
      const iptalOldu = !!(sonuc.iptal && (sonuc.iptal.canceled || sonuc.iptal.alreadyTerminal));
      // AWX iptali uzaktaki async gorevi ve ayrik k6'yi DURDURMAZ: durdur kipindeki playbook kosu
      // dizinindeki pid'leri ve dizine bagli k6'yi sonlandirir. Ortam kapisi BURADA YOK: durdurmak
      // her zaman serbest (CANCELED / FAILED kosuda da: kalan surec temizligi).
      if (k.islem === 'kosu') {
        try {
          const sen = await senaryoOku(Number(k.senaryo_id));
          const p = jsonOku(k.parametreler);
          if (!sen || !p) throw hata(409, 'senaryo_yok', 'Koşunun senaryosu ya da parametreleri okunamadı.');
          const simdiSn = Math.floor(Date.now() / 1000);
          const ev = dg.ekstraDegiskenler({
            islem: 'durdur', kosuId: id, hedefHost: k.hedef_host, yukHost: k.yuk_host, hedefIp: k.hedef_ip, vhost: k.vhost,
            senaryo: { tur: sen.senaryo_tur, tsv: sen.tsv, sha256: String(sen.sha256).trim() }, p: { ...p, motor }, k6: dg.k6Yolu(), kok: dg.ciktiKok(),
            hedefTuru: tur, wrk: dg.wrkYolu(), simdiSn,
          });
          const ihlal = dg.ekstraDegiskenleriDenetle(ev, { simdiSn });
          if (ihlal.length) throw hata(409, 'sinir_asildi', `Durdurma değişkenleri son denetimi geçemedi: ${ihlal.join(', ')}.`);
          const is = await baslat.isBaslat(req, {
            sablon: await baslat.sablonuCoz(),
            extraVars: ev,
            sablonAdi: `Nginx Yük Testi: durdur R${id} ${k.hedef_host || k.hedef_ip}`,
            denetim: {
              eylem: 'nginx_loadtest_durdur', targetHost: k.hedef_host || null, targetIp: k.hedef_ip,
              ayrinti: { kosuId: id, hedefTuru: tur, motor, iptal: sonuc.iptal, iptalHatasi: sonuc.iptalHatasi },
            },
          });
          sonuc.durdurIsi = { jobId: is.jobId, awxServerId: is.awxServerId };
        } catch (e) {
          sonuc.durdurHatasi = maskele(e && e.message).slice(0, 500);
        }
      }
      await dbOku((d) => d.query(`UPDATE nginx_loadtest_kosular SET iptal_eden = $2 WHERE id = $1`, [id, kim]));
      // Hic AWX isi olmayan (baslatmasi yarim kalmis) satir dogrudan kapanir.
      if (sid == null || !(jid > 0)) {
        await dbOku((d) => d.query(
          `UPDATE nginx_loadtest_kosular SET durum = 'CANCELED', finalized_at = GETUTCDATE(), finished_at = COALESCE(finished_at, GETUTCDATE())
            WHERE id = $1 AND durum = 'QUEUED' AND awx_job_id IS NULL`, [id]));
      }
      if (sonuc.durdurIsi) {
        const d = sonuc.durdurIsi;
        await birKezTekrarla('durdur isi', () => db().query(
          `UPDATE nginx_loadtest_kosular SET durdur_awx_server_id = $2, durdur_awx_job_id = $3 WHERE id = $1`, [id, d.awxServerId, d.jobId]));
        // Kosunun kilitleri durdur isine baglanir: is basariyla biterse (iki sunucu da "kalan surec
        // yok") supurme hemen birakir, aksi halde TTL (en az butce + 180 sn). Iptal BASARISIZSA kosu
        // isi hala calisiyor olabilir: kilit o ise bagli kalir (durdur isinin basarisi birakmasin).
        if (k.kilit_id && (iptalOldu || sid == null || !(jid > 0))) {
          try {
            await kilit.durdurIsineBagla(db(), k.kilit_id, { awxServerId: d.awxServerId, awxJobId: d.jobId, uzatSn: poller.butceSnOf(k) + KILIT_EK_SN });
          } catch (e) {
            console.warn(`[NginxYukTesti] kosu ${id} kilitleri durdur isine baglanamadi (TTL ile dusecek):`, maskele(e && e.message));
          }
        }
      }
      // Kosu: durdurma isi yoksa uzaktaki yuk surebilir; iptal basarili olsa da BASARI DEGIL. Metin
      // motor ve ture gore (k6 + sunucu tur 2 ile birebir; serbestte hedefte kaydedici yok).
      if (k.islem === 'kosu' && !sonuc.durdurIsi) {
        const uzaktaki = tur === 'serbest' ? motor : `${motor} / kaydedici`;
        throw hata(424, 'durdur_baslatilamadi',
          `AWX işi ${iptalOldu ? 'iptal edildi' : 'iptal edilemedi'}, ancak durdurma işi başlatılamadı: ${sonuc.durdurHatasi}. Uzaktaki ${uzaktaki} sürüyor olabilir; Durdur'u yeniden deneyin. Kilitler koşunun süre sınırına kadar tutulur.`,
          { iptal: sonuc.iptal, iptalHatasi: sonuc.iptalHatasi, durdurHatasi: sonuc.durdurHatasi });
      }
      if (!iptalOldu && !sonuc.durdurIsi && sid != null && jid > 0) {
        throw hata(424, 'awx_okunamadi', `Durdurulamadı: ${[sonuc.iptalHatasi, sonuc.durdurHatasi].filter(Boolean).join(' / ') || 'AWX yanıt vermedi'}`);
      }
      // Durdur isi baslatildiysa denetimi isBaslat yazdi; yoksa (on kontrol / is numarasiz satir) burada.
      if (!sonuc.durdurIsi) {
        try {
          require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_durdur', {
            result: sonuc.iptal && sonuc.iptal.canceled ? 'ok' : 'fail',
            targetHost: k.hedef_host || null, targetIp: k.hedef_ip,
            detail: baslat.denetimAyrintisi({ kosuId: id, ...sonuc }),
          });
        } catch {
          /* best-effort */
        }
      }
      res.json({ ok: true, ...sonuc });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_durdur', k ? { host: k.hedef_host, ip: k.hedef_ip, kosuId: k.id } : null);
    }
  });

  // Sonucu okunamamis kosuyu yeniden sonuclandirmaya alir (OKUNAMADI otomatik yeniden okunmaz:
  // poller en cok 3 kez dener). CAS: yalniz is numarali, sonucu okunamamis KOSU satiri; deneme
  // sayaci sifirlanir, poller hemen tetiklenir. Yalniz Admin (ADMIN_DISI_OKUMA'da YOK).
  router.post('/kosular/:id/yeniden-oku', async (req, res) => {
    let k = null;
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz koşu numarası.');
      k = await kosuOku(id);
      const r = await dbOku((d) => d.query(
        `UPDATE nginx_loadtest_kosular SET durum = 'FINALIZING', sonuclandirma_denemesi = 0
          WHERE id = $1 AND islem = 'kosu' AND awx_job_id IS NOT NULL AND (durum = 'OKUNAMADI' OR gecerlilik = 'OKUNAMADI')`,
        [id],
      ));
      if (!r.rowCount) throw hata(409, 'yeniden_okunamaz', 'Yalnız sonucu okunamamış koşular yeniden okunabilir.');
      poller.tetikle(id);
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_yeniden_oku', {
          targetHost: (k && k.hedef_host) || null, targetIp: (k && k.hedef_ip) || null,
          detail: baslat.denetimAyrintisi({ kosuId: id, oncekiDurum: k ? k.durum : null, oncekiGecerlilik: k ? k.gecerlilik ?? null : null }),
        });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_yeniden_oku', k ? { host: k.hedef_host, ip: k.hedef_ip, kosuId: k.id } : null);
    }
  });

  router.get('/karsilastir', async (req, res) => {
    try {
      const q = req.query || {};
      const ref = sayi(q.ref);
      const aday = sayi(q.aday);
      if (!ref || !aday) throw hata(400, 'gecersiz_istek', 'ref ve aday koşu numaraları gerekli.');
      const esik = (v, ad) => {
        if (v === undefined || v === '') return undefined;
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0 || n > 100) throw hata(400, 'gecersiz_istek', `${ad} 0..100 arasında olmalı.`);
        return n;
      };
      const esikCpu = esik(q.esikCpu, 'esikCpu');
      const esikP95 = esik(q.esikP95, 'esikP95');
      const [r, a] = [await kosuOku(ref), await kosuOku(aday)];
      for (const [x, ad] of [[r, 'referans'], [a, 'aday']]) {
        if (!x || x.islem !== 'kosu') throw hata(409, 'kosu_yok', `${ad} koşu bulunamadı (ön kontrol karşılaştırılmaz).`);
      }
      const adimlarOf = async (id) => (await dbOku((d) => d.query(`SELECT * FROM nginx_loadtest_adimlar WHERE kosu_id = $1 ORDER BY id ASC`, [id]))).rows.map(adimAnaliz);
      const ra = await adimlarOf(ref);
      const aa = await adimlarOf(aday);
      // Motor / hedef turu / is parcacigi / hiz tavani satirdan: k6 ile wrk, farkli is parcacigi ve
      // farkli tavan_rps (wrk) VERI_YOK; serbest taraf CPU'suz karar yolu (analiz.kararVer, sozlesme 10.2).
      const parcacik = (x) => (jsonOku(x.parametreler) || {}).is_parcacigi ?? null;
      const tavan = (x) => (jsonOku(x.parametreler) || {}).tavan_rps ?? null;
      let karar;
      try {
        const analiz = poller.cModulu('analiz.cjs');
        karar = analiz.kararVer(ra, aa, {
          ...(esikCpu !== undefined ? { esikCpu } : {}), ...(esikP95 !== undefined ? { esikP95 } : {}),
          refMotor: motorOf(r), adayMotor: motorOf(a), refHedefTuru: r.hedef_turu || 'sunucu', adayHedefTuru: a.hedef_turu || 'sunucu',
          refIsParcacigi: parcacik(r), adayIsParcacigi: parcacik(a), refTavanRps: tavan(r), adayTavanRps: tavan(a),
        });
      } catch (e) {
        throw hata(424, 'analiz_okunamadi', `Karşılaştırma hesaplanamadı: ${maskele(e && e.message)}`);
      }
      const ozet = (x) => ({
        id: Number(x.id), etiket: x.etiket ?? null, createdAt: iso(x.created_at), gecerlilik: x.gecerlilik ?? null, durum: x.durum,
        motor: motorOf(x), hedefTuru: x.hedef_turu || 'sunucu',
      });
      res.json({
        ok: true, karar: karar.karar, nedenler: karar.nedenler || [], tablo: karar.tablo || [],
        kademe: karar.kademe ?? null, kombinasyon: karar.kombinasyon ?? null, ref: ozet(r), aday: ozet(a),
      });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  return router;
}

function initNginxLoadtest(app) {
  app.use('/api/nginx-loadtest', yonlendiriciKur());
  poller.startPoller();
}

module.exports = {
  initNginxLoadtest,
  SEKME,
  _ADMIN_DISI_OKUMA: ADMIN_DISI_OKUMA,
  _yonlendiriciKurForTest: yonlendiriciKur,
  _kosuPlaniForTest: kosuPlani,
  _kararliJsonForTest: kararliJson,
};
