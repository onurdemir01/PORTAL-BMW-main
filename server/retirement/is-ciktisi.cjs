// server/retirement/is-ciktisi.cjs - Retirement hedefinin AWX isleri ve is ciktisi (2026-10-26).
//
// Kullanici: "is ciktisini gormek icin bir buton koy". Ekran ciktiyi yalniz bu oturumda elle baslatilan
// isler icin (alt cubuktaki is takipcisi) gosterebiliyordu; zamanlayicinin baslattigi isler (zamanlanmis
// STOP, silme on kontrolu, DELETE, vhost isleri) ve onceki oturumlarin isleri hic gorunmuyordu.
//
// IKI PARCA:
//   hedefIsleri : hedefin BILINEN isleri, yalniz DB'den (AWX cagrisi yok). Hangi isin hangi adim oldugu
//                 kanitlanamazsa is listeye KONMAZ ve `awxIsleriEksik` doner (tahmin yok).
//   GET /:id/targets/:tid/is-ciktisi?adim=&web= : SALT OKUNUR cikti ucu.
//     - Istemci sunucu / is numarasi VERMEZ. Is no hedefin kendi alanindan; sunucu saklanan awxServerId'den
//       ya da TEK is gecmisi satirindan cozulur. Playbook Kayitlarindan DEGIL: kayit baska sunucuya
//       cevrilirse ayni numarali BASKA bir is okunurdu (awx-sunucu-bagimlilik.cjs notu).
//     - AWX isinin playbook'u (ve gecmiste varsa template'i) adimin beklenen playbook'u olmali.
//     - Is surerken artimli okuma; bitince onbellek silinir, tam cekim yapilir ve MASKELI arsivlenir.
//     - Cikti her yanitta maskelenir (redactSecrets(maskSecrets(..))); arsivden okunan da (arsive daha
//       once ss/job-status HAM yazmis olabilir).
//     - AWX sunucusu kapali ya da is AWX'te yoksa Portal arsivinden okunur (kaynak 'arsiv').
//     - Hedefe, olaylara ve is gecmisine YAZMAZ; tek yazim arsiv INSERT'u.
//   HTTP: 409 = kalici (yeniden denemek ise yaramaz), 424 = gecici (olculemedi). 404 / 502 / 503 YOK:
//   kurumsal gecit bu kodlarda govdeyi HTML'e cevirir ve `code` kaybolur.
//   Router'a index.cjs'teki Admin + ServerHub kapilarindan SONRA baglanir (mount).
'use strict';

const ADIM_SIRASI = Object.freeze(['onkontrol', 'stop', 'web', 'delete_onkontrol', 'delete', 'rollback_onkontrol', 'rollback']);
// Adim -> Playbook Kayitlari anahtari (beklenen playbook template-preflight BEKLENEN_PLAYBOOK'tan).
const ADIM_ANAHTARI = Object.freeze({
  onkontrol: 'app_retirement_stop',
  stop: 'app_retirement_stop',
  web: 'server_hub_fix',
  delete_onkontrol: 'app_retirement_delete',
  delete: 'app_retirement_delete',
  rollback_onkontrol: 'app_retirement_rollback',
  rollback: 'app_retirement_rollback',
});
// Is gecmisi template adinin oneki (index.cjs launch cagrilari) -> aile. Vhost plani ve trafik olcumu
// hedefe yazilmaz; onlarin satirlari hicbir aileye girmez.
const AILE_ONEKI = Object.freeze({
  stop: ['retirement: plan ', 'retirement: stop '],
  delete: ['retirement: silme ', 'retirement: delete '],
  rollback: ['retirement: geri al'],
});
const AILE = Object.freeze({ onkontrol: 'stop', stop: 'stop', delete_onkontrol: 'delete', delete: 'delete', rollback_onkontrol: 'rollback', rollback: 'rollback' });
const PLAN_ADIMI = Object.freeze({ onkontrol: true, delete_onkontrol: true, rollback_onkontrol: true, stop: false, delete: false, rollback: false });
const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
// runner.cjs AWX_TRUNCATION_NOTICE'in degismeyen parcasi (bekci: IC-K).
const KIRPMA_IZI = '[PORTAL] Bu cikti bellek korumasi nedeniyle KIRPILDI';
const ZAMANLAYICI_KULLANICI = 'Portal (zamanlanmis)';

