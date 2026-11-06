// server/server-hub/__tests__/retire-etiket.test.cjs - Server Hub retirement kurallari ve etiketleri (2026-11-06).
//
// Kullanici: "jvm kapali auto start acik ise kritik"; "jvm kapali auto start acik trafik yoksa kritik ve
// retirement etiketi"; "jvm kapali auto start kapali trafik var yani ihs acik ise retirement etiketi";
// "JVM ayakta ancak parametrelerde degisiklik varsa kritik"; EAR var WAR yok, .ear ile bitmeyen girdi,
// EAR var JVM yok bulgulari; "retiere etiketi ayri olsun bulgular ayri olsun ... admin tarafindan
// editlenebilir olsun"; eslenik durumuna gore inceleme; "Manuel kontrol de gerekecek".
//
//   RE1  JVM kurallari: STOPPED_AUTOSTART_ON kritik; JVM_PARAM_FARKI yalniz calisan + fark=1 (0 / 2 /
//        kapali / olculemeyen JVM'de yok)
//   RE2  EAR bulgulari: WAR yok yalniz TAM taramada; JVM yok uc nedenle ayri metin; okunamayan XML neden
//        basina tek bulgu ve "JVM yok" sayilmaz; kok girdileri kok basina, yok sayma listesi (buyuk/kucuk
//        harf duyarsiz, Admin listesi varsayilanin yerine gecer); kesik liste yazilir
//   RE3  EAR verisi eski (35 gun ustu) / okunamadi / yok -> bulgu ve aday YOK, h.ear nedeni tasir
//   RE4  adaylar bulgudan ayri: R1 / R2 / R3 / R4 / R5; calisan JVM aday degil; engelli R1 yine aday
//   RE5  etiket motoru: R1 KESIN; eslenik kopya calisiyor / trafik olculemedi / engel / bayat -> SUPHELI ve
//        NEDEN; baska ortam etkilemez; JBoss 8 kopyasi not, etiketi dusurmez; R2 SUPHELI; EAR konusu
//        kopyada WAR varsa dusurulur
//   RE6  Admin kural seviyesi: KAPALI etiket uretmez; SUPHELI -> KESIN; gecersiz ayar satiri yok sayilir
//   RE7  manuel kontrol: ayni imza -> karar; imza degisince VERI_DEGISTI; yalniz KESIN + DOGRULANDI
//        retirement'a hazir; kayitlar okunamadi -> BILINMIYOR; imza istek sayisiyla degismez, durumla degisir
//   RE8  ear-hub-verisi: son kosu, JSON ayristirma, bozuk JSON null, DB hatasi okunamadi
//   RE9  katalog: her etiket kurali ve retire ile ilgili kod uc parcali dogrulama tasir
//   RE10 uclar (GERCEK initServerHub): GET /retire-etiketleri; PUT /retire-kontrol 400 / 409 (etiket yok,
//        imza eski) / 424 (kayitlar okunamadi) / 200 + gecmis + denetim; PUT /kurallar/etiket gerekce
//        zorunlu; PUT /kurallar/kok-yoksay gecersiz ad / 256 karakter -> 400, gecerli liste bulguyu kaldirir
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

// ── sahte Portal DB: ayarlar, Uygulama Envanteri, manuel kontrol ──────────────────────────────
const DB = {
  ayar: new Map(),
  kontrol: new Map(),
  kgecmis: [],
  earH: [],
  earU: [],
  earDus: false,
  kontrolDus: false,
};
const N = (s) => String(s).replace(/\s+/g, ' ').trim();
stub('../../db/index.cjs', {
  query: async (sql, p = []) => {
    const s = N(sql);
    if (
      s.startsWith(
        'SELECT anahtar, deger, aciklama, updated_by, updated_at FROM server_hub_ayarlar',
      )
    )
      return { rows: [...DB.ayar.values()] };
    if (s.includes('FROM ear_envanter_hostlari h JOIN son')) {
      if (DB.earDus) throw new Error("Invalid column name 'kok_girdileri'.");
      return { rows: DB.earH };
    }
    if (s.includes('FROM ear_envanter_uygulamalari u JOIN son')) return { rows: DB.earU };
    if (
      s.startsWith(
        'SELECT anahtar, sonuc, aciklama, imza, seviye, isaretleyen, isaretlendi FROM server_hub_retire_kontrol',
      )
    ) {
      if (DB.kontrolDus) throw new Error('baglanti yok');
      return { rows: [...DB.kontrol.values()] };
    }
    if (
      s.startsWith('SET XACT_ABORT ON;') &&
      s.includes('INSERT INTO server_hub_retire_kontrol_gecmisi')
    ) {
      const [anahtar, sonuc, aciklama, imza, seviye, kim] = p;
      if (s.includes('DELETE FROM server_hub_retire_kontrol WHERE anahtar = $1'))
        DB.kontrol.delete(anahtar);
      else
        DB.kontrol.set(anahtar, {
          anahtar,
          sonuc,
          aciklama,
          imza,
          seviye,
          isaretleyen: kim,
          isaretlendi: new Date(),
        });
      DB.kgecmis.push({
        id: DB.kgecmis.length + 1,
        anahtar,
        sonuc,
        aciklama,
        seviye,
        isaretleyen: kim,
        zaman: new Date(),
      });
      return { rows: [] };
    }
    if (
      /^SELECT TOP \d+ anahtar, sonuc, aciklama, seviye, isaretleyen, zaman FROM server_hub_retire_kontrol_gecmisi/.test(
        s,
      )
    )
      return { rows: [...DB.kgecmis].reverse().filter((r) => !p[0] || r.anahtar === p[0]) };
    if (s.startsWith('SET XACT_ABORT ON;') && s.includes('server_hub_ayarlar')) {
      const [anahtar, yeni, aciklama, kim, varsayilan] = p;
      const eski = DB.ayar.get(anahtar)?.deger || varsayilan;
      if (yeni === eski) return { rows: [{ eski, yeni, degisti: 0 }] };
      if (s.includes('DELETE FROM server_hub_ayarlar')) DB.ayar.delete(anahtar);
      else
        DB.ayar.set(anahtar, {
          anahtar,
          deger: yeni,
          aciklama,
          updated_by: kim,
          updated_at: new Date(),
        });
      return { rows: [{ eski, yeni, degisti: 1 }] };
    }
    if (/server_hub_ayar_gecmisi/.test(s)) return { rows: [] };
    throw new Error(`sahte DB bilinmeyen SQL: ${s.slice(0, 120)}`);
  },
});
const sifirla = () => {
  DB.ayar.clear();
  DB.kontrol.clear();
  DB.kgecmis.length = 0;
  DB.earH = [];
  DB.earU = [];
  DB.earDus = false;
  DB.kontrolDus = false;
  require('../ayarlar.cjs').onbellekSil();
};

