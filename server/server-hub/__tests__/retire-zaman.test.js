// server/server-hub/__tests__/retire-zaman.test.js - Retirement celiskisi ZAMAN / KOK KAPISI (2026-11-16).
//
// Uretim: "Retirement job'ina girmis JBoss uygulamalari neden kritik durumda gorunuyor?" STOP'tan ONCE
// alinmis tarama (EAR 35 gune, Server Hub ~1-2 gune kadar taze) celiski kaniti sayiliyordu; in-place
// JBoss 7 + 8'de STOP'un bilerek korudugu obur nesil paketi "ozgun adiyla diskte" sayiliyordu.
//   RA1 STOP oncesi EAR taramasi: celiski YOK, "dogrulama bekliyor" notu (EAR, paket)
//   RA2 STOP sonrasi EAR taramasi + ayni kokte ozgun ad: celiski (ORACQREPORTBATCH senaryosu)
//   RA3 in-place: /vhosting .old + /vhosting8 ozgun ad, hedef JBoss 7 -> celiski ve not YOK;
//       karsi test: /vhosting'de ozgun ad kalmis + STOP sonrasi tarama -> celiski
//   RA4 calisiyor / autostart: Server Hub taramasi STOP gunu ya da oncesi -> not; sonraki gun -> celiski;
//       gun sinirinda kurum saati (Europe/Istanbul) kullanilir
//   RA5 deleted, JVM taramada yok (sunucu duzeyi): silmeden once EAR -> not; sonra -> celiski; kok filtresi
//   RA6 STOP zamani kayitta yok: hicbir iddia kurulmaz, "zamani yok" notu
//   RA7 assess: eski veri -> 'info' RETIRE_DOGRULAMA_BEKLIYOR (kritik / R12 YOK); yeni veri -> 'danger'
//   RA8 capraz-veri: stopped_at / deleted_at tam zaman damgasi (durdurulduMs / silindiMs) tasinir
//   RA9 Uygulama 360: retire edilmis (kapali olculen) kopya ortam rozetinde acik / kapali sayilmaz, 'retire'
//       sayacina girer; olculemeyen kopya retire sayilmaz, 'olculemedi' kalir (inceleme B7)
//   RA11 inceleme B1: STOP gunu taramasi (sira belirsiz) bilgiye dusmez, UYARI (RETIRE_AYNI_GUN_DOGRULA); loaded_at
//       ham degeri STOP'tan onceyse kesin eski (bilgi); surec STOP'tan sonra basladiysa gun beklenmez (celiski)
//   RA12 inceleme B4: yolda fazla '/' ayni koktur; ad eslesip kok eslesmezse (bilinmeyen kok / kok yok) sessiz
//       kalinmaz, "kok eslenemedi" notu; bilinen obur nesil koku sessiz
//   RA13 inceleme B5 / B6: STOP gunu metni kurum gunu; Intl saat dilimi yoksa sabit UTC+3 yedegi
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function stub(rel, exports) {
  const p = require.resolve(rel);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}

// ── sahte kaynaklar (RA8): yalniz retirement sorgusu; dis envanter bos ───────────────────────
const RET_SATIRLARI = [];
const N = (s) => String(s).replace(/\s+/g, ' ').trim();
stub('../../inventory/mssql.cjs', { query: async () => ({ recordset: [] }) });
stub('../../db/index.cjs', {
  query: async (sql) => {
    const s = N(sql);
    if (s.includes('FROM retirement_targets t JOIN retirement_records r'))
      return { rows: RET_SATIRLARI };
    throw new Error(`sahte DB bilinmeyen SQL: ${s.slice(0, 80)}`);
  },
});

const {
  caprazAnaliz,
  dogrulamaMetni,
  kurumGunMetni,
  kurumZamanMetni,
  _kurumBicimiKur,
  _kurumSaatBicimiKur,
  _kurumGunu,
} = require('../capraz.cjs');
const { caprazVeri, _sifirla } = require('../capraz-veri.cjs');
const { assess } = require('../assess.cjs');
const { uygulamalar360 } = require('../uygulama-360.cjs');

// ── saf fiksturler ──────────────────────────────────────────────────────────────────────────
const STOP = Date.parse('2026-11-10T08:00:00Z');
const H = (host, env, jvms, ek = {}) => ({
  host,
  env,
  fresh: true,
  taramadanDustu: false,
  scanDate: '2026-11-12',
  jvms,
  ...ek,
});
const J = (name, ek = {}) => ({
  gen: 7,
  name,
  running: false,
  runningKnown: true,
  autoStart: 'false',
  ...ek,
});
const hedef = (host, uygulama, ek = {}) => ({
  hedef: 7,
  kayit: 24,
  host,
  uygulama,
  gen: 7,
  yol: `/vhosting/${uygulama}.ear`,
  durum: 'stopped',
  kayitDurum: 'stopped',
  durduruldu: '2026-11-10',
  durdurulduMs: STOP,
  silindiMs: null,
  ...ek,
});
const earOf = (taranma, uygulamalar) => () => ({ taranma, uygulamalar });
const E = (ad, kok = '/vhosting') => ({ ad, kok, jboss: kok === '/vhosting8' ? '8' : '7' });
const ac = (hostlar, hedefler, earFn = () => null) =>
  caprazAnaliz(hostlar, { capraz: { retirement: { okunamadi: false, hedefler } }, earOf: earFn });
