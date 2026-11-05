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
// POST /ear/kosu                       { kip, kapsam: FILO | SECILI, hostlar } elle tarama
// POST /ear/kosu/:id/iptal
// GET  /ear/uygulamalar                ?q&ortam&jboss&durum&servlet&kosu&limit&offset
// GET  /ear/uygulama/:kosu/:host/:uyg  WAR'lar, kutuphaneler, ayni adli kopyalar
// GET  /ear/agac/:kosu/:host/:uyg      ?bicim=json|txt  (ham dosyadan; yalniz TAM ve saklama suresinde)
// GET  /ear/eslenikler                 ?ortam&tumu=1
// GET  /ear/eslenik                    ?ad&ortam&jboss  (kutuphane farki)
// GET  /ear/kutuphaneler               ?q
// GET  /ear/kutuphane                  ?ad&surum (kullanan uygulamalar)
// GET  /ear/hostlar
// GET  /ear/disa-aktar/:gorunum.csv    uygulamalar | warlar | kutuphaneler | sunucular | eslenikler
// GET  /ear/disa-aktar-zip             ?kosu  (filo) | ?host&kosu (tek sunucu: tree.txt + inventory.json)
// PUT  /ear/ayar/:anahtar              { deger }
'use strict';

const alim = require('./ear-envanter-alim.cjs');
const ayar = require('./ear-envanter-ayar.cjs');
const poller = require('./ear-envanter-poller.cjs');
const sorgu = require('./ear-envanter-sorgu.cjs');
const rapor = require('./ear-envanter-rapor.cjs');

const GORUNUMLER = new Set(['uygulamalar', 'warlar', 'kutuphaneler', 'sunucular', 'eslenikler']);
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
      const sonraki = ayar.sonrakiZamanlama(a.deger);
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
        zamanlayici: {
          acik: a.deger.zamanlayici === 'ACIK',
          metin: ayar.zamanlamaMetni(a.deger),
          sonraki: sonraki ? sonraki.toISOString() : null,
        },
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
      if (!['FILO', 'SECILI'].includes(b.kapsam))
        throw hata(400, 'Kapsam FILO ya da SECILI olmalı.', 'gecersiz_kapsam');
      const secili = b.kapsam === 'SECILI' ? hostListesi(b.hostlar) : null;
      if (secili && !secili.length) throw hata(400, 'Sunucu listesi boş.', 'hedef_yok');
      const u = kullanici(req);
      const k = await poller.kosuOlustur({
        kip,
        hedefler: secili,
        kaynak: 'ELLE',
        baslatan: u.username,
        req,
      });
      denetim(req, {
        islem: 'kosu',
        kosu: k.id,
        kip,
        kapsam: secili ? 'SECILI' : 'FILO',
        hostSayisi: k.beklenen,
      });
      res.json({ ok: true, ...k });
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
        limit: q.limit || 100,
        offset: q.offset,
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
      res.json({
        ok: true,
        ...(await sorgu.eslenikler({
          kosu: req.query.kosu,
          ortam: req.query.ortam,
          tumu: req.query.tumu === '1',
        })),
      });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/eslenik', async (req, res) => {
    try {
      const ad = String(req.query.ad || '').slice(0, 256);
      if (!ad) throw hata(400, 'Uygulama adı gerekli.', 'gecersiz_param');
      res.json({
        ok: true,
        ...(await sorgu.eslenikFarki({
          kosu: req.query.kosu,
          ad,
          ortam: String(req.query.ortam || ''),
          jboss: String(req.query.jboss || ''),
        })),
      });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/kutuphaneler', async (req, res) => {
    try {
      res.json({
        ok: true,
        kutuphaneler: await sorgu.kutuphaneler({ kosu: req.query.kosu, q: req.query.q }),
      });
    } catch (e) {
      hataYaniti(res, e);
    }
  });

  router.get('/ear/kutuphane', async (req, res) => {
    try {
      const ad = String(req.query.ad || '');
      if (!ad) throw hata(400, 'Kütüphane adı gerekli.', 'gecersiz_param');
      res.json({
        ok: true,
        kullananlar: await sorgu.kutuphaneKullananlar({
          kosu: req.query.kosu,
          ad,
          surum: req.query.surum,
        }),
      });
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

  async function gorunumSatirlari(gorunum, kosu) {
    if (gorunum === 'uygulamalar') return (await sorgu.uygulamalar({ kosu })).satirlar;
    if (gorunum === 'warlar') return sorgu.warlar({ kosu });
    if (gorunum === 'kutuphaneler') return sorgu.kutuphaneler({ kosu });
    if (gorunum === 'sunucular') return sorgu.hostlar({ kosu });
    return (await sorgu.eslenikler({ kosu })).gruplar;
  }

  router.get('/ear/disa-aktar/:dosya', async (req, res) => {
    try {
      const m = /^([a-z]+)\.csv$/.exec(String(req.params.dosya || ''));
      if (!m || !GORUNUMLER.has(m[1])) throw hata(400, 'Bilinmeyen görünüm.', 'gecersiz_gorunum');
      const satirlar = await gorunumSatirlari(m[1], req.query.kosu);
      denetim(req, { islem: 'csv', gorunum: m[1], satir: satirlar.length });
      indir(
        res,
        `ear-envanter_${m[1]}_${damga()}.csv`,
        'text/csv; charset=utf-8',
        rapor.csv(rapor.KOLONLAR[m[1]], satirlar),
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
          const uyg = (await sorgu.uygulamalar({ kosu })).satirlar.filter((r) => r.host === host);
          const war = (await sorgu.warlar({ kosu })).filter((r) => r.host === host);
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
            warlar: await sorgu.warlar({ kosu }),
            kutuphaneler: await sorgu.kutuphaneler({ kosu }),
            sunucular: await sorgu.hostlar({ kosu }),
            eslenikler: (await sorgu.eslenikler({ kosu })).gruplar,
          }),
        );
        ad = `ear-envanter_${kosu ? `kosu${kosu}` : 'son'}_${damga()}.zip`;
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
