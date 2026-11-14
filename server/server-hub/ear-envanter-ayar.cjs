// server/server-hub/ear-envanter-ayar.cjs - Uygulama Envanteri ayarlari (2026-11-04).
//
// Kullanici: "her seferinde taranmasin butun sunuculari haftalik olarak tarasin otomatik istenirse
// elle de calistirilabilsin". Haftalik zamanlayici, parti boyutlari, okuma kimligi, kokler ve saklama
// suresi kaynak koda dokunmadan Admin ekranindan degisir.
//
// DEPO: Portal DB ear_envanter_ayarlar (anahtar -> deger). server-hub/ayarlar.cjs deseni: yalniz
// VARSAYILANDAN FARKLI satir tutulur (kodun varsayilani degisirse eski satir onu sessizce ezmesin);
// okunamazsa varsayilanlar uygulanir ve bu GIZLENMEZ (okunamadi=true, ekran soyler).
//
// ZAMANLAYICI VARSAYILANI KAPALI: AWX template'i girildigi an 1000+ sunucuda TAM tarama baslamasin.
// Akis: template -> 1-5 sunucuyla elle pilot -> Admin planlari acar.
//
// IKI PLAN (2026-11-05, kullanici: "haftada ayda x ayda bir olsun ... 2 ayda bir tam, 4 haftada bir
// ozet"): p1_* ve p2_* anahtarlari. Her plan: acik, birim (HAFTA | AY), aralik (her N birimde bir),
// gun (haftanin gunu), sira (AY icin ayin ILK..DORDUNCU | SON gunu), saat, kip, kapsam (FILO | SORUNLU |
// ORTAM:A,B), baslangic (TR tarihi; ilk calisma bu gun ya da sonrasi, N'lik aralik buradan sayilir).
// Varsayilan: P1 OZET her 4 haftada Pazar 02:00, P2 TAM her 2 ayda ayin ilk Pazari 03:00; ikisi KAPALI.
// TAM ONCELIGI: OZET ornegi, kapsami onu kapsayan acik bir TAM planinin ornegine TELAFI_MS kadar
// yakinsa calismaz ("TAM ile birlesti"): ayni gece iki filo taramasi olmaz.
// ESKI AYAR: tek haftalik plan (zamanlayici/gun/saat/kip). zamanlayici=ACIK ise BIR KEZ P1'e tasinir
// (HAFTA, 1, ayni gun / saat / kip); kapaliysa eski satirlar silinir. Tasima gunu eski H- anahtari da
// sayilir (cift kosu yok).
//
// SAAT: Turkiye 2016'dan beri sabit UTC+3 (yaz saati yok); hesap UTC uzerinden +3 ile yapilir,
// sunucunun TZ ayarina bagli degildir.
'use strict';

const TR_OFSET_MS = 3 * 60 * 60 * 1000;
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
// "ayin ilk Pazari": iyelik ekli gun adlari.
const GUNLER_IYELIK = ['Pazarı', 'Pazartesisi', 'Salısı', 'Çarşambası', 'Perşembesi', 'Cuması', 'Cumartesisi'];
// Kacirilan zamanlama (Portal kapaliydi) en gec bu kadar sonra yine baslar; sonrasi bir sonraki hafta.
const TELAFI_MS = 24 * 60 * 60 * 1000;

const tamSayi = (min, max) => (v) => {
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n >= min && n <= max ? String(n) : null;
};
const secenek = (liste) => (v) => (liste.includes(String(v).trim()) ? String(v).trim() : null);

const SIRALAR = Object.freeze(['ILK', 'IKINCI', 'UCUNCU', 'DORDUNCU', 'SON']);
const SIRA_METNI = { ILK: 'ilk', IKINCI: 'ikinci', UCUNCU: 'üçüncü', DORDUNCU: 'dördüncü', SON: 'son' };
const PLANLAR = Object.freeze(['p1', 'p2']);
const ESKI_ANAHTARLAR = Object.freeze(['zamanlayici', 'gun', 'saat', 'kip']);
const ORTAM_RE = /^[A-Z0-9][A-Z0-9 ._-]{0,63}$/;

