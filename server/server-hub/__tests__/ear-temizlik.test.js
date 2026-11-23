// server/server-hub/__tests__/ear-temizlik.test.js - Server Hub > EAR Temizligi (2026-11-16) davranisi.
//
// Kullanici: "EAR icinde WAR yok -> bu uyarilari rahatlikla temizleyebilmek icin bir sayfa ... on kontrolde
// gercekten bu dizine bir ls -ltr ile bakilmali ve benim tarafimdan silinmeden once teyit edilmeli".
// Senaryolar:
//   ET1 adaylar: yalniz EAR_WAR_YOK bulgusu; prod fail-closed; xml VAR -> engel; bicim engeli; kayit eslemesi
//   ET2 on kontrol: istemci yolu bulguda yoksa 404, bicim gecersizse 400 (launch YOK)
//   ET3 engel 409; ET4 aktif kayit 409 (okuma + filtreli tekil yaris)
//   ET5 plan extra_vars birebir (plan_only true, ear_fp '')
//   ET6 plan PLAN -> PLAN_HAZIR + fp + ls + info; ET7 FAIL / set_stats yok / baska eylem / fp yok -> PLAN_HATA
//   ET8 sure dolunca PLAN_ESKIDI ve sil reddi; ET9 onayMetni / planJobId / confirmed uyusmazligi reddi
//   ET10 CAS cift tik tek launch; ET11 launchBelirsiz -> BELIRSIZ (tekrar denenmez); ET12 kesin red -> PLAN_HAZIR
//   ET13 sil extra_vars birebir (ear_fp = plan fp); ET14 OK -> SILINDI + yedek + tek sunucu envanter taramasi
//   ET15 envanter 409 notu; ET16 sil FAIL -> HATA (envanter yok); ET17 onay aninda bulgu yok -> 409
//   ET18 iptal; ET19 5xx POST -> 424
//   ET20 ls bos / liste degil / ilk satir P degil -> PLAN_HATA; kayitta ls yoksa sil 409 ls_yok (teyitsiz silme yok)
//   ET21 ls kesintisi: betigin 302 satiri (ls -ld + 300 + tasma notu) korunur; fazlasi Portal notuyla kesilir
//   ET22 envanter: yalniz kosu_calisiyor 'suruyor' notu; diger 409 ve ilkParti.hata gercek hata notu
//   ET23 silme isi acildi ama is numarasi yazilamadi -> 502 kayit_yazilamadi, mesajda is numarasi, denetim var
//   ET24 zaman asimlari: numarasiz / bitmeyen plan -> PLAN_HATA; numarasiz / bitmeyen silme -> BELIRSIZ (asla SILINDI)
//   ET25 es zamanli iki GET: CAS'i kaybeden envanter taramasi acmaz (tek tarama)
//   ET26 salt okunur on kontrol OK donerse PLAN_HATA + 'BEKLENMEDIK' + denetimde anomali
'use strict';

const { test: nodeTest, beforeEach } = require('node:test');
const test = (ad, fn) => nodeTest(ad, { timeout: 15000 }, fn);
const assert = require('node:assert/strict');

const ET = require('../ear-temizlik.cjs');

// ── SAHTE DB: modulun T-SQL alt kumesi. Bilinmeyen sorgu HATA atar (sessiz gecmez). ──
const DB = { satirlar: [], sira: 0, kayma: 0, sorgular: [] };
const simdi = () => new Date(Date.now() + DB.kayma);
const temiz = (q) => String(q).replace(/\s+/g, ' ').trim();

function bol(s, ayirici) {
  const out = [];
  let d = 0;
  let bas = 0;
  let tirnak = false;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "'") tirnak = !tirnak;
    else if (!tirnak && s[i] === '(') d += 1;
    else if (!tirnak && s[i] === ')') d -= 1;
    else if (!tirnak && d === 0 && s.startsWith(ayirici, i)) {
      out.push(s.slice(bas, i));
      bas = i + ayirici.length;
      i += ayirici.length - 1;
    }
  }
  out.push(s.slice(bas));
  return out.map((x) => x.trim()).filter(Boolean);
}

function deger(ifade, p) {
  const e = ifade.trim();
  let m;
  if ((m = /^\$(\d+)$/.exec(e))) return p[Number(m[1]) - 1];
  if ((m = /^'([^']*)'$/.exec(e))) return m[1];
  if (e === 'NULL') return null;
  if (e === 'SYSUTCDATETIME()') return simdi();
  if ((m = /^DATEADD\(minute, (-?\d+), SYSUTCDATETIME\(\)\)$/.exec(e)))
    return new Date(simdi().getTime() + Number(m[1]) * 60000);
  if (/^-?\d+$/.test(e)) return Number(e);
  throw new Error(`sahte DB: deger yorumlanamadi: ${e}`);
}

const esit = (a, b) =>
  a instanceof Date || b instanceof Date ? +a === +b : String(a) === String(b);

function kosul(c, row, p) {
  let m;
  if ((m = /^(\w+) IS NULL$/.exec(c))) return row[m[1]] == null;
  if ((m = /^(\w+) IS NOT NULL$/.exec(c))) return row[m[1]] != null;
  if ((m = /^(\w+) IN \((.*)\)$/.exec(c)))
    return bol(m[2], ',').some((x) => esit(row[m[1]], deger(x, p)));
  if ((m = /^(\w+) < (.*)$/.exec(c))) return row[m[1]] != null && +row[m[1]] < +deger(m[2], p);
  if ((m = /^(\w+) > (.*)$/.exec(c))) return row[m[1]] != null && +row[m[1]] > +deger(m[2], p);
  if ((m = /^(\w+) = (.*)$/.exec(c))) return row[m[1]] != null && esit(row[m[1]], deger(m[2], p));
  throw new Error(`sahte DB: kosul yorumlanamadi: ${c}`);
}
const kosullar = (w, row, p) => bol(w, ' AND ').every((c) => kosul(c, row, p));
const AKTIF = ['PLANLANIYOR', 'PLAN_HAZIR', 'SILINIYOR'];

async function query(sql, p = []) {
  const q = temiz(sql);
  DB.sorgular.push(q);
  let m;
  if (
    (m =
      /^SELECT (?:TOP (\d+) )?\* FROM server_hub_ear_temizlik WHERE (.*?)(?: ORDER BY id( DESC)?)?$/.exec(
        q,
      ))
  ) {
    let r = DB.satirlar
      .filter((x) => kosullar(m[2], x, p))
      .sort((a, b) => (m[3] ? b.id - a.id : a.id - b.id));
    if (m[1]) r = r.slice(0, Number(m[1]));
    return { rows: r.map((x) => ({ ...x })) };
  }
  if ((m = /^SELECT TOP (\d+) \* FROM server_hub_ear_temizlik ORDER BY id DESC$/.exec(q)))
    return {
      rows: [...DB.satirlar]
        .sort((a, b) => b.id - a.id)
        .slice(0, Number(m[1]))
        .map((x) => ({ ...x })),
    };
  if ((m = /^UPDATE server_hub_ear_temizlik SET (.*) WHERE (.*)$/.exec(q))) {
    const hedef = DB.satirlar.filter((x) => kosullar(m[2], x, p));
    const set = bol(m[1], ',').map((x) => /^(\w+) = (.*)$/.exec(x));
    for (const r of hedef) {
      const yeni = {};
      for (const [, k, v] of set) yeni[k] = deger(v, p);
      Object.assign(r, yeni);
    }
    return { rows: [], rowCount: hedef.length };
  }
  if (
    /^INSERT INTO server_hub_ear_temizlik \(host, kok, ad, jboss, ortam, prod, durum, olusturan\) VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, 'PLANLANIYOR', \$7\) RETURNING id$/.test(
      q,
    )
  ) {
    if (
      DB.satirlar.some(
        (x) => x.host === p[0] && x.kok === p[1] && x.ad === p[2] && AKTIF.includes(x.durum),
      )
    )
      throw new Error(
        "Cannot insert duplicate key row in object 'dbo.server_hub_ear_temizlik' with unique index 'UX_shet_aktif'",
      );
    DB.sira += 1;
    const r = {
      id: DB.sira,
      host: p[0],
      kok: p[1],
      ad: p[2],
      jboss: p[3],
      ortam: p[4],
      prod: p[5],
      durum: 'PLANLANIYOR',
      olusturan: p[6],
      onaylayan: null,
      plan_awx_server_id: null,
      plan_job_id: null,
      plan_bitis_at: null,
      plan_json: null,
      sil_awx_server_id: null,
      sil_job_id: null,
      sonuc: null,
      yedek: null,
      envanter_kosu_id: null,
      envanter_notu: null,
      toplu_id: null,
      sil_istendi_at: null,
      sil_isteyen: null,
      created_at: simdi(),
      updated_at: simdi(),
    };
    DB.satirlar.push(r);
    return { rows: [{ id: r.id }], rowCount: 1 };
  }
  throw new Error(`sahte DB: bilinmeyen sorgu: ${q}`);
}

// ── SAHTE BAGIMLILIKLAR ──
const FP = 'a'.repeat(64);
const FP2 = 'b'.repeat(64);
const S = {
  launchlar: [],
  launchHata: null,
  launchGecikme: 0,
  jobs: new Map(),
  envanter: [],
  envanterHata: null,
  envanterSonuc: null,
  denetim: [],
  jobNo: 100,
  a: null,
  dbHata: null,
  isGecikme: 0,
  ocoPencere: null,
  ocoCagri: [],
};

function bulgu(kok, ad, jboss) {
  return {
    severity: 'warning',
    area: 'ear',
    code: 'EAR_WAR_YOK',
    text: `${kok}/${ad}: EAR içinde WAR yok`,
    fix: null,
    ear: { kok, ad, jboss },
  };
}
// Kullanim olculmus ve temiz (surec yok, son yazma taramadan 30 gun once). Temizlik kapisi fail-closed
// (2026-11-17): envanter kaydi ya da olculmus kullanim yoksa silme reddedilir; bu yuzden bulgusu olan her EAR
// icin kaydi verilmemisse temiz bir envanter kaydi eklenir. Fail-closed davranis ETT28'de ayrica sinanir.
const TEMIZ_KULLANIM = {
  durum: 'YOK',
  surecler: [],
  son_yazma: Date.parse('2026-10-16T10:00:00Z') / 1000,
  okunamayan: 0,
};
function temizKayit(kok, ad, jboss) {
  return {
    kok,
    ad,
    jboss,
    durum: 'TAM',
    warSayisi: 0,
    xml: { durum: 'JVM_YOK', neden: 'TANIM_YOK' },
    kullanim: TEMIZ_KULLANIM,
  };
}
// Kurulumdan sonra bulgu ekler; envanter kaydi da (kullanim temiz) birlikte eklenir.
function bulguEkle(hostAd, kok, ad, jboss) {
  const h = S.a.hosts.find((x) => x.host === hostAd);
  h.findings.push(bulgu(kok, ad, jboss));
  h.ear.uygulamalar.push(temizKayit(kok, ad, jboss));
}
function host(ad, envGroup, findings, uygulamalar = []) {
  const ul = [...uygulamalar];
  for (const f of findings) {
    if (!f || f.code !== 'EAR_WAR_YOK' || !f.ear) continue;
    if (ul.some((u) => u.kok === f.ear.kok && u.ad === f.ear.ad)) continue;
    ul.push(temizKayit(f.ear.kok, f.ear.ad, f.ear.jboss));
  }
  return {
    host: ad,
    env: envGroup === 'Production' ? 'PROD' : 'TEST',
    envGroup,
    findings,
    ear: { durum: 'VAR', taranma: '2026-11-15T10:00:00Z', uygulamalar: ul },
  };
}
function varsayilanA() {
  return {
    hosts: [
      host('HOSTA', 'Non-Production', [
        bulgu('/vhosting', 'APPX.ear', '7'),
        bulgu('/vhosting8', 'APPY.ear', '8'),
      ]),
      host('HOSTP', 'Production', [bulgu('/vhosting', 'PRODAPP.ear', '7')]),
      host('HOSTU', 'Bilinmiyor', [bulgu('/vhosting', 'UNK.ear', '7')]),
      host(
        'HOSTX',
        'Non-Production',
        [
          bulgu('/vhosting', 'BAGLI.ear', '7'),
          { code: 'DIGER', ear: { kok: '/vhosting', ad: 'Z.ear' } },
        ],
        [
          {
            kok: '/vhosting',
            ad: 'BAGLI.ear',
            jboss: '7',
            durum: 'TAM',
            warSayisi: 0,
            xml: { durum: 'VAR' },
          },
        ],
      ),
      host('HOSTB', 'Non-Production', [
        bulgu('/vhosting', 'TERS.ear', '8'),
        bulgu('/opt', 'K.ear', '7'),
      ]),
    ],
  };
}

const istek = (u = 'admin1') => ({ session: { user: { username: u, role: 'Admin' } } });

beforeEach(() => {
  DB.satirlar = [];
  DB.sira = 0;
  DB.kayma = 0;
  DB.sorgular = [];
  S.launchlar = [];
  S.launchHata = null;
  S.launchGecikme = 0;
  S.jobs = new Map();
  S.envanter = [];
  S.envanterHata = null;
  S.denetim = [];
  S.jobNo = 100;
  S.a = varsayilanA();
  S.envanterSonuc = null;
  S.dbHata = null;
  S.isGecikme = 0;
  S.ocoPencere = null;
  S.ocoCagri = [];
});

function sonucJob(sonuc, mesaj, ear, ek = {}) {
  return {
    status: sonuc === 'FAIL' ? 'failed' : 'successful',
    artifacts: {
      server_hub_fix_result: {
        host: 'HOSTA',
        action: 'ear_cleanup',
        line: `RESULT\tear_cleanup\t${sonuc}\t${mesaj}`,
        ear,
        ...ek,
      },
    },
  };
}
const PLAN_EAR = {
  fp: FP,
  ls: [
    'drwxr-x--- 3 was was 4096 Nov 1 10:00 /vhosting/APPX.ear',
    'total 8',
    '-rw-r----- 1 was was 120 Nov 1 10:00 application.xml',
  ],
  info: ['bicim\tACIK', 'boyut_kb\t12', 'war\t0', 'domain_xml\tyok'],
  backup: '',
};

const planEar = (kok, ad) => ({
  ...PLAN_EAR,
  ls: [`drwxr-x--- 3 was was 4096 Nov 1 10:00 ${kok}/${ad}`, ...PLAN_EAR.ls.slice(1)],
});

async function hazirPlan(ad = 'APPX.ear', kok = '/vhosting', h = 'HOSTA') {
  const k = await ET.onKontrol(istek(), { host: h, kok, ad });
  S.jobs.set(k.planJobId, sonucJob('PLAN', 'plan hazir', planEar(kok, ad)));
  const t = await ET.tekKayit(k.id);
  assert.equal(t.durum, 'PLAN_HAZIR');
  return t;
}

async function reddeder(p, status, code) {
  await assert.rejects(p, (e) => {
    assert.equal(e.status, status, e.message);
    if (code) assert.equal(e.code, code);
    return true;
  });
}