const jv = (r, hs, host, ad, gen = 7) =>
  r.jvm(
    host,
    hs.find((h) => h.host === host).jvms.find((j) => j.name === ad && j.gen === gen),
  ) || { celiski: [], dogrulanamadi: [] };

test('RA1 STOP oncesi EAR taramasi: celiski yok, dogrulama bekliyor notu', () => {
  const hs = [H('P1', 'PROD', [J('PAY')])];
  const r = ac(hs, [hedef('P1', 'PAY')], earOf('2026-11-01T02:00:00.000Z', [E('PAY.ear')]));
  const x = jv(r, hs, 'P1', 'PAY');
  assert.deepEqual(x.celiski, [], 'STOP oncesi EAR verisi celiski kurdu');
  assert.equal(x.dogrulanamadi.length, 1, 'eski veri sessiz gecti');
  assert.deepEqual(
    [x.dogrulanamadi[0].kaynak, x.dogrulanamadi[0].nedenler, x.dogrulanamadi[0].tarama],
    ['EAR', ['paket'], '2026-11-01'],
  );
  assert.equal(
    dogrulamaMetni(x.dogrulanamadi[0]),
    "Retirement #24 hedefi STOP edildi (2026-11-10); son Uygulama Envanteri (EAR) taraması STOP'tan önce (2026-11-01) — paket özgün adıyla diskte (PAY.ear) eski veriye ait, doğrulama bir sonraki taramada",
  );
  // Tarama STOP aninin kendisi: "sonra" degil.
  const r2 = ac(hs, [hedef('P1', 'PAY')], earOf(new Date(STOP).toISOString(), [E('PAY.ear')]));
  assert.deepEqual(jv(r2, hs, 'P1', 'PAY').celiski, [], 'ayni an STOP sonrasi sayildi');
});

test('RA2 STOP sonrasi EAR taramasi + ayni kokte ozgun ad: celiski (ORACQREPORTBATCH)', () => {
  const stop = Date.parse('2026-10-13T09:30:00Z');
  const hs = [H('ORACQP01', 'PROD', [J('ORACQREPORTBATCH')])];
  const r = ac(
    hs,
    [hedef('ORACQP01', 'ORACQREPORTBATCH', { durduruldu: '2026-10-13', durdurulduMs: stop })],
    earOf('2026-11-01T02:00:00.000Z', [E('ORACQREPORTBATCH.ear')]),
  );
  const x = jv(r, hs, 'ORACQP01', 'ORACQREPORTBATCH');
  assert.deepEqual(
    x.celiski.map((c) => [c.kayit, c.nedenler, c.paket]),
    [[24, ['paket'], 'ORACQREPORTBATCH.ear']],
  );
  assert.deepEqual(x.dogrulanamadi, []);
});

test('RA3 in-place JBoss 7 + 8: obur nesil paketi celiski degil; hedef kokte kalan ozgun ad celiski', () => {
  const hs = [H('P1', 'PROD', [J('PAY'), J('PAY', { gen: 8, running: true, autoStart: 'true' })])];
  const earInPlace = earOf('2026-11-11T02:00:00.000Z', [
    E('PAY.ear.364244_Delete_6.old', '/vhosting'),
    E('PAY.ear', '/vhosting8'),
  ]);
  const r = ac(hs, [hedef('P1', 'PAY')], earInPlace);
  const x7 = jv(r, hs, 'P1', 'PAY', 7);
  assert.deepEqual(
    [x7.celiski, x7.dogrulanamadi],
    [[], []],
    'obur nesil paketi celiski / not uretti',
  );
  assert.deepEqual(jv(r, hs, 'P1', 'PAY', 8).celiski, [], 'hedef olmayan nesil celiski aldi');
  // Kok sonundaki egik cizgi ayni koktur.
  const r1 = ac(
    hs,
    [hedef('P1', 'PAY')],
    earOf('2026-11-11T02:00:00.000Z', [E('PAY.ear', '/vhosting/')]),
  );
  assert.deepEqual(jv(r1, hs, 'P1', 'PAY', 7).celiski[0].nedenler, ['paket']);
  // Karsi test: /vhosting'de ozgun ad kalmis + STOP sonrasi tarama.
  const r2 = ac(
    hs,
    [hedef('P1', 'PAY')],
    earOf('2026-11-11T02:00:00.000Z', [E('PAY.ear', '/vhosting'), E('PAY.ear', '/vhosting8')]),
  );
  const c = jv(r2, hs, 'P1', 'PAY', 7).celiski;
  assert.deepEqual(
    c.map((y) => [y.nedenler, y.paket]),
    [[['paket'], 'PAY.ear']],
  );
  // Hedef JBoss 8 ise /vhosting8 kokune bakilir.
  const r3 = ac(
    hs,
    [hedef('P1', 'PAY', { gen: 8, yol: '/vhosting8/PAY.ear' })],
    earOf('2026-11-11T02:00:00.000Z', [E('PAY.ear', '/vhosting')]),
  );
  assert.deepEqual(
    jv(r3, hs, 'P1', 'PAY', 8).celiski.map((y) => y.nedenler),
    [['calisiyor', 'autostart']],
  );
});

