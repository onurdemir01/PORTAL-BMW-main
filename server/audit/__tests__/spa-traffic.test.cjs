// server/audit/__tests__/spa-traffic.test.cjs — SPA "yuk aliyor mu" (2026-09-24).
//
// Kullanici: "bu uygulamalar yuk aliyor mu gormek istiyorum; en iyi access log'dan goruruz."
// Kaynak dbo.Nginx_Spa_Traffic (bmw_nginx/nginx_config_audit/files/nginx_spa_traffic.sh).
//
// Kilitlenen iddialar:
//   T1 hc.jsp / hc.html YUK SAYILMAZ - ayri tutulur.
//   T2 UC durum var: yuk var / yuk yok / BILINMIYOR. Log okunamadiysa ya da okunan log 7 gunu
//      kapsamiyorsa "yuk yok" DENMEZ (atil sanip tanim silmeye goturebilirdi).
//   T3 Ayni tanim birden fazla mirror sunucuda: sayilar TOPLANIR, son istek en yenisi.
//   T4 Tablo yoksa ekran calismaya devam eder (trafik hic gosterilmez).
//
// 2026-10-02: T2-T4 artik METIN DEGIL DAVRANIS bekcisi. GET /api/denetim/nginx-spa sahte bir
// MSSQL ile GERCEKTEN kosulur (initDenetim + express). Eski metin bekcisi tam da hatali
// karari (`req7 > 0 ? active : sampled ? unknown : idle`) kilitliyordu: gunluk rotasyonlu
// hostta 1-4 gunluk olcum "7 gundur yuk yok - atil aday" gorunuyordu.
//   T5 kisa pencere / first_seen yok (kolon yok) -> idle DEGIL; ozet "yuk yok"a saymaz
//   T6 okunamayan mirror (LOADERR host|vhost) -> idle DEGIL
//   T7 host kipi satirlari ('@', vhost '_') hucreye yazilmaz, "olcum var" saymaz
//   T8 hucrede birden cok location: biri yuk aliyorsa "yuk var", biri kismi ise "?"; HIC
//      olculmeyen location da "?" yapar (atilmaz); '^~ /x/' tanimi '/x/' olcumune baglanir
//   T10 (PROD proxy satirlari): spa-traffic-proxy.test.cjs (proxy kolon onbellegi surec basina)
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
const PAGE = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'components', 'DenetimPage.tsx'),
  'utf8',
);
// Betik tarafinin iddialari (hc ayrimi, en uzun onek eslesmesi, regex location atlama)
// Ansible deposunun KENDI bekcisindedir: bmw_nginx/tests/check_spa_traffic.py. Portal testi
// baska bir deponun diskteki yerine bagimli olmamali.
test('T1 saglik kontrolu yuke SAYILMAZ (ekran bunu soyluyor)', () => {
  assert.ok(PAGE.includes('hc.jsp / hc.html sayılmaz'), 'ekranda hc haric oldugu yazmali');
  assert.ok(
    PAGE.includes('Sağlık kontrolü (hariç tutuldu)'),
    'ipucunda hc sayisi ayri gosterilmeli',
  );
});