// ── ET1 ──
test('ET1 adaylar: EAR_WAR_YOK bulgulari, prod fail-closed, xml VAR engeli, bicim engeli', async () => {
  const l = await ET.liste(false);
  assert.equal(l.planGecerlilikDk, 30);
  const bul = (h, ad) => l.adaylar.find((x) => x.host === h && x.ad === ad);
  assert.equal(l.adaylar.length, 7);
  assert.deepEqual(bul('HOSTA', 'APPX.ear'), {
    host: 'HOSTA',
    ortam: 'TEST',
    prod: false,
    kok: '/vhosting',
    ad: 'APPX.ear',
    jboss: 7,
    envanterTarihi: '2026-11-15T10:00:00Z',
    engel: null,
    kullanimUyarisi: null,
    kayit: null,
  });
  assert.equal(bul('HOSTA', 'APPY.ear').jboss, 8);
  assert.equal(bul('HOSTP', 'PRODAPP.ear').prod, true);
  assert.equal(bul('HOSTU', 'UNK.ear').prod, true, 'ortami bilinmeyen prod sayilir');
  assert.equal(bul('HOSTX', 'BAGLI.ear').engel, ET.ENGEL_XML);
  assert.ok(!bul('HOSTX', 'Z.ear'), 'baska kod aday degil');
  assert.match(bul('HOSTB', 'TERS.ear').engel, /uyuşmuyor/);
  assert.match(bul('HOSTB', 'K.ear').engel, /kapsamında değil/);
  const k = await ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' });
  const l2 = await ET.liste(false);
  assert.equal(l2.adaylar.find((x) => x.ad === 'APPX.ear').kayit.id, k.id);
  assert.equal(l2.adaylar.find((x) => x.ad === 'APPY.ear').kayit, null);
  assert.equal(l2.kayitlar.length, 1);
});

// ── ET2 ──
test('ET2 istemci yolu bulguda yoksa 404, bicim gecersizse 400; launch yok', async () => {
  await reddeder(
    ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting', ad: 'BASKA.ear' }),
    404,
    'bulgu_yok',
  );
  await reddeder(
    ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting8', ad: 'APPX.ear' }),
    404,
    'bulgu_yok',
  );
  await reddeder(
    ET.onKontrol(istek(), { host: 'HOSTP', kok: '/vhosting', ad: 'APPX.ear' }),
    404,
    'bulgu_yok',
  );
  await reddeder(
    ET.onKontrol(istek(), { host: 'HOSTA', kok: '/opt', ad: 'APPX.ear' }),
    400,
    'gecersiz_kok',
  );
  await reddeder(
    ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting', ad: '../APPX.ear' }),
    400,
    'gecersiz_ad',
  );
  await reddeder(
    ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.war' }),
    400,
    'gecersiz_ad',
  );
  await reddeder(
    ET.onKontrol(istek(), { host: 'HO STA', kok: '/vhosting', ad: 'APPX.ear' }),
    400,
    'gecersiz_host',
  );
  // bicim engelli bulgu (kok-jboss uyusmazligi) da acilmaz
  await reddeder(
    ET.onKontrol(istek(), { host: 'HOSTB', kok: '/vhosting', ad: 'TERS.ear' }),
    409,
    'engel',
  );
  assert.equal(S.launchlar.length, 0);
  assert.equal(DB.satirlar.length, 0);
});

// ── ET3 / ET4 ──
test('ET3 engel (domain.xml deployment) 409, kayit ve launch yok', async () => {
  await reddeder(
    ET.onKontrol(istek(), { host: 'HOSTX', kok: '/vhosting', ad: 'BAGLI.ear' }),
    409,
    'engel',
  );
  assert.equal(S.launchlar.length, 0);
  assert.equal(DB.satirlar.length, 0);
});

test('ET4 aktif kayit 409; filtreli tekil yarisi da 409', async () => {
  await ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' });
  await reddeder(
    ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' }),
    409,
    'aktif_kayit',
  );
  assert.equal(S.launchlar.length, 1);
  // okuma kapisi INSERT'ten ONCE reddeder (tekil indeks yalniz yaris savunmasi)
  assert.equal(DB.sorgular.filter((q) => q.startsWith('INSERT')).length, 1);
  // es zamanli iki istek: ikisi de okumayi gecer, ikincisi INSERT'te UNIQUE ihlali alir
  const [a, b] = await Promise.allSettled([
    ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting8', ad: 'APPY.ear' }),
    ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting8', ad: 'APPY.ear' }),
  ]);
  const red = [a, b].filter((x) => x.status === 'rejected');
  assert.equal(red.length, 1);
  assert.equal(red[0].reason.status, 409);
  assert.equal(S.launchlar.length, 2);
});

// ── ET5 ──
test('ET5 plan extra_vars birebir (plan_only true, ear_fp bos), kayit PLANLANIYOR + denetim', async () => {
  const k = await ET.onKontrol(istek('ali'), { host: 'hosta', kok: '/vhosting8', ad: 'APPY.ear' });
  assert.equal(S.launchlar.length, 1);
  const l = S.launchlar[0];
  assert.equal(l.key, 'server_hub_fix');
  assert.deepEqual(l.extraVars, {
    target_host: 'HOSTA',
    action: 'ear_cleanup',
    plan_only: true,
    gen: 8,
    ear_root: '/vhosting8',
    ear_name: 'APPY.ear',
    ear_fp: '',
  });
  assert.equal(k.durum, 'PLANLANIYOR');
  assert.equal(k.planJobId, 101);
  assert.equal(k.olusturan, 'ali');
  assert.equal(k.prod, false);
  assert.ok(S.denetim.some((d) => d.op === 'ear_temizlik_plan' && d.id === k.id));
});

// ── ET6 / ET7 ──
test('ET6 plan PLAN -> PLAN_HAZIR, fp + ls + info ekranda', async () => {
  const t = await hazirPlan();
  assert.equal(t.plan.fp, FP);
  assert.deepEqual(t.plan.ls, PLAN_EAR.ls);
  assert.deepEqual(t.plan.info[0], { anahtar: 'bicim', deger: 'ACIK' });
  assert.ok(t.kalanSn > 1700 && t.kalanSn <= 1800, String(t.kalanSn));
  assert.ok(t.planBitisAt);
  assert.ok(
    S.denetim.some((d) => d.op === 'ear_temizlik_sonuc' && d.faz === 'plan' && d.sonuc === 'PLAN'),
  );
});

test('ET7 FAIL / set_stats yok / baska eylem / fp yok -> PLAN_HATA', async () => {
  const durumlar = [
    [
      sonucJob('FAIL', 'sembolik bag - elle incelenmeli', {
        fp: '',
        ls: ['lrwxrwxrwx x'],
        info: [],
      }),
      /FAIL sembolik bag/,
    ],
    [{ status: 'successful', artifacts: {} }, /playbook güncel mi/],
    [
      {
        status: 'successful',
        artifacts: {
          server_hub_fix_result: { action: 'jboss_retire', line: 'RESULT\tjboss_retire\tPLAN\tx' },
        },
      },
      /playbook güncel mi/,
    ],
    [sonucJob('PLAN', 'x', { fp: 'kisa', ls: [], info: [] }), /parmak izi yok/],
  ];
  const adlar = [
    ['HOSTA', '/vhosting', 'APPX.ear'],
    ['HOSTA', '/vhosting8', 'APPY.ear'],
    ['HOSTP', '/vhosting', 'PRODAPP.ear'],
    ['HOSTU', '/vhosting', 'UNK.ear'],
  ];
  for (let i = 0; i < durumlar.length; i += 1) {
    const [h, kok, ad] = adlar[i];
    const k = await ET.onKontrol(istek(), { host: h, kok, ad });
    S.jobs.set(k.planJobId, durumlar[i][0]);
    const t = await ET.tekKayit(k.id);
    assert.equal(t.durum, 'PLAN_HATA', `durum ${i}`);
    assert.match(t.sonuc, durumlar[i][1]);
    await reddeder(
      ET.sil(istek(), k.id, {
        confirmed: true,
        ocoNo: '123456',
        onayMetni: ad,
        planJobId: k.planJobId,
      }),
      409,
      'durum',
    );
  }
  // FAIL'de ls yine gosterilir (neden gorulsun)
  assert.deepEqual((await ET.tekKayit(1)).plan.ls, ['lrwxrwxrwx x']);
  assert.equal(S.launchlar.length, 4);
});

test('ET7b suren plan isi: sonuc yokken durum degismez', async () => {
  const k = await ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' });
  const t = await ET.tekKayit(k.id);
  assert.equal(t.durum, 'PLANLANIYOR');
});

// ── ET8 ──
test('ET8 sure dolunca PLAN_ESKIDI, sil reddedilir ve launch yok', async () => {
  const t = await hazirPlan();
  DB.kayma = 31 * 60 * 1000;
  await reddeder(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'APPX.ear',
      planJobId: t.planJobId,
    }),
    409,
    'plan_eskidi',
  );
  assert.equal(DB.satirlar[0].durum, 'PLAN_ESKIDI');
  assert.equal(S.launchlar.length, 1);
  const l = await ET.liste(false);
  assert.equal(l.kayitlar[0].durum, 'PLAN_ESKIDI');
  // eskiyen kayit aktif sayilmaz: yeniden on kontrol acilir
  const k2 = await ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' });
  assert.equal(k2.durum, 'PLANLANIYOR');
});

test('ET8b eskime CAS aninda: kapilar gecse de sure CAS kosulunda dolmus -> plan_eskidi', async () => {
  const t = await hazirPlan();
  // getAssessment cagrisinda (kapilardan sonra, CAS'tan once) saat ilerler
  const eski = S.a;
  ET.kur({
    ...mevcutDeps(),
    getAssessment: async () => {
      DB.kayma = 31 * 60 * 1000;
      return eski;
    },
  });
  await reddeder(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'APPX.ear',
      planJobId: t.planJobId,
    }),
    409,
    'plan_eskidi',
  );
  assert.equal(S.launchlar.length, 1);
});

let _mevcut = null;
function mevcutDeps() {
  return _mevcut;
}
beforeEach(() => {
  // ET8b icin: beforeEach'te kurulan bagimliliklarin kopyasi
  const deps = {
    db: {
      query: async (sql, p) => {
        if (S.dbHata && S.dbHata(temiz(sql))) throw new Error('sahte DB: baglanti koptu');
        return query(sql, p);
      },
    },
    HOST_RE: /^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/,
    getAssessment: async () => S.a,
    launch: async (req, key, tpl, extraVars, detail) => {
      S.launchlar.push({ key, tpl, extraVars, detail, kim: req.session.user.username });
      if (S.launchGecikme) await new Promise((r) => setTimeout(r, S.launchGecikme));
      if (S.launchHata) throw S.launchHata;
      S.jobNo += 1;
      return { jobId: S.jobNo, status: 'pending', awxServerId: 1 };
    },
    isDurumu: async (sid, jid) => {
      if (S.isGecikme) await new Promise((r) => setTimeout(r, S.isGecikme));
      return S.jobs.get(Number(jid)) || { status: 'running' };
    },
    envanterKosu: async (o) => {
      S.envanter.push(o);
      if (S.envanterHata) throw S.envanterHata;
      return S.envanterSonuc || { id: 77, beklenen: 1 };
    },
    audit: (req, d) => S.denetim.push(d),
    // Uretimde silme yalniz acik OCO penceresinde: varsayilan pencere ACIK; testler S.ocoPencere ile degistirir.
    ocoPenceresiOku: async (no) => {
      S.ocoCagri.push(no);
      return S.ocoPencere ? S.ocoPencere(no) : { ok: true, ocoNumber: no };
    },
  };
  _mevcut = deps;
  ET.kur(deps);
});

// ── ET9 ──
test('ET9 onayMetni / planJobId uyusmazligi reddi; launch yok, durum PLAN_HAZIR', async () => {
  const t = await hazirPlan();
  await reddeder(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'appx.ear',
      planJobId: t.planJobId,
    }),
    400,
    'onay_metni',
  );
  await reddeder(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: ' APPX.ear',
      planJobId: t.planJobId,
    }),
    400,
    'onay_metni',
  );
  await reddeder(
    ET.sil(istek(), t.id, { confirmed: true, planJobId: t.planJobId }),
    400,
    'onay_metni',
  );
  await reddeder(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'APPX.ear',
      planJobId: t.planJobId + 1,
    }),
    409,
    'plan_degisti',
  );
  await reddeder(
    ET.sil(istek(), t.id, { confirmed: true, ocoNo: '123456', onayMetni: 'APPX.ear' }),
    409,
    'plan_degisti',
  );
  await reddeder(
    ET.sil(istek(), 999, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'APPX.ear',
      planJobId: t.planJobId,
    }),
    404,
    'kayit_yok',
  );
  assert.equal(S.launchlar.length, 1);
  assert.equal(DB.satirlar[0].durum, 'PLAN_HAZIR');
});

