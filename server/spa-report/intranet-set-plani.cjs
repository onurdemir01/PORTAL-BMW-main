// server/spa-report/intranet-set-plani.cjs - Intranet SPA gecis takvimi: SET PLANI (2026-11-27).
//
// Kullanici: "Set plani Admin duzenler": set basina gecis tarihi, DC, eski IP, yeni IP Portal DB'de
// (intranet_spa_set_plani). Uygulama sayisi, setin payi ve yuzdeler SABIT DEGIL: ekran DC basina
// takvim satirlarindan hesaplar (src/components/intranetSpa.ts setIlerlemesi).
//
// YAZIM (yalniz Admin, her degisiklik auditPortal'a):
//   PUT  /intranet/takvim/set           tek set: tarih / DC / IP. Tarih degisince (ya da `topla`)
//                                       setin uygulama satirlari da o tarihe gecer: setin her
//                                       satirinin surumu (`beklenen`) tutmali. Set toplu tarihin
//                                       TEK yolu budur (takvimin /tarih ucu yalniz tek satir).
//                                       Yanit `uyarilar`: bu setin DC'sinde ayni uygulama baska
//                                       bir sette de varsa (yazimi engellemez).
//   POST /intranet/takvim/plan/onizle   CSV (set;gecis_tarihi;dc;eski_ip;yeni_ip) onizleme: fark,
//                                       tarihi degisecek setlerin uygulama sayisi (elle duzeltme
//                                       kaybi dahil), satir hatalari, ayni DC uyarisi.
//   POST /intranet/takvim/plan/yukle    plan MEVCUT PLANIN YERINE GECER; takvim satirlarini SILMEZ,
//                                       yalniz tarihi degisen setlerin satirlarini yeni tarihe tasir.
// Takvim yuklemesi plani silmez (intranet-takvim.cjs).
// ESZAMANLILIK: plan satiri `surum` (yeni satir tablonun en buyuk surumu + 1: silinip yeniden
// olusturulan set eski ekranin surumunu tutturmaz). Plan yuklemesi `kilit` gonderir (plan + takvim
// surum ozeti): onizlemeden sonraki bir plan ya da takvim yazimi yuklemeyi 409 yapar.
'use strict';

const takvim = require('./intranet-takvim.cjs');

const T = (s) => String(s == null ? '' : s).trim();

const PLAN_SINIR = { satir: 100, dc: 64 };
const PLAN_ZORUNLU = ['set', 'gecis_tarihi'];
const PLAN_SECMELI = ['dc', 'eski_ip', 'yeni_ip'];
/** Bir plan satirinin degisebilen alanlari (fark, audit ozeti). */
const PLAN_ALANLARI = ['gecisTarihi', 'dc', 'eskiIp', 'yeniIp'];

