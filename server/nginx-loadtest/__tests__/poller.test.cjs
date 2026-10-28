// server/nginx-loadtest/__tests__/poller.test.cjs - Yuk Testi sonuclandirici (2026-10-27).
// poller.cjs gercek; db / AWX sahte (require.cache); C'nin sonuc.cjs / analiz.cjs modulleri sahte.
//
//   YPL1 on kontrol: DONE + ozet, kilit ise gore birakilir, maskeli stdout BIR kez arsivlenir
//   YPL2 kosu: /sw dizini SUNUCUDA kurulur (artifact'taki yol kullanilmaz), adimlar yazilir, gecerlilik
//   YPL3 okunamadi: dizin okunamazsa / analiz bozuksa OKUNAMADI - asla DONE; kilit yine birakilir
//   YPL4 eksik ya da baska kosuya ait set_stats basari DEGIL (OKUNAMADI), analiz hic cagrilmaz
//   YPL5 AWX okunamazsa satir DEGISMEZ (okunamadi != basarisiz), kilit birakilmaz
//   YPL6 bitmemis is: sahiplenme yok; QUEUED -> RUNNING; olay islemesi yeni biten is bitmis sayilmaz
//   YPL7 iptal ve basarisiz isler; AWX'te silinmis is
//   YPL8 sahiplenme CAS'i: baska tur aldiysa hicbir sey yazilmaz
//   YPL9 kilit supurmesi (bag turu kurali) ve bayat kuyruk
//   YPL10 analizNormalle: sozlesme disi cikti, null != 0, kirpma
//   YPL11 saklama (housekeeping): TOP(@n) <= 500 partileri, once adimlar, suren kosu silinmez
//   -- tur 2 (2026-10-27 inceleme) --
//   YPL12 DUR sozlesmesi: playbook DUR'da isi dusurur (failed); karar set_stats'tan -> DONE + KISMI
//   YPL13 kilit kurali: kosu iptali / hatasi kilidi BIRAKMAZ (cozer + butce + 180 sn), basari / failed birakir
//   YPL14 AWX 404: yalniz satir butce + 600 sn'den eskiyse "is yok"; daha genci hata (satir/kilit degismez)
//   YPL15 olay islemesi bitmemis terminal is: 10 dk beklenir, sonra "cikti eksik olabilir" nedeniyle yazilir
//   YPL16 deneme sayaci: okuma hatasi < 3 denemede FINALIZING kalir; > 3 ise /sw hic okunmaz
//   YPL17 sw_dizin bildirilmediyse /sw okunmaz: FAILED + GECERSIZ
//   YPL18 tick / tetikle sonuclandirmanin istedigi kolonlari okur (tur 3: hedef_turu, motor)
//   -- tur 3 (2026-10-28) --
//   YPL19 kosuAnaliz'e tur / motor satirdan; set_stats yankisi yalniz metinse karsilastirilir (null
//         playbook hatasini korur); wrk_kos.sh rc neden metni; serbest kosu (sunucu dosyasiz) DONE
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function sahte(rel, exports) {
  const p = Module._resolveFilename(path.join(__dirname, rel), module);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
function sahteC(ad, exports) {
  const p = path.join(__dirname, '..', ad);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const D = {};
function sifirla(ek = {}) {
  Object.assign(D, {
    sorgular: [],
    sahiplen: 1,
    deneme: 0,
    arsivVar: false,
    arsiv: [],
    son: null,
    adimInsert: [],
    adimSil: 0,
    kilitBirak: [],
    kilitCoz: [],
    awx: { status: 'successful', playbook: 'nginx_loadtest.yml', artifacts: {}, finished: '2026-10-27T10:30:00Z', eventProcessingFinished: true },
    awxHata: null,
    cikti: 'PLAY [x]\nansible_password=gizli ok\n',
    okunanDizin: null,
    okumaSecenek: null,
    okumaHatasi: null,
    analiz: { gecerlilik: 'GECERLI', nedenler: [], uyarilar: ['u1'], adimlar: [], ozet: { nproc: 8 } },
    analizCagri: 0,
    analizSecenek: null,
    bekleyenKilit: [],
    aktif: [],
    tekSatir: [],
    ...ek,
  });
}
sifirla();

sahte('../../db/index.cjs', {
  query: async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, ' ').trim();
    D.sorgular.push({ q, params });
    // Sahiplenme CAS'i: sayac SQL metninden (artis yan cumlesi varsa artar, RETURNING varsa doner).
    if (/^UPDATE nginx_loadtest_kosular SET durum = 'FINALIZING'/.test(q)) {
      if (!/WHERE id = \$1 AND durum IN \('QUEUED', 'RUNNING', 'FINALIZING'\)/.test(q)) throw new Error(`sahiplenme kosulu bozuk: ${q}`);
      if (D.sahiplen && /sonuclandirma_denemesi = sonuclandirma_denemesi \+ 1/.test(q)) D.deneme += 1;
      const rows = D.sahiplen && /RETURNING sonuclandirma_denemesi$/.test(q) ? [{ sonuclandirma_denemesi: D.deneme }] : [];
      return { rows, rowCount: D.sahiplen };
    }
    if (/^UPDATE nginx_loadtest_kilitleri SET held = 0,.* WHERE awx_server_id = \$1 AND awx_job_id = \$2/.test(q)) {
      D.kilitBirak.push(params);
      return { rows: [], rowCount: 3 };
    }
    if (/^UPDATE nginx_loadtest_kilitleri SET awx_server_id = NULL, awx_job_id = NULL, bag_turu = NULL/.test(q)) {
      if (!/WHERE awx_server_id = \$1 AND awx_job_id = \$2 AND held = 1$/.test(q)) throw new Error(`cozme kosulu bozuk: ${q}`);
      D.kilitCoz.push(params);
      return { rows: [], rowCount: 3 };
    }
    if (/^SELECT TOP 50 awx_server_id, awx_job_id, bag_turu FROM nginx_loadtest_kilitleri/.test(q)) return { rows: D.bekleyenKilit };
    if (/^SELECT 1 AS x FROM ansible_job_output/.test(q)) return { rows: D.arsivVar ? [{ x: 1 }] : [] };
    if (/^INSERT INTO ansible_job_output/.test(q)) {
      D.arsiv.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (/^DELETE FROM nginx_loadtest_adimlar WHERE kosu_id = \$1$/.test(q)) {
      D.adimSil += 1;
      return { rows: [], rowCount: 0 };
    }
    if (/^INSERT INTO nginx_loadtest_adimlar/.test(q)) {
      D.adimInsert.push({ q, params });
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE nginx_loadtest_kosular SET durum = \$2, gecerlilik = \$3/.test(q)) {
      const [id, durum, gecerlilik, nedenler, sonuc, okOzet, swDizin, bitis] = params;
      D.son = { id, durum, gecerlilik, nedenler: JSON.parse(nedenler || 'null'), sonuc: JSON.parse(sonuc || 'null'), okOzet: JSON.parse(okOzet || 'null'), swDizin, bitis };
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE nginx_loadtest_kosular SET durum = 'RUNNING'/.test(q)) return { rows: [], rowCount: 1 };
    if (/^UPDATE nginx_loadtest_kosular SET durum = 'FAILED', sonuc = \$1/.test(q)) return { rows: [], rowCount: 2 };
    if (/^SELECT TOP 20 id, islem, durum, /.test(q)) return { rows: D.aktif };
    if (/^SELECT id, islem, durum, .* FROM nginx_loadtest_kosular WHERE id = \$1$/.test(q)) return { rows: D.tekSatir.filter((r) => r.id === params[0]) };
    throw new Error(`beklenmeyen sorgu: ${q}`);
  },
});
sahte('../../ansible/runner.cjs', {
  redactSecrets: (s) => s,
  getJobStatusOnServer: async (sid, jid) => {
    if (D.awxHata) throw D.awxHata;
    return { jobId: jid, ...D.awx };
  },
  getJobOutputOnServer: async () => ({ output: D.cikti }),
});
sahteC('sonuc.cjs', {
  kosuDiziniOku: async (dizin, secenek) => {
    D.okunanDizin = dizin;
    D.okumaSecenek = secenek;
    if (D.okumaHatasi) throw D.okumaHatasi;
    return { dizin, sahte: true };
  },
});
sahteC('analiz.cjs', {
  kosuAnaliz: (veri, secenek) => {
    D.analizCagri += 1;
    D.analizAdim = secenek && secenek.adim;
    D.analizSecenek = secenek;
    if (typeof D.analiz === 'function') return D.analiz(veri);
    return D.analiz;
  },
});

const pl = require('../poller.cjs');

const BUTCE = 1380;
const KOSU = (ek = {}) => ({ id: 17, islem: 'kosu', durum: 'RUNNING', awx_server_id: 3, awx_job_id: 900, parametreler: JSON.stringify({ hizlar: [100], butceSn: BUTCE }), calisma_yas_sn: 600, sonuclandirma_denemesi: 0, kilit_id: 'kilit-17', ...ek });
const STATS = (ek = {}) => ({ surum: 1, run_id: '17', islem: 'kosu', durum: 'OK', hata: null, on_kontrol: null, kosu: { kos_rc: 0, sw_dizin: '/sw/BMW_PORTAL/nginx_loadtest/17' }, durdur: null, ...ek });
const ADIM = (ek = {}) => ({
  tur: 'R17_K_yeni_br_100_r1', senaryo: 'K', kip: 'yeni', ae: 'br', hiz: 100, deneme: 1, gecerlilik: 'GECERLI', nedenler: [],
  p50: 3.1, p95: 9.5, p99: 20, ttfb_p95: 8, tls_p95: 1.2, connect_p95: 0.4, hata_orani: 0, gercek_rps: 99.9, bayt_istek: 5120,
  n_istek: 12000, n_429: 0, n_5xx: 0, dropped: 0, istek_sunucu: 11990, rps_sunucu: 99.8, cpu_ms_istek: 0.42, host_cpu_ort: 31.5,
  kapasite_rps: 2100, srt_p50: 0.001, srt_p95: 0.004, srt_p99: 0.01, sikistirma_turu: 'dinamik', ham: { dosya: 'istemci_x.json' }, ...ek,
});
const once = (dk) => new Date(Date.now() - dk * 60000).toISOString();

test('YPL1 on kontrol: DONE, ozet, kilit birakma, maskeli tek arsiv', async () => {
  sifirla();
  const ok = { ip_yerel: true, server_name_var: true, yollar_toplam: 3, yollar_200: 3, hata_notu: 'token=abc123' };
  D.awx.artifacts = { nginx_loadtest_result: JSON.stringify(STATS({ islem: 'on_kontrol', kosu: null, on_kontrol: ok, hata: 'password=p4ss' })) };
  const o = await pl.kosuyuSonuclandir(KOSU({ islem: 'on_kontrol' }));
  assert.deepEqual(o, { terminal: true, durum: 'DONE' });
  assert.equal(D.son.durum, 'DONE');
  assert.equal(D.son.gecerlilik, null);
  assert.equal(D.son.okOzet.yollar_toplam, 3);
  assert.doesNotMatch(JSON.stringify(D.son), /abc123|p4ss/, 'sonuc maskelenmedi');
  assert.deepEqual(D.kilitBirak.map((p) => p.slice(0, 2)), [[3, 900]]);
  assert.equal(D.kilitBirak[0][2], '2026-10-27T10:30:00.000Z');
  assert.equal(D.arsiv.length, 1);
  assert.doesNotMatch(D.arsiv[0][2], /gizli/, 'arsivlenen stdout maskelenmedi');
  assert.equal(D.okunanDizin, null, 'on kontrol /sw okudu');
  assert.ok(D.son.bitis instanceof Date);
  // Arsiv zaten varsa ikinci kez yazilmaz.
  sifirla({ arsivVar: true });
  D.awx.artifacts = { nginx_loadtest_result: STATS({ islem: 'on_kontrol', kosu: null, on_kontrol: ok }) };
  await pl.kosuyuSonuclandir(KOSU({ islem: 'on_kontrol' }));
  assert.equal(D.arsiv.length, 0);
  // On kontrol bolumu yoksa OKUNAMADI; FAIL ise FAILED.
  sifirla();
  D.awx.artifacts = { nginx_loadtest_result: STATS({ islem: 'on_kontrol', kosu: null }) };
  assert.equal((await pl.kosuyuSonuclandir(KOSU({ islem: 'on_kontrol' }))).durum, 'OKUNAMADI');
  sifirla();
  D.awx = { ...D.awx, status: 'failed', artifacts: { nginx_loadtest_result: STATS({ islem: 'on_kontrol', durum: 'FAIL', kosu: null, on_kontrol: { ip_yerel: false } }) } };
  assert.equal((await pl.kosuyuSonuclandir(KOSU({ islem: 'on_kontrol' }))).durum, 'FAILED');
});

test('YPL2 kosu: dizin sunucuda kurulur, adimlar ve gecerlilik yazilir', async () => {
  sifirla();
  D.awx.artifacts = { nginx_loadtest_result: STATS() };
  D.analiz = { gecerlilik: 'GECERLI', nedenler: [], uyarilar: [], adimlar: [ADIM(), ADIM({ tur: 'R17_K_yeni_br_250_r1', hiz: 250, n_istek: 3e9 })], ozet: { nproc: 8 } };
  const o = await pl.kosuyuSonuclandir(KOSU());
  assert.equal(o.durum, 'DONE');
  assert.equal(D.okunanDizin, '/sw/BMW_PORTAL/nginx_loadtest/17');
  // Okuyucu YALNIZ bu kosunun adimini kabul eder (baska TUR'lu log satiri sayilip atlanir).
  assert.deepEqual(D.okumaSecenek, { adim: 'R17' }, 'kosuDiziniOku adim secenegi almadi');
  assert.equal(D.analizAdim, 'R17');
  assert.deepEqual([D.son.durum, D.son.gecerlilik, D.son.swDizin], ['DONE', 'GECERLI', '/sw/BMW_PORTAL/nginx_loadtest/17']);
  assert.deepEqual(D.son.sonuc.portal_analiz.ozet, { nproc: 8 });
  assert.equal(D.adimSil, 1, 'yeniden sonuclandirmada eski adimlar silinmiyor (cift satir)');
  assert.equal(D.adimInsert.length, 1);
  const { q, params } = D.adimInsert[0];
  assert.equal(params.length, 2 * 32);
  assert.match(q, /^INSERT INTO nginx_loadtest_adimlar \(kosu_id, tur, senaryo, kip, ae, hiz, deneme, gecerlilik, nedenler, p50,/);
  assert.deepEqual(params.slice(0, 9), [17, 'R17_K_yeni_br_100_r1', 'K', 'yeni', 'br', 100, 1, 'GECERLI', '[]']);
  assert.equal(params[32 + 9 + 9], '3000000000', 'INT tasan deger metin olarak gitmedi');
  assert.equal(params[31], JSON.stringify({ dosya: 'istemci_x.json' }));
  // Artifact baska bir dizin bildirse de Portal KENDI dizinini okur; fark gecerliligi dusurur.
  sifirla();
  D.awx.artifacts = { nginx_loadtest_result: STATS({ kosu: { kos_rc: 0, sw_dizin: '/etc' } }) };
  D.analiz = { gecerlilik: 'GECERLI', nedenler: [], uyarilar: [], adimlar: [ADIM()], ozet: {} };
  await pl.kosuyuSonuclandir(KOSU());
  assert.equal(D.okunanDizin, '/sw/BMW_PORTAL/nginx_loadtest/17', 'artifact yolu okundu');
  assert.equal(D.son.gecerlilik, 'KISMI');
  assert.match(D.son.nedenler.join(), /başka bir dizin bildirdi/);
  // Kok env'den: NGINX_LOADTEST_DIR.
  sifirla();
  process.env.NGINX_LOADTEST_DIR = '/sw/BMW_PORTAL_DEV/nginx_loadtest/';
  try {
    D.awx.artifacts = { nginx_loadtest_result: STATS({ kosu: { kos_rc: 0, sw_dizin: '/sw/BMW_PORTAL_DEV/nginx_loadtest/17/' } }) };
    await pl.kosuyuSonuclandir(KOSU());
    assert.equal(D.okunanDizin, '/sw/BMW_PORTAL_DEV/nginx_loadtest/17');
    assert.doesNotMatch(D.son.nedenler.join(), /başka bir dizin/, 'sondaki / farki dizin farki sayildi');
  } finally {
    delete process.env.NGINX_LOADTEST_DIR;
  }
  // DUR (erken durma): playbook isi dusurur (AWX 'failed'); yine de DONE ve GECERLI -> KISMI.
  sifirla();
  D.awx = { ...D.awx, status: 'failed', artifacts: { nginx_loadtest_result: STATS({ durum: 'DUR', hata: 'kos.sh rc 4: DUR: 429' }) } };
  D.analiz = { gecerlilik: 'GECERLI', nedenler: [], uyarilar: [], adimlar: [ADIM()], ozet: {} };
  await pl.kosuyuSonuclandir(KOSU());
  assert.deepEqual([D.son.durum, D.son.gecerlilik], ['DONE', 'KISMI']);
});

test('YPL3 okunamadi asla basari degil; kilit yine birakilir', async () => {
  for (const [ad, hazirla] of [
    ['dizin yok', () => { D.okumaHatasi = Object.assign(new Error('dizin yok: /sw/x'), { code: 'OKUNAMADI' }); }],
    ['cok buyuk', () => { D.okumaHatasi = Object.assign(new Error('boyut siniri asildi'), { code: 'OKUNAMADI' }); }],
    ['analiz sozlesme disi', () => { D.analiz = { gecerlilik: 'BELKI', adimlar: [] }; }],
    ['analiz patladi', () => { D.analiz = () => { throw new Error('bozuk csv'); }; }],
  ]) {
    // Ucuncu (son) deneme: kalici karar yazilir.
    sifirla({ deneme: 2 });
    D.awx.artifacts = { nginx_loadtest_result: STATS() };
    hazirla();
    const o = await pl.kosuyuSonuclandir(KOSU());
    assert.equal(o.durum, 'OKUNAMADI', ad);
    assert.deepEqual([D.son.durum, D.son.gecerlilik], ['OKUNAMADI', 'OKUNAMADI'], ad);
    assert.equal(D.adimInsert.length, 0, `${ad}: adim yazildi`);
    assert.equal(D.kilitBirak.length, 1, `${ad}: kilit birakilmadi`);
    assert.ok(D.son.nedenler.some((n) => /okunamadı\/çözümlenemedi/.test(n)), ad);
  }
});

test('YPL4 eksik ya da baska kosunun set_stats\'i basari degil', async () => {
  for (const [ad, artifacts] of [
    ['yok', {}],
    ['bos metin', { nginx_loadtest_result: '  ' }],
    ['bozuk JSON', { nginx_loadtest_result: '{bozuk' }],
    ['baska kosu', { nginx_loadtest_result: STATS({ run_id: '16' }) }],
    ['baska islem', { nginx_loadtest_result: STATS({ islem: 'on_kontrol' }) }],
  ]) {
    sifirla();
    D.awx.artifacts = artifacts;
    const o = await pl.kosuyuSonuclandir(KOSU());
    assert.equal(o.durum, 'OKUNAMADI', ad);
    assert.equal(D.son.gecerlilik, 'OKUNAMADI', ad);
    assert.equal(D.analizCagri, 0, `${ad}: kanitsiz sonuc analiz edildi`);
    assert.equal(D.kilitBirak.length, 1, ad);
  }
  // set_stats bazen ansible_stats.data altinda gelir (toleransli okuma).
  sifirla();
  D.awx.artifacts = { ansible_stats: { data: { nginx_loadtest_result: STATS() } } };
  D.analiz = { gecerlilik: 'KISMI', nedenler: ['x'], uyarilar: [], adimlar: [ADIM()], ozet: {} };
  assert.equal((await pl.kosuyuSonuclandir(KOSU())).durum, 'DONE');
});

test('YPL5 AWX okunamazsa satir degismez ve kilit tutulur', async () => {
  sifirla({ awxHata: Object.assign(new Error('ETIMEDOUT'), { status: 504 }) });
  await assert.rejects(pl.kosuyuSonuclandir(KOSU()), /ETIMEDOUT/);
  assert.equal(D.sorgular.length, 0, 'okunamayan is icin DB yazildi');
  // Sunucu devre disi: durum BILINMEZ, satir degismez (satir cok eski olsa da).
  sifirla({ awxHata: Object.assign(new Error('sunucu yok'), { status: 404, code: 'awx_server_missing' }) });
  await assert.rejects(pl.kosuyuSonuclandir(KOSU({ calisma_yas_sn: 99999 })));
  assert.equal(D.sorgular.length, 0);
  // tick hatayi yutar (tur dusmez), satir yine degismez.
  sifirla({ awxHata: new Error('baglanti'), aktif: [KOSU()] });
  const t = await pl.tick();
  assert.equal(t.kapanan, 0);
  assert.ok(D.sorgular.some((s) => /^SELECT TOP 20 id, islem, durum/.test(s.q)), 'tur aktif kosulari okumadi');
  assert.ok(!D.sorgular.some((s) => /^UPDATE nginx_loadtest_kosular SET durum = ('FINALIZING'|\$2)/.test(s.q)), 'okunamayan kosu yazildi');
  assert.equal(D.kilitBirak.length, 0);
  assert.equal(D.kilitCoz.length, 0);
});

test('YPL6 bitmemis is sahiplenilmez; QUEUED RUNNING olur; olay islemesi suren is bitmis sayilmaz', async () => {
  sifirla();
  D.awx.status = 'running';
  assert.deepEqual(await pl.kosuyuSonuclandir(KOSU()), { terminal: false, awxStatus: 'running' });
  assert.equal(D.sorgular.length, 0);
  await pl.kosuyuSonuclandir(KOSU({ durum: 'QUEUED' }));
  assert.match(D.sorgular[0].q, /SET durum = 'RUNNING'.*WHERE id = \$1 AND durum = 'QUEUED'/);
  sifirla();
  D.awx = { ...D.awx, eventProcessingFinished: false, finished: once(1) };
  assert.equal((await pl.kosuyuSonuclandir(KOSU())).terminal, false);
  assert.equal(D.kilitBirak.length, 0);
  assert.equal(D.son, null);
  // Is numarasi olmayan satir AWX'e sorulmaz.
  sifirla({ awxHata: new Error('sorulmamali') });
  assert.equal((await pl.kosuyuSonuclandir(KOSU({ awx_job_id: null }))).isYok, true);
});

test('YPL7 iptal, basarisiz ve AWX\'te silinmis isler', async () => {
  sifirla();
  D.awx = { ...D.awx, status: 'canceled', artifacts: {} };
  await pl.kosuyuSonuclandir(KOSU());
  assert.deepEqual([D.son.durum, D.son.gecerlilik], ['CANCELED', 'GECERSIZ']);
  assert.equal(D.kilitBirak.length, 0, 'iptal edilen kosunun kilidi birakildi (uzak k6 / kaydedici surebilir)');
  assert.deepEqual(D.kilitCoz, [[3, 900, BUTCE + 180]]);
  assert.equal(D.analizCagri, 0);
  // Basarisiz is: okunabilen dizinin sonucu yazilir ama GECERLI asla kalmaz.
  sifirla();
  D.awx = { ...D.awx, status: 'failed', artifacts: { nginx_loadtest_result: STATS({ durum: 'FAIL', hata: '429 alindi' }) } };
  D.analiz = { gecerlilik: 'GECERLI', nedenler: [], uyarilar: [], adimlar: [ADIM()], ozet: {} };
  await pl.kosuyuSonuclandir(KOSU());
  assert.deepEqual([D.son.durum, D.son.gecerlilik], ['FAILED', 'KISMI']);
  assert.match(D.son.nedenler[0], /AWX işi başarısız \(failed: 429 alindi\)/);
  assert.equal(D.adimInsert.length, 1);
  assert.equal(D.kilitBirak.length, 1, 'failed kosu isi (playbook temizledi) kilidi birakmadi');
  // Hata (error) + sonuc yok -> FAILED / OKUNAMADI; kilit tutulur (cozulur).
  sifirla({ okumaHatasi: new Error('yok') });
  D.awx = { ...D.awx, status: 'error', artifacts: {} };
  await pl.kosuyuSonuclandir(KOSU());
  assert.deepEqual([D.son.durum, D.son.gecerlilik], ['FAILED', 'OKUNAMADI']);
  assert.deepEqual([D.kilitBirak.length, D.kilitCoz.length], [0, 1]);
  // AWX'te artik yok (404, sunucu ayakta) ve satir butce + 600 sn'den eski: calismiyor -> OKUNAMADI.
  sifirla({ awxHata: Object.assign(new Error('not found'), { status: 404 }) });
  await pl.kosuyuSonuclandir(KOSU({ calisma_yas_sn: BUTCE + 601 }));
  assert.deepEqual([D.son.durum, D.son.gecerlilik], ['OKUNAMADI', 'OKUNAMADI']);
  assert.match(D.son.nedenler[0], /AWX iş #900 artık yok/);
  assert.deepEqual(D.kilitCoz, [[3, 900, BUTCE + 180]], 'yok sayilan kosu isinin kilidi butce + 180 ile tutulmadi');
  assert.equal(D.arsiv.length, 0);
});

test('YPL8 sahiplenme CAS: baska tur aldiysa hicbir sey yazilmaz', async () => {
  sifirla({ sahiplen: 0 });
  D.awx.artifacts = { nginx_loadtest_result: STATS() };
  const o = await pl.kosuyuSonuclandir(KOSU());
  assert.deepEqual(o, { terminal: true, atlandi: true });
  assert.equal(D.kilitBirak.length, 0);
  assert.equal(D.kilitCoz.length, 0);
  assert.equal(D.son, null);
  assert.equal(D.analizCagri, 0);
  const sahip = D.sorgular.find((s) => /FINALIZING/.test(s.q));
  assert.match(sahip.q, /WHERE id = \$1 AND durum IN \('QUEUED', 'RUNNING', 'FINALIZING'\)/);
  // Son yazim da FINALIZING kosullu (iki yazici birbirini ezmez).
  const kod = fs.readFileSync(path.join(__dirname, '..', 'poller.cjs'), 'utf8');
  assert.match(kod, /finalized_at = GETUTCDATE\(\)\s+WHERE id = \$1 AND durum = 'FINALIZING'/);
});

test('YPL9 kilit supurmesi (bag turu kurali) ve bayat kuyruk', async () => {
  sifirla({ bekleyenKilit: [{ awx_server_id: 3, awx_job_id: 900, bag_turu: null }, { awx_server_id: 3, awx_job_id: 900, bag_turu: null }] });
  D.awx.status = 'successful';
  assert.equal(await pl.kilitSupur(), 3);
  assert.deepEqual(D.kilitBirak.map((p) => p.slice(0, 2)), [[3, 900]], 'ayni is iki kez islendi');
  sifirla({ bekleyenKilit: [{ awx_server_id: 3, awx_job_id: 900, bag_turu: 'kosu' }] });
  D.awx.status = 'running';
  assert.equal(await pl.kilitSupur(), 0);
  assert.equal(D.kilitCoz.length, 0, 'suren isin kilidi cozuldu');
  sifirla({ bekleyenKilit: [{ awx_server_id: 3, awx_job_id: 900 }], awxHata: new Error('x') });
  assert.equal(await pl.kilitSupur(), 0, 'okunamayan isin kilidi birakildi (fail-open)');
  // Iptal edilen KOSU isinin kilidi birakilmaz, isten cozulur; on kontrolunki birakilir.
  sifirla({ bekleyenKilit: [{ awx_server_id: 3, awx_job_id: 900, bag_turu: 'kosu' }, { awx_server_id: 3, awx_job_id: 901, bag_turu: 'on_kontrol' }] });
  D.awx.status = 'canceled';
  assert.equal(await pl.kilitSupur(), 3);
  assert.deepEqual(D.kilitCoz, [[3, 900]]);
  assert.deepEqual(D.kilitBirak.map((p) => p.slice(0, 2)), [[3, 901]]);
  // Durdur isi: yalniz successful birakir; failed tutar.
  sifirla({ bekleyenKilit: [{ awx_server_id: 3, awx_job_id: 950, bag_turu: 'durdur' }] });
  D.awx.status = 'failed';
  assert.equal(await pl.kilitSupur(), 0);
  assert.deepEqual(D.kilitCoz, [[3, 950]]);
  sifirla({ bekleyenKilit: [{ awx_server_id: 3, awx_job_id: 950, bag_turu: 'durdur' }] });
  assert.equal(await pl.kilitSupur(), 3);
  sifirla();
  assert.equal(await pl.bayatKuyruk(), 2);
  assert.match(D.sorgular[0].q, /WHERE durum = 'QUEUED' AND awx_job_id IS NULL AND created_at < DATEADD\(MINUTE, -15, GETUTCDATE\(\)\)/);
  assert.equal(pl.pollSaniye({}), 30);
  assert.equal(pl.pollSaniye({ NGINX_LOADTEST_POLL_SN: '1' }), 10);
  assert.equal(pl.pollSaniye({ NGINX_LOADTEST_POLL_SN: 'x' }), 30);
});

test('YPL10 analizNormalle: sozlesme disi cikti reddedilir, olculmeyen null kalir', () => {
  assert.throws(() => pl.analizNormalle(null));
  assert.throws(() => pl.analizNormalle({ gecerlilik: 'OKUNAMADI', adimlar: [] }), /tanınmadı/);
  const a = pl.analizNormalle({
    gecerlilik: 'KISMI', nedenler: ['n'], uyarilar: [],
    adimlar: [ADIM({ gecerlilik: 'BILMEM', p95: '-', p99: 'olculemedi', srt_p99: Infinity, cpu_ms_istek: null, n_429: '0', ham: { x: 'y'.repeat(40000) } }), { tur: 'kotu tur;' }, ADIM({ tur: 'R17_B_ka_gzip_10_r1', senaryo: 'Z' })],
    ozet: { a: 1 },
  });
  assert.equal(a.adimlar.length, 2);
  assert.equal(a.adimlar[0].gecerlilik, 'GECERSIZ');
  assert.equal(a.adimlar[0].p95, null, "'-' 0'a cevrildi");
  assert.equal(a.adimlar[0].p99, null, 'sayi olmayan metin 0\'a cevrildi');
  assert.equal(a.adimlar[0].srt_p99, null, 'sonsuz deger saklandi');
  assert.equal(a.adimlar[0].cpu_ms_istek, null);
  assert.equal(a.adimlar[0].n_429, 0);
  assert.equal(a.adimlar[0].ham, '{"kirpildi":true}');
  assert.equal(a.adimlar[1].senaryo, null);
  assert.match(a.uyarilar.join(), /atlandı/);
  assert.deepEqual(Object.keys(a.adimlar[0]).filter((k) => pl.METRIKLER.includes(k)).length, 21);
  // Kosu uyarisi tavani 100: 59 genel + 41 katlanan adim uyarisi (40 + ozet satiri) KESILMEZ.
  const genel = Array.from({ length: 59 }, (_, i) => `kayit:k${i}:u`);
  const katli = [...Array.from({ length: 40 }, (_, i) => `R17_K_yeni_br_100_r${i}: diger_trafik_%5`), '… ve 3 adım uyarısı daha'];
  const t = pl.analizNormalle({ gecerlilik: 'GECERLI', nedenler: [], uyarilar: [...genel, ...katli], adimlar: [], ozet: {} });
  assert.equal(pl.KOSU_UYARI_TAVANI, 100);
  assert.equal(t.uyarilar.length, 100);
  assert.equal(t.uyarilar[99], '… ve 3 adım uyarısı daha');
});

test('YPL11 saklama: TOP(@n) partileri, once adimlar, suren kosu silinmez', () => {
  const kod = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'housekeeping.cjs'), 'utf8');
  const ifadeler = (kod.match(/`\s*(UPDATE|DELETE)[^`]*`/g) || []).filter((s) => /nginx_loadtest_/.test(s));
  assert.equal(ifadeler.length, 2, 'yuk testi saklama ifadeleri bulunamadi');
  for (const s of ifadeler) {
    assert.match(s, /DELETE TOP \(@n\)/, `parti parti degil: ${s.slice(0, 60)}`);
    assert.match(s, /durum NOT IN \('QUEUED', 'RUNNING', 'FINALIZING'\)/, 'suren kosu silinebilir');
    assert.match(s, /created_at < DATEADD\(day, -@d, GETUTCDATE\(\)\)/);
  }
  assert.match(ifadeler[0], /FROM nginx_loadtest_adimlar/, 'once adimlar silinmeli');
  assert.match(ifadeler[1], /NOT EXISTS \(SELECT 1 FROM nginx_loadtest_adimlar/, 'adimi kalan kosu silinebilir');
  assert.match(kod, /const NGINX_LOADTEST_PARTI = (\d+);/);
  assert.ok(Number(kod.match(/const NGINX_LOADTEST_PARTI = (\d+);/)[1]) <= 500, 'parti 500\'den buyuk');
  assert.equal((kod.match(/Math\.min\(cfg\.batchSize, NGINX_LOADTEST_PARTI\)/g) || []).length, 2);
  const hk = require('../../db/housekeeping.cjs');
  assert.equal(hk.getConfig().nginxLoadtestRetentionDays, 365);
});

test('YPL12 DUR sozlesmesi: set_stats DUR + AWX failed -> DONE + KISMI', async () => {
  // Saf kural: canceled ayri (once) ele alinir; FAIL her zaman basarisiz.
  const kural = [
    ['successful', 'OK', true], ['successful', 'DUR', true], ['successful', 'FAIL', false],
    ['failed', 'DUR', true], ['failed', 'OK', false], ['failed', 'FAIL', false],
    ['error', 'DUR', false], ['error', 'OK', false], ['canceled', 'DUR', false],
  ];
  for (const [awx, durum, beklenen] of kural) assert.equal(pl.kosuBasarili(awx, durum), beklenen, `${awx} + ${durum}`);
  const kos = async (awx, stats) => {
    sifirla();
    D.awx = { ...D.awx, status: awx, artifacts: { nginx_loadtest_result: stats } };
    D.analiz = { gecerlilik: 'GECERLI', nedenler: [], uyarilar: [], adimlar: [ADIM()], ozet: {} };
    await pl.kosuyuSonuclandir(KOSU());
    return D.son;
  };
  let s = await kos('failed', STATS({ durum: 'DUR', hata: 'kos.sh rc 4: DUR: 429', kosu: { kos_rc: 4, kaydedici_rc: 0, sw_dizin: '/sw/BMW_PORTAL/nginx_loadtest/17' } }));
  assert.deepEqual([s.durum, s.gecerlilik], ['DONE', 'KISMI'], 'DUR kosusu FAILED yazildi (karsilastirmadan duser)');
  assert.ok(s.nedenler.includes('koşu erken durdu (DUR)'));
  assert.ok(s.nedenler.includes('kos.sh rc=4'));
  assert.ok(!s.nedenler.some((n) => /AWX işi başarısız/.test(n)), 'DUR kosusuna "AWX isi basarisiz" nedeni yazildi');
  assert.equal(D.adimInsert.length, 1);
  // Analiz zaten KISMI / GECERSIZ diyorsa o kalir.
  sifirla();
  D.awx = { ...D.awx, status: 'failed', artifacts: { nginx_loadtest_result: STATS({ durum: 'DUR' }) } };
  D.analiz = { gecerlilik: 'GECERSIZ', nedenler: ['pencere_kisa'], uyarilar: [], adimlar: [ADIM()], ozet: {} };
  await pl.kosuyuSonuclandir(KOSU());
  assert.deepEqual([D.son.durum, D.son.gecerlilik], ['DONE', 'GECERSIZ']);
  // FAIL + failed, OK + failed, DUR + error basarisiz kalir.
  for (const [awx, durum] of [['failed', 'FAIL'], ['failed', 'OK'], ['error', 'DUR']]) {
    s = await kos(awx, STATS({ durum }));
    assert.deepEqual([s.durum, s.gecerlilik], ['FAILED', 'KISMI'], `${awx} + ${durum}`);
    assert.match(s.nedenler[0], /^AWX işi başarısız/);
  }
});

test('YPL13 kilit kurali poller\'da: kosu iptali / hatasi kilidi cozer, digerleri birakir', async () => {
  const kos = async (islem, awx, ek = {}) => {
    sifirla();
    D.awx = { ...D.awx, status: awx, artifacts: {} };
    await pl.kosuyuSonuclandir(KOSU({ islem, ...ek }));
    return { birak: D.kilitBirak.map((p) => p.slice(0, 2)), coz: D.kilitCoz };
  };
  assert.deepEqual(await kos('kosu', 'canceled'), { birak: [], coz: [[3, 900, BUTCE + 180]] });
  assert.deepEqual(await kos('kosu', 'error'), { birak: [], coz: [[3, 900, BUTCE + 180]] });
  assert.deepEqual(await kos('kosu', 'failed'), { birak: [[3, 900]], coz: [] });
  assert.deepEqual(await kos('kosu', 'successful'), { birak: [[3, 900]], coz: [] });
  assert.deepEqual(await kos('on_kontrol', 'canceled'), { birak: [[3, 900]], coz: [] });
  assert.deepEqual(await kos('on_kontrol', 'error'), { birak: [[3, 900]], coz: [] });
  // Butce okunamazsa en kotu durum: 2700 + 180.
  assert.deepEqual((await kos('kosu', 'canceled', { parametreler: '{bozuk' })).coz, [[3, 900, 2700 + 180]]);
  assert.deepEqual((await kos('kosu', 'canceled', { parametreler: null })).coz, [[3, 900, 2700 + 180]]);
  assert.deepEqual((await kos('kosu', 'canceled', { parametreler: { butceSn: 900 } })).coz, [[3, 900, 900 + 180]]);
  assert.equal(pl.butceSnOf({ parametreler: JSON.stringify({ butceSn: 99999 }) }), 2700, 'sinir disi butce kabul edildi');
});

test('YPL14 AWX 404: yalniz satir butce + 600 sn\'den eskiyse "is yok"', async () => {
  const yok = () => Object.assign(new Error('not found'), { status: 404 });
  // Genc satir: tek 404 kanit DEGIL (gecit / yeni URL): hata yukari, DB'ye dokunulmaz.
  sifirla({ awxHata: yok() });
  await assert.rejects(pl.kosuyuSonuclandir(KOSU({ calisma_yas_sn: BUTCE + 600 })), /not found/);
  assert.equal(D.sorgular.length, 0, 'genc satirda tek 404 sonuclandirdi / kilit birakti');
  // Yas DB'den gelmezse started_at / created_at (yerel saat) kullanilir.
  sifirla({ awxHata: yok() });
  await assert.rejects(pl.kosuyuSonuclandir(KOSU({ calisma_yas_sn: null, started_at: new Date(Date.now() - 60000), created_at: new Date(Date.now() - 3600 * 1000 * 5) })));
  assert.equal(D.sorgular.length, 0, 'started_at yerine created_at kullanildi');
  sifirla({ awxHata: yok() });
  await pl.kosuyuSonuclandir(KOSU({ calisma_yas_sn: undefined, started_at: null, created_at: new Date(Date.now() - (BUTCE + 700) * 1000) }));
  assert.equal(D.son && D.son.durum, 'OKUNAMADI');
  // Yas hic bilinmiyorsa "yok" SAYILMAZ (fail-closed).
  sifirla({ awxHata: yok() });
  await assert.rejects(pl.kosuyuSonuclandir(KOSU({ calisma_yas_sn: null, started_at: null, created_at: null })));
  assert.equal(D.sorgular.length, 0);
  // Butce okunamazsa esik en kotu durum (2700 + 600).
  sifirla({ awxHata: yok() });
  await assert.rejects(pl.kosuyuSonuclandir(KOSU({ parametreler: null, calisma_yas_sn: 3000 })));
  sifirla({ awxHata: yok() });
  await pl.kosuyuSonuclandir(KOSU({ parametreler: null, calisma_yas_sn: 3301 }));
  assert.equal(D.son.durum, 'OKUNAMADI');
});

test('YPL15 olay islemesi bitmemis terminal is: 10 dk beklenir, sonra neden ile yazilir', async () => {
  const kos = async (awx, ek = {}) => {
    sifirla();
    D.awx = { ...D.awx, artifacts: { nginx_loadtest_result: STATS() }, eventProcessingFinished: false, ...awx };
    D.analiz = { gecerlilik: 'GECERLI', nedenler: [], uyarilar: [], adimlar: [ADIM()], ozet: {} };
    return pl.kosuyuSonuclandir(KOSU(ek));
  };
  assert.deepEqual(await kos({ finished: once(9) }), { terminal: false, awxStatus: 'successful' });
  assert.equal(D.son, null);
  assert.ok(!D.sorgular.some((s) => /FINALIZING/.test(s.q)), 'olaylari islenen is sahiplenildi');
  const o = await kos({ finished: once(11) });
  assert.deepEqual(o, { terminal: true, durum: 'DONE' });
  assert.ok(D.son.nedenler.includes(pl.OLAY_EKSIK_NEDENI), 'eksik olay nedeni yazilmadi');
  assert.equal(pl.OLAY_EKSIK_NEDENI, 'AWX olay işlemesi tamamlanmadı; arşivlenen çıktı eksik olabilir');
  // Olaylar tamamsa neden yok.
  await kos({ finished: once(11), eventProcessingFinished: true });
  assert.ok(!D.son.nedenler.includes(pl.OLAY_EKSIK_NEDENI));
  // Bitis zamani yoksa satir yasi: butce + 600 sn'yi gecene kadar beklenir.
  assert.equal((await kos({ finished: null }, { calisma_yas_sn: 900 })).terminal, false);
  assert.equal((await kos({ finished: null }, { calisma_yas_sn: BUTCE + 601 })).terminal, true);
  // On kontrol isi de ayni kurala uyar.
  sifirla();
  D.awx = { ...D.awx, eventProcessingFinished: false, finished: once(30), artifacts: { nginx_loadtest_result: STATS({ islem: 'on_kontrol', kosu: null, on_kontrol: { ip_yerel: true } }) } };
  await pl.kosuyuSonuclandir(KOSU({ islem: 'on_kontrol' }));
  assert.deepEqual([D.son.durum, D.son.nedenler], ['DONE', [pl.OLAY_EKSIK_NEDENI]]);
});

test('YPL16 deneme sayaci: okuma hatasi 3 denemeye kadar FINALIZING, 3\'u gecince /sw okunmaz', async () => {
  const hazir = (deneme) => {
    sifirla({ deneme, okumaHatasi: Object.assign(new Error('EIO: NFS'), { code: 'OKUNAMADI' }) });
    D.awx.artifacts = { nginx_loadtest_result: STATS() };
  };
  // 1. ve 2. deneme: son yazim YOK, adim yok, sonraki tur yeniden dener (kilit ilk denemede ele alinir).
  for (const onceki of [0, 1]) {
    hazir(onceki);
    const o = await pl.kosuyuSonuclandir(KOSU({ durum: onceki ? 'FINALIZING' : 'RUNNING' }));
    assert.deepEqual(o, { terminal: false, yenidenDenenecek: true }, `deneme ${onceki + 1}`);
    assert.equal(D.son, null, `deneme ${onceki + 1}: son karar yazildi`);
    assert.equal(D.adimInsert.length + D.adimSil, 0);
    assert.equal(D.deneme, onceki + 1, 'sahiplenme sayaci artirmadi');
    assert.equal(D.okunanDizin, '/sw/BMW_PORTAL/nginx_loadtest/17');
    assert.equal(D.kilitBirak.length, 1);
  }
  // 3. deneme: kalici karar (bugunku gibi).
  hazir(2);
  assert.deepEqual(await pl.kosuyuSonuclandir(KOSU({ durum: 'FINALIZING' })), { terminal: true, durum: 'OKUNAMADI' });
  assert.match(D.son.nedenler.join(), /EIO: NFS/);
  // 4. deneme: onceki uc deneme son yazima ulasamadi (surec okuma sirasinda oldu): /sw OKUNMAZ.
  hazir(3);
  D.okumaHatasi = null;
  assert.deepEqual(await pl.kosuyuSonuclandir(KOSU({ durum: 'FINALIZING' })), { terminal: true, durum: 'OKUNAMADI' });
  assert.equal(D.okunanDizin, null, '3 denemeden sonra /sw yine okundu (cokme dongusu)');
  assert.equal(D.analizCagri, 0);
  assert.deepEqual([D.son.durum, D.son.gecerlilik, D.son.nedenler], ['OKUNAMADI', 'OKUNAMADI', [pl.DENEME_NEDENI]]);
  assert.equal(pl.DENEME_NEDENI, 'sonuç 3 denemede okunamadı (Portal süreci okuma sırasında yeniden başlamış olabilir)');
  assert.equal(D.son.sonuc.portal_analiz.hata, pl.DENEME_NEDENI);
  // On kontrol de: OKUNAMADI, gecerlilik yok.
  hazir(3);
  D.awx.artifacts = { nginx_loadtest_result: STATS({ islem: 'on_kontrol', kosu: null, on_kontrol: { ip_yerel: true } }) };
  await pl.kosuyuSonuclandir(KOSU({ islem: 'on_kontrol' }));
  assert.deepEqual([D.son.durum, D.son.gecerlilik], ['OKUNAMADI', null]);
  // Basarisiz is de okuma hatasinda yeniden dener (veri /sw'de olabilir).
  hazir(0);
  D.awx = { ...D.awx, status: 'failed', artifacts: { nginx_loadtest_result: STATS({ durum: 'FAIL' }) } };
  assert.equal((await pl.kosuyuSonuclandir(KOSU())).yenidenDenenecek, true);
  // tick yeniden denenecek kosuyu "sonuclanan" saymaz.
  hazir(0);
  D.aktif = [KOSU()];
  assert.equal((await pl.tick()).kapanan, 0);
});

test('YPL17 sw_dizin bildirilmediyse /sw okunmaz: FAILED + GECERSIZ', async () => {
  for (const sw of [null, '', '  ']) {
    sifirla();
    D.awx = { ...D.awx, status: 'failed', artifacts: { nginx_loadtest_result: STATS({ durum: 'FAIL', hata: 'kaydedici hazir olmadi', kosu: { kos_rc: null, kaydedici_rc: null, sw_dizin: sw } }) } };
    await pl.kosuyuSonuclandir(KOSU());
    assert.equal(D.okunanDizin, null, `sw_dizin ${JSON.stringify(sw)}: /sw okundu`);
    assert.deepEqual([D.son.durum, D.son.gecerlilik], ['FAILED', 'GECERSIZ']);
    assert.deepEqual(D.son.nedenler, ['AWX işi başarısız (failed: kaydedici hazir olmadi)', pl.SW_YOK_NEDENI]);
    assert.equal(D.adimInsert.length, 0);
  }
  assert.equal(pl.SW_YOK_NEDENI, "yük başlamadı ya da sonuçlar /sw'ye kopyalanmadı (playbook sw_dizin bildirmedi)");
  // Kosu bolumu HIC yoksa (girdi kapisi, derleme hatasi) eskisi gibi dizin denenir.
  sifirla({ deneme: 2, okumaHatasi: new Error('ENOENT') });
  D.awx = { ...D.awx, status: 'failed', artifacts: { nginx_loadtest_result: STATS({ durum: 'FAIL', kosu: null }) } };
  await pl.kosuyuSonuclandir(KOSU());
  assert.equal(D.okunanDizin, '/sw/BMW_PORTAL/nginx_loadtest/17');
  assert.deepEqual([D.son.durum, D.son.gecerlilik], ['FAILED', 'OKUNAMADI']);
});

test('YPL18 tick ve tetikle sonuclandirmanin istedigi kolonlari okur', async () => {
  for (const k of ['parametreler', 'started_at', 'created_at', 'sonuclandirma_denemesi', 'kilit_id', 'hedef_turu', 'motor']) {
    assert.match(pl.SONUCLANDIRMA_KOLONLARI, new RegExp(`\\b${k}\\b`), k);
  }
  // Tur 3 kolonlari kilit_id'den sonra, DATEDIFF'ten once.
  assert.match(pl.SONUCLANDIRMA_KOLONLARI.replace(/\s+/g, ' '), /kilit_id, hedef_turu, motor, DATEDIFF\(/);
  assert.match(pl.SONUCLANDIRMA_KOLONLARI.replace(/\s+/g, ' '), /DATEDIFF\(SECOND, COALESCE\(started_at, created_at\), GETUTCDATE\(\)\) AS calisma_yas_sn/);
  // tick satiri oldugu gibi gecirir: eski satirdaki 404 "is yok" olur.
  sifirla({ awxHata: Object.assign(new Error('not found'), { status: 404 }), aktif: [KOSU({ calisma_yas_sn: 99999 })] });
  assert.equal((await pl.tick()).kapanan, 1);
  const secim = D.sorgular.find((s) => /^SELECT TOP 20/.test(s.q));
  assert.ok(secim.q.includes(pl.SONUCLANDIRMA_KOLONLARI.replace(/\s+/g, ' ')), 'tick kolonlari eksik okuyor');
  // tetikle ayni kolonlarla tek satiri okur.
  sifirla({ tekSatir: [KOSU()] });
  D.awx.artifacts = { nginx_loadtest_result: STATS() };
  pl.tetikle(17);
  for (let i = 0; i < 20 && !D.son; i += 1) await new Promise((r) => setImmediate(r));
  const tek = D.sorgular.find((s) => /^SELECT id, islem, durum/.test(s.q));
  assert.ok(tek && tek.q.includes(pl.SONUCLANDIRMA_KOLONLARI.replace(/\s+/g, ' ')), 'tetikle kolonlari eksik okuyor');
  assert.equal(D.son && D.son.durum, 'DONE');
});

test('YPL19 tur 3: analiz secenekleri satirdan, yanki karsilastirmasi, wrk_kos.sh rc, serbest kosu DONE', async () => {
  // Serbest + wrk kosu: sunucu dosyasi yok (C'nin okuyucusu toleransli), analiz tur / motor ile -> DONE.
  sifirla();
  D.awx.artifacts = { nginx_loadtest_result: STATS({ surum: 2, hedef_turu: 'serbest', motor: 'wrk', kosu: { kos_rc: 0, kaydedici_rc: null, sw_dizin: '/sw/BMW_PORTAL/nginx_loadtest/17' } }) };
  D.analiz = {
    gecerlilik: 'GECERLI', nedenler: [], uyarilar: ['sunucu_olcumu_yok(serbest_hedef)'],
    adimlar: [ADIM({ tur: 'R17_K_ka_br_8_r1', hiz: 8, cpu_ms_istek: null, host_cpu_ort: null, istek_sunucu: null, rps_sunucu: null, kapasite_rps: null, dropped: null, ttfb_p95: null })], ozet: {},
  };
  let o = await pl.kosuyuSonuclandir(KOSU({ hedef_turu: 'serbest', motor: 'wrk' }));
  assert.deepEqual(o, { terminal: true, durum: 'DONE' });
  assert.deepEqual(D.analizSecenek, { adim: 'R17', hedefTuru: 'serbest', motor: 'wrk' });
  assert.deepEqual([D.son.durum, D.son.gecerlilik, D.son.swDizin], ['DONE', 'GECERLI', '/sw/BMW_PORTAL/nginx_loadtest/17']);
  assert.deepEqual([D.adimInsert[0].params[5], D.adimInsert[0].params[9 + 13], D.adimInsert[0].params[9 + 15]], [8, null, null], 'olculmeyen sunucu metrigi 0 yazildi');
  // Eski satir (kolonlar NULL / yok): sunucu / k6.
  sifirla();
  D.awx.artifacts = { nginx_loadtest_result: STATS() };
  await pl.kosuyuSonuclandir(KOSU());
  assert.deepEqual(D.analizSecenek, { adim: 'R17', hedefTuru: 'sunucu', motor: 'k6' });
  // Yanki (K7): yalniz METIN ise satirla karsilastirilir.
  const sn = (ham, kosu) => pl.statsNormalle(ham, kosu);
  assert.equal(sn(STATS({ hedef_turu: 'sunucu', motor: 'k6' }), KOSU()).uyusmazlik, null);
  assert.ok(sn(STATS({ hedef_turu: 'sunucu', motor: 'k6' }), KOSU()).stats);
  assert.deepEqual(sn(STATS({ hedef_turu: 'serbest' }), KOSU()), { stats: null, uyusmazlik: 'hedef_turu serbest' });
  assert.deepEqual(sn(STATS({ motor: 'wrk' }), KOSU({ hedef_turu: 'sunucu', motor: 'k6' })), { stats: null, uyusmazlik: 'motor wrk' });
  assert.deepEqual(sn(STATS({ hedef_turu: 'sunucu' }), KOSU({ hedef_turu: 'serbest', motor: 'wrk' })), { stats: null, uyusmazlik: 'hedef_turu sunucu' });
  assert.deepEqual(sn(STATS({ hedef_turu: 'serbest', motor: 'k6' }), KOSU({ hedef_turu: 'serbest', motor: 'wrk' })), { stats: null, uyusmazlik: 'motor k6' });
  for (const yanki of [{ hedef_turu: null, motor: null }, {}, { hedef_turu: 5, motor: false }]) {
    const s = sn(STATS(yanki), KOSU({ hedef_turu: 'serbest', motor: 'wrk' }));
    assert.equal(s.uyusmazlik, null, JSON.stringify(yanki));
    assert.ok(s.stats, `${JSON.stringify(yanki)}: null yanki stats'i dusurdu`);
  }
  // Uyusmazlik kosuda: OKUNAMADI, analiz yok.
  sifirla();
  D.awx.artifacts = { nginx_loadtest_result: STATS({ hedef_turu: 'sunucu', motor: 'k6' }) };
  await pl.kosuyuSonuclandir(KOSU({ hedef_turu: 'serbest', motor: 'k6' }));
  assert.deepEqual([D.son.durum, D.son.gecerlilik], ['OKUNAMADI', 'OKUNAMADI']);
  assert.match(D.son.nedenler[0], /bu koşuya ait değil \(hedef_turu sunucu\)/);
  assert.equal(D.analizCagri, 0);
  // Null yanki + girdi reddi (eski / yeni playbook): set_stats kullanilir, playbook'un metni KORUNUR.
  sifirla();
  const ret = 'girdi reddedildi, hicbir sey yapilmadi: is gecerlilik suresi dolmus ya da gecersiz (yuk_son_epoch)';
  D.awx = { ...D.awx, status: 'failed', jobExplanation: 'Job failed', artifacts: { nginx_loadtest_result: STATS({ islem: 'on_kontrol', durum: 'FAIL', hata: ret, hedef_turu: null, motor: null, kosu: null, on_kontrol: null }) } };
  await pl.kosuyuSonuclandir(KOSU({ islem: 'on_kontrol', hedef_turu: 'serbest', motor: 'wrk' }));
  assert.deepEqual([D.son.durum, D.son.sonuc.hata], ['FAILED', ret]);
  // wrk kosusu rc: neden metni wrk_kos.sh (k6 metni birebir kos.sh).
  sifirla();
  D.awx = { ...D.awx, status: 'failed', artifacts: { nginx_loadtest_result: STATS({ durum: 'DUR', hata: 'wrk_kos.sh rc 4: DUR: R17_K_ka_br_8_r1 - 429 alindi (3)', motor: 'wrk', kosu: { kos_rc: 4, kaydedici_rc: 0, sw_dizin: '/sw/BMW_PORTAL/nginx_loadtest/17' } }) } };
  D.analiz = { gecerlilik: 'GECERLI', nedenler: [], uyarilar: [], adimlar: [ADIM()], ozet: {} };
  await pl.kosuyuSonuclandir(KOSU({ motor: 'wrk' }));
  assert.deepEqual([D.son.durum, D.son.gecerlilik], ['DONE', 'KISMI']);
  assert.ok(D.son.nedenler.includes('wrk_kos.sh rc=4'), JSON.stringify(D.son.nedenler));
  assert.ok(!D.son.nedenler.includes('kos.sh rc=4'));
  sifirla();
  D.awx = { ...D.awx, status: 'failed', artifacts: { nginx_loadtest_result: STATS({ durum: 'DUR', kosu: { kos_rc: 4, kaydedici_rc: 0, sw_dizin: '/sw/BMW_PORTAL/nginx_loadtest/17' } }) } };
  await pl.kosuyuSonuclandir(KOSU({ motor: 'k6' }));
  assert.ok(D.son.nedenler.includes('kos.sh rc=4'));
  // On kontrol de yankiyla dogrulanir (baska motorun sonucu bu on kontrole yazilmaz).
  sifirla();
  D.awx.artifacts = { nginx_loadtest_result: STATS({ islem: 'on_kontrol', kosu: null, on_kontrol: { ip_yuk_makinesinde: false }, hedef_turu: 'serbest', motor: 'k6' }) };
  assert.equal((await pl.kosuyuSonuclandir(KOSU({ islem: 'on_kontrol', hedef_turu: 'serbest', motor: 'wrk' }))).durum, 'OKUNAMADI');
  assert.match(D.son.sonuc.hata, /\(motor k6\)/);
});