const U = (s) => String(s ?? '').trim().toUpperCase();
const sayi = (x) => {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const sunucuNo = (x) => (x == null || x === '' || !Number.isInteger(Number(x)) || Number(x) < 0 ? null : Number(x));
const iso = (v) => (v == null || v === '' ? null : v instanceof Date ? v.toISOString() : String(v));
function jsonNesne(s) {
  try {
    const o = typeof s === 'string' ? JSON.parse(s) : s;
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

// ── MASKE ──────────────────────────────────────────────────────────────────────────────────────
// Zincir: redactSecrets(maskSecrets(yerelMaske(ham))). maskSecrets yalniz password= / -password / PWD=
// kelimesini yakalar; tirnakli anahtari (`"TBMWANS_PWD": "x"`), become_pass / ssh_pass / client_secret /
// api_key / token anahtarlarini, bosluklu ya da kacisli tirnakli degeri, Basic yetki basligini ve URL
// icindeki kimligi GORMEZ (denetim G5): yerelMaske once onlari maskeler. redactSecrets Portal'in kendi
// AWX sirlarini (sunucu token'i, parola, Bearer) maskeler.
// Hassas anahtar: parola / gizli / token / api anahtari / kimlik; "pass" yalniz ayri parca olarak
// (become_pass, ssh_pass, pass) - "passed" / "bypass" DEGIL.
const HASSAS = /(password|passwd|passphrase|pwd|secret|token|api[_-]?key|apikey|credential)/i;
const hassasAnahtar = (k) => HASSAS.test(k) || /(^|[_.-])pass($|[_.-])/i.test(k);
const DEGER = `("(?:\\\\.|[^"\\\\\\r\\n])*"|'(?:\\\\.|[^'\\\\\\r\\n])*'|[^\\s"',;}&]+)`;
const ANAHTAR_DEGER = new RegExp(`(["']?)([A-Za-z0-9_.-]*(?:pass|pwd|secret|token|api[_-]?key|credential)[A-Za-z0-9_.-]*)\\1(\\s*[=:]\\s*)${DEGER}`, 'gi');
const SECENEK_DEGER = new RegExp(`(^|\\s)(-{1,2}[A-Za-z0-9_-]*pass[A-Za-z0-9_-]*\\s+)${DEGER}`, 'gim');
const YETKI_BASLIGI = /(Authorization\s*:\s*(?:Basic|Digest|Token|Negotiate)\s+)\S+/gi;
const URL_KIMLIGI = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi;
const tirnakli = (v) => (v[0] === '"' || v[0] === "'" ? `${v[0]}***${v[0]}` : '***');
function yerelMaske(s) {
  return s
    .replace(ANAHTAR_DEGER, (tam, q, k, ayr, v) => (hassasAnahtar(k) ? `${q}${k}${q}${ayr}${tirnakli(v)}` : tam))
    .replace(SECENEK_DEGER, (tam, bas, sec, v) => (hassasAnahtar(sec.trim().replace(/^-+/, '')) ? `${bas}${sec}${tirnakli(v)}` : tam))
    .replace(YETKI_BASLIGI, '$1***')
    .replace(URL_KIMLIGI, '$1***$3');
}
function maskele(metin) {
  const { maskSecrets } = require('../opsx/was-state.cjs');
  const { redactSecrets } = require('../ansible/runner.cjs');
  return redactSecrets(maskSecrets(yerelMaske(String(metin ?? ''))));
}
/** Nesne / dizi icindeki her metne maskele (eski job-status'un result / fixResult alanlari). */
const maskeleDerin = (v) => (typeof v === 'string' ? maskele(v)
  : Array.isArray(v) ? v.map(maskeleDerin)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskeleDerin(x)])) : v);

