// server/server-hub/__tests__/ear-temizlik.test.cjs - Server Hub > EAR Temizligi (2026-11-16) davranisi.
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
function host(ad, envGroup, findings, uygulamalar = []) {
  return {
    host: ad,
    env: envGroup === 'Production' ? 'PROD' : 'TEST',
    envGroup,
    findings,
    ear: { durum: 'VAR', taranma: '2026-11-15T10:00:00Z', uygulamalar },
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
      ET.sil(istek(), k.id, { confirmed: true, onayMetni: ad, planJobId: k.planJobId }),
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
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId }),
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
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId }),
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
  };
  _mevcut = deps;
  ET.kur(deps);
});

// ── ET9 ──
test('ET9 onayMetni / planJobId uyusmazligi reddi; launch yok, durum PLAN_HAZIR', async () => {
  const t = await hazirPlan();
  await reddeder(
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: 'appx.ear', planJobId: t.planJobId }),
    400,
    'onay_metni',
  );
  await reddeder(
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: ' APPX.ear', planJobId: t.planJobId }),
    400,
    'onay_metni',
  );
  await reddeder(
    ET.sil(istek(), t.id, { confirmed: true, planJobId: t.planJobId }),
    400,
    'onay_metni',
  );
  await reddeder(
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId + 1 }),
    409,
    'plan_degisti',
  );
  await reddeder(
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: 'APPX.ear' }),
    409,
    'plan_degisti',
  );
  await reddeder(
    ET.sil(istek(), 999, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId }),
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
  const govde = { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId };
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
  const govde = { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId };
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
  const govde = { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId };
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
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId }),
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
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId }),
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
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId }),
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
    { confirmed: true, onayMetni: 'APPX.ear', planJobId: g.body.kayit.planJobId },
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
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId }),
    409,
    'ls_yok',
  );
  DB.satirlar[0].plan_json = JSON.stringify({ fp: FP, ls: ['total 0'], info: [] });
  await reddeder(
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId }),
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
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId }),
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
    ET.sil(istek(), t.id, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t.planJobId }),
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
  await ET.sil(istek(), t3.id, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t3.planJobId });
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
  await ET.sil(istek(), t4.id, { confirmed: true, onayMetni: 'APPX.ear', planJobId: t4.planJobId });
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