test('RA4 calisiyor / autostart: yalniz STOP gununden sonraki Server Hub taramasi', () => {
  const run = { running: true, autoStart: 'true' };
  const sonuc = (scanDate, durdurulduMs = STOP) => {
    const hs = [H('P1', 'PROD', [J('PAY', run)], { scanDate })];
    return jv(ac(hs, [hedef('P1', 'PAY', { durdurulduMs })]), hs, 'P1', 'PAY');
  };
  // STOP'tan once -> not (sira 'once'); ayni gun: sira bilinmez -> not (sira 'belirsiz').
  for (const [g, sira] of [
    ['2026-11-09', 'once'],
    ['2026-11-10', 'belirsiz'],
  ]) {
    const x = sonuc(g);
    assert.deepEqual(x.celiski, [], `${g}: STOP oncesi tarama celiski kurdu`);
    assert.deepEqual(
      x.dogrulanamadi.map((b) => [b.kaynak, b.nedenler, b.tarama, b.sira]),
      [['SERVER_HUB', ['calisiyor', 'autostart'], g, sira]],
    );
  }
  assert.match(
    dogrulamaMetni(sonuc('2026-11-09').dogrulanamadi[0]),
    /son Server Hub taraması STOP günü ya da öncesi \(2026-11-09\) — JVM çalışıyor, auto-start açık eski veriye ait/,
  );
  assert.match(
    dogrulamaMetni(sonuc('2026-11-10').dogrulanamadi[0]),
    /son Server Hub taraması STOP gününde \(2026-11-10\), STOP'tan önce mi sonra mı bilinmiyor — JVM çalışıyor, auto-start açık görünüyor: yeniden tarayın/,
  );
  // Sonraki gun -> gercek celiski.
  const y = sonuc('2026-11-11');
  assert.deepEqual(
    y.celiski.map((c) => c.nedenler),
    [['calisiyor', 'autostart']],
  );
  assert.deepEqual(y.dogrulanamadi, []);
  // Yalniz auto-start acik (JVM kapali) da ayni kapidan gecer.
  const hsA = [H('P1', 'PROD', [J('PAY', { autoStart: 'true' })], { scanDate: '2026-11-10' })];
  assert.deepEqual(jv(ac(hsA, [hedef('P1', 'PAY')]), hsA, 'P1', 'PAY').celiski, []);
  hsA[0].scanDate = '2026-11-11';
  assert.deepEqual(
    jv(ac(hsA, [hedef('P1', 'PAY')]), hsA, 'P1', 'PAY').celiski.map((c) => c.nedenler),
    [['autostart']],
  );
  // Gun siniri kurum saatinde: 22:30Z = Istanbul'da ertesi gun 01:30; o gunun taramasi STOP'tan once olabilir.
  const gece = Date.parse('2026-11-10T22:30:00Z');
  assert.deepEqual(sonuc('2026-11-11', gece).celiski, [], 'UTC gunu kullanildi');
  assert.equal(sonuc('2026-11-12', gece).celiski.length, 1);
});

