// server/audit/__tests__/nginx-migration-traffic.test.cjs — Production Tasimalari'nda yuk gostergesi.
//
// Kullanici (2026-09-27): "yuk alip almama gostergesini Production Tasimalari sayfasina da
// ekler misin? yuk alimini GBRVPP07-08-09-10 sunucularindan kontrol etmelisin."
//
// MT1 olcum ESKI sunuculardan alinir; yeni sunucu satiri karismaz
// MT2 uc durum: active / idle / unknown - olcememek "yuk yok" DEGIL
// MT3 mirror sunucular TOPLANIR, okunamayan sunucu "yuk yok" yapmaz
// MT4 olcum satiri yoksa null - ekran uydurmaz
// MT7..MT11 (2026-10-02): kisa pencere / first_seen yok / okunamayan ya da satirsiz mirror
//   "yuk almiyor" DEGIL; host kipi satirlari karismaz; loadMigration sorgu baglantisi.
//   Kuralin kendisi: spa-traffic-pencere.test.cjs (ortak spaTrafikDurumu).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildMigration, loadMigration, MIGRATION_GROUPS } = require('../nginx-migration.cjs');

// GLOMO grubunun eski sunucularindan biri + yeni filodan biri.
const ESKI = 'GBRVPP07';
const ESKI2 = 'GBRVPP08';
const YENI = 'GBNGXP40';
// Tarama gunu ve olculen pencerenin basi: TAM = 8 gun (>= 7: "yok" denebilir),
// ROT3 = gunluk rotasyonlu hostta ~3 gun (2 gun 20 saat).
const GUN = '2026-10-02';
const TAM = '20260924000000';
const ROT3 = '20260929031500';

// Eski sunucuda bir proxy_pass location'i: tasima gorunumune girmesi icin sart.
function proxy(host, location, target) {
  return {
    host, vhost: 'GLOMO-PROD.conf', service: 'GLOMO', location,
    kind: 'proxy', upstream_name: null, target_url: target, upstream_defined: 1,
  };
}

const ROUTES = [{ namespace_name: 'glomo-prod', route_address: 'base-app-v0-glomo-prod.apps.fw.garanti.com.tr' }];
const OCP = [{ namespace: 'glomo-prod', application: 'base-app-v0' }];

function kur(trafficRows) {
  return buildMigration({
    proxyRows: [proxy(ESKI, '/base/', 'https://base-app-v0-glomo-prod.apps.fw.garanti.com.tr/')],
    upstreamRows: [], routeRows: ROUTES, ocpRows: OCP, dirRows: [], newLocRows: [],
    trafficRows,
    groups: MIGRATION_GROUPS.filter((g) => g.id === 'glomo'),
  });
}

const yolOf = (groups) => {
  const g = groups.find((x) => x.id === 'glomo');
  const a = (g.apps || []).find((x) => x.application === 'base-app-v0');
  assert.ok(a, 'uygulama tasima gorunumunde yok');
  return a.paths[0];
};

// Varsayilan: log 7 gunden uzun bir pencereyi kapsiyor (first_seen TAM) - "idle" ancak boyle.
const satir = (host, over = {}) => ({
  host, service: 'GLOMO', env: 'PROD', location: '/base/',
  req_24h: 0, req_7d: 0, hc_24h: 0, sampled: 0, last_seen: null, error: null,
  first_seen: TAM, scan_date: GUN, ...over,
});

test('MT1 olcum ESKI sunuculardan alinir; YENI sunucu satiri karismaz', () => {
  // Yeni sunucuda tanim yeni olustugu icin log kisadir; oraya bakmak "yuk yok" derdi.
  // Kullanici kurali: olcum isin GERCEKTEN aktigi eski sunuculardan.
  const yalnizYeni = yolOf(kur([satir(YENI, { req_7d: 5000, req_24h: 700 })]));
  assert.equal(yalnizYeni.traffic, null, 'yeni sunucu satiri olcume karismis');

  const eski = yolOf(kur([satir(ESKI, { req_7d: 5000, req_24h: 700, last_seen: '20260927101500' })]));
  assert.ok(eski.traffic, 'eski sunucu satiri okunmamis');
  assert.equal(eski.traffic.state, 'active');
  assert.equal(eski.traffic.req7, 5000);
  assert.equal(eski.traffic.lastSeen, '20260927101500');

  // Ikisi birden geldiginde YALNIZ eski sayilir.
  const ikisi = yolOf(kur([
    satir(ESKI, { req_7d: 10, req_24h: 2 }),
    satir(YENI, { req_7d: 9999, req_24h: 999 }),
  ]));
  assert.equal(ikisi.traffic.req7, 10, 'yeni sunucunun sayisi toplama girmis');
  assert.equal(ikisi.traffic.hosts, 1);
});