// ── SAHTE ORTAM: MSSQL + yetki (yalniz bu test sureci; node --test dosya basina surec) ──
const SERVER = path.join(__dirname, '..', '..');
function sahteModul(rel, exportsObj) {
  const p = require.resolve(path.join(SERVER, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj, children: [], paths: [] };
}
const gec = (_req, _res, next) => next();

const GUN = '2026-10-02';
const TAM = '20260924000000'; // 8 gun
const ROT3 = '20260929031500'; // ~3 gun (gunluk rotasyon)

let DB = null; // { config, trafik, fs, trfYok }
const SORGULAR = [];
async function query(text) {
  const t = String(text);
  SORGULAR.push(t);
  const rs = (recordset) => ({ recordset });
  // hasProxyColumns: proxy kolonlari yok (PROD proxy cozumu bu testin konusu degil)
  if (t.includes('FROM sys.columns') && t.includes('Nginx_Config_Audit')) return rs([{ n: 0 }]);
  if (t.includes("OBJECT_ID('dbo.Nginx_Spa_Traffic')"))
    return rs([DB.trfYok ? { trf: null, fs: null } : { trf: 1, fs: DB.fs }]);
  if (t.includes('FROM dbo.Nginx_Spa_Traffic')) {
    if (DB.trfYok) throw new Error("Invalid object name 'dbo.Nginx_Spa_Traffic'.");
    // SQL Server gibi: kolon YOKKEN adini yazan sorgu derleme aninda duser.
    if (!DB.fs && /first_seen/.test(t.replace(/AS first_seen/g, '')))
      throw new Error("Invalid column name 'first_seen'.");
    return rs(DB.trafik);
  }
  if (t.includes('MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit')) return rs([{ d: GUN }]);
  if (t.includes('SELECT DISTINCT TOP 30')) return rs([{ d: GUN }]);
  if (t.includes('FROM dbo.Nginx_Config_Audit')) return rs(DB.config);
  return rs([]); // dizin bayraklari, ekip sahipligi, tarama saati
}
sahteModul('inventory/mssql.cjs', {
  query,
  queryLong: query,
  sql: new Proxy({}, { get: () => () => 'tip' }),
});
sahteModul('auth/index.cjs', {
  requireAuth: gec,
  requireAdmin: gec,
  getRequestUser: () => null,
});
sahteModul('auth/visibility.cjs', {
  requireVisiblePrefix: () => gec,
  requireVisible: () => gec,
});

let sunucu = null;
let taban = '';
before(async () => {
  const express = require('express');
  const app = express();
  require('../denetim.cjs').initDenetim(app);
  await new Promise((ok) => {
    sunucu = app.listen(0, '127.0.0.1', ok);
  });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
});
after(() => new Promise((ok) => sunucu.close(ok)));

/** Nginx_Config_Audit SPA satiri (location kipi tanimi). */
const CFG = (host, o = {}) => ({
  service: 'GLOMO',
  env: 'PROD',
  application: 'kart-app-v1',
  namespace: 'kart-prod',
  include_name: 'kart-app-v1',
  location_path: '/kart/',
  host,
  vhost: 'GLOMO-PROD',
  deploy_mode: 'namespaced',
  include_exists: 1,
  app_deployed: 1,
  in_ocp_inventory: 1,
  status: 'OK',
  ...o,
});
/** Nginx_Spa_Traffic LOAD satiri. */
const LOAD = (host, o = {}) => ({
  host,
  vhost: 'GLOMO-PROD',
  service: 'GLOMO',
  env: 'PROD',
  location: '/kart/',
  req_24h: 0,
  req_7d: 0,
  hc_24h: 0,
  sampled: 0,
  last_seen: null,
  error: null,
  first_seen: TAM,
  scan_date: GUN,
  ...o,
});
const LOADERR = (host, vhost) => ({
  host,
  vhost,
  service: null,
  env: null,
  location: null,
  req_24h: null,
  req_7d: null,
  hc_24h: null,
  sampled: 0,
  last_seen: null,
  error: 'log www ile okunamiyor: /web_log/glomo.log',
  first_seen: null,
  scan_date: GUN,
});

async function getir(db) {
  DB = { fs: 40, trfYok: false, ...db };
  SORGULAR.length = 0;
  const r = await fetch(`${taban}/api/denetim/nginx-spa?fresh=1`);
  const j = await r.json();
  assert.equal(j.ok, true, `uc dustu: ${j.message}`);
  return j;
}
const hucre = (j, app = 'kart-app-v1') => j.rows.find((r) => r.application === app).envs.PROD;

test('T2 uc durum: aktif / atil / BILINMIYOR - olculemeyen "yuk yok" sayilmaz', async () => {
  const cfg = [CFG('H1'), CFG('H2')];
  const aktif = await getir({ config: cfg, trafik: [LOAD('H1', { req_7d: 12, req_24h: 3 }), LOAD('H2')] });
  assert.equal(hucre(aktif).traffic.state, 'active');

  // 7 gunun tamami, iki mirror da okundu, istek yok -> gercekten atil.
  const atil = await getir({ config: cfg, trafik: [LOAD('H1'), LOAD('H2')] });
  assert.equal(hucre(atil).traffic.state, 'idle');
  assert.equal(atil.trafficStats.idle, 1);

  // Kuyruk butcesi bitti (sampled) -> alt sinir.
  const smp = await getir({ config: cfg, trafik: [LOAD('H1', { sampled: 1 }), LOAD('H2')] });
  assert.equal(hucre(smp).traffic.state, 'unknown');
  assert.deepEqual(hucre(smp).traffic.kismi, ['sampled']);
  assert.ok(PAGE.includes('“Yük yok” demek DEĞİLDİR'), 'ekranda bilinmiyor/yok ayrimi aciklanmali');
});

test('T3 mirror sunucular: sayilar toplanir, son istek en yenisi', async () => {
  const j = await getir({
    config: [CFG('H1'), CFG('H2')],
    trafik: [
      LOAD('H1', { req_7d: 10, req_24h: 2, hc_24h: 5, last_seen: '20261001080000' }),
      LOAD('H2', { req_7d: 4, req_24h: 1, hc_24h: 5, last_seen: '20261001230000' }),
    ],
  });
  const t = hucre(j).traffic;
  assert.equal(t.req7, 14);
  assert.equal(t.req24, 3);
  assert.equal(t.hc24, 10);
  assert.equal(t.hosts, 2);
  assert.equal(t.lastSeen, '20261001230000');
});

test('T4 tablo yoksa ekran calisir: trafik sessizce gosterilmez', async () => {
  const j = await getir({ config: [CFG('H1')], trafik: [], trfYok: true });
  assert.equal(hucre(j).traffic, null, 'tablo yokken olcum uyduruldu');
  assert.equal(j.trafficStats.ready, false);
  assert.match(PAGE, /data\.trafficStats\?\.ready &&/, 'veri yoksa ozet seridi hic cizilmemeli');
});

test('T5 kisa pencere (gunluk rotasyon) ve first_seen yok -> idle DEGIL', async () => {
  const cfg = [CFG('H1'), CFG('H2')];
  // Tum donmus dosyalar okundu, sampled=0, ama veri ~3 gun.
  const rot = await getir({ config: cfg, trafik: [LOAD('H1', { first_seen: ROT3 }), LOAD('H2', { first_seen: ROT3 })] });
  const t = hucre(rot).traffic;
  assert.equal(t.state, 'unknown', '3 gunluk olcum "7 gundur yuk yok - atil aday" gosterildi');
  assert.deepEqual(t.kismi, ['pencere']);
  assert.equal(t.pencereSaat, 68);
  assert.equal(rot.trafficStats.idle, 0, 'kisa pencere "yuk yok" sayisina girdi');
  assert.equal(rot.trafficStats.unknown, 1);
  assert.equal(rot.trafficStats.kismi, 1);

  // first_seen KOLONU YOK (eski analyzer): sorgu dusmez, ama "yok" da denmez.
  const kolonsuz = await getir({
    config: cfg,
    fs: null,
    trafik: [LOAD('H1', { first_seen: null }), LOAD('H2', { first_seen: null })],
  });
  assert.equal(kolonsuz.trafficStats.ready, true, 'kolon yokken trafik sorgusu dustu');
  assert.equal(hucre(kolonsuz).traffic.state, 'unknown', 'pencere bilinmeden "yuk yok" denmis');
  assert.deepEqual(hucre(kolonsuz).traffic.kismi, ['pencere-bilinmiyor']);
  const trf = SORGULAR.find((s) => s.includes('FROM dbo.Nginx_Spa_Traffic') && s.includes('req_7d'));
  assert.match(trf, /CAST\(NULL AS NVARCHAR\(20\)\) AS first_seen/);
});

test('T6 okunamayan mirror (LOADERR host|vhost) hucreye ULASIR -> idle DEGIL', async () => {
  // Eskiden LOADERR satiri (service/env/location NULL) '||' anahtarina yaziliyordu: H2
  // okunamazken H1'in 0'i "yuk yok" gosteriliyordu.
  const j = await getir({ config: [CFG('H1'), CFG('H2')], trafik: [LOAD('H1'), LOADERR('H2', 'GLOMO-PROD')] });
  const t = hucre(j).traffic;
  assert.equal(t.state, 'unknown', 'okunamayan mirror sessizce yok sayildi');
  assert.equal(t.unknownHosts, 1);
  // Tanimin bir sunucusunun hic satiri yok -> yine "yok" denmez.
  const eksik = await getir({ config: [CFG('H1'), CFG('H2')], trafik: [LOAD('H1')] });
  assert.equal(hucre(eksik).traffic.state, 'unknown');
  assert.equal(hucre(eksik).traffic.missingHosts, 1);
});

test('T7 host kipi satirlari ve kovalar hucreye yazilmaz, "olcum var" saymaz', async () => {
  const hk = [
    { ...LOAD('H1', { service: null, env: null, location: '@kart.irp.local', req_7d: 900 }), vhost: 'kart-app-v1-kart-prod' },
    { ...LOAD('H1', { service: null, env: null, location: '@_', req_7d: 240 }), vhost: '_' },
    { ...LOAD('H1', { service: null, env: null, location: '@', req_7d: null, error: "server_name'de tam ad yok" }), vhost: 'wild' },
  ];
  const yalniz = await getir({ config: [CFG('H1')], trafik: hk });
  assert.equal(yalniz.trafficStats.ready, false, 'yalniz host kipi satiri "yuk olcumu var" sayildi');
  assert.equal(hucre(yalniz).traffic, null);
  const karisik = await getir({ config: [CFG('H1')], trafik: [...hk, LOAD('H1')] });
  assert.equal(hucre(karisik).traffic.state, 'idle');
  assert.equal(hucre(karisik).traffic.req7, 0, 'host kipi / kova sayisi location tanimina eklendi');
  const trf = SORGULAR.find((s) => s.includes('FROM dbo.Nginx_Spa_Traffic') && s.includes('req_7d'));
  assert.match(trf, /location NOT LIKE '@%'/, 'host kipi satirlari SQL de suzulmuyor');
});

test('T8 hucrede birden cok location: biri yuk aliyorsa "yuk var", biri kismi ise "?"', async () => {
  const cfg = [CFG('H1', { location_path: '/a/' }), CFG('H1', { location_path: '/b/' })];
  const a = await getir({
    config: cfg,
    trafik: [LOAD('H1', { location: '/a/' }), LOAD('H1', { location: '/b/', req_7d: 30 })],
  });
  assert.equal(hucre(a).traffic.state, 'active', '/b/ yuk alirken hucre "yuk yok" dedi');
  assert.equal(hucre(a).traffic.locations, 2);
  const k = await getir({
    config: cfg,
    trafik: [LOAD('H1', { location: '/a/' }), LOAD('H1', { location: '/b/', first_seen: ROT3 })],
  });
  assert.equal(hucre(k).traffic.state, 'unknown');
  assert.equal(k.trafficStats.idle, 0);

  // Dogrulama bulgusu (2026-10-02): HIC olculmeyen location birlesimde ATILIYORDU. /a/ yalniz
  // H1'de (8 gun, 0 istek), /b/ yalniz o gun satiri olmayan H2'de: hucre "yuk yok - atil aday".
  const cfg2 = [CFG('H1', { location_path: '/a/' }), CFG('H2', { location_path: '/b/' })];
  const s1 = await getir({ config: cfg2, trafik: [LOAD('H1', { location: '/a/' })] });
  const t1 = hucre(s1).traffic;
  assert.equal(t1.state, 'unknown', 'olculmeyen /b/ atildi, hucre "yuk yok" oldu');
  assert.deepEqual(t1.kismi, ['satirsiz-sunucu']);
  assert.equal(t1.missingHosts, 1);
  assert.equal(s1.trafficStats.idle, 0, 'olculmeyen location "yuk yok" sayisina girdi');
  // Olculmeyen location iki sunucuda tanimli: ikisi de "olcum satiri olmayan" sayilir.
  const s1b = await getir({
    config: [...cfg2, CFG('H3', { location_path: '/b/' })],
    trafik: [LOAD('H1', { location: '/a/' })],
  });
  assert.equal(hucre(s1b).traffic.missingHosts, 2, 'olculmeyen tanimin sunuculari sayilmadi');
  // '^~ /b/' yazili location: betik '/b/' olarak olcer; anahtar onekiz kurulur -> olcum hucreye ulasir.
  const cfg3 = [CFG('H1', { location_path: '/a/' }), CFG('H1', { location_path: '^~ /b/' })];
  const s2 = await getir({
    config: cfg3,
    trafik: [LOAD('H1', { location: '/a/' }), LOAD('H1', { location: '/b/', req_7d: 500 })],
  });
  assert.equal(hucre(s2).traffic.state, 'active', "'^~ /b/' tanimi /b/ olcumune baglanmadi");
  assert.equal(hucre(s2).traffic.req7, 500);
  // Hucrede tek location ve hic olcum yok -> null kalir (uydurma yok).
  const s3 = await getir({ config: [CFG('H2')], trafik: [LOAD('H1', { location: '/baska/' })] });
  assert.equal(hucre(s3).traffic, null);
});

test('T9 ekran: kisa pencere etiketi ortak modulden, "yuk ?" yalniz log okunamayinca', () => {
  // Metnin kendisi vitest'te (yukPencere.test.ts); burada baglanti. Bicimlendiriciden
  // bagimsiz (guard-text normalize): prettier satir bolse / tirnak degistirse de tutar.
  const { normalize } = require('../../util/guard-text.cjs');
  const ui = normalize(PAGE);
  assert.match(ui, /import \{[^}]*\bkismiEtiket\b[^}]*\} from '@\/components\/denetim\/yukPencere'/);
  assert.match(ui, /label: kismi \|\| 'yük \?'/, 'rozet kisa pencereyi "yuk ?" diye gosteriyor');
  // Sunucu kurali TEK yerde: denetim.cjs kendi esik/pencere hesabini yapmamali.
  assert.ok(!/sampled \? 'unknown' : 'idle'/.test(normalize(SRC)), 'eski karar geri gelmis');
});