// ── ET10 ──
test('ET10 CAS: cift tik tek silme isi acar', async () => {
  const t = await hazirPlan();
  S.launchGecikme = 20;
  const govde = { confirmed: true, ocoNo: '123456', onayMetni: 'APPX.ear', planJobId: t.planJobId };
  const r = await Promise.allSettled([ET.sil(istek(), t.id, govde), ET.sil(istek(), t.id, govde)]);
  const ok = r.filter((x) => x.status === 'fulfilled');
  const red = r.filter((x) => x.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(red.length, 1);
  assert.equal(red[0].reason.status, 409);
  assert.equal(S.launchlar.filter((l) => l.extraVars.plan_only === false).length, 1);
  assert.equal(ok[0].value.durum, 'SILINIYOR');
  assert.equal(ok[0].value.silJobId, 102);
});

// ── ET11 / ET12 ──
test('ET11 launchBelirsiz -> BELIRSIZ, tekrar denenmez', async () => {
  const t = await hazirPlan();
  S.launchHata = Object.assign(new Error('zaman asimi'), { launchBelirsiz: true });
  const govde = { confirmed: true, ocoNo: '123456', onayMetni: 'APPX.ear', planJobId: t.planJobId };
  await reddeder(ET.sil(istek(), t.id, govde), 502, 'launch_belirsiz');
  assert.equal(DB.satirlar[0].durum, 'BELIRSIZ');
  assert.match(DB.satirlar[0].sonuc, /tekrar denenmez/);
  S.launchHata = null;
  await reddeder(ET.sil(istek(), t.id, govde), 409, 'durum');
  assert.equal(S.launchlar.length, 2);
  // BELIRSIZ aktif degil ama GET onu ilerletmez (AWX'e sorulacak is numarasi yok)
  assert.equal((await ET.tekKayit(t.id)).durum, 'BELIRSIZ');
});

test('ET12 kesin launch reddi -> PLAN_HAZIR geri, yeniden denenebilir', async () => {
  const t = await hazirPlan();
  S.launchHata = Object.assign(new Error('Bad Request'), { status: 400 });
  const govde = { confirmed: true, ocoNo: '123456', onayMetni: 'APPX.ear', planJobId: t.planJobId };
  await reddeder(ET.sil(istek(), t.id, govde), 400);
  assert.equal(DB.satirlar[0].durum, 'PLAN_HAZIR');
  assert.equal(DB.satirlar[0].onaylayan, null);
  S.launchHata = null;
  const k = await ET.sil(istek(), t.id, govde);
  assert.equal(k.durum, 'SILINIYOR');
});

// ── ET13 ──
test('ET13 sil extra_vars birebir: plan_only false, ear_fp = plandaki parmak izi', async () => {
  const t = await hazirPlan('APPY.ear', '/vhosting8');
  const k = await ET.sil(istek('veli'), t.id, {
    confirmed: true,
    onayMetni: 'APPY.ear',
    planJobId: t.planJobId,
  });
  const l = S.launchlar.at(-1);
  assert.equal(l.key, 'server_hub_fix');
  assert.deepEqual(l.extraVars, {
    target_host: 'HOSTA',
    action: 'ear_cleanup',
    plan_only: false,
    gen: 8,
    ear_root: '/vhosting8',
    ear_name: 'APPY.ear',
    ear_fp: FP,
  });
  assert.equal(k.onaylayan, 'veli');
  assert.ok(S.denetim.some((d) => d.op === 'ear_temizlik_sil' && d.id === t.id));
});

// ── ET14 / ET15 / ET16 ──
async function silindi(envHata) {
  const t = await hazirPlan();
  const k = await ET.sil(istek('veli'), t.id, {
    confirmed: true,
    onayMetni: 'APPX.ear',
    planJobId: t.planJobId,
  });
  S.envanterHata = envHata || null;
  S.jobs.set(
    k.silJobId,
    sonucJob('OK', 'silindi; yedek /var/tmp/server_hub_backup/ear-APPX.ear-1.tgz', {
      ...PLAN_EAR,
      backup: '/var/tmp/server_hub_backup/ear-APPX.ear-1.tgz',
    }),
  );
  return (await ET.liste(false)).kayitlar.find((x) => x.id === t.id);
}

test('ET14 OK -> SILINDI + yedek + tek sunucu Uygulama Envanteri taramasi (bir kez)', async () => {
  const k = await silindi();
  assert.equal(k.durum, 'SILINDI');
  assert.equal(k.yedek, '/var/tmp/server_hub_backup/ear-APPX.ear-1.tgz');
  assert.equal(k.envanter.kosuId, 77);
  assert.equal(S.envanter.length, 1);
  assert.equal(S.envanter[0].kip, 'OZET');
  assert.equal(S.envanter[0].kapsam, 'SECILI');
  assert.deepEqual(S.envanter[0].hedefler, ['HOSTA']);
  assert.equal(S.envanter[0].req.session.user.username, 'veli');
  assert.ok(S.denetim.some((d) => d.op === 'ear_temizlik_sonuc' && d.durum === 'SILINDI'));
  await ET.liste(false);
  await ET.tekKayit(k.id);
  assert.equal(S.envanter.length, 1, 'tarama yeniden baslatilmaz');
});

test('ET15 calisan envanter kosusu (409) -> not', async () => {
  const k = await silindi(
    Object.assign(new Error('Çalışan bir Uygulama Envanteri taraması var'), {
      status: 409,
      code: 'kosu_calisiyor',
    }),
  );
  assert.equal(k.durum, 'SILINDI');
  assert.equal(k.envanter.kosuId, null);
  assert.equal(k.envanter.not, ET.ENVANTER_SURUYOR);
});

test('ET16 sil FAIL -> HATA, envanter taramasi yok; set_stats yok -> HATA (playbook)', async () => {
  const t = await hazirPlan();
  const k = await ET.sil(istek(), t.id, {
    confirmed: true,
    ocoNo: '123456',
    onayMetni: 'APPX.ear',
    planJobId: t.planJobId,
  });
  S.jobs.set(k.silJobId, sonucJob('FAIL', 'parmak izi degisti - HICBIR SEY silinmedi', PLAN_EAR));
  const h = await ET.tekKayit(k.id);
  assert.equal(h.durum, 'HATA');
  assert.match(h.sonuc, /parmak izi degisti/);
  assert.equal(S.envanter.length, 0);
  const t2 = await hazirPlan('APPY.ear', '/vhosting8');
  const k2 = await ET.sil(istek(), t2.id, {
    confirmed: true,
    ocoNo: '123456',
    onayMetni: 'APPY.ear',
    planJobId: t2.planJobId,
  });
  S.jobs.set(k2.silJobId, { status: 'failed', artifacts: {} });
  const h2 = await ET.tekKayit(k2.id);
  assert.equal(h2.durum, 'HATA');
  assert.match(h2.sonuc, /playbook güncel mi/);
});

// ── ET17 ──
test('ET17 onay aninda bulgu artik yok / engel -> 409, launch yok', async () => {
  const t = await hazirPlan();
  S.a = { hosts: [host('HOSTA', 'Non-Production', [])] };
  await reddeder(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'APPX.ear',
      planJobId: t.planJobId,
    }),
    409,
    'bulgu_yok',
  );
  S.a = {
    hosts: [
      host(
        'HOSTA',
        'Non-Production',
        [bulgu('/vhosting', 'APPX.ear', '7')],
        [{ kok: '/vhosting', ad: 'APPX.ear', xml: { durum: 'VAR' } }],
      ),
    ],
  };
  await reddeder(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'APPX.ear',
      planJobId: t.planJobId,
    }),
    409,
    'engel',
  );
  assert.equal(S.launchlar.length, 1);
  assert.equal(DB.satirlar[0].durum, 'PLAN_HAZIR');
});

// ── ET18 ──
test('ET18 iptal: yalniz PLAN_HAZIR', async () => {
  const t = await hazirPlan();
  const k = await ET.iptal(istek(), t.id);
  assert.equal(k.durum, 'IPTAL');
  assert.ok(S.denetim.some((d) => d.op === 'ear_temizlik_iptal'));
  await reddeder(ET.iptal(istek(), t.id), 409, 'durum');
  await reddeder(ET.iptal(istek(), 999), 404, 'kayit_yok');
  await reddeder(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'APPX.ear',
      planJobId: t.planJobId,
    }),
    409,
    'durum',
  );
});

// ── ET19: HTTP ──
function sahteRouter() {
  const r = { h: {} };
  r.get = (p, fn) => {
    r.h[`GET ${p}`] = fn;
  };
  r.post = (p, fn) => {
    r.h[`POST ${p}`] = fn;
  };
  return r;
}
async function cagir(router, method, yol, params = {}, body = {}, query = {}) {
  const res = { code: 200, body: null };
  res.status = (c) => {
    res.code = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  await router.h[`${method} ${yol}`]({ ...istek(), method, params, body, query, path: yol }, res);
  return res;
}

test('ET19 HTTP: uclar, confirmed zorunlu, 5xx POST -> 424', async () => {
  const router = sahteRouter();
  ET.mount(router, mevcutDeps());
  const l = await cagir(router, 'GET', '/ear-temizlik');
  assert.equal(l.code, 200);
  assert.equal(l.body.ok, true);
  assert.equal(l.body.planGecerlilikDk, 30);
  const o = await cagir(
    router,
    'POST',
    '/ear-temizlik/on-kontrol',
    {},
    { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' },
  );
  assert.equal(o.code, 200);
  const id = o.body.kayit.id;
  S.jobs.set(o.body.kayit.planJobId, sonucJob('PLAN', 'ok', PLAN_EAR));
  const g = await cagir(router, 'GET', '/ear-temizlik/:id', { id: String(id) });
  assert.equal(g.body.kayit.durum, 'PLAN_HAZIR');
  const c = await cagir(
    router,
    'POST',
    '/ear-temizlik/:id/sil',
    { id: String(id) },
    { onayMetni: 'APPX.ear', planJobId: g.body.kayit.planJobId },
  );
  assert.equal(c.code, 400);
  assert.equal((await cagir(router, 'GET', '/ear-temizlik/:id', { id: 'x' })).code, 400);
  const e = await cagir(
    router,
    'POST',
    '/ear-temizlik/on-kontrol',
    {},
    { host: 'HOSTA', kok: '/vhosting', ad: 'NOPE.ear' },
  );
  assert.equal(e.code, 404);
  S.launchHata = Object.assign(new Error('AWX 503'), { status: 503 });
  const f = await cagir(
    router,
    'POST',
    '/ear-temizlik/on-kontrol',
    {},
    { host: 'HOSTA', kok: '/vhosting8', ad: 'APPY.ear' },
  );
  assert.equal(f.code, 424);
  assert.equal(f.body.upstreamStatus, 503);
  assert.equal(DB.satirlar.find((x) => x.ad === 'APPY.ear').durum, 'PLAN_HATA');
  S.launchHata = null;
  const s = await cagir(
    router,
    'POST',
    '/ear-temizlik/:id/sil',
    { id: String(id) },
    { confirmed: true, ocoNo: '123456', onayMetni: 'APPX.ear', planJobId: g.body.kayit.planJobId },
  );
  assert.equal(s.code, 200);
  assert.equal(s.body.kayit.durum, 'SILINIYOR');
  const i = await cagir(router, 'POST', '/ear-temizlik/:id/iptal', { id: String(id) });
  assert.equal(i.code, 409);
});

// ── ET20 (inceleme B1) ──
test('ET20 ls ciktisi yoksa / liste degilse / ilk satir P degilse PLAN_HATA; kayitta ls yoksa sil 409 ls_yok', async () => {
  const durumlar = [
    [{ ...PLAN_EAR, ls: [] }, /ls -ltr çıktısı gelmedi — teyit/],
    [
      { ...PLAN_EAR, ls: "['drwxr-x--- 3 was was 4096 Nov 1 10:00 /vhosting/APPX.ear']" },
      /liste değil: string/,
    ],
    [
      { ...PLAN_EAR, ls: ['total 8', '-rw-r----- 1 was was 120 Nov 1 10:00 application.xml'] },
      /ilk satırı/,
    ],
    [
      { ...PLAN_EAR, ls: ['drwxr-x--- 3 was was 4096 Nov 1 10:00 /vhosting/BASKA.ear'] },
      /ilk satırı/,
    ],
  ];
  const adlar = [
    ['HOSTA', '/vhosting', 'APPX.ear'],
    ['HOSTA', '/vhosting8', 'APPY.ear'],
    ['HOSTP', '/vhosting', 'PRODAPP.ear'],
    ['HOSTU', '/vhosting', 'UNK.ear'],
  ];
  for (let i = 0; i < durumlar.length; i += 1) {
    const [h, kok, ad] = adlar[i];
    const k = await ET.onKontrol(istek(), { host: h, kok, ad });
    S.jobs.set(k.planJobId, sonucJob('PLAN', 'plan hazir', durumlar[i][0]));
    const t = await ET.tekKayit(k.id);
    assert.equal(t.durum, 'PLAN_HATA', `durum ${i}`);
    assert.match(t.sonuc, durumlar[i][1]);
  }
  // yol ile bitse de ls -ld / ls -l satiri olmayan ilk satir (hata metni, sembolik bag turu) kabul edilmez
  for (const ilk of [
    'ls: okunamadi /vhosting/APPX.ear',
    'lrwxrwxrwx 1 was was 9 Nov 1 10:00 /vhosting/APPX.ear',
  ]) {
    DB.satirlar = [];
    const k = await ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' });
    S.jobs.set(k.planJobId, sonucJob('PLAN', 'plan hazir', { ...PLAN_EAR, ls: [ilk] }));
    const t = await ET.tekKayit(k.id);
    assert.equal(t.durum, 'PLAN_HATA', ilk);
    assert.match(t.sonuc, /ilk satırı/);
  }
  // gecerli ls: dizin (ls -ld, SELinux noktasi) ve arsiv (ls -l) satirlari kabul
  for (const [kok, ad, ilk] of [
    ['/vhosting', 'APPX.ear', 'drwxr-x---. 3 was was 4096 Nov 1 10:00 /vhosting/APPX.ear'],
    ['/vhosting8', 'APPY.ear', '-rw-r----- 1 was was 9 Nov 1 10:00 /vhosting8/APPY.ear'],
  ]) {
    DB.satirlar = [];
    const k = await ET.onKontrol(istek(), { host: 'HOSTA', kok, ad });
    S.jobs.set(k.planJobId, sonucJob('PLAN', 'plan hazir', { ...PLAN_EAR, ls: [ilk] }));
    assert.equal((await ET.tekKayit(k.id)).durum, 'PLAN_HAZIR', ilk);
  }
  // kayitta (eski surum / elle) PLAN_HAZIR ama ls bos: silme kapisi reddeder, launch yok
  DB.satirlar = [];
  const t = await hazirPlan();
  const once = S.launchlar.length;
  DB.satirlar[0].plan_json = JSON.stringify({ fp: FP, ls: [], info: [] });
  await reddeder(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'APPX.ear',
      planJobId: t.planJobId,
    }),
    409,
    'ls_yok',
  );
  DB.satirlar[0].plan_json = JSON.stringify({ fp: FP, ls: ['total 0'], info: [] });
  await reddeder(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'APPX.ear',
      planJobId: t.planJobId,
    }),
    409,
    'ls_yok',
  );
  assert.equal(S.launchlar.length, once);
  assert.equal(DB.satirlar[0].durum, 'PLAN_HAZIR');
});

// ── ET21 (inceleme B2) ──
test('ET21 ls kesintisi: betigin en cok 302 satiri (tasma notu dahil) korunur; fazlasi Portal notuyla', async () => {
  assert.equal(ET.LS_MAX, 302);
  const ilk = 'drwxr-x--- 3 was was 4096 Nov 1 10:00 /vhosting/APPX.ear';
  const ic = Array.from({ length: 300 }, (_, i) => `-rw-r----- 1 was was 1 Nov 1 10:00 f${i}`);
  const betik = [ilk, ...ic, '... (12 satır daha)'];
  const k = await ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' });
  S.jobs.set(k.planJobId, sonucJob('PLAN', 'plan hazir', { ...PLAN_EAR, ls: betik }));
  const t = await ET.tekKayit(k.id);
  assert.equal(t.durum, 'PLAN_HAZIR');
  assert.equal(t.plan.ls.length, 302);
  assert.equal(t.plan.ls.at(-1), '... (12 satır daha)', 'betigin tasma notu kesilmez');
  // sozlesme disi fazla satir: sessiz kesinti yok, son satir Portal notu
  const k2 = await ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting8', ad: 'APPY.ear' });
  const fazla = [
    'drwxr-x--- 3 was was 4096 Nov 1 10:00 /vhosting8/APPY.ear',
    ...ic,
    'x1',
    'x2',
    'x3',
    'x4',
  ];
  S.jobs.set(k2.planJobId, sonucJob('PLAN', 'plan hazir', { ...PLAN_EAR, ls: fazla }));
  const t2 = await ET.tekKayit(k2.id);
  assert.equal(t2.plan.ls.length, 302);
  assert.equal(t2.plan.ls.at(-1), '... (Portal: 4 satır daha gösterilmedi)');
  assert.equal(t2.plan.ls.at(-2), '-rw-r----- 1 was was 1 Nov 1 10:00 f299');
});