test('MT2 uc durum: olcememek "yuk yok" DEGIL', () => {
  assert.equal(yolOf(kur([satir(ESKI, { req_7d: 1 })])).traffic.state, 'active');

  // Log OKUNDU, 7 gunun tamami kapsandi ve istek yok -> gercekten atil.
  assert.equal(yolOf(kur([satir(ESKI, { req_7d: 0 })])).traffic.state, 'idle');

  // Log okunamadi -> BILINMIYOR. "idle" demek, olculemeyen bir seyi iddia etmek olurdu.
  const hata = yolOf(kur([satir(ESKI, { error: 'log bulunamadi' })]));
  assert.equal(hata.traffic.state, 'unknown');
  assert.equal(hata.traffic.req7, null, 'okunamayan sunucuya sayi yazilmis');
  assert.equal(hata.traffic.unknownHosts, 1);

  // Ornekleme 7 gunu kapsamiyorsa req7 ALT SINIRDIR: 0 gorsek bile "atil" DEMEYIZ.
  const kismi = yolOf(kur([satir(ESKI, { req_7d: 0, sampled: 1 })]));
  assert.equal(kismi.traffic.state, 'unknown');
  assert.equal(kismi.traffic.sampled, true);

  // Saglik kontrolu YUK DEGILDIR: yalniz hc varsa atil sayilir.
  const sadeceHc = yolOf(kur([satir(ESKI, { req_7d: 0, hc_24h: 8640 })]));
  assert.equal(sadeceHc.traffic.state, 'idle');
  assert.equal(sadeceHc.traffic.hc24, 8640);
});

test('MT3 mirror sunucular TOPLANIR; okunamayan sunucu "yuk yok" yapmaz', () => {
  const t = yolOf(kur([
    satir(ESKI, { req_7d: 100, req_24h: 10, last_seen: '20260926080000' }),
    satir(ESKI2, { req_7d: 40, req_24h: 4, last_seen: '20260927090000' }),
  ])).traffic;
  assert.equal(t.req7, 140, 'mirror sunucular toplanmamis');
  assert.equal(t.req24, 14);
  assert.equal(t.hosts, 2);
  assert.equal(t.lastSeen, '20260927090000', 'son istek EN YENI olmali');

  // Biri okunamadi ama otekinde yuk var: durum ACTIVE kalir, okunamayan sayilir.
  const karma = yolOf(kur([
    satir(ESKI, { req_7d: 7 }),
    satir(ESKI2, { error: 'izin yok' }),
  ])).traffic;
  assert.equal(karma.state, 'active');
  assert.equal(karma.hosts, 1);
  assert.equal(karma.unknownHosts, 1, 'okunamayan sunucu bildirilmiyor');
});

test('MT4 olcum satiri yoksa null - ekran uydurmaz', () => {
  assert.equal(yolOf(kur([])).traffic, null);
  assert.equal(yolOf(kur(undefined)).traffic, null);
  // Baska bir location'in olcumu bu yola yazilmamali.
  assert.equal(yolOf(kur([satir(ESKI, { location: '/baska/', req_7d: 999 })])).traffic, null);
  // Baska servisin olcumu de karismamali.
  assert.equal(yolOf(kur([satir(ESKI, { service: 'WEBFORMS', req_7d: 999 })])).traffic, null);
});

test('MT5 "olculemedi" IKI sebebi ayirt edilebilir olmali', () => {
  // Kullanici (2026-09-27): "tum uygulamalar icin '? olculemedi' yaziyor". Iki sebep var
  // ve cozumleri TAMAMEN farkli; ekran ikisini ayni gosterirse teshis imkansizlasir:
  //   hosts === 0        -> log okunamadi (izin / yol / dosya yok)
  //   sampled && hosts>0 -> log kuyrugu 7 gunu kapsamiyor (LOG_TAIL_MB kucuk)
  const okunamadi = yolOf(kur([satir(ESKI, { error: 'log bulunamadi' })])).traffic;
  assert.equal(okunamadi.state, 'unknown');
  assert.equal(okunamadi.hosts, 0, 'log okunamadi durumu hosts=0 ile ayirt edilir');
  assert.equal(okunamadi.unknownHosts, 1);

  const kismi = yolOf(kur([satir(ESKI, { req_7d: 0, sampled: 1 })])).traffic;
  assert.equal(kismi.state, 'unknown');
  assert.ok(kismi.hosts > 0, 'kismi olcumde log OKUNDU');
  assert.equal(kismi.sampled, true);

  // Ekran ikisine AYRI etiket vermeli.
  const fs = require('node:fs');
  const path = require('node:path');
  const ui = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8');
  assert.match(ui, /log okunamadı/, 'log okunamadi etiketi yok');
  assert.match(ui, /kısmi ölçüm/, 'kismi olcum etiketi yok');
  assert.match(ui, /function yukEtiket/, 'etiket ayrimi yapilmiyor');
});