test('RA5 deleted, JVM taramada yok: sunucu duzeyi ayni zaman ve kok kurallariyla', () => {
  const hs = [H('P1', 'PROD', [J('BASKA')])];
  const sil = Date.parse('2026-11-10T08:00:00Z');
  const h = (ek = {}) =>
    hedef('P1', 'OLD', {
      durum: 'deleted',
      durdurulduMs: Date.parse('2026-11-01T08:00:00Z'),
      silindiMs: sil,
      ...ek,
    });
  // STOP'tan once alinmis EAR: celiski yok, sunucu duzeyi not.
  const r = ac(hs, [h()], earOf('2026-10-30T02:00:00.000Z', [E('OLD.ear')]));
  assert.deepEqual(r.host('P1'), []);
  assert.deepEqual(
    r.hostBekleyen('P1').map((b) => [b.kaynak, b.paket, b.kok, b.uygulama, b.tarama]),
    [['EAR', 'OLD.ear', '/vhosting', 'OLD', '2026-10-30']],
  );
  assert.match(
    dogrulamaMetni(r.hostBekleyen('P1')[0]),
    /hedefi silindi .*STOP'tan önce \(2026-10-30\)/,
  );
  // inceleme B3: STOP ile silme ARASINDA alinmis EAR'da ozgun ad -> STOP yarim kalmis: celiski (silme beklenmez).
  const rArada = ac(hs, [h()], earOf('2026-11-05T02:00:00.000Z', [E('OLD.ear')]));
  assert.deepEqual(
    rArada.host('P1').map((c) => [c.durum, c.paket, c.kok]),
    [['deleted', 'OLD.ear', '/vhosting']],
  );
  assert.deepEqual(rArada.hostBekleyen('P1'), []);
  // Silmeden sonra: sunucu duzeyi celiski.
  const r2 = ac(hs, [h()], earOf('2026-11-11T02:00:00.000Z', [E('OLD.ear')]));
  assert.deepEqual(
    r2.host('P1').map((c) => [c.durum, c.paket, c.kok]),
    [['deleted', 'OLD.ear', '/vhosting']],
  );
  assert.deepEqual(r2.hostBekleyen('P1'), []);
  // silindiMs yoksa STOP ani referanstir.
  const r3 = ac(hs, [h({ silindiMs: null })], earOf('2026-11-05T02:00:00.000Z', [E('OLD.ear')]));
  assert.equal(r3.host('P1').length, 1);
  // STOP ani yoksa silme ani yedek referanstir; metin "silmeden once" der.
  const r5 = ac(hs, [h({ durdurulduMs: null })], earOf('2026-11-05T02:00:00.000Z', [E('OLD.ear')]));
  assert.deepEqual(r5.host('P1'), []);
  assert.match(dogrulamaMetni(r5.hostBekleyen('P1')[0]), /silmeden önce \(2026-11-05\)/);
  const r6 = ac(hs, [h({ durdurulduMs: null })], earOf('2026-11-11T02:00:00.000Z', [E('OLD.ear')]));
  assert.equal(r6.host('P1').length, 1);
  // Kok filtresi sunucu duzeyinde de: ozgun ad yalniz obur kokte.
  const r4 = ac(hs, [h()], earOf('2026-11-11T02:00:00.000Z', [E('OLD.ear', '/vhosting8')]));
  assert.deepEqual([r4.host('P1'), r4.hostBekleyen('P1')], [[], []]);
});

test('RA6 STOP zamani kayitta yok: iddia kurulmaz, "zamani yok" notu', () => {
  const hs = [H('P1', 'PROD', [J('PAY', { running: true, autoStart: 'true' })])];
  const r = ac(
    hs,
    [hedef('P1', 'PAY', { durduruldu: null, durdurulduMs: null })],
    earOf('2026-11-11T02:00:00.000Z', [E('PAY.ear')]),
  );
  const x = jv(r, hs, 'P1', 'PAY');
  assert.deepEqual(x.celiski, [], 'zaman yokken celiski kuruldu');
  assert.deepEqual(
    x.dogrulanamadi.map((b) => [b.kaynak, b.nedenler, b.zamanYok]),
    [
      ['SERVER_HUB', ['calisiyor', 'autostart'], true],
      ['EAR', ['paket'], true],
    ],
  );
  assert.match(dogrulamaMetni(x.dogrulanamadi[1]), /kayıtta STOP zamanı yok — .*doğrulanamadı/);
  // Sunucu duzeyi de iddia kurmaz.
  const hs2 = [H('P1', 'PROD', [J('BASKA')])];
  const r2 = ac(
    hs2,
    [hedef('P1', 'OLD', { durum: 'deleted', durduruldu: null, durdurulduMs: null })],
    earOf('2026-11-11T02:00:00.000Z', [E('OLD.ear')]),
  );
  assert.deepEqual([r2.host('P1').length, r2.hostBekleyen('P1')[0].zamanYok], [0, true]);
});