// ── IS GECMISI ─────────────────────────────────────────────────────────────────────────────────
function aileOf(templateName) {
  const ad = String(templateName || '').toLowerCase();
  for (const [aile, onekler] of Object.entries(AILE_ONEKI)) if (onekler.some((o) => ad.startsWith(o))) return aile;
  return null;
}
function planOnlyOf(params) {
  const p = jsonNesne(params);
  return p && typeof p.plan_only === 'boolean' ? p.plan_only : null;
}
// Is BU hedefin mi: sunucu + uygulama + JBoss surumu (tek hedefte ust duzey alanlar, toplu iste
// rt_hedefler[]). Yalniz host'a bakmak ayni sunucudaki BASKA kaydin / uygulamanin satirini baglardi
// (denetim G1). Retirement launch'lari ucunu de yazar; eksikse satir kanit sayilmaz.
function hedefIcerir(params, t) {
  const p = jsonNesne(params);
  if (!p || !U(t.host) || !U(t.app_name)) return false;
  const uyar = (host, app, gen) => U(host) === U(t.host) && U(app) === U(t.app_name) && gen !== undefined && String(gen) === String(t.jboss_gen ?? null);
  if (U(p.target_host) && uyar(p.target_host, p.application, p.jboss_gen)) return true;
  return Array.isArray(p.rt_hedefler) && p.rt_hedefler.some((h) => h && uyar(h.host, h.application, h.jboss_gen));
}
function gecmisSatirlari(gecmis, jobId, t, aile) {
  return (Array.isArray(gecmis) ? gecmis : []).filter(
    (r) => sayi(r && r.job_id) === jobId && aileOf(r.template_name) === aile && hedefIcerir(r.params, t),
  );
}

/** Hedeflerin is numaralari icin TEK sorgu (500'luk parcalar). Hata FIRLATIR: cagiran karar verir. */
async function isGecmisiOku(db, hedefler) {
  const idler = [
    ...new Set(
      (hedefler || []).flatMap((t) =>
        [t.last_job_id, t.delete_job_id, t.rollback_job_id, jsonNesne(t.stop_izin_json)?.jobId, jsonNesne(t.delete_onkontrol_json)?.jobId, jsonNesne(t.rollback_onkontrol_json)?.jobId]
          .map(sayi)
          .filter(Boolean),
      ),
    ),
  ];
  if (!idler.length) return [];
  const out = [];
  for (let i = 0; i < idler.length; i += 500) {
    const parca = idler.slice(i, i + 500);
    const ph = parca.map((_, k) => `$${k + 1}`).join(', ');
    const r = await db.query(
      `SELECT job_id, awx_server_id, template_id, template_name, username, started_at, params
         FROM ansible_job_history WHERE template_name LIKE 'Retirement:%' AND job_id IN (${ph})`,
      parca,
    );
    out.push(...(r.rows || []));
  }
  return out;
}

// last_job_id ON KONTROL mu STOP mu? Once is gecmisinin plan_only'si (launch onu ham yazar). Gecmis
// satiri yoksa (yazimi best-effort) yalniz kod degismezleri kanit sayilir: izin listesi yalniz basarili
// on kontrol isine yazilir; 'planning' durumu is no ile AYNI yazimda gelir. Celiski -> null.
function sonIsTuru(t, gecmis) {
  const jobId = sayi(t.last_job_id);
  if (!jobId) return null;
  const turler = new Set(gecmisSatirlari(gecmis, jobId, t, 'stop').map((r) => planOnlyOf(r.params)));
  turler.delete(null);
  if (turler.size > 1) return null;
  if (turler.size === 1) return turler.has(true) ? 'onkontrol' : 'stop';
  if (sayi(jsonNesne(t.stop_izin_json)?.jobId) === jobId) return 'onkontrol';
  if (t.status === 'planning') return 'onkontrol';
  return null;
}