/** Kapsam: FILO | SORUNLU | ORTAM:A,B (1-20 ortam; normalize: trim, BUYUK, tekil, sirali). */
function kapsamDogrula(v) {
  const s = String(v == null ? '' : v).trim();
  // WEB (2026-11-07, Faz W): Server Hub'in son taramasinda web urunu (IHS / RHA) olan sunucular; 3-tier web
  // sunuculari JBoss envanterinde yoktur. FILO_WEB: ikisinin birlesimi.
  if (s === 'FILO' || s === 'SORUNLU' || s === 'WEB' || s === 'FILO_WEB') return s;
  const m = /^ORTAM:(.+)$/.exec(s);
  if (!m) return null;
  const l = [...new Set(m[1].split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))].sort();
  if (!l.length || l.length > 20 || l.some((x) => !ORTAM_RE.test(x))) return null;
  return `ORTAM:${l.join(',')}`;
}

/** Ust kapsam alttakini kapsar mi (TAM onceligi icin). */
function kapsamKapsar(ust, alt) {
  if (ust === alt || ust === 'FILO_WEB') return true;
  // FILO web sunucularini (envanter disi 3-tier) KAPSAMAZ; WEB yalniz kendini.
  if (alt === 'WEB' || alt === 'FILO_WEB' || ust === 'WEB') return false;
  if (ust === 'FILO') return true;
  if (ust.startsWith('ORTAM:') && alt.startsWith('ORTAM:')) {
    const u = new Set(ust.slice(6).split(','));
    return alt
      .slice(6)
      .split(',')
      .every((x) => u.has(x));
  }
  return false;
}

function tarihDogrula(v) {
  const s = String(v == null ? '' : v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, a, g] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(y, a - 1, g));
  if (y < 2020 || y > 2100 || d.getUTCMonth() !== a - 1 || d.getUTCDate() !== g) return null;
  return s;
}

const saatDogrula = (v) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v).trim()) ? String(v).trim() : null;

/** Kok listesi: mutlak yollar, ':' ayracli, en cok 4, '..' yok (playbook regex'inin ust kumesi degil, alt kumesi). */
/** Web kurulum kok adaylari: ':' ayrili mutlak yollar, en cok 10. */
function webKokDogrula(v) {
  const s = String(v).trim();
  const parcalar = s.split(':');
  if (!s || parcalar.length > 10) return null;
  for (const p of parcalar)
    if (!/^\/[A-Za-z0-9._/-]{1,120}$/.test(p) || p.split('/').includes('..')) return null;
  return s;
}

function kokDogrula(v) {
  const s = String(v).trim();
  const parcalar = s.split(':');
  if (!s || parcalar.length > 4) return null;
  for (const p of parcalar)
    if (!/^\/[A-Za-z0-9._/-]{1,120}$/.test(p) || p.split('/').includes('..')) return null;
  return s;
}

const PLAN_VARSAYILAN = Object.freeze({
  p1: { acik: 'KAPALI', birim: 'HAFTA', aralik: '4', gun: '0', sira: 'ILK', saat: '02:00', kip: 'OZET', kapsam: 'FILO', baslangic: '2026-01-01' },
  p2: { acik: 'KAPALI', birim: 'AY', aralik: '2', gun: '0', sira: 'ILK', saat: '03:00', kip: 'TAM', kapsam: 'FILO', baslangic: '2026-01-01' },
});