// ── assess duzeyi (ham satirlar) ───────────────────────────────────────────────────────────
const BUGUN = '2026-11-12';
const NOW = Date.parse(`${BUGUN}T10:00:00Z`);
const APP = 'ORRZAP01';
const HR = (host, ek = {}) => ({
  host,
  scan_date: BUGUN,
  products: 'JBOSS7',
  wall_s: 1,
  cpu_s: 0.1,
  note: '',
  scan_ver: '2.1',
  rec_counts: '',
  scan_errors: '',
  proc_visibility: 'FULL',
  sock_visibility: 'PID',
  loaded_at: `${ek.scan_date || BUGUN}T06:00:00Z`,
  ...ek,
});
const JR = (host, jvm, ek = {}) => ({
  host,
  gen: 7,
  jvm,
  grp: 'g',
  running: 0,
  auto_start: 'false',
  server_state: 'stopped',
  ports: '',
  running_src: 'PS_ABSENT',
  cfg_src: 'CLI_WILDCARD',
  ...ek,
});
const veri = ({ jvms, hedefler, taranma, uygulamalar }) => ({
  hosts: [HR(APP)],
  init: [],
  jboss: [],
  jvms,
  web: [],
  vhosts: [],
  ips: [],
  sshd: [],
  capraz: { retirement: { okunamadi: false, hedefler } },
  ear: {
    okunamadi: false,
    hostlar: [{ host: APP, kosuId: 3, taranma, durum: 'TAM', kokGirdileri: null, uygulamalar }],
  },
});
const U7 = (ad, kok = '/vhosting') => ({
  kok,
  jboss: kok === '/vhosting8' ? '8' : '7',
  ad,
  durum: 'TAM',
  warSayisi: 1,
  xml: null,
});
const sunucu = (r) => r.hosts.find((x) => x.host === APP);
const bul = (r, kod) => sunucu(r).findings.filter((f) => f.code === kod);