// Gecmisten sunucu: ayni is + aile + hedef + adim turu (plan_only). Birden cok sunucu = belirsiz.
function gecmisSunucusu(gecmis, jobId, t, adim) {
  const satirlar = gecmisSatirlari(gecmis, jobId, t, AILE[adim]).filter((r) => planOnlyOf(r.params) !== !PLAN_ADIMI[adim]);
  const idler = new Set(satirlar.map((r) => sunucuNo(r.awx_server_id)).filter((x) => x != null));
  if (idler.size > 1) return { id: null, belirsiz: true, satir: null };
  if (idler.size === 0) return { id: null, belirsiz: false, satir: satirlar[0] || null };
  const id = [...idler][0];
  return { id, belirsiz: false, satir: satirlar.find((r) => sunucuNo(r.awx_server_id) === id) || null, kanit: 'gecmis' };
}
// Web girdisinin sunucusu: kaldirma isinde poller is no ile BIRLIKTE yazar. Geri acma (restoring /
// restored) isinde yalniz webGeriAl'in isaretiyle (sunucuIsi = is no): isaretsiz eski girdide awxServerId
// ESKI kaldirma isinindir, ayni numara baska sunucuda okunurdu (denetim G3/G4) -> belirsiz.
const GERI_ACMA = new Set(['restoring', 'restored']);
function webSunucusu(w, jobId) {
  const sid = sunucuNo(w.awxServerId);
  if (sid == null) return { id: null, belirsiz: false, satir: null };
  const isaret = sayi(w.sunucuIsi);
  const guvenli = isaret != null ? isaret === jobId : !GERI_ACMA.has(String(w.status));
  return guvenli ? { id: sid, belirsiz: false, satir: null, kanit: 'kayit' } : { id: null, belirsiz: true, satir: null };
}
const kaynakOf = (satir) => (!satir || !satir.username ? null : satir.username === ZAMANLAYICI_KULLANICI ? 'zamanlayici' : 'elle');
const onKontrolDurumu = (d) => (d === 'running' || d === 'baslatiliyor' ? 'suruyor' : d === 'ok' ? 'basarili' : d === 'failed' ? 'basarisiz' : 'bilinmiyor');
// Web girdisinin is numarasi: running/ok/skip/failed kaldirma isi, restoring geri acma isi. restore_manual /
// restore_failed'te geri acma HIC baslamadi: jobId hala (basarili) kaldirma isidir.
const WEB_DURUMU = Object.freeze({
  running: 'suruyor', restoring: 'suruyor', ok: 'basarili', skip: 'basarili', restored: 'basarili',
  restore_manual: 'basarili', restore_failed: 'basarili', failed: 'basarisiz',
});
const SIRA = Object.fromEntries(ADIM_SIRASI.map((a, i) => [a, i]));