// ── ET22 (inceleme B3) ──
test("ET22 envanter notu: yalniz kosu_calisiyor 'suruyor'; diger 409 ve ilkParti.hata gercek hata", async () => {
  const k = await silindi(
    Object.assign(new Error('AWX şablonu farklı playbook koşuyor'), {
      status: 409,
      code: 'awx_template_playbook_mismatch',
    }),
  );
  assert.equal(k.durum, 'SILINDI');
  assert.notEqual(k.envanter.not, ET.ENVANTER_SURUYOR);
  assert.match(k.envanter.not, /başlatılamadı \(AWX şablonu farklı playbook koşuyor\)/);
  DB.satirlar = [];
  S.envanter = [];
  S.envanterSonuc = { id: 78, beklenen: 1, ilkParti: { hata: 'AWX 503', yenidenDenenecek: true } };
  const k2 = await silindi();
  assert.equal(k2.envanter.kosuId, 78);
  assert.match(
    k2.envanter.not,
    /#78 açıldı ama AWX işi henüz başlatılamadı \(AWX 503\); yeniden denenecek/,
  );
  DB.satirlar = [];
  S.envanterSonuc = { id: 79, beklenen: 1, ilkParti: { hata: 'AWX 503', yenidenDenenecek: false } };
  const k3 = await silindi();
  assert.match(k3.envanter.not, /#79 başlatılamadı/);
});

// ── ET23 (inceleme B4) ──
test('ET23 silme isi acildi ama is numarasi yazilamadi: 502 kayit_yazilamadi + is numarasi + denetim', async () => {
  const t = await hazirPlan();
  S.dbHata = (q) => q.startsWith('UPDATE server_hub_ear_temizlik SET sil_awx_server_id');
  await assert.rejects(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'APPX.ear',
      planJobId: t.planJobId,
    }),
    (e) => {
      assert.equal(e.status, 502);
      assert.equal(e.code, 'kayit_yazilamadi');
      assert.match(e.message, /Silme işi #102 AWX'te başlatıldı/);
      assert.match(e.message, /tekrar denemeyin/);
      return true;
    },
  );
  S.dbHata = null;
  assert.ok(S.denetim.some((d) => d.op === 'ear_temizlik_sil' && d.jobId === 102));
  assert.equal(DB.satirlar[0].durum, 'SILINIYOR');
  // tekrar tik: kayit SILINIYOR, ikinci is acilmaz
  await reddeder(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'APPX.ear',
      planJobId: t.planJobId,
    }),
    409,
    'durum',
  );
  assert.equal(S.launchlar.filter((l) => l.extraVars.plan_only === false).length, 1);
});

// ── ET24 (inceleme N1/N2/N3/N7) ──
test('ET24 zaman asimlari: plan -> PLAN_HATA, silme -> BELIRSIZ (asla SILINDI)', async () => {
  const gecmis = (dk) => new Date(Date.now() - dk * 60000);
  // numarasiz plan: 9 dk bekler, 11 dk PLAN_HATA
  const k1 = await ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' });
  const r1 = DB.satirlar.find((x) => x.id === k1.id);
  r1.plan_job_id = null;
  r1.updated_at = gecmis(9);
  assert.equal((await ET.tekKayit(k1.id)).durum, 'PLANLANIYOR');
  r1.updated_at = gecmis(11);
  const h1 = await ET.tekKayit(k1.id);
  assert.equal(h1.durum, 'PLAN_HATA');
  assert.match(h1.sonuc, /iş numarası yok/);
  // bitmeyen plan: 179 dk bekler, 181 dk PLAN_HATA
  const k2 = await ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting8', ad: 'APPY.ear' });
  const r2 = DB.satirlar.find((x) => x.id === k2.id);
  r2.updated_at = gecmis(179);
  assert.equal((await ET.tekKayit(k2.id)).durum, 'PLANLANIYOR');
  r2.updated_at = gecmis(181);
  const h2 = await ET.tekKayit(k2.id);
  assert.equal(h2.durum, 'PLAN_HATA');
  assert.match(h2.sonuc, /3 saatte bitmedi/);
  // numarasiz silme: 11 dk BELIRSIZ
  DB.satirlar = [];
  const t3 = await hazirPlan();
  await ET.sil(istek(), t3.id, {
    confirmed: true,
    ocoNo: '123456',
    onayMetni: 'APPX.ear',
    planJobId: t3.planJobId,
  });
  const r3 = DB.satirlar[0];
  r3.sil_job_id = null;
  r3.updated_at = gecmis(9);
  assert.equal((await ET.tekKayit(t3.id)).durum, 'SILINIYOR');
  r3.updated_at = gecmis(11);
  const h3 = await ET.tekKayit(t3.id);
  assert.equal(h3.durum, 'BELIRSIZ');
  assert.match(h3.sonuc, /numarası yazılamadı/);
  // bitmeyen silme: 181 dk BELIRSIZ, envanter taramasi yok
  DB.satirlar = [];
  const t4 = await hazirPlan();
  await ET.sil(istek(), t4.id, {
    confirmed: true,
    ocoNo: '123456',
    onayMetni: 'APPX.ear',
    planJobId: t4.planJobId,
  });
  const r4 = DB.satirlar[0];
  r4.updated_at = gecmis(179);
  assert.equal((await ET.tekKayit(t4.id)).durum, 'SILINIYOR');
  r4.updated_at = gecmis(181);
  const h4 = await ET.tekKayit(t4.id);
  assert.equal(h4.durum, 'BELIRSIZ');
  assert.match(h4.sonuc, /3 saatte bitmedi/);
  assert.equal(h4.yedek, null);
  assert.equal(S.envanter.length, 0);
});

// ── ET25 (inceleme N4) ──
test('ET25 es zamanli iki GET: yalniz CAS kazanan envanter taramasi acar', async () => {
  const t = await hazirPlan();
  const k = await ET.sil(istek('veli'), t.id, {
    confirmed: true,
    onayMetni: 'APPX.ear',
    planJobId: t.planJobId,
  });
  S.jobs.set(
    k.silJobId,
    sonucJob('OK', 'silindi', {
      ...PLAN_EAR,
      backup: '/var/tmp/server_hub_backup/ear-APPX.ear-1.tgz',
    }),
  );
  S.isGecikme = 15;
  const [a, b] = await Promise.all([ET.tekKayit(t.id), ET.tekKayit(t.id)]);
  assert.equal(a.durum, 'SILINDI');
  assert.equal(b.durum, 'SILINDI');
  assert.equal(S.envanter.length, 1);
  assert.equal(S.denetim.filter((d) => d.op === 'ear_temizlik_sonuc' && d.faz === 'sil').length, 1);
});