test('RA7 assess: eski veri bilgi notu (kritik ve R12 yok); STOP sonrasi veri kritik', () => {
  const hedefler = [hedef(APP, 'pay')];
  // JVM kapali + auto-start kapali (STOP tam); EAR STOP'tan once.
  const eski = assess(
    veri({
      jvms: [JR(APP, 'pay')],
      hedefler,
      taranma: '2026-11-01T02:00:00.000Z',
      uygulamalar: [U7('pay.ear')],
    }),
    { now: NOW },
  );
  assert.equal(bul(eski, 'RETIRE_KAYDI_CELISKI').length, 0);
  const not = bul(eski, 'RETIRE_DOGRULAMA_BEKLIYOR');
  assert.deepEqual([not.length, not[0].severity, not[0].area], [1, 'info', 'capraz']);
  assert.match(
    not[0].text,
    /^JBoss7 pay: Retirement #24 hedefi STOP edildi \(2026-11-10\); son Uygulama Envanteri/,
  );
  assert.notEqual(sunucu(eski).status, 'danger');
  assert.equal(sunucu(eski).retireAdaylari.filter((a) => a.kural === 'R12').length, 0);
  // EAR STOP'tan sonra: kritik.
  const yeni = assess(
    veri({
      jvms: [JR(APP, 'pay')],
      hedefler,
      taranma: '2026-11-11T02:00:00.000Z',
      uygulamalar: [U7('pay.ear')],
    }),
    { now: NOW },
  );
  const cel = bul(yeni, 'RETIRE_KAYDI_CELISKI');
  assert.deepEqual([cel.length, cel[0].severity], [1, 'danger']);
  assert.equal(bul(yeni, 'RETIRE_DOGRULAMA_BEKLIYOR').length, 0);
  assert.equal(sunucu(yeni).status, 'danger');
  // Sunucu duzeyi (JVM taramada yok, hedef silindi): silmeden once EAR -> bilgi; sonra -> kritik.
  const sil = [
    hedef(APP, 'old', {
      durum: 'deleted',
      durdurulduMs: Date.parse('2026-11-01T08:00:00Z'),
      silindiMs: Date.parse('2026-11-10T08:00:00Z'),
    }),
  ];
  const sEski = assess(
    veri({
      jvms: [JR(APP, 'baska')],
      hedefler: sil,
      taranma: '2026-10-30T02:00:00.000Z',
      uygulamalar: [U7('old.ear')],
    }),
    { now: NOW },
  );
  assert.equal(bul(sEski, 'RETIRE_KAYDI_CELISKI').length, 0);
  const sn = bul(sEski, 'RETIRE_DOGRULAMA_BEKLIYOR');
  assert.deepEqual([sn.length, sn[0].severity], [1, 'info']);
  assert.match(sn[0].text, /^\/vhosting\/old\.ear: Retirement #24 hedefi silindi/);
  assert.equal(sunucu(sEski).retireAdaylari.filter((a) => a.kural === 'R12').length, 0);
  const sYeni = assess(
    veri({
      jvms: [JR(APP, 'baska')],
      hedefler: sil,
      taranma: '2026-11-11T02:00:00.000Z',
      uygulamalar: [U7('old.ear')],
    }),
    { now: NOW },
  );
  assert.equal(bul(sYeni, 'RETIRE_KAYDI_CELISKI')[0].severity, 'danger');
});

test('RA8 capraz-veri: stopped_at / deleted_at tam zaman damgasi tasinir', async () => {
  _sifirla();
  RET_SATIRLARI.length = 0;
  RET_SATIRLARI.push(
    {
      id: 1,
      record_id: 24,
      host: 'P1',
      app_name: 'pay',
      jboss_gen: 7,
      app_path: '/vhosting/pay.ear',
      status: 'deleted',
      stopped_at: new Date('2026-11-10T08:15:30Z'),
      deleted_at: new Date('2026-11-12T09:00:00Z'),
      kayit_durum: 'deleted',
    },
    {
      id: 2,
      record_id: 24,
      host: 'P2',
      app_name: 'pay',
      jboss_gen: 7,
      app_path: '/vhosting/pay.ear',
      status: 'stopped',
      stopped_at: null,
      deleted_at: null,
      kayit_durum: 'stopped',
    },
  );
  const v = await caprazVeri();
  const [a, b] = v.retirement.hedefler;
  assert.deepEqual(
    [a.durduruldu, a.durdurulduMs, a.silindiMs],
    ['2026-11-10', Date.parse('2026-11-10T08:15:30Z'), Date.parse('2026-11-12T09:00:00Z')],
  );
  assert.deepEqual([b.durduruldu, b.durdurulduMs, b.silindiMs], [null, null, null]);
});

test('RA9 Uygulama 360: retire edilmis kopya ortam rozetinde ayri sayilir', () => {
  const ret = (durum) => [{ kayit: 24, hedef: 7, durum }];
  const KH = (host, env, jvms) => ({
    host,
    env,
    fresh: true,
    taramadanDustu: false,
    scanDate: BUGUN,
    hostClass: 'genel',
    jvms,
    ear: null,
  });
  const KJ = (ek = {}) => ({
    gen: 7,
    name: 'PAY',
    running: false,
    runningKnown: true,
    autoStart: 'false',
    vhosts: [],
    ...ek,
  });
  const r = uygulamalar360([
    KH('P1', 'PROD', [KJ({ retirement: ret('stopped') })]),
    KH('P2', 'PROD', [KJ({ retirement: ret('deleted') })]),
    KH('Q1', 'QA', [KJ({ running: true, retirement: ret('stopped') })]),
    KH('Q2', 'QA', [KJ({ retirement: ret('planned') })]),
    KH('T1', 'TEST', [KJ({ runningKnown: false, retirement: ret('stopped') })]),
    KH('T2', 'TEST', [KJ({ running: true })]),
  ]);
  const u = r.uygulamalar.find((x) => x.anahtar === 'PAY');
  assert.deepEqual(u.ortamlar, [
    { ortam: 'PROD', toplam: 0, acik: 0, kapali: 0, olculemedi: 0, retire: 2 },
    // Calisan retire kopyasi celiskidir (retire sayilmaz); STOP edilmemis hedef retire degildir.
    { ortam: 'QA', toplam: 2, acik: 1, kapali: 1, olculemedi: 0, retire: 0 },
    // Olculemeyen retire kopyasi retire sayilmaz (inceleme B7): kapali oldugu bilinmiyor.
    { ortam: 'TEST', toplam: 2, acik: 1, kapali: 0, olculemedi: 1, retire: 0 },
  ]);
});

test('RA11 STOP gunu taramasi: UYARI (sira belirsiz); loaded_at kesin onceyse bilgi; surec sonra basladiysa celiski', () => {
  // Saf duzey: ayni gun + loaded_at ham degeri STOP'tan once -> 'once'; sonra / yok -> 'belirsiz'.
  const run = { running: true, autoStart: 'true' };
  const x = (hEk, jEk = {}) => {
    const hs = [
      H('P1', 'PROD', [J('PAY', { ...run, ...jEk })], { scanDate: '2026-11-10', ...hEk }),
    ];
    return jv(ac(hs, [hedef('P1', 'PAY')]), hs, 'P1', 'PAY');
  };
  const sira = (r) => r.dogrulanamadi.map((b) => b.sira);
  assert.deepEqual(
    sira(x({ loadedAt: STOP - 60000 })),
    ['once'],
    'STOP oncesi yukleme belirsiz sayildi',
  );
  assert.deepEqual(sira(x({ loadedAt: STOP + 60000 })), ['belirsiz']);
  assert.deepEqual(sira(x({ loadedAt: null })), ['belirsiz']);
  // Surec STOP'tan (pay: 10 dk) sonra basladi: gozlem kesin STOP sonrasi -> celiski, ayni gun beklenmez.
  const sonra = x({}, { processStartEpoch: (STOP + 11 * 60000) / 1000 });
  assert.deepEqual(
    [sonra.celiski.map((c) => c.nedenler), sonra.dogrulanamadi],
    [[['calisiyor', 'autostart']], []],
  );
  // Pay icinde ya da STOP'tan once baslamis surec kanit degildir.
  assert.equal(x({}, { processStartEpoch: (STOP + 5 * 60000) / 1000 }).celiski.length, 0);
  assert.equal(x({}, { processStartEpoch: (STOP - 3600000) / 1000 }).celiski.length, 0);
  // Kapali JVM'in surec baslangici iddia kurmaz (yalniz calisan surec).
  assert.equal(
    x({}, { running: false, processStartEpoch: (STOP + 3600000) / 1000 }).celiski.length,
    0,
  );
  // Assess: STOP gunu taramasi -> warning RETIRE_AYNI_GUN_DOGRULA (kritik / R12 yok); loaded_at STOP'tan
  // once -> info RETIRE_DOGRULAMA_BEKLIYOR.
  const stopBugun = Date.parse(`${BUGUN}T08:00:00Z`);
  const hedefler = [hedef(APP, 'pay', { durduruldu: BUGUN, durdurulduMs: stopBugun })];
  const calisan = { running: 1, running_src: 'PS', server_state: 'running', auto_start: 'true' };
  const r = (loadedAt) =>
    assess(
      {
        ...veri({ jvms: [JR(APP, 'pay', calisan)], hedefler, taranma: null, uygulamalar: [] }),
        hosts: [HR(APP, { loaded_at: loadedAt })],
      },
      { now: NOW },
    );
  const ayni = r(`${BUGUN}T09:00:00Z`);
  const uy = bul(ayni, 'RETIRE_AYNI_GUN_DOGRULA');
  assert.deepEqual([uy.length, uy[0].severity, uy[0].area], [1, 'warning', 'capraz']);
  assert.match(
    uy[0].text,
    /^JBoss7 pay: Retirement #24 hedefi STOP edildi \(2026-11-12\); son Server Hub taraması STOP gününde/,
  );
  assert.equal(bul(ayni, 'RETIRE_KAYDI_CELISKI').length, 0);
  assert.equal(bul(ayni, 'RETIRE_DOGRULAMA_BEKLIYOR').length, 0);
  assert.equal(sunucu(ayni).retireAdaylari.filter((a) => a.kural === 'R12').length, 0);
  const once = r(`${BUGUN}T06:00:00Z`);
  assert.equal(bul(once, 'RETIRE_AYNI_GUN_DOGRULA').length, 0);
  assert.equal(bul(once, 'RETIRE_DOGRULAMA_BEKLIYOR')[0].severity, 'info');
});

test('RA12 kok eslemesi: fazla egik cizgi ayni kok; eslenemeyen kok sessiz kalmaz, obur nesil sessiz', () => {
  const hs = [H('P1', 'PROD', [J('PAY')])];
  const taze = '2026-11-11T02:00:00.000Z';
  // app_path'te cift '/' (P4) ve EAR kokunde cift '/': ayni kok -> celiski.
  const r1 = ac(
    hs,
    [hedef('P1', 'PAY', { yol: '/vhosting//PAY.ear' })],
    earOf(taze, [E('PAY.ear')]),
  );
  assert.deepEqual(
    jv(r1, hs, 'P1', 'PAY').celiski.map((c) => c.nedenler),
    [['paket']],
  );
  const r1b = ac(hs, [hedef('P1', 'PAY')], earOf(taze, [E('PAY.ear', '//vhosting')]));
  assert.deepEqual(
    jv(r1b, hs, 'P1', 'PAY').celiski.map((c) => c.nedenler),
    [['paket']],
  );
  // Ic ice yol (P7): hedef koku /vhosting/rel taranan koklerden degil; ayni ad /vhosting'de -> not.
  const r2 = ac(
    hs,
    [hedef('P1', 'PAY', { yol: '/vhosting/rel/PAY.ear' })],
    earOf(taze, [E('PAY.ear')]),
  );
  const x2 = jv(r2, hs, 'P1', 'PAY');
  assert.deepEqual(x2.celiski, []);
  assert.deepEqual(
    x2.dogrulanamadi.map((b) => [b.kaynak, b.kokUyusmaz, b.kok, b.hedefKok]),
    [['EAR', true, '/vhosting', '/vhosting/rel']],
  );
  assert.equal(
    dogrulamaMetni(x2.dogrulanamadi[0]),
    'Retirement #24 hedefi STOP edildi (2026-11-10); paket özgün adıyla başka kökte (/vhosting/PAY.ear), hedefin kökü /vhosting/rel Uygulama Envanteri (EAR) taraması (2026-11-11) ile eşlenemedi — paketin adı doğrulanamadı',
  );
  // EAR kaydinda kok yok (P13): not.
  const r3 = ac(hs, [hedef('P1', 'PAY')], earOf(taze, [{ ad: 'PAY.ear', jboss: '?' }]));
  assert.deepEqual(
    jv(r3, hs, 'P1', 'PAY').dogrulanamadi.map((b) => [b.kokUyusmaz, b.kok]),
    [[true, '']],
  );
  // Sunucu duzeyi (JVM taramada yok) da sessiz kalmaz.
  const hs2 = [H('P1', 'PROD', [J('BASKA')])];
  const r4 = ac(
    hs2,
    [hedef('P1', 'OLD', { yol: '/opt/apps/OLD.ear' })],
    earOf(taze, [E('OLD.ear')]),
  );
  assert.deepEqual(
    [r4.host('P1'), r4.hostBekleyen('P1').map((b) => [b.kokUyusmaz, b.uygulama])],
    [[], [[true, 'OLD']]],
  );
  // Bilinen obur nesil koku (in-place) sessiz kalir; hedef kokunde eslesme varsa kok notu yazilmaz.
  const r5 = ac(hs, [hedef('P1', 'PAY')], earOf(taze, [E('PAY.ear', '/vhosting8')]));
  assert.deepEqual(jv(r5, hs, 'P1', 'PAY').dogrulanamadi, []);
  const r6 = ac(hs, [hedef('P1', 'PAY')], earOf(taze, [E('PAY.ear'), E('PAY.ear', '/opt')]));
  const x6 = jv(r6, hs, 'P1', 'PAY');
  assert.deepEqual([x6.celiski.length, x6.dogrulanamadi], [1, []]);
});

test('RA13 kurum gunu: STOP gunu metni Istanbul gunu; Intl yoksa sabit UTC+3', async () => {
  const gece = Date.parse('2026-11-10T22:30:00Z');
  const aksam = Date.parse('2026-11-10T20:59:00Z');
  assert.equal(kurumGunMetni(gece), '2026-11-11');
  assert.equal(kurumGunMetni(aksam), '2026-11-10');
  assert.equal(kurumGunMetni(null), null);
  // EAR notunun tarama gunu da kurum gunu: 2026-11-09 22:30Z taramasi Istanbul'da 2026-11-10.
  const hs = [H('P1', 'PROD', [J('PAY')])];
  const r = ac(hs, [hedef('P1', 'PAY')], earOf('2026-11-09T22:30:00.000Z', [E('PAY.ear')]));
  assert.deepEqual(
    jv(r, hs, 'P1', 'PAY').dogrulanamadi.map((b) => b.tarama),
    ['2026-11-10'],
  );
  // capraz-veri 'durduruldu' metni kurum gunu (dogrulama notundaki tarama gunuyle ayni taban).
  _sifirla();
  RET_SATIRLARI.length = 0;
  RET_SATIRLARI.push({
    id: 3,
    record_id: 25,
    host: 'P1',
    app_name: 'pay',
    jboss_gen: 7,
    app_path: '/vhosting/pay.ear',
    status: 'stopped',
    stopped_at: new Date(gece),
    deleted_at: null,
    kayit_durum: 'stopped',
  });
  const v = await caprazVeri();
  const t = v.retirement.hedefler[0];
  assert.deepEqual([t.durduruldu, t.durdurulduMs], ['2026-11-11', gece]);
  // ICU / saat dilimi verisi olmayan Node: bicimleyici kurulamaz, modul dusmez, sabit ofset.
  const uyari = console.warn;
  const yazilan = [];
  console.warn = (m) => yazilan.push(String(m));
  try {
    const yok = _kurumBicimiKur(function () {
      throw new RangeError('Invalid time zone specified: Europe/Istanbul');
    });
    assert.equal(yok, null);
    assert.match(yazilan.join('\n'), /saat dilimi kullanilamiyor .*sabit UTC\+3/);
  } finally {
    console.warn = uyari;
  }
  assert.equal(_kurumGunu(gece, null), _kurumGunu(gece));
  assert.equal(_kurumGunu(aksam, null), _kurumGunu(aksam));
  // Gun + saat metni (kullanim kaniti, 2026-11-17): kurum saati, 24 saat; Intl'siz yedek ayni metni verir.
  const gs = Date.parse('2026-11-16T21:53:00Z');
  assert.equal(kurumZamanMetni(gs), '17.11.2026 00:53');
  assert.equal(kurumZamanMetni(gs, null), '17.11.2026 00:53');
  assert.equal(kurumZamanMetni(Date.parse('2026-11-17T09:05:00Z')), '17.11.2026 12:05');
  assert.equal(kurumZamanMetni(Number.NaN), null);
  assert.equal(
    _kurumSaatBicimiKur(function () {
      throw new RangeError('yok');
    }),
    null,
  );
});