test('MT6 kismi olcumde OLCULEN PENCERE bildirilir, yorumlanabilir olur', () => {
  // Kullanici (2026-09-27): "'? kismi olcum' yazanlar var, bunlari tam anlamlandiramiyorum".
  // Eksik bilgi olcumun GERCEKTEN kac gunu kapsadigiydi: log kuyrugu 7 gunu kapsamiyorsa
  // "0 istek" atil DEMEK DEGIL - yalnizca o kadar gunde istek gorulmedi demek.
  const t = yolOf(kur([satir(ESKI, { req_7d: 0, sampled: 1, first_seen: '20260925120000' })])).traffic;
  assert.equal(t.state, 'unknown');
  assert.equal(t.firstSeen, '20260925120000', 'olculen pencerenin basi tasinmiyor');

  // Mirror sunucularda EN DAR pencere alinir (en YENI first_seen): ESKI2 6 gun gormus olsa da
  // ESKI yalniz 1 gun gordu; kalan 5 gunde ESKI'ye gelen istek bilinmez. (2026-10-02'ye kadar
  // bu test EN ESKIYI istiyordu - "7 gun olctuk" yalaninin TA KENDISI; kural ters cevrildi.)
  const iki = yolOf(kur([
    satir(ESKI, { req_7d: 0, sampled: 1, first_seen: '20260926000000' }),
    satir(ESKI2, { req_7d: 0, sampled: 1, first_seen: '20260921000000' }),
  ])).traffic;
  assert.equal(iki.firstSeen, '20260926000000', 'en ESKI pencere alinmis - "7 gun olctuk" yalani');
  assert.equal(iki.pencereSaat, 144);

  // Eski tarama bu alani basmaz: null kalir, ekran "kac gun" DEMEZ ama patlamaz.
  const eskiTarama = yolOf(kur([satir(ESKI, { req_7d: 0, sampled: 1, first_seen: null })])).traffic;
  assert.equal(eskiTarama.firstSeen, null);
  assert.equal(eskiTarama.pencereSaat, null);

  // ETIKET metni ortak modulde (yukPencere.ts; davranisi vitest'te). Ekran onu kullanmali ve
  // pencere bilinmiyorsa SURE UYDURMAMALI (tarayici saatiyle hesap kaldirildi).
  const fs = require('node:fs');
  const path = require('node:path');
  const { normalize } = require('../../util/guard-text.cjs');
  const ui = normalize(fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8'));
  assert.match(ui, /import \{[^}]*\bkismiEtiket\b[^}]*\} from '\.\/yukPencere'/);
  assert.match(ui, /return kismiEtiket\(t\) \|\| 'kısmi ölçüm';/, 'etiket ortak modulden gelmiyor');
  assert.ok(!/Date\.now\(\) - bas/.test(ui), 'sure yine tarayici saatiyle hesaplaniyor');
  // "Yazim" sutunu kaldirildi (kullanici istegi) ve geri gelmemeli.
  assert.ok(!/>Yazım</.test(ui), 'Yazim sutunu geri gelmis');
  assert.ok(!/FormCell/.test(ui), 'FormCell olu kod olarak kalmis');
});

// ── 2026-10-02: KISA PENCERE / OKUNAMAYAN MIRROR / HOST KIPI ─────────────────────────────
// Gercek analyzer bicimiyle: eski sunucularin vhost adi '.conf'suz (GLOMO-PROD) ve LOADERR
// satiri service/env/location NULL.
function proxy2(host) {
  return { ...proxy(host, '/base/', 'https://base-app-v0-glomo-prod.apps.fw.garanti.com.tr/'), vhost: 'GLOMO-PROD' };
}
function kur2(hosts, trafficRows) {
  return buildMigration({
    proxyRows: hosts.map(proxy2),
    upstreamRows: [], routeRows: ROUTES, ocpRows: OCP, dirRows: [], newLocRows: [],
    trafficRows,
    groups: MIGRATION_GROUPS.filter((g) => g.id === 'glomo'),
  });
}
const loaderr = (host, vhost) => ({
  host, vhost, service: null, env: null, location: null,
  req_24h: null, req_7d: null, hc_24h: null, sampled: 0, last_seen: null,
  error: 'log www ile okunamiyor: /web_log/glomo.log', first_seen: null, scan_date: GUN,
});

