// server/ansible/ss-tasima-rotalari.cjs - Admin > Self Servis Tasima uclari (2026-11-10).
//
// Kullanici: "maestro2 emekli oluyor ... maestro2'deki job'lari tetiklemesi icin kullanilan cok
// fazla self servis otomasyonu var ... survey + smart onayi vb. tum sayfalari ilmek ilmek
// hazirlanmisti." Bu ekran her servisi (ansible_ss_items karti) bagimsiz bir birim olarak
// kaynak AWX sunucusundan hedefe tasir:
//
//   GET  /api/ansible/ss/tasima/plan?from=&to=            hazirlik raporu (kuru calisma)
//   GET  /api/ansible/ss/tasima/:itemId/detay?to=&toT=    template / survey farki, ayar uyumu, engeller
//   POST /api/ansible/ss/tasima/:itemId/hedef             elle esleme (HAZIRLIK kaydina yazilir)
//   POST /api/ansible/ss/tasima/:itemId/survey-yaz        kaynak survey'ini HEDEFE yazar (onayli)
//   POST /api/ansible/ss/tasima/:itemId/deneme            ayari hedefe sahneler; dogrula / gercek deneme isi
//   POST /api/ansible/ss/tasima/:itemId/tasi              tek transaction: kart hedefe baglanir
//   GET  /api/ansible/ss/tasima/:itemId/geri-al-onizleme  geri almada neler olacak
//   POST /api/ansible/ss/tasima/:itemId/geri-al           tek transaction: kart kaynaga doner
//   POST /api/ansible/ss/tasima/:itemId/hazirlik-iptal    acik HAZIRLIK kaydini kapatir
//
// Hepsi requireAuth + requireAdmin. Kaynak sunucuya yalniz GET gider; yazicilar (survey yaz /
// kapat) YALNIZ istegin `to` sunucusuna yazar. Gecmis (ansible_job_history, smart_tickets,
// oco_scheduled_launches) ve kaynak ayar satiri DEGISTIRILMEZ. Kapanis icindeki onbellege
// dokunan fonksiyonlar runner.cjs'ten enjekte edilir (sahte app / DB ile test edilebilir:
// server/ansible/__tests__/ss-tasima-rotalar.test.cjs).
'use strict';

const T = require('./ss-tasima.cjs');

const BASE = '/api/ansible/ss/tasima';
const ESZAMANLI = 6;
const GEREKCE_EN_AZ = 10;
const KART_ALANLARI = ['title', 'description', 'enabled', 'order', 'accessMode', 'accessGroups'];

function hata(status, message, ek = {}) {
  return Object.assign(new Error(message), { status, ek });
}

async function sinirliParalel(liste, n, fn) {
  const sonuc = new Array(liste.length);
  let i = 0;
  const isci = async () => {
    while (i < liste.length) {
      const k = i++;
      sonuc[k] = await fn(liste[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, liste.length) }, isci));
  return sonuc;
}

function kartOzeti(i) {
  const o = {};
  for (const k of KART_ALANLARI) o[k] = i[k] === undefined ? null : i[k];
  o.id = i.id;
  o.awxServerId = Number(i.awxServerId);
  o.awxTemplateId = Number(i.awxTemplateId);
  return o;
}

