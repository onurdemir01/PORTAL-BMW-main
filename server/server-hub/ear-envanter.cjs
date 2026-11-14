// server/server-hub/ear-envanter.cjs - Server Hub > Uygulama Envanteri uclari (2026-11-04).
//
// Kullanici: "/vhosting ve /vhosting8 altindaki EAR/WAR uygulamalarini ansible joblarla tarayip db'ye
// yazarak ... server hub altinda bir ek sayfa". Tarama: bmw_portal/ear_envanter/ear_envanter.yml
// (SALT OKUNUR). Yurutucu: ear-envanter-poller.cjs; alim: ear-envanter-alim.cjs.
//
// Server Hub router'ina (yalniz Admin + ServerHub gorunurluk kapisi) index.cjs'ten TEK satirla baglanir;
// kapilar zaten oradadir. Hata kodlari proxy'den gecenler: 400 / 409 / 422 / 424 (nginx 403/404/5xx
// govdesini HTML yapar).
//
// GET  /ear/ozet                       son kosu, calisan kosu ve partileri, zamanlayici, ayarlar, sayilar
// GET  /ear/kosular                    son kosular
// GET  /ear/kosu/:id                   kosu + partiler + hostlar
// POST /ear/kosu                       { kip, kapsam: FILO | SECILI | ORTAM | SORUNLU | WEB | FILO_WEB, hostlar, ortamlar }
// GET  /ear/ortamlar                   filodaki ortamlar + sunucu sayisi (acilir liste)
// GET  /ear/kapsam-onizleme            ?kapsam&ortamlar&kip  -> { sunucu, parti, ornek } (kosu acmaz)
// PUT  /ear/plan/:plan                 p1 | p2: { acik, birim, aralik, gun, sira, saat, kip, kapsam, baslangic }
// POST /ear/kosu/:id/iptal
// GET  /ear/uygulamalar                ?q&f&s&kosu&limit&offset (+ eski: ortam jboss durum servlet)
// GET  /ear/warlar                     ?q&f&s&kosu&limit&offset
// GET  /ear/degerler/:gorunum/:kolon   ?ara&q&f&kosu  (acilir liste: ilk 200 deger + sayi + farkli)
// GET  /ear/uygulama/:kosu/:host/:uyg  WAR'lar, kutuphaneler, ayni adli kopyalar
// GET  /ear/agac/:kosu/:host/:uyg      ?bicim=json|txt  (ham dosyadan; yalniz TAM ve saklama suresinde)
// GET  /ear/eslenikler                 ?tur&q&ortam&karar&kutuphane&yapi&jboss&tarihFarki&limit&offset
// GET  /ear/eslenik                    ?tur&ad&ortam&jboss&host&limit&offset  (kutuphane farki)
// GET  /ear/yapi-farki                 ?a=kosu:host:uyg&b=kosu:host:uyg  (iki TAM kopyanin dosya farki)
// GET  /ear/kutuphaneler               ?q&f&s&limit&offset
// GET  /ear/kutuphane                  ?ad&surum&limit&offset (kullanan uygulamalar)
// GET  /ear/hostlar
// GET  /ear/disa-aktar/:gorunum.csv    uygulamalar | warlar | kutuphaneler (?q&f&s; AKIS) | sunucular |
//                                      eslenikler (?tur ve eslenik suzgecleri)
// Liste uclari TOPLAM sayiyi da dondurur; hicbir liste sessizce kesilmez (2026-11-05).
// GET  /ear/disa-aktar-zip             ?kosu  (filo) | ?host&kosu (tek sunucu: tree.txt + inventory.json)
// PUT  /ear/ayar/:anahtar              { deger }
'use strict';

const alim = require('./ear-envanter-alim.cjs');
const ayar = require('./ear-envanter-ayar.cjs');
const poller = require('./ear-envanter-poller.cjs');
const sorgu = require('./ear-envanter-sorgu.cjs');
const rapor = require('./ear-envanter-rapor.cjs');
const eslenikMotoru = require('./ear-envanter-eslenik.cjs');