/** Ham hedef satiri + gecmis -> is kayitlari (ic alanlar `_sunucu`). Endpoint ve liste AYNI fonksiyonu kullanir. */
function hedefIsKayitlari(t, gecmis) {
  const isler = [];
  let eksik = false;
  const s = t.status;
  const ekle = (adim, jobId, durum, o = {}) =>
    isler.push({ adim, ...(o.web != null ? { web: o.web } : {}), jobId, durum, basladi: o.basladi ?? null, bitti: o.bitti ?? null, kaynak: o.kaynak ?? null, _sunucu: o.sunucu });
  const gecmisli = (adim, jobId) => gecmisSunucusu(gecmis, jobId, t, adim);

  // ON KONTROL + STOP (ikisi de last_job_id'ye yazilir; STOP on kontrolun numarasini ezer).
  const son = sayi(t.last_job_id);
  const tur = son ? sonIsTuru(t, gecmis) : null;
  if (son && !tur) eksik = true;
  const izin = jsonNesne(t.stop_izin_json);
  const izinIs = sayi(izin?.jobId);
  if (tur === 'onkontrol') {
    const g = gecmisli('onkontrol', son);
    const durum = s === 'planning' ? 'suruyor' : ['planned', 'stop_scheduled', 'stopping'].includes(s) || izinIs === son ? 'basarili' : s === 'failed' ? 'basarisiz' : 'bilinmiyor';
    ekle('onkontrol', son, durum, { basladi: iso(g.satir?.started_at), bitti: izinIs === son ? iso(izin?.at) : null, kaynak: kaynakOf(g.satir), sunucu: g });
  } else if (izinIs && izinIs !== son) {
    const g = gecmisli('onkontrol', izinIs);
    ekle('onkontrol', izinIs, 'basarili', { basladi: iso(g.satir?.started_at), bitti: iso(izin?.at), kaynak: kaynakOf(g.satir), sunucu: g });
  }
  if (tur === 'stop') {
    const g = gecmisli('stop', son);
    const durum = s === 'stopping' ? 'suruyor'
      : ['stopped', 'deleting', 'deleted', 'rolling_back', 'active', 'rollback_failed'].includes(s) ? 'basarili'
        : s === 'failed' && !sayi(t.delete_job_id) ? 'basarisiz' : 'bilinmiyor';
    ekle('stop', son, durum, { basladi: iso(g.satir?.started_at), bitti: durum === 'basarili' ? iso(t.stopped_at) : null, kaynak: kaynakOf(g.satir), sunucu: g });
  }

  // WEB: indeks web_result_json'daki OZGUN siradir (ekran webSonuc[i] ile eslestirir).
  const webler = jsonNesne(t.web_result_json);
  if (Array.isArray(webler))
    webler.forEach((w, i) => {
      const jobId = sayi(w && w.jobId);
      if (!jobId) return;
      ekle('web', jobId, WEB_DURUMU[String(w.status)] || 'bilinmiyor', {
        web: i, basladi: iso(w.basladi), bitti: iso(w.bitti), sunucu: webSunucusu(w, jobId),
      });
    });

  // SILME / GERI ALMA ON KONTROLU: kendi kayitlarinda is no + sunucu + durum + kaynak.
  for (const [adim, alan] of [['delete_onkontrol', 'delete_onkontrol_json'], ['rollback_onkontrol', 'rollback_onkontrol_json']]) {
    const o = jsonNesne(t[alan]);
    const jobId = sayi(o?.jobId);
    if (!jobId) continue;
    const kayitli = sunucuNo(o.awxServerId);
    const g = gecmisli(adim, jobId);
    const suruyor = o.durum === 'running' || o.durum === 'baslatiliyor';
    ekle(adim, jobId, onKontrolDurumu(o.durum), {
      basladi: suruyor ? iso(o.at) : iso(g.satir?.started_at),
      bitti: suruyor ? null : iso(o.at),
      kaynak: o.kaynak === 'elle' || o.kaynak === 'zamanlayici' ? o.kaynak : kaynakOf(g.satir),
      sunucu: kayitli != null ? { id: kayitli, belirsiz: false, satir: g.id === kayitli ? g.satir : null, kanit: 'kayit' } : g,
    });
  }

  const silme = sayi(t.delete_job_id);
  if (silme) {
    const g = gecmisli('delete', silme);
    const durum = s === 'deleting' ? 'suruyor' : s === 'deleted' ? 'basarili' : s === 'failed' ? 'basarisiz' : 'bilinmiyor';
    ekle('delete', silme, durum, { basladi: iso(g.satir?.started_at), bitti: durum === 'basarili' ? iso(t.deleted_at) : null, kaynak: kaynakOf(g.satir), sunucu: g });
  }
  const geri = sayi(t.rollback_job_id);
  if (geri) {
    const g = gecmisli('rollback', geri);
    const durum = s === 'rolling_back' ? 'suruyor' : s === 'active' ? 'basarili' : s === 'rollback_failed' ? 'basarisiz' : 'bilinmiyor';
    ekle('rollback', geri, durum, { basladi: iso(g.satir?.started_at), bitti: durum === 'basarili' ? iso(t.rolled_back_at) : null, kaynak: kaynakOf(g.satir), sunucu: g });
  }

  isler.sort((a, b) => SIRA[a.adim] - SIRA[b.adim] || (a.web ?? 0) - (b.web ?? 0));
  return { isler, eksik };
}