function kaydet(app, deps) {
  const {
    requireAuth,
    requireAdmin,
    dbx,
    getServerById,
    readSsItems,
    reloadSsItemsCache,
    reloadSsCustomCache,
    readCustom,
    writeCustom,
    setCustomCache,
    listTemplatesForServer,
    getTemplateDetailOnServer,
    getSurveySpecOnServer,
    writeSurveySpecOnServer,
    setSurveyEnabledOnServer,
    getJobOnServer,
    listTemplateSchedulesOnServer,
    resolveSsLaunchPlan,
    ssTestKosusuBaslat,
    sonTarihli,
    sonTarihMs = 8000,
    friendlyAwxError = (e) => ({ status: e.status || 502, message: e.message }),
    redactSecrets = (s) => String(s == null ? '' : s),
  } = deps;
  const env = deps.env || process.env;
  const invalidate =
    deps.invalidate ||
    (() => {
      try {
        require('./ss-customizations.cjs').invalidate();
      } catch {
        /* modul yoksa yoksay */
      }
    });
  const longJobConfig =
    deps.longJobConfig ||
    (async () => {
      try {
        return await require('./long-job-cancel.cjs').readConfig(dbx);
      } catch {
        return null;
      }
    });
  const denetle = (req, action, detail) => {
    try {
      (deps.audit || require('../audit/index.cjs').auditPortal)(req, action, {
        username: req.session?.user?.username || null,
        detail: JSON.stringify(detail),
      });
    } catch {
      /* audit yoksa yoksay */
    }
  };
  const kim = (req) => req.session?.user?.username || 'bilinmiyor';
  // Smart onayli serviste gercek deneme: admin "Smart atla" tercihi kapaliysa deneme GERCEK ve
  // sahipsiz bir Smart talebi acardi (poller'in actigi is deneme kaydina baglanmaz) -> reddedilir.
  const smartGerekliMi =
    deps.smartGerekliMi || ((smartApproval, gateVars) => require('./change-gates.cjs').isSmartRequired(smartApproval, gateVars));
  const adminSmartAtliyor = deps.adminSmartAtliyor || ((req) => require('./admin-smart-atla.cjs').adminSmartAtliyor(req));
  // Commit sonrasi kart onbellegi tazelenemezse runner'daki liste yazimini kilitler (bayat liste
  // tasimayi / geri almayi sessizce geri yazmasin).
  const ssItemsKirliIsaretle = deps.ssItemsKirliIsaretle || (() => {});

  // Her AWX okumasi suresiyle sinirli; gecerse hata (bilinmeyen "bos" sayilmaz).
  const sinirli = (is) =>
    sonTarihli
      ? sonTarihli(is, sonTarihMs, () => Promise.reject(Object.assign(new Error('AWX yanıtı süre sınırını aştı.'), { sureAsimi: true })))
      : is;

  // sunucuAdi: hangi sunucu okunurken hata alindi (403 mesaji "hedef" diye sabit kalmasin).
  function mesajOf(err, sunucuAdi) {
    if (err?.status === 403)
      return `Portal'ın ${sunucuAdi ? (String(sunucuAdi) + " sunucusundaki") : 'AWX'} hesabı bu template'te yetkili değil (AWX 403).`;
    const { message } = friendlyAwxError(err || {});
    const m = redactSecrets(message || (err?.message) || 'AWX isteği başarısız.');
    return sunucuAdi ? `${sunucuAdi}: ${m}` : m;
  }

  function sunucuAdi(id) {
    const s = getServerById(Number(id));
    return s ? s.name : `#${id}`;
  }

  // Kaynak ve hedef ayni AWX olamaz: ayni id YA DA ayni URL host'u (ayni sunucunun iki kaydi).
  function ciftKontrol(fromId, toS) {
    if (Number(fromId) === Number(toS.id) || T.ayniSunucu(getServerById(Number(fromId)), toS))
      throw hata(400, 'Kaynak ve hedef aynı sunucu olamaz.', {});
  }

  function yanitHata(res, err) {
    if (err?.ek && typeof err.status === 'number' && err.status >= 400 && err.status < 600) {
      return res.status(err.status).json({ ok: false, message: err.message, ...err.ek });
    }
    const status = err?.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ ok: false, message: mesajOf(err) });
  }

  function izinListesi() {
    return String(env.AWX_READ_ONLY_TEMPLATE_IDS || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  function sunucuGerekli(id, ad) {
    const n = Number(id);
    const s = Number.isInteger(n) ? getServerById(n) : null;
    if (!s) throw hata(400, `${ad} sunucu bulunamadı ya da devre dışı.`, {});
    return s;
  }

  function kartGetir(itemId) {
    const item = readSsItems().find((i) => String(i.id) === String(itemId));
    if (!item) throw hata(404, 'Servis bulunamadı.', {});
    return item;
  }

  async function acikKayit(itemId) {
    const { rows } = await dbx.query(
      `SELECT TOP 1 * FROM ansible_ss_migrations WHERE item_id = $1 AND status IN ('HAZIRLIK','TASINDI') ORDER BY id DESC`,
      [String(itemId)],
    );
    return rows?.[0] ? T.kayitSatiri(rows[0]) : null;
  }

  async function kayitGecmisi(itemId) {
    const { rows } = await dbx.query(
      `SELECT TOP 20 * FROM ansible_ss_migrations WHERE item_id = $1 ORDER BY id DESC`,
      [String(itemId)],
    );
    return (rows || []).map(T.kayitSatiri);
  }

  // HAZIRLIK kaydini getirir / acar / hedef degistiyse gunceller (deneme ve survey izi sifirlanir).
  async function hazirlikGetir(item, to, toT, toAd, kaynakAd, eslesme, by) {
    const acik = await acikKayit(item.id);
    if (acik?.status === 'TASINDI') throw hata(409, 'Servis zaten taşınmış; önce geri alın.', {});
    const from = Number(item.awxServerId);
    const fromT = Number(item.awxTemplateId);
    if (acik) {
      const ayni = acik.toServer === Number(to) && acik.toTemplate === Number(toT) && acik.fromServer === from && acik.fromTemplate === fromT;
      if (ayni) {
        if (eslesme === 'elle' && acik.eslesme !== 'elle') {
          await dbx.query(`UPDATE ansible_ss_migrations SET eslesme = 'elle' WHERE id = $1 AND status = 'HAZIRLIK'`, [acik.id]);
          acik.eslesme = 'elle';
        }
        return acik;
      }
      await dbx.query(
        `UPDATE ansible_ss_migrations
            SET from_server = $1, from_template = $2, from_template_name = $3, to_server = $4, to_template = $5,
                to_template_name = $6, eslesme = $7, survey_yazildi = 0, hedef_survey_hash = NULL,
                hedef_survey_onceki_json = NULL, deneme_job_id = NULL, deneme_at = NULL,
                deneme_kaynak_hash = NULL, deneme_hedef_survey_hash = NULL
          WHERE id = $8 AND status = 'HAZIRLIK'`,
        [from, fromT, kaynakAd || null, Number(to), Number(toT), toAd || null, eslesme, acik.id],
      );
      return acikKayit(item.id);
    }
    try {
      await dbx.query(
        `INSERT INTO ansible_ss_migrations (item_id, from_server, from_template, from_template_name, to_server,
           to_template, to_template_name, status, eslesme, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'HAZIRLIK', $8, $9)`,
        [String(item.id), from, fromT, kaynakAd || null, Number(to), Number(toT), toAd || null, eslesme, by],
      );
    } catch (err) {
      // Eszamanli hazirlik: UX_ss_migrations_acik ihlali ham SQL mesajiyla 500 donmesin.
      const m = T.tasimaHatasi(err);
      if (m) throw hata(m.status, m.message, {});
      throw err;
    }
    return acikKayit(item.id);
  }

  // AWX okumasi: { ok, deger, hata }. survey_spec 404 = bos survey.
  async function guvenliOku(fn, bos404, ad) {
    try {
      return { ok: true, deger: await sinirli(fn()) };
    } catch (err) {
      if (bos404 !== undefined && err && err.status === 404) return { ok: true, deger: bos404 };
      return { ok: false, deger: null, hata: mesajOf(err, ad) };
    }
  }

  function onbellekliOkuyucu() {
    const m = new Map();
    const oku = (anahtar, fn, bos404, ad) => {
      if (!m.has(anahtar)) m.set(anahtar, guvenliOku(fn, bos404, ad));
      return m.get(anahtar);
    };
    return {
      detay: (s, t) => oku(`d:${s}:${t}`, () => getTemplateDetailOnServer(s, t), undefined, sunucuAdi(s)),
      // spec: { spec, name, description } - survey yazimi kaynagin kendi ad/aciklamasini korur.
      specTam: (s, t) =>
        oku(
          `s:${s}:${t}`,
          () => getSurveySpecOnServer(s, t).then((r) => ({ spec: r.spec, name: r.name, description: r.description })),
          { spec: [], name: '', description: '' },
          sunucuAdi(s),
        ),
      spec: async (s, t) => {
        const r = await oku(
          `s:${s}:${t}`,
          () => getSurveySpecOnServer(s, t).then((x) => ({ spec: x.spec, name: x.name, description: x.description })),
          { spec: [], name: '', description: '' },
          sunucuAdi(s),
        );
        return r.ok ? { ok: true, deger: r.deger.spec } : r;
      },
    };
  }

  /**
   * Hedef (to, toT) baska bir yere bagli mi: baska servis karti, Playbook Kayitlari anahtari,
   * izin listesi disi, ya da baska bir servisin hazirlik / ad eslesmesi (cakisma). Survey yazimi,
   * deneme sahnelemesi ve analiz AYNI kontrolu kullanir - canli bir template'in survey'i ya da
   * ayar satiri baska servis adina ezilmesin.
   */
  async function hedefBagEngelleri(item, to, toT, { cakisma = false } = {}) {
    const engeller = [];
    const okunamayan = [];
    if (cakisma)
      engeller.push({ anahtar: 'hedef_cakisiyor', baslik: 'Başka bir servis de aynı hedef template ile eşleşti', adet: 1, ipucu: 'Birini elle başka bir hedefe bağlayın.' });
    const baskasi = readSsItems().find((i) => String(i.id) !== String(item.id) && Number(i.awxServerId) === Number(to) && Number(i.awxTemplateId) === Number(toT));
    if (baskasi)
      engeller.push({ anahtar: 'hedef_baska_serviste', baslik: `Hedef template zaten '${baskasi.title}' servisine bağlı`, adet: 1, ipucu: 'Diğer servisi önce taşıyın ya da başka bir hedef seçin.' });
    try {
      const { rows } = await dbx.query(T.PLAYBOOK_KAYDI_SQL, [Number(to), Number(toT)]);
      if (rows?.[0])
        engeller.push({ anahtar: 'hedef_playbook_kaydinda', baslik: `Hedef template Playbook Kayıtları'nda '${rows[0].key_name}' anahtarına bağlı`, adet: 1, ipucu: 'Bir Portal modülü aynı ayar satırını kullanır; başka bir hedef seçin.' });
    } catch (err) {
      okunamayan.push({ anahtar: 'hedef_playbook_kaydinda', baslik: 'Playbook Kayıtları', hata: String(err.message || err) });
    }
    const izin = izinListesi();
    if (izin.length && !izin.includes(Number(toT)))
      engeller.push({ anahtar: 'izin_listesi', baslik: `Hedef template #${toT} AWX_READ_ONLY_TEMPLATE_IDS listesinde yok`, adet: 1, ipucu: 'Hedef template numarasını izin listesine ekleyin.' });
    return { engeller, okunamayan };
  }

  // Yazici uclar (survey-yaz, deneme) icin: hedef bagli ya da kontrol edilemiyorsa 409.
  async function hedefYazilabilirGerekli(item, to, toT) {
    let cakisma;
    try {
      cakisma = await tekCakisma(item, to, toT);
    } catch {
      cakisma = null;
    }
    const b = await hedefBagEngelleri(item, to, toT, { cakisma: cakisma === true });
    if (cakisma === null) b.okunamayan.push({ anahtar: 'hedef_cakisiyor', baslik: 'Eşleşme çakışması kontrol edilemedi', hata: 'kaynak template listesi okunamadı' });
    if (b.engeller.length || b.okunamayan.length)
      throw hata(409, `Hedef template'e yazılamaz: ${[...b.engeller.map((e) => e.baslik), ...b.okunamayan.map((e) => (String(e.baslik) + " (kontrol edilemedi)"))].join('; ')}.`, {
        engeller: b.engeller,
        okunamayan: b.okunamayan,
      });
  }

  /**
   * Tek servis uclarinda cakisma (plan'daki `eslestir` cakismasinin sunucu tarafi karsiligi):
   * baska bir servisin acik HAZIRLIK kaydi ayni hedefi gosteriyorsa ya da ayni kaynak sunucudaki
   * baska bir kart (elle baska hedefe yonlenmemis) hedef ADIYLA eslesiyorsa true. Kaynak listesi
   * okunamazsa null (cagiran kontrol_edilemedi sayar).
   */
  async function tekCakisma(item, to, toT) {
    const { rows } = await dbx.query(
      `SELECT item_id, to_server, to_template, eslesme FROM ansible_ss_migrations WHERE status = 'HAZIRLIK' AND item_id <> $1`,
      [String(item.id)],
    );
    const elleBaska = new Set();
    for (const r of rows || []) {
      if (Number(r.to_server) === Number(to) && Number(r.to_template) === Number(toT)) return true;
      if (r.eslesme === 'elle') elleBaska.add(String(r.item_id));
    }
    const digerleri = readSsItems().filter(
      (i) => String(i.id) !== String(item.id) && Number(i.awxServerId) === Number(item.awxServerId) && !elleBaska.has(String(i.id)),
    );
    if (!digerleri.length) return false;
    const hD = await guvenliOku(() => getTemplateDetailOnServer(to, toT), undefined, sunucuAdi(to));
    const toAd = hD.ok && hD.deger ? String(hD.deger.name || '').trim() : '';
    if (!toAd) return hD.ok ? false : null;
    const fromS = getServerById(Number(item.awxServerId));
    if (!fromS) return null;
    const kL = await guvenliOku(() => listTemplatesForServer(fromS), undefined, fromS.name);
    if (!kL.ok) return null;
    const adlar = new Map(kL.deger.map((t) => [Number(t.id), String(t.name || '').trim()]));
    return digerleri.some((i) => adlar.get(Number(i.awxTemplateId)) === toAd);
  }

  /**
   * Bir servisin hedef template'e gore hazirlik analizi. `hedef`: { toT, toAd, eslesme, neden,
   * adaylar, cakisma }. Plan, detay ve tasi AYNI fonksiyonu kullanir (planHash tutarli).
   */
  async function analiz(ctx, item, hedef) {
    const from = Number(item.awxServerId);
    const fromT = Number(item.awxTemplateId);
    const to = Number(ctx.to);
    const r = {
      itemId: String(item.id),
      title: item.title,
      enabled: !!item.enabled,
      accessMode: item.accessMode || null,
      kaynakTemplate: { id: fromT, name: hedef.kaynakAd || '' },
      hedefTemplate: hedef.toT ? { id: Number(hedef.toT), name: hedef.toAd || '' } : null,
      eslesme: hedef.eslesme || null,
      eslesmeNedeni: hedef.neden ? T.ESLESME_NEDENI[hedef.neden] || hedef.neden : null,
      adaylar: hedef.adaylar || [],
      engeller: [],
      okunamayan: [],
      uyarilar: [],
      nedenler: [],
      surveyEylemi: null,
      kaynakSurveyModu: null,
      hedefSurveyModu: null,
      tahminSurveyYazilirsa: null,
      hedefSurveyHash: null,
      planHash: null,
      deneme: null,
      kayit: ctx.kayitlar ? ctx.kayitlar.get(String(item.id)) || null : null,
      sonKayitDurumu: ctx.sonDurumlar ? ctx.sonDurumlar.get(String(item.id)) || null : null,
    };
    const ic = {};
    if (ctx.sunucuHatasi) r.okunamayan.push({ anahtar: 'kontrol_edilemedi', baslik: 'Sunucu template listesi', hata: ctx.sunucuHatasi });
    if (!hedef.toT) {
      const d = T.durumBelirle({ eslesmeYok: !ctx.sunucuHatasi, engelVar: !!ctx.sunucuHatasi });
      r.durum = d.durum;
      r.cipler = d.cipler;
      if (r.eslesmeNedeni) r.nedenler.push(r.eslesmeNedeni);
      return { satir: r, ic };
    }
    const toT = Number(hedef.toT);

    // -- Engeller: kaynak cift (template kapsamli) + hedef ciftin baska bir yere bagli olmasi --
    const say = await T.engelleriSay(dbx, from, fromT);
    r.engeller.push(...say.engeller);
    r.okunamayan.push(...say.okunamayan);
    if (hedef.cakisma === null)
      r.okunamayan.push({ anahtar: 'hedef_cakisiyor', baslik: 'Eşleşme çakışması kontrol edilemedi', hata: 'kaynak template listesi okunamadı' });
    const bag = await hedefBagEngelleri(item, to, toT, { cakisma: hedef.cakisma === true });
    r.engeller.push(...bag.engeller);
    r.okunamayan.push(...bag.okunamayan);
    // TASINDI kaydi var ama kart hedefte degil (elle /ss/items duzenlemesi ya da bayat liste
    // yazimi karti geri cevirmis): kayit tutarsiz, servis kilitli kalmasin diye gorunur ENGEL.
    if (r.kayit?.status === 'TASINDI')
      r.engeller.push({ anahtar: 'tutarsiz_kayit', baslik: 'Taşıma kaydı TAŞINDI diyor ama kart kaynağa bağlı', adet: 1, ipucu: "Geri al penceresinden kaydı kapatın (kart değişmez), sonra yeniden taşıyın." });

    // -- AWX okumalari (kaynaga yalniz GET) --
    const ok = ctx.okuyucu || onbellekliOkuyucu();
    const [kD, kS, hD, hS] = await Promise.all([ok.detay(from, fromT), ok.spec(from, fromT), ok.detay(to, toT), ok.spec(to, toT)]);
    for (const [x, ad] of [[kD, 'Kaynak template'], [kS, 'Kaynak survey'], [hD, 'Hedef template'], [hS, 'Hedef survey']]) {
      if (!x.ok) r.okunamayan.push({ anahtar: 'kontrol_edilemedi', baslik: `${ad} okunamadı`, hata: x.hata });
    }
    const kDetail = kD.ok ? kD.deger : null;
    const hDetail = hD.ok ? hD.deger : null;
    const kSpec = kS.ok ? kS.deger : null;
    const hSpec = hS.ok ? hS.deger : null;
    if (kDetail?.name) r.kaynakTemplate.name = String(kDetail.name);
    if (hDetail?.name && r.hedefTemplate) r.hedefTemplate.name = String(hDetail.name);
    const kaynakModu = T.surveyModu(kDetail, kSpec);
    const hedefModu = T.surveyModu(hDetail, hSpec);
    r.kaynakSurveyModu = kaynakModu;
    r.hedefSurveyModu = hedefModu;
    const fark = T.surveyFarki(kSpec || [], hSpec || []);
    const karar = T.surveyKarari(kaynakModu, hedefModu, hDetail, hSpec || [], fark);
    if (karar.olculemedi && !r.okunamayan.some((o) => o.anahtar === 'kontrol_edilemedi'))
      r.okunamayan.push({ anahtar: 'kontrol_edilemedi', baslik: 'Survey türü ölçülemedi', hata: 'survey_enabled okunamadı' });
    r.uyarilar.push(...karar.uyarilar);
    r.surveyEylemi = karar.eylem;
    r.hedefteSilinecekSoru = karar.eylem === 'yaz' ? fark.satirlar.filter((s) => s.etiket === 'yalniz_hedefte').length : 0;

    // -- Ayar uyumu (hedefin SU ANKI hali + "survey yazilirsa" ongorusu) --
    const kaynakData = readCustom(from, fromT) || {};
    const hedefData = readCustom(to, toT) || {};
    const hedefDataVarMi = Object.keys(hedefData).length > 0;
    if (hedefDataVarMi && T.veriHash(hedefData) !== T.veriHash(kaynakData))
      r.uyarilar.push(
        Object.keys(kaynakData).length > 0
          ? 'Hedef template için farklı bir ayar satırı var; taşımada kaynağın ayarıyla değiştirilir (eskisi geçmişe arşivlenir).'
          : 'Hedef template için ayar satırı var ama kaynakta yok; taşımada silinir (geçmişe arşivlenir).',
      );
    const uyum = T.ozellestirmeUyumu(kaynakData, { hedefSpec: hSpec || [], hedefDetail: hDetail, kaynakDetail: kDetail, kaynakModu });
    r.uyarilar.push(...uyum.uyarilar);
    if (uyum.gomulu.length)
      r.engeller.push({ anahtar: 'gomulu_kimlik', baslik: `Ayar JSON'unda tanınmayan kimlik alanı: ${uyum.gomulu.slice(0, 5).join(', ')}`, adet: uyum.gomulu.length, ipucu: 'Geliştiriciye bildirin; bu alan eski kimlikle taşınabilir.' });
    let uyumTahmin = null;
    if (karar.eylem && hDetail) {
      const tahminDetay = { ...hDetail, survey_enabled: karar.eylem === 'yaz' };
      const tahminSpec = karar.eylem === 'yaz' ? T.parolaTemizle(kSpec || []) : hSpec || [];
      uyumTahmin = T.ozellestirmeUyumu(kaynakData, { hedefSpec: tahminSpec, hedefDetail: tahminDetay, kaynakDetail: kDetail, kaynakModu });
      r.tahminSurveyYazilirsa = uyumTahmin.hatalar.length ? 'OZELLESTIRME_UYUMSUZ' : 'HAZIR';
    }

    // -- Uyarilar (tasimayi engellemez) --
    try {
      const { rows } = await dbx.query(T.SUREN_IS_SQL, [from, fromT]);
      const n = Number(rows?.[0]?.n) || 0;
      if (n > 0) r.uyarilar.push(`Kaynakta süren ${n} iş var: kaynakta bitecek, çıktısı kaynaktan okunur.`);
    } catch (err) {
      r.uyarilar.push(`Kaynakta süren işler okunamadı: ${String(err.message || err)}`);
    }
    if (Array.isArray(ctx.longjob?.templates)) {
      const l = ctx.longjob.templates;
      const kaynakta = l.some((t) => t.serverId === from && t.templateId === fromT && t.kind !== 'workflow');
      const hedefte = l.some((t) => t.serverId === to && t.templateId === toT && t.kind !== 'workflow');
      if (kaynakta && !hedefte)
        r.uyarilar.push('Uzun iş otomatik iptal listesinde kaynak template var, hedef yok: hedefte bu işler otomatik iptal edilmez (Uzun İş panelinden ekleyin; hedef için ayrı iptal token\'ı gerekir).');
    }

    // -- Deneme kosusu gecerliligi --
    const hedefSurveyHash = (T.surveyHash(hDetail?.survey_enabled, hSpec || []) ?? null);
    const kaynakHash = T.veriHash(kaynakData);
    if (r.kayit?.status === 'HAZIRLIK' && r.kayit.denemeJobId && r.kayit.toServer === to && r.kayit.toTemplate === toT) {
      const deneme = { jobId: r.kayit.denemeJobId, at: r.kayit.denemeAt, status: null, gecerli: false, neden: null };
      try {
        const j = await sinirli(getJobOnServer(to, r.kayit.denemeJobId));
        deneme.status = j.status;
        if (j.status !== 'successful') deneme.neden = `Deneme işi başarılı değil (${j.status}).`;
        else if (Number(j.jobTemplate) !== toT) deneme.neden = 'Deneme işi başka bir template\'e ait.';
        else if (r.kayit.denemeKaynakHash !== kaynakHash) deneme.neden = 'Denemeden sonra kaynak ayarları değişti.';
        else if (r.kayit.denemeHedefSurveyHash !== hedefSurveyHash) deneme.neden = "Denemeden sonra hedef survey'i değişti.";
        else deneme.gecerli = true;
      } catch (err) {
        deneme.neden = `Deneme işi okunamadı: ${mesajOf(err, sunucuAdi(to))}`;
      }
      r.deneme = deneme;
    }

    const d = T.durumBelirle({
      eslesmeYok: false,
      engelVar: r.engeller.length > 0 || r.okunamayan.length > 0,
      surveyCip: karar.cip,
      uyumsuz: uyum.hatalar.length > 0,
    });
    r.durum = d.durum;
    r.cipler = d.cipler;
    r.nedenler.push(...uyum.hatalar);
    if (karar.cip === 'SURVEY_BOS') r.nedenler.push("Kaynak AWX survey'i kullanıyor, hedefte survey boş.");
    if (karar.cip === 'SURVEY_FARKLI' && karar.eylem === 'yaz') r.nedenler.push('Survey kritik düzeyde farklı (ya da hedefte kapalı).');
    if (karar.cip === 'SURVEY_FARKLI' && karar.eylem === 'kapat') r.nedenler.push("Kaynak Portal Survey Tasarımcısı kullanıyor (survey kapalı); hedefte survey açık.");
    r.hedefSurveyHash = hedefSurveyHash;
    r.planHash = T.planHash({ itemId: item.id, from, fromT, to, toT, kaynakData, hedefSurveyHash, hedefData });
    Object.assign(ic, { kDetail, hDetail, kSpec, hSpec, fark, karar, uyum, uyumTahmin, kaynakData, hedefData, hedefDataVarMi, hedefSurveyHash, kaynakHash, kaynakModu, hedefModu });
    return { satir: r, ic };
  }

  // Tek servis icin baglam (plan disindaki uclar): liste okumaz, hedef ADI ile esleme turunu soyler.
  async function tekBaglam(to) {
    let longjob = null;
    try {
      longjob = await longJobConfig();
    } catch {
      longjob = null;
    }
    return { to: Number(to), izinListesi: izinListesi(), longjob, okuyucu: onbellekliOkuyucu() };
  }

  async function tekHedef(ctx, item, toT) {
    const [kD, hD] = await Promise.all([ctx.okuyucu.detay(item.awxServerId, item.awxTemplateId), ctx.okuyucu.detay(ctx.to, toT)]);
    const kaynakAd = kD.ok && kD.deger ? String(kD.deger.name || '') : '';
    const toAd = hD.ok && hD.deger ? String(hD.deger.name || '') : '';
    const adla = kaynakAd && toAd && kaynakAd.trim() === toAd.trim();
    // Plan'daki cakisma burada da uygulanir (dogrudan API ile ENGEL satiri tasinmasin).
    let cakisma;
    try {
      cakisma = await tekCakisma(item, ctx.to, toT);
    } catch {
      cakisma = null;
    }
    return {
      toT: Number(toT),
      toAd,
      kaynakAd,
      eslesme: adla ? 'ad' : 'elle',
      neden: null,
      adaylar: [],
      cakisma,
    };
  }

  function toTGerekli(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw hata(400, 'Geçersiz hedef template.', {});
    return n;
  }

  // =========================================================================
  // GET plan
  // =========================================================================
  app.get(`${BASE}/plan`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const toS = sunucuGerekli(req.query.to, 'Hedef');
      const fromNo = Number(req.query.from);
      if (!Number.isInteger(fromNo) || fromNo <= 0) throw hata(400, 'Kaynak sunucu bulunamadı ya da devre dışı.', {});
      // Kaynak sunucu Portal'da kapatildiysa (emekli) rapor SALT-OKUNUR calisir: yalniz TASINDI
      // satirlari ve kayitlari gosterilir, geri alma disinda islem yok.
      const fromS = getServerById(fromNo);
      const saltOkunur = !fromS;
      ciftKontrol(fromNo, toS);
      const from = fromNo;
      const to = toS.id;

      try {
        await reloadSsCustomCache();
      } catch (err) {
        throw hata(503, `Self Servis ayarları okunamadı: ${err.message}`, {});
      }

      let kayitHatasi = null;
      const kayitlar = new Map();
      const sonDurumlar = new Map();
      try {
        const { rows } = await dbx.query(
          `SELECT id, item_id, status, from_server, from_template, from_template_name, to_server, to_template,
                  to_template_name, eslesme, survey_yazildi, hedef_survey_hash, deneme_job_id, deneme_at,
                  deneme_kaynak_hash, deneme_hedef_survey_hash, denemesiz_gerekce, created_by, created_at,
                  tasiyan, tasindi_at, geri_alan, geri_alindi_at
             FROM ansible_ss_migrations ORDER BY id DESC`,
        );
        for (const row of rows || []) {
          const k = T.kayitSatiri(row);
          if (!sonDurumlar.has(k.itemId)) sonDurumlar.set(k.itemId, k.status);
          if ((k.status === 'HAZIRLIK' || k.status === 'TASINDI') && !kayitlar.has(k.itemId)) kayitlar.set(k.itemId, k);
        }
      } catch (err) {
        kayitHatasi = String(err.message || err);
      }

      const tumu = readSsItems();
      const tasinmis = tumu.filter((i) => {
        const k = kayitlar.get(String(i.id));
        return k && k.status === 'TASINDI' && k.fromServer === from && k.toServer === to && Number(i.awxServerId) === to;
      });
      if (saltOkunur && !tasinmis.length) throw hata(400, 'Kaynak sunucu bulunamadı ya da devre dışı.', {});

      const sunucuHatalari = [];
      const [kL, hL] = saltOkunur
        ? [{ ok: true, deger: [] }, { ok: true, deger: [] }]
        : await Promise.all([
            guvenliOku(() => listTemplatesForServer(fromS), undefined, fromS.name),
            guvenliOku(() => listTemplatesForServer(toS), undefined, toS.name),
          ]);
      if (!kL.ok) sunucuHatalari.push({ sunucu: fromS.name, hata: kL.hata });
      if (!hL.ok) sunucuHatalari.push({ sunucu: toS.name, hata: hL.hata });
      const kaynakAdlari = new Map((kL.ok ? kL.deger : []).map((t) => [Number(t.id), String(t.name)]));
      const hedefListe = hL.ok ? hL.deger.map((t) => ({ id: Number(t.id), name: String(t.name) })) : [];

      const adaylar = saltOkunur ? [] : tumu.filter((i) => Number(i.awxServerId) === from);

      const elle = {};
      for (const i of adaylar) {
        const k = kayitlar.get(String(i.id));
        if (k && k.status === 'HAZIRLIK' && k.eslesme === 'elle' && k.toServer === to) elle[i.id] = k.toTemplate;
      }
      const eslesmeler = T.eslestir(
        adaylar.map((i) => ({ id: i.id, kaynakAd: kaynakAdlari.get(Number(i.awxTemplateId)) || '' })),
        hedefListe,
        elle,
      );
      // Liste okunamadiysa neden "template silinmis olabilir" degil, gercek neden olsun.
      for (const v of eslesmeler.values()) {
        if (v.toT) continue;
        if (!kL.ok && v.neden === 'kaynak_adi_yok') v.neden = 'kaynak_okunamadi';
        else if (!hL.ok && v.neden !== 'elle_secim_yok') v.neden = 'hedef_okunamadi';
      }
      // Baska bir servisin acik HAZIRLIK kaydi ayni hedefi gosteriyorsa da cakisma (tekCakisma ile ayni kural).
      for (const [id, v] of eslesmeler) {
        if (!v.toT || v.cakisma) continue;
        for (const [kid, k] of kayitlar) {
          if (kid !== String(id) && k.status === 'HAZIRLIK' && k.toServer === to && k.toTemplate === Number(v.toT)) v.cakisma = true;
        }
      }

      let longjob = null;
      try {
        longjob = await longJobConfig();
      } catch {
        longjob = null;
      }
      const okuyucu = onbellekliOkuyucu();
      const ctx = {
        to,
        izinListesi: izinListesi(),
        longjob,
        okuyucu,
        kayitlar,
        sonDurumlar,
        sunucuHatasi: sunucuHatalari.length ? sunucuHatalari.map((h) => `${h.sunucu}: ${h.hata}`).join('; ') : null,
      };

      const satirlar = await sinirliParalel(adaylar, ESZAMANLI, async (item) => {
        const e = eslesmeler.get(item.id) || { toT: null, neden: 'ad_yok', adaylar: [] };
        const { satir } = await analiz(ctx, item, { ...e, kaynakAd: kaynakAdlari.get(Number(item.awxTemplateId)) || '' });
        if (kayitHatasi) {
          satir.okunamayan.push({ anahtar: 'kontrol_edilemedi', baslik: 'Taşıma kayıtları', hata: kayitHatasi });
          if (satir.durum !== 'ESLESME_YOK') {
            satir.durum = 'ENGEL';
            satir.cipler = ['ENGEL', ...satir.cipler.filter((c) => c !== 'ENGEL' && c !== 'HAZIR')];
          }
        }
        if (satir.sonKayitDurumu === 'GERI_ALINDI' && !satir.kayit) satir.cipler = [...satir.cipler, 'GERI_ALINDI'];
        satir.kayit = T.istemciKaydi(satir.kayit);
        return satir;
      });
      for (const item of tasinmis) {
        const k = kayitlar.get(String(item.id));
        satirlar.push({
          itemId: String(item.id),
          title: item.title,
          enabled: !!item.enabled,
          accessMode: item.accessMode || null,
          kaynakTemplate: { id: k.fromTemplate, name: k.fromTemplateName || '' },
          hedefTemplate: { id: k.toTemplate, name: k.toTemplateName || '' },
          eslesme: k.eslesme,
          eslesmeNedeni: null,
          adaylar: [],
          engeller: [],
          okunamayan: [],
          uyarilar: [],
          nedenler: [],
          surveyEylemi: null,
          kaynakSurveyModu: null,
          hedefSurveyModu: null,
          tahminSurveyYazilirsa: null,
          hedefSurveyHash: null,
          planHash: null,
          deneme: null,
          kayit: T.istemciKaydi(k),
          sonKayitDurumu: 'TASINDI',
          durum: 'TASINDI',
          cipler: ['TASINDI'],
        });
      }

      res.json({
        ok: true,
        kaynak: { id: from, name: fromS ? fromS.name : '#' + from },
        saltOkunur,
        hedef: { id: to, name: toS.name },
        izinListesiDolu: izinListesi().length > 0,
        sunucuHatalari,
        kayitHatasi,
        hedefTemplateleri: hedefListe.sort((a, b) => a.name.localeCompare(b.name, 'tr')),
        satirlar,
      });
    } catch (err) {
      yanitHata(res, err);
    }
  });

  // =========================================================================
  // GET detay
  // =========================================================================
  app.get(`${BASE}/:itemId/detay`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const item = kartGetir(req.params.itemId);
      let kayitlar = [];
      let kayitHatasi = null;
      try {
        kayitlar = await kayitGecmisi(item.id);
      } catch (err) {
        kayitHatasi = String(err.message || err);
      }
      const acik = kayitlar.find((k) => k.status === 'HAZIRLIK' || k.status === 'TASINDI') || null;
      const istemciKayitlari = kayitlar.map(T.istemciKaydi);
      if (acik && acik.status === 'TASINDI') {
        // Kart hedefte degilse kayit tutarsiz: ekran 'tasindi' demesin, kaydi kapatma yolunu gostersin.
        const tutarsiz = Number(item.awxServerId) !== acik.toServer || Number(item.awxTemplateId) !== acik.toTemplate;
        return res.json({ ok: true, tasindi: true, tutarsiz, kayit: T.istemciKaydi(acik), kayitlar: istemciKayitlari, kayitHatasi });
      }

      const toS = sunucuGerekli(req.query.to, 'Hedef');
      ciftKontrol(item.awxServerId, toS);
      const toT = toTGerekli(req.query.toT);
      await reloadSsCustomCache();
      const ctx = await tekBaglam(toS.id);
      ctx.kayitlar = new Map(acik ? [[String(item.id), acik]] : []);
      const hedef = await tekHedef(ctx, item, toT);
      const { satir, ic } = await analiz(ctx, item, hedef);
      if (kayitHatasi) {
        satir.okunamayan.push({ anahtar: 'kontrol_edilemedi', baslik: 'Taşıma kayıtları', hata: kayitHatasi });
        if (satir.durum !== 'ESLESME_YOK') {
          satir.durum = 'ENGEL';
          satir.cipler = ['ENGEL', ...satir.cipler.filter((c) => c !== 'ENGEL' && c !== 'HAZIR')];
        }
      }

      // Portal disi AWX zamanlamalari (kaynak emekli olunca durur) - MAKUL: ad kalibi PORTAL_OCO_.
      try {
        const z = await sinirli(listTemplateSchedulesOnServer(item.awxServerId, item.awxTemplateId));
        const disari = z.filter((x) => !/^PORTAL_OCO_/.test(x.name));
        if (disari.length)
          satir.uyarilar.push(`Kaynak template'te Portal dışında kurulmuş ${disari.length} etkin AWX zamanlaması var (${disari.slice(0, 5).map((x) => x.name).join(', ')}): kaynak emekli olunca durur.`);
      } catch (err) {
        satir.uyarilar.push(`Kaynak AWX zamanlamaları okunamadı: ${mesajOf(err, sunucuAdi(item.awxServerId))}`);
      }
      satir.kayit = T.istemciKaydi(satir.kayit);

      res.json({
        ok: true,
        tasindi: false,
        satir,
        templateKarsilastirma: T.templateKarsilastir(ic.kDetail, ic.hDetail),
        surveyFarki: ic.fark ? ic.fark.satirlar : [],
        surveyOzet: ic.fark
          ? { kaynakSoru: ic.fark.kaynakSoru, hedefSoru: ic.fark.hedefSoru, parolaSoru: ic.fark.parolaSoru, kritikVar: ic.fark.kritikVar }
          : null,
        hedefSurveyHash: ic.hedefSurveyHash || null,
        uyum: ic.uyum ? { hatalar: ic.uyum.hatalar, uyarilar: ic.uyum.uyarilar } : null,
        uyumTahmin: ic.uyumTahmin ? { hatalar: ic.uyumTahmin.hatalar, uyarilar: ic.uyumTahmin.uyarilar } : null,
        hedefAyarVar: !!ic.hedefDataVarMi,
        hedefAyarFarkli: !!ic.hedefDataVarMi && T.veriHash(ic.hedefData) !== ic.kaynakHash,
        kayit: T.istemciKaydi(acik),
        kayitlar: istemciKayitlari,
        kayitHatasi,
      });
    } catch (err) {
      yanitHata(res, err);
    }
  });

  // =========================================================================
  // POST hedef (elle esleme)
  // =========================================================================
  app.post(`${BASE}/:itemId/hedef`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const item = kartGetir(req.params.itemId);
      const toS = sunucuGerekli(req.body?.to, 'Hedef');
      ciftKontrol(item.awxServerId, toS);
      const toT = toTGerekli(req.body?.toT);
      const izin = izinListesi();
      if (izin.length && !izin.includes(toT)) throw hata(400, `Hedef template #${toT} AWX_READ_ONLY_TEMPLATE_IDS listesinde yok.`, {});
      const ctx = await tekBaglam(toS.id);
      const hD = await ctx.okuyucu.detay(toS.id, toT);
      if (!hD.ok) throw hata(400, `Hedef template okunamadı: ${hD.hata}`, {});
      const kD = await ctx.okuyucu.detay(item.awxServerId, item.awxTemplateId);
      const kayit = await hazirlikGetir(item, toS.id, toT, String(hD.deger.name || ''), kD.ok ? String(kD.deger.name || '') : '', 'elle', kim(req));
      denetle(req, 'ss_migration_match', { itemId: item.id, to: { server: toS.id, template: toT } });
      res.json({ ok: true, kayit: T.istemciKaydi(kayit) });
    } catch (err) {
      yanitHata(res, err);
    }
  });

  // =========================================================================
  // POST survey-yaz (YALNIZ hedefe yazar)
  // =========================================================================
  app.post(`${BASE}/:itemId/survey-yaz`, requireAuth, requireAdmin, async (req, res) => {
    try {
      if (req.body?.onay !== true) throw hata(400, "Hedef survey'inin üzerine yazılacağı onaylanmadı.", {});
      // Beklenen hedef hash'i ZORUNLU: admin'in gordugu hedef survey'i ile yazim anindaki ayni
      // olmali (toplu yol da plan satirindaki hash'i gonderir).
      const beklenen = typeof req.body?.beklenenHedefHash === 'string' ? req.body.beklenenHedefHash : '';
      if (!beklenen) throw hata(400, "Beklenen hedef survey hash'i gönderilmedi; raporu yenileyin.", {});
      const item = kartGetir(req.params.itemId);
      const from = Number(item.awxServerId);
      const fromT = Number(item.awxTemplateId);
      const toS = sunucuGerekli(req.body?.to, 'Hedef');
      ciftKontrol(from, toS);
      const to = toS.id;
      const toT = toTGerekli(req.body?.toT);
      // Hedef baska bir servise / Playbook Kayitlari'na bagli, izin listesi disi ya da cakisiyorsa
      // canli bir template'in survey'i ezilmesin (AWX'e hicbir istek gitmeden 409).
      await hedefYazilabilirGerekli(item, to, toT);
      const ctx = await tekBaglam(to);
      const [hD, hS, kD, kSt] = await Promise.all([
        ctx.okuyucu.detay(to, toT),
        ctx.okuyucu.spec(to, toT),
        ctx.okuyucu.detay(from, fromT),
        ctx.okuyucu.specTam(from, fromT),
      ]);
      for (const [x, ad] of [[hD, 'Hedef template'], [hS, 'Hedef survey'], [kD, 'Kaynak template'], [kSt, 'Kaynak survey']]) {
        if (!x.ok) throw hata(503, `${ad} okunamadı: ${x.hata}`, {});
      }
      const kS = { ok: true, deger: kSt.deger.spec };
      const simdikiHash = T.surveyHash(hD.deger.survey_enabled, hS.deger);
      if (beklenen !== simdikiHash) throw hata(409, "Hedef survey'i siz bakarken değişti, raporu yenileyin.", {});
      const kaynakModu = T.surveyModu(kD.deger, kS.deger);
      const hedefModu = T.surveyModu(hD.deger, hS.deger);
      const karar = T.surveyKarari(kaynakModu, hedefModu, hD.deger, hS.deger, T.surveyFarki(kS.deger, hS.deger));
      if (karar.olculemedi) throw hata(503, 'Survey türü ölçülemedi.', {});
      if (!karar.eylem) throw hata(400, 'Survey farkı yok; yazılacak bir şey yok.', {});

      const kaynakAd = String(kD.deger.name || '');
      const toAd = String(hD.deger.name || '');
      const eslesme = kaynakAd.trim() && kaynakAd.trim() === toAd.trim() ? 'ad' : 'elle';
      const kayit = await hazirlikGetir(item, to, toT, toAd, kaynakAd, eslesme, kim(req));
      // Ilk yazimdan onceki hedef hali saklanir (sonraki yazimlar ezmez). Parola varsayilani
      // GET'te $encrypted$ gelir: sir icermez.
      await dbx.query(
        `UPDATE ansible_ss_migrations SET hedef_survey_onceki_json = COALESCE(hedef_survey_onceki_json, $1)
          WHERE id = $2 AND status = 'HAZIRLIK'`,
        [JSON.stringify({ survey_enabled: hD.deger.survey_enabled, spec: hS.deger }), kayit.id],
      );

      // AWX yazimi yarida kalsa da (spec POST gitti, PATCH dustu) denetim kaydi YAZILIR.
      let sonuc = null;
      let yazimHatasi = null;
      try {
        if (karar.eylem === 'yaz') {
          // Kaynak spec'in kendi adi / aciklamasi korunur (bossa template adi).
          sonuc = await writeSurveySpecOnServer(to, toT, kS.deger, {
            enable: true,
            name: kSt.deger.name || kaynakAd,
            description: kSt.deger.description || '',
          });
        } else {
          sonuc = await setSurveyEnabledOnServer(to, toT, false);
        }
      } catch (err) {
        yazimHatasi = err;
      } finally {
        const parolaSoru = T.surveyNormalize(kS.deger).filter((f) => f.parola).length;
        denetle(req, 'ss_migration_survey_write', {
          itemId: item.id,
          from: { server: from, template: fromT },
          to: { server: to, template: toT },
          eylem: karar.eylem,
          soruSayisi: T.surveyNormalize(kS.deger).length,
          parolaSoruSayisi: parolaSoru,
          parolaKorunan: (sonuc?.parolaKorunan) || [],
          parolaElle: (sonuc?.parolaElle) || [],
          sonuc: (() => { if (yazimHatasi) return 'hata'; if (sonuc?.ok) return 'ok'; return 'fark'; })(),
          ...(yazimHatasi ? { hata: mesajOf(yazimHatasi, toS.name), belirsiz: true } : {}),
        });
      }
      if (yazimHatasi) {
        // Hedef yarim yazilmis olabilir: kayitta "yazildi" isareti kalmaz, hash sifirlanir.
        try {
          await dbx.query(
            `UPDATE ansible_ss_migrations SET survey_yazildi = 0, hedef_survey_hash = NULL WHERE id = $1 AND status = 'HAZIRLIK'`,
            [kayit.id],
          );
        } catch {
          /* kayit guncellenemedi: denetim kaydi zaten yazildi */
        }
        throw Object.assign(new Error(`${mesajOf(yazimHatasi, toS.name)} Hedef survey yarım yazılmış olabilir; raporu yenileyip AWX'te kontrol edin.`), {
          status: yazimHatasi.status && yazimHatasi.status < 600 ? yazimHatasi.status : 502,
          ek: {},
        });
      }
      await dbx.query(
        `UPDATE ansible_ss_migrations SET survey_yazildi = $1, hedef_survey_hash = $2 WHERE id = $3 AND status = 'HAZIRLIK'`,
        [sonuc.ok ? 1 : 0, sonuc.hash || null, kayit.id],
      );
      const parolaSoru = T.surveyNormalize(kS.deger).filter((f) => f.parola).length;
      res.json({
        ok: !!sonuc.ok,
        eylem: karar.eylem,
        fark: sonuc.fark || null,
        hash: sonuc.hash || null,
        parolaSoru,
        parolaKorunan: sonuc.parolaKorunan || [],
        parolaElle: sonuc.parolaElle || [],
        message: sonuc.ok ? undefined : 'Yazıldı ama geri okunan survey beklenenle aynı değil.',
      });
    } catch (err) {
      yanitHata(res, err);
    }
  });

  // =========================================================================
  // POST deneme (ayari hedefe sahneler; dogrula ya da GERCEK deneme isi)
  // =========================================================================
  app.post(`${BASE}/:itemId/deneme`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const item = kartGetir(req.params.itemId);
      const from = Number(item.awxServerId);
      const fromT = Number(item.awxTemplateId);
      const toS = sunucuGerekli(req.body?.to, 'Hedef');
      ciftKontrol(from, toS);
      const to = toS.id;
      const toT = toTGerekli(req.body?.toT);
      const sadeceDogrula = req.body?.sadeceDogrula !== false;
      if (!sadeceDogrula && req.body?.confirm !== true) throw hata(400, 'confirm:true gönderilmeden gerçek tetikleme yapılmaz.', {});
      const extraVars = req.body?.extraVars && typeof req.body.extraVars === 'object' && !Array.isArray(req.body.extraVars) ? req.body.extraVars : {};

      // Sahneleme hedef ciftin ayar satirini yazar: o cift bir karta / modul kaydina bagliysa,
      // izin listesi disiysa ya da baska servisle cakisiyorsa yazilmaz (survey-yaz ile ayni kontrol).
      await hedefYazilabilirGerekli(item, to, toT);

      await reloadSsCustomCache();
      const kaynakData = readCustom(from, fromT) || {};
      const hedefData = readCustom(to, toT) || {};
      const hedefVar = Object.keys(hedefData).length > 0;
      const farkli = T.veriHash(hedefData) !== T.veriHash(kaynakData);
      if (hedefVar && farkli && req.body?.hedefAyarUzerineYaz !== true) {
        throw hata(409, 'Hedefte mevcut ayar var, üzerine yazılacak (geçmişe arşivlenir).', {
          onayGerekli: true,
          degisiklikler: T.alanFarki(hedefData, kaynakData),
        });
      }
      const ctx = await tekBaglam(to);
      const [kD, hD, hS] = await Promise.all([ctx.okuyucu.detay(from, fromT), ctx.okuyucu.detay(to, toT), ctx.okuyucu.spec(to, toT)]);
      if (!hD.ok) throw hata(503, `Hedef template okunamadı: ${hD.hata}`, {});
      if (!hS.ok) throw hata(503, `Hedef survey okunamadı: ${hS.hata}`, {});
      const kaynakAd = kD.ok ? String(kD.deger.name || '') : '';
      const toAd = String(hD.deger.name || '');
      const eslesme = kaynakAd.trim() && kaynakAd.trim() === toAd.trim() ? 'ad' : 'elle';
      const kayit = await hazirlikGetir(item, to, toT, toAd, kaynakAd, eslesme, kim(req));
      if (farkli) await writeCustom(to, toT, kaynakData, { by: kim(req), reason: `migrate:stage:${from}_${fromT}` });

      const server = getServerById(to);
      if (sadeceDogrula) {
        let yanit;
        try {
          const plan = await resolveSsLaunchPlan(server, toT, { submittedExtraVars: extraVars, templateName: item.title, req });
          yanit = { ok: true, valid: true, resolvedExtraVars: plan.extraVars, resolvedLaunchOptions: plan.resolvedLaunchOptions };
        } catch (err) {
          yanit = { ok: true, valid: false, message: err.field ? err.message : mesajOf(err, toS.name), field: err.field };
        }
        denetle(req, 'ss_migration_test', { itemId: item.id, to: { server: to, template: toT }, sadeceDogrula: true, valid: !!yanit.valid });
        return res.json({ ...yanit, kayitId: kayit.id, sahnelendi: farkli });
      }

      // Smart onayi gerekiyorsa ve admin "Smart atla" tercihi kapaliysa deneme GERCEK bir Smart
      // talebi acardi; onaydan sonra poller'in actigi is deneme kaydina baglanmaz (gecerli deneme
      // sayilmaz). Talep acilmadan reddedilir. Plan cozulemezse kontrol ssTestKosusuBaslat'a kalir
      // (ayni cozumleme orada da duser, bilet acilmaz).
      let smartPlan = null;
      try {
        smartPlan = await resolveSsLaunchPlan(server, toT, { submittedExtraVars: extraVars, templateName: item.title, req });
      } catch {
        smartPlan = null;
      }
      if (smartPlan && smartGerekliMi(smartPlan.overrides?.smartApproval, smartPlan.gateVars)) {
        if (!(await adminSmartAtliyor(req)))
          throw hata(
            409,
            "Bu servis Smart onayı istiyor. Deneme gerçek bir Smart talebi açardı ve onaydan sonraki iş deneme sayılmazdı. Admin 'Smart onayını atla' tercihini açıp tekrar deneyin ya da gerekçe yazarak denemesiz taşıyın.",
            { smartGerekli: true },
          );
      }

      const { status, body } = await ssTestKosusuBaslat(req, server, toT, {
        extraVars,
        templateName: item.title,
        scenarioName: `tasima-deneme:${item.id}`,
      });
      if (body?.jobId) {
        await dbx.query(
          `UPDATE ansible_ss_migrations
              SET deneme_job_id = $1, deneme_at = SYSUTCDATETIME(), deneme_kaynak_hash = $2, deneme_hedef_survey_hash = $3
            WHERE id = $4 AND status = 'HAZIRLIK'`,
          [Number(body.jobId), T.veriHash(kaynakData), T.surveyHash(hD.deger.survey_enabled, hS.deger), kayit.id],
        );
      }
      denetle(req, 'ss_migration_test', {
        itemId: item.id,
        to: { server: to, template: toT },
        sadeceDogrula: false,
        jobId: body?.jobId ? Number(body.jobId) : null,
        smartTicketId: body?.ticketId ? body.ticketId : null,
      });
      res.status(status).json({ ...body, kayitId: kayit.id });
    } catch (err) {
      yanitHata(res, err);
    }
  });

  // =========================================================================
  // POST tasi (tek transaction)
  // =========================================================================
  app.post(`${BASE}/:itemId/tasi`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const item = kartGetir(req.params.itemId);
      const from = Number(item.awxServerId);
      const fromT = Number(item.awxTemplateId);
      const toS = sunucuGerekli(req.body?.to, 'Hedef');
      ciftKontrol(from, toS);
      const to = toS.id;
      const toT = toTGerekli(req.body?.toT);
      const gerekceHam = req.body?.denemesizGerekce;
      const gerekce = gerekceHam === undefined || gerekceHam === null ? '' : String(gerekceHam).trim();
      if (gerekceHam !== undefined && gerekceHam !== null && gerekce.length < GEREKCE_EN_AZ)
        throw hata(400, `Deneme koşusu olmadan taşımak için en az ${GEREKCE_EN_AZ} karakter gerekçe yazın.`, {});
      if (gerekce.length > 500) throw hata(400, 'Gerekçe en fazla 500 karakter olabilir.', {});

      const acik = await acikKayit(item.id);
      if (acik?.status === 'TASINDI') throw hata(409, 'Servis zaten taşınmış.', {});
      await reloadSsCustomCache();
      const ctx = await tekBaglam(to);
      ctx.kayitlar = new Map(acik ? [[String(item.id), acik]] : []);
      const hedef = await tekHedef(ctx, item, toT);
      const { satir, ic } = await analiz(ctx, item, hedef);
      if (!req.body?.planHash || req.body.planHash !== satir.planHash)
        throw hata(409, 'Durum siz bakarken değişti, raporu yenileyin.', {});
      if (satir.durum !== 'HAZIR')
        throw hata(409, `Servis taşımaya hazır değil (${satir.durum}).`, { durum: satir.durum, nedenler: satir.nedenler, engeller: satir.engeller, okunamayan: satir.okunamayan });
      const denemeGecerli = !!(satir.deneme?.gecerli);
      if (!denemeGecerli && !gerekce)
        throw hata(409, 'Geçerli bir deneme koşusu yok. Önce hedefte deneme koşturun ya da gerekçe yazarak denemesiz taşıyın.', {
          deneme: satir.deneme,
        });

      const kaynakData = ic.kaynakData || {};
      // Kaynak ayar satiri onbellekten DEGIL, DB'deki ham metniyle kopyalanir; analizdeki
      // (onbellek) veriyle ayni degilse 409. Transaction ayni metni kilitleyip yeniden karsilastirir.
      const { rows: hamSatir } = await dbx.query(
        `SELECT data FROM ansible_ss_customizations WHERE awx_server_id = $1 AND template_id = $2`,
        [from, fromT],
      );
      const kaynakVar = !!(hamSatir?.[0]);
      const kaynakHam = (() => { if (kaynakVar) return String(hamSatir[0].data == null ? '' : hamSatir[0].data); return null; })();
      let kaynakDb = {};
      if (kaynakVar) {
        try {
          kaynakDb = JSON.parse(kaynakHam || '{}') || {};
        } catch {
          throw hata(409, 'Kaynak ayar satırı okunamadı (bozuk JSON); taşınmadı.', {});
        }
      }
      if (T.veriHash(kaynakDb) !== T.veriHash(kaynakData)) throw hata(409, 'Kaynak ayarları siz bakarken değişti; raporu yenileyin.', {});
      const temizKart = kartOzeti(item);
      const onceki = { item: temizKart, hedefCustom: ic.hedefDataVarMi ? ic.hedefData : null };
      const uygulanan = {
        item: { ...temizKart, awxServerId: to, awxTemplateId: toT },
        kaynakCustom: kaynakData,
        kaynakCustomHash: T.veriHash(kaynakData),
        // Hedef ayar HER ZAMAN kaynagin kopyasi (kaynakta yoksa hedef satir silinir).
        hedefCustomHash: T.veriHash(kaynakData),
        denemeJobId: (satir.deneme?.jobId ?? null),
      };
      const by = kim(req);
      let kayitId = null;
      try {
        const r = await dbx.query(
          T.TASIMA_SQL,
          [
            from,
            fromT,
            to,
            toT,
            String(item.id),
            kaynakVar ? 1 : 0,
            kaynakVar ? kaynakHam : null,
            by,
            `migrate:before:${from}_${fromT}`,
            JSON.stringify(onceki),
            JSON.stringify(uygulanan),
            denemeGecerli ? null : gerekce,
            satir.kaynakTemplate.name || null,
            (satir.hedefTemplate?.name) || null,
            hedef.eslesme === 'ad' ? 'ad' : 'elle',
          ],
          { tekrar: false },
        );
        kayitId = r?.rows?.[0] ? Number(r.rows[0].id) : null;
      } catch (err) {
        const m = T.tasimaHatasi(err);
        if (m) throw hata(m.status, m.message, {});
        throw err;
      }

      // Commit sonrasi: onbellekler. Atlanirsa hedefteki isler Smart / OCO kapisi OLMADAN kosar.
      // Hedef onbellek kaynagin kopyasi olur; kaynakta satir yoksa hedef girdisi SILINIR (null).
      const sonrasi = [];
      setCustomCache(to, toT, kaynakVar ? kaynakDb : null);
      invalidate();
      try {
        await reloadSsItemsCache();
      } catch (err) {
        ssItemsKirliIsaretle();
        sonrasi.push(`Kart önbelleği tazelenemedi (${err.message}); servis listesi yazımı tazelenene kadar kilitlendi. Portal'ı yeniden başlatın.`);
      }
      // Yaris: commit ile onbellek tazelenmesi arasinda kaynaga yeni bilet acilmis olabilir.
      let yarisUyarisi = null;
      const yaris = await T.engelleriSay(dbx, from, fromT);
      if (yaris.engeller.length)
        yarisUyarisi = `Taşındı, ancak taşıma anında kaynakta ${yaris.engeller.map((e) => (String(e.adet) + " × " + e.baslik)).join(', ')} açıldı; bunlar kaynakta sonuçlanır.`;
      denetle(req, 'ss_migration_apply', {
        itemId: item.id,
        title: item.title,
        from: { server: from, template: fromT },
        to: { server: to, template: toT },
        eslesme: hedef.eslesme,
        denemeJobId: uygulanan.denemeJobId,
        denemesiz: !denemeGecerli,
        surveyYazildi: !!(acik?.surveyYazildi),
        yarisUyarisi: !!yarisUyarisi,
      });
      res.json({ ok: true, kayitId, yarisUyarisi, uyarilar: sonrasi });
    } catch (err) {
      yanitHata(res, err);
    }
  });

  // =========================================================================
  // Geri alma
  // =========================================================================
  async function geriAlOnizleme(itemId) {
    const item = kartGetir(itemId);
    const kayit = await acikKayit(item.id);
    if (!kayit || kayit.status !== 'TASINDI') throw hata(409, 'Bu servis için açık bir taşıma yok.', {});
    const bagUygun = Number(item.awxServerId) === kayit.toServer && Number(item.awxTemplateId) === kayit.toTemplate;
    const uyg = kayit.uygulanan || {};
    const bilgiDegisiklikleri = T.alanFarki(
      Object.fromEntries(KART_ALANLARI.map((k) => [k, uyg.item?.[k]])),
      Object.fromEntries(KART_ALANLARI.map((k) => [k, item[k]])),
    );
    await reloadSsCustomCache();
    const hedefSimdi = readCustom(kayit.toServer, kayit.toTemplate) || {};
    const kaynakSimdi = readCustom(kayit.fromServer, kayit.fromTemplate) || {};
    const onayGerekenDegisiklikler = [];
    if (!uyg.hedefCustomHash || T.veriHash(hedefSimdi) !== uyg.hedefCustomHash)
      onayGerekenDegisiklikler.push({ tur: 'hedef_ayar', baslik: 'Hedef ayarlar taşımadan sonra değişti', farklar: T.alanFarki(uyg.kaynakCustom || {}, hedefSimdi) });
    if (!uyg.kaynakCustomHash || T.veriHash(kaynakSimdi) !== uyg.kaynakCustomHash)
      onayGerekenDegisiklikler.push({ tur: 'kaynak_ayar', baslik: 'Kaynak ayarlar taşımadan sonra değişti', farklar: T.alanFarki(uyg.kaynakCustom || {}, kaynakSimdi) });
    const say = await T.engelleriSay(dbx, kayit.toServer, kayit.toTemplate);
    // Kaynak sunucu Portal'da yoksa / kapaliysa ya da template orada okunamiyorsa geri alma karti
    // olu bir baga cevirir (maestro2 emekli olduktan sonra servis sessizce kullanilamaz olur).
    const kaynakS = getServerById(kayit.fromServer);
    if (!kaynakS) {
      say.engeller.push({
        anahtar: 'kaynak_sunucu_yok',
        baslik: `Kaynak sunucu #${kayit.fromServer} Portal'da yok ya da devre dışı`,
        adet: 1,
        ipucu: 'Kart çalışmayan bir sunucuya bağlanırdı; geri alma yapılamaz.',
      });
    } else {
      const kD = await guvenliOku(() => getTemplateDetailOnServer(kayit.fromServer, kayit.fromTemplate), undefined, kaynakS.name);
      if (!kD.ok) say.okunamayan.push({ anahtar: 'kaynak_template', baslik: `Kaynak template #${kayit.fromTemplate} okunamadı`, hata: kD.hata });
    }
    const uyarilar = [];
    try {
      const { rows } = await dbx.query(T.SUREN_IS_SQL, [kayit.toServer, kayit.toTemplate]);
      const n = Number(rows?.[0]?.n) || 0;
      if (n > 0) uyarilar.push(`Hedefte süren ${n} iş var: hedefte bitecek, çıktısı hedeften okunur.`);
    } catch (err) {
      uyarilar.push(`Hedefte süren işler okunamadı: ${String(err.message || err)}`);
    }
    if (kayit.surveyYazildi) uyarilar.push("Hedef survey'i yazılmıştı; geri alma onu değiştirmez (önceki hâli taşıma kaydında saklı).");
    return {
      item,
      kayit,
      bagUygun,
      bilgiDegisiklikleri,
      onayGerekenDegisiklikler,
      engeller: say.engeller,
      okunamayan: say.okunamayan,
      uyarilar,
    };
  }

  function onizlemeYaniti(o) {
    const kS = getServerById(o.kayit.fromServer);
    return {
      kayit: T.istemciKaydi(o.kayit),
      kaynakSunucuAdi: (kS?.name ?? null),
      bagUygun: o.bagUygun,
      bilgiDegisiklikleri: o.bilgiDegisiklikleri,
      onayGerekenDegisiklikler: o.onayGerekenDegisiklikler,
      engeller: o.engeller,
      okunamayan: o.okunamayan,
      uyarilar: o.uyarilar,
    };
  }

  app.get(`${BASE}/:itemId/geri-al-onizleme`, requireAuth, requireAdmin, async (req, res) => {
    try {
      res.json({ ok: true, ...onizlemeYaniti(await geriAlOnizleme(req.params.itemId)) });
    } catch (err) {
      yanitHata(res, err);
    }
  });

  app.post(`${BASE}/:itemId/geri-al`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const o = await geriAlOnizleme(req.params.itemId);
      if (Number(req.body?.migrationId) !== o.kayit.id) throw hata(409, 'Taşıma kaydı siz bakarken değişti; raporu yenileyin.', {});
      if (!o.bagUygun) {
        // Kart elle / bayat liste yazimiyla baska bir baga donmus: kart DEGISTIRILMEZ, yalniz
        // tutarsiz TASINDI kaydi KAPANDI yapilir (servis yeniden hazirlanip tasinabilsin).
        if (req.body?.kaydiKapat !== true)
          throw hata(409, 'Kart taşıma sonrası başka bir template\'e bağlanmış; otomatik geri alma güvenli değil. Kartı değiştirmeden yalnız kaydı kapatabilirsiniz.', {
            bagUygun: false,
          });
        const r = await dbx.query(
          `UPDATE ansible_ss_migrations
              SET status = 'KAPANDI', geri_alan = $1, geri_alindi_at = SYSUTCDATETIME(), geri_alma_notu = $2
            WHERE id = $3 AND item_id = $4 AND status = 'TASINDI'`,
          [kim(req), JSON.stringify({ kaydiKapat: true, kart: { server: Number(o.item.awxServerId), template: Number(o.item.awxTemplateId) } }), o.kayit.id, String(o.item.id)],
        );
        if (!r || r.rowCount !== 1) throw hata(409, 'Taşıma kaydı siz bakarken değişti; raporu yenileyin.', {});
        denetle(req, 'ss_migration_record_close', {
          itemId: o.item.id,
          migrationId: o.kayit.id,
          kart: { server: Number(o.item.awxServerId), template: Number(o.item.awxTemplateId) },
          kayitHedef: { server: o.kayit.toServer, template: o.kayit.toTemplate },
        });
        return res.json({ ok: true, kaydiKapatti: true, uyarilar: [] });
      }
      if (o.engeller.length || o.okunamayan.length)
        throw hata(409, 'Geri almadan önce çözülmesi gerekenler var (ya da kontrol edilemedi).', {
          engeller: o.engeller,
          okunamayan: o.okunamayan,
        });
      if (o.onayGerekenDegisiklikler.length && req.body?.degisiklikleriOnayla !== true)
        throw hata(409, 'Taşımadan sonra ayarlar değişti; değişiklikleri görüp onaylayın.', {
          onayGerekli: true,
          degisiklikler: o.onayGerekenDegisiklikler,
        });
      const not = JSON.stringify({
        bilgi: o.bilgiDegisiklikleri.map((d) => d.alan),
        onaylanan: o.onayGerekenDegisiklikler.map((d) => ({ tur: d.tur, alanlar: d.farklar.map((f) => f.alan) })),
      });
      try {
        await dbx.query(
          T.GERI_AL_SQL,
          [o.kayit.toServer, o.kayit.toTemplate, o.kayit.fromServer, o.kayit.fromTemplate, String(o.item.id), o.kayit.id, kim(req), not],
          { tekrar: false },
        );
      } catch (err) {
        const m = T.tasimaHatasi(err);
        if (m) throw hata(m.status, m.message, {});
        throw err;
      }
      invalidate();
      const uyarilar = [];
      try {
        await reloadSsItemsCache();
      } catch (err) {
        ssItemsKirliIsaretle();
        uyarilar.push(`Kart önbelleği tazelenemedi (${err.message}); servis listesi yazımı tazelenene kadar kilitlendi. Portal'ı yeniden başlatın.`);
      }
      denetle(req, 'ss_migration_rollback', {
        itemId: o.item.id,
        migrationId: o.kayit.id,
        from: { server: o.kayit.fromServer, template: o.kayit.fromTemplate },
        to: { server: o.kayit.toServer, template: o.kayit.toTemplate },
        onayliDegisiklikSayisi: o.onayGerekenDegisiklikler.length,
      });
      res.json({ ok: true, uyarilar });
    } catch (err) {
      yanitHata(res, err);
    }
  });

  // =========================================================================
  // POST hazirlik-iptal (sahnelenen hedef ayar satiri BIRAKILIR)
  // =========================================================================
  app.post(`${BASE}/:itemId/hazirlik-iptal`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const item = kartGetir(req.params.itemId);
      const r = await dbx.query(
        `UPDATE ansible_ss_migrations SET status = 'IPTAL' WHERE item_id = $1 AND status = 'HAZIRLIK'`,
        [String(item.id)],
      );
      denetle(req, 'ss_migration_prep_cancel', { itemId: item.id, adet: r?.rowCount });
      res.json({ ok: true, adet: (r?.rowCount) || 0 });
    } catch (err) {
      yanitHata(res, err);
    }
  });
}

module.exports = { kaydet, _kartOzeti: kartOzeti };