test('MT7 gunluk rotasyon: tum dosyalar okundu, sampled=0, pencere ~3 gun -> idle DEGIL', () => {
  const t = yolOf(kur([satir(ESKI, { first_seen: ROT3 })])).traffic;
  assert.equal(t.state, 'unknown', '3 gunluk olcum "yuk almiyor" gosteriliyor');
  assert.deepEqual(t.kismi, ['pencere']);
  assert.equal(t.pencereSaat, 68);
  assert.equal(t.sampled, false);
  // Kisa pencerede istek gorulduyse yuk VARDIR.
  assert.equal(yolOf(kur([satir(ESKI, { first_seen: ROT3, req_7d: 2 })])).traffic.state, 'active');
});

test('MT8 first_seen yok (eski analyzer) -> idle DEGIL, pencere bilinmiyor', () => {
  const t = yolOf(kur([satir(ESKI, { first_seen: null })])).traffic;
  assert.equal(t.state, 'unknown');
  assert.deepEqual(t.kismi, ['pencere-bilinmiyor']);
});

test('MT9 okunamayan / satirsiz mirror: tanimin bir sunucusu olculmediyse idle DEGIL', () => {
  // Iki eski sunucuda tanimli; ESKI2'nin logu okunamadi (LOADERR host|vhost).
  const ok = yolOf(kur2([ESKI, ESKI2], [satir(ESKI), loaderr(ESKI2, 'GLOMO-PROD')])).traffic;
  assert.equal(ok.state, 'unknown', 'okunamayan mirror sessizce yok sayildi');
  assert.equal(ok.unknownHosts, 1);
  assert.ok(ok.kismi.includes('okunamayan-sunucu'));
  // ESKI2'nin o gun hic satiri yok (zaman asimi).
  const yok = yolOf(kur2([ESKI, ESKI2], [satir(ESKI)])).traffic;
  assert.equal(yok.state, 'unknown');
  assert.equal(yok.missingHosts, 1);
  // Ikisi de tam olculdu -> idle.
  assert.equal(yolOf(kur2([ESKI, ESKI2], [satir(ESKI), satir(ESKI2)])).traffic.state, 'idle');
  // Baska vhost'un hatasi bu tanimi etkilemez.
  assert.equal(
    yolOf(kur2([ESKI], [satir(ESKI), loaderr(ESKI, 'WEBFORMS-PROD')])).traffic.state,
    'idle',
  );
});

test('MT10 host kipi satirlari ve kovalar tasima olcumune KARISMAZ', () => {
  const hk = [
    { ...satir(ESKI, { service: null, env: null, location: '@base.irp.local', req_7d: 900 }), vhost: 'base-app-v0-glomo-prod' },
    { ...satir(ESKI, { service: 'GLOMO', env: null, location: '@_', req_7d: 50 }), vhost: '_' },
    { ...satir(ESKI, { service: 'GLOMO', location: '/base/', req_7d: 70 }), vhost: '_' },
  ];
  const t = yolOf(kur([...hk, satir(ESKI)])).traffic;
  assert.equal(t.state, 'idle');
  assert.equal(t.req7, 0, 'kova / host kipi sayisi tanima eklendi');
  assert.equal(yolOf(kur(hk)).traffic, null, 'yalniz host kipi satiri varken olcum uyduruldu');
});

/**
 * Sahte MSSQL: SQL Server'in iki davranisini taklit eder - (1) kolon YOKKEN adini yazan
 * sorgu derleme aninda duser, (2) WHERE'deki host kipi suzgeci uygulanir.
 */