/** rowTarget'a eklenecek alanlar: awxIsleri (+ awxIsleriEksik). Sunucu numarasi istemciye VERILMEZ;
 *  yalniz biliniyorsa sunucunun kapali olup olmadigi (`sunucuVar(id)`: true/false, bilinmiyorsa null). */
function hedefIsleri(t, gecmis, { sunucuVar } = {}) {
  const { isler, eksik } = hedefIsKayitlari(t, gecmis);
  const awxIsleri = isler.map(({ _sunucu, ...x }) => {
    const id = _sunucu && !_sunucu.belirsiz ? _sunucu.id : null;
    const acik = id != null && typeof sunucuVar === 'function' ? sunucuVar(id) : null;
    return acik == null ? x : { ...x, sunucuKapali: !acik };
  });
  return eksik ? { awxIsleri, awxIsleriEksik: true } : { awxIsleri };
}

// AWX arayuzunde isin adresi: AAP 2.5 (API /api/controller/v2, gateway arayuzu) /execution/jobs/...,
// klasik AWX / AAP <= 2.4 /#/jobs/... . Sunucu yoksa null.
function awxIsAdresi(server, jobId) {
  if (!server || !server.url) return null;
  const kok = String(server.url).replace(/\/+$/, '');
  return /\/api\/controller\//.test(`${server.apiBase || ''}/`) ? `${kok}/execution/jobs/playbook/${jobId}/output` : `${kok}/#/jobs/playbook/${jobId}/output`;
}

// ── UC ─────────────────────────────────────────────────────────────────────────────────────────
const MESAJ = Object.freeze({
  hedef_yok: 'Hedef bu kayıtta yok (kayıttan çıkarılmış olabilir).',
  sunucu_belirsiz: 'İşin hangi AWX sunucusunda çalıştığı kanıtlanamadı; aynı numaralı başka bir işi göstermemek için çıktı okunmadı.',
});
// Reddedilen erisim denetime yazilir (yalniz baglama reddi; eksik is numarasi erisim reddi degil).
const DENETLENEN = new Set(['hedef_yok', 'sunucu_belirsiz', 'template_uyusmuyor']);

function mount(router, deps = {}) {
  const d = {
    db: deps.db || (() => require('../db/index.cjs')),
    runner: deps.runner || (() => require('../ansible/runner.cjs')),
    stdoutCache: deps.stdoutCache || (() => require('../ansible/job-stdout-cache.cjs')),
    beklenenPlaybook: deps.beklenenPlaybook || (() => require('../ansible/template-preflight.cjs').BEKLENEN_PLAYBOOK),
    audit: deps.audit || (() => {}),
  };
  // Beklenmeyen hata da 424 (gecici) doner: 500 gecitte HTML'e doner ve istemci kodu okuyamaz.
  router.get('/:id/targets/:tid/is-ciktisi', (req, res) =>
    isCiktisi(req, res, d).catch((e) => {
      if (!res.headersSent) res.status(424).json({ ok: false, code: 'olculemedi', kalici: false, message: `İş çıktısı okunamadı: ${maskele(e && e.message)}` });
    }));
}