function planAyarlari(p) {
  const v = PLAN_VARSAYILAN[p];
  const n = p.slice(1);
  return {
    [`${p}_acik`]: { ad: `Plan ${n}: açık`, varsayilan: v.acik, dogrula: secenek(['ACIK', 'KAPALI']) },
    [`${p}_birim`]: { ad: `Plan ${n}: birim`, varsayilan: v.birim, dogrula: secenek(['HAFTA', 'AY']) },
    [`${p}_aralik`]: { ad: `Plan ${n}: her N birimde bir`, varsayilan: v.aralik, dogrula: tamSayi(1, 12) },
    [`${p}_gun`]: { ad: `Plan ${n}: gün`, varsayilan: v.gun, dogrula: tamSayi(0, 6) },
    [`${p}_sira`]: { ad: `Plan ${n}: ayın kaçıncı günü`, varsayilan: v.sira, dogrula: secenek(SIRALAR) },
    [`${p}_saat`]: { ad: `Plan ${n}: saat (TR)`, varsayilan: v.saat, dogrula: saatDogrula },
    [`${p}_kip`]: { ad: `Plan ${n}: kip`, varsayilan: v.kip, dogrula: secenek(['OZET', 'TAM']) },
    [`${p}_kapsam`]: { ad: `Plan ${n}: kapsam`, varsayilan: v.kapsam, dogrula: kapsamDogrula },
    [`${p}_baslangic`]: { ad: `Plan ${n}: başlangıç`, varsayilan: v.baslangic, dogrula: tarihDogrula },
  };
}

const AYARLAR = Object.freeze({
  ...planAyarlari('p1'),
  ...planAyarlari('p2'),
  // Ust sinir 100: playbook'un ear_parti_siniri varsayilani. Daha buyuk parti AWX olay tablosunu ve
  // bellegi sisirir; filo partilere bolunur ve partiler SIRAYLA kosar.
  parti_ozet: { ad: 'ÖZET parti boyutu', varsayilan: '100', dogrula: tamSayi(1, 100) },
  parti_tam: { ad: 'TAM parti boyutu', varsayilan: '50', dogrula: tamSayi(1, 100) },
  okuma_kullanicisi: {
    ad: 'Okuma kimliği (dzdo)',
    varsayilan: 'was',
    dogrula: (v) =>
      /^([a-z_][a-z0-9_-]{0,31})?$/.test(String(v).trim()) ? String(v).trim() : null,
  },
  kokler: { ad: 'Taranan kökler', varsayilan: '/vhosting:/vhosting8', dogrula: kokDogrula },
  // FAZ 2 (2026-11-06): calisan her JVM icin JBoss CLI read-children-resources(deployment). Varsayilan
  // KAPALI: her JVM bir CLI (Java) sureci baslatir; once tek sunucuda pilot, sonra Admin acar.
  deployment_kontrolu: {
    ad: 'Deployment kontrolü (Faz 2, JBoss CLI)',
    varsayilan: 'KAPALI',
    dogrula: secenek(['ACIK', 'KAPALI']),
  },
  // FAZ W (2026-11-07): web katmani - Apache / IHS config agaci, soketler, IP'ler, access / error log ozeti.
  // Varsayilan KAPALI: loglar okunur (host basina butceli); once tek sunucuda pilot, sonra Admin acar.
  web_kontrolu: {
    ad: 'Web kontrolü (Faz W: Apache / IHS config, soket, IP, log özeti)',
    varsayilan: 'KAPALI',
    dogrula: secenek(['ACIK', 'KAPALI']),
  },
  web_okuma_kullanicisi: {
    ad: 'Web okuma kimliği (dzdo; boş = okuma kimliği)',
    varsayilan: '',
    dogrula: (v) =>
      /^([a-z_][a-z0-9_-]{0,31})?$/.test(String(v).trim()) ? String(v).trim() : null,
  },
  web_hc: {
    ad: 'Sağlık kontrolü dosyaları (gerçek istek sayılmaz)',
    varsayilan: 'hc.html,hc.jsp',
    dogrula: (v) =>
      /^[A-Za-z0-9._-]{1,64}(,[A-Za-z0-9._-]{1,64}){0,19}$/.test(String(v).trim()) ? String(v).trim() : null,
  },
  web_kokler: {
    ad: 'Web kurulum kök adayları (çalışanlar süreçten bulunur)',
    varsayilan: '/usr/IBMIHS:/opt/IBM/HTTPServer:/usr/IBM/HTTPServer:/etc/httpd:/opt/rh/httpd24/root/etc/httpd:/opt/jbcs-httpd24-2.4/httpd',
    dogrula: webKokDogrula,
  },
  // FAZ A (2026-11-07): yapilandirilmis JVM / WAS portlarina ESTABLISHED baglanti goruntusu (/proc/net/tcp,
  // 3 ornek, 10 sn arayla; host basina ~20 sn). Varsayilan KAPALI: once pilot.
  baglanti_kontrolu: {
    ad: 'Bağlantı görüntüsü (Faz A: JVM / WAS portlarına gelen bağlantılar)',
    varsayilan: 'KAPALI',
    dogrula: secenek(['ACIK', 'KAPALI']),
  },
  was_kokler: {
    ad: 'WebSphere kökleri (serverindex.xml)',
    varsayilan: '/opt/IBM/WebSphere/AppServer:/usr/IBM/WebSphere/AppServer',
    dogrula: webKokDogrula,
  },
  // DB: son N FILO kosusu (ve onlardan yeni secili kosular). /sw: son N TAM kosusunun ham dosyalari
  // (agac goruntuleyici ve ZIP bunlari okur).
  saklama_kosu: { ad: "DB'de tutulan filo koşusu", varsayilan: '12', dogrula: tamSayi(2, 52) },
  saklama_ham: { ad: "/sw'de tutulan TAM koşusu", varsayilan: '3', dogrula: tamSayi(1, 10) },
});