function sahteDb({ fs = 40, trafik = [] } = {}) {
  const sorgular = [];
  const query = async (text) => {
    const t = String(text);
    sorgular.push(t);
    const rs = (recordset) => ({ recordset });
    if (t.includes("OBJECT_ID('dbo.Nginx_Spa_Traffic')")) return rs([{ trf: 1, fs }]);
    if (t.includes('FROM dbo.Nginx_Spa_Traffic')) {
      if (!fs && /first_seen/.test(t.replace(/AS first_seen/g, '')))
        throw new Error("Invalid column name 'first_seen'.");
      const suz = t.includes("location NOT LIKE '@%'");
      return rs(trafik.filter((r) => !suz || !String(r.location || '').startsWith('@')));
    }
    if (t.includes('MAX(scan_date), 23) AS d')) return rs([{ d: GUN }]);
    if (t.includes("kind = 'proxy'")) return rs([proxy2(ESKI)]);
    if (t.includes('BMW_Openshift_Route_Inventory')) return rs(ROUTES);
    if (t.includes('FROM dbo.Openshift_Inventory')) return rs(OCP);
    return rs([]);
  };
  const sql = new Proxy({}, { get: () => () => 'tip' });
  return { query, sql, sorgular };
}
const yuklenen = async (db) => {
  const r = await loadMigration({ query: db.query, sql: db.sql, hasProxyColumns: async () => true });
  return { r, yol: yolOf(r.groups) };
};

test('MT11 loadMigration: first_seen kolonu YOKKEN sorgu dusmez, durum idle OLMAZ', async () => {
  // Eskiden CASE WHEN COL_LENGTH kalibi vardi: kolon yokken SQL Server onu da derleme aninda
  // dusurur, catch [] doner ve gosterge SESSIZCE kaybolurdu.
  const kolonsuz = sahteDb({ fs: null, trafik: [satir(ESKI, { first_seen: undefined })] });
  const a = await yuklenen(kolonsuz);
  assert.equal(a.r.trafficReady, true, 'kolon yokken trafik okunamadi');
  assert.equal(a.yol.traffic.state, 'unknown', 'pencere bilinmeden "yuk almiyor" denmis');
  assert.deepEqual(a.yol.traffic.kismi, ['pencere-bilinmiyor']);

  const kolonlu = sahteDb({ fs: 40, trafik: [satir(ESKI)] });
  const b = await yuklenen(kolonlu);
  assert.equal(b.yol.traffic.state, 'idle', 'tam pencerede gercek 0 idle olmali');
  const trf = kolonlu.sorgular.find((t) => t.includes('FROM dbo.Nginx_Spa_Traffic') && t.includes('req_7d'));
  assert.match(trf, /location NOT LIKE '@%'/, 'host kipi satirlari SQL de suzulmuyor');
  assert.match(trf, /scan_date, 23\) AS scan_date/, 'pencere icin scan_date secilmiyor');
  assert.match(trf, /AND host IN \(@o0/, 'yalniz eski sunucular okunmali');
});

test('MT12 loadMigration: yalniz host kipi satiri varken trafficReady YANLIS', async () => {
  const hk = [{ ...satir(ESKI, { service: null, env: null, location: '@base.irp.local', req_7d: 5 }), vhost: 'x' }];
  // SQL suzgeci olmasa bile (sahte DB'ye dogrudan) JS suzgeci "olcum var" demez.
  const db = sahteDb({ trafik: hk });
  const sorgu = db.query;
  db.query = async (t) => (String(t).includes('FROM dbo.Nginx_Spa_Traffic') && String(t).includes('req_7d')
    ? { recordset: hk }
    : sorgu(t));
  const { r, yol } = await yuklenen(db);
  assert.equal(r.trafficReady, false, 'host kipi satiri "yuk olcumu var" sayildi');
  assert.equal(yol.traffic, null);
});

test('MT13 uygulama ozeti: HIC olculmeyen yol "yuk almiyor" bandina dusurmez (ekran baglantisi)', () => {
  // Dogrulama bulgusu (2026-10-02): yukOzet null yolu atiyordu; /base/ 7 gun olculmus 0 ve
  // /base2/ hic olculmemisken uygulama "yuk almiyor" (bant 3) gorunuyordu. Kural ortak
  // modulde (yukPencere.yolYukOzeti; davranisi vitest yukPencere.test.ts). Burada baglanti.
  const fs = require('node:fs');
  const path = require('node:path');
  const { normalize } = require('../../util/guard-text.cjs');
  const ui = normalize(fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8'));
  assert.match(ui, /import \{[^}]*\byolYukOzeti\b[^}]*\} from '\.\/yukPencere'/);
  assert.match(ui, /function yukOzet\(paths: NginxMigrationApp\['paths'\]\): YukBilgi \{ return yolYukOzeti\(paths\); \}/,
    'ekran uygulama ozetini ortak kuraldan almiyor');
  assert.ok(!/\.filter\(Boolean\) as NonNullable<YukBilgi>/.test(ui), 'olculmeyen yolu atan eski ozet geri gelmis');
});