const { assess } = require('../assess.cjs');
const { etiketle } = require('../retire-etiket.cjs');
const { KODLAR, ETIKET_KURALLARI } = require('../kural-katalogu.cjs');
const ayarlar = require('../ayarlar.cjs');

// ── tarama fiksturleri (v2-guvenlik.test.cjs ile ayni bicim) ───────────────────────────────────
const BUGUN = '2026-11-06';
const NOW = Date.parse(`${BUGUN}T10:00:00Z`);
const APP = 'GBCJAP01';
const APP2 = 'GBCJAP02';
const TEST_APP = 'GBCJAT01';
const WEB = 'GBCJWP01';
const H3 = (host, ek = {}) => ({
  host,
  scan_date: BUGUN,
  products: '',
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
const W3 = (host) => ({
  host,
  product: 'IHS',
  running: 1,
  syntax: 'OK',
  detail: '1 vhost',
  check_class: 'OK',
  syntax_verification: 'VERIFIED',
  run_as: 'www',
  check_rc: 0,
  vhost_trust: 'FULL',
  running_src: 'PS',
});
const V3 = (host, server_name, ek = {}) => ({
  host,
  product: 'IHS',
  listen: '10.0.0.1:443',
  server_name,
  aliases: '',
  access_log: `/l/${server_name}`,
  proxy_targets: '',
  req_24h: 0,
  req_7d: 0,
  hc_24h: 3,
  shared: 0,
  sampled: 0,
  conf_file: `/c/${server_name}.conf`,
  traffic_state: 'NO_RECENT_TRAFFIC',
  traffic_reason: 'OK',
  cover_from_epoch: 1,
  last_req_epoch: null,
  last_line_epoch: null,
  log_read_as: 'www',
  ...ek,
});
const J3 = (host, jvm, ek = {}) => ({
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
const CALISAN = { running: 1, running_src: 'PS', server_state: 'running', auto_start: 'true' };
/** Durmus + auto-start acik oldapp, web katmaninda NRT/OK vhost (tam v2 kaniti). */
const r1Veri = () => ({
  hosts: [H3(APP, { products: 'JBOSS7' }), H3(WEB, { products: 'IHS' })],
  init: [],
  jboss: [],
  jvms: [J3(APP, 'oldapp', { auto_start: 'true' })],
  web: [W3(WEB)],
  vhosts: [V3(WEB, 'oldapp.bmw.local')],
  ips: [],
  sshd: [],
});
const A = (d, opts = {}) => assess(d, { now: NOW, ...opts });
const sunucu = (r, h) => r.hosts.find((x) => x.host === h);
const bul = (r, h, code) => sunucu(r, h).findings.filter((f) => f.code === code);

const taranma = (gunOnce = 0) =>
  new Date(Date.parse(`${BUGUN}T06:00:00Z`) - gunOnce * 86400000).toISOString();
const earHost = (host, uygulamalar, kokGirdileri = null, gunOnce = 0) => ({
  host,
  kosuId: 3,
  taranma: taranma(gunOnce),
  durum: 'TAM',
  kokGirdileri,
  uygulamalar,
});
const U7 = (ad, ek = {}) => ({
  kok: '/vhosting',
  jboss: '7',
  ad,
  durum: 'TAM',
  warSayisi: 1,
  xml: { durum: 'VAR', jvmler: [{ ad: 'oldapp', auto_start: true }] },
  ...ek,
});

test('RE1 STOPPED_AUTOSTART_ON kritik; JVM_PARAM_FARKI yalniz calisan JVM + fark=1', () => {
  const r = A(r1Veri());
  const so = bul(r, APP, 'STOPPED_AUTOSTART_ON');
  assert.equal(so.length, 1);
  assert.equal(so[0].severity, 'danger');
  assert.equal(KODLAR.get('STOPPED_AUTOSTART_ON').seviye, 'danger');
  const v = (ek) => {
    const d = r1Veri();
    d.jvms = [J3(APP, 'calisan', { ...CALISAN, ...ek })];
    return bul(A(d), APP, 'JVM_PARAM_FARKI');
  };
  const f = v({ jvm_arg_fark: 1 });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'danger');
  assert.match(f[0].text, /JBoss7 calisan çalışıyor ama yapılandırılan JVM parametreleri/);
  assert.equal(v({ jvm_arg_fark: 0 }).length, 0, 'fark yokken bulgu');
  assert.equal(v({ jvm_arg_fark: 2 }).length, 0, 'olculemeyen fark (reason=) bulgu sayildi');
  assert.equal(v({ jvm_arg_fark: null }).length, 0);
  assert.equal(v({}).length, 0, 'isaret yokken (eski sema) bulgu');
  assert.equal(
    v({ jvm_arg_fark: 1, running: 0, running_src: 'PS_ABSENT' }).length,
    0,
    'kapali JVM parametre farki',
  );
  assert.equal(v({ jvm_arg_fark: 1, running_src: 'UNMEASURED' }).length, 0, 'olculemeyen JVM');
  // Filo isareti: 'reason=' (tarayici karsilastiramadi) fark sayilmaz; maskJvmArgDiff ile ayni bicim.
  const { ARG_FARK_IFADE } = require('../index.cjs');
  assert.match(
    ARG_FARK_IFADE,
    /LIKE 'reason=%' OR t\.\[jvm_arg_diff\] LIKE 'partial; reason=%' THEN 2/,
  );
  assert.match(ARG_FARK_IFADE, /IS NULL OR LTRIM\(RTRIM\(t\.\[jvm_arg_diff\]\)\) = '' THEN 0/);
  assert.match(ARG_FARK_IFADE, /ELSE 1 END AS \[jvm_arg_fark\]$/);
  // Admin seviyeyi degistirebilir (katalogda).
  const d = r1Veri();
  d.jvms = [J3(APP, 'calisan', { ...CALISAN, jvm_arg_fark: 1 })];
  assert.equal(
    bul(A(d, { seviyeler: { JVM_PARAM_FARKI: 'warning' } }), APP, 'JVM_PARAM_FARKI')[0].severity,
    'warning',
  );
});

test('RE2 EAR bulgulari: WAR yok, JVM yok (3 neden), XML okunamadi, kok girdileri ve yok sayma', () => {
  const d = r1Veri();
  const OK = '/usr/jboss/AppServer domain.xml IZIN';
  d.ear = {
    okunamadi: false,
    hostlar: [
      earHost(
        APP,
        [
          U7('BOS.ear', { warSayisi: 0 }),
          U7('KISMI.ear', { durum: 'KISMI_SINIR', warSayisi: 0 }),
          U7('TANIMSIZ.ear', {
            xml: { durum: 'JVM_YOK', neden: 'TANIM_YOK', deploymentlar: [], jvmler: [] },
          }),
          U7('GRUPSUZ.ear', {
            xml: {
              durum: 'JVM_YOK',
              neden: 'GRUPTA_YOK',
              deploymentlar: [{ ad: 'grupsuz-dep', gruplar: [] }],
              jvmler: [],
            },
          }),
          U7('SUNUCUSUZ.ear', {
            xml: {
              durum: 'JVM_YOK',
              neden: 'SUNUCU_YOK',
              deploymentlar: [{ ad: 'S.ear', gruplar: [{ ad: 's-grp' }] }],
              jvmler: [],
            },
          }),
          U7('O1.ear', { xml: { durum: 'OLCULEMEDI', neden: OK } }),
          U7('O2.ear', { xml: { durum: 'OLCULEMEDI', neden: OK } }),
          U7('ESKITARAYICI.ear', { xml: null }),
        ],
        {
          girdiler: [
            { kok: '/vhosting', ad: 'ODEME.ear.bak', tip: 'F' },
            { kok: '/vhosting', ad: 'onceki', tip: 'L', hedef: 'ODEME.ear' },
            { kok: '/vhosting', ad: 'scripts', tip: 'D' },
            { kok: '/vhosting', ad: 'Logs', tip: 'D' },
            { kok: '/vhosting8', ad: 'ESKI.war', tip: 'F' },
          ],
          kesilen: 2,
        },
      ),
    ],
  };
  const r = A(d);
  const w = bul(r, APP, 'EAR_WAR_YOK');
  assert.deepEqual(
    w.map((f) => f.ear.ad),
    ['BOS.ear'],
    'WAR yok yalniz TAM taramada',
  );
  assert.equal(w[0].severity, 'warning');
  assert.equal(w[0].area, 'ear');
  const j = Object.fromEntries(bul(r, APP, 'EAR_JVM_YOK').map((f) => [f.ear.ad, f.text]));
  assert.deepEqual(Object.keys(j).sort(), ['GRUPSUZ.ear', 'SUNUCUSUZ.ear', 'TANIMSIZ.ear']);
  assert.match(j['TANIMSIZ.ear'], /deployment tanımı yok/);
  assert.match(j['GRUPSUZ.ear'], /grupsuz-dep.*hiçbir server-group'a atanmamış/);
  assert.match(j['SUNUCUSUZ.ear'], /s-grp.*bu sunucuda JVM'i yok/);
  const o = bul(r, APP, 'EAR_XML_OLCULEMEDI');
  assert.equal(o.length, 1, 'ayni nedenle okunamayanlar tek bulgu');
  assert.match(
    o[0].text,
    /2 EAR'ın JVM eşlemesi yapılamadı \("JVM yok" sayılmaz\): O1\.ear, O2\.ear/,
  );
  assert.ok(
    !bul(r, APP, 'EAR_JVM_YOK').some((f) => /ESKITARAYICI|O1/.test(f.text)),
    'olculmeyen eslesme JVM yok sayildi',
  );
  const k = bul(r, APP, 'KOK_EAR_DISI');
  assert.deepEqual(
    k.map((f) => f.ear.kok).sort(),
    ['/vhosting', '/vhosting8'],
    'kok basina tek bulgu',
  );
  const k7 = k.find((f) => f.ear.kok === '/vhosting');
  assert.deepEqual(
    k7.ear.girdiler.map((g) => g.ad),
    ['ODEME.ear.bak', 'onceki'],
    'scripts ve Logs (buyuk harf) yok sayilmali',
  );
  assert.match(k7.text, /onceki \(bağ → ODEME\.ear\)/);
  assert.match(k7.text, /liste kesik: 2 girdi daha/);
  // Admin listesi varsayilanin YERINE gecer: 'scripts' artik yok sayilmaz.
  const r2 = A(d, { kokYoksay: ['onceki'] });
  assert.deepEqual(
    bul(r2, APP, 'KOK_EAR_DISI')
      .find((f) => f.ear.kok === '/vhosting')
      .ear.girdiler.map((g) => g.ad),
    ['ODEME.ear.bak', 'scripts', 'Logs'],
  );
});

test('RE3 EAR verisi eski / okunamadi / yok: bulgu ve aday yok, nedeni h.ear tasir', () => {
  const ear = (gunOnce) => ({
    okunamadi: false,
    hostlar: [earHost(APP, [U7('BOS.ear', { warSayisi: 0 })], null, gunOnce)],
  });
  const durum = (d) => {
    const h = sunucu(A(d), APP);
    return {
      ear: h.ear.durum,
      bulgu: h.findings.filter((f) => f.area === 'ear').length,
      aday: h.retireAdaylari.filter((a) => a.tur === 'EAR').length,
    };
  };
  assert.deepEqual(
    durum({ ...r1Veri(), ear: ear(35) }),
    { ear: 'VAR', bulgu: 1, aday: 1 },
    'kontrol: 35 gun gecerli',
  );
  assert.deepEqual(durum({ ...r1Veri(), ear: ear(36) }), { ear: 'ESKI', bulgu: 0, aday: 0 });
  assert.equal(sunucu(A({ ...r1Veri(), ear: ear(36) }), APP).ear.yasGun, 36);
  assert.deepEqual(durum({ ...r1Veri(), ear: { okunamadi: true, hostlar: [] } }), {
    ear: 'OKUNAMADI',
    bulgu: 0,
    aday: 0,
  });
  assert.deepEqual(
    durum(r1Veri()),
    { ear: 'OKUNAMADI', bulgu: 0, aday: 0 },
    'veri hic verilmediyse olculmedi',
  );
  assert.deepEqual(durum({ ...r1Veri(), ear: { okunamadi: false, hostlar: [] } }), {
    ear: 'YOK',
    bulgu: 0,
    aday: 0,
  });
});

test('RE4 adaylar bulgudan ayri: R1 / R2; calisan JVM aday degil; engelli R1 yine aday', () => {
  const r = A(r1Veri());
  assert.deepEqual(sunucu(r, APP).retireAdaylari, [
    { kural: 'R1', tur: 'JVM', ad: 'oldapp', host: APP, gen: 7, engel: null },
  ]);
  assert.ok(
    !sunucu(r, APP).findings.some((f) => /^R\d$/.test(f.code)),
    'etiket bulgu listesine girdi',
  );
  const r2v = r1Veri();
  r2v.jvms = [J3(APP, 'oldapp', { auto_start: 'false' })];
  r2v.vhosts = [V3(WEB, 'oldapp.bmw.local', { req_7d: 40, req_24h: 3, traffic_state: 'ACTIVE' })];
  assert.deepEqual(
    sunucu(A(r2v), APP).retireAdaylari.map((a) => a.kural),
    ['R2'],
  );
  const cal = r1Veri();
  cal.jvms = [J3(APP, 'oldapp', CALISAN)];
  assert.deepEqual(sunucu(A(cal), APP).retireAdaylari, []);
  const engelli = r1Veri();
  engelli.vhosts = [V3(WEB, 'legacy.bmw.local', { aliases: 'oldapp.bmw.local' })];
  const ad = sunucu(A(engelli), APP).retireAdaylari;
  assert.equal(ad.length, 1);
  assert.match(ad[0].engel, /eşleme türü ALIAS/);
});

test('RE5 etiket motoru: KESIN, eslenik kopya / trafik / engel / bayat -> SUPHELI + neden; nesil notu; ortam ayrimi', () => {
  const tek = etiketle({ hosts: A(r1Veri()).hosts });
  assert.equal(tek.etiketler.length, 1);
  const e = tek.etiketler[0];
  assert.deepEqual(
    [e.anahtar, e.seviye, e.kurallar, e.nedenler],
    [`JVM|OLDAPP|PROD|7`, 'KESIN', ['R1'], []],
  );
  assert.equal(e.kopyalar[0].web[0].host, WEB, 'zincir: JVM -> web sunucusu');
  assert.equal(e.kopyalar[0].web[0].trafik, 'NO_RECENT_TRAFFIC');
  assert.equal(e.durum, 'BEKLIYOR');
  assert.equal(e.retirementHazir, false, 'kontrolsuz KESIN retirement akisina gitmez');

  const esl = r1Veri();
  esl.hosts.push(H3(APP2, { products: 'JBOSS7' }));
  esl.jvms.push(J3(APP2, 'oldapp', CALISAN));
  const ee = etiketle({ hosts: A(esl).hosts }).etiketler[0];
  assert.equal(ee.seviye, 'SUPHELI');
  assert.equal(ee.hamSeviye, 'KESIN');
  assert.ok(ee.nedenler.includes(`${APP2}: eşlenik kopya çalışıyor`), ee.nedenler.join(' | '));
  assert.deepEqual(ee.hostlar, [APP, APP2]);

  // Baska ortamdaki kopya etkilemez; JBoss 8 kopyasi not olur, etiketi dusurmez.
  const ort = r1Veri();
  ort.hosts.push(H3(TEST_APP, { products: 'JBOSS7' }), H3(APP2, { products: 'JBOSS8' }));
  ort.jvms.push(J3(TEST_APP, 'oldapp', CALISAN), J3(APP2, 'oldapp', { ...CALISAN, gen: 8 }));
  const eo = etiketle({ hosts: A(ort).hosts }).etiketler[0];
  assert.equal(eo.seviye, 'KESIN', eo.nedenler.join(' | '));
  assert.deepEqual(eo.notlar, [`${APP2}: JBoss 8 kopyası çalışıyor — uygulama taşınmış olabilir`]);

  const ver = r1Veri();
  ver.web = [
    {
      ...W3(WEB),
      vhost_trust: 'NONE',
      syntax_verification: 'NOT_VERIFIED',
      check_class: 'ACCESS_DENIED',
    },
  ];
  const ev = etiketle({ hosts: A(ver).hosts }).etiketler;
  // Trafik dogrulanamadiysa R1 kosulu (NO_RECENT_TRAFFIC) hic kurulmaz ya da kurulup dusurulur; asla KESIN degil.
  assert.ok(
    ev.every((x) => x.seviye !== 'KESIN'),
    'dogrulanamayan trafik KESIN',
  );

  const al = r1Veri();
  al.vhosts = [V3(WEB, 'legacy.bmw.local', { aliases: 'oldapp.bmw.local' })];
  const ea = etiketle({ hosts: A(al).hosts }).etiketler[0];
  assert.equal(ea.seviye, 'SUPHELI');
  assert.ok(
    ea.nedenler.some((n) => /retire kanıtı eksik — eşleme türü ALIAS/.test(n)),
    ea.nedenler.join(' | '),
  );

  const bayat = r1Veri();
  bayat.hosts = bayat.hosts.map((h) => ({
    ...h,
    scan_date: '2026-11-01',
    loaded_at: '2026-11-01T06:00:00Z',
  }));
  bayat.vhosts = bayat.vhosts.map((v) => ({ ...v }));
  const eb = etiketle({ hosts: A(bayat).hosts }).etiketler[0];
  assert.equal(eb.seviye, 'SUPHELI');
  assert.ok(
    eb.nedenler.some((n) => /tarama bayat/.test(n)),
    eb.nedenler.join(' | '),
  );

  const r2v = r1Veri();
  r2v.jvms = [J3(APP, 'oldapp', { auto_start: 'false' })];
  r2v.vhosts = [V3(WEB, 'oldapp.bmw.local', { req_7d: 40, req_24h: 3, traffic_state: 'ACTIVE' })];
  const e2 = etiketle({ hosts: A(r2v).hosts }).etiketler[0];
  assert.deepEqual([e2.kurallar, e2.seviye], [['R2'], 'SUPHELI']);

  // EAR konusu: ayni EAR iki sunucuda, birinde WAR var -> (Admin KESIN yapsa da) dusurulur.
  const ev2 = r1Veri();
  ev2.hosts.push(H3(APP2, { products: 'JBOSS7' }));
  ev2.ear = {
    okunamadi: false,
    hostlar: [
      earHost(APP, [U7('BOS.ear', { warSayisi: 0 })]),
      earHost(APP2, [U7('BOS.ear', { warSayisi: 2 })]),
    ],
  };
  const et = etiketle({ hosts: A(ev2).hosts, kurallar: { R3: 'KESIN' } }).etiketler.find(
    (x) => x.tur === 'EAR',
  );
  assert.deepEqual(
    [et.anahtar, et.hamSeviye, et.seviye],
    ['EAR|BOS.EAR|PROD|7', 'KESIN', 'SUPHELI'],
  );
  assert.ok(et.nedenler.includes(`${APP2}: bu kopyada 2 WAR var`), et.nedenler.join(' | '));
  assert.deepEqual(
    et.kopyalar.map((k) => [k.host, k.warSayisi]),
    [
      [APP, 0],
      [APP2, 2],
    ],
    'aday olmayan kopya da zincirde',
  );
});

test('RE5b zincir nedenleri: her dal ayri (calisma olculemedi, trafik, esleme, engel, bayat; EAR baglantisi)', () => {
  const { zincirNedenleri } = require('../retire-etiket.cjs');
  const k = (ek) => ({
    host: 'H1',
    calisiyor: false,
    taze: true,
    trafik: 'NO_RECENT_TRAFFIC',
    esleme: 'WEB_APP',
    engel: null,
    ...ek,
  });
  const J = { tur: 'JVM' };
  assert.deepEqual(zincirNedenleri(J, [k()], ['R1']), [], 'kontrol: tam kanit');
  assert.deepEqual(zincirNedenleri(J, [k({ calisiyor: null })], ['R1']), [
    'H1: çalışma durumu ölçülemedi',
  ]);
  assert.deepEqual(zincirNedenleri(J, [k({ calisiyor: true })], ['R1']), [
    'H1: eşlenik kopya çalışıyor',
  ]);
  assert.deepEqual(zincirNedenleri(J, [k({ taze: false, taramaTarihi: '2026-11-01' })], ['R1']), [
    'H1: tarama bayat (2026-11-01)',
  ]);
  assert.deepEqual(zincirNedenleri(J, [k({ trafik: 'ACTIVE' })], ['R1']), [
    'H1: web katmanında trafik var',
  ]);
  assert.deepEqual(zincirNedenleri(J, [k({ trafik: 'UNREADABLE' })], ['R1']), [
    'H1: trafik ölçülemedi',
  ]);
  assert.deepEqual(zincirNedenleri(J, [k({ trafik: 'UNVERIFIED' })], ['R1']), [
    'H1: trafik ölçülemedi',
  ]);
  assert.deepEqual(
    zincirNedenleri(J, [k({ trafik: 'NOT_MAPPED', esleme: 'NOT_MAPPED' })], ['R1']),
    ['H1: web katmanı eşlenemedi (NOT_MAPPED)'],
  );
  assert.deepEqual(zincirNedenleri(J, [k({ engel: 'bayat kanıt' })], ['R1']), [
    'H1: retire kanıtı eksik — bayat kanıt',
  ]);
  // R2 (trafik var) icin trafik kontrolu uygulanmaz: ACTIVE R2'nin kosuludur.
  assert.deepEqual(zincirNedenleri(J, [k({ trafik: 'ACTIVE' })], ['R2']), []);
  const E = { tur: 'EAR' };
  const e = (ek) => ({ host: 'H1', warSayisi: 0, xml: 'JVM_YOK', jvmler: [], ...ek });
  assert.deepEqual(zincirNedenleri(E, [e()], ['R3', 'R5']), []);
  assert.deepEqual(
    zincirNedenleri(
      E,
      [
        e({
          jvmler: [
            { ad: 'J1', calisiyor: true },
            { ad: 'J2', calisiyor: null },
          ],
        }),
      ],
      ['R3'],
    ),
    ["H1: çalışan JVM'e bağlı (J1)"],
  );
  assert.deepEqual(zincirNedenleri(E, [e({ xml: 'VAR' })], ['R5']), ["H1: bu kopya JVM'e bağlı"]);
  assert.deepEqual(zincirNedenleri(E, [e({ xml: 'OLCULEMEDI' })], ['R3']), [
    'H1: JBoss yapılandırması okunamadı',
  ]);
});

test('RE6 Admin kural seviyesi: KAPALI etiket uretmez, SUPHELI -> KESIN; gecersiz satir yok sayilir', () => {
  const hosts = A(r1Veri()).hosts;
  assert.equal(etiketle({ hosts, kurallar: { R1: 'KAPALI' } }).etiketler.length, 0);
  const d = r1Veri();
  d.ear = { okunamadi: false, hostlar: [earHost(APP, [U7('BOS.ear', { warSayisi: 0 })])] };
  const h2 = A(d).hosts;
  assert.equal(etiketle({ hosts: h2 }).etiketler.find((x) => x.tur === 'EAR').seviye, 'SUPHELI');
  assert.equal(
    etiketle({ hosts: h2, kurallar: { R3: 'KESIN' } }).etiketler.find((x) => x.tur === 'EAR')
      .seviye,
    'KESIN',
  );
  const a = ayarlar.satirlardan([
    { anahtar: 'etiket:R2', deger: 'KESIN' },
    { anahtar: 'etiket:R1', deger: 'BELKI' },
    { anahtar: 'etiket:R9', deger: 'KESIN' },
    { anahtar: 'liste:kok_yoksay', deger: 'b,a,a' },
  ]);
  assert.deepEqual(a.etiketler, {
    R1: 'KESIN',
    R2: 'KESIN',
    R3: 'SUPHELI',
    R4: 'SUPHELI',
    R5: 'SUPHELI',
  });
  assert.deepEqual(a.kokYoksay, ['a', 'b']);
  assert.deepEqual(
    ayarlar.satirlardan([{ anahtar: 'liste:kok_yoksay', deger: 'iyi,../kotu' }]).kokYoksay,
    ['log', 'logs', 'lost+found', 'scripts', 'temp', 'tmp'],
    'gecersiz liste varsayilani bozmaz',
  );
  assert.equal(
    ayarlar.satirlardan([{ anahtar: 'liste:kok_yoksay', deger: 'a,..' }]).kokYoksay.includes('..'),
    false,
    "'..' yok sayma adi olamaz",
  );
  assert.equal(ayarlar.yoksayNormal(['.']), null);
});

test('RE7 manuel kontrol: imza baglantisi, VERI_DEGISTI, yalniz KESIN + DOGRULANDI hazir, okunamadi BILINMIYOR', () => {
  const hosts = A(r1Veri()).hosts;
  const e = etiketle({ hosts }).etiketler[0];
  const kayit = (sonuc, imza = e.imza) =>
    new Map([[e.anahtar, { sonuc, imza, aciklama: 'CMDB kapali', isaretleyen: 'ayse' }]]);
  const d = etiketle({ hosts, kontroller: kayit('DOGRULANDI') }).etiketler[0];
  assert.deepEqual([d.durum, d.retirementHazir], ['DOGRULANDI', true]);
  assert.equal(
    etiketle({ hosts, kontroller: kayit('YANLIS_ALARM') }).etiketler[0].durum,
    'YANLIS_ALARM',
  );
  const v = etiketle({ hosts, kontroller: kayit('DOGRULANDI', 'f'.repeat(32)) }).etiketler[0];
  assert.deepEqual([v.durum, v.retirementHazir], ['VERI_DEGISTI', false]);
  const b = etiketle({ hosts, kontroller: null }).etiketler[0];
  assert.deepEqual([b.durum, b.retirementHazir], ['BILINMIYOR', false]);
  // SUPHELI + DOGRULANDI retirement'a hazir DEGIL.
  const sh = etiketle({ hosts, kurallar: { R1: 'SUPHELI' }, kontroller: kayit('DOGRULANDI') })
    .etiketler[0];
  assert.deepEqual([sh.seviye, sh.durum, sh.retirementHazir], ['SUPHELI', 'DOGRULANDI', false]);
  // Imza: istek sayisi / tarih degisimi imzayi bozmaz; kopya durumu bozar.
  const sayi = r1Veri();
  sayi.vhosts = [V3(WEB, 'oldapp.bmw.local', { hc_24h: 99 })];
  assert.equal(etiketle({ hosts: A(sayi).hosts }).etiketler[0].imza, e.imza);
  // Gunluk tarama tarihi (ikisi de taze) imzaya girmez: her gece kontrol gecersizlesmesin.
  const dun = r1Veri();
  dun.hosts = dun.hosts.map((h) => ({
    ...h,
    scan_date: '2026-11-05',
    loaded_at: '2026-11-05T06:00:00Z',
  }));
  const ed = etiketle({ hosts: A(dun).hosts }).etiketler[0];
  assert.deepEqual([ed.seviye, ed.imza], ['KESIN', e.imza], 'dunku tarama imzayi degistirdi');
  const yeni = r1Veri();
  yeni.hosts.push(H3(APP2, { products: 'JBOSS7' }));
  yeni.jvms.push(J3(APP2, 'oldapp', { auto_start: 'true' }));
  assert.notEqual(
    etiketle({ hosts: A(yeni).hosts }).etiketler[0].imza,
    e.imza,
    'yeni kopya imzayi degistirmedi',
  );
  assert.equal(etiketle({ hosts }).ozet.kesin, 1);
});

test('RE8 ear-hub-verisi: son kosu, JSON, bozuk JSON null, DB hatasi okunamadi', async () => {
  sifirla();
  const { earSonDurum } = require('../ear-hub-verisi.cjs');
  DB.earH = [
    {
      host: 'gbcjap01',
      kosu_id: 7,
      taranma_utc: new Date('2026-11-05T02:00:00Z'),
      durum: 'TAM',
      kok_girdileri: JSON.stringify({
        girdiler: [{ kok: '/vhosting', ad: 'X.bak', tip: 'F' }],
        kesilen: 1,
      }),
    },
    {
      host: 'GBCJAP02',
      kosu_id: 8,
      taranma_utc: '2026-11-04 01:00:00',
      durum: 'KISMI',
      kok_girdileri: '{bozuk',
    },
  ];
  DB.earU = [
    {
      host: 'GBCJAP01',
      kok: '/vhosting',
      jboss: '7',
      ad: 'A.ear',
      durum: 'TAM',
      war_sayisi: 0,
      xml_eslesme: JSON.stringify({ durum: 'JVM_YOK', neden: 'TANIM_YOK' }),
    },
    {
      host: 'GBCJAP02',
      kok: '/vhosting8',
      jboss: '8',
      ad: 'B.ear',
      durum: 'TAM',
      war_sayisi: null,
      xml_eslesme: null,
    },
    {
      host: 'BILINMEYEN',
      kok: '/vhosting',
      jboss: '7',
      ad: 'C.ear',
      durum: 'TAM',
      war_sayisi: 1,
      xml_eslesme: null,
    },
  ];
  const v = await earSonDurum();
  assert.equal(v.okunamadi, false);
  const [a, b] = v.hostlar;
  assert.deepEqual([a.host, a.kosuId, a.taranma], ['GBCJAP01', 7, '2026-11-05T02:00:00.000Z']);
  assert.deepEqual(a.kokGirdileri, {
    girdiler: [{ kok: '/vhosting', ad: 'X.bak', tip: 'F' }],
    kesilen: 1,
  });
  assert.deepEqual(a.uygulamalar[0].xml, { durum: 'JVM_YOK', neden: 'TANIM_YOK' });
  assert.equal(b.taranma, '2026-11-04T01:00:00.000Z', 'DATETIME2 metni UTC okunmali');
  assert.equal(b.kokGirdileri, null, 'bozuk JSON olculmedi sayilmali');
  assert.equal(b.uygulamalar[0].warSayisi, null);
  assert.equal(v.hostlar.length, 2, 'host satiri olmayan uygulama alinmaz');
  DB.earDus = true;
  const d = await earSonDurum();
  assert.deepEqual([d.okunamadi, d.hostlar.length], [true, 0]);
  assert.match(d.hata, /kok_girdileri/);
});

test('RE9 katalog: her etiket kurali ve retire ile ilgili kod uc parcali dogrulama tasir', () => {
  const tam = (x, ad) => {
    assert.ok(
      x && x.neden && x.eksik && Array.isArray(x.kontrol) && x.kontrol.length > 0,
      `${ad}: dogrulama eksik`,
    );
    for (const k of x.kontrol) assert.equal(typeof k, 'string');
  };
  for (const k of ETIKET_KURALLARI) tam(k.dogrulama, k.kural);
  for (const kod of [
    'STOPPED_AUTOSTART_ON',
    'JVM_PARAM_FARKI',
    'RETIRE_CANDIDATE',
    'NO_LOAD',
    'TRAFFIC_UNVERIFIED',
    'EAR_WAR_YOK',
    'KOK_EAR_DISI',
    'EAR_JVM_YOK',
    'EAR_XML_OLCULEMEDI',
  ])
    tam(KODLAR.get(kod).dogrulama, kod);
  // EAR alanindaki her kod dogrulama tasir (yeni kod eklenirse unutulmasin).
  for (const [kod, k] of KODLAR) if (k.alan === 'ear') tam(k.dogrulama, kod);
  assert.deepEqual(
    ETIKET_KURALLARI.map((k) => [k.kural, k.varsayilan]),
    [
      ['R1', 'KESIN'],
      ['R2', 'SUPHELI'],
      ['R3', 'SUPHELI'],
      ['R4', 'SUPHELI'],
      ['R5', 'SUPHELI'],
    ],
  );
  // Faz 2'nin deployment komutu elle kontrol olarak simdiden verilir (JBoss 7 ve 8).
  assert.ok(
    KODLAR.get('NO_LOAD').dogrulama.kontrol.some((k) =>
      k.includes('/host=master/server=<JVM>:read-children-resources(child-type=deployment'),
    ),
  );
  assert.ok(
    KODLAR.get('NO_LOAD').dogrulama.kontrol.some(
      (k) => k.includes('--controller=$HOSTNAME:9998') && k.includes('/host=primary/'),
    ),
  );
});

// ── RE10: GERCEK initServerHub ────────────────────────────────────────────────────────────────
let tarama = null;
stub('../../inventory/mssql.cjs', {
  query: async (q) => {
    const s = String(q);
    if (/OBJECT_ID\('dbo\.Server_Hub_Hosts'\) AS oid/.test(s))
      return { recordset: [{ oid: tarama ? 1 : null }] };
    if (/FROM sys\.columns c WHERE c\.object_id IN/.test(s)) {
      const { SH_KOLONLAR } = require('../index.cjs');
      return {
        recordset: Object.entries(SH_KOLONLAR).flatMap(([t, cs]) =>
          cs.map((name) => ({ tbl: t.replace('dbo.', ''), name })),
        ),
      };
    }
    const m = /FROM dbo\.Server_Hub_(\w+) t\b/.exec(s);
    if (m && tarama) return { recordset: tarama[m[1]] || [] };
    return { recordset: [] };
  },
  sql: { NVarChar: () => 'nvarchar', Int: 'int' },
});
stub('../../ansible/playbook-registry.cjs', {
  getByKey: async () => null,
  getEffectiveTemplateId: () => null,
});
const denetim = [];
stub('../../audit/index.cjs', {
  auditPortal: (_req, kat, d) => denetim.push([kat, JSON.parse(d.detail)]),
});

async function httpIle(fn) {
  stub('../../auth/index.cjs', { requireAuth: (_q, _s, n) => n() });
  stub('../../auth/visibility.cjs', { requireVisiblePrefix: () => (_q, _s, n) => n() });
  const { initServerHub, _onbellekSifirlaForTest } = require('../index.cjs');
  _onbellekSifirlaForTest();
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: { role: req.headers['x-rol'] || 'Admin', username: 'ayse' } };
    next();
  });
  const log = console.log;
  console.log = () => {};
  try {
    initServerHub(app);
  } finally {
    console.log = log;
  }
  const srv = await new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  try {
    return await fn(`http://127.0.0.1:${srv.address().port}/api/server-hub`);
  } finally {
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
    srv.close();
  }
}
const J = async (r) => ({ status: r.status, body: await r.json() });
const put = (url, body) =>
  fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(J);

test('RE10 uclar: etiket listesi, manuel kontrol (400 / 409 / 424 / 200), kural seviyesi, yok sayma listesi', async () => {
  sifirla();
  denetim.length = 0;
  const bugun = new Date().toISOString().slice(0, 10);
  const v = r1Veri();
  tarama = {
    Hosts: v.hosts.map((h) => ({ ...h, scan_date: bugun, loaded_at: `${bugun}T06:00:00Z` })),
    Jvms: v.jvms.map((j) => ({ ...j, scan_date: bugun })),
    Web: v.web.map((w) => ({ ...w, scan_date: bugun })),
    Vhosts: v.vhosts.map((x) => ({ ...x, scan_date: bugun })),
  };
  DB.earH = [
    {
      host: APP,
      kosu_id: 1,
      taranma_utc: new Date(),
      durum: 'TAM',
      kok_girdileri: JSON.stringify({
        girdiler: [{ kok: '/vhosting', ad: 'ESKI.war', tip: 'F' }],
        kesilen: 0,
      }),
    },
  ];
  DB.earU = [];
  await httpIle(async (kok) => {
    const yasak = await fetch(`${kok}/retire-etiketleri`, { headers: { 'x-rol': 'Operator' } });
    assert.equal(yasak.status, 403, 'Admin olmayan etiketleri gordu');
    let r = await fetch(`${kok}/retire-etiketleri?fresh=1`).then(J);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.kontrolOkunamadi, false);
    assert.equal(r.body.ear.okunamadi, false);
    assert.deepEqual(
      r.body.kurallar.map((k) => [k.kural, k.gecerli]),
      [
        ['R1', 'KESIN'],
        ['R2', 'SUPHELI'],
        ['R3', 'SUPHELI'],
        ['R4', 'SUPHELI'],
        ['R5', 'SUPHELI'],
      ],
    );
    const jvm = r.body.etiketler.find((e) => e.tur === 'JVM');
    const girdi = r.body.etiketler.find((e) => e.tur === 'GIRDI');
    assert.deepEqual([jvm.seviye, jvm.durum], ['KESIN', 'BEKLIYOR']);
    assert.deepEqual([girdi.ad, girdi.seviye], ['ESKI.war', 'SUPHELI']);

    // Girdi dogrulama ve guncellik kapilari
    let p = await put(`${kok}/retire-kontrol`, {
      anahtar: jvm.anahtar,
      sonuc: 'DOGRULANDI',
      aciklama: 'ok',
      imza: jvm.imza,
    });
    assert.equal(p.status, 400, 'kisa not kabul edildi');
    p = await put(`${kok}/retire-kontrol`, {
      anahtar: jvm.anahtar,
      sonuc: 'SIL',
      aciklama: 'CMDB kapali',
      imza: jvm.imza,
    });
    assert.equal(p.status, 400);
    p = await put(`${kok}/retire-kontrol`, {
      anahtar: 'JVM|YOK|PROD|7',
      sonuc: 'DOGRULANDI',
      aciklama: 'CMDB kapali',
      imza: jvm.imza,
    });
    assert.equal(p.status, 409);
    p = await put(`${kok}/retire-kontrol`, {
      anahtar: jvm.anahtar,
      sonuc: 'DOGRULANDI',
      aciklama: 'CMDB kapali',
      imza: '0'.repeat(32),
    });
    assert.equal(p.status, 409);
    assert.equal(p.body.imza, jvm.imza, '409 guncel imzayi tasimali');
    DB.kontrolDus = true;
    p = await put(`${kok}/retire-kontrol`, {
      anahtar: jvm.anahtar,
      sonuc: 'DOGRULANDI',
      aciklama: 'CMDB kapali',
      imza: jvm.imza,
    });
    assert.equal(p.status, 424, 'kayitlar okunamazken yazildi');
    r = await fetch(`${kok}/retire-etiketleri`).then(J);
    assert.equal(r.body.kontrolOkunamadi, true);
    assert.ok(r.body.etiketler.every((e) => e.durum === 'BILINMIYOR' && !e.retirementHazir));
    DB.kontrolDus = false;
    assert.equal(DB.kontrol.size, 0, 'reddedilen istek yazdi');

    p = await put(`${kok}/retire-kontrol`, {
      anahtar: jvm.anahtar,
      sonuc: 'DOGRULANDI',
      aciklama: 'CMDB kapali, sahip onayladi',
      imza: jvm.imza,
    });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.deepEqual([p.body.etiket.durum, p.body.etiket.retirementHazir], ['DOGRULANDI', true]);
    assert.equal(DB.kontrol.get(jvm.anahtar).seviye, 'KESIN');
    assert.deepEqual(denetim.at(-1), [
      'server_hub',
      { op: 'retire_kontrol', anahtar: jvm.anahtar, sonuc: 'DOGRULANDI', seviye: 'KESIN' },
    ]);
    p = await put(`${kok}/retire-kontrol`, {
      anahtar: jvm.anahtar,
      sonuc: 'GERI_AL',
      aciklama: '',
      imza: jvm.imza,
    });
    assert.equal(p.status, 200);
    assert.equal(p.body.etiket.durum, 'BEKLIYOR');
    const g = await fetch(
      `${kok}/retire-kontrol/gecmis?anahtar=${encodeURIComponent(jvm.anahtar)}`,
    ).then(J);
    assert.deepEqual(
      g.body.gecmis.map((x) => x.sonuc),
      ['GERI_ALINDI', 'DOGRULANDI'],
    );

    // Kural seviyesi: gerekce zorunlu; R4 KAPALI -> girdi etiketi kalkar (bulgu kalir).
    p = await put(`${kok}/kurallar/etiket/R4`, { seviye: 'KAPALI', aciklama: '' });
    assert.equal(p.status, 400);
    p = await put(`${kok}/kurallar/etiket/R9`, { seviye: 'KAPALI', aciklama: 'deneme' });
    assert.equal(p.status, 400);
    p = await put(`${kok}/kurallar/etiket/R4`, {
      seviye: 'KAPALI',
      aciklama: 'kokler elle temizleniyor',
    });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    r = await fetch(`${kok}/retire-etiketleri`).then(J);
    assert.ok(!r.body.etiketler.some((e) => e.tur === 'GIRDI'), 'KAPALI kural etiket uretti');
    assert.equal(r.body.kurallar.find((k) => k.kural === 'R4').gecerli, 'KAPALI');
    let k = await fetch(`${kok}/kurallar`).then(J);
    assert.equal(k.body.etiketKurallari.find((x) => x.kural === 'R4').degistiren, 'ayse');
    assert.ok(
      k.body.maddeler.flatMap((m) => m.ciktilar).find((c) => c.kod === 'EAR_WAR_YOK').dogrulama
        .kontrol.length > 0,
    );

    // Yok sayma listesi: gecersiz ad / uzunluk 400; gecerli liste bulguyu kaldirir (onbellek silinir).
    let h = await fetch(`${kok}/host/${APP}`).then(J);
    assert.ok(
      h.body.host.findings.some((f) => f.code === 'KOK_EAR_DISI'),
      'kontrol: bulgu var',
    );
    assert.equal(h.body.host.ear.durum, 'VAR');
    assert.ok(Array.isArray(h.body.host.retireAdaylari));
    p = await put(`${kok}/kurallar/kok-yoksay`, { liste: ['../etc'], aciklama: 'deneme' });
    assert.equal(p.status, 400);
    p = await put(`${kok}/kurallar/kok-yoksay`, {
      liste: Array.from({ length: 30 }, (_, i) => `uzun-dizin-adi-${i}`),
      aciklama: 'deneme',
    });
    assert.equal(p.status, 400, '256 karakter siniri');
    p = await put(`${kok}/kurallar/kok-yoksay`, { liste: ['scripts', 'ESKI.war'], aciklama: '' });
    assert.equal(p.status, 400, 'gerekcesiz liste');
    p = await put(`${kok}/kurallar/kok-yoksay`, {
      liste: ['scripts', 'ESKI.war'],
      aciklama: 'yedek klasoru',
    });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    h = await fetch(`${kok}/host/${APP}`).then(J);
    assert.ok(
      !h.body.host.findings.some((f) => f.code === 'KOK_EAR_DISI'),
      'yok sayilan girdi bulgu uretti (onbellek silinmedi?)',
    );
    k = await fetch(`${kok}/kurallar`).then(J);
    assert.deepEqual(k.body.kokYoksay.gecerli, ['ESKI.war', 'scripts']);
  });
});