// ── ET26 (inceleme N8) ──
test('ET26 salt okunur on kontrol OK donerse PLAN_HATA + BEKLENMEDIK + denetimde anomali', async () => {
  const k = await ET.onKontrol(istek(), { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' });
  S.jobs.set(
    k.planJobId,
    sonucJob('OK', 'silindi; yedek /var/tmp/x.tgz', { ...PLAN_EAR, backup: '/var/tmp/x.tgz' }),
  );
  const t = await ET.tekKayit(k.id);
  assert.equal(t.durum, 'PLAN_HATA');
  assert.match(t.sonuc, /^BEKLENMEDİK: salt okunur ön kontrol işi #101 sonucu OK/);
  const d = S.denetim.find((x) => x.op === 'ear_temizlik_sonuc' && x.faz === 'plan');
  assert.equal(d.anomali, true);
  assert.equal(d.yedek, '/var/tmp/x.tgz');
  assert.equal(S.envanter.length, 0);
});

// ── TOPLU (2026-11-16) ──
// ETT1 toplu on kontrol kismi basari; hicbiri -> 409 (sonuclar govdede); hepsi AWX 5xx -> 5xx (HTTP 424)
// ETT2 toplu on kontrol: tekil olmayan / 0 / 51 oge 400 (launch yok); 50 oge kabul
// ETT3 toplu sil HEPSI-YA-HIC: yanlis planJobId / olmayan / suresi dolmus / bulgu kalkti -> 409, hicbiri degismez
// ETT4 onayMetni tam "<n> EAR SIL" degilse 409; tekrar eden id 400
// ETT5 kuyruk: ayni sunucuda 2 kayit -> biri SILINIYOR biri sirada; ilki SILINDI olunca ikincisi baslar;
//      envanter taramasi son silmeden sonra TEK (iki kayda ayni kosu)
// ETT6 global TOPLU_ESZAMANLI (5) siniri
// ETT7 es zamanli kuyrukIlerlet / liste ayni kaydi iki kez baslatmaz, sunucu basina tek
// ETT8 sirada 60 dk -> PLAN_ESKIDI (launch yok); ETT9 eskit (30 dk) sirada kaydi eskitmez
// ETT10 toplu iptal yalniz siradakileri; SILINIYOR'a ve baska toplu isleme dokunmaz; gecersiz / bilinmeyen kimlik
// ETT11 tekli sil: sunucu doluysa sirada, GET :id ayni sunucuyu ilerletip baslatir; tekli iptal sirada kayitta
// ETT12 HTTP: toplu uclar :id uclarindan once, 409 govdesinde reddedilenler, 424 govdesinde sonuclar, sirada:true
// ETT13 kuyruktan (toplu) kesin launch reddi -> HATA (geri donmez), digerleri devam
// ETT14 CAS kaybeden: dogrulamadan sonra baska istek isaretlediyse kaybedenler'de, digerleri isaretli

const SIRA_DIGER = '11111111-2222-4333-8444-555555555555';

function cokHost(n) {
  const hosts = [];
  for (let i = 1; i <= n; i += 1)
    hosts.push(
      host(`H${i}`, i === 1 ? 'Production' : 'Non-Production', [
        bulgu('/vhosting', `E${i}.ear`, '7'),
      ]),
    );
  return { hosts };
}

const topluGovde = (planlar, metin) => ({
  confirmed: true,
  ocoNo: '123456',
  onayMetni: metin ?? `${planlar.length} EAR SIL`,
  kayitlar: planlar.map((t) => ({ id: t.id, planJobId: t.planJobId })),
});
const silLaunchlari = () => S.launchlar.filter((l) => l.extraVars.plan_only === false);
const okJob = (ad) =>
  sonucJob('OK', 'silindi', { ...PLAN_EAR, backup: `/var/tmp/server_hub_backup/ear-${ad}-1.tgz` });
const satir = (id) => DB.satirlar.find((x) => x.id === id);

test('ETT1 toplu on kontrol: kismi basari, hicbiri -> 409, hepsi AWX 5xx -> 5xx', async () => {
  let degerlendirme = 0;
  ET.kur({
    ...mevcutDeps(),
    getAssessment: async () => {
      degerlendirme += 1;
      return S.a;
    },
  });
  const y = await ET.topluOnKontrol(istek(), {
    adaylar: [
      { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' },
      { host: 'HOSTX', kok: '/vhosting', ad: 'BAGLI.ear' },
      { host: 'HOSTA', kok: '/vhosting', ad: 'BASKA.ear' },
      { host: 'hostp', kok: '/vhosting', ad: 'PRODAPP.ear' },
    ],
  });
  assert.equal(degerlendirme, 1, 'tek taze degerlendirme');
  assert.equal(y.basarili, 2);
  assert.equal(y.basarisiz, 2);
  assert.deepEqual(
    y.sonuclar.map((x) => [x.host, x.ad, x.ok]),
    [
      ['HOSTA', 'APPX.ear', true],
      ['HOSTX', 'BAGLI.ear', false],
      ['HOSTA', 'BASKA.ear', false],
      ['HOSTP', 'PRODAPP.ear', true],
    ],
  );
  assert.equal(y.sonuclar[0].id, 1);
  assert.match(y.sonuclar[1].message, /domain\.xml/);
  assert.match(y.sonuclar[2].message, /bulgusu yok/);
  assert.equal(S.launchlar.length, 2);
  assert.ok(S.launchlar.every((l) => l.extraVars.plan_only === true));
  const d = S.denetim.find((x) => x.op === 'ear_temizlik_toplu_plan');
  assert.equal(d.basarili, 2);
  assert.equal(d.ogeler.length, 4);
  // hicbiri baslamadi: 409, govdede sonuclar
  await assert.rejects(
    ET.topluOnKontrol(istek(), {
      adaylar: [
        { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' },
        { host: 'HOSTX', kok: '/vhosting', ad: 'BAGLI.ear' },
      ],
    }),
    (e) => {
      assert.equal(e.status, 409);
      assert.equal(e.ek.basarili, 0);
      assert.equal(e.ek.sonuclar.length, 2);
      assert.match(e.ek.sonuclar[0].message, /hâlâ/);
      return true;
    },
  );
  // hepsi AWX 5xx: 5xx (HTTP katmaninda 424)
  S.launchHata = Object.assign(new Error('AWX 503'), { status: 503 });
  await assert.rejects(
    ET.topluOnKontrol(istek(), {
      adaylar: [
        { host: 'HOSTA', kok: '/vhosting8', ad: 'APPY.ear' },
        { host: 'HOSTU', kok: '/vhosting', ad: 'UNK.ear' },
      ],
    }),
    (e) => {
      assert.equal(e.status, 503);
      assert.equal(e.ek.basarisiz, 2);
      return true;
    },
  );
});

test('ETT2 toplu on kontrol: tekil olmayan / bos / 51 oge 400; 50 oge kabul', async () => {
  await reddeder(
    ET.topluOnKontrol(istek(), {
      adaylar: [
        { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' },
        { host: 'hosta', kok: '/vhosting', ad: 'APPX.ear' },
      ],
    }),
    400,
    'toplu_tekrar',
  );
  await reddeder(ET.topluOnKontrol(istek(), { adaylar: [] }), 400, 'toplu_bos');
  await reddeder(ET.topluOnKontrol(istek(), {}), 400, 'toplu_bos');
  const cok = (n) =>
    Array.from({ length: n }, (_, i) => ({ host: 'HOSTA', kok: '/vhosting', ad: `N${i}.ear` }));
  await reddeder(ET.topluOnKontrol(istek(), { adaylar: cok(51) }), 400, 'toplu_fazla');
  // gecersiz oge (bicim) oge basina reddedilir: tek oge -> hicbiri baslamadi 409, oge mesajinda neden
  await assert.rejects(
    ET.topluOnKontrol(istek(), { adaylar: [{ host: 'HOSTA', kok: '/opt', ad: 'APPX.ear' }] }),
    (e) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, 'toplu_hicbiri');
      assert.equal(e.ek.sonuclar[0].ok, false);
      assert.match(e.ek.sonuclar[0].message, /Kök yalnız/);
      return true;
    },
  );
  assert.equal(S.launchlar.length, 0);
  assert.equal(DB.satirlar.length, 0);
  // 50 oge sinirin icinde: dogrulamadan gecer (bulgular yok -> 409, 400 degil)
  await reddeder(ET.topluOnKontrol(istek(), { adaylar: cok(50) }), 409, 'toplu_hicbiri');
  assert.equal(ET.TOPLU_MAX, 50);
});

test('ETT3 toplu sil hepsi-ya-hic: biri gecmezse hicbir kayit degismez', async () => {
  const t1 = await hazirPlan();
  const t2 = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  const t3 = await hazirPlan('UNK.ear', '/vhosting', 'HOSTU');
  const once = S.launchlar.length;
  const degismedi = () => {
    for (const t of [t1, t2, t3]) {
      assert.equal(satir(t.id).sil_istendi_at, null, `#${t.id} isaretlenmemeli`);
      assert.equal(satir(t.id).toplu_id, null);
    }
    assert.equal(S.launchlar.length, once);
  };
  // yanlis planJobId
  await assert.rejects(
    ET.topluSil(istek(), {
      ...topluGovde([t1, t2, t3]),
      kayitlar: [
        { id: t1.id, planJobId: t1.planJobId },
        { id: t2.id, planJobId: t2.planJobId + 99 },
        { id: t3.id, planJobId: t3.planJobId },
      ],
    }),
    (e) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, 'toplu_red');
      assert.deepEqual(
        e.ek.reddedilenler.map((x) => x.id),
        [t2.id],
      );
      return true;
    },
  );
  degismedi();
  assert.ok(!S.denetim.some((d) => d.op === 'ear_temizlik_toplu_sil'));
  // olmayan kayit
  await assert.rejects(
    ET.topluSil(istek(), {
      confirmed: true,
      onayMetni: '2 EAR SIL',
      kayitlar: [
        { id: t1.id, planJobId: t1.planJobId },
        { id: 999, planJobId: 1 },
      ],
    }),
    (e) => e.status === 409 && e.ek.reddedilenler[0].id === 999,
  );
  degismedi();
  // suresi dolmus (yalniz t3)
  satir(t3.id).plan_bitis_at = new Date(Date.now() - 31 * 60000);
  await assert.rejects(ET.topluSil(istek(), topluGovde([t1, t2, t3])), (e) => {
    assert.equal(e.status, 409);
    assert.deepEqual(
      e.ek.reddedilenler.map((x) => x.id),
      [t3.id],
    );
    assert.match(e.ek.reddedilenler[0].message, /dakikadan eski/);
    return true;
  });
  degismedi();
  assert.equal(satir(t1.id).durum, 'PLAN_HAZIR');
  // taze bulgu kalkti (t2)
  S.a = {
    hosts: S.a.hosts.map((h) => (h.host === 'HOSTP' ? { ...h, findings: [] } : h)),
  };
  await assert.rejects(ET.topluSil(istek(), topluGovde([t1, t2])), (e) => {
    assert.deepEqual(
      e.ek.reddedilenler.map((x) => x.id),
      [t2.id],
    );
    return true;
  });
  degismedi();
});

test('ETT4 onayMetni tam "<n> EAR SIL" degilse 409; tekrar eden id 400', async () => {
  const t1 = await hazirPlan();
  const t2 = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  for (const m of ['1 EAR SIL', '2 ear sil', ' 2 EAR SIL', '2 EAR SİL', 'APPX.ear', '']) {
    await reddeder(ET.topluSil(istek(), topluGovde([t1, t2], m)), 409, 'onay_metni');
  }
  await reddeder(ET.topluSil(istek(), topluGovde([t1, t1])), 400, 'toplu_tekrar');
  await reddeder(
    ET.topluSil(istek(), {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: '0 EAR SIL',
      kayitlar: [],
    }),
    400,
    'toplu_bos',
  );
  assert.equal(silLaunchlari().length, 0);
  assert.equal(satir(t1.id).sil_istendi_at, null);
  const y = await ET.topluSil(istek(), topluGovde([t1, t2]));
  assert.equal(y.baslatilan, 2);
});

test('ETT5 kuyruk: ayni sunucuda tek silme, ilki bitince ikincisi; envanter son silmeden sonra tek', async () => {
  const x = await hazirPlan();
  const yy = await hazirPlan('APPY.ear', '/vhosting8');
  const p = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  const y = await ET.topluSil(istek('veli'), topluGovde([x, yy, p]));
  assert.match(y.topluId, /^[0-9a-f-]{36}$/);
  assert.equal(y.baslatilan, 2);
  assert.equal(y.sirada, 1);
  assert.equal(y.kaybedenler, undefined);
  assert.equal(satir(x.id).durum, 'SILINIYOR');
  assert.equal(satir(p.id).durum, 'SILINIYOR');
  const k2 = (await ET.liste(false)).kayitlar.find((k) => k.id === yy.id);
  assert.equal(k2.durum, 'PLAN_HAZIR');
  assert.equal(k2.sirada, true);
  assert.equal(k2.topluId, y.topluId);
  assert.equal(k2.kalanSn, null);
  assert.equal(silLaunchlari().length, 2);
  assert.deepEqual(silLaunchlari()[0].extraVars, ET.extraVarsOf(satir(x.id), false, FP));
  assert.equal(silLaunchlari()[0].kim, 'veli');
  assert.equal(satir(x.id).onaylayan, 'veli');
  assert.equal(satir(x.id).sil_isteyen, 'veli');
  const d = S.denetim.find((q) => q.op === 'ear_temizlik_toplu_sil');
  assert.equal(d.topluId, y.topluId);
  assert.equal(d.isaretlenen, 3);
  assert.equal(d.prod, 1);
  // HOSTA'daki ilk silme biter: APPX SILINDI, tarama bekler, APPY baslar
  S.jobs.set(satir(x.id).sil_job_id, okJob('APPX.ear'));
  let l = await ET.liste(false);
  const kx = l.kayitlar.find((k) => k.id === x.id);
  assert.equal(kx.durum, 'SILINDI');
  assert.equal(kx.envanter.not, ET.ENVANTER_BEKLIYOR);
  assert.equal(kx.envanter.kosuId, null);
  assert.equal(l.kayitlar.find((k) => k.id === yy.id).durum, 'SILINIYOR');
  assert.equal(S.envanter.length, 0, 'ayni sunucuda bekleyen silme varken tarama yok');
  assert.equal(silLaunchlari().length, 3);
  // APPY biter: HOSTA icin TEK tarama, iki kayda ayni kosu
  S.jobs.set(satir(yy.id).sil_job_id, okJob('APPY.ear'));
  l = await ET.liste(false);
  assert.equal(S.envanter.length, 1);
  assert.deepEqual(S.envanter[0].hedefler, ['HOSTA']);
  for (const id of [x.id, yy.id]) {
    const k = l.kayitlar.find((q) => q.id === id);
    assert.equal(k.durum, 'SILINDI');
    assert.equal(k.envanter.kosuId, 77);
  }
  await ET.liste(false);
  await ET.tekKayit(x.id);
  assert.equal(S.envanter.length, 1, 'tarama yeniden baslatilmaz');
  // HOSTP kendi taramasini alir
  S.jobs.set(satir(p.id).sil_job_id, okJob('PRODAPP.ear'));
  await ET.tekKayit(p.id);
  assert.equal(S.envanter.length, 2);
  assert.deepEqual(S.envanter[1].hedefler, ['HOSTP']);
});

test('ETT6 global sinir: en cok 5 silme ayni anda', async () => {
  S.a = cokHost(7);
  const planlar = [];
  for (let i = 1; i <= 7; i += 1) planlar.push(await hazirPlan(`E${i}.ear`, '/vhosting', `H${i}`));
  const y = await ET.topluSil(istek(), topluGovde(planlar));
  assert.equal(ET.TOPLU_ESZAMANLI, 5);
  assert.equal(y.baslatilan, 5);
  assert.equal(y.sirada, 2);
  assert.equal(DB.satirlar.filter((r) => r.durum === 'SILINIYOR').length, 5);
  await ET.liste(false);
  assert.equal(silLaunchlari().length, 5, 'yer acilmadan baslamaz');
  // biri biter -> siradaki ilk (istek zamani, id sirasi) baslar
  S.jobs.set(satir(planlar[0].id).sil_job_id, okJob('E1.ear'));
  await ET.liste(false);
  assert.equal(DB.satirlar.filter((r) => r.durum === 'SILINIYOR').length, 5);
  assert.equal(satir(planlar[5].id).durum, 'SILINIYOR');
  assert.equal(satir(planlar[6].id).durum, 'PLAN_HAZIR');
  assert.equal(silLaunchlari().length, 6);
});

test('ETT7 es zamanli kuyruk cagrilari ayni kaydi iki kez baslatmaz', async () => {
  const x = await hazirPlan();
  const yy = await hazirPlan('APPY.ear', '/vhosting8');
  const p = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  // isaretli ama baslamamis (ornek: isaretleyen istegin kuyruk cagrisi henuz donmedi)
  for (const t of [x, yy, p]) {
    satir(t.id).sil_istendi_at = simdi();
    satir(t.id).oco_no = '123456';
    satir(t.id).sil_isteyen = 'veli';
  }
  S.launchGecikme = 15;
  await Promise.all([
    ET.kuyrukIlerlet(),
    ET.kuyrukIlerlet(),
    ET.liste(false),
    ET.tekKayit(yy.id),
    ET.kuyrukIlerlet(),
  ]);
  const ids = silLaunchlari().map((l) => `${l.extraVars.target_host}:${l.extraVars.ear_name}`);
  assert.deepEqual(
    [...ids].sort((a, b) => a.localeCompare(b)),
    ['HOSTA:APPX.ear', 'HOSTP:PRODAPP.ear'],
  );
  assert.equal(satir(yy.id).durum, 'PLAN_HAZIR');
  assert.notEqual(satir(x.id).sil_job_id, null);
});

async function siradaKur() {
  const x = await hazirPlan();
  const yy = await hazirPlan('APPY.ear', '/vhosting8');
  const y = await ET.topluSil(istek('veli'), topluGovde([x, yy]));
  assert.equal(y.sirada, 1);
  return { x, yy, y };
}

test('ETT8 sirada 60 dk asilinca PLAN_ESKIDI, launch yok', async () => {
  const { x, yy } = await siradaKur();
  const r = satir(yy.id);
  r.sil_istendi_at = new Date(Date.now() - 59 * 60000);
  r.plan_bitis_at = new Date(Date.now() - 59 * 60000);
  await ET.liste(false);
  assert.equal(r.durum, 'PLAN_HAZIR', '59 dk: hala sirada');
  r.sil_istendi_at = new Date(Date.now() - 61 * 60000);
  const k = (await ET.liste(false)).kayitlar.find((q) => q.id === yy.id);
  assert.equal(k.durum, 'PLAN_ESKIDI');
  assert.equal(k.sonuc, ET.SIRA_ESKIDI_NOTU);
  assert.equal(k.sirada, false);
  // HOSTA'daki silme biter: eskiyen kayit baslamaz; bekleyen kalmadigi icin tarama hemen
  S.jobs.set(satir(x.id).sil_job_id, okJob('APPX.ear'));
  await ET.liste(false);
  assert.equal(silLaunchlari().length, 1);
  assert.equal(S.envanter.length, 1);
  assert.ok(S.denetim.some((d) => d.faz === 'sira' && d.durum === 'PLAN_ESKIDI'));
});

test('ETT9 eskit (30 dk) sirada kaydi eskitmez; siradan baslar', async () => {
  const { x, yy } = await siradaKur();
  DB.kayma = 31 * 60 * 1000;
  await ET.liste(false);
  await ET.tekKayit(yy.id);
  assert.equal(satir(yy.id).durum, 'PLAN_HAZIR');
  assert.ok(satir(yy.id).sil_istendi_at);
  S.jobs.set(satir(x.id).sil_job_id, okJob('APPX.ear'));
  await ET.tekKayit(yy.id);
  assert.equal(satir(yy.id).durum, 'SILINIYOR');
  assert.equal(silLaunchlari().length, 2);
  assert.equal(silLaunchlari()[1].extraVars.ear_fp, FP);
  // sirada olmayan hazir plan ise eskir
  const t = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  DB.kayma += 31 * 60 * 1000;
  await ET.liste(false);
  assert.equal(satir(t.id).durum, 'PLAN_ESKIDI');
});

test('ETT10 toplu iptal yalniz siradakileri iptal eder', async () => {
  const x = await hazirPlan();
  const yy = await hazirPlan('APPY.ear', '/vhosting8');
  const p = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  const y = await ET.topluSil(istek(), topluGovde([x, yy, p]));
  // baska toplu islemin sirada kaydi (sunucusu dolu): dokunulmaz
  const u = await hazirPlan('UNK.ear', '/vhosting', 'HOSTU');
  Object.assign(satir(u.id), {
    sil_istendi_at: simdi(),
    oco_no: '123456',
    toplu_id: SIRA_DIGER,
    host: 'HOSTP',
  });
  const r = await ET.topluIptal(istek('ayse'), y.topluId);
  assert.deepEqual(r, { iptal: 1, suren: 2 });
  assert.equal(satir(yy.id).durum, 'IPTAL');
  assert.equal(satir(x.id).durum, 'SILINIYOR');
  assert.equal(satir(p.id).durum, 'SILINIYOR');
  assert.equal(satir(u.id).durum, 'PLAN_HAZIR');
  assert.ok(satir(u.id).sil_istendi_at);
  const d = S.denetim.find((q) => q.op === 'ear_temizlik_toplu_iptal');
  assert.equal(d.iptal, 1);
  assert.equal(d.topluId, y.topluId);
  assert.deepEqual(await ET.topluIptal(istek(), y.topluId), { iptal: 0, suren: 2 });
  await reddeder(ET.topluIptal(istek(), 'x; DROP'), 400, 'gecersiz_toplu');
  await reddeder(ET.topluIptal(istek(), 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'), 404, 'toplu_yok');
  // APPX biter: iptal edilen APPY baslamaz, HOSTA taramasi hemen
  S.jobs.set(satir(x.id).sil_job_id, okJob('APPX.ear'));
  await ET.tekKayit(x.id);
  assert.equal(satir(yy.id).durum, 'IPTAL');
  assert.equal(S.envanter.length, 1);
});

test('ETT11 tekli sil: sunucu doluysa sirada; GET :id ayni sunucuyu ilerletip baslatir; tekli iptal', async () => {
  const x = await hazirPlan();
  const yy = await hazirPlan('APPY.ear', '/vhosting8');
  const k1 = await ET.sil(istek(), x.id, {
    confirmed: true,
    ocoNo: '123456',
    onayMetni: 'APPX.ear',
    planJobId: x.planJobId,
  });
  assert.equal(k1.durum, 'SILINIYOR');
  assert.equal(k1.sirada, false);
  assert.equal(k1.topluId, null);
  const k2 = await ET.sil(istek(), yy.id, {
    confirmed: true,
    ocoNo: '123456',
    onayMetni: 'APPY.ear',
    planJobId: yy.planJobId,
  });
  assert.equal(k2.durum, 'PLAN_HAZIR');
  assert.equal(k2.sirada, true);
  assert.equal(silLaunchlari().length, 1);
  // tekrar istenemez
  await reddeder(
    ET.sil(istek(), yy.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'APPY.ear',
      planJobId: yy.planJobId,
    }),
    409,
    'sirada',
  );
  // GET :id (sirada kayit) HOSTA'daki silmeyi ilerletir, sonra kuyruk
  assert.equal((await ET.tekKayit(yy.id)).durum, 'PLAN_HAZIR');
  S.jobs.set(satir(x.id).sil_job_id, okJob('APPX.ear'));
  const k3 = await ET.tekKayit(yy.id);
  assert.equal(k3.durum, 'SILINIYOR');
  assert.equal(satir(x.id).durum, 'SILINDI');
  // tekli iptal sirada kayitta da calisir
  bulguEkle('HOSTP', '/vhosting', 'PROD2.ear', '7');
  const z = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  const w = await hazirPlan('PROD2.ear', '/vhosting', 'HOSTP');
  await ET.sil(istek(), z.id, {
    confirmed: true,
    ocoNo: '123456',
    onayMetni: 'PRODAPP.ear',
    planJobId: z.planJobId,
  });
  const kw = await ET.sil(istek(), w.id, {
    confirmed: true,
    ocoNo: '123456',
    onayMetni: 'PROD2.ear',
    planJobId: w.planJobId,
  });
  assert.equal(kw.sirada, true);
  const iw = await ET.iptal(istek(), w.id);
  assert.equal(iw.durum, 'IPTAL');
  assert.ok(S.denetim.some((d) => d.op === 'ear_temizlik_iptal' && d.id === w.id && d.sirada));
});

test('ETT12 HTTP: toplu uclar :id uclarindan once; 409 govdesinde reddedilenler; tekli sirada:true', async () => {
  const router = sahteRouter();
  ET.mount(router, mevcutDeps());
  const yollar = Object.keys(router.h);
  const sira = (y) => yollar.indexOf(y);
  assert.ok(sira('POST /ear-temizlik/toplu/sil') >= 0);
  assert.ok(sira('POST /ear-temizlik/toplu/sil') < sira('POST /ear-temizlik/:id/sil'));
  assert.ok(sira('POST /ear-temizlik/toplu/:topluId/iptal') >= 0);
  const o = await cagir(
    router,
    'POST',
    '/ear-temizlik/toplu/on-kontrol',
    {},
    {
      adaylar: [
        { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' },
        { host: 'HOSTA', kok: '/vhosting8', ad: 'APPY.ear' },
      ],
    },
  );
  assert.equal(o.code, 200);
  assert.equal(o.body.ok, true);
  assert.equal(o.body.basarili, 2);
  for (const s of o.body.sonuclar) {
    const r = satir(s.id);
    S.jobs.set(r.plan_job_id, sonucJob('PLAN', 'ok', planEar(r.kok, r.ad)));
  }
  const l = await cagir(router, 'GET', '/ear-temizlik');
  const hazir = l.body.kayitlar.filter((k) => k.durum === 'PLAN_HAZIR');
  assert.equal(hazir.length, 2);
  const c = await cagir(
    router,
    'POST',
    '/ear-temizlik/toplu/sil',
    {},
    { ...topluGovde(hazir), confirmed: undefined },
  );
  assert.equal(c.code, 400);
  const red = await cagir(
    router,
    'POST',
    '/ear-temizlik/toplu/sil',
    {},
    {
      ...topluGovde(hazir),
      kayitlar: [
        { id: hazir[0].id, planJobId: hazir[0].planJobId },
        { id: hazir[1].id, planJobId: 1 },
      ],
    },
  );
  assert.equal(red.code, 409);
  assert.equal(red.body.ok, false);
  assert.deepEqual(
    red.body.reddedilenler.map((x) => x.id),
    [hazir[1].id],
  );
  const s = await cagir(router, 'POST', '/ear-temizlik/toplu/sil', {}, topluGovde(hazir));
  assert.equal(s.code, 200);
  assert.equal(s.body.baslatilan, 1);
  assert.equal(s.body.sirada, 1);
  const i = await cagir(router, 'POST', '/ear-temizlik/toplu/:topluId/iptal', {
    topluId: s.body.topluId,
  });
  assert.deepEqual(i.body, { ok: true, iptal: 1, suren: 1 });
  // hepsi AWX 5xx: 424 + sonuclar
  S.launchHata = Object.assign(new Error('AWX 503'), { status: 503 });
  const f = await cagir(
    router,
    'POST',
    '/ear-temizlik/toplu/on-kontrol',
    {},
    { adaylar: [{ host: 'HOSTP', kok: '/vhosting', ad: 'PRODAPP.ear' }] },
  );
  assert.equal(f.code, 424);
  assert.equal(f.body.upstreamStatus, 503);
  assert.equal(f.body.sonuclar.length, 1);
  S.launchHata = null;
  // tekli sil HTTP: sunucu doluysa sirada:true
  bulguEkle('HOSTU', '/vhosting', 'UNK2.ear', '7');
  const t1 = await hazirPlan('UNK.ear', '/vhosting', 'HOSTU');
  const t2 = await hazirPlan('UNK2.ear', '/vhosting', 'HOSTU');
  const s1 = await cagir(
    router,
    'POST',
    '/ear-temizlik/:id/sil',
    { id: String(t1.id) },
    { confirmed: true, ocoNo: '123456', onayMetni: 'UNK.ear', planJobId: t1.planJobId },
  );
  assert.equal(s1.body.sirada, false);
  const s2 = await cagir(
    router,
    'POST',
    '/ear-temizlik/:id/sil',
    { id: String(t2.id) },
    { confirmed: true, ocoNo: '123456', onayMetni: 'UNK2.ear', planJobId: t2.planJobId },
  );
  assert.equal(s2.code, 200);
  assert.equal(s2.body.sirada, true);
  assert.equal(s2.body.kayit.sirada, true);
});

test('ETT13 kuyruktan kesin launch reddi -> HATA, digerleri devam', async () => {
  const x = await hazirPlan();
  const p = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  let n = 0;
  const asil = mevcutDeps();
  ET.kur({
    ...asil,
    launch: async (req, key, tpl, extraVars, detail) => {
      if (extraVars.plan_only === false) {
        n += 1;
        if (n === 1) throw Object.assign(new Error('Bad Request'), { status: 400 });
      }
      return asil.launch(req, key, tpl, extraVars, detail);
    },
  });
  const y = await ET.topluSil(istek(), topluGovde([x, p]));
  assert.equal(y.baslatilan, 1);
  assert.equal(satir(x.id).durum, 'HATA');
  assert.match(satir(x.id).sonuc, /silme işi başlatılamadı: Bad Request/);
  assert.equal(satir(p.id).durum, 'SILINIYOR');
  await ET.liste(false);
  assert.equal(satir(x.id).durum, 'HATA', 'yeniden denenmez');
});

test('ETT14 CAS kaybeden: dogrulamadan sonra baskasi isaretlediyse kaybedenler, digerleri isaretli', async () => {
  const x = await hazirPlan();
  const p = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  const eski = S.a;
  const asil = mevcutDeps();
  ET.kur({
    ...asil,
    getAssessment: async () => {
      // dogrulama okumasindan sonra, CAS'tan once: baska bir toplu istek x'i isaretledi
      Object.assign(satir(x.id), {
        sil_istendi_at: simdi(),
        oco_no: '123456',
        toplu_id: SIRA_DIGER,
      });
      return eski;
    },
  });
  const y = await ET.topluSil(istek(), topluGovde([x, p]));
  assert.deepEqual(y.kaybedenler, [x.id]);
  assert.equal(satir(x.id).toplu_id, SIRA_DIGER);
  assert.equal(satir(p.id).toplu_id, y.topluId);
  assert.equal(y.baslatilan, 1, 'yalniz bu islemin isaretledigi p sayilir');
  // hepsi kaybedilirse 409
  ET.kur(asil);
  const z = await hazirPlan('UNK.ear', '/vhosting', 'HOSTU');
  ET.kur({
    ...asil,
    getAssessment: async () => {
      satir(z.id).durum = 'IPTAL';
      return eski;
    },
  });
  await assert.rejects(ET.topluSil(istek(), topluGovde([z])), (e) => {
    assert.equal(e.status, 409);
    assert.deepEqual(e.ek.kaybedenler, [z.id]);
    return true;
  });
});

// ── INCELEME TUR 1 DUZELTMELERI (2026-11-16) ──
//   ETT15 BELIRSIZ gecisi de envanterKontrol'u tetikler (bekleyen SILINDI taramasi kaybolmaz)
//   ETT16 toplu on kontrol oge basina girdi hatasi; durum kodsuz belirsiz launch -> 5xx
//   ETT17 isaretleme / kuyruk hatasi: isaretlenen silmeler surerken "hata" yaniti verilmez
//   ETT18 sirada kayit baslatilmadan once bulgu kapisi (engel -> IPTAL); degerlendirme okunamazsa baslatma yok
//   ETT19 liste son 50'ye ek tum aktif kayitlari dondurur
//   ETT20 yurutucu turu kuyrugu sekmeden bagimsiz ilerletir; server/index.cjs'e kayitli
//   ETT21 toplu silmede ls -ltr ve parmak izi kapilari (kullanicinin ana sarti)
//   ETT22-25 baslatma CAS'i sirada kosulu; tekli iptal / toplu iptal CAS'i / baslatma hatasi sonrasi envanter

function bekleyenSilindi(h, kok, ad) {
  DB.sira += 1;
  const r = {
    id: DB.sira,
    host: h,
    kok,
    ad,
    jboss: 7,
    ortam: 'TEST',
    prod: 0,
    durum: 'SILINDI',
    olusturan: 'admin1',
    onaylayan: 'admin1',
    plan_awx_server_id: 1,
    plan_job_id: 900 + DB.sira,
    plan_bitis_at: simdi(),
    plan_json: null,
    sil_awx_server_id: 1,
    sil_job_id: 950 + DB.sira,
    sonuc: 'silindi',
    yedek: null,
    envanter_kosu_id: null,
    envanter_notu: ET.ENVANTER_BEKLIYOR,
    toplu_id: null,
    sil_istendi_at: simdi(),
    oco_no: '123456',
    sil_isteyen: 'admin1',
    created_at: simdi(),
    updated_at: simdi(),
  };
  DB.satirlar.push(r);
  return r;
}

test('ETT15 BELIRSIZ gecisi (zaman asimi / numarasiz) ayni sunucudaki bekleyen taramayi baslatir', async () => {
  const x = await hazirPlan();
  const yy = await hazirPlan('APPY.ear', '/vhosting8');
  await ET.topluSil(istek('veli'), topluGovde([x, yy]));
  S.jobs.set(satir(x.id).sil_job_id, okJob('APPX.ear'));
  await ET.liste(false);
  assert.equal(satir(x.id).durum, 'SILINDI');
  assert.equal(satir(x.id).envanter_notu, ET.ENVANTER_BEKLIYOR);
  assert.equal(satir(yy.id).durum, 'SILINIYOR');
  assert.equal(S.envanter.length, 0);
  satir(yy.id).updated_at = new Date(Date.now() - 4 * 3600 * 1000);
  await ET.liste(false);
  assert.equal(satir(yy.id).durum, 'BELIRSIZ');
  assert.equal(S.envanter.length, 1, 'zaman asimi BELIRSIZ: bekleyen tarama baslar');
  assert.deepEqual(S.envanter[0].hedefler, ['HOSTA']);
  assert.equal(satir(x.id).envanter_kosu_id, 77);
  // numarasiz silme (is numarasi yazilamadi) 10 dk sonra BELIRSIZ: yine tarama
  const p = bekleyenSilindi('HOSTP', '/vhosting', 'ESKI.ear');
  const z = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  Object.assign(satir(z.id), {
    durum: 'SILINIYOR',
    sil_istendi_at: simdi(),
    oco_no: '123456',
    sil_job_id: null,
    updated_at: new Date(Date.now() - 11 * 60000),
  });
  await ET.tekKayit(z.id);
  assert.equal(satir(z.id).durum, 'BELIRSIZ');
  assert.equal(S.envanter.length, 2);
  assert.deepEqual(S.envanter[1].hedefler, ['HOSTP']);
  assert.equal(satir(p.id).envanter_kosu_id, 77);
});

test('ETT16 toplu on kontrol: gecersiz oge yalniz kendisi ok:false; durum kodsuz belirsiz launch -> 502', async () => {
  const y = await ET.topluOnKontrol(istek(), {
    adaylar: [
      { host: 'HOSTA', kok: '/vhosting', ad: 'APPX.ear' },
      { host: 'HOSTA', kok: '/opt', ad: 'K.ear' },
      { host: 'HO STA', kok: '/vhosting', ad: 'APPX.ear' },
      null,
    ],
  });
  assert.equal(y.basarili, 1);
  assert.equal(y.basarisiz, 3);
  assert.deepEqual(
    y.sonuclar.map((x) => x.ok),
    [true, false, false, false],
  );
  assert.match(y.sonuclar[1].message, /Kök yalnız/);
  assert.match(y.sonuclar[2].message, /sunucu adı/);
  assert.equal(S.launchlar.length, 1);
  // tekillik gecerli ogeler uzerinde: ayni EAR iki kez -> 400 (gecersiz oge varken de)
  await reddeder(
    ET.topluOnKontrol(istek(), {
      adaylar: [
        { host: 'HOSTA', kok: '/vhosting8', ad: 'APPY.ear' },
        { host: 'HOSTA', kok: '/opt', ad: 'K.ear' },
        { host: 'hosta', kok: '/vhosting8', ad: 'APPY.ear' },
      ],
    }),
    400,
    'toplu_tekrar',
  );
  // ag kopmasi: launchBelirsiz, status yok -> 502 (HTTP'de 424)
  S.launchHata = Object.assign(new Error('socket hang up'), { launchBelirsiz: true });
  await assert.rejects(
    ET.topluOnKontrol(istek(), {
      adaylar: [
        { host: 'HOSTA', kok: '/vhosting8', ad: 'APPY.ear' },
        { host: 'HOSTU', kok: '/vhosting', ad: 'UNK.ear' },
      ],
    }),
    (e) => {
      assert.equal(e.status, 502);
      assert.equal(e.code, 'toplu_awx');
      assert.equal(e.ek.basarisiz, 2);
      return true;
    },
  );
});

test('ETT17 isaretleme / kuyruk hatasi: isaretlenen silmeler surerken hata yaniti yok', async () => {
  S.a = cokHost(7);
  const planlar = [];
  for (let i = 1; i <= 3; i += 1) planlar.push(await hazirPlan(`E${i}.ear`, '/vhosting', `H${i}`));
  let n = 0;
  S.dbHata = (q) => q.startsWith('UPDATE server_hub_ear_temizlik SET sil_istendi_at') && ++n === 3;
  const y = await ET.topluSil(istek(), topluGovde(planlar));
  S.dbHata = null;
  assert.deepEqual(y.kaybedenler, [planlar[2].id]);
  assert.equal(y.baslatilan, 2);
  assert.equal(y.sirada, 0);
  assert.equal(satir(planlar[2].id).sil_istendi_at, null);
  await ET.liste(false);
  assert.equal(silLaunchlari().length, 2, 'isaretlenmeyen kayit silinmez');
  // ilk isaretleme dusmusse hicbir kayit isaretli degil: hata yukari gider
  const t4 = await hazirPlan('E4.ear', '/vhosting', 'H4');
  S.dbHata = (q) => q.startsWith('UPDATE server_hub_ear_temizlik SET sil_istendi_at');
  await assert.rejects(ET.topluSil(istek(), topluGovde([t4])), /baglanti koptu/);
  S.dbHata = null;
  assert.equal(satir(t4.id).sil_istendi_at, null);
  // toplu: kuyruk hatasi istegi dusurmez; sayilar isaretlenenlerden
  const t5 = await hazirPlan('E5.ear', '/vhosting', 'H5');
  S.dbHata = (q) => q.includes('sil_istendi_at < DATEADD');
  const y5 = await ET.topluSil(istek(), topluGovde([t5]));
  S.dbHata = null;
  assert.equal(y5.baslatilan, 0);
  assert.equal(y5.sirada, 1);
  await ET.liste(false);
  assert.equal(satir(t5.id).durum, 'SILINIYOR');
  // tekli: kuyruk hatasi -> kayit sirada doner (basari), sonraki GET baslatir
  const t6 = await hazirPlan('E6.ear', '/vhosting', 'H6');
  S.dbHata = (q) => q.includes('sil_istendi_at < DATEADD');
  const k6 = await ET.sil(istek(), t6.id, {
    confirmed: true,
    ocoNo: '123456',
    onayMetni: 'E6.ear',
    planJobId: t6.planJobId,
  });
  S.dbHata = null;
  assert.equal(k6.sirada, true);
  await ET.liste(false);
  assert.equal(satir(t6.id).durum, 'SILINIYOR');
  // tekli: kesin red sonrasi kuyruk hatasi sonucu yutarsa ve kayit geri alindiysa basari denmez
  const t7 = await hazirPlan('E7.ear', '/vhosting', 'H7');
  S.launchHata = Object.assign(new Error('Bad Request'), { status: 400 });
  S.dbHata = (q) => q.includes("WHERE host = $1 AND durum IN ('PLAN_HAZIR', 'SILINIYOR')");
  await reddeder(
    ET.sil(istek(), t7.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'E7.ear',
      planJobId: t7.planJobId,
    }),
    502,
    'baslatilamadi',
  );
  S.dbHata = null;
  S.launchHata = null;
  assert.equal(satir(t7.id).durum, 'PLAN_HAZIR');
  assert.equal(satir(t7.id).sil_istendi_at, null);
});

test('ETT18 sirada kayit baslamadan bulgu kapisi: engel -> IPTAL; degerlendirme okunamazsa baslatma yok', async () => {
  const x = await hazirPlan();
  const yy = await hazirPlan('APPY.ear', '/vhosting8');
  await ET.topluSil(istek('veli'), topluGovde([x, yy]));
  // yy sirada iken APPY.ear domain.xml'e baglandi
  S.a.hosts[0].ear.uygulamalar = [
    { kok: '/vhosting8', ad: 'APPY.ear', jboss: '8', xml: { durum: 'VAR' } },
  ];
  S.jobs.set(satir(x.id).sil_job_id, okJob('APPX.ear'));
  await ET.liste(false);
  assert.equal(satir(yy.id).durum, 'IPTAL');
  assert.match(satir(yy.id).sonuc, /sırada iken yeniden denetlendi: .*domain\.xml/);
  assert.equal(silLaunchlari().length, 1);
  assert.equal(S.envanter.length, 1, 'bekleyen kalmadi: HOSTA taramasi');
  assert.ok(S.denetim.some((d) => d.faz === 'sira' && d.durum === 'IPTAL' && d.id === yy.id));
  // bulgu kalktiysa da IPTAL; degerlendirme okunamiyorsa once hicbiri baslamaz
  const p = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  const u = await hazirPlan('UNK.ear', '/vhosting', 'HOSTU');
  Object.assign(satir(p.id), { sil_istendi_at: simdi(), oco_no: '123456', sil_isteyen: 'veli' });
  Object.assign(satir(u.id), { sil_istendi_at: simdi(), oco_no: '123456', sil_isteyen: 'veli' });
  S.a.hosts.find((h) => h.host === 'HOSTP').findings = [];
  const asil = mevcutDeps();
  ET.kur({
    ...asil,
    getAssessment: async (fresh) => {
      if (fresh !== true) throw new Error('degerlendirme yok');
      return S.a;
    },
  });
  await ET.kuyrukIlerlet();
  assert.equal(satir(u.id).durum, 'PLAN_HAZIR');
  assert.equal(satir(p.id).durum, 'PLAN_HAZIR');
  assert.equal(silLaunchlari().length, 1);
  ET.kur(asil);
  await ET.kuyrukIlerlet();
  assert.equal(satir(p.id).durum, 'IPTAL');
  assert.match(satir(p.id).sonuc, /bulgusu artık yok/);
  assert.equal(satir(u.id).durum, 'SILINIYOR');
  // tekli istek sirada iken engel olustu: siradan duser
  bulguEkle('HOSTU', '/vhosting', 'UNK2.ear', '7');
  const w = await hazirPlan('UNK2.ear', '/vhosting', 'HOSTU');
  const sw = await ET.sil(istek(), w.id, {
    confirmed: true,
    ocoNo: '123456',
    onayMetni: 'UNK2.ear',
    planJobId: w.planJobId,
  });
  assert.equal(sw.sirada, true);
  S.a.hosts.find((h) => h.host === 'HOSTU').ear.uygulamalar = [
    { kok: '/vhosting', ad: 'UNK2.ear', jboss: '7', xml: { durum: 'VAR' } },
  ];
  S.jobs.set(satir(u.id).sil_job_id, okJob('UNK.ear'));
  await ET.tekKayit(w.id);
  assert.equal(satir(w.id).durum, 'IPTAL');
  assert.equal(silLaunchlari().length, 2);
});

test('ETT19 liste: son 50 kayda ek tum aktif kayitlar (sirada olan listeden dusmez)', async () => {
  const x = await hazirPlan();
  const yy = await hazirPlan('APPY.ear', '/vhosting8');
  await ET.topluSil(istek(), topluGovde([x, yy]));
  for (let i = 0; i < 55; i += 1) {
    DB.sira += 1;
    DB.satirlar.push({ ...satir(x.id), id: DB.sira, durum: 'IPTAL', ad: `ESKI${i}.ear` });
  }
  const l = await ET.liste(false);
  assert.equal(l.kayitlar.length, 52);
  const k = l.kayitlar.find((q) => q.id === yy.id);
  assert.ok(k, 'sirada kayit listede');
  assert.equal(k.sirada, true);
  assert.ok(l.kayitlar.some((q) => q.id === x.id));
  const idler = l.kayitlar.map((q) => q.id);
  assert.deepEqual(
    idler,
    [...idler].sort((a, b) => b - a),
  );
  assert.equal(l.adaylar.find((a) => a.ad === 'APPY.ear').kayit.id, yy.id);
});

test('ETT20 yurutucu turu kuyrugu sekmeden bagimsiz ilerletir; server/index.cjs kaydi', async () => {
  const { x, yy } = await siradaKur();
  S.jobs.set(satir(x.id).sil_job_id, okJob('APPX.ear'));
  assert.equal(await ET.yurutucuTuru(), true);
  assert.equal(satir(x.id).durum, 'SILINDI');
  assert.equal(satir(yy.id).durum, 'SILINIYOR');
  S.jobs.set(satir(yy.id).sil_job_id, okJob('APPY.ear'));
  await ET.yurutucuTuru();
  assert.equal(satir(yy.id).durum, 'SILINDI');
  assert.equal(S.envanter.length, 1);
  // ayni anda iki tur: ikincisi bos doner
  const ikili = await Promise.all([ET.yurutucuTuru(), ET.yurutucuTuru()]);
  assert.deepEqual(ikili, [true, false]);
  const asil = mevcutDeps();
  ET.kur(null);
  assert.equal(await ET.yurutucuTuru(), false, 'mount olmadan tur yok');
  ET.kur(asil);
  assert.ok(ET.YURUTUCU_SN > 0 && ET.YURUTUCU_SN <= 60);
  const fs = require('node:fs');
  const path = require('node:path');
  const idx = fs.readFileSync(path.join(__dirname, '..', '..', 'index.cjs'), 'utf8');
  assert.match(idx, /require\('\.\/server-hub\/ear-temizlik\.cjs'\)\.startPoller\(\)/);
});

test('ETT21 toplu sil: ls -ltr yok / basligi yanlis / parmak izi yok -> 409, hicbir kayit degismez', async () => {
  const bozuklar = [
    (pj) => ({ ...pj, ls: [] }),
    (pj) => ({
      ...pj,
      ls: ['drwxr-x--- 3 was was 4096 Nov 1 10:00 /vhosting/BASKA.ear', ...pj.ls.slice(1)],
    }),
    (pj) => ({ ...pj, fp: '' }),
  ];
  for (const boz of bozuklar) {
    DB.satirlar = [];
    const x = await hazirPlan();
    const p = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
    satir(x.id).plan_json = JSON.stringify(boz(JSON.parse(satir(x.id).plan_json)));
    await assert.rejects(ET.topluSil(istek(), topluGovde([x, p])), (e) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, 'toplu_red');
      assert.deepEqual(
        e.ek.reddedilenler.map((q) => q.id),
        [x.id],
      );
      assert.match(e.ek.reddedilenler[0].message, /ls -ltr çıktısı yok|parmak izi yok/);
      return true;
    });
    assert.equal(satir(x.id).sil_istendi_at, null);
    assert.equal(satir(p.id).sil_istendi_at, null);
    assert.equal(silLaunchlari().length, 0);
  }
});

test('ETT22 baslatma CAS: secimden sonra siradan cikan kayit baslamaz', async () => {
  const x = await hazirPlan();
  const asil = mevcutDeps();
  ET.kur({
    ...asil,
    getAssessment: async (fresh) => {
      // kuyruk degerlendirmesi (fresh=false) okunurken kayit siradan cikti
      if (fresh !== true) satir(x.id).sil_istendi_at = null;
      return S.a;
    },
  });
  const y = await ET.topluSil(istek(), topluGovde([x]));
  assert.equal(y.baslatilan, 0);
  assert.equal(silLaunchlari().length, 0);
  assert.equal(satir(x.id).durum, 'PLAN_HAZIR');
});

test('ETT23 tekli iptal (sirada) ayni sunucuda bekleyen taramayi baslatir', async () => {
  const b = bekleyenSilindi('HOSTA', '/vhosting', 'ESKI.ear');
  const yy = await hazirPlan('APPY.ear', '/vhosting8');
  Object.assign(satir(yy.id), { sil_istendi_at: simdi(), oco_no: '123456', sil_isteyen: 'veli' });
  await ET.iptal(istek(), yy.id);
  assert.equal(satir(yy.id).durum, 'IPTAL');
  assert.equal(S.envanter.length, 1);
  assert.equal(satir(b.id).envanter_kosu_id, 77);
});

test('ETT24 toplu iptal CAS toplu_id ile sinirli', async () => {
  const x = await hazirPlan();
  const yy = await hazirPlan('APPY.ear', '/vhosting8');
  const y = await ET.topluSil(istek(), topluGovde([x, yy]));
  let ilk = true;
  S.dbHata = (q) => {
    if (ilk && q.startsWith("UPDATE server_hub_ear_temizlik SET durum = 'IPTAL'")) {
      ilk = false;
      satir(yy.id).toplu_id = SIRA_DIGER;
    }
    return false;
  };
  const r = await ET.topluIptal(istek(), y.topluId);
  S.dbHata = null;
  assert.equal(r.iptal, 0);
  assert.equal(satir(yy.id).durum, 'PLAN_HAZIR');
});

test('ETT25 kuyruktan baslatma hatasi ayni sunucuda bekleyen taramayi baslatir', async () => {
  const b = bekleyenSilindi('HOSTA', '/vhosting', 'ESKI.ear');
  const yy = await hazirPlan('APPY.ear', '/vhosting8');
  Object.assign(satir(yy.id), {
    sil_istendi_at: simdi(),
    oco_no: '123456',
    sil_isteyen: 'veli',
    toplu_id: SIRA_DIGER,
  });
  S.launchHata = Object.assign(new Error('Bad Request'), { status: 400 });
  await ET.kuyrukIlerlet();
  assert.equal(satir(yy.id).durum, 'HATA');
  assert.equal(S.envanter.length, 1);
  assert.equal(satir(b.id).envanter_kosu_id, 77);
});

// KULLANIM ENGELI (2026-11-17, ODCRPAP01): JBoss'a bagli olmayan ama dizini kullanilan EAR (surec ya da son 7 gunde
// yazma) on kontrole de silmeye de giremez (tekli + toplu); olculemeyen / eski yazma engel degil.
test('ETT26 kullanim engeli: surec ya da 7 gun icinde yazma -> on kontrol / sil / toplu reddi', async () => {
  // Esik TARAMA anina gore (host(): taranma 2026-11-15T10:00:00Z), duvar saatine gore degil.
  const simdiSn = Math.floor(Date.parse('2026-11-15T10:00:00Z') / 1000);
  const kullanimli = (ad, kullanim) => ({
    kok: '/vhosting',
    ad,
    jboss: '7',
    durum: 'TAM',
    warSayisi: 0,
    xml: { durum: 'JVM_YOK', neden: 'TANIM_YOK', kullanim },
    kullanim,
  });
  const SUREC = {
    durum: 'VAR',
    surecler: [{ pid: 76867, comm: 'node', kullanici: 'was', nasil: 'cwd' }],
    son_yazma: null,
  };
  S.a.hosts.push(
    host(
      'HOSTK',
      'Non-Production',
      [
        'SUREC.ear',
        'YAZMA.ear',
        'ESKI.ear',
        'KISMI.ear',
        'SINIR.ear',
        'TEMIZ.ear',
        'ESKITAR.ear',
        'KORROOT.ear',
        'KORDIGER.ear',
        'KORESKI.ear',
      ].map((ad) => bulgu('/vhosting', ad, '7')),
      [
        kullanimli('SUREC.ear', SUREC),
        kullanimli('YAZMA.ear', { durum: 'YOK', surecler: [], son_yazma: simdiSn - 3600 }),
        kullanimli('ESKI.ear', { durum: 'YOK', surecler: [], son_yazma: simdiSn - 8 * 86400 }),
        kullanimli('KISMI.ear', {
          durum: 'KISMI',
          surecler: [],
          son_yazma: null,
          not: 'surec siniri',
        }),
        kullanimli('SINIR.ear', {
          durum: 'YOK',
          surecler: [],
          son_yazma: simdiSn - 7 * 86400 + 60,
        }),
        // 2026-11-23 (kullanici karari): izinle okunamayan surec. Hepsi root -> engel degil, uyari; root disi
        // ya da sahibi ayrilmamis (eski tarayici) -> ENGEL (tarayici `was` baskasinin cwd / fd'sini okuyamaz).
        kullanimli('KORROOT.ear', {
          durum: 'YOK',
          surecler: [],
          son_yazma: simdiSn - 30 * 86400,
          okunamayan: 40,
          okunamayan_diger: 0,
        }),
        kullanimli('KORDIGER.ear', {
          durum: 'KISMI',
          surecler: [],
          son_yazma: simdiSn - 30 * 86400,
          okunamayan: 40,
          okunamayan_diger: 2,
        }),
        kullanimli('KORESKI.ear', {
          durum: 'YOK',
          surecler: [],
          son_yazma: simdiSn - 30 * 86400,
          okunamayan: 40,
        }),
        // eski tarayici: xml JVM_YOK ama kullanim alani hic yok
        {
          kok: '/vhosting',
          ad: 'ESKITAR.ear',
          jboss: '7',
          durum: 'TAM',
          warSayisi: 0,
          xml: { durum: 'JVM_YOK', neden: 'TANIM_YOK' },
        },
      ],
    ),
  );
  const l = await ET.liste(false);
  const engel = (ad) => l.adaylar.find((x) => x.host === 'HOSTK' && x.ad === ad).engel;
  assert.match(engel('SUREC.ear'), /^dizin kullanımda \(süreç: node pid 76867 \[cwd\]\)$/);
  assert.match(engel('YAZMA.ear'), /^dizin kullanımda \(son yazma: \d\d\.\d\d\.\d{4} \d\d:\d\d\)$/);
  assert.match(engel('SINIR.ear'), /dizin kullanımda/, '7 gun icindeki yazma (sinirda) engel');
  assert.equal(engel('ESKI.ear'), null, '8 gun once yazma engel degil');
  // FAIL-CLOSED (kullanici karari 2026-11-17): olculemeyen ya da hic olculmemis kullanim ENGEL
  assert.equal(
    engel('KISMI.ear'),
    'dizin kullanımı ölçülemedi (surec siniri); silmek için yeni tarayıcıyla yeniden taranmalı',
  );
  assert.match(
    engel('ESKITAR.ear'),
    /^dizin kullanımı ölçülemedi \(.*eski tarayıcı.*\); silmek için/,
  );
  assert.equal(engel('TEMIZ.ear'), null, 'olculmus ve temiz kullanim engel degil');
  assert.equal(engel('KORROOT.ear'), null, 'yalniz root surecleri okunamadi: engel degil');
  assert.equal(
    engel('KORDIGER.ear'),
    'dizin kullanımı ölçülemedi (root dışı 2 süreç izin yüzünden okunamadı; dizini kullanıyor olabilir); silme kapalı: o süreçlerin bu dizini kullanmadığı doğrulanamıyor (tarama kimliği başka kullanıcıların süreçlerini okuyamaz)',
  );
  assert.equal(
    engel('KORESKI.ear'),
    'dizin kullanımı ölçülemedi (40 süreç okunamadı ve sahipleri bu tarayıcı sürümünde ayrılmadı); silmek için yeni tarayıcıyla yeniden taranmalı',
  );
  // engelli EAR'da ayrica uyari yok (engel metni zaten gosteriliyor); olculmus EAR'da uyari yok
  const uyari = (ad) => l.adaylar.find((x) => x.host === 'HOSTK' && x.ad === ad).kullanimUyarisi;
  assert.equal(uyari('KISMI.ear'), null);
  assert.equal(uyari('ESKI.ear'), null);
  assert.equal(uyari('SUREC.ear'), null);
  assert.equal(
    uyari('KORROOT.ear'),
    'dizin kullanımı kısmen görüldü: 40 root süreci izin yüzünden yalnız komut satırından denetlendi',
  );
  for (const ad of [
    'SUREC.ear',
    'YAZMA.ear',
    'KISMI.ear',
    'ESKITAR.ear',
    'KORDIGER.ear',
    'KORESKI.ear',
  ])
    await reddeder(ET.onKontrol(istek(), { host: 'HOSTK', kok: '/vhosting', ad }), 409, 'engel');
  assert.equal(S.launchlar.length, 0, 'engelli EAR icin AWX isi acilmaz');
  // toplu on kontrol: engelli oge ok:false, digeri baslar
  const y = await ET.topluOnKontrol(istek(), {
    adaylar: [
      { host: 'HOSTK', kok: '/vhosting', ad: 'SUREC.ear' },
      { host: 'HOSTK', kok: '/vhosting', ad: 'ESKI.ear' },
    ],
  });
  assert.deepEqual(
    y.sonuclar.map((x) => [x.ad, x.ok]),
    [
      ['SUREC.ear', false],
      ['ESKI.ear', true],
    ],
  );
  assert.match(y.sonuclar[0].message, /dizin kullanımda/);
  // plan hazirken kullanim basladi: tekli sil ve toplu sil reddedilir, hicbir kayit degismez
  const planlanan = await ET.tekKayit(y.sonuclar[1].id);
  S.jobs.set(planlanan.planJobId, sonucJob('PLAN', 'plan hazir', planEar('/vhosting', 'ESKI.ear')));
  const t = await ET.tekKayit(y.sonuclar[1].id);
  assert.equal(t.durum, 'PLAN_HAZIR');
  const t2 = await hazirPlan('TEMIZ.ear', '/vhosting', 'HOSTK');
  const hk = S.a.hosts.find((h) => h.host === 'HOSTK');
  hk.ear.uygulamalar = hk.ear.uygulamalar.map((u) =>
    u.ad === 'ESKI.ear' ? kullanimli('ESKI.ear', SUREC) : u,
  );
  await reddeder(
    ET.sil(istek(), t.id, {
      confirmed: true,
      ocoNo: '123456',
      onayMetni: 'ESKI.ear',
      planJobId: t.planJobId,
    }),
    409,
    'engel',
  );
  await assert.rejects(ET.topluSil(istek(), topluGovde([t, t2])), (e) => {
    assert.equal(e.status, 409);
    assert.deepEqual(
      e.ek.reddedilenler.map((x) => x.id),
      [t.id],
    );
    return true;
  });
  assert.equal(silLaunchlari().length, 0);
  assert.equal(satir(t2.id).sil_istendi_at, null, 'hepsi-ya-hic: digeri de isaretlenmedi');
});

// INCELEME B1 (2026-11-17): temizlik engeli de esigi TARAMA anina gore olcer. Envanter 10 gun once tarandi, dizin
// taramadan 1 saat once yazildi -> engel (duvar saatiyle 'eski yazma' sayilip silme acilirdi). Tarama anindan 1 gunden
// fazla ileri tarihli yazma kanit degil ve kullanim olculemedi sayilir -> FAIL-CLOSED engel (2026-11-17).
test('ETT27 kullanim engeli tarama anina gore: eski taramada taramadan once yazma engeldir', async () => {
  const TAR = Date.now() - 10 * 86400000;
  const sn = (ms) => Math.floor(ms / 1000);
  const kullanimli = (ad, kullanim) => ({
    kok: '/vhosting',
    ad,
    jboss: '7',
    durum: 'TAM',
    warSayisi: 0,
    xml: { durum: 'JVM_YOK', neden: 'TANIM_YOK', kullanim },
    kullanim,
  });
  const h = host(
    'HOSTE',
    'Non-Production',
    ['ONCE.ear', 'ILERI.ear'].map((ad) => bulgu('/vhosting', ad, '7')),
    [
      kullanimli('ONCE.ear', { durum: 'YOK', surecler: [], son_yazma: sn(TAR - 3600000) }),
      kullanimli('ILERI.ear', { durum: 'YOK', surecler: [], son_yazma: sn(TAR + 5 * 86400000) }),
    ],
  );
  h.ear.taranma = new Date(TAR).toISOString();
  S.a.hosts.push(h);
  const l = await ET.liste(false);
  const engel = (ad) => l.adaylar.find((x) => x.host === 'HOSTE' && x.ad === ad).engel;
  assert.match(engel('ONCE.ear'), /^dizin kullanımda \(son yazma: /);
  assert.match(
    engel('ILERI.ear'),
    /^dizin kullanımı ölçülemedi \(son yazma tarama anından ileri tarihli/,
  );
  await reddeder(
    ET.onKontrol(istek(), { host: 'HOSTE', kok: '/vhosting', ad: 'ONCE.ear' }),
    409,
    'engel',
  );
  assert.equal(S.launchlar.length, 0);
});

// FAIL-CLOSED (kullanici karari 2026-11-17): bulgusu olan ama envanter kaydi bulunamayan EAR'in dizin kullanimi
// bilinemez -> engel; on kontrol AWX isi acmaz.
test('ETT28 envanter kaydi olmayan EAR engellenir (kullanim bilinemez)', async () => {
  const h = host('HOSTN', 'Non-Production', []);
  h.findings.push(bulgu('/vhosting', 'KAYITSIZ.ear', '7'));
  S.a.hosts.push(h);
  const l = await ET.liste(false);
  const a = l.adaylar.find((x) => x.host === 'HOSTN' && x.ad === 'KAYITSIZ.ear');
  assert.equal(a.engel, 'dizin kullanımı ölçülemedi (envanter kaydı bulunamadı)');
  await reddeder(
    ET.onKontrol(istek(), { host: 'HOSTN', kok: '/vhosting', ad: 'KAYITSIZ.ear' }),
    409,
    'engel',
  );
  assert.equal(S.launchlar.length, 0);
});

// ── ETO: uretimde silme yalniz acik OCO penceresinde (2026-11-22, kullanici karari; PR-R) ──
const prodGovde = (t, ek = {}) => ({
  confirmed: true,
  onayMetni: 'PRODAPP.ear',
  planJobId: t.planJobId,
  ...ek,
});

test('ETO1 Production silmesi OCO numarasi ister; yoksa / gecersizse 400 oco_gerekli, is acilmaz', async () => {
  const t = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  const once = S.launchlar.length;
  await reddeder(ET.sil(istek(), t.id, prodGovde(t)), 400, 'oco_gerekli');
  await reddeder(ET.sil(istek(), t.id, prodGovde(t, { ocoNo: 'OCO-1;x' })), 400, 'oco_gerekli');
  assert.equal(S.launchlar.length, once, 'OCO numarasiz is acildi');
  assert.equal(satir(t.id).sil_istendi_at, null, 'kayit isaretlenmemeli');
  assert.deepEqual(S.ocoCagri, [], 'gecersiz numarayla OCO sorgulanmamali');
});

test('ETO2 pencere kapaliysa 409 oco_pencere; OCO okunamazsa 5xx (fail-closed); is acilmaz', async () => {
  const t = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  const once = S.launchlar.length;
  S.ocoPencere = () => ({ ok: false, status: 400, message: 'kesinti penceresi henuz baslamadi' });
  await reddeder(ET.sil(istek(), t.id, prodGovde(t, { ocoNo: '123456' })), 409, 'oco_pencere');
  S.ocoPencere = () => ({ ok: false, status: 503, message: 'OCO servisine ulasilamadi' });
  await reddeder(ET.sil(istek(), t.id, prodGovde(t, { ocoNo: '123456' })), 503, 'oco_pencere');
  assert.equal(S.launchlar.length, once, 'pencere disinda is acildi');
  assert.equal(satir(t.id).durum, 'PLAN_HAZIR');
});

test('ETO3 pencere aciksa silme baslar, numara kayitta ve denetimde; Non-Production OCO sormaz', async () => {
  const t = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  const k = await ET.sil(istek(), t.id, prodGovde(t, { ocoNo: ' 123456 ' }));
  assert.equal(k.durum, 'SILINIYOR');
  assert.equal(satir(t.id).oco_no, '123456');
  assert.equal(k.ocoNo, '123456');
  assert.ok(S.denetim.some((d) => d.op === 'ear_temizlik_sil' && d.ocoNo === '123456'));
  assert.equal(silLaunchlari().length, 1);
  const n = await hazirPlan('APPX.ear', '/vhosting', 'HOSTA');
  const cagri = S.ocoCagri.length;
  const nk = await ET.sil(istek(), n.id, {
    confirmed: true,
    ocoNo: '123456',
    onayMetni: 'APPX.ear',
    planJobId: n.planJobId,
  });
  assert.equal(nk.durum, 'SILINIYOR');
  assert.equal(S.ocoCagri.length, cagri, 'Non-Production icin OCO sorgulandi');
  assert.equal(satir(n.id).oco_no ?? null, null);
});

test('ETO4 kuyrukta beklerken pencere kapanirsa is ACILMADAN iptal (neden kayitta); toplu tek numarayla', async () => {
  // Ayni sunucuda suren silme: ikinci prod kayit sirada bekler.
  S.a = {
    hosts: [
      host('HOSTP', 'Production', [
        bulgu('/vhosting', 'PRODAPP.ear', '7'),
        bulgu('/vhosting', 'PROD2.ear', '7'),
      ]),
    ],
  };
  const t1 = await hazirPlan('PRODAPP.ear', '/vhosting', 'HOSTP');
  await ET.sil(istek(), t1.id, prodGovde(t1, { ocoNo: '123456' }));
  const t2 = await hazirPlan('PROD2.ear', '/vhosting', 'HOSTP');
  const s2 = await ET.sil(istek(), t2.id, {
    confirmed: true,
    onayMetni: 'PROD2.ear',
    planJobId: t2.planJobId,
    ocoNo: '123456',
  });
  assert.equal(s2.sirada, true, 'ayni sunucuda ikinci silme sirada olmali');
  const silOnce = silLaunchlari().length;
  // Ilk silme biter, pencere kapanmistir: siradaki baslatilmaz.
  S.jobs.set(satir(t1.id).sil_job_id, sonucJob('OK', 'silindi', PLAN_EAR));
  S.ocoPencere = () => ({ ok: false, status: 400, message: 'kesinti penceresi bitti' });
  await ET.yurutucuTuru();
  assert.equal(silLaunchlari().length, silOnce, 'pencere kapaliyken siradaki is acildi');
  assert.equal(satir(t2.id).durum, 'IPTAL');
  assert.match(satir(t2.id).sonuc, /OCO 123456: kesinti penceresi bitti/);
  // Toplu: secimde prod varsa tek numara zorunlu; yoksa hicbir kayit isaretlenmez.
  S.ocoPencere = null;
  S.a = cokHost(3);
  const planlar = [];
  for (let i = 1; i <= 3; i += 1) planlar.push(await hazirPlan(`E${i}.ear`, '/vhosting', `H${i}`));
  const govde = topluGovde(planlar);
  delete govde.ocoNo;
  await reddeder(ET.topluSil(istek(), govde), 400, 'oco_gerekli');
  assert.ok(
    planlar.every((p) => satir(p.id).sil_istendi_at == null),
    'numarasiz toplu isaretledi',
  );
  await ET.topluSil(istek(), topluGovde(planlar));
  assert.equal(satir(planlar[0].id).oco_no, '123456', 'prod kayda numara yazilmali');
  assert.equal(
    satir(planlar[1].id).oco_no ?? null,
    null,
    'Non-Production kayda numara yazilmamali',
  );
});