const TTL_MS = 30 * 1000;
let _cache = { at: 0, value: null };
const onbellekSil = () => {
  _cache = { at: 0, value: null };
};
const db = () => require('../db/index.cjs');

function hata(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function varsayilanlar() {
  return Object.fromEntries(Object.entries(AYARLAR).map(([k, v]) => [k, v.varsayilan]));
}

/** DB satirlari -> ayar nesnesi. Gecersiz / bilinmeyen satir yok sayilir (varsayilan gecerli kalir). */
function satirlardan(rows) {
  const deger = varsayilanlar();
  const kayitlar = {};
  for (const r of rows || []) {
    const a = AYARLAR[String(r.anahtar || '').trim()];
    if (!a) continue;
    const d = a.dogrula(r.deger == null ? '' : r.deger);
    if (d == null) continue;
    deger[r.anahtar] = d;
    kayitlar[r.anahtar] = {
      updatedBy: r.updated_by || null,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    };
  }
  return { deger, kayitlar, okunamadi: false, hata: '' };
}

/**
 * Eski tek haftalik plan -> P1 (bir kez). Yalniz zamanlayici=ACIK ise davranis aynen tasinir; kapali
 * eski plan hic calismamistir, satirlari silinir ve yeni varsayilanlar gecerli olur.
 */
async function eskiyiTasi(rows) {
  const eski = Object.fromEntries(
    (rows || [])
      .filter((r) => ESKI_ANAHTARLAR.includes(String(r.anahtar || '').trim()))
      .map((r) => [String(r.anahtar).trim(), String(r.deger == null ? '' : r.deger).trim()]),
  );
  if (!Object.keys(eski).length) return false;
  const yeni = {};
  if (eski.zamanlayici === 'ACIK') {
    Object.assign(yeni, {
      p1_acik: 'ACIK',
      p1_birim: 'HAFTA',
      p1_aralik: '1',
      p1_gun: tamSayi(0, 6)(eski.gun || '0') || '0',
      p1_saat: saatDogrula(eski.saat || '02:00') || '02:00',
      p1_kip: secenek(['OZET', 'TAM'])(eski.kip || 'TAM') || 'TAM',
    });
  }
  const yaz = Object.entries(yeni).filter(([k, v]) => v !== AYARLAR[k].varsayilan);
  const sil = [...ESKI_ANAHTARLAR, ...Object.keys(yeni).filter((k) => yeni[k] === AYARLAR[k].varsayilan)];
  await db().query(
    `SET XACT_ABORT ON;
     BEGIN TRAN;
     DELETE FROM ear_envanter_ayarlar WHERE anahtar IN (SELECT value FROM OPENJSON($1));
     INSERT INTO ear_envanter_ayarlar (anahtar, deger, updated_by)
       SELECT j.anahtar, j.deger, 'eski-haftalik-plan' FROM OPENJSON($2) WITH (anahtar NVARCHAR(64), deger NVARCHAR(400)) j;
     COMMIT;`,
    [JSON.stringify(sil), JSON.stringify(yaz.map(([anahtar, deger]) => ({ anahtar, deger })))],
  );
  console.log(
    `[EarEnvanter] eski haftalik plan ${eski.zamanlayici === 'ACIK' ? 'Plan 1e tasindi' : 'kapaliydi, silindi'}`,
  );
  return true;
}

async function oku(fresh = false) {
  if (!fresh && _cache.value && Date.now() - _cache.at < TTL_MS) return _cache.value;
  try {
    let { rows } = await db().query(
      `SELECT anahtar, deger, updated_by, updated_at FROM ear_envanter_ayarlar`,
    );
    if (await eskiyiTasi(rows))
      ({ rows } = await db().query(
        `SELECT anahtar, deger, updated_by, updated_at FROM ear_envanter_ayarlar`,
      ));
    const value = satirlardan(rows);
    _cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    return {
      deger: varsayilanlar(),
      kayitlar: {},
      okunamadi: true,
      hata: err.message || 'okunamadı',
    };
  }
}

/** Tek ayar yazar; varsayilana donen deger satiri siler. Donus: { anahtar, eski, yeni }. */
async function yaz(anahtar, deger, kim) {
  const a = AYARLAR[String(anahtar || '').trim()];
  if (!a)
    throw hata(
      400,
      `Bilinmeyen ayar: ${String(anahtar || '(boş)').slice(0, 40)}`,
      'bilinmeyen_ayar',
    );
  const d = a.dogrula(deger == null ? '' : deger);
  if (d == null)
    throw hata(
      400,
      `${a.ad} için geçersiz değer: ${String(deger ?? '').slice(0, 60) || '(boş)'}`,
      'gecersiz_ayar',
    );
  const simdiki = await oku(true);
  if (simdiki.okunamadi)
    throw hata(424, `Uygulama Envanteri ayarları okunamadı: ${simdiki.hata}`, 'ayar_okunamadi');
  const eski = simdiki.deger[anahtar];
  if (d === a.varsayilan) {
    await db().query(`DELETE FROM ear_envanter_ayarlar WHERE anahtar = $1`, [anahtar]);
  } else {
    await db().query(
      `SET XACT_ABORT ON;
       BEGIN TRAN;
       UPDATE ear_envanter_ayarlar WITH (UPDLOCK, HOLDLOCK)
          SET deger = $2, updated_by = $3, updated_at = SYSUTCDATETIME()
        WHERE anahtar = $1;
       IF @@ROWCOUNT = 0
         INSERT INTO ear_envanter_ayarlar (anahtar, deger, updated_by) VALUES ($1, $2, $3);
       COMMIT;`,
      [anahtar, d, String(kim || 'unknown').slice(0, 128)],
    );
  }
  onbellekSil();
  return { anahtar, eski, yeni: d };
}

/**
 * Bir planin birden cok alani TEK transaction'da (once hepsi dogrulanir; biri gecersizse hicbiri
 * yazilmaz). alanlar: { acik, birim, aralik, gun, sira, saat, kip, kapsam, baslangic } (eksik alan
 * degismez). Donus: { plan, degisen: [{ anahtar, eski, yeni }] }.
 */
async function planYaz(plan, alanlar, kim) {
  const p = String(plan || '').toLowerCase();
  if (!PLANLAR.includes(p)) throw hata(400, `Bilinmeyen plan: ${String(plan).slice(0, 10)}`, 'bilinmeyen_plan');
  const girdi = alanlar && typeof alanlar === 'object' ? alanlar : {};
  const yeni = {};
  for (const [alan, deger] of Object.entries(girdi)) {
    const anahtar = `${p}_${alan}`;
    const a = AYARLAR[anahtar];
    if (!a) throw hata(400, `Bilinmeyen plan alanı: ${String(alan).slice(0, 30)}`, 'bilinmeyen_ayar');
    const d = a.dogrula(deger == null ? '' : deger);
    if (d == null)
      throw hata(400, `${a.ad} için geçersiz değer: ${String(deger ?? '').slice(0, 60) || '(boş)'}`, 'gecersiz_ayar');
    yeni[anahtar] = d;
  }
  if (!Object.keys(yeni).length) throw hata(400, 'Değişecek alan yok.', 'bos_istek');
  const simdiki = await oku(true);
  if (simdiki.okunamadi)
    throw hata(424, `Uygulama Envanteri ayarları okunamadı: ${simdiki.hata}`, 'ayar_okunamadi');
  const degisen = Object.entries(yeni)
    .filter(([k, v]) => simdiki.deger[k] !== v)
    .map(([anahtar, v]) => ({ anahtar, eski: simdiki.deger[anahtar], yeni: v }));
  if (!degisen.length) return { plan: p, degisen };
  const sil = degisen.filter((x) => x.yeni === AYARLAR[x.anahtar].varsayilan).map((x) => x.anahtar);
  const yaz = degisen
    .filter((x) => x.yeni !== AYARLAR[x.anahtar].varsayilan)
    .map((x) => ({ anahtar: x.anahtar, deger: x.yeni }));
  await db().query(
    `SET XACT_ABORT ON;
     BEGIN TRAN;
     DELETE FROM ear_envanter_ayarlar WHERE anahtar IN (SELECT value FROM OPENJSON($1));
     UPDATE x SET deger = j.deger, updated_by = $3, updated_at = SYSUTCDATETIME()
       FROM ear_envanter_ayarlar x WITH (UPDLOCK, HOLDLOCK)
       JOIN OPENJSON($2) WITH (anahtar NVARCHAR(64), deger NVARCHAR(400)) j ON j.anahtar = x.anahtar;
     INSERT INTO ear_envanter_ayarlar (anahtar, deger, updated_by)
       SELECT j.anahtar, j.deger, $3 FROM OPENJSON($2) WITH (anahtar NVARCHAR(64), deger NVARCHAR(400)) j
        WHERE NOT EXISTS (SELECT 1 FROM ear_envanter_ayarlar x WITH (UPDLOCK, HOLDLOCK) WHERE x.anahtar = j.anahtar);
     COMMIT;`,
    [JSON.stringify(sil), JSON.stringify(yaz), String(kim || 'unknown').slice(0, 128)],
  );
  onbellekSil();
  return { plan: p, degisen };
}

// ── ZAMANLAMA ───────────────────────────────────────────────────────────────────────────────────

/** TR yerel (Y, ay 0-11, gun, SS, DD) -> UTC Date. Ay / gun tasmasi Date.UTC ile cozulur. */
const trAn = (y, a, g, ss, dd) => new Date(Date.UTC(y, a, g, ss, dd) - TR_OFSET_MS);
/** UTC Date -> TR tarihi "YYYY-AA-GG". */
const trGun = (d) => new Date(d.getTime() + TR_OFSET_MS).toISOString().slice(0, 10);

/** Ayar degerleri -> plan nesnesi. */
function planOf(deger, p) {
  const al = (k) => (deger && deger[`${p}_${k}`] != null ? deger[`${p}_${k}`] : PLAN_VARSAYILAN[p][k]);
  const [ss, dd] = String(al('saat')).split(':').map(Number);
  const [by, ba, bg] = String(al('baslangic')).split('-').map(Number);
  return {
    p,
    ad: p.toUpperCase(),
    acik: al('acik') === 'ACIK',
    birim: al('birim') === 'AY' ? 'AY' : 'HAFTA',
    aralik: Math.max(1, Math.min(12, Number(al('aralik')) || 1)),
    gun: Number(al('gun')) || 0,
    sira: SIRALAR.includes(al('sira')) ? al('sira') : 'ILK',
    saat: al('saat'),
    ss,
    dd,
    kip: al('kip') === 'TAM' ? 'TAM' : 'OZET',
    kapsam: al('kapsam'),
    baslangic: al('baslangic'),
    by,
    ba: ba - 1,
    bg,
  };
}

/** Ayin (y, a) icindeki ILK..DORDUNCU ya da SON `gun` (0 Pazar). */
function ayinGunu(y, a, gun, sira) {
  if (sira === 'SON') {
    const son = new Date(Date.UTC(y, a + 1, 0));
    return son.getUTCDate() - ((son.getUTCDay() - gun + 7) % 7);
  }
  const ilk = new Date(Date.UTC(y, a, 1)).getUTCDay();
  return 1 + ((gun - ilk + 7) % 7) + 7 * SIRALAR.indexOf(sira);
}

/** k. ornek (k >= 0; baslangic suzgeci uygulanmadan). */
function ornek(plan, k) {
  if (plan.birim === 'HAFTA') {
    const fark = (plan.gun - new Date(Date.UTC(plan.by, plan.ba, plan.bg)).getUTCDay() + 7) % 7;
    return trAn(plan.by, plan.ba, plan.bg + fark + 7 * plan.aralik * k, plan.ss, plan.dd);
  }
  const ay = plan.ba + plan.aralik * k;
  const y = plan.by + Math.floor(ay / 12);
  const a = ((ay % 12) + 12) % 12;
  return trAn(y, a, ayinGunu(y, a, plan.gun, plan.sira), plan.ss, plan.dd);
}

/** Baslangic gununden once kalan ornek sayilmaz (AY biriminde ilk ay baslangictan once olabilir). */
const ilkK = (plan) => (ornek(plan, 0) >= trAn(plan.by, plan.ba, plan.bg, 0, 0) ? 0 : 1);

/** `simdi`den once gelen (ya da ona esit) son ornegin k'si; yoksa null. */
function sonK(plan, simdi) {
  const t = simdi.getTime();
  const k0 = ilkK(plan);
  if (ornek(plan, k0).getTime() > t) return null;
  let k;
  if (plan.birim === 'HAFTA') k = Math.floor((t - ornek(plan, 0).getTime()) / (7 * 86400000 * plan.aralik));
  else {
    const yerel = new Date(t + TR_OFSET_MS);
    const ay = (yerel.getUTCFullYear() - plan.by) * 12 + (yerel.getUTCMonth() - plan.ba);
    k = Math.floor(ay / plan.aralik);
  }
  k = Math.max(k0, k);
  while (k > k0 && ornek(plan, k).getTime() > t) k -= 1;
  while (ornek(plan, k + 1).getTime() <= t) k += 1;
  return k;
}

/** Ayardaki planin `simdi`den once gelen en son ornegi (UTC Date) ya da null. */
function sonZamanlama(plan, simdi = new Date()) {
  const k = sonK(plan, simdi);
  return k == null ? null : ornek(plan, k);
}

/** Sonraki n ornek (UTC Date); plan kapaliysa []. */
function sonrakiZamanlamalar(plan, simdi = new Date(), n = 3) {
  if (!plan.acik) return [];
  const k = sonK(plan, simdi);
  const out = [];
  for (let i = k == null ? ilkK(plan) : k + 1; out.length < n; i += 1) {
    const z = ornek(plan, i);
    if (z.getTime() > simdi.getTime()) out.push(z);
  }
  return out;
}

/** Plan `zaman`a +-pencere yakin bir ornek tasiyor mu. */
function yakinOrnekVar(plan, zaman, pencere) {
  const s = sonZamanlama(plan, new Date(zaman.getTime() + pencere));
  return !!s && s.getTime() >= zaman.getTime() - pencere;
}

/**
 * Su an baslatilmasi gereken plan ornekleri. Donus: [{ plan, zaman, anahtar, esAnahtarlar, birlesti }]
 * (TAM once). Zaman gelmis ve en gec TELAFI_MS gecmis olmali. Anahtar "P1-YYYY-AA-GG" (TR tarihi);
 * ayni anahtarla ikinci kosu acilmaz (DB kosulu). birlesti: bu OZET ornegini kapsayan TAM planin adi.
 */
function bekleyenZamanlama(deger, simdi = new Date()) {
  const planlar = PLANLAR.map((p) => planOf(deger, p));
  const out = [];
  for (const plan of planlar) {
    if (!plan.acik) continue;
    const zaman = sonZamanlama(plan, simdi);
    if (!zaman || simdi.getTime() - zaman.getTime() > TELAFI_MS) continue;
    const gun = trGun(zaman);
    const tam = planlar.find(
      (t) =>
        t.p !== plan.p &&
        t.acik &&
        t.kip === 'TAM' &&
        plan.kip !== 'TAM' &&
        kapsamKapsar(t.kapsam, plan.kapsam) &&
        yakinOrnekVar(t, zaman, TELAFI_MS),
    );
    out.push({
      plan,
      zaman,
      anahtar: `${plan.ad}-${gun}`,
      // Eski haftalik plan P1'e tasindi: ayni gunun eski anahtari da sayilir.
      esAnahtarlar: plan.p === 'p1' ? [`H-${gun}`] : [],
      birlesti: tam ? tam.ad : null,
    });
  }
  return out.sort((a, b) => { if (a.plan.kip === b.plan.kip) return 0; if (a.plan.kip === 'TAM') return -1; return 1; });
}

function kapsamMetni(k) {
  if (k === 'FILO') return 'tüm filo';
  if (k === 'SORUNLU') return 'yalnız sorunlu sunucular';
  return `ortam: ${String(k).slice(6).split(',').join(', ')}`;
}

function zamanlamaMetni(plan) {
  const sik =
    (() => { if (plan.birim === 'HAFTA') { if (plan.aralik === 1) return 'Her hafta'; return `Her ${plan.aralik} haftada bir`; } if (plan.aralik === 1) return 'Her ay'; return `Her ${plan.aralik} ayda bir`; })();
  const ne =
    plan.birim === 'HAFTA'
      ? GUNLER[plan.gun] || '?'
      : `ayın ${SIRA_METNI[plan.sira]} ${GUNLER_IYELIK[plan.gun] || '?'}`;
  return `${sik} · ${ne} ${plan.saat} (TR) · ${plan.kip === 'TAM' ? 'TAM' : 'ÖZET'} · ${kapsamMetni(plan.kapsam)}`;
}

/** Ozet ekrani icin planlar: metin + sonraki 3 calisma (ekran ve zamanlayici ayni hesabi gorur). */
function planOzeti(deger, simdi = new Date()) {
  return PLANLAR.map((p) => {
    const plan = planOf(deger, p);
    return {
      ad: plan.ad,
      acik: plan.acik,
      kip: plan.kip,
      kapsam: plan.kapsam,
      metin: zamanlamaMetni(plan),
      sonraki: sonrakiZamanlamalar(plan, simdi, 3).map((d) => d.toISOString()),
    };
  });
}

module.exports = {
  AYARLAR,
  GUNLER,
  SIRALAR,
  PLANLAR,
  PLAN_VARSAYILAN,
  TELAFI_MS,
  oku,
  yaz,
  planYaz,
  onbellekSil,
  satirlardan,
  varsayilanlar,
  kokDogrula,
  kapsamDogrula,
  kapsamKapsar,
  tarihDogrula,
  planOf,
  ayinGunu,
  ornek,
  sonZamanlama,
  sonrakiZamanlamalar,
  bekleyenZamanlama,
  zamanlamaMetni,
  kapsamMetni,
  planOzeti,
  trGun,
};