const OKTET = String.raw`(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const IPV4_RE = new RegExp(String.raw`^${OKTET}(\.${OKTET}){3}$`);
/** Bos ya da IPv4 (onde sifirsiz dort oktet). */
const ipGecerli = (s) => !s || IPV4_RE.test(s);

/** Plan alanlarinin ortak denetimi (CSV satiri ve tek set duzeltmesi). */
function planSorunlari({ dc, eskiIp, yeniIp }) {
  const sorun = [];
  if (dc.length > PLAN_SINIR.dc) sorun.push(`dc çok uzun (${dc.length} > ${PLAN_SINIR.dc})`);
  // Formul baslangici ve kontrol karakteri DC adina giremez (CSV indirmede de etkisizlesir).
  else if (/^[=+\-@]/.test(dc) || /[\p{Cc}]/u.test(dc)) sorun.push(`dc geçersiz ("${dc}")`);
  if (!ipGecerli(eskiIp)) sorun.push(`eski_ip IPv4 değil ("${eskiIp}")`);
  if (!ipGecerli(yeniIp)) sorun.push(`yeni_ip IPv4 değil ("${yeniIp}")`);
  return sorun;
}

/** Set plani CSV'si -> satirlar. Satir hatasi varsa yukleme REDDEDILIR. Set adi tekil. */
function planAyristir(metinHam) {
  const { sonuc, hata, veri } = takvim.csvTabloOku(metinHam, {
    zorunlu: PLAN_ZORUNLU,
    secmeli: PLAN_SECMELI,
    satirSiniri: PLAN_SINIR.satir,
  });
  if (!veri) return sonuc;
  const gorulen = new Map();
  for (const { no, al } of veri) {
    const set = takvim.setCoz(al('set'));
    const tarih = takvim.tarihHucresi(al('gecis_tarihi'));
    const p = { dc: al('dc'), eskiIp: al('eski_ip'), yeniIp: al('yeni_ip') };
    const sorun = [];
    if (!set) sorun.push(`set geçersiz ("${al('set')}"; Pilot ya da Set N)`);
    if (tarih.sorun) sorun.push(tarih.sorun);
    sorun.push(...planSorunlari(p));
    if (set && gorulen.has(set.ad)) sorun.push(`${set.ad} ${gorulen.get(set.ad)}. satırda da var`);
    if (sorun.length) {
      hata(no, sorun.join('; ') + '.');
      continue;
    }
    gorulen.set(set.ad, no);
    sonuc.satirlar.push({ set: set.ad, setSira: set.sira, gecisTarihi: tarih.tarih, ...p });
  }
  sonuc.satirlar.sort((a, b) => a.setSira - b.setSira);
  return sonuc;
}

const PLAN_SECIM = `SELECT set_adi, set_sira, CONVERT(varchar(10), gecis_tarihi, 23) AS gecis_tarihi, dc,
       eski_ip, yeni_ip, surum, guncelleyen, CONVERT(varchar(33), guncelleme, 126) AS guncelleme
  FROM intranet_spa_set_plani`;

function plandan(x) {
  return {
    set: x.set_adi,
    setSira: Number(x.set_sira),
    gecisTarihi: x.gecis_tarihi,
    dc: x.dc || '',
    eskiIp: x.eski_ip || '',
    yeniIp: x.yeni_ip || '',
    surum: Number(x.surum),
    guncelleyen: x.guncelleyen || null,
    guncelleme: x.guncelleme || null,
  };
}

async function planOku(db) {
  const { rows } = await db.query(`${PLAN_SECIM} ORDER BY set_sira`);
  return rows.map(plandan);
}

/** Plan yukleme kilidi: plan + takvim surum ozeti (ikisinden birine yazim kilidi degistirir). */
const planKilidi = (plan, takvimRows) =>
  `plan ${takvim.surumKilidi(plan)} | takvim ${takvim.surumKilidi(takvimRows)}`;

const TAKVIM_KILIT_SECIM = `SELECT set_adi, namespace, uygulama, surum, elle_tarih,
       CONVERT(varchar(10), gecis_tarihi, 23) AS gecis_tarihi
  FROM intranet_spa_takvim`;

/** TAKVIM_KILIT_SECIM satiri -> ayni DC denetiminin satiri. */
const dcSatiri = (r) => ({ set: r.set_adi, namespace: r.namespace, uygulama: r.uygulama });

/**
 * Plan farki ve tasima listesi (onizleme ve yukleme AYNI hesap). Yeni plandaki bir setin tarihi
 * eski plandakinden farkliysa (ya da set planda yeni ise) setin bu tarihten farkli satirlari tasinir;
 * `elle` bunlardan elle duzeltilmis (elle_tarih = 1, tek satir duzeltmesi) olanlar. Uyarilar: bos
 * set, plansiz set, yeni planda ayni uygulamanin ayni DC'de birden fazla sette olmasi.
 */
function planFarki(eskiPlan, yeniPlan, takvimRows) {
  const eski = new Map(eskiPlan.map((p) => [p.set, p]));
  const yeniK = new Set(yeniPlan.map((p) => p.set));
  const satirlar = new Map();
  for (const r of takvimRows) {
    if (!satirlar.has(r.set_adi)) satirlar.set(r.set_adi, []);
    satirlar.get(r.set_adi).push(r);
  }
  let yeni = 0;
  let degisen = 0;
  const tasima = [];
  for (const p of yeniPlan) {
    const e = eski.get(p.set);
    if (!e) yeni += 1;
    else if (PLAN_ALANLARI.some((a) => e[a] !== p[a])) degisen += 1;
    if (e && e.gecisTarihi === p.gecisTarihi) continue;
    const tasinan = (satirlar.get(p.set) || []).filter((r) => r.gecis_tarihi !== p.gecisTarihi);
    if (tasinan.length)
      tasima.push({
        set: p.set,
        eskiTarih: e ? e.gecisTarihi : null,
        yeniTarih: p.gecisTarihi,
        uygulama: tasinan.length,
        elle: tasinan.filter((r) => Number(r.elle_tarih) === 1).length,
      });
  }
  const uyarilar = takvim.ayniDcOzeti(takvimRows.map(dcSatiri), yeniPlan);
  const bos = yeniPlan.filter((p) => !satirlar.has(p.set)).map((p) => p.set);
  if (bos.length) uyarilar.push(`Takvimde uygulaması olmayan set: ${bos.join(', ')}.`);
  const plansiz = [...satirlar.keys()].filter((s) => !yeniK.has(s));
  if (plansiz.length)
    uyarilar.push(`Takvimde olup bu planda olmayan set (plan yok görünür): ${plansiz.join(', ')}.`);
  return {
    fark: {
      mevcut: eskiPlan.length,
      yeni,
      kalkan: eskiPlan.filter((p) => !yeniK.has(p.set)).length,
      degisen,
    },
    tasima,
    uyarilar,
  };
}

const PLAN_KOLON = [
  'set_adi',
  'set_sira',
  'gecis_tarihi',
  'dc',
  'eski_ip',
  'yeni_ip',
  'surum',
  'guncelleyen',
];
const planDegerleri = (p, surum, by) => [
  p.set,
  p.setSira,
  p.gecisTarihi,
  p.dc || null,
  p.eskiIp || null,
  p.yeniIp || null,
  surum,
  by,
];

function planInsert(satirlar, surum, by) {
  const params = [];
  const degerler = satirlar.map((p) => {
    const yer = planDegerleri(p, surum, by).map((d, j) => {
      params.push(d);
      const ph = `$${params.length}`;
      return j === 2 ? `CONVERT(date, ${ph}, 23)` : ph;
    });
    return `(${yer.join(', ')})`;
  });
  return {
    sql: `INSERT INTO intranet_spa_set_plani (${PLAN_KOLON.join(', ')}) VALUES ${degerler.join(', ')}`,
    params,
  };
}

const cakisma = (res, message, ek = {}) =>
  res.status(409).json({ ok: false, code: takvim.CAKISMA, message, ...ek });

/** PUT /set govdesi -> { p } ya da { hata } (400). */
function duzeltmeGovdesi(b) {
  const set = takvim.setCoz(b?.set);
  const tarih = takvim.tarihCoz(b?.gecisTarihi);
  if (!set) return { hata: 'Geçersiz set.' };
  if (!tarih) return { hata: 'Geçersiz tarih (yyyy-aa-gg).' };
  const p = {
    set: set.ad,
    setSira: set.sira,
    gecisTarihi: tarih,
    dc: T(b?.dc),
    eskiIp: T(b?.eskiIp),
    yeniIp: T(b?.yeniIp),
  };
  const sorun = planSorunlari(p);
  if (sorun.length) return { hata: sorun.join('; ') + '.' };
  const beklenenSurum = Number(b?.beklenenSurum);
  if (!Number.isInteger(beklenenSurum) || beklenenSurum < 0)
    return { hata: 'beklenenSurum zorunlu (plan yoksa 0).' };
  const beklenen = b?.beklenen;
  if (beklenen != null && (typeof beklenen !== 'object' || Array.isArray(beklenen)))
    return { hata: 'beklenen geçersiz.' };
  return { p, beklenenSurum, beklenen: beklenen || null, topla: b?.topla === true };
}

/** Tek set duzeltmesi (transaction icinde). */
async function setDuzelt(tx, { p, beklenenSurum, beklenen, topla, by }) {
  const once = await tx.query(`${PLAN_SECIM} WITH (UPDLOCK, HOLDLOCK) WHERE set_adi = $1`, [p.set]);
  const eski = once.rows[0] ? plandan(once.rows[0]) : null;
  if ((eski?.surum ?? 0) !== beklenenSurum) return { cakisma: true, plan: eski };
  let tasima = { satir: 0, tasinan: 0, eski: [] };
  if (!eski || eski.gecisTarihi !== p.gecisTarihi || topla) {
    // Satirlari tasiyan yazim setin her satirinin surumunu ister: eski ekran tasimaz.
    if (!beklenen) return { eksikBeklenen: true };
    tasima = await takvim.setSatirlariniTasi(tx, {
      setAdi: p.set,
      tarih: p.gecisTarihi,
      by,
      beklenen,
    });
    if (tasima.cakisma) return { cakisma: true, plan: eski };
  }
  if (eski) {
    await tx.query(
      `UPDATE intranet_spa_set_plani
          SET gecis_tarihi = CONVERT(date, $2, 23), dc = $3, eski_ip = $4, yeni_ip = $5,
              surum = surum + 1, guncelleyen = $6, guncelleme = SYSUTCDATETIME()
        WHERE set_adi = $1`,
      [p.set, p.gecisTarihi, p.dc || null, p.eskiIp || null, p.yeniIp || null, by],
    );
  } else {
    const m = await tx.query(
      'SELECT MAX(surum) AS m FROM intranet_spa_set_plani WITH (UPDLOCK, HOLDLOCK)',
    );
    const ins = planInsert([p], Number(m.rows[0]?.m || 0) + 1, by);
    await tx.query(ins.sql, ins.params);
  }
  const sonra = await tx.query(`${PLAN_SECIM} WHERE set_adi = $1`, [p.set]);
  // AYNI DC: bu setin DC'si yazildiktan sonra ayni uygulama ayni DC'de baska bir sette de varsa
  // UYARI (yazimi engellemez; plan onizlemesiyle ayni ozet, yalniz bu seti iceren ciftler).
  let uyarilar = [];
  if (p.dc) {
    const butunPlan = (await tx.query(PLAN_SECIM)).rows.map(plandan);
    const butunTakvim = (await tx.query(TAKVIM_KILIT_SECIM)).rows;
    uyarilar = takvim.ayniDcOzeti(butunTakvim.map(dcSatiri), butunPlan, p.set);
  }
  return {
    eski,
    plan: sonra.rows[0] ? plandan(sonra.rows[0]) : null,
    tasima,
    uyarilar,
    rows: tasima.tasinan ? await takvim.setSatirlari(tx, p.set) : [],
  };
}

const planOzeti = (p) => (p ? Object.fromEntries(PLAN_ALANLARI.map((a) => [a, p[a]])) : null);

/** Plan yuklemesi audit'i: yeni, kalkan ya da alani degisen her set icin eski ve yeni degerler. */
function planDegisimleri(eskiPlan, yeniPlan) {
  const yeniM = new Map(yeniPlan.map((p) => [p.set, p]));
  const eskiM = new Map(eskiPlan.map((p) => [p.set, p]));
  const out = [];
  for (const e of eskiPlan) {
    const y = yeniM.get(e.set);
    if (!y || PLAN_ALANLARI.some((a) => e[a] !== y[a]))
      out.push({ set: e.set, eski: planOzeti(e), yeni: planOzeti(y) });
  }
  for (const y of yeniPlan)
    if (!eskiM.has(y.set)) out.push({ set: y.set, eski: null, yeni: planOzeti(y) });
  return out;
}

function mountSetPlani(router, { dbOf, requireAdmin, dbHatasi }) {
  router.put('/intranet/takvim/set', requireAdmin, async (req, res) => {
    const g = duzeltmeGovdesi(req.body);
    if (g.hata) return res.status(400).json({ ok: false, message: g.hata });
    const by = takvim.kim(req);
    try {
      const s = await dbOf().transaction((tx) => setDuzelt(tx, { ...g, by }));
      if (s.eksikBeklenen)
        return res.status(400).json({
          ok: false,
          message: 'Setin tarihi değişiyor: setin satır sürümleri (beklenen) zorunlu.',
        });
      if (s.cakisma)
        return cakisma(
          res,
          `${g.p.set} siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin.`,
          {
            plan: s.plan,
          },
        );
      takvim.denetle(req, 'intranet_spa_set_plani_duzelt', {
        set: g.p.set,
        eski: planOzeti(s.eski),
        yeni: planOzeti(s.plan),
        tasinan: s.tasima.tasinan,
        eskiTarihler: s.tasima.eski,
      });
      return res.json({
        ok: true,
        plan: s.plan,
        rows: s.rows,
        tasinan: s.tasima.tasinan,
        uyarilar: s.uyarilar,
      });
    } catch (e) {
      return dbHatasi(res, e, 'Set planı güncellenemedi.');
    }
  });

  router.post('/intranet/takvim/plan/onizle', requireAdmin, async (req, res) => {
    const a = planAyristir(req.body?.metin);
    let plan;
    let takvimRows;
    try {
      const db = dbOf();
      plan = await planOku(db);
      takvimRows = (await db.query(TAKVIM_KILIT_SECIM)).rows;
    } catch (e) {
      return dbHatasi(res, e, 'Mevcut set planı okunamadı.');
    }
    const f = a.hataSayisi
      ? { fark: null, tasima: [], uyarilar: [] }
      : planFarki(plan, a.satirlar, takvimRows);
    res.json({
      ok: true,
      gecerli: !a.hataSayisi,
      satir: a.satirlar.length,
      toplam: a.toplam,
      setler: a.satirlar,
      hatalar: a.hatalar,
      hataSayisi: a.hataSayisi || 0,
      yoksayilanSutun: a.yoksayilanSutun,
      ...f,
      kilit: planKilidi(plan, takvimRows),
    });
  });

  router.post('/intranet/takvim/plan/yukle', requireAdmin, async (req, res) => {
    const a = planAyristir(req.body?.metin);
    if (a.hataSayisi)
      return res.status(400).json({
        ok: false,
        message: `Dosyada ${a.hataSayisi} hata var; set planı değiştirilmedi.`,
        hatalar: a.hatalar,
      });
    const beklenen = T(req.body?.beklenenKilit);
    const by = takvim.kim(req);
    try {
      const sonuc = await dbOf().transaction(async (tx) => {
        const plan = (await tx.query(`${PLAN_SECIM} WITH (UPDLOCK, HOLDLOCK)`)).rows.map(plandan);
        const takvimRows = (await tx.query(`${TAKVIM_KILIT_SECIM} WITH (UPDLOCK, HOLDLOCK)`)).rows;
        if (planKilidi(plan, takvimRows) !== beklenen) return { cakisma: true };
        const f = planFarki(plan, a.satirlar, takvimRows);
        // ABA: yeni satirlar eski planin en buyuk surumunun ustunden baslar.
        const taban = plan.reduce((n, p) => Math.max(n, p.surum), 0) + 1;
        await tx.query('DELETE FROM intranet_spa_set_plani');
        const ins = planInsert(a.satirlar, taban, by);
        await tx.query(ins.sql, ins.params);
        for (const t of f.tasima)
          await takvim.setSatirlariniTasi(tx, { setAdi: t.set, tarih: t.yeniTarih, by });
        return {
          cakisma: false,
          onceki: plan.length,
          tasima: f.tasima,
          degisen: planDegisimleri(plan, a.satirlar),
        };
      });
      if (sonuc.cakisma)
        return cakisma(
          res,
          'Set planı ya da takvim siz önizlerken değişti. Önizlemeyi yenileyip tekrar deneyin.',
        );
      takvim.denetle(req, 'intranet_spa_set_plani_yukle', {
        onceki: sonuc.onceki,
        set: a.satirlar.length,
        tasinan: sonuc.tasima.map((t) => `${t.set}:${t.uygulama}`),
        degisen: sonuc.degisen,
      });
      res.json({
        ok: true,
        satir: a.satirlar.length,
        tasinan: sonuc.tasima.reduce((n, t) => n + t.uygulama, 0),
      });
    } catch (e) {
      return dbHatasi(res, e, 'Set planı yüklenemedi.');
    }
  });
}

module.exports = {
  mountSetPlani,
  planAyristir,
  planOku,
  planFarki,
  ipGecerli,
  PLAN_SINIR,
};