async function isCiktisi(req, res, d) {
  const q = req.query || {};
  const id = sayi(req.params.id);
  const tid = sayi(req.params.tid);
  const adim = String(q.adim ?? '');
  let web = null;
  const ozet = { id, tid, adim };
  const red = (http, code, message) => {
    if (DENETLENEN.has(code)) {
      try {
        d.audit(req, { ...ozet, web, code });
      } catch {
        /* best-effort */
      }
    }
    return res.status(http).json({ ok: false, code, kalici: http !== 424, message });
  };
  if (!id || !tid || !ADIM_SIRASI.includes(adim)) return red(400, 'gecersiz', 'İstek geçersiz: kayıt, hedef ya da adım tanınmadı.');
  if (adim === 'web') {
    if (!/^\d{1,4}$/.test(String(q.web ?? ''))) return red(400, 'gecersiz', 'İstek geçersiz: web adımı için vhost sırası gerekli.');
    web = Number(q.web);
  } else if (q.web != null && q.web !== '') return red(400, 'gecersiz', 'İstek geçersiz: vhost sırası yalnız web adımında verilir.');

  const db = d.db();
  let t;
  let gecmis;
  try {
    const r = await db.query(`SELECT * FROM retirement_targets WHERE id = $1 AND record_id = $2`, [tid, id]);
    t = r.rows?.[0] || null;
    if (t) gecmis = await isGecmisiOku(db, [t]);
  } catch (e) {
    return red(424, 'olculemedi', `Portal veritabanı okunamadı: ${maskele(e.message)}`);
  }
  if (!t) return red(409, 'hedef_yok', MESAJ.hedef_yok);
  if (adim === 'web') {
    const liste = jsonNesne(t.web_result_json);
    if (!Array.isArray(liste) || web >= liste.length) return red(400, 'gecersiz', 'İstek geçersiz: bu sırada vhost yok.');
  }
  const is = hedefIsKayitlari(t, gecmis).isler.find((x) => x.adim === adim && (adim !== 'web' || x.web === web));
  if (!is) return red(409, 'is_yok', 'Bu adımın AWX iş numarası kayıtlı değil.');
  if (!is._sunucu || is._sunucu.belirsiz || is._sunucu.id == null) return red(409, 'sunucu_belirsiz', MESAJ.sunucu_belirsiz);
  const sid = is._sunucu.id;
  const jobId = is.jobId;
  const temel = { adim, ...(web != null ? { web } : {}), jobId, awxServerId: sid };

  const arsivden = async (code, sebep) => {
    // Arsiv yolunda playbook dogrulanamaz: bag kanitli olmali (isle birlikte yazilmis sunucu ya da
    // template'li gecmis satiri); degilse baska isin arsivi gosterilmez.
    if (is._sunucu.kanit !== 'kayit' && !sayi(is._sunucu.satir?.template_id)) return red(409, 'sunucu_belirsiz', MESAJ.sunucu_belirsiz);
    let satir;
    try {
      const r = await db.query(`SELECT TOP 1 stdout, fetched_at FROM ansible_job_output WHERE awx_server_id = $1 AND job_id = $2`, [sid, jobId]);
      satir = r.rows?.[0] || null;
    } catch (e) {
      return red(424, 'olculemedi', `Portal arşivi okunamadı: ${maskele(e.message)}`);
    }
    if (!satir) return red(409, code, `${sebep} Bu işin çıktısı Portal arşivinde de yok.`);
    const ham = String(satir.stdout ?? '');
    return res.json({
      ok: true, kaynak: 'arsiv', ...temel, sunucuAdi: null, status: null, bitti: true,
      output: maskele(ham), kirpildi: ham.includes(KIRPMA_IZI), started: null, finished: null, elapsed: null,
      awxUrl: null, arsivTarihi: iso(satir.fetched_at), uyari: `${sebep} Portal arşivi gösteriliyor.`, jobExplanation: null, resultTraceback: null,
    });
  };

  const runner = d.runner();
  let info;
  try {
    info = await runner.getJobStatusOnServer(sid, jobId);
  } catch (e) {
    if (e && e.code === 'awx_server_missing') return arsivden('awx_server_missing', maskele(e.message));
    if (e && Number(e.status) === 404) return arsivden('awx_job_missing', `AWX iş #${jobId} artık yok (temizlenmiş olabilir).`);
    return red(424, 'awx_okunamadi', `AWX işi okunamadı (#${jobId}): ${maskele(e && e.message)}`);
  }
  // BAGLAMA: isin playbook'u adimin playbook'u olmali; gecmiste template varsa o da tutmali.
  const beklenen = String(d.beklenenPlaybook()[ADIM_ANAHTARI[adim]] || '').toLowerCase();
  const gercek = String(info.playbook || '').split('/').pop().toLowerCase();
  if (!beklenen || !gercek) return red(424, 'olculemedi', `AWX iş #${jobId}: playbook bilgisi okunamadı; çıktı doğrulanmadan gösterilmez.`);
  const gTpl = sayi(is._sunucu.satir?.template_id);
  if (gercek !== beklenen || (gTpl && info.templateId != null && Number(info.templateId) !== gTpl))
    return red(409, 'template_uyusmuyor', `AWX’teki #${jobId} bu adımın playbook’u değil (${info.playbook || '?'}; beklenen ${beklenen}); çıktı gösterilmedi.`);

  // AWX isi bitirse de olay islemesi surerken stdout eksik olabilir: event_processing_finished false iken
  // is BITMEMIS sayilir (artimli okuma, arsiv yok); alan yoksa (eski AWX) durum yeterli.
  const bitti = TERMINAL.has(String(info.status)) && info.eventProcessingFinished !== false;
  // Biten iste son metin artimlardan TUREMEZ: onbellek birakilir, AWX'ten tam cekilir (arsive giden budur).
  if (bitti) d.stdoutCache().sil(sid, jobId);
  let ham;
  try {
    ({ output: ham } = await runner.getJobOutputOnServer(sid, jobId, { artimli: !bitti }));
  } catch (e) {
    return red(424, 'awx_okunamadi', `AWX iş #${jobId} çıktısı okunamadı: ${maskele(e && e.message)}`);
  }
  ham = String(ham ?? '');
  const output = maskele(ham);
  if (bitti && output) {
    try {
      const ex = await db.query(`SELECT 1 FROM ansible_job_output WHERE awx_server_id = $1 AND job_id = $2`, [sid, jobId]);
      if (!ex.rows?.length) await db.query(`INSERT INTO ansible_job_output (awx_server_id, job_id, stdout) VALUES ($1, $2, $3)`, [sid, jobId, output]);
    } catch (e) {
      console.warn(`[Retirement] is #${jobId} ciktisi arsivlenemedi:`, maskele(e.message));
    }
  }
  const server = runner.getServerById(sid);
  const elapsed = Number(info.elapsed);
  return res.json({
    ok: true, kaynak: 'awx', ...temel, sunucuAdi: server?.name || null,
    status: info.status ?? null, bitti, output, kirpildi: ham.includes(KIRPMA_IZI),
    started: info.started ?? null, finished: info.finished ?? null, elapsed: Number.isFinite(elapsed) && info.elapsed != null ? elapsed : null,
    awxUrl: awxIsAdresi(server, jobId),
    arsivTarihi: null, uyari: null,
    jobExplanation: info.jobExplanation ? maskele(info.jobExplanation) : null,
    resultTraceback: info.resultTraceback ? maskele(info.resultTraceback) : null,
  });
}

module.exports = { mount, hedefIsleri, isGecmisiOku, maskele, maskeleDerin, ADIM_SIRASI, KIRPMA_IZI, _hedefIsKayitlari: hedefIsKayitlari, _sonIsTuru: sonIsTuru, _awxIsAdresi: awxIsAdresi };