const GORUNUMLER = new Set(['uygulamalar', 'warlar', 'kutuphaneler', 'sunucular', 'eslenikler']);
const AKAN = new Set(['uygulamalar', 'warlar', 'kutuphaneler']);
const ESLENIK_TURLERI = new Set(['ORTAM_ICI', 'ORTAMLAR_ARASI', 'NESIL', 'ORTAM_YOK']);
const AGIR_SINIR = 2;
const SECILI_SINIR = 1000;
let _agir = 0;

function hata(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

/** Proxy'den gecmeyen kodlar (403/404/501/502/503/504) gecenlere cevrilir. */
function durumKodu(s) {
  const n = Number(s);
  if ([400, 409, 422, 424].includes(n)) return n;
  if (n === 404 || n === 403 || n === 501) return 409;
  if ([502, 503, 504].includes(n)) return 424;
  return 500;
}

function hataYaniti(res, e) {
  const status = durumKodu(e && e.status);
  const message =
    status === 500
      ? 'Uygulama Envanteri isteği işlenemedi.'
      : String((e && e.message) || 'hata').slice(0, 600);
  if (status === 500) console.warn('[EarEnvanter] istek hatasi:', e && e.message);
  res.status(status).json({ ok: false, message, code: (e && e.code) || null });
}

const tam = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};
const kullanici = (req) => (req.session && req.session.user) || {};

function hostParam(v) {
  const h = String(v || '')
    .trim()
    .toUpperCase();
  if (!alim.HOST_RE.test(h)) throw hata(400, 'Geçersiz sunucu adı.', 'gecersiz_host');
  return h;
}

/** Istek kapsami -> FILO | SECILI | SORUNLU | WEB | FILO_WEB | ORTAM:A,B (ortamlar dizi ya da virgullu metin). */
function kapsamParam(kapsam, ortamlarHam) {
  const k = String(kapsam || '').toUpperCase();
  if (k === 'FILO' || k === 'SECILI' || k === 'SORUNLU' || k === 'WEB' || k === 'FILO_WEB') return k;
  if (k === 'ORTAM') {
    const l = Array.isArray(ortamlarHam) ? ortamlarHam : String(ortamlarHam || '').split(',');
    const d = ayar.kapsamDogrula(`ORTAM:${l.map((x) => String(x || '')).join(',')}`);
    if (!d) throw hata(400, 'Ortam listesi geçersiz (1-20 ortam).', 'gecersiz_kapsam');
    return d;
  }
  throw hata(400, 'Kapsam FILO, SECILI, ORTAM, SORUNLU, WEB ya da FILO_WEB olmalı.', 'gecersiz_kapsam');
}

/** Elle liste: metin (satir / bosluk / virgul ayracli) ya da dizi. */
function hostListesi(v) {
  const ham = Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/);
  const liste = [
    ...new Set(
      ham
        .map((x) =>
          String(x || '')
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  ];
  if (liste.length > SECILI_SINIR)
    throw hata(400, `Elle seçimde en çok ${SECILI_SINIR} sunucu.`, 'cok_host');
  const kotu = liste.filter((h) => !alim.HOST_RE.test(h));
  if (kotu.length)
    throw hata(400, `Geçersiz sunucu adı: ${kotu.slice(0, 5).join(', ')}`, 'gecersiz_host');
  return liste.map((host) => ({ host }));
}

async function agirIs(fn) {
  if (_agir >= AGIR_SINIR)
    throw hata(
      409,
      'Aynı anda en çok iki ağaç / ZIP hazırlanır; birazdan yeniden deneyin.',
      'mesgul',
    );
  _agir += 1;
  try {
    return await fn();
  } finally {
    _agir -= 1;
  }
}

/** Kosunun ham dosyasindan tek hostun yukunu okur. */
async function hostYuku(kosuId, host) {
  const k = await poller.kosuOku(kosuId);
  if (!k) throw hata(409, 'Koşu bulunamadı.', 'kosu_yok');
  let dizin = alim.earDizin();
  try {
    dizin = JSON.parse(k.parametreler || '{}').dizin || dizin;
  } catch {
    /* parametre okunamazsa guncel dizin */
  }
  let buf;
  try {
    buf = await alim.hamOku(alim.hamDosyaYolu(dizin, alim.kosuAltDizini(k), host));
  } catch (e) {
    if (e.kod === 'DOSYA_YOK')
      throw hata(
        409,
        `Ham dosya yok: koşu ${kosuId} saklama süresini geçmiş ya da bu sunucudan sonuç gelmemiş.`,
        'ham_yok',
      );
    throw hata(424, e.message, 'ham_okunamadi');
  }
  try {
    return { kosu: k, yuk: alim.paketCoz(buf) };
  } catch (e) {
    throw hata(422, `Ham dosya çözülemedi: ${e.message}`, 'ham_bozuk');
  }
}

/** "kosu:host:uyg" -> { kosu, host, uyg } */
function kopyaParam(v) {
  const m = /^(\d{1,9}):([^:]{1,64}):(\d{1,6})$/.exec(String(v || ''));
  if (!m) throw hata(400, 'Kopya "koşu:sunucu:uygulama" biçiminde olmalı.', 'gecersiz_param');
  return { kosu: Number(m[1]), host: hostParam(m[2]), uyg: Number(m[3]) };
}

const eslenikTuru = (v) => {
  const t = String(v || '').toUpperCase();
  return ESLENIK_TURLERI.has(t) ? t : null;
};

/** Istek -> eslenik listesi suzgeci (degerler kirpilir; bilinmeyen tur eski cagri sayilir). */
function eslenikSuzgeci(q) {
  const M = (v, n) => String(v == null ? '' : v).slice(0, n);
  return {
    kosu: q.kosu,
    tur: eslenikTuru(q.tur),
    tumu: q.tumu === '1',
    q: M(q.q, 100),
    ortam: M(q.ortam, 2000),
    karar: M(q.karar, 300),
    kutuphane: M(q.kutuphane, 300),
    yapi: M(q.yapi, 300),
    jboss: M(q.jboss, 2),
    tarihFarki: q.tarihFarki,
    tarihFarkiMax: q.tarihFarkiMax,
    limit: q.limit,
    offset: q.offset,
  };
}

const eskiParametreler = (q) => ({ ortam: q.ortam, jboss: q.jboss, durum: q.durum, servlet: q.servlet });

/** WAR satiri istemciye kutuphane set izi olmadan gider (ic anahtar). */
function setsiz(r) {
  const x = { ...r };
  delete x.kutuphane_seti;
  return x;
}

function indir(res, ad, tur, govde) {
  res.setHeader('Content-Type', tur);
  res.setHeader('Content-Disposition', `attachment; filename="${ad}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(govde);
}

const damga = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

async function templateDurumu() {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(poller.REGISTRY_KEY).catch(() => null);
  return {
    anahtar: poller.REGISTRY_KEY,
    tanimli: !!(row && row.enabled !== false && reg.getEffectiveTemplateId(row)),
  };
}

function mount(router, { launch, audit } = {}) {
  poller.kur({ launch });
  const denetim = (req, detail) => {
    try {
      if (audit) audit(req, { action: 'ear_envanter', ...detail });
    } catch {
      /* best-effort */
    }
  };

  router.get('/ear/ozet', async (req, res) => {
    try {
      const [a, template, kosular, sayilar] = await Promise.all([
        ayar.oku(),
        templateDurumu(),
        sorgu.kosular(10),
        sorgu.sayilar().catch(() => null),
      ]);
      const aktif = kosular.find((k) => k.durum === 'CALISIYOR') || null;
      const planlar = ayar.planOzeti(a.deger);
      const sonraki = planlar
        .filter((p) => p.acik && p.sonraki.length)
        .map((p) => p.sonraki[0])
        .sort()[0];
      const aktifDetay = aktif ? await sorgu.kosuDetay(aktif.id, { hostlarla: false }) : null;
      res.json({
        ok: true,
        ayarlar: {
          deger: a.deger,
          kayitlar: a.kayitlar,
          okunamadi: a.okunamadi,
          hata: a.hata || '',
          tanimlar: Object.entries(ayar.AYARLAR).map(([anahtar, t]) => ({
            anahtar,
            ad: t.ad,
            varsayilan: t.varsayilan,
          })),
        },
        // Eski ozet alani: planlardan biri aciksa acik; en yakin calisma.
        zamanlayici: {
          acik: planlar.some((p) => p.acik),
          metin: planlar.filter((p) => p.acik).map((p) => `${p.ad}: ${p.metin}`).join(' | ') || 'planlar kapalı',
          sonraki: sonraki || null,
        },
        planlar,
        template,
        dizin: alim.earDizin(),
        aktif: aktifDetay
          ? { ...aktifDetay.kosu, alinan: aktif.alinan, partiler: aktifDetay.partiler }
          : null,
        son: kosular.find((k) => k.durum !== 'CALISIYOR') || null,
        sayilar,
      });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/kosular', async (req, res) => {
    try {
      res.json({ ok: true, kosular: await sorgu.kosular(req.query.limit) });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/kosu/:id', async (req, res) => {
    try {
      const id = tam(req.params.id);
      if (!id) throw hata(400, 'Geçersiz koşu numarası.', 'gecersiz_kosu');
      const d = await sorgu.kosuDetay(id);
      if (!d) throw hata(409, 'Koşu bulunamadı.', 'kosu_yok');
      res.json({ ok: true, ...d });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.post('/ear/kosu', async (req, res) => {
    try {
      const b = req.body || {};
      const kip = String(b.kip || '').toUpperCase();
      // Kapsam ACIK yazilir: bos liste asla "filo" anlamina gelmez (yanlislikla 1000+ sunucu taranmasin).
      const kapsam = kapsamParam(b.kapsam, b.ortamlar);
      const secili = kapsam === 'SECILI' ? hostListesi(b.hostlar) : null;
      if (secili && !secili.length) throw hata(400, 'Sunucu listesi boş.', 'hedef_yok');
      const u = kullanici(req);
      const k = await poller.kosuOlustur({
        kip,
        hedefler: secili,
        kapsam: secili ? null : kapsam,
        kaynak: 'ELLE',
        baslatan: u.username,
        req,
      });
      denetim(req, {
        islem: 'kosu',
        kosu: k.id,
        kip,
        kapsam,
        hostSayisi: k.beklenen,
      });
      res.json({ ok: true, ...k });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/ortamlar', async (req, res) => {
    try {
      res.json({ ok: true, ortamlar: await poller.ortamlar() });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/kapsam-onizleme', async (req, res) => {
    try {
      const kapsam = kapsamParam(req.query.kapsam, req.query.ortamlar);
      if (kapsam === 'SECILI') throw hata(400, 'Seçili liste için önizleme gerekmez.', 'gecersiz_kapsam');
      const kip = String(req.query.kip || 'OZET').toUpperCase() === 'TAM' ? 'TAM' : 'OZET';
      res.json({ ok: true, kapsam, ...(await poller.kapsamOnizleme(kapsam, kip)) });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.put('/ear/plan/:plan', async (req, res) => {
    try {
      const r = await ayar.planYaz(req.params.plan, req.body || {}, kullanici(req).username);
      denetim(req, { islem: 'plan', ...r });
      const a = await ayar.oku();
      res.json({ ok: true, ...r, planlar: ayar.planOzeti(a.deger) });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.post('/ear/kosu/:id/iptal', async (req, res) => {
    try {
      const id = tam(req.params.id);
      if (!id) throw hata(400, 'Geçersiz koşu numarası.', 'gecersiz_kosu');
      const r = await poller.kosuIptal(id, kullanici(req).username);
      denetim(req, { islem: 'iptal', kosu: id, awxIptal: r.awxIptal });
      res.json({ ok: true, ...r });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/uygulamalar', async (req, res) => {
    try {
      const q = req.query;
      const r = await sorgu.uygulamalar({
        kosu: q.kosu,
        q: q.q,
        ortam: q.ortam,
        jboss: q.jboss,
        durum: q.durum,
        servlet: q.servlet,
        f: q.f,
        s: q.s,
        limit: q.limit || 100,
        offset: q.offset,
      });
      res.json({ ok: true, ...r });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/warlar', async (req, res) => {
    try {
      const q = req.query;
      const r = await sorgu.warlar({
        kosu: q.kosu,
        q: q.q,
        f: q.f,
        s: q.s,
        limit: q.limit || 100,
        offset: q.offset,
      });
      res.json({ ok: true, satirlar: r.satirlar.map(setsiz), toplam: r.toplam });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/degerler/:gorunum/:kolon', async (req, res) => {
    try {
      const r = await sorgu.degerler({
        gorunum: String(req.params.gorunum || ''),
        kolon: String(req.params.kolon || ''),
        kosu: req.query.kosu,
        q: req.query.q,
        f: req.query.f,
        ara: req.query.ara,
      });
      res.json({ ok: true, ...r });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/uygulama/:kosu/:host/:uyg', async (req, res) => {
    try {
      const kosu = tam(req.params.kosu);
      const uygNo = tam(req.params.uyg);
      if (!kosu || uygNo == null)
        throw hata(400, 'Geçersiz koşu / uygulama numarası.', 'gecersiz_param');
      const d = await sorgu.uygulamaDetay({ kosu, host: hostParam(req.params.host), uygNo });
      if (!d) throw hata(409, 'Uygulama bulunamadı.', 'uygulama_yok');
      res.json({ ok: true, ...d });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/agac/:kosu/:host/:uyg', async (req, res) => {
    try {
      const kosu = tam(req.params.kosu);
      const uygNo = tam(req.params.uyg);
      const host = hostParam(req.params.host);
      if (!kosu || uygNo == null)
        throw hata(400, 'Geçersiz koşu / uygulama numarası.', 'gecersiz_param');
      const sonuc = await agirIs(async () => {
        const { yuk } = await hostYuku(kosu, host);
        const u = (yuk.uygulamalar || [])[uygNo];
        if (!u) throw hata(409, 'Uygulama ham dosyada yok.', 'uygulama_yok');
        return { u, taranmaUtc: yuk.baslangic_utc || null };
      });
      const { u, taranmaUtc } = sonuc;
      if (req.query.bicim === 'txt') {
        return indir(
          res,
          `${rapor.guvenliParca(host)}_${rapor.guvenliParca(u.ad)}_tree.txt`,
          'text/plain; charset=utf-8',
          rapor.agacMetni({ host, kosu, uygulama: u, taranmaUtc }),
        );
      }
      if (req.query.bicim === 'inventory') {
        return indir(
          res,
          `${rapor.guvenliParca(host)}_${rapor.guvenliParca(u.ad)}_inventory.json`,
          'application/json; charset=utf-8',
          rapor.inventoryJson({ host, kosu, taranmaUtc, uygulama: u }),
        );
      }
      const { satirlar, ...ozet } = u;
      res.json({
        ok: true,
        host,
        kosu,
        taranmaUtc,
        uygulama: ozet,
        satirlar: Array.isArray(satirlar) ? satirlar : [],
      });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/eslenikler', async (req, res) => {
    try {
      res.json({ ok: true, ...(await sorgu.eslenikler(eslenikSuzgeci(req.query))) });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/eslenik', async (req, res) => {
    try {
      const ad = String(req.query.ad || '').slice(0, 256);
      if (!ad) throw hata(400, 'Uygulama adı gerekli.', 'gecersiz_param');
      const tur = eslenikTuru(req.query.tur) || 'ORTAM_ICI';
      res.json({
        ok: true,
        ...(await sorgu.eslenikFarki({
          kosu: req.query.kosu,
          tur,
          ad,
          ortam: String(req.query.ortam || ''),
          jboss: String(req.query.jboss || ''),
          host: req.query.host ? hostParam(req.query.host) : '',
          limit: req.query.limit,
          offset: req.query.offset,
        })),
      });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  // Iki TAM kopyanin dosya farki. Agactan yeniden hesaplanan yapi izi tarayicinin iziyle TUTMAZSA fark
  // gosterilmez (yaniltici liste yerine neden yazilir).
  router.get('/ear/yapi-farki', async (req, res) => {
    try {
      const a = kopyaParam(req.query.a);
      const b = kopyaParam(req.query.b);
      const sonuc = await agirIs(async () => {
        const oku = async (k) => {
          const { yuk } = await hostYuku(k.kosu, k.host);
          const u = (yuk.uygulamalar || [])[k.uyg];
          if (!u) throw hata(409, `${k.host}: uygulama ham dosyada yok.`, 'uygulama_yok');
          return { ...k, u, kip: yuk.kip };
        };
        return [await oku(a), await oku(b)];
      });
      const neden = (x) =>
        { if (x.kip !== 'TAM') return `${x.host}: ÖZET taramada dosya ağacı tutulmaz; TAM tarama gerekir.`; if (x.u.durum !== 'TAM') return `${x.host}: tarama eksik (${x.u.durum}); dosya farkı güvenilir olmaz.`; if (eslenikMotoru.yapiIzi(x.u.satirlar) !== String(x.u.yapi_izi || '')) return `${x.host}: ağaç satırları tarayıcının yapı iziyle tutmuyor; fark hesaplanamadı.`; return null; };
      const engel = neden(sonuc[0]) || neden(sonuc[1]);
      if (engel) return res.json({ ok: true, hesaplanamadi: engel });
      res.json({
        ok: true,
        a: { host: a.host, kosu: a.kosu, yapi_izi: sonuc[0].u.yapi_izi },
        b: { host: b.host, kosu: b.kosu, yapi_izi: sonuc[1].u.yapi_izi },
        ayni: sonuc[0].u.yapi_izi === sonuc[1].u.yapi_izi,
        ...eslenikMotoru.yapiFarki(sonuc[0].u.satirlar, sonuc[1].u.satirlar),
      });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/kutuphaneler', async (req, res) => {
    try {
      const r = await sorgu.kutuphaneler({
        kosu: req.query.kosu,
        q: req.query.q,
        f: req.query.f,
        s: req.query.s,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      res.json({ ok: true, kutuphaneler: r.satirlar, toplam: r.toplam });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/kutuphane', async (req, res) => {
    try {
      const ad = String(req.query.ad || '');
      if (!ad) throw hata(400, 'Kütüphane adı gerekli.', 'gecersiz_param');
      const r = await sorgu.kutuphaneKullananlar({
        kosu: req.query.kosu,
        ad,
        surum: req.query.surum,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      res.json({ ok: true, kullananlar: r.satirlar, toplam: r.toplam });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/hostlar', async (req, res) => {
    try {
      res.json({ ok: true, hostlar: await sorgu.hostlar({ kosu: req.query.kosu }) });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  // AKIS: uygulamalar / warlar / kutuphaneler parca parca (5000) okunur ve yazilir; ekrandaki suzgec ve
  // siralama aynen uygulanir. Eksik kalirsa (veri akista degisti) baglanti HATA ile kesilir.
  async function akit(req, res, gorunum) {
    const q = req.query;
    const ortak = { kosu: q.kosu, q: q.q, f: q.f, s: q.s };
    const fn = { uygulamalar: sorgu.uygulamalar, warlar: sorgu.warlar, kutuphaneler: sorgu.kutuphaneler }[gorunum];
    // Ilk parca yazilmadan once dogrulanir: gecersiz suzgec 400 ile doner (baslik henuz gitmedi).
    const ilk = await fn({ ...ortak, ...(gorunum === 'uygulamalar' ? eskiParametreler(q) : {}), limit: 1, offset: 0 });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ear-envanter_${gorunum}_${damga()}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    // Istemci baglantiyi kapatirsa 'drain' hic gelmez: 'close' bekleyen yazmayi reddeder (sizinti yok).
    const yaz = (metin) =>
      new Promise((coz, red) => {
        if (res.destroyed) return red(new Error('istemci baglantiyi kapatti'));
        if (res.write(metin)) return coz();
        const temizle = () => {
          res.off('drain', bosaldi);
          res.off('close', kapandi);
        };
        const bosaldi = () => {
          temizle();
          coz();
        };
        const kapandi = () => {
          temizle();
          red(new Error('istemci baglantiyi kapatti'));
        };
        res.once('drain', bosaldi);
        res.once('close', kapandi);
        return undefined;
      });
    try {
      const n = await rapor.csvAkisi(yaz, rapor.KOLONLAR[gorunum], async (offset, adet) => {
        const r = await fn({
          ...ortak,
          ...(gorunum === 'uygulamalar' ? eskiParametreler(q) : {}),
          limit: adet,
          offset,
        });
        return { satirlar: r.satirlar, toplam: r.toplam };
      });
      denetim(req, { islem: 'csv', gorunum, satir: n, beklenen: ilk.toplam });
      res.end();
    } catch (e) {
      console.warn('[EarEnvanter] csv akisi kesildi:', gorunum, e && e.message);
      res.destroy(e);
    }
  }

  async function gorunumSatirlari(gorunum, q) {
    if (gorunum === 'sunucular') return sorgu.hostlar({ kosu: q.kosu });
    const r = await sorgu.eslenikler({ ...eslenikSuzgeci(q), tur: eslenikTuru(q.tur) || 'ORTAM_ICI', limit: null });
    return r.satirlar;
  }

  router.get('/ear/disa-aktar/:dosya', async (req, res) => {
    try {
      const m = /^([a-z]+)\.csv$/.exec(String(req.params.dosya || ''));
      if (!m || !GORUNUMLER.has(m[1])) throw hata(400, 'Bilinmeyen görünüm.', 'gecersiz_gorunum');
      if (AKAN.has(m[1])) return await akit(req, res, m[1]);
      const satirlar = await gorunumSatirlari(m[1], req.query);
      const tur = eslenikTuru(req.query.tur) || 'ORTAM_ICI';
      const kolonAdi =
        m[1] !== 'eslenikler'
          ? m[1]
          : { ORTAM_ICI: 'eslenikler', ORTAMLAR_ARASI: 'eslenikler_ortamlar_arasi', NESIL: 'eslenikler_nesil', ORTAM_YOK: 'eslenikler_ortam_yok' }[tur];
      denetim(req, { islem: 'csv', gorunum: m[1], tur: m[1] === 'eslenikler' ? tur : undefined, satir: satirlar.length });
      indir(
        res,
        `ear-envanter_${m[1] === 'eslenikler' ? kolonAdi : m[1]}_${damga()}.csv`,
        'text/csv; charset=utf-8',
        rapor.csv(rapor.KOLONLAR[kolonAdi], satirlar),
      );
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/disa-aktar-zip', async (req, res) => {
    try {
      const { zipOlustur } = require('../util/zip-yazici.cjs');
      const kosu = tam(req.query.kosu) || 0;
      let girisler;
      let ad;
      if (req.query.host) {
        const host = hostParam(req.query.host);
        if (!kosu) throw hata(400, "Sunucu ZIP'i için koşu numarası gerekli.", 'gecersiz_kosu');
        girisler = await agirIs(async () => {
          const { yuk } = await hostYuku(kosu, host);
          const tek = JSON.stringify([{ k: 'host', op: 'esit', v: host }]);
          const uyg = (await sorgu.uygulamalar({ kosu, f: tek })).satirlar;
          const war = (await sorgu.warlar({ kosu, f: tek })).satirlar.map(setsiz);
          const sunucu = (await sorgu.hostlar({ kosu })).find((r) => r.host === host) || null;
          return rapor.hostZipGirisleri({
            host,
            ortam: sunucu && sunucu.ortam,
            kosu,
            yuk,
            uygulamaSatirlari: uyg,
            warSatirlari: war,
            sunucuSatiri: sunucu,
          });
        });
        ad = `ear-envanter_${rapor.guvenliParca(host)}_kosu${kosu}.zip`;
      } else {
        girisler = await agirIs(async () =>
          rapor.filoZipGirisleri({
            uygulamalar: (await sorgu.uygulamalar({ kosu })).satirlar,
            warlar: (await sorgu.warlar({ kosu })).satirlar.map(setsiz),
            kutuphaneler: (await sorgu.kutuphaneler({ kosu })).satirlar,
            sunucular: await sorgu.hostlar({ kosu }),
            eslenik: await eslenikMotoru.analiz({ kosu }),
          }),
        );
        ad = `ear-envanter_${kosu ? 'kosu' + kosu : 'son'}_${damga()}.zip`;
      }
      const zip = zipOlustur(girisler, { sinirBayt: 256 * 1024 * 1024 });
      denetim(req, {
        islem: 'zip',
        kosu,
        host: req.query.host || null,
        dosya: girisler.length,
        bayt: zip.length,
      });
      indir(res, ad, 'application/zip', zip);
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.put('/ear/ayar/:anahtar', async (req, res) => {
    try {
      const r = await ayar.yaz(req.params.anahtar, (req.body || {}).deger, kullanici(req).username);
      denetim(req, { islem: 'ayar', ...r });
      res.json({ ok: true, ...r });
    } catch (e) {
      hataYaniti(res, e);
    }
  });
}

module.exports = { mount, durumKodu, hostListesi, GORUNUMLER };
